// frontend-react/src/components/financeiro/pendencias/PendenciasCusto.jsx
//
// Pendências de custo como AÇÃO. O caminho depende do VOLUME:
//
//   poucas  → CORRIGIR INDIVIDUALMENTE: custo + imposto na própria linha,
//             "Salvar na base" e feedback por linha;
//   muitas  → CORRIGIR EM LOTE: baixar XLSX → preencher → enviar ali mesmo →
//             importar e atualizar a base.
//
// Os dois terminam na MESMA coisa: a BASE DE CUSTOS vinculada atualizada.
// Depois, e só depois, REPROCESSAR (nunca automático). Nada fica só em estado
// React nem vale só para este fechamento.
//
// Segurança: o que pode ser gravado é decidido por utils/financeiro/baseCustos
// com os registros REAIS da base (identidade segura / ambígua / insuficiente);
// a tela não cria regra de matching.

import { useCallback, useEffect, useMemo, useState } from "react";
import { agruparPendencias, gapsSemLinha, GAP_TIPO_LABEL, montarPlanilhaPendencias, motivoDoGap, nomeDaPlanilhaDePendencias, separarPendenciasParaPlanilha } from "../../../utils/financeiro/pendencias.js";
import { baixarBlob, TIPO_XLSX } from "../../../utils/financeiro/arquivos.js";
import { indexarPorProduto, itensDaBase } from "../../../utils/financeiro/baseCustos.js";
import { obterCustosDaBase, obterPadraoCustoBase } from "../../../services/basesCustoApi.js";
import { SecaoFinanceira } from "../shared/SecaoFinanceira.jsx";
import { formatarMoeda } from "../../../utils/currency.js";
import { PendenciaLinha } from "./PendenciaLinha.jsx";
import { CorrecaoEmLote } from "./CorrecaoEmLote.jsx";

// Até aqui, corrigir uma a uma é mais rápido que montar planilha.
export const LIMITE_CORRECAO_INDIVIDUAL = 12;
const MAX_VISIVEIS = 10;

export function PendenciasCusto({ linhas, processamento, marketplace, contexto = {}, base = null, onReprocessar, reprocessando = false }) {
  const pendencias = useMemo(
    () => agruparPendencias(linhas, { unmatchedCosts: processamento?.unmatchedCosts }),
    [linhas, processamento]
  );
  const semLinha = useMemo(() => gapsSemLinha(pendencias, processamento?.unmatchedCosts), [pendencias, processamento]);

  const [registrados, setRegistrados] = useState({});
  const [gravadasLote, setGravadasLote] = useState(0);
  const [verTodas, setVerTodas] = useState(false);
  const [modoEscolhido, setModoEscolhido] = useState(null);
  const [padrao, setPadrao] = useState(null);
  const [itens, setItens] = useState([]);
  const [leituraBase, setLeituraBase] = useState("idle"); // idle | carregando | ok | erro

  // Cada processamento novo é um retrato novo: o que foi corrigido antes ou
  // já saiu da lista (resolvido) ou continua pendente (a base não resolveu).
  useEffect(() => {
    setRegistrados({});
    setGravadasLote(0);
  }, [processamento]);

  // Correção direta só quando o processamento USOU a base vinculada desta
  // conta — corrigir a base não muda nada se os custos vieram de upload.
  const marketplaceSuportado = marketplace === "meli" || marketplace === "shopee";
  const baseDoProcessamento =
    marketplaceSuportado && processamento?.costsSource === "base" && base?.slug && processamento?.costsBase?.slug === base.slug ? base : null;

  const slugBase = baseDoProcessamento?.slug || null;
  const carregarBase = useCallback(
    (sinal) => {
      if (!slugBase) return Promise.resolve();
      return Promise.all([obterCustosDaBase(slugBase, { signal: sinal }), obterPadraoCustoBase(slugBase, { signal: sinal }).catch(() => null)])
        .then(([b, p]) => {
          setItens(itensDaBase(b));
          setPadrao(p?.padrao || null);
          setLeituraBase("ok");
        })
        .catch((e) => {
          if (e?.name === "AbortError") return;
          setLeituraBase("erro");
        });
    },
    [slugBase]
  );
  useEffect(() => {
    if (!slugBase) {
      setItens([]);
      setPadrao(null);
      setLeituraBase("idle");
      return undefined;
    }
    setLeituraBase("carregando");
    const controlador = new AbortController();
    carregarBase(controlador.signal);
    return () => controlador.abort();
  }, [slugBase, carregarBase]);

  const indice = useMemo(() => indexarPorProduto(itens), [itens]);

  if (!pendencias.length && !semLinha.length) return null;

  const baseDaConta = baseDoProcessamento && leituraBase === "ok" ? baseDoProcessamento : null;
  const nRegistrados = Object.keys(registrados).length;
  const correcoes = nRegistrados + gravadasLote;
  const receitaTotal = pendencias.reduce((s, p) => (p.receitaImpactada === null ? s : s + p.receitaImpactada), 0);
  const modoPadrao = pendencias.length <= LIMITE_CORRECAO_INDIVIDUAL ? "individual" : "lote";
  const modo = modoEscolhido || modoPadrao;
  const visiveis = verTodas ? pendencias : pendencias.slice(0, MAX_VISIVEIS);
  const planilha = separarPendenciasParaPlanilha(pendencias, { marketplace });

  function baixarPlanilha() {
    const bytes = montarPlanilhaPendencias(pendencias, { marketplace, ...contexto, indice });
    baixarBlob(new Blob([bytes], { type: TIPO_XLSX }), nomeDaPlanilhaDePendencias({ marketplace, periodo: contexto.competencia }));
  }

  // Memória local do que acabou de ser gravado: a próxima pendência do MESMO
  // Item (Shopee) precisa enxergar o registro novo — sem isto ela seria
  // tratada como "criar" e sobrescreveria o que acabou de ser gravado.
  function aplicarRegistro(r) {
    setItens((atual) => {
      const resto = atual.filter((i) => i.produtoId !== r.produtoId);
      return [...resto, { produtoId: r.produtoId, idModel: r.idModel || null, sku: null, custo: r.custo, imposto: r.imposto, nome: r.nome || null }];
    });
  }

  // Por que a correção direta NÃO está disponível — dito com todas as letras.
  const motivoSemBase = !marketplaceSuportado
    ? "este marketplace não corrige custo por aqui."
    : processamento?.costsSource !== "base"
      ? "este processamento usou a planilha de custos enviada, não a base vinculada da conta — corrigir a base não mudaria nada. Corrija a planilha de custos e reprocesse."
      : !baseDoProcessamento
        ? "a base usada no processamento não é a vinculada a esta operação."
        : leituraBase === "carregando"
          ? "lendo a base de custos…"
          : "não foi possível ler a base de custos agora. Tente reprocessar ou corrija em Bases de Custo.";

  const resumo = pendencias.length
    ? `${pendencias.length} ${pendencias.length === 1 ? "produto precisa" : "produtos precisam"} de custo · ${formatarMoeda(Math.round(receitaTotal * 100) / 100)} de receita fora do LC/MC.`
    : "Diagnóstico da base sem produto associado — veja o detalhe abaixo.";

  const rodapeReprocessar = (
    <div className="vf-fin-pendencias__rodape">
      <span className="vf-field__hint">
        {correcoes > 0
          ? `${correcoes} ${correcoes === 1 ? "correção feita" : "correções feitas"} na base. Reprocesse para refletir no fechamento.`
          : "Depois de corrigir a base, reprocesse o fechamento."}
      </span>
      {onReprocessar && (
        <button type="button" className={`vf-btn ${correcoes > 0 ? "vf-btn--primary" : "vf-btn--secondary"} vf-btn--sm`} disabled={reprocessando} onClick={onReprocessar}>
          {reprocessando ? "Reprocessando…" : "Reprocessar fechamento"}
        </button>
      )}
    </div>
  );

  return (
    <SecaoFinanceira id="pendencias" titulo="Pendências de custo" descricao={resumo}>
      {baseDaConta ? (
        <>
          <div className="vf-fin-pendencias__modo" role="group" aria-label="Como corrigir">
            <div className="vf-segmented">
              <button type="button" className={`vf-segmented__item${modo === "individual" ? " is-active" : ""}`} aria-pressed={modo === "individual"} onClick={() => setModoEscolhido("individual")}>
                Corrigir individualmente
              </button>
              <button type="button" className={`vf-segmented__item${modo === "lote" ? " is-active" : ""}`} aria-pressed={modo === "lote"} onClick={() => setModoEscolhido("lote")}>
                Corrigir em lote (planilha)
              </button>
            </div>
            <span className="vf-field__hint">
              {modoPadrao === "individual"
                ? `Poucas pendências (${pendencias.length}): corrija direto aqui e salve na base ${baseDaConta.nome || baseDaConta.slug}.`
                : `Muitas pendências (${pendencias.length}): o caminho mais rápido é baixar a planilha, preencher e importar aqui mesmo.`}
            </span>
          </div>
        </>
      ) : (
        <div className="vf-banner is-info vf-banner--compact" role="status">
          <div className="vf-banner__content">
            <p className="vf-banner__description">
              <strong>Correção direta indisponível neste fechamento:</strong> {motivoSemBase}
            </p>
          </div>
        </div>
      )}

      {correcoes > 0 && (
        <div className="vf-banner is-success vf-banner--compact" role="status">
          <div className="vf-banner__content">
            <p className="vf-banner__description">
              {correcoes === 1 ? "1 custo foi registrado" : `${correcoes} custos foram registrados`} na base. O fechamento só reflete depois de <strong>reprocessar</strong>.
            </p>
          </div>
        </div>
      )}

      {baseDaConta && modo === "lote" && (
        <CorrecaoEmLote
          marketplace={marketplace}
          base={baseDaConta}
          itensBase={itens}
          pendencias={pendencias}
          planilha={{ incluidas: planilha.incluidas.length, semId: planilha.semId.length, ambiguas: planilha.ambiguas.length }}
          onBaixar={baixarPlanilha}
          onAplicado={({ gravadas }) => {
            setGravadasLote((n) => n + gravadas);
            carregarBase();
          }}
          onReprocessar={onReprocessar}
          reprocessando={reprocessando}
          gravadas={correcoes}
        />
      )}

      {(!baseDaConta || modo === "individual") && pendencias.length > 0 && (
        <div className="vf-table-wrap vf-table-scroll vf-fin-pendencias__tabela">
          <table className="vf-table vf-table--compact" aria-label="Produtos com pendência de custo">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Identificação</th>
                <th>Motivo</th>
                <th className="is-numeric">Receita impactada</th>
                <th className="is-numeric">Custo atual</th>
                <th>Novo custo</th>
                <th>Imposto %</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((p) => (
                <PendenciaLinha
                  key={p.chave}
                  pendencia={p}
                  marketplace={marketplace}
                  base={baseDaConta}
                  indice={indice}
                  padrao={padrao}
                  registrado={registrados[p.chave] ?? null}
                  onRegistrado={(r) => {
                    aplicarRegistro(r);
                    setRegistrados((x) => ({ ...x, [p.chave]: r }));
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(!baseDaConta || modo === "individual") && pendencias.length > MAX_VISIVEIS && (
        <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => setVerTodas((v) => !v)}>
          {verTodas ? "Mostrar só as maiores" : `Ver todas as ${pendencias.length} pendências`}
        </button>
      )}

      {/* Sem base para atualizar: a planilha continua útil (corrigir em Bases/arquivo). */}
      {!baseDaConta && pendencias.length > 0 && (
        <div className="vf-cluster">
          <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" onClick={baixarPlanilha}>
            Baixar planilha (XLSX)
          </button>
          <a className="vf-btn vf-btn--ghost vf-btn--sm" href="bases.html" target="_blank" rel="noopener noreferrer">
            Abrir Bases de Custo ↗
          </a>
        </div>
      )}

      {(!baseDaConta || modo === "individual") && rodapeReprocessar}

      {semLinha.length > 0 && (
        <details className="vf-fin-disclosure">
          <summary>Diagnóstico da base ({semLinha.length})</summary>
          <ul className="vf-fin-leitura">
            {semLinha.slice(0, 200).map((g, i) => (
              <li key={i} className="vf-fin-leitura__item is-warning">
                <span className="vf-mono">{GAP_TIPO_LABEL[g.type] || "ID"}: {String(g.value ?? "—")}</span> — {motivoDoGap(g)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </SecaoFinanceira>
  );
}
