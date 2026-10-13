// frontend-react/src/components/financeiro/shopee/ReconciliacaoShopee.jsx
//
// Reconciliação Shopee DENTRO do resultado do processamento (antes era uma
// seção solta do legado). Lê só o summary (orderAll*) — a reconciliação é do
// motor; nada é recalculado. Sem Order.all no processamento, o motor devolve
// contagens 0: mostrar "0 pedidos" seria afirmar algo que o arquivo nem trouxe,
// então a tela explica o que falta.

import { reconciliacaoShopee } from "../../../utils/financeiro/resumoFechamento.js";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";

export function ReconciliacaoShopee({ summary, marketplace }) {
  if (marketplace !== "shopee") return null;
  const r = reconciliacaoShopee(summary);

  if (!r.disponivel) {
    return (
      <section className="vf-fin-bloco" aria-label="Reconciliação Shopee">
        <h4 className="vf-fin-bloco__titulo">Reconciliação Shopee</h4>
        <p className="vf-field__hint">
          Sem Order.all neste processamento — a visão reconciliada por status de pedido (concluídos, enviados,
          cancelados, não pagos, devoluções) não está disponível. Envie o Order.all e reprocesse para vê-la.
        </p>
      </section>
    );
  }

  const comPedidos = r.estados.filter((e) => e.pedidos !== null && e.pedidos > 0);
  return (
    <section className="vf-fin-bloco vf-stack vf-stack--sm" aria-label="Reconciliação Shopee">
      <h4 className="vf-fin-bloco__titulo">Reconciliação Shopee</h4>
      <div className="vf-fin-recon__fluxo">
        <div>
          <span className="vf-field__hint">Base do fechamento</span>
          <strong>{formatarValor(r.performance)}</strong>
        </div>
        <span aria-hidden="true">→</span>
        <div>
          <span className="vf-field__hint">Visão reconciliada (Order.all)</span>
          <strong>{formatarValor(r.reconciliada)}</strong>
          <span className="vf-field__hint">{formatarValor(r.pedidos, "numero")} pedidos</span>
        </div>
      </div>
      <div className="vf-fin-recon__estados">
        {comPedidos.map((e) => (
          <div key={e.rotulo} className={`vf-fin-recon__estado is-${e.tom}`} data-estado={e.rotulo}>
            <span className="vf-fin-recon__rotulo">{e.rotulo}</span>
            <span className="vf-fin-recon__valor">{formatarValor(e.receita)}</span>
            <span className="vf-field__hint">
              {formatarValor(e.pedidos, "numero")} {e.pedidos === 1 ? "pedido" : "pedidos"} · {e.apoio}
            </span>
          </div>
        ))}
      </div>
      {r.maioresCancelamentos.length > 0 && (
        <details className="vf-fin-disclosure">
          <summary>Maiores impactos de cancelamento ({r.maioresCancelamentos.length})</summary>
          <ul className="vf-fin-leitura">
            {r.maioresCancelamentos.map((i, idx) => (
              <li key={idx} className="vf-fin-leitura__item is-neutral">
                {i.productName} — {formatarValor(i.count, "numero")} {i.count === 1 ? "pedido" : "pedidos"} · {formatarValor(i.revenue)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
