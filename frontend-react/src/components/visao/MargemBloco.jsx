// frontend-react/src/components/visao/MargemBloco.jsx
// Bloco 3 — Margem (Motor de Margem). Só Mercado Livre; escopoConta=false
// (o motor ainda resolve base por cliente, não por conta — ver
// visaoService.js). Foco em qualidade de item, não em total financeiro
// (isso é o bloco Resultado).

import { formatarPercentual } from "../../utils/percentage.js";
import { formatarNumero } from "../../utils/numbers.js";

export function MargemBloco({ dados }) {
  const placar = dados.placar || {};
  const cobertura = dados.cobertura || {};
  const excecoes = dados.excecoes || [];

  return (
    <div className="vf-stack">
      <div className="vf-kpi-grid">
        <div className="vf-kpi vf-kpi--featured">
          <span className="vf-kpi__label">Margem média</span>
          <span className="vf-kpi__value">{formatarPercentual((placar.margemMediaPercent ?? null) / 100)}</span>
        </div>
        <div className="vf-kpi">
          <span className="vf-kpi__label">Itens com margem</span>
          <span className="vf-kpi__value">{formatarNumero(placar.itensComMargem)}</span>
        </div>
        <div className={placar.itensSemMargem > 0 ? "vf-kpi vf-kpi--warning" : "vf-kpi"}>
          <span className="vf-kpi__label">Itens sem margem</span>
          <span className="vf-kpi__value">{formatarNumero(placar.itensSemMargem)}</span>
        </div>
      </div>

      {cobertura.parcial && (
        <p className="vf-field__hint">
          Cobertura parcial: {formatarNumero(cobertura.itensAnalisados)} de {formatarNumero(cobertura.totalItensMl)} itens analisados.
          {cobertura.motivoParcial ? ` ${cobertura.motivoParcial}` : ""}
        </p>
      )}

      {excecoes.length > 0 && (
        <p className="vf-field__hint">{formatarNumero(excecoes.length)} item(ns) com divergência precisam de revisão.</p>
      )}
    </div>
  );
}
