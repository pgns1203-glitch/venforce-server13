// frontend-react/src/components/financeiro/HistoricoTab.jsx
//
// Linha do tempo de status por período — a mesma fonte de RelatoriosTab,
// vista como sequência e não como tabela de ação. Nenhuma escrita aqui de
// propósito: publicar tem UM lugar (Relatórios gerados / Fechamento) para
// que não existam dois caminhos com tratamento de erro diferente — foi
// exatamente isso que o Financeiro legado fez (o botão "Salvar" e o "Gerar
// link" gravam a mesma entidade com fallbacks distintos).
//
// O backend não devolve faturamento/resultado por período nesta lista (só
// status/datas) — e isso não é preenchido com zero aqui.

import { formatarDataHora, rotularCompetencia } from "../../utils/dates.js";
import { BlocoIndisponivel, BlocoSkeleton } from "../visao/BlocoCard.jsx";

const STATUS_DOT = { publicado: "●", rascunho: "○" };
const STATUS_TOM = { publicado: "success", rascunho: "neutral" };

// A lista operacional é mais rica (traz `published_at`); a de leitura é a
// que sempre existe. Uma normalização, dois formatos.
function normalizar(entregas, leitura) {
  if (Array.isArray(entregas)) {
    return entregas.map((e) => ({
      periodo: e.periodo,
      status: e.publicado ? "publicado" : "rascunho",
      geradoEm: e.created_at,
      publicadoEm: e.publicado ? e.published_at : null,
    }));
  }
  return (leitura || []).map((r) => ({
    periodo: r.periodo,
    status: r.status,
    geradoEm: r.geradoEm,
    publicadoEm: null, // o payload de leitura não tem esse campo — não é inventado
  }));
}

export function HistoricoTab({ relatorios, entregas, periodo }) {
  if (!relatorios.disponivel) return <BlocoIndisponivel motivo={relatorios.motivo} />;
  if (entregas.carregando && !entregas.entregas) return <BlocoSkeleton linhas={4} />;

  const lista = normalizar(entregas.erro ? null : entregas.entregas, relatorios.dados).sort((a, b) =>
    String(b.periodo).localeCompare(String(a.periodo))
  );

  if (!lista.length) {
    return (
      <div className="vf-empty">
        <p className="vf-empty__description">Nenhum período fechado ainda para comparar.</p>
      </div>
    );
  }

  return (
    <ul className="vf-fin-historico">
      {lista.map((r, i) => {
        const doPeriodoEmTela = String(r.periodo || "").includes(periodo);
        return (
          <li key={`${r.periodo}-${i}`} className={`vf-fin-historico__item${doPeriodoEmTela ? " is-destacada" : ""}`}>
            <span className={`vf-fin-historico__dot is-${STATUS_TOM[r.status] || "neutral"}`} aria-hidden="true">
              {STATUS_DOT[r.status] || "○"}
            </span>
            <span className="vf-fin-historico__periodo">{rotularCompetencia(r.periodo)}</span>
            <span className="vf-field__hint">
              {r.status === "publicado" ? "Publicado" : "Rascunho"}
              {r.publicadoEm ? ` · ${formatarDataHora(r.publicadoEm)}` : ""}
            </span>
            {doPeriodoEmTela && <span className="vf-tag">período em tela</span>}
          </li>
        );
      })}
    </ul>
  );
}
