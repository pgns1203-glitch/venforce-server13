// server/services/painelContas/painelContasVariacao.js
// Contrato de variação mês-a-mês do Painel de Contas (Auditoria §12).
//
// delta/deltaPct/deltaPp seguem EXATAMENTE a lógica de
// cliente360ResultadoService.js:67-78 — não são importadas de lá porque esse
// módulo não as exporta (só exporta `montarVariacao`, que tem um shape fixo
// de campos do motor de fechamento, não reutilizável aqui). Reimplementação
// IDÊNTICA, conforme a auditoria autoriza explicitamente (§12/§19).
//
// Métricas ABSOLUTAS (fat, lc, ads) -> {abs, pct}. Métricas de TAXA
// (mc, acos, tacos, já em fração 0-1) -> {pp} (pontos percentuais).
// null em qualquer ponta -> null. x === 0 nunca produz Infinity (guard
// explícito em deltaPct, igual ao motor oficial).
const { sanitizarParaJson } = require("../cliente360/cliente360ResultadoService");

function round2(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : null;
}

function delta(x, y) {
  if (x === null || x === undefined || y === null || y === undefined) return null;
  return round2(Number(y) - Number(x));
}

function deltaPct(x, y) {
  if (x === null || x === undefined || y === null || y === undefined) return null;
  return Number(x) !== 0 ? (Number(y) - Number(x)) / Math.abs(Number(x)) : null;
}

function deltaPp(x, y) {
  if (x === null || x === undefined || y === null || y === undefined) return null;
  return round2((Number(y) - Number(x)) * 100);
}

// Variação de um `resumo` (fat/lc/mc/ads/acos/tacos) contra o mês anterior.
// com/atv/nps: fora do escopo (§10) — nenhuma variação calculada para eles.
function variacaoResumo(anterior, atual) {
  const a = anterior || {};
  const b = atual || {};
  return {
    fat: { abs: delta(a.fat, b.fat), pct: deltaPct(a.fat, b.fat) },
    lc: { abs: delta(a.lc, b.lc), pct: deltaPct(a.lc, b.lc) },
    mc: { pp: deltaPp(a.mc, b.mc) },
    ads: { abs: delta(a.ads, b.ads), pct: deltaPct(a.ads, b.ads) },
    acos: { pp: deltaPp(a.acos, b.acos) },
    tacos: { pp: deltaPp(a.tacos, b.tacos) },
  };
}

module.exports = { delta, deltaPct, deltaPp, variacaoResumo, sanitizarParaJson };
