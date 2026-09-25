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
    assert.strictEqual(res.corpo.anuncios[0].faturamentoValor, undefined);
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

  console.log("meliAnunciosOrdenacaoGlobal.test.js passed");
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
