// Configuração server-side do gateway Shopee (saída com IPv4 fixo).
// Tudo opcional: sem as ENV o servidor sobe e `configured = false`.
// A URL do gateway vem SÓ daqui (nunca de body/query do frontend).
// Em NODE_ENV=production só https é aceito; em dev/test http segue permitido.
const DEFAULT_TIMEOUT_MS = 15000; // > UPSTREAM_TIMEOUT_MS do gateway (10 s)
const MIN_SECRET_LENGTH = 32;

function readConfig(env = process.env) {
  const url = String(env.SHOPEE_GATEWAY_URL || "").trim().replace(/\/+$/, "");
  const secret = String(env.SHOPEE_GATEWAY_SECRET || "");
  const timeoutMs = Number(env.SHOPEE_GATEWAY_TIMEOUT_MS) > 0 ? Number(env.SHOPEE_GATEWAY_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  const isProduction = String(env.NODE_ENV || "").trim().toLowerCase() === "production";

  let baseUrl = "";
  if (url) {
    try {
      const u = new URL(url);
      const protocolOk = u.protocol === "https:" || (!isProduction && u.protocol === "http:");
      if (protocolOk && !u.username && !u.password && !u.search && !u.hash) baseUrl = url;
    } catch {
      baseUrl = "";
    }
  }
  const secretOk = secret.length >= MIN_SECRET_LENGTH;

  return {
    baseUrl,
    secret: secretOk ? secret : "",
    timeoutMs,
    urlConfigured: Boolean(baseUrl),
    secretConfigured: secretOk,
    configured: Boolean(baseUrl) && secretOk,
  };
}

module.exports = { readConfig, DEFAULT_TIMEOUT_MS, MIN_SECRET_LENGTH };
