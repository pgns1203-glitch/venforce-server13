"use strict";
// Saída HTTP do gateway. Toda chamada externa (Shopee e descoberta de IP)
// passa por `outbound()`, que garante:
//   - IPv4 forçado (family: 4 + lookup só A record; sem fallback para IPv6);
//   - timeout real cobrindo DNS, conexão, resposta e corpo (AbortController);
//   - redirect nunca seguido (node:http não segue; 3xx vira UPSTREAM_REDIRECT);
//   - limite de tamanho da resposta;
//   - headers de saída fixos: nada do chamador é repassado.

const http = require("http");
const https = require("https");
const dns = require("dns");
const net = require("net");
const { gatewayError } = require("./errors");
const { SAFE_PATH } = require("./config");

const USER_AGENT = "venforce-shopee-gateway/1";
const ENVELOPE_KEYS = new Set(["method", "path", "query", "body"]);

// Resolve só A record. Respeita `all` (usado pelo autoSelectFamily do Node).
function lookupIPv4(hostname, options, callback) {
  const cb = typeof options === "function" ? options : callback;
  const opts = typeof options === "object" && options !== null ? options : {};
  dns.lookup(hostname, { ...opts, family: 4, hints: 0 }, cb);
}

function buildRequestOptions(url, { method, headers, signal }) {
  return {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || undefined,
    path: url.pathname + url.search,
    method,
    headers,
    signal,
    family: 4,
    lookup: lookupIPv4,
    autoSelectFamily: false,
    agent: false, // sem keep-alive compartilhado: cada chamada abre e fecha sua conexão
  };
}

function classifyNetworkError(err) {
  if (err && (err.name === "AbortError" || err.code === "ABORT_ERR")) return "UPSTREAM_TIMEOUT";
  return "UPSTREAM_NETWORK";
}

// Faz UMA requisição. Sem retry: a assinatura Shopee carrega timestamp e
// qualquer nova tentativa precisa ser gerada (e assinada) de novo pelo Render.
function outbound(urlString, { method = "GET", body = null, timeoutMs, maxResponseBytes, accept = "application/json" }) {
  const url = new URL(urlString);
  const transport = url.protocol === "https:" ? https : url.protocol === "http:" ? http : null;
  if (!transport) return Promise.reject(gatewayError("CONFIG_MISSING"));

  const headers = { accept, "user-agent": USER_AGENT };
  let payload = null;
  if (body !== null && body !== undefined) {
    payload = Buffer.from(JSON.stringify(body), "utf8");
    headers["content-type"] = "application/json";
    headers["content-length"] = String(payload.length);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const req = transport.request(buildRequestOptions(url, { method, headers, signal: controller.signal }), (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400) {
        finish(reject, gatewayError("UPSTREAM_REDIRECT"));
        return res.destroy();
      }
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxResponseBytes) {
        finish(reject, gatewayError("UPSTREAM_RESPONSE_TOO_LARGE"));
        return res.destroy();
      }
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxResponseBytes) {
          finish(reject, gatewayError("UPSTREAM_RESPONSE_TOO_LARGE"));
          return res.destroy();
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        finish(resolve, {
          status,
          contentType: typeof res.headers["content-type"] === "string" ? res.headers["content-type"].slice(0, 200) : null,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
      res.on("error", (err) => finish(reject, gatewayError(classifyNetworkError(err))));
      res.on("aborted", () => finish(reject, gatewayError(controller.signal.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_NETWORK")));
    });

    req.on("error", (err) => finish(reject, gatewayError(controller.signal.aborted ? "UPSTREAM_TIMEOUT" : classifyNetworkError(err))));
    if (payload) req.write(payload);
    req.end();
  });
}

// ── /forward ──────────────────────────────────────────────────────────────

function validateQuery(query, cfg) {
  if (query === undefined || query === null) return [];
  if (typeof query !== "object" || Array.isArray(query)) throw gatewayError("QUERY_INVALID");
  const entries = Object.entries(query);
  if (entries.length > cfg.maxQueryKeys) throw gatewayError("QUERY_INVALID");
  for (const [k, v] of entries) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(k)) throw gatewayError("QUERY_INVALID");
    if (!["string", "number", "boolean"].includes(typeof v)) throw gatewayError("QUERY_INVALID");
    if (typeof v === "number" && !Number.isFinite(v)) throw gatewayError("QUERY_INVALID");
  }
  return entries.map(([k, v]) => [k, String(v)]);
}

// Valida o envelope e devolve a URL final. Host/protocolo vêm SÓ da config.
function buildForwardTarget(envelope, cfg) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw gatewayError("INVALID_FORMAT");
  for (const k of Object.keys(envelope)) if (!ENVELOPE_KEYS.has(k)) throw gatewayError("INVALID_FORMAT");

  const method = typeof envelope.method === "string" ? envelope.method.toUpperCase() : "";
  if (!cfg.allowedMethods.has(method)) throw gatewayError("METHOD_NOT_ALLOWED");

  const path = envelope.path;
  if (typeof path !== "string" || path.length > 256 || !SAFE_PATH.test(path)) throw gatewayError("PATH_NOT_ALLOWED");
  if (!cfg.allowedPaths.has(path)) throw gatewayError("PATH_NOT_ALLOWED");

  if (method === "GET" && envelope.body !== undefined && envelope.body !== null) throw gatewayError("INVALID_FORMAT");

  if (!cfg.shopeeOrigin) throw gatewayError("CONFIG_MISSING");

  const url = new URL(path, cfg.shopeeOrigin);
  for (const [k, v] of validateQuery(envelope.query, cfg)) url.searchParams.append(k, v);
  if (url.search.length > cfg.maxQueryLength) throw gatewayError("QUERY_INVALID");
  // Defesa em profundidade: a URL composta tem que continuar na origem e no path permitidos.
  if (url.origin !== cfg.shopeeOrigin || url.pathname !== path) throw gatewayError("PATH_NOT_ALLOWED");

  return { method, path, url: url.toString(), body: method === "POST" ? envelope.body ?? null : null };
}

async function forward(envelope, cfg) {
  const target = buildForwardTarget(envelope, cfg);
  const upstream = await outbound(target.url, {
    method: target.method,
    body: target.body,
    timeoutMs: cfg.upstreamTimeoutMs,
    maxResponseBytes: cfg.maxResponseBytes,
  });
  return { target, upstream };
}

// ── /probe/ip ─────────────────────────────────────────────────────────────

async function probeIp(cfg) {
  const res = await outbound(cfg.ipProbeUrl, {
    method: "GET",
    timeoutMs: cfg.upstreamTimeoutMs,
    maxResponseBytes: 1024,
    accept: "text/plain, application/json",
  });
  if (res.status < 200 || res.status >= 300) throw gatewayError("UPSTREAM_INVALID_RESPONSE");
  // Aceita texto puro ("1.2.3.4") ou JSON {"ip":"1.2.3.4"}.
  let candidate = res.body.trim();
  if (candidate.startsWith("{")) {
    try {
      candidate = String(JSON.parse(candidate).ip || "");
    } catch {
      candidate = "";
    }
  }
  if (!net.isIPv4(candidate)) throw gatewayError("UPSTREAM_INVALID_RESPONSE");
  return candidate;
}

module.exports = { outbound, forward, probeIp, buildForwardTarget, buildRequestOptions, lookupIPv4 };
