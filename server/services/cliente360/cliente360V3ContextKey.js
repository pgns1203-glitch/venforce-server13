// server/services/cliente360/cliente360V3ContextKey.js
//
// V3 FASE 1 — ContextKey (prompt master, seção "ContextKey"): identidade
// explícita de UMA resposta da Cliente 360 V3 —
//   clienteId + clienteContaId + periodo + compararCom
// — nunca marketplace (deriva da conta, não é um eixo do contexto) e nunca
// um contador opaco. Mesmo algoritmo do lado frontend
// (frontend-react/src/utils/cliente360V3ContextKey.js): os dois precisam
// concordar byte a byte para o frontend poder comparar a chave que pediu
// contra a que o backend ecoa em `contexto.contextKey` sem ambiguidade.
//
// null quando o contexto está incompleto — nunca uma chave "parcial" que
// pareça válida.

function criarContextKey({ clienteId, clienteContaId, periodo, compararCom = null } = {}) {
  if (clienteId == null || clienteContaId == null || !periodo) return null;
  return `${clienteId}:${clienteContaId}:${periodo}:${compararCom == null ? "" : compararCom}`;
}

module.exports = { criarContextKey };
