// server/tests/backfillMeliUserProducts.test.js
//
// Backfill controlado de meli_user_products (rollout do modelo UP para
// anúncios que já existiam antes do sync novo). Ver
// docs/PROPOSTA_BACKFILL_MELI_USER_PRODUCTS.md.
//
// Cobre:
//   1. dry-run não escreve nada (nem meli_anuncios, nem meli_user_products);
//   2. o UPDATE estreito nunca sobrescreve um user_product_id já existente;
//   3. o backfill real (não dry-run) grava em meli_user_products via
//      registrarUserProducts (reaproveitado, não duplicado);
//   4. retomada: item já preenchido não é buscado de novo no ML;
//   5. exceção de rede no multiget não derruba o cliente;
//   6. 429 respeita retryAfter (espera antes do próximo lote);
//   7. falha em registrarUserProducts não deixa user_product_id gravado
//      (ordem de persistência: meli_user_products antes de meli_anuncios);
//   8. cliente com erro estrutural (409) não impede o próximo, em --all.

const assert = require("assert");
const Module = require("module");

let respostaMultiget = [];
let chamadasMultiget = [];
// null | "excecao" | "500" | "429"
let modoFalhaMultiget = null;
let retryAfterSimulado = null;
// vazio = a falha afeta qualquer lote; com itens = só afeta lotes que peçam
// algum desses ids (usado para falhar só 1 cliente em testes com --all).
let idsQueDevemFalhar = new Set();
const originalLoad = Module._load;
Module._load = function loadWithMlFetchStub(request, parent, isMain) {
  if (request === "../../utils/mlClient" || request === "../utils/mlClient") {
    return {
      async mlFetch(clienteId, path, options = {}) {
        if (path.startsWith("/items?ids=")) {
          const idsPedidos = path.replace("/items?ids=", "").split(",");
          chamadasMultiget.push(idsPedidos);
          const afetaEsteLote =
            idsQueDevemFalhar.size === 0 ||
            idsPedidos.some((id) => idsQueDevemFalhar.has(id));
          if (afetaEsteLote && modoFalhaMultiget === "excecao") {
            throw new Error("ECONNRESET simulado");
          }
          if (afetaEsteLote && modoFalhaMultiget === "500") {
            return { ok: false, status: 500 };
          }
          if (afetaEsteLote && modoFalhaMultiget === "429") {
            return { ok: false, status: 429, retryAfter: retryAfterSimulado };
          }
          return {
            ok: true,
            status: 200,
            data: idsPedidos
              .map((id) => respostaMultiget.find((b) => b.id === id))
              .filter(Boolean)
              .map((body) => ({ code: 200, body })),
          };
        }
        return { ok: true, status: 200, data: {} };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pool = require("../config/database");
const backfill = require("../scripts/backfillMeliUserProducts");
const meliAnunciosService = require("../services/meliAnuncios/meliAnunciosService");
const familiaService = require("../services/meliAnuncios/meliFamiliaService");

Module._load = originalLoad;

// esperarFn de teste: nunca dorme de verdade, só registra por quanto tempo
// o código pediu pra esperar — permite testar pacing/retryAfter sem deixar
// a suíte lenta.
function esperarFnDeTeste() {
  const chamadas = [];
  return { chamadas, fn: async (ms) => { chamadas.push(ms); } };
}

// ── fixtures (mesmo padrão de tests/meliUserProducts.test.js) ──────────────

function itemUP(over = {}) {
  return {
    id: "MLB1",
    title: "Camisa De Pesca",
    status: "active",
    price: 100,
    attributes: [],
    pictures: [],
    site_id: "MLB",
    domain_id: "MLB-FISHING_SHIRTS",
    catalog_listing: false,
    family_name: "Camisa De Pesca Traira E Espada",
    family_id: "5424136139438415",
    user_product_id: "MLBU4607668110",
    ...over,
  };
}

function itemLegado(over = {}) {
  return {
    id: "MLB9",
    title: "Produto legado",
    status: "active",
    price: 50,
    attributes: [],
    pictures: [],
    site_id: "MLB",
    domain_id: "MLB-SHIRTS",
    catalog_listing: false,
    ...over,
  };
}

class MockDb {
  constructor({ contas = [], grants = [], anuncios = [] } = {}) {
    this.contas = contas;
    this.grants = grants;
    this.anuncios = anuncios;
    this.userProducts = [];
  }

  async connect() {
    return { query: (sql, params) => this.query(sql, params), release() {} };
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q.includes("FROM clientes WHERE id = $1")) {
      return { rows: [{ id: params[0], nome: "Cliente A", slug: "cliente-a", ativo: true }] };
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
    if (q.includes("base_cliente_vinculos")) {
      return { rows: [] };
    }

    // --- clientes pendentes (backfillTodos / --all) -------------------------
    if (q.startsWith("SELECT DISTINCT cliente_id, cliente_slug FROM meli_anuncios WHERE user_product_id IS NULL")) {
      const vistos = new Map();
      for (const a of this.anuncios) {
        if (!a.user_product_id && !vistos.has(a.cliente_id)) {
          vistos.set(a.cliente_id, a.cliente_slug || `cliente-${a.cliente_id}`);
        }
      }
      return { rows: [...vistos.entries()].map(([cliente_id, cliente_slug]) => ({ cliente_id, cliente_slug })) };
    }

    if (q.startsWith("CREATE TABLE") || q.startsWith("ALTER TABLE") || q.startsWith("CREATE INDEX")) {
      return { rows: [] };
    }

    // --- candidatos ao backfill ---------------------------------------------
    if (q.startsWith("SELECT item_id FROM meli_anuncios WHERE cliente_id = $1 AND user_product_id IS NULL")) {
      return {
        rows: this.anuncios
          .filter((a) => a.cliente_id === params[0] && !a.user_product_id)
          .map((a) => ({ item_id: a.item_id })),
      };
    }

    // --- UPDATE estreito, nunca sobrescreve valor existente -----------------
    if (q.startsWith("UPDATE meli_anuncios") && q.includes("user_product_id = $")) {
      const [clienteId, itemId, userProductId] = params;
      const row = this.anuncios.find((a) => a.cliente_id === clienteId && a.item_id === itemId);
      if (row && !row.user_product_id) {
        row.user_product_id = userProductId;
        return { rows: [{ item_id: itemId }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // --- meli_user_products: upsert (idêntico ao mock existente) -----------
    if (q.startsWith("INSERT INTO meli_user_products")) {
      const [
        cliente_id, cliente_conta_id, ml_user_id, user_product_id,
        family_id, family_name, site_id, domain_id, catalog_product_id,
      ] = params;
      const existente = this.userProducts.find(
        (u) => u.cliente_id === cliente_id && u.user_product_id === user_product_id
      );
      const row = {
        cliente_id, cliente_conta_id, ml_user_id, user_product_id,
        family_id, family_name, site_id, domain_id, catalog_product_id,
      };
      if (existente) {
        Object.assign(existente, row, {
          family_id: row.family_id != null ? row.family_id : existente.family_id,
        });
      } else {
        this.userProducts.push(row);
      }
      return { rows: [] };
    }

    return { rows: [] };
  }
}

function withMockDb(dbOpts, fn) {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const db = new MockDb(dbOpts);
  pool.query = (sql, params) => db.query(sql, params);
  pool.connect = () => db.connect();
  return Promise.resolve()
    .then(() => fn(db))
    .finally(() => {
      pool.query = originalQuery;
      pool.connect = originalConnect;
    });
}

const contaUnica = {
  contas: [{
    id: 10, cliente_id: 1, marketplace: "meli", external_account_id: "900",
    nome: "Conta A", ativo: true, is_primary: true,
  }],
  grants: [{
    id: 100, cliente_id: 1, ml_user_id: "900",
    access_token: "tok", refresh_token: "ref",
    expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    token_status: "valid", is_primary: false,
    refresh_failures: 0, updated_at: new Date().toISOString(),
  }],
};

async function run() {
  // 1. dry-run: conta certo, mas não escreve nada em nenhuma tabela.
  await withMockDb({
    ...contaUnica,
    anuncios: [
      { cliente_id: 1, item_id: "MLB1", user_product_id: null },
      { cliente_id: 1, item_id: "MLB9", user_product_id: null },
    ],
  }, async (db) => {
    chamadasMultiget = [];
    respostaMultiget = [itemUP({ id: "MLB1" }), itemLegado({ id: "MLB9" })];

    const res = await backfill.backfillCliente({ clienteId: 1, clienteSlug: "cliente-a", dryRun: true, esperarFn: esperarFnDeTeste().fn });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.analisados, 2);
    assert.strictEqual(res.comUserProductId, 1);
    assert.strictEqual(res.semUserProductId, 1);
    assert.strictEqual(res.erros, 0);

    assert.strictEqual(db.anuncios.find((a) => a.item_id === "MLB1").user_product_id, null, "dry-run não pode escrever em meli_anuncios");
    assert.strictEqual(db.userProducts.length, 0, "dry-run não pode escrever em meli_user_products");
    console.log("  ✓ backfillCliente() em dry-run analisa e conta, mas não escreve nada");
  });

  // 2. UPDATE estreito nunca sobrescreve user_product_id já existente.
  await withMockDb({
    anuncios: [
      { cliente_id: 1, item_id: "MLB1", user_product_id: "JA_EXISTENTE" },
      { cliente_id: 1, item_id: "MLB2", user_product_id: null },
    ],
  }, async (db) => {
    const alterouExistente = await meliAnunciosService.preencherUserProductId(1, "MLB1", "NOVO_VALOR");
    assert.strictEqual(alterouExistente, false, "não deve reportar escrita quando já havia valor");
    assert.strictEqual(db.anuncios[0].user_product_id, "JA_EXISTENTE", "valor existente não pode ser sobrescrito");

    const alterouVazio = await meliAnunciosService.preencherUserProductId(1, "MLB2", "NOVO_VALOR");
    assert.strictEqual(alterouVazio, true, "deve reportar escrita quando estava NULL");
    assert.strictEqual(db.anuncios[1].user_product_id, "NOVO_VALOR");
    console.log("  ✓ preencherUserProductId() nunca sobrescreve valor existente, só preenche NULL");
  });

  // 3. Backfill real grava em meli_anuncios E em meli_user_products (via
  //    registrarUserProducts reaproveitado — não uma cópia da lógica).
  await withMockDb({
    ...contaUnica,
    anuncios: [{ cliente_id: 1, item_id: "MLB1", user_product_id: null }],
  }, async (db) => {
    chamadasMultiget = [];
    respostaMultiget = [itemUP({ id: "MLB1" })];

    const res = await backfill.backfillCliente({ clienteId: 1, clienteSlug: "cliente-a", dryRun: false, esperarFn: esperarFnDeTeste().fn });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.comUserProductId, 1);
    assert.strictEqual(db.anuncios[0].user_product_id, "MLBU4607668110", "meli_anuncios precisa ser atualizado");
    assert.strictEqual(db.userProducts.length, 1, "meli_user_products precisa ser populado");
    assert.strictEqual(db.userProducts[0].family_id, "5424136139438415");
    console.log("  ✓ backfillCliente() (não dry-run) grava em meli_anuncios e em meli_user_products");
  });

  // 4. Retomada: item já preenchido não entra nos candidatos nem é buscado no ML.
  await withMockDb({
    ...contaUnica,
    anuncios: [
      { cliente_id: 1, item_id: "MLB1", user_product_id: "JA_PREENCHIDO" }, // execução anterior
      { cliente_id: 1, item_id: "MLB2", user_product_id: null },           // falta processar
    ],
  }, async (db) => {
    chamadasMultiget = [];
    respostaMultiget = [itemUP({ id: "MLB2", user_product_id: "MLBU_NOVO" })];

    const res = await backfill.backfillCliente({ clienteId: 1, clienteSlug: "cliente-a", dryRun: false, esperarFn: esperarFnDeTeste().fn });

    assert.strictEqual(res.analisados, 1, "só o item ainda sem UP deve ser candidato");
    assert.ok(
      chamadasMultiget.every((lote) => !lote.includes("MLB1")),
      "item já preenchido não pode ser buscado de novo no ML"
    );
    assert.strictEqual(db.anuncios.find((a) => a.item_id === "MLB1").user_product_id, "JA_PREENCHIDO", "não pode ser tocado de novo");
    assert.strictEqual(db.anuncios.find((a) => a.item_id === "MLB2").user_product_id, "MLBU_NOVO");
    console.log("  ✓ backfillCliente() retoma: item já preenchido não é reprocessado");
  });

  // 5. Falha de rede no multiget não derruba o cliente — vira "erro", não trava.
  await withMockDb({
    ...contaUnica,
    anuncios: [{ cliente_id: 1, item_id: "MLB_FALHA", user_product_id: null }],
  }, async (db) => {
    chamadasMultiget = [];
    respostaMultiget = [];
    modoFalhaMultiget = "500";
    const { fn: esperar } = esperarFnDeTeste();

    let res;
    try {
      res = await backfill.backfillCliente({ clienteId: 1, clienteSlug: "cliente-a", dryRun: false, esperarFn: esperar });
    } finally {
      modoFalhaMultiget = null;
    }

    assert.strictEqual(res.ok, true, "falha de 1 lote não pode derrubar o backfill do cliente");
    assert.strictEqual(res.analisados, 1);
    assert.strictEqual(res.erros, 1, "o lote que falhou deve contar como erro, não como sem_user_product_id");
    assert.strictEqual(res.comUserProductId, 0);
    assert.strictEqual(res.semUserProductId, 0);
    assert.strictEqual(db.anuncios[0].user_product_id, null, "nada deve ser escrito para o lote que falhou");
    console.log("  ✓ backfillCliente() isola falha de rede num lote como erro, sem derrubar o cliente");
  });

  // 6. Exceção de rede (não um HTTP de erro, uma exceção de verdade — o que
  //    mlFetch faz num erro de conexão/refresh) não derruba o --all: o
  //    cliente que falha vira "erro" e o próximo cliente é processado.
  await withMockDb({
    contas: [
      { id: 10, cliente_id: 1, marketplace: "meli", external_account_id: "900", nome: "Conta A", ativo: true, is_primary: true },
      { id: 20, cliente_id: 2, marketplace: "meli", external_account_id: "901", nome: "Conta B", ativo: true, is_primary: true },
    ],
    grants: [
      { id: 100, cliente_id: 1, ml_user_id: "900", access_token: "tok", refresh_token: "ref", expires_at: new Date(Date.now() + 86400000).toISOString(), token_status: "valid", is_primary: false, refresh_failures: 0, updated_at: new Date().toISOString() },
      { id: 200, cliente_id: 2, ml_user_id: "901", access_token: "tok", refresh_token: "ref", expires_at: new Date(Date.now() + 86400000).toISOString(), token_status: "valid", is_primary: false, refresh_failures: 0, updated_at: new Date().toISOString() },
    ],
    anuncios: [
      { cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB1", user_product_id: null },
      { cliente_id: 2, cliente_slug: "cliente-b", item_id: "MLB2", user_product_id: null },
    ],
  }, async (db) => {
    chamadasMultiget = [];
    respostaMultiget = [itemUP({ id: "MLB2" })]; // só o cliente 2 vai encontrar resposta válida
    const { fn: esperar } = esperarFnDeTeste();

    // a exceção afeta só o lote de MLB1 (cliente 1) — MLB2 (cliente 2) segue normal.
    modoFalhaMultiget = "excecao";
    idsQueDevemFalhar = new Set(["MLB1"]);

    let resultados;
    try {
      resultados = await backfill.backfillTodos({ dryRun: false, esperarFn: esperar, delayMs: 0 });
    } finally {
      modoFalhaMultiget = null;
      idsQueDevemFalhar = new Set();
    }

    const [r1, r2] = resultados;
    assert.strictEqual(r1.clienteId, 1);
    assert.strictEqual(r1.ok, true, "exceção de rede não pode derrubar o cliente 1");
    assert.strictEqual(r1.erros, 1);
    assert.strictEqual(r2.clienteId, 2);
    assert.strictEqual(r2.ok, true, "o cliente 2 precisa ser processado mesmo com o 1 falhando");
    assert.strictEqual(r2.comUserProductId, 1, "cliente 2 processado normalmente");
    console.log("  ✓ backfillTodos() isola exceção de rede de 1 cliente e continua para o próximo");
  });

  // 7. 429: espera o retryAfter antes do próximo lote (sem retry automático
  //    do mesmo lote — só pacing, sem arquitetura de retry).
  await withMockDb({
    ...contaUnica,
    anuncios: [{ cliente_id: 1, item_id: "MLB1", user_product_id: null }],
  }, async (db) => {
    chamadasMultiget = [];
    respostaMultiget = [];
    modoFalhaMultiget = "429";
    retryAfterSimulado = 2; // segundos
    const { chamadas, fn: esperar } = esperarFnDeTeste();

    let res;
    try {
      res = await backfill.backfillCliente({ clienteId: 1, clienteSlug: "cliente-a", dryRun: false, esperarFn: esperar });
    } finally {
      modoFalhaMultiget = null;
      retryAfterSimulado = null;
    }

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.erros, 1);
    assert.ok(chamadas.includes(2000), `esperava um esperarFn(2000) pelo retryAfter=2s, recebeu: ${JSON.stringify(chamadas)}`);
    console.log("  ✓ backfillCliente() respeita retryAfter de um 429 antes de seguir");
  });

  // 8. Ordem de persistência: registrarUserProducts primeiro. Se ele falhar,
  //    meli_anuncios.user_product_id NÃO pode ser gravado (evita órfão).
  await withMockDb({
    ...contaUnica,
    anuncios: [{ cliente_id: 1, item_id: "MLB1", user_product_id: null }],
  }, async (db) => {
    chamadasMultiget = [];
    respostaMultiget = [itemUP({ id: "MLB1" })];
    const { fn: esperar } = esperarFnDeTeste();

    const originalRegistrar = familiaService.registrarUserProducts;
    familiaService.registrarUserProducts = async () => {
      throw new Error("falha proposital em meli_user_products");
    };

    const errosOriginal = console.error;
    console.error = () => {}; // silencia o log esperado de erro
    let res;
    try {
      res = await backfill.backfillCliente({ clienteId: 1, clienteSlug: "cliente-a", dryRun: false, esperarFn: esperar });
    } finally {
      familiaService.registrarUserProducts = originalRegistrar;
      console.error = errosOriginal;
    }

    assert.strictEqual(res.ok, true, "falha na persistência não pode derrubar o cliente");
    assert.strictEqual(res.erros, 1);
    assert.strictEqual(res.comUserProductId, 0, "não pode contar como sucesso o que não foi persistido");
    assert.strictEqual(
      db.anuncios[0].user_product_id, null,
      "meli_anuncios não pode ser atualizado quando meli_user_products falhou"
    );
    console.log("  ✓ backfillCliente() não grava user_product_id em meli_anuncios se registrarUserProducts falhar");
  });

  // 9. Cliente com erro estrutural (409 de múltiplas contas ML) não impede
  //    o processamento dos clientes seguintes em --all.
  await withMockDb({
    contas: [
      { id: 20, cliente_id: 2, marketplace: "meli", external_account_id: "901", nome: "Conta B", ativo: true, is_primary: true },
    ],
    grants: [
      { id: 200, cliente_id: 2, ml_user_id: "901", access_token: "tok", refresh_token: "ref", expires_at: new Date(Date.now() + 86400000).toISOString(), token_status: "valid", is_primary: false, refresh_failures: 0, updated_at: new Date().toISOString() },
    ],
    anuncios: [
      { cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB1", user_product_id: null },
      { cliente_id: 2, cliente_slug: "cliente-b", item_id: "MLB2", user_product_id: null },
    ],
  }, async (db) => {
    chamadasMultiget = [];
    respostaMultiget = [itemUP({ id: "MLB2" })];
    const { fn: esperar } = esperarFnDeTeste();

    const originalResolver = meliAnunciosService.resolverContextoConta;
    meliAnunciosService.resolverContextoConta = async (args) => {
      if (args.clienteId === 1) {
        const erro = new Error("MULTIPLE_MARKETPLACE_ACCOUNTS");
        erro.statusCode = 409;
        erro.code = "MULTIPLE_MARKETPLACE_ACCOUNTS";
        throw erro;
      }
      return originalResolver(args);
    };

    const errosOriginal = console.error;
    console.error = () => {};
    let resultados;
    try {
      resultados = await backfill.backfillTodos({ dryRun: false, esperarFn: esperar, delayMs: 0 });
    } finally {
      meliAnunciosService.resolverContextoConta = originalResolver;
      console.error = errosOriginal;
    }

    const [r1, r2] = resultados;
    assert.strictEqual(r1.clienteId, 1);
    assert.strictEqual(r1.ok, false, "cliente 1 (409) precisa ser marcado como falho, não travar o processo");
    assert.strictEqual(r2.clienteId, 2);
    assert.strictEqual(r2.ok, true, "cliente 2 precisa ser processado mesmo com o 1 tendo dado 409");
    assert.strictEqual(r2.comUserProductId, 1);
    console.log("  ✓ backfillTodos() isola erro estrutural (409) de 1 cliente e segue para o próximo");
  });

  // 10. CLI: --cliente_id, --all e --dry-run são reconhecidos independentemente.
  {
    assert.deepStrictEqual(
      backfill.parseArgs(["--cliente_id=104"]),
      { clienteId: 104, all: false, dryRun: false }
    );
    assert.deepStrictEqual(
      backfill.parseArgs(["--all"]),
      { clienteId: null, all: true, dryRun: false }
    );
    assert.deepStrictEqual(
      backfill.parseArgs(["--cliente_id=48", "--dry-run"]),
      { clienteId: 48, all: false, dryRun: true }
    );
    console.log("  ✓ parseArgs() reconhece --cliente_id, --all e --dry-run");
  }

  console.log("backfillMeliUserProducts.test.js passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
