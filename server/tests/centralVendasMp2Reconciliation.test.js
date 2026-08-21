// server/tests/centralVendasMp2Reconciliation.test.js
//
// MP2 — centralVendasMpReconciliationService.reconcilePayments é uma função
// PURA (sem I/O): recebe as duas evidências já persistidas (Payments do MP1
// + movimentos do Settlement Report) e devolve rows/summary. Testável sem
// banco/rede.
//
// Cobre a fixture REAL do handoff (payment_id 174959925172 — seção 22 do
// spec MP2) e os casos de 0/1/N SETTLEMENT, tolerância monetária, null vs
// zero, e separação de eventos posteriores (REFUND/DISPUTE/...).

const assert = require("assert");
const { reconcilePayments } = require("../services/centralVendas/centralVendasMpReconciliationService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

function payment({ paymentId, orderId = "O1", transactionAmount = null, netReceivedAmount = null, chargesTotal = 0 }) {
  return { paymentId, orderId, orderIds: [orderId], transactionAmount, netReceivedAmount, chargesTotal };
}

function movement({
  sourceId, orderId = null, shippingId = null, transactionType = "SETTLEMENT",
  transactionAmount = null, feeAmount = null, settlementNetAmount = null, realAmount = null,
  moneyReleaseDate = null,
}) {
  return { sourceId, orderId, shippingId, transactionType, transactionAmount, feeAmount, settlementNetAmount, realAmount, moneyReleaseDate };
}

function run() {
  // 31/33/38 — fixture REAL do handoff: 174959925172, matched, deltas 0.
  {
    const payments = [payment({
      paymentId: "174959925172", orderId: "2000018051653738",
      transactionAmount: 34.90, netReceivedAmount: 22.41, chargesTotal: 12.49,
    })];
    const movements = [movement({
      sourceId: "174959925172", orderId: "2000018051653738",
      transactionType: "SETTLEMENT", transactionAmount: 34.90, feeAmount: -12.49,
      settlementNetAmount: 22.41, realAmount: 22.41,
    })];
    const { rows, summary } = reconcilePayments({ payments, movements });
    eq("fixture real: 1 row", rows.length, 1);
    const r = rows[0];
    eq("fixture real: grossMatch", r.grossMatch, true);
    eq("fixture real: grossDelta", r.grossDelta, 0);
    eq("fixture real: netMatch", r.netMatch, true);
    eq("fixture real: netDelta", r.netDelta, 0);
    eq("fixture real: feeExplanationMatch", r.feeExplanationMatch, true);
    eq("fixture real: feeDelta", r.feeDelta, 0);
    eq("fixture real: reconciliationStatus", r.reconciliationStatus, "matched");
    eq("fixture real: settlementBaseMatchCount", r.settlementBaseMatchCount, 1);
    eq("fixture real: summary.paymentsMatched", summary.paymentsMatched, 1);
  }

  // 31 — SOURCE_ID = paymentId faz o vínculo (join exclusivo por essa chave).
  {
    const payments = [payment({ paymentId: "P1", transactionAmount: 100, netReceivedAmount: 90 })];
    const movements = [movement({ sourceId: "P1", transactionAmount: 100, feeAmount: -10, settlementNetAmount: 90 })];
    const { rows } = reconcilePayments({ payments, movements });
    eq("31: vinculo por SOURCE_ID=paymentId", rows[0].settlementBaseMatchCount, 1);
  }

  // 32 — ORDER_ID divergente NUNCA substitui SOURCE_ID (só cross-check).
  {
    const payments = [payment({ paymentId: "P1", orderId: "ORDER-A", transactionAmount: 100, netReceivedAmount: 90 })];
    const movements = [movement({ sourceId: "P1", orderId: "ORDER-DIFERENTE", transactionAmount: 100, feeAmount: -10, settlementNetAmount: 90 })];
    const { rows } = reconcilePayments({ payments, movements });
    eq("32: ainda concilia mesmo com ORDER_ID divergente (SOURCE_ID manda)", rows[0].reconciliationStatus, "matched");
    eq("32: settlementOrderId exposto para diagnostico", rows[0].settlementOrderId, "ORDER-DIFERENTE");
  }

  // 34 — zero SETTLEMENT = missing.
  {
    const payments = [payment({ paymentId: "P1", transactionAmount: 100, netReceivedAmount: 90 })];
    const movements = [];
    const { rows, summary } = reconcilePayments({ payments, movements });
    eq("34: settlementBaseMatchCount=0", rows[0].settlementBaseMatchCount, 0);
    eq("34: reconciliationStatus=settlement_missing", rows[0].reconciliationStatus, "settlement_missing");
    eq("34: summary.paymentsSettlementMissing", summary.paymentsSettlementMissing, 1);
  }

  // 35 — 2 SETTLEMENT = ambiguous, NUNCA escolhe "a primeira".
  {
    const payments = [payment({ paymentId: "P1", transactionAmount: 100, netReceivedAmount: 90 })];
    const movements = [
      movement({ sourceId: "P1", transactionAmount: 100, feeAmount: -10, settlementNetAmount: 90 }),
      movement({ sourceId: "P1", transactionAmount: 999, feeAmount: -1, settlementNetAmount: 998 }),
    ];
    const { rows, summary } = reconcilePayments({ payments, movements });
    eq("35: settlementBaseMatchCount=2", rows[0].settlementBaseMatchCount, 2);
    eq("35: reconciliationStatus=settlement_ambiguous", rows[0].reconciliationStatus, "settlement_ambiguous");
    ok("35: nao usa nenhum dos dois como base (settlementNetAmount null)", rows[0].settlementNetAmount === null);
    eq("35: summary.paymentsSettlementAmbiguous", summary.paymentsSettlementAmbiguous, 1);
  }

  // 24 — múltiplos movimentos: 1 SETTLEMENT + REFUND + DISPUTE. Base
  // determinística pela linha SETTLEMENT; postMovements = 2, nunca somados.
  {
    const payments = [payment({ paymentId: "P1", transactionAmount: 100, netReceivedAmount: 90 })];
    const movements = [
      movement({ sourceId: "P1", transactionType: "SETTLEMENT", transactionAmount: 100, feeAmount: -10, settlementNetAmount: 90 }),
      movement({ sourceId: "P1", transactionType: "REFUND", transactionAmount: -50 }),
      movement({ sourceId: "P1", transactionType: "DISPUTE", transactionAmount: -20 }),
    ];
    const { rows, summary } = reconcilePayments({ payments, movements });
    eq("24: settlementBaseMatchCount=1", rows[0].settlementBaseMatchCount, 1);
    eq("24: postMovementsCount=2", rows[0].postMovementsCount, 2);
    ok("24: postMovementTypes contem REFUND e DISPUTE", rows[0].postMovementTypes.includes("REFUND") && rows[0].postMovementTypes.includes("DISPUTE"));
    eq("24: reconciliationStatus continua matched (eventos posteriores nao mudam o resultado)", rows[0].reconciliationStatus, "matched");
    eq("summary.postMovementsCount agregado", summary.postMovementsCount, 2);
  }

  // 36/37 — grossMatch / netMatch dentro/fora da tolerância R$0,01.
  {
    // Dentro da tolerancia -> match.
    const p1 = [payment({ paymentId: "P1", transactionAmount: 100, netReceivedAmount: 100 })];
    const m1 = [movement({ sourceId: "P1", transactionAmount: 99.99, settlementNetAmount: 100 })];
    const r1 = reconcilePayments({ payments: p1, movements: m1 }).rows[0];
    eq("36: 100 vs 99.99 (delta 0.01) -> grossMatch true", r1.grossMatch, true);

    // Fora da tolerancia -> divergent.
    const p2 = [payment({ paymentId: "P1", transactionAmount: 100, netReceivedAmount: 100 })];
    const m2 = [movement({ sourceId: "P1", transactionAmount: 99.98, settlementNetAmount: 100 })];
    const r2 = reconcilePayments({ payments: p2, movements: m2 }).rows[0];
    eq("37: 100 vs 99.98 (delta 0.02) -> grossMatch false", r2.grossMatch, false);
    eq("37: reconciliationStatus=divergent", r2.reconciliationStatus, "divergent");
  }

  // 39/40 — null nunca vira match nem zero.
  {
    const payments = [payment({ paymentId: "P1", transactionAmount: 100, netReceivedAmount: null })];
    const movements = [movement({ sourceId: "P1", transactionAmount: 100, settlementNetAmount: 20 })];
    const { rows } = reconcilePayments({ payments, movements });
    ok("40: netMatch NUNCA true quando Payment.net e null", rows[0].netMatch !== true);
    eq("40: netMatch e false (nao null-como-zero)", rows[0].netMatch, false);
    eq("40: netDelta null (nao comparavel)", rows[0].netDelta, null);
  }

  // Payment inexistente para um SOURCE_ID: settlement continua persistido
  // (fora do escopo desta funcao pura — ela so itera `payments`), mas nao
  // gera nenhuma linha de conciliacao falsa para ele.
  {
    const payments = [];
    const movements = [movement({ sourceId: "SEM_PAYMENT", transactionAmount: 50, settlementNetAmount: 45 })];
    const { rows, summary } = reconcilePayments({ payments, movements });
    eq("payment inexistente: 0 rows de conciliacao", rows.length, 0);
    eq("payment inexistente: settlementRowsUnlinked=1", summary.settlementRowsUnlinked, 1);
    eq("payment inexistente: settlementRowsLinkedToPayments=0", summary.settlementRowsLinkedToPayments, 0);
  }

  // payment_incomplete: Payment sem NENHUM valor usavel (nem gross nem net).
  {
    const payments = [payment({ paymentId: "P1", transactionAmount: null, netReceivedAmount: null })];
    const movements = [movement({ sourceId: "P1", transactionAmount: 100, settlementNetAmount: 90 })];
    const { rows } = reconcilePayments({ payments, movements });
    eq("payment_incomplete", rows[0].reconciliationStatus, "payment_incomplete");
  }

  // transactionTypeCounts agrega tipo desconhecido sem derrubar o calculo.
  {
    const payments = [payment({ paymentId: "P1", transactionAmount: 10, netReceivedAmount: 10 })];
    const movements = [
      movement({ sourceId: "P1", transactionType: "SETTLEMENT", transactionAmount: 10, settlementNetAmount: 10 }),
      movement({ sourceId: "P1", transactionType: "TIPO_NUNCA_VISTO_ANTES", transactionAmount: 1 }),
    ];
    const { summary } = reconcilePayments({ payments, movements });
    eq("tipo desconhecido aparece em typeCounts", summary.transactionTypeCounts.TIPO_NUNCA_VISTO_ANTES, 1);
  }

  // Hardening final MP3 (ponto 2) — settlement_pending vs settlement_missing.
  // Retrocompatibilidade: sem `reports`, comportamento IDENTICO ao anterior
  // (settlement_missing definitivo) — teste 34 acima ja prova isso.
  {
    // report ainda "pending" (nao imported) -> zero SETTLEMENT NUNCA vira
    // settlement_missing definitivo.
    const payments = [payment({ paymentId: "P1", transactionAmount: 100, netReceivedAmount: 90 })];
    payments[0].syncRunId = 501;
    const { rows } = reconcilePayments({ payments, movements: [], reports: [{ syncRunId: 501, status: "pending" }] });
    eq("hardening: report pending -> settlement_pending (nunca missing)", rows[0].reconciliationStatus, "settlement_pending");
  }
  {
    // report "processed" (ainda nao importado) -> mesma regra.
    const payments = [payment({ paymentId: "P1", transactionAmount: 100, netReceivedAmount: 90 })];
    payments[0].syncRunId = 502;
    const { rows } = reconcilePayments({ payments, movements: [], reports: [{ syncRunId: 502, status: "processed" }] });
    eq("hardening: report processed -> settlement_pending", rows[0].reconciliationStatus, "settlement_pending");
  }
  {
    // report "imported" + zero SETTLEMENT -> settlement_missing DEFINITIVO.
    const payments = [payment({ paymentId: "P1", transactionAmount: 100, netReceivedAmount: 90 })];
    payments[0].syncRunId = 503;
    const { rows, summary } = reconcilePayments({ payments, movements: [], reports: [{ syncRunId: 503, status: "imported" }] });
    eq("hardening: report imported + zero settlement -> settlement_missing", rows[0].reconciliationStatus, "settlement_missing");
    eq("hardening: summary.paymentsSettlementMissing", summary.paymentsSettlementMissing, 1);
  }
  {
    // nenhum report para o run do Payment (ainda nem foi requisitado) ->
    // nunca definitivo enquanto nao ha prova de import completo.
    const payments = [payment({ paymentId: "P1", transactionAmount: 100, netReceivedAmount: 90 })];
    payments[0].syncRunId = 504;
    const { rows } = reconcilePayments({ payments, movements: [], reports: [] });
    eq("hardening: sem report algum para o run -> settlement_pending (nao missing)", rows[0].reconciliationStatus, "settlement_pending");
  }
  {
    // range com varios runs: 1 imported + 1 pending -> classificados
    // separadamente, nunca o pending contado como missing.
    const payments = [
      { paymentId: "PA", orderId: "OA", orderIds: ["OA"], transactionAmount: 100, netReceivedAmount: 90, chargesTotal: 0, syncRunId: 601 },
      { paymentId: "PB", orderId: "OB", orderIds: ["OB"], transactionAmount: 100, netReceivedAmount: 90, chargesTotal: 0, syncRunId: 602 },
    ];
    const reports = [{ syncRunId: 601, status: "imported" }, { syncRunId: 602, status: "pending" }];
    const { rows, summary } = reconcilePayments({ payments, movements: [], reports });
    eq("hardening: run imported -> settlement_missing", rows.find((r) => r.paymentId === "PA").reconciliationStatus, "settlement_missing");
    eq("hardening: run pending -> settlement_pending", rows.find((r) => r.paymentId === "PB").reconciliationStatus, "settlement_pending");
    eq("hardening: summary.paymentsSettlementMissing=1", summary.paymentsSettlementMissing, 1);
    eq("hardening: summary.paymentsSettlementPending=1", summary.paymentsSettlementPending, 1);
  }

  console.log(`centralVendasMp2Reconciliation.test.js: ${checks} verificacoes OK`);
}

run();
