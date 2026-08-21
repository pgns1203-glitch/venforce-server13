// server/tests/centralVendasMp3ReadEndpoint.test.js
//
// MP3 — GET /:slug/read/mercado-pago/reconciliation (controller). Prova que
// o controller repassa slug/query corretamente ao service e nunca vaza
// token/Authorization/dado de comprador na resposta (mesmo padrão de
// centralVendasMp2ReconciliationEndpoint.test.js).

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

function carregarControllerComStub(getMercadoPagoReconciliationForRangeStub) {
  const originalLoad = Module._load;
  Module._load = function loadWithStub(request, parent, isMain) {
    if (request === "../services/centralVendas/centralVendasMp3ReadService") {
      return { getMercadoPagoReconciliationForRange: getMercadoPagoReconciliationForRangeStub };
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
  // Repasse correto de slug + query params.
  {
    const stub = async (slug, params) => {
      eq("slug propagado", slug, "cliente-a");
      eq("dateFrom propagado", params.dateFrom, "2026-08-01");
      eq("dateTo propagado", params.dateTo, "2026-08-31");
      eq("clienteContaId propagado", params.clienteContaId, "10");
      return {
        ok: true, rows: [{ orderId: "O1", paymentIds: ["P1"], mpStatus: "matched_clean" }],
        summary: { ordersTotal: 1 }, mpReconciliationStatus: "complete",
        reports: [{ syncRunId: 501, status: "imported" }],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      };
    };
    const controller = carregarControllerComStub(stub);
    const req = { params: { slug: "cliente-a" }, query: { dateFrom: "2026-08-01", dateTo: "2026-08-31", clienteContaId: "10" } };
    const res = fakeRes();
    await controller.obterCentralVendasReadMercadoPagoReconciliation(req, res);
    eq("200", res.statusCode, 200);
    eq("ok=true", res.body.ok, true);
    eq("1 row", res.body.rows.length, 1);
  }

  // slug ausente -> 400, nunca chama o service.
  {
    let chamado = false;
    const controller = carregarControllerComStub(async () => { chamado = true; return {}; });
    const req = { params: { slug: "" }, query: {} };
    const res = fakeRes();
    await controller.obterCentralVendasReadMercadoPagoReconciliation(req, res);
    eq("slug ausente -> 400", res.statusCode, 400);
    ok("service nunca chamado sem slug", !chamado);
  }

  // Nunca vaza token/Authorization/dado de comprador na resposta.
  {
    const stub = async () => ({
      ok: true,
      rows: [{ orderId: "O1", mpStatus: "matched_clean", moneyReleaseStatus: "released" }],
      summary: { ordersTotal: 1 },
      mpReconciliationStatus: "complete",
      reports: [],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });
    const controller = carregarControllerComStub(stub);
    const req = { params: { slug: "cliente-a" }, query: {} };
    const res = fakeRes();
    await controller.obterCentralVendasReadMercadoPagoReconciliation(req, res);
    const dump = JSON.stringify(res.body).toLowerCase();
    ok("nenhum access_token/Authorization/bearer na resposta", !dump.includes("access_token") && !dump.includes("authorization") && !dump.includes("bearer"));
    ok("nenhum campo de comprador (buyer/nickname/email) na resposta", !dump.includes("buyer") && !dump.includes("comprador"));
  }

  console.log(`centralVendasMp3ReadEndpoint.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
