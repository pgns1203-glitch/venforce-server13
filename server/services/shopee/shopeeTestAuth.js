// OAuth Shopee Open Platform v2 — ambiente de TESTE.
//
// Contrato usado (API pública v2, sem access_token/shop_id na assinatura):
//   sign = hex(HMAC-SHA256(partner_key, `${partner_id}${api_path}${timestamp}`))
//   timestamp em segundos Unix (a Shopee recusa fora de ~5 min)
//   GET  /api/v2/shop/auth_partner?partner_id&timestamp&sign&redirect   (navegador do seller)
//   POST /api/v2/auth/token/get?partner_id&timestamp&sign  corpo JSON {code, shop_id, partner_id}
// Path, método e parâmetros de query do token/get foram conferidos contra o host
// de teste (sem credencial ele responde "error_sign"); a base string da assinatura
// só se prova no primeiro grant real — um erro ali volta como `error_sign`.
//
// Sem retry: cada tentativa precisaria de timestamp/assinatura novos e o `code`
// é de uso único. Nunca loga partner_key, sign, code nem tokens. Redirect não é seguido.
const crypto = require("crypto");
const { shopeeGatewayClient } = require("./shopeeGatewayClient");

const AUTH_PARTNER_PATH = "/api/v2/shop/auth_partner";
const TOKEN_GET_PATH = "/api/v2/auth/token/get";

const CODES = Object.freeze({
  NAO_CONFIGURADO: "SHOPEE_TEST_NAO_CONFIGURADO",
  PARAMETRO_INVALIDO: "SHOPEE_TEST_PARAMETRO_INVALIDO",
  TIMEOUT: "SHOPEE_TEST_TIMEOUT",
  REDE: "SHOPEE_TEST_ERRO_REDE",
  REDIRECT_BLOQUEADO: "SHOPEE_TEST_REDIRECT_BLOQUEADO",
  UPSTREAM_4XX: "SHOPEE_TEST_UPSTREAM_4XX",
  UPSTREAM_5XX: "SHOPEE_TEST_UPSTREAM_5XX",
  RESPOSTA_INVALIDA: "SHOPEE_TEST_RESPOSTA_INVALIDA",
});

// Só metadados seguros. `shopeeError` é o código curto da Shopee (ex.: error_sign),
// filtrado por regex; a mensagem livre da Shopee não é guardada.
class ShopeeAuthError extends Error {
  constructor(code, message, { upstreamStatus = null, shopeeError = null, shopeeRequestId = null } = {}) {
    super(message);
    this.name = "ShopeeAuthError";
    this.code = code;
    this.upstreamStatus = upstreamStatus;
    this.shopeeError = shopeeError;
    this.shopeeRequestId = shopeeRequestId;
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message, upstreamStatus: this.upstreamStatus, shopeeError: this.shopeeError, shopeeRequestId: this.shopeeRequestId };
  }
}

const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;
const safe = (v) => (typeof v === "string" && SAFE_TOKEN.test(v) ? v : null);

function signPublic({ partnerId, partnerKey, path, timestamp }) {
  return crypto.createHmac("sha256", partnerKey).update(`${partnerId}${path}${timestamp}`, "utf8").digest("hex");
}

function exigirConfig(config) {
  if (!config || !config.configured || !config.partnerKey) {
    throw new ShopeeAuthError(CODES.NAO_CONFIGURADO, "App Shopee de teste não configurado.");
  }
}

// URL que o seller abre. O `state` vai embutido na redirect: a Shopee devolve a
// redirect com `code` e `shop_id` acrescentados.
function buildAuthorizationUrl(config, state, { now = Date.now } = {}) {
  exigirConfig(config);
  const timestamp = Math.floor(now() / 1000);
  const redirect = new URL(config.redirectUrl);
  redirect.searchParams.set("state", state);

  const url = new URL(AUTH_PARTNER_PATH, config.apiOrigin);
  url.searchParams.set("partner_id", String(config.partnerId));
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", signPublic({ partnerId: config.partnerId, partnerKey: config.partnerKey, path: AUTH_PARTNER_PATH, timestamp }));
  url.searchParams.set("redirect", redirect.toString());
  return url.toString();
}

function isRedirectError(err) {
  const texto = `${(err && err.message) || ""} ${(err && err.cause && err.cause.message) || ""}`;
  return /redirect/i.test(texto);
}

function parseJson(raw) {
  try {
    const data = JSON.parse(raw);
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

// Converte (status HTTP, corpo cru) da Shopee em resultado ou ShopeeAuthError.
function interpretarTokenGet(status, raw, shopId) {
  const data = parseJson(raw);
  const meta = { upstreamStatus: status, shopeeError: safe(data && data.error), shopeeRequestId: safe(data && data.request_id) };

  if (status >= 500) throw new ShopeeAuthError(CODES.UPSTREAM_5XX, `Shopee falhou no token/get (${status}).`, meta);
  if (!data) throw new ShopeeAuthError(CODES.RESPOSTA_INVALIDA, "Shopee devolveu resposta em formato inesperado.", meta);
  if (status >= 400 || (typeof data.error === "string" && data.error !== "")) {
    throw new ShopeeAuthError(CODES.UPSTREAM_4XX, `Shopee recusou o token/get${meta.shopeeError ? ` (${meta.shopeeError})` : ""}.`, meta);
  }
  if (status < 200 || status >= 300) throw new ShopeeAuthError(CODES.RESPOSTA_INVALIDA, `Status inesperado da Shopee (${status}).`, meta);

  const { access_token: accessToken, refresh_token: refreshToken, expire_in: expireIn } = data;
  if (typeof accessToken !== "string" || !accessToken || typeof refreshToken !== "string" || !refreshToken || !(Number(expireIn) > 0)) {
    throw new ShopeeAuthError(CODES.RESPOSTA_INVALIDA, "Shopee respondeu sem access_token/refresh_token/expire_in válidos.", meta);
  }

  const result = { shopId, expireIn: Number(expireIn), shopeeRequestId: meta.shopeeRequestId };
  // Tokens nunca enumeráveis: não saem em JSON.stringify, spread nem log.
  Object.defineProperty(result, "accessToken", { value: accessToken, enumerable: false });
  Object.defineProperty(result, "refreshToken", { value: refreshToken, enumerable: false });
  return result;
}

async function postDireto(config, url, body, doFetch) {
  if (!doFetch) throw new ShopeeAuthError(CODES.REDE, "fetch indisponível neste runtime.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "error",
    });
    if (response.status >= 300 && response.status < 400) {
      throw new ShopeeAuthError(CODES.REDIRECT_BLOQUEADO, "Shopee respondeu com redirecionamento; não é seguido.", { upstreamStatus: response.status });
    }
    return { status: response.status, raw: await response.text() };
  } catch (err) {
    if (err instanceof ShopeeAuthError) throw err;
    if (err && err.name === "AbortError") throw new ShopeeAuthError(CODES.TIMEOUT, `Shopee não respondeu em ${config.timeoutMs}ms.`);
    if (isRedirectError(err)) throw new ShopeeAuthError(CODES.REDIRECT_BLOQUEADO, "Shopee respondeu com redirecionamento; não é seguido.");
    throw new ShopeeAuthError(CODES.REDE, "Falha de rede ao chamar a Shopee.");
  } finally {
    clearTimeout(timer);
  }
}

// Via gateway de IPv4 fixo (o gateway precisa estar com SHOPEE_API_ORIGIN = host
// de teste e TOKEN_GET_PATH na allowlist). 4xx/5xx da Shopee chegam como erro do
// gateway com `upstreamStatus` e `upstreamBody` (não enumerável).
async function postViaGateway(config, query, body, gateway) {
  try {
    const r = await gateway.forward({ method: "POST", path: TOKEN_GET_PATH, query, body }, { timeoutMs: config.timeoutMs });
    return { status: r.status, raw: r.body };
  } catch (err) {
    if (err && Number.isInteger(err.upstreamStatus)) return { status: err.upstreamStatus, raw: err.upstreamBody || "" };
    const gwCode = safe(err && err.code);
    if (gwCode && /TIMEOUT/.test(gwCode)) throw new ShopeeAuthError(CODES.TIMEOUT, `Gateway/Shopee não respondeu (${gwCode}).`);
    if (gwCode && /REDIRECT/.test(gwCode)) throw new ShopeeAuthError(CODES.REDIRECT_BLOQUEADO, "Redirecionamento bloqueado no gateway.");
    throw new ShopeeAuthError(CODES.REDE, `Falha ao chamar a Shopee pelo gateway${gwCode ? ` (${gwCode})` : ""}.`);
  }
}

async function exchangeCodeForToken(config, { code, shopId }, { fetchImpl, gateway = shopeeGatewayClient, now = Date.now } = {}) {
  exigirConfig(config);
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(code)) {
    throw new ShopeeAuthError(CODES.PARAMETRO_INVALIDO, "code inválido.");
  }
  if (!Number.isSafeInteger(shopId) || shopId <= 0) throw new ShopeeAuthError(CODES.PARAMETRO_INVALIDO, "shop_id inválido.");

  const timestamp = Math.floor(now() / 1000);
  const query = {
    partner_id: String(config.partnerId),
    timestamp: String(timestamp),
    sign: signPublic({ partnerId: config.partnerId, partnerKey: config.partnerKey, path: TOKEN_GET_PATH, timestamp }),
  };
  const body = { code, shop_id: shopId, partner_id: config.partnerId };

  let resposta;
  if (config.transport === "gateway") {
    resposta = await postViaGateway(config, query, body, gateway);
  } else {
    const url = new URL(TOKEN_GET_PATH, config.apiOrigin);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const doFetch = fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    resposta = await postDireto(config, url.toString(), body, doFetch);
  }
  return interpretarTokenGet(resposta.status, resposta.raw, shopId);
}

module.exports = {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  signPublic,
  ShopeeAuthError,
  CODES,
  AUTH_PARTNER_PATH,
  TOKEN_GET_PATH,
};
