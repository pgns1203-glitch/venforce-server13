// server/tests/meliAnunciosPromocoes.test.js
//
// Promoções oficiais do item (GET /anuncios-meli/:itemId/promocoes), para o
// bloco "Promoções disponíveis" do modal de detalhe.
//
// Regras protegidas por este teste:
//
//  1. read-only de ponta a ponta: o endpoint só faz GET /seller-promotions/
//     items/{id} — nunca POST/PUT/DELETE (nunca inscreve o item, nunca grava
//     preço). Nenhum teste aqui deve produzir uma chamada de escrita.
//  2. nunca inventa desconto: candidate sem suggested_discounted_price vira
//     precoFinal=null (não cai para original_price nem para 0); started/
//     pending com price<=0 (candidato "cru" devolvido com price:0) também
//     vira precoFinal=null.
//  3. ordenação reaproveita escolherPromocao (mesma função da tela
//     "Promoções com Retorno ML") — ativa/agendada primeiro, maior
//     meli_percentage antes, nunca uma heurística nova.
//  4. a conta ML usada na chamada ao Mercado Livre é a da própria linha do
//     anúncio (mesma regra dos vizinhos GET /:itemId e /variacoes-legado).

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
        const chamada = { clienteId, path, metodo: options.method || "GET", mlUserId: options.mlUserId };
        mlChamadas.push(chamada);
        return mlHandler ? mlHandler(chamada) : { ok: true, status: 200, data: [] };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pool = require("../config/database");
const ctrl = require("../controllers/meliAnunciosController");
const promocoesService = require("../services/meliAnuncios/meliPromocoesService");

Module._load = originalLoad;

// ── fixtures (mesmo padrão de meliAnunciosPreco.test.js) ───────────────────

const cliente = { id: 1, nome: "Cliente A", slug: "cliente-a", ativo: true };

function anunciosFixture() {
  return [
    {
      id: 7, cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB-X",
      titulo: "Camiseta Azul P", preco: 100, preco_original: 100,
      cliente_conta_id: 10, ml_user_id: "111",
    },
  ];
}

class MockDb {
  constructor({ anuncios = [] } = {}) {
    this.anuncios = anuncios;
  }
  async connect() { return { query: (sql, params) => this.query(sql, params), release() {} }; }
  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (q.includes("FROM clientes WHERE LOWER(slug) = $1")) {
      return { rows: cliente.slug === params[0] ? [cliente] : [] };
    }
    if (q.startsWith("SELECT * FROM meli_anuncios WHERE cliente_id = $1 AND item_id = $2")) {
      const row = this.anuncios.find((a) => a.cliente_id === params[0] && a.item_id === String(params[1]));
      return { rows: row ? [row] : [] };
    }
    if (q.startsWith("CREATE TABLE") || q.startsWith("ALTER TABLE") || q.startsWith("CREATE INDEX")) {
      return { rows: [] };
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
  return Promise.resolve().then(() => fn(db)).finally(() => {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  });
}

function fakeRes() {
  return {
    statusCode: 200, corpo: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.corpo = obj; return this; },
  };
}

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

async function run() {
  // 1. Promoção ATIVA (started): desconto real calculado, preço da resposta.
  await withMockDb({ anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    mlHandler = () => ({
      ok: true, status: 200,
      data: [{ id: "P-1", type: "DEAL", status: "started", price: 134.9, original_price: 149.9, name: "HOTSALE" }],
    });

    const res = fakeRes();
    await ctrl.promocoes({ params: { itemId: "MLB-X" }, query: { clienteSlug: "cliente-a" } }, res);

    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    assert.strictEqual(res.corpo.promocoes.length, 1);
    const linha = res.corpo.promocoes[0];
    assert.strictEqual(linha.status, "started");
    assert.strictEqual(linha.statusLabel, "ATIVA");
    assert.strictEqual(linha.precoFinal, 134.9);
    assert.strictEqual(linha.precoOriginal, 149.9);
    assert.strictEqual(linha.descontoReais, 15);
    assert.ok(Math.abs(linha.descontoPercentual - 10.01) < 0.1, `desconto% inesperado: ${linha.descontoPercentual}`);
    assert.strictEqual(linha.editavelPrecoFinal, true);
    ok("promoção ativa: desconto real calculado a partir do price/original_price do ML");
  });

  // 2. CANDIDATE com sugestão: precoFinal = suggested_discounted_price (nunca
  //    o price bruto, que vem 0 nesse status).
  await withMockDb({ anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    mlHandler = () => ({
      ok: true, status: 200,
      data: [{
        type: "PRICE_DISCOUNT", status: "candidate", price: 0, original_price: 149.9,
        suggested_discounted_price: 134.9, min_discounted_price: 120, max_discounted_price: 145,
      }],
    });

    const res = fakeRes();
    await ctrl.promocoes({ params: { itemId: "MLB-X" }, query: { clienteSlug: "cliente-a" } }, res);

    const linha = res.corpo.promocoes[0];
    assert.strictEqual(linha.status, "candidate");
    assert.strictEqual(linha.statusLabel, "ELEGÍVEL");
    assert.strictEqual(linha.precoFinal, 134.9, "candidate usa suggested_discounted_price, nunca o price bruto (0)");
    assert.strictEqual(linha.descontoReais, 15);
    ok("candidate com sugestão do ML: preço final vem de suggested_discounted_price");
  });

  // 3. CANDIDATE SEM sugestão: nunca inventar desconto.
  await withMockDb({ anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    mlHandler = () => ({
      ok: true, status: 200,
      data: [{ type: "PRICE_DISCOUNT", status: "candidate", price: 0, original_price: 149.9 }],
    });

    const res = fakeRes();
    await ctrl.promocoes({ params: { itemId: "MLB-X" }, query: { clienteSlug: "cliente-a" } }, res);

    const linha = res.corpo.promocoes[0];
    assert.strictEqual(linha.precoFinal, null, "sem suggested_discounted_price, precoFinal não pode ser inventado");
    assert.strictEqual(linha.descontoReais, null);
    assert.strictEqual(linha.descontoPercentual, null);
    assert.strictEqual(linha.editavelPrecoFinal, true, "célula continua editável como simulação, mesmo sem sugestão do ML");
    ok("candidate sem sugestão do ML: precoFinal/desconto ficam null, nunca um cálculo próprio");
  });

  // 4. MÚLTIPLAS promoções: ordenação reaproveita escolherPromocao (ativa
  //    primeiro, maior meli_percentage antes) — sem esconder as demais.
  await withMockDb({ anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    mlHandler = () => ({
      ok: true, status: 200,
      data: [
        { type: "PRICE_DISCOUNT", status: "candidate", price: 0, original_price: 100, suggested_discounted_price: 90 },
        { id: "P-2", type: "DEAL", status: "started", price: 82, original_price: 100, meli_percentage: 3 },
        { id: "P-3", type: "PRE_NEGOTIATED", status: "started", price: 80, original_price: 100, meli_percentage: 8 },
      ],
    });

    const res = fakeRes();
    await ctrl.promocoes({ params: { itemId: "MLB-X" }, query: { clienteSlug: "cliente-a" } }, res);

    assert.strictEqual(res.corpo.promocoes.length, 3, "as três promoções devem aparecer — nunca esconder atrás de uma só");
    assert.strictEqual(res.corpo.promocoes[0].id, "P-3", "ativa com maior meli_percentage vem primeiro");
    assert.strictEqual(res.corpo.promocoes[1].id, "P-2", "ativa com menor meli_percentage vem em seguida");
    assert.strictEqual(res.corpo.promocoes[2].status, "candidate", "candidate fica por último, depois das ativas");
    ok("múltiplas promoções: todas aparecem, ordenadas por prioridade (ativa > candidate, maior retorno ML antes)");
  });

  // 5. Read-only: nenhuma chamada de escrita é feita (só GET).
  await withMockDb({ anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    mlHandler = () => ({ ok: true, status: 200, data: [{ type: "DEAL", status: "started", price: 90, original_price: 100 }] });

    const res = fakeRes();
    await ctrl.promocoes({ params: { itemId: "MLB-X" }, query: { clienteSlug: "cliente-a" } }, res);

    assert.strictEqual(res.corpo.ok, true);
    assert.ok(mlChamadas.length >= 1, "esperava pelo menos uma chamada ao Mercado Livre");
    assert.ok(mlChamadas.every((c) => c.metodo === "GET"), "o endpoint de promoções nunca pode fazer POST/PUT/DELETE");
    assert.ok(mlChamadas.every((c) => /seller-promotions\/items\//.test(c.path)), "só pode chamar /seller-promotions/items/{id}");
    assert.strictEqual(mlChamadas[0].mlUserId, "111", "a conta ML usada é a da própria linha do anúncio");
    ok("read-only: só GET /seller-promotions/items/{id}, usando a conta ML da linha do anúncio");
  });

  // 6. ML sem promoção nenhuma para o item: lista vazia, sem quebrar.
  await withMockDb({ anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    mlHandler = () => ({ ok: true, status: 200, data: [] });

    const res = fakeRes();
    await ctrl.promocoes({ params: { itemId: "MLB-X" }, query: { clienteSlug: "cliente-a" } }, res);

    assert.strictEqual(res.corpo.ok, true);
    assert.deepStrictEqual(res.corpo.promocoes, []);
    ok("sem promoção nenhuma: lista vazia, sem erro");
  });

  // 7. Falha do Mercado Livre ao consultar: não derruba a tela, devolve vazio.
  await withMockDb({ anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    mlHandler = () => ({ ok: false, status: 500, data: { message: "erro" } });

    const res = fakeRes();
    await ctrl.promocoes({ params: { itemId: "MLB-X" }, query: { clienteSlug: "cliente-a" } }, res);

    assert.strictEqual(res.corpo.ok, true, "falha ao consultar promoções não pode derrubar o endpoint inteiro");
    assert.deepStrictEqual(res.corpo.promocoes, []);
    ok("falha do Mercado Livre ao consultar promoções: devolve lista vazia, sem quebrar a resposta");
  });

  // 8. clienteSlug ausente e anúncio inexistente: 400/404 sem chamar o ML.
  await withMockDb({ anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    const res = fakeRes();
    await ctrl.promocoes({ params: { itemId: "MLB-X" }, query: {} }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(mlChamadas.length, 0);

    const res2 = fakeRes();
    await ctrl.promocoes({ params: { itemId: "MLB-NAOEXISTE" }, query: { clienteSlug: "cliente-a" } }, res2);
    assert.strictEqual(res2.statusCode, 404);
    assert.strictEqual(mlChamadas.length, 0);
    ok("clienteSlug ausente é 400 e anúncio inexistente é 404, sem chamada ao Mercado Livre");
  });

  // 9. Normalizador direto — casos de borda.
  assert.strictEqual(promocoesService.normalizarPromocao({ status: "started", price: 0, original_price: 100 }, 0).precoFinal, null,
    "started com price 0 não é preço real");
  assert.strictEqual(promocoesService.normalizarPromocao({ status: "pending", price: 50, original_price: 100 }, 0).statusLabel, "AGENDADA");
  assert.strictEqual(promocoesService.rotuloTipoPromocao("DOD"), "Oferta do dia");
  assert.strictEqual(promocoesService.rotuloTipoPromocao("TIPO_DESCONHECIDO"), "TIPO_DESCONHECIDO");
  ok("normalizarPromocao: started com price=0 não vira preço real; statusLabel e rótulo de tipo corretos");
}

run()
  .then(() => {
    console.log(`\n✓ ${checks} verificações de promoções do anúncio ML`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n✗ FALHOU:", err.message);
    console.error(err.stack);
    process.exit(1);
  });
