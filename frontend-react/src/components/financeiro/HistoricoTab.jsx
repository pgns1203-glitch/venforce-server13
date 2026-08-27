// frontend-react/src/components/financeiro/HistoricoTab.jsx
// Mesma fonte de RelatoriosTab.jsx (entregasClienteService, sem filtro de
// período) — aqui como linha do tempo de status por período, não tabela de
// ação. O backend não devolve faturamento/resultado por período nesta
// lista (só status/geradoEm/publicado) — não é fabricado aqui.

import { rotularCompetencia } from "../../utils/dates.js";
import { BlocoIndisponivel } from "../visao/BlocoCard.jsx";

const STATUS_DOT = { publicado: "●", rascunho: "○" };
const STATUS_TOM = { publicado: "success", rascunho: "neutral" };

export function HistoricoTab({ relatorios }) {
  if (!relatorios.disponivel) {
    return <BlocoIndisponivel motivo={relatorios.motivo} />;
  }

  const lista = [...(relatorios.dados || [])].sort((a, b) => String(b.periodo).localeCompare(String(a.periodo)));
  if (!lista.length) {
    return (
      <div className="vf-empty">
        <p className="vf-empty__description">Nenhum período fechado ainda para comparar.</p>
      </div>
    );
  }

  return (
    <ul className="vf-fin-historico">
      {lista.map((r, i) => (
        <li key={`${r.periodo}-${i}`} className="vf-fin-historico__item">
          <span className={`vf-fin-historico__dot is-${STATUS_TOM[r.status] || "neutral"}`} aria-hidden="true">
            {STATUS_DOT[r.status] || "○"}
          </span>
          <span className="vf-fin-historico__periodo">{rotularCompetencia(r.periodo)}</span>
          <span className="vf-field__hint">{r.status === "publicado" ? "Publicado" : "Rascunho"}</span>
        </li>
      ))}
    </ul>
  );
}
