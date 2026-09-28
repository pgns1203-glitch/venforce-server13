// server/tests/meliAnunciosOrdenacaoGlobal.test.js
//
// GET /anuncios-meli/familias?ordenarPor= — ordenação GLOBAL contra o
// catálogo filtrado inteiro (Faturamento %, Curva ABC, Unidades vendidas 7d e
// Margem projetada), corrigindo o bug em que a ordenação por performance só
// valia dentro da página atual. Margem projetada virou GLOBAL nesta missão
// (ver docs/AUDITORIA_ANUNCIOS_ML_MARGEM_PROJETADA_GLOBAL_PLANO_TECNICO.md) —
// lê SOMENTE o snapshot já persistido (`anuncios_margem_projetada_snapshot`),
// nunca o Motor de Margem/Mercado Livre durante a listagem.
//
// O que este teste protege:
//   1. sequência monotônica cruzando a fronteira de página (o bug relatado:
//      pág.1 10/9/8 -> pág.2 7/6/5, nunca 20/15/12);
//   2. família usa SEMPRE o agregado (porFamilia), nunca o filho mais forte;
//   3. item sem receita/margem computável no período fica no fim, nas duas
//      direções (NULLS LAST);
//   4. Motor/snapshot indisponível cai no SQL padrão com
//      ordenacaoAplicada:false, nunca 500;
//   5. sem ordenarPor (ou valor inválido), resposta idêntica ao path antigo —
//      regressão zero;
//   6. clienteContaId isola o ranking (nunca mistura receita/margem de outra
//      conta);
//   7. margem_asc/margem_desc NUNCA chamam motorMargemService — só leem
//      margemProjetadaSnapshotRepository.lerSnapshotPorItens.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const Module = require("module");

let motorHandler = null; // ({ clienteSlug, clienteContaId, itemIds }, deps) => { porMlb, periodo } ou throw

// Toda chamada real a montarItens() feita pelo controller, com os DOIS
// argumentos (args, deps) — usado pelo Teste I (Finding 1) pra provar que o
// controller injeta um enrichBatch no-op, em vez de deixar itemIds:[] cair no
// enrichBatch real (que dispara 3 chamadas AO VIVO ao Mercado Livre — ver
// motorMargemService.enrichBatch).
let chamadasMontarItens = [];

// unidadesVendidas7d_* (GLOBAL) não passa pelo Motor — usa
// buscarVendas7dPorItens direto (ver meliMetricas7dService.js). Registra
// cada chamada (itemIds pedidos) pro teste N provar que o lote é o
// CATÁLOGO INTEIRO filtrado, nunca só a página.
let vendasHandler = null; // ({ clienteId, mlUserId, itemIds }) => { ok, porItem } ou { ok:false }
let chamadasVendas7d = [];

// margem projetada (snapshot, NUNCA o Motor) — snapshotHandler simula
// margemProjetadaSnapshotRepository.lerSnapshotPorItens, chamadasSnapshot
// registra cada chamada (mesmo padrão de chamadasVendas7d) pro teste provar
// que o lote pedido é o catálogo inteiro filtrado.
let snapshotHandler = null; // ({ clienteId, itemIds }) => Map(item_id -> {...}) ou throw
let chamadasSnapshot = [];

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "../services/motorMargem/motorMargemService") {
    return {
      async montarItens(args, deps) {
        chamadasMontarItens.push({ args, deps });
        if (!motorHandler) return { porMlb: new Map(), periodo: {} };
        return motorHandler(args, deps);
      },
    };
  }
  if (request === "../services/meliAnuncios/meliMetricas7dService") {
    return {
      JANELA_DIAS: 7,
      async buscarVendas7dPorItens(args) {
        chamadasVendas7d.push(args);
        if (!vendasHandler) return { ok: true, porItem: {} };
        return vendasHandler(args);
      },
    };
  }
  if (request === "../services/motorMargem/margemProjetadaSnapshotRepository") {
    return {
      async lerSnapshotPorItens(args) {
        chamadasSnapshot.push(args);
        if (!snapshotHandler) return new Map();
        return snapshotHandler(args);
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
    if (q.includes("COUNT(*)::int AS total FROM cliente_contas")) {
      const total = this.contas.filter((c) => c.cliente_id === params[0] && c.ativo !== false && c.marketplace === "meli").length;
      return { rows: [{ total }] };
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
    // faturamentoValor: valor ABSOLUTO (R$) junto do percentual que decidiu
    // a posição — a receita real de cada MLB, nunca derivada do percentual.
    assert.strictEqual(res1.corpo.anuncios[0].faturamentoValor, 400, "MLB1: receita real, não percentual × total");
    assert.strictEqual(res1.corpo.anuncios[1].faturamentoValor, 300);

    const res2 = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "2", limit: "2", ordenarPor: "faturamento_desc" } }, res2);
    assert.deepStrictEqual(res2.corpo.anuncios.map((a) => a.item_id), ["MLB3", "MLB4"]);
    assert.ok(res1.corpo.anuncios[1].faturamentoPercentual > res2.corpo.anuncios[0].faturamentoPercentual,
      "o último da página 1 tem de valer MAIS que o primeiro da página 2 — nunca reinicia");
    assert.strictEqual(res2.corpo.anuncios[0].faturamentoValor, 200, "MLB3: valor absoluto sobrevive à paginação, igual ao percentual");
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
    // faturamentoValor da família é o CONSOLIDADO dos filhos (50+50=100),
    // nunca o de um filho isolado (50) — mesma regra do percentual (porFamilia).
    assert.strictEqual(familia.faturamentoValor, 100, "família usa o valor consolidado (soma dos filhos), não o de um filho isolado");
    const itemAvulso = res.corpo.anuncios.find((a) => a.tipo === "item");
    assert.strictEqual(itemAvulso.faturamentoValor, 80, "MLB-B avulso: valor absoluto próprio, sem agregação de família");
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
    const semVenda = desc.corpo.anuncios.find((a) => a.item_id === "MLB-SEM-VENDA");
    assert.strictEqual(semVenda.faturamentoValor, null, "sem receita no período — null, nunca 0 inventado");
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

  // E. sem ordenarPor: path antigo intacto (ordenacaoAplicada/faturamento*
  //    continuam ausentes — regressão zero), mas AGORA carrega os campos de
  //    margem projetada da PÁGINA (fonte única da célula — ver missão
  //    "migrar exibição de margem projetada para o snapshot"). Isso não é
  //    regressão: é o objetivo desta missão — a célula precisa da margem
  //    independentemente do sort ativo.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [anuncioFixture({ item_id: "MLB1" }), anuncioFixture({ item_id: "MLB2" })],
  }, async () => {
    chamadasSnapshot.length = 0;
    chamadasMontarItens.length = 0;
    snapshotHandler = () => new Map([
      ["MLB1", { marginPercent: 22.5, profit: 12, computable: true, status: "HEALTHY", calculadoEm: "2026-09-28T10:00:00Z", origemJob: "manual_cli" }],
      // MLB2: sem entrada — snapshot ausente.
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10" } }, res);
    assert.strictEqual(res.corpo.ok, true);
    assert.strictEqual(res.corpo.ordenacaoAplicada, undefined, "sem ordenarPor não deve nem existir o campo — path antigo não conhece esse contrato");
    assert.strictEqual(res.corpo.anuncios[0].faturamentoPercentual, undefined);
    assert.strictEqual(res.corpo.anuncios[0].faturamentoValor, undefined);

    const mlb1 = res.corpo.anuncios.find((a) => a.item_id === "MLB1");
    const mlb2 = res.corpo.anuncios.find((a) => a.item_id === "MLB2");
    assert.strictEqual(mlb1.margemProjetadaPercent, 22.5, "MLB1 com snapshot: campo vem preenchido mesmo sem ordenarPor");
    assert.strictEqual(mlb1.margemProjetadaProfit, 12);
    assert.strictEqual(mlb1.margemProjetadaComputable, true);
    assert.strictEqual(mlb1.margemProjetadaStatus, "HEALTHY");
    assert.strictEqual(mlb1.margemProjetadaCalculadaEm, "2026-09-28T10:00:00Z");
    assert.strictEqual(mlb1.margemProjetadaOrigemJob, "manual_cli");
    assert.strictEqual(mlb2.margemProjetadaPercent, null, "MLB2 sem snapshot: null, nunca 0/inventado");
    assert.strictEqual(mlb2.margemProjetadaComputable, false);

    assert.strictEqual(chamadasSnapshot.length, 1, "exatamente 1 leitura de snapshot para anexar a página");
    assert.deepStrictEqual(chamadasSnapshot[0].itemIds.sort(), ["MLB1", "MLB2"], "lote pedido é só os item_id DESTA PÁGINA, nunca o catálogo inteiro");
    assert.strictEqual(chamadasMontarItens.length, 0, "anexar margem projetada ao path padrão NUNCA chama o Motor de Margem");
    snapshotHandler = null;
    console.log("  ✓ E. sem ordenarPor: path antigo intacto + campos de margem projetada da página (fonte única da célula)");
  });

  // E2. sem ordenarPor: família NUNCA tem margemProjetadaPercent (mesma
  //     regra de sempre) — e SEM nenhuma leitura extra de filhos/soma de
  //     profit (a listagem nunca mostra profit de família, só "—").
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB-A1", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-A2", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-B", user_product_id: null }), // avulso, força o batch a existir
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    chamadasSnapshot.length = 0;
    snapshotHandler = () => new Map([
      ["MLB-A1", { marginPercent: 90, profit: 999, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-B", { marginPercent: 15, profit: 3, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10" } }, res);
    const familia = res.corpo.anuncios.find((a) => a.tipo === "familia");
    assert.ok(familia, "FAM1 precisa aparecer como família");
    assert.strictEqual(familia.margemProjetadaPercent, null, "família NUNCA tem margemProjetadaPercent, mesmo com filho de 90%");
    assert.strictEqual(familia.margemProjetadaProfit, null, "path padrão não resolve soma de profit de família — não é exibida na listagem, nunca gastar essa leitura à toa");
    assert.strictEqual(familia.margemProjetadaComputable, false);
    assert.strictEqual(familia.margemProjetadaMinPercent, null, "path padrão não resolve filhos — sem faixa, mesmo com um filho de 90%");
    assert.strictEqual(familia.margemProjetadaMaxPercent, null);
    assert.strictEqual(familia.margemProjetadaMediaPercent, null, "faixa/média só existem quando ordenarPor=margem_* (ponto onde os filhos já são resolvidos pra ranquear)");
    const itemAvulso = res.corpo.anuncios.find((a) => a.tipo === "item");
    assert.strictEqual(itemAvulso.margemProjetadaPercent, 15, "item avulso: batch funcionou normalmente");
    // A linha de família montada por montarAnunciosDeRows não tem `item_id`
    // (só tipo/family_id/...) — anexarMargemProjetadaNaPagina filtra por
    // `tipo === "item"` antes de montar o batch, então a família nunca entra
    // nele, e nenhum filho (MLB-A1/MLB-A2) é resolvido/pedido à toa.
    assert.deepStrictEqual(chamadasSnapshot[0].itemIds, ["MLB-B"], "família não resolve filhos — o batch só pede o item_id do avulso, nunca os filhos da família");
    snapshotHandler = null;
    console.log("  ✓ E2. sem ordenarPor: família margemProjetadaPercent SEMPRE null, sem resolver filhos/soma de profit");
  });

  // F. margem_desc virou GLOBAL (lê o snapshot, nunca o Motor) — MUDA de
  //    comportamento em relação ao contrato antigo (antes: ignorado
  //    silenciosamente, ordenação LOCAL de página no frontend). Ver
  //    docs/AUDITORIA_ANUNCIOS_ML_MARGEM_PROJETADA_GLOBAL_PLANO_TECNICO.md §8.2/§10 FASE 4.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [anuncioFixture({ item_id: "MLB1" }), anuncioFixture({ item_id: "MLB2" })],
  }, async () => {
    chamadasMontarItens.length = 0;
    snapshotHandler = () => new Map([
      ["MLB1", { marginPercent: 30, profit: 10, computable: true, status: "HEALTHY", calculadoEm: "2026-09-28T05:00:00Z", origemJob: "orquestrador_manual" }],
      ["MLB2", { marginPercent: 10, profit: 2, computable: true, status: "HEALTHY", calculadoEm: "2026-09-28T05:00:00Z", origemJob: "orquestrador_manual" }],
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_desc" } }, res);
    assert.strictEqual(res.corpo.ok, true);
    assert.strictEqual(res.corpo.ordenacaoAplicada, true, "margem_desc agora É aplicado globalmente (mudança de contrato desta missão)");
    assert.deepStrictEqual(res.corpo.anuncios.map((a) => a.item_id), ["MLB1", "MLB2"], "MLB1 (30%) > MLB2 (10%)");
    assert.strictEqual(chamadasMontarItens.length, 0, "margem_desc NUNCA chama o Motor de Margem — só lê o snapshot persistido");
    snapshotHandler = null;
    console.log("  ✓ F. ordenarPor=margem_desc: MUDOU de contrato — agora GLOBAL, lê snapshot, nunca o Motor");
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

  // H. curvaAbc_desc: mesma prova de ponta a ponta (sort -> paginate ->
  //    hydrate) que o Teste A fez para faturamento_desc, agora para Curva
  //    ABC — cruzando a fronteira de página 1 -> 2 sem reiniciar.
  //    ORDEM_ABC (A=1,B=2,C=3) é a mesma tabela de CURVA_ABC_ORDEM do
  //    controller, só para comparar a ordem numericamente aqui no teste: o
  //    comparador de "desc" é reaproveitado (mesmo código de
  //    faturamento_desc) contra o ORDINAL da classe, então "desc" ordena
  //    pelo ordinal NUMÉRICO decrescente (C=3 primeiro, A=1 por último) —
  //    não precisa ler como "melhor pra pior" em português.
  const ORDEM_ABC = { A: 1, B: 2, C: 3 };
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB1" }), anuncioFixture({ item_id: "MLB2" }),
      anuncioFixture({ item_id: "MLB3" }), anuncioFixture({ item_id: "MLB4" }),
    ],
  }, async () => {
    // Pareto 80/95 (cliente360ProdutosEngine.classificarCurvaAbc) sobre
    // receitas 1000/500/100/1 (total 1601, share acumulado descendente):
    // MLB1 62,5% -> A; MLB2 93,7% -> B; MLB3 99,9% -> C; MLB4 100% -> C.
    // 3 classes distintas nos 4 itens — confirmado empiricamente rodando
    // este teste (ver saída do comando no report da task).
    motorHandler = () => ({
      porMlb: new Map([
        ["MLB1", { receita: 1000 }], ["MLB2", { receita: 500 }],
        ["MLB3", { receita: 100 }], ["MLB4", { receita: 1 }],
      ]),
      periodo: { dateFrom: "2026-09-01", dateTo: "2026-09-24" },
    });

    const res1 = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "2", ordenarPor: "curvaAbc_desc" } }, res1);
    assert.strictEqual(res1.corpo.ok, true);
    assert.strictEqual(res1.corpo.ordenacaoAplicada, true);
    assert.deepStrictEqual(res1.corpo.anuncios.map((a) => a.item_id), ["MLB3", "MLB4"]);
    assert.deepStrictEqual(res1.corpo.anuncios.map((a) => a.curvaAbc), ["C", "C"]);
    assert.strictEqual(res1.corpo.anuncios[0].faturamentoPercentual, undefined, "curvaAbc_desc não anexa faturamentoPercentual");
    assert.strictEqual(res1.corpo.anuncios[0].faturamentoValor, undefined, "curvaAbc_desc não anexa faturamentoValor — Curva ABC não tem valor absoluto");

    const res2 = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "2", limit: "2", ordenarPor: "curvaAbc_desc" } }, res2);
    assert.strictEqual(res2.corpo.ok, true);
    assert.deepStrictEqual(res2.corpo.anuncios.map((a) => a.item_id), ["MLB2", "MLB1"]);
    assert.deepStrictEqual(res2.corpo.anuncios.map((a) => a.curvaAbc), ["B", "A"]);

    const todasClasses = new Set([...res1.corpo.anuncios, ...res2.corpo.anuncios].map((a) => a.curvaAbc));
    assert.ok(todasClasses.size >= 2, "precisa de pelo menos 2 classes distintas pra provar o ranking, não um empate geral disfarçado");

    assert.ok(
      ORDEM_ABC[res1.corpo.anuncios[1].curvaAbc] >= ORDEM_ABC[res2.corpo.anuncios[0].curvaAbc],
      "o último item da página 1 não pode ter ordinal MENOR que o primeiro da página 2 — nunca reinicia na fronteira"
    );
    motorHandler = null;
    console.log("  ✓ H. curvaAbc_desc: monotônico cruzando página 1 -> 2 (ponta a ponta: sort -> paginate -> hydrate)");
  });

  // I. Finding 1: montarItens() é chamado com um `deps.enrichBatch` no-op —
  //    é ISSO que torna itemIds:[] barato, não o array vazio sozinho (ver
  //    motorMargemService.enrichBatch: itemIds:[] cai no `else` e dispara 3
  //    chamadas AO VIVO ao Mercado Livre se ninguém substituir enrichBatch).
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [anuncioFixture({ item_id: "MLB1" }), anuncioFixture({ item_id: "MLB2" })],
  }, async () => {
    chamadasMontarItens.length = 0;
    motorHandler = () => ({ porMlb: new Map([["MLB1", { receita: 10 }]]), periodo: {} });

    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "faturamento_desc" } }, res);
    assert.strictEqual(res.corpo.ok, true);
    assert.strictEqual(chamadasMontarItens.length, 1, "listarAgrupadoOrdenadoPorMotor chama montarItens exatamente uma vez");

    const { args, deps } = chamadasMontarItens[0];
    assert.deepStrictEqual(args.itemIds, [], "continua pedindo itemIds:[] — o Motor monta porMlb pro período inteiro independente disso");
    assert.strictEqual(typeof deps, "object", "montarItens precisa receber um segundo argumento (deps)");
    assert.strictEqual(typeof deps.enrichBatch, "function", "deps.enrichBatch precisa ser injetado — é o que evita o enrichBatch REAL (3 chamadas ao vivo ao ML) rodar para itemIds:[]");

    const noop = await deps.enrichBatch();
    assert.deepStrictEqual(noop, { totalItensMl: 0, itens: [] }, "o enrichBatch injetado precisa ser um no-op inofensivo, nunca chamar nada de verdade");
    motorHandler = null;
    console.log("  ✓ I. montarItens recebe deps.enrichBatch no-op (Finding 1: itemIds:[] sozinho NÃO é barato, a injeção é que torna)");
  });

  // J. Finding 3: tie-break determinístico por grupo_key quando o valor de
  //    ranking empata (aqui: TODOS sem receita no período, o pior caso —
  //    curvaAbc só tem 3 classes e faturamento manda todo item sem venda pro
  //    mesmo grupo `null`, então a zona empatada é grande na prática). A
  //    query real (LISTAR_CHAVES_FILTRADAS) não tem ORDER BY — cada chamada
  //    de página pode devolver as linhas em ordem diferente do Postgres.
  //    Simulamos isso aqui com DUAS instâncias de MockDb, cada uma com as
  //    MESMAS 4 chaves em ordem diferente — sem o tie-break, essa
  //    reordenação faria a página 2 repetir/pular grupo_key.
  {
    const itemsEmpatados = [
      anuncioFixture({ item_id: "MLB-D" }), anuncioFixture({ item_id: "MLB-B" }),
      anuncioFixture({ item_id: "MLB-A" }), anuncioFixture({ item_id: "MLB-C" }),
    ];
    const itemsEmpatadosOutraOrdem = [
      anuncioFixture({ item_id: "MLB-C" }), anuncioFixture({ item_id: "MLB-A" }),
      anuncioFixture({ item_id: "MLB-D" }), anuncioFixture({ item_id: "MLB-B" }),
    ];
    // grupo_key = "item:MLB-<X>" — nenhum tem porMlb (nenhuma venda no
    // período), então valorOrdenacao é null pros 4, um empate total.
    motorHandler = () => ({ porMlb: new Map(), periodo: {} });

    let pag1;
    await withMockDb({ ...UMA_CONTA, anuncios: itemsEmpatados }, async () => {
      const res = fakeRes();
      await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "2", ordenarPor: "faturamento_desc" } }, res);
      pag1 = res.corpo.anuncios.map((a) => a.item_id);
    });

    let pag2;
    await withMockDb({ ...UMA_CONTA, anuncios: itemsEmpatadosOutraOrdem }, async () => {
      const res = fakeRes();
      await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "2", limit: "2", ordenarPor: "faturamento_desc" } }, res);
      pag2 = res.corpo.anuncios.map((a) => a.item_id);
    });

    motorHandler = null;
    assert.deepStrictEqual(pag1, ["MLB-A", "MLB-B"], "página 1, ordenada por grupo_key ASC como tie-break, sempre traz A e B primeiro, não importa a ordem que o SQL devolveu");
    assert.deepStrictEqual(pag2, ["MLB-C", "MLB-D"], "página 2 continua exatamente onde a 1 parou (C e D), mesmo com o SQL da 2ª chamada devolvendo em ordem diferente da 1ª");
    const uniao = new Set([...pag1, ...pag2]);
    assert.strictEqual(uniao.size, 4, "as duas páginas juntas são uma partição limpa do conjunto empatado — nenhum item_id duplicado nem sumido");
    console.log("  ✓ J. tie-break por grupo_key: partição estável entre páginas mesmo com o SQL devolvendo em ordem diferente a cada chamada");
  }

  // K. Finding 4: erro NÃO tipado do Motor (sem .statusCode/.payload.codigo —
  //    ex.: timeout de rede, TypeError) também cai no fallback, nunca 500 —
  //    Restrição Global #5 do plano ("Motor indisponível nunca pode virar
  //    erro 500"). Antes desta correção só o erro TIPADO (o mesmo shape que
  //    exigirContextoPronto lança) tinha fallback; qualquer outro rethrowava.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [anuncioFixture({ item_id: "MLB1" }), anuncioFixture({ item_id: "MLB2" })],
  }, async () => {
    motorHandler = () => { throw new Error("ECONNRESET simulado — sem statusCode nem payload"); };
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "faturamento_desc" } }, res);
    assert.strictEqual(res.corpo.ok, true, "erro não tipado também precisa cair no fallback, nunca virar exceção não tratada / 500");
    assert.strictEqual(res.corpo.ordenacaoAplicada, false);
    assert.deepStrictEqual(res.corpo.ordenacaoIndisponivel, { codigo: "ERRO_INESPERADO", mensagem: "Não foi possível ordenar globalmente no momento." });
    assert.strictEqual(res.corpo.anuncios.length, 2, "SQL padrão continua respondendo a página normalmente");
    motorHandler = null;
    console.log("  ✓ K. erro NÃO tipado do Motor: fallback pro SQL padrão com ordenacaoIndisponivel genérico, nunca 500/exceção");
  });

  // ── L-O: unidadesVendidas7d (GLOBAL) — decisão "globalizar Unidades
  //    vendidas 7d / manter Margem local" (buscarVendas7dPorItens já busca
  //    os pedidos da CONTA INTEIRA no período, então globalizar não custa
  //    chamada extra — ver comentário de ORDENACOES_GLOBAIS). ──────────────

  // L. unidades_desc: sequência monotônica cruzando página 1 -> 2, e o lote
  //    pedido a buscarVendas7dPorItens é o CATÁLOGO INTEIRO filtrado, nunca
  //    só a página — mesmo bug/mesma correção de faturamento_desc (teste A).
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB1" }), anuncioFixture({ item_id: "MLB2" }),
      anuncioFixture({ item_id: "MLB3" }), anuncioFixture({ item_id: "MLB4" }),
    ],
  }, async () => {
    chamadasVendas7d.length = 0;
    vendasHandler = () => ({ ok: true, porItem: { MLB1: 40, MLB2: 30, MLB3: 20, MLB4: 10 } });

    const res1 = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "2", ordenarPor: "unidades_desc" } }, res1);
    assert.strictEqual(res1.corpo.ok, true);
    assert.deepStrictEqual(res1.corpo.anuncios.map((a) => a.item_id), ["MLB1", "MLB2"]);
    assert.strictEqual(res1.corpo.ordenacaoAplicada, true);
    assert.strictEqual(res1.corpo.anuncios[0].unidadesVendidas7d, 40);

    const res2 = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "2", limit: "2", ordenarPor: "unidades_desc" } }, res2);
    assert.deepStrictEqual(res2.corpo.anuncios.map((a) => a.item_id), ["MLB3", "MLB4"]);
    assert.ok(res1.corpo.anuncios[1].unidadesVendidas7d > res2.corpo.anuncios[0].unidadesVendidas7d,
      "último da página 1 (30) tem de valer MAIS que o primeiro da página 2 (20) — nunca reinicia");

    assert.ok(chamadasVendas7d.length >= 2, "cada página faz sua própria busca (mesmo padrão do Motor pra faturamento)");
    const idsDaChamada = new Set(chamadasVendas7d[0].itemIds);
    assert.ok(["MLB1", "MLB2", "MLB3", "MLB4"].every((id) => idsDaChamada.has(id)),
      "o lote pedido é o CATÁLOGO INTEIRO filtrado, nunca só a página — é isso que garante o ranking global");
    vendasHandler = null;
    console.log("  ✓ L. unidades_desc: monotônico cruzando página 1 -> 2, lote pedido é o catálogo inteiro");
  });

  // M. unidades_desc: família usa a SOMA dos filhos, nunca o filho isolado —
  //    mesmo raciocínio do teste B (faturamento).
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB-A1", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-A2", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-B", user_product_id: null }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    vendasHandler = () => ({ ok: true, porItem: { "MLB-A1": 5, "MLB-A2": 5, "MLB-B": 8 } });
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "unidades_desc" } }, res);
    const familia = res.corpo.anuncios.find((a) => a.tipo === "familia");
    assert.ok(familia, "FAM1 precisa aparecer como família");
    assert.strictEqual(res.corpo.anuncios[0].family_id, "FAM1", "FAM1 (5+5=10) > MLB-B (8) — família vence pelo agregado, não pelo filho isolado");
    assert.strictEqual(familia.unidadesVendidas7d, 10, "família usa a soma dos filhos, nunca o filho isolado");
    const itemAvulso = res.corpo.anuncios.find((a) => a.tipo === "item");
    assert.strictEqual(itemAvulso.unidadesVendidas7d, 8);
    vendasHandler = null;
    console.log("  ✓ M. unidades_desc: família usa a soma dos filhos (porFamilia agregado)");
  });

  // N. busca de vendas 7d falhou (ok:false — token, rede, erro do ML):
  //    fallback pro SQL padrão, ordenacaoAplicada:false, nunca 500 — mesma
  //    garantia do Motor indisponível (teste D), agora pro caminho que não
  //    usa o Motor de Margem.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [anuncioFixture({ item_id: "MLB1" }), anuncioFixture({ item_id: "MLB2" })],
  }, async () => {
    vendasHandler = () => ({ ok: false, porItem: {} });
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "unidades_asc" } }, res);
    assert.strictEqual(res.corpo.ok, true, "fallback nunca é 500");
    assert.strictEqual(res.corpo.ordenacaoAplicada, false);
    assert.deepStrictEqual(res.corpo.ordenacaoIndisponivel, { codigo: "ERRO_INESPERADO", mensagem: "Não foi possível ordenar globalmente no momento." });
    assert.strictEqual(res.corpo.anuncios.length, 2, "SQL padrão continua respondendo a página normalmente");
    vendasHandler = null;
    console.log("  ✓ N. busca de vendas 7d falhou: fallback pro SQL padrão, ordenacaoAplicada:false, nunca 500");
  });

  // O. conta sem external_account_id (mlUserId nunca chega a existir — ver
  //    resolveMarketplaceAccountContext, que lê `conta.external_account_id`
  //    direto, sem depender de grant): fallback pro SQL padrão, nunca 500 —
  //    mesma garantia, motivo diferente (nenhuma conta ML utilizável, não
  //    uma falha de rede).
  await withMockDb({
    contas: [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", external_account_id: null, is_primary: true, ativo: true }],
    grants: [],
    anuncios: [anuncioFixture({ item_id: "MLB1" })],
  }, async () => {
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "unidades_desc" } }, res);
    assert.strictEqual(res.corpo.ok, true, "fallback nunca é 500");
    assert.strictEqual(res.corpo.ordenacaoAplicada, false);
    assert.strictEqual(res.corpo.ordenacaoIndisponivel.codigo, "CONTA_ML_INDISPONIVEL");
    console.log("  ✓ O. sem conta ML resolvível: fallback pro SQL padrão, ordenacaoAplicada:false, nunca 500");
  });

  // ── P-Z: margem_asc/margem_desc — snapshot como ÚNICA fonte (nunca o
  //    Motor), ver docs/AUDITORIA_ANUNCIOS_ML_MARGEM_PROJETADA_GLOBAL_PLANO_TECNICO.md ──

  // P. DESC: 30/20/10/null cruzando página 1 -> 2, null sempre no fim — mesma
  //    prova ponta a ponta do teste A, agora para margem.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB-30" }), anuncioFixture({ item_id: "MLB-20" }),
      anuncioFixture({ item_id: "MLB-10" }), anuncioFixture({ item_id: "MLB-NULL" }),
    ],
  }, async () => {
    chamadasMontarItens.length = 0;
    snapshotHandler = () => new Map([
      ["MLB-30", { marginPercent: 30, profit: 9, computable: true, status: "HEALTHY", calculadoEm: "2026-09-28T05:00:00Z", origemJob: "orquestrador_manual" }],
      ["MLB-20", { marginPercent: 20, profit: 6, computable: true, status: "HEALTHY", calculadoEm: "2026-09-28T05:00:00Z", origemJob: "orquestrador_manual" }],
      ["MLB-10", { marginPercent: 10, profit: 3, computable: true, status: "HEALTHY", calculadoEm: "2026-09-28T05:00:00Z", origemJob: "orquestrador_manual" }],
      // MLB-NULL: computable=false — marginPercent chega null do repositório.
      ["MLB-NULL", { marginPercent: null, profit: null, computable: false, status: "UNVALIDATED", calculadoEm: "2026-09-28T05:00:00Z", origemJob: "orquestrador_manual" }],
    ]);

    const res1 = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "2", ordenarPor: "margem_desc" } }, res1);
    assert.strictEqual(res1.corpo.ordenacaoAplicada, true);
    assert.deepStrictEqual(res1.corpo.anuncios.map((a) => a.item_id), ["MLB-30", "MLB-20"]);
    assert.deepStrictEqual(res1.corpo.anuncios.map((a) => a.margemProjetadaPercent), [30, 20]);
    assert.strictEqual(res1.corpo.anuncios[0].margemProjetadaProfit, 9, "profit exposto, mas informativo — não decide posição");
    assert.strictEqual(res1.corpo.anuncios[0].margemProjetadaComputable, true);
    assert.strictEqual(res1.corpo.anuncios[0].margemProjetadaStatus, "HEALTHY");
    assert.strictEqual(res1.corpo.anuncios[0].margemProjetadaCalculadaEm, "2026-09-28T05:00:00Z");
    assert.strictEqual(res1.corpo.anuncios[0].margemProjetadaOrigemJob, "orquestrador_manual");

    const res2 = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "2", limit: "2", ordenarPor: "margem_desc" } }, res2);
    assert.deepStrictEqual(res2.corpo.anuncios.map((a) => a.item_id), ["MLB-10", "MLB-NULL"], "não computável fica no FIM mesmo em DESC");
    assert.strictEqual(res2.corpo.anuncios[1].margemProjetadaPercent, null, "sem margem computável — null, nunca 0 inventado");
    assert.strictEqual(res2.corpo.anuncios[1].margemProjetadaComputable, false);
    assert.strictEqual(chamadasMontarItens.length, 0, "margem_desc nunca chama o Motor de Margem");
    snapshotHandler = null;
    console.log("  ✓ P. margem_desc: 30/20/10/null cruzando página 1 -> 2, não computável sempre no fim");
  });

  // Q. ASC: 10/20/30/null — não computável continua no fim (nunca vai para o
  //    topo só porque a direção inverteu).
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB-30" }), anuncioFixture({ item_id: "MLB-20" }),
      anuncioFixture({ item_id: "MLB-10" }), anuncioFixture({ item_id: "MLB-NULL" }),
    ],
  }, async () => {
    snapshotHandler = () => new Map([
      ["MLB-30", { marginPercent: 30, profit: 9, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-20", { marginPercent: 20, profit: 6, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-10", { marginPercent: 10, profit: 3, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-NULL", { marginPercent: null, profit: null, computable: false, status: "UNVALIDATED", calculadoEm: null, origemJob: "manual_cli" }],
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_asc" } }, res);
    assert.deepStrictEqual(res.corpo.anuncios.map((a) => a.item_id), ["MLB-10", "MLB-20", "MLB-30", "MLB-NULL"],
      "ASC: menor margem computável primeiro, não computável continua no fim");
    snapshotHandler = null;
    console.log("  ✓ Q. margem_asc: 10/20/30/null — NULLS LAST vale nas duas direções");
  });

  // R. Contrato de família ATUALIZADO (missão "faixa de margem projetada nos
  //    agrupadores"): família AGORA compete de verdade no ranking global de
  //    margem — `porFamilia` deixou de ficar sempre vazio (NULLS LAST
  //    incondicional); passa a ser a MÉDIA SIMPLES de `marginPercent` dos
  //    filhos computáveis, mesma unidade (%) do item avulso, então comparar
  //    os dois numericamente é válido (não é mais a mistura R$-vs-% da
  //    correção anterior). `margemProjetadaPercent` da família continua
  //    SEMPRE null (não existe "a" margem única da família) — o valor de
  //    ranking mora em `margemProjetadaMediaPercent`, a faixa visual em
  //    `margemProjetadaMinPercent`/`MaxPercent`, e a soma de profit continua
  //    só informativa em `margemProjetadaProfit`.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB-A1", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-A2", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-B", user_product_id: null }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    // FAM1: filhos 10% e 30% (ambos computáveis) -> média (10+30)/2 = 20%,
    // faixa 10%-30%. MLB-B avulso: 15% — abaixo da MÉDIA da família (20%),
    // então em margem_desc a família vem ANTES do avulso: prova que a média
    // decide a posição de verdade, não é mais "família sempre por último".
    snapshotHandler = () => new Map([
      ["MLB-A1", { marginPercent: 10, profit: 4, computable: true, status: "HEALTHY", calculadoEm: "2026-09-28T04:00:00Z", origemJob: "manual_cli" }],
      ["MLB-A2", { marginPercent: 30, profit: 10, computable: true, status: "HEALTHY", calculadoEm: "2026-09-28T05:00:00Z", origemJob: "manual_cli" }],
      ["MLB-B", { marginPercent: 15, profit: 999, computable: true, status: "HEALTHY", calculadoEm: "2026-09-28T03:00:00Z", origemJob: "manual_cli" }],
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_desc" } }, res);
    const familia = res.corpo.anuncios.find((a) => a.tipo === "familia");
    const itemAvulso = res.corpo.anuncios.find((a) => a.tipo === "item");
    assert.ok(familia, "FAM1 precisa aparecer como família");
    assert.strictEqual(res.corpo.anuncios[0].family_id, "FAM1", "FAM1 (média 20%) vem ANTES de MLB-B (15%) — família compete de verdade no ranking, não é mais NULLS LAST automático");
    assert.strictEqual(res.corpo.anuncios[1].item_id, "MLB-B", "MLB-B (15%, computável) fica DEPOIS da família (20%)");
    assert.strictEqual(familia.margemProjetadaPercent, null, "família NUNCA tem margemProjetadaPercent único — nem a média rotulada como 'Percent'");
    assert.strictEqual(familia.margemProjetadaMediaPercent, 20, "média dos filhos computáveis: (10+30)/2 = 20 — o mesmo valor que decidiu a posição");
    assert.strictEqual(familia.margemProjetadaMinPercent, 10, "faixa visual: mínimo dos filhos computáveis");
    assert.strictEqual(familia.margemProjetadaMaxPercent, 30, "faixa visual: máximo dos filhos computáveis");
    assert.strictEqual(familia.margemProjetadaProfit, 14, "profit continua a SOMA (4+10=14) — informativo, nunca usado no comparator");
    assert.strictEqual(familia.margemProjetadaComputable, false, "família nunca é 'computável' — não existe margem % única de família, ponto");
    assert.strictEqual(familia.margemProjetadaStatus, null, "status não agrega por família — nunca inventado");
    assert.strictEqual(familia.margemProjetadaCalculadaEm, "2026-09-28T05:00:00Z", "calculadoEm de família é o MAIS RECENTE entre os filhos com profit conhecido");
    assert.strictEqual(itemAvulso.margemProjetadaPercent, 15, "MLB-B avulso: continua usando marginPercent direto, sem agregação");
    assert.strictEqual(itemAvulso.margemProjetadaProfit, 999, "MLB-B avulso: profit próprio, sem soma nenhuma");
    snapshotHandler = null;
    console.log("  ✓ R. margem_desc: família compete pela MÉDIA de marginPercent dos filhos computáveis — mesma unidade do item, ranking real (não mais NULLS LAST automático)");
  });

  // S. família sem NENHUM filho computável (nem snapshot) fica com
  //    min/max/média/profit todos null — NULLS LAST por FALTA de sinal, não
  //    mais por design perene (a diferença importa: uma família com filhos
  //    computáveis agora ranqueia de verdade, ver R).
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB-A1", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-A2", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-B" }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    snapshotHandler = () => new Map([
      ["MLB-B", { marginPercent: 5, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      // MLB-A1/MLB-A2: sem entrada no Map — snapshot ausente pros dois.
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_desc" } }, res);
    const familia = res.corpo.anuncios.find((a) => a.tipo === "familia");
    assert.strictEqual(familia.margemProjetadaPercent, null, "família: sempre null (nunca teve percent, agora também sem profit)");
    assert.strictEqual(familia.margemProjetadaProfit, null, "família sem nenhum filho com profit: null, nunca 0");
    assert.strictEqual(familia.margemProjetadaComputable, false);
    assert.strictEqual(familia.margemProjetadaMinPercent, null, "sem filho computável: sem faixa nenhuma, nunca 0");
    assert.strictEqual(familia.margemProjetadaMaxPercent, null);
    assert.strictEqual(familia.margemProjetadaMediaPercent, null, "sem filho computável: sem média — cai em NULLS LAST por falta de sinal");
    assert.deepStrictEqual(res.corpo.anuncios.map((a) => a.item_id), ["MLB-B", "FAM1"].map((k) => (k === "FAM1" ? familia.item_id : k)));
    assert.strictEqual(res.corpo.anuncios[0].family_id, null, "MLB-B (5%, computável) vem antes de FAM1 (sem nenhum filho computável)");
    snapshotHandler = null;
    console.log("  ✓ S. margem_desc: família sem nenhum filho computável fica com min/max/média null, no fim — nunca 0 nem herda do avulso");
  });

  // T. cobertura ZERO (job nunca rodou para este cliente): fallback pro SQL
  //    padrão, ordenacaoAplicada:false, codigo SNAPSHOT_INDISPONIVEL — nunca
  //    500 nem "ordenação" que é só o tie-break disfarçado.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [anuncioFixture({ item_id: "MLB1" }), anuncioFixture({ item_id: "MLB2" })],
  }, async () => {
    snapshotHandler = () => new Map(); // nenhuma linha — cobertura zero
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_desc" } }, res);
    assert.strictEqual(res.corpo.ok, true, "fallback nunca é 500");
    assert.strictEqual(res.corpo.ordenacaoAplicada, false);
    assert.deepStrictEqual(res.corpo.ordenacaoIndisponivel, { codigo: "SNAPSHOT_INDISPONIVEL", mensagem: "Margem projetada ainda não foi calculada para este cliente." });
    assert.strictEqual(res.corpo.anuncios.length, 2, "SQL padrão continua respondendo a página normalmente");
    snapshotHandler = null;
    console.log("  ✓ T. cobertura zero do snapshot: fallback pro SQL padrão, ordenacaoAplicada:false, SNAPSHOT_INDISPONIVEL");
  });

  // U. cobertura PARCIAL (alguns itens têm snapshot, outros não) NÃO cai no
  //    fallback — os sem snapshot só vão para o fim via NULLS LAST, mesma
  //    regra de "sem receita no período" (teste C).
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [anuncioFixture({ item_id: "MLB-COM" }), anuncioFixture({ item_id: "MLB-SEM" })],
  }, async () => {
    snapshotHandler = () => new Map([
      ["MLB-COM", { marginPercent: 15, profit: 3, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_desc" } }, res);
    assert.strictEqual(res.corpo.ordenacaoAplicada, true, "cobertura parcial NÃO é fallback — pelo menos 1 item computável");
    assert.deepStrictEqual(res.corpo.anuncios.map((a) => a.item_id), ["MLB-COM", "MLB-SEM"]);
    const semSnapshot = res.corpo.anuncios.find((a) => a.item_id === "MLB-SEM");
    assert.strictEqual(semSnapshot.margemProjetadaPercent, null, "snapshot ausente — null, nunca 0/erro");
    assert.strictEqual(semSnapshot.margemProjetadaComputable, false);
    snapshotHandler = null;
    console.log("  ✓ U. cobertura parcial: item sem snapshot fica no fim (null), não dispara fallback");
  });

  // V. erro do repositório (ex.: falha de conexão) cai no fallback, nunca
  //    500 — mesma garantia dos outros 3 critérios (testes D/K/N).
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [anuncioFixture({ item_id: "MLB1" }), anuncioFixture({ item_id: "MLB2" })],
  }, async () => {
    snapshotHandler = () => { throw new Error("ECONNRESET simulado"); };
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_asc" } }, res);
    assert.strictEqual(res.corpo.ok, true, "fallback nunca é 500");
    assert.strictEqual(res.corpo.ordenacaoAplicada, false);
    assert.deepStrictEqual(res.corpo.ordenacaoIndisponivel, { codigo: "ERRO_INESPERADO", mensagem: "Não foi possível ordenar globalmente no momento." });
    assert.strictEqual(res.corpo.anuncios.length, 2, "SQL padrão continua respondendo a página normalmente");
    snapshotHandler = null;
    console.log("  ✓ V. erro do repositório de snapshot: fallback pro SQL padrão, ordenacaoAplicada:false, nunca 500");
  });

  // W. clienteContaId isola o catálogo pedido ao repositório — nunca mistura
  //    item_id de outra conta no lote (mesmo cuidado do teste G).
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
    chamadasSnapshot.length = 0;
    snapshotHandler = () => new Map([
      ["MLB-C10", { marginPercent: 10, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-C20", { marginPercent: 999, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", clienteContaId: "10", page: "1", limit: "10", ordenarPor: "margem_desc" } }, res);
    assert.deepStrictEqual(res.corpo.anuncios.map((a) => a.item_id), ["MLB-C10"], "MLB-C20 é de outra conta — não pode nem chegar ao lote pedido ao repositório");
    assert.strictEqual(chamadasSnapshot.length, 1);
    assert.deepStrictEqual(chamadasSnapshot[0].itemIds, ["MLB-C10"], "lote pedido ao repositório já vem escopado pela conta — nunca item_id de outra conta");
    snapshotHandler = null;
    console.log("  ✓ W. clienteContaId isola o lote pedido ao repositório de snapshot — nunca mistura contas");
  });

  // X. tie-break determinístico quando margemProjetadaPercent EMPATA em valor
  //    NÃO-nulo (teste J já cobre o empate all-null; aqui os valores são
  //    iguais e reais, provando que o comparador não trata "cmp===0" como
  //    "ordem qualquer").
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB-D" }), anuncioFixture({ item_id: "MLB-B" }),
      anuncioFixture({ item_id: "MLB-A" }), anuncioFixture({ item_id: "MLB-C" }),
    ],
  }, async () => {
    snapshotHandler = () => new Map([
      ["MLB-D", { marginPercent: 15, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-B", { marginPercent: 15, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-A", { marginPercent: 15, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-C", { marginPercent: 15, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_desc" } }, res);
    assert.deepStrictEqual(res.corpo.anuncios.map((a) => a.item_id), ["MLB-A", "MLB-B", "MLB-C", "MLB-D"],
      "todos empatados em 15% — desempate determinístico por grupo_key ASC");
    snapshotHandler = null;
    console.log("  ✓ X. margem_desc: tie-break por grupo_key quando margemProjetadaPercent empata em valor real (não só null)");
  });

  // Nota: "filtro aplicado ANTES do ranking" (q/status/filtro) é uma
  // garantia do código COMPARTILHADO `familiaService.listarChavesFiltradas`
  // (primeiro passo de `listarAgrupadoOrdenadoPorMotor`, idêntico para os 4
  // critérios) — já coberta com matchSql real (não a versão simplificada do
  // MockDb deste arquivo, que ignora status/q de propósito) em
  // `meliAnunciosFamilias.test.js:919`. margem_desc não introduz nenhum
  // caminho de filtro novo, então não duplicamos o teste aqui.

  // Z. total da paginação é o total do universo FILTRADO, sem duplicar —
  //    mesma garantia estrutural que os outros 3 critérios já têm (a família
  //    conta como 1 grupo, não como N itens).
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB-A1", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-A2", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-B" }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    snapshotHandler = () => new Map([
      ["MLB-A1", { marginPercent: 10, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-A2", { marginPercent: 20, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-B", { marginPercent: 30, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_desc" } }, res);
    assert.strictEqual(res.corpo.paginacao.total, 2, "2 grupos (FAM1 + MLB-B avulso) — família conta 1 vez, nunca duplicada");
    assert.strictEqual(res.corpo.anuncios.length, 2);
    snapshotHandler = null;
    console.log("  ✓ Z. margem_desc: total da paginação é o universo de GRUPOS filtrado, sem duplicar família");
  });

  // AB. PROVA "valor usado no ranking === valor exposto na resposta"
  //     (requisito explícito da missão de revisão) — 3 itens avulsos com
  //     marginPercent TODOS DIFERENTES (mesma unidade entre si — comparação
  //     válida) + 1 família, para provar dois invariantes distintos:
  //     (1) entre ITENS, a ordem da resposta bate com o marginPercent
  //         exposto, ordenado — nenhum valor interno invisível decidiu a
  //         posição; (2) a família nunca entra nessa disputa (fica sempre
  //         no fim, ver teste R) e nunca expõe margemProjetadaPercent — só
  //         `margemProjetadaProfit`, que é o MESMO valor somado, nunca uma
  //         média/percentual inventado.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB-X" }),
      anuncioFixture({ item_id: "MLB-Y" }),
      anuncioFixture({ item_id: "MLB-Z" }),
      anuncioFixture({ item_id: "MLB-A1", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-A2", user_product_id: "UP1" }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    // FAM1: filhos 8% e 100% -> média 54% (MAIOR que qualquer item avulso,
    // inclusive MLB-X=40%) — família AGORA disputa e VENCE de verdade.
    // profit da família (12.5+9.25=21.75) é DELIBERADAMENTE menor que o de
    // MLB-X (55) — prova que quem decide a posição é a MÉDIA de
    // marginPercent, nunca o profit somado.
    snapshotHandler = () => new Map([
      ["MLB-X", { marginPercent: 40, profit: 55, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-Y", { marginPercent: 17.4, profit: 20, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-Z", { marginPercent: 3, profit: 2, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-A1", { marginPercent: 8, profit: 12.5, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-A2", { marginPercent: 100, profit: 9.25, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_desc" } }, res);

    const familia = res.corpo.anuncios.find((a) => a.tipo === "familia");
    assert.strictEqual(familia.margemProjetadaProfit, 21.75, "família: profit exposto é a soma real (12.5+9.25=21.75) — não é o que decide a posição");
    assert.strictEqual(familia.margemProjetadaPercent, null, "família: margemProjetadaPercent nunca é preenchido, mesmo com filho de marginPercent=100");
    assert.strictEqual(familia.margemProjetadaMediaPercent, 54, "média dos filhos: (8+100)/2 = 54 — o valor que decidiu a posição");
    assert.strictEqual(familia.margemProjetadaMinPercent, 8);
    assert.strictEqual(familia.margemProjetadaMaxPercent, 100);

    // Invariante 1: entre ITENS (mesma unidade), a ordem da resposta já é a
    // ordem decrescente do próprio margemProjetadaPercent exposto — o valor
    // que decidiu a posição é EXATAMENTE o valor mostrado.
    const itensNaOrdem = res.corpo.anuncios.filter((a) => a.tipo === "item");
    const percentuaisExpostos = itensNaOrdem.map((a) => a.margemProjetadaPercent);
    assert.deepStrictEqual(percentuaisExpostos, [40, 17.4, 3],
      "itens vêm na ordem decrescente do PRÓPRIO margemProjetadaPercent exposto (40, 17.4, 3) — o mesmo valor que decidiu a posição");

    // Invariante 2: família disputa e VENCE por média (54%), à frente do
    // maior item avulso (MLB-X, 40%) — mesmo com profit somado (21.75) MENOR
    // que o profit do próprio MLB-X (55): quem decide é a média de
    // marginPercent, nunca o profit.
    assert.strictEqual(res.corpo.anuncios[0].tipo, "familia", "família (média 54%) vem em PRIMEIRO lugar — à frente de MLB-X (40%), o maior item avulso");
    assert.deepStrictEqual(res.corpo.anuncios.slice(1).map((a) => a.item_id), ["MLB-X", "MLB-Y", "MLB-Z"], "itens seguem na mesma ordem de sempre, logo depois da família");
    snapshotHandler = null;
    console.log("  ✓ AB. valor exposto na resposta === valor usado no ranking (item: margemProjetadaPercent; família: margemProjetadaMediaPercent, compete de verdade contra item, profit nunca decide)");
  });

  // AD. faturamento_desc TAMBÉM anexa os campos de margem projetada — fonte
  //     única da célula, independente do critério de ordenação ativo. Batch
  //     é só da PÁGINA retornada (2 de 4 itens do catálogo filtrado, ver
  //     PASSO "sort normal continua barato") — nunca o catálogo inteiro que
  //     `todosItemIds` already resolveu pro ranking de faturamento.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB1" }), anuncioFixture({ item_id: "MLB2" }),
      anuncioFixture({ item_id: "MLB3" }), anuncioFixture({ item_id: "MLB4" }),
    ],
  }, async () => {
    chamadasSnapshot.length = 0;
    motorHandler = () => ({
      porMlb: new Map([["MLB1", { receita: 400 }], ["MLB2", { receita: 300 }], ["MLB3", { receita: 200 }], ["MLB4", { receita: 100 }]]),
      periodo: {},
    });
    snapshotHandler = () => new Map([["MLB1", { marginPercent: 12, profit: 5, computable: true, status: "HEALTHY", calculadoEm: "2026-09-28T00:00:00Z", origemJob: "manual_cli" }]]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "2", ordenarPor: "faturamento_desc" } }, res);
    assert.deepStrictEqual(res.corpo.anuncios.map((a) => a.item_id), ["MLB1", "MLB2"], "pré-condição: página 1 de 2, MLB1/MLB2 (maior faturamento)");
    assert.strictEqual(res.corpo.anuncios[0].margemProjetadaPercent, 12, "MLB1: campo de margem projetada vem junto, mesmo ordenando por faturamento");
    assert.strictEqual(res.corpo.anuncios[1].margemProjetadaPercent, null, "MLB2: sem snapshot, null");
    assert.strictEqual(chamadasSnapshot.length, 1);
    assert.deepStrictEqual(chamadasSnapshot[0].itemIds.sort(), ["MLB1", "MLB2"],
      "batch pede só os 2 item_id DESTA PÁGINA — MLB3/MLB4 (resto do catálogo, usados só pro ranking de faturamento) nunca entram nesta leitura");
    motorHandler = null; snapshotHandler = null;
    console.log("  ✓ AD. faturamento_desc: também anexa margem projetada, batch só da página (2), nunca o catálogo filtrado inteiro (4)");
  });

  // AE. curvaAbc_asc TAMBÉM anexa — mesmo comportamento de AD, critério
  //     diferente (prova que não é hardcoded só pro branch de faturamento).
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [anuncioFixture({ item_id: "MLB1" }), anuncioFixture({ item_id: "MLB2" })],
  }, async () => {
    chamadasSnapshot.length = 0;
    motorHandler = () => ({ porMlb: new Map([["MLB1", { receita: 900 }], ["MLB2", { receita: 100 }]]), periodo: {} });
    snapshotHandler = () => new Map([["MLB2", { marginPercent: 7, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }]]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "curvaAbc_asc" } }, res);
    const mlb2 = res.corpo.anuncios.find((a) => a.item_id === "MLB2");
    assert.strictEqual(mlb2.margemProjetadaPercent, 7, "curvaAbc_asc também anexa margem projetada");
    assert.strictEqual(chamadasSnapshot.length, 1);
    motorHandler = null; snapshotHandler = null;
    console.log("  ✓ AE. curvaAbc_asc: também anexa margem projetada da página");
  });

  // AF. unidades_desc TAMBÉM anexa — mesmo comportamento, critério que nem
  //     passa pelo Motor (usa buscarVendas7dPorItens).
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [anuncioFixture({ item_id: "MLB1" }), anuncioFixture({ item_id: "MLB2" })],
  }, async () => {
    chamadasSnapshot.length = 0;
    vendasHandler = () => ({ ok: true, porItem: { MLB1: 10, MLB2: 5 } });
    snapshotHandler = () => new Map([["MLB1", { marginPercent: 33, profit: 9, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }]]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "unidades_desc" } }, res);
    const mlb1 = res.corpo.anuncios.find((a) => a.item_id === "MLB1");
    assert.strictEqual(mlb1.margemProjetadaPercent, 33, "unidades_desc também anexa margem projetada");
    assert.strictEqual(chamadasSnapshot.length, 1);
    vendasHandler = null; snapshotHandler = null;
    console.log("  ✓ AF. unidades_desc: também anexa margem projetada da página");
  });

  // AG. margem_desc NÃO faz uma 2ª leitura de snapshot para anexar os campos
  //     na página — reaproveita o `ranking` (snapshot do catálogo FILTRADO
  //     inteiro) já carregado pro ranking global (PASSO "não duplicar leitura").
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB1" }), anuncioFixture({ item_id: "MLB2" }),
      anuncioFixture({ item_id: "MLB3" }), anuncioFixture({ item_id: "MLB4" }),
    ],
  }, async () => {
    chamadasSnapshot.length = 0;
    snapshotHandler = () => new Map([
      ["MLB1", { marginPercent: 40, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB2", { marginPercent: 30, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB3", { marginPercent: 20, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB4", { marginPercent: 10, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "2", ordenarPor: "margem_desc" } }, res);
    assert.deepStrictEqual(res.corpo.anuncios.map((a) => a.item_id), ["MLB1", "MLB2"]);
    assert.strictEqual(res.corpo.anuncios[0].margemProjetadaPercent, 40);
    assert.strictEqual(chamadasSnapshot.length, 1,
      "exatamente 1 leitura de snapshot (a do ranking global, contra o catálogo filtrado inteiro) — os campos da página são recortados dela, nunca uma 2ª query");
    assert.deepStrictEqual(chamadasSnapshot[0].itemIds.sort(), ["MLB1", "MLB2", "MLB3", "MLB4"],
      "a ÚNICA leitura pede o catálogo FILTRADO inteiro (necessário pro ranking global) — não é 'só a página', é reaproveitamento, não coincidência");
    snapshotHandler = null;
    console.log("  ✓ AG. margem_desc: 1 única leitura de snapshot (reaproveitada do ranking), nunca uma 2ª pra anexar a página");
  });

  // AH-AL. Cenários OBRIGATÓRIOS da missão "faixa de margem projetada nos
  //        agrupadores" — exemplos exatos do prompt, um por um.

  // AH. Família com 3 filhos (10%/20%/30%): faixa 10%-30%, ranking = média 20%.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB-A1", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-A2", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-A3", user_product_id: "UP1" }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    snapshotHandler = () => new Map([
      ["MLB-A1", { marginPercent: 10, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-A2", { marginPercent: 20, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-A3", { marginPercent: 30, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_desc" } }, res);
    const familia = res.corpo.anuncios.find((a) => a.tipo === "familia");
    assert.strictEqual(familia.margemProjetadaMinPercent, 10);
    assert.strictEqual(familia.margemProjetadaMaxPercent, 30);
    assert.strictEqual(familia.margemProjetadaMediaPercent, 20, "(10+20+30)/3 = 20");
    snapshotHandler = null;
    console.log("  ✓ AH. família com 3 filhos (10/20/30): visual 10%-30%, ranking (média) 20%");
  });

  // AI. Família com 2 filhos (5%/25%): faixa 5%-25%, ranking = média 15%.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB-A1", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-A2", user_product_id: "UP1" }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    snapshotHandler = () => new Map([
      ["MLB-A1", { marginPercent: 5, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-A2", { marginPercent: 25, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_desc" } }, res);
    const familia = res.corpo.anuncios.find((a) => a.tipo === "familia");
    assert.strictEqual(familia.margemProjetadaMinPercent, 5);
    assert.strictEqual(familia.margemProjetadaMaxPercent, 25);
    assert.strictEqual(familia.margemProjetadaMediaPercent, 15, "(5+25)/2 = 15");
    snapshotHandler = null;
    console.log("  ✓ AI. família com 2 filhos (5/25): visual 5%-25%, ranking (média) 15%");
  });

  // AJ. Filho sem snapshot (10%/null/30%): o filho sem snapshot é IGNORADO
  //     na faixa/média — nunca vira 0, nunca estica o mínimo.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB-A1", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-A2", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-A3", user_product_id: "UP1" }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    snapshotHandler = () => new Map([
      ["MLB-A1", { marginPercent: 10, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      // MLB-A2: sem entrada no Map — snapshot ausente (equivale a "null" do prompt).
      ["MLB-A3", { marginPercent: 30, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_desc" } }, res);
    const familia = res.corpo.anuncios.find((a) => a.tipo === "familia");
    assert.strictEqual(familia.margemProjetadaMinPercent, 10);
    assert.strictEqual(familia.margemProjetadaMaxPercent, 30);
    assert.strictEqual(familia.margemProjetadaMediaPercent, 20, "(10+30)/2 = 20 — o filho sem snapshot NUNCA entra na conta (nem como 0)");
    snapshotHandler = null;
    console.log("  ✓ AJ. filho sem snapshot (10/null/30): ignorado — visual 10%-30%, ranking (média dos 2 válidos) 20%");
  });

  // AK. Todos os filhos noncomputable (UNVALIDATED): visual "—" (min/max/média
  //     null), ranking NULLS LAST.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB-A1", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-A2", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-B" }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    snapshotHandler = () => new Map([
      ["MLB-A1", { marginPercent: null, profit: null, computable: false, status: "UNVALIDATED", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-A2", { marginPercent: null, profit: null, computable: false, status: "UNVALIDATED", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-B", { marginPercent: 12, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_desc" } }, res);
    const familia = res.corpo.anuncios.find((a) => a.tipo === "familia");
    assert.strictEqual(familia.margemProjetadaMinPercent, null, "todos os filhos UNVALIDATED — sem faixa, nunca 0");
    assert.strictEqual(familia.margemProjetadaMaxPercent, null);
    assert.strictEqual(familia.margemProjetadaMediaPercent, null, "sem média — NULLS LAST");
    assert.strictEqual(res.corpo.anuncios[0].item_id, "MLB-B", "MLB-B (12%, computável) vem ANTES da família (sem nenhum filho computável)");
    assert.strictEqual(res.corpo.anuncios[1].family_id, "FAM1", "família cai pro fim — NULLS LAST por falta de sinal");
    snapshotHandler = null;
    console.log("  ✓ AK. família com todos os filhos noncomputable: visual '—' (min/max/média null), ranking NULLS LAST");
  });

  // AL. "Realizada" nunca entra na conta — dupla prova. (1) Nível de DADO:
  //     mesmo que a entrada do snapshot carregasse um campo `realized`
  //     (aqui simulado deliberadamente com um valor ENORME, 80%, que
  //     dominaria a média se fosse lido por engano), a agregação só lê
  //     `marginPercent`/`computable` — o `realized` simulado é só ruído no
  //     objeto, nunca alcançado pelo código. (2) Nível ESTRUTURAL: checagem
  //     estática confirma que o bloco de agregação nunca REFERENCIA a
  //     palavra "realized" no código-fonte, então não é coincidência do
  //     fixture — é impossível de acontecer.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB-A1", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-A2", user_product_id: "UP1" }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    snapshotHandler = () => new Map([
      // `realized: 80` simulado de propósito — nunca deveria influenciar
      // min/max/média (que ficam em 10/20/15, não perto de 80).
      ["MLB-A1", { marginPercent: 10, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli", realized: 80 }],
      ["MLB-A2", { marginPercent: 20, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli", realized: 80 }],
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_desc" } }, res);
    const familia = res.corpo.anuncios.find((a) => a.tipo === "familia");
    assert.strictEqual(familia.margemProjetadaMinPercent, 10, "mínimo é o marginPercent projetado (10), não o 'realized' simulado (80)");
    assert.strictEqual(familia.margemProjetadaMaxPercent, 20, "máximo é o marginPercent projetado (20), não o 'realized' simulado (80)");
    assert.strictEqual(familia.margemProjetadaMediaPercent, 15, "(10+20)/2 = 15 — o 'realized' simulado (80) nunca entra na soma");
    snapshotHandler = null;

    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(path.join(__dirname, "../controllers/meliAnunciosController.js"), "utf8");
    const inicioFn = src.indexOf("function montarMargemProjetadaGlobal(");
    const fimFn = src.indexOf("\r\n}\r\n", inicioFn); // CRLF no repo — "\n}\n" nunca bate
    assert.ok(fimFn > inicioFn, "precisa achar o fim de montarMargemProjetadaGlobal");
    const blocoFn = src.slice(inicioFn, fimFn);
    assert.ok(!/realized/i.test(blocoFn), "montarMargemProjetadaGlobal (min/max/média de família) nunca referencia 'realized' — a agregação só lê marginPercent do snapshot, que já é sempre projetado");
    console.log("  ✓ AL. faixa/média de família nunca usa margem realizada — nem por dado (campo 'realized' simulado no snapshot é ignorado), nem estruturalmente (checagem estática do bloco de agregação)");
  });

  // AM. Caso C: família com EXATAMENTE 1 filho computável (18%) — min===max,
  //     visual deve mostrar o valor ÚNICO ("18,0%"), NUNCA "18,0% – 18,0%".
  //     Ranking usa o mesmo valor (18%) como média de 1 elemento.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB-A1", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-B" }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    snapshotHandler = () => new Map([
      ["MLB-A1", { marginPercent: 18, profit: 2, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
      ["MLB-B", { marginPercent: 5, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_desc" } }, res);
    const familia = res.corpo.anuncios.find((a) => a.tipo === "familia");
    assert.strictEqual(familia.margemProjetadaMinPercent, 18);
    assert.strictEqual(familia.margemProjetadaMaxPercent, 18, "min === max com 1 único filho computável — a faixa vira um ponto só");
    assert.strictEqual(familia.margemProjetadaMediaPercent, 18, "média de 1 elemento é o próprio valor");
    assert.strictEqual(res.corpo.anuncios[0].family_id, "FAM1", "família (18%) vem antes de MLB-B (5%) — ranking usa o valor único normalmente");
    snapshotHandler = null;
    console.log("  ✓ AM. família com 1 único filho computável (18%): min===max no backend (o front decide não repetir o valor — ver teste headless 39a4)");
  });

  // AN. Caso D (mistura EXATA do prompt): filho SEM snapshot + filho
  //     UNVALIDATED + filho SEM snapshot — as DUAS razões de exclusão
  //     (ausência e não-computável) juntas na MESMA família, nenhuma delas
  //     contamina min/max/média.
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB-A1", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-A2", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-A3", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-B" }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    snapshotHandler = () => new Map([
      // MLB-A1: sem entrada no Map — snapshot ausente ("null" do prompt).
      ["MLB-A2", { marginPercent: null, profit: null, computable: false, status: "UNVALIDATED", calculadoEm: null, origemJob: "manual_cli" }],
      // MLB-A3: sem entrada no Map — snapshot ausente ("null" do prompt).
      ["MLB-B", { marginPercent: 7, profit: 1, computable: true, status: "HEALTHY", calculadoEm: null, origemJob: "manual_cli" }],
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_desc" } }, res);
    const familia = res.corpo.anuncios.find((a) => a.tipo === "familia");
    assert.strictEqual(familia.margemProjetadaMinPercent, null, "null + UNVALIDATED + null: nenhum filho computável, sem faixa");
    assert.strictEqual(familia.margemProjetadaMaxPercent, null);
    assert.strictEqual(familia.margemProjetadaMediaPercent, null, "sem média — NULLS LAST");
    assert.strictEqual(res.corpo.anuncios[0].item_id, "MLB-B", "MLB-B (7%, computável) vem antes da família (nenhum sinal)");
    assert.strictEqual(res.corpo.anuncios[1].family_id, "FAM1", "família cai pro fim — NULLS LAST");
    snapshotHandler = null;
    console.log("  ✓ AN. família com null/UNVALIDATED/null (mistura exata do prompt): visual '—' (min/max/média null), ranking NULLS LAST");
  });

  // AC. Checagem ESTÁTICA (arquitetural, não só o spy em runtime dos testes
  //     acima): o bloco `margemProjetada` do controller não pode nem
  //     REFERENCIAR motorMargemService/meliApiEvidenceAdapter/
  //     marketplaceCurrentQuoteService/mlFetch — nunca uma chamada externa ao
  //     Mercado Livre durante a listagem. Isola só o texto do branch (entre o
  //     `else if (config.campo === "margemProjetada")` e o próximo `} else {`
  //     no mesmo nível), porque o ARQUIVO inteiro legitimamente importa
  //     motorMargemService (usado por /performance, endpoint diferente).
  {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "../controllers/meliAnunciosController.js"),
      "utf8"
    );
    const inicio = src.indexOf('config.campo === "margemProjetada"');
    assert.ok(inicio > -1, "branch margemProjetada precisa existir no controller");
    const fim = src.indexOf("} else {", inicio);
    assert.ok(fim > inicio, "precisa achar o fim do branch (próximo `} else {` no mesmo nível)");
    const bloco = src.slice(inicio, fim);

    for (const proibido of ["motorMargemService", "meliApiEvidenceAdapter", "marketplaceCurrentQuoteService", "mlFetch("]) {
      assert.ok(!bloco.includes(proibido), `branch margemProjetada NÃO pode referenciar ${proibido}`);
    }
    assert.ok(bloco.includes("margemProjetadaSnapshotRepository"), "branch margemProjetada precisa usar o repositório de snapshot");
    console.log("  ✓ AC. branch margemProjetada (checagem estática): sem referência a Motor/ML — só o repositório de snapshot");
  }

  console.log("meliAnunciosOrdenacaoGlobal.test.js passed");
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
