// Composição financeira — os quatro cartões do detalhamento executivo do
// legado (Receitas · Deduções · Custos/Investimentos · Resultado), cada um um
// cartão de verdade, com linhas rótulo/valor separadas por divisor leve e o
// Resultado Final como linha de total. Só os campos que o motor do
// marketplace devolve; nenhum número é calculado aqui.
//
// Custos/Investimentos aparecem com sinal de menos: o backend devolve o total
// positivo (adsTotal) e o desconta do LC no finalResult. Zero não é despesa:
// fica neutro, não vermelho.
import { blocosExecutivos, numOuNull } from "../../../utils/financeiro/resumoFechamento.js";
import { formatarValor, tomDoValor } from "../shared/ValorFinanceiro.jsx";

function valorDoItem(bloco, item) {
  if (bloco.id !== "investimentos") return formatarValor(item.valor, item.tipo);
  const n = numOuNull(item.valor);
  if (n === null) return formatarValor(null);
  return n === 0 ? formatarValor(0) : formatarValor(-n, "moeda");
}

// Como no legado: resultado e margens pintados pelo sinal; o resto neutro.
const COM_TOM = new Set(["contributionProfitTotal", "mcCalculada", "finalResult", "finalMarginCalculated"]);

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
                className={`vf-fin-extrato__linha${b.id === "investimentos" && numOuNull(i.valor) > 0 ? " is-despesa" : ""}${i.chave === "finalResult" ? " is-total" : ""}${COM_TOM.has(i.chave) ? ` is-${tomDoValor(i.valor)}` : ""}`}
                key={i.chave}
                data-despesa={b.id === "investimentos" ? i.chave : undefined}
              >
                <dt>{i.rotulo}</dt>
                <dd>{valorDoItem(b, i)}</dd>
              </div>
            ))}
            {b.status && (
              <div className={`vf-fin-extrato__linha is-status${b.confianca ? ` is-confianca-${b.confianca}` : ""}`}>
                <dt>Status do fechamento</dt>
                <dd>{b.status}</dd>
              </div>
            )}
          </dl>
        </section>
      ))}
    </div>
  );
}
