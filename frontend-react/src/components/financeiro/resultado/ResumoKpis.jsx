// Resultado executivo do processamento — direto do `summary` (kpisPrincipais).
//
// Hierarquia: o Resultado Final e os três totais que o explicam (Receita
// Bruta, Receita Líquida, LC) são a FAIXA PRINCIPAL; as margens e os índices
// (MC, MC Final, TACoS, TACoX) são leitura de apoio, em linha. Quatro números
// grandes se escaneiam; oito do mesmo tamanho competem.
import { kpisPrincipais } from "../../../utils/financeiro/resumoFechamento.js";
import { formatarValor, tomDoValor } from "../shared/ValorFinanceiro.jsx";

const PRIMARIOS = ["finalResult", "grossRevenueTotal", "paidRevenueTotal", "contributionProfitTotal"];

export function ResumoKpis({ summary }) {
  const kpis = kpisPrincipais(summary);
  const primarios = PRIMARIOS.map((c) => kpis.find((k) => k.chave === c)).filter(Boolean);
  const secundarios = kpis.filter((k) => !PRIMARIOS.includes(k.chave));

  return (
    <div className="vf-fin-resumo" data-testid="kpis-processamento">
      <div className="vf-fin-resumo__principal">
        {primarios.map((k) => {
          const tom = k.tipo === "moeda" ? tomDoValor(k.valor) : "neutro";
          return (
            <div
              key={k.chave}
              className={`vf-fin-kpi${k.chave === "finalResult" ? " is-destaque" : ""} is-${tom}`}
              data-kpi={k.chave}
              title={k.descricao || undefined}
            >
              <span className="vf-fin-kpi__rotulo">{k.rotulo}</span>
              <span className="vf-fin-kpi__valor">{formatarValor(k.valor, k.tipo)}</span>
              {k.chave === "finalResult" && <span className="vf-fin-kpi__apoio">Resultado após despesas comerciais</span>}
            </div>
          );
        })}
      </div>
      {secundarios.length > 0 && (
        <dl className="vf-fin-resumo__apoio">
          {secundarios.map((k) => (
            <div key={k.chave} className="vf-fin-kpi-sec" data-kpi={k.chave} title={k.descricao || undefined}>
              <dt className="vf-fin-kpi__rotulo">{k.rotulo}</dt>
              <dd className="vf-fin-kpi__valor vf-fin-kpi__valor--sec">{formatarValor(k.valor, k.tipo)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
