// frontend-react/src/components/financeiro/fechamento/CompetenciaFechamento.jsx
//
// Competência do fechamento — o mês que esta tela fecha, sempre por extenso
// ("Outubro/2026"), com o estado DESTA conta ao lado. Internamente o valor
// continua `AAAA-MM`.
//
// Trocar de mês com trabalho em andamento (arquivos escolhidos, resultado
// processado, apresentação não salva) NÃO acontece em silêncio: a troca fica
// pendente numa confirmação inline que nomeia os dois meses. Nunca
// `window.confirm` — o diálogo do navegador congela a página e não diz de
// qual competência se trata.

import { VFMonthYearSelector } from "../../ui/VFMonthYearSelector/index.js";
import { rotularCompetencia } from "../../../utils/dates.js";

export function CompetenciaFechamento({ periodo, status, trocaPendente, onPedirTroca, onConfirmarTroca, onCancelarTroca }) {
  const atual = rotularCompetencia(periodo);
  return (
    <div className="vf-fin-competencia">
      <div className="vf-fin-competencia__linha">
        <div className="vf-fin-competencia__texto">
          <span className="vf-fin-competencia__rotulo">Competência do fechamento</span>
          <strong className="vf-fin-competencia__valor" data-testid="competencia-extenso">{atual}</strong>
        </div>
        <VFMonthYearSelector value={periodo} onChange={onPedirTroca} />
        {status && (
          <span className={`vf-tag is-${status.tom}`} data-testid="status-competencia">
            {status.label}
          </span>
        )}
      </div>
      {status?.legado && (
        <p className="vf-field__hint">
          Existe um fechamento legado desta competência sem operação registrada — ele é do cliente, não desta conta.
          Veja em Relatórios gerados.
        </p>
      )}
      {trocaPendente && (
        <div className="vf-banner is-warning vf-banner--compact" role="alertdialog" aria-label="Confirmar troca de competência">
          <div className="vf-banner__content">
            <p className="vf-banner__description">
              Trocar para <strong>{rotularCompetencia(trocaPendente)}</strong> irá limpar o processamento atual de{" "}
              <strong>{atual}</strong> (arquivos, resultado e edições não salvas). Continuar?
            </p>
            <div className="vf-cluster">
              <button type="button" className="vf-btn vf-btn--danger vf-btn--sm" onClick={onConfirmarTroca}>
                Trocar e limpar
              </button>
              <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={onCancelarTroca}>
                Manter {atual}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
