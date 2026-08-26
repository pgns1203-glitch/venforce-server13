// server/tests/vfApi.test.js
//
// F0.2 — cobre Portal/vf-api.js: fetch autenticado, 401 central, timeout,
// AbortError externo, e a normalização dos dois vocabulários de erro de
// contexto (`code` × `codigo`) num vocabulário canônico único.
//
// ES Module carregado via import() dinâmico a partir de um runner
// CommonJS — mesmo padrão de execução isolada (`node <arquivo>.test.js`)
// de server/tests/run-all.js e o mesmo usado em vfFormat.test.js (F0.1).
//
// Tudo que toca o mundo externo (fetch, storage, AbortController, redirect)
// é mockado via createVfApi(options) — a mesma injeção de dependência já
// usada em Portal/design-image-api.js.

const assert = require("assert");
const path = require("path");

let checks = 0;
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

/* ── Mocks determinísticos ──────────────────────────────────────────── */

class FakeSignal {
  constructor() {
    this.aborted = false;
    this._listeners = [];
  }
  addEventListener(type, fn) {
    if (type === "abort") this._listeners.push(fn);
  }
  removeEventListener(type, fn) {
    if (type !== "abort") return;
    const i = this._listeners.indexOf(fn);
    if (i >= 0) this._listeners.splice(i, 1);
  }
  _fire() {
    this.aborted = true;
    this._listeners.slice().forEach((fn) => fn());
  }
}

class FakeAbortController {
  constructor() {
    this.signal = new FakeSignal();
  }
  abort() {
    if (!this.signal.aborted) this.signal._fire();
  }
}

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    removeItem: (k) => {
      delete data[k];
    },
    _dump: () => ({ ...data }),
  };
}

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (body === undefined) throw new Error("sem corpo JSON");
      return body;
    },
  };
}

// fetch que resolve com uma resposta fixa, ignorando o signal.
function fetchFixo(status, body) {
  return async () => jsonResponse(status, body);
}

// fetch que só resolve quando o signal (interno, do timeout/abort) dispara —
// simula uma requisição pendente até timeout/abort, sem sleep real.
function fetchQueEsperaAbort() {
  return (url, init) =>
    new Promise((resolve, reject) => {
      const signal = init.signal;
      const onAbort = () => {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        reject(err);
      };
      if (!signal) return; // nunca resolve — não deve acontecer nos testes
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort);
    });
}

(async () => {
  const modPath = path.join(__dirname, "..", "..", "Portal", "vf-api.js");
  const { createVfApi, VfApiError, ERROR_ALIASES } = await import(`file://${modPath}`);

  const baseOptions = () => ({
    baseUrl: "https://api.teste.local",
    AbortController: FakeAbortController,
    storage: fakeStorage({ "vf-token": "jwt-teste" }),
    redirectToLogin: () => {
      redirectCalls += 1;
    },
  });
  let redirectCalls = 0;

  console.log("\n▸ request básico — método, URL, Authorization, JSON automático");
  {
    let capturado = null;
    const api = createVfApi({
      ...baseOptions(),
      fetch: async (url, init) => {
        capturado = { url, init };
        return jsonResponse(200, { ok: true, valor: 42 });
      },
    });
    const r = await api.post("/clientes/9/contas", { body: { nome: "N97" } });
    eq("resultado devolvido", r, { ok: true, valor: 42 });
    eq("URL prefixada com baseUrl", capturado.url, "https://api.teste.local/clientes/9/contas");
    eq("método correto", capturado.init.method, "POST");
    eq("Authorization com o token de vf-token", capturado.init.headers.Authorization, "Bearer jwt-teste");
    eq("Content-Type JSON automático para body objeto", capturado.init.headers["Content-Type"], "application/json");
    eq("body serializado", capturado.init.body, JSON.stringify({ nome: "N97" }));
  }

  console.log("\n▸ GET não envia body, aceita params");
  {
    let capturado = null;
    const api = createVfApi({
      ...baseOptions(),
      fetch: async (url, init) => {
        capturado = { url, init };
        return jsonResponse(200, { ok: true });
      },
    });
    await api.get("/clientes/9/contas", { params: { marketplace: "meli", vazio: "" } });
    eq("query string só com valor presente", capturado.url, "https://api.teste.local/clientes/9/contas?marketplace=meli");
    eq("GET sem body", capturado.init.body, undefined);
  }

  console.log("\n▸ FormData não vira JSON (upload — Financeiro/importações)");
  {
    let capturado = null;
    class FakeFormData {}
    const form = new FakeFormData();
    global.FormData = FakeFormData;
    const api = createVfApi({
      ...baseOptions(),
      fetch: async (url, init) => {
        capturado = init;
        return jsonResponse(200, { ok: true });
      },
    });
    await api.post("/importar-base", { body: form });
    ok("Content-Type NÃO foi forçado para JSON", !capturado.headers["Content-Type"]);
    eq("body é o FormData original, não serializado", capturado.body, form);
    delete global.FormData;
  }

  console.log("\n▸ 401 — limpa sessão, redireciona, devolve null (não é erro de contexto)");
  {
    redirectCalls = 0;
    const storage = fakeStorage({ "vf-token": "jwt-velho", "vf-user": '{"id":1}' });
    const api = createVfApi({
      ...baseOptions(),
      storage,
      redirectToLogin: () => {
        redirectCalls += 1;
      },
      fetch: fetchFixo(401, { ok: false, erro: "Sessão expirada" }),
    });
    const r = await api.get("/qualquer");
    eq("devolve null", r, null);
    eq("redirecionou uma vez", redirectCalls, 1);
    eq("vf-token removido", storage.getItem("vf-token"), null);
    eq("vf-user removido", storage.getItem("vf-user"), null);
  }

  console.log("\n▸ normalização — MULTIPLE_MARKETPLACE_ACCOUNTS (code, 409) → CONTA_AMBIGUA");
  {
    const api = createVfApi({
      ...baseOptions(),
      fetch: fetchFixo(409, {
        ok: false,
        code: "MULTIPLE_MARKETPLACE_ACCOUNTS",
        erro: "Selecione a conta.",
        contas: [{ id: 1, nome: "ML1" }, { id: 2, nome: "ML2" }],
      }),
    });
    await assert.rejects(
      () => api.get("/clientes/9/contas"),
      (err) => {
        ok("é VfApiError", err instanceof VfApiError);
        eq("code canônico", err.code, "CONTA_AMBIGUA");
        eq("status preservado", err.status, 409);
        eq("mensagem original preservada", err.message, "Selecione a conta.");
        eq("contas preservadas em details", err.details.contas, [{ id: 1, nome: "ML1" }, { id: 2, nome: "ML2" }]);
        return true;
      }
    );
    checks += 1;
    console.log("  ok  MULTIPLE_MARKETPLACE_ACCOUNTS → CONTA_AMBIGUA, contas preservadas");
  }

  console.log("\n▸ normalização — GRANT_ML_NAO_CONECTADO (codigo, HTTP 400) → GRANT_DESCONECTADO");
  {
    const api = createVfApi({
      ...baseOptions(),
      fetch: fetchFixo(400, { ok: false, codigo: "GRANT_ML_NAO_CONECTADO", erro: "Conecte o Mercado Livre." }),
    });
    await assert.rejects(() => api.get("/automacoes/x"), (err) => {
      eq("code canônico mesmo vindo de HTTP 400", err.code, "GRANT_DESCONECTADO");
      eq("status 400 preservado (classificação veio do código, não do status)", err.status, 400);
      return true;
    });
    checks += 1;
    console.log("  ok  GRANT_ML_NAO_CONECTADO (400) → GRANT_DESCONECTADO, sem depender do status");
  }

  console.log("\n▸ normalização — BASE_MELI_NAO_VINCULADA (codigo, 409) → BASE_AUSENTE");
  {
    const api = createVfApi({
      ...baseOptions(),
      fetch: fetchFixo(409, { ok: false, codigo: "BASE_MELI_NAO_VINCULADA", erro: "Sem base vinculada." }),
    });
    await assert.rejects(() => api.get("/x"), (err) => {
      eq("code canônico", err.code, "BASE_AUSENTE");
      return true;
    });
    checks += 1;
    console.log("  ok  BASE_MELI_NAO_VINCULADA → BASE_AUSENTE");
  }

  console.log("\n▸ normalização — MULTIPLAS_BASES_MELI (codigo, 409) → BASE_AMBIGUA");
  {
    const api = createVfApi({
      ...baseOptions(),
      fetch: fetchFixo(409, { ok: false, codigo: "MULTIPLAS_BASES_MELI", erro: "Mais de uma base MELI." }),
    });
    await assert.rejects(() => api.get("/x"), (err) => {
      eq("code canônico", err.code, "BASE_AMBIGUA");
      return true;
    });
    checks += 1;
    console.log("  ok  MULTIPLAS_BASES_MELI → BASE_AMBIGUA");
  }

  console.log("\n▸ normalização — CLIENTE_NAO_ENCONTRADO (codigo, 404) passa direto (já canônico)");
  {
    const api = createVfApi({
      ...baseOptions(),
      fetch: fetchFixo(404, { ok: false, codigo: "CLIENTE_NAO_ENCONTRADO", erro: "Cliente não encontrado." }),
    });
    await assert.rejects(() => api.get("/x"), (err) => {
      eq("code inalterado", err.code, "CLIENTE_NAO_ENCONTRADO");
      eq("status 404", err.status, 404);
      return true;
    });
    checks += 1;
    console.log("  ok  CLIENTE_NAO_ENCONTRADO passa direto");
  }

  console.log("\n▸ AbortError EXTERNO (troca de contexto) → devolve null, não é erro de aplicação");
  {
    const externalController = new FakeAbortController();
    const api = createVfApi({
      ...baseOptions(),
      fetch: fetchQueEsperaAbort(),
    });
    const promessa = api.get("/pedidos", { signal: externalController.signal });
    externalController.abort(); // simula troca de cliente/conta em voo
    const r = await promessa;
    eq("devolve null, não lança", r, null);
  }

  console.log("\n▸ TIMEOUT interno → erro tipado TIMEOUT, repetível (não é o mesmo que abort externo)");
  {
    const api = createVfApi({
      ...baseOptions(),
      fetch: fetchQueEsperaAbort(),
    });
    await assert.rejects(
      () => api.get("/pedidos", { timeoutMs: 5 }),
      (err) => {
        ok("é VfApiError", err instanceof VfApiError);
        eq("code TIMEOUT", err.code, "TIMEOUT");
        return true;
      }
    );
    checks += 1;
    console.log("  ok  timeout interno vira TIMEOUT tipado");

    // repetível: uma segunda chamada, desta vez resolvendo normalmente
    const api2 = createVfApi({ ...baseOptions(), fetch: fetchFixo(200, { ok: true }) });
    const r2 = await api2.get("/pedidos");
    eq("nova tentativa funciona normalmente", r2, { ok: true });
  }

  console.log("\n▸ 5xx → erro tipado SERVIDOR, preservando status/mensagem");
  {
    const api = createVfApi({
      ...baseOptions(),
      fetch: fetchFixo(500, { ok: false, erro: "Falha interna do servidor." }),
    });
    await assert.rejects(() => api.get("/x"), (err) => {
      eq("code SERVIDOR", err.code, "SERVIDOR");
      eq("status 500 preservado", err.status, 500);
      eq("mensagem preservada", err.message, "Falha interna do servidor.");
      return true;
    });
    checks += 1;
    console.log("  ok  5xx → SERVIDOR");
  }

  console.log("\n▸ JSON inválido / resposta sem corpo — não quebra a camada de erro");
  {
    const api = createVfApi({
      ...baseOptions(),
      fetch: async () => ({ status: 500, ok: false, json: async () => { throw new Error("não é JSON"); } }),
    });
    await assert.rejects(() => api.get("/x"), (err) => {
      eq("cai no fallback genérico por status", err.code, "SERVIDOR");
      eq("mensagem genérica previsível", err.message, "Erro HTTP 500.");
      return true;
    });
    checks += 1;
    console.log("  ok  corpo não-JSON em resposta de erro não quebra a normalização");

    const api2 = createVfApi({
      ...baseOptions(),
      fetch: async () => ({ status: 204, ok: true, json: async () => { throw new Error("sem corpo"); } }),
    });
    const r = await api2.get("/x");
    eq("sucesso sem corpo JSON devolve null, não lança", r, null);
  }

  console.log("\n▸ código desconhecido — preservado, NÃO vira SERVIDOR (forward-compatible)");
  {
    const api = createVfApi({
      ...baseOptions(),
      fetch: fetchFixo(409, { ok: false, code: "NOVO_ERRO_FUTURO", erro: "Algo novo do backend." }),
    });
    await assert.rejects(() => api.get("/x"), (err) => {
      eq("código desconhecido preservado", err.code, "NOVO_ERRO_FUTURO");
      ok("não virou SERVIDOR", err.code !== "SERVIDOR");
      return true;
    });
    checks += 1;
    console.log("  ok  NOVO_ERRO_FUTURO preservado como veio");
  }

  console.log("\n▸ erro só com mensagem (sem code/codigo) — classificação genérica, mensagem mantida");
  {
    const api = createVfApi({
      ...baseOptions(),
      fetch: fetchFixo(418, { ok: false, erro: "Falha qualquer" }),
    });
    await assert.rejects(() => api.get("/x"), (err) => {
      eq("classificação genérica por status (HTTP_418)", err.code, "HTTP_418");
      eq("mensagem original mantida", err.message, "Falha qualquer");
      return true;
    });
    checks += 1;
    console.log("  ok  sem code/codigo → HTTP_<status>, mensagem preservada");
  }

  console.log("\n▸ falha de rede (sem resposta) → erro tipado REDE, não derruba a camada");
  {
    const api = createVfApi({
      ...baseOptions(),
      fetch: async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      },
    });
    await assert.rejects(() => api.get("/x"), (err) => {
      eq("code REDE", err.code, "REDE");
      return true;
    });
    checks += 1;
    console.log("  ok  falha de rede → REDE");
  }

  console.log("\n▸ listener de abort não vaza (signal externo, sem timeout disparado)");
  {
    const externalController = new FakeAbortController();
    const api = createVfApi({ ...baseOptions(), fetch: fetchFixo(200, { ok: true }) });
    await api.get("/x", { signal: externalController.signal });
    eq("nenhum listener de abort ficou pendurado após sucesso", externalController.signal._listeners.length, 0);
  }

  console.log("\n▸ scoped() — contexto ainda atual: resolve normalmente");
  {
    const ctx = { clienteId: 87, clienteContaId: 42 };
    const api = createVfApi({ ...baseOptions(), fetch: fetchFixo(200, { ok: true, dado: 1 }) });
    const req = api.scoped(ctx, { isCurrent: (c) => c === ctx });
    const r = await req.get("/operacao/visao");
    eq("resolve normalmente quando o contexto não mudou", r, { ok: true, dado: 1 });
  }

  console.log("\n▸ scoped() — contexto mudou durante a chamada: devolve null, não lança (sucesso descartado)");
  {
    const ctx = { clienteId: 87, clienteContaId: 42 };
    let contextoAtual = ctx;
    const api = createVfApi({ ...baseOptions(), fetch: fetchFixo(200, { ok: true, dado: 1 }) });
    const req = api.scoped(ctx, { isCurrent: (c) => c === contextoAtual });
    contextoAtual = { clienteId: 87, clienteContaId: 99 }; // troca ML1 → ML2 antes da resposta
    const r = await req.get("/operacao/visao");
    eq("resposta obsoleta descartada", r, null);
  }

  console.log("\n▸ scoped() — contexto mudou E a chamada deu erro: descarta silenciosamente, não lança");
  {
    const ctx = { clienteId: 87, clienteContaId: 42 };
    let contextoAtual = ctx;
    const api = createVfApi({
      ...baseOptions(),
      fetch: fetchFixo(409, { ok: false, code: "MULTIPLE_MARKETPLACE_ACCOUNTS", erro: "Selecione a conta." }),
    });
    const req = api.scoped(ctx, { isCurrent: (c) => c === contextoAtual });
    contextoAtual = { clienteId: 87, clienteContaId: 99 };
    const r = await req.get("/operacao/visao");
    eq("erro de resposta obsoleta também é descartado (null, não lança)", r, null);
  }

  console.log("\n▸ scoped() — contexto AINDA atual e a chamada deu erro: propaga normalmente");
  {
    const ctx = { clienteId: 87, clienteContaId: 42 };
    const api = createVfApi({
      ...baseOptions(),
      fetch: fetchFixo(409, { ok: false, code: "MULTIPLE_MARKETPLACE_ACCOUNTS", erro: "Selecione a conta." }),
    });
    const req = api.scoped(ctx, { isCurrent: (c) => c === ctx });
    await assert.rejects(() => req.get("/operacao/visao"), (err) => {
      eq("erro real propaga quando o contexto ainda é o mesmo", err.code, "CONTA_AMBIGUA");
      return true;
    });
    checks += 1;
    console.log("  ok  erro real propaga quando o contexto ainda é atual");
  }

  console.log("\n▸ scoped() sem isCurrent — comportamento idêntico a request() puro (F0.3 pluga depois)");
  {
    const ctx = { clienteId: 1 };
    const api = createVfApi({ ...baseOptions(), fetch: fetchFixo(200, { ok: true }) });
    const req = api.scoped(ctx);
    const r = await req.get("/x");
    eq("sem validador, sempre resolve", r, { ok: true });
  }

  console.log("\n▸ regressão — ponte window.VF preserva config/format já publicados");
  {
    global.window = global;
    window.VF = { config: { apiBase: "preexistente" }, format: { moeda: () => "x" } };
    // reimporta vf-api num contexto com window.VF já populado — querystring
    // força um novo registro de módulo no cache do ESM loader, garantindo
    // que o código de nível superior (a ponte window.VF.api = …) rode de novo.
    const modUrl = `file://${modPath}?bridge-check`;
    const mod2 = await import(modUrl);
    ok("window.VF.config não foi apagado", window.VF.config && window.VF.config.apiBase === "preexistente");
    ok("window.VF.format não foi apagado", window.VF.format && typeof window.VF.format.moeda === "function");
    ok("window.VF.api foi publicado", window.VF.api === mod2.vfApi);
    delete global.window;
  }

  console.log(`\n✓ vfApi: ${checks} verificações`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
