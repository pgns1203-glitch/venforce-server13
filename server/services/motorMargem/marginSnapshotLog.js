// server/services/motorMargem/marginSnapshotLog.js
// Margin Snapshot — log estruturado (M8).
//
// Uma linha JSON por evento (mesmo formato de mlClient: `{"event": ...}`),
// para responder "qual run começou, de qual conta, por quê, quanto
// processou, quantos retries/429, quanto durou, por que falhou" direto do
// log do Render, sem abrir o banco. Só ids, contadores e mensagens
// redigidas: nunca token, nunca payload do ML, nunca valor financeiro.

const { redigirSegredos } = require("./marginSnapshotSanitize");

const CHAVES_PROIBIDAS = new Set([
  "access_token", "refresh_token", "api_key", "apikey", "password",
  "authorization", "token", "secret", "client_secret",
]);

function sanitizarCampos(campos) {
  const saida = {};
  for (const [chave, valor] of Object.entries(campos || {})) {
    if (CHAVES_PROIBIDAS.has(String(chave).toLowerCase())) continue;
    if (valor === undefined) continue;
    saida[chave] = typeof valor === "string" ? redigirSegredos(valor, 500) : valor;
  }
  return saida;
}

function logEvento(logger, nivel, event, campos = {}) {
  const alvo = logger || console;
  const fn = alvo[nivel] || alvo.log;
  if (typeof fn !== "function") return;
  fn.call(alvo, JSON.stringify({ event, ...sanitizarCampos(campos) }));
}

module.exports = { logEvento, sanitizarCampos };
