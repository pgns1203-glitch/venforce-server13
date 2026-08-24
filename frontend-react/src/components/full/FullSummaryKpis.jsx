import { formatarNumero } from "../../utils/numbers.js";

// Terceira coluna = tom do card, espelhando o mesmo agrupamento de
// severidade usado no badge de status da tabela (ver STATUS_TONE em
// FullInventoryTable.jsx): ruptura/crítico pedem ação imediata (danger),
// repor/alto/excesso/sem giro pedem atenção (warning), saudável confirma
// que está tudo bem (success). Nenhum card fica sem tom.
const LABELS = [
  ["total", "Inventários", null],
  ["disponivel", "Disp.", null],
  ["indisponivel", "Indisp.", null],
  ["ruptura", "Ruptura", "danger"],
  ["critico", "Crítico", "danger"],
  ["repor", "Repor", "warning"],
  ["saudavel", "Saudável", "success"],
  ["alto", "Alto", "warning"],
  ["excesso", "Excesso", "warning"],
  ["semGiro", "Sem giro", "warning"],
  ["semDado", "Sem dado", null],
];

export default function FullSummaryKpis({ summary }) {
  if (!summary) return null;

  return (
    <div className="vf-kpi-grid" role="list" aria-label="Resumo dos inventários Full">
      {LABELS.map(([chave, label, tom]) => (
        <div className={`vf-kpi${tom ? ` vf-kpi--${tom}` : ""}`} role="listitem" key={chave}>
          <span className="vf-kpi__label">{label}</span>
          <span className="vf-kpi__value">{formatarNumero(summary[chave] ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}
