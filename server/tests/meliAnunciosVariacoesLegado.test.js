// server/tests/meliAnunciosVariacoesLegado.test.js
//
// Auditoria (docs/... investigação de variações não exibidas): existem DOIS
// modelos legítimos do Mercado Livre para representar variação de cor/tamanho:
//
//   modelo novo   family_id -> user_product_id -> item_id  (já implementado)
//   modelo legado item_id -> variations[]                  (não persistido)
//
// Um item legado (ex.: MLB2652739620, confirmado em produção com 24
// variações reais de Cor x Tamanho) tem family_id/user_product_id NULOS —
// hoje ele vira, na listagem, uma linha indistinguível de um SKU único.
//
// Esta suíte cobre o sinal informacional novo (variations_count), SEM
// inventar hierarquia de família/UP para o modelo legado:
//
//   1. mapearItem() extrai variations_count de body.variations.length;
//   2. upsertAnuncios() persiste e ATUALIZA a contagem numa ressincronização;
//   3. listarAgrupado(): item sem family/UP com variations_count > 0 é
//      marcado; sem variações continua um anúncio simples; item do modelo
//      novo (com family_id) não é afetado por variations_count nenhum.
//   4. dado antigo/NULL não quebra a listagem.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");

const pool = require("../config/database");
const meliSyncService = require("../services/meliAnuncios/meliSyncService");
const meliAnunciosService = require("../services/meliAnuncios/meliAnunciosService");
const meliFamiliaService = require("../services/meliAnuncios/meliFamiliaService");

function itemBase(overrides = {}) {
  return {
    id: "MLB123",
    title: "Produto de teste",
    status: "active",
    price: 100,
    attributes: [],
    pictures: [],
    ...overrides,
  };
}

// ── Seção 1: mapearItem() ────────────────────────────────────────────────

function testMapearItem() {
  // 1a. item realmente simples: sem a chave `variations` no payload.
  {
    const registro = meliSyncService.mapearItem(itemBase(), 1, "cliente-a");
    assert.strictEqual(registro.variations_count, 0);
    console.log("  ✓ mapearItem() grava variations_count = 0 quando o payload não traz `variations`");
  }

  // 1b. item legado multivariante: MLB2652739620 tem 24 variações reais.
  {
    const variations = Array.from({ length: 24 }, (_, i) => ({ id: 1000 + i }));
    const registro = meliSyncService.mapearItem(
      itemBase({ id: "MLB2652739620", variations }),
      1,
      "cliente-a"
    );
    assert.strictEqual(registro.variations_count, 24);
    console.log("  ✓ mapearItem() extrai variations_count = 24 de item.variations.length");
  }

  // 1c. `variations: []` explícito (ML às vezes devolve array vazio) conta 0,
  // não null — nunca inferido, sempre o tamanho real do array recebido.
  {
    const registro = meliSyncService.mapearItem(itemBase({ variations: [] }), 1, "cliente-a");
    assert.strictEqual(registro.variations_count, 0);
    console.log("  ✓ mapearItem() grava variations_count = 0 para `variations: []`");
  }

  // 1d. item do modelo novo (family_id/user_product_id presentes) não perde o
  // sinal legado por engano — mapearItem não decide qual modelo "vale", só
  // reporta os dois fatos que recebeu. A decisão de qual prevalece é da
  // listagem (listarAgrupado), não do mapeamento.
  {
    const registro = meliSyncService.mapearItem(
      itemBase({ user_product_id: "UP1", family_id: 555 }),
      1,
      "cliente-a"
    );
    assert.strictEqual(registro.variations_count, 0);
    assert.strictEqual(registro.user_product_id, "UP1");
    console.log("  ✓ mapearItem() não confunde variations_count com family_id/user_product_id");
  }
}

// ── Seção 2: upsertAnuncios() — persistência e ressincronização ─────────

class MockDbUpsert {
  constructor() {
    this.anuncios = [];
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q.startsWith("CREATE TABLE") || q.startsWith("ALTER TABLE") || q.startsWith("CREATE INDEX")) {
      return { rows: [] };
    }

    if (q.startsWith("INSERT INTO meli_anuncios")) {
      assert.ok(
        q.includes("variations_count"),
        "upsertAnuncios() precisa gravar variations_count — coluna ausente do INSERT"
      );

      const [
        cliente_id, cliente_slug, item_id, sku, titulo, marca, modelo,
        preco, preco_original, moeda, estoque, vendidos, status, sub_status,
        listing_type_id, category_id, permalink, thumbnail, pictures_count,
        pictures_json, logistic_type, is_full, attributes_json, health,
        score_venforce, score_motivo, cliente_conta_id, ml_user_id,
        catalog_listing, catalog_product_id, family_name, user_product_id,
        variations_count,
      ] = params;

      const existente = this.anuncios.find(
        (a) => a.cliente_id === cliente_id && a.item_id === item_id
      );
      const row = {
        cliente_id, cliente_slug, item_id, sku, titulo, marca, modelo,
        preco, preco_original, moeda, estoque, vendidos, status, sub_status,
        listing_type_id, category_id, permalink, thumbnail, pictures_count,
        pictures_json, logistic_type, is_full, attributes_json, health,
        score_venforce, score_motivo, cliente_conta_id, ml_user_id,
        catalog_listing, catalog_product_id, family_name, user_product_id,
        variations_count,
      };
      if (existente) Object.assign(existente, row);
      else this.anuncios.push(row);
      return { rows: [] };
    }

    return { rows: [] };
  }
}

function withMockDb(fn) {
  const originalQuery = pool.query;
  const db = new MockDbUpsert();
  pool.query = (sql, params) => db.query(sql, params);
  return Promise.resolve()
    .then(() => fn(db))
    .finally(() => {
      pool.query = originalQuery;
    });
}

async function testUpsert() {
  // 2a. anúncio novo grava variations_count.
  await withMockDb(async (db) => {
    const registro = meliSyncService.mapearItem(
      itemBase({ id: "MLB2652739620", variations: Array(24).fill({}) }),
      1,
      "cliente-a"
    );
    await meliAnunciosService.upsertAnuncios([registro]);

    const salvo = db.anuncios.find((a) => a.item_id === "MLB2652739620");
    assert.strictEqual(salvo.variations_count, 24);
    console.log("  ✓ upsertAnuncios() grava variations_count em anúncio novo");
  });

  // 2b. ressincronização ATUALIZA a contagem (sem duplicar linha) quando o
  // Mercado Livre adiciona/remove variações entre duas sincronizações.
  await withMockDb(async (db) => {
    const primeira = meliSyncService.mapearItem(
      itemBase({ id: "MLB999", variations: Array(3).fill({}) }),
      1,
      "cliente-a"
    );
    await meliAnunciosService.upsertAnuncios([primeira]);

    const segunda = meliSyncService.mapearItem(
      itemBase({ id: "MLB999", variations: Array(5).fill({}) }),
      1,
      "cliente-a"
    );
    await meliAnunciosService.upsertAnuncios([segunda]);

    const linhas = db.anuncios.filter((a) => a.item_id === "MLB999");
    assert.strictEqual(linhas.length, 1, "ressincronização não pode duplicar a linha");
    assert.strictEqual(linhas[0].variations_count, 5, "a contagem precisa refletir a ÚLTIMA sincronização");
    console.log("  ✓ upsertAnuncios() atualiza variations_count numa ressincronização, sem duplicar linha");
  });
}

// ── Seção 3 e 4: listarAgrupado() ────────────────────────────────────────
//
// Mock mínimo, focado só no sinal novo — não reimplementa toda a fidelidade
// de estoque/ordenação da CTE (isso já é coberto por
// server/tests/meliAnunciosFamilias.test.js). Aqui a pergunta é uma só: o
// campo variations_count chega até o payload da linha certa, e só nela.

const cliente = { id: 1, nome: "Cliente A", slug: "cliente-a", ativo: true };

class MockDbListagem {
  constructor({ anuncios = [], userProducts = [] } = {}) {
    this.anuncios = anuncios;
    this.userProducts = userProducts;
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q.startsWith("CREATE TABLE") || q.startsWith("ALTER TABLE") || q.startsWith("CREATE INDEX")) {
      return { rows: [] };
    }
    if (q.includes("FROM clientes WHERE LOWER(slug) = $1")) {
      return { rows: cliente.slug === params[0] ? [cliente] : [] };
    }

    if (q.includes("-- LISTAR_AGRUPADO_PAGINA")) {
      const clienteId = params[0];
      const linhas = this.anuncios.filter((a) => a.cliente_id === clienteId);
      const grupos = new Map();
      for (const a of linhas) {
        const up = a.user_product_id
          ? this.userProducts.find((u) => u.cliente_id === clienteId && u.user_product_id === a.user_product_id)
          : null;
        const familyId = up && up.family_id != null ? up.family_id : null;
        const key = familyId != null ? `fam:${familyId}` : `item:${a.item_id}`;
        const g = grupos.get(key) || {
          grupo_key: key, family_id: familyId, family_name: up ? up.family_name : null,
          item_id: a.item_id, total_itens: 0, ups: new Set(), vendidos_total: 0,
          preco_min: null, preco_max: null, moeda: a.moeda, score_min: null,
          total_ativos: 0, total_pausados: 0, total_encerrados: 0,
        };
        g.total_itens++;
        if (a.user_product_id) g.ups.add(a.user_product_id);
        if (a.status === "active") g.total_ativos++;
        grupos.set(key, g);
      }
      const pagina = Array.from(grupos.values()).map((g) => ({
        grupo_key: g.grupo_key, family_id: g.family_id, family_name: g.family_name,
        item_id: g.item_id, total_itens: g.total_itens, total_user_products: g.ups.size,
        vendidos_total: g.vendidos_total, preco_min: g.preco_min, preco_max: g.preco_max,
        moeda: g.moeda, score_min: g.score_min, total_ativos: g.total_ativos,
        total_pausados: g.total_pausados, total_encerrados: g.total_encerrados,
        estoque_total: null, total_grupos: grupos.size,
      }));
      return { rows: pagina };
    }

    if (q.includes("-- LISTAR_AGRUPADO_ITENS_DA_PAGINA")) {
      assert.ok(
        q.includes("variations_count"),
        "listarAgrupado() precisa pedir variations_count na consulta dos itens da página"
      );
      const clienteId = params[0];
      const itemIds = new Set(params[params.length - 1]);
      const rows = this.anuncios
        .filter((a) => a.cliente_id === clienteId && itemIds.has(a.item_id))
        .map((a) => ({ ...a }));
      return { rows };
    }

    if (q.includes("-- LISTAR_FAMILIAS_CAPA_DA_PAGINA")) {
      return { rows: [] };
    }

    return { rows: [] };
  }
}

function withMockDbListagem(dados, fn) {
  const originalQuery = pool.query;
  const db = new MockDbListagem(dados);
  pool.query = (sql, params) => db.query(sql, params);
  return Promise.resolve()
    .then(() => fn(db))
    .finally(() => {
      pool.query = originalQuery;
    });
}

function anuncio(overrides = {}) {
  return {
    cliente_id: 1, cliente_conta_id: null, item_id: "MLB1", user_product_id: null,
    titulo: "Produto 1", status: "active", preco: 10, moeda: "BRL", estoque: 5,
    vendidos: 0, sku: "SKU1", thumbnail: null, permalink: null, pictures_count: 5,
    is_full: false, revisado: false, score_venforce: null, score_motivo: null,
    catalog_listing: false, family_name: null, updated_at: null, variations_count: 0,
    ...overrides,
  };
}

async function testListarAgrupado() {
  // 3a. item legado (sem family/UP) com variations_count > 0 é marcado.
  await withMockDbListagem({
    anuncios: [anuncio({ item_id: "MLB2652739620", variations_count: 24, titulo: "Tênis Modare" })],
  }, async () => {
    const resultado = await meliFamiliaService.listarAgrupado({ clienteId: 1 });
    const linha = resultado.anuncios.find((a) => a.item_id === "MLB2652739620");
    assert.strictEqual(linha.tipo, "item");
    assert.strictEqual(linha.family_id, null, "item legado não pode ganhar family_id inventado");
    assert.strictEqual(linha.variations_count, 24);
    console.log("  ✓ listarAgrupado() marca item legado sem family/UP com variations_count > 0");
  });

  // 3b. item realmente simples (sem family/UP, sem variações) continua simples.
  await withMockDbListagem({
    anuncios: [anuncio({ item_id: "MLB-SIMPLES", variations_count: 0 })],
  }, async () => {
    const resultado = await meliFamiliaService.listarAgrupado({ clienteId: 1 });
    const linha = resultado.anuncios.find((a) => a.item_id === "MLB-SIMPLES");
    assert.strictEqual(linha.tipo, "item");
    assert.strictEqual(linha.variations_count, 0);
    console.log("  ✓ listarAgrupado() mantém item sem variações como anúncio simples (variations_count = 0)");
  });

  // 3c. item do modelo NOVO (family_id/user_product_id) não é afetado por
  // variations_count — mesmo que a linha tivesse um valor >0 por engano de
  // dado (ex.: item pré-migração recém sincronizado), a hierarquia família ->
  // UP continua vindo só de meli_user_products, nunca de variations_count.
  await withMockDbListagem({
    anuncios: [
      anuncio({ item_id: "MLB-A1", user_product_id: "UP1", variations_count: 3 }),
      anuncio({ item_id: "MLB-A2", user_product_id: "UP2", variations_count: 0 }),
    ],
    userProducts: [
      { cliente_id: 1, user_product_id: "UP1", family_id: "FAM-1", family_name: "Familia 1" },
      { cliente_id: 1, user_product_id: "UP2", family_id: "FAM-1", family_name: "Familia 1" },
    ],
  }, async () => {
    const resultado = await meliFamiliaService.listarAgrupado({ clienteId: 1 });
    assert.strictEqual(resultado.anuncios.length, 1, "os dois UPs da mesma família têm de virar UM grupo");
    const grupo = resultado.anuncios[0];
    assert.strictEqual(grupo.tipo, "familia");
    assert.strictEqual(grupo.family_id, "FAM-1");
    assert.strictEqual(grupo.total_user_products, 2);
    assert.strictEqual(
      grupo.variations_count, undefined,
      "variations_count não é um conceito do grupo família — não deve aparecer na linha de família"
    );
    console.log("  ✓ listarAgrupado() não deixa variations_count vazar para a hierarquia família/UP do modelo novo");
  });

  // 4. dado antigo/NULL (linha sincronizada antes desta migração) não quebra
  // a listagem — vira anúncio simples, nunca erro.
  await withMockDbListagem({
    anuncios: [(() => { const a = anuncio({ item_id: "MLB-ANTIGO" }); delete a.variations_count; return a; })()],
  }, async () => {
    const resultado = await meliFamiliaService.listarAgrupado({ clienteId: 1 });
    const linha = resultado.anuncios.find((a) => a.item_id === "MLB-ANTIGO");
    assert.strictEqual(linha.tipo, "item");
    assert.strictEqual(linha.variations_count, 0, "NULL/ausente vira 0, nunca null solto pro front");
    console.log("  ✓ listarAgrupado() trata variations_count NULL/ausente como 0, sem quebrar");
  });
}

async function run() {
  testMapearItem();
  await testUpsert();
  await testListarAgrupado();
}

run()
  .then(() => {
    console.log("\n✓ meliAnunciosVariacoesLegado.test.js — todos os testes passaram");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n✗ meliAnunciosVariacoesLegado.test.js falhou:", err);
    process.exit(1);
  });
