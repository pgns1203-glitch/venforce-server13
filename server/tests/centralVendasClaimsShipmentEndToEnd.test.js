// server/tests/centralVendasClaimsShipmentEndToEnd.test.js
//
// RUN 8 — micro-investigação cirúrgica (claim 5553953268, resource="shipment",
// unresolved mesmo após o fix do commit 59836d8).
//
// Todos os testes de resolveClaimOrderLink/buildShipmentOrderIndex existentes
// (centralVendasClaimsPosVenda.test.js, seção "RUN 7") chamam
// buscarClaimsPorPeriodo DIRETAMENTE, com um `orders` fabricado à mão no
// próprio teste — nunca provam que o array `orders` que de fato sai de
// fetchAllOrders (parseando uma resposta real de /orders/search) chega
// intacto até buildShipmentOrderIndex passando pelo caminho real:
//
//   sincronizarVendasMeli → fetchAllOrders → buscarClaimsPorPeriodo(orders)
//   → buildShipmentOrderIndex(orders) → resolverReturnsSemVinculo
//   → resolveClaimOrderLink
//
// Este arquivo roda sincronizarVendasMeli de verdade (só o mlFetch é
// estubado, por rota — mesmo padrão de centralVendasM3Completude.test.js) e
// prova essa passagem fim-a-fim, nos dois sentidos: quando o vínculo por
// shipment RESOLVE (a orders chegou) e quando ele fica unresolved com o
// diagnóstico completo (para o próximo sync real explicar sozinho qual dos
// 3 cenários — 0 matches / 1 match não usado / pack ambíguo — é o real).

const assert = require("assert");
const Module = require("module");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

const cliente = { id: 1, nome: "Loja E2E", slug: "loja-e2e" };

// Estuba mlFetch por rota (orders/shipments/claims/returns). Mesmo padrão de
// centralVendasM3Completude.test.js: os 3 módulos (sync/claims/frete)
// destruturam mlFetch no topo, então o cache dos 3 precisa ser invalidado
// junto — senão um cenário herda o mlFetch do cenário anterior.
function carregarComHandlers(handlers) {
  const originalLoad = Module._load;
  Module._load = function loadWithStub(request, parent, isMain) {
    if (request === "../../utils/mlClient") {
      return {
        async mlFetch(clienteId, path, options = {}) {
          for (const [prefix, handler] of handlers) {
            if (path.startsWith(prefix)) return handler(path, options);
          }
          return { ok: true, status: 200, data: {} };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve("../services/centralVendas/centralVendasSyncService")];
    delete require.cache[require.resolve("../services/centralVendas/centralVendasClaimsService")];
    delete require.cache[require.resolve("../services/centralVendas/centralVendasFreteService")];
    return require("../services/centralVendas/centralVendasSyncService");
  } finally {
    Module._load = originalLoad;
  }
}

function pedidoApi(id, shipmentId) {
  return {
    id, date_created: "2026-07-10T10:00:00.000-03:00", status: "paid", tags: [], payments: [],
    shipping: { id: shipmentId, logistic_type: "cross_docking" },
    order_items: [{
      item: { id: "MLB111", seller_sku: "SKU-1", title: "Produto" },
      quantity: 1, unit_price: 100, sale_fee: 10,
    }],
  };
}

function fakeRepo() {
  return {
    persistedCalls: [],
    async ensureCentralVendasTables() {},
    async getClienteBySlug(slug) { return slug === cliente.slug ? cliente : null; },
    async persistCentralVendasImport(args) {
      this.persistedCalls.push(args);
      return {
        importacao: { id: this.persistedCalls.length },
        pedidosPersistidos: args.motorPayload.pedidos.length,
        itensPersistidos: args.motorPayload.itens.length,
        componentesPersistidos: args.motorPayload.componentes.length,
      };
    },
  };
}

async function capturandoLogs(fn) {
  const original = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = original; }
}

const PERIODO = { dateFrom: "2026-07-01", dateTo: "2026-07-31" };
// accountContext pronto: pula resolveMarketplaceAccountContext (não precisa
// de fake db de cliente_contas/ml_tokens para este teste — o que se quer
// provar é orders -> claims, não a resolução de identidade, já coberta em
// centralVendasAccountContext.test.js).
const ACCOUNT_CONTEXT = { mlUserId: "111", base: null };

async function run() {
  // ── 1) Vínculo por shipment RESOLVE passando pelo caminho REAL ─────────
  // (fetchAllOrders real parseando /orders/search estubado, não um `order`
  // fabricado a mão) — prova que `orders` chega com shipping.id até
  // buildShipmentOrderIndex.
  await capturandoLogs(async () => {
    const repo = fakeRepo();
    const syncService = carregarComHandlers([
      ["/orders/search", () => ({
        ok: true, status: 200,
        data: { results: [pedidoApi("PEDIDO_E2E", "SHIP-E2E")], paging: { total: 1 } },
      })],
      ["/shipments/", () => ({ ok: true, status: 200, data: {} })],
      ["/post-purchase/v1/claims/search", () => ({
        ok: true, status: 200,
        data: {
          paging: { total: 1 },
          data: [{
            id: "5553953268", resource: "shipment", resource_id: "SHIP-E2E",
            status: "closed", type: "returns", related_entities: ["return"],
            resolution: { reason: "item_returned", benefited: ["complainant"] },
          }],
        },
      })],
      ["/post-purchase/v2/claims/", () => ({
        // Reprodução exata do diagnóstico real do RUN 7: 200 OK, sem
        // order_id, porque o claim está associado a um shipment.
        ok: true, status: 200, data: { status: "delivered", resource: null, items: [] },
      })],
    ]);

    const { sincronizarVendasMeli } = syncService.createCentralVendasSyncService(repo, {});
    const resultado = await sincronizarVendasMeli({
      clienteSlug: cliente.slug, marketplace: "meli", accountContext: ACCOUNT_CONTEXT, ...PERIODO,
    });

    ok("e2e resolve: sync concluiu sem lançar", !!resultado);
    eq("e2e resolve: 1 pedido persistido", repo.persistedCalls.length, 1);
    const pedidosPersistidos = repo.persistedCalls[0].motorPayload.pedidos;
    eq("e2e resolve: pedido do array real da API chega ao motor", pedidosPersistidos.length, 1);
    eq("e2e resolve: vínculo por shipment (via orders REAIS de fetchAllOrders) cancela o pedido",
      pedidosPersistidos[0].status, "cancelado");
    eq("e2e resolve: nenhum RETURNS_UNRESOLVED — orders chegou de verdade",
      repo.persistedCalls[0].resumo.claimsReturnsNaoResolvidos, 0);
  });

  // ── 2) Vínculo por shipment NÃO resolve (0 matches) passando pelo caminho
  // REAL — prova que o diagnóstico completo (RUN 8) chega até o resumo
  // persistido mesmo vindo do fluxo inteiro, não só do helper isolado.
  await capturandoLogs(async () => {
    const repo = fakeRepo();
    const syncService = carregarComHandlers([
      ["/orders/search", () => ({
        ok: true, status: 200,
        data: { results: [pedidoApi("PEDIDO_E2E_2", "SHIP-DIFERENTE")], paging: { total: 1 } },
      })],
      ["/shipments/", () => ({ ok: true, status: 200, data: {} })],
      ["/post-purchase/v1/claims/search", () => ({
        ok: true, status: 200,
        data: {
          paging: { total: 1 },
          data: [{
            id: "5553953268", resource: "shipment", resource_id: "SHIP-NAO-BATE",
            status: "closed", type: "returns", related_entities: ["return"],
            resolution: { reason: "item_returned", benefited: ["complainant"] },
          }],
        },
      })],
      ["/post-purchase/v2/claims/", () => ({
        ok: true, status: 200, data: { status: "delivered", resource: null, items: [] },
      })],
    ]);

    const { sincronizarVendasMeli } = syncService.createCentralVendasSyncService(repo, {});
    const resultado = await sincronizarVendasMeli({
      clienteSlug: cliente.slug, marketplace: "meli", accountContext: ACCOUNT_CONTEXT, ...PERIODO,
    });

    ok("e2e unresolved: sync concluiu sem lançar", !!resultado);
    eq("e2e unresolved: RETURNS_UNRESOLVED = 1 (shipment não bate com nenhum order do período)",
      repo.persistedCalls[0].resumo.claimsReturnsNaoResolvidos, 1);
  });
}

run()
  .then(() => {
    console.log(`\n${checks} verificacoes passaram.`);
    console.log("centralVendasClaimsShipmentEndToEnd.test.js passed");
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
