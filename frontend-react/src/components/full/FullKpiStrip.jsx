// Faixa de KPIs da Central do Full — a mesma faixa segmentada de Anúncios ML
// (.am-resumo): cards colados por filete de 1px, filete lateral nos de risco,
// e os de contagem são FILTROS da lista (clicar liga/desliga; vários somam).
// Previsão e cobertura média são leitura, não recorte — por isso não são botões.
import { formatarNumero } from "../../utils/numbers.js";
import { formatarMoeda } from "../../utils/currency.js";

function moeda(valor) {
  return formatarMoeda(valor, { casas: 0 });
}

function KpiFiltro({ chave, ativo, onAlternar, rotulo, valor, rodape, tomRodape, acento, disabled, title }) {
  return (
    <button
      type="button"
      className={`vf-metric full-kpi${acento ? ` is-${acento}` : ""}${ativo ? " is-active" : ""}`}
      aria-pressed={ativo ? "true" : "false"}
      onClick={() => onAlternar(chave)}
      disabled={disabled}
      title={title}
    >
      <span className="vf-metric__label">{rotulo}</span>
      <strong className="vf-metric__value">{valor}</strong>
      <span className={`vf-metric__foot${tomRodape ? ` is-${tomRodape}` : ""}`}>{rodape}</span>
    </button>
  );
}

function KpiLeitura({ rotulo, valor, rodape, acento }) {
  return (
    <div className={`vf-metric full-kpi full-kpi--leitura${acento ? ` is-${acento}` : ""}`}>
      <span className="vf-metric__label">{rotulo}</span>
      <strong className="vf-metric__value">{valor}</strong>
      <span className="vf-metric__foot is-neutral">{rodape}</span>
    </div>
  );
}

export default function FullKpiStrip({ resumo, kpisAtivos, onAlternar, custosDisponiveis }) {
  if (!resumo) return null;
  const ativo = (chave) => kpisAtivos.includes(chave);
  const props = { onAlternar };

  return (
    <div className="full-kpis" role="group" aria-label="Resumo do Full — clique para filtrar a lista">
      <KpiFiltro {...props} chave="comEstoque" ativo={ativo("comEstoque")} rotulo="Com estoque"
        valor={formatarNumero(resumo.disponivel)} rodape={`de ${formatarNumero(resumo.total)} no Full`} tomRodape="neutral" />
      <KpiFiltro {...props} chave="ruptura" ativo={ativo("ruptura")} rotulo="Sem estoque" acento="danger"
        valor={formatarNumero(resumo.ruptura)} rodape="vendas paradas" tomRodape="danger" />
      <KpiFiltro {...props} chave="critico" ativo={ativo("critico")} rotulo="Crítico" acento="danger"
        valor={formatarNumero(resumo.critico)} rodape="menos de 7 dias" tomRodape="danger" />
      <KpiFiltro {...props} chave="repor" ativo={ativo("repor")} rotulo="Repor" acento="warning"
        valor={formatarNumero(resumo.repor)} rodape="7 a 15 dias" tomRodape="warning" />
      <KpiFiltro {...props} chave="parado" ativo={ativo("parado")} rotulo="Excesso / sem giro" acento="warning"
        valor={formatarNumero(resumo.parado)}
        rodape={resumo.custoParado !== null ? `${moeda(resumo.custoParado)} parados` : "mais de 60 dias ou sem venda"}
        tomRodape="warning" />
      <KpiFiltro {...props} chave="semCusto" ativo={ativo("semCusto")} rotulo="Custo no Full"
        valor={custosDisponiveis ? moeda(resumo.custoEstoque) : "—"}
        rodape={!custosDisponiveis ? "sem Base de custo" : resumo.semCusto > 0 ? `${formatarNumero(resumo.semCusto)} sem custo` : "todos com custo"}
        tomRodape={!custosDisponiveis ? "neutral" : resumo.semCusto > 0 ? "warning" : "success"}
        disabled={!custosDisponiveis || resumo.semCusto === 0}
        title={custosDisponiveis ? "Clique para ver os produtos sem custo na Base" : "Vincule uma Base de custo à conta para ver o custo"} />
      <KpiLeitura rotulo="Previsão 30d" valor={moeda(resumo.previsao30d)} rodape="ritmo dos últimos 14d" />
      <KpiLeitura rotulo="Cobertura média" acento="info"
        valor={resumo.coberturaMedia === null ? "—" : `${formatarNumero(resumo.coberturaMedia, 1)} dias`} rodape="meta 30 dias" />
    </div>
  );
}
