// server/services/centralVendas/centralVendasMpSettlementReportService.js
// MP2 — Lifecycle do Settlement Report: ensure/gerar -> poll bounded ->
// download -> parse -> importar. Único ponto de entrada idempotente,
// reaproveitado tanto pelo Sync Worker (automação opcional — seção 29 do
// spec) quanto pelo endpoint operacional de start/refresh (seção 28).
//
// Endpoints validados no handoff (seções 14-18):
//   GET  /v1/account/settlement_report/config
//   POST /v1/account/settlement_report/config
//   POST /v1/account/settlement_report                       -> 202 pending
//   GET  /v1/account/settlement_report/search?id={reportId}
//   GET  /v1/account/settlement_report/{file_name}            -> CSV
//
// NUNCA gera um segundo report externo para o MESMO sync_run_id (UNIQUE em
// central_vendas_mp_settlement_reports.sync_run_id garante isso mesmo sob
// corrida). NUNCA bloqueia o Sync Worker indefinidamente: o polling é
// bounded (poucas tentativas/pouco tempo) — se continuar pending, persiste
// e encerra normalmente; quem chamar de novo (worker do próximo run, ou o
// endpoint de refresh) retoma o MESMO report.

const crypto = require("crypto");
const { mpFetch, mpFetchText } = require("../../utils/mercadoPagoClient");
const { ensureSettlementConfig } = require("./centralVendasMpSettlementConfigService");
const { parseSettlementCsv } = require("./centralVendasMpSettlementCsvParser");
const repository = require("./centralVendasMpSettlementRepository");

const SETTLEMENT_REPORT_PATH = "/v1/account/settlement_report";
const DEFAULT_POLL_ATTEMPTS = 2;
const DEFAULT_POLL_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Intervalo half-open: begin = dateFrom 00:00Z, end = dia SEGUINTE a dateTo
// 00:00Z — nunca perde o último dia do período (seção 6 do spec MP2).
// dateFrom/dateTo chegam como "YYYY-MM-DD" (mesmo formato do Sync Run).
function computeHalfOpenInterval(dateFrom, dateTo) {
  const begin = `${dateFrom}T00:00:00Z`;
  const [y, m, d] = String(dateTo).split("-").map(Number);
  const endDateUtc = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));
  const end = endDateUtc.toISOString().replace(/\.\d{3}Z$/, "Z");
  return { begin, end };
}

// file_name só pode ser usado como path dentro do host FIXO do Mercado Pago
// — nunca "../", nunca URL absoluta, nunca separador de diretório (seção 21
// do spec MP2). Charset deliberadamente restrito ao observado no handoff.
const FILE_NAME_SAFE = /^[A-Za-z0-9._-]+$/;
function sanitizeFileName(fileName) {
  const v = String(fileName || "").trim();
  if (!v || !FILE_NAME_SAFE.test(v) || v.includes("..")) return null;
  return v;
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

function createCentralVendasMpSettlementReportService({
  mpFetchFn = mpFetch,
  mpFetchTextFn = mpFetchText,
  ensureSettlementConfigFn = ensureSettlementConfig,
  parseSettlementCsvFn = parseSettlementCsv,
  sleepFn = sleep,
  repo = repository,
  pollAttempts = DEFAULT_POLL_ATTEMPTS,
  pollDelayMs = DEFAULT_POLL_DELAY_MS,
} = {}) {
  async function gerarReportExterno({ clienteId, sellerId, begin, end }) {
    return mpFetchFn(clienteId, SETTLEMENT_REPORT_PATH, {
      mlUserId: sellerId,
      method: "POST",
      body: JSON.stringify({ begin_date: begin, end_date: end }),
    });
  }

  async function consultarStatus({ clienteId, sellerId, reportExternalId }) {
    return mpFetchFn(
      clienteId,
      `${SETTLEMENT_REPORT_PATH}/search?id=${encodeURIComponent(reportExternalId)}`,
      { mlUserId: sellerId }
    );
  }

  // Poll bounded: no máximo `pollAttempts` consultas, `pollDelayMs` entre
  // elas. Nunca lança se continuar pending — devolve o último status visto
  // (seção 7 do spec: "se continuar pending: persistir pending, encerrar
  // normalmente, permitir retomar depois").
  async function pollStatusBounded({ clienteId, sellerId, reportExternalId }) {
    let ultimaResposta = null;
    for (let attempt = 1; attempt <= pollAttempts; attempt++) {
      ultimaResposta = await consultarStatus({ clienteId, sellerId, reportExternalId });
      if (ultimaResposta?.ok && ultimaResposta.data?.status === "processed") return ultimaResposta;
      if (attempt < pollAttempts) await sleepFn(pollDelayMs);
    }
    return ultimaResposta;
  }

  async function baixarEImportar({ reportRow, clienteId, sellerId, db }) {
    const fileName = sanitizeFileName(reportRow.fileName);
    if (!fileName) {
      return repo.updateSettlementReportStatus({
        id: reportRow.id, status: "failed",
        errorCode: "SETTLEMENT_FILE_NAME_INVALID",
        errorMessage: `file_name invalido/nao sanitizavel: "${String(reportRow.fileName || "").slice(0, 200)}"`,
      }, db);
    }

    const resp = await mpFetchTextFn(clienteId, `${SETTLEMENT_REPORT_PATH}/${fileName}`, { mlUserId: sellerId });
    if (!resp?.ok || typeof resp.data !== "string") {
      return repo.updateSettlementReportStatus({
        id: reportRow.id, status: "failed",
        errorCode: "SETTLEMENT_DOWNLOAD_FAILED",
        errorMessage: `download falhou (http ${resp?.status ?? "desconhecido"})`,
      }, db);
    }

    const csvText = resp.data;
    let parsed;
    try {
      parsed = await parseSettlementCsvFn(csvText);
    } catch (err) {
      // Falha no parse NUNCA destrói movimentos de uma importação anterior
      // válida (seção 23) — não chamamos replaceSettlementMovements aqui,
      // só marcamos o report como failed preservando o que já existia.
      return repo.updateSettlementReportStatus({
        id: reportRow.id, status: "failed",
        errorCode: "SETTLEMENT_PARSE_FAILED",
        errorMessage: err?.message || String(err),
      }, db);
    }

    await repo.replaceSettlementMovements({
      reportId: reportRow.id,
      syncRunId: reportRow.syncRunId,
      clienteContaId: reportRow.clienteContaId,
      movements: parsed.rows,
    }, db);

    return repo.updateSettlementReportStatus({
      id: reportRow.id,
      status: "imported",
      fileSha256: sha256Hex(csvText),
      rowsCount: parsed.rowsCount,
      downloadedAt: new Date().toISOString(),
      importedAt: new Date().toISOString(),
    }, db);
  }

  // Ponto de entrada único e idempotente. Sempre a partir da identidade
  // CONGELADA do Sync Run (clienteId/clienteContaId/sellerId/dateFrom/
  // dateTo já resolvidos por quem chama — nunca resolvido aqui de novo).
  async function ensureSettlementReportForRun({
    syncRunId, clienteId, clienteContaId, externalAccountId, sellerId, dateFrom, dateTo, db,
  }) {
    let reportRow = await repo.getSettlementReportByRun(syncRunId, db);

    // Estados terminais definitivos: nada a fazer, devolve como está.
    if (reportRow && (reportRow.status === "imported" || reportRow.status === "failed")) {
      return reportRow;
    }

    // Ainda não existe report para este run: checa config e gera.
    if (!reportRow) {
      const configResult = await ensureSettlementConfigFn({ clienteId, sellerId });

      if (!configResult.compatible) {
        if (configResult.reason !== "incompatible") {
          // Resposta que não parece config real nem 404 conhecido — aborta
          // sem persistir nada (nunca inventa incompatibilidade a partir de
          // um payload que a API real nunca devolveria).
          return null;
        }
        return repo.upsertSettlementReport({
          syncRunId, clienteId, clienteContaId, externalAccountId,
          status: "failed",
          errorCode: "SETTLEMENT_CONFIG_INCOMPATIBLE",
          errorMessage: `Config da conta sem colunas obrigatorias: ${configResult.missingColumns.join(", ")}`,
        }, db);
      }

      const { begin, end } = computeHalfOpenInterval(dateFrom, dateTo);
      const genResp = await gerarReportExterno({ clienteId, sellerId, begin, end });

      if (!genResp?.ok || genResp.data?.id == null) {
        return repo.upsertSettlementReport({
          syncRunId, clienteId, clienteContaId, externalAccountId,
          beginDate: begin, endDate: end,
          status: "failed",
          errorCode: "SETTLEMENT_GENERATION_FAILED",
          errorMessage: `POST settlement_report falhou (http ${genResp?.status ?? "desconhecido"})`,
        }, db);
      }

      reportRow = await repo.upsertSettlementReport({
        syncRunId, clienteId, clienteContaId, externalAccountId,
        reportExternalId: String(genResp.data.id),
        beginDate: begin, endDate: end,
        status: "pending",
        reportType: genResp.data.report_type || null,
        format: genResp.data.format || null,
        currencyId: genResp.data.currency_id || null,
        requestedAt: new Date().toISOString(),
      }, db);
    }

    // Report existe (recem-criado ou de uma chamada anterior) e ainda não
    // chegou a um estado terminal: consulta status com polling bounded.
    if (!reportRow.reportExternalId) return reportRow;

    const statusResp = await pollStatusBounded({
      clienteId, sellerId, reportExternalId: reportRow.reportExternalId,
    });

    if (!statusResp?.ok) {
      // Falha ao CONSULTAR não é falha do report em si — mantém pending,
      // permite retomar depois (nao perde o Payment/MP1 nem o report).
      return repo.updateSettlementReportStatus({ id: reportRow.id, status: "pending" }, db);
    }

    if (statusResp.data?.status !== "processed") {
      return repo.updateSettlementReportStatus({ id: reportRow.id, status: "pending" }, db);
    }

    reportRow = await repo.updateSettlementReportStatus({
      id: reportRow.id, status: "processed",
      fileName: statusResp.data.file_name || null,
      processedAt: new Date().toISOString(),
    }, db);

    if (!reportRow.fileName) return reportRow;

    return baixarEImportar({ reportRow, clienteId, sellerId, db });
  }

  return {
    ensureSettlementReportForRun,
    // Mesma função: reconsultar/retomar um report pending é só chamar de
    // novo — idempotente por construção (UNIQUE(sync_run_id) + estados
    // terminais nunca reabertos).
    refreshSettlementReport: ensureSettlementReportForRun,
  };
}

const defaultService = createCentralVendasMpSettlementReportService();

module.exports = {
  ensureSettlementReportForRun: defaultService.ensureSettlementReportForRun,
  refreshSettlementReport: defaultService.refreshSettlementReport,
  createCentralVendasMpSettlementReportService,
  computeHalfOpenInterval,
  sanitizeFileName,
  sha256Hex,
  DEFAULT_POLL_ATTEMPTS,
  DEFAULT_POLL_DELAY_MS,
};
