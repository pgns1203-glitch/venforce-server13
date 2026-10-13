// frontend-react/src/components/financeiro/pendencias/PendenciasCusto.jsx
//
// Pendências de custo como AÇÃO, não como uma caixa vermelha. Cada produto sem
// custo/ambíguo aparece com o motivo, a receita que fica fora do LC/MC, o custo
// que a linha tem hoje e — quando é seguro — o campo para corrigir ali mesmo:
//
//   Produto · ID · SKU/Model · Motivo · Receita impactada · Custo atual · Novo custo · Ação
//
//   A. Corrigir na linha  → só MELI + base vinculada USADA no processamento +
//                           "sem custo" (nunca ambíguo). A chave da base é o
//                           MLB, então o registro afetado é inequívoco. O
//                           operador vê exatamente o que será gravado antes
//                           de confirmar; sucesso/erro são POR LINHA.
//   B. Baixar planilha    → XLSX para preencher e reimportar em Bases de Custo.
//   C. Reprocessar        → depois de corrigir (na linha ou na base). O
//                           reprocesso é um passo explícito, em lote: corrigir
//                           10 produtos não dispara 10 processamentos.
//
// Shopee: o custo pode morar no Item ou na Variação e a tela NÃO escolhe — lá
// a correção continua em Bases de Custo (ou pela planilha). Nenhum matching
// novo existe aqui.

import { useEffect, useMemo, useState } from "react";
import { agruparPendencias, gapsSemLinha, GAP_TIPO_LABEL, montarPlanilhaPendencias, motivoDoGap, nomeDaPlanilhaDePendencias } from "../../../utils/financeiro/pendencias.js";
import { baixarBlob, TIPO_XLSX } from "../../../utils/financeiro/arquivos.js";
import { obterPadraoCustoBase } from "../../../services/basesCustoApi.js";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";
import { SecaoFinanceira } from "../shared/SecaoFinanceira.jsx";
import { formatarMoeda } from "../../../utils/currency.js";
import { PendenciaLinha } from "./PendenciaLinha.jsx";
import { FluxoCorrecao } from "./FluxoCorrecao.jsx";

// As maiores primeiro (ordenadas por receita impactada); o resto fica a um clique,
// para a lista não empurrar reconciliação e composição para o fim da página.
const MAX_VISIVEIS = 10;

export function PendenciasCusto({ linhas, processamento, marketplace, contexto = {}, base = null, onReprocessar, reprocessando = false }) {
  const pendencias = useMemo(
    () => agruparPendencias(linhas, { unmatchedCosts: processamento?.unmatchedCosts }),
    [linhas, processamento]
  );
  const semLinha = useMemo(() => gapsSemLinha(pendencias, processamento?.unmatchedCosts), [pendencias, processamento]);
  const [registrados, setRegistrados] = useState({});
  const [verTodas, setVerTodas] = useState(false);
  const [padrao, setPadrao] = useState(null);

  // Cada processamento novo é um retrato novo: o que foi corrigido antes ou
  // já saiu da lista (resolvido) ou continua pendente (a base não resolveu).
  useEffect(() => {
    setRegistrados({});
  }, [processamento]);

  // Correção na linha só quando o processamento USOU a base vinculada desta
  // conta — corrigir a base não muda nada se os custos vieram de upload.
  const baseDaConta =
    marketplace === "meli" &&
    processamento?.costsSource === "base" &&
    base?.slug &&
    processamento?.costsBase?.slug === base.slug
      ? base
      : null;

  // Imposto/taxa que um registro NOVO recebe — para o operador saber o que
  // será criado. Uma leitura por base.
  const slugBase = baseDaConta?.slug || null;
  useEffect(() => {
    if (!slugBase) {
      setPadrao(null);
      return undefined;
    }
    const controlador = new AbortController();
    obterPadraoCustoBase(slugBase, { signal: controlador.signal })
      .then((r) => setPadrao(r?.padrao || null))
      .catch(() => setPadrao(null));
    return () => controlador.abort();
  }, [slugBase]);

  if (!pendencias.length && !semLinha.length) return null;

  const receitaTotal = pendencias.reduce((s, p) => (p.receitaImpactada === null ? s : s + p.receitaImpactada), 0);
  const visiveis = verTodas ? pendencias : pendencias.slice(0, MAX_VISIVEIS);
  const nRegistrados = Object.keys(registrados).length;

  function baixarPlanilha() {
    const bytes = montarPlanilhaPendencias(pendencias, { marketplace, ...contexto });
    baixarBlob(new Blob([bytes], { type: TIPO_XLSX }), nomeDaPlanilhaDePendencias({ marketplace, periodo: contexto.competencia }));
  }

  // Por que a correção na linha NÃO está disponível — dito com todas as letras.
  const motivoSemCorrecao =
    marketplace !== "meli"
      ? "no Shopee o custo pode estar no Item ou na Variação e a tela não escolhe o identificador sozinha."
      : processamento?.costsSource !== "base"
        ? "este processamento usou a planilha de custos enviada, não a base vinculada da conta — corrigir a base não mudaria nada."
        : "a base usada no processamento não é a vinculada a esta operação.";
  const motivoLinha =
    marketplace !== "meli"
      ? "Shopee: custo no Item ou na Variação — corrigir em Bases de Custo"
      : !baseDaConta
        ? "Custo vindo de planilha enviada — corrija a planilha"
        : null;

  const resumo = pendencias.length
    ? `${pendencias.length} ${pendencias.length === 1 ? "produto precisa" : "produtos precisam"} de ação · ${formatarMoeda(Math.round(receitaTotal * 100) / 100)} de receita fora do LC/MC.`
    : "Diagnóstico da base sem produto associado — veja o detalhe abaixo.";

  return (
    <SecaoFinanceira
      id="pendencias"
      titulo="Pendências de custo"
      descricao={resumo}
    >
      <FluxoCorrecao
        aoVivo={!!baseDaConta}
        motivoSemCorrecao={motivoSemCorrecao}
        base={base}
        nRegistrados={nRegistrados}
        onBaixar={baixarPlanilha}
        onReprocessar={onReprocessar}
        reprocessando={reprocessando}
      />

      {nRegistrados > 0 && (
        <div className="vf-banner is-success vf-banner--compact" role="status">
          <div className="vf-banner__content">
            <p className="vf-banner__description">
              {nRegistrados === 1 ? "1 custo foi registrado" : `${nRegistrados} custos foram registrados`} na base. O fechamento só reflete
              depois de <strong>reprocessar</strong>.
            </p>
          </div>
        </div>
      )}

      {pendencias.length > 0 && (
        <div className="vf-table-wrap vf-table-scroll vf-fin-pendencias__tabela">
          <table className="vf-table vf-table--compact" aria-label="Produtos com pendência de custo">
            <thead>
              <tr>
                <th>Produto</th>
                <th>ID</th>
                <th>SKU / Model</th>
                <th>Motivo</th>
                <th className="is-numeric">Receita impactada</th>
                <th className="is-numeric">Custo atual</th>
                <th>Novo custo</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((p) => (
                <PendenciaLinha
                  key={p.chave}
                  pendencia={p}
                  base={baseDaConta}
                  padrao={padrao}
                  motivoSemCorrecao={motivoLinha}
                  registrado={registrados[p.chave] ?? null}
                  onRegistrado={(valor) => setRegistrados((r) => ({ ...r, [p.chave]: valor }))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pendencias.length > MAX_VISIVEIS && (
        <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => setVerTodas((v) => !v)}>
          {verTodas ? "Mostrar só as maiores" : `Ver todas as ${pendencias.length} pendências`}
        </button>
      )}

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
