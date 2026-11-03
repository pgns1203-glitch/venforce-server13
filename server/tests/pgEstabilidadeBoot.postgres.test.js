// server/tests/pgEstabilidadeBoot.postgres.test.js
//
// P0 03/11/2026 — estabilidade do PostgreSQL no boot, contra PostgreSQL REAL
// local (de preferência um cluster descartável com os limites do Render
// Basic-256mb: shared_buffers=64MB, work_mem=1600kB, max_connections=103).
//
//   VF_PG_ESTABILIDADE_TEST_DATABASE_URL=postgres://vf@127.0.0.1:57652/postgres \
//     node tests/pgEstabilidadeBoot.postgres.test.js
//
// Sem a variável: PULA (exit 0). Host fora de localhost: recusa.
// O cenário de CRASH (kill -9 num backend → crash-recovery do servidor
// inteiro, o mesmo mecanismo do incidente) só roda com
// VF_PG_ESTABILIDADE_PERMITE_CRASH=1 — derruba TODAS as conexões do cluster.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { Pool, Client } = require("pg");

const BASE_URL = process.env.VF_PG_ESTABILIDADE_TEST_DATABASE_URL;
if (!BASE_URL) {
  console.log("  (pulado) defina VF_PG_ESTABILIDADE_TEST_DATABASE_URL para rodar contra PostgreSQL local");
  process.exit(0);
}
const HOST = new URL(BASE_URL).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(HOST)) {
  console.error(`LOCAL_DATABASE_REQUIRED (host=${HOST})`);
  process.exit(1);
}
// O pool do app (config/database) nunca é usado aqui; porta morta por segurança.
process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/teste-sem-banco";

const { aplicarSchemaVersionado, lerVersao, hashDoSql } = require("../services/schema/schemaVersionado");
const repository = require("../services/centralVendas/centralVendasRepository");
const { executarBackfill } = require("../scripts/central-vendas-backfill-escopo-componentes");
const { classificarComponenteFinanceiro } = require("../services/centralVendas/centralVendasComponenteLedger");
const { executarEtapasDeBoot } = require("../services/boot/bootSequencial");
const { instrumentarPool } = require("../config/databaseObservabilidade");
const { protegerConexoesDoPool } = require("../config/databaseConexao");

const SCHEMA_CENTRAL = fs.readFileSync(path.join(__dirname, "..", "sql", "central_vendas_schema.sql"), "utf8");
const FIXTURES = `
CREATE TABLE users (id integer PRIMARY KEY);
CREATE TABLE clientes (id integer PRIMARY KEY, nome text, slug text UNIQUE, ativo boolean DEFAULT true);
CREATE TABLE cliente_contas (id integer PRIMARY KEY, cliente_id integer REFERENCES clientes(id));
CREATE TABLE ml_tokens (id integer PRIMARY KEY);
CREATE TABLE bases (id integer PRIMARY KEY);
INSERT INTO clientes VALUES (1, 'Loja', 'loja', true);
INSERT INTO cliente_contas VALUES (5, 1);
`;

let checks = 0;
function ok(label) {
  checks += 1;
  console.log(`  ok  ${label}`);
}
const silencioso = { log: () => {}, warn: () => {}, error: () => {} };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const nomeDb = `vf_pgestab_${Date.now()}_${process.pid}`;
const urlDb = (() => { const u = new URL(BASE_URL); u.pathname = `/${nomeDb}`; return u.toString(); })();
const pools = [];
function novoPool(max = 4) {
  const p = protegerConexoesDoPool(new Pool({ connectionString: urlDb, ssl: false, max, connectionTimeoutMillis: 5000 }), { logger: silencioso });
  pools.push(p);
  return p;
}
async function novoClient() {
  const c = new Client({ connectionString: urlDb, ssl: false });
  c.on("error", () => {});
  await c.connect();
  return c;
}
async function existeColuna(q, tabela, coluna) {
  const { rows } = await q.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2", [tabela, coluna]
  );
  return rows.length === 1;
}
async function existeIndice(q, nome) {
  const { rows } = await q.query("SELECT to_regclass($1) IS NOT NULL AS e", [`public.${nome}`]);
  return rows[0].e;
}
// Segura AccessShare (leitura) em imports e RowExclusive (escrita) em
// componentes numa transação aberta — o que uma leitura longa da Central e um
// sync em andamento seguram em produção.
async function segurarLocksDeNegocio() {
  const c = await novoClient();
  await c.query("BEGIN");
  await c.query("SELECT count(*) FROM central_vendas_imports");
  await c.query("UPDATE central_vendas_componentes SET obs = obs WHERE id = -1");
  return { c, liberar: async () => { await c.query("COMMIT").catch(() => {}); await c.end().catch(() => {}); } };
}
async function cronometrar(fn) {
  const t0 = Date.now();
  let erro = null;
  let resultado;
  try { resultado = await fn(); } catch (err) { erro = err; }
  return { ms: Date.now() - t0, erro, resultado };
}

async function main() {
  console.log(`  banco de teste: host=${HOST} db=${nomeDb}`);
  const admin = new Client({ connectionString: BASE_URL, ssl: false });
  admin.on("error", () => {});
  await admin.connect();
  await admin.query(`CREATE DATABASE "${nomeDb}"`);
  const { rows: [cfg] } = await admin.query(
    "SELECT current_setting('shared_buffers') sb, current_setting('work_mem') wm, current_setting('max_connections') mc, version() v"
  );
  console.log(`  servidor: ${cfg.v.split(" ").slice(0, 2).join(" ")} shared_buffers=${cfg.sb} work_mem=${cfg.wm} max_connections=${cfg.mc}`);
  try {
    const setup = novoPool();
    await setup.query(FIXTURES);

    // ── 1. base NOVA + dois boots concorrentes (duas instâncias) ───────────
    {
      const a = novoPool();
      const b = novoPool();
      const rs = await Promise.all([
        aplicarSchemaVersionado({ db: a, chave: "central_vendas_schema", sql: SCHEMA_CENTRAL, lockKey: "venforce:central-vendas:schema", logger: silencioso }),
        aplicarSchemaVersionado({ db: b, chave: "central_vendas_schema", sql: SCHEMA_CENTRAL, lockKey: "venforce:central-vendas:schema", logger: silencioso }),
      ]);
      const motivos = rs.map((r) => r.motivo).sort();
      assert.deepStrictEqual(motivos, ["aplicado", "aplicado_por_outra_instancia"], JSON.stringify(rs));
      assert.strictEqual(await lerVersao(setup, "central_vendas_schema"), hashDoSql(SCHEMA_CENTRAL));
      assert.ok(await existeColuna(setup, "central_vendas_imports", "coverage_date_to"));
      ok("base nova + 2 boots simultâneos: DDL aplicado UMA vez, a 2ª instância espera o advisory lock e não repete");

      // Além do schema da Central, os ensures do processo (pool real) também em paralelo.
      const [r1, r2] = await Promise.all([repository.ensureCentralVendasTables(novoPool()), repository.ensureCentralVendasTables(novoPool())]);
      assert.strictEqual(r1, undefined); assert.strictEqual(r2, undefined);
      ok("ensureCentralVendasTables em 2 pools (2 processos) com schema em dia: ambos ok");
    }

    // ── 2. schema EM DIA: nenhum lock pedido em tabela de negócio ──────────
    {
      const trava = await segurarLocksDeNegocio();
      try {
        const novo = await cronometrar(() => aplicarSchemaVersionado({
          db: novoPool(), chave: "central_vendas_schema", sql: SCHEMA_CENTRAL, lockKey: "venforce:central-vendas:schema", logger: silencioso,
        }));
        assert.ifError(novo.erro);
        assert.strictEqual(novo.resultado.motivo, "atualizado");
        assert.ok(novo.ms < 1000, `${novo.ms} ms`);
        ok(`schema em dia com leitura+escrita longas abertas na Central: ensure termina em ${novo.ms} ms, sem DDL`);

        // O comportamento ANTIGO (o arquivo inteiro a cada boot), com lock_timeout de 1 s
        // só para não pendurar o teste: o ALTER pede ACCESS EXCLUSIVE e fica preso.
        const c = await novoClient();
        const antigo = await cronometrar(async () => {
          await c.query("BEGIN");
          await c.query("SET LOCAL lock_timeout = 1000");
          await c.query(SCHEMA_CENTRAL);
        });
        await c.query("ROLLBACK").catch(() => {});
        await c.end();
        assert.strictEqual(antigo.erro?.code, "55P03", String(antigo.erro));
        ok("controle: o DDL antigo (reexecutado a cada boot) fica bloqueado pelos mesmos locks (55P03 após 1 s; sem lock_timeout esperaria indefinidamente e enfileiraria a Central atrás dele)");
      } finally {
        await trava.liberar();
      }
    }

    // ── 3. schema PARCIAL (deploy com DDL novo / base parcialmente migrada) ─
    {
      await setup.query("ALTER TABLE central_vendas_imports DROP COLUMN coverage_date_to");
      await setup.query("DROP INDEX idx_central_vendas_imports_sync_run");
      await setup.query("UPDATE venforce_schema_versoes SET hash = 'sql-antigo' WHERE chave = 'central_vendas_schema'");
      const r = await aplicarSchemaVersionado({ db: novoPool(), chave: "central_vendas_schema", sql: SCHEMA_CENTRAL, lockKey: "venforce:central-vendas:schema", logger: silencioso });
      assert.strictEqual(r.motivo, "aplicado");
      assert.ok(await existeColuna(setup, "central_vendas_imports", "coverage_date_to"));
      assert.ok(await existeIndice(setup, "idx_central_vendas_imports_sync_run"));
      ok("hash diferente (SQL novo): reaplica e recria coluna e índice ausentes");

      await setup.query("ALTER TABLE central_vendas_imports DROP COLUMN coverage_date_to");
      await setup.query("DELETE FROM venforce_schema_versoes WHERE chave = 'central_vendas_schema'");
      const r2 = await aplicarSchemaVersionado({ db: novoPool(), chave: "central_vendas_schema", sql: SCHEMA_CENTRAL, lockKey: "venforce:central-vendas:schema", logger: silencioso });
      assert.strictEqual(r2.motivo, "aplicado");
      assert.ok(await existeColuna(setup, "central_vendas_imports", "coverage_date_to"));
      ok("sem marcador (base anterior a este mecanismo, parcialmente migrada): aplica uma vez e grava o marcador");
    }

    // ── 4. lock_timeout: DDL necessário + Central ocupada ⇒ desiste rápido ──
    {
      await setup.query("UPDATE venforce_schema_versoes SET hash = 'sql-antigo' WHERE chave = 'central_vendas_schema'");
      const trava = await segurarLocksDeNegocio();
      let r;
      const vitima = novoPool();
      try {
        // Enquanto o DDL espera, uma leitura normal da Central NÃO pode ficar presa mais que o lock_timeout.
        const ddl = cronometrar(() => aplicarSchemaVersionado({
          db: vitima, chave: "central_vendas_schema", sql: SCHEMA_CENTRAL, lockKey: "venforce:central-vendas:schema",
          lockTimeoutMs: 1500, logger: silencioso,
        }));
        await dormir(200);
        const leitura = await cronometrar(() => setup.query("SELECT count(*) FROM central_vendas_imports"));
        r = await ddl;
        assert.strictEqual(r.erro?.code, "55P03", String(r.erro));
        assert.ok(r.ms < 4000, `${r.ms} ms`);
        assert.ifError(leitura.erro);
        assert.ok(leitura.ms < 3000, `leitura ${leitura.ms} ms`);
        assert.strictEqual(await lerVersao(setup, "central_vendas_schema"), "sql-antigo");
        ok(`DDL pendente com a Central ocupada: desiste em ${r.ms} ms (55P03), leituras atrás dele esperaram no máx. ${leitura.ms} ms, marcador intacto`);
      } finally {
        await trava.liberar();
      }
      // Com o boot sequencial, o 55P03 é transitório: a etapa repete e passa.
      const res = await executarEtapasDeBoot([{
        nome: "central-vendas-schema",
        executar: () => aplicarSchemaVersionado({ db: vitima, chave: "central_vendas_schema", sql: SCHEMA_CENTRAL, lockKey: "venforce:central-vendas:schema", logger: silencioso }),
      }], { logger: silencioso, esperasMs: [50] });
      assert.ok(res[0].ok);
      assert.strictEqual(await lerVersao(setup, "central_vendas_schema"), hashDoSql(SCHEMA_CENTRAL));
      ok("depois que a Central libera, a etapa de boot aplica o DDL e grava o marcador");
    }

    // ── 5. conexão interrompida no meio do DDL ─────────────────────────────
    {
      await setup.query("UPDATE venforce_schema_versoes SET hash = 'sql-antigo' WHERE chave = 'central_vendas_schema'");
      const trava = await segurarLocksDeNegocio();
      const p = novoPool();
      try {
        const ddl = cronometrar(() => aplicarSchemaVersionado({
          db: p, chave: "central_vendas_schema", sql: SCHEMA_CENTRAL, lockKey: "venforce:central-vendas:schema",
          lockTimeoutMs: 20000, logger: silencioso,
        }));
        // espera o DDL ficar bloqueado e mata a conexão dele (pg_terminate_backend)
        let pid = null;
        for (let i = 0; i < 50 && !pid; i += 1) {
          await dormir(100);
          const { rows } = await setup.query(
            `SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%central_vendas_imports%' LIMIT 1`
          );
          pid = rows[0]?.pid || null;
        }
        assert.ok(pid, "DDL não chegou a esperar lock");
        await setup.query("SELECT pg_terminate_backend($1)", [pid]);
        const r = await ddl;
        assert.ok(r.erro, "DDL deveria falhar");
        assert.ok(["57P01", undefined].includes(r.erro.code) || /terminat/i.test(r.erro.message), String(r.erro.code));
        assert.strictEqual(await lerVersao(setup, "central_vendas_schema"), "sql-antigo");
        ok(`conexão do DDL derrubada no meio (${r.erro.code || r.erro.message.slice(0, 40)}): erro propaga, processo segue, marcador NÃO gravado`);
      } finally {
        await trava.liberar();
      }
      const r2 = await aplicarSchemaVersionado({ db: p, chave: "central_vendas_schema", sql: SCHEMA_CENTRAL, lockKey: "venforce:central-vendas:schema", logger: silencioso });
      assert.strictEqual(r2.motivo, "aplicado");
      const { rows: [{ n }] } = await p.query("SELECT count(*)::int n FROM central_vendas_imports");
      assert.strictEqual(n, 0);
      ok("o mesmo pool, depois da conexão morta, reaplica o DDL e volta a responder");
    }

    // ── 6. backfill FORA do boot ───────────────────────────────────────────
    {
      await setup.query(`INSERT INTO central_vendas_imports (id, cliente_slug, competencia) VALUES (1, 'loja', '2026-09')`);
      const tipos = ["receita_produto", "receita_envio", "tarifa_venda", "custo_produto", "imposto_interno", "frete_seller", "cancelamento_reembolso", "ajuste_desconhecido"];
      const linhas = [];
      for (const tipo of tipos) for (const itemId of [null, "MLB1", ""]) linhas.push({ tipo, itemId });
      for (const l of linhas) {
        await setup.query(
          `INSERT INTO central_vendas_componentes (import_id, cliente_slug, competencia, pedido_id, item_id, tipo, valor, confianca)
           VALUES (1, 'loja', '2026-09', 'P1', $1, $2, 1, 'alta')`, [l.itemId, l.tipo]
        );
      }
      await setup.query("UPDATE venforce_schema_versoes SET hash = 'sql-antigo' WHERE chave = 'central_vendas_schema'");
      await aplicarSchemaVersionado({ db: novoPool(), chave: "central_vendas_schema", sql: SCHEMA_CENTRAL, lockKey: "venforce:central-vendas:schema", logger: silencioso });
      const { rows: [{ n }] } = await setup.query("SELECT count(*)::int n FROM central_vendas_componentes WHERE escopo IS NULL");
      assert.strictEqual(n, linhas.length);
      assert.ok(!/UPDATE\s+central_vendas_componentes/i.test(SCHEMA_CENTRAL));
      ok(`schema reaplicado NÃO faz backfill: ${n} linhas legadas continuam sem classificação`);

      const seco = await executarBackfill({ db: setup, apply: false, tamanhoLote: 7, pausaMs: 0, logger: silencioso });
      assert.strictEqual(seco.linhasSemClassificacao, linhas.length);
      assert.strictEqual(seco.linhasAtualizadas, 0);
      const { rows: [{ n: aindaNull }] } = await setup.query("SELECT count(*)::int n FROM central_vendas_componentes WHERE escopo IS NULL");
      assert.strictEqual(aindaNull, linhas.length);
      const real = await executarBackfill({ db: setup, apply: true, tamanhoLote: 7, pausaMs: 0, logger: silencioso });
      assert.strictEqual(real.linhasAtualizadas, linhas.length);
      assert.ok(real.lotes >= Math.ceil(linhas.length / 7));
      const { rows } = await setup.query("SELECT tipo, item_id, escopo, efeito, incluido_no_resultado FROM central_vendas_componentes");
      for (const r of rows) {
        const esperado = classificarComponenteFinanceiro({ tipo: r.tipo, itemId: r.item_id });
        assert.deepStrictEqual(
          { escopo: r.escopo, efeito: r.efeito, incluido: r.incluido_no_resultado },
          { escopo: esperado.escopo, efeito: esperado.efeito, incluido: esperado.incluidoNoResultado },
          `${r.tipo}/${JSON.stringify(r.item_id)}`
        );
      }
      const denovo = await executarBackfill({ db: setup, apply: true, tamanhoLote: 7, pausaMs: 0, logger: silencioso });
      assert.strictEqual(denovo.linhasAtualizadas, 0);
      ok(`script de backfill: dry-run não altera; apply em ${real.lotes} lotes classifica igual a classificarComponenteFinanceiro (${rows.length} combinações); 2ª execução = 0`);
    }

    // ── 7. etapas de boot: dependente só depois do schema ──────────────────
    {
      const ordem = [];
      const res = await executarEtapasDeBoot([
        {
          nome: "schema-que-falha",
          executar: async () => { ordem.push("schema-a"); await setup.query("SELECT * FROM tabela_que_nao_existe"); },
          aoConcluir: () => ordem.push("worker-a-INICIADO"),
          aoFalhar: () => ordem.push("worker-a-nao-iniciado"),
        },
        {
          nome: "schema-ok",
          executar: async () => { ordem.push("schema-b"); await repository.ensureCentralVendasTables(novoPool()); },
          aoConcluir: () => ordem.push("worker-b-iniciado"),
        },
      ], { logger: silencioso, esperasMs: [10, 10] });
      assert.deepStrictEqual(ordem, ["schema-a", "worker-a-nao-iniciado", "schema-b", "worker-b-iniciado"]);
      assert.deepStrictEqual(res.map((r) => [r.nome, r.ok, r.tentativas]), [["schema-que-falha", false, 1], ["schema-ok", true, 1]]);
      ok("erro NÃO transitório (42P01) não repete, não inicia o worker dependente e não impede a etapa seguinte");
    }

    // ── 7b. achados da revisão do Codex ────────────────────────────────────
    {
      const migr = (f) => fs.readFileSync(path.join(__dirname, "..", "sql", "migrations", f), "utf8");
      // (a) BEGIN;/COMMIT; do próprio arquivo não podem encerrar a transação protegida
      const sqlComTx = "BEGIN;\nCREATE TABLE t_teste_tx (id int);\nCOMMIT;\nSELECT 1/0;\n";
      const r = await cronometrar(() => aplicarSchemaVersionado({ db: novoPool(), chave: "teste_tx", sql: sqlComTx, removerTransacaoPropria: true, logger: silencioso }));
      assert.strictEqual(r.erro?.code, "22012");
      assert.ok(!(await existeIndice(setup, "t_teste_tx")), "COMMIT do arquivo encerrou a transação antes da hora");
      assert.strictEqual(await lerVersao(setup, "teste_tx"), null);
      ok("migration com BEGIN;/COMMIT; próprios: tudo na transação protegida (erro depois do COMMIT do arquivo desfaz tudo, sem marcador)");

      // (b) Squads: arquivos reais, aplicados 1x; com leitura longa em cliente_responsaveis e
      //     DDL pendente, desiste por lock_timeout em vez de travar o boot inteiro
      for (const f of ["20260827_squads_foundation.sql", "20260828_cliente_responsaveis_p24.sql", "20261015_squad_members_funcao_gestor.sql"]) {
        await aplicarSchemaVersionado({ db: novoPool(), chave: f, sql: migr(f), lockKey: `vf:schema:${f}`, removerTransacaoPropria: true, logger: silencioso });
      }
      await setup.query("UPDATE venforce_schema_versoes SET hash = 'antigo' WHERE chave = '20260828_cliente_responsaveis_p24.sql'");
      const leitor = await novoClient();
      await leitor.query("BEGIN");
      await leitor.query("SELECT count(*) FROM cliente_responsaveis");
      const f = "20260828_cliente_responsaveis_p24.sql";
      const r2 = await cronometrar(() => aplicarSchemaVersionado({ db: novoPool(), chave: f, sql: migr(f), lockKey: `vf:schema:${f}`, removerTransacaoPropria: true, lockTimeoutMs: 1000, logger: silencioso }));
      await leitor.query("COMMIT"); await leitor.end();
      assert.strictEqual(r2.erro?.code, "55P03", String(r2.erro));
      assert.ok(r2.ms < 3000, `${r2.ms} ms`);
      ok(`Squads com DDL pendente e leitura longa em cliente_responsaveis: desiste em ${r2.ms} ms (55P03, transitório) em vez de travar o boot`);

      // (c) advisory lock ocupado por outra instância (de schema ou da tabela de versões): teto próprio
      const outra = await novoClient();
      await outra.query("SELECT pg_advisory_lock(hashtextextended('venforce:central-vendas:schema', 0))");
      await setup.query("UPDATE venforce_schema_versoes SET hash = 'antigo' WHERE chave = 'central_vendas_schema'");
      const r3 = await cronometrar(() => aplicarSchemaVersionado({ db: novoPool(), chave: "central_vendas_schema", sql: SCHEMA_CENTRAL, lockKey: "venforce:central-vendas:schema", esperaLockMs: 700, logger: silencioso }));
      await outra.query("SELECT pg_advisory_unlock_all()");
      await outra.query("SELECT pg_advisory_lock(hashtextextended('vf:schema:venforce_schema_versoes', 0))");
      const r4 = await cronometrar(() => aplicarSchemaVersionado({ db: novoPool(), chave: "central_vendas_schema", sql: SCHEMA_CENTRAL, lockKey: "venforce:central-vendas:schema", esperaLockMs: 700, logger: silencioso }));
      await outra.end();
      assert.strictEqual(r3.erro?.code, "VF_SCHEMA_LOCK_OCUPADO", String(r3.erro));
      assert.strictEqual(r4.erro?.code, "VF_SCHEMA_LOCK_OCUPADO", String(r4.erro));
      assert.ok(r3.ms < 2500 && r4.ms < 2500, `${r3.ms}/${r4.ms}`);
      const r5 = await aplicarSchemaVersionado({ db: novoPool(), chave: "central_vendas_schema", sql: SCHEMA_CENTRAL, lockKey: "venforce:central-vendas:schema", logger: silencioso });
      assert.strictEqual(r5.motivo, "aplicado");
      ok(`advisory lock de schema / da tabela de versões preso por outra sessão: desiste em ${r3.ms}/${r4.ms} ms (VF_SCHEMA_LOCK_OCUPADO, transitório); liberado, aplica`);
    }

    // ── 8. PostgreSQL em crash-recovery (kill -9 num backend) ──────────────
    if (process.env.VF_PG_ESTABILIDADE_PERMITE_CRASH === "1") {
      const logs = [];
      const logger = { log: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) };
      const app = novoPool(6);
      const obs = instrumentarPool(app, { logger, iniciarTimer: false });
      await Promise.all([1, 2, 3].map(() => app.query("SELECT 1")));
      const vitima = await novoClient();
      const { rows: [{ pid }] } = await vitima.query("SELECT pg_backend_pid() AS pid");
      // Operações EM VOO no pool do app (como as requisições de 03/11): morrem junto.
      const emVoo = [1, 2].map(() => cronometrar(() => app.query("SELECT pg_sleep(5)")));
      await dormir(100);
      process.kill(Number(pid), "SIGKILL");
      // Logo depois do kill: o servidor derruba TODAS as conexões e entra em recovery.
      const durante = [];
      for (let i = 0; i < 100; i += 1) {
        const r = await cronometrar(() => app.query("SELECT 1"));
        durante.push(r.erro ? (r.erro.code || r.erro.message.slice(0, 50)) : "ok");
        if (!r.erro) break;
        await dormir(10);
      }
      const voo = await Promise.all(emVoo);
      for (const v of voo) {
        assert.ok(v.erro, "operação em voo deveria falhar");
        durante.unshift(`emVoo:${v.erro.code || v.erro.message.slice(0, 40)}`);
      }
      assert.ok(durante.some((d) => d !== "ok"), `nenhuma falha observada: ${durante}`);
      // Recuperação: o boot sequencial reexecuta o ensure até o banco voltar.
      const res = await executarEtapasDeBoot([{
        nome: "central-vendas-schema",
        executar: async () => { await app.query("SELECT 1"); await repository.ensureCentralVendasTables(app); },
      }], {
        logger: { log: () => {}, error: () => {}, warn: (m) => { const c = /erro transitório \(([^ ]*)/.exec(m); if (c) durante.push(`boot:${c[1] || "sem-code"}`); } },
        esperasMs: [200, 500, 1000, 2000, 4000, 8000],
        sleep: dormir, // o padrão usa timer unref (no servidor o HTTP segura o processo; aqui não)
      });
      assert.ok(res[0].ok, JSON.stringify(res[0].erro?.message));
      const estado = obs.estado();
      assert.strictEqual(estado.degradado, null);
      assert.ok(estado.totais.recuperacoes >= 1, JSON.stringify(estado));
      assert.ok(logs.some((l) => /voltou a atender/.test(l)), logs.join("\n"));
      await vitima.end().catch(() => {});
      ok(`kill -9 num backend → crash-recovery (erros: ${[...new Set(durante.filter((d) => d !== "ok"))].join(", ")}); ` +
        `o processo segue, a etapa de boot repete até o banco voltar (${res[0].tentativas} tentativas) e o pool registra a recuperação`);
    } else {
      console.log("  (pulado) cenário de crash-recovery — defina VF_PG_ESTABILIDADE_PERMITE_CRASH=1 (derruba todas as conexões do cluster)");
    }

    console.log(`\n✓ pgEstabilidadeBoot.postgres: ${checks} checks`);
  } finally {
    for (const p of pools) await p.end().catch(() => {});
    await admin.end().catch(() => {});
    // conexão nova: a do admin pode ter caído no cenário de crash
    const limpeza = new Client({ connectionString: BASE_URL, ssl: false });
    limpeza.on("error", () => {});
    await limpeza.connect();
    await limpeza.query(`DROP DATABASE IF EXISTS "${nomeDb}" WITH (FORCE)`).catch((e) => console.error("drop:", e.message));
    await limpeza.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
