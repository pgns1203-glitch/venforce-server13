// frontend-react/src/components/financeiro/mesa/DetalhesFechamento.jsx
//
// O detalhamento completo do fechamento — o conteúdo do drawer "Detalhes"
// da cascata. Tudo o que a mesa resume: a leitura (alertas), a reconciliação
// Shopee (Order.all), os quatro blocos do legado + eventos do período, a
// cobertura (custo × financeiro) e, no MELI, a conciliação Mercado Pago.
// Ordem das perguntas: o que merece atenção → bate com o marketplace → como
// se compõe → posso confiar.

import { ConciliacaoTab } from "../ConciliacaoTab.jsx";
import { ComposicaoFinanceira } from "../resultado/ComposicaoFinanceira.jsx";
import { CoberturaFechamento } from "../resultado/CoberturaFechamento.jsx";
import { LeituraFechamento } from "../resultado/LeituraFechamento.jsx";
import { MetricasSecundarias } from "../resultado/MetricasSecundarias.jsx";
import { ReconciliacaoShopee } from "../shopee/ReconciliacaoShopee.jsx";

export function DetalhesFechamento({ processamento, marketplace, conciliacao = null }) {
  const summary = processamento?.summary || {};
  return (
    <div className="vf-stack vf-fin-mesa-detalhes">
      <LeituraFechamento processamento={processamento} marketplace={marketplace} />
      <ReconciliacaoShopee summary={summary} marketplace={marketplace} />
      <section className="vf-stack vf-stack--sm" aria-label="Composição financeira" data-secao="composicao">
        <h4 className="vf-fin-mesa__rotulo-grupo">Composição financeira</h4>
        <ComposicaoFinanceira summary={summary} marketplace={marketplace} />
        {/* Eventos do período: a grade de KPIs secundários do legado. */}
        <MetricasSecundarias summary={summary} marketplace={marketplace} />
      </section>
      <section className="vf-stack vf-stack--sm vf-fin-secao--compacta" aria-label="Cobertura" data-secao="cobertura">
        <h4 className="vf-fin-mesa__rotulo-grupo">Cobertura</h4>
        <CoberturaFechamento summary={summary} unmatchedIds={processamento?.unmatchedIds} unmatchedCosts={processamento?.unmatchedCosts} />
      </section>
      {marketplace === "meli" && conciliacao && (
        <section className="vf-stack vf-stack--sm" aria-label="Conciliação Mercado Pago" data-secao="conciliacao">
          <h4 className="vf-fin-mesa__rotulo-grupo">Conciliação Mercado Pago (Central de Vendas)</h4>
          <ConciliacaoTab conciliacao={conciliacao} />
        </section>
      )}
    </div>
  );
}
