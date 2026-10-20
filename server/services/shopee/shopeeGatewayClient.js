// Client do gateway Shopee (saída com IPv4 fixo). Só transporte: sem endpoints
// Shopee, sem OAuth, sem assinatura Shopee (partner_key fica no Render e a
// assinatura Shopee vai pronta dentro de `query`). Ainda NÃO está ligado a
// nenhuma rota — ver docs/integracoes/SHOPEE_FIXED_IP_GATEWAY.md.
//
// Autenticação Render → Gateway (mesmo contrato de shopee-gateway/src/auth.js):
//   X-VF-Timestamp  segundos Unix
//   X-VF-Nonce      32 bytes aleatórios em base64url
//   X-VF-Signature  hex(HMAC-SHA256(secret, METHOD\nPATH\nTIMESTAMP\nNONCE\nhex(SHA256(body))))
//
// Sem retry: cada tentativa precisa de timestamp/nonce (e assinatura Shopee) novos.
// Nunca loga segredo, assinatura, query nem corpo. Redirect nunca é seguido.
const crypto = require("crypto");
const { readConfig } = require("./shopeeGatewayConfig");
const { ShopeeGatewayError, CODES } = require("./shopeeGatewayError");

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text || "", "utf8").digest("hex");
}

function canonicalString({ method, path, timestamp, nonce, body }) {
  return [String(method).toUpperCase(), path, String(timestamp), nonce, sha256Hex(body)].join("\n");
}

function signRequest({ secret, method, path, body = "", now = Date.now, nonce }) {
  const timestamp = String(Math.floor(now() / 1000));
  const n = nonce || crypto.randomBytes(32).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(canonicalString({ method, path, timestamp, nonce: n, body })).digest("hex");
  return { "X-VF-Timestamp": timestamp, "X-VF-Nonce": n, "X-VF-Signature": signature };
}

function isRedirectError(err) {
  const texto = `${(err && err.message) || ""} ${(err && err.cause && err.cause.message) || ""}`;
  return /redirect/i.test(texto);
}

function createShopeeGatewayClient({ config: configOrGetter, fetchImpl, now = Date.now } = {}) {
  const getConfig = typeof configOrGetter === "function" ? configOrGetter : () => configOrGetter || readConfig();
  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);

  async function call(gatewayPath, { method, payload, timeoutMs: timeoutOverride } = {}) {
    const cfg = getConfig();
    if (!cfg.configured) {
      throw new ShopeeGatewayError(CODES.NAO_CONFIGURADO, "Gateway Shopee não configurado (SHOPEE_GATEWAY_URL / SHOPEE_GATEWAY_SECRET).");
    }
    if (!doFetch) throw new ShopeeGatewayError(CODES.REDE, "fetch indisponível neste runtime.");

    const body = payload === undefined ? "" : JSON.stringify(payload);
    const requestId = crypto.randomUUID();
    const headers = {
      Accept: "application/json",
      "X-Request-Id": requestId,
      ...signRequest({ secret: cfg.secret, method, path: gatewayPath, body, now }),
    };
    if (body) headers["Content-Type"] = "application/json";

    const timeoutMs = Number(timeoutOverride) > 0 ? Number(timeoutOverride) : cfg.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    const meta = (extra = {}) => ({ path: gatewayPath, requestId, durationMs: Date.now() - startedAt, ...extra });

    let response;
    let raw;
    try {
      response = await doFetch(cfg.baseUrl + gatewayPath, { method, headers, body: body || undefined, signal: controller.signal, redirect: "error" });
      raw = await response.text();
    } catch (err) {
      if (err && err.name === "AbortError") throw new ShopeeGatewayError(CODES.TIMEOUT, `Gateway Shopee não respondeu em ${timeoutMs}ms.`, meta());
      if (isRedirectError(err)) throw new ShopeeGatewayError(CODES.REDIRECT_BLOQUEADO, "Gateway respondeu com redirecionamento; não é seguido.", meta());
      throw new ShopeeGatewayError(CODES.REDE, "Falha de rede ao chamar o gateway Shopee.", meta());
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      throw new ShopeeGatewayError(CODES.REDIRECT_BLOQUEADO, "Gateway respondeu com redirecionamento; não é seguido.", meta({ status: response.status }));
    }

    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
    if (!data || typeof data !== "object" || typeof data.ok !== "boolean") {
      throw new ShopeeGatewayError(CODES.RESPOSTA_INVALIDA, "Gateway devolveu resposta em formato inesperado.", meta({ status: response.status }));
    }

    if (!data.ok || !response.ok) {
      const gwCode = data.error && typeof data.error.code === "string" && /^[A-Z0-9_]{1,64}$/.test(data.error.code) ? data.error.code : CODES.RESPOSTA_INVALIDA;
      const upstream = data.upstream && typeof data.upstream === "object" ? data.upstream : null;
      throw new ShopeeGatewayError(gwCode, `Gateway Shopee recusou/falhou: ${gwCode} (${response.status}).`, meta({
        status: response.status,
        upstreamStatus: upstream && Number.isInteger(upstream.status) ? upstream.status : null,
        upstreamBody: upstream && typeof upstream.body === "string" ? upstream.body : null,
      }));
    }
    return { data, requestId, status: response.status };
  }

  // IPv4 público de saída observado pelo gateway (fase A do teste real).
  async function probeIp(options = {}) {
    const { data, requestId } = await call("/probe/ip", { method: "GET", timeoutMs: options.timeoutMs });
    if (typeof data.ipv4 !== "string" || !/^\d{1,3}(\.\d{1,3}){3}$/.test(data.ipv4)) {
      throw new ShopeeGatewayError(CODES.RESPOSTA_INVALIDA, "Gateway devolveu IP em formato inesperado.", { path: "/probe/ip", requestId });
    }
    return { ipv4: data.ipv4, requestId };
  }

  // Encaminha UMA chamada à Shopee. `path` precisa estar na allowlist do gateway;
  // assinatura Shopee (sign, timestamp, partner_id...) vai pronta em `query`.
  // Resolve com o corpo cru da Shopee em 2xx; 4xx/5xx viram ShopeeGatewayError
  // (UPSTREAM_4XX/UPSTREAM_5XX) com `upstreamStatus` e `upstreamBody`.
  async function forward({ method, path, query, body } = {}, options = {}) {
    const m = String(method || "").toUpperCase();
    if (!["GET", "POST"].includes(m) || typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
      throw new ShopeeGatewayError(CODES.ENVELOPE_INVALIDO, "Envelope inválido (method GET/POST e path relativo).");
    }
    const envelope = { method: m, path };
    if (query !== undefined) envelope.query = query;
    if (body !== undefined && m === "POST") envelope.body = body;
    const { data, requestId } = await call("/forward", { method: "POST", payload: envelope, timeoutMs: options.timeoutMs });
    const up = data.upstream || {};
    return { status: up.status, contentType: up.content_type || null, body: typeof up.body === "string" ? up.body : "", requestId };
  }

  return { probeIp, forward };
}

const shopeeGatewayClient = createShopeeGatewayClient();

module.exports = { createShopeeGatewayClient, shopeeGatewayClient, signRequest, canonicalString, sha256Hex };
