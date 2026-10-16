// frontend-react/src/components/visao/ResultadoPeriodo.jsx
// Bloco principal — resultado do período. Fonte: Central de Vendas Read API
// (getCentralVendasReadBootstrap → filteredSummary), escopoConta=true (é desta
// operação específica).
//
// Redesign V3 (Direção A): números como "figuras" sem caixa (classes
// .vf-visao-figure*, nunca os cards KPI da Fundação). Linha principal
// (Faturamento / Lucro de contribuição / Margem de contribuição) + régua
// secundária (Ticket / Pedidos válidos / Cancelados / Confiança do
// fechamento). Sem barra financeira, sem custos/despesas, sem gráfico.
//
// Os números são VFNumber: mudando com a tela aberta, deslizam do valor antigo
// para o novo e acendem — continua sem nenhuma classe .vf-kpi.

import { pontosParaFracao } from "../../utils/percentage.js";
import { formatarNumero, AUSENTE } from "../../utils/numbers.js";
import { CONFIANCA_FECHAMENTO } from "../../utils/visaoLabels.js";
import { VFNumber } from "../ui/VFNumber/index.js";

// Valor monetário com o símbolo "R$" em corpo menor (igual ao canvas), sem
// perder a regra de ausência ("—", nunca "R$ 0,00").
function Cifra({ valor }) {
  return <VFNumber value={valor} format="brl" goodDirection="up" currencyClassName="vf-visao-figure__cur" />;
}

export function ResultadoPeriodo({ dados }) {
  const confianca = CONFIANCA_FECHAMENTO[dados.confiancaFechamento] || null;
  // `semCusto`/`semFrete` podem chegar como número (contagem) — `(0 || 0)` é
  // `0`, e `0 && <p>` faz o React imprimir um "0" solto. Coage para booleano.
  const temSemCusto = Boolean(dados.semCusto);
  const temSemFrete = Boolean(dados.semFrete);
  const lcClasse =
    dados.lucroContribuicao < 0
      ? " vf-visao-num--danger"
      : dados.lucroContribuicao > 0
        ? " vf-visao-num--success"
        : "";

  return (
    <div className="vf-stack">
      <div className="vf-visao-figures">
        <div className="vf-visao-figure">
          <span className="vf-visao-figure__label">Faturamento</span>
          <span className="vf-visao-figure__value vf-visao-figure__value--lg">
            <Cifra valor={dados.faturamento} />
          </span>
        </div>
        <div className="vf-visao-figure">
          <span className="vf-visao-figure__label">Lucro de contribuição</span>
          <span className={`vf-visao-figure__value vf-visao-figure__value--lg${lcClasse}`}>
            <Cifra valor={dados.lucroContribuicao} />
          </span>
        </div>
        <div className="vf-visao-figure">
          <span className="vf-visao-figure__label">Margem de contribuição</span>
          <span className="vf-visao-figure__value vf-visao-figure__value--lg">
            <VFNumber value={pontosParaFracao(dados.margemContribuicaoPercentual)} format="pct" goodDirection="up" />
          </span>
        </div>
      </div>

      <hr className="vf-divider" />

      <div className="vf-visao-metricrow">
        <div className="vf-visao-figure">
          <span className="vf-visao-figure__label">Ticket médio</span>
          <span className="vf-visao-figure__value">
            <Cifra valor={dados.ticket} />
          </span>
        </div>
        <div className="vf-visao-figure">
          <span className="vf-visao-figure__label">Pedidos válidos</span>
          <span className="vf-visao-figure__value">
            <VFNumber value={dados.pedidosValidos} goodDirection="up" />
            <span className="vf-visao-figure__sub"> / {formatarNumero(dados.pedidosTotal)}</span>
          </span>
        </div>
        <div className="vf-visao-figure">
          <span className="vf-visao-figure__label">Cancelados</span>
          <span className={`vf-visao-figure__value${dados.cancelados > 0 ? " vf-visao-num--warning" : ""}`}>
            <VFNumber value={dados.cancelados} goodDirection="down" />
          </span>
        </div>
        <div className="vf-visao-figure">
          <span className="vf-visao-figure__label">Confiança do fechamento</span>
          {confianca ? (
            <span className={`vf-tag is-${confianca.tom}`} style={{ alignSelf: "flex-start" }}>
              {confianca.label}
            </span>
          ) : (
            <span className="vf-visao-figure__value vf-visao-figure__value--sm">{AUSENTE}</span>
          )}
        </div>
      </div>

      {(temSemCusto || temSemFrete) && (
        <p className="vf-field__hint">
          {temSemCusto ? "Itens sem custo cadastrado neste período." : ""}
          {temSemCusto && temSemFrete ? " " : ""}
          {temSemFrete ? "Itens sem frete neste período." : ""}
        </p>
      )}
    </div>
  );
}
