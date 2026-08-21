// server/tests/centralVendasMp3ResultadoConciliado.test.js
//
// MP3 — bateria financeira obrigatória (seção 20 do spec MP3).
// Integra de verdade a saída do MP2 (reconcilePayments) como entrada do MP3
// (computeResultadoConciliadoMp) — nunca reimplementa a conciliação
// Payment<->Settlement aqui, só prova a combinação real das duas camadas.

const assert = require("assert");
const { reconcilePayments } = require("../services/centralVendas/centralVendasMpReconciliationService");
const { computeResultadoConciliadoMp, computeOrderMpReconciliation } = require("../services/centralVendas/centralVendasMp3ResultadoConciliadoService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

function payment({ paymentId, orderId = "O1", orderIds = null, transactionAmount = null, transactionAmountRefunded = null, netReceivedAmount = null, chargesTotal = 0, moneyReleaseStatus = null, moneyReleaseDate = null }) {
  return {
    paymentId, orderId, orderIds: orderIds || [orderId],
    transactionAmount, transactionAmountRefunded, netReceivedAmount, chargesTotal,
    moneyReleaseStatus, moneyReleaseDate,
  };
}

function movement({ sourceId, orderId = null, transactionType = "SETTLEMENT", transactionAmount = null, feeAmount = null, settlementNetAmount = null, realAmount = null }) {
  return { sourceId, orderId, shippingId: null, transactionType, transactionAmount, feeAmount, settlementNetAmount, realAmount, moneyReleaseDate: null };
}

function pedido({ id = "O1", rowId = 1, valor = null, custo = null, imposto = null, resultado = null, entraNoResultado = true }) {
  return { id, rowId, valor, custo, imposto, resultado, entraNoResultado };
}

function reconciliar({ payments, movements }) {
  return reconcilePayments({ payments, movements });
}

async function run() {
  // 1 — Caso simples do spec (seção 20): faturamento 34.90, custo 10,
  // imposto 2, settlement net 22.41 -> resultadoConciliado = 10.41. Prova
  // que NÃO subtrai de novo shipping/sale_fee/processing/financing (o
  // chargesTotal de 12.49 já está embutido no settlementNetAmount, nunca
  // reaparece na fórmula).
  {
    const { rows: rec } = reconciliar({
      payments: [payment({ paymentId: "P1", orderId: "O1", transactionAmount: 34.90, netReceivedAmount: 22.41, chargesTotal: 12.49 })],
      movements: [movement({ sourceId: "P1", orderId: "O1", transactionAmount: 34.90, feeAmount: -12.49, settlementNetAmount: 22.41, realAmount: 22.41 })],
    });
    const pedidos = [pedido({ id: "O1", valor: 34.90, custo: 10, imposto: 2, resultado: 20 })];
    const { rows } = computeResultadoConciliadoMp({ pedidos, reconciliationRows: rec });
    eq("1: mpStatus matched_clean", rows[0].mpStatus, "matched_clean");
    eq("1: resultadoConciliadoMpBase = 22.41-10-2 = 10.41", rows[0].resultadoConciliadoMpBase, 10.41);
    eq("1: nao subtrai shipping/fees de novo (chargesTotal nao aparece na formula)", rows[0].resultadoConciliadoMpBase, 10.41);
    eq("1: deltaResultadoMp = 10.41-20 = -9.59", rows[0].deltaResultadoMp, -9.59);
    eq("1: incluidoNoResultadoConciliado", rows[0].incluidoNoResultadoConciliado, true);
  }

  // 2 — deductions do MP == deductions operacionais -> delta 0 (resultado
  // conciliado bate com operacional).
  {
    const { rows: rec } = reconciliar({
      payments: [payment({ paymentId: "P1", orderId: "O1", transactionAmount: 100, netReceivedAmount: 80 })],
      movements: [movement({ sourceId: "P1", orderId: "O1", transactionAmount: 100, feeAmount: -20, settlementNetAmount: 80 })],
    });
    // operacional: faturamento 100, custo 30, imposto 5 -> resultado
    // operacional "correto" seria 100-20(taxas/frete)-30-5=45; aqui simulamos
    // que o motor bateu exatamente nisso.
    const pedidos = [pedido({ id: "O1", valor: 100, custo: 30, imposto: 5, resultado: 45 })];
    const { rows } = computeResultadoConciliadoMp({ pedidos, reconciliationRows: rec });
    eq("2: resultadoConciliadoMpBase = 80-30-5 = 45", rows[0].resultadoConciliadoMpBase, 45);
    eq("2: delta = 0 (bate com operacional)", rows[0].deltaResultadoMp, 0);
  }

  // 3 — processing fee extra nao capturado pelo motor operacional ->
  // resultado conciliado MENOR (delta negativo), nunca escondido.
  {
    const { rows: rec } = reconciliar({
      payments: [payment({ paymentId: "P1", orderId: "O1", transactionAmount: 100, netReceivedAmount: 78 })],
      movements: [movement({ sourceId: "P1", orderId: "O1", transactionAmount: 100, feeAmount: -22, settlementNetAmount: 78 })],
    });
    const pedidos = [pedido({ id: "O1", valor: 100, custo: 30, imposto: 5, resultado: 45 })];
    const { rows } = computeResultadoConciliadoMp({ pedidos, reconciliationRows: rec });
    eq("3: resultadoConciliadoMpBase = 78-30-5 = 43", rows[0].resultadoConciliadoMpBase, 43);
    eq("3: delta negativo (-2) revela deducao nao capturada", rows[0].deltaResultadoMp, -2);
  }

  // 4 — Order com 2 Payments determinísticos: soma os 2 settlementNetAmount
  // UMA vez cada, nunca só payments[0].
  {
    const { rows: rec } = reconciliar({
      payments: [
        payment({ paymentId: "P1", orderId: "O1", transactionAmount: 60, netReceivedAmount: 50 }),
        payment({ paymentId: "P2", orderId: "O1", transactionAmount: 40, netReceivedAmount: 35 }),
      ],
      movements: [
        movement({ sourceId: "P1", orderId: "O1", transactionAmount: 60, feeAmount: -10, settlementNetAmount: 50 }),
        movement({ sourceId: "P2", orderId: "O1", transactionAmount: 40, feeAmount: -5, settlementNetAmount: 35 }),
      ],
    });
    const pedidos = [pedido({ id: "O1", valor: 100, custo: 20, imposto: 5, resultado: 60 })];
    const { rows } = computeResultadoConciliadoMp({ pedidos, reconciliationRows: rec });
    eq("4: paymentsCount = 2", rows[0].paymentsCount, 2);
    eq("4: settlementNetAmountTotal = 50+35 = 85", rows[0].settlementNetAmountTotal, 85);
    eq("4: resultadoConciliadoMpBase = 85-20-5 = 60", rows[0].resultadoConciliadoMpBase, 60);
  }

  // 5 — Payment compartilhado entre 2 orders -> shared_payment_ambiguous
  // para AMBOS, nunca duplica o líquido, nunca rateia.
  {
    const { rows: rec } = reconciliar({
      payments: [payment({ paymentId: "P1", orderId: "O1", orderIds: ["O1", "O2"], transactionAmount: 100, netReceivedAmount: 90 })],
      movements: [movement({ sourceId: "P1", orderId: "O1", transactionAmount: 100, feeAmount: -10, settlementNetAmount: 90 })],
    });
    const pedidos = [
      pedido({ id: "O1", valor: 50, custo: 10, imposto: 1, resultado: 30 }),
      pedido({ id: "O2", valor: 50, custo: 10, imposto: 1, resultado: 30 }),
    ];
    const { rows, summary } = computeResultadoConciliadoMp({ pedidos, reconciliationRows: rec });
    eq("5: O1 ambiguous", rows[0].mpStatus, "shared_payment_ambiguous");
    eq("5: O2 ambiguous", rows[1].mpStatus, "shared_payment_ambiguous");
    ok("5: nenhum dos dois produz resultadoConciliadoMpBase", rows[0].resultadoConciliadoMpBase === null && rows[1].resultadoConciliadoMpBase === null);
    eq("5: payment contado 1 vez no agregado (paymentsUnique)", summary.paymentsUnique, 1);
    eq("5: ordersAmbiguous = 2", summary.ordersAmbiguous, 2);
  }

  // 6 — gross do Payment diferente do faturamento do Order -> order_gross_divergent.
  {
    const { rows: rec } = reconciliar({
      payments: [payment({ paymentId: "P1", orderId: "O1", transactionAmount: 100, netReceivedAmount: 90 })],
      movements: [movement({ sourceId: "P1", orderId: "O1", transactionAmount: 100, feeAmount: -10, settlementNetAmount: 90 })],
    });
    const pedidos = [pedido({ id: "O1", valor: 999, custo: 10, imposto: 1, resultado: 500 })];
    const { rows } = computeResultadoConciliadoMp({ pedidos, reconciliationRows: rec });
    eq("6: mpStatus order_gross_divergent", rows[0].mpStatus, "order_gross_divergent");
    ok("6: resultadoConciliadoMpBase = null", rows[0].resultadoConciliadoMpBase === null);
    ok("6: grossDeltaOrder exposto (nunca escondido)", typeof rows[0].grossDeltaOrder === "number" && rows[0].grossDeltaOrder !== 0);
  }

  // 7 — Settlement missing.
  {
    const { rows: rec } = reconciliar({
      payments: [payment({ paymentId: "P1", orderId: "O1", transactionAmount: 100, netReceivedAmount: 90 })],
      movements: [],
    });
    const pedidos = [pedido({ id: "O1", valor: 100, custo: 10, imposto: 1, resultado: 50 })];
    const { rows } = computeResultadoConciliadoMp({ pedidos, reconciliationRows: rec });
    eq("7: mpStatus settlement_missing", rows[0].mpStatus, "settlement_missing");
    ok("7: resultado nao calculado", rows[0].resultadoConciliadoMpBase === null);
  }

  // 8 — Settlement ambiguous (2 SETTLEMENT para o mesmo SOURCE_ID).
  {
    const { rows: rec } = reconciliar({
      payments: [payment({ paymentId: "P1", orderId: "O1", transactionAmount: 100, netReceivedAmount: 90 })],
      movements: [
        movement({ sourceId: "P1", orderId: "O1", transactionAmount: 100, feeAmount: -10, settlementNetAmount: 90 }),
        movement({ sourceId: "P1", orderId: "O1", transactionAmount: 100, feeAmount: -10, settlementNetAmount: 90 }),
      ],
    });
    const pedidos = [pedido({ id: "O1", valor: 100, custo: 10, imposto: 1, resultado: 50 })];
    const { rows } = computeResultadoConciliadoMp({ pedidos, reconciliationRows: rec });
    eq("8: mpStatus settlement_ambiguous", rows[0].mpStatus, "settlement_ambiguous");
  }

  // 9 — Payment incompleto (sem transaction_amount nem net_received_amount usaveis).
  {
    const { rows: rec } = reconciliar({
      payments: [payment({ paymentId: "P1", orderId: "O1", transactionAmount: null, netReceivedAmount: null })],
      movements: [],
    });
    const pedidos = [pedido({ id: "O1", valor: 100, custo: 10, imposto: 1, resultado: 50 })];
    const { rows } = computeResultadoConciliadoMp({ pedidos, reconciliationRows: rec });
    eq("9: mpStatus payment_incomplete", rows[0].mpStatus, "payment_incomplete");
  }

  // 10 — net null (transaction_amount presente, net_received_amount ausente)
  // -> netCheck falha -> divergent (MP2), nunca tratado como zero.
  {
    const { rows: rec } = reconciliar({
      payments: [payment({ paymentId: "P1", orderId: "O1", transactionAmount: 100, netReceivedAmount: null })],
      movements: [movement({ sourceId: "P1", orderId: "O1", transactionAmount: 100, feeAmount: -10, settlementNetAmount: 90 })],
    });
    const pedidos = [pedido({ id: "O1", valor: 100, custo: 10, imposto: 1, resultado: 50 })];
    const { rows } = computeResultadoConciliadoMp({ pedidos, reconciliationRows: rec });
    eq("10: net null -> divergent (nunca vira zero)", rows[0].mpStatus, "divergent");
  }

  // 11 — zero real (transaction_amount_refunded = 0) NUNCA conta como refund
  // real; refund > 0 conta e marca eventos posteriores.
  {
    const { rows: rec } = reconciliar({
      payments: [payment({ paymentId: "P1", orderId: "O1", transactionAmount: 100, transactionAmountRefunded: 0, netReceivedAmount: 90 })],
      movements: [movement({ sourceId: "P1", orderId: "O1", transactionAmount: 100, feeAmount: -10, settlementNetAmount: 90 })],
    });
    const pedidos = [pedido({ id: "O1", valor: 100, custo: 10, imposto: 1, resultado: 50 })];
    const { rows } = computeResultadoConciliadoMp({ pedidos, reconciliationRows: rec });
    eq("11: refund=0 real -> matched_clean (nao conta como evento posterior)", rows[0].mpStatus, "matched_clean");
    eq("11: temEventosPosteriores=false", rows[0].temEventosPosteriores, false);
  }
  {
    const { rows: rec } = reconciliar({
      payments: [payment({ paymentId: "P1", orderId: "O1", transactionAmount: 100, transactionAmountRefunded: 25, netReceivedAmount: 90 })],
      movements: [movement({ sourceId: "P1", orderId: "O1", transactionAmount: 100, feeAmount: -10, settlementNetAmount: 90 })],
    });
    const pedidos = [pedido({ id: "O1", valor: 100, custo: 10, imposto: 1, resultado: 50 })];
    const { rows } = computeResultadoConciliadoMp({ pedidos, reconciliationRows: rec });
    eq("11b: refund>0 real -> matched_with_post_events", rows[0].mpStatus, "matched_with_post_events");
    ok("11b: ainda produz resultadoConciliadoMpBase (base, nao final)", rows[0].resultadoConciliadoMpBase === 79);
  }

  // 12 — DISPUTE presente (movimento pós-venda) -> matched_with_post_events,
  // nunca somado automaticamente ao resultado.
  {
    const { rows: rec, summary: recSummary } = reconciliar({
      payments: [payment({ paymentId: "P1", orderId: "O1", transactionAmount: 100, netReceivedAmount: 90 })],
      movements: [
        movement({ sourceId: "P1", orderId: "O1", transactionAmount: 100, feeAmount: -10, settlementNetAmount: 90 }),
        movement({ sourceId: "P1", orderId: "O1", transactionType: "DISPUTE", transactionAmount: -38.70 }),
      ],
    });
    const pedidos = [pedido({ id: "O1", valor: 100, custo: 10, imposto: 1, resultado: 50 })];
    const { rows, summary } = computeResultadoConciliadoMp({ pedidos, reconciliationRows: rec, transactionTypeCounts: recSummary.transactionTypeCounts });
    eq("12: mpStatus matched_with_post_events", rows[0].mpStatus, "matched_with_post_events");
    eq("12: resultadoConciliadoMpBase = 90-10-1 = 79 (DISPUTE nao somado)", rows[0].resultadoConciliadoMpBase, 79);
    ok("12: postMovementTypes inclui DISPUTE", rows[0].postMovementTypes.includes("DISPUTE"));
    eq("12: agregado postMovementTypeCounts.DISPUTE=1, sem SETTLEMENT", summary.postMovementTypeCounts, { DISPUTE: 1 });
  }

  // 13 — pending vs released (liberação != conciliação — seção 9).
  {
    const { rows: rec } = reconciliar({
      payments: [payment({ paymentId: "P1", orderId: "O1", transactionAmount: 100, netReceivedAmount: 90, moneyReleaseStatus: "pending", moneyReleaseDate: "2026-09-18T00:00:00Z" })],
      movements: [movement({ sourceId: "P1", orderId: "O1", transactionAmount: 100, feeAmount: -10, settlementNetAmount: 90 })],
    });
    const pedidos = [pedido({ id: "O1", valor: 100, custo: 10, imposto: 1, resultado: 50 })];
    const { rows } = computeResultadoConciliadoMp({ pedidos, reconciliationRows: rec });
    eq("13: moneyReleaseStatus pending, ainda assim matched_clean", rows[0].moneyReleaseStatus, "pending");
    eq("13: mpStatus nao alterado por moneyReleaseStatus", rows[0].mpStatus, "matched_clean");
    ok("13: resultadoConciliadoMpBase calculado mesmo pending", rows[0].resultadoConciliadoMpBase === 79);
  }
  {
    const { rows: rec } = reconciliar({
      payments: [payment({ paymentId: "P1", orderId: "O1", transactionAmount: 100, netReceivedAmount: 90, moneyReleaseStatus: "released" })],
      movements: [movement({ sourceId: "P1", orderId: "O1", transactionAmount: 100, feeAmount: -10, settlementNetAmount: 90 })],
    });
    const pedidos = [pedido({ id: "O1", valor: 100, custo: 10, imposto: 1, resultado: 50 })];
    const { rows, summary } = computeResultadoConciliadoMp({ pedidos, reconciliationRows: rec });
    eq("13b: moneyReleaseStatus released", rows[0].moneyReleaseStatus, "released");
    eq("13b: paymentsReleased=1", summary.paymentsReleased, 1);
    eq("13b: paymentsPendingRelease=0", summary.paymentsPendingRelease, 0);
  }

  // 14 — cancelado/fora do resultado: nunca produz resultadoConciliadoMp,
  // mas continua expondo Payment/Settlement para auditoria.
  {
    const { rows: rec } = reconciliar({
      payments: [payment({ paymentId: "P1", orderId: "O1", transactionAmount: 100, netReceivedAmount: 90 })],
      movements: [movement({ sourceId: "P1", orderId: "O1", transactionAmount: 100, feeAmount: -10, settlementNetAmount: 90 })],
    });
    const pedidos = [pedido({ id: "O1", valor: 100, custo: 10, imposto: 1, resultado: null, entraNoResultado: false })];
    const { rows } = computeResultadoConciliadoMp({ pedidos, reconciliationRows: rec });
    eq("14: mpStatus not_applicable", rows[0].mpStatus, "not_applicable");
    eq("14: incluidoNoResultadoConciliado=false", rows[0].incluidoNoResultadoConciliado, false);
    ok("14: resultadoConciliadoMpBase=null", rows[0].resultadoConciliadoMpBase === null);
    eq("14: ainda expoe paymentIds para auditoria", rows[0].paymentIds, ["P1"]);
    eq("14: ainda expoe settlementNetAmountTotal para auditoria", rows[0].settlementNetAmountTotal, 90);
  }

  // 15 — custo ausente / imposto ausente: matched no nivel payment/settlement,
  // mas resultado conciliado NAO calculavel (motivo explicito, nunca 0).
  {
    const { rows: rec } = reconciliar({
      payments: [payment({ paymentId: "P1", orderId: "O1", transactionAmount: 100, netReceivedAmount: 90 })],
      movements: [movement({ sourceId: "P1", orderId: "O1", transactionAmount: 100, feeAmount: -10, settlementNetAmount: 90 })],
    });
    const pedidoSemCusto = [pedido({ id: "O1", valor: 100, custo: null, imposto: 1, resultado: 50 })];
    const r1 = computeResultadoConciliadoMp({ pedidos: pedidoSemCusto, reconciliationRows: rec });
    eq("15a: mpStatus ainda matched_clean (payment/settlement ok)", r1.rows[0].mpStatus, "matched_clean");
    ok("15a: resultadoConciliadoMpBase=null (custo ausente)", r1.rows[0].resultadoConciliadoMpBase === null);
    ok("15a: motivo explicito", r1.rows[0].motivo.includes("custo"));

    const pedidoSemImposto = [pedido({ id: "O1", valor: 100, custo: 10, imposto: null, resultado: 50 })];
    const r2 = computeResultadoConciliadoMp({ pedidos: pedidoSemImposto, reconciliationRows: rec });
    ok("15b: resultadoConciliadoMpBase=null (imposto ausente)", r2.rows[0].resultadoConciliadoMpBase === null);
    ok("15b: motivo explicito", r2.rows[0].motivo.includes("imposto"));
  }

  // 16 — range com 2 sync_runs (payments/settlements de runs diferentes) e
  // contas A/B: garantidos no nivel de agregação por quem monta
  // `reconciliationRows` (bulk por syncRunIds) — aqui provamos que a função
  // pura é agnóstica à origem das rows, só à composição orderId<->payments.
  {
    const recRunA = reconciliar({
      payments: [payment({ paymentId: "PA", orderId: "OA", transactionAmount: 50, netReceivedAmount: 45 })],
      movements: [movement({ sourceId: "PA", orderId: "OA", transactionAmount: 50, feeAmount: -5, settlementNetAmount: 45 })],
    }).rows;
    const recRunB = reconciliar({
      payments: [payment({ paymentId: "PB", orderId: "OB", transactionAmount: 70, netReceivedAmount: 60 })],
      movements: [movement({ sourceId: "PB", orderId: "OB", transactionAmount: 70, feeAmount: -10, settlementNetAmount: 60 })],
    }).rows;
    const pedidos = [
      pedido({ id: "OA", valor: 50, custo: 5, imposto: 0, resultado: 40 }),
      pedido({ id: "OB", valor: 70, custo: 5, imposto: 0, resultado: 55 }),
    ];
    const { rows, summary } = computeResultadoConciliadoMp({ pedidos, reconciliationRows: [...recRunA, ...recRunB] });
    eq("16: OA conciliado (run A)", rows[0].resultadoConciliadoMpBase, 40);
    eq("16: OB conciliado (run B)", rows[1].resultadoConciliadoMpBase, 55);
    eq("16: paymentsUnique = 2 (nenhum cruzamento entre runs)", summary.paymentsUnique, 2);
  }

  // 17 — resultado operacional (pedido.resultado) NUNCA é sobrescrito/alterado
  // pelo MP3, mesmo quando ha divergencia grande.
  {
    const { rows: rec } = reconciliar({
      payments: [payment({ paymentId: "P1", orderId: "O1", transactionAmount: 999, netReceivedAmount: 900 })],
      movements: [movement({ sourceId: "P1", orderId: "O1", transactionAmount: 999, feeAmount: -99, settlementNetAmount: 900 })],
    });
    const pedidos = [pedido({ id: "O1", valor: 100, custo: 10, imposto: 1, resultado: 55 })];
    const { rows } = computeResultadoConciliadoMp({ pedidos, reconciliationRows: rec });
    eq("17: resultadoOperacional preservado identico ao pedido (nunca sobrescrito)", rows[0].resultadoOperacional, 55);
  }

  console.log(`centralVendasMp3ResultadoConciliado.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
