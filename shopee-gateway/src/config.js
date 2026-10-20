"use strict";
// Configuração do gateway, lida só de variáveis de ambiente.
// - GATEWAY_SHARED_SECRET é obrigatório: sem ele o processo não sobe.
// - SHOPEE_API_ORIGIN é opcional no boot: sem ele /forward responde
//   CONFIG_MISSING, mas /health e /probe/ip funcionam (fase A: descobrir o IP
//   antes de ter o host oficial confirmado).
// - SHOPEE_ALLOWED_PATHS é uma lista exata (sem curinga). Vazia = nada passa.

const MIN_SECRET_LENGTH = 32;
// Só segmentos [A-Za-z0-9_-] separados por "/": sem ".", "%", "\\", "//".
const SAFE_PATH = /^(\/[A-Za-z0-9_-]+)+$/;

function intEnv(env, name, def, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} inválido (inteiro entre ${min} e ${max}).`);
  }
  return n;
}

// Aceita só uma origem pura: protocolo + host (+ porta). Sem path, query,
// fragmento nem credenciais. Em produção, só https.
function parseOrigin(value, name, isProduction) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`${name} não é uma URL válida.`);
  }
  const allowedProtocol = u.protocol === "https:" || (!isProduction && u.protocol === "http:");
  if (!allowedProtocol) throw new Error(`${name} precisa ser https${isProduction ? "" : " (http só fora de produção)"}.`);
  if (u.username || u.password) throw new Error(`${name} não pode conter credenciais.`);
  if ((u.pathname && u.pathname !== "/") || u.search || u.hash) throw new Error(`${name} deve ser só a origem (sem path/query).`);
  return u.origin;
}

function parseUrl(value, name, isProduction) {
  const raw = String(value || "").trim();
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`${name} não é uma URL válida.`);
  }
  const allowedProtocol = u.protocol === "https:" || (!isProduction && u.protocol === "http:");
  if (!allowedProtocol) throw new Error(`${name} precisa ser https.`);
  if (u.username || u.password) throw new Error(`${name} não pode conter credenciais.`);
  return u.toString();
}

function parseAllowedPaths(value) {
  const list = String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of list) {
    if (!SAFE_PATH.test(p)) throw new Error(`SHOPEE_ALLOWED_PATHS contém path inválido: ${JSON.stringify(p)}`);
  }
  return new Set(list);
}

function loadConfig(env = process.env) {
  const isProduction = String(env.NODE_ENV || "").trim().toLowerCase() === "production";
  const secret = String(env.GATEWAY_SHARED_SECRET || "");
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`GATEWAY_SHARED_SECRET ausente ou curto demais (mínimo ${MIN_SECRET_LENGTH} caracteres).`);
  }

  return Object.freeze({
    isProduction,
    secret,
    host: String(env.HOST || "127.0.0.1").trim(),
    port: intEnv(env, "PORT", 8787, { min: 0, max: 65535 }),
    shopeeOrigin: parseOrigin(env.SHOPEE_API_ORIGIN, "SHOPEE_API_ORIGIN", isProduction),
    allowedPaths: parseAllowedPaths(env.SHOPEE_ALLOWED_PATHS),
    allowedMethods: new Set(["GET", "POST"]),
    ipProbeUrl: parseUrl(env.IP_PROBE_URL || "https://api.ipify.org", "IP_PROBE_URL", isProduction),
    upstreamTimeoutMs: intEnv(env, "UPSTREAM_TIMEOUT_MS", 10000, { min: 100, max: 60000 }),
    authWindowSeconds: intEnv(env, "AUTH_WINDOW_SECONDS", 60, { min: 5, max: 300 }),
    maxBodyBytes: intEnv(env, "MAX_BODY_BYTES", 64 * 1024, { min: 256, max: 1024 * 1024 }),
    maxResponseBytes: intEnv(env, "MAX_RESPONSE_BYTES", 1024 * 1024, { min: 1024, max: 10 * 1024 * 1024 }),
    maxQueryLength: intEnv(env, "MAX_QUERY_LENGTH", 4096, { min: 64, max: 16384 }),
    maxQueryKeys: 50,
    maxNonces: intEnv(env, "MAX_NONCES", 10000, { min: 10, max: 1000000 }),
    maxInflight: intEnv(env, "MAX_INFLIGHT", 32, { min: 1, max: 1024 }),
  });
}

module.exports = { loadConfig, SAFE_PATH, MIN_SECRET_LENGTH };
