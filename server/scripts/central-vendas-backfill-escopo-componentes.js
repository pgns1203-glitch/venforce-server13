#!/usr/bin/env node
// server/scripts/central-vendas-backfill-escopo-componentes.js
//
// Backfill HISTÓRICO (execução única) da classificação M6 de
// central_vendas_componentes (escopo / efeito / incluido_no_resultado) nas
// linhas legadas com escopo IS NULL. Até 03/11/2026 isto era um UPDATE dentro
// de central_vendas_schema.sql, executado em TODO boot, na mesma transação dos
// ALTER TABLE (ACCESS EXCLUSIVE), varrendo a tabela inteira (~2 GB em
// produção) para não achar nenhuma linha. Saiu do boot; quem precisar dele
// (base legada anterior ao M6) roda este script UMA vez.
//
// Seguro para produção:
//   - padrão DRY-RUN: só conta, lote a lote, as linhas sem classificação;
//   - percorre a tabela por FAIXA DE id (índice da PK): cada lote é uma
//     transação curta, com statement_timeout e lock_timeout próprios e pausa
//     entre lotes — nunca uma varredura longa, nunca um lock longo;
//   - mesma regra determinística de classificarComponenteFinanceiro() (o
//     teste centralVendasBackfillEscopo.test.js compara as duas);
//   - só toca linhas com escopo IS NULL (idempotente: rodar de novo é no-op);
//   - NÃO lê server/.env: usa só o DATABASE_URL do shell e imprime o host antes
//     de qualquer query. --apply fora de localhost exige --confirm-host=<host>.
//
//   DATABASE_URL=... node server/scripts/central-vendas-backfill-escopo-componentes.js
//       [--apply [--confirm-host=<host>]] [--lote=5000] [--pausa-ms=200] [--limite-minutos=30] [--a-partir-de=<id>]

const { Pool } = require("pg");
const { protegerConexoesDoPool } = require("../config/databaseConexao");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);

// A MESMA regra de classificarComponenteFinanceiro() (o UPDATE que saiu do
// schema tratava item_id '' como 'item'; o JS trata como 'pedido' — aqui vale o JS).
const SET_CLASSIFICACAO = `
  escopo = CASE WHEN c.item_id IS NULL OR c.item_id = '' THEN 'pedido' ELSE 'item' END,
  efeito = CASE c.tipo
             WHEN 'receita_produto' THEN 'credito'
             WHEN 'receita_envio' THEN 'credito'
             WHEN 'tarifa_venda' THEN 'debito'
             WHEN 'custo_produto' THEN 'debito'
             WHEN 'imposto_interno' THEN 'debito'
             WHEN 'frete_seller' THEN 'debito'
             WHEN 'cancelamento_reembolso' THEN 'debito'
             ELSE NULL
           END,
  incluido_no_resultado = CASE
             WHEN c.tipo IN ('receita_produto', 'tarifa_venda', 'custo_produto', 'imposto_interno', 'frete_seller') THEN TRUE
             WHEN c.tipo IN ('receita_envio', 'cancelamento_reembolso') THEN FALSE
             ELSE NULL
           END`;

function lerArgs(argv) {
  const args = {};
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  }
  return args;
}

function hostDaUrl(url) {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return "?";
  }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Núcleo testável. db = pool (connect/query). Devolve
 * { modo, lotes, linhasSemClassificacao, linhasAtualizadas, faixa, interrompido }.
 */
async function executarBackfill({
  db,
  apply = false,
  aPartirDe = null,
  tamanhoLote = 5000,
  pausaMs = 200,
  limiteMs = 30 * 60 * 1000,
  statementTimeoutMs = 30000,
  lockTimeoutMs = 2000,
  logger = console,
  sleep = dormir,
}) {
  const { rows: [faixa] } = await db.query(
    "SELECT MIN(id)::bigint AS min, MAX(id)::bigint AS max FROM central_vendas_componentes"
  );
  const resultado = {
    modo: apply ? "apply" : "dry-run",
    lotes: 0,
    linhasSemClassificacao: 0,
    linhasAtualizadas: 0,
    faixa: { min: faixa.min, max: faixa.max },
    interrompido: false,
  };
  if (faixa.min === null) return resultado;
  const inicio = Date.now();
  let de = BigInt(faixa.min);
  if (aPartirDe !== null && BigInt(aPartirDe) > de) de = BigInt(aPartirDe);
  const ate = BigInt(faixa.max);
  const passo = BigInt(tamanhoLote);
  while (de <= ate) {
    if (Date.now() - inicio > limiteMs) {
      resultado.interrompido = true;
      resultado.retomarDe = de.toString();
      logger.log?.(`[backfill-escopo] limite de tempo: parou antes do id ${de} (retome com --a-partir-de=${de})`);
      break;
    }
    const fimLote = de + passo - 1n;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL statement_timeout = ${Number(statementTimeoutMs)}`);
      await client.query(`SET LOCAL lock_timeout = ${Number(lockTimeoutMs)}`);
      if (apply) {
        const r = await client.query(
          `UPDATE central_vendas_componentes c SET ${SET_CLASSIFICACAO}
            WHERE c.id BETWEEN $1 AND $2 AND c.escopo IS NULL`,
          [de.toString(), fimLote.toString()]
        );
        resultado.linhasAtualizadas += r.rowCount;
        resultado.linhasSemClassificacao += r.rowCount;
      } else {
        const r = await client.query(
          `SELECT COUNT(*)::int AS n FROM central_vendas_componentes
            WHERE id BETWEEN $1 AND $2 AND escopo IS NULL`,
          [de.toString(), fimLote.toString()]
        );
        resultado.linhasSemClassificacao += r.rows[0].n;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      throw Object.assign(err, { loteDe: de.toString() });
    }
    client.release();
    resultado.lotes += 1;
    de = fimLote + 1n;
    if (pausaMs > 0 && de <= ate) await sleep(pausaMs);
  }
  return resultado;
}

async function main() {
  const args = lerArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL não definido no shell (o .env NÃO é lido por este script).");
    process.exit(2);
  }
  const host = hostDaUrl(process.env.DATABASE_URL);
  console.error(`[backfill-escopo] banco: host=${host}`);
  const apply = args.apply === true;
  if (apply && !LOCAL_HOSTS.has(host) && args["confirm-host"] !== host) {
    console.error(`[backfill-escopo] --apply fora de localhost exige --confirm-host=${host}`);
    process.exit(3);
  }
  const pool = protegerConexoesDoPool(new (Pool)({
    connectionString: process.env.DATABASE_URL,
    ssl: LOCAL_HOSTS.has(host) ? false : { rejectUnauthorized: false },
    max: 1,
  }));
  try {
    const r = await executarBackfill({
      db: pool,
      apply,
      aPartirDe: args["a-partir-de"] ? String(args["a-partir-de"]) : null,
      tamanhoLote: args.lote ? Number(args.lote) : 5000,
      pausaMs: args["pausa-ms"] !== undefined ? Number(args["pausa-ms"]) : 200,
      limiteMs: (args["limite-minutos"] ? Number(args["limite-minutos"]) : 30) * 60 * 1000,
    });
    console.log(JSON.stringify({ host, ...r }, null, 2));
    if (!apply) console.log(`DRY-RUN: nada foi alterado. ${r.linhasSemClassificacao} linha(s) sem classificação.`);
  } finally {
    await pool.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[backfill-escopo] falhou: ${err.code || ""} ${err.message}${err.loteDe ? ` (lote a partir do id ${err.loteDe})` : ""}`);
    process.exit(1);
  });
}

module.exports = { executarBackfill, SET_CLASSIFICACAO };
