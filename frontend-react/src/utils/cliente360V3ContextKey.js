// frontend-react/src/utils/cliente360V3ContextKey.js
//
// Gêmeo do backend (server/services/cliente360/cliente360V3ContextKey.js) —
// os dois PRECISAM concordar byte a byte: o hook usa isto para saber se uma
// resposta que chegou ainda corresponde ao contexto que a pediu, comparando
// com o contextKey que o próprio backend ecoa em `contexto.contextKey`.
//
// null quando o contexto está incompleto — nunca uma chave "parcial" que
// pareça válida.

export function criarContextKey({ clienteId, clienteContaId, periodo, compararCom = null } = {}) {
  if (clienteId == null || clienteContaId == null || !periodo) return null;
  return `${clienteId}:${clienteContaId}:${periodo}:${compararCom == null ? "" : compararCom}`;
}
