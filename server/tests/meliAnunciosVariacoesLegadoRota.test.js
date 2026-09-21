// server/tests/meliAnunciosVariacoesLegadoRota.test.js
//
// GET /anuncios-meli/:itemId/variacoes-legado — expansão, na própria linha do
// anúncio, das variações do modelo LEGADO do ML (item_id -> variations[]).
// Mesmo padrão de resolução de conta do vizinho GET /:itemId (detalhe): a
// linha já sabe de qual conta veio (ml_user_id gravado na sincronização); só
// cai em resolverContextoConta quando essa coluna ainda está vazia — e aí,
// com 2+ contas e nenhuma indicação, é ambiguidade (409), nunca um palpite.
//
// Read-only nos dois sentidos: só lê o Mercado Livre (via
// meliVariacoesLegadoService), não escreve em nada.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const Module = require("module");

let mlHandler = null;

const originalLoad = Module._load;
Module._load = function loadWithMlFetchStub(request, parent, isMain) {
  if (request === "../../utils/mlClient" || request === "../utils/mlClient") {
    return {
      async mlFetch(clienteId, path, options = {}) {
        return mlHandler
          ? mlHandler({ clienteId, path, mlUserId: options.mlUserId })
          : { ok: true, status: 200, data: [] };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pool = require("../config/database");
const ctrl = require("../controllers/meliAnunciosController");

Module._load = originalLoad;

const cliente = { id: 1, nome: "Cliente A", slug: "cliente-a", ativo: true };

function grantFixture({ id, cliente_id, ml_user_id }) {
  return {
    id, cliente_id, ml_user_id,
    access_token: "tok", refresh_token: "ref",
    expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    token_status: "valid", is_primary: false,
    refresh_failures: 0, updated_at: new Date().toISOString(),
  };
}

function anunciosFixture() {
  return [
    {
      id: 20, cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB-LEGADO",
      titulo: "Tênis com variações reais", user_product_id: null,
      variations_count: 24, estoque: 0, status: "active", sub_status: null,
      cliente_conta_id: 10, ml_user_id: "111",
    },
    // Linha sincronizada antes de ml_user_id existir: força resolverContextoConta.
    {
      id: 21, cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB-SEMCONTA",
      titulo: "Linha antiga", user_product_id: null,
      variations_count: 5, estoque: 0, status: "active", sub_status: null,
      cliente_conta_id: null, ml_user_id: null,
    },
  ];
}

class MockDb {
  constructor({ contas = [], grants = [], anuncios = [] } = {}) {
    this.contas = contas;
    this.grants = grants;
    this.anuncios = anuncios;
  }

  async connect() {
    return { query: (sql, params) => this.query(sql, params), release() {} };
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q.includes("FROM clientes WHERE id = $1")) {
      return { rows: cliente.id === Number(params[0]) ? [cliente] : [] };
    }
    if (q.includes("FROM clientes WHERE LOWER(slug) = $1")) {
      return { rows: cliente.slug === params[0] ? [cliente] : [] };
    }
    if (q.startsWith("SELECT * FROM cliente_contas WHERE id = $1")) {
      const conta = this.contas.find((c) => c.id === Number(params[0]));
      return { rows: conta ? [conta] : [] };
    }
    if (q.includes("FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true ORDER BY is_primary")) {
      return { rows: this.contas.filter((c) => c.cliente_id === params[0] && c.marketplace === params[1] && c.ativo !== false) };
    }
    if (q.includes("COUNT(*)::int AS total FROM cliente_contas")) {
      const total = this.contas.filter((c) => c.cliente_id === params[0] && c.ativo !== false && c.marketplace === "meli").length;
      return { rows: [{ total }] };
    }
    if (q.includes("t.cliente_id = $1 AND t.ml_user_id = $2")) {
      const row = this.grants.find((g) => g.cliente_id === params[0] && String(g.ml_user_id) === String(params[1]));
      return { rows: row ? [row] : [] };
    }
    if (q.includes("FROM ml_tokens t") && q.includes("WHERE t.cliente_id = $1")) {
      return { rows: this.grants.filter((g) => g.cliente_id === params[0]) };
    }
    if (q.includes("base_cliente_vinculos")) return { rows: [] };
    if (q.startsWith("CREATE TABLE") || q.startsWith("ALTER TABLE") || q.startsWith("CREATE INDEX")) return { rows: [] };

    if (q.startsWith("SELECT * FROM meli_anuncios WHERE cliente_id = $1 AND item_id = $2")) {
      const row = this.anuncios.find((a) => a.cliente_id === params[0] && a.item_id === String(params[1]));
      return { rows: row ? [row] : [] };
    }

    return { rows: [] };
  }
}

function withMockDb(opts, fn) {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const db = new MockDb(opts);
  pool.query = (sql, params) => db.query(sql, params);
  pool.connect = () => db.connect();
  return Promise.resolve()
    .then(() => fn(db))
    .finally(() => {
      pool.query = originalQuery;
      pool.connect = originalConnect;
    });
}

function fakeReq({ itemId, clienteSlug = "cliente-a", clienteContaId }) {
  return { params: { itemId }, query: { clienteSlug, clienteContaId } };
}

function fakeRes() {
  return {
    statusCode: 200,
    corpo: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.corpo = obj; return this; },
  };
}

const UMA_CONTA = {
  contas: [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", external_account_id: "111", is_primary: true, ativo: true }],
  grants: [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })],
};

const DUAS_CONTAS = {
  contas: [
    { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", external_account_id: "111", is_primary: true, ativo: true },
    { id: 11, cliente_id: 1, marketplace: "meli", nome: "ML 2", external_account_id: "222", is_primary: false, ativo: true },
  ],
  grants: [
    grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" }),
    grantFixture({ id: 101, cliente_id: 1, ml_user_id: "222" }),
  ],
};

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

async function run() {
  // 1. Caminho feliz: a linha já sabe a conta (ml_user_id gravado) — nenhuma
  //    resolução extra, e a chamada ao ML usa exatamente esse mlUserId.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async () => {
    mlHandler = async ({ path, mlUserId }) => {
      assert.strictEqual(path, "/items/MLB-LEGADO/variations");
      assert.strictEqual(mlUserId, "111", "tem de usar o ml_user_id já gravado na linha, não resolver de novo");
      return {
        ok: true, status: 200,
        data: [
          { id: 1, attribute_combinations: [{ name: "Color", value_name: "Preto" }, { name: "Size", value_name: "34 BR" }], price: 189.9, available_quantity: 4, sold_quantity: 0 },
        ],
      };
    };
    const req = fakeReq({ itemId: "MLB-LEGADO" });
    const res = fakeRes();
    await ctrl.variacoesLegado(req, res);
    assert.strictEqual(res.corpo.ok, true);
    assert.strictEqual(res.corpo.variacoes.length, 1);
    assert.strictEqual(res.corpo.variacoes[0].atributos[0].valor, "Preto");
    ok("caminho feliz: usa o ml_user_id da própria linha e devolve as variações mapeadas");
  });

  // 2. Linha sem ml_user_id + 1 conta só: resolverContextoConta acha sozinho.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async () => {
    mlHandler = async ({ mlUserId }) => {
      assert.strictEqual(mlUserId, "111");
      return { ok: true, status: 200, data: [] };
    };
    const req = fakeReq({ itemId: "MLB-SEMCONTA" });
    const res = fakeRes();
    await ctrl.variacoesLegado(req, res);
    assert.strictEqual(res.corpo.ok, true);
    ok("linha sem ml_user_id: resolve pelo contexto de conta quando há só uma conta");
  });

  // 3. Linha sem ml_user_id + 2 contas + nenhuma indicação: ambiguidade (409).
  await withMockDb({ ...DUAS_CONTAS, anuncios: anunciosFixture() }, async () => {
    const req = fakeReq({ itemId: "MLB-SEMCONTA" });
    const res = fakeRes();
    await ctrl.variacoesLegado(req, res);
    assert.strictEqual(res.statusCode, 409, "2 contas sem indicação nunca pode escolher sozinho");
    assert.strictEqual(res.corpo.ok, false);
    ok("ambiguidade de conta vira 409, nunca um palpite");
  });

  // 4. Anúncio inexistente no banco -> 404.
  await withMockDb({ ...UMA_CONTA, anuncios: [] }, async () => {
    const req = fakeReq({ itemId: "MLB-FANTASMA" });
    const res = fakeRes();
    await ctrl.variacoesLegado(req, res);
    assert.strictEqual(res.statusCode, 404);
    ok("anúncio não encontrado no banco vira 404");
  });

  // 5. Cliente inexistente -> 404.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async () => {
    const req = fakeReq({ itemId: "MLB-LEGADO", clienteSlug: "outro-cliente" });
    const res = fakeRes();
    await ctrl.variacoesLegado(req, res);
    assert.strictEqual(res.statusCode, 404);
    ok("clienteSlug que não resolve cliente vira 404");
  });

  // 6. Recusa do ML: falha legível, HTTP 200 (mesmo padrão dos vizinhos), sem lançar.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async () => {
    mlHandler = async () => ({ ok: false, status: 404, data: { message: "Item not found" } });
    const req = fakeReq({ itemId: "MLB-LEGADO" });
    const res = fakeRes();
    await ctrl.variacoesLegado(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.corpo.ok, false);
    assert.ok(res.corpo.motivo, "falha precisa vir com motivo legível");
    ok("recusa do ML vira falha legível, sem derrubar a rota");
  });

  console.log(`\n${checks} verificações passaram.`);
}

run().catch((e) => { console.error("FALHOU:", e); process.exit(1); });
