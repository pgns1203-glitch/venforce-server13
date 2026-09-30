// server/services/painelContas/painelContasSemanas.js
// Disponibilidade semanal — Opção A confirmada (Auditoria §11/§29 D4, decisão
// técnica adotada): blocos fixos de 7 dias por competência —
// S1=01-07, S2=08-14, S3=15-21, S4=22-28, e S5=29-fim quando o mês tiver
// dias além de 28 (meses de 29/30/31 dias). Nunca semana ISO (cruzaria limite
// de mês, incompatível com toda fonte financeira existente, que é 100%
// ancorada em competência YYYY-MM).
//
// No consolidado legado, só FAT tem série diária em payload_json.porDia.
// Na conta, FAT/LC/MC podem vir dos pedidos canônicos do próprio import;
// Ads/ACOS/TACOS/COM/ATV/NPS continuam null. Nenhuma métrica é rateada.
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

function dataIso(valor) {
  if (!valor) return null;
  return valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor).slice(0, 10);
}

function numeroOuNull(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function round2(valor) {
  return Math.round(Number(valor) * 100) / 100;
}

// Quebra semanal POR CONTA usando as linhas do MESMO import que alimenta o
// FAT mensal da conta. O chamador só invoca esta função quando há import
// selecionado; ausência de import é representada por [] (nenhuma semana
// inventada). Cancelados/mediações seguem o predicado oficial da Central.
//
// A cobertura publicada distingue zero real de ausência: bloco inteiramente
// coberto e sem pedido válido tem FAT 0; fora da cobertura fica null. Em
// imports legacy, sem cobertura auditável, só um bloco com pedido pode afirmar
// valor. LC soma `resultado` real; MC usa a mesma base oficial do import
// (faturamento dos pedidos não bloqueados). Sem resultado/base, ambos são null.
function agruparPedidosEmSemanas(
  competencia,
  pedidos,
  { coberturaInicio = null, coberturaFim = null, pedidoValido = () => true } = {}
) {
  if (!Array.isArray(pedidos)) return [];
  const inicio = dataIso(coberturaInicio);
  const fim = dataIso(coberturaFim);
  const validos = pedidos
    .filter((p) => dataIso(p?.data_pedido)?.startsWith(`${competencia}-`))
    .filter(pedidoValido);

  return blocosDaSemana(competencia).map(({ semana, de, ate }) => {
    const deIso = `${competencia}-${pad2(de)}`;
    const ateIso = `${competencia}-${pad2(ate)}`;
    const doBloco = validos.filter((p) => {
      const data = dataIso(p.data_pedido);
      return data >= deIso && data <= ateIso;
    });
    // Zero só é afirmado quando o bloco inteiro está coberto. Uma publicação
    // parcial que alcança apenas parte da semana não autoriza completar os
    // dias restantes com zero; se houver pedidos, a soma parcial real aparece,
    // caso contrário o bloco permanece ausente.
    const coberto = Boolean(inicio && fim && inicio <= deIso && fim >= ateIso);
    const temDado = coberto || doBloco.length > 0;
    const fat = temDado ? round2(doBloco.reduce((soma, p) => soma + (numeroOuNull(p.faturamento) || 0), 0)) : null;
    const comResultado = doBloco.map((p) => numeroOuNull(p.resultado)).filter((v) => v !== null);
    const lc = comResultado.length ? round2(comResultado.reduce((soma, v) => soma + v, 0)) : null;
    const baseMc = doBloco
      .filter((p) => String(p.confianca || "").toLowerCase() !== "bloqueado")
      .reduce((soma, p) => soma + (numeroOuNull(p.faturamento) || 0), 0);
    const mc = lc !== null && baseMc > 0 ? Math.round((lc / baseMc) * 1e6) / 1e6 : null;
    return {
      semana,
      de: deIso,
      ate: ateIso,
      resumo: { fat, lc, mc, ads: null, acos: null, tacos: null, com: null, atv: null, nps: null },
    };
  });
}

module.exports = { DEFINICAO, blocosDaSemana, agruparEmSemanas, agruparPedidosEmSemanas };
