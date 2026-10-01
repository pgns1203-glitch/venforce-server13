// server/tests/clienteContasTiktok.test.js
//
// Painel de Contas V3 — operação TikTok Shop como ClienteConta.
//   - cadastro aceita 'tiktok' (criarConta / filtro de listagem);
//   - banco ainda sem a migration → 409 MARKETPLACE_PENDENTE_MIGRACAO, não 500;
//   - a resolução de contexto das INTEGRAÇÕES continua só meli/shopee;
//   - a migration só amplia a CHECK (sem DML, transacional) e é manual.

process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/teste-sem-banco";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const pool = require("../config/database");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
}

function instalarMock({ checkAceitaTiktok }) {
  const original = { query: pool.query, connect: pool.connect };
  const inseridas = [];
  async function query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(q) || q.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (q.includes("FROM clientes")) return { rows: [{ id: 7, slug: "coremix", nome: "Coremix", ativo: true }] };
    if (q.startsWith("SELECT id FROM cliente_contas")) return { rows: [] };
    if (q.includes("SELECT 1 FROM cliente_contas WHERE slug") || q.includes("FROM cliente_contas WHERE slug")) return { rows: [] };
    if (q.startsWith("INSERT INTO cliente_contas")) {
      if (params[1] === "tiktok" && !checkAceitaTiktok) {
        const err = new Error('new row for relation "cliente_contas" violates check constraint "cliente_contas_marketplace_check"');
        err.code = "23514";
        err.constraint = "cliente_contas_marketplace_check";
        throw err;
      }
      const row = { id: 900 + inseridas.length, cliente_id: params[0], marketplace: params[1], nome: params[2], slug: params[3], external_account_id: params[4], is_primary: params[5], ativo: true, metadata_json: {} };
      inseridas.push(row);
      return { rows: [row] };
    }
    if (q.includes("FROM cliente_contas")) return { rows: [] };
    throw new Error(`SQL inesperado: ${q.slice(0, 90)}`);
  }
  pool.query = (sql, params) => query(sql, params);
  pool.connect = async () => ({ query: (sql, params) => query(sql, params), release() {} });
  return { inseridas, restaurar: () => Object.assign(pool, original) };
}

const svc = require("../services/clienteContas/clienteContaService");

async function rejeita(label, promise, statusCode, code) {
  let erro = null;
  try { await promise; } catch (e) { erro = e; }
  ok(`${label} — recebido ${erro?.statusCode} ${erro?.code}`, erro && erro.statusCode === statusCode && (!code || erro.code === code));
}

async function run() {
  ok("cadastro aceita tiktok", svc.normalizarMarketplaceCadastro("TikTok") === "tiktok");
  ok("integrações continuam meli/shopee", svc.normalizarMarketplaceConta("tiktok") === null);

  let mock = instalarMock({ checkAceitaTiktok: true });
  try {
    await rejeita(
      "resolver de contexto das integrações recusa tiktok",
      svc.resolveMarketplaceAccountContext({ clienteSlug: "coremix", marketplace: "tiktok" }), 400
    );
    const conta = await svc.criarConta({ clienteSlug: "coremix", marketplace: "tiktok", nome: "TikTok 1" });
    ok("conta TikTok criada com marketplace tiktok", conta.marketplace === "tiktok" && mock.inseridas.length === 1);
    ok("primeira conta TikTok vira principal do marketplace", conta.is_primary === true);
    await rejeita("marketplace desconhecido continua 400", svc.criarConta({ clienteSlug: "coremix", marketplace: "magalu", nome: "x" }), 400);
  } finally { mock.restaurar(); }

  mock = instalarMock({ checkAceitaTiktok: false });
  try {
    await rejeita(
      "banco sem a migration → 409 explicativo, não 500",
      svc.criarConta({ clienteSlug: "coremix", marketplace: "tiktok", nome: "TikTok 1" }), 409, "MARKETPLACE_PENDENTE_MIGRACAO"
    );
  } finally { mock.restaurar(); }

  const sql = fs.readFileSync(path.join(__dirname, "..", "sql", "migrations", "20261001_cliente_contas_marketplace_tiktok.sql"), "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  ok("migration só mexe na CHECK (sem INSERT/UPDATE/DELETE)", !/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(sql));
  ok("migration não derruba tabela", !/DROP\s+TABLE/i.test(sql));
  ok("migration amplia para meli, shopee e tiktok", /CHECK \(marketplace IN \('meli', 'shopee', 'tiktok'\)\)/.test(sql));
  ok("migration é transacional (nunca fica sem CHECK)", /BEGIN;[\s\S]*DROP CONSTRAINT IF EXISTS[\s\S]*ADD CONSTRAINT[\s\S]*COMMIT;/.test(sql));

  const { MIGRATIONS_INVENTARIO } = require("../services/schema/schemaEnsure");
  const item = MIGRATIONS_INVENTARIO.find((m) => m.arquivo === "20261001_cliente_contas_marketplace_tiktok.sql");
  ok("migration inventariada como MANUAL", item && item.auto === false && item.runner === null);

  console.log(`clienteContasTiktok.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => { console.error(err); process.exit(1); });
