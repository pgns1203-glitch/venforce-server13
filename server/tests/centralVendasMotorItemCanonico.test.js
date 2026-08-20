// M5 — Motor financeiro canônico por item.
//
// Este arquivo NÃO reescreve buildMotorFromOrders/allocateFrete: a auditoria
// do M5 confirmou que o motor já satisfaz os invariantes exigidos (item
// independente, frete real de senders[].cost rateado sem perda de centavos,
// pedido derivado por acumulação literal dos itens, resumo derivado por
// agregação literal dos pedidos). Este teste prova esses invariantes com
// números concretos — inclusive um cenário de regressão explícito para
// contaminação pelo primeiro item, que nenhum teste existente cobria (os
// testes anteriores de motor/frete usavam sempre pedidos de 1 item só).

const assert = require("assert");
const {
  buildMotorFromOrders,
  buildCostMap,
} = require("../services/centralVendas/centralVendasSyncService");
const { pedidoEntraNoResultado } = require("../services/centralVendas/centralVendasService");
const { round2 } = require("../utils/numberUtils");

function fakeItem({ mlb, sku = null, qty, price, saleFee }) {
  return {
    item: { id: mlb, seller_sku: sku, title: mlb },
    quantity: qty,
    unit_price: price,
    sale_fee: saleFee,
  };
}

function fakeOrder({ id, shipmentId = null, status = "paid", items }) {
  return {
    id,
    pack_id: null,
    date_created: "2026-07-10T10:00:00.000-03:00",
    status,
    shipping: shipmentId ? { id: shipmentId, logistic_type: "cross_docking" } : {},
    order_items: items,
  };
}

function itemComponent(motor, pedidoId, itemId, tipo) {
  return motor.componentes.find((c) => c.pedidoId === pedidoId && c.itemId === itemId && c.tipo === tipo);
}

function run() {
  // ── Caso 1 — pedido simples: 1 pedido, 1 item ─────────────────────────
  {
    const costMap = buildCostMap([{ produto_id: "MLB1111111111", custo_produto: 40, imposto_percentual: 5 }]);
    const order = fakeOrder({
      id: "P1",
      shipmentId: "S1",
      items: [fakeItem({ mlb: "MLB1111111111", sku: "SKU1", qty: 2, price: 50, saleFee: 8 })],
    });
    const freteMap = new Map([["S1", { valor: 10, status: "real", motivo: null }]]);

    const motor = buildMotorFromOrders({
      orders: [order], costMap, freteMap, clienteSlug: "cliente-teste", competencia: "2026-07",
    });

    const item = motor.itens[0];
    assert.strictEqual(item.receitaProduto, 100, "receita = 50 * 2");
    assert.strictEqual(item.custoProduto, 80, "custo = 40 * 2");
    assert.strictEqual(item.impostoInterno, 5, "imposto = 100 * 5%");
    assert.strictEqual(itemComponent(motor, "P1", item.itemId, "tarifa_venda").valor, -16, "tarifa = 8 * 2, negada");
    assert.strictEqual(itemComponent(motor, "P1", item.itemId, "frete_seller").valor, -10, "frete real negado");
    assert.strictEqual(item.resultado, round2(100 - 16 - 80 - 5 - 10), "resultado_item = receita - tarifa - custo - imposto - frete");
    assert.strictEqual(item.resultado, -11);

    const pedido = motor.pedidos[0];
    assert.strictEqual(pedido.faturamento, 100);
    assert.strictEqual(pedido.resultado, -11);
    assert.strictEqual(pedido.confianca, "confiavel");
    console.log("  ✓ caso 1: pedido simples — receita/tarifa/custo/imposto/frete/resultado corretos");
  }

  // ── Caso 2 — multi-item heterogêneo: A e B usam SUAS PRÓPRIAS informações ──
  // Também prova o Caso 4 (frete real ratado sem perda) e o Caso 7 (pedido = soma dos itens).
  let motor2, itemA, itemB, pedido2;
  {
    const costMap = buildCostMap([
      { produto_id: "MLB2222222221", custo_produto: 40, imposto_percentual: 5 },
      { produto_id: "MLB2222222222", custo_produto: 15, imposto_percentual: 2 },
    ]);
    const order = fakeOrder({
      id: "P2",
      shipmentId: "S2",
      items: [
        fakeItem({ mlb: "MLB2222222221", sku: "SKUA", qty: 1, price: 100, saleFee: 10 }),
        fakeItem({ mlb: "MLB2222222222", sku: "SKUB", qty: 3, price: 50, saleFee: 5 }),
      ],
    });
    const freteMap = new Map([["S2", { valor: 20, status: "real", motivo: null }]]);

    motor2 = buildMotorFromOrders({ orders: [order], costMap, freteMap, clienteSlug: "cliente-teste", competencia: "2026-07" });
    itemA = motor2.itens.find((i) => i.mlb === "MLB2222222221");
    itemB = motor2.itens.find((i) => i.mlb === "MLB2222222222");
    pedido2 = motor2.pedidos[0];

    // Item A usa exclusivamente seus próprios dados.
    assert.strictEqual(itemA.receitaProduto, 100);
    assert.strictEqual(itemA.custoProduto, 40, "custo A = 40 * 1, nunca o de B");
    assert.strictEqual(itemA.impostoInterno, 5, "imposto A = 100 * 5%, nunca o de B (2%)");

    // Item B usa exclusivamente seus próprios dados.
    assert.strictEqual(itemB.receitaProduto, 150, "receita B = 50 * 3");
    assert.strictEqual(itemB.custoProduto, 45, "custo B = 15 * 3, nunca o de A (40)");
    assert.strictEqual(itemB.impostoInterno, 3, "imposto B = 150 * 2%, nunca o de A (5%)");

    // Frete real (20) ratado por unidade entre A (1 un) e B (3 un), sem perda de centavo.
    const freteA = itemComponent(motor2, "P2", itemA.itemId, "frete_seller").valor;
    const freteB = itemComponent(motor2, "P2", itemB.itemId, "frete_seller").valor;
    assert.strictEqual(freteA, -5, "frete A = round2(20/4 * 1)");
    assert.strictEqual(freteB, -15, "frete B = resto (20 - 5), item B leva o resto por ser o último");
    assert.strictEqual(round2(Math.abs(freteA) + Math.abs(freteB)), 20, "soma(frete_item) === frete real do pedido");

    assert.strictEqual(itemA.resultado, 40, "100 - 10 - 40 - 5 - 5");
    assert.strictEqual(itemB.resultado, 72, "150 - 15 - 45 - 3 - 15");

    // Caso 7 — pedido = soma dos itens (quando todos calculáveis).
    assert.strictEqual(pedido2.resultado, round2(itemA.resultado + itemB.resultado));
    assert.strictEqual(pedido2.resultado, 112);
    assert.strictEqual(pedido2.faturamento, round2(itemA.receitaProduto + itemB.receitaProduto));
    assert.strictEqual(pedido2.faturamento, 250);
    console.log("  ✓ caso 2: A e B usam dados próprios (custo/imposto/tarifa nunca cruzam)");
    console.log("  ✓ caso 4: frete real (20) ratado sem perda — soma(frete_item) === frete_pedido");
    console.log("  ✓ caso 7: resultado_pedido === Σ resultado_item");
  }

  // ── Caso 3 — regressão explícita de contaminação pelo primeiro item ──────
  // Números extremos: se o bug existisse (item B herdando dados de A), a
  // diferença apareceria em ordens de grandeza, não em centavos.
  {
    const costMap = buildCostMap([
      { produto_id: "MLB3333333331", custo_produto: 1000, imposto_percentual: 50 },
      { produto_id: "MLB3333333332", custo_produto: 1, imposto_percentual: 0.01 },
    ]);
    const order = fakeOrder({
      id: "P3",
      items: [
        fakeItem({ mlb: "MLB3333333331", qty: 1, price: 2000, saleFee: 100 }),
        fakeItem({ mlb: "MLB3333333332", qty: 5, price: 20, saleFee: 2 }),
      ],
    });

    const motor = buildMotorFromOrders({ orders: [order], costMap, freteMap: new Map(), clienteSlug: "cliente-teste", competencia: "2026-07" });
    const itemX = motor.itens.find((i) => i.mlb === "MLB3333333331");
    const itemY = motor.itens.find((i) => i.mlb === "MLB3333333332");

    assert.strictEqual(itemX.custoProduto, 1000, "X usa seu próprio custo (1000), listado PRIMEIRO no pedido");
    assert.strictEqual(itemX.impostoInterno, 1000, "X: 2000 * 50%");

    // Se B contaminasse com o custo/imposto do primeiro item (X), estes
    // valores seriam 5*1000=5000 e 100*0.5=50 em vez dos corretos abaixo.
    assert.strictEqual(itemY.custoProduto, 5, "Y usa seu próprio custo (1 * 5 un), NUNCA o de X (1000)");
    assert.strictEqual(itemY.impostoInterno, 1, "Y: 100 * 1%, NUNCA o imposto de X (50%)");
    assert.notStrictEqual(itemY.custoProduto, itemX.custoProduto);
    console.log("  ✓ caso 3: regressão de contaminação — item listado depois nunca herda custo/imposto do primeiro");
  }

  // ── Caso 5 — um item sem custo: bloqueio não vaza para o outro item ──────
  {
    const costMap = buildCostMap([{ produto_id: "MLB4444444441", custo_produto: 40, imposto_percentual: 5 }]);
    const order = fakeOrder({
      id: "P5",
      shipmentId: "S5",
      items: [
        fakeItem({ mlb: "MLB4444444441", qty: 1, price: 100, saleFee: 10 }),
        fakeItem({ mlb: "MLB4444444442", qty: 2, price: 30, saleFee: 3 }),
      ],
    });
    const freteMap = new Map([["S5", { valor: 12, status: "real", motivo: null }]]);

    const motor = buildMotorFromOrders({ orders: [order], costMap, freteMap, clienteSlug: "cliente-teste", competencia: "2026-07" });
    const itemOk = motor.itens.find((i) => i.mlb === "MLB4444444441");
    const itemSem = motor.itens.find((i) => i.mlb === "MLB4444444442");
    const pedido = motor.pedidos[0];

    assert.strictEqual(itemOk.confianca, "confiavel");
    assert.strictEqual(itemOk.custoProduto, 40);
    assert.notStrictEqual(itemOk.resultado, null, "item OK mantém seu próprio resultado calculado");

    assert.strictEqual(itemSem.confianca, "bloqueado");
    assert.strictEqual(itemSem.custoProduto, null, "custo ausente nunca vira 0 nem herda o de outro item");
    assert.ok(itemSem.pendencias.includes("custo_produto_ausente"));
    assert.strictEqual(itemSem.resultado, null);

    // Política atual (all-or-nothing no agregado do pedido): 1 item bloqueado
    // basta para bloquear o RESULTADO DO PEDIDO — mas isso não reescreve o
    // resultado já calculado do item OK acima, que continua auditável.
    assert.strictEqual(pedido.confianca, "bloqueado");
    assert.strictEqual(pedido.resultado, null, "pedido bloqueado não soma parcialmente — nunca inventa resultado");
    console.log("  ✓ caso 5: item sem custo bloqueia só a si mesmo no nível item; pedido segue a política atual (all-or-nothing)");
  }

  // ── Caso 6 — frete ausente multi-item: null continua null para os dois ──
  {
    const costMap = buildCostMap([
      { produto_id: "MLB5555555551", custo_produto: 10, imposto_percentual: 5 },
      { produto_id: "MLB5555555552", custo_produto: 20, imposto_percentual: 5 },
    ]);
    const order = fakeOrder({
      id: "P6",
      shipmentId: "S6",
      items: [
        fakeItem({ mlb: "MLB5555555551", qty: 1, price: 50, saleFee: 5 }),
        fakeItem({ mlb: "MLB5555555552", qty: 2, price: 60, saleFee: 6 }),
      ],
    });
    // S6 propositalmente ausente do freteMap — shipment consultado mas sem custo do seller.
    const motor = buildMotorFromOrders({ orders: [order], costMap, freteMap: new Map(), clienteSlug: "cliente-teste", competencia: "2026-07" });
    const itemC = motor.itens.find((i) => i.mlb === "MLB5555555551");
    const itemD = motor.itens.find((i) => i.mlb === "MLB5555555552");

    assert.strictEqual(itemComponent(motor, "P6", itemC.itemId, "frete_seller").valor, null);
    assert.strictEqual(itemComponent(motor, "P6", itemD.itemId, "frete_seller").valor, null);
    assert.strictEqual(itemC.confianca, "parcial", "custo/imposto/tarifa presentes, só frete ausente");
    assert.strictEqual(itemD.confianca, "parcial");
    assert.ok(itemC.pendencias.includes("frete_seller_ausente"));
    assert.ok(itemD.pendencias.includes("frete_seller_ausente"));
    console.log("  ✓ caso 6: frete ausente permanece null nos dois itens — confiança nunca vira confiável por adivinhação");
  }

  // ── Caso 8 — resumo = soma dos pedidos válidos ────────────────────────
  {
    const costMap = buildCostMap([
      { produto_id: "MLB6666666661", custo_produto: 10, imposto_percentual: 5 },
      { produto_id: "MLB6666666662", custo_produto: 20, imposto_percentual: 5 },
    ]);
    const orders = [
      fakeOrder({ id: "O1", shipmentId: "SV1", items: [fakeItem({ mlb: "MLB6666666661", qty: 1, price: 100, saleFee: 10 })] }),
      fakeOrder({ id: "O2", shipmentId: "SV2", items: [fakeItem({ mlb: "MLB6666666662", qty: 1, price: 200, saleFee: 20 })] }),
      // Bloqueado: MLB sem custo na base — entra no resumo, mas não no lucroContribuicao.
      fakeOrder({ id: "O3", items: [fakeItem({ mlb: "MLB6666666669", qty: 1, price: 50, saleFee: 5 })] }),
      // Fora do resultado inteiramente (cancelado) — não conta em nenhum agregado.
      fakeOrder({ id: "O4", status: "cancelado", items: [fakeItem({ mlb: "MLB6666666661", qty: 1, price: 999, saleFee: 1 })] }),
    ];
    const freteMap = new Map([
      ["SV1", { valor: 5, status: "real", motivo: null }],
      ["SV2", { valor: 10, status: "real", motivo: null }],
    ]);

    const motor = buildMotorFromOrders({ orders, costMap, freteMap, clienteSlug: "cliente-teste", competencia: "2026-07" });

    const validos = motor.pedidos.filter(pedidoEntraNoResultado);
    assert.strictEqual(validos.length, 3, "O4 (cancelado) não entra no resultado");

    const somaResultado = round2(
      validos.filter((p) => p.resultado !== null).reduce((s, p) => s + p.resultado, 0)
    );
    assert.strictEqual(motor.resumo.lucroContribuicao, somaResultado, "resumo.lucroContribuicao === Σ resultado_pedido válido");

    const somaFaturamentoNaoBloqueado = round2(
      validos.filter((p) => p.confianca !== "bloqueado").reduce((s, p) => s + p.faturamento, 0)
    );
    assert.strictEqual(motor.resumo.faturamento, somaFaturamentoNaoBloqueado);

    // Valores concretos, não só auto-consistência.
    assert.strictEqual(motor.resumo.lucroContribuicao, 210, "O1 (70) + O2 (140); O3 bloqueado não soma");
    assert.strictEqual(motor.resumo.faturamento, 300, "O1 (100) + O2 (200); O3 (50) fica em receitaBloqueada");
    assert.strictEqual(motor.resumo.receitaBloqueada, 50);
    assert.strictEqual(motor.resumo.pedidosBloqueados, 1);
    assert.strictEqual(motor.resumo.pedidosConfiaveis, 2);
    assert.strictEqual(motor.resumo.pedidosTotal, 4);
    assert.strictEqual(motor.resumo.pedidosValidos, 3);
    console.log("  ✓ caso 8: resumo.lucroContribuicao/faturamento === soma dos pedidos válidos (cancelado e bloqueado tratados corretamente)");
  }

  console.log("centralVendasMotorItemCanonico.test.js passed");
}

run();
