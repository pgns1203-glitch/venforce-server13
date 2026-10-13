// Leitura do fechamento — frases determinísticas sobre números do backend.
// Explica POR QUE o fechamento é parcial; não usa IA nem cria interpretação.
//
// Dois pesos: ALERTAS (warning/danger — o que pede atenção) em destaque, e
// CONTEXTO (neutral/success) em texto de apoio. Frases que só repetem o que o
// cabeçalho e os KPIs já dizem (modo, Resultado Final) não são repetidas aqui.
// Notas técnicas do motor ficam recolhidas.
import { leituraDoFechamento } from "../../../utils/financeiro/resumoFechamento.js";
import { SecaoFinanceira } from "../shared/SecaoFinanceira.jsx";

const MARCA = { success: "✓", warning: "!", danger: "×", neutral: "·" };
const ehAlerta = (f) => f.tom === "warning" || f.tom === "danger";

export function LeituraFechamento({ processamento, marketplace }) {
  const frases = leituraDoFechamento({
    summary: processamento?.summary,
    marketplace,
    unmatchedIds: processamento?.unmatchedIds,
    unmatchedCosts: processamento?.unmatchedCosts,
    competencia: processamento?.competencia,
  }).filter((f) => !f.redundante);
  const notas = Array.isArray(processamento?.summary?.executiveNotes) ? processamento.summary.executiveNotes.filter(Boolean) : [];
  if (!frases.length && !notas.length) return null;

  const alertas = frases.filter(ehAlerta);
  const contexto = frases.filter((f) => !ehAlerta(f));

  return (
    <SecaoFinanceira id="leitura" titulo="Leitura do fechamento" className="vf-fin-leitura-bloco">
      {alertas.length > 0 && (
        <ul className="vf-fin-leitura vf-fin-leitura--alertas" aria-label="Pontos de atenção">
          {alertas.map((f, i) => (
            <li key={i} className={`vf-fin-leitura__item is-${f.tom}`}>
              <span aria-hidden="true">{MARCA[f.tom]}</span> {f.texto}
            </li>
          ))}
        </ul>
      )}
      {contexto.length > 0 && (
        <ul className="vf-fin-leitura vf-fin-leitura--contexto" aria-label="Contexto">
          {contexto.map((f, i) => (
            <li key={i} className={`vf-fin-leitura__item is-${f.tom}`}>
              <span aria-hidden="true">{MARCA[f.tom]}</span> {f.texto}
            </li>
          ))}
        </ul>
      )}
      {notas.length > 0 && (
        <details className="vf-fin-disclosure">
          <summary>Notas técnicas do motor ({notas.length})</summary>
          <ul className="vf-fin-leitura">
            {notas.map((n, i) => (
              <li key={i} className="vf-fin-leitura__item is-neutral">{n}</li>
            ))}
          </ul>
        </details>
      )}
    </SecaoFinanceira>
  );
}
