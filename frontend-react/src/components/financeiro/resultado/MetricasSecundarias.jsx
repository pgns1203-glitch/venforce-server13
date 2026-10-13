// Eventos do período específicos do marketplace (Shopee: cancelados/não
// pagos/devoluções; MELI: reembolsos, perdido, fora do LC). Nunca cards Shopee
// no MELI. Faixa compacta de apoio à cobertura — não cards soltos.
import { metricasSecundarias } from "../../../utils/financeiro/resumoFechamento.js";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";

export function MetricasSecundarias({ summary, marketplace }) {
  const itens = metricasSecundarias(summary, marketplace);
  if (!itens.length) return null;
  return (
    <dl className="vf-fin-eventos" aria-label="Eventos do período">
      {itens.map((m) => (
        <div className="vf-fin-eventos__item" key={m.chave} data-metrica={m.chave}>
          <dt>{m.rotulo}</dt>
          <dd>{formatarValor(m.valor, m.tipo)}</dd>
        </div>
      ))}
    </dl>
  );
}
