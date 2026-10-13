// Leitura do fechamento — frases determinísticas sobre números do backend.
// Explica POR QUE o fechamento é parcial; não usa IA nem cria interpretação.
import { leituraDoFechamento } from "../../../utils/financeiro/resumoFechamento.js";

const MARCA = { success: "✓", warning: "!", danger: "×", neutral: "·" };

export function LeituraFechamento({ processamento, marketplace }) {
  const frases = leituraDoFechamento({
    summary: processamento?.summary,
    marketplace,
    unmatchedIds: processamento?.unmatchedIds,
    unmatchedCosts: processamento?.unmatchedCosts,
    competencia: processamento?.competencia,
  });
  const notas = Array.isArray(processamento?.summary?.executiveNotes) ? processamento.summary.executiveNotes.filter(Boolean) : [];
  if (!frases.length && !notas.length) return null;
  return (
    <section className="vf-fin-bloco" aria-label="Leitura do fechamento">
      <h4 className="vf-fin-bloco__titulo">Leitura do fechamento</h4>
      <ul className="vf-fin-leitura">
        {frases.map((f, i) => (
          <li key={i} className={`vf-fin-leitura__item is-${f.tom}`}>
            <span aria-hidden="true">{MARCA[f.tom]}</span> {f.texto}
          </li>
        ))}
      </ul>
      {notas.length > 0 && (
        <details className="vf-fin-disclosure">
          <summary>Notas do motor ({notas.length})</summary>
          <ul className="vf-fin-leitura">
            {notas.map((n, i) => (
              <li key={i} className="vf-fin-leitura__item is-neutral">{n}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
