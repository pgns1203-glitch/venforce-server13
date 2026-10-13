// Status de UMA linha — sempre o do normalizador central (produtos.js).
import { STATUS_LINHA_INFO } from "../../../utils/financeiro/produtos.js";

export function ProdutoFinanceiroStatus({ linha }) {
  const info = STATUS_LINHA_INFO[linha.statusPrincipal] || STATUS_LINHA_INFO.sem_mc;
  return (
    <span className="vf-cluster vf-fin-status-linha">
      <span className={`vf-tag is-${info.tom}`}>{info.label}</span>
      {/* Aguardando financeiro com custo ausente: o eixo de custo também é
          dito — mas como detalhe, nunca no lugar do status principal. */}
      {linha.statusPrincipal === "aguardando_financeiro" && linha.statusCusto !== "ok" && (
        <span className="vf-field__hint">{linha.statusCusto === "ambiguo" ? "custo ambíguo" : "sem custo"}</span>
      )}
      {linha.canceladoOuDevolvido && <span className="vf-field__hint">{linha.statusPedido}</span>}
    </span>
  );
}
