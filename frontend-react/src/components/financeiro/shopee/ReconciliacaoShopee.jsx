// frontend-react/src/components/financeiro/shopee/ReconciliacaoShopee.jsx
//
// Reconciliação Shopee DENTRO do resultado do processamento, antes dos
// produtos. Lê só o summary (orderAll*) — a reconciliação é do motor; nada é
// recalculado. Sem Order.all no processamento, o motor devolve contagens 0:
// mostrar "0 pedidos" seria afirmar algo que o arquivo nem trouxe, então a
// tela explica o que falta.
//
// Responde em poucos segundos: "o que já consolidou, o que ainda está em
// trânsito e o que ficou de fora?". Os estados são os do motor, só agrupados
// por leitura; estado com 0 pedidos não ocupa espaço.

import { reconciliacaoShopee } from "../../../utils/financeiro/resumoFechamento.js";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";
import { SecaoFinanceira } from "../shared/SecaoFinanceira.jsx";

const GRUPOS = [
  { id: "consolidado", titulo: "Consolidado ou perto de consolidar", estados: ["Concluídos", "Entregues"] },
  { id: "andamento", titulo: "Em trânsito / atenção", estados: ["Enviados", "Em atenção"] },
  { id: "fora", titulo: "Fora do resultado", estados: ["Cancelados confirmados", "Não pagos", "Devoluções / Reembolsos"] },
];

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
  const grupos = GRUPOS.map((g) => ({ ...g, itens: comPedidos.filter((e) => g.estados.includes(e.rotulo)) })).filter((g) => g.itens.length);

  return (
    <SecaoFinanceira
      id="reconciliacao"
      titulo="Reconciliação Shopee"
      descricao="Da base do fechamento (Performance) para a visão por status de pedido (Order.all)."
    >
      <div className="vf-fin-recon__fluxo">
        <div>
          <span className="vf-field__hint">Base do fechamento</span>
          <strong>{formatarValor(r.performance)}</strong>
        </div>
        <span aria-hidden="true" className="vf-fin-recon__seta">→</span>
        <div>
          <span className="vf-field__hint">Visão reconciliada (Order.all)</span>
          <strong>{formatarValor(r.reconciliada)}</strong>
          <span className="vf-field__hint">{formatarValor(r.pedidos, "numero")} pedidos</span>
        </div>
      </div>
      <div className="vf-fin-recon__grupos">
        {grupos.map((g) => (
          <div key={g.id} className="vf-fin-recon__grupo" data-grupo={g.id}>
            <h4 className="vf-fin-bloco__titulo">{g.titulo}</h4>
            <ul className="vf-fin-recon__lista">
              {g.itens.map((e) => (
                <li key={e.rotulo} className={`vf-fin-recon__estado is-${e.tom}`} data-estado={e.rotulo}>
                  <span className="vf-fin-recon__rotulo">{e.rotulo}</span>
                  <span className="vf-fin-recon__valor">{formatarValor(e.receita)}</span>
                  <span className="vf-field__hint">
                    {formatarValor(e.pedidos, "numero")} {e.pedidos === 1 ? "pedido" : "pedidos"} · {e.apoio}
                  </span>
                </li>
              ))}
            </ul>
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
    </SecaoFinanceira>
  );
}
