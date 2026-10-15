// server/services/promoSnapshot/promoSnapshotLegado.js
// Promo Snapshot — acesso de LEITURA ao diagnóstico da tela antiga "Promoções
// ML" (promocoes_diagnosticos / promocoes_diagnostico_itens). Só é usado
// quando a conta NÃO tem Promo Snapshot (fonte única: promoSnapshotFonte), e
// sempre rotulado "diagnóstico legado". Nada aqui chama o Mercado Livre.
//
// Tabelas ainda inexistentes (42P01) = sem legado, nunca erro.

// status vem do payload da linha (status || statusPromocao); vazio = aceito,
// como na tela antiga.
const STATUS_SQL = `LOWER(COALESCE(NULLIF(i.payload_raw->>'status', ''), i.payload_raw->>'statusPromocao', ''))`;
const STATUS_ACEITOS_SQL = `(${STATUS_SQL} = '' OR ${STATUS_SQL} IN ('candidate','started','active','pending'))`;

async function consultaOuVazio(db, sql, params) {
  if (!db || typeof db.query !== "function") return null;
  try {
    return (await db.query(sql, params)).rows;
  } catch (err) {
    if (err && err.code === "42P01") return null;
    throw err;
  }
}

/** Último diagnóstico concluído do seller → { id, createdAt, parcial, itensScaneados } | null. */
async function obterDiagnosticoLegado({ db, clienteId, sellerId }) {
  const rows = await consultaOuVazio(
    db,
    `SELECT id, created_at, parcial, itens_scaneados
       FROM promocoes_diagnosticos
      WHERE cliente_id = $1 AND seller_id = $2 AND status = 'concluido'
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [clienteId, sellerId]
  );
  if (!rows || !rows.length) return null;
  const r = rows[0];
  return { id: Number(r.id), createdAt: r.created_at, parcial: r.parcial === true, itensScaneados: Number(r.itens_scaneados) || 0 };
}

/**
 * Promoções do diagnóstico para UM anúncio, no formato de linha que a Bancada
 * consome. Sempre `estimativa: true`: o legado não tem preço final lido do ML,
 * vigência nem percentuais — só o preço promocional e o retorno da época.
 */
async function listarPromocoesLegadoDoItem({ db, diagnostico, itemId, limit = 60 }) {
  const rows = await consultaOuVazio(
    db,
    `SELECT i.id::text AS chave, i.item_id::text AS item_id, i.preco_promocao AS preco_promo, i.retorno_ml AS retorno,
            i.campanha AS nome, i.campanha_id AS promo_id, i.tipo_promocao AS tipo, NULLIF(${STATUS_SQL}, '') AS status
       FROM promocoes_diagnostico_itens i
      WHERE i.diagnostico_id = $1 AND i.item_id = $2
        AND i.preco_promocao IS NOT NULL AND i.preco_promocao > 0
        AND ${STATUS_ACEITOS_SQL}
      ORDER BY i.id
      LIMIT $3`,
    [diagnostico.id, itemId, limit]
  );
  return (rows || []).map((r) => {
    const retorno = r.retorno === null || r.retorno === undefined ? null : Number(r.retorno);
    return {
      itemId: r.item_id,
      promocaoChave: r.chave,
      promotionId: r.promo_id ? String(r.promo_id) : null,
      refId: null,
      tipo: r.tipo || null,
      nome: r.nome || null,
      status: r.status ? String(r.status).toLowerCase() : null,
      statusExibicao: null,
      inicio: null,
      fim: null,
      precoOriginal: null,
      precoFinal: Number(r.preco_promo),
      precoFinalFonte: "diagnostico_legado",
      descontoPercentual: null,
      sellerPercentage: null,
      meliPercentage: null,
      subsidioMl: Number.isFinite(retorno) ? retorno : null,
      elegivel: true,
      observedAt: diagnostico.createdAt,
      herdada: false,
      estimativa: true,
    };
  });
}

module.exports = { obterDiagnosticoLegado, listarPromocoesLegadoDoItem, STATUS_SQL, STATUS_ACEITOS_SQL };
