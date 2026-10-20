// Erro tipado do client do gateway Shopee.
// `code` é estável: códigos locais (abaixo) ou o `error.code` devolvido pelo
// gateway (AUTH_INVALID, PATH_NOT_ALLOWED, UPSTREAM_4XX, UPSTREAM_TIMEOUT...).
// Só metadados seguros são serializados. O corpo da Shopee (4xx/5xx) fica em
// `upstreamBody`, NÃO enumerável: não entra em JSON.stringify nem em log.
class ShopeeGatewayError extends Error {
  constructor(code, message, { status = null, upstreamStatus = null, requestId = null, path = null, durationMs = null, upstreamBody } = {}) {
    super(message);
    this.name = "ShopeeGatewayError";
    this.code = code;
    this.status = status; // HTTP do gateway
    this.upstreamStatus = upstreamStatus; // HTTP da Shopee, quando houve resposta
    this.requestId = requestId;
    this.path = path; // rota do gateway (/forward, /probe/ip)
    this.durationMs = durationMs;
    Object.defineProperty(this, "upstreamBody", { value: upstreamBody === undefined ? null : upstreamBody, enumerable: false });
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
      upstreamStatus: this.upstreamStatus,
      requestId: this.requestId,
      path: this.path,
      durationMs: this.durationMs,
    };
  }
}

const CODES = Object.freeze({
  NAO_CONFIGURADO: "SHOPEE_GATEWAY_NAO_CONFIGURADO",
  TIMEOUT: "SHOPEE_GATEWAY_TIMEOUT",
  REDE: "SHOPEE_GATEWAY_ERRO_REDE",
  REDIRECT_BLOQUEADO: "SHOPEE_GATEWAY_REDIRECT_BLOQUEADO",
  RESPOSTA_INVALIDA: "SHOPEE_GATEWAY_RESPOSTA_INVALIDA",
  ENVELOPE_INVALIDO: "SHOPEE_GATEWAY_ENVELOPE_INVALIDO",
});

module.exports = { ShopeeGatewayError, CODES };
