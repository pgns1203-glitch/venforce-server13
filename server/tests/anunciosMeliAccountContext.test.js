// server/tests/anunciosMeliAccountContext.test.js
//
// Prova que o módulo de Anúncios ML (listagem persistida, sincronização e
// criação de anúncios — server/services/meliAnuncios/*) parou de escolher
// "a conta principal" em silêncio via resolveMlGrant({clienteId}) e passou a
// resolver a conta ML exata via resolveMarketplaceAccountContext, no mesmo
// padrão já validado em adsMetricasAccountContext.test.js e
// centralVendasAccountContext.test.js.
//
// meliAnunciosService/meliSyncService/meliCriacaoService usam o `pool`
// singleton diretamente (sem injeção de `queryable`), então trocamos
// temporariamente pool.query por um banco em memória.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
let mlFetchCalls = [];
Module._load = function loadWithMlFetchStub(request, parent, isMain) {
  if (request === "../../utils/mlClient" || request === "../utils/mlClient") {
    return {
      async mlFetch(clienteId, path, options = {}) {
        mlFetchCalls.push({ clienteId, path, mlUserId: options.mlUserId });
        if (path.includes("/items/search")) {
          return { ok: true, status: 200, data: { results: [`MLB-${options.mlUserId}-1`], scroll_id: null } };
        }
        if (path.startsWith("/items?ids=")) {
          const ids = path.replace("/items?ids=", "").split(",");
          return {
            ok: true, status: 200,
            data: ids.map((id) => ({
              code: 200,
              body: { id, title: `Produto ${id}`, status: "active", price: 100, attributes: [], pictures: [] },
            })),
          };
        }
        if (path === "/items" && options.method === "POST") {
          return { ok: true, status: 201, data: { id: "MLBCRIADO", title: "Produto criado", status: "active", price: 100, currency_id: "BRL" } };
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
const meliCriacaoService = require("../services/meliAnuncios/meliCriacaoService");

Module._load = originalLoad;

// ── fixtures ────────────────────────────────────────────────────────────────

const cliente = { id: 1, nome: "Cliente A", slug: "cliente-a", ativo: true };

function grantFixture({ id, cliente_id, ml_user_id, token_status = "valid" }) {
  return {
    id, cliente_id, ml_user_id,
    access_token: "tok", refresh_token: "ref",
    expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    token_status, is_primary: false,
    refresh_failures: 0, updated_at: new Date().toISOString(),
  };
}

class MockDb {
  constructor({ contas = [], grants = [] } = {}) {
    this.contas = contas;
    this.grants = grants;
    this.anuncios = []; // meli_anuncios em memória
    this.publicacoes = []; // meli_anuncio_publicacoes em memória
    this._nextPubId = 1;
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

    // --- schema (meli_anuncios / meli_anuncio_publicacoes) ----------------
    if (q.startsWith("CREATE TABLE") || q.startsWith("ALTER TABLE") || q.startsWith("CREATE INDEX")) {
      return { rows: [] };
    }

    // --- meli_anuncios: upsert ---------------------------------------------
    if (q.startsWith("INSERT INTO meli_anuncios")) {
      const [
        cliente_id, cliente_slug, item_id, sku, titulo, marca, modelo,
        preco, preco_original, moeda, estoque, vendidos, status, sub_status,
        listing_type_id, category_id, permalink, thumbnail, pictures_count,
        pictures_json, logistic_type, is_full, attributes_json, health,
        score_venforce, score_motivo, cliente_conta_id, ml_user_id,
      ] = params;
      const existente = this.anuncios.find((a) => a.cliente_id === cliente_id && a.item_id === item_id);
      const row = {
        cliente_id, cliente_slug, item_id, sku, titulo, marca, modelo,
        preco, preco_original, moeda, estoque, vendidos, status, sub_status,
        listing_type_id, category_id, permalink, thumbnail, pictures_count,
        pictures_json, logistic_type, is_full, attributes_json, health,
        score_venforce, score_motivo, cliente_conta_id, ml_user_id,
        revisado: existente ? existente.revisado : false,
        updated_at: new Date().toISOString(),
      };
      if (existente) Object.assign(existente, row);
      else this.anuncios.push(row);
      return { rows: [] };
    }

    // --- meli_anuncios: itemIdsExistentes -----------------------------------
    if (q.startsWith("SELECT item_id FROM meli_anuncios WHERE cliente_id = $1")) {
      return { rows: this.anuncios.filter((a) => a.cliente_id === params[0]).map((a) => ({ item_id: a.item_id })) };
    }

    // --- meli_anuncios: obterResumo (agregados, distinguido por "AS ativos") --
    if (q.includes("FROM meli_anuncios") && q.includes("AS ativos")) {
      const filtrados = filtrarAnuncios(this.anuncios, q, params);
      return {
        rows: [{
          total: filtrados.length,
          ativos: filtrados.filter((a) => a.status === "active").length,
          pausados: 0, encerrados: 0, fotos_insuficientes: 0, sem_sku: 0,
          score_baixo: 0, full: 0, score_medio: 0, ultima_sync: null,
        }],
      };
    }

    // --- meli_anuncios: total (listarAnuncios) ------------------------------
    if (q.startsWith("SELECT COUNT(*)::int AS total FROM meli_anuncios")) {
      const filtrados = filtrarAnuncios(this.anuncios, q, params);
      return { rows: [{ total: filtrados.length }] };
    }

    // --- meli_anuncios: listagem paginada ------------------------------------
    if (q.startsWith("SELECT item_id, sku, titulo") && q.includes("FROM meli_anuncios")) {
      const filtrados = filtrarAnuncios(this.anuncios, q, params);
      return { rows: filtrados };
    }

    // --- meli_anuncio_publicacoes: insert (salvarPublicacao) ----------------
    if (q.startsWith("INSERT INTO meli_anuncio_publicacoes")) {
      const [cliente_id, cliente_slug, cliente_conta_id, ml_user_id, item_id, permalink, status] = params;
      const row = { id: this._nextPubId++, cliente_id, cliente_slug, cliente_conta_id, ml_user_id, item_id, permalink, status, created_at: new Date().toISOString() };
      this.publicacoes.push(row);
      return { rows: [{ id: row.id, item_id: row.item_id, permalink: row.permalink, status: row.status, created_at: row.created_at }] };
    }

    return { rows: [] };
  }
}

// Filtra o array em memória pelo WHERE cliente_id = $1 [AND cliente_conta_id ...]
// — não interpreta SQL de verdade, só cobre os predicados que este módulo gera.
function filtrarAnuncios(anuncios, sql, params) {
  const clienteId = params[0];
  let rows = anuncios.filter((a) => a.cliente_id === clienteId);
  if (sql.includes("cliente_conta_id = $2 OR cliente_conta_id IS NULL")) {
    const contaId = params[1];
    rows = rows.filter((a) => a.cliente_conta_id === contaId || a.cliente_conta_id == null);
  } else if (sql.includes("cliente_conta_id = $2")) {
    const contaId = params[1];
    rows = rows.filter((a) => a.cliente_conta_id === contaId);
  }
  return rows;
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

async function assertThrows(promise, matcher) {
  let errou = false;
  try {
    await promise;
  } catch (err) {
    errou = true;
    matcher(err);
  }
  assert.ok(errou, "esperava erro, mas a operação teve sucesso");
}

async function run() {
  // 1. Uma conta ML ativa — sync resolve sozinho, todo mlFetch usa o mlUserId
  //    certo, upsert grava cliente_conta_id/ml_user_id.
  await withMockDb(
    {
      contas: [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", external_account_id: "111", is_primary: true, ativo: true }],
      grants: [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })],
    },
    async (db) => {
      mlFetchCalls = [];
      const res = await meliSyncService.sincronizar({ clienteId: 1, clienteSlug: "cliente-a", modo: "novos" });
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.contaId, 10);
      assert.ok(mlFetchCalls.every((c) => c.mlUserId === "111"), "toda chamada de sync deve usar o mlUserId da única conta");
      const anuncio = db.anuncios.find((a) => a.cliente_id === 1);
      assert.strictEqual(anuncio.cliente_conta_id, 10);
      assert.strictEqual(anuncio.ml_user_id, "111");
      console.log("  ✓ 1 conta ML ativa: sync resolve sozinho e grava cliente_conta_id/ml_user_id corretos");
    }
  );

  // 2. Duas contas ML sem clienteContaId — nunca escolhe sozinho.
  await withMockDb(
    {
      contas: [
        { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", external_account_id: "111", is_primary: true, ativo: true },
        { id: 11, cliente_id: 1, marketplace: "meli", nome: "ML 2", external_account_id: "222", is_primary: false, ativo: true },
      ],
      grants: [
        grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" }),
        grantFixture({ id: 101, cliente_id: 1, ml_user_id: "222" }),
      ],
    },
    async () => {
      mlFetchCalls = [];
      await assertThrows(
        meliSyncService.sincronizar({ clienteId: 1, clienteSlug: "cliente-a", modo: "novos" }),
        (err) => {
          assert.strictEqual(err.statusCode, 409);
          assert.strictEqual(err.code, "MULTIPLE_MARKETPLACE_ACCOUNTS");
          assert.strictEqual(err.contas.length, 2);
        }
      );
      assert.strictEqual(mlFetchCalls.length, 0, "sync não deve chamar a API ML sem saber de qual conta");

      await assertThrows(
        meliAnunciosService.resolverContextoConta({ clienteId: 1, requireUsableGrant: false }),
        (err) => assert.strictEqual(err.code, "MULTIPLE_MARKETPLACE_ACCOUNTS")
      );
      console.log("  ✓ 2 contas ML sem clienteContaId: sync e resolverContextoConta lançam 409, nenhuma API chamada");
    }
  );

  // 3. clienteContaId explícito isola a conta — sync de A depois B nunca mistura.
  await withMockDb(
    {
      contas: [
        { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", external_account_id: "111", is_primary: true, ativo: true },
        { id: 11, cliente_id: 1, marketplace: "meli", nome: "ML 2", external_account_id: "222", is_primary: false, ativo: true },
      ],
      grants: [
        grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" }),
        grantFixture({ id: 101, cliente_id: 1, ml_user_id: "222" }),
      ],
    },
    async (db) => {
      mlFetchCalls = [];
      await meliSyncService.sincronizar({ clienteId: 1, clienteSlug: "cliente-a", modo: "novos", clienteContaId: 10 });
      assert.ok(mlFetchCalls.every((c) => c.mlUserId === "111"));

      mlFetchCalls = [];
      await meliSyncService.sincronizar({ clienteId: 1, clienteSlug: "cliente-a", modo: "novos", clienteContaId: 11 });
      assert.ok(mlFetchCalls.every((c) => c.mlUserId === "222"), "clienteContaId=11 nunca deve usar o mlUserId=111 da outra conta");

      const daContaA = db.anuncios.filter((a) => a.cliente_conta_id === 10);
      const daContaB = db.anuncios.filter((a) => a.cliente_conta_id === 11);
      assert.ok(daContaA.length > 0 && daContaB.length > 0);
      assert.ok(daContaA.every((a) => a.ml_user_id === "111"));
      assert.ok(daContaB.every((a) => a.ml_user_id === "222"));
      console.log("  ✓ clienteContaId explícito isola a conta na sincronização, sem mistura entre contas");
    }
  );

  // 4. Linhas históricas (cliente_conta_id IS NULL) aparecem com includeLegacy
  //    e somem quando includeLegacy=false (2+ contas, uma escolhida).
  await withMockDb({}, async (db) => {
    db.anuncios.push(
      { cliente_id: 1, item_id: "MLB-LEGADO", titulo: "Legado", status: "active", cliente_conta_id: null, ml_user_id: null, revisado: false },
      { cliente_id: 1, item_id: "MLB-CONTA10", titulo: "Conta 10", status: "active", cliente_conta_id: 10, ml_user_id: "111", revisado: false }
    );

    const semFiltro = await meliAnunciosService.listarAnuncios({ clienteId: 1 });
    assert.strictEqual(semFiltro.anuncios.length, 2, "sem clienteContaId, comportamento atual preservado (mostra tudo)");

    const comIncludeLegacy = await meliAnunciosService.listarAnuncios({ clienteId: 1, clienteContaId: 10, includeLegacy: true });
    assert.strictEqual(comIncludeLegacy.anuncios.length, 2, "includeLegacy=true mostra a conta escolhida + legado");

    const semIncludeLegacy = await meliAnunciosService.listarAnuncios({ clienteId: 1, clienteContaId: 10, includeLegacy: false });
    assert.strictEqual(semIncludeLegacy.anuncios.length, 1, "includeLegacy=false (2+ contas ativas) esconde o legado");
    assert.strictEqual(semIncludeLegacy.anuncios[0].item_id, "MLB-CONTA10");

    const resumoComLegado = await meliAnunciosService.obterResumo(1, 10, true);
    assert.strictEqual(resumoComLegado.total, 2);
    const resumoSemLegado = await meliAnunciosService.obterResumo(1, 10, false);
    assert.strictEqual(resumoSemLegado.total, 1);
    console.log("  ✓ linhas históricas (cliente_conta_id NULL) respeitam includeLegacy em listarAnuncios/obterResumo");
  });

  // 5. createMercadoLivreItem com conta explícita grava cliente_conta_id certo
  //    e usa o mlUserId certo no POST /items.
  await withMockDb(
    {
      contas: [
        { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", external_account_id: "111", is_primary: true, ativo: true },
        { id: 11, cliente_id: 1, marketplace: "meli", nome: "ML 2", external_account_id: "222", is_primary: false, ativo: true },
      ],
      grants: [
        grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" }),
        grantFixture({ id: 101, cliente_id: 1, ml_user_id: "222" }),
      ],
    },
    async (db) => {
      mlFetchCalls = [];
      const dados = {
        title: "Fone Bluetooth Premium Com Case",
        category_id: "MLB1234",
        price: 199.9,
        currency_id: "BRL",
        available_quantity: 5,
        condition: "new",
        buying_mode: "buy_it_now",
        listing_type_id: "gold_special",
        pictures: [{ source: "https://http2.mlstatic.com/exemplo.jpg" }],
        attributes: [{ id: "BRAND", value_name: "Genérica" }],
      };
      const resultado = await meliCriacaoService.createMercadoLivreItem({
        clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 11, dados, createdBy: 10,
      });
      assert.strictEqual(resultado.ok, true);
      const postCall = mlFetchCalls.find((c) => c.path === "/items");
      assert.ok(postCall, "deve ter chamado POST /items");
      assert.strictEqual(postCall.mlUserId, "222", "clienteContaId=11 deve publicar usando o mlUserId=222, nunca o 111 da outra conta");
      const publicacao = db.publicacoes.find((p) => p.item_id === "MLBCRIADO");
      assert.ok(publicacao);
      assert.strictEqual(publicacao.cliente_conta_id, 11);
      assert.strictEqual(publicacao.ml_user_id, "222");
      const catalogoLocal = db.anuncios.find((a) => a.item_id === "MLBCRIADO");
      assert.ok(catalogoLocal);
      assert.strictEqual(catalogoLocal.cliente_conta_id, 11);
      console.log("  ✓ createMercadoLivreItem com clienteContaId explícito publica e grava na conta certa");
    }
  );

  console.log("anunciosMeliAccountContext.test.js passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
