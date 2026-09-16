// server/tests/meliAnunciosSemAgrupamento.test.js
//
// Filtro "sem agrupamento" da listagem de Anúncios ML.
//
// Conceito (decisão explícita — NÃO é "sem família"): um anúncio está "sem
// agrupamento" quando não é alcançável pela visão Família -> User Product ->
// Item. São DOIS casos distintos que a UI trata como um só, e um terceiro
// defensivo:
//   1. anúncio sem user_product_id            (legado, nunca migrado ao modelo UP)
//   2. user_product_id existe, mas sem family_id  (o ML não agrupou esse UP)
//   3. user_product_id sem linha em meli_user_products (órfão — 0 em produção,
//      mas o predicado não pode deixar o anúncio sumir das duas abas)
//
// O filtro entra como um novo VALOR do parâmetro `filtro` que já existe
// (mesma porta dos cards de KPI clicáveis), não como um parâmetro novo — o
// contrato atual de GET /anuncios-meli fica intacto.
//
// Cobre:
//   A. garante o schema de meli_user_products (deploy novo não quebra com 500)
//   B. inclui anúncio sem user_product_id
//   C. inclui anúncio cujo UP existe mas tem family_id NULL
//   D. exclui anúncio cujo UP tem family_id (esse aparece na aba de famílias)
//   E. inclui anúncio com UP órfão (sem linha em meli_user_products)
//   F. total/paginação refletem o filtro, não o catálogo inteiro
//   G. respeita account-scope (clienteContaId + includeLegacy)
//   H. contrato intacto: filtro vazio continua devolvendo tudo
//   I. contrato intacto: filtro desconhecido continua caindo no default
//   J. outro filtro existente (sem_fotos) não é afetado
//   K. o controller repassa `filtro` para o service sem tradução

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");

const pool = require("../config/database");
const anunciosService = require("../services/meliAnuncios/meliAnunciosService");
const ctrl = require("../controllers/meliAnunciosController");

// Banco em memória com as DUAS tabelas — o predicado novo correlaciona
// meli_anuncios com meli_user_products, então o mock precisa simular a
// junção como o Postgres faria.
class MockDb {
  constructor({ anuncios = [], userProducts = [] } = {}) {
    this.anuncios = anuncios;
    this.userProducts = userProducts;
    this.sqlExecutado = [];
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();
    this.sqlExecutado.push(q);

    if (q.startsWith("CREATE TABLE") || q.startsWith("ALTER TABLE") || q.startsWith("CREATE INDEX")) {
      return { rows: [] };
    }

    const ehContagem = /^SELECT COUNT\(\*\)::int AS total FROM meli_anuncios/.test(q);
    const ehListagem = /^SELECT item_id, sku, titulo/.test(q) && /FROM meli_anuncios/.test(q);
    if (!ehContagem && !ehListagem) return { rows: [] };

    let linhas = this.anuncios.filter((a) => a.cliente_id === params[0]);

    // Account-scope: as duas formas que listarAnuncios() monta hoje.
    if (/\(cliente_conta_id = \$2 OR cliente_conta_id IS NULL\)/.test(q)) {
      linhas = linhas.filter((a) => a.cliente_conta_id === params[1] || a.cliente_conta_id == null);
    } else if (/cliente_conta_id = \$2/.test(q)) {
      linhas = linhas.filter((a) => a.cliente_conta_id === params[1]);
    }

    // Predicado novo: "sem agrupamento".
    if (/NOT EXISTS \( SELECT 1 FROM meli_user_products/.test(q)) {
      linhas = linhas.filter((a) => {
        if (a.user_product_id == null) return true;
        const up = this.userProducts.find(
          (u) => u.cliente_id === a.cliente_id && u.user_product_id === a.user_product_id
        );
        return !up || up.family_id == null;
      });
    }

    // Filtro pré-existente usado como controle de regressão.
    if (/COALESCE\(pictures_count, 0\) < 3/.test(q)) {
      linhas = linhas.filter((a) => (a.pictures_count || 0) < 3);
    }

    if (ehContagem) return { rows: [{ total: linhas.length }] };

    const limit = params[params.length - 2];
    const offset = params[params.length - 1];
    return { rows: linhas.slice(offset, offset + limit) };
  }
}

function withMockDb(dados, fn) {
  const originalQuery = pool.query;
  const db = new MockDb(dados);
  pool.query = (sql, params) => db.query(sql, params);
  return Promise.resolve()
    .then(() => fn(db))
    .finally(() => {
      pool.query = originalQuery;
    });
}

function anuncio(overrides = {}) {
  return {
    cliente_id: 1,
    cliente_conta_id: 10,
    item_id: "MLB1",
    user_product_id: null,
    pictures_count: 5,
    ...overrides,
  };
}

function up(overrides = {}) {
  return {
    cliente_id: 1,
    user_product_id: "UP1",
    family_id: "FAM1",
    ...overrides,
  };
}

function ids(resultado) {
  return resultado.anuncios.map((a) => a.item_id).sort();
}

async function run() {
  // A. o predicado lê meli_user_products — em deploy novo a tabela pode ainda
  //    não existir. O filtro precisa garantir o schema em vez de dar 500.
  //
  //    Roda PRIMEIRO de propósito: ensureSchema() tem cache por processo, então
  //    só o primeiro uso do filtro emite o CREATE TABLE. É exatamente o que
  //    acontece em produção — a garantia é do boot, não de toda consulta.
  await withMockDb(
    { anuncios: [], userProducts: [] },
    async (db) => {
      await anunciosService.listarAnuncios({ clienteId: 1, filtro: "sem_agrupamento" });
      const criou = db.sqlExecutado.some((q) =>
        /CREATE TABLE IF NOT EXISTS meli_user_products/.test(q)
      );
      assert.ok(criou, "deve garantir o schema de meli_user_products antes de consultá-la");
      console.log("  ✓ A. garante o schema de meli_user_products");
    }
  );

  // B. anúncio sem user_product_id entra no filtro.
  await withMockDb(
    {
      anuncios: [
        anuncio({ item_id: "MLB-SEM-UP", user_product_id: null }),
        anuncio({ item_id: "MLB-AGRUPADO", user_product_id: "UP1" }),
      ],
      userProducts: [up({ user_product_id: "UP1", family_id: "FAM1" })],
    },
    async () => {
      const r = await anunciosService.listarAnuncios({ clienteId: 1, filtro: "sem_agrupamento" });
      assert.deepStrictEqual(ids(r), ["MLB-SEM-UP"]);
      console.log("  ✓ B. inclui anúncio sem user_product_id");
    }
  );

  // C. UP existe mas sem family_id — o ML não agrupou. Entra no filtro.
  await withMockDb(
    {
      anuncios: [anuncio({ item_id: "MLB-UP-SEM-FAM", user_product_id: "UP-ORFA" })],
      userProducts: [up({ user_product_id: "UP-ORFA", family_id: null })],
    },
    async () => {
      const r = await anunciosService.listarAnuncios({ clienteId: 1, filtro: "sem_agrupamento" });
      assert.deepStrictEqual(ids(r), ["MLB-UP-SEM-FAM"]);
      console.log("  ✓ C. inclui anúncio cujo user_product_id não tem family_id");
    }
  );

  // D. UP com family_id fica FORA — esse anúncio aparece na aba de famílias.
  await withMockDb(
    {
      anuncios: [anuncio({ item_id: "MLB-COM-FAM", user_product_id: "UP1" })],
      userProducts: [up({ user_product_id: "UP1", family_id: "FAM1" })],
    },
    async () => {
      const r = await anunciosService.listarAnuncios({ clienteId: 1, filtro: "sem_agrupamento" });
      assert.deepStrictEqual(ids(r), []);
      console.log("  ✓ D. exclui anúncio cujo user_product_id tem family_id");
    }
  );

  // E. UP referenciado sem linha em meli_user_products: o anúncio não pode
  //    sumir das duas abas — entra em "sem agrupamento".
  await withMockDb(
    {
      anuncios: [anuncio({ item_id: "MLB-UP-FANTASMA", user_product_id: "UP-INEXISTENTE" })],
      userProducts: [],
    },
    async () => {
      const r = await anunciosService.listarAnuncios({ clienteId: 1, filtro: "sem_agrupamento" });
      assert.deepStrictEqual(ids(r), ["MLB-UP-FANTASMA"]);
      console.log("  ✓ E. inclui anúncio com user_product_id órfão");
    }
  );

  // F. total/paginação contam só o que passou pelo filtro.
  await withMockDb(
    {
      anuncios: [
        anuncio({ item_id: "MLB-A", user_product_id: null }),
        anuncio({ item_id: "MLB-B", user_product_id: "UP-SEM-FAM" }),
        anuncio({ item_id: "MLB-C", user_product_id: "UP-COM-FAM" }),
        anuncio({ item_id: "MLB-D", user_product_id: "UP-COM-FAM" }),
      ],
      userProducts: [
        up({ user_product_id: "UP-SEM-FAM", family_id: null }),
        up({ user_product_id: "UP-COM-FAM", family_id: "FAM1" }),
      ],
    },
    async () => {
      const r = await anunciosService.listarAnuncios({
        clienteId: 1, filtro: "sem_agrupamento", page: 1, limit: 1,
      });
      assert.strictEqual(r.paginacao.total, 2, "total conta só os sem agrupamento");
      assert.strictEqual(r.paginacao.totalPaginas, 2);
      assert.strictEqual(r.anuncios.length, 1, "a página respeita o limit");
      console.log("  ✓ F. total e paginação refletem o filtro");
    }
  );

  // G. account-scope continua valendo junto com o filtro novo.
  await withMockDb(
    {
      anuncios: [
        anuncio({ item_id: "MLB-CONTA-10", cliente_conta_id: 10, user_product_id: null }),
        anuncio({ item_id: "MLB-LEGADO", cliente_conta_id: null, user_product_id: null }),
        anuncio({ item_id: "MLB-CONTA-20", cliente_conta_id: 20, user_product_id: null }),
      ],
      userProducts: [],
    },
    async () => {
      const comLegado = await anunciosService.listarAnuncios({
        clienteId: 1, clienteContaId: 10, includeLegacy: true, filtro: "sem_agrupamento",
      });
      assert.deepStrictEqual(ids(comLegado), ["MLB-CONTA-10", "MLB-LEGADO"]);

      const semLegado = await anunciosService.listarAnuncios({
        clienteId: 1, clienteContaId: 10, includeLegacy: false, filtro: "sem_agrupamento",
      });
      assert.deepStrictEqual(ids(semLegado), ["MLB-CONTA-10"]);
      console.log("  ✓ G. respeita account-scope (includeLegacy true e false)");
    }
  );

  // H. contrato intacto: sem filtro, devolve tudo (agrupado e não agrupado).
  await withMockDb(
    {
      anuncios: [
        anuncio({ item_id: "MLB-A", user_product_id: null }),
        anuncio({ item_id: "MLB-B", user_product_id: "UP1" }),
      ],
      userProducts: [up({ user_product_id: "UP1", family_id: "FAM1" })],
    },
    async () => {
      const r = await anunciosService.listarAnuncios({ clienteId: 1 });
      assert.deepStrictEqual(ids(r), ["MLB-A", "MLB-B"]);
      console.log("  ✓ H. filtro vazio continua devolvendo o catálogo inteiro");
    }
  );

  // I. contrato intacto: valor desconhecido continua no default (não filtra).
  await withMockDb(
    {
      anuncios: [
        anuncio({ item_id: "MLB-A", user_product_id: null }),
        anuncio({ item_id: "MLB-B", user_product_id: "UP1" }),
      ],
      userProducts: [up({ user_product_id: "UP1", family_id: "FAM1" })],
    },
    async () => {
      const r = await anunciosService.listarAnuncios({ clienteId: 1, filtro: "valor_inventado" });
      assert.deepStrictEqual(ids(r), ["MLB-A", "MLB-B"]);
      console.log("  ✓ I. filtro desconhecido continua caindo no default");
    }
  );

  // J. regressão: um filtro pré-existente continua funcionando igual.
  await withMockDb(
    {
      anuncios: [
        anuncio({ item_id: "MLB-POUCAS-FOTOS", pictures_count: 1, user_product_id: "UP1" }),
        anuncio({ item_id: "MLB-MUITAS-FOTOS", pictures_count: 8, user_product_id: null }),
      ],
      userProducts: [up({ user_product_id: "UP1", family_id: "FAM1" })],
    },
    async () => {
      const r = await anunciosService.listarAnuncios({ clienteId: 1, filtro: "sem_fotos" });
      assert.deepStrictEqual(ids(r), ["MLB-POUCAS-FOTOS"]);
      console.log("  ✓ J. filtro sem_fotos não foi afetado");
    }
  );

  // K. o controller repassa `filtro` cru para o service — a aba de "sem
  //    agrupamento" não precisa de nenhuma lógica especial no frontend.
  {
    const resolverOriginal = anunciosService.resolverCliente;
    const listarOriginal = anunciosService.listarAnuncios;
    let recebido = null;
    anunciosService.resolverCliente = async () => ({ id: 1, slug: "cliente-a", nome: "Cliente A" });
    anunciosService.listarAnuncios = async (args) => {
      recebido = args;
      return { anuncios: [], paginacao: { page: 1, limit: 24, total: 0, totalPaginas: 1 } };
    };
    try {
      const res = {
        statusCode: 200,
        corpo: null,
        status(code) { this.statusCode = code; return this; },
        json(obj) { this.corpo = obj; return this; },
      };
      await ctrl.listar(
        { query: { clienteSlug: "cliente-a", filtro: "sem_agrupamento" } },
        res
      );
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(recebido.filtro, "sem_agrupamento");
      console.log("  ✓ K. controller repassa filtro=sem_agrupamento sem traduzir");
    } finally {
      anunciosService.resolverCliente = resolverOriginal;
      anunciosService.listarAnuncios = listarOriginal;
    }
  }

  console.log("meliAnunciosSemAgrupamento.test.js passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
