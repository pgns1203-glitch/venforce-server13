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
// Edição em massa continua fora daqui. O que este serviço faz é persistir a
// relação oficial do Mercado Livre e servir a LISTAGEM UNIFICADA da tela de
// anúncios (listarAgrupado) — uma lista só, com agrupador quando existe.
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
// sobre meli_anuncios já filtrado pela conta (a mesma fonte que os endpoints
// existentes já usam) e só então junta com meli_user_products para achar a
// família — assim uma família/UP/item que só existe para outra conta nunca
// aparece, mesmo que meli_user_products.cliente_conta_id esteja desatualizado.
//
// Isso vale igualmente para a listagem unificada: o LEFT JOIN acrescenta a
// família a um anúncio que JÁ passou pelo escopo de conta. Um LEFT JOIN não
// alarga o escopo — só decide se a linha ganha agrupador ou não.
// -----------------------------------------------------------------------------

function clausulaConta({ clienteContaId, includeLegacy, paramIndex }) {
  if (clienteContaId == null) return { sql: "", param: null };
  const sql = includeLegacy
    ? ` AND (a.cliente_conta_id = $${paramIndex} OR a.cliente_conta_id IS NULL)`
    : ` AND a.cliente_conta_id = $${paramIndex}`;
  return { sql, param: clienteContaId };
}

// Predicados de recorte dos cards de KPI. São os MESMOS de
// meliAnunciosService.listarAnuncios (e com os mesmos limiares 60/80), só
// reescritos contra o alias `b` da CTE `base` desta consulta — a listagem
// unificada não pode filtrar diferente da listagem plana.
//
// "sem_agrupamento" continua existindo como recorte de diagnóstico ("o que a
// hierarquia do ML não alcança"), mas aqui ele é só mais um filtro: deixou de
// ser a identidade de uma aba. Na CTE `base` o LEFT JOIN já resolve os três
// caminhos do predicado antigo (sem user_product_id, UP sem family_id, UP
// órfão) num único `b.family_id IS NULL`.
function predicadoFiltroItem(filtro) {
  switch (filtro) {
    case "sem_fotos":        return `COALESCE(b.pictures_count, 0) < 3`;
    case "score_baixo":      return `COALESCE(b.score_venforce, 0) < 60`;
    case "sem_sku":          return `(b.sku IS NULL OR b.sku = '')`;
    case "ficha_incompleta": return `b.score_motivo = 'Ficha técnica incompleta'`;
    case "pausados":         return `b.status = 'paused'`;
    case "score_muito_bom":  return `COALESCE(b.score_venforce, 0) >= 80`;
    case "score_medio":      return `(COALESCE(b.score_venforce, 0) >= 60 AND COALESCE(b.score_venforce, 0) < 80)`;
    case "mercado_full":     return `b.is_full = true`;
    case "sem_agrupamento":  return `b.family_id IS NULL`;
    default:                 return "";
  }
}

// -----------------------------------------------------------------------------
// LISTAGEM UNIFICADA (uma lista só, como a listagem de anúncios do ML)
//
// Ver docs/AUDITORIA_ANUNCIOS_ML_LISTAGEM_UNIFICADA.md. Em uma frase: a
// família não é categoria de tela, é chave derivada — e a doc oficial
// (user-products.md) manda "agrupar os ítens por família, por user product",
// não segregar os agrupáveis dos não agrupáveis.
//
// Cada linha da página é um GRUPO, e todo anúncio pertence a exatamente um:
//
//   grupo_key = 'fam:'  || family_id   quando o UP do anúncio tem família
//             = 'item:' || item_id     caso contrário (anúncio individual)
//
// O segundo caso não é resto nem anomalia: a FAQ de user-products.md diz que
// antes da tag "user_product_seller" a relação user_product_id:item_id é 1:1 e
// o item não tem family_name. Anúncio sem agrupador é um anúncio individual.
//
// ESTOQUE — o ponto que justifica a existência desta consulta. Segundo
// user-products.md (campos sincronizados por UP) e estoque-distribuido.md, o
// estoque pertence ao User Product e o ML REPLICA available_quantity em todos
// os itens do mesmo UP. Somar item a item duplicaria o estoque de todo UP com
// mais de um MLB — caso já observado em produção. Por isso a CTE
// `estoque_por_up` colapsa por UP antes de somar.
//
// VENDIDOS — regra oposta, e de propósito: sold_quantity NÃO está na lista de
// campos sincronizados por UP, e a FAQ do UPtin confirma que as ordens ficam
// atreladas ao item_id. Vendas somam item a item.
// -----------------------------------------------------------------------------
async function listarAgrupado({
  clienteId,
  clienteContaId = null,
  includeLegacy = true,
  q = "",
  status = "",
  filtro = "",
  page = 1,
  limit = 20,
}) {
  await ensureSchema();
  // meli_anuncios é de meliAnunciosService, e esta consulta lê colunas que
  // entraram por ALTER TABLE ... ADD COLUMN IF NOT EXISTS (user_product_id,
  // catalog_listing, family_name). Num deploy novo, em que /familias for a
  // primeira leitura do módulo, elas podem ainda não existir — e o require é
  // tardio só porque meliAnunciosService já requer ESTE módulo (o require
  // circular no topo deixaria um dos dois pela metade).
  await require("./meliAnunciosService").ensureSchema();

  const params = [clienteId];
  let i = 2;

  const conta = clausulaConta({ clienteContaId, includeLegacy, paramIndex: i });
  if (conta.param != null) { params.push(conta.param); i++; }

  // Busca/status/filtro casam por ITEM; o grupo entra na lista se QUALQUER
  // item dele casar. Os agregados, porém, continuam sendo do grupo inteiro
  // (ver `grupos`, que não conhece estes predicados): estoque de um produto é
  // estoque do produto — filtrar por "Ativos" não muda o estoque total.
  const match = [];
  const termo = String(q || "").trim();
  if (termo) {
    params.push(`%${termo}%`);
    const qIdx = i;
    i++;
    match.push(`(b.titulo ILIKE $${qIdx} OR b.item_id ILIKE $${qIdx} OR b.sku ILIKE $${qIdx}
                 OR b.up_family_name ILIKE $${qIdx} OR b.user_product_id ILIKE $${qIdx})`);
  }
  if (status) {
    params.push(String(status));
    match.push(`b.status = $${i}`);
    i++;
  }
  const predFiltro = predicadoFiltroItem(filtro);
  if (predFiltro) match.push(predFiltro);
  const matchSql = match.length ? match.join(" AND ") : "TRUE";

  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const pag = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (pag - 1) * lim;
  params.push(lim, offset);
  const limIdx = i;
  const offIdx = i + 1;

  // A ordem operacional da listagem plana (revisado ASC, score ASC NULLS
  // FIRST, updated_at DESC) sobe para o nível de grupo mantendo o
  // significado: o grupo aparece tão alto quanto o seu PIOR item. Para um
  // grupo de um item só, é literalmente a ordem de antes — nenhuma regressão
  // para quem não tem família. O COALESCE(score, -1) é o que preserva o
  // "NULLS FIRST" depois do MIN (que descartaria os nulos).
  const sql = `
    -- LISTAR_AGRUPADO_PAGINA
    WITH base AS (
      SELECT a.item_id, a.user_product_id, a.titulo, a.sku, a.status,
             a.preco, a.moeda, a.estoque, a.vendidos, a.score_venforce,
             a.score_motivo, a.pictures_count, a.is_full, a.revisado,
             a.updated_at,
             up.family_id,
             up.family_name AS up_family_name,
             CASE WHEN up.family_id IS NOT NULL
                  THEN 'fam:' || up.family_id
                  ELSE 'item:' || a.item_id
             END AS grupo_key
        FROM meli_anuncios a
        LEFT JOIN meli_user_products up
               ON up.cliente_id = a.cliente_id
              AND up.user_product_id = a.user_product_id
       WHERE a.cliente_id = $1${conta.sql}
    ),
    estoque_por_up AS (
      SELECT b.grupo_key,
             COALESCE(b.user_product_id, 'item:' || b.item_id) AS up_key,
             MAX(b.estoque) AS estoque
        FROM base b
       GROUP BY b.grupo_key, COALESCE(b.user_product_id, 'item:' || b.item_id)
    ),
    estoque_grupo AS (
      SELECT grupo_key, SUM(estoque)::int AS estoque_total
        FROM estoque_por_up
       GROUP BY grupo_key
    ),
    selecionados AS (
      SELECT DISTINCT b.grupo_key FROM base b WHERE ${matchSql}
    ),
    grupos AS (
      SELECT b.grupo_key,
             MIN(b.family_id)                                AS family_id,
             MAX(b.up_family_name)                           AS family_name,
             MIN(b.item_id)                                  AS item_id,
             COUNT(*)::int                                   AS total_itens,
             COUNT(DISTINCT b.user_product_id)::int          AS total_user_products,
             SUM(COALESCE(b.vendidos, 0))::int               AS vendidos_total,
             MIN(b.preco)                                    AS preco_min,
             MAX(b.preco)                                    AS preco_max,
             MIN(b.moeda)                                    AS moeda,
             MIN(b.score_venforce)                           AS score_min,
             COUNT(*) FILTER (WHERE b.status = 'active')::int AS total_ativos,
             COUNT(*) FILTER (WHERE b.status = 'paused')::int AS total_pausados,
             COUNT(*) FILTER (WHERE b.status = 'closed')::int AS total_encerrados,
             MIN(CASE WHEN b.revisado THEN 1 ELSE 0 END)     AS ord_revisado,
             MIN(COALESCE(b.score_venforce, -1))             AS ord_score,
             MAX(b.updated_at)                               AS ord_updated
        FROM base b
       GROUP BY b.grupo_key
    )
    SELECT g.grupo_key, g.family_id, g.family_name, g.item_id,
           g.total_itens, g.total_user_products, g.vendidos_total,
           g.preco_min, g.preco_max, g.moeda, g.score_min,
           g.total_ativos, g.total_pausados, g.total_encerrados,
           e.estoque_total,
           COUNT(*) OVER()::int AS total_grupos
      FROM grupos g
      JOIN selecionados s ON s.grupo_key = g.grupo_key
      LEFT JOIN estoque_grupo e ON e.grupo_key = g.grupo_key
     ORDER BY g.ord_revisado ASC,
              g.ord_score ASC,
              g.ord_updated DESC NULLS LAST,
              g.grupo_key ASC
     LIMIT $${limIdx} OFFSET $${offIdx};
  `;

  const { rows } = await db.query(sql, params);
  const totalGrupos = rows.length ? rows[0].total_grupos : 0;

  const familyIds = rows.filter((r) => r.family_id != null).map((r) => r.family_id);
  const itemIds = rows.filter((r) => r.family_id == null).map((r) => r.item_id);

  // Query 2: os campos completos dos anúncios INDIVIDUAIS desta página. Um
  // grupo 'item:' tem exatamente um MLB, então a linha da lista é a linha do
  // anúncio — e o front a renderiza com o mesmo `rowAnuncioHtml` de sempre,
  // com badges, score e link externo. Sem esta consulta, o anúncio individual
  // viraria uma linha mais pobre que a do agrupador, que é o contrário do
  // pedido ("nenhuma distinção visual").
  const itemPorId = new Map();
  if (itemIds.length) {
    const params2 = [clienteId];
    let j = 2;
    const conta2 = clausulaConta({ clienteContaId, includeLegacy, paramIndex: j });
    if (conta2.param != null) { params2.push(conta2.param); j++; }
    params2.push(itemIds);

    const { rows: itemRows } = await db.query(
      `-- LISTAR_AGRUPADO_ITENS_DA_PAGINA
       SELECT a.item_id, a.sku, a.titulo, a.marca, a.modelo, a.preco,
              a.preco_original, a.moeda, a.estoque, a.vendidos, a.status,
              a.sub_status, a.listing_type_id, a.category_id, a.permalink,
              a.thumbnail, a.pictures_count, a.logistic_type, a.is_full,
              a.health, a.score_venforce, a.score_motivo, a.revisado,
              a.last_synced_at, a.catalog_listing, a.family_name,
              a.user_product_id, a.variations_count
         FROM meli_anuncios a
        WHERE a.cliente_id = $1${conta2.sql}
          AND a.item_id = ANY($${j}::text[]);`,
      params2
    );
    for (const r of itemRows) itemPorId.set(r.item_id, r);
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

  // Uma lista, duas formas de linha. `tipo` é o ÚNICO campo que as distingue
  // no payload — e ele não descreve uma categoria de tela, descreve se existe
  // ou não um agrupador abaixo da linha (o que decide apenas se ela expande).
  const anuncios = rows.map((r) => {
    if (r.family_id != null) {
      return {
        tipo: "familia",
        key: r.grupo_key,
        family_id: r.family_id,
        family_name: r.family_name,
        titulo: r.family_name,
        total_user_products: r.total_user_products,
        total_itens: r.total_itens,
        // Estoque somado por UP distinto; vendas somadas por item. Ver o
        // cabeçalho de listarAgrupado: a doc do ML define os dois em níveis
        // diferentes, então eles agregam de formas diferentes.
        estoque_total: r.estoque_total,
        vendidos_total: r.vendidos_total,
        // A família não tem um preço: "preço por variação" é o nome da
        // iniciativa. Os dois extremos vão para a tela decidir faixa ou valor.
        preco_min: r.preco_min,
        preco_max: r.preco_max,
        moeda: r.moeda,
        // O pior score do grupo — mesmo critério que ordena a lista.
        score_min: r.score_min,
        status_contagem: {
          ativos: r.total_ativos,
          pausados: r.total_pausados,
          encerrados: r.total_encerrados,
        },
        // Sempre objeto — o front testa `cover.thumbnail`, nunca a existência
        // de `cover`. Família sem imagem devolve thumbnail null.
        cover: capaPorFamilia.get(r.family_id) || { thumbnail: null, user_product_id: null },
      };
    }

    // Anúncio individual: a linha É o anúncio. Devolve o registro inteiro de
    // meli_anuncios (mesmo contrato de campos de GET /anuncios-meli) para que
    // a tela não precise de um renderizador mais pobre só para ele.
    const item = itemPorId.get(r.item_id) || { item_id: r.item_id };
    return Object.assign({}, item, {
      tipo: "item",
      key: r.grupo_key,
      // Sem family_id: ou o anúncio não tem User Product, ou o UP não tem
      // família. `family_name` NÃO é zerado — ele vem de meli_anuncios e é o
      // sinal que trava a edição de título (achado do BODY_INVALID_FIELDS);
      // sobrescrevê-lo aqui seria apagar um dado real.
      family_id: null,
      total_itens: 1,
      total_user_products: r.total_user_products,
      estoque_total: r.estoque_total,
      vendidos_total: r.vendidos_total,
      cover: { thumbnail: item.thumbnail == null ? null : item.thumbnail, user_product_id: item.user_product_id || null },
      // Modelo LEGADO (item_id -> variations[] do ML) — só existe nesta
      // forma "item" porque family_id já é null aqui por construção. Nunca
      // aparece na forma "família": lá a hierarquia é 100% de
      // meli_user_products, e variations_count não participa dela. NULL
      // (linha sincronizada antes desta coluna existir) normaliza para 0 —
      // o front só testa "> 0", nunca precisa distinguir NULL de zero.
      variations_count: item.variations_count || 0,
    });
  });

  return {
    anuncios,
    paginacao: {
      page: pag,
      limit: lim,
      total: totalGrupos,
      totalPaginas: Math.max(Math.ceil(totalGrupos / lim), 1),
    },
  };
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
            a.preco_original, a.moeda,
            a.estoque, a.vendidos, a.score_venforce, a.sku, a.thumbnail,
            a.permalink, a.listing_type_id,
            a.pictures_count, a.is_full, a.revisado, a.catalog_listing,
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
    // Os mesmos campos que a linha da LISTA usa, porque a expansão é a
    // continuação da mesma tabela — mesmas colunas, alinhadas ao mesmo
    // cabeçalho. Enquanto a expansão era uma árvore separada, com grade
    // própria, moeda/vendidos/score não eram lidos daqui.
    //
    // `listing_type_id` é projeção pura de uma coluna que já existia em
    // meli_anuncios (a listagem plana sempre a leu): ela entrou aqui porque a
    // expansão passou a mostrar os MLBs direto abaixo do agrupador, sem o
    // nível do User Product, e aí a condição comercial (Clássico / Premium) é
    // o que distingue dois anúncios da MESMA variação. Nada mais mudou na
    // consulta — nem filtro, nem join, nem ordem, nem agregação.
    porUp.get(r.user_product_id).itens.push({
      item_id: r.item_id,
      user_product_id: r.user_product_id,
      family_id: familyId,
      titulo: r.titulo,
      status: r.status,
      preco: r.preco,
      preco_original: r.preco_original,
      moeda: r.moeda,
      estoque: r.estoque,
      vendidos: r.vendidos,
      score_venforce: r.score_venforce,
      sku: r.sku,
      thumbnail: r.thumbnail,
      permalink: r.permalink,
      listing_type_id: r.listing_type_id,
      // Mesmas colunas que a listagem plana já lê para o card avulso
      // (rowAnuncioHtml) — sem elas o card do MLB dentro da família não
      // consegue montar os mesmos badges (Catálogo/Full/fotos/Revisado).
      pictures_count: r.pictures_count,
      is_full: r.is_full,
      revisado: r.revisado,
      catalog_listing: r.catalog_listing,
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
  listarAgrupado,
  obterFamiliaDetalhe,
};
