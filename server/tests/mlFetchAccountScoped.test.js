// server/tests/mlFetchAccountScoped.test.js
//
// Demonstra a resolução segura por conta pedida na Fase 1 da fundação de
// clientes/contas (auditoria, seção "ML FETCH / GRANTS"): uma operação
// account-scoped que informa `mlUserId` explicitamente nunca usa outro
// grant do mesmo cliente — nem quando esse outro grant é o principal, nem
// quando o grant pedido está indisponível (não há fallback silencioso).
//
// Não usa DI: `mlTokenService` e `mlClient.mlFetch` usam o `pool` singleton
// (server/config/database.js) — o mesmo padrão de mock das outras suítes.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
async function rejeitaCom(label, promise, verificar) {
  let erro = null;
  try { await promise; } catch (e) { erro = e; }
  assert.ok(erro, `FALHOU (não rejeitou): ${label}`);
  if (verificar) assert.ok(verificar(erro), `FALHOU (erro inesperado): ${label} — ${erro.message}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const pool = require("../config/database");

const FAR_FUTURE = new Date(Date.now() + 6 * 60 * 60 * 1000);

class MemoryDb {
  constructor(rows) {
    this.rows = rows;
  }
  async connect() {
    return { query: (sql, params) => this.query(sql, params), release() {} };
  }
  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(q) || q.includes("pg_advisory")) return { rows: [] };
    if (q.includes("WHERE t.cliente_id = $1 AND t.ml_user_id = $2")) {
      return {
        rows: this.rows
          .filter((r) => Number(r.cliente_id) === Number(params[0]) && String(r.ml_user_id) === String(params[1]))
          .map((r) => ({ ...r })),
      };
    }
    throw new Error(`Query não mapeada no mock: ${q}`);
  }
}

function grant({ id, ml_user_id, is_primary, token_status = "valid" }) {
  return {
    id, cliente_id: 1, ml_user_id,
    access_token: `access-${ml_user_id}`, refresh_token: `refresh-${ml_user_id}`,
    expires_at: FAR_FUTURE, created_at: new Date(), updated_at: new Date(),
    is_primary, token_status, refresh_failures: 0,
    last_refresh_error_at: null, next_refresh_attempt_at: null,
    _has_is_primary: true, _has_refresh_metadata: true,
  };
}

async function run() {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const originalFetch = global.fetch;

  // ML1 não é principal; ML2 é. A troca de principal NUNCA deve mudar qual
  // token uma chamada account-scoped por mlUserId usa.
  const db = new MemoryDb([
    grant({ id: 101, ml_user_id: "111", is_primary: false }),
    grant({ id: 102, ml_user_id: "222", is_primary: true }),
  ]);
  pool.query = (sql, params) => db.query(sql, params);
  pool.connect = () => db.connect();

  try {
    delete require.cache[require.resolve("../services/mlTokenService")];
    delete require.cache[require.resolve("../utils/mlClient")];
    const { resolveMlGrant } = require("../services/mlTokenService");
    const { mlFetch } = require("../utils/mlClient");

    const ml1 = await resolveMlGrant({ clienteId: 1, mlUserId: "111", requireUsable: true });
    ok("mlUserId explícito (ML1) resolve para o grant certo mesmo sem ser principal", ml1.id === 101);

    const ml2 = await resolveMlGrant({ clienteId: 1, mlUserId: "222", requireUsable: true });
    ok("mlUserId explícito (ML2, principal) resolve para si mesmo", ml2.id === 102);

    // mlFetch(clienteId, path, { mlUserId }) — o padrão seguro que a Fase 1
    // prepara para consumidores account-sensitive (auditoria, item 8).
    let tokenUsado = null;
    global.fetch = async (url, options) => {
      tokenUsado = options.headers.Authorization;
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 111 }) };
    };
    await mlFetch(1, "/users/111/items/search", { mlUserId: "111" });
    ok("mlFetch com mlUserId=ML1 usa o access_token de ML1, não o do principal (ML2)", tokenUsado === "Bearer access-111");

    tokenUsado = null;
    await mlFetch(1, "/users/222/items/search", { mlUserId: "222" });
    ok("mlFetch com mlUserId=ML2 usa o access_token de ML2", tokenUsado === "Bearer access-222");

    // Principal indisponível não deve fazer uma operação explicitamente
    // ML1 cair para ML2 — nem o inverso.
    db.rows.find((r) => r.ml_user_id === "222").token_status = "revoked";
    const ml1AindaOk = await resolveMlGrant({ clienteId: 1, mlUserId: "111", requireUsable: true });
    ok("ML2 (principal) revogado: operação explícita por ML1 continua resolvendo ML1", ml1AindaOk.id === 101);

    await rejeitaCom(
      "operação explícita por ML2 (revogado) falha em vez de usar ML1 silenciosamente",
      resolveMlGrant({ clienteId: 1, mlUserId: "222", requireUsable: true }),
      (e) => e.code === "ML_GRANT_REVOKED"
    );

    console.log(`\n✓ mlFetch account-scoped: ${checks} verificações`);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../services/mlTokenService")];
    delete require.cache[require.resolve("../utils/mlClient")];
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
