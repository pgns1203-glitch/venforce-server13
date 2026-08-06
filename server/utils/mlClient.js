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

async function mlFetch(clienteId, path, options = {}) {
  const { mlUserId, noRefresh = false, ...fetchOptions } = options;

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
    try { data = await res.json(); } catch (_) { data = null; }
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
};
