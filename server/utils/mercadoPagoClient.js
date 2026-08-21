// server/utils/mercadoPagoClient.js
// Cliente HTTP para a API do Mercado Pago (MP1 — Central de Vendas).
//
// Mesma filosofia de server/utils/mlClient.js: base FIXA (nunca aceita host
// arbitrário vindo do chamador), reaproveita o MESMO grant/token da conta
// Mercado Livre (mlTokenService) — os testes reais do handoff foram feitos
// com esse access token — e nunca expõe token no retorno/log.
//
// Account-aware por construção: `mlUserId` é sempre propagado ao
// mlTokenService (o mesmo padrão já usado por mlFetch em Claims/Frete), nunca
// resolvido "por cliente" quando o cliente possui mais de uma conta.

const {
  getValidMlGrantToken,
  getMlGrantTokenNoRefresh,
  refreshMlGrant,
  sanitizeErrorMessage,
} = require("../services/mlTokenService");

const MP_API = "https://api.mercadopago.com";

function parseRetryAfter(res) {
  const header = res && res.headers && typeof res.headers.get === "function"
    ? res.headers.get("retry-after")
    : null;
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

// `path` deve ser sempre relativo (ex.: "/v1/payments/123"), nunca uma URL
// absoluta — mesmo que o chamador tente injetar algo como "https://evil".
// O host é sempre `${MP_API}${path}` (concatenação simples, nunca URL()
// parseada a partir de entrada externa), então isso já é seguro por
// construção; esta função só recusa cedo um path visivelmente errado (ex.:
// path vindo de um file_name de Settlement não sanitizado — seção 21/31 do
// spec MP2).
function assertPathRelativoSeguro(path) {
  const p = String(path || "");
  if (!p.startsWith("/") || p.includes("://")) {
    throw new Error(`Path invalido para mpFetch/mpFetchText (precisa ser relativo, comecar com "/"): "${p.slice(0, 200)}"`);
  }
}

// Núcleo compartilhado por mpFetch (JSON) e mpFetchText (CSV do Settlement
// Report — MP2). Mesma máquina de refresh em 401/mesmo grant account-aware/
// mesmo Retry-After de mpFetch original; só troca como o corpo da resposta é
// lido (`readBody`).
async function mpFetchCore(clienteId, path, options, readBody) {
  assertPathRelativoSeguro(path);
  const { mlUserId, noRefresh = false, ...fetchOptions } = options;

  async function doRequest(token) {
    return fetch(`${MP_API}${path}`, {
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
        event: "mp_api_unauthorized_refresh",
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

    const data = await readBody(res);
    return { ok: res.ok, status: res.status, data, retryAfter: parseRetryAfter(res) };
  } catch (error) {
    console.error(JSON.stringify({
      event: "mp_api_request_failed",
      cliente_id: clienteId,
      path,
      error: sanitizeErrorMessage(error),
    }));
    throw error;
  }
}

// Idêntico a mlFetch (mesma máquina de refresh em 401), só troca o host.
// `path` sempre relativo (ex.: "/v1/payments/123") — nunca uma URL completa.
async function mpFetch(clienteId, path, options = {}) {
  return mpFetchCore(clienteId, path, options, async (res) => {
    try { return await res.json(); } catch (_) { return null; }
  });
}

// MP2 — Settlement Report é baixado como CSV (nunca JSON). Aditivo: mesmo
// account-aware/refresh/Retry-After de mpFetch, só troca `res.json()` por
// `res.text()`. `data` aqui é sempre uma string (ou null em falha de leitura),
// nunca um objeto parseado — quem decide o que fazer com o texto é o chamador
// (ver centralVendasMpSettlementCsvParser).
async function mpFetchText(clienteId, path, options = {}) {
  return mpFetchCore(clienteId, path, options, async (res) => {
    try { return await res.text(); } catch (_) { return null; }
  });
}

module.exports = {
  mpFetch,
  mpFetchText,
  parseRetryAfter,
  MP_API,
};
