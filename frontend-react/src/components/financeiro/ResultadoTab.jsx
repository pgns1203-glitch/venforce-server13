// frontend-react/src/components/financeiro/ResultadoTab.jsx
// Composição do resultado do fechamento SALVO (payload_json.cards, estrutura
// livre — server/services/financeiroVisaoService.js). `disponivel` é
// obrigatório POR ITEM (Master Spec M6): um card sem valor nunca vira R$0.
// Desde a paridade operacional não é mais uma aba: é o bloco "Fechamento
// salvo" da aba Fechamento.

import { formatarMoeda } from "../../utils/currency.js";
import { AUSENTE } from "../../utils/numbers.js";
import { formatarPercentual, pontosParaFracao } from "../../utils/percentage.js";

// O payload salvo tem dois formatos de card: o do V3 (valor numérico; os
// percentuais já em pontos e com "%" no título) e o do legado (valor já
// formatado em texto). Cada um é exibido como foi gravado — nunca um
// percentual como R$ nem uma string como "R$ NaN".
function valorDoItem(item) {
  if (!item.disponivel) return AUSENTE;
  if (typeof item.valor === "string") return item.valor;
  if (String(item.rotulo || "").includes("%")) return formatarPercentual(pontosParaFracao(item.valor));
  return formatarMoeda(item.valor);
}

export function ResultadoTab({ resultado, periodoLabel }) {
  if (!resultado?.disponivel) {
    return (
      <div className="vf-empty">
        <p className="vf-empty__title">Nenhum fechamento salvo</p>
        <p className="vf-empty__description">
          {resultado?.motivo || `Nenhum fechamento salvo para ${periodoLabel}.`} Processe um fechamento acima para visualizar o resultado.
        </p>
      </div>
    );
  }

  const composicao = resultado.dados?.composicao || [];
  if (!composicao.length) {
    return (
      <div className="vf-empty">
        <p className="vf-empty__description">
          O fechamento salvo de {periodoLabel} não registrou a composição do resultado. Reprocesse para ver o detalhe.
        </p>
      </div>
    );
  }

  const maxAbs = Math.max(
    1,
    ...composicao.filter((c) => typeof c.valor === "number" && !String(c.rotulo || "").includes("%")).map((c) => Math.abs(c.valor))
  );

  return (
    <div className="vf-fin-composicao">
      {composicao.map((item, i) => {
        const numerico = typeof item.valor === "number" && !String(item.rotulo || "").includes("%");
        const negativo = numerico && item.valor < 0;
        const pct = item.disponivel && numerico ? Math.min(100, (Math.abs(item.valor) / maxAbs) * 100) : 0;
        return (
          <div className="vf-fin-composicao__linha" key={item.chave || i}>
            <span className="vf-fin-composicao__rotulo">{item.rotulo || item.chave || "—"}</span>
            <span className="vf-fin-composicao__barra">
              <span
                className={`vf-fin-composicao__preenchimento${negativo ? " is-negativo" : ""}`}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="vf-fin-composicao__valor">{valorDoItem(item)}</span>
          </div>
        );
      })}
    </div>
  );
}
