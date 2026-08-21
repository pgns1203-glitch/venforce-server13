// server/services/centralVendas/centralVendasMp3ResultadoConciliadoService.js
// MP3 — transforma Payment + Settlement (já conciliados pelo MP2) em uma
// camada financeira derivada por ORDER: resultadoConciliadoMp.
//
// Função PURA (sem I/O): recebe os pedidos já no contrato canônico
// (buildPedidoContrato — M5/M6) e as rows já conciliadas pelo MP2
// (centralVendasMpReconciliationService.reconcilePayments) e devolve, por
// pedido, o veredito MP3. Nunca reimplementa a conciliação Payment<->
// Settlement (isso é MP2) nem recalcula `resultado` (Motor de Margem/ledger
// M6) — só combina as duas evidências já existentes.
//
// Regra de ouro (seção 2/3 do spec MP3): `resultado` do pedido NUNCA é
// sobrescrito. `resultadoConciliadoMpBase` só existe quando TODAS as provas
// da seção 4 do spec passam; senão null + `motivo` explícito (nunca
// ausência virando zero, nunca motivo escondido atrás de 1 booleano).

const { round2 } = require("../../utils/numberUtils");

// Settlement.SETTLEMENT_NET_AMOUNT já é o líquido observado pela plataforma
// (shipping/sale_fee/processing/financing já deduzidos — seção 3 do spec
// MP3). Nunca subtrair essas charges de novo aqui.
const ORDER_GROSS_TOLERANCE = 0.01;

function isRealRefund(row) {
  return typeof row.paymentTransactionAmountRefunded === "number" && row.paymentTransactionAmountRefunded > 0;
}

// released só quando TODOS os payments do pedido têm moneyReleaseStatus
// EXPLICITAMENTE "released" — nunca por omissão (seção 9 do spec): um
// payment com status ausente ao lado de outro "released" NUNCA vira
// "released" (bug corrigido: filtrar os null antes do every() permitia
// [released, null] passar como released). "pending" tem prioridade sobre
// "unknown" quando coexistem (é um sinal explícito, não ausência de dado).
// "unknown" cobre tanto ausência total quanto ausência parcial sem pending.
function aggregateMoneyReleaseStatus(rows) {
  if (!rows.length) return "unknown";
  const statuses = rows.map((r) => r.moneyReleaseStatus);
  if (statuses.some((s) => s === "pending")) return "pending";
  if (statuses.every((s) => s === "released")) return "released";
  return "unknown";
}

function sumIfAllPresent(rows, field) {
  if (!rows.length || !rows.every((r) => typeof r[field] === "number")) return null;
  return round2(rows.reduce((acc, r) => acc + r[field], 0));
}

// Núcleo do MP3: 1 pedido (contrato canônico) + as rows de conciliação MP2
// vinculadas a ele (por orderIds) -> veredito MP3. Nunca escolhe "algumas"
// rows e ignora outras — qualquer condição de bloqueio (payment incompleto,
// settlement ausente/ambíguo, divergência, payment compartilhado) se aplica
// ao pedido inteiro.
function computeOrderMpReconciliation(pedido, rowsDoPedido) {
  const rows = rowsDoPedido || [];
  const paymentIds = rows.map((r) => r.paymentId);
  const paymentsCount = rows.length;
  const postMovementsCount = rows.reduce((acc, r) => acc + (r.postMovementsCount || 0), 0);
  const postMovementTypes = [...new Set(rows.flatMap((r) => r.postMovementTypes || []))];
  const temEventosPosteriores = postMovementsCount > 0 || rows.some(isRealRefund);

  const paymentTransactionAmountTotal = sumIfAllPresent(rows, "paymentTransactionAmount");
  const paymentNetReceivedAmountTotal = sumIfAllPresent(rows, "paymentNetReceivedAmount");
  const settlementNetAmountTotal = sumIfAllPresent(rows, "settlementNetAmount");

  const linha = {
    orderId: pedido.id,
    rowId: pedido.rowId ?? null,
    resultadoOperacional: pedido.resultado ?? null,
    incluidoNoResultadoConciliado: false,
    mpStatus: "not_applicable",
    motivo: null,
    paymentIds,
    paymentsCount,
    paymentTransactionAmountTotal,
    paymentNetReceivedAmountTotal,
    settlementNetAmountTotal,
    orderGrossMatch: null,
    grossDeltaOrder: null,
    resultadoConciliadoMpBase: null,
    deltaResultadoMp: null,
    temEventosPosteriores,
    postMovementsCount,
    postMovementTypes,
    moneyReleaseStatus: paymentsCount ? aggregateMoneyReleaseStatus(rows) : null,
    // Data de liberação só é exposta sem ambiguidade quando há 1 único
    // payment (seção 9) — com múltiplos payments, cada um pode ter sua
    // própria data; nunca escolhe "a primeira" por adivinhação.
    moneyReleaseDate: paymentsCount === 1 ? (rows[0].moneyReleaseDate ?? null) : null,
  };

  // Seção 18 do spec MP3 — cancelado/fora do resultado nunca produz
  // resultadoConciliadoMp como se fosse venda válida, mas continua expondo
  // Payment/Settlement para auditoria (paymentIds/totais acima já calculados).
  if (!pedido.entraNoResultado) {
    return { ...linha, mpStatus: "not_applicable", motivo: "pedido_fora_do_resultado" };
  }

  if (paymentsCount === 0) {
    return { ...linha, mpStatus: "payment_missing", motivo: "nenhum payment vinculado a este pedido" };
  }

  // Seção 6 — payment compartilhado entre 2+ orders NUNCA é rateado; marca
  // ambíguo para TODOS os orders que tocam aquele payment.
  if (rows.some((r) => Array.isArray(r.orderIds) && r.orderIds.length > 1)) {
    return { ...linha, mpStatus: "shared_payment_ambiguous", motivo: "payment compartilhado entre mais de 1 order — nao rateado" };
  }

  if (rows.some((r) => r.reconciliationStatus === "payment_incomplete")) {
    return { ...linha, mpStatus: "payment_incomplete", motivo: "payment sem transaction_amount/net_received_amount usaveis" };
  }
  if (rows.some((r) => r.reconciliationStatus === "settlement_missing")) {
    return { ...linha, mpStatus: "settlement_missing", motivo: "nenhum SETTLEMENT encontrado para o(s) payment(s) deste pedido (report ja importado)" };
  }
  // Hardening final MP3 (ponto 2) — Settlement assincrono: report ainda
  // requested/pending/processed (ou ainda nao existe) NUNCA vira
  // settlement_missing definitivo (seção do hardening) — so quando o report
  // do run ja terminou de importar e mesmo assim nao ha SETTLEMENT.
  if (rows.some((r) => r.reconciliationStatus === "settlement_pending")) {
    return { ...linha, mpStatus: "settlement_pending", motivo: "settlement do(s) payment(s) deste pedido ainda nao foi importado (sync assincrono em andamento)" };
  }
  if (rows.some((r) => r.reconciliationStatus === "settlement_ambiguous")) {
    return { ...linha, mpStatus: "settlement_ambiguous", motivo: "mais de 1 SETTLEMENT para o mesmo payment" };
  }
  if (rows.some((r) => r.reconciliationStatus === "divergent")) {
    return { ...linha, mpStatus: "divergent", motivo: "gross/net do payment nao bate com o settlement (tolerancia R$0,01)" };
  }

  // A partir daqui, TODOS os payments deste pedido estão "matched" (MP2) —
  // nunca soma settlementNetAmount de um payment não determinístico.
  if (paymentTransactionAmountTotal === null) {
    return { ...linha, mpStatus: "order_gross_divergent", motivo: "transaction_amount ausente em pelo menos 1 payment do pedido" };
  }

  // orderGrossMatch (seção 4, check novo do MP3): SUM(Payment.transaction_amount)
  // vs faturamento canônico do Order, tolerância R$0,01 — nunca heurística.
  const grossDeltaOrder = round2(paymentTransactionAmountTotal - (pedido.valor ?? 0));
  const orderGrossMatch = pedido.valor != null && Math.abs(grossDeltaOrder) <= ORDER_GROSS_TOLERANCE + 1e-9;
  if (!orderGrossMatch) {
    return {
      ...linha, orderGrossMatch: false, grossDeltaOrder,
      mpStatus: "order_gross_divergent",
      motivo: "SUM(Payment.transaction_amount) diverge do faturamento canonico do Order",
    };
  }

  const mpStatus = temEventosPosteriores ? "matched_with_post_events" : "matched_clean";

  // Custo/imposto SEMPRE vêm do motor operacional (nunca do Mercado Pago —
  // seção 3). Ausentes -> resultado conciliado não calculável, mas o
  // mpStatus de conciliação Payment<->Settlement continua sendo reportado.
  if (pedido.custo == null) {
    return { ...linha, orderGrossMatch: true, grossDeltaOrder, mpStatus, motivo: "custo_produto ausente no motor operacional — resultado conciliado nao calculavel" };
  }
  if (pedido.imposto == null) {
    return { ...linha, orderGrossMatch: true, grossDeltaOrder, mpStatus, motivo: "imposto_interno ausente no motor operacional — resultado conciliado nao calculavel" };
  }

  // Fórmula do MP3 (seção 3 do spec): settlementNetAmount JÁ é líquido de
  // shipping/sale_fee/processing/financing — nunca subtraídos de novo.
  const resultadoConciliadoMpBase = round2(settlementNetAmountTotal - pedido.custo - pedido.imposto);
  const deltaResultadoMp = pedido.resultado == null ? null : round2(resultadoConciliadoMpBase - pedido.resultado);

  return {
    ...linha,
    incluidoNoResultadoConciliado: true,
    mpStatus,
    orderGrossMatch: true,
    grossDeltaOrder,
    resultadoConciliadoMpBase,
    deltaResultadoMp,
  };
}

function buildResumoAgregado(rows, reconciliationRows, transactionTypeCounts) {
  const ordersTotal = rows.length;
  const ordersComPayment = rows.filter((r) => r.paymentsCount > 0).length;
  const ordersMatchedClean = rows.filter((r) => r.mpStatus === "matched_clean").length;
  const ordersMatchedWithEvents = rows.filter((r) => r.mpStatus === "matched_with_post_events").length;
  const ordersDivergent = rows.filter((r) => r.mpStatus === "divergent" || r.mpStatus === "order_gross_divergent").length;
  const ordersMissing = rows.filter((r) => r.mpStatus === "payment_missing" || r.mpStatus === "settlement_missing").length;
  const ordersAmbiguous = rows.filter((r) => r.mpStatus === "shared_payment_ambiguous" || r.mpStatus === "settlement_ambiguous").length;
  // Hardening final MP3 (ponto 2) — contado À PARTE de ordersMissing: cobertura
  // parcial/pending nunca deve ser lida como ausência definitiva.
  const ordersSettlementPending = rows.filter((r) => r.mpStatus === "settlement_pending").length;

  // Elegível = entra no resultado operacional (mpStatus !== not_applicable).
  // Coberto = de fato produziu resultadoConciliadoMpBase. coveragePercent é
  // SEMPRE sobre os elegíveis — nunca sobre ordersTotal (evita diluir a
  // cobertura com pedidos cancelados/fora do resultado, seção 11/15).
  const elegiveis = rows.filter((r) => r.mpStatus !== "not_applicable");
  const cobertos = rows.filter((r) => r.incluidoNoResultadoConciliado);
  const coveragePercent = elegiveis.length ? round2((cobertos.length / elegiveis.length) * 100) : 0;

  const paymentsList = reconciliationRows || [];
  const paymentsUnique = paymentsList.length;
  const paymentsMatched = paymentsList.filter((r) => r.reconciliationStatus === "matched").length;
  const paymentsSettlementPending = paymentsList.filter((r) => r.reconciliationStatus === "settlement_pending").length;
  const paymentsReleased = paymentsList.filter((r) => r.moneyReleaseStatus === "released").length;
  // "Pendente" agrupa pending + unknown (nunca assume liberado por omissão
  // — seção 9): só existem 2 baldes no agregado (seção 11 do spec MP3).
  const paymentsPendingRelease = paymentsUnique - paymentsReleased;

  const totalPaymentGross = round2(paymentsList.reduce((acc, r) => acc + (typeof r.paymentTransactionAmount === "number" ? r.paymentTransactionAmount : 0), 0));
  const totalPaymentNet = round2(paymentsList.reduce((acc, r) => acc + (typeof r.paymentNetReceivedAmount === "number" ? r.paymentNetReceivedAmount : 0), 0));
  const totalSettlementNet = round2(paymentsList.reduce((acc, r) => acc + (typeof r.settlementNetAmount === "number" ? r.settlementNetAmount : 0), 0));

  const resultadoOperacionalDosOrdersCobertos = cobertos.length
    ? round2(cobertos.reduce((acc, r) => acc + (r.resultadoOperacional ?? 0), 0))
    : null;
  const resultadoConciliadoDosOrdersCobertos = cobertos.length
    ? round2(cobertos.reduce((acc, r) => acc + (r.resultadoConciliadoMpBase ?? 0), 0))
    : null;
  const deltaResultadoDosOrdersCobertos = cobertos.length
    ? round2(resultadoConciliadoDosOrdersCobertos - resultadoOperacionalDosOrdersCobertos)
    : null;

  const postMovementTypeCounts = {};
  for (const [tipo, contagem] of Object.entries(transactionTypeCounts || {})) {
    if (tipo === "SETTLEMENT") continue;
    postMovementTypeCounts[tipo] = contagem;
  }
  const postMovementsCount = Object.values(postMovementTypeCounts).reduce((acc, n) => acc + n, 0);

  return {
    ordersTotal, ordersComPayment, ordersMatchedClean, ordersMatchedWithEvents,
    ordersDivergent, ordersMissing, ordersAmbiguous, ordersSettlementPending, coveragePercent,
    paymentsUnique, paymentsMatched, paymentsSettlementPending,
    totalPaymentGross, totalPaymentNet, totalSettlementNet,
    resultadoOperacionalDosOrdersCobertos, resultadoConciliadoDosOrdersCobertos, deltaResultadoDosOrdersCobertos,
    paymentsReleased, paymentsPendingRelease,
    postMovementsCount, postMovementTypeCounts,
  };
}

// Função PURA principal — sem I/O. `pedidos` no contrato canônico
// (buildPedidoContrato: id/rowId/valor/custo/imposto/resultado/
// entraNoResultado); `reconciliationRows` = saída de
// centralVendasMpReconciliationService.reconcilePayments(...).rows;
// `transactionTypeCounts` = a mesma saída .summary.transactionTypeCounts
// (reaproveitado, nunca recalculado — seção 26 do spec MP2/11 do MP3).
function computeResultadoConciliadoMp({ pedidos, reconciliationRows, transactionTypeCounts }) {
  const rowsByOrderId = new Map();
  for (const row of reconciliationRows || []) {
    const orderIds = Array.isArray(row.orderIds) && row.orderIds.length ? row.orderIds : (row.orderId != null ? [row.orderId] : []);
    for (const orderId of orderIds) {
      if (!rowsByOrderId.has(orderId)) rowsByOrderId.set(orderId, []);
      rowsByOrderId.get(orderId).push(row);
    }
  }

  const rows = (pedidos || []).map((pedido) => computeOrderMpReconciliation(pedido, rowsByOrderId.get(pedido.id) || []));
  const summary = buildResumoAgregado(rows, reconciliationRows, transactionTypeCounts);

  return { rows, summary };
}

module.exports = {
  computeResultadoConciliadoMp,
  computeOrderMpReconciliation,
  ORDER_GROSS_TOLERANCE,
};
