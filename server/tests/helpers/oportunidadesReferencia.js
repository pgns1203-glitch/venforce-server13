// server/tests/helpers/oportunidadesReferencia.js
// Referência JS da consulta de ELEGÍVEIS das Oportunidades
// (services/motorMargem/precificacao/precificacaoOportunidadesSql.js): o banco
// só seleciona — promoção × Margin Snapshot da conta, sem promoção em
// andamento (started/active), com P' < preço atual — e nenhuma conta
// financeira. Os fakes usam isto no lugar do banco; scripts/promoSnapshotSqlCheck.js
// confere o SQL real contra esta referência.
//
// O cálculo (LC', ΔLC, veredito), a ordem e a página são do serviço
// (core.calcularCenario), não daqui.

/**
 * promos: [{ item_id, chave, preco_promo, retorno, promo_status, ...colunas da fonte }]
 * snapPorItem: Map(item_id → linha de margin_projection_snapshots)
 * anuncioPorItem: Map(item_id → { logistic_type }) — meli_anuncios do cliente
 * Devolve { rows } como o Postgres devolveria (mesma ordem: item_id, chave).
 */
function elegiveisReferencia({ promos, snapPorItem, anuncioPorItem = new Map() }) {
  const porChave = (a, b) => (String(a.item_id) < String(b.item_id) ? -1 : String(a.item_id) > String(b.item_id) ? 1
    : String(a.chave) < String(b.chave) ? -1 : String(a.chave) > String(b.chave) ? 1 : 0);
  const rows = [];
  for (const p of [...promos].sort(porChave)) {
    const snap = snapPorItem.get(String(p.item_id));
    if (!snap) continue;
    if (!(Number(p.preco_promo) > 0)) continue;
    if (["started", "active"].includes(String(p.promo_status || "").toLowerCase())) continue;
    if (snap.price == null || !(Number(p.preco_promo) < Number(snap.price))) continue;
    const anuncio = anuncioPorItem.get(String(p.item_id)) || null;
    const meta = snap.quality_json && snap.quality_json.targetMargin;
    rows.push({
      ...p,
      snap_titulo: snap.titulo, image_url: snap.image_url, price: snap.price, cost: snap.cost,
      tax_rate: snap.tax_rate, fixed_fee: snap.fixed_fee, commission_rate: snap.commission_rate,
      freight: snap.freight, margin: snap.margin, snap_commission: snap.commission, snap_profit: snap.profit,
      snap_target_margin: meta === undefined || meta === null ? null : String(meta),
      snap_calculated_at: snap.calculated_at || null,
      anuncio_logistic_type: anuncio ? anuncio.logistic_type ?? null : null,
    });
  }
  return { rows };
}

module.exports = { elegiveisReferencia };
