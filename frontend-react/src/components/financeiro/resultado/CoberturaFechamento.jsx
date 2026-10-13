// Dois eixos que NUNCA se misturam:
//   custo      → a base de custos cobre esta venda?
//   financeiro → o marketplace já publicou tarifas/repasse desta venda?
// "Aguardando financeiro" não é "sem custo".
//
// Quando um eixo NÃO se aplica ao motor (Shopee não separa financeiro
// disponível × pendente), ele vira uma nota compacta — não um card vazio do
// mesmo tamanho do outro. Ausência de dado não reserva espaço.
import { coberturas } from "../../../utils/financeiro/resumoFechamento.js";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";

function Linha({ rotulo, valor, tipo }) {
  return (
    <div className="vf-fin-extrato__linha">
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
    <div className={`vf-fin-cobertura${financeiro.aplicavel ? " vf-fin-cobertura--2" : ""}`}>
      <section className="vf-fin-bloco" aria-label="Cobertura de custos" data-eixo="custo">
        <h4 className="vf-fin-bloco__titulo">Cobertura de custos</h4>
        <p className="vf-fin-cobertura__pct">{formatarValor(custo.percentual, "pontos")}</p>
        <Barra pontos={custo.percentual} />
        <dl className="vf-fin-extrato">
          <Linha rotulo="Receita com custo" valor={custo.receitaComCusto} />
          <Linha rotulo="Receita sem custo" valor={custo.receitaSemCusto} />
          <Linha rotulo="Produtos sem custo" valor={custo.produtosSemCusto} tipo="numero" />
          {custo.custosAmbiguos !== null && <Linha rotulo="Custos ambíguos" valor={custo.custosAmbiguos} tipo="numero" />}
        </dl>
      </section>
      {financeiro.aplicavel ? (
        <section className="vf-fin-bloco" aria-label="Cobertura financeira" data-eixo="financeiro">
          <h4 className="vf-fin-bloco__titulo">Cobertura financeira</h4>
          <p className="vf-fin-cobertura__pct">{formatarValor(financeiro.percentual, "pontos")}</p>
          <Barra pontos={financeiro.percentual} />
          <dl className="vf-fin-extrato">
            <Linha rotulo="Receita com financeiro disponível" valor={financeiro.receitaComFinanceiro} />
            <Linha rotulo="Receita aguardando financeiro" valor={financeiro.receitaAguardando} />
            <Linha rotulo="Vendas aguardando financeiro" valor={financeiro.vendasAguardando} tipo="numero" />
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
