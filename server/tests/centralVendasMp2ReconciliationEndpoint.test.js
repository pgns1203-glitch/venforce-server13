// server/tests/centralVendasMp2ReconciliationEndpoint.test.js
//
// MP2 — GET .../sync-runs/:runId/mercado-pago/reconciliation (controller).
// IDOR-safe: reusa centralVendasSyncRunService.obterSyncRun (mesma porta de
// M2/M3, já testada em centralVendasSyncRuns.test.js) — runId de OUTRO
// cliente nunca é servido aqui, nunca uma segunda forma de acesso ao dado.
// Sem token/Authorization/dado de comprador na resposta (seção 27/31/44).

const assert = require("assert");
const Module = require("module");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function criarErroHttp(statusCode, mensagem) {
  const err = new Error(mensagem);
  err.statusCode = statusCode;
  return err;
}

// Carrega o controller com centralVendasSyncRunService.obterSyncRun e
// centralVendasMpReconciliationService.getReconciliationForRun estubados —
// exercita o CONTROLLER real (roteamento de erro/paginação/masking), não
// reimplementa a lógica de IDOR (essa já é do runService, testada à parte).
function carregarControllerComStubs({ obterSyncRunStub, getReconciliationStub }) {
  const originalLoad = Module._load;
  Module._load = function loadWithStub(request, parent, isMain) {
    if (request === "../services/centralVendas/centralVendasSyncRunService") {
      return { obterSyncRun: obterSyncRunStub };
    }
    if (request === "../services/centralVendas/centralVendasMpReconciliationService") {
      return { getReconciliationForRun: getReconciliationStub };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve("../controllers/centralVendasController")];
    return require("../controllers/centralVendasController");
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve("../controllers/centralVendasController")];
  }
}

async function run() {
  // 43 — runId de OUTRO cliente (obterSyncRun lança 404, mesma porta usada
  // por /:slug/sync-runs/:runId) -> controller devolve 404, nunca vaza dado.
  {
    const obterSyncRunStub = async ({ runId, clienteSlug }) => {
      if (clienteSlug !== "cliente-dono") throw criarErroHttp(404, "Sync run nao encontrado.");
      return { id: runId, clienteId: 1, clienteContaId: 5, externalAccountId: "111", dateFrom: "2026-08-01", dateTo: "2026-08-31" };
    };
    let getReconciliationChamado = false;
    const getReconciliationStub = async () => { getReconciliationChamado = true; return { report: null, rows: [], summary: {} }; };
    const controller = carregarControllerComStubs({ obterSyncRunStub, getReconciliationStub });

    const req = { params: { slug: "outro-cliente-tentando-acessar", runId: "1" }, query: {} };
    const res = fakeRes();
    await controller.obterMercadoPagoReconciliationController(req, res);

    eq("43: IDOR bloqueado -> 404", res.statusCode, 404);
    eq("43: ok=false", res.body.ok, false);
    ok("43: nunca chega a buscar reconciliation de um run de outro cliente", !getReconciliationChamado);
  }

  // 43b — mesmo clienteSlug do dono -> 200, dados servidos normalmente.
  {
    const obterSyncRunStub = async ({ runId, clienteSlug }) => {
      eq("43b: runId propagado corretamente", runId, 7);
      eq("43b: clienteSlug propagado corretamente", clienteSlug, "cliente-dono");
      return { id: runId, clienteId: 1, clienteContaId: 5, externalAccountId: "111", dateFrom: "2026-08-01", dateTo: "2026-08-31" };
    };
    const getReconciliationStub = async ({ run }) => {
      eq("43b: run resolvido repassado para o service de reconciliacao", run.id, 7);
      return {
        report: { reportExternalId: "R1", status: "imported", fileName: "x.csv", rowsCount: 1, beginDate: "2026-08-01T00:00:00Z", endDate: "2026-09-01T00:00:00Z", errorCode: null },
        rows: [{
          paymentId: "174959925172", orderId: "2000018051653738",
          paymentTransactionAmount: 34.90, paymentNetReceivedAmount: 22.41,
          settlementTransactionAmount: 34.90, settlementNetAmount: 22.41,
          grossMatch: true, netMatch: true, reconciliationStatus: "matched",
        }],
        summary: { paymentsCount: 1, paymentsMatched: 1 },
      };
    };
    const controller = carregarControllerComStubs({ obterSyncRunStub, getReconciliationStub });

    const req = { params: { slug: "cliente-dono", runId: "7" }, query: {} };
    const res = fakeRes();
    await controller.obterMercadoPagoReconciliationController(req, res);

    eq("dono: 200", res.statusCode, 200);
    eq("dono: ok=true", res.body.ok, true);
    eq("dono: report.id exposto", res.body.report.id, "R1");
    eq("dono: 1 row paginada", res.body.rows.length, 1);
    eq("dono: pagination.total", res.body.pagination.total, 1);

    // 44 — nunca token/Authorization/dado de comprador na resposta.
    const dump = JSON.stringify(res.body).toLowerCase();
    ok("44: nenhum access_token/Authorization na resposta", !dump.includes("access_token") && !dump.includes("authorization") && !dump.includes("bearer"));
    ok("44: nenhum campo de comprador (buyer/nickname/email) na resposta", !dump.includes("buyer") && !dump.includes("comprador"));
  }

  // 44 (POST settlement) — mesma proteção IDOR no endpoint operacional.
  {
    const obterSyncRunStub = async ({ clienteSlug }) => {
      if (clienteSlug !== "cliente-dono") throw criarErroHttp(404, "Sync run nao encontrado.");
      return { id: 7, clienteId: 1, clienteContaId: 5, externalAccountId: null, dateFrom: "2026-08-01", dateTo: "2026-08-31" };
    };
    const controller = carregarControllerComStubs({ obterSyncRunStub, getReconciliationStub: async () => ({}) });
    const req = { params: { slug: "outro-cliente", runId: "7" }, query: {} };
    const res = fakeRes();
    await controller.iniciarOuRetomarMercadoPagoSettlementController(req, res);
    eq("POST settlement tambem bloqueia IDOR -> 404", res.statusCode, 404);
  }

  console.log(`centralVendasMp2ReconciliationEndpoint.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
