// frontend-react/src/components/financeiro/FechamentoTab.jsx
// Status do fechamento do período — leitura (server/services/
// financeiroVisaoService.js). GERAR um fechamento continua sendo o fluxo de
// upload real, em Portal/financeiro.html (F4.1 é só leitura; a ação de
// gerar/publicar não foi absorvida ainda — Master Spec F4.2, risco alto,
// "é dinheiro", roda em paralelo antes de qualquer cutover).

import { formatarDataHora } from "../../utils/dates.js";

const STATUS_INFO = {
  publicado: { label: "Publicado", tom: "success" },
  rascunho: { label: "Rascunho", tom: "warning" },
  nao_gerado: { label: "Não gerado", tom: "neutral" },
};

export function FechamentoTab({ resultado, clienteSlug, periodoLabel }) {
  const dados = resultado.dados;
  const status = STATUS_INFO[dados?.status] || STATUS_INFO.nao_gerado;
  const semFechamento = !resultado.disponivel || !dados || dados.status === "nao_gerado";

  return (
    <div className="vf-stack">
      <div className="vf-cluster" style={{ justifyContent: "space-between" }}>
        <span className={`vf-status is-${status.tom}`}>{status.label}</span>
        <span className="vf-field__hint">{periodoLabel}</span>
      </div>

      {semFechamento ? (
        <div className="vf-empty">
          <p className="vf-empty__title">Nenhum fechamento gerado</p>
          <p className="vf-empty__description">
            {resultado.motivo || `${periodoLabel} ainda não tem fechamento processado.`}
          </p>
          <div className="vf-empty__actions">
            <a className="vf-btn vf-btn--primary" href={`financeiro.html?cliente=${encodeURIComponent(clienteSlug)}`}>
              Gerar no Financeiro (legado) →
            </a>
          </div>
        </div>
      ) : (
        <>
          <p className="vf-field__hint">
            Gerado em {formatarDataHora(dados.geradoEm)}
            {dados.publicadoEm ? ` · publicado em ${formatarDataHora(dados.publicadoEm)}` : ""}
          </p>
          <p className="vf-field__hint">
            <a href={`financeiro.html?cliente=${encodeURIComponent(clienteSlug)}`}>Abrir no Financeiro (legado) →</a>
          </p>
        </>
      )}
    </div>
  );
}
