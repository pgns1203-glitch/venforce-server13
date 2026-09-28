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

// ---------------------------------------------------------------------------
// Leitura da Central (M5) — SEMPRE escopada por cliente + conta + marketplace
// (P0: conta 6 nunca lê linha da conta 5). O filtro é montado como lista de
// condições com parâmetros posicionais — nenhum valor do usuário é
// interpolado no SQL. Linhas fora do catálogo ficam fora da leitura padrão.
// ---------------------------------------------------------------------------

// Enums aceitos nos filtros (M6) — os mesmos CHECKs do schema. Valor fora
// daqui nunca chega ao SQL (o service valida antes; o builder re-filtra).
const STATUS_VALIDOS = ["HEALTHY", "LOW_MARGIN", "LOSS", "UNVALIDATED", "SUSPECT_DATA", "RECONCILING"];
const REFRESH_STATUS_VALIDOS = ["fresh", "stale", "processing", "failed", "missing"];
const CONFIANCA_VALIDOS = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"];
const STATUS_ANUNCIO_VALIDOS = ["active", "paused"];

// Busca v1 (§8.4 do plano): ILIKE substring depois do escopo por conta, sem
// extensão nova (sem pg_trgm). `%`, `_` e `\` do usuário são escapados — a
// busca é sempre literal.
function padraoBusca(termo) {
  return `%${String(termo).replace(/[\\%_]/g, "\\$&")}%`;
}

function montarFiltroSnapshots({
  clienteId, clienteContaId, marketplace = "meli", incluirForaDoCatalogo = false, somenteForaDoCatalogo = false,
  status = null, refreshStatus = null, confianca = null, statusAnuncio = null, busca = null,
}) {
  if (!clienteId) throw new Error("montarFiltroSnapshots: clienteId é obrigatório.");
  if (!clienteContaId) throw new Error("montarFiltroSnapshots: clienteContaId é obrigatório.");
  const params = [clienteId, clienteContaId, marketplace];
  const condicoes = ["cliente_id = $1", "cliente_conta_id = $2", "marketplace = $3"];
  if (somenteForaDoCatalogo) condicoes.push("catalog_missing_since IS NOT NULL");
  else if (!incluirForaDoCatalogo) condicoes.push("catalog_missing_since IS NULL");

  function lista(coluna, valores, validos) {
    const aceitos = (Array.isArray(valores) ? valores : []).filter((v) => validos.includes(v));
    if (!aceitos.length) return;
    params.push(aceitos);
    condicoes.push(`${coluna} = ANY($${params.length}::text[])`);
  }
  lista("status", status, STATUS_VALIDOS);
  lista("refresh_status", refreshStatus, REFRESH_STATUS_VALIDOS);
  lista("confidence_level", confianca, CONFIANCA_VALIDOS);
  // O escopo indexado de cliente+conta+marketplace é aplicado antes deste
  // predicado e a página tem teto de 200. Para a escala atual, ler a chave já
  // persistida no JSONB evita duplicação de dado e uma migration prematura.
  lista("(quality_json->>'statusAnuncio')", statusAnuncio, STATUS_ANUNCIO_VALIDOS);

  const termo = typeof busca === "string" ? busca.trim() : "";
  if (termo) {
    params.push(padraoBusca(termo));
    const n = params.length;
    condicoes.push(`(item_id ILIKE $${n} OR sku ILIKE $${n} OR titulo ILIKE $${n})`);
  }
  return { condicoes, params };
}

// Ordenação por WHITELIST (M6). A chave pública vira um fragmento SQL fixo;
// nada enviado pelo usuário é interpolado. Toda ordem termina em
// `item_id ASC` (paginação estável) e manda nulos para o fim nos dois
// sentidos (item sem margem nunca "vence" por falta de dado). `status` segue
// a precedência de AÇÃO do Motor (core/marginStatus.STATUS_PRECEDENCE),
// não a ordem alfabética.
const ORDENACOES = {
  margin_percent: "margin_percent",
  profit: "profit",
  status: "array_position(ARRAY['UNVALIDATED','SUSPECT_DATA','LOSS','LOW_MARGIN','RECONCILING','HEALTHY']::text[], status)",
  updated_at: "updated_at",
  calculated_at: "calculated_at",
  titulo: "titulo",
};

// Aliases do contrato ao vivo (motorMargemService.ORDENACOES).
const ALIASES_ORDENACAO = {
  margem_asc: ["margin_percent", "ASC"],
  margem_desc: ["margin_percent", "DESC"],
  titulo_asc: ["titulo", "ASC"],
};

function resolverOrdenacao({ ordenacao = null, direcao = null } = {}) {
  let chave = ordenacao ? String(ordenacao).trim() : "margin_percent";
  let dir = direcao ? String(direcao).trim().toUpperCase() : null;
  if (ALIASES_ORDENACAO[chave]) {
    const [col, dirAlias] = ALIASES_ORDENACAO[chave];
    chave = col;
    dir = dir || dirAlias;
  }
  if (!Object.prototype.hasOwnProperty.call(ORDENACOES, chave)) return null;
  if (!dir) dir = chave === "updated_at" || chave === "calculated_at" ? "DESC" : "ASC";
  if (dir !== "ASC" && dir !== "DESC") return null;
  return { chave, direcao: dir, orderBy: `${ORDENACOES[chave]} ${dir} NULLS LAST, item_id ASC` };
}

// Ordem padrão da leitura: piores margens primeiro (mesma intenção de
// ORDENACOES.margem_asc do Motor ao vivo); sem margem vai para o fim; item_id
// desempata para a paginação ser estável (nunca repete/pula item entre
// páginas).
const ORDEM_PADRAO = resolverOrdenacao().orderBy;

async function queryProjectionSnapshotsPage({ filtro, orderBy = ORDEM_PADRAO, limit, offset, db = pool }) {
  const params = [...filtro.params, limit, offset];
  const result = await db.query(
    `/* ms:list */ SELECT * FROM margin_projection_snapshots
      WHERE ${filtro.condicoes.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return result.rows.map(sanitizeSnapshot);
}

async function countProjectionSnapshotsFiltrado({ filtro, db = pool }) {
  const result = await db.query(
    `/* ms:count */ SELECT COUNT(*)::int AS total, MAX(calculated_at) AS ultimo_calculo
       FROM margin_projection_snapshots
      WHERE ${filtro.condicoes.join(" AND ")}`,
    filtro.params
  );
  const row = result.rows[0] || {};
  return { total: Number(row.total || 0), ultimoCalculoEm: row.ultimo_calculo || null };
}

// KPIs (M6) — UMA agregação no banco sobre o escopo inteiro da conta (nunca
// contando uma página em JS). Inclui os estados financeiro/refresh, anúncios
// ativos/pausados e quantos têm margem calculável.
async function summarizeProjectionSnapshots({ filtro, db = pool }) {
  const porStatus = STATUS_VALIDOS
    .map((s) => `COUNT(*) FILTER (WHERE status = '${s}')::int AS "status_${s}"`)
    .join(",\n            ");
  const porRefresh = ["fresh", "stale", "failed"]
    .map((s) => `COUNT(*) FILTER (WHERE refresh_status = '${s}')::int AS "refresh_${s}"`)
    .join(",\n            ");
  const result = await db.query(
    `/* ms:kpis */ SELECT COUNT(*)::int AS total,
            ${porStatus},
            ${porRefresh},
            COUNT(*) FILTER (WHERE quality_json->>'statusAnuncio' = 'active')::int AS anuncios_ativos,
            COUNT(*) FILTER (WHERE quality_json->>'statusAnuncio' = 'paused')::int AS anuncios_pausados,
            COUNT(*) FILTER (WHERE margin IS NOT NULL)::int AS com_margem,
            MAX(calculated_at) AS ultimo_calculo
       FROM margin_projection_snapshots
      WHERE ${filtro.condicoes.join(" AND ")}`,
    filtro.params
  );
  const row = result.rows[0] || {};
  const n = (v) => Number(v || 0);
  return {
    total: n(row.total),
    porStatus: Object.fromEntries(STATUS_VALIDOS.map((s) => [s, n(row[`status_${s}`])])),
    porRefreshStatus: { fresh: n(row.refresh_fresh), stale: n(row.refresh_stale), failed: n(row.refresh_failed) },
    anuncios: { total: n(row.total), ativos: n(row.anuncios_ativos), pausados: n(row.anuncios_pausados) },
    comMargem: n(row.com_margem),
    ultimoCalculoEm: row.ultimo_calculo || null,
  };
}

// Projeção persistida de um LOTE de anúncios (os que tiveram venda no
// período) — UMA query com `item_id = ANY`, nunca uma por anúncio. Inclui
// itens fora do catálogo atual: eles venderam no período e o desvio
// previsto × realizado continua valendo para eles.
async function mapProjectionsForItems({ clienteId, clienteContaId, marketplace = "meli", itemIds, db = pool }) {
  if (!clienteId) throw new Error("mapProjectionsForItems: clienteId é obrigatório.");
  if (!clienteContaId) throw new Error("mapProjectionsForItems: clienteContaId é obrigatório.");
  const ids = Array.from(new Set((itemIds || []).filter(Boolean).map(String)));
  if (!ids.length) return new Map();
  const result = await db.query(
    `/* ms:projecoes */ SELECT item_id, titulo, price, profit, margin, margin_percent, status, calculated_at
       FROM margin_projection_snapshots
      WHERE cliente_id = $1 AND cliente_conta_id = $2 AND marketplace = $3 AND item_id = ANY($4::text[])`,
    [clienteId, clienteContaId, marketplace, ids]
  );
  const mapa = new Map();
  for (const row of result.rows) {
    mapa.set(row.item_id, {
      itemId: row.item_id,
      titulo: row.titulo || null,
      price: row.price != null ? Number(row.price) : null,
      profit: row.profit != null ? Number(row.profit) : null,
      margin: row.margin != null ? Number(row.margin) : null,
      marginPercent: row.margin_percent != null ? Number(row.margin_percent) : null,
      status: row.status || null,
      calculatedAt: row.calculated_at || null,
    });
  }
  return mapa;
}

module.exports = {
  mapProjectionsForItems,
  STATUS_VALIDOS,
  REFRESH_STATUS_VALIDOS,
  CONFIANCA_VALIDOS,
  STATUS_ANUNCIO_VALIDOS,
  resolverOrdenacao,
  padraoBusca,
  summarizeProjectionSnapshots,
  ensureMarginSnapshotTables,
  upsertProjectionSnapshot,
  markSnapshotsRefreshFailed,
  markSnapshotsOutsideCatalog,
  montarFiltroSnapshots,
  queryProjectionSnapshotsPage,
  countProjectionSnapshotsFiltrado,
  ORDEM_PADRAO,
  getProjectionSnapshot,
  listProjectionSnapshots,
  countProjectionSnapshots,
  sanitizeSnapshot,
};
