// frontend-react/src/components/visao/AtividadeBloco.jsx
// Bloco 6 — Atividade recente. Fonte: centralVendasSyncRunService
// (execuções de sincronização desta operação). escopoConta=true.
//
// Só mostra o que o backend de fato dá: execuções de sync. Não inventa
// linha de "último fechamento"/"último diagnóstico" aqui — essas entradas
// não existem nesta fonte; os blocos Fechamento e Saúde já cobrem isso.

import { formatarDataHora } from "../../utils/dates.js";
import { runStatusInfo, COMPLETENESS_STATUS } from "../../utils/visaoLabels.js";

export function AtividadeBloco({ dados }) {
  const runs = (dados || []).slice(0, 5);

  if (!runs.length) {
    return (
      <div className="vf-empty">
        <p className="vf-empty__description">Nenhuma sincronização registrada ainda.</p>
      </div>
    );
  }

  return (
    <ul className="vf-stack vf-stack--sm" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {runs.map((run) => {
        const status = runStatusInfo(run.status);
        const quando = run.finishedAt || run.startedAt || run.createdAt;
        return (
          <li key={run.id} className="vf-cluster" style={{ justifyContent: "space-between", fontSize: 13 }}>
            <span className={`vf-tag is-${status.tom}`}>{status.label}</span>
            <span className="vf-field__hint">
              {run.dateFrom} — {run.dateTo}
              {run.completenessStatus && run.completenessStatus !== "unknown"
                ? ` · ${COMPLETENESS_STATUS[run.completenessStatus] || run.completenessStatus}`
                : ""}
            </span>
            <span className="vf-field__hint">{formatarDataHora(quando)}</span>
          </li>
        );
      })}
    </ul>
  );
}
