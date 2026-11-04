// server/services/schema/schemaVersionado.js
//
// P0 03/11/2026 — estabilidade do PostgreSQL no boot.
//
// O PROBLEMA: os `ensure*` do boot reexecutavam o DDL inteiro em TODA subida
// do processo. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` pede ACCESS
// EXCLUSIVE na tabela ANTES de descobrir que a coluna já existe, e
// `CREATE INDEX IF NOT EXISTS` pede SHARE antes de descobrir que o índice já
// existe (provado em PG 18.6 local — ver o relatório em
// Prompts/PostgreSQL_Estabilidade/). Sem `lock_timeout`, um ALTER desses que
// encontra uma leitura longa em andamento ESPERA — e toda query que chega
// depois na mesma tabela entra na fila atrás dele: a Central inteira para e o
// pool enche, a cada deploy.
//
// A CORREÇÃO (aditiva, sem mudar o DDL de ninguém):
//   1. Marcador de versão: tabela `venforce_schema_versoes (chave, hash)`. O
//      hash é o SHA-256 do SQL efetivamente aplicado. Se o marcador da chave
//      já tem o hash do SQL atual, NADA é executado — só um SELECT por chave
//      (sem lock em tabela de negócio). Mudou o SQL (deploy com DDL novo),
//      base nova ou parcialmente migrada (sem marcador) → aplica uma vez.
//   2. Quando aplica: conexão dedicada, BEGIN, statement_timeout, advisory
//      lock de transação (a MESMA chave que cada ensure já usava — duas
//      instâncias no deploy continuam serializadas, inclusive contra o código
//      antigo), releitura do marcador (outra instância pode ter acabado de
//      aplicar), `lock_timeout` curto para o DDL e, no fim, o marcador gravado
//      na MESMA transação do DDL (nunca "marcado sem aplicar").
//   3. `lock_timeout` estourado (55P03) devolve o erro: quem chamou tenta de
//      novo depois (o boot sequencial tem retry com backoff; os ensures
//      chamados sob demanda tentam na próxima chamada). Nunca fica pendurado
//      segurando a fila de locks.
//
// Escape: VF_SCHEMA_REAPLICAR=1 ignora o marcador (reaplica tudo uma vez, com
// as mesmas proteções). Útil se alguém alterar o schema à mão.

const crypto = require("crypto");

const TABELA_VERSOES = "venforce_schema_versoes";
const LOCK_TABELA_VERSOES = "vf:schema:venforce_schema_versoes";

const LOCK_TIMEOUT_PADRAO_MS = 3000;
const STATEMENT_TIMEOUT_PADRAO_MS = 120000;
// Teto para ESPERAR o advisory lock (outra instância aplicando o mesmo DDL).
// Estourou ⇒ VF_SCHEMA_LOCK_OCUPADO, erro transitório: o boot tenta de novo.
const ESPERA_LOCK_PADRAO_MS = 60000;

// Linhas `BEGIN;` / `COMMIT;` de NÍVEL SUPERIOR de um arquivo de migration
// (as de Squads e de custos abrem a própria transação). Dentro da transação
// protegida, aquele COMMIT a encerraria antes do marcador. Só casa a linha
// inteira com ponto e vírgula — `BEGIN` de bloco DO $$ … $$ não é tocado.
function semTransacaoPropria(sql) {
  return String(sql).replace(/^[ \t]*(BEGIN|COMMIT)[ \t]*;[ \t]*$/gim, "-- ($1 do arquivo: transação controlada por schemaVersionado)");
}

// Espera o advisory lock com teto próprio; depois devolve o statement_timeout
// da etapa seguinte. 57014 aqui = outra instância segurando o lock.
async function esperarAdvisoryLock(client, sqlLock, chaveLock, esperaMs) {
  await client.query(`SET LOCAL statement_timeout = ${Number(esperaMs)}`);
  try {
    await client.query(sqlLock, [chaveLock]);
  } catch (err) {
    if (err?.code === "57014") {
      throw Object.assign(new Error(`advisory lock de schema ocupado por mais de ${esperaMs} ms (${chaveLock})`), {
        code: "VF_SCHEMA_LOCK_OCUPADO",
        cause: err,
      });
    }
    throw err;
  }
}

function hashDoSql(sql) {
  return crypto.createHash("sha256").update(String(sql)).digest("hex");
}

function msDoEnv(nome, padrao) {
  const n = Number.parseInt(process.env[nome], 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

function ehPool(db) {
  return typeof db?.connect === "function" && typeof db?.release !== "function";
}

// Lê o hash gravado para `chave`. Tabela de versões ausente = nada aplicado
// ainda (base nova ou anterior a este mecanismo).
async function lerVersao(db, chave) {
  try {
    const { rows } = await db.query(
      `/* schema:VERSAO */ SELECT hash FROM ${TABELA_VERSOES} WHERE chave = $1`,
      [chave]
    );
    return rows[0]?.hash || null;
  } catch (err) {
    if (err?.code === "42P01") return null; // undefined_table
    throw err;
  }
}

// Cria a tabela de versões numa transação curta própria, serializada por
// advisory lock (CREATE TABLE IF NOT EXISTS concorrente pode falhar com 23505
// em pg_type). Tabela nova e minúscula: não toca nenhuma tabela de negócio.
async function garantirTabelaVersoes(client, esperaMs = msDoEnv("VF_SCHEMA_ESPERA_LOCK_MS", ESPERA_LOCK_PADRAO_MS)) {
  await client.query("BEGIN");
  try {
    await esperarAdvisoryLock(client, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", LOCK_TABELA_VERSOES, esperaMs);
    await client.query(`SET LOCAL statement_timeout = ${Number(esperaMs)}`);
    await client.query(`SET LOCAL lock_timeout = ${LOCK_TIMEOUT_PADRAO_MS}`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${TABELA_VERSOES} (
         chave TEXT PRIMARY KEY,
         hash TEXT NOT NULL,
         aplicado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

const SQL_LOCK = {
  hashtext: "SELECT pg_advisory_xact_lock(hashtext($1))",
  hashtextextended: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
};

/**
 * Aplica `sql` (DDL idempotente) só se o marcador de `chave` não tiver o hash
 * dele. Exige um pool (connect + query). Devolve
 * { aplicado: boolean, motivo: "atualizado" | "aplicado" | "aplicado_por_outra_instancia" }.
 *
 * lockKey/lockFn: a chave de advisory lock que o ensure JÁ usava, com a mesma
 * função de hash, para continuar mutuamente exclusivo com o código anterior.
 */
async function aplicarSchemaVersionado({
  db,
  chave,
  sql,
  lockKey,
  lockFn = "hashtextextended",
  lockTimeoutMs = msDoEnv("VF_SCHEMA_LOCK_TIMEOUT_MS", LOCK_TIMEOUT_PADRAO_MS),
  statementTimeoutMs = msDoEnv("VF_SCHEMA_STATEMENT_TIMEOUT_MS", STATEMENT_TIMEOUT_PADRAO_MS),
  esperaLockMs = msDoEnv("VF_SCHEMA_ESPERA_LOCK_MS", ESPERA_LOCK_PADRAO_MS),
  removerTransacaoPropria = false,
  forcar = process.env.VF_SCHEMA_REAPLICAR === "1",
  logger = console,
}) {
  if (!ehPool(db)) throw new Error("aplicarSchemaVersionado exige um pool (connect/query)");
  if (!SQL_LOCK[lockFn]) throw new Error(`lockFn inválido: ${lockFn}`);
  const hash = hashDoSql(sql);

  // Caminho quente (todo boot com schema em dia): 1 SELECT, nenhuma conexão
  // dedicada, nenhum lock em tabela de negócio.
  if (!forcar && (await lerVersao(db, chave)) === hash) {
    return { aplicado: false, motivo: "atualizado" };
  }

  const inicio = Date.now();
  const client = await db.connect();
  let descartar;
  try {
    await garantirTabelaVersoes(client, esperaLockMs);
    await client.query("BEGIN");
    // A espera pela outra instância tem teto próprio (esperaLockMs →
    // VF_SCHEMA_LOCK_OCUPADO, transitório). lock_timeout só DEPOIS: ele valeria
    // para o advisory lock também, e esperar a outra instância é o certo.
    await esperarAdvisoryLock(client, SQL_LOCK[lockFn], lockKey || `vf:schema:${chave}`, esperaLockMs);
    await client.query(`SET LOCAL statement_timeout = ${Number(statementTimeoutMs)}`);
    if (!forcar && (await lerVersao(client, chave)) === hash) {
      await client.query("COMMIT");
      return { aplicado: false, motivo: "aplicado_por_outra_instancia" };
    }
    await client.query(`SET LOCAL lock_timeout = ${Number(lockTimeoutMs)}`);
    await client.query(removerTransacaoPropria ? semTransacaoPropria(sql) : sql);
    await client.query(
      `INSERT INTO ${TABELA_VERSOES} (chave, hash, aplicado_em) VALUES ($1, $2, NOW())
       ON CONFLICT (chave) DO UPDATE SET hash = EXCLUDED.hash, aplicado_em = EXCLUDED.aplicado_em`,
      [chave, hash]
    );
    await client.query("COMMIT");
    logger.log?.(`[schema] ${chave}: DDL aplicado em ${Date.now() - inicio} ms (hash ${hash.slice(0, 12)})`);
    return { aplicado: true, motivo: "aplicado" };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      descartar = rollbackErr; // conexão em estado desconhecido: não volta ao pool
    }
    throw err;
  } finally {
    client.release(descartar);
  }
}

module.exports = {
  aplicarSchemaVersionado,
  lerVersao,
  hashDoSql,
  semTransacaoPropria,
  TABELA_VERSOES,
  LOCK_TIMEOUT_PADRAO_MS,
  STATEMENT_TIMEOUT_PADRAO_MS,
};
