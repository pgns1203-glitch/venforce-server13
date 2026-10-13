// Cobertura — COMPACTA: é apoio ("posso confiar nos números?"), não protagonista.
//
// Dois eixos que NUNCA se misturam:
//   custo      → a base de custos cobre esta venda?
//   financeiro → o marketplace já publicou tarifas/repasse desta venda?
// "Aguardando financeiro" não é "sem custo".
//
// Cada eixo é UMA linha: percentual + barra + os números que o explicam. Eixo
// que NÃO se aplica ao motor (Shopee não separa financeiro disponível ×
// pendente) vira uma nota de uma linha — não um card vazio.
import { coberturas } from "../../../utils/financeiro/resumoFechamento.js";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";

function Item({ rotulo, valor, tipo }) {
  return (
    <div className="vf-fin-cob__item">
      <dt>{rotulo}</dt>
      <dd>{formatarValor(valor, tipo)}</dd>
    </div>
  );
}

function Barra({ pontos }) {
  if (pontos === null || pontos === undefined) return null;
  const largura = Math.max(0, Math.min(100, Number(pontos)));
  return (
    <span className="vf-fin-cobertura__barra" aria-hidden="true">
      <span style={{ width: `${largura}%` }} />
    </span>
  );
}

export function CoberturaFechamento({ summary, unmatchedIds, unmatchedCosts }) {
  const { custo, financeiro } = coberturas(summary, { unmatchedIds, unmatchedCosts });
  return (
    <div className="vf-fin-cob">
      <section className="vf-fin-cob__linha" aria-label="Cobertura de custos" data-eixo="custo">
        <div className="vf-fin-cob__resumo">
          <span className="vf-fin-cob__nome">Custos</span>
          <span className="vf-fin-cob__pct">{formatarValor(custo.percentual, "pontos")}</span>
          <Barra pontos={custo.percentual} />
        </div>
        <dl className="vf-fin-cob__itens">
          <Item rotulo="Receita com custo" valor={custo.receitaComCusto} />
          <Item rotulo="Receita sem custo" valor={custo.receitaSemCusto} />
          <Item rotulo="Produtos sem custo" valor={custo.produtosSemCusto} tipo="numero" />
          {custo.custosAmbiguos !== null && <Item rotulo="Custos ambíguos" valor={custo.custosAmbiguos} tipo="numero" />}
        </dl>
      </section>
      {financeiro.aplicavel ? (
        <section className="vf-fin-cob__linha" aria-label="Cobertura financeira" data-eixo="financeiro">
          <div className="vf-fin-cob__resumo">
            <span className="vf-fin-cob__nome">Financeiro</span>
            <span className="vf-fin-cob__pct">{formatarValor(financeiro.percentual, "pontos")}</span>
            <Barra pontos={financeiro.percentual} />
          </div>
          <dl className="vf-fin-cob__itens">
            <Item rotulo="Receita com financeiro disponível" valor={financeiro.receitaComFinanceiro} />
            <Item rotulo="Receita aguardando financeiro" valor={financeiro.receitaAguardando} />
            <Item rotulo="Vendas aguardando financeiro" valor={financeiro.vendasAguardando} tipo="numero" />
          </dl>
        </section>
      ) : (
        <aside className="vf-fin-cobertura__nota" aria-label="Cobertura financeira" data-eixo="financeiro">
          <strong>Cobertura financeira:</strong> este motor não separa financeiro disponível × pendente — as tarifas e o repasse
          vêm da própria planilha processada.
        </aside>
      )}
    </div>
  );
}
