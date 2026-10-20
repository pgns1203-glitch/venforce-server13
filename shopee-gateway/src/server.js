"use strict";
// Gateway de saída Shopee: um IPv4 previsível entre o Render e a Shopee.
// Não guarda partner_key/tokens nem regra de negócio — só autentica o Render
// (HMAC), aplica a allowlist e repassa.
//
// Rotas:
//   GET  /health    sem auth, responde só {"ok":true}
//   GET  /probe/ip  HMAC; devolve o IPv4 público de saída observado
//   POST /forward   HMAC; envelope {method, path, query?, body?}

const http = require("http");
const crypto = require("crypto");
const { loadConfig } = require("./config");
const { createVerifier } = require("./auth");
const { forward, probeIp } = require("./forwarder");
const { GatewayError, gatewayError } = require("./errors");

const ROUTES = {
  "/health": "GET",
  "/probe/ip": "GET",
  "/forward": "POST",
};
const REQUEST_ID_RE = /^[A-Za-z0-9_.:-]{8,64}$/;

function defaultLog(entry) {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
}

// Lê o corpo cru com limite. Ao estourar, para de guardar e drena até o fim
// (resposta 413 limpa); passado de 10× o limite, derruba a conexão.
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = Number(req.headers["content-length"]) > maxBytes;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) tooLarge = true;
      if (size > maxBytes * 10) {
        req.destroy();
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => (tooLarge ? reject(gatewayError("BODY_TOO_LARGE")) : resolve(Buffer.concat(chunks))));
    req.on("error", () => reject(gatewayError("INVALID_FORMAT")));
  });
}

function sendJson(res, status, payload, requestId) {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-request-id": requestId,
  });
  res.end(body);
}

function createGateway(cfg, { log = defaultLog, now = Date.now } = {}) {
  const verify = createVerifier({ secret: cfg.secret, windowSeconds: cfg.authWindowSeconds, maxNonces: cfg.maxNonces, now });
  let inflight = 0;

  async function handle(req, res, ctx) {
    const route = req.url;
    const expectedMethod = ROUTES[route];
    if (!expectedMethod) throw gatewayError("NOT_FOUND");
    ctx.route = route;
    if (req.method !== expectedMethod) throw gatewayError("METHOD_NOT_ALLOWED");

    if (route === "/health") {
      req.resume();
      return sendJson(res, 200, { ok: true }, ctx.requestId);
    }

    const body = await readBody(req, cfg.maxBodyBytes);
    verify({ method: req.method, path: route, headers: req.headers, body });

    if (route === "/probe/ip") {
      const ip = await probeIp(cfg);
      ctx.status = 200;
      return sendJson(res, 200, { ok: true, request_id: ctx.requestId, ipv4: ip }, ctx.requestId);
    }

    let envelope;
    try {
      envelope = JSON.parse(body.toString("utf8"));
    } catch {
      throw gatewayError("INVALID_FORMAT");
    }
    const { target, upstream } = await forward(envelope, cfg);
    ctx.upstreamMethod = target.method;
    ctx.upstreamPath = target.path;
    ctx.upstreamStatus = upstream.status;

    const upstreamOut = { status: upstream.status, content_type: upstream.contentType, body: upstream.body };
    if (upstream.status >= 200 && upstream.status < 300) {
      return sendJson(res, 200, { ok: true, request_id: ctx.requestId, upstream: upstreamOut }, ctx.requestId);
    }
    const code = upstream.status >= 500 ? "UPSTREAM_5XX" : upstream.status >= 400 ? "UPSTREAM_4XX" : "UPSTREAM_INVALID_RESPONSE";
    const err = gatewayError(code);
    ctx.errorCode = code;
    // 4xx/5xx da Shopee: o corpo volta ao Render (ele precisa do código de erro
    // da Shopee para decidir), mas nunca entra no log.
    return sendJson(
      res,
      err.status,
      { ok: false, request_id: ctx.requestId, error: { code, message: err.message }, upstream: code === "UPSTREAM_INVALID_RESPONSE" ? undefined : upstreamOut },
      ctx.requestId,
    );
  }

  const server = http.createServer({ maxHeaderSize: 8 * 1024 }, (req, res) => {
    const started = now();
    const incomingId = req.headers["x-request-id"];
    const ctx = {
      requestId: typeof incomingId === "string" && REQUEST_ID_RE.test(incomingId) ? incomingId : crypto.randomUUID(),
      route: null,
    };

    res.on("finish", () => {
      log({
        level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
        request_id: ctx.requestId,
        method: req.method,
        route: ctx.route, // só rotas conhecidas; URL desconhecida não é logada
        upstream_method: ctx.upstreamMethod,
        upstream_path: ctx.upstreamPath, // só path já aprovado pela allowlist, sem query
        upstream_status: ctx.upstreamStatus,
        status: res.statusCode,
        duration_ms: now() - started,
        error_code: ctx.errorCode,
      });
    });

    if (inflight >= cfg.maxInflight) {
      ctx.errorCode = "BUSY";
      req.resume();
      const e = gatewayError("BUSY");
      return sendJson(res, e.status, { ok: false, request_id: ctx.requestId, error: { code: e.code, message: e.message } }, ctx.requestId);
    }
    inflight += 1;
    res.on("close", () => {
      inflight -= 1;
    });

    handle(req, res, ctx).catch((err) => {
      const e = err instanceof GatewayError ? err : gatewayError("INTERNAL");
      ctx.errorCode = e.code;
      if (!(err instanceof GatewayError)) {
        log({ level: "error", request_id: ctx.requestId, error_code: "INTERNAL", error_name: err && err.name });
      }
      sendJson(res, e.status, { ok: false, request_id: ctx.requestId, error: { code: e.code, message: e.message } }, ctx.requestId);
    });
  });

  // DoS básico: cabeçalho lento, corpo lento, cabeçalhos demais.
  server.headersTimeout = 10000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 64;
  return server;
}

if (require.main === module) {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    // A mensagem de config nunca inclui o valor do segredo.
    process.stderr.write(`[shopee-gateway] configuração inválida: ${err.message}\n`);
    process.exit(1);
  }
  const server = createGateway(cfg);
  server.listen(cfg.port, cfg.host, () => {
    defaultLog({
      level: "info",
      msg: "listening",
      host: cfg.host,
      port: server.address().port,
      shopee_origin_configured: Boolean(cfg.shopeeOrigin),
      allowed_paths: cfg.allowedPaths.size,
    });
  });
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

module.exports = { createGateway };
