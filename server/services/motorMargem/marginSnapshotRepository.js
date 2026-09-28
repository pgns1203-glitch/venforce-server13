// server/services/motorMargem/marginSnapshotRepository.js
// Margin Snapshot — repository de margin_projection_snapshots (M1 da
// fundação, ver docs/AUDITORIA_WORKERS_E_PLANO_MARGIN_SNAPSHOT.md).
//
// Só persistência: nenhuma chamada ao Mercado Livre, nenhuma regra do Motor
// (marginEngine/marginItem), nenhuma rota HTTP. O worker que vai preencher
// esta tabela é trabalho de M2/M3 (fora desta rodada).

const fs = require("fs");
const path = require("path");
const pool = require("../../config/database");

const schemaPath = path.join(__dirname, "..", "..", "sql", "margin_snapshot_schema.sql");

async function ensureMarginSnapshotTables(db = pool) {
  const sql = fs.readFileSync(schemaPath, "utf8");
  await db.query(sql);
}

// null = ausente, 0 = zero real (§16 do prompt de M1) — nunca `valor || 0`.
// Só normaliza undefined -> null; um 0/false explícito passa intocado.
function ausenteParaNull(valor) {
  return valor === undefined ? null : valor;
}

function asJsonb(valor, fallback) {
  return JSON.stringify(valor === undefined ? fallback : valor);
}

function sanitizeSnapshot(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    clienteId: Number(row.cliente_id),
    clienteContaId: Number(row.cliente_conta_id),
    marketplace: row.marketplace,
    itemId: row.item_id,
    sku: row.sku,
    titulo: row.titulo,
    baseId: row.base_id != null ? Number(row.base_id) : null,

    price: row.price != null ? Number(row.price) : null,
    listPrice: row.list_price != null ? Number(row.list_price) : null,
    promoPrice: row.promo_price != null ? Number(row.promo_price) : null,
    cost: row.cost != null ? Number(row.cost) : null,
    taxRate: row.tax_rate != null ? Number(row.tax_rate) : null,
    fixedFee: row.fixed_fee != null ? Number(row.fixed_fee) : null,
    commission: row.commission != null ? Number(row.commission) : null,
    commissionRate: row.commission_rate != null ? Number(row.commission_rate) : null,
    freight: row.freight != null ? Number(row.freight) : null,

    profit: row.profit != null ? Number(row.profit) : null,
    margin: row.margin != null ? Number(row.margin) : null,
    marginPercent: row.margin_percent != null ? Number(row.margin_percent) : null,
    status: row.status,

    confidenceLevel: row.confidence_level || null,
    quality: row.quality_json || {},
    missing: row.missing_json || [],
    assumed: row.assumed_json || [],
    divergences: row.divergences_json || [],

    observedAt: row.observed_at,
    calculatedAt: row.calculated_at,
    sourceUpdatedAt: row.source_updated_at,

    runId: row.run_id != null ? Number(row.run_id) : null,
    refreshStatus: row.refresh_status,
    lastError: row.last_error || null,

    imageUrl: row.image_url || null,
    catalogMissingSince: row.catalog_missing_since || null,

    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Escrita — UPSERT idempotente obrigatório (§11 do prompt de M1). A mesma
// conta+MLB processada N vezes atualiza sempre a MESMA linha (chave
// uq_margin_projection_snapshots_item), nunca cria duplicata.
// ---------------------------------------------------------------------------

async function upsertProjectionSnapshot(dados, db = pool) {
  const {
    clienteId, clienteContaId, marketplace = "meli", itemId, sku, titulo, baseId,
    price, listPrice, promoPrice, cost, taxRate, fixedFee, commission, commissionRate, freight,
    profit, margin, marginPercent, status,
    confidenceLevel, quality, missing, assumed, divergences,
    observedAt, calculatedAt, sourceUpdatedAt,
    runId, refreshStatus = "fresh", lastError,
    imageUrl,
  } = dados;

  if (!clienteId) throw new Error("upsertProjectionSnapshot: clienteId é obrigatório.");
  if (!clienteContaId) throw new Error("upsertProjectionSnapshot: clienteContaId é obrigatório.");
  if (!itemId) throw new Error("upsertProjectionSnapshot: itemId é obrigatório.");
  if (!status) throw new Error("upsertProjectionSnapshot: status é obrigatório.");

  const result = await db.query(
    `INSERT INTO margin_projection_snapshots (
       cliente_id, cliente_conta_id, marketplace, item_id, sku, titulo, base_id,
       price, list_price, promo_price, cost, tax_rate, fixed_fee, commission, commission_rate, freight,
       profit, margin, margin_percent, status,
       confidence_level, quality_json, missing_json, assumed_json, divergences_json,
       observed_at, calculated_at, source_updated_at,
       run_id, refresh_status, last_error,
       image_url, catalog_missing_since
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,
       $8,$9,$10,$11,$12,$13,$14,$15,$16,
       $17,$18,$19,$20,
       $21,$22::jsonb,$23::jsonb,$24::jsonb,$25::jsonb,
       $26,COALESCE($27, NOW()),$28,
       $29,$30,$31,
       $32,NULL
     )
     ON CONFLICT (cliente_id, cliente_conta_id, marketplace, item_id) DO UPDATE SET
       sku = EXCLUDED.sku,
       titulo = EXCLUDED.titulo,
       base_id = EXCLUDED.base_id,
       price = EXCLUDED.price,
       list_price = EXCLUDED.list_price,
       promo_price = EXCLUDED.promo_price,
       cost = EXCLUDED.cost,
       tax_rate = EXCLUDED.tax_rate,
       fixed_fee = EXCLUDED.fixed_fee,
       commission = EXCLUDED.commission,
       commission_rate = EXCLUDED.commission_rate,
       freight = EXCLUDED.freight,
       profit = EXCLUDED.profit,
       margin = EXCLUDED.margin,
       margin_percent = EXCLUDED.margin_percent,
       status = EXCLUDED.status,
       confidence_level = EXCLUDED.confidence_level,
       quality_json = EXCLUDED.quality_json,
       missing_json = EXCLUDED.missing_json,
       assumed_json = EXCLUDED.assumed_json,
       divergences_json = EXCLUDED.divergences_json,
       observed_at = EXCLUDED.observed_at,
       calculated_at = EXCLUDED.calculated_at,
       source_updated_at = EXCLUDED.source_updated_at,
       run_id = EXCLUDED.run_id,
       refresh_status = EXCLUDED.refresh_status,
       last_error = EXCLUDED.last_error,
       image_url = EXCLUDED.image_url,
       catalog_missing_since = NULL,
       updated_at = NOW()
     RETURNING *`,
    [
      clienteId, clienteContaId, marketplace, itemId, ausenteParaNull(sku), ausenteParaNull(titulo), ausenteParaNull(baseId),
      ausenteParaNull(price), ausenteParaNull(listPrice), ausenteParaNull(promoPrice), ausenteParaNull(cost),
      ausenteParaNull(taxRate), ausenteParaNull(fixedFee), ausenteParaNull(commission), ausenteParaNull(commissionRate),
      ausenteParaNull(freight),
      ausenteParaNull(profit), ausenteParaNull(margin), ausenteParaNull(marginPercent), status,
      ausenteParaNull(confidenceLevel), asJsonb(quality, {}), asJsonb(missing, []), asJsonb(assumed, []), asJsonb(divergences, []),
      ausenteParaNull(observedAt), ausenteParaNull(calculatedAt), ausenteParaNull(sourceUpdatedAt),
      ausenteParaNull(runId), refreshStatus, ausenteParaNull(lastError),
      ausenteParaNull(imageUrl),
    ]
  );
  return sanitizeSnapshot(result.rows[0]);
}

// ---------------------------------------------------------------------------
// Falha parcial (M3, §9.4 do plano) — o item NÃO pôde ser recalculado neste
// run. Só marca as linhas que JÁ existem: valores financeiros anteriores
// ficam intactos (nunca zerados/apagados), só refresh_status/last_error/
// run_id mudam. Item que nunca teve snapshot continua sem linha — nenhuma
// linha financeira falsa é criada para ele.
// ---------------------------------------------------------------------------

async function markSnapshotsRefreshFailed({
  clienteId, clienteContaId, marketplace = "meli", itemIds, runId = null, lastError = null, db = pool,
}) {
  if (!clienteId) throw new Error("markSnapshotsRefreshFailed: clienteId é obrigatório.");
  if (!clienteContaId) throw new Error("markSnapshotsRefreshFailed: clienteContaId é obrigatório.");
  const ids = (Array.isArray(itemIds) ? itemIds : []).map((id) => String(id)).filter(Boolean);
  if (!ids.length) return [];

  const result = await db.query(
    `UPDATE margin_projection_snapshots
        SET refresh_status = 'failed', last_error = $5, run_id = $6, updated_at = NOW()
      WHERE cliente_id = $1 AND cliente_conta_id = $2 AND marketplace = $3
        AND item_id = ANY($4::text[])
      RETURNING item_id`,
    [clienteId, clienteContaId, marketplace, ids, lastError ? String(lastError).slice(0, 2000) : null, runId]
  );
  return result.rows.map((row) => row.item_id);
}

// Itens da conta que NÃO estavam na listagem completa do catálogo deste run
// (encerrados/excluídos no ML). Não apaga: marca `catalog_missing_since` e
// `refresh_status='stale'` — a leitura padrão da Central filtra essas linhas.
// Só deve ser chamado depois de uma listagem de catálogo BEM-SUCEDIDA
// (listagem que falhou nunca pode "sumir" com itens).
async function markSnapshotsOutsideCatalog({
  clienteId, clienteContaId, marketplace = "meli", catalogItemIds, runId = null, db = pool,
}) {
  if (!clienteId) throw new Error("markSnapshotsOutsideCatalog: clienteId é obrigatório.");
  if (!clienteContaId) throw new Error("markSnapshotsOutsideCatalog: clienteContaId é obrigatório.");
  if (!Array.isArray(catalogItemIds)) throw new Error("markSnapshotsOutsideCatalog: catalogItemIds é obrigatório.");

  const result = await db.query(
    `UPDATE margin_projection_snapshots
        SET catalog_missing_since = NOW(), refresh_status = 'stale',
            last_error = 'Item fora do catálogo (ativos + pausados) na última listagem completa.',
            run_id = $5, updated_at = NOW()
      WHERE cliente_id = $1 AND cliente_conta_id = $2 AND marketplace = $3
        AND catalog_missing_since IS NULL
        AND NOT (item_id = ANY($4::text[]))
      RETURNING item_id`,
    [clienteId, clienteContaId, marketplace, catalogItemIds.map((id) => String(id)), runId]
  );
  return result.rows.map((row) => row.item_id);
}

// ---------------------------------------------------------------------------
// Leitura — sempre escopada por conta (P0, ver §12 do prompt de M1: conta 6
// NUNCA pode ler snapshot da conta 5).
// ---------------------------------------------------------------------------

async function getProjectionSnapshot({ clienteContaId, marketplace = "meli", itemId, db = pool }) {
  if (!clienteContaId) throw new Error("getProjectionSnapshot: clienteContaId é obrigatório.");
  if (!itemId) throw new Error("getProjectionSnapshot: itemId é obrigatório.");

  const result = await db.query(
    `SELECT * FROM margin_projection_snapshots
      WHERE cliente_conta_id = $1 AND marketplace = $2 AND item_id = $3
      LIMIT 1`,
    [clienteContaId, marketplace, itemId]
  );
  return result.rows[0] ? sanitizeSnapshot(result.rows[0]) : null;
}

const COLUNAS_ORDENACAO = new Set(["margin_percent", "profit", "status", "updated_at", "titulo"]);

async function listProjectionSnapshots({
  clienteContaId, marketplace = "meli", status = null, page = 1, limit = 50,
  ordenacao = "updated_at", direcao = "DESC", db = pool,
}) {
  if (!clienteContaId) throw new Error("listProjectionSnapshots: clienteContaId é obrigatório.");

  const coluna = COLUNAS_ORDENACAO.has(ordenacao) ? ordenacao : "updated_at";
  const dir = String(direcao).toUpperCase() === "ASC" ? "ASC" : "DESC";
  const limitNum = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const pageNum = Math.max(Number(page) || 1, 1);
  const offset = (pageNum - 1) * limitNum;

  const condicoes = ["cliente_conta_id = $1", "marketplace = $2"];
  const params = [clienteContaId, marketplace];
  if (status) {
    params.push(status);
    condicoes.push(`status = $${params.length}`);
  }

  params.push(limitNum, offset);
  const result = await db.query(
    `SELECT * FROM margin_projection_snapshots
      WHERE ${condicoes.join(" AND ")}
      ORDER BY ${coluna} ${dir} NULLS LAST
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return result.rows.map(sanitizeSnapshot);
}

async function countProjectionSnapshots({ clienteContaId, marketplace = "meli", status = null, db = pool }) {
  if (!clienteContaId) throw new Error("countProjectionSnapshots: clienteContaId é obrigatório.");

  const condicoes = ["cliente_conta_id = $1", "marketplace = $2"];
  const params = [clienteContaId, marketplace];
  if (status) {
    params.push(status);
    condicoes.push(`status = $${params.length}`);
  }

  const result = await db.query(
    `SELECT COUNT(*)::int AS total FROM margin_projection_snapshots WHERE ${condicoes.join(" AND ")}`,
    params
  );
  return result.rows[0]?.total || 0;
}

module.exports = {
  ensureMarginSnapshotTables,
  upsertProjectionSnapshot,
  markSnapshotsRefreshFailed,
  markSnapshotsOutsideCatalog,
  getProjectionSnapshot,
  listProjectionSnapshots,
  countProjectionSnapshots,
  sanitizeSnapshot,
};
