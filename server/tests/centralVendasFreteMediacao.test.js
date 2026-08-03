const assert = require("assert");
const {
  extrairFreteSeller,
  createCentralVendasFreteService,
} = require("../services/centralVendas/centralVendasFreteService");
const { buildPayloadFromRange } = require("../services/centralVendas/centralVendasService");
const {
  reconciliar,
  totaisOperacionais,
} = require("../services/cliente360/cliente360FechamentoAdapter");
const {
  agregarProdutos,
  pedidoEntraNoResultado,
} = require("../services/cliente360/cliente360PonteEngine");
const { coberturaPeriodo } = require("../services/cliente360/cliente360ConfiancaEngine");

const SELLER_ID = 81387353;

async function run() {
  // 1. Payload oficial: usa o custo final do seller, nunca o gross_amount.
  const exemploDoc = {
    gross_amount: 24.55,
    receiver: { user_id: 74425755, cost: 0, compensation: 0, save: 0 },
    senders: [{
      user_id: SELLER_ID,
      cost: 8.19,
      compensation: 3,
      save: 2,
      discounts: [{ rate: 0.6, type: "mandatory", promoted_amount: 12.29 }],
    }],
  };
  assert.strictEqual(extrairFreteSeller(exemploDoc, SELLER_ID), 8.19);

  // 2. Mais de um seller: casa estritamente por user_id.
  assert.strictEqual(
    extrairFreteSeller({
      gross_amount: 80,
      senders: [
        { user_id: 111, cost: 50 },
        { user_id: SELLER_ID, cost: 7.35 },
      ],
    }, SELLER_ID),
    7.35
  );

  // 3. Sem sender correspondente: ausência honesta, sem fallback inflado.
  let aviso = "";
  const warnOriginal = console.warn;
  console.warn = (msg) => { aviso = String(msg); };
  try {
    assert.strictEqual(
      extrairFreteSeller({
        gross_amount: 99,
        base_cost: 99,
        senders: [{ user_id: 999, cost: 1 }],
      }, SELLER_ID),
      null
    );
  } finally {
    console.warn = warnOriginal;
  }
  assert.match(aviso, /sem sender correspondente/);

  // 4. Zero continua sendo um custo real.
  assert.strictEqual(
    extrairFreteSeller({ gross_amount: 20, senders: [{ user_id: SELLER_ID, cost: 0 }] }, SELLER_ID),
    0
  );

  // A consulta usa /costs e propaga sellerId até a extração.
  let caminhoChamado = null;
  const service = createCentralVendasFreteService({
    sleepFn: async () => {},
    mlFetchFn: async (_clienteId, path) => {
      caminhoChamado = path;
      return { ok: true, status: 200, data: exemploDoc };
    },
  });
  const frete = await service.buscarFreteShipment({
    clienteId: 1,
    sellerId: SELLER_ID,
    shipmentId: "SHIP-1",
  });
  assert.strictEqual(caminhoChamado, "/shipments/SHIP-1/costs");
  assert.deepStrictEqual(
    { valor: frete.valor, status: frete.status, motivo: frete.motivo },
    { valor: 8.19, status: "real", motivo: null }
  );

  // 5. Mediação permanece visível no payload, mas sai de todos os totais.
  const snapshot = {
    importacao: {
      id: 10,
      fonte: "orders_api",
      created_at: "2026-07-31T12:00:00.000Z",
      resumo_json: {
        faturamento: 600,
        lucroContribuicao: 240,
        margemContribuicaoPercentual: 40,
      },
    },
    pedidos: [
      {
        id: 1,
        pedido_id: "PAGO",
        data_pedido: "2026-07-10",
        status: "paid",
        faturamento: 100,
        quantidade_itens: 1,
        resultado: 40,
        confianca: "confiavel",
        pendencias_json: [],
      },
      {
        id: 2,
        pedido_id: "MEDIACAO",
        data_pedido: "2026-07-11",
        status: "mediation",
        faturamento: 500,
        quantidade_itens: 5,
        resultado: 200,
        confianca: "confiavel",
        pendencias_json: [],
      },
    ],
    itens: [
      {
        pedido_row_id: 1,
        pedido_id: "PAGO",
        item_id: "PAGO:MLB1:0",
        mlb: "MLB1",
        titulo: "Venda válida",
        quantidade: 1,
        receita_produto: 100,
        custo_produto: 40,
        imposto_interno: 5,
      },
      {
        pedido_row_id: 2,
        pedido_id: "MEDIACAO",
        item_id: "MEDIACAO:MLB2:0",
        mlb: "MLB2",
        titulo: "Venda em mediação",
        quantidade: 5,
        receita_produto: 500,
        custo_produto: 200,
        imposto_interno: 25,
      },
    ],
    componentes: [
      { pedido_row_id: 1, pedido_id: "PAGO", tipo: "receita_produto", valor: 100 },
      { pedido_row_id: 1, pedido_id: "PAGO", tipo: "tarifa_venda", valor: -10 },
      { pedido_row_id: 1, pedido_id: "PAGO", tipo: "frete_seller", valor: -5 },
      { pedido_row_id: 1, pedido_id: "PAGO", tipo: "custo_produto", valor: -40 },
      { pedido_row_id: 1, pedido_id: "PAGO", tipo: "imposto_interno", valor: -5 },
      { pedido_row_id: 2, pedido_id: "MEDIACAO", tipo: "receita_produto", valor: 500 },
      { pedido_row_id: 2, pedido_id: "MEDIACAO", tipo: "tarifa_venda", valor: -50 },
      { pedido_row_id: 2, pedido_id: "MEDIACAO", tipo: "frete_seller", valor: -25 },
      { pedido_row_id: 2, pedido_id: "MEDIACAO", tipo: "custo_produto", valor: -200 },
      { pedido_row_id: 2, pedido_id: "MEDIACAO", tipo: "imposto_interno", valor: -25 },
    ],
  };

  const payload = buildPayloadFromRange(
    { id: 1, slug: "cliente-teste", nome: "Cliente Teste" },
    { dateFrom: "2026-07-01", dateTo: "2026-07-31" },
    snapshot
  );
  const mediacao = payload.pedidos.find((pedido) => pedido.id === "MEDIACAO");

  assert.strictEqual(payload.pedidos.length, 2, "mediação deve continuar visível");
  assert.strictEqual(mediacao.status, "com_problema");
  assert.strictEqual(mediacao.entraNoResultado, false);
  assert.strictEqual(payload.resumo.pedidosTotal, 2);
  assert.strictEqual(payload.resumo.pedidosValidos, 1);
  assert.strictEqual(payload.resumo.pedidosForaResultado, 1);
  assert.strictEqual(payload.resumo.faturamento, 100);
  assert.strictEqual(payload.resumo.lucroContribuicao, 40);
  assert.strictEqual(payload.resumo.totaisPorTipo.receita_produto, 100);

  const totais = totaisOperacionais(payload.pedidos);
  assert.strictEqual(totais.pedidos, 2);
  assert.strictEqual(totais.pedidosPagos, 1);
  assert.strictEqual(totais.comProblema, 1);
  assert.strictEqual(totais.faturamentoFechamento, 100);

  const reconciliacao = reconciliar(payload.pedidos);
  assert.strictEqual(reconciliacao.faturamentoFechamento, 100);
  assert.strictEqual(reconciliacao.faturamentoDetalhe, 100);

  assert.strictEqual(pedidoEntraNoResultado(mediacao), false);
  const produtos = agregarProdutos(payload.pedidos);
  assert.strictEqual(produtos.has("MLB1"), true);
  assert.strictEqual(produtos.has("MLB2"), false);

  const cobertura = coberturaPeriodo(payload.pedidos);
  assert.strictEqual(cobertura.faturamento, 100);
  assert.strictEqual(cobertura.coberturaResultado, 1);

  console.log("centralVendasFreteMediacao.test.js passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
