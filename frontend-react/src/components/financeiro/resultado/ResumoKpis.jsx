// KPIs principais do processamento — direto do `summary` (kpisPrincipais).
import { kpisPrincipais } from "../../../utils/financeiro/resumoFechamento.js";
import { formatarValor, tomDoValor } from "../shared/ValorFinanceiro.jsx";

export function ResumoKpis({ summary }) {
  const kpis = kpisPrincipais(summary);
  return (
    <div className="vf-kpi-grid vf-fin-kpis" data-testid="kpis-processamento">
      {kpis.map((k) => {
        const negativo = tomDoValor(k.valor) === "negativo" && k.tipo === "moeda";
        return (
          <div
            key={k.chave}
            className={`vf-kpi${k.chave === "finalResult" ? " vf-kpi--featured" : ""}${negativo ? " vf-kpi--danger" : ""}`}
            data-kpi={k.chave}
            title={k.descricao || undefined}
          >
            <span className="vf-kpi__label">{k.rotulo}</span>
            <span className={`vf-kpi__value${k.tipo === "moeda" ? " vf-kpi__value--currency" : ""}`}>{formatarValor(k.valor, k.tipo)}</span>
            {k.chave === "finalResult" && <span className="vf-kpi__foot">Resultado após despesas comerciais</span>}
          </div>
        );
      })}
    </div>
  );
}
