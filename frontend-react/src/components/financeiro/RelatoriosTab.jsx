// frontend-react/src/components/financeiro/RelatoriosTab.jsx
// Relatórios gerados — mesma fonte de entregasClienteService que o
// Histórico (não há dois payloads diferentes no backend hoje; ver
// financeiroVisaoService.js `relatorios`). Aqui: tabela de ações
// (abrir/copiar link público). Histórico (HistoricoTab.jsx): comparação
// compacta por período.

import { useState } from "react";
import { formatarDataHora } from "../../utils/dates.js";
import { rotularCompetencia } from "../../utils/dates.js";
import { BlocoIndisponivel } from "../visao/BlocoCard.jsx";

function linkPublico(token) {
  return `${window.location.origin}/relatorio-publico.html?token=${encodeURIComponent(token)}`;
}

export function RelatoriosTab({ relatorios }) {
  const [copiadoIdx, setCopiadoIdx] = useState(null);

  if (!relatorios.disponivel) {
    return <BlocoIndisponivel motivo={relatorios.motivo} />;
  }

  const lista = relatorios.dados || [];
  if (!lista.length) {
    return (
      <div className="vf-empty">
        <p className="vf-empty__description">Nenhum relatório gerado para este cliente ainda.</p>
      </div>
    );
  }

  async function copiar(token, idx) {
    try {
      await navigator.clipboard.writeText(linkPublico(token));
      setCopiadoIdx(idx);
      setTimeout(() => setCopiadoIdx((atual) => (atual === idx ? null : atual)), 1600);
    } catch {
      /* clipboard indisponível (ex.: contexto não seguro) — sem ação, sem quebrar a tela */
    }
  }

  return (
    <div className="vf-table-wrap">
      <table className="vf-table vf-table--compact">
        <thead>
          <tr>
            <th>Período</th>
            <th>Status</th>
            <th>Gerado em</th>
            <th>Publicado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {lista.map((r, i) => (
            <tr key={`${r.periodo}-${i}`}>
              <td>{rotularCompetencia(r.periodo)}</td>
              <td>{r.status === "publicado" ? "Publicado" : "Rascunho"}</td>
              <td>{formatarDataHora(r.geradoEm)}</td>
              <td>{r.publicado ? "Sim" : "Não"}</td>
              <td className="vf-table__actions">
                {r.publicado && r.token ? (
                  <>
                    <a className="vf-btn vf-btn--ghost vf-btn--sm" href={linkPublico(r.token)} target="_blank" rel="noreferrer">
                      Abrir
                    </a>
                    <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => copiar(r.token, i)}>
                      {copiadoIdx === i ? "Copiado!" : "Copiar link"}
                    </button>
                  </>
                ) : (
                  <span className="vf-field__hint">Não publicado</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
