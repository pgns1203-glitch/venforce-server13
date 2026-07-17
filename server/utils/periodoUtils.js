// server/utils/periodoUtils.js
// Helpers de competência/período para o Cliente 360.
// Competência = mês atual (YYYY-MM), não "últimos 30 dias".
// Datas em horário local do servidor; formato ISO YYYY-MM-DD.

const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymd(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function labelDe(ano, mesIndex) {
  return `${MESES_PT[mesIndex]}/${ano}`;
}

// Competência do mês corrente.
// dateTo = hoje (não o fim do mês) para refletir o acumulado parcial.
function competenciaAtual() {
  const now = new Date();
  const ano = now.getFullYear();
  const mesIndex = now.getMonth();
  const primeiro = new Date(ano, mesIndex, 1);
  return {
    competencia: `${ano}-${pad2(mesIndex + 1)}`,
    label: labelDe(ano, mesIndex),
    dateFrom: ymd(primeiro),
    dateTo: ymd(now),
  };
}

// Alias semântico.
function periodoMesAtual() {
  return competenciaAtual();
}

// Competência imediatamente anterior a uma "YYYY-MM" (vira o ano corretamente:
// 2026-01 → 2025-12). Retorna null para entrada inválida.
function competenciaAnteriorDe(competencia) {
  const match = String(competencia || "").trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const ano = parseInt(match[1], 10);
  const mes = parseInt(match[2], 10);
  if (mes < 1 || mes > 12) return null;
  const d = new Date(ano, mes - 2, 1); // mes é 1-based; -2 = mês anterior em 0-based
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

// Mês anterior FECHADO — período padrão da Cliente 360.
// Mês corrente é instável (muda todo dia); o anterior é comparável e estável.
function periodoMesAnterior() {
  const anterior = competenciaAnteriorDe(competenciaAtual().competencia);
  return parseCompetencia(anterior);
}

// Valida e normaliza uma string "YYYY-MM". Retorna null se inválida.
function parseCompetencia(competencia) {
  const texto = String(competencia || "").trim();
  const match = texto.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const ano = parseInt(match[1], 10);
  const mes = parseInt(match[2], 10);
  if (mes < 1 || mes > 12) return null;
  const range = rangeFromCompetencia(texto);
  return {
    competencia: texto,
    label: labelDe(ano, mes - 1),
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
  };
}

// Range completo do mês de uma competência "YYYY-MM".
// dateTo = último dia do mês.
function rangeFromCompetencia(competencia) {
  const texto = String(competencia || "").trim();
  const match = texto.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    const atual = competenciaAtual();
    return { dateFrom: atual.dateFrom, dateTo: atual.dateTo };
  }
  const ano = parseInt(match[1], 10);
  const mes = parseInt(match[2], 10); // 1-12
  const primeiro = new Date(ano, mes - 1, 1);
  const ultimo = new Date(ano, mes, 0); // dia 0 do mês seguinte = último dia
  return { dateFrom: ymd(primeiro), dateTo: ymd(ultimo) };
}

module.exports = {
  competenciaAtual,
  periodoMesAtual,
  periodoMesAnterior,
  competenciaAnteriorDe,
  parseCompetencia,
  rangeFromCompetencia,
};
