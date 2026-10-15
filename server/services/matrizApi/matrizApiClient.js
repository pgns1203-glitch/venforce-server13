// Cliente HTTP da API da matriz. Só HTTP: sem endpoints, sem regra de negócio.
// Toda comunicação com a matriz deve passar por aqui.
// Nunca loga token/Authorization/payload. Redirect nunca é seguido (vira erro).
const { readConfig } = require("./matrizApiConfig");
const { MatrizApiError, CODES, fromStatus } = require("./matrizApiError");

// x-request-id do upstream só entra no erro se tiver forma de identificador.
function readUpstreamRequestId(response) {
  try {
    const v = response && response.headers && typeof response.headers.get === "function" ? response.headers.get("x-request-id") : null;
    return v && /^[\w.:-]{1,128}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

// fetch com redirect:"error" rejeita com TypeError cuja causa menciona "redirect".
function isRedirectError(err) {
  const texto = `${(err && err.message) || ""} ${(err && err.cause && err.cause.message) || ""}`;
  return /redirect/i.test(texto);
}

function createMatrizApiClient({ config: configOrGetter, fetchImpl } = {}) {
  const getConfig = typeof configOrGetter === "function" ? configOrGetter : () => configOrGetter || readConfig();
  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);

  function buildUrl(baseUrl, path, query) {
    const p = String(path || "");
    // path é sempre relativo à base configurada: bloqueia URL absoluta / host injetado.
    if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith("//")) {
      throw new MatrizApiError(CODES.ERRO_HTTP, "Path inválido: URL absoluta não é permitida.");
    }
    const url = new URL(baseUrl + (p.startsWith("/") ? p : `/${p}`));
    if (query && typeof query === "object") {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  async function request(path, options = {}) {
    const cfg = getConfig();
    if (!cfg.configured) {
      throw new MatrizApiError(CODES.NAO_CONFIGURADA, "API da matriz não configurada (MATRIZ_API_BASE_URL / MATRIZ_API_TOKEN).");
    }
    if (!doFetch) {
      throw new MatrizApiError(CODES.REDE, "fetch indisponível neste runtime.");
    }

    const method = String(options.method || "GET").toUpperCase();
    const url = buildUrl(cfg.baseUrl, path, options.query);
    // Metadados seguros do erro: path relativo, sem query/fragmento.
    const safePath = (String(path || "").split(/[?#]/)[0] || "/").replace(/^(?!\/)/, "/");
    const headers = { Accept: "application/json", Authorization: `Bearer ${cfg.token}`, ...(options.headers || {}) };
    let body;
    if (options.body !== undefined && method !== "GET" && method !== "HEAD") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : cfg.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    const meta = (extra = {}) => ({ method, path: safePath, durationMs: Date.now() - startedAt, ...extra });

    let response;
    try {
      response = await doFetch(url, { method, headers, body, signal: controller.signal, redirect: "error" });
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new MatrizApiError(CODES.TIMEOUT, `API da matriz não respondeu em ${timeoutMs}ms.`, meta());
      }
      if (isRedirectError(err)) {
        throw new MatrizApiError(CODES.REDIRECT_BLOQUEADO, "API da matriz respondeu com redirecionamento; não é seguido.", meta());
      }
      throw new MatrizApiError(CODES.REDE, "Falha de rede ao chamar a API da matriz.", meta());
    } finally {
      clearTimeout(timer);
    }

    const upstreamRequestId = readUpstreamRequestId(response);
    const raw = await response.text().catch(() => "");
    let data = null;
    let isJson = false;
    if (raw) {
      try {
        data = JSON.parse(raw);
        isJson = true;
      } catch {
        isJson = false;
      }
    }

    // Se um fetch injetado/legado devolver 3xx sem lançar, também não é aceito.
    if (response.status >= 300 && response.status < 400) {
      throw new MatrizApiError(CODES.REDIRECT_BLOQUEADO, "API da matriz respondeu com redirecionamento; não é seguido.", meta({ status: response.status, upstreamRequestId }));
    }
    if (!response.ok) {
      // O corpo do erro (JSON ou não) é descartado: só metadados seguros sobem.
      throw fromStatus(response.status, meta({ upstreamRequestId }));
    }
    if (raw && !isJson) {
      throw new MatrizApiError(CODES.RESPOSTA_INVALIDA, "API da matriz devolveu resposta não JSON.", meta({ status: response.status, upstreamRequestId }));
    }
    return data;
  }

  return {
    request,
    get: (path, options = {}) => request(path, { ...options, method: "GET" }),
    post: (path, body, options = {}) => request(path, { ...options, method: "POST", body }),
  };
}

const matrizApiClient = createMatrizApiClient();

module.exports = { createMatrizApiClient, matrizApiClient };
