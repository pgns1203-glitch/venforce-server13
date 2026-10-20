"use strict";
// Erros do gateway. `code` é estável (o Render decide por ele); `status` é o
// HTTP devolvido ao chamador. A mensagem é sempre genérica: nunca carrega
// segredo, assinatura, query, corpo ou stack.

class GatewayError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.status = status;
  }
}

// [status HTTP, mensagem pública]
const DEFS = Object.freeze({
  AUTH_MISSING: [401, "Autenticação do gateway ausente."],
  AUTH_INVALID: [401, "Autenticação do gateway inválida."],
  TIMESTAMP_EXPIRED: [401, "Timestamp fora da janela permitida."],
  NONCE_REPLAY: [401, "Nonce já utilizado."],
  NONCE_CACHE_FULL: [503, "Gateway temporariamente indisponível."],
  BUSY: [503, "Gateway temporariamente indisponível."],
  NOT_FOUND: [404, "Rota não encontrada."],
  METHOD_NOT_ALLOWED: [405, "Método não permitido."],
  PATH_NOT_ALLOWED: [403, "Path não permitido."],
  INVALID_FORMAT: [400, "Requisição em formato inválido."],
  QUERY_INVALID: [400, "Query inválida ou grande demais."],
  BODY_TOO_LARGE: [413, "Corpo da requisição grande demais."],
  CONFIG_MISSING: [503, "Gateway sem configuração para esta operação."],
  UPSTREAM_TIMEOUT: [504, "Upstream não respondeu a tempo."],
  UPSTREAM_NETWORK: [502, "Falha de rede/DNS ao chamar o upstream."],
  UPSTREAM_REDIRECT: [502, "Upstream respondeu com redirecionamento; não é seguido."],
  UPSTREAM_RESPONSE_TOO_LARGE: [502, "Resposta do upstream grande demais."],
  UPSTREAM_INVALID_RESPONSE: [502, "Resposta do upstream em formato inesperado."],
  UPSTREAM_4XX: [502, "Upstream recusou a requisição (4xx)."],
  UPSTREAM_5XX: [502, "Upstream falhou (5xx)."],
  INTERNAL: [500, "Erro interno do gateway."],
});

function gatewayError(code) {
  const def = DEFS[code] || DEFS.INTERNAL;
  return new GatewayError(DEFS[code] ? code : "INTERNAL", def[0], def[1]);
}

module.exports = { GatewayError, gatewayError, CODES: Object.keys(DEFS) };
