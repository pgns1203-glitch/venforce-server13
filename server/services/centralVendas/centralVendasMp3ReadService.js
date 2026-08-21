// server/services/centralVendas/centralVendasMp3ReadService.js
// MP3 — Read API canônica e range-aware da conciliação Mercado Pago.
//
// Reaproveita integralmente `centralVendasService.resolveRangeContext`
// (mesma seleção M4/account-aware do resto da Central — nunca uma segunda
// implementação) e `buildPayloadFromRange` (contrato canônico de pedido,
// M5/M6). O que este arquivo adiciona é: derivar os sync_run_ids elegíveis
// daquele MESMO snapshot já resolvido (nunca "o último Sync Run do
// cliente" — seção 12 do spec MP3), carregar Payments/Settlement em BULK
// (1 query cada, nunca 1 por pedido — seção 13) e combinar com
// centralVendasMp3ResultadoConciliadoService (a fórmula financeira em si).
//
// mpReconciliationStatus é um eixo PRÓPRIO (seção 19 do spec MP3) — nunca
// entra em REQUIRED_SOURCES_BASE/completeness_status do run (M3).

const pool = require("../../config/database");

function getRepository() {
  return require("./centralVendasRepository");
}
function getMpPaymentsRepository() {
  return require("./centralVendasMpPaymentsRepository");
}
function getMpSettlementRepository() {
  return require("./centralVendasMpSettlementRepository");
}

const {
  createCentralVendasService,
  buildPayloadFromRange,
  buildContextoPayload,
} = require("./centralVendasService");
const { reconcilePayments } = require("./centralVendasMpReconciliationService");
const { computeResultadoConciliadoMp } = require("./centralVendasMp3ResultadoConciliadoService");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampPage(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
function clampLimit(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

// Deriva os sync_run_ids elegíveis do MESMO snapshot que a Read API já
// resolveu (snapshot.imports — seção 12 do spec MP3: nunca "o último run do
// cliente", sempre os imports/sync_runs realmente selecionados pelo M4 para
// o range/conta pedidos). Imports legados (pré-M2, sem sync_run_id) são
// ignorados aqui — nunca produzem Payment/Settlement, e isso é esperado.
function deriveSyncRunIds(snapshot) {
  const imports = (snapshot && snapshot.imports) || [];
  const ids = imports
    .map((row) => (row.sync_run_id != null ? Number(row.sync_run_id) : null))
    .filter((id) => Number.isFinite(id));
  return [...new Set(ids)];
}

// classificação simples e explícita (seção 8/19 do spec MP3) — nunca um
// booleano único escondendo o motivo.
function classificarMpReconciliationStatus({ syncRunIds, summary }) {
  if (!syncRunIds.length || summary.ordersTotal === 0) return "not_available";
  if (summary.paymentsUnique === 0) return "pending";
  if (summary.ordersDivergent > 0 || summary.ordersAmbiguous > 0) return "divergent";
  if (summary.coveragePercent >= 99.995) return "complete";
  return "partial";
}

function createCentralVendasMp3ReadService(
  repository = getRepository(),
  db = pool,
  mpPaymentsRepository = getMpPaymentsRepository(),
  mpSettlementRepository = getMpSettlementRepository()
) {
  const base = createCentralVendasService(repository, db);

  async function getMercadoPagoReconciliationForRange(clienteSlug, params = {}) {
    const { dateFrom, dateTo, marketplace = "meli", clienteContaId = null, page, limit } = params;

    const { cliente, context, snapshot, dateFrom: from, dateTo: to } =
      await base.resolveRangeContext(clienteSlug, { dateFrom, dateTo, marketplace, clienteContaId });

    const payload = buildPayloadFromRange(cliente, { dateFrom: from, dateTo: to }, snapshot);
    const pedidos = payload.pedidos || [];
    const syncRunIds = deriveSyncRunIds(snapshot);

    // Bulk por construção (seção 13 do spec MP3): 3 queries no TOTAL,
    // nunca 1 por pedido/por run — mesmo espírito de performance do M10.
    const [payments, movements, reports] = await Promise.all([
      mpPaymentsRepository.listMpPaymentsWithChargesTotalByRunIds(syncRunIds, db),
      mpSettlementRepository.listSettlementMovementsByRunIds(syncRunIds, db),
      mpSettlementRepository.listSettlementReportsByRunIds(syncRunIds, db),
    ]);

    const { rows: reconciliationRows, summary: mpSummary } = reconcilePayments({ payments, movements });
    const { rows, summary } = computeResultadoConciliadoMp({
      pedidos,
      reconciliationRows,
      transactionTypeCounts: mpSummary.transactionTypeCounts,
    });

    const mpReconciliationStatus = classificarMpReconciliationStatus({ syncRunIds, summary });

    const pageClamped = clampPage(page);
    const limitClamped = clampLimit(limit);
    const total = rows.length;
    const totalPages = total ? Math.ceil(total / limitClamped) : 0;
    const inicio = (pageClamped - 1) * limitClamped;
    const pageRows = rows.slice(inicio, inicio + limitClamped);

    return {
      ok: true,
      cliente,
      periodo: payload.periodo,
      contexto: buildContextoPayload(context),
      mpReconciliationStatus,
      summary,
      reports: reports.map((r) => ({
        syncRunId: r.syncRunId, status: r.status, fileName: r.fileName,
        rowsCount: r.rowsCount, errorCode: r.errorCode,
      })),
      rows: pageRows,
      pagination: { page: pageClamped, limit: limitClamped, total, totalPages },
    };
  }

  return { getMercadoPagoReconciliationForRange };
}

module.exports = {
  createCentralVendasMp3ReadService,
  getMercadoPagoReconciliationForRange: (...args) =>
    createCentralVendasMp3ReadService().getMercadoPagoReconciliationForRange(...args),
  deriveSyncRunIds,
  classificarMpReconciliationStatus,
};
