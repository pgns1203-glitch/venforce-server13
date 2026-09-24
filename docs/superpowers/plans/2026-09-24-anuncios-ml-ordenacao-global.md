# Ordenação global (Faturamento % / Curva ABC) — Anúncios ML — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer `GET /anuncios-meli/familias` aceitar `ordenarPor` (faturamento_asc/desc, curvaAbc_asc/desc) e devolver a PÁGINA já ordenada contra o catálogo inteiro filtrado, corrigindo o bug em que a ordenação por performance só valia dentro da página atual.

**Architecture:** O ranking usa o `porMlb` que o Motor de Margem já monta pro período INTEIRO independente de `itemIds` (custo pago hoje mesmo). O backend busca só as CHAVES (grupo_key/family_id/item_id) do catálogo filtrado inteiro (query leve, sem os agregados pesados), roda o Motor uma vez (`itemIds: []`, sem custo de `enrichBatch`), ordena em JS, corta a página e só então hidrata os detalhes completos (título, preço, capa etc.) dos itens daquela página — reaproveitando 100% do código de hidratação que já existe. Margem e Unidades vendidas continuam ordenação local (client-side, dentro da página), sem mudança de comportamento, só relabeling.

**Tech Stack:** Node.js + `pg` (raw SQL, sem ORM), testes com `assert` nativo + MockDb caseiro (sem Jest), frontend vanilla JS (`Portal/anuncios-meli.js`), testes de UI headless via CDP (`Portal/anuncios-meli-listagem-unificada-ui.test.js`).

**Spec:** Decisão de implementação do usuário nesta conversa (ordenação global só para % Faturamento e Curva ABC; Margem/Unidades continuam locais só com relabel; contrato de resposta usa campos semânticos `faturamentoPercentual`/`curvaAbc`, nunca um campo genérico).

## Global Constraints

- NÃO implementar ordenação global para Margem nem Unidades vendidas — ficam como ordenação client-side de página, só o rótulo do `<select>` muda.
- Resposta de `GET /anuncios-meli/familias` com `ordenarPor` ativo usa campos semânticos por critério (`faturamentoPercentual` OU `curvaAbc`), nunca um campo genérico tipo `ordenacaoValor`.
- Comportamento SEM `ordenarPor` (ou com valor inválido) tem de ficar byte-a-byte idêntico ao atual — é o path testado há mais tempo, zero regressão tolerada.
- Família usa sempre o agregado `porFamilia` (nunca herda do filho mais forte) — mesma regra que já existe em `montarFaturamento`/`montarCurvaAbc`.
- Motor indisponível (Base não vinculada etc.) nunca pode virar erro 500 nem ordenação "quebrada" — cai no SQL padrão com aviso explícito (`ordenacaoAplicada: false`).
- Nunca trazer o catálogo inteiro para o frontend — o ranking completo mora e morre no backend; só a página final viaja pela rede.
- `PERFORMANCE_MAX_ITENS = 24` (`server/controllers/meliAnunciosController.js:362`) não pode ser tocado nem contornado por este trabalho.
- **Eliminação completa da ordenação client-side para os critérios globais** (reforço explícito, ver Task 6): quando `AM.ordenarPor` é `faturamento_*`/`curvaAbc_*`, (a) `AM.anuncios` é atribuído UMA VEZ, direto de `r.data.anuncios`, e nunca mais reordenado no frontend; (b) `aplicarOrdenacaoPerformance()` NUNCA é chamada nesse caminho — só no ramo `else` (Margem/Unidades); (c) trocar de página manda o MESMO `ordenarPor` de novo e o `<select>` permanece com o critério selecionado, nunca reseta para "Padrão". Isso é o que corrige a causa raiz relatada (página 2 "reiniciando" o ranking) — não é um efeito colateral, é o critério de aceite da correção.

---

## Task 1: Extrair `montarAnunciosDeRows` (refactor puro, sem mudança de comportamento)

**Files:**
- Modify: `server/services/meliAnuncios/meliFamiliaService.js:240-551` (função `listarAgrupado`)
- Test: `server/tests/meliAnunciosFamilias.test.js` (suíte existente é o gate de regressão — nenhum teste novo nesta task)

**Interfaces:**
- Produces: `async function montarAnunciosDeRows(rows, { clienteId, clienteContaId, includeLegacy, termo })` — recebe as linhas já agregadas (mesmo shape de `rows` que a query `LISTAR_AGRUPADO_PAGINA` devolve hoje: `grupo_key, family_id, family_name, item_id, total_itens, total_user_products, vendidos_total, preco_min, preco_max, moeda, score_min, total_ativos, total_pausados, total_encerrados, estoque_total`) e devolve o array `anuncios` no MESMO shape de hoje (`tipo: "familia"|"item"`, com `cover`, etc.). Consumida por `listarAgrupado` (Task 1) e pela nova `listarAgrupadoOrdenadoPorMotor` (Task 5).

- [ ] **Step 1: Rodar a suíte atual e guardar a saída como baseline**

Run: `node server/tests/meliAnunciosFamilias.test.js`
Expected: `meliAnunciosFamilias.test.js passed` (saída completa sem erro — esta é a rede de segurança do refactor, não há teste novo a escrever para uma extração pura).

- [ ] **Step 2: Extrair o corpo de hidratação para `montarAnunciosDeRows`**

Em `server/services/meliAnuncios/meliFamiliaService.js`, mova o bloco que hoje começa em `const familyIds = rows.filter(...)` (linha ~374) e termina em `return anuncios;` implícito (a construção de `const anuncios = rows.map(...)`, linha ~482-540) para uma nova função:

```js
// Hidrata um conjunto de linhas já agregadas (grupo_key/family_id/item_id +
// agregados) com os detalhes completos que a tela precisa: item avulso
// (query 2) e capa de família (query 3). Não decide QUAIS grupos entram —
// só enche o que já foi decidido por quem chamou (paginação SQL comum ou
// ranking do Motor, ver listarAgrupadoOrdenadoPorMotor).
async function montarAnunciosDeRows(rows, { clienteId, clienteContaId = null, includeLegacy = true, termo = "" } = {}) {
  const familyIds = rows.filter((r) => r.family_id != null).map((r) => r.family_id);
  const itemIds = rows.filter((r) => r.family_id == null).map((r) => r.item_id);

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

  return rows.map((r) => {
    if (r.family_id != null) {
      return {
        tipo: "familia",
        key: r.grupo_key,
        family_id: r.family_id,
        family_name: r.family_name,
        titulo: r.family_name,
        total_user_products: r.total_user_products,
        total_itens: r.total_itens,
        estoque_total: r.estoque_total,
        vendidos_total: r.vendidos_total,
        preco_min: r.preco_min,
        preco_max: r.preco_max,
        moeda: r.moeda,
        score_min: r.score_min,
        status_contagem: {
          ativos: r.total_ativos,
          pausados: r.total_pausados,
          encerrados: r.total_encerrados,
        },
        cover: capaPorFamilia.get(r.family_id) || { thumbnail: null, user_product_id: null },
      };
    }

    const item = itemPorId.get(r.item_id) || { item_id: r.item_id };
    return Object.assign({}, item, {
      tipo: "item",
      key: r.grupo_key,
      family_id: null,
      total_itens: 1,
      total_user_products: r.total_user_products,
      estoque_total: r.estoque_total,
      vendidos_total: r.vendidos_total,
      cover: { thumbnail: item.thumbnail == null ? null : item.thumbnail, user_product_id: item.user_product_id || null },
      variations_count: item.variations_count || 0,
    });
  });
}
```

(Copie literalmente o corpo já existente — este passo NÃO muda nenhuma linha de lógica, só move e dá nome à função. `clausulaConta` e `db` já estão importados no topo do arquivo.)

- [ ] **Step 3: Reduzir `listarAgrupado` para usar a função extraída**

```js
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
  await require("./meliAnunciosService").ensureSchema();

  const { params, nextParamIndex, conta, matchSql } = construirFiltroBase({
    clienteId, clienteContaId, includeLegacy, q, status, filtro,
  });
  let i = nextParamIndex;

  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const pag = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (pag - 1) * lim;
  params.push(lim, offset);
  const limIdx = i;
  const offIdx = i + 1;

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

  const anuncios = await montarAnunciosDeRows(rows, {
    clienteId, clienteContaId, includeLegacy, termo: String(q || "").trim(),
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
```

Note: a query SQL em si (o texto entre `LISTAR_AGRUPADO_PAGINA`) fica IDÊNTICA à de hoje — só a montagem de `params`/`conta`/`matchSql` migrou para `construirFiltroBase` (ver abaixo) e a hidratação migrou para `montarAnunciosDeRows`.

- [ ] **Step 4: Adicionar `construirFiltroBase` (extração da montagem de params/conta/match)**

Logo acima de `listarAgrupado`, adicione:

```js
// Monta os predicados COMUNS a qualquer leitura do catálogo agrupado
// (LISTAR_AGRUPADO_PAGINA, LISTAR_CHAVES_FILTRADAS): filtro de conta
// (clausulaConta) + busca/status/filtro (match por item, o grupo entra se
// QUALQUER item dele casar). Devolve `nextParamIndex` para quem monta a
// query poder continuar empilhando params próprios (ex.: limit/offset).
function construirFiltroBase({ clienteId, clienteContaId = null, includeLegacy = true, q = "", status = "", filtro = "" }) {
  const params = [clienteId];
  let i = 2;

  const conta = clausulaConta({ clienteContaId, includeLegacy, paramIndex: i });
  if (conta.param != null) { params.push(conta.param); i++; }

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

  return { params, nextParamIndex: i, conta, matchSql };
}
```

- [ ] **Step 5: Rodar a suíte de novo e confirmar zero regressão**

Run: `node server/tests/meliAnunciosFamilias.test.js`
Expected: `meliAnunciosFamilias.test.js passed`, mesmíssima contagem de `✓` de antes do refactor (nenhuma asserção pode mudar de comportamento).

- [ ] **Step 6: Exportar as duas novas funções internas (para Task 2/3/5 reaproveitarem)**

Em `module.exports` (linha ~689), adicione `construirFiltroBase` e `montarAnunciosDeRows`:

```js
module.exports = {
  ensureSchema,
  extrairUserProducts,
  registrarUserProducts,
  listarAgrupado,
  obterFamiliaDetalhe,
  resolverItensDeFamilias,
  construirFiltroBase,
  montarAnunciosDeRows,
};
```

- [ ] **Step 7: Commit**

```bash
git add server/services/meliAnuncios/meliFamiliaService.js
git commit -m "refactor(anuncios-ml): extrai construirFiltroBase e montarAnunciosDeRows de listarAgrupado"
```

---

## Task 2: `listarChavesFiltradas` — catálogo filtrado inteiro, só chaves

**Files:**
- Modify: `server/services/meliAnuncios/meliFamiliaService.js`
- Test: `server/tests/meliAnunciosFamilias.test.js`

**Interfaces:**
- Consumes: `construirFiltroBase` (Task 1).
- Produces: `async function listarChavesFiltradas({ clienteId, clienteContaId, includeLegacy, q, status, filtro })` → `Promise<Array<{ grupo_key: string, family_id: string|null, item_id: string }>>`, SEM limit/offset — todo o catálogo que bate no filtro. Consumida por `listarAgrupadoOrdenadoPorMotor` (Task 5).

- [ ] **Step 1: Escrever o teste (vai falhar — função ainda não existe)**

Em `server/tests/meliAnunciosFamilias.test.js`, logo antes de `console.log("meliAnunciosFamilias.test.js passed");` (linha ~1227), adicione o handler de mock e os testes:

Primeiro, adicione o handler da nova query no `MockDb.query` (dentro da classe, logo depois do bloco `-- LISTAR_AGRUPADO_PAGINA`, antes de `-- LISTAR_AGRUPADO_ITENS_DA_PAGINA`, por volta da linha 328):

```js
    // --- LISTAR_CHAVES_FILTRADAS --------------------------------------------
    if (q.includes("-- LISTAR_CHAVES_FILTRADAS")) {
      let i = 0;
      const clienteId = params[i++];
      const temConta = q.includes("a.cliente_conta_id = $");
      const includeLegacy = temConta ? q.includes("OR a.cliente_conta_id IS NULL)") : true;
      const clienteContaId = temConta ? params[i++] : null;
      const temQ = q.includes("b.titulo ILIKE $");
      const qTerm = temQ ? String(params[i++]).replace(/^%|%$/g, "").toLowerCase() : null;
      const temStatus = q.includes("b.status = $");
      const statusParam = temStatus ? params[i++] : null;

      const whereMatch = (q.match(/FROM base b WHERE (.*?) \)/) || [])[1] || "TRUE";
      const base = this.baseCte(clienteId, clienteContaId, includeLegacy);
      const selecionados = base.filter((l) => casaSelecionado(whereMatch, l, qTerm, statusParam));

      const grupos = new Map();
      for (const linha of selecionados) {
        const g = grupos.get(linha.grupo_key) || { grupo_key: linha.grupo_key, family_id: null, item_id: null };
        if (g.family_id == null) g.family_id = linha.family_id;
        if (g.item_id == null || String(linha.a.item_id) < g.item_id) g.item_id = String(linha.a.item_id);
        grupos.set(linha.grupo_key, g);
      }
      return { rows: Array.from(grupos.values()) };
    }

```

Agora os testes:

```js
  // AJ. listarChavesFiltradas devolve TODO o catálogo filtrado, sem
  //     LIMIT/OFFSET — é a base do ranking global (ver Task 5).
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB1", user_product_id: null }),
      anuncioFixture({ item_id: "MLB2", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB3", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB4", user_product_id: null, status: "paused" }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    const chaves = await meliFamiliaService.listarChavesFiltradas({ clienteId: 1 });
    const porChave = new Map(chaves.map((c) => [c.grupo_key, c]));
    assert.strictEqual(chaves.length, 3, "MLB2+MLB3 colapsam em 1 grupo (FAM1); MLB1 e MLB4 ficam avulsos");
    assert.strictEqual(porChave.get("fam:FAM1").item_id, "MLB2");
    assert.strictEqual(porChave.get("item:MLB1").family_id, null);
    console.log("  ✓ AJ. listarChavesFiltradas: catálogo inteiro, sem paginação, família colapsada");
  });

  // AK. listarChavesFiltradas respeita status/q — mesmo predicado de
  //     listarAgrupado (casaSelecionado), nunca lista item fora do filtro.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB1", status: "active" }),
      anuncioFixture({ item_id: "MLB2", status: "paused" }),
    ],
    userProducts: [],
  }, async () => {
    const chaves = await meliFamiliaService.listarChavesFiltradas({ clienteId: 1, status: "paused" });
    assert.deepStrictEqual(chaves.map((c) => c.item_id), ["MLB2"]);
    console.log("  ✓ AK. listarChavesFiltradas: filtro de status restringe o catálogo inteiro");
  });

  // AL. clienteContaId isola o catálogo — mesma garantia de sempre.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-C10", cliente_conta_id: 10 }),
      anuncioFixture({ item_id: "MLB-C11", cliente_conta_id: 11 }),
    ],
    userProducts: [],
  }, async () => {
    const chaves = await meliFamiliaService.listarChavesFiltradas({
      clienteId: 1, clienteContaId: 10, includeLegacy: false,
    });
    assert.deepStrictEqual(chaves.map((c) => c.item_id), ["MLB-C10"]);
    console.log("  ✓ AL. listarChavesFiltradas isola por clienteContaId");
  });

```

- [ ] **Step 2: Rodar e confirmar que falha (função não existe)**

Run: `node server/tests/meliAnunciosFamilias.test.js`
Expected: `TypeError: meliFamiliaService.listarChavesFiltradas is not a function`

- [ ] **Step 3: Implementar `listarChavesFiltradas`**

Em `server/services/meliAnuncios/meliFamiliaService.js`, logo depois de `listarAgrupado`:

```js
// Todo o catálogo filtrado (mesmo predicado de listarAgrupado), SEM
// LIMIT/OFFSET e sem os agregados pesados (estoque/vendidos/preço) — só as
// chaves que o ranking do Motor precisa (ver meliAnunciosController.
// listarAgrupadoOrdenadoPorMotor). Aggregados completos de uma chave
// específica vêm depois, só para a página final, via listarAgrupadoPorChaves.
async function listarChavesFiltradas({ clienteId, clienteContaId = null, includeLegacy = true, q = "", status = "", filtro = "" }) {
  await ensureSchema();

  const { params, conta, matchSql } = construirFiltroBase({
    clienteId, clienteContaId, includeLegacy, q, status, filtro,
  });

  const sql = `
    -- LISTAR_CHAVES_FILTRADAS
    WITH base AS (
      SELECT a.item_id, a.user_product_id, a.titulo, a.sku, a.status,
             up.family_id, up.family_name AS up_family_name,
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
    selecionados AS (
      SELECT DISTINCT b.grupo_key FROM base b WHERE ${matchSql}
    )
    SELECT b.grupo_key, MIN(b.family_id) AS family_id, MIN(b.item_id) AS item_id
      FROM base b
      JOIN selecionados s ON s.grupo_key = b.grupo_key
     GROUP BY b.grupo_key;
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node server/tests/meliAnunciosFamilias.test.js`
Expected: `meliAnunciosFamilias.test.js passed`, incluindo `✓ AJ.`, `✓ AK.`, `✓ AL.`

- [ ] **Step 5: Exportar**

```js
module.exports = {
  ensureSchema,
  extrairUserProducts,
  registrarUserProducts,
  listarAgrupado,
  obterFamiliaDetalhe,
  resolverItensDeFamilias,
  construirFiltroBase,
  montarAnunciosDeRows,
  listarChavesFiltradas,
};
```

- [ ] **Step 6: Commit**

```bash
git add server/services/meliAnuncios/meliFamiliaService.js server/tests/meliAnunciosFamilias.test.js
git commit -m "feat(anuncios-ml): listarChavesFiltradas — catalogo filtrado inteiro sem paginacao"
```

---

## Task 3: `listarAgrupadoPorChaves` — hidrata agregados de um conjunto explícito de grupos

**Files:**
- Modify: `server/services/meliAnuncios/meliFamiliaService.js`
- Test: `server/tests/meliAnunciosFamilias.test.js`

**Interfaces:**
- Consumes: `construirFiltroBase`'s `conta` (reaproveita só a cláusula de conta, não o match de busca — aqui quem decide os grupos é a lista de `grupoKeys`, não `q`/`status`/`filtro`), `montarAnunciosDeRows` (Task 1).
- Produces: `async function listarAgrupadoPorChaves({ clienteId, clienteContaId, includeLegacy, grupoKeys })` → `Promise<Array<row>>` no MESMO shape das rows de `LISTAR_AGRUPADO_PAGINA` (sem `total_grupos`), na ORDEM que o Postgres devolver (quem chama reordena). Consumida por `listarAgrupadoOrdenadoPorMotor` (Task 5).

- [ ] **Step 1: Escrever o teste (vai falhar)**

No `MockDb.query`, adicione o handler logo depois do bloco `-- LISTAR_CHAVES_FILTRADAS` (Task 2):

```js
    // --- LISTAR_AGRUPADO_POR_CHAVES -----------------------------------------
    if (q.includes("-- LISTAR_AGRUPADO_POR_CHAVES")) {
      let i = 0;
      const clienteId = params[i++];
      const temConta = q.includes("a.cliente_conta_id = $");
      const includeLegacy = temConta ? q.includes("OR a.cliente_conta_id IS NULL)") : true;
      const clienteContaId = temConta ? params[i++] : null;
      const grupoKeysAlvo = new Set(params[i++]);

      const base = this.baseCte(clienteId, clienteContaId, includeLegacy)
        .filter((l) => grupoKeysAlvo.has(l.grupo_key));

      const estoquePorGrupo = new Map();
      for (const linha of base) {
        const upKey = linha.a.user_product_id || `item:${linha.a.item_id}`;
        const porUp = estoquePorGrupo.get(linha.grupo_key) || new Map();
        const atual = porUp.has(upKey) ? porUp.get(upKey) : null;
        const valor = linha.a.estoque == null ? null : Number(linha.a.estoque);
        porUp.set(upKey, atual == null ? valor : (valor == null ? atual : Math.max(atual, valor)));
        estoquePorGrupo.set(linha.grupo_key, porUp);
      }

      const num = (v) => (v == null ? null : Number(v));
      const grupos = new Map();
      for (const linha of base) {
        const g = grupos.get(linha.grupo_key) || {
          grupo_key: linha.grupo_key, family_id: linha.family_id, family_name: null, item_id: null,
          total_itens: 0, ups: new Set(), vendidos_total: 0,
          preco_min: null, preco_max: null, moeda: null, score_min: null,
          total_ativos: 0, total_pausados: 0, total_encerrados: 0,
        };
        const a = linha.a;
        g.total_itens++;
        if (a.user_product_id) g.ups.add(a.user_product_id);
        if (linha.up_family_name != null) {
          g.family_name = g.family_name == null || linha.up_family_name > g.family_name
            ? linha.up_family_name : g.family_name;
        }
        g.item_id = g.item_id == null || String(a.item_id) < g.item_id ? String(a.item_id) : g.item_id;
        g.vendidos_total += Number(a.vendidos || 0);
        if (num(a.preco) != null) {
          g.preco_min = g.preco_min == null ? num(a.preco) : Math.min(g.preco_min, num(a.preco));
          g.preco_max = g.preco_max == null ? num(a.preco) : Math.max(g.preco_max, num(a.preco));
        }
        if (a.moeda != null) g.moeda = g.moeda == null || a.moeda < g.moeda ? a.moeda : g.moeda;
        if (num(a.score_venforce) != null) {
          g.score_min = g.score_min == null ? num(a.score_venforce) : Math.min(g.score_min, num(a.score_venforce));
        }
        if (a.status === "active") g.total_ativos++;
        if (a.status === "paused") g.total_pausados++;
        if (a.status === "closed") g.total_encerrados++;
        grupos.set(linha.grupo_key, g);
      }

      const rows = Array.from(grupos.values()).map((g) => {
        const porUp = estoquePorGrupo.get(g.grupo_key) || new Map();
        let estoqueTotal = null;
        for (const v of porUp.values()) {
          if (v == null) continue;
          estoqueTotal = (estoqueTotal == null ? 0 : estoqueTotal) + v;
        }
        return {
          grupo_key: g.grupo_key, family_id: g.family_id, family_name: g.family_name, item_id: g.item_id,
          total_itens: g.total_itens, total_user_products: g.ups.size, vendidos_total: g.vendidos_total,
          preco_min: g.preco_min, preco_max: g.preco_max, moeda: g.moeda, score_min: g.score_min,
          total_ativos: g.total_ativos, total_pausados: g.total_pausados, total_encerrados: g.total_encerrados,
          estoque_total: estoqueTotal,
        };
      });
      return { rows };
    }

```

Testes:

```js
  // AM. listarAgrupadoPorChaves hidrata SÓ as chaves pedidas, com os mesmos
  //     agregados de listarAgrupado (estoque por UP distinto, vendidos por
  //     item) — nenhum grupo fora da lista aparece.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB1", user_product_id: null, vendidos: 3 }),
      anuncioFixture({ item_id: "MLB2", user_product_id: "UP1", estoque: 5 }),
      anuncioFixture({ item_id: "MLB3", user_product_id: "UP1", estoque: 5 }), // mesmo UP: não duplica estoque
      anuncioFixture({ item_id: "MLB-FORA", user_product_id: null }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    const rows = await meliFamiliaService.listarAgrupadoPorChaves({
      clienteId: 1, grupoKeys: ["item:MLB1", "fam:FAM1"],
    });
    const porChave = new Map(rows.map((r) => [r.grupo_key, r]));
    assert.strictEqual(rows.length, 2, "MLB-FORA não pode aparecer — não estava em grupoKeys");
    assert.strictEqual(porChave.get("item:MLB1").vendidos_total, 3);
    assert.strictEqual(porChave.get("fam:FAM1").estoque_total, 5, "UP1 tem 2 MLBs — estoque conta 1 vez");
    console.log("  ✓ AM. listarAgrupadoPorChaves: hidrata só as chaves pedidas, agregados corretos");
  });

  // AN. grupoKeys vazio: zero linhas, sem quebrar.
  await withMockDb({ anuncios: [], userProducts: [] }, async () => {
    const rows = await meliFamiliaService.listarAgrupadoPorChaves({ clienteId: 1, grupoKeys: [] });
    assert.deepStrictEqual(rows, []);
    console.log("  ✓ AN. listarAgrupadoPorChaves com grupoKeys vazio: array vazio");
  });

```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node server/tests/meliAnunciosFamilias.test.js`
Expected: `TypeError: meliFamiliaService.listarAgrupadoPorChaves is not a function`

- [ ] **Step 3: Implementar `listarAgrupadoPorChaves`**

```js
// Hidrata os AGREGADOS completos (estoque por UP distinto, vendidos por
// item, preço/score/status) de um conjunto EXPLÍCITO de grupo_key — usado
// quando quem decide a ordem/página não é o SQL (ORDER BY/LIMIT/OFFSET de
// listarAgrupado), e sim um ranking já calculado em JS (ver
// meliAnunciosController.listarAgrupadoOrdenadoPorMotor). Mesma forma de
// linha de LISTAR_AGRUPADO_PAGINA, sem total_grupos (quem chama já sabe o
// total pelo tamanho do ranking).
async function listarAgrupadoPorChaves({ clienteId, clienteContaId = null, includeLegacy = true, grupoKeys }) {
  if (!grupoKeys || !grupoKeys.length) return [];
  await ensureSchema();

  const params = [clienteId];
  let i = 2;
  const conta = clausulaConta({ clienteContaId, includeLegacy, paramIndex: i });
  if (conta.param != null) { params.push(conta.param); i++; }
  params.push(grupoKeys);
  const chavesIdx = i;

  const sql = `
    -- LISTAR_AGRUPADO_POR_CHAVES
    WITH base AS (
      SELECT a.item_id, a.user_product_id, a.titulo, a.sku, a.status,
             a.preco, a.moeda, a.estoque, a.vendidos, a.score_venforce,
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
       WHERE b.grupo_key = ANY($${chavesIdx}::text[])
       GROUP BY b.grupo_key, COALESCE(b.user_product_id, 'item:' || b.item_id)
    ),
    estoque_grupo AS (
      SELECT grupo_key, SUM(estoque)::int AS estoque_total
        FROM estoque_por_up
       GROUP BY grupo_key
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
             COUNT(*) FILTER (WHERE b.status = 'closed')::int AS total_encerrados
        FROM base b
       WHERE b.grupo_key = ANY($${chavesIdx}::text[])
       GROUP BY b.grupo_key
    )
    SELECT g.grupo_key, g.family_id, g.family_name, g.item_id,
           g.total_itens, g.total_user_products, g.vendidos_total,
           g.preco_min, g.preco_max, g.moeda, g.score_min,
           g.total_ativos, g.total_pausados, g.total_encerrados,
           e.estoque_total
      FROM grupos g
      LEFT JOIN estoque_grupo e ON e.grupo_key = g.grupo_key;
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node server/tests/meliAnunciosFamilias.test.js`
Expected: `meliAnunciosFamilias.test.js passed`, incluindo `✓ AM.`, `✓ AN.`

- [ ] **Step 5: Exportar**

```js
module.exports = {
  ensureSchema,
  extrairUserProducts,
  registrarUserProducts,
  listarAgrupado,
  obterFamiliaDetalhe,
  resolverItensDeFamilias,
  construirFiltroBase,
  montarAnunciosDeRows,
  listarChavesFiltradas,
  listarAgrupadoPorChaves,
};
```

- [ ] **Step 6: Commit**

```bash
git add server/services/meliAnuncios/meliFamiliaService.js server/tests/meliAnunciosFamilias.test.js
git commit -m "feat(anuncios-ml): listarAgrupadoPorChaves — hidrata agregados de um conjunto explicito de grupos"
```

---

## Task 4: Exportar `montarFaturamento`/`montarCurvaAbc` do controller

**Files:**
- Modify: `server/controllers/meliAnunciosController.js:500-566` (definições), `:2208-2236` (`module.exports`)
- Test: nenhum novo — são funções puras já cobertas indiretamente; a cobertura direta vem na Task 5.

**Interfaces:**
- Produces: `montarFaturamento(porMlb, itemIds, periodo, porFamiliaItens)` e `montarCurvaAbc(porMlb, itemIds, periodo, porFamiliaItens)` passam a ser exportadas, com a MESMA assinatura de hoje (nenhuma mudança de código nelas). Consumidas por `listarAgrupadoOrdenadoPorMotor` (Task 5) dentro do MESMO arquivo (chamada direta, sem `require` circular).

- [ ] **Step 1: Adicionar as duas funções ao `module.exports`**

Em `server/controllers/meliAnunciosController.js`, no bloco `module.exports` (linha ~2208):

```js
module.exports = {
  listarClientes,
  sincronizar,
  resumo,
  listar,
  listarAgrupado,
  detalheFamilia,
  performance,
  detalhe,
  variacoesLegado,
  promocoes,
  aplicarPromocao,
  atualizarEstoqueVariacaoLegado,
  atualizarConteudo,
  atualizarEstoque,
  atualizarPreco,
  simularMargem,
  marcarRevisado,
  otimizar,
  listarOtimizacoes,
  aprovarOtimizacao,
  criacaoStatus,
  criacaoCategorias,
  criacaoAtributos,
  criacaoSaleTerms,
  criacaoListingTypes,
  publicarAnuncio,
  retryPrecosAtacado,
  montarFaturamento,
  montarCurvaAbc,
};
```

- [ ] **Step 2: Rodar a suíte de performance (regressão — nada deve mudar)**

Run: `node server/tests/meliAnunciosPerformance.test.js`
Expected: passa exatamente como antes (só adicionamos exports, nenhuma linha de comportamento mudou).

- [ ] **Step 3: Commit**

```bash
git add server/controllers/meliAnunciosController.js
git commit -m "refactor(anuncios-ml): exporta montarFaturamento/montarCurvaAbc para reaproveitar na ordenacao global"
```

---

## Task 5: `ordenarPor` em `GET /anuncios-meli/familias` — orquestração + fallback

**Files:**
- Modify: `server/controllers/meliAnunciosController.js:227-266` (`listarAgrupado`, handler HTTP — mesmo nome de função que o service, mas é o controller)
- Test: Create: `server/tests/meliAnunciosOrdenacaoGlobal.test.js`

**Interfaces:**
- Consumes: `familiaService.listarChavesFiltradas`, `familiaService.resolverItensDeFamilias`, `familiaService.listarAgrupadoPorChaves`, `familiaService.montarAnunciosDeRows` (Tasks 1-3), `familiaService.listarAgrupado` (fallback), `motorMargemService.montarItens`, `montarFaturamento`/`montarCurvaAbc` (Task 4, mesmo arquivo).
- Produces: resposta HTTP de `GET /anuncios-meli/familias?...&ordenarPor=` com `{ ok, cliente, anuncios, paginacao, ordenacaoAplicada, ordenacaoIndisponivel }`. `anuncios[i].faturamentoPercentual` (fração 0..1, mesma escala de `montarFaturamento`) quando `ordenarPor` é `faturamento_*`; `anuncios[i].curvaAbc` ("A"|"B"|"C"|null) quando é `curvaAbc_*`. Nenhum dos dois campos aparece quando `ordenarPor` está ausente/inválido.

- [ ] **Step 1: Escrever o teste (vai falhar — comportamento não existe)**

Create `server/tests/meliAnunciosOrdenacaoGlobal.test.js`:

```js
// server/tests/meliAnunciosOrdenacaoGlobal.test.js
//
// GET /anuncios-meli/familias?ordenarPor= — ordenação GLOBAL contra o
// catálogo filtrado inteiro (Faturamento % e Curva ABC), corrigindo o bug em
// que a ordenação por performance só valia dentro da página atual. Margem e
// Unidades vendidas NÃO entram aqui — continuam locais (ver
// Portal/anuncios-meli.js aplicarOrdenacaoPerformance).
//
// O que este teste protege:
//   1. sequência monotônica cruzando a fronteira de página (o bug relatado:
//      pág.1 10/9/8 -> pág.2 7/6/5, nunca 20/15/12);
//   2. família usa SEMPRE o agregado porFamilia, nunca o filho mais forte;
//   3. item sem receita no período fica no fim, nas duas direções;
//   4. Motor indisponível cai no SQL padrão com ordenacaoAplicada:false;
//   5. sem ordenarPor (ou valor inválido de margem/unidades), resposta
//      idêntica ao path antigo — regressão zero;
//   6. clienteContaId isola o ranking (nunca mistura receita de outra conta).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const Module = require("module");

let motorHandler = null; // ({ clienteSlug, clienteContaId, itemIds }) => { porMlb, periodo } ou throw

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "../services/motorMargem/motorMargemService") {
    return {
      async montarItens(args) {
        if (!motorHandler) return { porMlb: new Map(), periodo: {} };
        return motorHandler(args);
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pool = require("../config/database");
const ctrl = require("../controllers/meliAnunciosController");

Module._load = originalLoad;

// ── fixtures (mesmo padrão de meliAnunciosFamilias.test.js) ────────────────

const cliente = { id: 1, nome: "Cliente A", slug: "cliente-a", ativo: true };

function grantFixture({ id, cliente_id, ml_user_id }) {
  return {
    id, cliente_id, ml_user_id,
    access_token: "tok", refresh_token: "ref",
    expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    token_status: "valid", is_primary: false,
    refresh_failures: 0, updated_at: new Date().toISOString(),
  };
}

function anuncioFixture(over = {}) {
  return {
    cliente_id: 1, item_id: "MLB1", user_product_id: null, cliente_conta_id: 10,
    titulo: "Produto", status: "active", preco: 10, moeda: "BRL", estoque: 5, vendidos: 0,
    sku: "SKU1", thumbnail: null, permalink: null, pictures_count: 0, is_full: false,
    revisado: false, score_venforce: null, score_motivo: null, catalog_listing: false,
    family_name: null, updated_at: null, ...over,
  };
}

function upFixture(over = {}) {
  return { cliente_id: 1, user_product_id: "UP1", family_id: "FAM1", family_name: "Familia 1", ...over };
}

// ── MockDb — reaproveita só o suficiente pra rodar as queries reais de
//    meliFamiliaService por baixo do controller (mesma técnica de
//    meliAnunciosFamilias.test.js, resumida ao necessário aqui) ────────────

function contaFiltro(a, clienteContaId, includeLegacy) {
  if (clienteContaId == null) return true;
  if (includeLegacy) return a.cliente_conta_id === clienteContaId || a.cliente_conta_id == null;
  return a.cliente_conta_id === clienteContaId;
}

class MockDb {
  constructor({ contas = [], grants = [], anuncios = [], userProducts = [] } = {}) {
    this.contas = contas; this.grants = grants; this.anuncios = anuncios; this.userProducts = userProducts;
  }
  async connect() { return { query: (sql, params) => this.query(sql, params), release() {} }; }
  upFor(clienteId, userProductId) {
    return this.userProducts.find((u) => u.cliente_id === clienteId && u.user_product_id === userProductId);
  }
  baseCte(clienteId, clienteContaId, includeLegacy) {
    return this.anuncios
      .filter((a) => a.cliente_id === clienteId && contaFiltro(a, clienteContaId, includeLegacy))
      .map((a) => {
        const up = a.user_product_id ? this.upFor(clienteId, a.user_product_id) : null;
        const familyId = up && up.family_id != null ? up.family_id : null;
        return { a, family_id: familyId, up_family_name: up ? up.family_name : null,
          grupo_key: familyId != null ? `fam:${familyId}` : `item:${a.item_id}` };
      });
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q.includes("FROM clientes WHERE id = $1")) return { rows: cliente.id === Number(params[0]) ? [cliente] : [] };
    if (q.includes("FROM clientes WHERE LOWER(slug) = $1")) return { rows: cliente.slug === params[0] ? [cliente] : [] };
    if (q.startsWith("SELECT * FROM cliente_contas WHERE id = $1")) {
      const conta = this.contas.find((c) => c.id === Number(params[0]));
      return { rows: conta ? [conta] : [] };
    }
    if (q.includes("FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true ORDER BY is_primary")) {
      return { rows: this.contas.filter((c) => c.cliente_id === params[0] && c.marketplace === params[1] && c.ativo !== false) };
    }
    if (q.includes("t.cliente_id = $1 AND t.ml_user_id = $2")) {
      const row = this.grants.find((g) => g.cliente_id === params[0] && String(g.ml_user_id) === String(params[1]));
      return { rows: row ? [row] : [] };
    }
    if (q.includes("base_cliente_vinculos")) return { rows: [] };
    if (q.startsWith("CREATE TABLE") || q.startsWith("ALTER TABLE") || q.startsWith("CREATE INDEX")) return { rows: [] };

    if (q.includes("-- LISTAR_CHAVES_FILTRADAS") || q.includes("-- LISTAR_AGRUPADO_PAGINA")) {
      let i = 0;
      const clienteId = params[i++];
      const temConta = q.includes("a.cliente_conta_id = $");
      const includeLegacy = temConta ? q.includes("OR a.cliente_conta_id IS NULL)") : true;
      const clienteContaId = temConta ? params[i++] : null;
      const base = this.baseCte(clienteId, clienteContaId, includeLegacy);
      const grupos = new Map();
      for (const linha of base) {
        const g = grupos.get(linha.grupo_key) || { grupo_key: linha.grupo_key, family_id: null, item_id: null, total_grupos: 0 };
        if (g.family_id == null) g.family_id = linha.family_id;
        if (g.item_id == null || String(linha.a.item_id) < g.item_id) g.item_id = String(linha.a.item_id);
        grupos.set(linha.grupo_key, g);
      }
      const lista = Array.from(grupos.values());
      lista.forEach((g) => { g.total_grupos = lista.length; });
      if (q.includes("-- LISTAR_AGRUPADO_PAGINA")) {
        const lim = params[params.length - 2];
        const offset = params[params.length - 1];
        return { rows: lista.slice(offset, offset + lim) };
      }
      return { rows: lista };
    }

    if (q.includes("-- LISTAR_AGRUPADO_POR_CHAVES")) {
      const chaves = new Set(params[params.length - 1]);
      const base = this.baseCte(params[0], null, true).filter((l) => chaves.has(l.grupo_key));
      const grupos = new Map();
      for (const linha of base) {
        const g = grupos.get(linha.grupo_key) || { grupo_key: linha.grupo_key, family_id: linha.family_id, family_name: null, item_id: null, total_itens: 0, total_user_products: 0, vendidos_total: 0, preco_min: null, preco_max: null, moeda: null, score_min: null, total_ativos: 0, total_pausados: 0, total_encerrados: 0, estoque_total: null };
        g.item_id = g.item_id == null || String(linha.a.item_id) < g.item_id ? String(linha.a.item_id) : g.item_id;
        grupos.set(linha.grupo_key, g);
      }
      return { rows: Array.from(grupos.values()) };
    }

    if (q.includes("-- LISTAR_AGRUPADO_ITENS_DA_PAGINA")) {
      const itemIds = new Set(params[params.length - 1]);
      return { rows: this.anuncios.filter((a) => itemIds.has(a.item_id)).map((a) => ({ ...a })) };
    }
    if (q.includes("-- LISTAR_FAMILIAS_CAPA_DA_PAGINA")) return { rows: [] };
    if (q.includes("FAMILIAS_ITENS_BULK")) {
      const familyIds = new Set(params[params.length - 1]);
      const porFamilia = new Map();
      for (const a of this.anuncios) {
        const up = a.user_product_id ? this.upFor(a.cliente_id, a.user_product_id) : null;
        if (!up || !familyIds.has(up.family_id)) continue;
        if (!porFamilia.has(up.family_id)) porFamilia.set(up.family_id, []);
        porFamilia.get(up.family_id).push(a.item_id);
      }
      return { rows: Array.from(porFamilia.entries()).flatMap(([familyId, itens]) => itens.map((item_id) => ({ family_id: familyId, item_id }))) };
    }

    throw new Error("MockDb: query não reconhecida: " + q.slice(0, 120));
  }
}

function withMockDb(dbOpts, fn) {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const db = new MockDb(dbOpts);
  pool.query = (sql, params) => db.query(sql, params);
  pool.connect = () => db.connect();
  return Promise.resolve().then(() => fn(db)).finally(() => { pool.query = originalQuery; pool.connect = originalConnect; });
}

function fakeRes() {
  return { statusCode: 200, corpo: null, status(c) { this.statusCode = c; return this; }, json(o) { this.corpo = o; return this; } };
}

const UMA_CONTA = {
  contas: [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", external_account_id: "111", is_primary: true, ativo: true }],
  grants: [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })],
};

async function run() {
  // A. faturamento_desc: sequência monotônica cruzando página 1 -> 2 (o bug
  //    relatado — sem isso, a página 2 recomeça do zero).
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB1" }), anuncioFixture({ item_id: "MLB2" }),
      anuncioFixture({ item_id: "MLB3" }), anuncioFixture({ item_id: "MLB4" }),
    ],
  }, async () => {
    motorHandler = () => ({
      porMlb: new Map([
        ["MLB1", { receita: 400 }], ["MLB2", { receita: 300 }],
        ["MLB3", { receita: 200 }], ["MLB4", { receita: 100 }],
      ]),
      periodo: { dateFrom: "2026-09-01", dateTo: "2026-09-24" },
    });

    const res1 = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "2", ordenarPor: "faturamento_desc" } }, res1);
    assert.strictEqual(res1.corpo.ok, true);
    assert.deepStrictEqual(res1.corpo.anuncios.map((a) => a.item_id), ["MLB1", "MLB2"]);
    assert.strictEqual(res1.corpo.ordenacaoAplicada, true);
    assert.ok(res1.corpo.anuncios[0].faturamentoPercentual > res1.corpo.anuncios[1].faturamentoPercentual);

    const res2 = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "2", limit: "2", ordenarPor: "faturamento_desc" } }, res2);
    assert.deepStrictEqual(res2.corpo.anuncios.map((a) => a.item_id), ["MLB3", "MLB4"]);
    assert.ok(res1.corpo.anuncios[1].faturamentoPercentual > res2.corpo.anuncios[0].faturamentoPercentual,
      "o último da página 1 tem de valer MAIS que o primeiro da página 2 — nunca reinicia");
    motorHandler = null;
    console.log("  ✓ A. faturamento_desc: monotônico cruzando página 1 -> 2");
  });

  // B. família usa porFamilia agregado (soma dos filhos), nunca o filho mais
  //    forte isolado.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB-A1", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-A2", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-B", user_product_id: null }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    motorHandler = () => ({
      porMlb: new Map([["MLB-A1", { receita: 50 }], ["MLB-A2", { receita: 50 }], ["MLB-B", { receita: 80 }]]),
      periodo: {},
    });
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "faturamento_desc" } }, res);
    const familia = res.corpo.anuncios.find((a) => a.tipo === "familia");
    assert.ok(familia, "FAM1 precisa aparecer como família");
    assert.strictEqual(res.corpo.anuncios[0].family_id, "FAM1", "FAM1 (50+50=100) > MLB-B (80) — família vence pelo agregado, não pelo filho isolado");
    motorHandler = null;
    console.log("  ✓ B. família usa porFamilia agregado (soma dos filhos), não o filho mais forte");
  });

  // C. item sem receita no período fica no fim, nas duas direções.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [anuncioFixture({ item_id: "MLB-COM-VENDA" }), anuncioFixture({ item_id: "MLB-SEM-VENDA" })],
  }, async () => {
    motorHandler = () => ({ porMlb: new Map([["MLB-COM-VENDA", { receita: 10 }]]), periodo: {} });

    const asc = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "faturamento_asc" } }, asc);
    assert.deepStrictEqual(asc.corpo.anuncios.map((a) => a.item_id), ["MLB-COM-VENDA", "MLB-SEM-VENDA"]);

    const desc = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "faturamento_desc" } }, desc);
    assert.deepStrictEqual(desc.corpo.anuncios.map((a) => a.item_id), ["MLB-COM-VENDA", "MLB-SEM-VENDA"],
      "sem receita fica no fim mesmo em DESC — não pode competir com um valor real");
    motorHandler = null;
    console.log("  ✓ C. item sem receita no período: sempre no fim, nas duas direções");
  });

  // D. Motor indisponível: cai no SQL padrão, ordenacaoAplicada:false, nunca
  //    500 nem ordenação quebrada.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [anuncioFixture({ item_id: "MLB1" }), anuncioFixture({ item_id: "MLB2" })],
  }, async () => {
    motorHandler = () => {
      const err = new Error("Base não vinculada");
      err.statusCode = 409;
      err.payload = { codigo: "BASE_NAO_VINCULADA", erro: "Base não vinculada" };
      throw err;
    };
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "faturamento_desc" } }, res);
    assert.strictEqual(res.corpo.ok, true, "fallback nunca é 500");
    assert.strictEqual(res.corpo.ordenacaoAplicada, false);
    assert.deepStrictEqual(res.corpo.ordenacaoIndisponivel, { codigo: "BASE_NAO_VINCULADA", mensagem: "Base não vinculada" });
    assert.strictEqual(res.corpo.anuncios.length, 2, "SQL padrão continua respondendo a página normalmente");
    motorHandler = null;
    console.log("  ✓ D. Motor indisponível: fallback pro SQL padrão, ordenacaoAplicada:false, nunca 500");
  });

  // E. sem ordenarPor: comportamento idêntico ao path antigo (regressão).
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [anuncioFixture({ item_id: "MLB1" }), anuncioFixture({ item_id: "MLB2" })],
  }, async () => {
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10" } }, res);
    assert.strictEqual(res.corpo.ok, true);
    assert.strictEqual(res.corpo.ordenacaoAplicada, undefined, "sem ordenarPor não deve nem existir o campo — path antigo não conhece esse contrato");
    assert.strictEqual(res.corpo.anuncios[0].faturamentoPercentual, undefined);
    console.log("  ✓ E. sem ordenarPor: resposta idêntica ao path antigo, sem campos novos");
  });

  // F. valor inválido (ex.: 'margem_desc', que é ordenação LOCAL) é ignorado
  //    pelo backend — cai no SQL padrão, nunca erro.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [anuncioFixture({ item_id: "MLB1" })],
  }, async () => {
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_desc" } }, res);
    assert.strictEqual(res.corpo.ok, true);
    assert.strictEqual(res.corpo.ordenacaoAplicada, undefined);
    console.log("  ✓ F. ordenarPor=margem_desc (local, não suportado no backend) é ignorado, sem erro");
  });

  // G. clienteContaId isola o ranking — nunca mistura receita de outra conta.
  await withMockDb({
    contas: [
      { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", external_account_id: "111", is_primary: true, ativo: true },
      { id: 20, cliente_id: 1, marketplace: "meli", nome: "ML 2", external_account_id: "222", is_primary: false, ativo: true },
    ],
    grants: [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" }), grantFixture({ id: 200, cliente_id: 1, ml_user_id: "222" })],
    anuncios: [
      anuncioFixture({ item_id: "MLB-C10", cliente_conta_id: 10 }),
      anuncioFixture({ item_id: "MLB-C20", cliente_conta_id: 20 }),
    ],
  }, async () => {
    const contasVistas = [];
    motorHandler = ({ clienteContaId }) => {
      contasVistas.push(clienteContaId);
      return { porMlb: new Map([["MLB-C10", { receita: 10 }], ["MLB-C20", { receita: 999 }]]), periodo: {} };
    };
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", clienteContaId: "10", page: "1", limit: "10", ordenarPor: "faturamento_desc" } }, res);
    assert.deepStrictEqual(res.corpo.anuncios.map((a) => a.item_id), ["MLB-C10"], "MLB-C20 é de outra conta — não pode nem aparecer no catálogo filtrado");
    assert.deepStrictEqual(contasVistas, [10]);
    motorHandler = null;
    console.log("  ✓ G. clienteContaId isola o catálogo e o Motor — nunca mistura contas");
  });

  console.log("meliAnunciosOrdenacaoGlobal.test.js passed");
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node server/tests/meliAnunciosOrdenacaoGlobal.test.js`
Expected: falha no teste A (resposta sem `ordenacaoAplicada`/`faturamentoPercentual` — o handler ainda ignora `ordenarPor`).

- [ ] **Step 3: Implementar a orquestração no controller**

Em `server/controllers/meliAnunciosController.js`, adicione (perto de `PERFORMANCE_MAX_ITENS`, linha ~362, ou logo antes de `listarAgrupado`):

```js
// Critérios com ranking GLOBAL (contra o catálogo filtrado inteiro, via
// Motor de Margem) — margem_*/unidades_* NÃO entram aqui de propósito:
// continuam ordenação local de página no frontend (aplicarOrdenacaoPerformance
// em Portal/anuncios-meli.js), decisão explícita da auditoria "ordenação
// global limitada à página atual" — margem/unidades exigiriam recalcular o
// Motor pro catálogo inteiro a cada ordenação, sem cache, custo não aceito.
const ORDENACOES_GLOBAIS = {
  faturamento_asc: { campo: "faturamento", direcao: "asc" },
  faturamento_desc: { campo: "faturamento", direcao: "desc" },
  curvaAbc_asc: { campo: "curvaAbc", direcao: "asc" },
  curvaAbc_desc: { campo: "curvaAbc", direcao: "desc" },
};
const CURVA_ABC_ORDEM = { A: 1, B: 2, C: 3 };

// Ranking GLOBAL contra o catálogo FILTRADO inteiro (q/status/filtro/conta),
// não só a página pedida — corrige o bug em que ordenar por %Faturamento ou
// Curva ABC só valia dentro da página atual (auditoria "ordenação global
// limitada à página atual"). Só entra aqui quando `ordenarPor` bate um dos
// ORDENACOES_GLOBAIS; caminho de sempre (listarAgrupado do service) fica
// intocado para qualquer outro valor.
//
// Custo: uma query leve (só chaves, sem os agregados pesados) sobre o
// catálogo inteiro filtrado + UMA chamada ao Motor com itemIds:[] — o Motor
// monta `porMlb` (receita por MLB) pro PERÍODO INTEIRO independente de
// itemIds (ver motorMargemService.prepareWorkspaceContext), então isso não
// paga o custo por-item de enrichBatch. Só a página final (após ordenar e
// cortar) é hidratada com detalhe completo (título/preço/capa).
async function listarAgrupadoOrdenadoPorMotor({ cliente, clienteContaId, includeLegacy, q, status, filtro, page, limit, config }) {
  const chaves = await familiaService.listarChavesFiltradas({
    clienteId: cliente.id, clienteContaId, includeLegacy, q, status, filtro,
  });

  const familyIds = Array.from(new Set(chaves.filter((c) => c.family_id != null).map((c) => c.family_id)));
  const itemIdsIndividuais = chaves.filter((c) => c.family_id == null).map((c) => c.item_id);

  let porFamiliaItens = new Map();
  if (familyIds.length) {
    porFamiliaItens = await familiaService.resolverItensDeFamilias({
      clienteId: cliente.id, clienteContaId, includeLegacy, familyIds,
    });
  }

  let motorResultado;
  try {
    motorResultado = await motorMargemService.montarItens({
      clienteSlug: cliente.slug, clienteContaId, itemIds: [],
    });
  } catch (err) {
    if (err.statusCode && err.payload && err.payload.codigo) {
      const fallback = await familiaService.listarAgrupado({
        clienteId: cliente.id, clienteContaId, includeLegacy, q, status, filtro, page, limit,
      });
      return {
        ...fallback,
        ordenacaoAplicada: false,
        ordenacaoIndisponivel: { codigo: err.payload.codigo, mensagem: err.payload.erro },
      };
    }
    throw err;
  }

  const { porMlb, periodo } = motorResultado;
  const uniao = new Set(itemIdsIndividuais);
  for (const filhos of porFamiliaItens.values()) for (const id of filhos) uniao.add(id);
  const todosItemIds = Array.from(uniao);

  const ranking = config.campo === "faturamento"
    ? montarFaturamento(porMlb, todosItemIds, periodo, porFamiliaItens)
    : montarCurvaAbc(porMlb, todosItemIds, periodo, porFamiliaItens);
  const campoResposta = config.campo === "faturamento" ? "faturamentoPercentual" : "curvaAbc";

  const comValor = chaves.map((c) => {
    const valorBruto = c.family_id != null ? ranking.porFamilia[c.family_id] : ranking.porItem[c.item_id];
    const valorOrdenacao = config.campo === "curvaAbc"
      ? (valorBruto != null ? CURVA_ABC_ORDEM[valorBruto] : null)
      : valorBruto;
    return { chave: c, valorBruto, valorOrdenacao };
  });

  comValor.sort((x, y) => {
    if (x.valorOrdenacao == null && y.valorOrdenacao == null) return 0;
    if (x.valorOrdenacao == null) return 1;
    if (y.valorOrdenacao == null) return -1;
    return config.direcao === "asc" ? x.valorOrdenacao - y.valorOrdenacao : y.valorOrdenacao - x.valorOrdenacao;
  });

  const total = comValor.length;
  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const pag = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (pag - 1) * lim;
  const paginaComValor = comValor.slice(offset, offset + lim);

  const grupoKeysDaPagina = paginaComValor.map((x) => x.chave.grupo_key);
  const rows = await familiaService.listarAgrupadoPorChaves({
    clienteId: cliente.id, clienteContaId, includeLegacy, grupoKeys: grupoKeysDaPagina,
  });
  const rowsPorChave = new Map(rows.map((r) => [r.grupo_key, r]));
  const rowsOrdenadas = grupoKeysDaPagina.map((k) => rowsPorChave.get(k)).filter(Boolean);

  const anuncios = await familiaService.montarAnunciosDeRows(rowsOrdenadas, {
    clienteId: cliente.id, clienteContaId, includeLegacy, termo: String(q || "").trim(),
  });

  const valorPorChave = new Map(paginaComValor.map((x) => [x.chave.grupo_key, x.valorBruto]));
  for (const anuncio of anuncios) {
    const chave = anuncio.tipo === "familia" ? `fam:${anuncio.family_id}` : `item:${anuncio.item_id}`;
    anuncio[campoResposta] = valorPorChave.has(chave) ? valorPorChave.get(chave) : null;
  }

  return {
    anuncios,
    paginacao: { page: pag, limit: lim, total, totalPaginas: Math.max(Math.ceil(total / lim), 1) },
    ordenacaoAplicada: true,
    ordenacaoIndisponivel: null,
  };
}
```

Agora modifique o handler HTTP `listarAgrupado` (linha 227-266) para ler `ordenarPor` e desviar:

```js
async function listarAgrupado(req, res) {
  try {
    const { clienteSlug, q, status, filtro, page, limit, ordenarPor } = req.query || {};
    const clienteContaId = extrairClienteContaId(req.query && req.query.clienteContaId);
    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const cliente = await anunciosService.resolverCliente(clienteSlug);
    if (!cliente) {
      return res.status(404).json({ ok: false, motivo: "Cliente não encontrado." });
    }

    let contaId = null;
    let includeLegacy = true;
    if (clienteContaId != null) {
      const contexto = await anunciosService.resolverContextoConta({
        clienteId: cliente.id, clienteContaId, requireUsableGrant: false,
      });
      contaId = contexto.contaId;
      includeLegacy = contexto.includeLegacy;
    }

    const configGlobal = ORDENACOES_GLOBAIS[ordenarPor];
    const resultado = configGlobal
      ? await listarAgrupadoOrdenadoPorMotor({
          cliente, clienteContaId: contaId, includeLegacy, q, status, filtro, page, limit, config: configGlobal,
        })
      : await familiaService.listarAgrupado({
          clienteId: cliente.id, clienteContaId: contaId, includeLegacy, q, status, filtro, page, limit,
        });

    const resposta = {
      ok: true,
      cliente: { slug: cliente.slug, nome: cliente.nome },
      anuncios: resultado.anuncios,
      paginacao: resultado.paginacao,
    };
    if (configGlobal) {
      resposta.ordenacaoAplicada = resultado.ordenacaoAplicada;
      resposta.ordenacaoIndisponivel = resultado.ordenacaoIndisponivel;
    }
    return res.json(resposta);
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] listarAgrupado:", err.message);
    return res.status(500).json({ ok: false, motivo: "Erro ao listar os anúncios." });
  }
}
```

Note o `if (configGlobal)`: quando `ordenarPor` está ausente ou é `margem_*`/`unidades_*` (não suportado no backend), a resposta NÃO ganha os campos `ordenacaoAplicada`/`ordenacaoIndisponivel` — mantém o contrato antigo byte-a-byte (Global Constraint: "comportamento SEM ordenarPor... byte-a-byte idêntico").

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node server/tests/meliAnunciosOrdenacaoGlobal.test.js`
Expected: `meliAnunciosOrdenacaoGlobal.test.js passed`, com `✓ A.` até `✓ G.`

- [ ] **Step 5: Rodar as suítes vizinhas (regressão)**

Run: `node server/tests/meliAnunciosFamilias.test.js && node server/tests/meliAnunciosPerformance.test.js`
Expected: ambas passam sem nenhuma mudança de comportamento.

- [ ] **Step 6: Commit**

```bash
git add server/controllers/meliAnunciosController.js server/tests/meliAnunciosOrdenacaoGlobal.test.js
git commit -m "feat(anuncios-ml): ordenarPor global (faturamento/curvaAbc) em GET /anuncios-meli/familias"
```

---

## Task 6: Frontend — `ordenarPor` persistente entre páginas + relabel de Margem/Unidades

**Files:**
- Modify: `Portal/anuncios-meli.html:62-75` (dropdown)
- Modify: `Portal/anuncios-meli.js:30-127` (estado `AM`), `:508-530` (bind do dropdown), `:630-663` (`carregarAnuncios`)
- Test: Modify: `Portal/anuncios-meli-listagem-unificada-ui.test.js`

**Interfaces:**
- Consumes: resposta de `GET /anuncios-meli/familias` com os campos novos de Task 5 (`ordenacaoAplicada`, `ordenacaoIndisponivel`, `anuncios[i].faturamentoPercentual`/`curvaAbc`).
- Produces: `AM.ordenarPor` (string|null) — critério GLOBAL ativo, sobrevive à troca de página (ao contrário de `AM_ordemOriginalAnuncios`, que continua resetando a cada `carregarAnuncios()` para os critérios LOCAIS).

**Garantias de aceite desta task (requisito explícito do usuário — ver Global Constraints):**
1. Quando `AM.ordenarPor` é `faturamento_*`/`curvaAbc_*`, `AM.anuncios` recebe `r.data.anuncios` UMA VEZ em `carregarAnuncios` e nunca é reatribuído/reordenado depois disso — não existe `.sort()` nesse caminho (testes 39d, 39g).
2. `aplicarOrdenacaoPerformance()` só é chamada no ramo `else` do handler do dropdown (Margem/Unidades/"Padrão") — nunca quando `ORDENACOES_GLOBAIS[criterio]` é verdadeiro (prova indireta: `chamadasPerformance.length === 0` nos testes 39d/39g, já que `aplicarOrdenacaoPerformance` sempre dispara `GET /performance`).
3. Trocar de página com um critério global ativo reenvia o MESMO `ordenarPor` na querystring (teste 39e, campo `chamadasFamilias`).
4. O `<select id="am-ordenacao">` mantém o valor selecionado após a troca de página quando o critério é global — só reseta para `""` no ramo local/"Padrão" (teste 39e).
5. Página 1 (último item) > Página 2 (primeiro item) em `faturamento_desc` — validado tanto no backend (Task 5, teste A) quanto ponta-a-ponta na UI (teste 39e).

- [ ] **Step 1: Relabel do dropdown (HTML)**

Em `Portal/anuncios-meli.html:66-71`:

```html
<option value="margem_asc">Margem (nesta página): menor → maior</option>
<option value="margem_desc">Margem (nesta página): maior → menor</option>
<option value="faturamento_asc">% Faturamento: menor → maior</option>
<option value="faturamento_desc">% Faturamento: maior → menor</option>
<option value="unidades_asc">Unidades vendidas 7d (nesta página): menor → maior</option>
<option value="unidades_desc">Unidades vendidas 7d (nesta página): maior → menor</option>
```

(`curvaAbc_asc`/`curvaAbc_desc`, linhas 72-73, ficam com o texto atual — já não prometiam algo que a implementação vai cumprir agora.)

- [ ] **Step 2: Escrever o teste de UI (vai falhar — front ainda não manda `ordenarPor` nem entende os campos novos)**

Em `Portal/anuncios-meli-listagem-unificada-ui.test.js`, no handler do mock de `/anuncios-meli/familias` (linha 532-547), adicione suporte a `ordenarPor` controlável por teste:

```js
    // A LISTA — uma só, com linhas dos dois tipos.
    if (caminho.startsWith("/anuncios-meli/familias")) {
      const qs = new URL(url).searchParams;
      const termo = qs.get("q");
      const filtro = qs.get("filtro");
      const ordenarPor = qs.get("ordenarPor");
      chamadasFamilias.push({ page: qs.get("page"), ordenarPor });
      if (ordenarPorGlobalHandler && ordenarPor) { await corpo(ordenarPorGlobalHandler(qs)); return; }
      let anuncios;
      if (conta === "43") anuncios = LINHAS_CONTA_43;
      else if (filtro) anuncios = LINHAS_CONTA_42_FILTRO;
      else if (termo) anuncios = LINHAS_CONTA_42_BUSCA;
      else anuncios = LINHAS_CONTA_42;
      await corpo({
        ok: true, cliente: { slug: "n97", nome: "N97 Comercial" },
        anuncios,
        paginacao: { page: 1, limit: 20, total: anuncios.length, totalPaginas: 1 },
      });
      return;
    }
```

Declare `chamadasFamilias` e `ordenarPorGlobalHandler` junto às outras variáveis de controle do teste (perto de `performanceHandler`, `atrasoPerformance` etc., início do arquivo):

```js
let chamadasFamilias = [];
let ordenarPorGlobalHandler = null; // (qs) => resposta completa de /anuncios-meli/familias
```

Agora os testes, logo depois do bloco "39a-c" (após a linha ~2600, onde termina o teste de unidades):

```js
    /* ── 39d-f: ordenação GLOBAL por %Faturamento (ordenarPor no backend) ── */

    await check("39d — faturamento_desc: front manda ordenarPor e PINTA direto da resposta, sem 2ª chamada a /performance", async () => {
      chamadasFamilias.length = 0;
      chamadasPerformance.length = 0;
      ordenarPorGlobalHandler = () => ({
        ok: true, cliente: { slug: "n97", nome: "N97 Comercial" },
        ordenacaoAplicada: true, ordenacaoIndisponivel: null,
        anuncios: [
          { tipo: "item", item_id: "MLB-SEMUP", key: "item:MLB-SEMUP", titulo: "Item A", status: "active", faturamentoPercentual: 0.30, cover: { thumbnail: null } },
          { tipo: "item", item_id: "MLB-SEMVAR", key: "item:MLB-SEMVAR", titulo: "Item B", status: "active", faturamentoPercentual: 0.10, cover: { thumbnail: null } },
        ],
        paginacao: { page: 1, limit: 20, total: 2, totalPaginas: 1 },
      });

      await cdp.evaluate(`(function(){
        var s = document.getElementById('am-ordenacao');
        s.value = 'faturamento_desc';
        s.dispatchEvent(new Event('change'));
      })()`);
      await waitFor(cdp, `(function(){
        var r = document.querySelector('.am-listagem > .am-row');
        return r && r.getAttribute('data-item') === 'MLB-SEMUP';
      })()`, "MLB-SEMUP (30%) deveria vir primeiro");

      assert.strictEqual(chamadasPerformance.length, 0, "ordenação global não precisa de uma 2ª chamada a /performance — o valor já veio na listagem");
      const texto = await cdp.evaluate(`document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-faturamento__valor, .am-row[data-item="MLB-SEMUP"] [data-faturamento]')?.textContent || ''`);
      assert.ok(texto.includes("30"), `célula de %Faturamento deveria pintar 30% direto da resposta da listagem: "${texto}"`);
      ordenarPorGlobalHandler = null;
      console.log("  ✓ 39d");
    });

    await check("39e — trocar de página com faturamento_desc ativo: ordenarPor viaja para a página 2, dropdown continua mostrando o critério, e o ranking NÃO reinicia (último da pág.1 > primeiro da pág.2)", async () => {
      chamadasFamilias.length = 0;
      // 2 itens por página, valores DECRESCENTES cruzando a borda — é o
      // cenário exato do relato original (10/9/8 -> 20/15/12 seria o bug; o
      // esperado é 30/20 -> 10/5, sempre caindo).
      ordenarPorGlobalHandler = (qs) => ({
        ok: true, cliente: { slug: "n97", nome: "N97 Comercial" },
        ordenacaoAplicada: true, ordenacaoIndisponivel: null,
        anuncios: qs.get("page") === "2"
          ? [
              { tipo: "item", item_id: "MLB-PAG2-A", key: "item:MLB-PAG2-A", titulo: "Item pág2 A", status: "active", faturamentoPercentual: 0.10, cover: { thumbnail: null } },
              { tipo: "item", item_id: "MLB-PAG2-B", key: "item:MLB-PAG2-B", titulo: "Item pág2 B", status: "active", faturamentoPercentual: 0.05, cover: { thumbnail: null } },
            ]
          : [
              { tipo: "item", item_id: "MLB-PAG1-A", key: "item:MLB-PAG1-A", titulo: "Item pág1 A", status: "active", faturamentoPercentual: 0.30, cover: { thumbnail: null } },
              { tipo: "item", item_id: "MLB-PAG1-B", key: "item:MLB-PAG1-B", titulo: "Item pág1 B", status: "active", faturamentoPercentual: 0.20, cover: { thumbnail: null } },
            ],
        paginacao: { page: Number(qs.get("page") || 1), limit: 2, total: 4, totalPaginas: 2 },
      });

      await cdp.evaluate(`(function(){
        var s = document.getElementById('am-ordenacao');
        s.value = 'faturamento_desc';
        s.dispatchEvent(new Event('change'));
      })()`);
      await waitFor(cdp, `document.querySelector('.am-row[data-item="MLB-PAG1-A"]')`, "página 1 não carregou");
      const ultimaPag1 = await cdp.evaluate(`document.querySelector('.am-row[data-item="MLB-PAG1-B"] [data-faturamento], .am-row[data-item="MLB-PAG1-B"] .am-faturamento__valor')?.textContent || ''`);

      await clicar(cdp, '#am-pag [data-pagina="2"]');
      await waitFor(cdp, `document.querySelector('.am-row[data-item="MLB-PAG2-A"]')`, "página 2 não carregou");
      const primeiraPag2 = await cdp.evaluate(`document.querySelector('.am-row[data-item="MLB-PAG2-A"] [data-faturamento], .am-row[data-item="MLB-PAG2-A"] .am-faturamento__valor')?.textContent || ''`);

      assert.ok(chamadasFamilias.some((c) => c.page === "2" && c.ordenarPor === "faturamento_desc"),
        "a chamada da página 2 tem de levar ordenarPor=faturamento_desc — é exatamente o bug relatado (ordenação reiniciava ao trocar de página)");
      const valorDropdown = await cdp.evaluate(`document.getElementById('am-ordenacao').value`);
      assert.strictEqual(valorDropdown, "faturamento_desc", "trocar de página NÃO pode resetar o dropdown quando o critério é global");

      // VALIDAÇÃO ESPECÍFICA pedida: último item da página 1 (20%) tem de
      // valer MAIS que o primeiro item da página 2 (10%) — nunca o ranking
      // "reiniciando" (o que apareceria como pág.2 > pág.1, ex.: 10% -> 30%).
      const paraNumero = (t) => parseFloat(String(t).replace(",", ".").replace("%", "").trim());
      assert.ok(paraNumero(ultimaPag1) > paraNumero(primeiraPag2),
        `último item da página 1 (${ultimaPag1}) tem de ser MAIOR que o primeiro da página 2 (${primeiraPag2}) — faturamento_desc nunca reinicia o ranking na borda de página`);
      ordenarPorGlobalHandler = null;
      console.log("  ✓ 39e");
    });

    await check("39f — ordenacaoIndisponivel: mostra aviso inline, não quebra a lista", async () => {
      ordenarPorGlobalHandler = () => ({
        ok: true, cliente: { slug: "n97", nome: "N97 Comercial" },
        ordenacaoAplicada: false,
        ordenacaoIndisponivel: { codigo: "BASE_NAO_VINCULADA", mensagem: "Vincule uma Base para ordenar por Faturamento." },
        anuncios: [{ tipo: "item", item_id: "MLB-SEMUP", key: "item:MLB-SEMUP", titulo: "Item A", status: "active", cover: { thumbnail: null } }],
        paginacao: { page: 1, limit: 20, total: 1, totalPaginas: 1 },
      });

      await cdp.evaluate(`(function(){
        var s = document.getElementById('am-ordenacao');
        s.value = 'faturamento_asc';
        s.dispatchEvent(new Event('change'));
      })()`);
      await waitFor(cdp, `document.querySelector('.am-row[data-item="MLB-SEMUP"]')`, "lista tem de continuar respondendo mesmo sem ordenação");
      await waitFor(cdp, `(function(){
        var el = document.getElementById('am-ordenacao-aviso');
        return el && !el.hidden && el.textContent.includes('Vincule uma Base');
      })()`, "aviso de ordenacaoIndisponivel deveria aparecer com a mensagem do backend");
      ordenarPorGlobalHandler = null;
      console.log("  ✓ 39f");
    });

    await check("39g — front NUNCA reordena AM.anuncios localmente para critério global: renderiza EXATAMENTE a ordem que o backend mandou, mesmo que pareça 'fora de ordem'", async () => {
      // Backend de propósito NÃO manda os valores em ordem decrescente
      // (30% depois de 10%) — se o front ainda tivesse QUALQUER resquício do
      // comportamento antigo (reordenar AM.anuncios em memória, como
      // aplicarOrdenacaoPerformance fazia), a tela corrigiria essa "ordem
      // errada" e o teste pegaria isso. O contrato correto é: pra critério
      // global, o front confia cegamente na ordem do backend.
      chamadasPerformance.length = 0;
      ordenarPorGlobalHandler = () => ({
        ok: true, cliente: { slug: "n97", nome: "N97 Comercial" },
        ordenacaoAplicada: true, ordenacaoIndisponivel: null,
        anuncios: [
          { tipo: "item", item_id: "MLB-FORA-1", key: "item:MLB-FORA-1", titulo: "X", status: "active", faturamentoPercentual: 0.10, cover: { thumbnail: null } },
          { tipo: "item", item_id: "MLB-FORA-2", key: "item:MLB-FORA-2", titulo: "Y", status: "active", faturamentoPercentual: 0.30, cover: { thumbnail: null } },
          { tipo: "item", item_id: "MLB-FORA-3", key: "item:MLB-FORA-3", titulo: "Z", status: "active", faturamentoPercentual: 0.20, cover: { thumbnail: null } },
        ],
        paginacao: { page: 1, limit: 20, total: 3, totalPaginas: 1 },
      });

      await cdp.evaluate(`(function(){
        var s = document.getElementById('am-ordenacao');
        s.value = 'faturamento_desc';
        s.dispatchEvent(new Event('change'));
      })()`);
      await waitFor(cdp, `document.querySelector('.am-row[data-item="MLB-FORA-1"]')`, "lista não carregou");

      const ordemRenderizada = await cdp.evaluate(`Array.from(document.querySelectorAll('.am-listagem > .am-row')).map(function(r){
        return r.getAttribute('data-item'); })`);
      assert.deepStrictEqual(ordemRenderizada, ["MLB-FORA-1", "MLB-FORA-2", "MLB-FORA-3"],
        `o front reordenou localmente (ordem renderizada: ${JSON.stringify(ordemRenderizada)}) — para critério global, a ordem tem de ser EXATAMENTE a que o backend mandou, nunca recalculada em memória`);
      assert.strictEqual(chamadasPerformance.length, 0, "nenhuma chamada a /performance (aplicarOrdenacaoPerformance) pode ter disparado para um critério global");
      ordenarPorGlobalHandler = null;
      console.log("  ✓ 39g");
    });
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run (headless, mesma suíte que já roda no Windows via shim — ver `[[venforce-detalhe-anuncio-modal-central]]`): `node Portal/anuncios-meli-listagem-unificada-ui.test.js`
Expected: falha em 39d (nenhum `ordenarPor` é mandado hoje; dropdown ainda dispara `aplicarOrdenacaoPerformance` pra tudo) — 39e/39f/39g falhariam pelo mesmo motivo em cascata.

- [ ] **Step 4: Implementar no frontend**

Em `Portal/anuncios-meli.js`, adicione o estado (perto de `filtros`, linha ~41):

```js
    filtros: { q: "", status: "", filtro: "" },
    // Critério GLOBAL ativo (faturamento_*/curvaAbc_*) — sobrevive à troca de
    // página, ao contrário da ordenação LOCAL (AM_ordemOriginalAnuncios, que
    // reseta a cada carregarAnuncios porque só faz sentido pra página que
    // acabou de sair de cena). null = nenhum critério global ativo.
    ordenarPor: null,
```

Adicione a constante de critérios globais logo acima de `ORDENACOES_PERFORMANCE` (linha ~1812):

```js
  var ORDENACOES_GLOBAIS = { faturamento_asc: 1, faturamento_desc: 1, curvaAbc_asc: 1, curvaAbc_desc: 1 };
```

Troque o bind do dropdown (linhas 525-529):

```js
    if (el("am-ordenacao")) {
      el("am-ordenacao").addEventListener("change", function (e) {
        var criterio = e.target.value;
        if (!criterio) {
          AM.ordenarPor = null;
          aplicarOrdenacaoPerformance(null);
          return;
        }
        if (ORDENACOES_GLOBAIS[criterio]) {
          AM.ordenarPor = criterio;
          AM.paginacao.page = 1;
          carregarAnuncios();
          return;
        }
        // Margem/Unidades: ordenação LOCAL de sempre, nunca junto com uma
        // ordenação global ativa — as duas são mutuamente exclusivas no
        // mesmo <select>.
        AM.ordenarPor = null;
        aplicarOrdenacaoPerformance(criterio);
      });
    }
```

Troque `carregarAnuncios` (linhas 630-663):

```js
  function carregarAnuncios() {
    if (!AM.clienteAtual) return;
    var meuToken = ++AM.catalogoToken;
    var box = el("am-catalogo-container");

    AM.carregandoCatalogo = true;
    box.innerHTML = estadoHtml("loading", "Carregando anúncios…");

    var qs = "clienteSlug=" + encodeURIComponent(AM.clienteAtual.slug) +
             "&page=" + AM.paginacao.page + "&limit=" + AM.paginacao.limit;
    if (AM.filtros.q) qs += "&q=" + encodeURIComponent(AM.filtros.q);
    if (AM.filtros.status) qs += "&status=" + encodeURIComponent(AM.filtros.status);
    if (AM.filtros.filtro) qs += "&filtro=" + encodeURIComponent(AM.filtros.filtro);
    if (AM.contaMlId) qs += "&clienteContaId=" + encodeURIComponent(AM.contaMlId);
    if (AM.ordenarPor) qs += "&ordenarPor=" + encodeURIComponent(AM.ordenarPor);

    api("/anuncios-meli/familias?" + qs).then(function (r) {
      if (meuToken !== AM.catalogoToken) return;
      AM.carregandoCatalogo = false;
      if (!r.data || !r.data.ok) {
        box.innerHTML = estadoHtml("error", "Erro ao carregar",
          (r.data && r.data.motivo) || "Tente novamente.");
        return;
      }
      AM.anuncios = r.data.anuncios || [];
      AM.paginacao = r.data.paginacao || AM.paginacao;

      // Ordenação GLOBAL: o backend já manda o valor que decidiu a posição
      // (faturamentoPercentual/curvaAbc) — escreve nos MESMOS caches que as
      // células da lista já leem (faturamentoCelulaHtml/badgesAnuncioHtml),
      // sem uma 2ª chamada a /performance (ver auditoria "ordenação global
      // limitada à página atual").
      if (AM.ordenarPor) {
        AM.anuncios.forEach(function (linha) {
          if (linha.faturamentoPercentual === undefined && linha.curvaAbc === undefined) return;
          var cacheItem = linha.tipo === "familia" ? AM.state.faturamentoPorFamiliaCache : AM.state.faturamentoCache;
          var cacheAbc = linha.tipo === "familia" ? AM.state.curvaAbcPorFamiliaCache : AM.state.curvaAbcCache;
          var chave = linha.tipo === "familia" ? linha.family_id : linha.item_id;
          if (linha.faturamentoPercentual !== undefined) cacheItem[chave] = linha.faturamentoPercentual;
          if (linha.curvaAbc !== undefined) cacheAbc[chave] = linha.curvaAbc;
        });
        var aviso = el("am-ordenacao-aviso");
        if (aviso) {
          if (r.data.ordenacaoAplicada === false && r.data.ordenacaoIndisponivel) {
            aviso.textContent = r.data.ordenacaoIndisponivel.mensagem || "Não foi possível ordenar globalmente.";
            aviso.hidden = false;
          } else {
            aviso.hidden = true;
          }
        }
      } else {
        AM_ordemOriginalAnuncios = null;
        if (el("am-ordenacao")) el("am-ordenacao").value = "";
        var avisoLimpo = el("am-ordenacao-aviso");
        if (avisoLimpo) avisoLimpo.hidden = true;
      }
      renderCatalogo();
    });
  }
```

Note que o `else` preserva EXATAMENTE o comportamento antigo (reset de `AM_ordemOriginalAnuncios` e do `<select>`) para quando `AM.ordenarPor` é `null` — ou seja, para os critérios locais (Margem/Unidades) e para "Padrão", nada muda.

Adicione o elemento de aviso no HTML, logo abaixo do `<div class="vf-field am-filtro-ordenacao">` (`Portal/anuncios-meli.html`, depois da linha 75):

```html
                  <div id="am-ordenacao-aviso" class="vf-alert is-warning" role="status" hidden></div>
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node Portal/anuncios-meli-listagem-unificada-ui.test.js`
Expected: passa, incluindo `✓ 39d`, `✓ 39e`, `✓ 39f`, `✓ 39g`, e as suítes 39a-c (Margem/Unidades) continuam passando sem mudança — 39a-c são a prova de que `aplicarOrdenacaoPerformance()` continua funcionando NORMALMENTE para Margem/Unidades (não foi removida, só deixou de ser chamada para os critérios globais).

- [ ] **Step 6: Rodar a suíte Vitest do módulo (se houver) e a suíte completa do Portal**

Run: `cd Portal && npx vitest run` (se o projeto usa Vitest para este diretório — confirmar comando exato em `Portal/package.json` antes de rodar) e `node Portal/anuncios-meli-listagem-unificada-ui.test.js` de novo, isolado, pra garantir que não há vazamento de estado entre os testes 39d-f e os testes seguintes do arquivo (ex.: `AM.ordenarPor` ficando "preso" em `faturamento_desc` para o próximo `check()`).
Expected: tudo verde. Se algum teste seguinte quebrar por causa do `ordenarPor` que ficou setado, adicione ao fim de 39f: `await cdp.evaluate("document.getElementById('am-ordenacao').value=''; document.getElementById('am-ordenacao').dispatchEvent(new Event('change'))");` para devolver o estado a "Padrão" antes do próximo teste.

- [ ] **Step 7: Commit**

```bash
git add Portal/anuncios-meli.html Portal/anuncios-meli.js Portal/anuncios-meli-listagem-unificada-ui.test.js
git commit -m "feat(anuncios-ml): ordenacao global persiste entre paginas; margem/unidades relabeled como locais"
```

---

## Self-Review (feito ao final da escrita deste plano)

- **Cobertura do contrato aprovado:** `ordenarPor` restrito a faturamento/curvaAbc (Task 5, `ORDENACOES_GLOBAIS`) ✓; Margem/Unidades só relabel (Task 6, Step 1) ✓; campos semânticos `faturamentoPercentual`/`curvaAbc` em vez de campo genérico (Task 5) ✓; fluxo SQL→ranking→pagina→hidrata só página (Tasks 2-3-5) ✓; família via `porFamilia` (Task 5 + teste B) ✓; fallback explícito (Task 5 + teste D) ✓; comportamento sem `ordenarPor` intocado (Task 1 regressão + Task 5 teste E) ✓; testes página1→página2 (teste A backend + teste 39e UI), filtros ativos (Task 2 teste AK), família agregada (teste B), multi-conta (teste G), fallback (teste D), regressão sem ordenarPor (teste E) ✓.
- **Cobertura do reforço "eliminar ordenação em memória" (pedido explícito do usuário):** página atual sempre resultado do backend, nunca reordenada no front (testes 39d/39g — `AM.anuncios` recebe a resposta uma única vez); trocar página mantém o mesmo ranking global (teste 39e, `chamadasFamilias` com `ordenarPor` presente na página 2); `aplicarOrdenacaoPerformance()` nunca dispara para critério global (testes 39d/39g via `chamadasPerformance.length === 0`, e as suítes 39a-c provam que ela continua funcionando normalmente para Margem/Unidades — não foi removida, só deixou de ser chamada nesse ramo); dropdown permanece selecionado durante a paginação (teste 39e, leitura de `#am-ordenacao.value`); página 1 (último) > página 2 (primeiro) em `faturamento_desc` validado com valores reais tanto no backend (teste A) quanto na UI renderizada (teste 39e) ✓.
- **Placeholders:** nenhum "TBD"/"implementar depois" — todo SQL, todo JS e todo teste está escrito por extenso nos steps.
- **Consistência de tipos/nomes:** `grupo_key` (`fam:ID`/`item:ID`) usado identicamente em `meliFamiliaService` (Tasks 1-3) e reconstruído do mesmo jeito em `meliAnunciosController.listarAgrupadoOrdenadoPorMotor` (Task 5); `montarAnunciosDeRows(rows, {clienteId, clienteContaId, includeLegacy, termo})` chamado com a mesma assinatura nas Tasks 1 e 5; `AM.ordenarPor` (Task 6) só existe no frontend, nunca confundido com o `ordenarPor` da querystring (mesmo nome, propositalmente, pra rastreabilidade).
