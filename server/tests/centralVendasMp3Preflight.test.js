// server/tests/centralVendasMp3Preflight.test.js
//
// MP3 — preflight obrigatório (seção 1 do spec MP3) antes da integração
// financeira propriamente dita:
//
//   1.1 — listMpPaymentsWithChargesTotalByRun/ByRunIds expõem status/
//         statusDetail/moneyReleaseStatus/moneyReleaseDate/
//         transactionAmountRefunded/refundCount (null preservado != zero),
//         e centralVendasMpReconciliationService repassa esses campos na row.
//   1.2 — retry seguro de report "failed" com reportExternalId já existente
//         (SETTLEMENT_DOWNLOAD_FAILED/SETTLEMENT_PARSE_FAILED) — nunca um
//         novo POST; SETTLEMENT_CONFIG_INCOMPATIBLE/SETTLEMENT_FILE_NAME_
//         INVALID continuam terminais; SETTLEMENT_GENERATION_FAILED sem
//         reportExternalId nunca é retomado automaticamente.
//   1.3 — config 404 só é tratada como "não encontrada" com o erro
//         documentado (config_not_found_for_user) — outro 404 nunca dispara
//         criação automática de config.

const assert = require("assert");
const {
  listMpPaymentsWithChargesTotalByRun,
  listMpPaymentsWithChargesTotalByRunIds,
} = require("../services/centralVendas/centralVendasMpPaymentsRepository");
const { reconcilePayments } = require("../services/centralVendas/centralVendasMpReconciliationService");
const { createCentralVendasMpSettlementReportService } = require("../services/centralVendas/centralVendasMpSettlementReportService");
const { createCentralVendasMpSettlementConfigService, REQUIRED_COLUMNS } = require("../services/centralVendas/centralVendasMpSettlementConfigService");
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

function makePaymentsReadFakeDb({ payments = [], charges = [] }) {
  let queryCount = 0;
  return {
    get queryCount() { return queryCount; },
    async query(sql, params = []) {
      queryCount += 1;
      if (sql.includes("FROM central_vendas_mp_payments p") && sql.includes("LEFT JOIN central_vendas_mp_payment_charges")) {
        let rows;
        if (sql.includes("sync_run_id = ANY(")) {
          const ids = (params[0] || []).map(Number);
          rows = payments.filter((p) => ids.includes(Number(p.sync_run_id)));
        } else {
          const [syncRunId] = params;
          rows = payments.filter((p) => p.sync_run_id === syncRunId);
        }
        rows = rows
          .slice()
          .sort((a, b) => a.id - b.id)
          .map((p) => {
            const chargesTotal = charges
              .filter((c) => c.mp_payment_row_id === p.id)
              .reduce((s, c) => s + (c.amount_original || 0), 0);
            return { ...p, charges_total: chargesTotal };
          });
        return { rows };
      }
      throw new Error(`Fake db: SQL nao mapeado -> ${sql.slice(0, 160)}`);
    },
  };
}

function paymentRowFixture(overrides = {}) {
  return {
    id: 1,
    sync_run_id: 10,
    cliente_conta_id: 5,
    order_id: "O1",
    order_ids_json: ["O1"],
    payment_id: "P1",
    status: "approved",
    status_detail: "accredited",
    transaction_amount: 34.90,
    transaction_amount_refunded: 0,
    net_received_amount: 22.41,
    money_release_date: "2026-09-18T12:36:32.000-04:00",
    money_release_status: "pending",
    refund_count: 0,
    ...overrides,
  };
}

async function run() {
  // ── 1.1 ──────────────────────────────────────────────────────────────
  {
    const db = makePaymentsReadFakeDb({
      payments: [paymentRowFixture()],
      charges: [{ mp_payment_row_id: 1, amount_original: 12.49 }],
    });
    const [row] = await listMpPaymentsWithChargesTotalByRun(10, db);
    eq("1.1: status exposto", row.status, "approved");
    eq("1.1: statusDetail exposto", row.statusDetail, "accredited");
    eq("1.1: moneyReleaseStatus exposto", row.moneyReleaseStatus, "pending");
    eq("1.1: moneyReleaseDate exposto", row.moneyReleaseDate, "2026-09-18T12:36:32.000-04:00");
    eq("1.1: transactionAmountRefunded=0 preservado (zero real, nao null)", row.transactionAmountRefunded, 0);
    eq("1.1: refundCount=0 preservado (zero real, nao null)", row.refundCount, 0);
    eq("1.1: chargesTotal somado", row.chargesTotal, 12.49);
  }

  // Ausência continua NULL (nunca vira zero/string vazia).
  {
    const db = makePaymentsReadFakeDb({
      payments: [paymentRowFixture({
        id: 2, status: null, status_detail: null, money_release_status: null,
        money_release_date: null, transaction_amount_refunded: null, refund_count: null,
      })],
      charges: [],
    });
    const [row] = await listMpPaymentsWithChargesTotalByRun(10, db);
    ok("1.1: status ausente -> null", row.status === null);
    ok("1.1: moneyReleaseStatus ausente -> null", row.moneyReleaseStatus === null);
    ok("1.1: moneyReleaseDate ausente -> null", row.moneyReleaseDate === null);
    ok("1.1: transactionAmountRefunded ausente -> null (nunca 0)", row.transactionAmountRefunded === null);
    ok("1.1: refundCount ausente -> null (nunca 0)", row.refundCount === null);
    eq("1.1: chargesTotal sem charge nenhuma -> 0 real", row.chargesTotal, 0);
  }

  // Bulk por array de sync_run_ids — 1 UNICA query para N runs (seção 13).
  {
    const db = makePaymentsReadFakeDb({
      payments: [
        paymentRowFixture({ id: 1, sync_run_id: 10, payment_id: "P1" }),
        paymentRowFixture({ id: 2, sync_run_id: 11, payment_id: "P2" }),
        paymentRowFixture({ id: 3, sync_run_id: 99, payment_id: "P-OUTRO-RUN" }),
      ],
      charges: [],
    });
    const rows = await listMpPaymentsWithChargesTotalByRunIds([10, 11], db);
    eq("bulk: 1 unica query para 2 runs", db.queryCount, 1);
    eq("bulk: so payments dos runs pedidos", rows.map((r) => r.paymentId).sort(), ["P1", "P2"]);
  }
  {
    const db = makePaymentsReadFakeDb({ payments: [], charges: [] });
    const rows = await listMpPaymentsWithChargesTotalByRunIds([], db);
    eq("bulk: array vazio -> [] sem tocar o banco", rows, []);
    eq("bulk: nenhuma query disparada para array vazio", db.queryCount, 0);
  }

  // reconcilePayments repassa moneyReleaseStatus/moneyReleaseDate/refundCount/
  // paymentStatus/paymentTransactionAmountRefunded na row (seção 9 do spec MP3
  // — conciliação nunca decide sozinha a partir disso, só expõe evidência).
  {
    const payments = [{
      paymentId: "P1", orderId: "O1", orderIds: ["O1"],
      status: "approved", statusDetail: "accredited",
      transactionAmount: 100, transactionAmountRefunded: 0, netReceivedAmount: 90,
      moneyReleaseStatus: "released", moneyReleaseDate: "2026-08-20T00:00:00Z", refundCount: 0,
      chargesTotal: 10,
    }];
    const movements = [{ sourceId: "P1", transactionType: "SETTLEMENT", transactionAmount: 100, feeAmount: -10, settlementNetAmount: 90 }];
    const { rows } = reconcilePayments({ payments, movements });
    eq("reconciliation row: paymentStatus", rows[0].paymentStatus, "approved");
    eq("reconciliation row: moneyReleaseStatus", rows[0].moneyReleaseStatus, "released");
    eq("reconciliation row: moneyReleaseDate", rows[0].moneyReleaseDate, "2026-08-20T00:00:00Z");
    eq("reconciliation row: refundCount", rows[0].refundCount, 0);
    eq("reconciliation row: paymentTransactionAmountRefunded", rows[0].paymentTransactionAmountRefunded, 0);
  }

  // ── 1.2 ──────────────────────────────────────────────────────────────
  function baseArgs(db, syncRunId = 1) {
    return {
      syncRunId, clienteId: 9, clienteContaId: 5, externalAccountId: "111", sellerId: "111",
      dateFrom: "2026-08-01", dateTo: "2026-08-31", db,
    };
  }

  // SETTLEMENT_DOWNLOAD_FAILED com reportExternalId -> retoma o MESMO
  // report (sem novo POST), reconsulta status e tenta o download de novo.
  {
    const db = makeMpSettlementFakeDb();
    // Semeia um report "failed" com reportExternalId já existente (simula
    // uma tentativa anterior que passou do POST e falhou no download).
    db.reports.push({
      id: 1, sync_run_id: 1, cliente_id: 9, cliente_conta_id: 5, external_account_id: "111",
      report_external_id: "R1", begin_date: null, end_date: null, status: "failed",
      report_type: "settlement", format: "CSV", currency_id: "BRL", file_name: "venforce-settlement-x.csv",
      file_sha256: null, rows_count: null, error_code: "SETTLEMENT_DOWNLOAD_FAILED", error_message: "download falhou (http 500)",
      requested_at: "2026-08-21T00:00:00Z", processed_at: "2026-08-21T00:00:00Z", downloaded_at: null, imported_at: null,
    });

    let genChamado = false;
    let searchChamado = 0;
    const mpFetchFn = async (clienteId, path) => {
      if (path === "/v1/account/settlement_report") { genChamado = true; return { ok: true, status: 202, data: { id: "R1" } }; }
      if (path.startsWith("/v1/account/settlement_report/search")) {
        searchChamado += 1;
        return { ok: true, status: 200, data: { id: "R1", status: "processed", file_name: "venforce-settlement-x.csv" } };
      }
      throw new Error(`path inesperado: ${path}`);
    };
    const mpFetchTextCalls = [];
    const mpFetchTextFn = async (clienteId, path) => {
      mpFetchTextCalls.push(path);
      return {
        ok: true, status: 200,
        data: "SOURCE_ID;TRANSACTION_TYPE;TRANSACTION_AMOUNT;FEE_AMOUNT;SETTLEMENT_NET_AMOUNT;REAL_AMOUNT;ORDER_ID;SHIPPING_ID;MONEY_RELEASE_DATE\n"
          + "P1;SETTLEMENT;34,90;-12,49;22,41;22,41;O1;;2026-09-18T12:36:32.000-04:00\n",
      };
    };
    const service = createCentralVendasMpSettlementReportService({
      mpFetchFn, mpFetchTextFn,
      ensureSettlementConfigFn: async () => { throw new Error("nunca deveria checar config de novo para retomar report existente"); },
      sleepFn: async () => {},
      repo: require("../services/centralVendas/centralVendasMpSettlementRepository"),
      pollAttempts: 1, pollDelayMs: 1,
    });

    const result = await service.ensureSettlementReportForRun(baseArgs(db));
    ok("1.2 DOWNLOAD_FAILED: nunca gera um novo POST", !genChamado);
    ok("1.2 DOWNLOAD_FAILED: reconsulta o MESMO reportExternalId", searchChamado === 1);
    eq("1.2 DOWNLOAD_FAILED: retomou e importou com sucesso", result.status, "imported");
    eq("1.2 DOWNLOAD_FAILED: mesmo reportExternalId (R1)", result.reportExternalId, "R1");
    eq("1.2 DOWNLOAD_FAILED: 1 unico report para o run (nunca duplicou)", db.reports.length, 1);
  }

  // SETTLEMENT_PARSE_FAILED com reportExternalId -> retoma (redownload+reparse).
  {
    const db = makeMpSettlementFakeDb();
    db.reports.push({
      id: 1, sync_run_id: 1, cliente_id: 9, cliente_conta_id: 5, external_account_id: "111",
      report_external_id: "R2", begin_date: null, end_date: null, status: "failed",
      report_type: "settlement", format: "CSV", currency_id: "BRL", file_name: "venforce-settlement-y.csv",
      file_sha256: null, rows_count: null, error_code: "SETTLEMENT_PARSE_FAILED", error_message: "csv invalido",
      requested_at: "2026-08-21T00:00:00Z", processed_at: "2026-08-21T00:00:00Z", downloaded_at: null, imported_at: null,
    });
    let genChamado = false;
    const mpFetchFn = async (clienteId, path) => {
      if (path === "/v1/account/settlement_report") { genChamado = true; return { ok: true, status: 202, data: { id: "R2" } }; }
      if (path.startsWith("/v1/account/settlement_report/search")) {
        return { ok: true, status: 200, data: { id: "R2", status: "processed", file_name: "venforce-settlement-y.csv" } };
      }
      throw new Error(`path inesperado: ${path}`);
    };
    const mpFetchTextFn = async () => ({
      ok: true, status: 200,
      data: "SOURCE_ID;TRANSACTION_TYPE;TRANSACTION_AMOUNT;FEE_AMOUNT;SETTLEMENT_NET_AMOUNT;REAL_AMOUNT;ORDER_ID;SHIPPING_ID;MONEY_RELEASE_DATE\n"
        + "P2;SETTLEMENT;10,00;-1,00;9,00;9,00;O2;;2026-09-18T12:36:32.000-04:00\n",
    });
    const service = createCentralVendasMpSettlementReportService({
      mpFetchFn, mpFetchTextFn,
      ensureSettlementConfigFn: async () => { throw new Error("nao deveria checar config de novo"); },
      sleepFn: async () => {},
      repo: require("../services/centralVendas/centralVendasMpSettlementRepository"),
      pollAttempts: 1, pollDelayMs: 1,
    });
    const result = await service.ensureSettlementReportForRun(baseArgs(db));
    ok("1.2 PARSE_FAILED: nunca gera um novo POST", !genChamado);
    eq("1.2 PARSE_FAILED: retomou e importou com sucesso", result.status, "imported");
    eq("1.2 PARSE_FAILED: 1 unico report para o run", db.reports.length, 1);
  }

  // SETTLEMENT_CONFIG_INCOMPATIBLE continua terminal — nenhuma chamada nova.
  {
    const db = makeMpSettlementFakeDb();
    db.reports.push({
      id: 1, sync_run_id: 1, cliente_id: 9, cliente_conta_id: 5, external_account_id: "111",
      report_external_id: null, status: "failed", error_code: "SETTLEMENT_CONFIG_INCOMPATIBLE",
      error_message: "faltando coluna", file_name: null, file_sha256: null, rows_count: null,
      requested_at: null, processed_at: null, downloaded_at: null, imported_at: null,
      begin_date: null, end_date: null, report_type: null, format: null, currency_id: null,
    });
    let chamouAlgo = false;
    const service = createCentralVendasMpSettlementReportService({
      mpFetchFn: async () => { chamouAlgo = true; return { ok: true }; },
      ensureSettlementConfigFn: async () => { chamouAlgo = true; return { compatible: true }; },
      sleepFn: async () => {},
      repo: require("../services/centralVendas/centralVendasMpSettlementRepository"),
    });
    const result = await service.ensureSettlementReportForRun(baseArgs(db));
    eq("1.2 CONFIG_INCOMPATIBLE: continua terminal", result.status, "failed");
    eq("1.2 CONFIG_INCOMPATIBLE: errorCode preservado", result.errorCode, "SETTLEMENT_CONFIG_INCOMPATIBLE");
    ok("1.2 CONFIG_INCOMPATIBLE: nenhuma chamada nova (nem config, nem fetch)", !chamouAlgo);
  }

  // SETTLEMENT_FILE_NAME_INVALID continua terminal.
  {
    const db = makeMpSettlementFakeDb();
    db.reports.push({
      id: 1, sync_run_id: 1, cliente_id: 9, cliente_conta_id: 5, external_account_id: "111",
      report_external_id: "R3", status: "failed", error_code: "SETTLEMENT_FILE_NAME_INVALID",
      error_message: "nome invalido", file_name: "../../etc/passwd", file_sha256: null, rows_count: null,
      requested_at: null, processed_at: null, downloaded_at: null, imported_at: null,
      begin_date: null, end_date: null, report_type: null, format: null, currency_id: null,
    });
    let chamouAlgo = false;
    const service = createCentralVendasMpSettlementReportService({
      mpFetchFn: async () => { chamouAlgo = true; return { ok: true }; },
      mpFetchTextFn: async () => { chamouAlgo = true; return { ok: true, data: "" }; },
      ensureSettlementConfigFn: async () => { chamouAlgo = true; return { compatible: true }; },
      sleepFn: async () => {},
      repo: require("../services/centralVendas/centralVendasMpSettlementRepository"),
    });
    const result = await service.ensureSettlementReportForRun(baseArgs(db));
    eq("1.2 FILE_NAME_INVALID: continua terminal", result.status, "failed");
    ok("1.2 FILE_NAME_INVALID: nenhuma chamada nova", !chamouAlgo);
  }

  // SETTLEMENT_GENERATION_FAILED (sem reportExternalId) nunca e retomado
  // automaticamente — continua terminal, nunca refaz o POST sozinho.
  {
    const db = makeMpSettlementFakeDb();
    db.reports.push({
      id: 1, sync_run_id: 1, cliente_id: 9, cliente_conta_id: 5, external_account_id: "111",
      report_external_id: null, status: "failed", error_code: "SETTLEMENT_GENERATION_FAILED",
      error_message: "POST falhou (http 500)", file_name: null, file_sha256: null, rows_count: null,
      requested_at: null, processed_at: null, downloaded_at: null, imported_at: null,
      begin_date: null, end_date: null, report_type: null, format: null, currency_id: null,
    });
    let postChamado = false;
    const service = createCentralVendasMpSettlementReportService({
      mpFetchFn: async (clienteId, path) => { if (path === "/v1/account/settlement_report") postChamado = true; return { ok: true, data: { id: "NOVO" } }; },
      ensureSettlementConfigFn: async () => ({ compatible: true, created: false }),
      sleepFn: async () => {},
      repo: require("../services/centralVendas/centralVendasMpSettlementRepository"),
    });
    const result = await service.ensureSettlementReportForRun(baseArgs(db));
    eq("1.2 GENERATION_FAILED sem reportExternalId: continua terminal", result.status, "failed");
    eq("1.2 GENERATION_FAILED: errorCode preservado", result.errorCode, "SETTLEMENT_GENERATION_FAILED");
    ok("1.2 GENERATION_FAILED: nunca refaz o POST sozinho", !postChamado);
  }

  // ── 1.3 ──────────────────────────────────────────────────────────────
  {
    // 404 com data.status===404 mas SEM o erro documentado -> nao cria
    // config (nunca dispara POST), nunca reporta como "incompatible" real.
    const calls = [];
    const mpFetchFn = async (clienteId, path, options) => {
      calls.push({ path, method: options?.method || "GET" });
      return { ok: false, status: 404, data: { message: "algo generico", status: 404 } };
    };
    const { ensureSettlementConfig } = createCentralVendasMpSettlementConfigService({ mpFetchFn });
    const r = await ensureSettlementConfig({ clienteId: 1, sellerId: "111" });
    eq("1.3: apenas 1 chamada (GET, NUNCA POST)", calls.length, 1);
    eq("1.3: compatible=false", r.compatible, false);
    eq("1.3: reason=http_error (nunca tratado como not-found)", r.reason, "http_error");
    eq("1.3: httpStatus propagado", r.httpStatus, 404);
  }
  {
    // erro documentado continua funcionando (regressao do cenario B do MP2).
    const calls = [];
    const mpFetchFn = async (clienteId, path, options) => {
      calls.push({ method: options?.method || "GET" });
      if (!options?.method || options.method === "GET") {
        return { ok: false, status: 404, data: { error: "config_not_found_for_user", status: 404 } };
      }
      return { ok: true, status: 200, data: { columns: REQUIRED_COLUMNS.map((key) => ({ key })) } };
    };
    const { ensureSettlementConfig } = createCentralVendasMpSettlementConfigService({ mpFetchFn });
    const r = await ensureSettlementConfig({ clienteId: 1, sellerId: "111" });
    eq("1.3: erro documentado ainda cria config (GET+POST)", calls.length, 2);
    eq("1.3: created=true", r.created, true);
  }

  console.log(`centralVendasMp3Preflight.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
