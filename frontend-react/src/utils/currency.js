// Moeda em pt-BR. Ausente vira "—", nunca "R$ 0,00".

import { ehAusente, AUSENTE } from "./numbers.js";

// Usa o sinal de menos tipográfico (−, U+2212) em vez do hífen: alinha melhor
// em coluna numérica e não é confundido com um traço de separação.
export function formatarMoeda(valor, { casas = 2, sinalPositivo = false } = {}) {
  if (ehAusente(valor)) return AUSENTE;
  const n = Number(valor);
  const corpo = Math.abs(n).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
  if (n < 0) return `−R$ ${corpo}`;
  return `${sinalPositivo && n > 0 ? "+" : ""}R$ ${corpo}`;
}

// Variação em reais, sempre com sinal explícito (+R$ 3.500,00 / −R$ 2.640,00).
export function formatarVariacaoMoeda(valor, casas = 2) {
  return formatarMoeda(valor, { casas, sinalPositivo: true });
}

// Versão compacta para KPIs muito largos.
export function formatarMoedaCompacta(valor) {
  if (ehAusente(valor)) return AUSENTE;
  const n = Number(valor);
  const abs = Math.abs(n);
  const sinal = n < 0 ? "−" : "";
  if (abs >= 1_000_000) {
    return `${sinal}R$ ${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  }
  if (abs >= 10_000) {
    return `${sinal}R$ ${(abs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  }
  return formatarMoeda(n);
}
