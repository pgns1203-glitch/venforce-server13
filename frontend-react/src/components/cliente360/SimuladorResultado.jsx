// Simulador "e se…". Por produto: Δ% preço, Δ% custo, Δ% frete e pausar/despausar.
//
// Toda a matemática roda NO SERVIDOR (mesmo motor puro da ponte), chamada com
// debounce curto pelo hook. Não há cópia das fórmulas aqui.
//
// ADS NÃO É VARIÁVEL. Não existe input de Ads, não existe "Cortar Ads ao
// TACoS-alvo", não existe cenário de redução de orçamento. O investimento do mês
// aparece num bloco secundário e informativo, FIXO, só para mostrar o resultado
// após Ads do cenário. Sem dados de Ads, esse bloco não é calculado — e jamais
// assume Ads = 0.

import { useMemo, useState } from "react";
import { formatarMoeda, formatarVariacaoMoeda } from "../../utils/currency.js";
import { formatarNumero } from "../../utils/numbers.js";
import { formatarPercentual } from "../../utils/percentage.js";
import { useCliente360Simulation } from "../../hooks/useCliente360Simulation.js";
import EmptyState from "./EmptyState.jsx";

export default function SimuladorResultado({ simulacao, slug, competencia, marketplace }) {
  const sim = useCliente360Simulation({ slug, competencia, marketplace });
  const [busca, setBusca] = useState("");
  const [somenteAjustados, setSomenteAjustados] = useState(false);

  const produtos = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (simulacao.produtos || []).filter((p) => {
      if (somenteAjustados && !sim.ajustes[p.mlb]) return false;
      if (!termo) return true;
      return `${p.titulo} ${p.mlb}`.toLowerCase().includes(termo);
    });
  }, [simulacao.produtos, busca, somenteAjustados, sim.ajustes]);

  const adsDisponivel = simulacao.adsMantido !== null && simulacao.adsMantido !== undefined;
  const antes = sim.resultado?.antes;
  const depois = sim.resultado?.depois;
  const delta = sim.resultado?.delta;

  const semElasticidade = (sim.resultado?.avisos || []).some((a) => a.motivo === "elasticidade_desconhecida");

  const campo = (mlb, chave) => sim.ajustes[mlb]?.[chave] ?? (chave === "pausar" ? false : 0);

  return (
    <section className="vf-section c360-simulador">
      <div className="vf-section__header">
        <div>
          <h2 className="vf-section__title">Simulador</h2>
          <p className="vf-section__description">
            Ajuste preço, custo e frete por produto — ou pause o que sangra — e veja o resultado
            operacional recalculado no servidor.
          </p>
        </div>
        <div className="vf-section__actions">
          {sim.processando && <span className="vf-status is-info">Simulando…</span>}
        </div>
      </div>

      {/* Topo: resultado OPERACIONAL — o número que a simulação de fato move */}
      <div className="c360-sim-topo">
        <article className="vf-kpi">
          <p className="vf-kpi__label">Resultado operacional atual</p>
          <p className="vf-kpi__value">
            {formatarMoeda(antes?.resultadoOperacional ?? simulacao.resultadoOperacionalAtual)}
          </p>
        </article>
        <article className="vf-kpi vf-kpi--featured">
          <p className="vf-kpi__label">Resultado operacional simulado</p>
          <p className="vf-kpi__value">{formatarMoeda(depois?.resultadoOperacional)}</p>
        </article>
        <article className={`vf-kpi${(delta?.resultadoOperacional ?? 0) < 0 ? " vf-kpi--danger" : ""}`}>
          <p className="vf-kpi__label">Variação operacional</p>
          <p className="vf-kpi__value">{formatarVariacaoMoeda(delta?.resultadoOperacional)}</p>
          {depois && (
            <p className="vf-kpi__foot">Margem simulada: {formatarPercentual(depois.margemOperacional)}</p>
          )}
        </article>
      </div>

      {/* Bloco secundário: Ads MANTIDO, fixo. Não é variável do cenário. */}
      <div className="c360-sim-ads">
        <p className="c360-grupo__titulo">
          Ads mantido no fechamento
          <span className="c360-grupo__formula">o investimento do mês não muda com a simulação</span>
        </p>
        {adsDisponivel ? (
          <div className="c360-sim-ads__linhas">
            <div><span>Ads mantido</span><strong>{formatarMoeda(simulacao.adsMantido)}</strong></div>
            <div>
              <span>Resultado atual após Ads</span>
              <strong>{formatarMoeda(antes?.resultadoAposAds ?? simulacao.resultadoAposAdsAtual)}</strong>
            </div>
            <div>
              <span>Resultado simulado após Ads</span>
              <strong>{formatarMoeda(depois?.resultadoAposAds)}</strong>
            </div>
          </div>
        ) : (
          <p className="c360-nota">
            Resultado após Ads indisponível — não há dados de Ads nesta competência. A simulação
            operacional acima continua válida.
          </p>
        )}
      </div>

      {/* Cenários rápidos: todos operacionais */}
      <div className="c360-sim-cenarios">
        {simulacao.cenariosRapidos.map((c) => (
          <button
            key={c.chave}
            type="button"
            className={`vf-btn vf-btn--secondary vf-btn--sm${sim.cenarioRapidoAtivo === c.chave ? " is-active" : ""}`}
            title={c.descricao}
            disabled={sim.processando}
            onClick={() => sim.aplicarCenarioRapido(c.chave, simulacao.produtos)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {sim.erro && (
        <div className="vf-banner is-danger vf-banner--compact" role="alert">
          <div className="vf-banner__content">
            <p className="vf-banner__title">Não foi possível simular</p>
            <p className="vf-banner__description">{sim.erro}</p>
          </div>
        </div>
      )}

      {semElasticidade && (
        <div className="vf-banner is-warning vf-banner--compact">
          <div className="vf-banner__content">
            <p className="vf-banner__title">Volume mantido fixo</p>
            <p className="vf-banner__description">
              Algum produto alterado não tem elasticidade-preço estimável no histórico. O simulador
              não inventa a reação do mercado: manteve o volume e o número é aproximado.
            </p>
          </div>
        </div>
      )}

      <div className="vf-toolbar c360-sim-toolbar">
        <div className="vf-toolbar__filters">
          <input
            className="vf-input vf-input--sm"
            type="search"
            placeholder="Buscar produto ou MLB"
            aria-label="Buscar produto"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <label className="vf-check">
            <input
              type="checkbox"
              checked={somenteAjustados}
              onChange={(e) => setSomenteAjustados(e.target.checked)}
            />{" "}
            Só os ajustados
          </label>
        </div>
        <div className="vf-toolbar__actions">
          <button
            type="button"
            className="vf-btn vf-btn--ghost vf-btn--sm"
            disabled={!sim.temCenario}
            onClick={sim.limpar}
          >
            Limpar cenário
          </button>
        </div>
      </div>

      {produtos.length === 0 ? (
        <EmptyState
          compacto
          titulo="Nenhum produto para simular"
          descricao="Ajuste a busca ou sincronize o fechamento desta competência."
        />
      ) : (
        <div className="vf-table-wrap c360-sim-tabela">
          <table className="vf-table vf-table--compact">
            <thead>
              <tr>
                <th scope="col">Produto</th>
                <th scope="col" className="c360-num">Unid.</th>
                <th scope="col" className="c360-num">Preço</th>
                <th scope="col" className="c360-num">Margem/un.</th>
                <th scope="col" className="c360-num">Δ% preço</th>
                <th scope="col" className="c360-num">Δ% custo</th>
                <th scope="col" className="c360-num">Δ% frete</th>
                <th scope="col">Pausar</th>
              </tr>
            </thead>
            <tbody>
              {produtos.map((p) => (
                <tr key={p.mlb} className={p.noVermelho ? "c360-linha-vermelho" : undefined}>
                  <th scope="row" className="c360-produto">
                    <span className="c360-produto__titulo">{p.titulo}</span>
                    <span className="c360-produto__mlb">{p.mlb}</span>
                    {p.noVermelho && <span className="vf-tag is-danger">no vermelho</span>}
                  </th>
                  <td className="c360-num">{formatarNumero(p.unidades)}</td>
                  <td className="c360-num">{formatarMoeda(p.precoMedio)}</td>
                  <td className={`c360-num${p.margemUnitaria < 0 ? " c360-dir--negativo" : ""}`}>
                    {formatarMoeda(p.margemUnitaria)}
                  </td>
                  {["deltaPrecoPct", "deltaCustoPct", "deltaFretePct"].map((chave) => (
                    <td key={chave} className="c360-num">
                      <input
                        className="vf-input vf-input--sm c360-sim-input"
                        type="number"
                        step="1"
                        aria-label={`${chave === "deltaPrecoPct" ? "Variação de preço" : chave === "deltaCustoPct" ? "Variação de custo" : "Variação de frete"} de ${p.titulo}`}
                        value={campo(p.mlb, chave)}
                        disabled={campo(p.mlb, "pausar")}
                        onChange={(e) => sim.definir(p.mlb, chave, Number(e.target.value) || 0)}
                      />
                    </td>
                  ))}
                  <td>
                    <label className="vf-switch">
                      <input
                        type="checkbox"
                        aria-label={`Pausar ${p.titulo}`}
                        checked={campo(p.mlb, "pausar")}
                        onChange={(e) => sim.definir(p.mlb, "pausar", e.target.checked)}
                      />
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
