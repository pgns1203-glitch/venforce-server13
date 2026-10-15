// Configuração server-side da API da matriz. Tudo opcional: a ausência das ENV
// NÃO impede o startup — só deixa `configured = false`.
// A base URL vem EXCLUSIVAMENTE daqui (nunca de body/query do frontend).
// Em NODE_ENV=production só https é aceito (o Bearer nunca trafega em claro);
// em dev/test http segue permitido.
const DEFAULT_TIMEOUT_MS = 15000;

function readConfig(env = process.env) {
  const baseUrl = String(env.MATRIZ_API_BASE_URL || "").trim().replace(/\/+$/, "");
  const token = String(env.MATRIZ_API_TOKEN || "").trim();
  const timeoutMs = Number(env.MATRIZ_API_TIMEOUT_MS) > 0 ? Number(env.MATRIZ_API_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  const isProduction = String(env.NODE_ENV || "").trim().toLowerCase() === "production";

  let baseUrlValid = false;
  if (baseUrl) {
    try {
      const u = new URL(baseUrl);
      baseUrlValid = u.protocol === "https:" || (!isProduction && u.protocol === "http:");
    } catch {
      baseUrlValid = false;
    }
  }

  return {
    baseUrl: baseUrlValid ? baseUrl : "",
    token,
    timeoutMs,
    baseUrlConfigured: baseUrlValid,
    authenticationConfigured: Boolean(token),
    configured: baseUrlValid && Boolean(token),
  };
}

module.exports = { readConfig, DEFAULT_TIMEOUT_MS };
