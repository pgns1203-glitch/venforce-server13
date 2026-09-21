// server/services/painelContas/painelContasSemanas.js
// Disponibilidade semanal — Opção A confirmada (Auditoria §11/§29 D4, decisão
// técnica adotada): blocos fixos de 7 dias por competência —
// S1=01-07, S2=08-14, S3=15-21, S4=22-28, e S5=29-fim quando o mês tiver
// dias além de 28 (meses de 29/30/31 dias). Nunca semana ISO (cruzaria limite
// de mês, incompatível com toda fonte financeira existente, que é 100%
// ancorada em competência YYYY-MM).
//
// Só FAT tem série diária persistida (payload_json.porDia) — todo o resto
// (LC/MC/ADS/ACOS/TACOS/COM/ATV/NPS) é `null` em granularidade semanal,
// NUNCA o valor mensal rateado (Auditoria §11, regra dura).
const DEFINICAO = "dias_fixos_01_07_08_14_15_21_22_28_29_fim";

function ultimoDiaDoMes(competencia) {
  const [ano, mes] = String(competencia).split("-").map(Number);
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Blocos [de, ate] em dia-do-mês (1-indexado), parando no último dia real do
// mês. S5 só aparece quando o mês tem dia 29 (Auditoria §11).
function blocosDaSemana(competencia) {
  const ultimoDia = ultimoDiaDoMes(competencia);
  const cortes = [1, 8, 15, 22, 29];
  const blocos = [];
  for (let i = 0; i < cortes.length; i++) {
    const de = cortes[i];
    if (de > ultimoDia) break;
    const proximoCorte = cortes[i + 1];
    const ate = Math.min((proximoCorte || ultimoDia + 1) - 1, ultimoDia);
    blocos.push({ semana: `S${i + 1}`, de, ate });
  }
  return blocos;
}

// `porDia`: array [{data:"YYYY-MM-DD", vendasBrutas}] do payload_json do
// snapshot mensal (cliente360SyncService já grava vendasBrutas sempre
// numérico, nunca null — 0 real é 0). Bloco sem NENHUM dia presente no
// payload -> fat null (ausência de dado, não venda zero). Bloco com dias
// presentes -> soma real, mesmo que o resultado seja 0.
function agruparEmSemanas(competencia, porDia) {
  const dias = Array.isArray(porDia) ? porDia : [];
  const blocos = blocosDaSemana(competencia);
  return blocos.map(({ semana, de, ate }) => {
    const doBloco = dias.filter((d) => {
      const dia = Number(String(d?.data || "").slice(8, 10));
      return Number.isFinite(dia) && dia >= de && dia <= ate;
    });
    const fat = doBloco.length
      ? Math.round(doBloco.reduce((soma, d) => soma + (Number(d.vendasBrutas) || 0), 0) * 100) / 100
      : null;
    return {
      semana,
      de: `${competencia}-${pad2(de)}`,
      ate: `${competencia}-${pad2(ate)}`,
      resumo: { fat, lc: null, mc: null, ads: null, acos: null, tacos: null, com: null, atv: null, nps: null },
    };
  });
}

module.exports = { DEFINICAO, blocosDaSemana, agruparEmSemanas };
