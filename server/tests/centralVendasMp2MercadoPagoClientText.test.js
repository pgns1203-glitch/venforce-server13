// server/tests/centralVendasMp2MercadoPagoClientText.test.js
//
// MP2 — mpFetchText (server/utils/mercadoPagoClient.js) é a evolução
// ADITIVA do cliente MP1 para baixar o Settlement Report (CSV, não JSON —
// seção 5/10 do spec MP2). Mesma máquina de refresh em 401/mesmo host FIXO/
// mesmo Retry-After de mpFetch; só troca `res.json()` por `res.text()`.
//
// Prova especificamente: (a) host sempre api.mercadopago.com mesmo para o
// download; (b) path relativo invalido (URL absoluta/"://") é recusado
// ANTES de qualquer fetch; (c) mpFetch original (MP1) continua intacto.

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

function carregarComTokenStub(tokenServiceStub) {
  const originalLoad = Module._load;
  Module._load = function loadWithStub(request, parent, isMain) {
    if (request === "../services/mlTokenService") return tokenServiceStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve("../utils/mercadoPagoClient")];
    return require("../utils/mercadoPagoClient");
  } finally {
    Module._load = originalLoad;
  }
}

async function run() {
  const tokenStubBase = {
    async getValidMlGrantToken() { return { grant: { id: 1 }, accessToken: "tok-abc" }; },
    async getMlGrantTokenNoRefresh() { return { grant: { id: 1 }, accessToken: "tok-abc" }; },
    async refreshMlGrant() { return { id: 1, access_token: "tok-novo" }; },
    sanitizeErrorMessage: (m) => String(m),
  };

  // 12 — download do Settlement usa o MESMO host fixo (api.mercadopago.com),
  // nunca monta URL a partir do file_name.
  {
    let fetchedUrl = null;
    const originalFetch = global.fetch;
    global.fetch = async (url) => { fetchedUrl = url; return { ok: true, status: 200, text: async () => "SOURCE_ID;TRANSACTION_TYPE\nP1;SETTLEMENT\n", headers: { get: () => null } }; };

    const { mpFetchText, MP_API } = carregarComTokenStub(tokenStubBase);
    const resp = await mpFetchText(1, "/v1/account/settlement_report/venforce-settlement-manual.csv", { mlUserId: "111" });

    eq("12: host fixo", String(fetchedUrl), `${MP_API}/v1/account/settlement_report/venforce-settlement-manual.csv`);
    ok("12: resposta e texto (CSV), nao JSON parseado", typeof resp.data === "string" && resp.data.includes("SOURCE_ID"));
    global.fetch = originalFetch;
  }

  // Path absoluto/host arbitrario e recusado ANTES de qualquer fetch (defesa
  // extra contra um file_name mal sanitizado rio acima).
  {
    let fetchChamado = false;
    const originalFetch = global.fetch;
    global.fetch = async () => { fetchChamado = true; return { ok: true, status: 200, text: async () => "", headers: { get: () => null } }; };

    const { mpFetchText } = carregarComTokenStub(tokenStubBase);
    let lancou = false;
    try {
      await mpFetchText(1, "https://evil.example.com/roubo.csv", { mlUserId: "111" });
    } catch (_) { lancou = true; }
    ok("path absoluto e recusado", lancou);
    ok("fetch nunca chamado com path absoluto", !fetchChamado);
    global.fetch = originalFetch;
  }

  // Refresh em 401 continua funcionando identico ao mpFetch original (mesmo
  // grant, mesmo mlUserId) quando usado via mpFetchText.
  {
    const chamadas = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      chamadas.push(opts.headers.Authorization);
      if (chamadas.length === 1) return { ok: false, status: 401, text: async () => "", headers: { get: () => null } };
      return { ok: true, status: 200, text: async () => "csv-conteudo", headers: { get: () => null } };
    };
    let refreshChamado = false;
    const tokenStub = {
      ...tokenStubBase,
      async getValidMlGrantToken() { return { grant: { id: 42 }, accessToken: "tok-velho" }; },
      async refreshMlGrant(grantId) { refreshChamado = true; eq("refresh no MESMO grant", grantId, 42); return { id: 42, access_token: "tok-novo" }; },
    };
    const { mpFetchText } = carregarComTokenStub(tokenStub);
    const resp = await mpFetchText(1, "/v1/account/settlement_report/arquivo.csv", { mlUserId: "111" });
    ok("refresh disparado em 401", refreshChamado);
    eq("2a tentativa usa token novo", chamadas[1], "Bearer tok-novo");
    eq("resposta final ok com texto", resp.data, "csv-conteudo");
    ok("nenhum token na resposta", !JSON.stringify(resp).includes("tok-velho") && !JSON.stringify(resp).includes("tok-novo"));
    global.fetch = originalFetch;
  }

  // mpFetch (MP1) continua intacto apos a evolucao aditiva.
  {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: 174959925172 }), headers: { get: () => null } });
    const { mpFetch } = carregarComTokenStub(tokenStubBase);
    const resp = await mpFetch(1, "/v1/payments/174959925172", { mlUserId: "111" });
    eq("mpFetch continua devolvendo JSON parseado", resp.data.id, 174959925172);
    global.fetch = originalFetch;
  }

  console.log(`centralVendasMp2MercadoPagoClientText.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
