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

// `composicao`, quando informado, monta o shape REAL de pricing/costs/
// marketplaceCosts que core/marginItem.js produz (ver montarComposicaoDoItem
// no controller) — só os campos que o item precisa pra decompor a margem.
function evid(valor) {
  return valor == null ? null : { value: valor };
}

function itemDeMargem({
  itemId, realizedComputable, realizedMargin, realizedProfit, projectedMargin, projectedProfit, projectedComputable = true,
  status, statusLabel, statusReasons, composicao, precoAtual, precoAlvo, precoOriginal,
}) {
  const item = {
    identity: { itemId },
    margin: {
      realized: {
        computable: !!realizedComputable, margin: realizedMargin ?? null,
        marginPercent: realizedMargin != null ? realizedMargin * 100 : null, profit: realizedProfit ?? null,
      },
      projected: {
        computable: projectedComputable, margin: projectedMargin ?? null,
        marginPercent: projectedMargin != null ? projectedMargin * 100 : null, profit: projectedProfit ?? null,
      },
      // Preço alvo — mesmo shape de core/marginItem.js (margin.target). Só
      // `computable` quando o teste passa `precoAlvo` explicitamente; do
      // contrário fica exatamente como o Motor devolve quando não consegue
      // calcular (nunca um preço inventado).
      target: precoAlvo != null ? { computable: true, price: precoAlvo } : { computable: false, price: null },
    },
    quality: { status, statusLabel, statusReasons: statusReasons || [] },
  };
  if (precoAtual !== undefined || precoOriginal !== undefined) {
    item.pricing = {};
    if (precoAtual !== undefined) item.pricing.current = evid(precoAtual);
    if (precoOriginal !== undefined) item.pricing.list = evid(precoOriginal);
  }
  if (composicao) {
    item.pricing = { current: evid(composicao.vendaProjetada), sold: evid(composicao.vendaRealizada) };
    item.costs = {
      cost: { projected: evid(composicao.custoProjetado), realized: evid(composicao.custoRealizado) },
      taxRate: { projected: evid(composicao.impostoProjetado), realized: evid(composicao.impostoRealizado) },
      fixedFee: { projected: evid(composicao.taxaFixaProjetada), realized: evid(composicao.taxaFixaRealizada) },
    };
    item.marketplaceCosts = {
      commissionProjected: evid(composicao.comissaoProjetada),
      commissionRealized: evid(composicao.comissaoRealizada),
      freightProjected: evid(composicao.freteProjetado),
      freightRealized: evid(composicao.freteRealizado),
    };
  }
  return item;
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

  // 1b. precoAtual (obtido ao vivo) e precoAlvo (calculado p/ margem-alvo) do
  //     Motor chegam em margem[itemId] — a Tela de Anúncios lê exatamente
  //     esses dois campos para alimentar o preço da linha (ver
  //     Portal/anuncios-meli.js precoCelulaHtml/margemConteudoHtml). Item sem
  //     nenhum dos dois (Motor não resolveu) fica `null`, nunca 0.
  await withMockDb(UMA_CONTA, async () => {
    reset();
    margemHandler = () => ({
      itens: [
        itemDeMargem({
          itemId: "MLB-A", realizedComputable: false, projectedMargin: 0.18, status: "HEALTHY", statusLabel: "Saudável",
          precoAtual: 129.9, precoAlvo: 139.5,
        }),
        itemDeMargem({
          itemId: "MLB-B", realizedComputable: false, projectedComputable: false, status: "UNVALIDATED", statusLabel: "Sem custo",
        }),
      ],
    });

    const res = fakeRes();
    await ctrl.performance({ query: { clienteSlug: "cliente-a", itemIds: "MLB-A,MLB-B", incluirMetricas: "0" } }, res);

    assert.strictEqual(res.corpo.margem["MLB-A"].precoAtual, 129.9, "precoAtual vem de item.pricing.current (obtido pelo Motor)");
    assert.strictEqual(res.corpo.margem["MLB-A"].precoAlvo, 139.5, "precoAlvo vem de item.margin.target (calculado pelo Motor)");
    assert.strictEqual(res.corpo.margem["MLB-B"].precoAtual, null, "sem pricing no item, precoAtual é null — nunca 0");
    assert.strictEqual(res.corpo.margem["MLB-B"].precoAlvo, null, "target não-computável vira null — nunca um preço inventado");
    ok("precoAtual/precoAlvo do Motor chegam em margem[itemId], com null (nunca 0) quando o Motor não resolveu");
  });

  // 1c. precoOriginal (preço cheio/regular AO VIVO, item.pricing.list —
  //     sale_price.regular_amount via resolverPrecosItem) chega em
  //     margem[itemId] — a MESMA fonte que a composição já usa. Sem
  //     evidência (sem promoção ativa, ou Motor não resolveu), fica `null`,
  //     nunca 0 e nunca um valor "inventado" a partir de outro campo.
  await withMockDb(UMA_CONTA, async () => {
    reset();
    margemHandler = () => ({
      itens: [
        itemDeMargem({
          itemId: "MLB-A", realizedComputable: false, projectedMargin: 0.18, status: "HEALTHY", statusLabel: "Saudável",
          precoAtual: 89.9, precoOriginal: 129.9,
        }),
        itemDeMargem({
          itemId: "MLB-B", realizedComputable: false, projectedMargin: 0.18, status: "HEALTHY", statusLabel: "Saudável",
          precoAtual: 89.9,
        }),
      ],
    });

    const res = fakeRes();
    await ctrl.performance({ query: { clienteSlug: "cliente-a", itemIds: "MLB-A,MLB-B", incluirMetricas: "0" } }, res);

    assert.strictEqual(res.corpo.margem["MLB-A"].precoOriginal, 129.9, "precoOriginal vem de item.pricing.list (sale_price.regular_amount)");
    assert.strictEqual(res.corpo.margem["MLB-B"].precoOriginal, null, "sem promoção/evidência de list price, precoOriginal é null — nunca inventado a partir do preço atual");
    ok("precoOriginal (preço cheio ao vivo, sale_price.regular_amount) chega em margem[itemId], null quando o Motor não tem a evidência");
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

  // 9. incluirMargem=0 — usado pelo pré-carregamento em background do
  //    agrupador ainda fechado: métricas rodam normalmente, o Motor de
  //    Margem NUNCA é chamado (zero chamadas ao motorMargemService).
  await withMockDb(UMA_CONTA, async () => {
    reset();
    metricasHandler = () => ({ "MLB-A": { views: 10, vendas: 1, conversao: 10 } });
    margemHandler = () => ({ itens: [itemDeMargem({ itemId: "MLB-A", realizedComputable: true, realizedMargin: 0.3, status: "HEALTHY", statusLabel: "Saudável" })] });

    const res = fakeRes();
    await ctrl.performance({ query: { clienteSlug: "cliente-a", itemIds: "MLB-A", incluirMargem: "0" } }, res);

    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    assert.strictEqual(res.corpo.metricas7d["MLB-A"].views, 10, "métricas continuam vindo com incluirMargem=0");
    assert.deepStrictEqual(res.corpo.margem, {}, "margem some da resposta quando incluirMargem=0");
    assert.strictEqual(res.corpo.margemIndisponivel, null);
    assert.strictEqual(chamadasMargem.length, 0, "o Motor de Margem não pode ser chamado quando incluirMargem=0");
    assert.strictEqual(chamadasMetricas.length, 1, "métricas seguem chamadas normalmente");
    ok("incluirMargem=0: zero chamadas ao Motor de Margem, métricas intactas — o pré-carregamento do agrupador fechado nunca gasta margem");
  });

  // 10. incluirMetricas=0 — usado quando a expansão só precisa da margem
  //     (as métricas já vieram do pré-carregamento em background).
  await withMockDb(UMA_CONTA, async () => {
    reset();
    metricasHandler = () => ({ "MLB-A": { views: 10, vendas: 1, conversao: 10 } });
    margemHandler = () => ({ itens: [itemDeMargem({ itemId: "MLB-A", realizedComputable: true, realizedMargin: 0.3, status: "HEALTHY", statusLabel: "Saudável" })] });

    const res = fakeRes();
    await ctrl.performance({ query: { clienteSlug: "cliente-a", itemIds: "MLB-A", incluirMetricas: "0" } }, res);

    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    assert.deepStrictEqual(res.corpo.metricas7d, {}, "métricas somem da resposta quando incluirMetricas=0");
    assert.strictEqual(res.corpo.margem["MLB-A"].marginPercent, 30, "margem continua vindo com incluirMetricas=0");
    assert.strictEqual(chamadasMetricas.length, 0, "meliMetricas7dService não pode ser chamado quando incluirMetricas=0");
    assert.strictEqual(chamadasMargem.length, 1, "margem segue chamada normalmente");
    ok("incluirMetricas=0: zero chamadas a meliMetricas7dService, margem intacta — expandir depois do pré-carregamento não refaz a métrica");
  });

  // 11. Os dois desligados ao mesmo tempo: 200 com mapas vazios, zero
  //     chamadas aos dois serviços — mesmo com itemIds preenchido.
  await withMockDb(UMA_CONTA, async () => {
    reset();
    const res = fakeRes();
    await ctrl.performance({ query: { clienteSlug: "cliente-a", itemIds: "MLB-A", incluirMetricas: "0", incluirMargem: "0" } }, res);
    assert.strictEqual(res.corpo.ok, true);
    assert.deepStrictEqual(res.corpo.metricas7d, {});
    assert.deepStrictEqual(res.corpo.margem, {});
    assert.strictEqual(chamadasMetricas.length, 0);
    assert.strictEqual(chamadasMargem.length, 0);
    ok("incluirMetricas=0 e incluirMargem=0 juntos: zero chamadas aos dois serviços, mesmo com itemIds preenchido");
  });

  // 12. incluirComposicao=1 + margem REALIZADA computável: ladder completo,
  //     taxa fixa ausente (realizada nunca tem, por desenho — ver
  //     marginItem.js), imposto em R$ = venda × percentual (a ÚNICA conta
  //     nova, sobre os MESMOS dois valores que o Motor já usou).
  await withMockDb(UMA_CONTA, async () => {
    reset();
    metricasHandler = () => ({});
    margemHandler = () => ({
      itens: [itemDeMargem({
        itemId: "MLB-R1", realizedComputable: true, realizedMargin: 0.32, realizedProfit: 64, status: "HEALTHY", statusLabel: "Saudável",
        composicao: { vendaRealizada: 200, custoRealizado: 80, impostoRealizado: 0.05, comissaoRealizada: 25, freteRealizado: 15 },
      })],
    });

    const res = fakeRes();
    await ctrl.performance({ query: { clienteSlug: "cliente-a", itemIds: "MLB-R1", incluirComposicao: "1" } }, res);

    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    assert.strictEqual(res.corpo.margem["MLB-R1"].origem, "realized");
    assert.strictEqual(res.corpo.margem["MLB-R1"].profit, 64,
      "profit (R$) precisa vir junto — a composição usa este número pronto do Motor, nunca soma as linhas pra chegar nele");
    assert.deepStrictEqual(res.corpo.composicao["MLB-R1"], {
      venda: 200, custoProduto: 80, comissaoMl: 25, frete: 15, taxaFixa: null, impostoPercentual: 0.05, impostoValor: 10,
      precoPromocionalAtivo: false,
    }, JSON.stringify(res.corpo.composicao));
    ok("incluirComposicao=1 + margem realizada: ladder completo, taxa fixa ausente (sem histórico), imposto R$ = venda × percentual");
  });

  // 13. incluirComposicao=1 + margem PROJETADA (sem venda realizada): usa os
  //     campos projetados, incluindo taxa fixa (que só existe do lado
  //     projetado).
  await withMockDb(UMA_CONTA, async () => {
    reset();
    metricasHandler = () => ({});
    margemHandler = () => ({
      itens: [itemDeMargem({
        itemId: "MLB-P1", realizedComputable: false, projectedMargin: 0.20, projectedProfit: 30, status: "HEALTHY", statusLabel: "Saudável",
        composicao: { vendaProjetada: 150, custoProjetado: 60, impostoProjetado: 0.04, comissaoProjetada: 18, freteProjetado: 12, taxaFixaProjetada: 3 },
      })],
    });

    const res = fakeRes();
    await ctrl.performance({ query: { clienteSlug: "cliente-a", itemIds: "MLB-P1", incluirComposicao: "1" } }, res);

    assert.strictEqual(res.corpo.margem["MLB-P1"].origem, "projected");
    assert.strictEqual(res.corpo.margem["MLB-P1"].profit, 30);
    assert.deepStrictEqual(res.corpo.composicao["MLB-P1"], {
      venda: 150, custoProduto: 60, comissaoMl: 18, frete: 12, taxaFixa: 3, impostoPercentual: 0.04, impostoValor: 6,
      precoPromocionalAtivo: false,
    }, JSON.stringify(res.corpo.composicao));
    ok("incluirComposicao=1 + margem projetada: ladder completo, incluindo taxa fixa (só existe do lado projetado)");
  });

  // 14. Item NÃO computável (nem realizada nem projetada — ex. UNVALIDATED):
  //     composicao fica de fora, o front cai no statusLabel/statusReasons
  //     de sempre. Nunca uma composição parcial.
  await withMockDb(UMA_CONTA, async () => {
    reset();
    metricasHandler = () => ({});
    margemHandler = () => ({
      itens: [itemDeMargem({
        itemId: "MLB-U1", realizedComputable: false, projectedComputable: false, projectedMargin: null,
        status: "UNVALIDATED", statusLabel: "Não validado", statusReasons: ["Variáveis obrigatórias ausentes: custo."],
      })],
    });

    const res = fakeRes();
    await ctrl.performance({ query: { clienteSlug: "cliente-a", itemIds: "MLB-U1", incluirComposicao: "1" } }, res);

    assert.strictEqual(res.corpo.margem["MLB-U1"].statusLabel, "Não validado");
    assert.strictEqual(res.corpo.composicao["MLB-U1"], undefined, "item não-computável não pode ter composição, nem parcial");
    ok("item não-computável (UNVALIDATED): composicao fica de fora — sem número, sem estimativa, só o rótulo real do Motor");
  });

  // 15. incluirComposicao ausente (default "0"): composicao vem vazia mesmo
  //     com item perfeitamente computável — é opt-in, ao contrário de
  //     incluirMetricas/incluirMargem.
  await withMockDb(UMA_CONTA, async () => {
    reset();
    metricasHandler = () => ({});
    margemHandler = () => ({
      itens: [itemDeMargem({
        itemId: "MLB-R2", realizedComputable: true, realizedMargin: 0.30, status: "HEALTHY", statusLabel: "Saudável",
        composicao: { vendaRealizada: 100, custoRealizado: 50, impostoRealizado: 0.05, comissaoRealizada: 10, freteRealizado: 5 },
      })],
    });

    const res = fakeRes();
    await ctrl.performance({ query: { clienteSlug: "cliente-a", itemIds: "MLB-R2" } }, res);

    assert.strictEqual(res.corpo.margem["MLB-R2"].marginPercent, 30, "margem continua vindo normalmente");
    assert.deepStrictEqual(res.corpo.composicao, {}, "composicao é opt-in — sem incluirComposicao=1, fica sempre vazia");
    ok("incluirComposicao ausente: default desligado (opt-in), composicao vazia mesmo com item computável");
  });

  // 16. incluirComposicao=1 mas incluirMargem=0: composicao depende de
  //     margem ter sido buscada — sem margem, não tem o que decompor.
  await withMockDb(UMA_CONTA, async () => {
    reset();
    metricasHandler = () => ({ "MLB-R3": { views: 10, vendas: 1, conversao: 10 } });
    margemHandler = () => ({
      itens: [itemDeMargem({
        itemId: "MLB-R3", realizedComputable: true, realizedMargin: 0.30, status: "HEALTHY", statusLabel: "Saudável",
        composicao: { vendaRealizada: 100, custoRealizado: 50, impostoRealizado: 0.05, comissaoRealizada: 10, freteRealizado: 5 },
      })],
    });

    const res = fakeRes();
    await ctrl.performance({ query: { clienteSlug: "cliente-a", itemIds: "MLB-R3", incluirMargem: "0", incluirComposicao: "1" } }, res);

    assert.deepStrictEqual(res.corpo.margem, {}, "margem desligada continua vazia");
    assert.deepStrictEqual(res.corpo.composicao, {}, "composicao sem margem não tem o que decompor — fica vazia também");
    assert.strictEqual(chamadasMargem.length, 0, "o Motor de Margem não pode ser chamado quando incluirMargem=0, mesmo pedindo composicao");
    ok("incluirComposicao=1 com incluirMargem=0: composicao vazia, Motor de Margem não é chamado");
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
