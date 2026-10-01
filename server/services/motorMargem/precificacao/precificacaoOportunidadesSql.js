// server/services/motorMargem/precificacao/precificacaoOportunidadesSql.js
// Oportunidades — filtro, 1 linha por anúncio, ordenação e PÁGINA no banco.
//
// Uma consulta só, para qualquer tamanho de catálogo: as promoções da fonte
// (Promo Snapshot ou diagnóstico legado) casadas com o Margin Snapshot da
// MESMA conta e com as unidades vendidas no período (passadas como dois
// arrays paralelos — nada de consulta por item). Só `limit` linhas voltam
// para o Node; `total` sai da mesma consulta.
//
// Espelha a régua de precificacaoOportunidadesService.montarCandidata (que
// usa core/marginEngine.computeMargin):
//   comissão  = ROUND(preço_promo × commission_rate, 2)
//   lucro     = preço − preço × imposto − comissão − frete − taxa_fixa − custo + retorno_ml
//   margem    = ROUND(lucro / preço, 6) > 0
//   exige preço > 0, custo, imposto e taxa de comissão (frete/taxa fixa
//   ausentes valem 0, como no Motor)
// Ordem: com retorno ML > mais unidades > maior margem > item_id; dentro do
// anúncio fica a promoção melhor pela mesma régua. A equivalência com a
// régua JS é verificada contra Postgres real em
// scripts/promoSnapshotSqlCheck.js.
//
// `fonteSql` é um SELECT que expõe ao menos: item_id, chave, preco_promo,
// retorno (demais colunas passam adiante como estão) e usa os parâmetros
// $1..$n de `paramsFonte`.

function sqlOportunidadesPaginadas({ fonteSql, paramsFonte = [], clienteContaId, vendasPorMlb, page, limit }) {
  const ids = [];
  const unidades = [];
  for (const [itemId, v] of vendasPorMlb || new Map()) {
    const n = Number(v && v.unidades);
    if (!itemId || !Number.isFinite(n) || n === 0) continue;
    ids.push(String(itemId));
    unidades.push(n);
  }
  const k = paramsFonte.length;
  const p = (i) => `$${k + i}`;
  const sql = `
    WITH promos AS (${fonteSql}),
    vendas AS (
      SELECT v.item_id, v.unidades FROM unnest(${p(2)}::text[], ${p(3)}::numeric[]) AS v(item_id, unidades)
    ),
    calc AS (
      SELECT pr.*, s.titulo AS snap_titulo, s.image_url, s.price, s.cost, s.tax_rate, s.fixed_fee,
             s.commission_rate, s.freight, s.margin, COALESCE(v.unidades, 0) AS unidades,
             (pr.preco_promo - pr.preco_promo * s.tax_rate - ROUND(pr.preco_promo * s.commission_rate, 2)
               - COALESCE(s.freight, 0) - COALESCE(s.fixed_fee, 0) - s.cost + COALESCE(pr.retorno, 0)) AS lucro
        FROM promos pr
        JOIN margin_projection_snapshots s
          ON s.cliente_conta_id = ${p(1)} AND s.marketplace = 'meli'
         AND s.item_id = pr.item_id AND s.catalog_missing_since IS NULL
        LEFT JOIN vendas v ON v.item_id = pr.item_id
       WHERE pr.preco_promo > 0 AND s.cost IS NOT NULL AND s.tax_rate IS NOT NULL AND s.commission_rate IS NOT NULL
    ),
    melhor AS (
      SELECT DISTINCT ON (c.item_id) c.*, ROUND(c.lucro / c.preco_promo, 6) AS margem_depois,
             (COALESCE(c.retorno, 0) <> 0) AS com_retorno
        FROM calc c
       WHERE ROUND(c.lucro / c.preco_promo, 6) > 0
       ORDER BY c.item_id, (COALESCE(c.retorno, 0) <> 0) DESC, ROUND(c.lucro / c.preco_promo, 6) DESC, c.chave ASC
    ),
    total AS (SELECT COUNT(*)::int AS total FROM melhor)
    SELECT t.total AS total_oportunidades, pg.*
      FROM total t
      LEFT JOIN LATERAL (
        SELECT * FROM melhor
         ORDER BY com_retorno DESC, unidades DESC, margem_depois DESC, item_id ASC
         LIMIT ${p(4)} OFFSET ${p(5)}
      ) pg ON true`;
  return {
    sql,
    params: [...paramsFonte, clienteContaId, ids, unidades, limit, (page - 1) * limit],
  };
}

/** { total, rows } — rows sem a linha-sentinela de página vazia. */
function lerPagina(result) {
  const rows = (result && result.rows) || [];
  const total = rows.length ? Number(rows[0].total_oportunidades || 0) : 0;
  return { total, rows: rows.filter((r) => r.item_id !== null && r.item_id !== undefined) };
}

module.exports = { sqlOportunidadesPaginadas, lerPagina };
