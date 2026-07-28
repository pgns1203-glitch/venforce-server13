// Placar do consultor — só ações OPERACIONAIS.
//
// Crédito é dado apenas quando a ação registrada num mês aparece como melhora do
// MESMO fator na ponte do mês seguinte. Ads não é creditado: mudança de verba de
// mídia não é ação operacional comprovável na ponte (que nem contém Ads).
// Ações históricas de Ads continuam no banco e aparecem numa área "Histórico
// legado", com crédito R$ 0,00 e fora do total — nada é apagado.
//
// Carregado sob demanda: a apuração percorre a ponte de várias competências.

import { useCallback, useEffect, useRef, useState } from "react";
import { formatarMoeda } from "../../utils/currency.js";
import { rotularCompetencia } from "../../utils/dates.js";
import { obterPlacar } from "../../services/cliente360Api.js";
import DataTable from "./DataTable.jsx";
import EmptyState from "./EmptyState.jsx";

const FATOR_LABEL = {
  custo: "Correção de custo", frete: "Renegociação de frete", preco: "Reprecificação",
  comissao: "Correção de comissão", imposto: "Correção de imposto",
  mix: "Melhoria de mix", produto: "Pausa/retomada de produto", base: "Correção de base",
};

const COLUNAS_PLACAR = [
  { key: "acao", header: "Ação", width: "30%", isRowHeader: true,
    render: (acao) => FATOR_LABEL[acao.fator] || acao.fator },
  { key: "competencia", header: "Competência", width: "16%",
    render: (acao) => rotularCompetencia(acao.competencia) },
  { key: "medida", header: "Medida em", width: "16%",
    render: (acao) => rotularCompetencia(acao.competenciaMedida) },
  { key: "produto", header: "Produto", width: "22%",
    render: (acao) => acao.titulo || acao.mlb || "conta toda",
    cellClassName: () => "c360-fraco c360-td--truncar" },
  { key: "credito", header: "Crédito", width: "16%", align: "right",
    render: (acao) => formatarMoeda(acao.creditoApurado),
    cellClassName: (acao) => (acao.creditoApurado > 0 ? "c360-dir--positivo" : "") },
];

export default function PlacarConsultor({ slug, marketplace }) {
  const [placar, setPlacar] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const abortRef = useRef(null);

  // Trocar de cliente invalida o placar apurado.
  useEffect(() => {
    setPlacar(null);
    setErro(null);
  }, [slug, marketplace]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const apurar = useCallback(async () => {
    abortRef.current?.abort();
    const controlador = new AbortController();
    abortRef.current = controlador;

    setCarregando(true);
    setErro(null);
    try {
      const resposta = await obterPlacar(slug, { marketplace, signal: controlador.signal });
      if (!controlador.signal.aborted) setPlacar(resposta);
    } catch (err) {
      if (err?.name === "AbortError" || controlador.signal.aborted) return;
      setErro(err?.message || "Não foi possível carregar o placar.");
    } finally {
      if (!controlador.signal.aborted) setCarregando(false);
    }
  }, [slug, marketplace]);

  return (
    <section className="vf-section c360-secao c360-placar">
      <div className="vf-section__header">
        <div className="vf-section__heading">
          <h2 className="vf-section__title">Placar do consultor</h2>
          <p className="vf-section__description">
            Quanto de resultado operacional foi recuperado por ação registrada da consultoria.
            O que não tem ação por trás fica em “mercado/outros” e nunca é creditado.
          </p>
        </div>
        <div className="vf-section__actions">
          <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" disabled={carregando} onClick={apurar}>
            {carregando ? "Apurando…" : placar ? "Recalcular" : "Apurar placar"}
          </button>
        </div>
      </div>

      {erro && (
        <div className="vf-banner is-danger vf-banner--compact" role="alert">
          <div className="vf-banner__content"><p className="vf-banner__description">{erro}</p></div>
        </div>
      )}

      {!placar && !erro && (
        <EmptyState
          compacto
          titulo="Placar não apurado"
          descricao="A apuração percorre a ponte de várias competências. Clique em “Apurar placar” quando precisar do número."
        />
      )}

      {placar && (
        <>
          <div className="vf-kpi-grid c360-kpis">
            <article className="vf-kpi vf-kpi--featured">
              <p className="vf-kpi__label">Recuperado por ação da consultoria</p>
              <p className="vf-kpi__value">{formatarMoeda(placar.totalRecuperado)}</p>
            </article>
            <article className="vf-kpi">
              <p className="vf-kpi__label">Ainda na mesa</p>
              <p className="vf-kpi__value">{formatarMoeda(placar.aindaNaMesa)}</p>
              <p className="vf-kpi__foot">recuperável operacional não capturado</p>
            </article>
          </div>

          {placar.acoes.length === 0 ? (
            <EmptyState
              compacto
              titulo="Nenhuma ação operacional registrada"
              descricao="Registre correções de custo, frete, preço, comissão, imposto, mix ou base para o placar medir o efeito no mês seguinte."
            />
          ) : (
            <DataTable
              caption="Ações creditadas no placar"
              columns={COLUNAS_PLACAR}
              rows={placar.acoes}
              getRowKey={(acao) => acao.id}
            />
          )}

          {placar.legado?.length > 0 && (
            <details className="c360-detalhe">
              <summary>
                Histórico legado — ações de mídia registradas antes da separação Ads × operação ({placar.legado.length})
              </summary>
              <p className="c360-nota">
                Estes registros continuam no banco por auditoria. Não entram no placar operacional
                e valem R$ 0,00 aqui.
              </p>
              <ul className="c360-legado">
                {placar.legado.map((acao) => (
                  <li key={acao.id}>
                    <span className="vf-tag is-neutral">{acao.fator}</span>{" "}
                    {acao.titulo || acao.tipo} · {rotularCompetencia(acao.competencia)}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <p className="c360-nota c360-nota--fraca">{placar.observacao}</p>
        </>
      )}
    </section>
  );
}
