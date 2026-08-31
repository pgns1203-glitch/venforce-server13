// server/tests/schemaEnsureEntregasCliente.test.js
//
// VenForce V3 — Pós-Convergência #2 (BLOCO 4/5/19).
//
// Prova, sem Postgres real (fake `db` que captura o SQL), que o `ensure` que
// fecha o bug de produção `column "cliente_conta_id" does not exist`:
//   1. cria `entregas_cliente` se não existir (banco vazio);
//   2. adiciona `cliente_conta_id` de forma aditiva e idempotente (banco legado);
//   3. é seguro em execução repetida (latch + todo comando IF NOT EXISTS/guardado);
//   4. NUNCA aplica o índice UNIQUE de D4;
//   5. a FK para cliente_contas é guardada (base sem a foundation não quebra).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");
const mod = require("../services/schema/schemaEnsure");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

function fakeDb() {
  const capturas = [];
  return {
    capturas,
    async query(sql, params = []) {
      capturas.push(String(sql));
      return { rows: [] };
    },
    sqlConcatenado() {
      return this.capturas.join("\n;\n");
    },
  };
}

async function run() {
  // ---- roda o ensure com um db injetado (nunca toca no pool real) ----
  const db = fakeDb();
  await mod.ensureEntregasClienteSchema(db);
  const sql = db.sqlConcatenado();

  ok("cria entregas_cliente com CREATE TABLE IF NOT EXISTS (banco vazio)",
    /CREATE TABLE IF NOT EXISTS entregas_cliente/i.test(sql));

  ok("adiciona cliente_conta_id de forma aditiva (ADD COLUMN IF NOT EXISTS)",
    /ALTER TABLE entregas_cliente\s+ADD COLUMN IF NOT EXISTS cliente_conta_id/i.test(sql));

  ok("cliente_conta_id é NULLABLE — não tem NOT NULL nem DEFAULT nem CHECK",
    !/cliente_conta_id\s+INTEGER\s+(NOT NULL|DEFAULT|CHECK)/i.test(sql));

  ok("índice não-único de conta é criado (idx_entregas_cliente_conta_id)",
    /CREATE INDEX IF NOT EXISTS idx_entregas_cliente_conta_id/i.test(sql));

  ok("índice parcial (cliente, conta, periodo) é criado e é NÃO-único",
    /CREATE INDEX IF NOT EXISTS idx_entregas_cliente_conta_periodo/i.test(sql)
      && !/CREATE UNIQUE INDEX[^;]*idx_entregas_cliente_conta_periodo/i.test(sql));

  ok("FK para cliente_contas é GUARDADA por to_regclass (base sem foundation não quebra)",
    /to_regclass\('public\.cliente_contas'\)/i.test(sql)
      && /fk_entregas_cliente_conta/i.test(sql));

  // ---- BLOCO 5: o índice UNIQUE de D4 NUNCA é aplicado por aqui ----
  ok("NÃO cria o índice UNIQUE de D4 (uq_entregas_fechamento_competencia)",
    !/uq_entregas_fechamento_competencia/i.test(sql));
  ok("NÃO emite nenhum CREATE UNIQUE INDEX sobre entregas_cliente",
    !/CREATE UNIQUE INDEX[\s\S]*entregas_cliente/i.test(sql));

  // ---- o código-fonte do ensure não referencia o arquivo de D4 ----
  const fs = require("fs");
  const path = require("path");
  const fonte = fs.readFileSync(path.join(__dirname, "..", "services", "schema", "schemaEnsure.js"), "utf8");
  // Só pode aparecer no INVENTÁRIO (com auto:false), nunca num readFileSync/query.
  ok("schemaEnsure.js não lê nem executa 20260828_entregas_cliente_unicidade_p26.sql",
    !/readFileSync[^)]*unicidade_p26/i.test(fonte) && !/query[^)]*unicidade_p26/i.test(fonte));

  // ---- idempotência: 2ª chamada no MESMO pool é no-op (latch) ----
  mod._resetEnsuredParaTeste();
  const original = pool.query;
  let chamadasNoPool = 0;
  pool.query = async () => { chamadasNoPool += 1; return { rows: [] }; };
  try {
    await mod.ensureEntregasClienteSchema();   // db === pool → roda, seta latch
    const depoisDaPrimeira = chamadasNoPool;
    await mod.ensureEntregasClienteSchema();   // db === pool → latch → no-op
    ok("2ª chamada no mesmo pool não reexecuta o DDL (latch _ensured)",
      chamadasNoPool === depoisDaPrimeira && depoisDaPrimeira >= 1);
  } finally {
    pool.query = original;
    mod._resetEnsuredParaTeste();
  }

  // ---- um db != pool sempre roda (teste/`/setup` com conexão própria) ----
  const db2 = fakeDb();
  await mod.ensureEntregasClienteSchema(db2);
  await mod.ensureEntregasClienteSchema(db2);
  ok("db injetado (!= pool) roda toda vez (sem latch global)", db2.capturas.length >= 2);

  console.log(`\nschemaEnsureEntregasCliente.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
