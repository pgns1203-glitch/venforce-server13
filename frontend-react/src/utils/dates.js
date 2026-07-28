// Datas e competências (YYYY-MM).
//
// O backend é a autoridade sobre qual período foi realmente usado (inclusive a
// regra de mês parcial). Aqui só formatamos e montamos a lista do seletor.

import { AUSENTE } from "./numbers.js";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function ehCompetencia(valor) {
  return /^\d{4}-\d{2}$/.test(String(valor || ""));
}

export function rotularCompetencia(competencia) {
  if (!ehCompetencia(competencia)) return AUSENTE;
  const [ano, mes] = competencia.split("-");
  const nome = MESES[Number(mes) - 1];
  return nome ? `${nome[0].toUpperCase()}${nome.slice(1)}/${ano}` : competencia;
}

export function competenciaAnterior(competencia) {
  const [ano, mes] = String(competencia).split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function competenciaAtual(agora = new Date()) {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

// Últimas N competências, da mais recente para a mais antiga, incluindo o mês
// corrente (que a tela marca como "Período parcial").
export function competenciasRecentes(quantidade = 13, agora = new Date()) {
  const out = [];
  let cursor = competenciaAtual(agora);
  for (let i = 0; i < quantidade; i++) {
    out.push(cursor);
    cursor = competenciaAnterior(cursor);
  }
  return out;
}

export function formatarData(iso) {
  if (!iso) return AUSENTE;
  const [ano, mes, dia] = String(iso).slice(0, 10).split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : AUSENTE;
}

export function formatarDataHora(iso) {
  if (!iso) return AUSENTE;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? AUSENTE
    : d.toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
}
