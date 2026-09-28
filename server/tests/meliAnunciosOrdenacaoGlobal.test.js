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

  // R. Contrato de família AUDITADO contra o que já está em produção — não
  //    escolhido de novo (ver comentário de montarMargemProjetadaGlobal):
  //    `montarMargemPorFamilia` (performance()) e o sort LOCAL do Portal
  //    (`valorOrdenacaoDaLinha`, anuncios-meli.js:2147) já usam SOMA de
  //    profit como valor INFORMATIVO de família — NUNCA média/herança de
  //    marginPercent, e NUNCA um valor que compete numericamente com o
  //    marginPercent (%) de um item avulso na MESMA ordenação (gate do
  //    prompt "fechar integração funcional da tela": "profit não compete
  //    numericamente com marginPercent" + "família fica em NULLS LAST").
  //    `margemProjetadaPercent` de família fica SEMPRE null (nunca a soma
  //    rotulada como "Percent", que seria exatamente o erro "profit como se
  //    fosse margin_percent"). `margemProjetadaProfit` carrega a soma
  //    (rotulada corretamente, só informativo — nunca usado pra ordenar).
  await withMockDb({
    ...UMA_CONTA,
    anuncios: [
      anuncioFixture({ item_id: "MLB-A1", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-A2", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-B", user_product_id: null }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    // FAM1: profit 10+4=14 (soma) — DELIBERADAMENTE bem menor que o profit
    // de MLB-B (999), mas MLB-B tem marginPercent BAIXO (5%). Sob o bug
    // antigo (família ranqueada pela soma de profit, competindo direto com
    // marginPercent do item), FAM1 venceria em margem_desc (14 > 5). Sob o
    // contrato correto (família SEMPRE NULLS LAST, nunca no comparator),
    // MLB-B (tem valor, 5%) vem ANTES de FAM1 (não tem valor de ranking
    // nenhum) — prova que profit de família não compete com marginPercent
    // de item em NENHUM sentido, nem "família ganha por ter number maior".
    snapshotHandler = () => new Map([
      ["MLB-A1", { marginPercent: 40, profit: 10, computable: true, status: "HEALTHY", calculadoEm: "2026-09-28T04:00:00Z", origemJob: "manual_cli" }],
      ["MLB-A2", { marginPercent: 20, profit: 4, computable: true, status: "HEALTHY", calculadoEm: "2026-09-28T05:00:00Z", origemJob: "manual_cli" }],
      ["MLB-B", { marginPercent: 5, profit: 999, computable: true, status: "HEALTHY", calculadoEm: "2026-09-28T03:00:00Z", origemJob: "manual_cli" }],
    ]);
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", page: "1", limit: "10", ordenarPor: "margem_desc" } }, res);
    const familia = res.corpo.anuncios.find((a) => a.tipo === "familia");
    const itemAvulso = res.corpo.anuncios.find((a) => a.tipo === "item");
    assert.ok(familia, "FAM1 precisa aparecer como família");
    // MLB-B (marginPercent=5, computável) vem ANTES de FAM1 mesmo com
    // marginPercent baixíssimo — porque família não tem valor de ranking
    // NENHUM (nem o profit=999 dela entra na disputa), não porque "5 > 14"
    // em alguma unidade comum (não existe unidade comum).
    assert.strictEqual(res.corpo.anuncios[0].item_id, "MLB-B", "MLB-B (tem valor de ranking, 5%) sempre antes de FAM1 (sem valor de ranking, mesmo com profit=14 informativo)");
    assert.strictEqual(res.corpo.anuncios[1].family_id, "FAM1", "FAM1 cai pro fim (NULLS LAST) mesmo tendo o MAIOR profit somado nominal (14) — profit de família nunca é comparado numericamente contra marginPercent de item");
    assert.strictEqual(familia.margemProjetadaPercent, null, "família NUNCA tem margemProjetadaPercent — nem a soma nem uma média rotuladas como percentual");
    assert.strictEqual(familia.margemProjetadaProfit, 14, "família usa a SOMA de profit dos filhos (10+4=14) — mesma fonte do sort local já em produção, só que agora puramente informativa");
    assert.strictEqual(familia.margemProjetadaComputable, false, "família nunca é 'computável' — não existe margem % de família, ponto");
    assert.strictEqual(familia.margemProjetadaStatus, null, "status não agrega por família — nunca inventado");
    assert.strictEqual(familia.margemProjetadaCalculadaEm, "2026-09-28T05:00:00Z", "calculadoEm de família é o MAIS RECENTE entre os filhos com profit conhecido");
    assert.strictEqual(itemAvulso.margemProjetadaPercent, 5, "MLB-B avulso: continua usando marginPercent direto, sem agregação");
    assert.strictEqual(itemAvulso.margemProjetadaProfit, 999, "MLB-B avulso: profit próprio, sem soma nenhuma");
    snapshotHandler = null;
    console.log("  ✓ R. margem_desc: família é SEMPRE NULLS LAST (nunca ranqueada pela soma de profit), margemProjetadaPercent SEMPRE null, profit é só informativo");
  });

  // S. família sem NENHUM filho com profit conhecido fica null (vai para o
  //    fim) — não é tratada como 0 nem herda do avulso.
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
    assert.deepStrictEqual(res.corpo.anuncios.map((a) => a.item_id), ["MLB-B", "FAM1"].map((k) => (k === "FAM1" ? familia.item_id : k)));
    assert.strictEqual(res.corpo.anuncios[0].family_id, null, "MLB-B (profit=1, computável) vem antes de FAM1 (sem profit, null)");
    snapshotHandler = null;
    console.log("  ✓ S. margem_desc: família sem nenhum filho com profit conhecido fica null, no fim — nunca 0 nem herda do avulso");
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
    assert.strictEqual(familia.margemProjetadaProfit, 21.75, "família: valor exposto é a soma real (12.5+9.25=21.75), independente do marginPercent alto de um dos filhos (100%)");
    assert.strictEqual(familia.margemProjetadaPercent, null, "família: margemProjetadaPercent nunca é preenchido, mesmo com filho de marginPercent=100");

    // Invariante 1: entre ITENS (mesma unidade), a ordem da resposta já é a
    // ordem decrescente do próprio margemProjetadaPercent exposto — o valor
    // que decidiu a posição é EXATAMENTE o valor mostrado.
    const itensNaOrdem = res.corpo.anuncios.filter((a) => a.tipo === "item");
    const percentuaisExpostos = itensNaOrdem.map((a) => a.margemProjetadaPercent);
    assert.deepStrictEqual(percentuaisExpostos, [40, 17.4, 3],
      "itens vêm na ordem decrescente do PRÓPRIO margemProjetadaPercent exposto (40, 17.4, 3) — o mesmo valor que decidiu a posição");

    // Invariante 2: família nunca disputa posição com item nenhum, mesmo
    // tendo um filho (MLB-A2) com marginPercent=100 (maior que qualquer
    // item avulso) — profit continua só informativo, nunca vira ranking.
    assert.strictEqual(res.corpo.anuncios[res.corpo.anuncios.length - 1].tipo, "familia",
      "família fica na ÚLTIMA posição, mesmo com um filho de marginPercent=100 — profit de família nunca compete com marginPercent de item");
    snapshotHandler = null;
    console.log("  ✓ AB. valor exposto na resposta === valor usado no ranking (item: margemProjetadaPercent, mesma unidade comparável; família: sempre última, margemProjetadaProfit só informativo)");
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
