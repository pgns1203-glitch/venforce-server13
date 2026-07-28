// server/services/cliente360/cliente360Periodo.js
// Utilitários PUROS de competência/período do cockpit de resultado da Cliente 360.
// Centraliza a regra de COMPETÊNCIA PARCIAL para que backend e testes tenham uma
// fonte única:
//   - mês fechado  → compara o mês inteiro contra o mês inteiro anterior;
//   - mês corrente → compara do dia 1 até HOJE contra o MESMO número de dias do
//     mês anterior (nunca parcial contra mês cheio).
//
// Timezone: o projeto opera em America/Sao_Paulo. Como as datas do fechamento são
// strings ISO (YYYY-MM-DD) sem hora, o "hoje" é resolvido no fuso do projeto para
// não virar o dia por causa do UTC do servidor.

const TIMEZONE = "America/Sao_Paulo";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const COMPETENCIA_REGEX = /^\d{4}-\d{2}$/;

// Data de hoje (YYYY-MM-DD) no fuso do projeto, independente do TZ do processo.
function hojeIso(agora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
  return partes; // en-CA já formata como YYYY-MM-DD
}

function competenciaAtual(agora = new Date()) {
  return hojeIso(agora).slice(0, 7);
}

function ehCompetenciaValida(valor) {
  return COMPETENCIA_REGEX.test(String(valor || ""));
}

function normalizarCompetencia(valor, agora = new Date()) {
  const texto = String(valor || "").trim();
  return ehCompetenciaValida(texto) ? texto : competenciaAtual(agora);
}

function competenciaAnteriorDe(competencia) {
  const [ano, mes] = String(competencia).split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function proximaCompetencia(competencia) {
  const [ano, mes] = String(competencia).split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function diasNoMes(competencia) {
  const [ano, mes] = String(competencia).split("-").map(Number);
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function rotuloCompetencia(competencia) {
  const mes = Number(String(competencia || "").slice(5, 7));
  const ano = String(competencia || "").slice(0, 4);
  const nome = MESES[mes - 1];
  return nome ? `${nome}/${ano}` : String(competencia || "");
}

// Range de uma competência. `ateDia` limita o último dia (usado no mês parcial e
// para espelhar o mesmo nº de dias no período comparado).
function rangeDaCompetencia(competencia, { ateDia = null } = {}) {
  const ultimoDia = diasNoMes(competencia);
  const fimDia = Math.min(Math.max(Number(ateDia) || ultimoDia, 1), ultimoDia);
  return {
    competencia,
    inicio: `${competencia}-01`,
    fim: `${competencia}-${String(fimDia).padStart(2, "0")}`,
    diasNoPeriodo: fimDia,
    diasNoMes: ultimoDia,
    parcial: fimDia < ultimoDia,
    label: rotuloCompetencia(competencia),
  };
}

// Resolve os dois períodos da tela aplicando a regra de competência parcial.
// Devolve { atual, comparado } já com `parcial` marcado.
function resolverPeriodos(competencia, compararCom, agora = new Date()) {
  const compAtual = competencia;
  const compComparado = compararCom || competenciaAnteriorDe(compAtual);

  const corrente = compAtual === competenciaAtual(agora);
  const diaDeHoje = Number(hojeIso(agora).slice(8, 10));

  const atual = corrente
    ? rangeDaCompetencia(compAtual, { ateDia: diaDeHoje })
    : rangeDaCompetencia(compAtual);

  // Mês corrente é parcial: o comparado tem que usar o MESMO nº de dias.
  const comparado = atual.parcial
    ? rangeDaCompetencia(compComparado, { ateDia: atual.diasNoPeriodo })
    : rangeDaCompetencia(compComparado);

  return { atual, comparado };
}

// Lista as N competências anteriores à referência (mais antiga → mais recente).
function competenciasAnteriores(competenciaRef, quantidade) {
  const out = [];
  let cursor = competenciaRef;
  for (let i = 0; i < quantidade; i++) {
    cursor = competenciaAnteriorDe(cursor);
    out.push(cursor);
  }
  return out.reverse();
}

module.exports = {
  TIMEZONE,
  MESES,
  hojeIso,
  competenciaAtual,
  ehCompetenciaValida,
  normalizarCompetencia,
  competenciaAnteriorDe,
  proximaCompetencia,
  diasNoMes,
  rotuloCompetencia,
  rangeDaCompetencia,
  resolverPeriodos,
  competenciasAnteriores,
};
