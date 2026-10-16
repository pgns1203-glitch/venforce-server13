import { VFKpi } from "../ui/VFKpi/index.js";

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
      {LABELS.map(([chave, label, tom], i) => (
        <VFKpi key={chave} role="listitem" label={label} value={summary[chave] ?? 0} tone={tom} enterIndex={i} />
      ))}
    </div>
  );
}
