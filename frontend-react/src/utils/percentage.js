// Percentuais em pt-BR.
//
// Contrato com o backend: margens e TACoS chegam como FRAÇÃO (0,041) e variações
// de margem chegam como PONTOS PERCENTUAIS já calculados (`deltaPp`, `pp`).
// Ausente continua sendo "—", nunca "0%".

import { ehAusente, AUSENTE } from "./numbers.js";

export function formatarPercentual(fracao, casas = 1) {
  if (ehAusente(fracao)) return AUSENTE;
  return `${(Number(fracao) * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })}%`;
}

// Variação percentual com sinal explícito (+12,4% / −8,1%).
export function formatarVariacaoPercentual(fracao, casas = 1) {
  if (ehAusente(fracao)) return AUSENTE;
  const n = Number(fracao) * 100;
  const sinal = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sinal}${Math.abs(n).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })}%`;
}

// Pontos percentuais vindos prontos do backend (margem subiu 1,3 p.p.).
export function formatarPontosPercentuais(pp, casas = 1) {
  if (ehAusente(pp)) return AUSENTE;
  const n = Number(pp);
  const sinal = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sinal}${Math.abs(n).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })} p.p.`;
}
