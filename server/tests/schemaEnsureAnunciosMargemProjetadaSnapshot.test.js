// server/tests/schemaEnsureAnunciosMargemProjetadaSnapshot.test.js
//
// FASE 1 do plano de ordenação global por margem PROJETADA (Anúncios ML) —
// ver docs/AUDITORIA_ANUNCIOS_ML_MARGEM_PROJETADA_GLOBAL_PLANO_TECNICO.md.
//
// Prova, sem Postgres real (fake `db` que captura o SQL, mesmo padrão de
// schemaEnsureEntregasCliente.test.js):
//   1. cria anuncios_margem_projetada_snapshot se não existir (banco vazio);
//   2. UNIQUE é (cliente_id, item_id) — SEM cliente_conta_id na chave;
//   3. FK composta para meli_anuncios(cliente_id, item_id) é GUARDADA por
//      to_regclass (a tabela pode não existir ainda no instante do boot);
//   4. FK para cliente_contas(id) também é GUARDADA (migration auto:false);
//   5. é seguro em execução repetida (latch + todo comando IF NOT EXISTS/guardado);
//   6. nenhum comportamento de ensureEntregasClienteSchema foi alterado (latch
//      próprio, independente).

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
  await mod.ensureAnunciosMargemProjetadaSnapshotSchema(db);
  const sql = db.sqlConcatenado();

  ok("cria anuncios_margem_projetada_snapshot com CREATE TABLE IF NOT EXISTS (banco vazio)",
    /CREATE TABLE IF NOT EXISTS anuncios_margem_projetada_snapshot/i.test(sql));

  ok("cliente_id é NOT NULL com FK direta para clientes(id) ON DELETE CASCADE",
    /cliente_id\s+INTEGER\s+NOT NULL\s+REFERENCES\s+clientes\(id\)\s+ON DELETE CASCADE/i.test(sql));

  ok("cliente_conta_id é coluna simples (NULLABLE), FK vem depois guardada — nunca inline",
    /cliente_conta_id\s+INTEGER,/i.test(sql) &&
      !/cliente_conta_id\s+INTEGER\s+REFERENCES/i.test(sql));

  ok("item_id é TEXT (mesmo tipo de meli_anuncios.item_id, não VARCHAR truncado)",
    /item_id\s+TEXT\s+NOT NULL/i.test(sql));

  ok("computable tem DEFAULT FALSE explícito",
    /computable\s+BOOLEAN\s+NOT NULL\s+DEFAULT FALSE/i.test(sql));

  ok("calculado_em tem DEFAULT NOW()",
    /calculado_em\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT NOW\(\)/i.test(sql));

  ok("UNIQUE é (cliente_id, item_id) — SEM cliente_conta_id na chave natural",
    /UNIQUE \(cliente_id, item_id\)/i.test(sql));

  ok("NÃO existe nenhuma UNIQUE que inclua cliente_conta_id (evita reabrir NULL != NULL)",
    !/UNIQUE[^)]*cliente_conta_id/i.test(sql));

  // ---- FK composta para meli_anuncios, GUARDADA ----
  ok("FK composta para meli_anuncios(cliente_id, item_id) existe",
    /FOREIGN KEY \(cliente_id, item_id\) REFERENCES meli_anuncios\(cliente_id, item_id\)/i.test(sql));

  ok("FK para meli_anuncios é ON DELETE CASCADE (upsert-only, nunca há DELETE hoje)",
    /REFERENCES meli_anuncios\(cliente_id, item_id\) ON DELETE CASCADE/i.test(sql));

  ok("FK para meli_anuncios é GUARDADA por to_regclass('public.meli_anuncios')",
    /to_regclass\('public\.meli_anuncios'\)/i.test(sql));

  // ---- FK para cliente_contas, GUARDADA ----
  ok("FK para cliente_contas(id) existe, ON DELETE SET NULL",
    /FOREIGN KEY \(cliente_conta_id\) REFERENCES cliente_contas\(id\) ON DELETE SET NULL/i.test(sql));

  ok("FK para cliente_contas é GUARDADA por to_regclass('public.cliente_contas')",
    /to_regclass\('public\.cliente_contas'\)/i.test(sql));

  // ---- índices ----
  ok("índice (cliente_id, cliente_conta_id) para filtro de leitura existe",
    /CREATE INDEX IF NOT EXISTS idx_amps_cliente_conta ON anuncios_margem_projetada_snapshot\(cliente_id, cliente_conta_id\)/i.test(sql));
  ok("índice em margin_percent existe (futura ORDER BY)",
    /CREATE INDEX IF NOT EXISTS idx_amps_margin_percent ON anuncios_margem_projetada_snapshot\(margin_percent\)/i.test(sql));
  ok("índice em calculado_em existe (futura consulta de staleness)",
    /CREATE INDEX IF NOT EXISTS idx_amps_calculado_em ON anuncios_margem_projetada_snapshot\(calculado_em\)/i.test(sql));

  // ---- idempotência: 2ª chamada no MESMO pool é no-op (latch) ----
  mod._resetAmpsEnsuredParaTeste();
  const original = pool.query;
  let chamadasNoPool = 0;
  pool.query = async () => { chamadasNoPool += 1; return { rows: [] }; };
  try {
    await mod.ensureAnunciosMargemProjetadaSnapshotSchema();   // db === pool → roda, seta latch
    const depoisDaPrimeira = chamadasNoPool;
    await mod.ensureAnunciosMargemProjetadaSnapshotSchema();   // db === pool → latch → no-op
    ok("2ª chamada no mesmo pool não reexecuta o DDL (latch _ensuredAmps)",
      chamadasNoPool === depoisDaPrimeira && depoisDaPrimeira >= 1);
  } finally {
    pool.query = original;
    mod._resetAmpsEnsuredParaTeste();
  }

  // ---- um db != pool sempre roda (teste/`/setup` com conexão própria) ----
  const db2 = fakeDb();
  await mod.ensureAnunciosMargemProjetadaSnapshotSchema(db2);
  await mod.ensureAnunciosMargemProjetadaSnapshotSchema(db2);
  ok("db injetado (!= pool) roda toda vez (sem latch global)", db2.capturas.length >= 2);

  // ---- os dois latches (entregas_cliente x snapshot de margem) são independentes ----
  mod._resetEnsuredParaTeste();
  mod._resetAmpsEnsuredParaTeste();
  let chamadasEntregas = 0;
  let chamadasAmps = 0;
  pool.query = async (sql2) => {
    if (/entregas_cliente/i.test(String(sql2))) chamadasEntregas += 1;
    if (/anuncios_margem_projetada_snapshot/i.test(String(sql2))) chamadasAmps += 1;
    return { rows: [] };
  };
  try {
    await mod.ensureEntregasClienteSchema();
    await mod.ensureAnunciosMargemProjetadaSnapshotSchema();
    ok("latch de entregas_cliente e de anuncios_margem_projetada_snapshot são independentes " +
      "(rodar um não pula o outro)", chamadasEntregas >= 1 && chamadasAmps >= 1);
  } finally {
    pool.query = original;
    mod._resetEnsuredParaTeste();
    mod._resetAmpsEnsuredParaTeste();
  }

  console.log(`\nschemaEnsureAnunciosMargemProjetadaSnapshot.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
