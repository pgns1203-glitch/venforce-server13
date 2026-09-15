// server/services/meliAnuncios/meliFamiliaService.js
// -----------------------------------------------------------------------------
// Módulo: Anúncios Meli — User Products (UP) e famílias do Mercado Livre.
//
// Modelo do ML:  family_id  ->  user_product_id  ->  item_id (MLB)
// Modelo aqui:   meli_anuncios --user_product_id--> meli_user_products --family_id
//
// Este serviço é dono da tabela meli_user_products, no mesmo padrão de
// otimizadorMeliService.js (cada serviço do módulo garante o próprio schema).
//
// NÃO chama a API do Mercado Livre. Os quatro campos de que precisa
// (user_product_id, family_id, site_id, domain_id) já vêm no multiget /items
// que meliSyncService faz — confirmado em produção: item com user_product_id
// sempre traz family_id; item legado (multivariante não migrado) não traz
// nenhum dos dois. Por isso não existe resolvedor, fila, retry nem worker.
//
// Agrupamento visual, edição em massa e qualquer leitura agrupada estão FORA
// deste PR — aqui só se persiste a relação oficial do Mercado Livre.
// -----------------------------------------------------------------------------

const _dbModule = require("../../config/database");
const db =
  _dbModule && typeof _dbModule.query === "function"
    ? _dbModule
    : _dbModule.pool || _dbModule.default || _dbModule;

// -----------------------------------------------------------------------------
// Schema
// -----------------------------------------------------------------------------
let _schemaPronto = false;

async function ensureSchema() {
  if (_schemaPronto) return;

  // family_id é TEXT por decisão explícita: o valor do ML passa de
  // Number.MAX_SAFE_INTEGER e não pode virar Number em lugar nenhum do
  // caminho (ver parseJsonPreservingIds em utils/mlClient.js).
  await db.query(`
    CREATE TABLE IF NOT EXISTS meli_user_products (
      id                 SERIAL PRIMARY KEY,
      cliente_id         INTEGER NOT NULL,
      cliente_conta_id   INTEGER,
      ml_user_id         TEXT,
      user_product_id    TEXT NOT NULL,
      family_id          TEXT,
      family_name        TEXT,
      site_id            TEXT,
      domain_id          TEXT,
      catalog_product_id TEXT,
      last_synced_at     TIMESTAMPTZ DEFAULT NOW(),
      created_at         TIMESTAMPTZ DEFAULT NOW(),
      updated_at         TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (cliente_id, user_product_id)
    );
  `);

  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_meli_user_products_family
       ON meli_user_products (cliente_id, family_id) WHERE family_id IS NOT NULL;`
  );
  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_meli_user_products_conta
       ON meli_user_products (cliente_conta_id);`
  );

  _schemaPronto = true;
}

// -----------------------------------------------------------------------------
// Extração
// -----------------------------------------------------------------------------

// Reduz os registros de anúncio do lote à lista de User Products distintos.
// Um UP com 45 anúncios vira 1 linha — a deduplicação acontece aqui, em
// memória, antes de qualquer ida ao banco.
//
// Registro sem user_product_id é anúncio legado (multivariante não migrado ao
// modelo UP): não tem UP nem família, e é descartado. Nada é inferido.
function extrairUserProducts(registros) {
  const porChave = new Map();

  for (const r of Array.isArray(registros) ? registros : []) {
    const up = r && r.user_product_id;
    if (!up) continue;

    const chave = `${r.cliente_id}:${up}`;
    porChave.set(chave, {
      cliente_id: r.cliente_id,
      cliente_conta_id: r.cliente_conta_id ?? null,
      ml_user_id: r.ml_user_id != null ? String(r.ml_user_id) : null,
      user_product_id: String(up),
      family_id: r.family_id != null ? String(r.family_id) : null,
      family_name: r.family_name || null,
      site_id: r.site_id || null,
      domain_id: r.domain_id || null,
      catalog_product_id: r.catalog_product_id || null,
    });
  }

  return Array.from(porChave.values());
}

// -----------------------------------------------------------------------------
// Upsert (chamado pela sincronização)
// -----------------------------------------------------------------------------
async function registrarUserProducts(registros) {
  const linhas = extrairUserProducts(registros);
  if (!linhas.length) return 0;

  await ensureSchema();

  // family_id usa COALESCE: se uma ressincronização vier sem o campo, o valor
  // já conhecido é preservado em vez de virar NULL. Mudança real de família
  // (EXCLUDED não nulo) continua sobrescrevendo normalmente.
  const sql = `
    INSERT INTO meli_user_products (
      cliente_id, cliente_conta_id, ml_user_id, user_product_id,
      family_id, family_name, site_id, domain_id, catalog_product_id,
      last_synced_at, updated_at
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8, $9,
      NOW(), NOW()
    )
    ON CONFLICT (cliente_id, user_product_id) DO UPDATE SET
      cliente_conta_id   = EXCLUDED.cliente_conta_id,
      ml_user_id         = EXCLUDED.ml_user_id,
      family_id          = COALESCE(EXCLUDED.family_id, meli_user_products.family_id),
      family_name        = EXCLUDED.family_name,
      site_id            = EXCLUDED.site_id,
      domain_id          = EXCLUDED.domain_id,
      catalog_product_id = EXCLUDED.catalog_product_id,
      last_synced_at     = NOW(),
      updated_at         = NOW();
  `;

  let salvos = 0;
  for (const l of linhas) {
    await db.query(sql, [
      l.cliente_id,
      l.cliente_conta_id,
      l.ml_user_id,
      l.user_product_id,
      l.family_id,
      l.family_name,
      l.site_id,
      l.domain_id,
      l.catalog_product_id,
    ]);
    salvos++;
  }
  return salvos;
}

module.exports = {
  ensureSchema,
  extrairUserProducts,
  registrarUserProducts,
};
