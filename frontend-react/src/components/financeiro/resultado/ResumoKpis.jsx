// Resultado executivo do processamento — direto do `summary` (kpisPrincipais).
//
// Mesma leitura do Financeiro legado (Portal/financeiro.html, .vf-fin-kpi-grid):
// uma GRADE de cartões fortes — Resultado Final em destaque e, do mesmo
// tamanho entre si, Receita Bruta, Receita Líquida, LC Total, MC Calculada e
// MC Final. A margem não fica escondida numa linha de apoio. TACoS e TACoX
// (índices sobre o faturamento) ficam numa faixa menor logo abaixo.
import { kpisPrincipais } from "../../../utils/financeiro/resumoFechamento.js";
import { formatarValor, tomDoValor } from "../shared/ValorFinanceiro.jsx";
import { VFNumber } from "../../ui/VFNumber/index.js";

const PRIMARIOS = ["finalResult", "grossRevenueTotal", "paidRevenueTotal", "contributionProfitTotal", "mcCalculada", "finalMarginCalculated"];
// Só os números de RESULTADO ganham cor pelo sinal; receita é neutra.
const COM_TOM = new Set(["finalResult", "contributionProfitTotal", "mcCalculada", "finalMarginCalculated"]);
const APOIO = {
  finalResult: "após ADS, Venforce, afiliados e demais custos",
  contributionProfitTotal: "antes das despesas comerciais",
  mcCalculada: "LC sobre a receita calculável",
  finalMarginCalculated: "Resultado sobre a receita calculável",
};

export function ResumoKpis({ summary }) {
  const kpis = kpisPrincipais(summary);
  const primarios = PRIMARIOS.map((c) => kpis.find((k) => k.chave === c)).filter(Boolean);
  const secundarios = kpis.filter((k) => !PRIMARIOS.includes(k.chave));

  return (
    <div className="vf-fin-resumo" data-testid="kpis-processamento">
      <div className="vf-fin-resumo__principal">
        {primarios.map((k) => {
          const tom = COM_TOM.has(k.chave) ? tomDoValor(k.valor) : "neutro";
          return (
            <div
              key={k.chave}
              className={`vf-fin-kpi${k.chave === "finalResult" ? " is-destaque" : ""} is-${tom}`}
              data-kpi={k.chave}
              title={k.descricao || undefined}
            >
              <span className="vf-fin-kpi__rotulo">{k.rotulo}</span>
              <span className="vf-fin-kpi__valor">
                <VFNumber
                  value={k.valor}
                  format={(v) => formatarValor(v, k.tipo)}
                  goodDirection={COM_TOM.has(k.chave) ? "up" : undefined}
                />
              </span>
              {APOIO[k.chave] && <span className="vf-fin-kpi__apoio">{APOIO[k.chave]}</span>}
            </div>
          );
        })}
      </div>
      {secundarios.length > 0 && (
        <dl className="vf-fin-resumo__apoio">
          {secundarios.map((k) => (
            <div key={k.chave} className="vf-fin-kpi-sec" data-kpi={k.chave} title={k.descricao || undefined}>
              <dt className="vf-fin-kpi__rotulo">{k.rotulo}</dt>
              <dd className="vf-fin-kpi__valor vf-fin-kpi__valor--sec">
                <VFNumber value={k.valor} format={(v) => formatarValor(v, k.tipo)} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
