// frontend-react/src/components/financeiro/pendencias/PendenciasCusto.jsx
//
// Pendências de custo como AÇÃO, não como uma caixa vermelha: cada produto
// sem custo/ambíguo com o motivo, a receita impactada e o que fazer.
//   A. Baixar planilha de pendências (CSV)
//   B. Reprocessar o fechamento depois de corrigir a base
//   C. Corrigir custo na hora — só MELI + base vinculada + sem custo

import { useMemo, useState } from "react";
import { agruparPendencias, gapsSemLinha, GAP_TIPO_LABEL, montarCsvPendencias, motivoDoGap, nomeDaPlanilhaDePendencias } from "../../../utils/financeiro/pendencias.js";
import { baixarBlob } from "../../../utils/financeiro/arquivos.js";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";
import { formatarMoeda } from "../../../utils/currency.js";
import { CorrigirCustoMeli } from "./CorrigirCustoMeli.jsx";

const MAX_VISIVEIS = 25;

export function PendenciasCusto({ linhas, processamento, marketplace, contexto = {}, base = null, onReprocessar, reprocessando = false }) {
  const pendencias = useMemo(
    () => agruparPendencias(linhas, { unmatchedCosts: processamento?.unmatchedCosts }),
    [linhas, processamento]
  );
  const semLinha = useMemo(() => gapsSemLinha(pendencias, processamento?.unmatchedCosts), [pendencias, processamento]);
  const [corrigindo, setCorrigindo] = useState(null);
  const [registrados, setRegistrados] = useState([]);
  const [verTodas, setVerTodas] = useState(false);

  if (!pendencias.length && !semLinha.length) return null;

  // Correção rápida só quando o processamento USOU a base vinculada desta
  // conta — corrigir a base não muda nada se os custos vieram de upload.
  const baseDaConta =
    marketplace === "meli" &&
    processamento?.costsSource === "base" &&
    base?.slug &&
    processamento?.costsBase?.slug === base.slug
      ? base
      : null;

  const receitaTotal = pendencias.reduce((s, p) => (p.receitaImpactada === null ? s : s + p.receitaImpactada), 0);
  const visiveis = verTodas ? pendencias : pendencias.slice(0, MAX_VISIVEIS);

  function baixarCsv() {
    const csv = montarCsvPendencias(pendencias, { marketplace, ...contexto });
    baixarBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), nomeDaPlanilhaDePendencias({ marketplace, periodo: contexto.competencia }));
  }

  return (
    <section className="vf-fin-bloco vf-fin-pendencias vf-stack vf-stack--sm" aria-label="Pendências de custo">
      <div className="vf-cluster vf-cluster--between">
        <div>
          <h4 className="vf-fin-bloco__titulo">Pendências de custo</h4>
          <p className="vf-field__hint">
            {pendencias.length} {pendencias.length === 1 ? "produto precisa" : "produtos precisam"} de ação
            {pendencias.length ? ` · ${formatarMoeda(Math.round(receitaTotal * 100) / 100)} de receita fora do LC/MC` : ""}.
          </p>
        </div>
        <div className="vf-cluster">
          {pendencias.length > 0 && (
            <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" onClick={baixarCsv}>
              Baixar planilha de pendências
            </button>
          )}
          <a className="vf-btn vf-btn--ghost vf-btn--sm" href="bases.html">
            Abrir Bases de Custo
          </a>
          {onReprocessar && (
            <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" disabled={reprocessando} onClick={onReprocessar}>
              {reprocessando ? "Reprocessando…" : "Reprocessar fechamento"}
            </button>
          )}
        </div>
      </div>

      {pendencias.length > 0 && (
        <div className="vf-table-wrap vf-table-scroll">
          <table className="vf-table vf-table--compact" aria-label="Produtos com pendência de custo">
            <thead>
              <tr>
                <th>Produto</th>
                <th>ID</th>
                <th>SKU / Model</th>
                <th>Motivo</th>
                <th className="is-numeric">Receita impactada</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((p) => {
                const podeCorrigir = baseDaConta && p.statusCusto === "sem_custo" && p.itemId && !registrados.includes(p.chave);
                return (
                  <tr key={p.chave} data-pendencia={p.statusCusto}>
                    <td>{p.produto || "—"}</td>
                    <td className="vf-mono">{p.itemId || "—"}</td>
                    <td className="vf-mono">{[p.sku, p.modelId].filter(Boolean).join(" · ") || "—"}</td>
                    <td>
                      {p.motivo}
                      {p.aguardandoFinanceiro && <span className="vf-field__hint"> · também aguardando financeiro</span>}
                    </td>
                    <td className="is-numeric">{formatarValor(p.receitaImpactada)}</td>
                    <td>
                      {registrados.includes(p.chave) ? (
                        <span className="vf-status is-success">Custo registrado</span>
                      ) : corrigindo === p.chave ? (
                        <CorrigirCustoMeli
                          pendencia={p}
                          base={baseDaConta}
                          onCancelar={() => setCorrigindo(null)}
                          onRegistrado={() => {
                            setRegistrados((r) => [...r, p.chave]);
                            setCorrigindo(null);
                            onReprocessar?.();
                          }}
                        />
                      ) : podeCorrigir ? (
                        <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => setCorrigindo(p.chave)}>
                          Corrigir custo
                        </button>
                      ) : (
                        <span className="vf-field__hint">Corrigir em Bases de Custo</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pendencias.length > MAX_VISIVEIS && (
        <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => setVerTodas((v) => !v)}>
          {verTodas ? "Mostrar só as maiores" : `Ver todas as ${pendencias.length} pendências`}
        </button>
      )}

      {marketplace !== "meli" && pendencias.length > 0 && (
        <p className="vf-field__hint">
          No Shopee o custo pode estar no Item ou na Variação — a tela não escolhe o identificador. Corrija em Bases de Custo
          (ou baixe a planilha de pendências) e reprocesse.
        </p>
      )}
      {marketplace === "meli" && !baseDaConta && pendencias.length > 0 && (
        <p className="vf-field__hint">
          Correção rápida indisponível: este processamento não usou a base vinculada da conta. Corrija a planilha de custos e
          reprocesse.
        </p>
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
    </section>
  );
}
