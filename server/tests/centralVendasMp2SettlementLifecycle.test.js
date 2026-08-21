// server/tests/centralVendasMp2SettlementLifecycle.test.js
//
// MP2 — centralVendasMpSettlementReportService.ensureSettlementReportForRun:
// lifecycle assincrono (requested -> pending -> processed -> imported),
// idempotencia por sync_run_id, polling bounded, filename sanitizado.
// Endpoints validados no handoff (seções 16-18):
//   POST /v1/account/settlement_report                        -> 202 pending
//   GET  /v1/account/settlement_report/search?id={reportId}
//   GET  /v1/account/settlement_report/{file_name}             -> CSV

const assert = require("assert");
const { createCentralVendasMpSettlementReportService } = require("../services/centralVendas/centralVendasMpSettlementReportService");
const { makeMpSettlementFakeDb } = require("./helpers/mpSettlementFakeDb");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

const CSV_FIXTURE =
  "SOURCE_ID;TRANSACTION_TYPE;TRANSACTION_AMOUNT;FEE_AMOUNT;SETTLEMENT_NET_AMOUNT;REAL_AMOUNT;ORDER_ID;SHIPPING_ID;MONEY_RELEASE_DATE\n" +
  "174959925172;SETTLEMENT;34,90;-12,49;22,41;22,41;2000018051653738;;2026-09-18T12:36:32.000-04:00\n";

function baseArgs(db) {
  return {
    syncRunId: 1, clienteId: 9, clienteContaId: 5, externalAccountId: "111", sellerId: "111",
    dateFrom: "2026-08-01", dateTo: "2026-08-31", db,
  };
}

async function run() {
  // 5/6/7/8 — POST -> 202 pending, reportId persistido, search continua
  // pending, polling bounded (nunca trava esperando indefinidamente).
  {
    const db = makeMpSettlementFakeDb();
    const genCalls = [];
    const searchCalls = [];
    const mpFetchFn = async (clienteId, path, options) => {
      if (path === "/v1/account/settlement_report") {
        genCalls.push(1);
        return { ok: true, status: 202, data: { id: "102875955", status: "pending", report_type: "settlement", format: "CSV", currency_id: "BRL" } };
      }
      if (path.startsWith("/v1/account/settlement_report/search")) {
        searchCalls.push(1);
        return { ok: true, status: 200, data: { id: 102875955, status: "pending" } };
      }
      throw new Error(`path inesperado: ${path}`);
    };
    let sleepCalls = 0;
    const service = createCentralVendasMpSettlementReportService({
      mpFetchFn,
      ensureSettlementConfigFn: async () => ({ compatible: true, created: false }),
      sleepFn: async () => { sleepCalls += 1; },
      repo: require("../services/centralVendas/centralVendasMpSettlementRepository"),
      pollAttempts: 2,
      pollDelayMs: 10,
    });

    const result = await service.ensureSettlementReportForRun(baseArgs(db));

    eq("5: POST gerou report (202 pending)", genCalls.length, 1);
    eq("6: reportExternalId persistido", result.reportExternalId, "102875955");
    eq("7: status final pending (search nunca virou processed)", result.status, "pending");
    ok("8: polling bounded — no maximo 2 tentativas de search", searchCalls.length === 2);
    ok("8: sleep chamado entre tentativas, nunca apos a ultima", sleepCalls === 1);
    eq("db: 1 report persistido", db.reports.length, 1);
  }

  // 9 — refresh posterior (segunda chamada) continua o MESMO report: nunca
  // gera um segundo POST/report externo. Neste segundo ciclo o search ja
  // responde processed -> dispara download+import (10/11).
  {
    const db = makeMpSettlementFakeDb();
    let genCallCount = 0;
    let fase = "pending";
    const mpFetchFn = async (clienteId, path) => {
      if (path === "/v1/account/settlement_report") {
        genCallCount += 1;
        return { ok: true, status: 202, data: { id: "R1", status: "pending", report_type: "settlement", format: "CSV", currency_id: "BRL" } };
      }
      if (path.startsWith("/v1/account/settlement_report/search")) {
        if (fase === "pending") return { ok: true, status: 200, data: { id: "R1", status: "pending" } };
        return { ok: true, status: 200, data: { id: "R1", status: "processed", file_name: "venforce-settlement-manual-2026-08-21-135759.csv" } };
      }
      throw new Error(`path inesperado: ${path}`);
    };
    const mpFetchTextCalls = [];
    const mpFetchTextFn = async (clienteId, path, options) => {
      mpFetchTextCalls.push({ path, mlUserId: options?.mlUserId });
      return { ok: true, status: 200, data: CSV_FIXTURE };
    };
    const service = createCentralVendasMpSettlementReportService({
      mpFetchFn, mpFetchTextFn,
      ensureSettlementConfigFn: async () => ({ compatible: true, created: false }),
      sleepFn: async () => {},
      repo: require("../services/centralVendas/centralVendasMpSettlementRepository"),
      pollAttempts: 1,
      pollDelayMs: 1,
    });

    const args = baseArgs(db);
    const r1 = await service.ensureSettlementReportForRun(args);
    eq("primeira chamada: pending", r1.status, "pending");
    eq("primeira chamada: 1 report gerado", genCallCount, 1);

    fase = "processed";
    const r2 = await service.refreshSettlementReport(args);
    eq("9: refresh NAO gera um segundo report (genCallCount continua 1)", genCallCount, 1);
    eq("9: mesmo reportExternalId (R1)", r2.reportExternalId, "R1");
    eq("10: status final imported (processed -> baixado -> importado)", r2.status, "imported");
    ok("10: file_name persistido", r2.fileName === "venforce-settlement-manual-2026-08-21-135759.csv");
    eq("11: download disparado 1x", mpFetchTextCalls.length, 1);
    eq("12: path de download e relativo (host fixo fica a cargo do mercadoPagoClient)", mpFetchTextCalls[0].path, "/v1/account/settlement_report/venforce-settlement-manual-2026-08-21-135759.csv");
    eq("11: movimento importado com os valores do CSV", db.movements.length, 1);
    eq("11: rows_count refletido no report", r2.rowsCount, 1);

    // 45 — chamar de novo (idempotente): ja esta 'imported', devolve como
    // esta sem nenhuma chamada nova a API.
    const chamadasAntes = mpFetchTextCalls.length;
    const r3 = await service.ensureSettlementReportForRun(args);
    eq("45: estado terminal 'imported' devolvido sem nova chamada", r3.status, "imported");
    eq("45: nenhuma nova chamada de download", mpFetchTextCalls.length, chamadasAntes);
    eq("45: continua 1 unico report para o run", db.reports.length, 1);
  }

  // 13 — filename invalido (path traversal) e BLOQUEADO antes do download.
  {
    const db = makeMpSettlementFakeDb();
    const mpFetchFn = async (clienteId, path) => {
      if (path === "/v1/account/settlement_report") {
        return { ok: true, status: 202, data: { id: "R2", status: "pending" } };
      }
      if (path.startsWith("/v1/account/settlement_report/search")) {
        return { ok: true, status: 200, data: { id: "R2", status: "processed", file_name: "../../../etc/passwd" } };
      }
      throw new Error(`path inesperado: ${path}`);
    };
    let downloadChamado = false;
    const mpFetchTextFn = async () => { downloadChamado = true; return { ok: true, status: 200, data: "" }; };
    const service = createCentralVendasMpSettlementReportService({
      mpFetchFn, mpFetchTextFn,
      ensureSettlementConfigFn: async () => ({ compatible: true, created: false }),
      sleepFn: async () => {},
      repo: require("../services/centralVendas/centralVendasMpSettlementRepository"),
      pollAttempts: 1,
      pollDelayMs: 1,
    });
    const result = await service.ensureSettlementReportForRun(baseArgs(db));
    eq("13: status failed", result.status, "failed");
    eq("13: errorCode SETTLEMENT_FILE_NAME_INVALID", result.errorCode, "SETTLEMENT_FILE_NAME_INVALID");
    ok("13: download NUNCA chamado com filename invalido", !downloadChamado);
  }

  // Config incompativel: registra SETTLEMENT_CONFIG_INCOMPATIBLE, nunca gera
  // report externo (nenhuma chamada a POST settlement_report).
  {
    const db = makeMpSettlementFakeDb();
    let genChamado = false;
    const mpFetchFn = async (clienteId, path) => {
      if (path === "/v1/account/settlement_report") { genChamado = true; return { ok: true, status: 202, data: { id: "X" } }; }
      throw new Error(`nao deveria chamar ${path}`);
    };
    const service = createCentralVendasMpSettlementReportService({
      mpFetchFn,
      ensureSettlementConfigFn: async () => ({ compatible: false, reason: "incompatible", missingColumns: ["SHIPPING_ID"] }),
      sleepFn: async () => {},
      repo: require("../services/centralVendas/centralVendasMpSettlementRepository"),
    });
    const result = await service.ensureSettlementReportForRun(baseArgs(db));
    eq("config incompativel: status failed", result.status, "failed");
    eq("config incompativel: errorCode", result.errorCode, "SETTLEMENT_CONFIG_INCOMPATIBLE");
    ok("config incompativel: SHIPPING_ID mencionado no erro", result.errorMessage.includes("SHIPPING_ID"));
    ok("config incompativel: nunca gera report externo", !genChamado);
  }

  console.log(`centralVendasMp2SettlementLifecycle.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
