// server/services/centralVendas/centralVendasMpReconciliationService.js
// MP2 — Conciliação Payment <-> Settlement.
//
// Chave de conciliação PROVADA no handoff (seção 20/21):
//   Payment.payment_id = Settlement.SOURCE_ID  (igualdade textual EXATA)
//
// ORDER_ID é só cross-check/diagnóstico; SHIPPING_ID é evidência auxiliar.
// Nenhum dos dois é fallback de vínculo (seção 17 do spec MP2) — nunca
// concilia por valor/data/SKU/buyer/posição/proximidade temporal.
//
// Calcula tudo em memória a partir das DUAS evidências já persistidas
// (central_vendas_mp_payments + central_vendas_mp_settlement_movements) —
// nenhuma terceira tabela de "resultado conciliado" (seção 26 do spec): a
// reconciliação é sempre DERIVÁVEL, nunca uma verdade paralela para
// desincronizar.
//
// Esta camada é só INTERPRETAÇÃO/leitura — nunca soma REFUND/DISPUTE/
// SETTLEMENT_SHIPPING ao resultado, nunca altera Resultado Parcial/margem/
// ledger M6/podeConcluir (seção 19/33 do spec MP2). MP3 decide a semântica
// financeira.

const { round2 } = require("../../utils/numberUtils");
const centralVendasMpPaymentsRepository = require("./centralVendasMpPaymentsRepository");
const centralVendasMpSettlementRepository = require("./centralVendasMpSettlementRepository");

const MONETARY_TOLERANCE = 0.01;

function checkMonetario(expected, observed) {
  if (expected === null || expected === undefined || observed === null || observed === undefined) {
    // Ausência de valor NUNCA é match nem zero (seção 21/23 do spec MP2).
    return { expected: expected ?? null, observed: observed ?? null, delta: null, match: false };
  }
  const delta = round2(observed - expected);
  const match = Math.abs(delta) <= MONETARY_TOLERANCE + 1e-9;
  return { expected, observed, delta, match };
}

// Agrupa os movimentos do Settlement por SOURCE_ID (chave de conciliação —
// seção 17). Índice em memória, nunca uma nova tabela.
function indexMovementsBySourceId(movements) {
  const bySource = new Map();
  for (const m of movements || []) {
    const key = m.sourceId;
    if (key == null) continue;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(m);
  }
  return bySource;
}

// Para 1 Payment, encontra a(s) linha(s) SETTLEMENT do MESMO SOURCE_ID e
// classifica 0/1/N (seção 18/24 do spec MP2) — nunca escolhe "a primeira"
// quando há ambiguidade.
function reconcileOnePayment(payment, movementsForSource) {
  const movs = movementsForSource || [];
  const settlementRows = movs.filter((m) => m.transactionType === "SETTLEMENT");
  const postMovements = movs.filter((m) => m.transactionType !== "SETTLEMENT");
  const postMovementTypes = [...new Set(postMovements.map((m) => m.transactionType))];

  const settlementBaseMatchCount = settlementRows.length;
  const base = settlementBaseMatchCount === 1 ? settlementRows[0] : null;

  const grossCheck = base ? checkMonetario(payment.transactionAmount, base.transactionAmount)
    : { expected: payment.transactionAmount ?? null, observed: null, delta: null, match: false };
  const netCheck = base ? checkMonetario(payment.netReceivedAmount, base.settlementNetAmount)
    : { expected: payment.netReceivedAmount ?? null, observed: null, delta: null, match: false };

  // feeExplanationMatch é evidência AUXILIAR (seção 20 do spec): comparado
  // apenas quando há base, e uma divergência aqui não derruba `matched`
  // sozinha — pode ser true/false/null (não comparável).
  let feeCheck = { expected: null, observed: null, delta: null, match: null };
  if (base) {
    const feeObservado = base.feeAmount === null || base.feeAmount === undefined ? null : Math.abs(base.feeAmount);
    feeCheck = checkMonetario(payment.chargesTotal ?? null, feeObservado);
    if (feeCheck.expected === null || feeCheck.observed === null) feeCheck.match = null;
  }

  const paymentSemValoresUsaveis = (payment.transactionAmount === null || payment.transactionAmount === undefined)
    && (payment.netReceivedAmount === null || payment.netReceivedAmount === undefined);

  let reconciliationStatus;
  if (paymentSemValoresUsaveis) {
    reconciliationStatus = "payment_incomplete";
  } else if (settlementBaseMatchCount === 0) {
    reconciliationStatus = "settlement_missing";
  } else if (settlementBaseMatchCount > 1) {
    reconciliationStatus = "settlement_ambiguous";
  } else if (grossCheck.match === true && netCheck.match === true) {
    reconciliationStatus = "matched";
  } else {
    reconciliationStatus = "divergent";
  }

  return {
    paymentId: payment.paymentId,
    orderId: payment.orderId,
    orderIds: payment.orderIds,
    paymentStatus: payment.status ?? null,
    paymentStatusDetail: payment.statusDetail ?? null,
    paymentTransactionAmount: payment.transactionAmount ?? null,
    paymentTransactionAmountRefunded: payment.transactionAmountRefunded ?? null,
    paymentNetReceivedAmount: payment.netReceivedAmount ?? null,
    // MP3 preflight (seção 1.1/9 do spec MP3) — conciliação != liberação do
    // dinheiro: exposto aqui só como evidência, nunca usado para alterar
    // reconciliationStatus/resultado sozinho.
    moneyReleaseStatus: payment.moneyReleaseStatus ?? null,
    moneyReleaseDate: payment.moneyReleaseDate ?? null,
    refundCount: payment.refundCount ?? null,
    settlementTransactionAmount: base ? base.transactionAmount : null,
    settlementFeeAmount: base ? base.feeAmount : null,
    settlementNetAmount: base ? base.settlementNetAmount : null,
    settlementRealAmount: base ? base.realAmount : null,
    settlementMoneyReleaseDate: base ? base.moneyReleaseDate : null,
    settlementOrderId: base ? base.orderId : null,
    settlementShippingId: base ? base.shippingId : null,
    grossDelta: grossCheck.delta,
    netDelta: netCheck.delta,
    feeDelta: feeCheck.delta,
    grossMatch: grossCheck.match,
    netMatch: netCheck.match,
    feeExplanationMatch: feeCheck.match,
    settlementBaseMatchCount,
    reconciliationStatus,
    postMovementsCount: postMovements.length,
    postMovementTypes,
  };
}

// Função PURA (sem I/O) — recebe as duas evidências já carregadas e devolve
// rows + summary. Testável sem banco/rede.
function reconcilePayments({ payments, movements }) {
  const bySource = indexMovementsBySourceId(movements);
  const rows = (payments || []).map((payment) => {
    const movs = bySource.get(payment.paymentId) || [];
    return reconcileOnePayment(payment, movs);
  });

  const linkedSourceIds = new Set((payments || []).map((p) => p.paymentId));
  const settlementRowsLinkedToPayments = (movements || []).filter((m) => m.sourceId != null && linkedSourceIds.has(m.sourceId)).length;
  const settlementRowsUnlinked = (movements || []).length - settlementRowsLinkedToPayments;

  const transactionTypeCounts = {};
  for (const m of movements || []) {
    const tt = m.transactionType || "DESCONHECIDO";
    transactionTypeCounts[tt] = (transactionTypeCounts[tt] || 0) + 1;
  }

  const summary = {
    paymentsCount: rows.length,
    paymentsMatched: rows.filter((r) => r.reconciliationStatus === "matched").length,
    paymentsDivergent: rows.filter((r) => r.reconciliationStatus === "divergent").length,
    paymentsSettlementMissing: rows.filter((r) => r.reconciliationStatus === "settlement_missing").length,
    paymentsSettlementAmbiguous: rows.filter((r) => r.reconciliationStatus === "settlement_ambiguous").length,
    paymentsIncomplete: rows.filter((r) => r.reconciliationStatus === "payment_incomplete").length,
    postMovementsCount: rows.reduce((acc, r) => acc + r.postMovementsCount, 0),
    transactionTypeCounts,
    settlementRowsLinkedToPayments,
    settlementRowsUnlinked,
  };

  return { rows, summary };
}

// Orquestração: carrega as duas evidências (escopadas por run — nunca
// vazam entre contas, seção 30 do spec MP2) e aplica a função pura acima.
// `runId`/`clienteSlug` não são validados aqui — o chamador (controller) já
// deve ter chamado centralVendasSyncRunService.obterSyncRun (IDOR-safe) e
// passar o `run` resolvido.
async function getReconciliationForRun({ run, db }) {
  const [payments, movements, report] = await Promise.all([
    centralVendasMpPaymentsRepository.listMpPaymentsWithChargesTotalByRun(run.id, db),
    centralVendasMpSettlementRepository.listSettlementMovementsByRun(run.id, db),
    centralVendasMpSettlementRepository.getSettlementReportByRun(run.id, db),
  ]);

  const { rows, summary } = reconcilePayments({ payments, movements });
  return { report, rows, summary };
}

module.exports = {
  reconcilePayments,
  getReconciliationForRun,
  checkMonetario,
  MONETARY_TOLERANCE,
};
