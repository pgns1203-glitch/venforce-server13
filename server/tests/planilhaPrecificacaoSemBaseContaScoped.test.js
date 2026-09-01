// server/tests/planilhaPrecificacaoSemBaseContaScoped.test.js
//
// Regressão do bug real de produção: gerarPlanilhaPrecificacaoSemBase monta o
// path do ML com o mlUserId da conta selecionada
// (`/users/${mlUserId}/items/search`) mas chamava `mlFetch` sem `{ mlUserId
// }` nas options — a escolha do TOKEN caía no fallback/principal do
// cliente. Cliente com 2 contas ML e a Conta 1 como principal: pedir a
// Conta 2 buscava os anúncios do seller da Conta 2 só que autenticado com o
// token da Conta 1, e o Mercado Livre responde 403 "Searching another user
// items is restricted."
//
// Não usa DI: mlTokenService/clienteContaService/contextoPrecificacaoService/
// mlClient usam o `pool`/`fetch` globais — mesmo padrão de mock das outras
// suítes (automacoesContaScoped.test.js, mlFetchAccountScoped.test.js).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const pool = require("../config/database");

const FAR_FUTURE = new Date(Date.now() + 6 * 60 * 60 * 1000);

const CLIENTE = { id: 90, nome: "Cliente X", slug: "cliente-x", ativo: true };

// Conta 1 é a principal — exatamente o cenário do bug real: se o mlUserId
// não for propagado, a Conta 2 cairia silenciosamente para este token.
const CONTA_1 = { id: 101, cliente_id: 90, marketplace: "meli", nome: "ML Conta 1", slug: "cliente-x-meli-1", external_account_id: "111", is_primary: true, ativo: true, metadata_json: {}, created_at: new Date(), updated_at: new Date() };
const CONTA_2 = { id: 102, cliente_id: 90, marketplace: "meli", nome: "ML Conta 2", slug: "cliente-x-meli-2", external_account_id: "222", is_primary: false, ativo: true, metadata_json: {}, created_at: new Date(), updated_at: new Date() };

function grant({ id, cliente_conta_id, ml_user_id, is_primary }) {
  return {
    id, cliente_id: 90, cliente_conta_id, ml_user_id,
    access_token: `access-${ml_user_id}`, refresh_token: `refresh-${ml_user_id}`,
    expires_at: FAR_FUTURE, created_at: new Date(), updated_at: new Date(),
    is_primary, token_status: "valid", refresh_failures: 0,
    last_refresh_error_at: null, next_refresh_attempt_at: null,
    _has_is_primary: true, _has_refresh_metadata: true,
  };
}

class MemoryDb {
  constructor() {
    this.contas = [CONTA_1, CONTA_2];
    this.grants = [
      grant({ id: 201, cliente_conta_id: 101, ml_user_id: "111", is_primary: true }),
      grant({ id: 202, cliente_conta_id: 102, ml_user_id: "222", is_primary: false }),
    ];
  }

  async connect() {
    return { query: (sql, params) => this.query(sql, params), release() {} };
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(q) || q.includes("pg_advisory")) return { rows: [] };

    if (q.startsWith("SELECT id, nome, slug FROM clientes WHERE slug = $1 AND ativo = true")) {
      return { rows: params[0] === CLIENTE.slug ? [CLIENTE] : [] };
    }
    if (q.startsWith("SELECT id, nome, slug, ativo FROM clientes WHERE slug = $1")) {
      return { rows: params[0] === CLIENTE.slug ? [CLIENTE] : [] };
    }
    if (q.startsWith("SELECT id, nome, slug, ativo FROM clientes WHERE id = $1")) {
      return { rows: Number(params[0]) === CLIENTE.id ? [CLIENTE] : [] };
    }

    if (q.startsWith("SELECT * FROM cliente_contas WHERE id = $1")) {
      const c = this.contas.find((x) => x.id === Number(params[0]));
      return { rows: c ? [c] : [] };
    }
    if (q.startsWith("SELECT COUNT(*)::int AS total FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true")) {
      const total = this.contas.filter((c) => c.cliente_id === Number(params[0]) && c.marketplace === params[1] && c.ativo).length;
      return { rows: [{ total }] };
    }

    if (q.includes("FROM ml_tokens t") && q.includes("t.cliente_id = $1 AND t.ml_user_id = $2")) {
      const g = this.grants.find((x) => x.cliente_id === Number(params[0]) && String(x.ml_user_id) === String(params[1]));
      return { rows: g ? [{ ...g }] : [] };
    }
    // Fallback legado (sem mlUserId): usado quando um bug faz o consumidor
    // esquecer de propagar options.mlUserId ao mlFetch — devolve o grant
    // PRINCIPAL do cliente, nunca o da conta pedida. É essa a query que
    // provou o bug real de produção (Conta 2 caindo no token da Conta 1).
    if (q.includes("FROM ml_tokens t") && q.includes("WHERE t.cliente_id = $1") && !q.includes("ml_user_id = $2")) {
      return { rows: this.grants.filter((x) => x.cliente_id === Number(params[0])).map((g) => ({ ...g })) };
    }

    // base_cliente_vinculos: nenhum vínculo cadastrado (rota sem base) —
    // tanto o lookup por conta (obterBaseDaConta) quanto por cliente
    // (buscarBasesMeliDoCliente) devolvem vazio.
    if (q.includes("FROM base_cliente_vinculos v") && q.includes("JOIN bases b ON b.id = v.base_id")) {
      return { rows: [] };
    }

    throw new Error(`Query não mapeada no mock: ${q}`);
  }
}

async function run() {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const originalFetch = global.fetch;
  const db = new MemoryDb();
  pool.query = (sql, params) => db.query(sql, params);
  pool.connect = () => db.connect();

  const chamadasFetch = [];
  global.fetch = async (url, options) => {
    chamadasFetch.push({ url: String(url), authorization: options.headers.Authorization });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ results: [], scroll_id: null }),
    };
  };

  try {
    delete require.cache[require.resolve("../services/mlTokenService")];
    delete require.cache[require.resolve("../services/clienteContas/clienteContaService")];
    delete require.cache[require.resolve("../services/automacoes/contextoPrecificacaoService")];
    delete require.cache[require.resolve("../utils/mlClient")];
    delete require.cache[require.resolve("../services/automacoes/planilhaPrecificacaoSemBaseService")];
    const { gerarPlanilhaPrecificacaoSemBase } = require("../services/automacoes/planilhaPrecificacaoSemBaseService");

    // ── Conta 2 (não principal): nunca pode cair no token da Conta 1 ─────
    chamadasFetch.length = 0;
    await gerarPlanilhaPrecificacaoSemBase({ clienteSlugRaw: "cliente-x", clienteContaId: 102 });
    ok("Conta 2 — pelo menos uma chamada ao ML", chamadasFetch.length >= 1);
    const buscaConta2 = chamadasFetch.find((c) => c.url.includes("/users/222/items/search"));
    ok("Conta 2 — path usa o seller 222", Boolean(buscaConta2));
    ok("Conta 2 — usa o access_token de 222 (não o principal 111)", buscaConta2.authorization === "Bearer access-222");
    ok("Conta 2 — nenhuma chamada usou o token principal (access-111)", !chamadasFetch.some((c) => c.authorization === "Bearer access-111"));

    // ── Conta 1 (principal): comportamento existente continua funcionando ─
    chamadasFetch.length = 0;
    await gerarPlanilhaPrecificacaoSemBase({ clienteSlugRaw: "cliente-x", clienteContaId: 101 });
    const buscaConta1 = chamadasFetch.find((c) => c.url.includes("/users/111/items/search"));
    ok("Conta 1 — path usa o seller 111", Boolean(buscaConta1));
    ok("Conta 1 — usa o access_token de 111", buscaConta1.authorization === "Bearer access-111");

    // ── Regressão conceitual: em toda chamada de busca por seller, o id do
    //    seller no path bate com o mlUserId que decidiu o token usado. ────
    const todasBuscas = [
      { conta: 102, resp: buscaConta2 },
      { conta: 101, resp: buscaConta1 },
    ];
    for (const { conta, resp } of todasBuscas) {
      const sellerNoPath = resp.url.match(/\/users\/([^/]+)\/items\/search/)?.[1];
      const grantDoSeller = db.grants.find((g) => g.ml_user_id === sellerNoPath);
      ok(
        `conta ${conta} — seller do path (${sellerNoPath}) e token usado (${resp.authorization}) pertencem ao mesmo grant`,
        grantDoSeller && resp.authorization === `Bearer ${grantDoSeller.access_token}`
      );
    }

    console.log(`\n✓ planilhaPrecificacaoSemBaseContaScoped: ${checks} verificações`);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../services/mlTokenService")];
    delete require.cache[require.resolve("../services/clienteContas/clienteContaService")];
    delete require.cache[require.resolve("../services/automacoes/contextoPrecificacaoService")];
    delete require.cache[require.resolve("../utils/mlClient")];
    delete require.cache[require.resolve("../services/automacoes/planilhaPrecificacaoSemBaseService")];
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
