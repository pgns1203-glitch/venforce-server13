// Célula de produto das listas da Central do Full, no padrão da lista de
// Anúncios ML (.am-row__thumb / título display / ids embaixo): miniatura,
// título numa linha e MLB · SKU · variações · avisos fluindo lado a lado.
import { STATUS_LABEL, STATUS_TONE } from "../../utils/fullOperationalStatus.js";

export function FullThumb({ inv }) {
  const ref = inv.references?.[0];
  return (
    <span className="full-thumb" aria-hidden="true">
      {inv.thumbnail ? <img src={inv.thumbnail} alt="" loading="lazy" /> : null}
      {!inv.thumbnail && ref?.title ? ref.title.trim().charAt(0).toUpperCase() : null}
    </span>
  );
}

export function FullProdutoInfo({ inv }) {
  const referencias = Array.isArray(inv.references) ? inv.references : [];
  const principal = referencias[0] || {};
  const extras = referencias.length - 1;
  const semCusto = typeof inv.stock?.total === "number" && inv.stock.total > 0 && inv.unitCost === null;

  return (
    <div className="full-produto">
      <p className="full-produto__titulo" title={principal.title || inv.inventoryId}>
        {principal.title || inv.inventoryId}
      </p>
      <div className="full-produto__ids">
        <span className="vf-mono">{principal.mlb || inv.inventoryId}</span>
        {principal.sellerSku ? <span>SKU {principal.sellerSku}</span> : <span className="full-produto__sem-sku">sem SKU</span>}
        {principal.variationId ? <span>variação {principal.variationId}</span> : null}
        {extras > 0 ? <span className="vf-tag">+{extras} ref.</span> : null}
        {inv.listingStatus && inv.listingStatus !== "active" ? <span className="vf-tag is-neutral">{rotuloAnuncio(inv.listingStatus)}</span> : null}
        {semCusto ? <span className="vf-tag is-warning">sem custo</span> : null}
      </div>
    </div>
  );
}

function rotuloAnuncio(status) {
  if (status === "paused") return "pausado";
  if (status === "closed") return "finalizado";
  if (status === "under_review") return "em revisão";
  return status;
}

export function FullStatus({ inv }) {
  const tom = STATUS_TONE[inv.operationalStatus];
  return (
    <span className={`vf-status${tom ? ` ${tom}` : ""}`}>
      {STATUS_LABEL[inv.operationalStatus] || inv.operationalStatus || "—"}
    </span>
  );
}
