// frontend-react/src/utils/periodoUrl.js
// Período (`&periodo=YYYY-MM`) espelhado na URL — compartilhado entre Visão
// e Financeiro (mesmo formato de competência nos dois backends). Período
// NÃO é contexto canônico (D11 do Master Spec): passageiro na URL, não
// passa por vf-context.js.

import { competenciaAtual, ehCompetencia } from "./dates.js";

export function lerPeriodoDaUrl(search = window.location.search) {
  const q = new URLSearchParams(search || "");
  return ehCompetencia(q.get("periodo")) ? q.get("periodo") : competenciaAtual();
}

export function escreverPeriodoNaUrl(periodo) {
  const q = new URLSearchParams(window.location.search || "");
  if (periodo) q.set("periodo", periodo);
  else q.delete("periodo");
  window.history.replaceState({}, "", `${window.location.pathname}?${q}`);
}
