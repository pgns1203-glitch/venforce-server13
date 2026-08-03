const assert = require("assert");
const {
  STATUS_FORA_DO_RESULTADO,
  buildPayloadFromRange,
  pedidoEntraNoResultado,
} = require("../services/centralVendas/centralVendasService");
const ponteEngine = require("../services/cliente360/cliente360PonteEngine");
const {
  reconciliar,
  totaisOperacionais,
} = require("../services/cliente360/cliente360FechamentoAdapter");

function pedidoRow({ rowId, pedidoId, status, faturamento, resultado }) {
  return {
    id: rowId,
    pedido_id: pedidoId,
    data_pedido: "2026-07-10",
    status,
    faturamento,
    quantidade_itens: 1,
    resultado,
    confianca: "confiavel",
    pendencias_json: [],
  };
}

function itemRow({ pedidoRowId, pedidoId, mlb, receita }) {
  return {
    pedido_row_id: pedidoRowId,
    pedido_id: pedidoId,
    item_id: `${pedidoId}:${mlb}:0`,
    mlb,
    titulo: mlb,
    quantidade: 1,
    receita_produto: receita,
    custo_produto: receita * 0.4,
    imposto_interno: receita * 0.05,
  };
}

const snapshot = {
  importacao: {
    id: 1,
    fonte: "orders_api",
    created_at: "2026-07-31T12:00:00.000Z",
    // Simula o resumo antigo/inflado persistido antes da correção.
    resumo_json: { faturamento: 150, lucroContribuicao: 60 },
  },
  pedidos: [
    pedidoRow({ rowId: 1, pedidoId: "PAGO", status: "paid", faturamento: 100, resultado: 40 }),
    pedidoRow({ rowId: 2, pedidoId: "MEDIACAO", status: "mediation", faturamento: 50, resultado: 20 }),
  ],
  itens: [
    itemRow({ pedidoRowId: 1, pedidoId: "PAGO", mlb: "MLB-PAGO", receita: 100 }),
    itemRow({ pedidoRowId: 2, pedidoId: "MEDIACAO", mlb: "MLB-MEDIACAO", receita: 50 }),
  ],
  componentes: [],
};

const payload = buildPayloadFromRange(
  { id: 1, slug: "cliente-teste", nome: "Cliente Teste" },
  { dateFrom: "2026-07-01", dateTo: "2026-07-31" },
  snapshot
);

// A fonte de verdade é única e a Cliente 360 reexporta o mesmo predicado.
assert.strictEqual(ponteEngine.pedidoEntraNoResultado, pedidoEntraNoResultado);
assert.deepStrictEqual([...STATUS_FORA_DO_RESULTADO].sort(), ["cancelado", "com_problema"]);
assert.strictEqual(pedidoEntraNoResultado({ status: "pago" }), true);
assert.strictEqual(pedidoEntraNoResultado({ status: "cancelado" }), false);
assert.strictEqual(pedidoEntraNoResultado({ status: "com_problema" }), false);

// R$ 50 em mediação não contaminam faturamento, lucro ou margem.
assert.strictEqual(payload.resumo.faturamento, 100);
assert.strictEqual(payload.resumo.lucroContribuicao, 40);
assert.strictEqual(payload.resumo.margemContribuicaoPercentual, 40);
assert.strictEqual(payload.resumo.pedidosValidos, 1);

// O pedido não desaparece: segue no payload e nas contagens auditáveis.
assert.strictEqual(payload.pedidos.length, 2);
assert.strictEqual(payload.resumo.pedidosTotal, 2);
assert.strictEqual(payload.resumo.pedidosForaResultado, 1);
const mediacao = payload.pedidos.find((pedido) => pedido.id === "MEDIACAO");
assert.ok(mediacao);
assert.strictEqual(mediacao.status, "com_problema");
assert.strictEqual(mediacao.valor, 50);
assert.strictEqual(mediacao.entraNoResultado, false);

// Cliente 360 usa a mesma base de R$ 100 na operação e na reconciliação.
const totais = totaisOperacionais(payload.pedidos);
assert.strictEqual(totais.pedidos, 2);
assert.strictEqual(totais.pedidosPagos, 1);
assert.strictEqual(totais.comProblema, 1);
assert.strictEqual(totais.faturamentoFechamento, 100);
assert.strictEqual(reconciliar(payload.pedidos).faturamentoFechamento, 100);

console.log("centralVendasMediacaoResultado.test.js passed");
