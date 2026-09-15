// server/tests/meliUserProducts.test.js
//
// PR 1 da modelagem B+ de anúncios ML: `meli_user_products` como entidade de
// primeira classe, alimentada pelo multiget /items que a sincronização JÁ faz.
//
//   meli_anuncios --user_product_id--> meli_user_products --family_id
//
// A Fase 0 provou que GET /items retorna family_id, user_product_id, site_id e
// domain_id juntos — nenhuma chamada extra ao Mercado Livre é necessária.
//
// Cobre:
//   1-3. mlClient.bigIntFields — parsing que preserva IDs acima de
//        Number.MAX_SAFE_INTEGER (family_id real observado chega a 99,48% do
//        limite; JSON.parse puro corromperia em silêncio);
//   4-5. mapearItem() capturando family_id / site_id / domain_id;
//   6-10. registrarUserProducts() — dedupe, upsert, escopo por cliente;
//   11. a tabela de UP nunca derruba a sincronização de anúncio;
//   12. family_id NÃO é gravado em meli_anuncios (decisão arquitetural 3).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const Module = require("module");

// O mlClient REAL é carregado antes do stub — os casos 1-3 testam o parser de
// verdade, e não o dublê que os serviços enxergam.
const mlClientReal = require("../utils/mlClient");

// ── stub do mlClient para os serviços ───────────────────────────────────────
let respostaMultiget = [];
const originalLoad = Module._load;
Module._load = function loadWithMlFetchStub(request, parent, isMain) {
  if (request === "../../utils/mlClient" || request === "../utils/mlClient") {
    return {
      async mlFetch(clienteId, path, options = {}) {
        if (path.includes("/items/search")) {
          return {
            ok: true,
            status: 200,
            data: { results: respostaMultiget.map((b) => b.id), scroll_id: null },
          };
        }
        if (path.startsWith("/items?ids=")) {
          const ids = path.replace("/items?ids=", "").split(",");
          return {
            ok: true,
            status: 200,
            data: ids
              .map((id) => respostaMultiget.find((b) => b.id === id))
              .filter(Boolean)
              .map((body) => ({ code: 200, body })),
          };
        }
        return { ok: true, status: 200, data: {} };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pool = require("../config/database");
const meliAnunciosService = require("../services/meliAnuncios/meliAnunciosService");
const meliSyncService = require("../services/meliAnuncios/meliSyncService");
const meliFamiliaService = require("../services/meliAnuncios/meliFamiliaService");

Module._load = originalLoad;

// ── fixtures ────────────────────────────────────────────────────────────────

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

// Item no modelo User Product: traz family_id, user_product_id, site_id e
// domain_id — exatamente como a Fase 0 observou em produção.
function itemUP(over = {}) {
  return {
    id: "MLB1",
    title: "Camisa De Pesca",
    status: "active",
    price: 100,
    attributes: [],
    pictures: [],
    site_id: "MLB",
    domain_id: "MLB-FISHING_SHIRTS",
    catalog_listing: false,
    family_name: "Camisa De Pesca Traira E Espada",
    family_id: "5424136139438415",
    user_product_id: "MLBU4607668110",
    ...over,
  };
}

// Item legado (multivariante não migrado): sem UP, sem família.
function itemLegado(over = {}) {
  return {
    id: "MLB9",
    title: "Produto legado",
    status: "active",
    price: 50,
    attributes: [],
    pictures: [],
    site_id: "MLB",
    domain_id: "MLB-SHIRTS",
    catalog_listing: false,
    ...over,
  };
}

class MockDb {
  constructor({ contas = [], grants = [] } = {}) {
    this.contas = contas;
    this.grants = grants;
    this.anuncios = [];
    this.userProducts = [];
    this.falharUserProducts = false;
  }

  async connect() {
    return { query: (sql, params) => this.query(sql, params), release() {} };
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    // --- fundação Cliente/Conta ------------------------------------------
    if (q.includes("FROM clientes WHERE id = $1")) {
      return { rows: cliente.id === Number(params[0]) ? [cliente] : [] };
    }
    if (q.includes("FROM clientes WHERE LOWER(slug) = $1")) {
      return { rows: cliente.slug === params[0] ? [cliente] : [] };
    }
    if (q.startsWith("SELECT * FROM cliente_contas WHERE id = $1")) {
      const conta = this.contas.find((c) => c.id === Number(params[0]));
      return { rows: conta ? [conta] : [] };
    }
    if (q.includes("FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true ORDER BY is_primary")) {
      return { rows: this.contas.filter((c) => c.cliente_id === params[0] && c.marketplace === params[1] && c.ativo !== false) };
    }
    if (q.includes("COUNT(*)::int AS total FROM cliente_contas")) {
      const total = this.contas.filter((c) => c.cliente_id === params[0] && c.ativo !== false && c.marketplace === "meli").length;
      return { rows: [{ total }] };
    }
    if (q.includes("t.cliente_id = $1 AND t.ml_user_id = $2")) {
      const row = this.grants.find((g) => g.cliente_id === params[0] && String(g.ml_user_id) === String(params[1]));
      return { rows: row ? [row] : [] };
    }
    if (q.includes("FROM ml_tokens t") && q.includes("WHERE t.cliente_id = $1")) {
      return { rows: this.grants.filter((g) => g.cliente_id === params[0]) };
    }
    if (q.includes("base_cliente_vinculos")) {
      return { rows: [] };
    }

    // --- schema ------------------------------------------------------------
    if (q.startsWith("CREATE TABLE") || q.startsWith("ALTER TABLE") || q.startsWith("CREATE INDEX")) {
      return { rows: [] };
    }

    // --- meli_anuncios: upsert --------------------------------------------
    if (q.startsWith("INSERT INTO meli_anuncios")) {
      const colunas = (q.match(/INSERT INTO meli_anuncios \(([^)]+)\)/) || [])[1] || "";
      const nomes = colunas.split(",").map((c) => c.trim()).filter((c) => c && c !== "last_synced_at" && c !== "updated_at");
      const row = {};
      nomes.forEach((nome, i) => { row[nome] = params[i]; });
      // guarda a lista de colunas do INSERT para o caso 12
      row.__colunas = nomes;
      const existente = this.anuncios.find((a) => a.cliente_id === row.cliente_id && a.item_id === row.item_id);
      if (existente) Object.assign(existente, row);
      else this.anuncios.push(row);
      return { rows: [] };
    }

    if (q.startsWith("SELECT item_id FROM meli_anuncios WHERE cliente_id = $1")) {
      return { rows: this.anuncios.filter((a) => a.cliente_id === params[0]).map((a) => ({ item_id: a.item_id })) };
    }

    // --- meli_user_products: upsert ---------------------------------------
    if (q.startsWith("INSERT INTO meli_user_products")) {
      if (this.falharUserProducts) throw new Error("falha proposital em meli_user_products");
      const [
        cliente_id, cliente_conta_id, ml_user_id, user_product_id,
        family_id, family_name, site_id, domain_id, catalog_product_id,
      ] = params;
      const existente = this.userProducts.find(
        (u) => u.cliente_id === cliente_id && u.user_product_id === user_product_id
      );
      const row = {
        cliente_id, cliente_conta_id, ml_user_id, user_product_id,
        family_id, family_name, site_id, domain_id, catalog_product_id,
      };
      if (existente) {
        // espelha o COALESCE do ON CONFLICT: family_id nulo não apaga o bom
        Object.assign(existente, row, {
          family_id: row.family_id != null ? row.family_id : existente.family_id,
        });
      } else {
        this.userProducts.push(row);
      }
      return { rows: [] };
    }

    return { rows: [] };
  }
}

function withMockDb(dbOpts, fn) {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const db = new MockDb(dbOpts);
  pool.query = (sql, params) => db.query(sql, params);
  pool.connect = () => db.connect();
  return Promise.resolve()
    .then(() => fn(db))
    .finally(() => {
      pool.query = originalQuery;
      pool.connect = originalConnect;
    });
}

// external_account_id é o campo que vira mlUserId em
// resolveMarketplaceAccountContext — não `ml_user_id`.
const contaUnica = {
  contas: [{
    id: 10, cliente_id: 1, marketplace: "meli", external_account_id: "900",
    nome: "Conta A", ativo: true, is_primary: true,
  }],
  grants: [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "900" })],
};

// ── casos ───────────────────────────────────────────────────────────────────

async function run() {
  // 1. O parser preserva IDs acima de Number.MAX_SAFE_INTEGER — e o teste prova
  //    que o caminho ingênuo (JSON.parse puro) corromperia o mesmo valor.
  {
    const texto = '{"id":"MLBU1","family_id":18446744000000000615}';
    const seguro = mlClientReal.parseJsonPreservingIds(texto, ["family_id"]);
    assert.strictEqual(seguro.family_id, "18446744000000000615");

    const ingenuo = JSON.parse(texto);
    assert.notStrictEqual(
      String(ingenuo.family_id),
      "18446744000000000615",
      "JSON.parse puro deveria corromper este valor — se não corrompe, o teste perdeu o sentido"
    );
    console.log("  ✓ parseJsonPreservingIds preserva ID acima de MAX_SAFE_INTEGER (JSON.parse puro corrompe)");
  }

  // 2. Idempotente: valor que já veio como string não é re-processado.
  {
    const texto = '{"family_id":"5424136139438415"}';
    const r = mlClientReal.parseJsonPreservingIds(texto, ["family_id"]);
    assert.strictEqual(r.family_id, "5424136139438415");

    // e o campo não listado continua número
    const r2 = mlClientReal.parseJsonPreservingIds('{"family_id":1,"price":100}', ["family_id"]);
    assert.strictEqual(r2.family_id, "1");
    assert.strictEqual(r2.price, 100);
    console.log("  ✓ parseJsonPreservingIds é idempotente e só toca os campos listados");
  }

  // 3. É genérico — não é uma solução específica para family_id (decisão 5).
  {
    const texto = '{"inventory_id":9007199254740993,"outro":{"inventory_id":12345}}';
    const r = mlClientReal.parseJsonPreservingIds(texto, ["inventory_id"]);
    assert.strictEqual(r.inventory_id, "9007199254740993");
    assert.strictEqual(r.outro.inventory_id, "12345", "deve alcançar o campo aninhado");

    // vários campos de uma vez
    const r2 = mlClientReal.parseJsonPreservingIds('{"a":111,"b":222}', ["a", "b"]);
    assert.deepStrictEqual(r2, { a: "111", b: "222" });
    console.log("  ✓ parseJsonPreservingIds é genérico (qualquer campo, inclusive aninhado)");
  }

  // 4. mapearItem() captura family_id como STRING, site_id e domain_id.
  {
    const r = meliSyncService.mapearItem(
      itemUP({ family_id: "8959937601307983" }), 1, "cliente-a", 10, "900"
    );
    assert.strictEqual(r.family_id, "8959937601307983");
    assert.strictEqual(typeof r.family_id, "string");
    assert.strictEqual(r.user_product_id, "MLBU4607668110");
    assert.strictEqual(r.site_id, "MLB");
    assert.strictEqual(r.domain_id, "MLB-FISHING_SHIRTS");
    console.log("  ✓ mapearItem() captura family_id (string), site_id e domain_id");
  }

  // 5. Item legado (sem UP) não inventa família.
  {
    const r = meliSyncService.mapearItem(itemLegado(), 1, "cliente-a");
    assert.strictEqual(r.user_product_id, null);
    assert.strictEqual(r.family_id, null);
    console.log("  ✓ mapearItem() não inventa family_id para item legado sem user_product_id");
  }

  // 6. Dedupe: 45 itens do mesmo User Product geram 1 linha, não 45.
  await withMockDb({}, async (db) => {
    const registros = [];
    for (let i = 0; i < 45; i++) {
      registros.push(meliSyncService.mapearItem(
        itemUP({ id: `MLB${i}`, user_product_id: "MLBU-UNICO" }), 1, "cliente-a", 10, "900"
      ));
    }
    const salvos = await meliFamiliaService.registrarUserProducts(registros);
    assert.strictEqual(db.userProducts.length, 1, "45 itens do mesmo UP devem gerar 1 linha");
    assert.strictEqual(salvos, 1);
    assert.strictEqual(db.userProducts[0].family_id, "5424136139438415");
    console.log("  ✓ registrarUserProducts() dedupa 45 itens do mesmo UP em 1 linha");
  });

  // 7. UPs distintos da mesma família: N linhas, 1 family_id.
  await withMockDb({}, async (db) => {
    const registros = ["MLBU4607668110", "MLBU4581405457", "MLBU4607668128"].map((up, i) =>
      meliSyncService.mapearItem(itemUP({ id: `MLB${i}`, user_product_id: up }), 1, "cliente-a", 10, "900")
    );
    await meliFamiliaService.registrarUserProducts(registros);
    assert.strictEqual(db.userProducts.length, 3);
    const familias = new Set(db.userProducts.map((u) => u.family_id));
    assert.strictEqual(familias.size, 1, "os 3 UPs pertencem à mesma família");
    assert.strictEqual([...familias][0], "5424136139438415");
    console.log("  ✓ registrarUserProducts() grava 3 UPs distintos sob 1 family_id");
  });

  // 8. Itens legados não geram linha nenhuma.
  await withMockDb({}, async (db) => {
    const registros = [
      meliSyncService.mapearItem(itemLegado({ id: "MLB90" }), 1, "cliente-a", 10, "900"),
      meliSyncService.mapearItem(itemLegado({ id: "MLB91" }), 1, "cliente-a", 10, "900"),
    ];
    const salvos = await meliFamiliaService.registrarUserProducts(registros);
    assert.strictEqual(db.userProducts.length, 0);
    assert.strictEqual(salvos, 0);
    console.log("  ✓ registrarUserProducts() ignora itens legados (sem user_product_id)");
  });

  // 9. Upsert: não duplica, e atualiza quando o UP muda de família.
  await withMockDb({}, async (db) => {
    const base = meliSyncService.mapearItem(itemUP(), 1, "cliente-a", 10, "900");
    await meliFamiliaService.registrarUserProducts([base]);
    await meliFamiliaService.registrarUserProducts([base]);
    assert.strictEqual(db.userProducts.length, 1, "upsert não pode duplicar");

    const mudou = meliSyncService.mapearItem(
      itemUP({ family_id: "9999999999999999", family_name: "Nova Família" }), 1, "cliente-a", 10, "900"
    );
    await meliFamiliaService.registrarUserProducts([mudou]);
    assert.strictEqual(db.userProducts.length, 1);
    assert.strictEqual(db.userProducts[0].family_id, "9999999999999999");
    assert.strictEqual(db.userProducts[0].family_name, "Nova Família");
    console.log("  ✓ registrarUserProducts() é idempotente e atualiza mudança de família");
  });

  // 10. Escopo por cliente: mesmo user_product_id em 2 clientes = 2 linhas.
  await withMockDb({}, async (db) => {
    const a = meliSyncService.mapearItem(itemUP(), 1, "cliente-a", 10, "900");
    const b = meliSyncService.mapearItem(itemUP(), 2, "cliente-b", 20, "901");
    await meliFamiliaService.registrarUserProducts([a, b]);
    assert.strictEqual(db.userProducts.length, 2, "o mesmo UP em clientes diferentes são linhas diferentes");
    assert.deepStrictEqual(db.userProducts.map((u) => u.cliente_id).sort(), [1, 2]);
    console.log("  ✓ registrarUserProducts() escopa o UP por cliente");
  });

  // 11. A tabela de UP é derivada: falhar nela não derruba a sincronização.
  await withMockDb(contaUnica, async (db) => {
    respostaMultiget = [itemUP({ id: "MLB1" })];
    db.falharUserProducts = true;

    // a falha é proposital: silencia o console.error esperado para manter a
    // saída do teste limpa, e confirma que ele foi emitido.
    const errosOriginal = console.error;
    const erros = [];
    console.error = (...args) => erros.push(args.join(" "));
    let res;
    try {
      res = await meliSyncService.sincronizar({
        clienteId: 1, clienteSlug: "cliente-a", modo: "completo", clienteContaId: 10,
      });
    } finally {
      console.error = errosOriginal;
    }
    assert.ok(
      erros.some((e) => e.includes("meli_user_products_falhou")),
      "a falha precisa ser registrada, não engolida em silêncio"
    );

    assert.strictEqual(res.ok, true, "a sincronização de anúncio não pode cair junto");
    assert.strictEqual(res.totalSalvos, 1);
    assert.strictEqual(db.anuncios.length, 1, "o anúncio tem que estar salvo");
    assert.strictEqual(db.userProducts.length, 0);
    console.log("  ✓ falha em meli_user_products não derruba sincronizar()");
  });

  // 12. Decisão arquitetural 3: family_id NÃO entra em meli_anuncios.
  await withMockDb(contaUnica, async (db) => {
    respostaMultiget = [itemUP({ id: "MLB1" })];

    const res = await meliSyncService.sincronizar({
      clienteId: 1, clienteSlug: "cliente-a", modo: "completo", clienteContaId: 10,
    });

    assert.strictEqual(res.ok, true);
    const anuncio = db.anuncios[0];
    assert.ok(anuncio, "anúncio deveria ter sido gravado");
    assert.ok(
      !anuncio.__colunas.includes("family_id"),
      "family_id NÃO pode estar no INSERT de meli_anuncios — ele vive só em meli_user_products"
    );
    assert.ok(!anuncio.__colunas.includes("site_id"));
    assert.ok(!anuncio.__colunas.includes("domain_id"));
    assert.strictEqual(anuncio.user_product_id, "MLBU4607668110", "user_product_id continua em meli_anuncios");

    // e o UP foi para a tabela certa, com a família
    assert.strictEqual(db.userProducts.length, 1);
    assert.strictEqual(db.userProducts[0].family_id, "5424136139438415");
    assert.strictEqual(db.userProducts[0].site_id, "MLB");
    assert.strictEqual(db.userProducts[0].domain_id, "MLB-FISHING_SHIRTS");
    console.log("  ✓ family_id fica em meli_user_products e NÃO em meli_anuncios");
  });

  console.log("meliUserProducts.test.js passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
