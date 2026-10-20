// frontend-react/src/components/financeiro/mesa/ReceitaAoResultado.jsx
//
// "Da receita ao resultado" — a cascata do modelo B. Cada degrau é um total
// que o motor devolveu (Receita Bruta, Receita Líquida, LC, despesas do
// período, Resultado Final). As despesas aparecem com sinal de menos e a
// barra delas sai do degrau anterior; a posição é só desenho (utils/
// financeiro/mesa.js). O detalhamento completo (4 blocos do legado, eventos,
// cobertura, leitura) fica em "Detalhes".

import { degrausDoResultado } from "../../../utils/financeiro/mesa.js";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";
import { VFButton } from "../../ui/VFButton/index.js";

export function ReceitaAoResultado({ summary, onBaixarPlanilha = null, onDetalhes = null }) {
  const degraus = degrausDoResultado(summary);

  return (
    <section className="vf-card vf-fin-mesa-cascata" aria-labelledby="vf-fin-cascata-titulo">
      <header className="vf-fin-mesa-cascata__cabecalho">
        <div>
          <h3 className="vf-fin-mesa__titulo" id="vf-fin-cascata-titulo">Da receita ao resultado</h3>
          <p className="vf-fin-mesa__descricao">Cada barra mostra o total do degrau; as despesas saem do degrau anterior.</p>
        </div>
        <div className="vf-cluster">
          {onDetalhes && (
            <VFButton size="sm" variant="ghost" onClick={onDetalhes}>
              Detalhes
            </VFButton>
          )}
          {onBaixarPlanilha && (
            <VFButton size="sm" onClick={onBaixarPlanilha}>
              Baixar planilha
            </VFButton>
          )}
        </div>
      </header>
      <div className="vf-fin-mesa-cascata__degraus" role="list">
        {degraus.map((d) => {
          const negativo = d.valor !== null && d.valor < 0;
          const classe = d.tipo === "saida" ? "is-saida" : d.final ? (negativo ? "is-final is-negativo" : "is-final") : negativo ? "is-negativo" : "is-total";
          return (
            <div key={d.chave} className={`vf-fin-mesa-cascata__degrau${d.tipo === "total" && d.chave !== "grossRevenueTotal" && d.chave !== "paidRevenueTotal" ? " is-soma" : ""}`} data-degrau={d.chave} role="listitem">
              <span className="vf-fin-mesa-cascata__rotulo">{d.rotulo}</span>
              <span className="vf-fin-mesa-cascata__trilho" aria-hidden="true">
                {d.barra && (
                  <span
                    className={`vf-fin-mesa-cascata__barra ${classe}`}
                    style={{ left: `${d.barra.inicio}%`, width: `${d.barra.largura}%` }}
                  />
                )}
              </span>
              <span className={`vf-fin-mesa-cascata__valor${d.tipo === "saida" ? " is-negativo" : d.final ? (negativo ? " is-negativo" : " is-positivo") : ""}`}>
                {d.tipo === "saida" ? formatarValor(-d.valor, "moeda") : formatarValor(d.valor, "moeda")}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
