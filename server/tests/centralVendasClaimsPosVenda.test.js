const assert = require("assert");
const {
  buildClaimsMap,
  classificarClaim,
  createCentralVendasClaimsService,
} = require("../services/centralVendas/centralVendasClaimsService");
const {
  buildCostMap,
  buildMotorFromOrders,
} = require("../services/centralVendas/centralVendasSyncService");
const { buildPayloadFromRange } = require("../services/centralVendas/centralVendasService");

function order(id) {
  return {
    id,
    date_created: "2026-07-10T10:00:00.000-03:00",
    status: "paid",
    tags: ["paid", "delivered"],
    shipping: { id: `SHIP-${id}`, logistic_type: "cross_docking" },
    order_items: [{
      item: { id: "MLB111", title: "Produto", seller_sku: "SKU-1" },
      quantity: 1,
      unit_price: 100,
      sale_fee: 10,
    }],
  };
}

function snapshotFromMotor(motor, resumo = motor.resumo) {
  const rowIds = new Map(motor.pedidos.map((pedido, index) => [pedido.pedidoId, index + 1]));
  return {
    importacao: {
      id: 77,
      fonte: "orders_api",
      created_at: "2026-07-31T12:00:00.000Z",
      resumo_json: resumo,
    },
    pedidos: motor.pedidos.map((pedido) => ({
      id: rowIds.get(pedido.pedidoId),
      pedido_id: pedido.pedidoId,
      data_pedido: pedido.dataPedido,
      status: pedido.status,
      quantidade_itens: pedido.quantidadeItens,
      faturamento: pedido.faturamento,
      resultado: pedido.resultado,
      confianca: pedido.confianca,
      pendencias_json: pedido.pendencias,
      payload_json: pedido,
    })),
    itens: motor.itens.map((item) => ({
      ...item,
      pedido_row_id: rowIds.get(item.pedidoId),
      pedido_id: item.pedidoId,
      item_id: item.itemId,
      receita_produto: item.receitaProduto,
      custo_produto: item.custoProduto,
      imposto_interno: item.impostoInterno,
    })),
    componentes: motor.componentes.map((component) => ({
      ...component,
      pedido_row_id: rowIds.get(component.pedidoId),
      pedido_id: component.pedidoId,
      item_id: component.itemId,
    })),
  };
}

async function run() {
  const devolucao = {
    id: 501,
    resource: "order",
    resource_id: "DEVOLVIDO",
    status: "closed",
    type: "returns",
    stage: "claim",
    related_entities: ["return"],
    resolution: { reason: "item_returned", benefited: ["complainant"] },
  };
  const mediacao = {
    id: 502,
    resource: "order",
    resource_id: "MEDIACAO",
    status: "opened",
    type: "mediations",
    stage: "dispute",
    related_entities: [],
    resolution: null,
  };
  const favorVendedor = {
    id: 503,
    resource: "order",
    resource_id: "FAVOR_VENDEDOR",
    status: "closed",
    type: "mediations",
    stage: "dispute",
    related_entities: [],
    resolution: { reason: "coverage_decision", benefited: ["respondent"] },
  };
  const recursoErrado = {
    id: 504,
    resource: "shipment",
    resource_id: "SEM_CLAIM",
    status: "closed",
    type: "returns",
    related_entities: ["return"],
    resolution: { reason: "item_returned", benefited: ["complainant"] },
  };

  assert.deepStrictEqual(classificarClaim(devolucao), {
    status: "cancelado",
    tipo: "devolucao",
    motivo: "item_returned",
  });
  assert.deepStrictEqual(classificarClaim(mediacao), {
    status: "com_problema",
    tipo: "mediacao",
    motivo: "mediacao_em_aberto",
  });
  assert.strictEqual(classificarClaim(favorVendedor), null);

  // O cruzamento usa resource_id somente quando resource=order.
  const claimsMap = buildClaimsMap([devolucao, mediacao, favorVendedor, recursoErrado]);
  assert.strictEqual(claimsMap.size, 3);
  assert.strictEqual(claimsMap.has("DEVOLVIDO"), true);
  assert.strictEqual(claimsMap.has("SEM_CLAIM"), false);

  const orders = [order("DEVOLVIDO"), order("MEDIACAO"), order("FAVOR_VENDEDOR"), order("SEM_CLAIM")];
  const freteMap = new Map(orders.map((pedido) => [pedido.shipping.id, { valor: 5, status: "real" }]));
  const motor = buildMotorFromOrders({
    orders,
    costMap: buildCostMap([{ produto_id: "MLB111", custo_produto: 40, imposto_percentual: 5 }]),
    freteMap,
    claimsMap,
    claimsIndisponivel: false,
    clienteSlug: "cliente-teste",
    competencia: "2026-07",
  });

  // 1. Devolução efetivada sai dos agregados, mas continua visível.
  const pedidoDevolvido = motor.pedidos.find((pedido) => pedido.pedidoId === "DEVOLVIDO");
  assert.strictEqual(pedidoDevolvido.status, "cancelado");
  assert.strictEqual(pedidoDevolvido.posVendaTipo, "devolucao");
  assert.strictEqual(pedidoDevolvido.faturamento, 100);

  // 2. Mediação aberta usa o status existente e também sai do resultado.
  const pedidoMediacao = motor.pedidos.find((pedido) => pedido.pedidoId === "MEDIACAO");
  assert.strictEqual(pedidoMediacao.status, "com_problema");
  assert.strictEqual(pedidoMediacao.posVendaTipo, "mediacao");

  // 3. Claim encerrado a favor do vendedor, sem return/refund, permanece pago.
  assert.strictEqual(motor.pedidos.find((pedido) => pedido.pedidoId === "FAVOR_VENDEDOR").status, "paid");

  // 5. Pedido sem claim de order não é afetado. Os dois pedidos válidos formam
  // a base financeira; devolução e mediação permanecem na contagem total.
  assert.strictEqual(motor.pedidos.find((pedido) => pedido.pedidoId === "SEM_CLAIM").status, "paid");
  assert.strictEqual(motor.resumo.pedidosTotal, 4);
  assert.strictEqual(motor.resumo.pedidosValidos, 2);
  assert.strictEqual(motor.resumo.faturamento, 200);
  assert.strictEqual(motor.resumo.devolucoes, 1);
  assert.strictEqual(motor.resumo.mediacoes, 1);

  const payload = buildPayloadFromRange(
    { id: 1, slug: "cliente-teste", nome: "Cliente Teste" },
    { dateFrom: "2026-07-01", dateTo: "2026-07-31" },
    snapshotFromMotor(motor)
  );
  assert.strictEqual(payload.pedidos.length, 4);
  assert.strictEqual(payload.resumo.faturamento, 200);
  assert.strictEqual(payload.resumo.devolucoes, 1);
  assert.strictEqual(payload.resumo.mediacoes, 1);
  assert.strictEqual(payload.pedidos.find((pedido) => pedido.id === "DEVOLVIDO").entraNoResultado, false);
  assert.strictEqual(payload.pedidos.find((pedido) => pedido.id === "MEDIACAO").entraNoResultado, false);

  // Busca paginada: seller + período, sem chamada por pedido.
  const paths = [];
  const paginas = [devolucao, mediacao];
  const service = createCentralVendasClaimsService({
    sleepFn: async () => {},
    mlFetchFn: async (_clienteId, path) => {
      paths.push(path);
      const offset = Number(new URL(`https://api.test${path}`).searchParams.get("offset"));
      return {
        ok: true,
        status: 200,
        data: { paging: { total: 2, offset, limit: 1 }, data: [paginas[offset]] },
      };
    },
  });
  const lote = await service.buscarClaimsPorPeriodo({
    clienteId: 1,
    sellerId: 999,
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
    limit: 1,
  });
  assert.strictEqual(paths.length, 2);
  assert.match(paths[0], /players\.user_id=999/);
  assert.match(paths[0], /range=date_created/);
  assert.match(paths[1], /offset=1/);
  assert.strictEqual(lote.claimsMap.size, 2);
  assert.strictEqual(lote.indisponivel, false);

  // 4. Falha técnica: retries esgotados, mapa parcial descartado e confiança
  // explicitamente rebaixada no motor e no contrato retornado à tela.
  let calls = 0;
  const failingService = createCentralVendasClaimsService({
    sleepFn: async () => {},
    mlFetchFn: async () => {
      calls++;
      return { ok: false, status: 503, data: null };
    },
  });
  const falha = await failingService.buscarClaimsPorPeriodo({
    clienteId: 1,
    sellerId: 999,
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
  });
  assert.strictEqual(calls, 3);
  assert.strictEqual(falha.indisponivel, true);
  assert.strictEqual(falha.motivo, "http_503");
  assert.strictEqual(falha.claimsMap.size, 0);

  const motorSemClaims = buildMotorFromOrders({
    orders: [order("NAO_VERIFICADO")],
    costMap: buildCostMap([{ produto_id: "MLB111", custo_produto: 40, imposto_percentual: 5 }]),
    freteMap: new Map([["SHIP-NAO_VERIFICADO", { valor: 5, status: "real" }]]),
    claimsMap: falha.claimsMap,
    claimsIndisponivel: falha.indisponivel,
    claimsMotivo: falha.motivo,
    clienteSlug: "cliente-teste",
    competencia: "2026-07",
  });
  assert.strictEqual(motorSemClaims.resumo.claimsIndisponivel, true);
  assert.strictEqual(motorSemClaims.resumo.confianca, "parcial");

  const payloadSemClaims = buildPayloadFromRange(
    { id: 1, slug: "cliente-teste", nome: "Cliente Teste" },
    { dateFrom: "2026-07-01", dateTo: "2026-07-31" },
    snapshotFromMotor(motorSemClaims)
  );
  assert.strictEqual(payloadSemClaims.resumo.claimsIndisponivel, true);
  assert.strictEqual(payloadSemClaims.motor.confianca, "parcial");
  assert.strictEqual(payloadSemClaims.motor.podeConcluir, false);

  console.log("centralVendasClaimsPosVenda.test.js passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
