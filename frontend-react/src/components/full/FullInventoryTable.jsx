import { formatarNumero, ehAusente, AUSENTE } from "../../utils/numbers.js";
import { STATUS_LABEL, STATUS_TONE } from "../../utils/fullOperationalStatus.js";

// `variationPct` do backend já é ponto percentual pronto (80 = 80%), ao
// contrário de utils/percentage.js (que espera fração 0-1 vinda do motor de
// margem). Formatador local para não confundir os dois contratos.
function formatarVariacaoPontos(pct) {
  if (ehAusente(pct)) return AUSENTE;
  const sinal = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sinal}${formatarNumero(Math.abs(pct), 1)}%`;
}

function referenciaPrincipal(inv) {
  const referencias = Array.isArray(inv.references) ? inv.references : [];
  const principal = referencias[0] || {};
  return {
    titulo: principal.title || inv.inventoryId,
    mlb: principal.mlb || AUSENTE,
    sku: principal.sellerSku || AUSENTE,
    extras: Math.max(0, referencias.length - 1),
  };
}

export default function FullInventoryTable({ inventories, onDetalhar }) {
  if (!inventories.length) {
    return <p className="full-table-vazio">Nenhum inventário encontrado com os filtros atuais.</p>;
  }

  return (
    <div className="vf-table-wrap">
      <table className="vf-table">
        <thead>
          <tr>
            <th scope="col">Produto / referências</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">Estoque disp.</th>
            <th scope="col" className="num">Indisp.</th>
            <th scope="col" className="num">7d anterior</th>
            <th scope="col" className="num">7d atual</th>
            <th scope="col" className="num">Δ / variação</th>
            <th scope="col" className="num">Giro/dia</th>
            <th scope="col" className="num">Cobertura (dias)</th>
            <th scope="col" className="num">Enviar</th>
            <th scope="col">
              <span className="vf-visually-hidden">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {inventories.map((inv) => {
            const principal = referenciaPrincipal(inv);
            const statusTom = STATUS_TONE[inv.operationalStatus] || "";
            return (
              <tr key={inv.inventoryId}>
                <td>
                  <div className="full-table-produto">
                    <strong>{principal.titulo}</strong>
                    <span className="full-table-refs">
                      <span className="vf-mono">{principal.mlb}</span> · SKU{" "}
                      <span className="vf-mono">{principal.sku}</span>
                      {principal.extras > 0 ? ` · +${principal.extras} ref.` : ""}
                    </span>
                  </div>
                </td>
                <td>
                  <span className={`vf-status${statusTom ? ` ${statusTom}` : ""}`}>
                    {STATUS_LABEL[inv.operationalStatus] || inv.operationalStatus || AUSENTE}
                  </span>
                </td>
                <td className="num">{formatarNumero(inv.stock?.available)}</td>
                <td className="num">{formatarNumero(inv.stock?.notAvailable)}</td>
                <td className="num">{formatarNumero(inv.sales?.previous7d)}</td>
                <td className="num">{formatarNumero(inv.sales?.current7d)}</td>
                <td className="num">
                  {inv.trend ? (
                    <>
                      {formatarNumero(inv.trend.deltaUnits)} ({formatarVariacaoPontos(inv.trend.variationPct)})
                    </>
                  ) : (
                    AUSENTE
                  )}
                </td>
                <td className="num">{formatarNumero(inv.dailyTurnover, 2)}</td>
                <td className="num">{formatarNumero(inv.coverageDays, 1)}</td>
                <td className="num">{formatarNumero(inv.sendQuantity)}</td>
                <td>
                  <button
                    type="button"
                    className="vf-btn vf-btn--ghost vf-btn--sm"
                    onClick={() => onDetalhar(inv.inventoryId)}
                  >
                    Detalhar
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
