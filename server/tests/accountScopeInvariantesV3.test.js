// server/tests/accountScopeInvariantesV3.test.js
//
// VenForce V3 — Auditoria account-aware transversal (Pessoa 2, pré-Convergência #4).
//
// Regressão permanente da regra que o bug de Automações revelou
// (seller B + token A → 403 "Searching another user items is restricted."):
//
//   ClienteConta escolhida = conta usada = seller/path = grant/token = base
//
// Fixture conceitual padrão (mission §17) — Cliente WBS:
//   Conta A: id 101, meli, seller 111, grant 201, token access-111, is_primary
//   Conta B: id 102, meli, seller 222, grant 202, token access-222, não-primary
//
// Cobre:
//  1. resolveMarketplaceAccountContext(conta B) → nunca toca nada da conta A
//  2. resolveMarketplaceAccountContext(conta A) → mesmo com B principal, usa A
//  3. sem clienteContaId + 2 contas → 409 MULTIPLE_MARKETPLACE_ACCOUNTS
//  4. o contexto resolvido passa em checkAccountContext (invariante §16)
//  5. checkAccountContext PEGA um contexto seller-B + token-A montado à mão
//  6. mlFetch por /users/{seller} usa o token daquele seller, não o principal
//  7. fix account-scope: obterCotacaoAtual propaga mlUserId ao
//     /users/{seller}/shipping_options/free

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
async function rejeitaCom(label, promise, verificar) {
  let erro = null;
  try { await promise; } catch (e) { erro = e; }
  assert.ok(erro, `FALHOU (não rejeitou): ${label}`);
  if (verificar) assert.ok(verificar(erro), `FALHOU (erro inesperado): ${label} — ${erro && erro.message}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const pool = require("../config/database");
const { checkAccountContext, assertAccountContext } = require("../services/clienteContas/accountContextInvariant");

const FAR_FUTURE = new Date(Date.now() + 6 * 60 * 60 * 1000);

// ─────────────── fixture WBS ───────────────
const WBS = {
  cliente: { id: 1, nome: "Cliente WBS", slug: "cliente-wbs", ativo: true },
  contas: [
    { id: 101, cliente_id: 1, marketplace: "meli", nome: "Conta A", slug: "wbs-meli-a",
      external_account_id: "111", is_primary: true, ativo: true, metadata_json: {},
      created_at: new Date("2024-01-01"), updated_at: new Date("2024-01-01") },
    { id: 102, cliente_id: 1, marketplace: "meli", nome: "Conta B", slug: "wbs-meli-b",
      external_account_id: "222", is_primary: false, ativo: true, metadata_json: {},
      created_at: new Date("2024-02-01"), updated_at: new Date("2024-02-01") },
  ],
  grants: [
    { id: 201, cliente_id: 1, ml_user_id: "111", access_token: "access-111", refresh_token: "refresh-111",
      expires_at: FAR_FUTURE, is_primary: true, token_status: "valid", refresh_failures: 0,
      last_refresh_error_at: null, next_refresh_attempt_at: null,
      _has_is_primary: true, _has_refresh_metadata: true, created_at: new Date(), updated_at: new Date() },
    { id: 202, cliente_id: 1, ml_user_id: "222", access_token: "access-222", refresh_token: "refresh-222",
      expires_at: FAR_FUTURE, is_primary: false, token_status: "valid", refresh_failures: 0,
      last_refresh_error_at: null, next_refresh_attempt_at: null,
      _has_is_primary: true, _has_refresh_metadata: true, created_at: new Date(), updated_at: new Date() },
  ],
  // Conta A → base 91; Conta B → base 92. Duas bases, cada uma da sua conta.
  vinculos: [
    { id: 1, cliente_id: 1, cliente_conta_id: 101, base_id: 91, marketplace: "meli", ativo: true, updated_at: new Date() },
    { id: 2, cliente_id: 1, cliente_conta_id: 102, base_id: 92, marketplace: "meli", ativo: true, updated_at: new Date() },
  ],
  bases: [
    { id: 91, slug: "base-a", nome: "Base A", marketplace: "meli", ativo: true },
    { id: 92, slug: "base-b", nome: "Base B", marketplace: "meli", ativo: true },
  ],
};

class MemoryDb {
  constructor(state) { this.s = state; }
  async connect() { return { query: (sql, p) => this.query(sql, p), release() {} }; }
  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(q) || q.includes("pg_advisory")) return { rows: [] };

    if (q.includes("FROM clientes WHERE id = $1")) {
      return { rows: this.s.cliente.id === Number(params[0]) ? [this.s.cliente] : [] };
    }
    if (q.includes("FROM clientes WHERE slug = $1")) {
      return { rows: this.s.cliente.slug === params[0] ? [this.s.cliente] : [] };
    }
    if (q.startsWith("SELECT * FROM cliente_contas WHERE id = $1")) {
      return { rows: this.s.contas.filter((c) => c.id === Number(params[0])).map((c) => ({ ...c })) };
    }
    if (q.startsWith("SELECT * FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true")) {
      return { rows: this.s.contas.filter((c) => c.cliente_id === Number(params[0]) && c.marketplace === params[1] && c.ativo).map((c) => ({ ...c })) };
    }
    if (q.includes("COUNT(*)::int AS total FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true")) {
      const total = this.s.contas.filter((c) => c.cliente_id === Number(params[0]) && c.marketplace === params[1] && c.ativo).length;
      return { rows: [{ total }] };
    }
    // resolveMlGrant por (cliente_id, ml_user_id)
    if (q.includes("FROM ml_tokens t WHERE t.cliente_id = $1 AND t.ml_user_id = $2")) {
      return { rows: this.s.grants.filter((g) => g.cliente_id === Number(params[0]) && String(g.ml_user_id) === String(params[1])).map((g) => ({ ...g })) };
    }
    // resolveMlGrant legado (lista por cliente)
    if (q.includes("FROM ml_tokens t WHERE t.cliente_id = $1")) {
      return { rows: this.s.grants.filter((g) => g.cliente_id === Number(params[0])).map((g) => ({ ...g })) };
    }
    // obterBaseDaConta — vínculo direto pela conta
    if (q.includes("FROM base_cliente_vinculos v") && q.includes("WHERE v.cliente_conta_id = $1 AND v.ativo = true")) {
      const v = this.s.vinculos.find((x) => x.cliente_conta_id === Number(params[0]) && x.ativo);
      if (!v) return { rows: [] };
      const b = this.s.bases.find((x) => x.id === v.base_id);
      return { rows: [{ vinculo_id: v.id, base_id: v.base_id, slug: b.slug, nome: b.nome }] };
    }
    // obterBaseDaConta / contexto legado — vínculo por cliente + marketplace
    if (q.includes("FROM base_cliente_vinculos v") && q.includes("WHERE v.cliente_id = $1 AND v.marketplace = $2 AND v.ativo = true")) {
      const v = this.s.vinculos.find((x) => x.cliente_id === Number(params[0]) && x.marketplace === params[1] && x.ativo);
      if (!v) return { rows: [] };
      const b = this.s.bases.find((x) => x.id === v.base_id);
      return { rows: [{ vinculo_id: v.id, base_id: v.base_id, slug: b.slug, nome: b.nome }] };
    }
    throw new Error(`Query não mapeada no MemoryDb: ${q}`);
  }
}

async function run() {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const originalFetch = global.fetch;

  const db = new MemoryDb(JSON.parse(JSON.stringify(WBS), (k, v) =>
    (k === "expires_at" || k === "created_at" || k === "updated_at") && typeof v === "string" ? new Date(v) : v));
  // datas viram string no JSON.parse acima só para expires_at/…; recoloca Date:
  db.s.grants.forEach((g) => { g.expires_at = FAR_FUTURE; });

  pool.query = (sql, p) => db.query(sql, p);
  pool.connect = () => db.connect();

  try {
    for (const m of ["../services/mlTokenService", "../utils/mlClient",
      "../services/clienteContas/clienteContaService"]) {
      delete require.cache[require.resolve(m)];
    }
    const { resolveMarketplaceAccountContext } = require("../services/clienteContas/clienteContaService");
    const { mlFetch } = require("../utils/mlClient");

    // 1. Conta B explícita — nunca toca a conta A / seller 111 / token 111 / base 91
    const ctxB = await resolveMarketplaceAccountContext({
      clienteId: 1, marketplace: "meli", clienteContaId: 102, requireUsableGrant: true,
    });
    ok("conta B: conta resolvida é a 102", ctxB.conta && ctxB.conta.id === 102);
    ok("conta B: mlUserId é 222 (nunca 111)", ctxB.mlUserId === "222");
    ok("conta B: grant é o 202 do seller 222", ctxB.grant && ctxB.grant.id === 202 && String(ctxB.grant.ml_user_id) === "222");
    ok("conta B: base resolvida é a 92 (Base B), nunca a 91", ctxB.base && ctxB.base.base_id === 92);

    const invB = checkAccountContext({
      clienteId: 1, clienteContaId: 102, marketplace: "meli",
      conta: ctxB.conta, sellerId: ctxB.mlUserId, mlUserId: ctxB.mlUserId,
      grant: ctxB.grant, base: ctxB.base, requireAccount: true, requireGrant: true,
    });
    ok("conta B: contexto resolvido passa no invariante §16", invB.ok === true);

    // 2. Conta A explícita — mesmo com... na verdade A é a principal aqui;
    //    inverte: torna B principal em memória e prova que A explícita ainda usa A.
    db.s.contas.find((c) => c.id === 101).is_primary = false;
    db.s.contas.find((c) => c.id === 102).is_primary = true;
    db.s.grants.find((g) => g.id === 201).is_primary = false;
    db.s.grants.find((g) => g.id === 202).is_primary = true;

    const ctxA = await resolveMarketplaceAccountContext({
      clienteId: 1, marketplace: "meli", clienteContaId: 101, requireUsableGrant: true,
    });
    ok("conta A explícita: resolve A mesmo com B como principal", ctxA.conta.id === 101 && ctxA.mlUserId === "111");
    ok("conta A explícita: grant é o 201 (seller 111), não o principal 202", ctxA.grant.id === 201);
    ok("conta A explícita: base é a 91, não a 92", ctxA.base.base_id === 91);
    ok("conta A explícita: passa no invariante §16",
      checkAccountContext({ clienteId: 1, clienteContaId: 101, marketplace: "meli",
        conta: ctxA.conta, sellerId: ctxA.mlUserId, mlUserId: ctxA.mlUserId,
        grant: ctxA.grant, base: ctxA.base }).ok === true);

    // 3. Sem clienteContaId + 2 contas ativas → 409 MULTIPLE_MARKETPLACE_ACCOUNTS
    await rejeitaCom(
      "sem conta + 2 contas ativas → 409 MULTIPLE_MARKETPLACE_ACCOUNTS (nunca escolhe em silêncio)",
      resolveMarketplaceAccountContext({ clienteId: 1, marketplace: "meli", clienteContaId: null }),
      (e) => e.code === "MULTIPLE_MARKETPLACE_ACCOUNTS" && e.statusCode === 409
    );

    // 4. checkAccountContext PEGA o bug clássico montado à mão
    const bug = checkAccountContext({
      clienteId: 1, clienteContaId: 102, marketplace: "meli",
      conta: db.s.contas.find((c) => c.id === 102),   // conta B (seller 222)
      sellerId: "222",                                 // path aponta pro seller B
      mlUserId: "111",                                 // mas o token é do seller A
      grant: db.s.grants.find((g) => g.id === 201),
    });
    ok("invariante pega seller-B + token-A", bug.ok === false &&
      bug.violacoes.some((v) => /token/.test(v) && /111/.test(v)));

    let lancou = false;
    try {
      assertAccountContext({ clienteId: 1, clienteContaId: 102, sellerId: "222", mlUserId: "111" });
    } catch (e) { lancou = e.code === "ACCOUNT_CONTEXT_INVARIANTE_VIOLADO"; }
    ok("assertAccountContext lança com code canônico", lancou);

    // 5. mlFetch por /users/{seller} usa o token daquele seller
    let tokenUsado = null;
    global.fetch = async (url, options) => {
      tokenUsado = options.headers.Authorization;
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
    };
    await mlFetch(1, "/users/222/items/search", { mlUserId: "222" });
    ok("mlFetch /users/222 usa access-222 (não o principal)", tokenUsado === "Bearer access-222");

    // 6. fix account-scope: obterCotacaoAtual propaga mlUserId ao shipping_options
    delete require.cache[require.resolve("../services/shared/marketplaceCurrentQuoteService")];
    const { obterCotacaoAtual } = require("../services/shared/marketplaceCurrentQuoteService");
    const chamadas = [];
    const fakeFetch = async (clienteId, path, options = {}) => {
      chamadas.push({ path, mlUserId: options.mlUserId });
      if (path.includes("/sale_price")) return { ok: true, data: { amount: 100 } };
      return { ok: true, data: { results: [], coverage: { all_country: { list_cost: 12 } } } };
    };
    await obterCotacaoAtual(
      { clienteId: 1, itemId: "MLB1", precoListaFallback: 100, listingTypeId: "gold_pro",
        categoryId: "MLB1", sellerId: "222", logisticType: "cross_docking", mlUserId: "222" },
      { mlFetchFn: fakeFetch, resolverPrecosItemFn: async () => ({ precoCheio: 100, precoPromocional: null, precoEfetivo: 100, fonte: "sale_price" }) }
    );
    const shipCall = chamadas.find((c) => c.path.includes("/users/222/shipping_options/free"));
    ok("obterCotacaoAtual chama /users/222/shipping_options/free", Boolean(shipCall));
    ok("obterCotacaoAtual propaga { mlUserId: '222' } ao shipping_options (fix account-scope)",
      shipCall && shipCall.mlUserId === "222");

    // 7. fix account-scope: meliApiEvidenceAdapter.buscarItensAtivos propaga
    //    mlUserId ao /users/{seller}/items/search (Motor Margem MELI_API).
    delete require.cache[require.resolve("../services/motorMargem/adapters/meliApiEvidenceAdapter")];
    const meliApi = require("../services/motorMargem/adapters/meliApiEvidenceAdapter");
    let buscaOpts = null;
    await meliApi.buscarItensAtivos(
      { clienteId: 1, mlUserId: "222", offset: 0, limit: 20 },
      async (clienteId, path, options = {}) => { buscaOpts = { path, mlUserId: options.mlUserId }; return { ok: true, data: { results: [], paging: { total: 0 } } }; }
    );
    ok("buscarItensAtivos monta /users/222/items/search", buscaOpts && buscaOpts.path.includes("/users/222/items/search"));
    ok("buscarItensAtivos propaga { mlUserId: '222' } (fix account-scope Motor Margem)", buscaOpts && buscaOpts.mlUserId === "222");

    console.log(`\naccountScopeInvariantesV3.test.js: ${checks} verificações passaram.`);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    global.fetch = originalFetch;
    for (const m of ["../services/mlTokenService", "../utils/mlClient",
      "../services/clienteContas/clienteContaService",
      "../services/shared/marketplaceCurrentQuoteService",
      "../services/motorMargem/adapters/meliApiEvidenceAdapter"]) {
      delete require.cache[require.resolve(m)];
    }
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
