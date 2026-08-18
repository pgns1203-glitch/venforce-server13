import { formatarNumero } from "../../utils/numbers.js";

const LABELS = [
  ["total", "Inventários"],
  ["disponivel", "Disp."],
  ["indisponivel", "Indisp."],
  ["ruptura", "Ruptura"],
  ["repor", "Repor"],
  ["saudavel", "Saudável"],
  ["excesso", "Excesso"],
  ["semDado", "Sem dado"],
];

export default function FullSummaryKpis({ summary }) {
  if (!summary) return null;

  return (
    <div className="full-kpis" role="list" aria-label="Resumo dos inventários Full">
      {LABELS.map(([chave, label]) => (
        <div className="full-kpi" role="listitem" key={chave}>
          <span className="full-kpi-valor">{formatarNumero(summary[chave] ?? 0)}</span>
          <span className="full-kpi-label">{label}</span>
        </div>
      ))}
    </div>
  );
}
