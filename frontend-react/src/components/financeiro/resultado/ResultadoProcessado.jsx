// frontend-react/src/components/financeiro/resultado/ResultadoProcessado.jsx
//
// RESULTADO DO PROCESSAMENTO — nasce logo abaixo de Processar, no mesmo
// fluxo. A ordem é a ordem das perguntas de quem fecha o mês:
//
//   1. Quanto fechou?            Faixa de topo: KPIs + (ao lado) Leitura discreta
//   2. Bate com o marketplace?   Reconciliação (Shopee)
//   3. Como se compõe?           Composição financeira
//   4. Posso confiar?            Cobertura (compacta — apoio, não protagonista)
//   5. O que está errado?        Pendências (slot `pendencias`)
//   6. Quero salvar/publicar?    Ações (slot `acoes`)
//
// Os produtos NÃO moram aqui: são a investigação detalhada e vêm por último,
// fora deste componente (NovoFechamento). Tudo vem da resposta de
// POST /fechamentos/financeiro; nada é recalculado.

import { useMemo } from "react";
import { ehAdmin } from "../../../services/apiClient.js";
import { normalizarLinhas } from "../../../utils/financeiro/produtos.js";
import { ReconciliacaoShopee } from "../shopee/ReconciliacaoShopee.jsx";
import { rotuloModo, CONFIANCA_LABEL } from "../../../utils/financeiro/resumoFechamento.js";
import { base64ParaBlob, baixarBlob, nomeDaPlanilhaProcessada, TIPO_XLSX } from "../../../utils/financeiro/arquivos.js";
import { SecaoFinanceira } from "../shared/SecaoFinanceira.jsx";
import { ResumoKpis } from "./ResumoKpis.jsx";
import { ComposicaoFinanceira } from "./ComposicaoFinanceira.jsx";
import { CoberturaFechamento } from "./CoberturaFechamento.jsx";
import { LeituraFechamento } from "./LeituraFechamento.jsx";
import { MetricasSecundarias } from "./MetricasSecundarias.jsx";

export function ResultadoProcessado({ processamento, marketplace, periodo, linhas: linhasDoPai = null, pendencias = null, acoes = null }) {
  // Linhas COMPLETAS do processamento em memória, normalizadas uma vez — a
  // mesma lista alimenta pendências e tabela de produtos. O pai pode entregar
  // a lista pronta (para não normalizar duas vezes).
  const linhasProprias = useMemo(
    () => (linhasDoPai ? null : normalizarLinhas(processamento?.detailedRows, { ambiguousIds: processamento?.summary?.ambiguousCostIds })),
    [linhasDoPai, processamento]
  );
  const linhas = linhasDoPai || linhasProprias;

  if (!processamento) {
    return (
      <div className="vf-empty">
        <p className="vf-empty__description">Processe um fechamento para visualizar o resultado.</p>
      </div>
    );
  }
  const summary = processamento.summary || {};
  const modo = rotuloModo(summary);
  const confianca = CONFIANCA_LABEL[summary.financialConfidence] || null;
  const origemCustos = processamento.costsSource === "base" ? processamento.costsBase : null;

  function baixarPlanilha() {
    baixarBlob(base64ParaBlob(processamento.excelBase64, TIPO_XLSX), nomeDaPlanilhaProcessada({ marketplace, periodo }));
  }

  return (
    <section className="vf-fin-resultado vf-fin-pagina" aria-label="Resultado do processamento">
      <SecaoFinanceira
        id="resultado"
        titulo="Resultado do fechamento"
        descricao={[
          modo,
          confianca ? `confiança ${confianca.toLowerCase()}` : null,
          origemCustos ? `custos da base ${origemCustos.nome || origemCustos.slug}` : processamento.costsSource === "upload" ? "custos da planilha enviada" : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        acoes={
          processamento.excelBase64 ? (
            <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" onClick={baixarPlanilha}>
              Baixar planilha processada
            </button>
          ) : null
        }
      >
        {processamento.emptySales && (
          <div className="vf-banner is-info vf-banner--compact" role="status">
            <div className="vf-banner__content">
              <p className="vf-banner__description">Planilha válida sem vendas no período.</p>
            </div>
          </div>
        )}

        {/* Caixa-preta do fechamento: captura automática no backend. Só avisa
            que já aconteceu — sem dado sensível na tela. */}
        {processamento.incidente?.codigo && (
          <div className="vf-cluster vf-fin-incidente" role="status">
            <span className="vf-field__hint">
              Ocorrência de suporte <strong className="vf-mono">{processamento.incidente.codigo}</strong> — arquivos
              preservados temporariamente para diagnóstico.
            </span>
            <button
              type="button"
              className="vf-btn vf-btn--ghost vf-btn--sm"
              onClick={() => navigator.clipboard?.writeText(processamento.incidente.codigo)}
            >
              Copiar código
            </button>
            {ehAdmin() && (
              <a
                className="vf-btn vf-btn--ghost vf-btn--sm"
                href={`financeiro-debug.html?incidente=${encodeURIComponent(processamento.incidente.codigo)}`}
              >
                Abrir diagnóstico
              </a>
            )}
          </div>
        )}

        {/* Faixa de topo: os números à esquerda, a leitura como apoio à direita. */}
        <div className="vf-fin-topo">
          <div className="vf-fin-topo__numeros">
            <ResumoKpis summary={summary} />
            <MetricasSecundarias summary={summary} marketplace={marketplace} />
          </div>
          <LeituraFechamento processamento={processamento} marketplace={marketplace} />
        </div>
      </SecaoFinanceira>

      <ReconciliacaoShopee summary={summary} marketplace={marketplace} />

      <SecaoFinanceira id="composicao" titulo="Composição financeira" descricao="Como o resultado se forma: receitas, deduções, custos e investimentos.">
        <ComposicaoFinanceira summary={summary} marketplace={marketplace} />
      </SecaoFinanceira>

      <SecaoFinanceira id="cobertura" titulo="Cobertura" className="vf-fin-secao--compacta">
        <CoberturaFechamento
          summary={summary}
          unmatchedIds={processamento.unmatchedIds}
          unmatchedCosts={processamento.unmatchedCosts}
        />
      </SecaoFinanceira>

      {typeof pendencias === "function" ? pendencias({ linhas }) : pendencias}

      {acoes}
    </section>
  );
}
