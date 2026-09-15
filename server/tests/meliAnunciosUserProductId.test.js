// server/tests/meliAnunciosUserProductId.test.js
//
// Fase 1 da evolução da modelagem de anúncios ML: persistir `user_product_id`
// (chave estável do ML para futuramente chegar em family_id — ver
// docs/AUDITORIA... / user-products.md). Esta fase NÃO agrupa nada, só grava
// o dado que hoje é lido de /items e descartado.
//
// Cobre:
//  1. mapearItem() extrai user_product_id do payload do ML;
//  2. mapearItem() não quebra e grava null quando o payload não traz o campo;
//  3. upsertAnuncios() grava user_product_id em anúncio novo e ATUALIZA (sem
//     duplicar linha) quando o anúncio já existe com user_product_id nulo.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");

const pool = require("../config/database");
const meliSyncService = require("../services/meliAnuncios/meliSyncService");
const meliAnunciosService = require("../services/meliAnuncios/meliAnunciosService");

// Banco em memória mínimo — só o suficiente para upsertAnuncios(), no mesmo
// espírito do MockDb de anunciosMeliAccountContext.test.js.
class MockDb {
  constructor() {
    this.anuncios = [];
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q.startsWith("CREATE TABLE") || q.startsWith("ALTER TABLE") || q.startsWith("CREATE INDEX")) {
      return { rows: [] };
    }

    if (q.startsWith("INSERT INTO meli_anuncios")) {
      // Mapeia os params pela ORDEM real de upsertAnuncios() — inclui
      // user_product_id como último campo de conteúdo antes de last_synced_at.
      const [
        cliente_id, cliente_slug, item_id, sku, titulo, marca, modelo,
        preco, preco_original, moeda, estoque, vendidos, status, sub_status,
        listing_type_id, category_id, permalink, thumbnail, pictures_count,
        pictures_json, logistic_type, is_full, attributes_json, health,
        score_venforce, score_motivo, cliente_conta_id, ml_user_id,
        catalog_listing, catalog_product_id, family_name, user_product_id,
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
  const db = new MockDb();
  pool.query = (sql, params) => db.query(sql, params);
  return Promise.resolve()
    .then(() => fn(db))
    .finally(() => {
      pool.query = originalQuery;
    });
}

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

async function run() {
  // 1. mapearItem() extrai user_product_id quando presente no payload do ML.
  {
    const registro = meliSyncService.mapearItem(
      itemBase({ user_product_id: "UP123" }),
      1,
      "cliente-a"
    );
    assert.strictEqual(registro.user_product_id, "UP123");
    console.log("  ✓ mapearItem() extrai user_product_id do payload do ML");
  }

  // 2. mapearItem() não quebra e grava null quando o payload não traz o campo.
  {
    const registro = meliSyncService.mapearItem(itemBase(), 1, "cliente-a");
    assert.strictEqual(registro.user_product_id, null);
    console.log("  ✓ mapearItem() grava null quando o payload não traz user_product_id");
  }

  // 3. upsertAnuncios(): anúncio novo grava user_product_id; anúncio existente
  //    com user_product_id NULL é ATUALIZADO (sem duplicar linha) quando a
  //    ressincronização traz o valor.
  await withMockDb(async (db) => {
    const registroNovo = meliSyncService.mapearItem(
      itemBase({ id: "MLB999", user_product_id: "UP999" }),
      1,
      "cliente-a"
    );
    await meliAnunciosService.upsertAnuncios([registroNovo]);

    assert.strictEqual(db.anuncios.length, 1);
    assert.strictEqual(db.anuncios[0].user_product_id, "UP999");
    console.log("  ✓ upsertAnuncios() grava user_product_id em anúncio novo");

    const registroSemUP = meliSyncService.mapearItem(
      itemBase({ id: "MLB999" }),
      1,
      "cliente-a"
    );
    await meliAnunciosService.upsertAnuncios([registroSemUP]);
    assert.strictEqual(db.anuncios.length, 1, "não deve duplicar a linha");
    assert.strictEqual(db.anuncios[0].user_product_id, null);

    const registroAtualizado = meliSyncService.mapearItem(
      itemBase({ id: "MLB999", user_product_id: "UP999-v2" }),
      1,
      "cliente-a"
    );
    await meliAnunciosService.upsertAnuncios([registroAtualizado]);

    assert.strictEqual(db.anuncios.length, 1, "upsert de anúncio existente não duplica a linha");
    assert.strictEqual(db.anuncios[0].item_id, "MLB999");
    assert.strictEqual(db.anuncios[0].user_product_id, "UP999-v2");
    console.log("  ✓ upsertAnuncios() atualiza user_product_id de anúncio existente sem duplicar linha");
  });

  console.log("meliAnunciosUserProductId.test.js passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
