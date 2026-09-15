// server/tests/meliAnunciosFamilias.test.js
//
// Nova visão somente leitura: Família -> User Product -> Item MLB.
//
//   GET /anuncios-meli/familias
//   GET /anuncios-meli/familias/:familyId
//
// Regra canônica desta modelagem (decisão explícita, não presumida):
//   meli_anuncios        = autoridade de account-scope (cliente_conta_id)
//   meli_user_products    = autoridade da hierarquia (user_product_id -> family_id)
//
// meli_user_products.cliente_conta_id NUNCA é usado como fronteira de
// segurança — toda leitura parte de meli_anuncios já filtrado pela conta, e
// só então junta com meli_user_products para achar a família.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");

const pool = require("../config/database");
const meliFamiliaService = require("../services/meliAnuncios/meliFamiliaService");
const ctrl = require("../controllers/meliAnunciosController");

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

function anuncioFixture(over = {}) {
  return {
    cliente_id: 1,
    item_id: "MLB1",
    user_product_id: "UP1",
    cliente_conta_id: 10,
    titulo: "Produto 1",
    status: "active",
    preco: 10,
    estoque: 5,
    sku: "SKU1",
    thumbnail: "http://thumb/1",
    permalink: "http://ml/1",
    ...over,
  };
}

function upFixture(over = {}) {
  return {
    cliente_id: 1,
    user_product_id: "UP1",
    family_id: "FAM1",
    family_name: "Familia 1",
    site_id: "MLB",
    domain_id: "MLB-DOM",
    ...over,
  };
}

// ── MockDb ──────────────────────────────────────────────────────────────────
//
// Os 4 novos acessos de leitura usam CTEs (WITH escopo AS (...)) que seriam
// frágeis de casar por texto exato. Cada query real carrega uma tag única
// (comentário SQL) só para o mock reconhecer QUAL consulta é — a lógica de
// junção/filtragem é recalculada aqui em memória, espelhando exatamente o que
// o Postgres faria com os mesmos dados.

function contaFiltro(a, clienteContaId, includeLegacy) {
  if (clienteContaId == null) return true;
  if (includeLegacy) return a.cliente_conta_id === clienteContaId || a.cliente_conta_id == null;
  return a.cliente_conta_id === clienteContaId;
}

class MockDb {
  constructor({ contas = [], grants = [], anuncios = [], userProducts = [] } = {}) {
    this.contas = contas;
    this.grants = grants;
    this.anuncios = anuncios;
    this.userProducts = userProducts;
  }

  async connect() {
    return { query: (sql, params) => this.query(sql, params), release() {} };
  }

  upFor(clienteId, userProductId) {
    return this.userProducts.find(
      (u) => u.cliente_id === clienteId && u.user_product_id === userProductId
    );
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    // --- fundação Cliente/Conta (mesmo padrão dos outros testes do módulo) --
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
    if (q.startsWith("CREATE TABLE") || q.startsWith("ALTER TABLE") || q.startsWith("CREATE INDEX")) {
      return { rows: [] };
    }

    // --- LISTAR_FAMILIAS_PAGINA ------------------------------------------
    if (q.includes("-- LISTAR_FAMILIAS_PAGINA")) {
      let i = 0;
      const clienteId = params[i++];
      const temConta = q.includes("a.cliente_conta_id = $");
      const includeLegacy = temConta ? q.includes("OR a.cliente_conta_id IS NULL)") : true;
      const clienteContaId = temConta ? params[i++] : null;
      const temQ = q.includes("ILIKE $");
      const qTerm = temQ ? String(params[i++]).replace(/^%|%$/g, "").toLowerCase() : null;
      const lim = params[i++];
      const offset = params[i++];

      const escopo = this.anuncios.filter(
        (a) => a.cliente_id === clienteId && a.user_product_id != null && contaFiltro(a, clienteContaId, includeLegacy)
      );

      let joined = escopo
        .map((a) => ({ a, up: this.upFor(clienteId, a.user_product_id) }))
        .filter(({ up }) => up && up.family_id != null);

      if (qTerm) {
        const familiasComMatch = new Set(
          joined
            .filter(({ a, up }) =>
              (up.family_name && up.family_name.toLowerCase().includes(qTerm)) ||
              (a.titulo && a.titulo.toLowerCase().includes(qTerm)) ||
              (a.sku && a.sku.toLowerCase().includes(qTerm)) ||
              (up.user_product_id && up.user_product_id.toLowerCase().includes(qTerm)) ||
              (a.item_id && a.item_id.toLowerCase().includes(qTerm))
            )
            .map(({ up }) => up.family_id)
        );
        joined = joined.filter(({ up }) => familiasComMatch.has(up.family_id));
      }

      const porFamilia = new Map();
      for (const { up } of joined) {
        if (!porFamilia.has(up.family_id)) {
          porFamilia.set(up.family_id, { family_id: up.family_id, family_name: up.family_name, ups: new Set(), totalItens: 0 });
        }
        const g = porFamilia.get(up.family_id);
        g.ups.add(up.user_product_id);
        g.totalItens++;
        if (up.family_name != null) g.family_name = up.family_name;
      }

      let familias = Array.from(porFamilia.values()).map((g) => ({
        family_id: g.family_id,
        family_name: g.family_name,
        total_user_products: g.ups.size,
        total_itens: g.totalItens,
      }));

      familias.sort((x, y) => {
        if (x.family_name == null && y.family_name != null) return 1;
        if (y.family_name == null && x.family_name != null) return -1;
        const xn = x.family_name || "";
        const yn = y.family_name || "";
        if (xn === yn) return String(x.family_id).localeCompare(String(y.family_id));
        return xn.localeCompare(yn);
      });

      const totalFamilias = familias.length;
      const pagina = familias.slice(offset, offset + lim).map((f) => ({ ...f, total_familias: totalFamilias }));
      return { rows: pagina };
    }

    // --- LISTAR_FAMILIAS_UPS_DA_PAGINA -----------------------------------
    if (q.includes("-- LISTAR_FAMILIAS_UPS_DA_PAGINA")) {
      let i = 0;
      const clienteId = params[i++];
      const temConta = q.includes("a.cliente_conta_id = $");
      const includeLegacy = temConta ? q.includes("OR a.cliente_conta_id IS NULL)") : true;
      const clienteContaId = temConta ? params[i++] : null;
      const familyIds = new Set(params[i++]);

      const escopo = this.anuncios.filter(
        (a) => a.cliente_id === clienteId && a.user_product_id != null && contaFiltro(a, clienteContaId, includeLegacy)
      );

      const porChave = new Map();
      for (const a of escopo) {
        const up = this.upFor(clienteId, a.user_product_id);
        if (!up || !familyIds.has(up.family_id)) continue;
        const chave = `${up.family_id}|${up.user_product_id}`;
        if (!porChave.has(chave)) {
          porChave.set(chave, {
            family_id: up.family_id,
            user_product_id: up.user_product_id,
            site_id: up.site_id,
            domain_id: up.domain_id,
            total_itens: 0,
          });
        }
        porChave.get(chave).total_itens++;
      }
      return { rows: Array.from(porChave.values()) };
    }

    // --- SEM_USER_PRODUCT_TOTAL -------------------------------------------
    if (q.includes("-- SEM_USER_PRODUCT_TOTAL")) {
      let i = 0;
      const clienteId = params[i++];
      const temConta = q.includes("a.cliente_conta_id = $");
      const includeLegacy = temConta ? q.includes("OR a.cliente_conta_id IS NULL)") : true;
      const clienteContaId = temConta ? params[i++] : null;
      const total = this.anuncios.filter(
        (a) => a.cliente_id === clienteId && a.user_product_id == null && contaFiltro(a, clienteContaId, includeLegacy)
      ).length;
      return { rows: [{ total }] };
    }

    // --- FAMILIA_DETALHE_ITENS --------------------------------------------
    if (q.includes("-- FAMILIA_DETALHE_ITENS")) {
      let i = 0;
      const clienteId = params[i++];
      const familyId = params[i++];
      const temConta = q.includes("a.cliente_conta_id = $");
      const includeLegacy = temConta ? q.includes("OR a.cliente_conta_id IS NULL)") : true;
      const clienteContaId = temConta ? params[i++] : null;

      const escopo = this.anuncios.filter(
        (a) => a.cliente_id === clienteId && a.user_product_id != null && contaFiltro(a, clienteContaId, includeLegacy)
      );

      const rows = [];
      for (const a of escopo) {
        const up = this.upFor(clienteId, a.user_product_id);
        if (!up || up.family_id !== familyId) continue;
        rows.push({
          item_id: a.item_id,
          user_product_id: a.user_product_id,
          titulo: a.titulo,
          status: a.status,
          preco: a.preco,
          estoque: a.estoque,
          sku: a.sku,
          thumbnail: a.thumbnail,
          permalink: a.permalink,
          site_id: up.site_id,
          domain_id: up.domain_id,
          family_name: up.family_name,
        });
      }
      rows.sort((x, y) =>
        x.user_product_id === y.user_product_id
          ? String(x.item_id).localeCompare(String(y.item_id))
          : String(x.user_product_id).localeCompare(String(y.user_product_id))
      );
      return { rows };
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

function fakeRes() {
  return {
    statusCode: 200,
    corpo: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.corpo = obj; return this; },
  };
}

const contaA = { id: 10, cliente_id: 1, marketplace: "meli", external_account_id: "111", nome: "Conta A", ativo: true, is_primary: true };
const contaB = { id: 20, cliente_id: 1, marketplace: "meli", external_account_id: "222", nome: "Conta B", ativo: true, is_primary: false };

async function run() {
  // A. Hierarquia normal: Família -> múltiplos UPs -> múltiplos MLBs.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB1a", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB1b", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB2a", user_product_id: "UP2" }),
      anuncioFixture({ item_id: "MLB2b", user_product_id: "UP2" }),
    ],
    userProducts: [
      upFixture({ user_product_id: "UP1" }),
      upFixture({ user_product_id: "UP2" }),
    ],
  }, async () => {
    const r = await meliFamiliaService.listarFamilias({ clienteId: 1 });
    assert.strictEqual(r.familias.length, 1);
    const fam = r.familias[0];
    assert.strictEqual(fam.family_id, "FAM1");
    assert.strictEqual(fam.total_user_products, 2);
    assert.strictEqual(fam.total_itens, 4);
    assert.strictEqual(fam.user_products.length, 2);
    for (const up of fam.user_products) assert.strictEqual(up.total_itens, 2);
    console.log("  ✓ A. hierarquia Família -> UPs -> MLBs");
  });

  // B. Múltiplos MLBs no mesmo UP: não duplica o UP no payload.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB1a", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB1b", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB1c", user_product_id: "UP1" }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1" })],
  }, async () => {
    const r = await meliFamiliaService.listarFamilias({ clienteId: 1 });
    assert.strictEqual(r.familias[0].user_products.length, 1, "UP1 não pode aparecer 3x");
    assert.strictEqual(r.familias[0].user_products[0].total_itens, 3);
    console.log("  ✓ B. UP com 3 MLBs não duplica no payload");
  });

  // C. Paginação conta famílias, nunca itens.
  await withMockDb({
    anuncios: [
      ...Array.from({ length: 10 }, (_, i) => anuncioFixture({ item_id: `MLB-F1-${i}`, user_product_id: "UP1" })),
      anuncioFixture({ item_id: "MLB-F2", user_product_id: "UP2" }),
      ...Array.from({ length: 5 }, (_, i) => anuncioFixture({ item_id: `MLB-F3-${i}`, user_product_id: "UP3" })),
    ],
    userProducts: [
      upFixture({ user_product_id: "UP1", family_id: "FAM1", family_name: "AAA" }),
      upFixture({ user_product_id: "UP2", family_id: "FAM2", family_name: "BBB" }),
      upFixture({ user_product_id: "UP3", family_id: "FAM3", family_name: "CCC" }),
    ],
  }, async () => {
    const r = await meliFamiliaService.listarFamilias({ clienteId: 1, page: 1, limit: 2 });
    assert.strictEqual(r.familias.length, 2, "limit=2 deve trazer 2 famílias, não itens");
    assert.strictEqual(r.paginacao.totalFamilias, 3);
    assert.strictEqual(r.paginacao.totalPaginas, 2);
    console.log("  ✓ C. paginação por família, independente do total de itens");
  });

  // D. Busca por family_name, titulo, sku, user_product_id, item_id.
  const fixturesD = {
    anuncios: [
      anuncioFixture({ item_id: "MLB-CAMISA", user_product_id: "UP-CAMISA", titulo: "Camisa Azul", sku: "SKU-A" }),
      anuncioFixture({ item_id: "MLB-CALCA", user_product_id: "UP-CALCA", titulo: "Calça Preta", sku: "SKU-B" }),
    ],
    userProducts: [
      upFixture({ user_product_id: "UP-CAMISA", family_id: "FAM-CAMISA", family_name: "Familia Camisas" }),
      upFixture({ user_product_id: "UP-CALCA", family_id: "FAM-CALCA", family_name: "Familia Calcas" }),
    ],
  };
  const casosD = [
    ["Familia Camisas", "FAM-CAMISA"],
    ["Azul", "FAM-CAMISA"],
    ["SKU-B", "FAM-CALCA"],
    ["UP-CALCA", "FAM-CALCA"],
    ["MLB-CAMISA", "FAM-CAMISA"],
  ];
  for (const [termo, esperado] of casosD) {
    await withMockDb(fixturesD, async () => {
      const r = await meliFamiliaService.listarFamilias({ clienteId: 1, q: termo });
      assert.strictEqual(r.familias.length, 1, `q="${termo}" deveria achar exatamente 1 família`);
      assert.strictEqual(r.familias[0].family_id, esperado, `q="${termo}" deveria achar ${esperado}`);
    });
  }
  console.log("  ✓ D. busca por family_name/titulo/sku/user_product_id/item_id");

  // E. Família exclusiva da Conta B não aparece na listagem da Conta A.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-A", user_product_id: "UP-A", cliente_conta_id: 10 }),
      anuncioFixture({ item_id: "MLB-B", user_product_id: "UP-B", cliente_conta_id: 20 }),
    ],
    userProducts: [
      upFixture({ user_product_id: "UP-A", family_id: "FAM-A" }),
      upFixture({ user_product_id: "UP-B", family_id: "FAM-B" }),
    ],
  }, async () => {
    const r = await meliFamiliaService.listarFamilias({ clienteId: 1, clienteContaId: 10, includeLegacy: false });
    const ids = r.familias.map((f) => f.family_id);
    assert.ok(ids.includes("FAM-A"), "FAM-A (da própria conta) deve aparecer");
    assert.ok(!ids.includes("FAM-B"), "FAM-B (exclusiva da Conta B) não pode aparecer para a Conta A");
    console.log("  ✓ E. família exclusiva da Conta B fica fora da listagem da Conta A");
  });

  // F. Detalhe cross-account: Conta A pede familyId exclusivo da B -> 404.
  await withMockDb({
    anuncios: [anuncioFixture({ item_id: "MLB-B", user_product_id: "UP-B", cliente_conta_id: 20 })],
    userProducts: [upFixture({ user_product_id: "UP-B", family_id: "FAM-B" })],
    contas: [contaA, contaB],
    grants: [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" }), grantFixture({ id: 101, cliente_id: 1, ml_user_id: "222" })],
  }, async () => {
    const direto = await meliFamiliaService.obterFamiliaDetalhe({ clienteId: 1, familyId: "FAM-B", clienteContaId: 10, includeLegacy: false });
    assert.strictEqual(direto, null, "família exclusiva da Conta B deve resolver como inexistente para a Conta A");

    const req = { params: { familyId: "FAM-B" }, query: { clienteSlug: "cliente-a", clienteContaId: "10" } };
    const res = fakeRes();
    await ctrl.detalheFamilia(req, res);
    assert.strictEqual(res.statusCode, 404, "o endpoint HTTP deve responder 404, não vazar a família da outra conta");
    console.log("  ✓ F. detalhe cross-account responde 404 (service e HTTP)");
  });

  // G. Família compartilhada entre contas: Conta A só recebe os MLBs do escopo A.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-A", user_product_id: "UP-S", cliente_conta_id: 10 }),
      anuncioFixture({ item_id: "MLB-B", user_product_id: "UP-S", cliente_conta_id: 20 }),
    ],
    userProducts: [upFixture({ user_product_id: "UP-S", family_id: "FAM-S" })],
  }, async () => {
    const familia = await meliFamiliaService.obterFamiliaDetalhe({ clienteId: 1, familyId: "FAM-S", clienteContaId: 10, includeLegacy: false });
    assert.ok(familia, "família compartilhada deve existir para a Conta A (ela também tem itens)");
    const todosItens = familia.user_products.flatMap((up) => up.itens);
    assert.strictEqual(todosItens.length, 1, "só o item da Conta A pode aparecer");
    assert.strictEqual(todosItens[0].item_id, "MLB-A");
    console.log("  ✓ G. família compartilhada: Conta A só vê os MLBs do seu escopo");
  });

  // H. includeLegacy=true inclui linhas com cliente_conta_id NULL.
  await withMockDb({
    anuncios: [anuncioFixture({ item_id: "MLB-LEG", user_product_id: "UP-LEG", cliente_conta_id: null })],
    userProducts: [upFixture({ user_product_id: "UP-LEG", family_id: "FAM-LEG" })],
  }, async () => {
    const r = await meliFamiliaService.listarFamilias({ clienteId: 1, clienteContaId: 10, includeLegacy: true });
    assert.ok(r.familias.some((f) => f.family_id === "FAM-LEG"), "includeLegacy=true deve incluir item com conta NULL");
    console.log("  ✓ H. includeLegacy=true inclui linhas legadas (cliente_conta_id NULL)");
  });

  // I. includeLegacy=false não inclui linhas NULL.
  await withMockDb({
    anuncios: [anuncioFixture({ item_id: "MLB-LEG", user_product_id: "UP-LEG", cliente_conta_id: null })],
    userProducts: [upFixture({ user_product_id: "UP-LEG", family_id: "FAM-LEG" })],
  }, async () => {
    const r = await meliFamiliaService.listarFamilias({ clienteId: 1, clienteContaId: 10, includeLegacy: false });
    assert.ok(!r.familias.some((f) => f.family_id === "FAM-LEG"), "includeLegacy=false não pode incluir item com conta NULL");
    console.log("  ✓ I. includeLegacy=false exclui linhas legadas (cliente_conta_id NULL)");
  });

  // J. sem_user_product respeita ClienteConta/includeLegacy.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-A", user_product_id: null, cliente_conta_id: 10 }),
      anuncioFixture({ item_id: "MLB-NULL", user_product_id: null, cliente_conta_id: null }),
      anuncioFixture({ item_id: "MLB-B", user_product_id: null, cliente_conta_id: 20 }),
    ],
  }, async () => {
    const comLegado = await meliFamiliaService.contarSemUserProduct({ clienteId: 1, clienteContaId: 10, includeLegacy: true });
    assert.strictEqual(comLegado, 2, "conta 10 + NULL = 2");
    const semLegado = await meliFamiliaService.contarSemUserProduct({ clienteId: 1, clienteContaId: 10, includeLegacy: false });
    assert.strictEqual(semLegado, 1, "só conta 10 = 1");
    const semFiltro = await meliFamiliaService.contarSemUserProduct({ clienteId: 1 });
    assert.strictEqual(semFiltro, 3, "sem clienteContaId conta tudo");
    console.log("  ✓ J. sem_user_product respeita ClienteConta/includeLegacy");
  });

  // K. UP sem family_id não aparece como família.
  await withMockDb({
    anuncios: [anuncioFixture({ item_id: "MLB-ORFAO", user_product_id: "UP-ORFAO" })],
    userProducts: [upFixture({ user_product_id: "UP-ORFAO", family_id: null })],
  }, async () => {
    const r = await meliFamiliaService.listarFamilias({ clienteId: 1 });
    assert.strictEqual(r.familias.length, 0, "UP sem family_id não pode virar família");
    console.log("  ✓ K. UP sem family_id não aparece como família");
  });

  // L. Ordem de rota: GET /familias nunca cai em detalhe(itemId="familias").
  {
    const router = require("../routes/meliAnunciosRoutes");
    const rotasGet = router.stack
      .filter((camada) => camada.route && camada.route.methods && camada.route.methods.get)
      .map((camada) => camada.route.path);
    const idxFamilias = rotasGet.indexOf("/familias");
    const idxFamiliaDetalhe = rotasGet.indexOf("/familias/:familyId");
    const idxItemId = rotasGet.indexOf("/:itemId");
    assert.ok(idxFamilias !== -1, "GET /familias precisa estar registrada");
    assert.ok(idxFamiliaDetalhe !== -1, "GET /familias/:familyId precisa estar registrada");
    assert.ok(idxItemId !== -1, "GET /:itemId (rota existente) precisa continuar registrada");
    assert.ok(idxFamilias < idxItemId, "GET /familias precisa vir ANTES de GET /:itemId");
    assert.ok(idxFamiliaDetalhe < idxItemId, "GET /familias/:familyId precisa vir ANTES de GET /:itemId");
    console.log("  ✓ L. /familias e /familias/:familyId registradas antes de /:itemId");
  }

  // M. Nenhuma rota nova chama a API do Mercado Livre.
  await withMockDb({
    anuncios: [anuncioFixture({ item_id: "MLB1", user_product_id: "UP1" })],
    userProducts: [upFixture({ user_product_id: "UP1" })],
  }, async () => {
    const Module = require("module");
    const originalLoad = Module._load;
    Module._load = function loadThatThrows(request, parent, isMain) {
      if (request === "../../utils/mlClient" || request === "../utils/mlClient") {
        throw new Error("mlFetch não pode ser chamado pela leitura agrupada de famílias");
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    try {
      await meliFamiliaService.listarFamilias({ clienteId: 1 });
      await meliFamiliaService.contarSemUserProduct({ clienteId: 1 });
      await meliFamiliaService.obterFamiliaDetalhe({ clienteId: 1, familyId: "FAM1" });
    } finally {
      Module._load = originalLoad;
    }
    console.log("  ✓ M. leitura agrupada não chama a API do Mercado Livre");
  });

  console.log("meliAnunciosFamilias.test.js passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
