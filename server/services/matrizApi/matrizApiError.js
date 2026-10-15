// Erro tipado da camada de integração com a API da matriz.
// `code` é estável (para o chamador decidir). O erro carrega SÓ metadados
// seguros: method, path (sem query), status, code, upstreamRequestId e
// durationMs. Nunca token/Authorization nem corpo da resposta.
class MatrizApiError extends Error {
  constructor(code, message, { status = null, method = null, path = null, upstreamRequestId = null, durationMs = null } = {}) {
    super(message);
    this.name = "MatrizApiError";
    this.code = code;
    this.status = status;
    this.method = method;
    this.path = path;
    this.upstreamRequestId = upstreamRequestId;
    this.durationMs = durationMs;
  }

  // Serialização/log só enxerga os metadados seguros.
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
      method: this.method,
      path: this.path,
      upstreamRequestId: this.upstreamRequestId,
      durationMs: this.durationMs,
    };
  }
}

const CODES = Object.freeze({
  NAO_CONFIGURADA: "MATRIZ_NAO_CONFIGURADA",
  ENDPOINT_NAO_CONFIGURADO: "MATRIZ_ENDPOINT_NAO_CONFIGURADO",
  NAO_AUTORIZADO: "MATRIZ_NAO_AUTORIZADO", // 401
  PROIBIDO: "MATRIZ_PROIBIDO", // 403
  NAO_ENCONTRADO: "MATRIZ_NAO_ENCONTRADO", // 404
  RATE_LIMIT: "MATRIZ_RATE_LIMIT", // 429
  ERRO_SERVIDOR: "MATRIZ_ERRO_SERVIDOR", // 5xx
  ERRO_HTTP: "MATRIZ_ERRO_HTTP", // demais 4xx
  RESPOSTA_INVALIDA: "MATRIZ_RESPOSTA_INVALIDA", // não JSON
  REDIRECT_BLOQUEADO: "MATRIZ_REDIRECT_BLOQUEADO", // 3xx nunca é seguido
  TIMEOUT: "MATRIZ_TIMEOUT",
  REDE: "MATRIZ_ERRO_REDE",
});

function fromStatus(status, meta = {}) {
  const m = { ...meta, status };
  if (status === 401) return new MatrizApiError(CODES.NAO_AUTORIZADO, "API da matriz recusou a autenticação (401).", m);
  if (status === 403) return new MatrizApiError(CODES.PROIBIDO, "API da matriz negou o acesso (403).", m);
  if (status === 404) return new MatrizApiError(CODES.NAO_ENCONTRADO, "Recurso não encontrado na API da matriz (404).", m);
  if (status === 429) return new MatrizApiError(CODES.RATE_LIMIT, "API da matriz limitou as requisições (429).", m);
  if (status >= 500) return new MatrizApiError(CODES.ERRO_SERVIDOR, `API da matriz falhou (${status}).`, m);
  return new MatrizApiError(CODES.ERRO_HTTP, `API da matriz respondeu ${status}.`, m);
}

module.exports = { MatrizApiError, CODES, fromStatus };
