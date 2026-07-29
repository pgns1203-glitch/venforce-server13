// server/middlewares/observabilityMiddleware.js
// Correlação e telemetria de request no servidor.
//
// Regras: gera/reaproveita o X-Request-Id, devolve o header, e no `finish`
// enfileira o registro. Nunca aguarda o INSERT e nunca lê o corpo da request.

"use strict";

const crypto = require("crypto");
const service = require("../services/observabilityService");
const S = require("../utils/observabilitySanitizer");

// Rotas fora da telemetria: ingestão da própria observabilidade (recursão),
// health-check de uptime (ruído constante) e download de arquivos.
const IGNORED_EXACT = new Set(["/", "/health", "/favicon.ico"]);
const IGNORED_PREFIXES = ["/admin/observability", "/downloads"];

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{8,120}$/;

function isValidRequestId(value) {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

function newRequestId() {
  try {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* ambiente sem randomUUID cai no fallback abaixo */
  }
  return `req-${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}`;
}

function shouldIgnore(req) {
  if (req.method === "OPTIONS") return true;
  const caminho = req.path || "";
  if (IGNORED_EXACT.has(caminho)) return true;
  return IGNORED_PREFIXES.some((prefixo) => caminho === prefixo || caminho.startsWith(`${prefixo}/`));
}

function resolveRoute(req) {
  const base = req.baseUrl || "";
  const padrao = req.route && typeof req.route.path === "string" ? req.route.path : null;
  if (!padrao) return null;
  const completo = `${base}${padrao}`.replace(/\/{2,}/g, "/");
  return completo || "/";
}

function responseSize(res) {
  const header = res.getHeader ? res.getHeader("content-length") : null;
  const parsed = parseInt(Array.isArray(header) ? header[0] : header, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function contentType(res) {
  const header = res.getHeader ? res.getHeader("content-type") : null;
  const texto = Array.isArray(header) ? header[0] : header;
  return texto ? S.truncateString(String(texto), 120) : null;
}

/** Chamado pelo error handler global antes de responder. */
function captureRequestError(req, err, extra = {}) {
  if (!req || !err) return;
  const config = service.getConfig();
  req.__vfObsError = {
    name: S.sanitizeMessage(err.name || "Error", 120),
    message: S.sanitizeMessage(err.message, 500),
    stack: config.captureStack ? S.sanitizeStack(err.stack) : null,
    ...extra,
  };
}

function observabilityMiddleware(req, res, next) {
  // O request id existe mesmo para rotas ignoradas: o navegador usa o header
  // devolvido para correlacionar, e /health é justamente um teste do Portal.
  try {
    const recebido = req.get ? req.get("X-Request-Id") : null;
    const requestId = isValidRequestId(recebido) ? recebido : newRequestId();
    req.requestId = requestId;
    if (!res.headersSent) res.setHeader("X-Request-Id", requestId);
  } catch {
    req.requestId = req.requestId || newRequestId();
  }

  let config;
  try {
    config = service.getConfig();
  } catch {
    return next();
  }

  if (!config.enabled || shouldIgnore(req)) return next();

  const inicio = process.hrtime.bigint();
  let registrado = false;

  const registrar = (finalizado) => {
    if (registrado) return;
    registrado = true;
    try {
      const duracao = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
      const erro = req.__vfObsError || null;
      const status = finalizado ? res.statusCode : 0;

      service.recordServerRequest({
        requestId: req.requestId,
        method: String(req.method || "GET").toUpperCase().slice(0, 10),
        route: resolveRoute(req),
        path: S.sanitizePath(req.originalUrl || req.url || "/"),
        statusCode: status,
        durationMs: duracao,
        userId: req.user?.id ?? null,
        userEmail: req.user?.email ? S.sanitizeMessage(req.user.email, 160) : null,
        userNome: req.user?.nome ? S.sanitizeMessage(req.user.nome, 160) : null,
        contentType: finalizado ? contentType(res) : null,
        responseSize: finalizado ? responseSize(res) : null,
        userAgent: S.shortenUserAgent(req.get ? req.get("user-agent") : null),
        errorName: erro?.name ?? null,
        errorMessage: erro?.message ?? null,
        errorStack: erro?.stack ?? null,
        metadata: {
          url: S.sanitizeUrl(req.originalUrl || req.url || "/"),
          query: S.sanitizeValue(req.query, { maxDepth: 2, maxString: 200, maxKeys: 20 }),
          origem: S.sanitizeMessage(req.get ? req.get("origin") : null, 160),
          referer: req.get ? S.sanitizeUrl(req.get("referer") || "") || null : null,
          ip: S.sanitizeMessage(
            (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").toString().split(",")[0].trim(),
            60
          ),
          lenta: duracao >= config.slowMs,
          erro: !!erro || status >= 400 || !finalizado,
          finalizada: finalizado,
          debugSession: S.sanitizeMessage(req.get ? req.get("X-VF-Debug-Session") : null, 80),
          debugTab: S.sanitizeMessage(req.get ? req.get("X-VF-Debug-Tab") : null, 80),
          tipoEvento: finalizado ? "http" : "abortada",
        },
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      // Observabilidade nunca derruba a resposta.
      if (process.env.NODE_ENV !== "production") {
        console.error("[observability] falha ao registrar request:", err.message);
      }
    }
  };

  res.on("finish", () => registrar(true));
  res.on("close", () => registrar(false));

  next();
}

module.exports = {
  observabilityMiddleware,
  captureRequestError,
  shouldIgnore,
  isValidRequestId,
  newRequestId,
  resolveRoute,
  IGNORED_EXACT,
  IGNORED_PREFIXES,
};
