// server/tests/meliAnunciosVariacoesLegadoEstoqueRota.test.js
//
// PATCH /anuncios-meli/:itemId/variacoes-legado/:variationId/estoque
//
// Escrita real de estoque de uma variação do modelo LEGADO
// (ver meliVariacoesLegadoEstoqueService: GET fresco -> PUT /items com
// `variations` inteira -> GET de confirmação). Este teste cobre só a FIAÇÃO
// do controller — conta/token, validação local antes de chamar o ML, e o
// contrato de resposta — porque a lógica de segurança em si (payload, perda
// de variação, bloqueios) já está coberta em
// meliVariacoesLegadoEstoqueService.test.js.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const Module = require("module");

let mlChamadas = [];
let mlHandler = null;

const originalLoad = Module._load;
Module._load = function loadWithMlFetchStub(request, parent, isMain) {
  if (request === "../../utils/mlClient" || request === "../utils/mlClient") {
    return {
      async mlFetch(clienteId, path, options = {}) {
        const chamada = {
          clienteId, path, metodo: options.method || "GET",
          mlUserId: options.mlUserId,
          body: options.body ? JSON.parse(options.body) : null,
        };
        mlChamadas.push(chamada);
        return mlHandler ? mlHandler(chamada) : { ok: true, status: 200, data: {} };
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
      variations_count: 3, estoque: 0, status: "active", sub_status: null,
      cliente_conta_id: 10, ml_user_id: "111",
    },
    {
      id: 21, cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB-SEMCONTA",
      titulo: "Linha antiga", user_product_id: null,
      variations_count: 2, estoque: 0, status: "active", sub_status: null,
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

function fakeReq({ itemId, variationId, clienteSlug = "cliente-a", clienteContaId, estoque }) {
  return { params: { itemId, variationId }, body: { clienteSlug, clienteContaId, estoque } };
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

const ITEM_LEGADO = { id: "MLB-LEGADO", user_product_id: null, shipping: { logistic_type: "me2" } };
function variacoesFixture() {
  return [
    { id: 1, available_quantity: 4 },
    { id: 2, available_quantity: 6 },
    { id: 3, available_quantity: 9 },
  ];
}

function handlerFeliz({ alvoId, novaQtd }) {
  let getVariations = 0;
  return (chamada) => {
    if (chamada.metodo === "GET" && !chamada.path.endsWith("/variations")) {
      return { ok: true, status: 200, data: ITEM_LEGADO };
    }
    if (chamada.metodo === "GET") {
      getVariations += 1;
      const lista = variacoesFixture();
      if (getVariations === 1) return { ok: true, status: 200, data: lista };
      return { ok: true, status: 200, data: lista.map((v) => (v.id === alvoId ? { ...v, available_quantity: novaQtd } : v)) };
    }
    return { ok: true, status: 200, data: {} };
  };
}

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

async function run() {
  // 1. Caminho feliz: usa o ml_user_id da própria linha, faz a sequência
  //    GET item / GET variations / PUT / GET variations e devolve as
  //    variações frescas.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    mlHandler = handlerFeliz({ alvoId: 2, novaQtd: 20 });
    const res = fakeRes();
    await ctrl.atualizarEstoqueVariacaoLegado(
      fakeReq({ itemId: "MLB-LEGADO", variationId: 2, estoque: 20 }),
      res
    );
    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    assert.ok(mlChamadas.every((c) => c.mlUserId === "111"), "toda chamada usa o ml_user_id da própria linha");
    const put = mlChamadas.find((c) => c.metodo === "PUT");
    assert.deepStrictEqual(put.body, {
      variations: [
        { id: 1, available_quantity: 4 },
        { id: 2, available_quantity: 20 },
        { id: 3, available_quantity: 9 },
      ],
    });
    const alvo = res.corpo.variacoes.find((v) => v.id === 2);
    assert.strictEqual(alvo.estoque, 20);
    ok("caminho feliz: usa a conta da linha, monta o payload completo e devolve as variações frescas");
  });

  // 2. Duas contas: a linha manda (nunca a primeira conta da lista).
  await withMockDb({ ...DUAS_CONTAS, anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    mlHandler = handlerFeliz({ alvoId: 1, novaQtd: 5 });
    const res = fakeRes();
    await ctrl.atualizarEstoqueVariacaoLegado(
      fakeReq({ itemId: "MLB-LEGADO", variationId: 1, estoque: 5 }),
      res
    );
    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    assert.ok(mlChamadas.every((c) => c.mlUserId === "111"), "com duas contas, vale o ml_user_id da própria linha");
    ok("duas contas cadastradas: usa o ml_user_id gravado na linha do anúncio, não a primeira da lista");
  });

  // 3. Linha sem conta + duas contas + nenhuma indicação -> 409, sem chamar o ML.
  await withMockDb({ ...DUAS_CONTAS, anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    const res = fakeRes();
    await ctrl.atualizarEstoqueVariacaoLegado(
      fakeReq({ itemId: "MLB-SEMCONTA", variationId: 1, estoque: 5 }),
      res
    );
    assert.strictEqual(res.statusCode, 409, "ambiguidade de conta nunca pode virar palpite");
    assert.strictEqual(mlChamadas.length, 0);
    ok("linha sem conta + duas contas: 409, nenhuma chamada ao Mercado Livre");
  });

  // 4. Anúncio inexistente no banco -> 404.
  await withMockDb({ ...UMA_CONTA, anuncios: [] }, async () => {
    mlChamadas = [];
    const res = fakeRes();
    await ctrl.atualizarEstoqueVariacaoLegado(
      fakeReq({ itemId: "MLB-FANTASMA", variationId: 1, estoque: 5 }),
      res
    );
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(mlChamadas.length, 0);
    ok("anúncio não encontrado no banco: 404, sem chamar o Mercado Livre");
  });

  // 5. clienteSlug ausente -> 400, sem chamar o ML.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    const res = fakeRes();
    await ctrl.atualizarEstoqueVariacaoLegado(
      { params: { itemId: "MLB-LEGADO", variationId: 1 }, body: { estoque: 5 } },
      res
    );
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(mlChamadas.length, 0);
    ok("clienteSlug ausente: 400, sem chamar o Mercado Livre");
  });

  // 6. Estoque inválido -> 400 ANTES de resolver cliente/conta/token.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    const res = fakeRes();
    await ctrl.atualizarEstoqueVariacaoLegado(
      fakeReq({ itemId: "MLB-LEGADO", variationId: 1, estoque: "-3" }),
      res
    );
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.corpo.codigo, "ESTOQUE_INVALIDO");
    assert.strictEqual(mlChamadas.length, 0, "validação local não pode gastar chamada ao ML nem resolver conta");
    ok("estoque inválido: 400 antes de qualquer chamada externa");
  });

  // 7. Bloqueio do service (ex.: item já migrado ao User Product) passa como
  //    { ok:false, codigo, motivo } HTTP 200 — mesmo padrão dos vizinhos.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    mlHandler = (chamada) => {
      if (chamada.metodo === "GET" && !chamada.path.endsWith("/variations")) {
        return { ok: true, status: 200, data: { id: "MLB-LEGADO", user_product_id: "MLBU-9", shipping: {} } };
      }
      return { ok: true, status: 200, data: [] };
    };
    const res = fakeRes();
    await ctrl.atualizarEstoqueVariacaoLegado(
      fakeReq({ itemId: "MLB-LEGADO", variationId: 1, estoque: 5 }),
      res
    );
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.corpo.ok, false);
    assert.strictEqual(res.corpo.codigo, "USER_PRODUCT_MIGRADO");
    ok("bloqueio do service (User Product migrado): 200 com ok:false e código legível");
  });

  // 8. Perda crítica de variação: a rota repassa `critico:true` para a UI
  //    orientar conferência manual, sem nunca reportar sucesso.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    let gets = 0;
    mlHandler = (chamada) => {
      if (chamada.metodo === "GET" && !chamada.path.endsWith("/variations")) {
        return { ok: true, status: 200, data: ITEM_LEGADO };
      }
      if (chamada.metodo === "GET") {
        gets += 1;
        return gets === 1
          ? { ok: true, status: 200, data: variacoesFixture() }
          : { ok: true, status: 200, data: [{ id: 1, available_quantity: 4 }] };
      }
      return { ok: true, status: 200, data: {} };
    };
    const res = fakeRes();
    await ctrl.atualizarEstoqueVariacaoLegado(
      fakeReq({ itemId: "MLB-LEGADO", variationId: 1, estoque: 4 }),
      res
    );
    assert.strictEqual(res.corpo.ok, false);
    assert.strictEqual(res.corpo.codigo, "PERDA_DE_VARIACAO");
    assert.strictEqual(res.corpo.critico, true);
    ok("perda de variação detectada pós-PUT: nunca sucesso, `critico:true` chega até a resposta");
  });

  console.log(`\n${checks} verificações passaram.`);
}

run().catch((e) => { console.error("FALHOU:", e); process.exit(1); });
