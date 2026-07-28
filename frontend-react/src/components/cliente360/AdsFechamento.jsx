// Bloco "Ads no fechamento" — DESCRITIVO por decisão de produto.
//
// Este é o único lugar da tela, além dos KPIs do fechamento, onde Ads aparece.
// Ele mostra os números lado a lado e NADA MAIS: sem "Ads prejudicou o
// resultado", sem "Ads sem retorno", sem "corte o orçamento", sem "é possível
// recuperar", sem "reduzir Ads aumentará o lucro".
//
// O motivo é factual, não estilístico: o sistema não tem dado que sustente
// causalidade entre verba de mídia e resultado, nem que preveja as vendas
// perdidas após um corte. Afirmar qualquer uma dessas coisas seria inventar.
//
// Leitura permitida: "o investimento passou de X para Y e o TACoS passou de A%
// para B%".

import { formatarMoeda, formatarVariacaoMoeda } from "../../utils/currency.js";
import { formatarPercentual, formatarVariacaoPercentual, formatarPontosPercentuais } from "../../utils/percentage.js";
import { rotularCompetencia, formatarDataHora } from "../../utils/dates.js";
import DataTable from "./DataTable.jsx";

const MOTIVO_STATUS = {
  sem_dados: "Nenhum investimento de Ads encontrado para esta competência.",
  sem_grant: "O token do cliente não tem permissão no Mercado Ads.",
  erro: "Falha ao consultar o Mercado Ads.",
  parcial: "Só existe o resumo do mês inteiro — não cobre o mesmo intervalo do fechamento.",
};

const ROTULO_FONTE = { mercado_ads: "Mercado Ads", resumo_mensal: "Resumo mensal" };

export default function AdsFechamento({ ads, periodo, comparacao }) {
  const indisponivel = !ads?.disponivel;
  const motivo = ads?.atual?.motivo || MOTIVO_STATUS[ads?.atual?.status] || null;

  // Mesmas larguras da Comparação mensal: as duas tabelas ficam na mesma régua.
  const colunas = [
    { key: "label", header: "Indicador", width: "34%", isRowHeader: true, render: (l) => l.label },
    { key: "a", header: rotularCompetencia(comparacao.competencia), width: "17%", align: "right", render: (l) => l.a },
    { key: "b", header: rotularCompetencia(periodo.competencia), width: "17%", align: "right", render: (l) => l.b },
    { key: "delta", header: "Variação", width: "17%", align: "right", render: (l) => l.delta },
    { key: "pct", header: "%", width: "15%", align: "right",
      render: (l) => l.pct, cellClassName: () => "c360-fraco" },
  ];

  const linhas = indisponivel ? [] : [
    {
      label: "Investimento em Ads",
      a: formatarMoeda(ads.anterior.valor),
      b: formatarMoeda(ads.atual.valor),
      delta: formatarVariacaoMoeda(ads.variacoes.abs),
      pct: formatarVariacaoPercentual(ads.variacoes.pct),
    },
    {
      label: "TACoS",
      a: formatarPercentual(ads.anterior.tacos),
      b: formatarPercentual(ads.atual.tacos),
      delta: formatarPontosPercentuais(ads.variacoes.tacosPp),
      pct: "—",
    },
    {
      label: "Resultado após Ads",
      a: formatarMoeda(ads.anterior.resultadoAposAds),
      b: formatarMoeda(ads.atual.resultadoAposAds),
      delta: formatarVariacaoMoeda(ads.variacoes.resultadoAposAds),
      pct: "—",
    },
  ];

  return (
    <section className="vf-section c360-secao c360-ads">
      <div className="vf-section__header">
        <div className="vf-section__heading">
          <h2 className="vf-section__title">Ads no fechamento</h2>
          <p className="vf-section__description">
            Bloco descritivo. Mostra o investimento e o TACoS do período, sem entrar na explicação
            do resultado operacional.
          </p>
        </div>
        <div className="vf-section__actions">
          {ads?.atual?.fonte && (
            <span className="vf-tag is-neutral">{ROTULO_FONTE[ads.atual.fonte] || ads.atual.fonte}</span>
          )}
          {ads?.atual?.status === "parcial" && <span className="vf-tag is-warning">Parcial</span>}
        </div>
      </div>

      {indisponivel ? (
        <div className="vf-banner is-info vf-banner--compact">
          <div className="vf-banner__content">
            <p className="vf-banner__title">Sem dados de Ads</p>
            <p className="vf-banner__description">
              {motivo || "Investimento não disponível nesta competência."}
            </p>
          </div>
        </div>
      ) : (
        <>
          {ads.leitura && <p className="c360-ads__leitura">{ads.leitura}</p>}

          <DataTable
            caption="Comparação mensal do investimento em Ads, TACoS e resultado após Ads"
            columns={colunas}
            rows={linhas}
            getRowKey={(l) => l.label}
          />

          <p className="c360-nota c360-nota--fraca">
            Fonte: {ROTULO_FONTE[ads.atual.fonte] || ads.atual.fonte || "—"}
            {ads.atual.atualizadoEm ? ` · atualizado em ${formatarDataHora(ads.atual.atualizadoEm)}` : ""}
          </p>
        </>
      )}
    </section>
  );
}
