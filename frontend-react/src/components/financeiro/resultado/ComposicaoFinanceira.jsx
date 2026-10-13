// Composição financeira: Receitas · Deduções · Custos/Investimentos ·
// Resultado, lado a lado numa só moldura (quatro colunas, divisores leves) em
// vez de quatro caixas com muito espaço vazio. Só os campos que o motor do
// marketplace devolve; nenhum número é calculado aqui.
//
// Custos/Investimentos aparecem com sinal de menos: o backend devolve o total
// positivo (adsTotal) e o desconta do LC no finalResult.
import { blocosExecutivos, numOuNull } from "../../../utils/financeiro/resumoFechamento.js";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";

function valorDoItem(bloco, item) {
  if (bloco.id !== "investimentos") return formatarValor(item.valor, item.tipo);
  const n = numOuNull(item.valor);
  if (n === null) return formatarValor(null);
  return n === 0 ? formatarValor(0) : formatarValor(-n, "moeda");
}

export function ComposicaoFinanceira({ summary, marketplace }) {
  const blocos = blocosExecutivos(summary, marketplace);
  return (
    <div className="vf-fin-composicao-grid">
      {blocos.map((b) => (
        <section key={b.id} className="vf-fin-composicao-col" aria-label={b.titulo} data-bloco={b.id}>
          <h4 className="vf-fin-bloco__titulo">{b.titulo}</h4>
          <dl className="vf-fin-extrato">
            {b.itens.map((i) => (
              <div
                className={`vf-fin-extrato__linha${b.id === "investimentos" ? " is-despesa" : ""}${i.chave === "finalResult" ? " is-total" : ""}`}
                key={i.chave}
                data-despesa={b.id === "investimentos" ? i.chave : undefined}
              >
                <dt>{i.rotulo}</dt>
                <dd>{valorDoItem(b, i)}</dd>
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
