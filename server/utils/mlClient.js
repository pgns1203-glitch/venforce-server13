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

// options.bigIntFields: lista de campos cujo valor numérico deve chegar como
// string íntegra (ver parseJsonPreservingIds). Opt-in — sem ele o parsing
// segue exatamente como antes.
async function mlFetch(clienteId, path, options = {}) {
  const { mlUserId, noRefresh = false, bigIntFields = null, ...fetchOptions } = options;

  async function doRequest(token) {
    return fetch(`${ML_API}${path}`, {
      ...fetchOptions,
      headers: {
        "Content-Type": "application/json",
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
  getValidMlTokenByCliente,
  getMlTokenByClienteNoRefresh,
  parseRetryAfter,
  parseJsonPreservingIds,
};
