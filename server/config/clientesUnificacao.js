// O projeto não possui parser genérico exportado; a config de Squads tem gate
// próprio. Aqui só "true" explícito habilita, sem compartilhar esse gate.
const enabled = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase() === "true";
function flags(env = process.env) {
  return {
    execute: enabled(env.CLIENTES_UNIFICACAO_EXECUTE_ENABLED),
    rollback: enabled(env.CLIENTES_UNIFICACAO_ROLLBACK_ENABLED),
  };
}
// Só transações READ ONLY. Escrita mantém os quatro limites originais.
function previewTimeoutMs(env = process.env) {
  const raw = String(env.CLIENTES_UNIFICACAO_PREVIEW_TIMEOUT_MS || "");
  const value = /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(value) && value >= 15000 && value <= 45000
    ? value
    : 30000;
}
module.exports = { flags, enabled, previewTimeoutMs };
