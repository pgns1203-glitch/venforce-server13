// Portal/vf-api.js
//
// Camada HTTP compartilhada do Shell V3 (F0.2): fetch autenticado, timeout,
// AbortController, tratamento central de 401, e normalização dos DOIS
// vocabulários de erro de contexto já em produção (`code` × `codigo` —
// MASTER SPEC §3.4/§18.5) num vocabulário canônico único.
//
// Precedentes lidos e generalizados aqui (nenhum foi alterado):
//   Portal/dashboard.js:54-73        — fetch com AbortController+timeout,
//                                       401 → clearSession(), JSON seguro
//   Portal/fechamentos-api.js:568-600 — AbortError externo (troca de
//                                       contexto) devolve null, silencioso
//   Portal/design-image-api.js       — factory com fetch/getToken/Abort
//                                       injetáveis, erro tipado por código
//   frontend-react/…/apiClient.js    — classe de erro tipada (ApiError)
//
// vf-api NÃO conhece Cliente/Conta/Squad, não decide autorização, não tem
// store nem state machine — isso é vf-context.js (F0.3). `scoped()` aqui é
// só a primitiva de descarte; quem decide "o contexto mudou" é quem chama.
//
// ES Module. Espelhado em window.VF.api (nunca apaga window.VF.config /
// window.VF.format, publicados por vf-config.js e vf-format.js).

import { config } from "./vf-config.js";

const TOKEN_KEY = "vf-token";
const USER_KEY = "vf-user";
const DEFAULT_TIMEOUT_MS = 15000; // mesmo valor de Portal/dashboard.js:3
const LOGIN_PATH = "index.html";

// MASTER SPEC §18.5 — dois vocabulários hoje (`code` 409 do resolvedor de
// contas; `codigo` 400/404/409 do contextoPrecificacaoService) mapeados
// para o vocabulário canônico único. Nomes já canônicos (CLIENTE_NAO_
// ENCONTRADO, CONTA_INATIVA, …) mapeiam para si mesmos — presentes aqui só
// como documentação; ficam de fora do objeto porque `canonicalCode()` já
// devolve o próprio código quando não há alias (forward-compatible).
export const ERROR_ALIASES = Object.freeze({
  // server/services/clienteContas/clienteContaService.js:198,607 (409)
  MULTIPLE_MARKETPLACE_ACCOUNTS: "CONTA_AMBIGUA",
  // server/services/automacoes/contextoPrecificacaoService.js — hoje 400
  // (MASTER SPEC §17.2 pede 424; vf-api mapeia por CÓDIGO, não por status,
  // exatamente para sobreviver a essa mudança sem que nenhuma tela mude)
  GRANT_ML_NAO_CONECTADO: "GRANT_DESCONECTADO",
  BASE_MELI_NAO_VINCULADA: "BASE_AUSENTE", // hoje 409
  MULTIPLAS_BASES_MELI: "BASE_AMBIGUA", // hoje 409
});

function canonicalCode(rawCode) {
  const code = String(rawCode);
  return ERROR_ALIASES[code] || code; // desconhecido: preservado como veio
}

function fallbackCode(status) {
  // Sem `code`/`codigo` no corpo: status >=500 vira o tipo genérico
  // SERVIDOR; o resto usa o mesmo padrão de Portal/design-image-api.js:55
  // (`HTTP_${status}`) — visível, sem fingir um significado que não existe.
  return status >= 500 ? "SERVIDOR" : `HTTP_${status}`;
}

// Tudo do corpo que não é o envelope de erro em si (ok/code/codigo/erro/
// mensagem/message) é preservado em `details` — é onde moram `contas`
// (CONTA_AMBIGUA) e `contexto` (envelope canônico do §18.5), sem hardcodar
// nomes de campo específicos.
function extractDetails(body) {
  if (!body || typeof body !== "object") return null;
  const { ok, code, codigo, erro, mensagem, message, ...rest } = body;
  return Object.keys(rest).length ? rest : null;
}

export class VfApiError extends Error {
  constructor(message, { status = 0, code = "ERRO", details = null, raw = null } = {}) {
    super(message);
    this.name = "VfApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.raw = raw;
  }
}

function normalizeErrorBody(status, body) {
  const rawCode = body && (body.code || body.codigo);
  const code = rawCode ? canonicalCode(rawCode) : fallbackCode(status);
  const message =
    (body && (body.erro || body.mensagem || body.message)) || `Erro HTTP ${status}.`;
  return new VfApiError(message, { status, code, details: extractDetails(body), raw: body });
}

function hasHeader(headers, name) {
  if (!headers) return false;
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

function buildUrl(baseUrl, path, params) {
  let url = `${baseUrl}${path}`;
  if (params && typeof params === "object") {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined || value === "") continue;
      qs.set(key, String(value));
    }
    const query = qs.toString();
    if (query) url += (path.includes("?") ? "&" : "?") + query;
  }
  return url;
}

// createVfApi(options) — fábrica testável: tudo que toca o mundo externo
// (fetch, storage, AbortController, redirect) é injetável. Sem `options`,
// usa os mesmos globais que o resto do Portal já usa.
export function createVfApi(options = {}) {
  const baseUrl = String(options.baseUrl || config.apiBase).replace(/\/+$/, "");
  const fetchImpl = options.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const AbortImpl =
    options.AbortController || (typeof AbortController === "function" ? AbortController : null);
  const storage = options.storage || (typeof localStorage !== "undefined" ? localStorage : null);
  const getToken =
    typeof options.getToken === "function"
      ? options.getToken
      : () => {
          try {
            return storage ? storage.getItem(TOKEN_KEY) : null;
          } catch {
            return null;
          }
        };
  const redirectToLogin =
    typeof options.redirectToLogin === "function"
      ? options.redirectToLogin
      : () => {
          if (typeof window !== "undefined") window.location.replace(LOGIN_PATH);
        };
  const defaultTimeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;

  function clearSession() {
    try {
      storage && storage.removeItem(TOKEN_KEY);
    } catch {
      /* sessão já não pode ser lida — segue para o redirect mesmo assim */
    }
    try {
      storage && storage.removeItem(USER_KEY);
    } catch {
      /* idem */
    }
    redirectToLogin();
  }

  async function request(path, init = {}) {
    const {
      method = "GET",
      headers,
      body,
      params,
      signal: externalSignal,
      timeoutMs = defaultTimeoutMs,
    } = init;

    if (!fetchImpl) {
      throw new VfApiError("Este ambiente não suporta chamadas ao servidor.", { code: "SEM_FETCH" });
    }

    const controller = AbortImpl ? new AbortImpl() : null;
    let timedOut = false;
    const timer =
      controller && timeoutMs > 0 && typeof setTimeout === "function"
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs)
        : null;

    const forwardAbort = () => controller && controller.abort();
    if (externalSignal && controller) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", forwardAbort);
    }

    const finalHeaders = { Accept: "application/json", ...(headers || {}) };
    const token = getToken();
    if (token && !hasHeader(finalHeaders, "Authorization")) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }

    const isFormLike = typeof FormData !== "undefined" && body instanceof FormData;
    let bodyToSend = body;
    if (body && typeof body === "object" && !isFormLike && !hasHeader(finalHeaders, "Content-Type")) {
      finalHeaders["Content-Type"] = "application/json";
      bodyToSend = JSON.stringify(body);
    }

    const url = buildUrl(baseUrl, path, params);
    const sendsBody = method !== "GET" && method !== "HEAD";

    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: finalHeaders,
        body: sendsBody ? bodyToSend : undefined,
        signal: controller ? controller.signal : externalSignal,
      });
    } catch (err) {
      if (err && err.name === "AbortError") {
        if (timedOut) {
          throw new VfApiError("O servidor demorou demais para responder.", {
            code: "TIMEOUT",
            status: 0,
          });
        }
        return null; // cancelado por quem chamou — mesmo contrato de fechamentos-api.js:578
      }
      throw new VfApiError("Não foi possível falar com o servidor VenForce.", {
        code: "REDE",
        status: 0,
        details: { message: err && err.message },
      });
    } finally {
      if (timer) clearTimeout(timer);
      if (externalSignal && controller) externalSignal.removeEventListener("abort", forwardAbort);
    }

    if (response.status === 401) {
      clearSession();
      return null; // sessão morreu — nunca vira erro de contexto
    }

    let parsedBody = null;
    try {
      parsedBody = await response.json();
    } catch {
      parsedBody = null; // resposta sem corpo/sem JSON — não pode quebrar a camada
    }

    if (!response.ok || (parsedBody && parsedBody.ok === false)) {
      throw normalizeErrorBody(response.status, parsedBody);
    }

    return parsedBody;
  }

  const verb = (method) => (path, init = {}) => request(path, { ...init, method });

  // scoped(context, { isCurrent }) — congela `context` no momento da
  // chamada; se `isCurrent(context)` disser que já não é mais o contexto
  // atual quando a resposta chega (sucesso OU erro), devolve null em vez
  // de propagar — MASTER SPEC §6.6. Sem `isCurrent`, equivale a request()
  // puro: vf-context.js (F0.3) pluga o validador depois, sem refatorar
  // vf-api.
  function scoped(context, { isCurrent } = {}) {
    const stillCurrent = typeof isCurrent === "function" ? isCurrent : () => true;

    async function scopedRequest(path, init = {}) {
      let result;
      try {
        result = await request(path, init);
      } catch (err) {
        if (!stillCurrent(context)) return null; // ninguém mais espera essa resposta
        throw err;
      }
      return stillCurrent(context) ? result : null;
    }

    return {
      context,
      request: scopedRequest,
      get: (path, init) => scopedRequest(path, { ...init, method: "GET" }),
      post: (path, init) => scopedRequest(path, { ...init, method: "POST" }),
      put: (path, init) => scopedRequest(path, { ...init, method: "PUT" }),
      patch: (path, init) => scopedRequest(path, { ...init, method: "PATCH" }),
      delete: (path, init) => scopedRequest(path, { ...init, method: "DELETE" }),
    };
  }

  return {
    request,
    get: verb("GET"),
    post: verb("POST"),
    put: verb("PUT"),
    patch: verb("PATCH"),
    delete: verb("DELETE"),
    scoped,
    clearSession,
  };
}

export const vfApi = createVfApi();

if (typeof window !== "undefined") {
  window.VF = window.VF || {};
  window.VF.api = vfApi;
}
