// Plano de prioridades — Alta/Média/Baixa, cada nível recolhido com o
// resumo (n ações) e "+ Adicionar ação". Cada ação: título, o que será
// feito, data prevista (texto livre, como no legado: "15/06").
import { NIVEIS_PRIORIDADE } from "../../../utils/financeiro/entregaConteudo.js";

const ACAO_VAZIA = { titulo: "", desc: "", data: "" };

function Nivel({ nivel, acoes, onChange, somenteLeitura }) {
  const atualizar = (i, campo, v) => onChange(acoes.map((a, j) => (j === i ? { ...a, [campo]: v } : a)));
  const preenchidas = acoes.filter((a) => a.titulo.trim()).length;
  return (
    <details className="vf-fin-prioridade" open={acoes.length > 0 || undefined} data-nivel={nivel.id}>
      <summary>
        <span className={`vf-fin-prioridade__ponto is-${nivel.id}`} aria-hidden="true" />
        {nivel.label} <span className="vf-field__hint">· {preenchidas} {preenchidas === 1 ? "ação" : "ações"}</span>
      </summary>
      <div className="vf-stack vf-stack--sm">
        {acoes.map((a, i) => (
          <div className="vf-fin-prioridade__acao" key={i}>
            {somenteLeitura ? (
              <p className="vf-fin-leitura__item is-neutral">
                <strong>{a.titulo || "—"}</strong>
                {a.desc ? ` — ${a.desc}` : ""}
                {a.data ? ` · ${a.data}` : ""}
              </p>
            ) : (
              <>
                <input className="vf-input vf-input--sm" aria-label={`${nivel.label}: título da ação ${i + 1}`} placeholder="Título" value={a.titulo} onChange={(e) => atualizar(i, "titulo", e.target.value)} />
                <input className="vf-input vf-input--sm" aria-label={`${nivel.label}: o que será feito ${i + 1}`} placeholder="O que será feito" value={a.desc} onChange={(e) => atualizar(i, "desc", e.target.value)} />
                <input className="vf-input vf-input--sm" aria-label={`${nivel.label}: data prevista ${i + 1}`} placeholder="Data prevista (ex: 15/06)" value={a.data} onChange={(e) => atualizar(i, "data", e.target.value)} />
                <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" aria-label={`Remover ação ${i + 1} de ${nivel.label}`} onClick={() => onChange(acoes.filter((_, j) => j !== i))}>
                  Remover
                </button>
              </>
            )}
          </div>
        ))}
        {!somenteLeitura && (
          <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => onChange([...acoes, { ...ACAO_VAZIA }])}>
            + Adicionar ação
          </button>
        )}
      </div>
    </details>
  );
}

export function EntregaPrioridades({ conteudo, onChange, somenteLeitura }) {
  return (
    <fieldset className="vf-fin-entrega__lista">
      <legend className="vf-fin-bloco__titulo">Plano de prioridades</legend>
      {NIVEIS_PRIORIDADE.map((n) => (
        <Nivel
          key={n.id}
          nivel={n}
          acoes={conteudo.prioridades[n.id] || []}
          somenteLeitura={somenteLeitura}
          onChange={(acoes) => onChange({ ...conteudo, prioridades: { ...conteudo.prioridades, [n.id]: acoes } })}
        />
      ))}
    </fieldset>
  );
}
