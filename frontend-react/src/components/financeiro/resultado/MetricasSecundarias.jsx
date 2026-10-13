// Métricas específicas do marketplace (Shopee: cancelados/não pagos/
// devoluções; MELI: reembolsos, perdido, fora do LC). Nunca cards Shopee no MELI.
import { metricasSecundarias } from "../../../utils/financeiro/resumoFechamento.js";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";

export function MetricasSecundarias({ summary, marketplace }) {
  const itens = metricasSecundarias(summary, marketplace);
  if (!itens.length) return null;
  return (
    <div className="vf-metric-row vf-fin-metricas" aria-label="Métricas do marketplace">
      {itens.map((m) => (
        <div className="vf-metric" key={m.chave} data-metrica={m.chave}>
          <span className="vf-metric__label">{m.rotulo}</span>
          <span className="vf-metric__value">{formatarValor(m.valor, m.tipo)}</span>
        </div>
      ))}
    </div>
  );
}
