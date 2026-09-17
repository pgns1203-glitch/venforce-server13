// server/tests/meliAnunciosPreco.test.js
//
// Edição real de PREÇO de um anúncio ML
// (PATCH /anuncios-meli/:itemId/preco -> POST /items/{id}/prices/standard).
//
// Regras protegidas por este teste:
//
//  1. a escrita usa a API dedicada de Preços, não o PUT genérico de /items:
//     desde 18/03/2026 um PUT de /items que só altera "price" é rejeitado
//     quando o item tem automatização de preço (dynamic pricing) ativa;
//
//  2. antes de escrever, o preço padrão (`standard`) atual é lido via
//     GET /items/{id}/prices — é o `id` dessa entrada que identifica QUAL
//     preço estamos alterando no POST;
//
//  3. depois do POST, o valor exibido NUNCA é o que foi enviado — é sempre
//     relido via um segundo GET /items/{id}/prices. Nunca assumir sucesso
//     silencioso;
//
//  4. item com variações nativas do ML bloqueia ANTES de qualquer chamada
//     de preço — esta tela não sabe (ainda) editar preço por variação;
//
//  5. recusa do ML (automação ativa, ou qualquer outra) é mensagem REAL,
//     e o snapshot local (`meli_anuncios.preco`) só muda depois da
//     confirmação — nunca antes, nunca em cima de uma falha;
//
//  6. se o ML confirma a escrita mas a releitura de confirmação falha, o
//     resultado é "não foi possível confirmar" — nunca um sucesso mascarado.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const Module = require("module");

// ── stub do cliente ML ──────────────────────────────────────────────────────
let mlChamadas = [];
let mlHandler = null;

const originalLoad = Module._load;
Module._load = function loadWithMlFetchStub(request, parent, isMain) {
  if (request === "../../utils/mlClient" || request === "../utils/mlClient") {
    return {
      async mlFetch(clienteId, path, options = {}) {
        const chamada = {
          clienteId,
          path,
          metodo: options.method || "GET",
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
const precoService = require("../services/meliAnuncios/meliPrecoService");

Module._load = originalLoad;

// ── fixtures (mesmo padrão de meliAnunciosEstoque.test.js) ─────────────────

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
      id: 7, cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB-X",
      titulo: "Camiseta Azul P", preco: 100, preco_original: 100,
      cliente_conta_id: 10, ml_user_id: "111",
    },
    {
      id: 11, cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB-SEMCONTA",
      titulo: "Linha antiga", preco: 50, preco_original: 50,
      cliente_conta_id: null, ml_user_id: null,
    },
  ];
}

class MockDb {
  constructor({ contas = [], grants = [], anuncios = [] } = {}) {
    this.contas = contas;
    this.grants = grants;
    this.anuncios = anuncios;
    this.updates = [];
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
    if (q.startsWith("CREATE TABLE") || q.startsWith("ALTER TABLE") || q.startsWith("CREATE INDEX")) {
      return { rows: [] };
    }

    if (q.startsWith("SELECT * FROM meli_anuncios WHERE cliente_id = $1 AND item_id = $2")) {
      const row = this.anuncios.find((a) => a.cliente_id === params[0] && a.item_id === String(params[1]));
      return { rows: row ? [row] : [] };
    }

    if (q.startsWith("UPDATE meli_anuncios")) {
      const row = this.anuncios.find((a) => a.cliente_id === params[0] && a.item_id === String(params[1]));
      if (!row) return { rows: [] };
      const sets = q.slice(q.indexOf("SET") + 3, q.indexOf("WHERE")).split(",");
      const campos = [];
      for (const parte of sets) {
        const m = parte.trim().match(/^([a-z_]+) = \$(\d+)/);
        if (!m) continue;
        row[m[1]] = params[Number(m[2]) - 1];
        campos.push(m[1]);
      }
      this.updates.push({ itemId: row.item_id, campos });
      return { rows: [row] };
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

function linha(db, itemId) {
  return db.anuncios.find((a) => a.item_id === itemId);
}

// Handler-fábrica: monta as respostas dos 4 passos possíveis
// (variação, prices-pré, POST standard, prices-confirmação) a partir de um
// mapa de overrides por path+método.
function handlerPadrao({
  variations = [],
  standardId = "PRICE1",
  standardAmountAntes = 100,
  moeda = "BRL",
  postResposta = { ok: true, status: 200, data: {} },
  standardAmountDepois,
} = {}) {
  return (chamada) => {
    if (chamada.metodo === "GET" && /variations/.test(chamada.path)) {
      return { ok: true, status: 200, data: { id: "MLB-X", variations } };
    }
    if (chamada.metodo === "GET" && /\/prices$/.test(chamada.path)) {
      const jaEscreveu = mlChamadas.some((c) => c.metodo === "POST");
      const amount = jaEscreveu && standardAmountDepois !== undefined ? standardAmountDepois : standardAmountAntes;
      return {
        ok: true, status: 200,
        data: { id: "MLB-X", prices: [{ id: standardId, type: "standard", amount, currency_id: moeda, conditions: {} }] },
      };
    }
    if (chamada.metodo === "POST" && /prices\/standard$/.test(chamada.path)) {
      return postResposta;
    }
    return { ok: true, status: 200, data: {} };
  };
}

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

async function run() {
  // 1. Caminho feliz: preço confirmado é o da RELEITURA, não o enviado.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async (db) => {
    mlChamadas = [];
    mlHandler = handlerPadrao({ standardAmountAntes: 100, standardAmountDepois: 119.9 });

    const res = fakeRes();
    await ctrl.atualizarPreco(
      { params: { itemId: "MLB-X" }, body: { clienteSlug: "cliente-a", preco: 120 } },
      res
    );

    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    assert.strictEqual(res.corpo.preco, 119.9, "o preço devolvido tem de ser o CONFIRMADO na releitura, não o enviado");

    const posts = mlChamadas.filter((c) => c.metodo === "POST");
    assert.strictEqual(posts.length, 1, "esperava exatamente um POST de escrita de preço");
    assert.strictEqual(posts[0].path, "/items/MLB-X/prices/standard");
    assert.deepStrictEqual(
      posts[0].body,
      { prices: [{ id: "PRICE1", amount: 120, currency_id: "BRL" }] },
      "o corpo do POST referencia o id do preço standard atual e o valor pedido"
    );
    assert.strictEqual(posts[0].mlUserId, "111");

    const gets = mlChamadas.filter((c) => c.metodo === "GET" && /\/prices$/.test(c.path));
    assert.strictEqual(gets.length, 2, "esperava uma leitura ANTES e uma DEPOIS da escrita (confirmação)");

    assert.strictEqual(linha(db, "MLB-X").preco, 119.9, "o snapshot local grava o valor CONFIRMADO");
    ok("caminho feliz: POST em /prices/standard, e o preço final é sempre o da releitura pós-escrita");
  });

  // 2. Automação de preço ativa: recusa real, sem tocar no banco, sem
  //    confirmar nada (a escrita nem aconteceu).
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async (db) => {
    mlChamadas = [];
    mlHandler = handlerPadrao({
      postResposta: {
        ok: false, status: 400,
        data: {
          message: "Validation error",
          cause: [{ code: "item.price.not_modifiable", message: "Cannot modify price on items with dynamic pricing" }],
        },
      },
    });

    const res = fakeRes();
    await ctrl.atualizarPreco(
      { params: { itemId: "MLB-X" }, body: { clienteSlug: "cliente-a", preco: 150 } },
      res
    );

    assert.strictEqual(res.statusCode, 200, "recusa esperada do ML é 200 com ok:false, como no resto do módulo");
    assert.strictEqual(res.corpo.ok, false);
    assert.strictEqual(res.corpo.codigo, "item.price.not_modifiable");
    assert.match(res.corpo.motivo, /automat/i, "a mensagem precisa explicar que é automatização de preço, não um erro genérico");

    const gets = mlChamadas.filter((c) => c.metodo === "GET" && /\/prices$/.test(c.path));
    assert.strictEqual(gets.length, 1, "sem escrita bem-sucedida, não pode haver releitura de confirmação");
    assert.strictEqual(linha(db, "MLB-X").preco, 100, "preço local não pode mudar quando o ML recusa");
    ok("automação de preço ativa: código e mensagem reais, nenhuma releitura, banco intacto");
  });

  // 3. Item com variação: bloqueia ANTES de qualquer chamada de preço.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async (db) => {
    mlChamadas = [];
    mlHandler = handlerPadrao({ variations: [{ id: 111 }, { id: 222 }] });

    const res = fakeRes();
    await ctrl.atualizarPreco(
      { params: { itemId: "MLB-X" }, body: { clienteSlug: "cliente-a", preco: 150 } },
      res
    );

    assert.strictEqual(res.corpo.ok, false);
    assert.strictEqual(res.corpo.codigo, "PRECO_ITEM_COM_VARIACAO");
    assert.match(res.corpo.motivo, /variaç/i);
    assert.match(res.corpo.motivo, /não está disponível|ainda não/i);
    assert.strictEqual(mlChamadas.length, 1, "bloqueio tem de acontecer só com a checagem de variação — nenhuma chamada de preço");
    assert.strictEqual(linha(db, "MLB-X").preco, 100);
    ok("item com variação: bloqueado antes de qualquer chamada de preço, mensagem explica o motivo");
  });

  // 4. Falha ao LER o preço padrão (antes de escrever): erro real, nada
  //    gravado, nenhum POST tentado.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async (db) => {
    mlChamadas = [];
    mlHandler = (chamada) => {
      if (/variations/.test(chamada.path)) return { ok: true, status: 200, data: { variations: [] } };
      if (/\/prices$/.test(chamada.path)) return { ok: false, status: 500, data: { message: "Internal error" } };
      return { ok: true, status: 200, data: {} };
    };

    const res = fakeRes();
    await ctrl.atualizarPreco(
      { params: { itemId: "MLB-X" }, body: { clienteSlug: "cliente-a", preco: 150 } },
      res
    );

    assert.strictEqual(res.corpo.ok, false);
    assert.strictEqual(mlChamadas.filter((c) => c.metodo === "POST").length, 0, "sem preço padrão lido, não há o que escrever");
    assert.strictEqual(linha(db, "MLB-X").preco, 100);
    ok("falha ao ler o preço padrão: erro real repassado, nenhum POST tentado, banco intacto");
  });

  // 5. POST confirma, mas a releitura de confirmação falha: não é sucesso
  //    mascarado — nem o banco pode ser tocado sem saber o valor real.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async (db) => {
    mlChamadas = [];
    let jaLeuAntes = false;
    mlHandler = (chamada) => {
      if (/variations/.test(chamada.path)) return { ok: true, status: 200, data: { variations: [] } };
      if (chamada.metodo === "GET" && /\/prices$/.test(chamada.path)) {
        if (!jaLeuAntes) {
          jaLeuAntes = true;
          return { ok: true, status: 200, data: { prices: [{ id: "PRICE1", type: "standard", amount: 100, currency_id: "BRL", conditions: {} }] } };
        }
        return { ok: false, status: 500, data: {} }; // releitura de confirmação falha
      }
      if (chamada.metodo === "POST") return { ok: true, status: 200, data: {} };
      return { ok: true, status: 200, data: {} };
    };

    const res = fakeRes();
    await ctrl.atualizarPreco(
      { params: { itemId: "MLB-X" }, body: { clienteSlug: "cliente-a", preco: 150 } },
      res
    );

    assert.strictEqual(res.corpo.ok, false, "sem confirmação, não pode devolver sucesso");
    assert.strictEqual(res.corpo.codigo, "PRECO_CONFIRMACAO_FALHOU");
    assert.match(res.corpo.motivo, /confirmar/i);
    assert.strictEqual(linha(db, "MLB-X").preco, 100, "sem saber o valor real, o banco não pode ser tocado");
    ok("escrita aceita mas confirmação falha: erro explícito de confirmação, banco intacto (nunca um chute)");
  });

  // 6. Validação local: preço ausente/zero/negativo/não numérico é 400 sem
  //    gastar nenhuma chamada ao Mercado Livre.
  for (const [valor, codigo] of [
    [null, "PRECO_AUSENTE"],
    ["", "PRECO_AUSENTE"],
    [0, "PRECO_INVALIDO"],
    [-10, "PRECO_INVALIDO"],
    ["abc", "PRECO_INVALIDO"],
  ]) {
    await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async (db) => {
      mlChamadas = [];
      const res = fakeRes();
      await ctrl.atualizarPreco(
        { params: { itemId: "MLB-X" }, body: { clienteSlug: "cliente-a", preco: valor } },
        res
      );
      assert.strictEqual(res.statusCode, 400, `valor ${JSON.stringify(valor)} deveria ser 400`);
      assert.strictEqual(res.corpo.codigo, codigo);
      assert.strictEqual(mlChamadas.length, 0, "valor inválido não pode gastar chamada ao Mercado Livre");
    });
  }
  ok("preço ausente, zero, negativo e não numérico: 400 sem tocar no Mercado Livre");

  // 7. clienteSlug ausente e anúncio inexistente: 400/404 sem chamar o ML.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    const res = fakeRes();
    await ctrl.atualizarPreco({ params: { itemId: "MLB-X" }, body: { preco: 150 } }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(mlChamadas.length, 0);

    const res2 = fakeRes();
    await ctrl.atualizarPreco(
      { params: { itemId: "MLB-NAOEXISTE" }, body: { clienteSlug: "cliente-a", preco: 150 } },
      res2
    );
    assert.strictEqual(res2.statusCode, 404);
    ok("clienteSlug ausente é 400 e anúncio inexistente é 404, sem chamada ao Mercado Livre");
  });

  // 8. A conta ML vem da linha do anúncio.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async (db) => {
    mlChamadas = [];
    mlHandler = handlerPadrao({ standardAmountAntes: 100, standardAmountDepois: 130 });

    const res = fakeRes();
    await ctrl.atualizarPreco(
      { params: { itemId: "MLB-X" }, body: { clienteSlug: "cliente-a", preco: 130 } },
      res
    );
    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    assert.ok(mlChamadas.every((c) => c.mlUserId === "111"), "todas as chamadas precisam usar o ml_user_id da própria linha do anúncio");
    ok("a conta ML usada em todas as chamadas é a da própria linha do anúncio");
  });

  // 9. O normalizador, direto.
  assert.strictEqual(precoService.normalizarPreco(150).ok, true);
  assert.strictEqual(precoService.normalizarPreco(150).valor, 150);
  assert.strictEqual(precoService.normalizarPreco("150.5").valor, 150.5);
  assert.strictEqual(precoService.normalizarPreco(0).ok, false);
  assert.strictEqual(precoService.normalizarPreco(-1).ok, false);
  ok("normalizarPreco: número positivo passa, zero/negativo não");
}

run()
  .then(() => {
    console.log(`\n✓ ${checks} verificações de edição de preço de anúncio ML`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n✗ FALHOU:", err.message);
    console.error(err.stack);
    process.exit(1);
  });
