// Prova que buildMotorFromOrders (centralVendasSyncService) trata o frete
// real com a semantica correta: real -> componente real; ausente -> null
// (nunca 0 inventado); zero real (base_cost:0) continua real, nao vira
// ausente; pedido sem frete cai para "parcial"; pedido com tudo real fica
// "confiavel".

const assert = require("assert");
const {
  buildMotorFromOrders,
  buildCostMap,
} = require("../services/centralVendas/centralVendasSyncService");

const costMap = buildCostMap([
  { produto_id: "MLB111", custo_produto: 10, imposto_percentual: 5 },
]);

function fakeOrder({ id, shipmentId, saleFee = 2 }) {
  return {
    id,
    pack_id: null,
    date_created: "2026-07-10T10:00:00.000-03:00",
    status: "paid",
    shipping: { id: shipmentId, logistic_type: "cross_docking" },
    order_items: [
      {
        item: { id: "MLB111", seller_sku: "SKU1", title: "Produto" },
        quantity: 1,
        unit_price: 100,
        sale_fee: saleFee,
      },
    ],
  };
}

function componenteFrete(motor, pedidoId) {
  return motor.componentes.find((c) => c.pedidoId === pedidoId && c.tipo === "frete_seller");
}

function run() {
  const orders = [
    fakeOrder({ id: "P_REAL", shipmentId: "S1" }),   // frete real (10)
    fakeOrder({ id: "P_AUSENTE", shipmentId: "S2" }), // sem entrada no freteMap
    fakeOrder({ id: "P_ZERO", shipmentId: "S3" }),    // frete real igual a 0
  ];

  const freteMap = new Map([
    ["S1", { valor: 10, status: "real", motivo: null }],
    ["S3", { valor: 0, status: "real", motivo: null }],
    // S2 propositalmente ausente do mapa.
  ]);

  const motor = buildMotorFromOrders({
    orders,
    costMap,
    freteMap,
    clienteSlug: "cliente-teste",
    competencia: "2026-07",
  });

  // Frete real gera componente real, com o valor negativo (custo) esperado.
  {
    const c = componenteFrete(motor, "P_REAL");
    assert.strictEqual(c.valor, -10, "frete real de 10 deve virar -10 no componente");
    assert.strictEqual(c.fonte, "shipments_api");
    assert.strictEqual(c.confianca, "real");
    console.log("  ✓ frete real gera componente real (valor=-10, fonte=shipments_api)");
  }

  // Frete ausente gera componente com valor null, nunca 0.
  {
    const c = componenteFrete(motor, "P_AUSENTE");
    assert.strictEqual(c.valor, null, "frete ausente nao pode virar 0");
    assert.strictEqual(c.fonte, "ausente");
    assert.strictEqual(c.confianca, "ausente");
    console.log("  ✓ frete ausente gera componente null (nunca 0 inventado)");
  }

  // Zero real continua real — nao pode ser tratado como ausente.
  {
    const c = componenteFrete(motor, "P_ZERO");
    assert.notStrictEqual(c.valor, null, "zero real nao pode virar componente ausente");
    assert.strictEqual(Number(c.valor), 0, "zero real deve gerar componente com valor 0 (negado)");
    assert.strictEqual(c.fonte, "shipments_api");
    assert.strictEqual(c.confianca, "real");
    console.log("  ✓ zero real nao vira ausente");
  }

  // Pedido sem frete cai para parcial (nao bloqueado, mas nao confiavel).
  {
    const pedido = motor.pedidos.find((p) => p.pedidoId === "P_AUSENTE");
    assert.strictEqual(pedido.confianca, "parcial", "pedido sem frete deve ficar parcial");
    assert.ok(pedido.pendencias.includes("frete_seller_ausente"));
    console.log("  ✓ pedido sem frete fica parcial");
  }

  // Pedido com todos os componentes reais (incluindo frete) fica confiavel.
  {
    const pedido = motor.pedidos.find((p) => p.pedidoId === "P_REAL");
    assert.strictEqual(pedido.confianca, "confiavel", "pedido com tudo real deve ficar confiavel");
    assert.notStrictEqual(pedido.resultado, null, "pedido confiavel deve ter resultado calculado");
    console.log("  ✓ pedido com todos os componentes reais fica confiavel");
  }

  console.log("centralVendasMotorFrete.test.js passed");
}

run();
