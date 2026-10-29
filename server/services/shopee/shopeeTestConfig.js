// Configuração server-side dos apps Shopee de TESTE (sandbox). Só lê
// SHOPEE_TEST_*: produção vai ter config própria e nunca passa por aqui.
// Sem as ENV o servidor sobe e o app fica `configured = false`.
//
// Um app = um par Partner ID/Key. Hoje só "marketing" está habilitado; Produto
// e ERP entram adicionando o nome em APPS (as ENV seguem o mesmo padrão:
// SHOPEE_TEST_<APP>_PARTNER_ID / SHOPEE_TEST_<APP>_PARTNER_KEY).
const APPS = Object.freeze(["marketing"]);

// Hosts de teste conhecidos da Shopee Open Platform v2. A origem vem só daqui:
// nunca de query/body, e o host de produção (partner.shopeemobile.com) é recusado.
const TEST_ORIGINS = Object.freeze([
  "https://partner.test-stable.shopeemobile.com",
  "https://openplatform.sandbox.test-stable.shopee.sg",
]);
const DEFAULT_ORIGIN = TEST_ORIGINS[0];
const DEFAULT_TIMEOUT_MS = 10000;
const TRANSPORTS = Object.freeze(["direct", "gateway"]);

function readRedirectUrl(raw, isProduction) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const u = new URL(value);
    const protocolOk = u.protocol === "https:" || (!isProduction && u.protocol === "http:");
    // Sem query/fragmento: o `state` é anexado aqui e nada mais pode viajar junto.
    if (!protocolOk || u.username || u.password || u.search || u.hash) return "";
    return u.toString();
  } catch {
    return "";
  }
}

function readTestConfig(app, env = process.env) {
  const nome = String(app || "").trim().toLowerCase();
  if (!APPS.includes(nome)) return { app: nome, configured: false, appValido: false };

  const prefix = `SHOPEE_TEST_${nome.toUpperCase()}`;
  const partnerIdRaw = String(env[`${prefix}_PARTNER_ID`] || "").trim();
  const partnerKey = String(env[`${prefix}_PARTNER_KEY`] || "").trim();
  const isProduction = String(env.NODE_ENV || "").trim().toLowerCase() === "production";

  const partnerId = /^[1-9]\d{0,15}$/.test(partnerIdRaw) ? Number(partnerIdRaw) : null;
  const redirectUrl = readRedirectUrl(env.SHOPEE_TEST_REDIRECT_URL, isProduction);

  const originRaw = String(env.SHOPEE_TEST_API_ORIGIN || "").trim().replace(/\/+$/, "");
  const apiOrigin = originRaw ? (TEST_ORIGINS.includes(originRaw) ? originRaw : "") : DEFAULT_ORIGIN;

  const transportRaw = String(env.SHOPEE_TEST_TRANSPORT || "").trim().toLowerCase();
  const transport = transportRaw ? (TRANSPORTS.includes(transportRaw) ? transportRaw : "") : "direct";

  const timeoutMs = Number(env.SHOPEE_TEST_TIMEOUT_MS) > 0 ? Number(env.SHOPEE_TEST_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;

  const faltando = [];
  if (!partnerId) faltando.push(`${prefix}_PARTNER_ID`);
  if (!partnerKey) faltando.push(`${prefix}_PARTNER_KEY`);
  if (!redirectUrl) faltando.push("SHOPEE_TEST_REDIRECT_URL");
  if (!apiOrigin) faltando.push("SHOPEE_TEST_API_ORIGIN");
  if (!transport) faltando.push("SHOPEE_TEST_TRANSPORT");

  const config = {
    app: nome,
    appValido: true,
    ambiente: "test",
    partnerId,
    redirectUrl,
    apiOrigin,
    transport,
    timeoutMs,
    faltando,
    configured: faltando.length === 0,
  };
  // A chave nunca é enumerável: não sai em JSON.stringify, spread nem log.
  Object.defineProperty(config, "partnerKey", { value: partnerKey, enumerable: false });
  return config;
}

module.exports = { readTestConfig, APPS, TEST_ORIGINS, DEFAULT_ORIGIN, DEFAULT_TIMEOUT_MS };
