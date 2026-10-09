// LC Total → despesas comerciais → Resultado Final. Todos os números são do
// backend (summary.*Total e summary.finalResult); a tela não soma nada.
import { composicaoResultado, numOuNull } from "../../../utils/financeiro/resumoFechamento.js";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";

export function ComposicaoResultado({ summary }) {
  const { lc, despesas, resultado } = composicaoResultado(summary);
  return (
    <section className="vf-fin-bloco" aria-label="Composição do resultado">
      <h4 className="vf-fin-bloco__titulo">Do LC ao Resultado Final</h4>
      <dl className="vf-fin-extrato">
        <div className="vf-fin-extrato__linha">
          <dt>{lc.rotulo}</dt>
          <dd>{formatarValor(lc.valor, "moeda")}</dd>
        </div>
        {despesas.map((d) => {
          const n = numOuNull(d.valor);
          return (
            <div className="vf-fin-extrato__linha is-despesa" key={d.chave} data-despesa={d.chave}>
              {/* Despesa exibida com sinal de menos — o backend devolve o total
                  positivo (adsTotal) e o desconta do LC no finalResult. */}
              <dt>− {d.rotulo}</dt>
              <dd>{n === null ? formatarValor(null) : n === 0 ? formatarValor(0) : formatarValor(-n, "moeda")}</dd>
            </div>
          );
        })}
        <div className="vf-fin-extrato__linha is-total">
          <dt>{resultado.rotulo}</dt>
          <dd>{formatarValor(resultado.valor, "moeda")}</dd>
        </div>
      </dl>
    </section>
  );
}
