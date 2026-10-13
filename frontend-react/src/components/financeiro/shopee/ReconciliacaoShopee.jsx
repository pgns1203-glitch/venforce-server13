// frontend-react/src/components/financeiro/shopee/ReconciliacaoShopee.jsx
//
// Reconciliação Shopee logo depois do resultado, com a leitura do legado
// (Portal/financeiro.js, renderShopeeReconciliacao): o comparativo
// Performance (pedidos pagos) → Reconciliação (visão completa) em destaque e,
// abaixo, um cartão por status de pedido com valor e quantidade, a borda na
// cor do que aquele status significa. Lê só o summary (orderAll*) — a
// reconciliação é do motor; nada é recalculado. Status com 0 pedidos não vira
// cartão. Sem Order.all no processamento, o motor devolve contagens 0:
// mostrar "0 pedidos" seria afirmar algo que o arquivo nem trouxe, então a
// tela explica o que falta.

import { reconciliacaoShopee } from "../../../utils/financeiro/resumoFechamento.js";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";
import { SecaoFinanceira } from "../shared/SecaoFinanceira.jsx";

const pedidos = (n) => `${formatarValor(n, "numero")} ${n === 1 ? "pedido" : "pedidos"}`;

export function ReconciliacaoShopee({ summary, marketplace }) {
  if (marketplace !== "shopee") return null;
  const r = reconciliacaoShopee(summary);

  if (!r.disponivel) {
    return (
      <SecaoFinanceira id="reconciliacao" titulo="Reconciliação Shopee">
        <p className="vf-fin-nota">
          Sem Order.all neste processamento — a visão reconciliada por status de pedido (concluídos, enviados,
          cancelados, não pagos, devoluções) não está disponível. Envie o Order.all e reprocesse para vê-la.
        </p>
      </SecaoFinanceira>
    );
  }

  const comPedidos = r.estados.filter((e) => e.pedidos !== null && e.pedidos > 0);
  const diferenca = r.reconciliada !== null && r.performance !== null && r.reconciliada > r.performance;

  return (
    <SecaoFinanceira id="reconciliacao" titulo="Reconciliação Shopee" className="vf-fin-secao--destaque">
      <div className="vf-fin-recon">
        <div className="vf-fin-recon__fluxo">
          <div className="vf-fin-recon__lado">
            <span className="vf-fin-recon__rotulo-fluxo">Performance (pedidos pagos)</span>
            <strong className="vf-fin-recon__total is-positivo">{formatarValor(r.performance)}</strong>
            <span className="vf-field__hint">base do fechamento</span>
          </div>
          <span aria-hidden="true" className="vf-fin-recon__seta">→</span>
          <div className="vf-fin-recon__lado">
            <span className="vf-fin-recon__rotulo-fluxo">Reconciliação (visão completa)</span>
            <strong className="vf-fin-recon__total">{formatarValor(r.reconciliada)}</strong>
            <span className="vf-field__hint">{pedidos(r.pedidos)} no Order.all</span>
          </div>
        </div>

        <ul className="vf-fin-recon__grade" aria-label="Pedidos por status">
          {comPedidos.map((e) => (
            <li key={e.rotulo} className={`vf-fin-recon__estado is-${e.tom}`} data-estado={e.rotulo}>
              <span className="vf-fin-recon__rotulo">{e.rotulo}</span>
              <span className="vf-fin-recon__apoio">{e.apoio}</span>
              <span className="vf-fin-recon__valor">{formatarValor(e.receita)}</span>
              <span className="vf-fin-recon__qtd">{pedidos(e.pedidos)}</span>
            </li>
          ))}
        </ul>

        {diferenca && (
          <p className="vf-fin-recon__nota">
            A Performance considera só os pedidos pagos usados no cálculo financeiro; a Reconciliação inclui também
            cancelados, não pagos, devoluções e status operacionais — por isso é maior.
          </p>
        )}

        {r.maioresCancelamentos.length > 0 && (
          <details className="vf-fin-disclosure vf-fin-disclosure--leve">
            <summary>Maiores impactos de cancelamento ({r.maioresCancelamentos.length})</summary>
            <ul className="vf-fin-leitura">
              {r.maioresCancelamentos.map((i, idx) => (
                <li key={idx} className="vf-fin-leitura__item is-neutral">
                  {i.productName} — {pedidos(i.count)} · {formatarValor(i.revenue)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </SecaoFinanceira>
  );
}
