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
    assert.ok(
      mlChamadas.every((c) => /seller-promotions\/items\//.test(c.path) || /\/sale_price/.test(c.path)),
      "só pode chamar /seller-promotions/items/{id} e /items/{id}/sale_price (fonte da promoção ATIVA)"
    );
    assert.ok(mlChamadas.every((c) => c.mlUserId === "111"), "a conta ML usada é a da própria linha do anúncio, nas duas chamadas");
    ok("read-only: só GET /seller-promotions/items/{id} e /items/{id}/sale_price, usando a conta ML da linha do anúncio");
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

  // 10. subsidioMl — vem direto de discount_meli_boost_amount (redução real
  //     de tarifa que o ML mostra como "Reduzimos R$ X das suas tarifas"),
  //     nunca mais calculado a partir de meli_percentage/desconto.
  {
    const linha = promocoesService.normalizarPromocao(
      { status: "started", price: 80, original_price: 100, discount_meli_boost_amount: 0.61 }, 0
    );
    assert.strictEqual(linha.subsidioMl, 0.61, "subsidioMl = discount_meli_boost_amount, em R$, sem conversão de unidade");
  }
  ok("subsidioMl: vem de discount_meli_boost_amount (redução de tarifa), não mais de meli_percentage*desconto");

  // 11. subsidioMl ausente quando o ML não manda discount_meli_boost_amount
  //     (ex.: boosted_offer nunca veio true para este tipo/item).
  {
    const linha = promocoesService.normalizarPromocao(
      { status: "started", price: 82, original_price: 100, meli_percentage: 3 }, 0
    );
    assert.strictEqual(linha.subsidioMl, null, "sem discount_meli_boost_amount do ML, subsidioMl fica null (UI mostra —)");
  }
  ok("subsidioMl: null quando o ML não devolve discount_meli_boost_amount para o tipo de promoção");

  // 12. discount_meli_boost_amount = 0 é um valor válido (R$ 0,00) — não é
  //     ausência de dado, então não pode virar null/"—".
  {
    const linha = promocoesService.normalizarPromocao(
      { status: "started", price: 80, original_price: 100, discount_meli_boost_amount: 0 }, 0
    );
    assert.strictEqual(linha.subsidioMl, 0, "discount_meli_boost_amount = 0 é válido, não é ausência de dado");
  }
  ok("subsidioMl: 0 é tratado como valor válido (R$ 0,00), nunca como ausência");

  // 13. subsidioMl ignora meli_percentage/seller_percentage — eles continuam
  //     expostos como campos próprios da promoção, só não alimentam mais R$.
  {
    const linha = promocoesService.normalizarPromocao(
      {
        status: "started", price: 80, original_price: 100,
        meli_percentage: 50, seller_percentage: 999, discount_meli_boost_amount: 0.61,
      }, 0
    );
    assert.strictEqual(linha.subsidioMl, 0.61, "subsidioMl ignora meli_percentage e seller_percentage");
    assert.strictEqual(linha.meliPercentage, 50, "meli_percentage continua exposto como dado da promoção");
    assert.strictEqual(linha.sellerPercentage, 999, "seller_percentage continua exposto como dado da promoção");
  }
  ok("subsidioMl: ignora meli_percentage/seller_percentage; ambos continuam expostos como campos próprios");

  // 14. statusExibicao — casamento por id: só a promoção cujo id bate com o
  //     promotion_id do sale_price vira ATIVA; outra started vira NÃO APLICADA.
  {
    const ativa = promocoesService.normalizarPromocao({ id: "123", status: "started" }, 0, "123");
    const naoAplicada = promocoesService.normalizarPromocao({ id: "456", status: "started" }, 1, "123");
    assert.strictEqual(ativa.statusExibicao, "ATIVA", "id bate com sale_price.metadata.promotion_id");
    assert.strictEqual(naoAplicada.statusExibicao, "NÃO APLICADA", "started que não bate com o promotion_id não pode ser ATIVA");
  }
  ok("statusExibicao: só a promoção cujo id casa com promotion_id vira ATIVA; as demais started viram NÃO APLICADA");

  // 15. statusExibicao — casamento por ref_id, quando a promoção não expõe id.
  {
    const ativa = promocoesService.normalizarPromocao({ ref_id: "abc", status: "started" }, 0, "abc");
    assert.strictEqual(ativa.statusExibicao, "ATIVA", "casamento também funciona por ref_id");
  }
  ok("statusExibicao: casamento por ref_id (quando a promoção não tem id) também identifica a ATIVA");

  // 16. statusExibicao — sem promotion_id (sale_price sem metadata ou falhou):
  //     nenhuma promoção started pode virar ATIVA por eliminação.
  {
    const linha1 = promocoesService.normalizarPromocao({ id: "123", status: "started" }, 0, null);
    const linha2 = promocoesService.normalizarPromocao({ ref_id: "abc", status: "started" }, 1, null);
    assert.strictEqual(linha1.statusExibicao, "NÃO APLICADA");
    assert.strictEqual(linha2.statusExibicao, "NÃO APLICADA");
  }
  ok("statusExibicao: sem promotion_id, nenhuma promoção started vira ATIVA — nunca por eliminação/heurística");

  // 17. statusExibicao — pending e candidate seguem vocabulário próprio,
  //     independente de promotion_id.
  {
    const agendada = promocoesService.normalizarPromocao({ status: "pending" }, 0, "qualquer");
    const elegivel = promocoesService.normalizarPromocao({ status: "candidate" }, 0, "qualquer");
    assert.strictEqual(agendada.statusExibicao, "PROGRAMADA");
    assert.strictEqual(elegivel.statusExibicao, "ELEGÍVEL");
  }
  ok("statusExibicao: pending vira PROGRAMADA e candidate vira ELEGÍVEL, sempre — não dependem de promotion_id");

  // 18. Fluxo completo via controller: /seller-promotions/items e /sale_price
  //     rodam em paralelo; só a promoção apontada por metadata.promotion_id
  //     vira ATIVA, a outra started vira NÃO APLICADA.
  await withMockDb({ anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    mlHandler = (chamada) => {
      if (/\/sale_price/.test(chamada.path)) {
        return { ok: true, status: 200, data: { amount: 80, regular_amount: 100, metadata: { promotion_id: "P-3" } } };
      }
      return {
        ok: true, status: 200,
        data: [
          { id: "P-2", type: "DEAL", status: "started", price: 82, original_price: 100, meli_percentage: 3, discount_meli_boost_amount: 1.2 },
          { id: "P-3", type: "PRE_NEGOTIATED", status: "started", price: 80, original_price: 100, meli_percentage: 8, discount_meli_boost_amount: 0.61 },
        ],
      };
    };

    const res = fakeRes();
    await ctrl.promocoes({ params: { itemId: "MLB-X" }, query: { clienteSlug: "cliente-a" } }, res);

    const porId = {};
    res.corpo.promocoes.forEach((p) => { porId[p.id] = p; });
    assert.strictEqual(porId["P-3"].statusExibicao, "ATIVA", "P-3 é a que o sale_price aponta — só ela vira ATIVA");
    assert.strictEqual(porId["P-2"].statusExibicao, "NÃO APLICADA", "P-2 está started mas não define o preço atual");
    assert.strictEqual(porId["P-3"].subsidioMl, 0.61);
    assert.strictEqual(porId["P-2"].subsidioMl, 1.2);
    assert.ok(mlChamadas.some((c) => /seller-promotions\/items\//.test(c.path)), "precisa ter chamado /seller-promotions/items/{id}");
    assert.ok(mlChamadas.some((c) => /\/sale_price/.test(c.path)), "precisa ter chamado /items/{id}/sale_price em paralelo");
    assert.ok(mlChamadas.every((c) => c.metodo === "GET"), "as duas chamadas continuam GET, nunca escrita");
    ok("fluxo completo: /sale_price roda em paralelo com /seller-promotions/items e decide qual promoção é ATIVA");
  });

  // 19b. Enriquecimento de vigência: promoção chega SEM start_date/finish_date
  //      do endpoint principal, mas tem id+type — busca em
  //      /seller-promotions/promotions/{id}?promotion_type={tipo} e preenche
  //      inicio/fim com o que essa segunda chamada devolver.
  await withMockDb({ anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    mlHandler = (chamada) => {
      if (/\/sale_price/.test(chamada.path)) return { ok: true, status: 200, data: {} };
      if (/seller-promotions\/promotions\//.test(chamada.path)) {
        assert.ok(/\/seller-promotions\/promotions\/P-9/.test(chamada.path), "precisa consultar pelo promotion_id certo");
        assert.ok(/promotion_type=SMART/.test(chamada.path), "precisa mandar promotion_type na consulta de detalhe");
        return {
          ok: true, status: 200,
          data: { id: "P-9", type: "SMART", status: "started", start_date: "2026-04-22T01:00:00Z", finish_date: "2026-05-22T01:00:00Z" },
        };
      }
      return {
        ok: true, status: 200,
        data: [{ id: "P-9", type: "SMART", status: "started", price: 80, original_price: 100 }],
      };
    };

    const res = fakeRes();
    await ctrl.promocoes({ params: { itemId: "MLB-X" }, query: { clienteSlug: "cliente-a" } }, res);

    const linha = res.corpo.promocoes[0];
    assert.strictEqual(linha.inicio, "2026-04-22T01:00:00Z", "vigência enriquecida via /seller-promotions/promotions/{id}");
    assert.strictEqual(linha.fim, "2026-05-22T01:00:00Z");
    assert.ok(
      mlChamadas.some((c) => /seller-promotions\/promotions\/P-9/.test(c.path)),
      "precisa ter chamado o detalhe da campanha para a promoção sem data"
    );
    ok("enriquecimento de vigência: promoção SMART sem data no endpoint principal recebe inicio/fim do detalhe da campanha");
  });

  // 19c. Enriquecimento falha (ok:false ou exceção) — não derruba a
  //      listagem; a promoção continua com inicio/fim null, nunca inventado.
  await withMockDb({ anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    mlHandler = (chamada) => {
      if (/\/sale_price/.test(chamada.path)) return { ok: true, status: 200, data: {} };
      if (/seller-promotions\/promotions\//.test(chamada.path)) {
        return { ok: false, status: 500, data: { message: "erro" } };
      }
      return {
        ok: true, status: 200,
        data: [{ id: "P-9", type: "SMART", status: "started", price: 80, original_price: 100 }],
      };
    };

    const res = fakeRes();
    await ctrl.promocoes({ params: { itemId: "MLB-X" }, query: { clienteSlug: "cliente-a" } }, res);

    assert.strictEqual(res.corpo.ok, true, "falha no enriquecimento não pode derrubar a listagem inteira");
    const linha = res.corpo.promocoes[0];
    assert.strictEqual(linha.inicio, null, "sem detalhe disponível, inicio continua null (nunca inventado)");
    assert.strictEqual(linha.fim, null, "sem detalhe disponível, fim continua null (nunca inventado)");
    ok("enriquecimento de vigência: falha (ok:false) do detalhe da campanha não derruba a listagem, inicio/fim seguem null");
  });

  // 19d. Enriquecimento lança exceção (ex.: erro de rede) — mesma garantia
  //      de resiliência, via try/catch.
  await withMockDb({ anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    mlHandler = (chamada) => {
      if (/\/sale_price/.test(chamada.path)) return { ok: true, status: 200, data: {} };
      if (/seller-promotions\/promotions\//.test(chamada.path)) throw new Error("timeout");
      return {
        ok: true, status: 200,
        data: [{ id: "P-9", type: "SMART", status: "started", price: 80, original_price: 100 }],
      };
    };

    const res = fakeRes();
    await ctrl.promocoes({ params: { itemId: "MLB-X" }, query: { clienteSlug: "cliente-a" } }, res);

    assert.strictEqual(res.corpo.ok, true, "exceção no enriquecimento não pode derrubar a listagem inteira");
    assert.strictEqual(res.corpo.promocoes[0].inicio, null);
    ok("enriquecimento de vigência: exceção de rede no detalhe da campanha não derruba a listagem");
  });

  // 19e. Promoção que já veio com start_date/finish_date do endpoint
  //      principal NÃO dispara a chamada extra de enriquecimento.
  await withMockDb({ anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    mlHandler = (chamada) => {
      if (/\/sale_price/.test(chamada.path)) return { ok: true, status: 200, data: {} };
      return {
        ok: true, status: 200,
        data: [{
          id: "P-9", type: "DEAL", status: "started", price: 80, original_price: 100,
          start_date: "2026-01-01T00:00:00Z", finish_date: "2026-01-31T23:59:59Z",
        }],
      };
    };

    const res = fakeRes();
    await ctrl.promocoes({ params: { itemId: "MLB-X" }, query: { clienteSlug: "cliente-a" } }, res);

    assert.strictEqual(res.corpo.promocoes[0].inicio, "2026-01-01T00:00:00Z");
    assert.strictEqual(res.corpo.promocoes[0].fim, "2026-01-31T23:59:59Z");
    assert.ok(
      !mlChamadas.some((c) => /seller-promotions\/promotions\//.test(c.path)),
      "promoção que já tem data não pode disparar a chamada extra de enriquecimento"
    );
    ok("enriquecimento de vigência: promoção que já tem start_date/finish_date não faz chamada extra");
  });

  // 19f. Sem promotion_id (id ausente) ou sem type: nunca tenta enriquecer
  //      (não há como montar a consulta de detalhe da campanha).
  await withMockDb({ anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    mlHandler = (chamada) => {
      if (/\/sale_price/.test(chamada.path)) return { ok: true, status: 200, data: {} };
      return {
        ok: true, status: 200,
        data: [{ type: "PRICE_DISCOUNT", status: "candidate", price: 0, original_price: 100, suggested_discounted_price: 90 }],
      };
    };

    const res = fakeRes();
    await ctrl.promocoes({ params: { itemId: "MLB-X" }, query: { clienteSlug: "cliente-a" } }, res);

    assert.strictEqual(res.corpo.promocoes[0].inicio, null);
    assert.ok(
      !mlChamadas.some((c) => /seller-promotions\/promotions\//.test(c.path)),
      "sem id de promoção não há como montar a consulta de detalhe — não deve nem tentar"
    );
    ok("enriquecimento de vigência: promoção sem id não dispara tentativa de enriquecimento");
  });

  // 19h. Promoção sem `id` (campanha) mas com `ref_id` (oferta/candidato):
  //      fallback defensivo usa ref_id como promotion_id — nenhum caso
  //      documentado do ML faz isso sozinho (ref_id sempre vem junto de id
  //      nos exemplos oficiais), mas o fallback é seguro: se o ref_id não
  //      servir como promotion_id, o ML só devolve erro/ok:false, que já é
  //      tratado sem quebrar a listagem.
  await withMockDb({ anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    mlHandler = (chamada) => {
      if (/\/sale_price/.test(chamada.path)) return { ok: true, status: 200, data: {} };
      if (/seller-promotions\/promotions\//.test(chamada.path)) {
        assert.ok(/\/seller-promotions\/promotions\/OFFER-MLB1-999/.test(chamada.path), "precisa usar o ref_id quando não há id");
        return { ok: true, status: 200, data: { start_date: "2026-02-01T00:00:00Z", finish_date: "2026-02-10T00:00:00Z" } };
      }
      return {
        ok: true, status: 200,
        data: [{ ref_id: "OFFER-MLB1-999", type: "SMART", status: "started", price: 80, original_price: 100 }],
      };
    };

    const res = fakeRes();
    await ctrl.promocoes({ params: { itemId: "MLB-X" }, query: { clienteSlug: "cliente-a" } }, res);

    assert.strictEqual(res.corpo.promocoes[0].inicio, "2026-02-01T00:00:00Z", "fallback por ref_id preenche a vigência quando não há id");
    assert.strictEqual(res.corpo.promocoes[0].fim, "2026-02-10T00:00:00Z");
    ok("enriquecimento de vigência: sem id, cai para ref_id como promotion_id (fallback defensivo)");
  });

  // 19i. Deduplicação: duas promoções diferentes (mesmo id+type) sem data —
  //      só UMA chamada a /seller-promotions/promotions/{id}, e as DUAS
  //      recebem a mesma vigência. Nunca cache persistente — só dentro
  //      desta execução de listarPromocoesDoItem.
  await withMockDb({ anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    let chamadasDetalhe = 0;
    mlHandler = (chamada) => {
      if (/\/sale_price/.test(chamada.path)) return { ok: true, status: 200, data: {} };
      if (/seller-promotions\/promotions\//.test(chamada.path)) {
        chamadasDetalhe += 1;
        return { ok: true, status: 200, data: { start_date: "2026-03-01T00:00:00Z", finish_date: "2026-03-10T00:00:00Z" } };
      }
      return {
        ok: true, status: 200,
        data: [
          { id: "P-9", type: "SMART", status: "started", price: 80, original_price: 100 },
          { id: "P-9", type: "SMART", status: "pending", price: 82, original_price: 100 },
        ],
      };
    };

    const res = fakeRes();
    await ctrl.promocoes({ params: { itemId: "MLB-X" }, query: { clienteSlug: "cliente-a" } }, res);

    assert.strictEqual(chamadasDetalhe, 1, "mesmo id+type entre duas promoções deve gerar só UMA chamada de detalhe");
    assert.ok(res.corpo.promocoes.every((p) => p.inicio === "2026-03-01T00:00:00Z"), "as duas promoções recebem a mesma vigência deduplicada");
    ok("enriquecimento de vigência: duas promoções com o mesmo id+type deduplicam em uma única chamada ao detalhe da campanha");
  });

  // 19g. Diagnóstico temporário de subsídio — log só roda com os DOIS
  //      gates explicitamente ligados (NODE_ENV=test E VENFORCE_PROMO_DEBUG=1);
  //      nunca por conta própria, nunca em produção.
  {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalDebugFlag = process.env.VENFORCE_PROMO_DEBUG;
    const originalConsoleLog = console.log;
    let logs = [];
    console.log = (...args) => { logs.push(args); };
    try {
      // Nenhum dos dois gates ligado: não loga.
      delete process.env.NODE_ENV;
      delete process.env.VENFORCE_PROMO_DEBUG;
      logs = [];
      promocoesService.normalizarPromocao({ type: "SMART", status: "started", meli_percentage: 3 }, 0);
      assert.strictEqual(logs.length, 0, "sem nenhum gate ligado, não deve logar nada");

      // Só NODE_ENV=test, sem a flag: ainda não loga (evita ruído em toda a suíte).
      process.env.NODE_ENV = "test";
      delete process.env.VENFORCE_PROMO_DEBUG;
      logs = [];
      promocoesService.normalizarPromocao({ type: "SMART", status: "started", meli_percentage: 3 }, 0);
      assert.strictEqual(logs.length, 0, "NODE_ENV=test sozinho não deve logar — precisa também da flag explícita");

      // Os dois gates ligados: loga os campos de diagnóstico.
      process.env.NODE_ENV = "test";
      process.env.VENFORCE_PROMO_DEBUG = "1";
      logs = [];
      promocoesService.normalizarPromocao(
        { type: "SMART", status: "started", boosted_offer: false, meli_percentage: 3, seller_percentage: 8 }, 0
      );
      assert.strictEqual(logs.length, 1, "com os dois gates ligados, deve logar exatamente uma linha por promoção normalizada");
      const payload = JSON.parse(logs[0][1]);
      assert.strictEqual(payload.type, "SMART");
      assert.strictEqual(payload.status, "started");
      assert.strictEqual(payload.boosted_offer, false);
      assert.strictEqual(payload.discount_meli_boost_amount, undefined);
      assert.strictEqual(payload.meli_percentage, 3);
      assert.strictEqual(payload.seller_percentage, 8);
    } finally {
      console.log = originalConsoleLog;
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
      if (originalDebugFlag === undefined) delete process.env.VENFORCE_PROMO_DEBUG; else process.env.VENFORCE_PROMO_DEBUG = originalDebugFlag;
    }
  }
  ok("diagnóstico temporário de subsídio: só loga type/status/boosted_offer/discount_meli_boost_amount/meli_percentage/seller_percentage com os dois gates (NODE_ENV=test + VENFORCE_PROMO_DEBUG=1) ligados");

  // 19. Fallback: sale_price sem metadata/promotion_id — nenhuma promoção
  //     vira ATIVA, mesmo com duas started (nunca inferir pelo menor preço).
  await withMockDb({ anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    mlHandler = (chamada) => {
      if (/\/sale_price/.test(chamada.path)) return { ok: true, status: 200, data: {} };
      return {
        ok: true, status: 200,
        data: [
          { id: "P-2", type: "DEAL", status: "started", price: 82, original_price: 100 },
          { id: "P-3", type: "PRE_NEGOTIATED", status: "started", price: 80, original_price: 100 },
        ],
      };
    };

    const res = fakeRes();
    await ctrl.promocoes({ params: { itemId: "MLB-X" }, query: { clienteSlug: "cliente-a" } }, res);

    assert.ok(
      res.corpo.promocoes.every((p) => p.statusExibicao !== "ATIVA"),
      "sem metadata.promotion_id, nenhuma promoção started pode virar ATIVA"
    );
    ok("fallback: sale_price sem metadata.promotion_id — nenhuma promoção vira ATIVA, mesmo com duas started");
  });
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
