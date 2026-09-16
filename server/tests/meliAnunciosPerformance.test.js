// server/tests/meliAnunciosPerformance.test.js
//
// GET /anuncios-meli/performance — enriquecimento AO VIVO e ASSÍNCRONO da
// listagem (métricas últ. 7 dias + margem por MLB). Ver
// server/controllers/meliAnunciosController.js (performance) e o plano em
// docs (commit desta entrega).
//
// O que este teste protege:
//
//  1. a lista de itemIds é cortada em PERFORMANCE_MAX_ITENS — proteção da
//     rota, não regra de domínio — e NUNCA um itemId além do teto chega aos
//     dois serviços de baixo;
//  2. métricas e margem são blocos INDEPENDENTES: falha de um nunca derruba
//     o outro (Promise.allSettled);
//  3. contexto do Motor de Margem não-pronto (Base não vinculada etc.) vira
//     `margemIndisponivel` com a MESMA mensagem do erro tipado — nunca 500,
//     nunca texto inventado;
//  4. margem por item escolhe `realized` quando computável, senão
//     `projected` — mesma precedência que o próprio Motor já usa para
//     ordenar;
//  5. clienteContaId chega aos dois serviços de baixo — margem da conta
//     ERRADA para cliente multi-conta seria pior que não mostrar margem;
//  6. clienteSlug ausente é 400; lote de itemIds vazio não gasta chamada
//     nenhuma; ambiguidade de conta (2+ contas, sem seleção) é 409.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const Module = require("module");

let metricasHandler = null; // ({clienteId, mlUserId, itemIds}) => valor ou throw
let margemHandler = null;   // ({clienteSlug, clienteContaId, itemIds}) => valor ou throw
let chamadasMetricas = [];
let chamadasMargem = [];

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "../services/meliAnuncios/meliMetricas7dService") {
    return {
      async montarMetricas7d(args) {
        chamadasMetricas.push(args);
        if (!metricasHandler) return {};
        return metricasHandler(args);
      },
    };
  }
  if (request === "../services/motorMargem/motorMargemService") {
    return {
      async montarItens(args) {
        chamadasMargem.push(args);
        if (!margemHandler) return { itens: [] };
        return margemHandler(args);
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pool = require("../config/database");
const ctrl = require("../controllers/meliAnunciosController");

Module._load = originalLoad;

// ── fixtures de conta (mesmo padrão de meliAnunciosEstoque.test.js) ────────

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

const UMA_CONTA = {
  contas: [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", external_account_id: "111", is_primary: true, ativo: true }],
  grants: [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })],
};

const DUAS_CONTAS = {
  contas: [
    { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", external_account_id: "111", is_primary: true, ativo: true },
    { id: 11, cliente_id: 1, marketplace: "meli", nome: "ML 2", external_account_id: "222", is_primary: false, ativo: true },
  ],
  grants: [
    grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" }),
    grantFixture({ id: 101, cliente_id: 1, ml_user_id: "222" }),
  ],
};

class MockDb {
  constructor({ contas = [], grants = [] } = {}) {
    this.contas = contas;
    this.grants = grants;
  }

  async connect() {
    return { query: (sql, params) => this.query(sql, params), release() {} };
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

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
    if (q.includes("base_cliente_vinculos")) return { rows: [] };
    if (q.startsWith("CREATE TABLE") || q.startsWith("ALTER TABLE") || q.startsWith("CREATE INDEX")) {
      return { rows: [] };
    }
    return { rows: [] };
  }
}

function withMockDb(opts, fn) {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const db = new MockDb(opts);
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

function reset() {
  chamadasMetricas = [];
  chamadasMargem = [];
  metricasHandler = null;
  margemHandler = null;
}

function itemDeMargem({ itemId, realizedComputable, realizedMargin, projectedMargin, status, statusLabel, statusReasons }) {
  return {
    identity: { itemId },
    margin: {
      realized: { computable: !!realizedComputable, margin: realizedMargin ?? null, marginPercent: realizedMargin != null ? realizedMargin * 100 : null },
      projected: { computable: true, margin: projectedMargin ?? null, marginPercent: projectedMargin != null ? projectedMargin * 100 : null },
    },
    quality: { status, statusLabel, statusReasons: statusReasons || [] },
  };
}

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

async function run() {
  // 1. Caminho feliz: métricas e margem combinadas, margem prefere REALIZED
  //    quando computável, PROJECTED quando não.
  await withMockDb(UMA_CONTA, async () => {
    reset();
    metricasHandler = () => ({
      "MLB-A": { views: 100, vendas: 3, conversao: 3 },
      "MLB-B": { views: 50, vendas: 0, conversao: 0 },
    });
    margemHandler = () => ({
      itens: [
        itemDeMargem({ itemId: "MLB-A", realizedComputable: true, realizedMargin: 0.25, projectedMargin: 0.4, status: "HEALTHY", statusLabel: "Saudável" }),
        itemDeMargem({ itemId: "MLB-B", realizedComputable: false, projectedMargin: 0.05, status: "LOW_MARGIN", statusLabel: "Margem baixa", statusReasons: ["Margem de 5.00% abaixo da meta de 10.00%."] }),
      ],
    });

    const res = fakeRes();
    await ctrl.performance({ query: { clienteSlug: "cliente-a", itemIds: "MLB-A,MLB-B" } }, res);

    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    assert.strictEqual(res.corpo.metricas7d["MLB-A"].views, 100);
    assert.strictEqual(res.corpo.margem["MLB-A"].origem, "realized", "MLB-A tem realized computável — precisa preferir realized");
    assert.strictEqual(res.corpo.margem["MLB-A"].marginPercent, 25);
    assert.strictEqual(res.corpo.margem["MLB-B"].origem, "projected", "MLB-B sem realized computável — cai para projected");
    assert.strictEqual(res.corpo.margem["MLB-B"].marginPercent, 5);
    assert.strictEqual(res.corpo.margem["MLB-B"].statusLabel, "Margem baixa");
    assert.strictEqual(res.corpo.margemIndisponivel, null);
    ok("caminho feliz: métricas + margem combinadas, realized > projected na precedência de exibição");
  });

  // 2. Contexto do Motor não-pronto (Base não vinculada) vira
  //    margemIndisponivel com a mensagem REAL do erro — nunca 500, e
  //    métricas continuam chegando normalmente (independência dos blocos).
  await withMockDb(UMA_CONTA, async () => {
    reset();
    metricasHandler = () => ({ "MLB-A": { views: 10, vendas: 1, conversao: 10 } });
    margemHandler = () => {
      const err = new Error("Base de custos MELI não vinculada.");
      err.statusCode = 424;
      err.payload = { ok: false, codigo: "BASE_MELI_NAO_VINCULADA", erro: "Base de custos MELI não vinculada." };
      throw err;
    };

    const res = fakeRes();
    await ctrl.performance({ query: { clienteSlug: "cliente-a", itemIds: "MLB-A" } }, res);

    assert.strictEqual(res.statusCode, 200, "contexto de margem não-pronto não pode virar 500");
    assert.strictEqual(res.corpo.ok, true);
    assert.deepStrictEqual(res.corpo.margem, {});
    assert.deepStrictEqual(res.corpo.margemIndisponivel, {
      codigo: "BASE_MELI_NAO_VINCULADA",
      mensagem: "Base de custos MELI não vinculada.",
    });
    assert.strictEqual(res.corpo.metricas7d["MLB-A"].views, 10, "métricas não podem ser afetadas pela margem indisponível");
    ok("Base não vinculada: margemIndisponivel com a mensagem real do Motor, listagem de métricas intacta, 200 (nunca 500)");
  });

  // 3. Falha das MÉTRICAS não derruba a margem (independência no outro
  //    sentido).
  await withMockDb(UMA_CONTA, async () => {
    reset();
    metricasHandler = () => { throw new Error("Falha ao buscar visitas"); };
    margemHandler = () => ({
      itens: [itemDeMargem({ itemId: "MLB-A", realizedComputable: true, realizedMargin: 0.3, status: "HEALTHY", statusLabel: "Saudável" })],
    });

    const res = fakeRes();
    await ctrl.performance({ query: { clienteSlug: "cliente-a", itemIds: "MLB-A" } }, res);

    assert.strictEqual(res.corpo.ok, true);
    assert.deepStrictEqual(res.corpo.metricas7d, {}, "métricas falhas viram objeto vazio, não derrubam a resposta");
    assert.strictEqual(res.corpo.margem["MLB-A"].marginPercent, 30, "margem segue intacta mesmo com métricas falhando");
    ok("falha das métricas não derruba a margem — resposta continua 200 com margem íntegra");
  });

  // 4. Teto PERFORMANCE_MAX_ITENS: itemIds além do teto nunca chegam aos
  //    serviços de baixo.
  await withMockDb(UMA_CONTA, async () => {
    reset();
    metricasHandler = () => ({});
    margemHandler = () => ({ itens: [] });

    const muitos = Array.from({ length: 40 }, (_, i) => `MLB-${i}`);
    const res = fakeRes();
    await ctrl.performance({ query: { clienteSlug: "cliente-a", itemIds: muitos.join(",") } }, res);

    assert.strictEqual(res.corpo.ok, true);
    assert.ok(chamadasMetricas[0].itemIds.length <= 24, "métricas não podem receber mais itens que o teto");
    assert.ok(chamadasMargem[0].itemIds.length <= 24, "margem não pode receber mais itens que o teto");
    assert.strictEqual(chamadasMetricas[0].itemIds.length, chamadasMargem[0].itemIds.length, "os dois serviços recebem o MESMO lote cortado");
    ok("PERFORMANCE_MAX_ITENS: itemIds além do teto são cortados antes de chegar aos dois serviços");
  });

  // 5. clienteContaId chega aos dois serviços de baixo.
  await withMockDb(DUAS_CONTAS, async () => {
    reset();
    metricasHandler = () => ({});
    margemHandler = () => ({ itens: [] });

    const res = fakeRes();
    await ctrl.performance(
      { query: { clienteSlug: "cliente-a", itemIds: "MLB-A", clienteContaId: "11" } },
      res
    );

    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    assert.strictEqual(chamadasMetricas[0].mlUserId, "222", "métricas têm de usar o ml_user_id da conta selecionada, não a primeira");
    assert.strictEqual(chamadasMargem[0].clienteContaId, 11, "margem tem de saber de qual conta é — senão calcula a conta errada");
    ok("clienteContaId chega correto aos dois serviços (métricas via mlUserId, margem via clienteContaId)");
  });

  // 6. Lote vazio: zero chamadas aos serviços de baixo.
  await withMockDb(UMA_CONTA, async () => {
    reset();
    const res = fakeRes();
    await ctrl.performance({ query: { clienteSlug: "cliente-a", itemIds: "" } }, res);
    assert.strictEqual(res.corpo.ok, true);
    assert.deepStrictEqual(res.corpo.metricas7d, {});
    assert.deepStrictEqual(res.corpo.margem, {});
    assert.strictEqual(chamadasMetricas.length, 0, "lote vazio não pode gastar chamada nenhuma");
    assert.strictEqual(chamadasMargem.length, 0);
    ok("itemIds vazio: 200 com mapas vazios, zero chamadas aos serviços de baixo");
  });

  // 7. clienteSlug ausente: 400 sem tocar nos serviços.
  await withMockDb(UMA_CONTA, async () => {
    reset();
    const res = fakeRes();
    await ctrl.performance({ query: { itemIds: "MLB-A" } }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(chamadasMetricas.length, 0);
    assert.strictEqual(chamadasMargem.length, 0);
    ok("clienteSlug ausente: 400 sem chamar nenhum serviço");
  });

  // 8. Ambiguidade de conta (2+ contas, sem seleção): 409, não chute.
  await withMockDb(DUAS_CONTAS, async () => {
    reset();
    const res = fakeRes();
    await ctrl.performance({ query: { clienteSlug: "cliente-a", itemIds: "MLB-A" } }, res);
    assert.strictEqual(res.statusCode, 409, "duas contas sem seleção não pode resolver sozinho — é ambiguidade");
    ok("duas contas sem clienteContaId: 409 (ambiguidade), nunca uma conta escolhida em silêncio");
  });
}

run()
  .then(() => {
    console.log(`\n✓ ${checks} verificações de GET /anuncios-meli/performance`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n✗ FALHOU:", err.message);
    console.error(err.stack);
    process.exit(1);
  });
