// frontend-react/src/components/financeiro/ResultadoTab.jsx
// Composição do resultado do fechamento salvo (payload_json.cards, estrutura
// livre — server/services/financeiroVisaoService.js). `disponivel` é
// obrigatório POR ITEM (Master Spec M6): um card sem valor nunca vira R$0.

import { formatarMoeda } from "../../utils/currency.js";
import { AUSENTE } from "../../utils/numbers.js";

export function ResultadoTab({ resultado, clienteSlug, periodoLabel, onGerar }) {
  if (!resultado.disponivel) {
    return (
      <div className="vf-empty">
        <p className="vf-empty__title">Sem fechamento processado</p>
        <p className="vf-empty__description">{resultado.motivo || `Nenhum fechamento gerado para ${periodoLabel} ainda.`}</p>
        <div className="vf-empty__actions">
          {onGerar ? (
            <button type="button" className="vf-btn vf-btn--primary" onClick={onGerar}>
              Gerar fechamento
            </button>
          ) : (
            <a className="vf-btn vf-btn--ghost" href={`financeiro.html?cliente=${encodeURIComponent(clienteSlug)}`}>
              Financeiro (legado) →
            </a>
          )}
        </div>
      </div>
    );
  }

  const composicao = resultado.dados?.composicao || [];
  if (!composicao.length) {
    return (
      <div className="vf-empty">
        <p className="vf-empty__description">O fechamento de {periodoLabel} não tem linhas de composição registradas.</p>
      </div>
    );
  }

  const maxAbs = Math.max(1, ...composicao.map((c) => Math.abs(Number(c.valor) || 0)));

  return (
    <div className="vf-fin-composicao">
      {composicao.map((item, i) => {
        const negativo = Number(item.valor) < 0;
        const pct = item.disponivel ? Math.min(100, (Math.abs(Number(item.valor) || 0) / maxAbs) * 100) : 0;
        return (
          <div className="vf-fin-composicao__linha" key={item.chave || i}>
            <span className="vf-fin-composicao__rotulo">{item.rotulo || item.chave || "—"}</span>
            <span className="vf-fin-composicao__barra">
              <span
                className={`vf-fin-composicao__preenchimento${negativo ? " is-negativo" : ""}`}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="vf-fin-composicao__valor">{item.disponivel ? formatarMoeda(item.valor) : AUSENTE}</span>
          </div>
        );
      })}
    </div>
  );
}
