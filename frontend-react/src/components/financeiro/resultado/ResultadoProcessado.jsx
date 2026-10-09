// frontend-react/src/components/financeiro/resultado/ResultadoProcessado.jsx
//
// RESULTADO DO PROCESSAMENTO — nasce logo abaixo de Processar, no mesmo
// fluxo. Ordem de leitura: resumo → leitura/cobertura → composição →
// métricas do marketplace. Tudo vem da resposta de POST /fechamentos/financeiro;
// nada é recalculado aqui.

import { ehAdmin } from "../../../services/apiClient.js";
import { rotuloModo, CONFIANCA_LABEL } from "../../../utils/financeiro/resumoFechamento.js";
import { base64ParaBlob, baixarBlob, nomeDaPlanilhaProcessada, TIPO_XLSX } from "../../../utils/financeiro/arquivos.js";
import { ResumoKpis } from "./ResumoKpis.jsx";
import { ComposicaoResultado } from "./ComposicaoResultado.jsx";
import { BlocosExecutivos } from "./BlocosExecutivos.jsx";
import { CoberturaFechamento } from "./CoberturaFechamento.jsx";
import { LeituraFechamento } from "./LeituraFechamento.jsx";
import { MetricasSecundarias } from "./MetricasSecundarias.jsx";

export function ResultadoProcessado({ processamento, marketplace, periodo, children }) {
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
    <section className="vf-fin-resultado vf-stack" aria-label="Resultado do processamento">
      <header className="vf-cluster vf-cluster--between vf-fin-resultado__cabecalho">
        <div className="vf-stack vf-stack--sm">
          <h3 className="vf-fin-resultado__titulo">Resultado do processamento</h3>
          <p className="vf-field__hint">
            {[modo, confianca ? `confiança ${confianca.toLowerCase()}` : null,
              origemCustos ? `custos da base ${origemCustos.nome || origemCustos.slug}` : processamento.costsSource === "upload" ? "custos da planilha enviada" : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="vf-cluster">
          {processamento.excelBase64 && (
            <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" onClick={baixarPlanilha}>
              Baixar planilha processada
            </button>
          )}
        </div>
      </header>

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

      <ResumoKpis summary={summary} />

      <div className="vf-fin-blocos vf-fin-blocos--2">
        <LeituraFechamento processamento={processamento} marketplace={marketplace} />
        <ComposicaoResultado summary={summary} />
      </div>

      <CoberturaFechamento
        summary={summary}
        unmatchedIds={processamento.unmatchedIds}
        unmatchedCosts={processamento.unmatchedCosts}
      />

      <MetricasSecundarias summary={summary} marketplace={marketplace} />

      {children}

      <details className="vf-fin-disclosure">
        <summary>Receitas, deduções, investimentos e resultado</summary>
        <BlocosExecutivos summary={summary} marketplace={marketplace} />
      </details>
    </section>
  );
}
