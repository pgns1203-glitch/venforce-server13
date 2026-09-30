const {
  getValidMlGrantToken,
  getValidMlTokenByCliente,
  getMlGrantTokenNoRefresh,
  refreshMlGrant,
  sanitizeErrorMessage,
} = require("../services/mlTokenService");

const ML_API = "https://api.mercadolibre.com";

async function getMlTokenByClienteNoRefresh(clienteId, options = {}) {
  return (await getMlGrantTokenNoRefresh(clienteId, options)).accessToken;
}

function parseRetryAfter(res) {
  const header = res && res.headers && typeof res.headers.get === "function"
    ? res.headers.get("retry-after")
    : null;
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

// JSON.parse converte todo número para double: identificadores acima de
// Number.MAX_SAFE_INTEGER (9.007.199.254.740.991) são truncados em SILÊNCIO —
// sem erro, sem log. O family_id do Mercado Livre já chega a 99,4% desse
// limite hoje, e a doc mostra valores na casa de 2^64.
//
// A saída: antes de parsear, os campos listados viram string no texto bruto.
// Genérico por nome de campo (serve para inventory_id, family_id, o que for),
// alcança ocorrências aninhadas e é idempotente — valor já entre aspas não
// casa com a expressão.
function parseJsonPreservingIds(texto, campos) {
  let saida = String(texto);
  for (const campo of campos) {
    const nome = String(campo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    saida = saida.replace(new RegExp(`("${nome}"\\s*:\\s*)(-?\\d+)`, "g"), '$1"$2"');
  }
  return JSON.parse(saida);
}

// Erro classificado de tempo/cancelamento. `enviado` diz se a requisição
// chegou a sair do processo: false = com certeza não saiu (seguro dizer que
// nada foi escrito); true = saiu e foi abortada sem resposta (resultado
// DESCONHECIDO para escritas — o ML pode ter processado).
class MlTimeoutError extends Error {
  constructor(code, message, { enviado, path } = {}) {
    super(message);
    this.name = "MlTimeoutError";
    this.code = code;
    this.enviado = Boolean(enviado);
    this.path = path || null;
  }
}

function agoraMonotonico() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

// options.bigIntFields: lista de campos cujo valor numérico deve chegar como
// string íntegra (ver parseJsonPreservingIds). Opt-in — sem ele o parsing
// segue exatamente como antes.
//
// Tempo/cancelamento (TODOS opt-in — sem eles o comportamento é o de antes,
// para não mudar nenhum consumidor existente):
//   options.timeoutMs   aborta a requisição (e a leitura do corpo) depois disso
//   options.deadlineAt  instante MONOTÔNICO (performance.now()) depois do qual
//                       a requisição NUNCA é enviada; se já estiver em voo, é
//                       abortada nele. Usado pela Central de Margem para
//                       garantir que uma escrita não sai depois do lease.
//   options.signal      AbortSignal externo
// A promessa devolvida nunca fica pendurada além do limite: até a obtenção
// do token entra na corrida.
async function mlFetch(clienteId, path, options = {}) {
  const { timeoutMs = null, deadlineAt = null, signal = null } = options;
  if (timeoutMs == null && deadlineAt == null && !signal) return mlFetchSemLimite(clienteId, path, options);

  const restante = deadlineAt == null ? Infinity : deadlineAt - agoraMonotonico();
  const limite = Math.min(timeoutMs == null ? Infinity : Number(timeoutMs), restante);
  if (!(limite > 0)) {
    throw new MlTimeoutError("ML_DEADLINE_EXCEEDED", "Prazo esgotado antes de enviar a requisição ao Mercado Livre.", { enviado: false, path });
  }
  const controller = new AbortController();
  const estado = { enviado: false, motivo: null };
  let timer = null;
  let rejeitar;
  const abortou = new Promise((_, reject) => { rejeitar = reject; });
  const abortar = (code, message) => {
    if (estado.motivo) return;
    estado.motivo = code;
    controller.abort();
    rejeitar(new MlTimeoutError(code, message, { enviado: estado.enviado, path }));
  };
  if (Number.isFinite(limite)) {
    timer = setTimeout(() => abortar("ML_TIMEOUT", `O Mercado Livre não respondeu em ${Math.round(limite)} ms.`), limite);
  }
  const aoAbortarExterno = () => abortar("ML_ABORTED", "Requisição ao Mercado Livre cancelada.");
  if (signal) {
    if (signal.aborted) aoAbortarExterno();
    else signal.addEventListener("abort", aoAbortarExterno, { once: true });
  }
  try {
    return await Promise.race([
      mlFetchSemLimite(clienteId, path, { ...options, signal: controller.signal }, {
        antesDeEnviar() {
          if (controller.signal.aborted || (deadlineAt != null && agoraMonotonico() >= deadlineAt)) {
            throw new MlTimeoutError(estado.motivo || "ML_DEADLINE_EXCEEDED", "Prazo esgotado antes de enviar a requisição ao Mercado Livre.", { enviado: false, path });
          }
          estado.enviado = true;
        },
      }),
      abortou,
    ]);
  } catch (err) {
    if (err && err.name === "MlTimeoutError") throw err;
    if (estado.motivo) throw new MlTimeoutError(estado.motivo, "Requisição ao Mercado Livre abortada.", { enviado: estado.enviado, path });
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", aoAbortarExterno);
    abortou.catch(() => {});
  }
}

async function mlFetchSemLimite(clienteId, path, options = {}, hooks = {}) {
  const { mlUserId, noRefresh = false, bigIntFields = null, timeoutMs: _t, deadlineAt: _d, ...fetchOptions } = options;
  if (!fetchOptions.signal) delete fetchOptions.signal;

  // Corpo multipart (upload de imagem): o fetch monta o Content-Type com o
  // boundary sozinho — forçar "application/json" aqui quebraria o envio.
  const multipart = typeof FormData !== "undefined" && fetchOptions.body instanceof FormData;

  async function doRequest(token) {
    if (hooks.antesDeEnviar) hooks.antesDeEnviar();
    return fetch(`${ML_API}${path}`, {
      ...fetchOptions,
      headers: {
        ...(multipart ? {} : { "Content-Type": "application/json" }),
        ...(fetchOptions.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  }

  try {
    let tokenResult = noRefresh
      ? await getMlGrantTokenNoRefresh(clienteId, { mlUserId })
      : await getValidMlGrantToken(clienteId, { mlUserId });
    let res = await doRequest(tokenResult.accessToken);

    if (!noRefresh && res.status === 401) {
      console.warn(JSON.stringify({
        event: "ml_api_unauthorized_refresh",
        cliente_id: clienteId,
        grant_id: tokenResult.grant.id,
        path,
      }));
      const refreshed = await refreshMlGrant(tokenResult.grant.id, {
        force: true,
        staleAccessToken: tokenResult.accessToken,
      });
      tokenResult = { grant: refreshed, accessToken: refreshed.access_token };
      res = await doRequest(tokenResult.accessToken);
    }

    let data;
    try {
      data = Array.isArray(bigIntFields) && bigIntFields.length
        ? parseJsonPreservingIds(await res.text(), bigIntFields)
        : await res.json();
    } catch (_) { data = null; }
    return { ok: res.ok, status: res.status, data, retryAfter: parseRetryAfter(res) };
  } catch (error) {
    if (error && error.name === "MlTimeoutError") throw error;
    console.error(JSON.stringify({
      event: "ml_api_request_failed",
      cliente_id: clienteId,
      path,
      error: sanitizeErrorMessage(error),
    }));
    throw error;
  }
}

module.exports = {
  mlFetch,
  MlTimeoutError,
  getValidMlTokenByCliente,
  getMlTokenByClienteNoRefresh,
  parseRetryAfter,
  parseJsonPreservingIds,
};
