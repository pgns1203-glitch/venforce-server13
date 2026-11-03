// Configuração server-side dos apps Shopee LIVE (produção). Só lê SHOPEE_LIVE_*
// (+ a chave de cifra dos tokens): nunca SHOPEE_TEST_*. Sem as ENV o servidor
// sobe e o app fica `configured = false`.
//
// O host LIVE NÃO tem padrão no código: vem de SHOPEE_LIVE_API_ORIGIN e precisa
// ser comprovado pela sondagem (scripts/shopeeLiveSignProbe.js). Guardas:
// só https, só origem, domínio Shopee, e nunca um host de teste/sandbox — assim
// uma config LIVE não chama TEST (e o TEST já só aceita os hosts de teste).
const { APPS, TEST_ORIGINS, DEFAULT_TIMEOUT_MS, readRedirectUrl } = require("./shopeeTestConfig");
const { lerChave } = require("./shopeeTokenCrypto");
const { readConfig: readGatewayConfig } = require("./shopeeGatewayConfig");

// LIVE só sai pelo gateway de IPv4 fixo (allowlist de IP da Shopee). "direct"
// sairia pelo IP variável do Render: não é aceito no LIVE, nem explícito.
const TRANSPORTS = Object.freeze(["gateway"]);
const HOST_SHOPEE = /(^|\.)shopee(mobile)?\.[a-z]{2,}(\.[a-z]{2,})?$/;
const HOST_DE_TESTE = /test-stable|sandbox|(^|[.-])uat([.-]|$)|(^|[.-])test([.-]|$)/;

function readLiveOrigin(raw) {
  const value = String(raw || "").trim().replace(/\/+$/, "");
  if (!value || TEST_ORIGINS.includes(value)) return "";
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== "/")) return "";
    const host = u.hostname.toLowerCase();
    if (!HOST_SHOPEE.test(host) || HOST_DE_TESTE.test(host)) return "";
    return u.origin;
  } catch {
    return "";
  }
}

function readLiveConfig(app, env = process.env) {
  const nome = String(app || "").trim().toLowerCase();
  if (!APPS.includes(nome)) return { app: nome, configured: false, appValido: false };

  const prefix = `SHOPEE_LIVE_${nome.toUpperCase()}`;
  const partnerIdRaw = String(env[`${prefix}_PARTNER_ID`] || "").trim();
  const partnerKey = String(env[`${prefix}_PARTNER_KEY`] || "").trim();

  const partnerId = /^[1-9]\d{0,15}$/.test(partnerIdRaw) ? Number(partnerIdRaw) : null;
  // LIVE: redirect sempre https, em qualquer NODE_ENV.
  const redirectUrl = readRedirectUrl(env.SHOPEE_LIVE_REDIRECT_URL, true);
  const apiOrigin = readLiveOrigin(env.SHOPEE_LIVE_API_ORIGIN);

  // Sem padrão: SHOPEE_LIVE_TRANSPORT=gateway tem que estar explícito.
  const transportRaw = String(env.SHOPEE_LIVE_TRANSPORT || "").trim().toLowerCase();
  const transport = TRANSPORTS.includes(transportRaw) ? transportRaw : "";
  const timeoutMs = Number(env.SHOPEE_LIVE_TIMEOUT_MS) > 0 ? Number(env.SHOPEE_LIVE_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  const chaveCifra = lerChave(env);

  const faltando = [];
  if (!partnerId) faltando.push(`${prefix}_PARTNER_ID`);
  if (!partnerKey) faltando.push(`${prefix}_PARTNER_KEY`);
  if (!redirectUrl) faltando.push("SHOPEE_LIVE_REDIRECT_URL");
  if (!apiOrigin) faltando.push("SHOPEE_LIVE_API_ORIGIN");
  if (!transport) faltando.push("SHOPEE_LIVE_TRANSPORT");
  if (!chaveCifra) faltando.push("SHOPEE_TOKEN_ENCRYPTION_KEY");
  // transport=gateway sem URL/secret válidos não conta como configurado
  // (o token/get falharia só no callback, depois do lojista autorizar).
  if (transport === "gateway") {
    const gw = readGatewayConfig(env);
    if (!gw.urlConfigured) faltando.push("SHOPEE_GATEWAY_URL");
    if (!gw.secretConfigured) faltando.push("SHOPEE_GATEWAY_SECRET");
  }

  const config = {
    app: nome,
    appValido: true,
    ambiente: "live",
    partnerId,
    redirectUrl,
    apiOrigin,
    transport,
    timeoutMs,
    faltando,
    configured: faltando.length === 0,
  };
  // Segredos nunca enumeráveis: não saem em JSON.stringify, spread nem log.
  Object.defineProperty(config, "partnerKey", { value: partnerKey, enumerable: false });
  Object.defineProperty(config, "chaveCifra", { value: chaveCifra, enumerable: false });
  return config;
}

module.exports = { readLiveConfig, readLiveOrigin };
