// Leitura do fechamento — frases determinísticas sobre números do backend.
// Explica POR QUE o fechamento é parcial; não usa IA nem cria interpretação.
//
// É APOIO, não protagonista: um painel discreto ao lado dos KPIs (na faixa de
// topo do resultado), em texto pequeno. Só os ALERTAS (warning/danger) ficam
// à vista; contexto (neutral/success) e as notas técnicas do motor ficam
// recolhidos. Frases que só repetem o que o cabeçalho e os KPIs já dizem (modo,
// Resultado Final) não aparecem aqui.
import { leituraDoFechamento } from "../../../utils/financeiro/resumoFechamento.js";

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
  const recolhido = contexto.length + notas.length;

  return (
    <aside className="vf-fin-leitura-card" aria-label="Leitura do fechamento" data-secao="leitura">
      <h4 className="vf-fin-bloco__titulo">Leitura do fechamento</h4>
      {alertas.length > 0 ? (
        <ul className="vf-fin-leitura vf-fin-leitura--alertas" aria-label="Pontos de atenção">
          {alertas.map((f, i) => (
            <li key={i} className={`vf-fin-leitura__item is-${f.tom}`}>
              <span aria-hidden="true">{MARCA[f.tom]}</span> {f.texto}
            </li>
          ))}
        </ul>
      ) : (
        <p className="vf-fin-leitura__vazio">Nenhum ponto de atenção.</p>
      )}
      {recolhido > 0 && (
        <details className="vf-fin-disclosure vf-fin-disclosure--leve">
          <summary>Contexto e notas técnicas ({recolhido})</summary>
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
            <ul className="vf-fin-leitura vf-fin-leitura--notas" aria-label="Notas técnicas do motor">
              {notas.map((n, i) => (
                <li key={i} className="vf-fin-leitura__item is-neutral">{n}</li>
              ))}
            </ul>
          )}
        </details>
      )}
    </aside>
  );
}
