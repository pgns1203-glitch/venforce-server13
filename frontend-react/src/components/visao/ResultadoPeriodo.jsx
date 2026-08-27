// frontend-react/src/components/visao/ResultadoPeriodo.jsx
// Bloco 2 — resultado do período. Fonte: Central de Vendas Read API
// (getCentralVendasReadBootstrap → summary), escopoConta=true (é desta
// operação específica).

import { formatarMoeda } from "../../utils/currency.js";
import { formatarPercentual } from "../../utils/percentage.js";
import { formatarNumero, AUSENTE } from "../../utils/numbers.js";
import { CONFIANCA_FECHAMENTO } from "../../utils/visaoLabels.js";

export function ResultadoPeriodo({ dados }) {
  const confianca = CONFIANCA_FECHAMENTO[dados.confiancaFechamento] || null;

  return (
    <div className="vf-stack">
      <div className="vf-kpi-grid">
        <div className="vf-kpi vf-kpi--featured">
          <span className="vf-kpi__label">Faturamento</span>
          <span className="vf-kpi__value vf-kpi__value--currency">{formatarMoeda(dados.faturamento)}</span>
        </div>
        <div className={dados.lucroContribuicao < 0 ? "vf-kpi vf-kpi--danger" : "vf-kpi"}>
          <span className="vf-kpi__label">Resultado (LC)</span>
          <span className="vf-kpi__value vf-kpi__value--currency">{formatarMoeda(dados.lucroContribuicao)}</span>
        </div>
        <div className="vf-kpi">
          <span className="vf-kpi__label">Margem de contribuição</span>
          <span className="vf-kpi__value">{formatarPercentual((dados.margemContribuicaoPercentual ?? null) / 100)}</span>
        </div>
        <div className="vf-kpi">
          <span className="vf-kpi__label">Ticket médio</span>
          <span className="vf-kpi__value vf-kpi__value--currency">{formatarMoeda(dados.ticket)}</span>
        </div>
        <div className="vf-kpi">
          <span className="vf-kpi__label">Pedidos válidos</span>
          <span className="vf-kpi__value">
            {formatarNumero(dados.pedidosValidos)}
            <span className="vf-field__hint"> / {formatarNumero(dados.pedidosTotal)}</span>
          </span>
        </div>
        <div className={dados.cancelados > 0 ? "vf-kpi vf-kpi--warning" : "vf-kpi"}>
          <span className="vf-kpi__label">Cancelados</span>
          <span className="vf-kpi__value">{formatarNumero(dados.cancelados)}</span>
        </div>
      </div>

      {confianca && (
        <div className="vf-cluster" style={{ justifyContent: "space-between" }}>
          <span className={`vf-tag is-${confianca.tom}`}>Fechamento {confianca.label.toLowerCase()}</span>
          {(dados.semCusto || dados.semFrete) && (
            <span className="vf-field__hint">
              {dados.semCusto ? "Itens sem custo" : ""}
              {dados.semCusto && dados.semFrete ? " · " : ""}
              {dados.semFrete ? "Itens sem frete" : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
