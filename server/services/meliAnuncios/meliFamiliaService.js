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

// -----------------------------------------------------------------------------
// Leitura agrupada: Família -> User Product -> Item MLB.
//
// Regra canônica (decisão explícita da modelagem, ver
// docs/AUDITORIA_MELI_USER_PRODUCTS_POS_IMPLEMENTACAO.md e o diagnóstico da
// missão de account-scope):
//
//   meli_anuncios       = autoridade de account-scope (cliente_conta_id)
//   meli_user_products  = autoridade da hierarquia (user_product_id -> family_id)
//
// meli_user_products.cliente_conta_id NUNCA é usado como filtro de segurança
// — sua UNIQUE é (cliente_id, user_product_id), sem a conta, e o upsert
// sobrescreve esse campo sem COALESCE. Toda leitura abaixo parte de uma CTE
// "escopo" sobre meli_anuncios (a mesma fonte que os 3 endpoints existentes
// já usam) e só então junta com meli_user_products para achar a família —
// assim uma família/UP/item que só existe para outra conta nunca aparece,
// mesmo que meli_user_products.cliente_conta_id esteja desatualizado.
// -----------------------------------------------------------------------------

function clausulaConta({ clienteContaId, includeLegacy, paramIndex }) {
  if (clienteContaId == null) return { sql: "", param: null };
  const sql = includeLegacy
    ? ` AND (a.cliente_conta_id = $${paramIndex} OR a.cliente_conta_id IS NULL)`
    : ` AND a.cliente_conta_id = $${paramIndex}`;
  return { sql, param: clienteContaId };
}

// Página de famílias + agregados (sem carregar nenhum MLB). Paginação por
// família: LIMIT/OFFSET contam family_id distintos, nunca item_id.
async function listarFamilias({
  clienteId,
  clienteContaId = null,
  includeLegacy = true,
  q = "",
  page = 1,
  limit = 20,
}) {
  await ensureSchema();

  const params = [clienteId];
  let i = 2;

  const conta = clausulaConta({ clienteContaId, includeLegacy, paramIndex: i });
  if (conta.param != null) { params.push(conta.param); i++; }

  const termo = String(q || "").trim();
  let cteMatch = "";
  let filtroMatch = "";
  if (termo) {
    params.push(`%${termo}%`);
    const qIdx = i;
    i++;
    cteMatch = `,
    familias_match AS (
      SELECT DISTINCT up.family_id
      FROM escopo e
      JOIN meli_user_products up ON up.cliente_id = $1 AND up.user_product_id = e.user_product_id
      WHERE up.family_id IS NOT NULL
        AND (up.family_name ILIKE $${qIdx} OR e.titulo ILIKE $${qIdx} OR e.sku ILIKE $${qIdx}
             OR up.user_product_id ILIKE $${qIdx} OR e.item_id ILIKE $${qIdx})
    )`;
    filtroMatch = ` AND EXISTS (SELECT 1 FROM familias_match fm WHERE fm.family_id = up.family_id)`;
  }

  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const pag = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (pag - 1) * lim;
  params.push(lim, offset);
  const limIdx = i;
  const offIdx = i + 1;

  const sql = `
    -- LISTAR_FAMILIAS_PAGINA
    WITH escopo AS (
      SELECT a.item_id, a.user_product_id, a.titulo, a.sku
      FROM meli_anuncios a
      WHERE a.cliente_id = $1
        AND a.user_product_id IS NOT NULL
        ${conta.sql}
    )${cteMatch}
    , agregado AS (
      SELECT up.family_id, MAX(up.family_name) AS family_name,
             COUNT(DISTINCT up.user_product_id)::int AS total_user_products,
             COUNT(e.item_id)::int AS total_itens
      FROM escopo e
      JOIN meli_user_products up ON up.cliente_id = $1 AND up.user_product_id = e.user_product_id
      WHERE up.family_id IS NOT NULL${filtroMatch}
      GROUP BY up.family_id
    )
    SELECT family_id, family_name, total_user_products, total_itens,
           COUNT(*) OVER()::int AS total_familias
    FROM agregado
    ORDER BY family_name ASC NULLS LAST, family_id ASC
    LIMIT $${limIdx} OFFSET $${offIdx};
  `;

  const { rows } = await db.query(sql, params);
  const totalFamilias = rows.length ? rows[0].total_familias : 0;

  // Query 2: só os user_products das famílias desta página — nunca busca UP
  // de família fora da página atual.
  const familyIds = rows.map((r) => r.family_id);
  const upsPorFamilia = new Map();
  if (familyIds.length) {
    const params2 = [clienteId];
    let j = 2;
    const conta2 = clausulaConta({ clienteContaId, includeLegacy, paramIndex: j });
    if (conta2.param != null) { params2.push(conta2.param); j++; }
    params2.push(familyIds);
    const famIdx = j;

    const sql2 = `
      -- LISTAR_FAMILIAS_UPS_DA_PAGINA
      WITH escopo AS (
        SELECT a.item_id, a.user_product_id
        FROM meli_anuncios a
        WHERE a.cliente_id = $1
          AND a.user_product_id IS NOT NULL
          ${conta2.sql}
      )
      SELECT up.family_id, up.user_product_id, up.site_id, up.domain_id,
             COUNT(e.item_id)::int AS total_itens
      FROM escopo e
      JOIN meli_user_products up ON up.cliente_id = $1 AND up.user_product_id = e.user_product_id
      WHERE up.family_id = ANY($${famIdx}::text[])
      GROUP BY up.family_id, up.user_product_id, up.site_id, up.domain_id
      ORDER BY up.family_id, up.user_product_id;
    `;
    const { rows: upsRows } = await db.query(sql2, params2);
    for (const r of upsRows) {
      const lista = upsPorFamilia.get(r.family_id) || [];
      lista.push({
        user_product_id: r.user_product_id,
        site_id: r.site_id,
        domain_id: r.domain_id,
        total_itens: r.total_itens,
      });
      upsPorFamilia.set(r.family_id, lista);
    }
  }

  // Query 3: a capa de cada família DESTA página.
  //
  // Calculada em leitura, nunca persistida: não existe coluna de thumbnail
  // em meli_user_products e nada é gravado aqui. A régua imita o que o
  // Mercado Livre mostra num agrupador — a variação que representa a
  // família:
  //
  //   1. quando há busca, quem casa com o termo vem primeiro (a variação
  //      relevante para AQUELA busca, não a campeã de vendas da família);
  //   2. ter imagem — uma capa sem foto não cumpre o papel de capa;
  //   3. mais vendido — é o "principal" observável que temos, já que
  //      meli_user_products não guarda marca de UP principal;
  //   4. ativo antes de pausado — desempate útil quando as vendas empatam
  //      (o caso comum: todo mundo com 0);
  //   5. maior estoque e, por fim, item_id, só para a escolha ser estável
  //      entre duas chamadas iguais.
  //
  // O escopo é o mesmo das outras leituras: parte de meli_anuncios já
  // filtrado pela conta, então a capa nunca vaza de outra operação.
  const capaPorFamilia = new Map();
  if (familyIds.length) {
    const params3 = [clienteId];
    let k = 2;
    const conta3 = clausulaConta({ clienteContaId, includeLegacy, paramIndex: k });
    if (conta3.param != null) { params3.push(conta3.param); k++; }
    params3.push(familyIds);
    const famIdx3 = k;
    k++;

    let relevancia = "";
    if (termo) {
      params3.push(`%${termo}%`);
      const qIdx3 = k;
      k++;
      relevancia = `(e.titulo ILIKE $${qIdx3} OR e.sku ILIKE $${qIdx3}
                 OR e.item_id ILIKE $${qIdx3} OR e.user_product_id ILIKE $${qIdx3}) DESC,`;
    }

    const sql3 = `
      -- LISTAR_FAMILIAS_CAPA_DA_PAGINA
      WITH escopo AS (
        SELECT a.item_id, a.user_product_id, a.titulo, a.sku,
               a.thumbnail, a.vendidos, a.estoque, a.status
        FROM meli_anuncios a
        WHERE a.cliente_id = $1
          AND a.user_product_id IS NOT NULL
          ${conta3.sql}
      )
      SELECT DISTINCT ON (up.family_id)
             up.family_id, e.user_product_id, NULLIF(e.thumbnail, '') AS thumbnail
      FROM escopo e
      JOIN meli_user_products up ON up.cliente_id = $1 AND up.user_product_id = e.user_product_id
      WHERE up.family_id = ANY($${famIdx3}::text[])
      ORDER BY up.family_id,
               ${relevancia}
               (NULLIF(e.thumbnail, '') IS NOT NULL) DESC,
               e.vendidos DESC NULLS LAST,
               (e.status = 'active') DESC,
               e.estoque DESC NULLS LAST,
               e.item_id ASC;
    `;

    const { rows: capaRows } = await db.query(sql3, params3);
    for (const r of capaRows) {
      capaPorFamilia.set(r.family_id, {
        thumbnail: r.thumbnail == null ? null : r.thumbnail,
        user_product_id: r.user_product_id,
      });
    }
  }

  const familias = rows.map((r) => ({
    family_id: r.family_id,
    family_name: r.family_name,
    total_user_products: r.total_user_products,
    total_itens: r.total_itens,
    // Sempre objeto — o front testa `cover.thumbnail`, nunca a existência
    // de `cover`. Família sem imagem devolve thumbnail null.
    cover: capaPorFamilia.get(r.family_id) || { thumbnail: null, user_product_id: null },
    user_products: upsPorFamilia.get(r.family_id) || [],
  }));

  return {
    familias,
    paginacao: {
      page: pag,
      limit: lim,
      totalFamilias,
      totalPaginas: Math.max(Math.ceil(totalFamilias / lim), 1),
    },
  };
}

// Contador de anúncios sem User Product (legado). Nunca misturado com a
// listagem de famílias — bloco próprio na resposta do controller.
async function contarSemUserProduct({ clienteId, clienteContaId = null, includeLegacy = true }) {
  await ensureSchema();

  const params = [clienteId];
  const conta = clausulaConta({ clienteContaId, includeLegacy, paramIndex: 2 });
  if (conta.param != null) params.push(conta.param);

  const { rows } = await db.query(
    `-- SEM_USER_PRODUCT_TOTAL
     SELECT COUNT(*)::int AS total
       FROM meli_anuncios a
      WHERE a.cliente_id = $1 AND a.user_product_id IS NULL${conta.sql};`,
    params
  );
  return rows[0] ? rows[0].total : 0;
}

// Detalhe de 1 família: User Products -> Itens MLB completos, sempre
// escopados por meli_anuncios. Retorna null quando a família não existe
// dentro do escopo pedido (conta errada, ou family_id inexistente) — o
// controller responde 404 nos dois casos, sem distinguir, para nunca revelar
// a existência de uma família de outra conta.
async function obterFamiliaDetalhe({ clienteId, familyId, clienteContaId = null, includeLegacy = true }) {
  await ensureSchema();

  const params = [clienteId, familyId];
  const conta = clausulaConta({ clienteContaId, includeLegacy, paramIndex: 3 });
  if (conta.param != null) params.push(conta.param);

  const { rows } = await db.query(
    `-- FAMILIA_DETALHE_ITENS
     SELECT a.item_id, a.user_product_id, a.titulo, a.status, a.preco,
            a.estoque, a.sku, a.thumbnail, a.permalink,
            up.site_id, up.domain_id, up.family_name
       FROM meli_anuncios a
       JOIN meli_user_products up
         ON up.cliente_id = a.cliente_id AND up.user_product_id = a.user_product_id
      WHERE a.cliente_id = $1
        AND a.user_product_id IS NOT NULL
        AND up.family_id = $2
        ${conta.sql}
      ORDER BY a.user_product_id, a.item_id;`,
    params
  );

  if (!rows.length) return null;

  const porUp = new Map();
  let familyName = null;
  for (const r of rows) {
    if (r.family_name != null) familyName = r.family_name;
    if (!porUp.has(r.user_product_id)) {
      porUp.set(r.user_product_id, {
        user_product_id: r.user_product_id,
        site_id: r.site_id,
        domain_id: r.domain_id,
        itens: [],
      });
    }
    porUp.get(r.user_product_id).itens.push({
      item_id: r.item_id,
      user_product_id: r.user_product_id,
      family_id: familyId,
      titulo: r.titulo,
      status: r.status,
      preco: r.preco,
      estoque: r.estoque,
      sku: r.sku,
      thumbnail: r.thumbnail,
      permalink: r.permalink,
    });
  }

  const userProducts = Array.from(porUp.values()).map((up) => ({
    ...up,
    total_itens: up.itens.length,
  }));

  return {
    family_id: familyId,
    family_name: familyName,
    user_products: userProducts,
  };
}

module.exports = {
  ensureSchema,
  extrairUserProducts,
  registrarUserProducts,
  listarFamilias,
  contarSemUserProduct,
  obterFamiliaDetalhe,
};
