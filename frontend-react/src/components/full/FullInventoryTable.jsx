import { formatarNumero, ehAusente, AUSENTE } from "../../utils/numbers.js";

const STATUS_LABEL = {
  RUPTURA: "Ruptura",
  CRITICO: "Crítico",
  REPOR: "Repor",
  SAUDAVEL: "Saudável",
  ALTO: "Alto",
  EXCESSO: "Excesso",
  SEM_GIRO: "Sem giro",
  SEM_DADO: "Sem dado",
};

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
    <div className="full-table-scroll">
      <table className="full-table">
        <thead>
          <tr>
            <th scope="col">Produto / referências</th>
            <th scope="col">Status</th>
            <th scope="col">Estoque disp.</th>
            <th scope="col">Indisp.</th>
            <th scope="col">7d anterior</th>
            <th scope="col">7d atual</th>
            <th scope="col">Δ / variação</th>
            <th scope="col">Giro/dia</th>
            <th scope="col">Cobertura (dias)</th>
            <th scope="col">Enviar</th>
            <th scope="col">
              <span className="full-sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {inventories.map((inv) => {
            const principal = referenciaPrincipal(inv);
            const statusClasse = String(inv.operationalStatus || "sem-dado").toLowerCase().replace(/_/g, "-");
            return (
              <tr key={inv.inventoryId}>
                <td>
                  <div className="full-table-produto">
                    <strong>{principal.titulo}</strong>
                    <span className="full-table-refs">
                      {principal.mlb} · SKU {principal.sku}
                      {principal.extras > 0 ? ` · +${principal.extras} ref.` : ""}
                    </span>
                  </div>
                </td>
                <td>
                  <span className={`full-badge full-badge--${statusClasse}`}>
                    {STATUS_LABEL[inv.operationalStatus] || inv.operationalStatus || AUSENTE}
                  </span>
                </td>
                <td>{formatarNumero(inv.stock?.available)}</td>
                <td>{formatarNumero(inv.stock?.notAvailable)}</td>
                <td>{formatarNumero(inv.sales?.previous7d)}</td>
                <td>{formatarNumero(inv.sales?.current7d)}</td>
                <td>
                  {inv.trend ? (
                    <>
                      {formatarNumero(inv.trend.deltaUnits)} ({formatarVariacaoPontos(inv.trend.variationPct)})
                    </>
                  ) : (
                    AUSENTE
                  )}
                </td>
                <td>{formatarNumero(inv.dailyTurnover, 2)}</td>
                <td>{formatarNumero(inv.coverageDays, 1)}</td>
                <td>{formatarNumero(inv.sendQuantity)}</td>
                <td>
                  <button type="button" className="vf-btn vf-btn--ghost" onClick={() => onDetalhar(inv.inventoryId)}>
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
