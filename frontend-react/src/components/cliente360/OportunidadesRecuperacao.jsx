// Oportunidades de recuperação OPERACIONAL.
//
// O total recuperável soma apenas oportunidades operacionais comprováveis:
// custo, frete, preço, comissão, imposto, mix e produtos no vermelho.
// Não existe "Ads sem retorno", "TACoS recuperável" nem "cortar verba" — cortar
// mídia tem efeito incerto sobre a receita, então tratá-la como dinheiro na mesa
// seria prometer um resultado que o dado não sustenta.
//
// Alertas de qualidade de dado aparecem na lista, mas fora do total (contaNoTotal).

import { formatarMoeda } from "../../utils/currency.js";
import EmptyState from "./EmptyState.jsx";

const SEVERIDADE_TAG = { critico: "is-danger", atencao: "is-warning", info: "is-info" };

export default function OportunidadesRecuperacao({ oportunidades }) {
  const lista = oportunidades?.oportunidades || [];
  const contaveis = lista.filter((o) => o.contaNoTotal);
  const alertas = lista.filter((o) => !o.contaNoTotal);

  return (
    <section className="vf-section c360-secao c360-recuperacao">
      <div className="vf-section__header">
        <div className="vf-section__heading">
          <h2 className="vf-section__title">Oportunidades de recuperação operacional</h2>
          <p className="vf-section__description">
            Cada item nasce de uma perda que já aparece na ponte ou de um produto do período.
            O valor é um teto conservador, não uma promessa.
          </p>
        </div>
        <div className="vf-section__actions">
          <span className="vf-kpi__label c360-recuperacao__rotulo">Total recuperável</span>
          <span className="c360-recuperacao__total">{formatarMoeda(oportunidades?.totalRecuperavel)}</span>
        </div>
      </div>

      {lista.length === 0 ? (
        <EmptyState
          compacto
          titulo="Nenhuma oportunidade operacional identificada"
          descricao="Nenhum custo, frete, preço, comissão ou imposto piorou o suficiente para virar valor recuperável neste período."
        />
      ) : (
        <>
          <ul className="c360-oportunidades">
            {contaveis.map((op, i) => (
              <li key={`${op.fator}-${i}`} className="vf-card c360-oportunidade">
                <div className="c360-oportunidade__cabecalho">
                  <div>
                    <span className={`vf-tag ${SEVERIDADE_TAG[op.severidade] || "is-neutral"}`}>{op.fator}</span>
                    <h3 className="c360-oportunidade__titulo">{op.titulo}</h3>
                  </div>
                  <p className="c360-oportunidade__valor">{formatarMoeda(op.recuperavelEstimado)}</p>
                </div>

                <p className="c360-oportunidade__descricao">{op.descricao}</p>
                {op.acaoRecomendada && (
                  <p className="c360-oportunidade__acao"><strong>Ação:</strong> {op.acaoRecomendada}</p>
                )}

                {op.produtos?.length > 0 && (
                  <ul className="c360-oportunidade__produtos">
                    {op.produtos.slice(0, 6).map((p) => (
                      <li key={p.mlb}>
                        <span className="c360-produto__titulo">{p.titulo || p.mlb}</span>
                        <span className="c360-produto__mlb">{p.mlb}</span>
                        <span className="c360-num c360-dir--negativo">
                          {formatarMoeda(p.impacto ?? p.resultado ?? (p.recuperavel != null ? -p.recuperavel : null))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {op.destino && (
                  <a className="vf-btn vf-btn--ghost vf-btn--sm" href={op.destino}>Abrir tela de ação</a>
                )}
              </li>
            ))}
          </ul>

          {alertas.length > 0 && (
            <div className="c360-recuperacao__alertas">
              <p className="c360-grupo__titulo">Sem valor estimável</p>
              {alertas.map((op, i) => (
                <div key={`alerta-${i}`} className="vf-banner is-warning vf-banner--compact">
                  <div className="vf-banner__content">
                    <p className="vf-banner__title">{op.titulo}</p>
                    <p className="vf-banner__description">{op.descricao}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="c360-nota c360-nota--fraca">{oportunidades.observacao}</p>
        </>
      )}
    </section>
  );
}
