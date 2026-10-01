// server/tests/helpers/oportunidadesReferencia.js
// Referência JS da consulta paginada das Oportunidades
// (services/motorMargem/precificacao/precificacaoOportunidadesSql.js): mesma
// régua (montarCandidata/computeMargin), 1 linha por anúncio, mesma ordem e
// mesma página, no formato de linha que a consulta devolve. Os fakes usam
// isto no lugar do banco; scripts/promoSnapshotSqlCheck.js confere o SQL real
// contra esta referência.

const {
  montarCandidata,
  ordenarDeduplicarPaginar,
} = require("../../services/motorMargem/precificacao/precificacaoOportunidadesService");

/**
 * promos: [{ item_id, chave, preco_promo, retorno, ...colunas da fonte }]
 * snapPorItem: Map(item_id → linha de margin_projection_snapshots)
 * Devolve { rows } como o Postgres devolveria (linha-sentinela com
 * item_id null quando a página está vazia).
 */
function paginaReferencia({ promos, snapPorItem, vendasPorMlb = new Map(), page, limit }) {
  const ordenadas = [...promos].sort((a, b) => (String(a.chave) < String(b.chave) ? -1 : String(a.chave) > String(b.chave) ? 1 : 0));
  const candidatas = [];
  for (const p of ordenadas) {
    const snap = snapPorItem.get(String(p.item_id));
    if (!snap) continue;
    if (!(Number(p.preco_promo) > 0)) continue;
    if (snap.cost == null || snap.tax_rate == null || snap.commission_rate == null) continue;
    const c = montarCandidata({
      itemId: String(p.item_id), promocao: p, precoPromo: Number(p.preco_promo), retornoMl: Number(p.retorno) || 0,
      snap, titulo: p.fonte_titulo || null, vendasPorMlb,
    });
    if (c) candidatas.push({ ...c, _snap: snap });
  }
  const { total, pagina } = ordenarDeduplicarPaginar(candidatas, { page, limit });
  const rows = pagina.map((c) => ({
    ...c.promocao,
    snap_titulo: c._snap.titulo, image_url: c._snap.image_url, price: c._snap.price, cost: c._snap.cost,
    tax_rate: c._snap.tax_rate, fixed_fee: c._snap.fixed_fee, commission_rate: c._snap.commission_rate,
    freight: c._snap.freight, margin: c._snap.margin, unidades: c.unidades, margem_depois: c.margemDepois,
    total_oportunidades: total,
  }));
  return { rows: rows.length ? rows : [{ total_oportunidades: total, item_id: null }] };
}

/** Parâmetros finais da consulta (conta, ids, unidades, limit, offset) → objeto. */
function lerParametrosPagina(params, nFonte) {
  const [clienteContaId, ids, unidades, limit, offset] = params.slice(nFonte);
  const vendasPorMlb = new Map((ids || []).map((id, i) => [id, { unidades: unidades[i] }]));
  return { clienteContaId, vendasPorMlb, limit, page: Math.floor(offset / limit) + 1 };
}

module.exports = { paginaReferencia, lerParametrosPagina };
