// server/tests/mercadoPagoClient.test.js
//
// MP1 — server/utils/mercadoPagoClient.js é uma cópia estrutural de mlClient.js
// (mesma máquina de refresh em 401, mesma sanitização de erro), só trocando o
// host fixo para api.mercadopago.com. Este arquivo prova especificamente o
// que é NOVO/arriscado aqui: host sempre fixo (nunca aceita host arbitrário),
// refresh em 401 usa o MESMO grant/conta (mlUserId propagado), e nenhum
// token/Authorization escapa para o retorno ou para o log de erro.

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

// Estuba mlTokenService (mesmo grant que mlClient usa) via Module._load —
// mercadoPagoClient.js requer o módulo real diretamente, sem injeção.
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
  // 1. Host sempre fixo — nunca monta URL a partir de entrada do chamador.
  {
    let fetchedUrl = null;
    const originalFetch = global.fetch;
    global.fetch = async (url) => { fetchedUrl = url; return { ok: true, status: 200, json: async () => ({ id: 1 }), headers: { get: () => null } }; };

    const tokenStub = {
      async getValidMlGrantToken() { return { grant: { id: 1 }, accessToken: "tok-abc" }; },
      async getMlGrantTokenNoRefresh() { return { grant: { id: 1 }, accessToken: "tok-abc" }; },
      async refreshMlGrant() { return { id: 1, access_token: "tok-novo" }; },
      sanitizeErrorMessage: (m) => String(m),
    };
    const { mpFetch } = carregarComTokenStub(tokenStub);
    await mpFetch(1, "/v1/payments/174959925172", {});
    ok("1: host fixo api.mercadopago.com", String(fetchedUrl).startsWith("https://api.mercadopago.com/"));
    ok("1: path preservado", String(fetchedUrl).endsWith("/v1/payments/174959925172"));
    global.fetch = originalFetch;
  }

  // 2. 401 -> refresh do MESMO grant, retry com o novo token, sem vazar o
  // token antigo/novo na resposta.
  {
    const chamadas = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const auth = opts.headers.Authorization;
      chamadas.push(auth);
      if (chamadas.length === 1) {
        return { ok: false, status: 401, json: async () => ({}), headers: { get: () => null } };
      }
      return { ok: true, status: 200, json: async () => ({ id: 174959925172, status: "approved" }), headers: { get: () => null } };
    };

    let refreshCalledWith = null;
    const tokenStub = {
      async getValidMlGrantToken(clienteId, opts) {
        eq("2: mlUserId propagado na 1a resolucao", opts.mlUserId, "111");
        return { grant: { id: 42 }, accessToken: "tok-velho" };
      },
      async getMlGrantTokenNoRefresh() { throw new Error("nao deveria ser chamado"); },
      async refreshMlGrant(grantId, opts) {
        refreshCalledWith = { grantId, staleAccessToken: opts.staleAccessToken };
        return { id: 42, access_token: "tok-novo" };
      },
      sanitizeErrorMessage: (m) => String(m),
    };
    const { mpFetch } = carregarComTokenStub(tokenStub);
    const resp = await mpFetch(1, "/v1/payments/174959925172", { mlUserId: "111" });

    eq("2: 1a tentativa usa token velho", chamadas[0], "Bearer tok-velho");
    eq("2: 2a tentativa usa token novo apos refresh", chamadas[1], "Bearer tok-novo");
    eq("2: refresh chamado no MESMO grant (42)", refreshCalledWith.grantId, 42);
    eq("2: refresh recebe o token velho como stale", refreshCalledWith.staleAccessToken, "tok-velho");
    eq("2: resposta final ok", resp.ok, true);
    ok("2: nenhum token na resposta", !JSON.stringify(resp).includes("tok-velho") && !JSON.stringify(resp).includes("tok-novo"));
    global.fetch = originalFetch;
  }

  // 3. Erro de rede nunca vaza token/Authorization na mensagem sanitizada.
  {
    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error("network down, Authorization: Bearer tok-secreto-xyz"); };
    const tokenStub = {
      async getValidMlGrantToken() { return { grant: { id: 1 }, accessToken: "tok-secreto-xyz" }; },
      async getMlGrantTokenNoRefresh() { return { grant: { id: 1 }, accessToken: "tok-secreto-xyz" }; },
      async refreshMlGrant() { throw new Error("nao deveria ser chamado"); },
      sanitizeErrorMessage: (m) => String(m).replace(/Bearer\s+\S+/g, "Bearer [redacted]"),
    };
    const { mpFetch } = carregarComTokenStub(tokenStub);
    const originalError = console.error;
    let logged = "";
    console.error = (msg) => { logged += msg; };
    let lancou = false;
    try { await mpFetch(1, "/v1/payments/1", {}); } catch (_) { lancou = true; }
    console.error = originalError;
    global.fetch = originalFetch;

    ok("3: erro propagado", lancou);
    ok("3: token nao aparece no log de erro", !logged.includes("tok-secreto-xyz"));
  }

  console.log(`mercadoPagoClient.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
