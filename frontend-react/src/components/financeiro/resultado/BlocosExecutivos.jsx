// Receitas · Deduções · Custos/Investimentos · Resultado — só os campos que o
// motor do marketplace devolve.
import { blocosExecutivos } from "../../../utils/financeiro/resumoFechamento.js";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";

export function BlocosExecutivos({ summary, marketplace }) {
  const blocos = blocosExecutivos(summary, marketplace);
  return (
    <div className="vf-fin-blocos">
      {blocos.map((b) => (
        <section key={b.id} className="vf-fin-bloco" aria-label={b.titulo} data-bloco={b.id}>
          <h4 className="vf-fin-bloco__titulo">{b.titulo}</h4>
          <dl className="vf-fin-extrato">
            {b.itens.map((i) => (
              <div className="vf-fin-extrato__linha" key={i.chave}>
                <dt>{i.rotulo}</dt>
                <dd>{formatarValor(i.valor, i.tipo)}</dd>
              </div>
            ))}
            {b.status && (
              <div className="vf-fin-extrato__linha">
                <dt>Confiança do fechamento</dt>
                <dd>{b.status}</dd>
              </div>
            )}
          </dl>
        </section>
      ))}
    </div>
  );
}
