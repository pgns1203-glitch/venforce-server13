// frontend-react/src/components/financeiro/shared/SecaoFinanceira.jsx
//
// Moldura ÚNICA das seções grandes do fechamento (resultado, leitura,
// cobertura, pendências, reconciliação, composição, ações, produtos). Dá a
// página o mesmo ritmo — título, respiro vertical, divisor leve — em vez de
// cada bloco ter a sua caixa. Quem precisa de uma caixa (um card de verdade)
// usa `.vf-fin-bloco` por dentro; a seção em si não é um card.

import { useId } from "react";

export function SecaoFinanceira({ id, titulo, descricao, acoes, children, className = "" }) {
  const tituloId = `${useId()}-titulo`;
  return (
    <section className={`vf-fin-secao ${className}`.trim()} data-secao={id} aria-labelledby={tituloId}>
      <header className="vf-fin-secao__cabecalho">
        <div className="vf-fin-secao__textos">
          <h3 id={tituloId} className="vf-fin-secao__titulo">{titulo}</h3>
          {descricao ? <p className="vf-fin-secao__descricao">{descricao}</p> : null}
        </div>
        {acoes ? <div className="vf-cluster vf-fin-secao__acoes">{acoes}</div> : null}
      </header>
      <div className="vf-fin-secao__corpo">{children}</div>
    </section>
  );
}
