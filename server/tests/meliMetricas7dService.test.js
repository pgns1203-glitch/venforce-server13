// server/tests/meliMetricas7dService.test.js
//
// Métricas "últ. 7 dias" (views/vendas/conversão) da tela de Anúncios ML —
// server/services/meliAnuncios/meliMetricas7dService.js.
//
// O que este teste protege:
//
//  1. vendas reaproveita o MESMO padrão de metricasService (orders/search,
//     agregado por item_id) — NUNCA sold_quantity acumulado, e SÓ 1 chamada
//     de pedidos cobre o lote inteiro (não é 1 por item);
//  2. views é 1 chamada por item (não existe endpoint em lote por item na
//     API do ML) — e a falha de UM item não derruba os outros;
//  3. conversão nunca é NaN/Infinity: "—" (null) quando views é 0/nulo,
//     número real (inclusive 0%) quando dá para calcular;
//  4. vendas=0 real (pedidos buscados com sucesso, nenhum bateu) é diferente
//     de vendas=null (a busca de pedidos falhou por completo) — só o
//     primeiro é "fato", o segundo é "não sei";
//  5. régua de custo de integração: exatamente 1 chamada a orders/search por
//     lote, e exatamente N chamadas a visits/time_window (N = itemIds
//     únicos pedidos) — nunca mais que isso.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const Module = require("module");

let mlChamadas = [];
let mlHandler = null;

const originalLoad = Module._load;
Module._load = function loadWithMlFetchStub(request, parent, isMain) {
  if (request === "../../utils/mlClient" || request === "../utils/mlClient") {
    return {
      async mlFetch(clienteId, path, options = {}) {
        const chamada = { clienteId, path, mlUserId: options.mlUserId };
        mlChamadas.push(chamada);
        return mlHandler ? mlHandler(chamada) : { ok: true, status: 200, data: {} };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const metricas7d = require("../services/meliAnuncios/meliMetricas7dService");

Module._load = originalLoad;

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

function ordersHandler(orders) {
  return (chamada) => {
    if (!chamada.path.startsWith("/orders/search")) return undefined;
    return { ok: true, status: 200, data: { results: orders, paging: { total: orders.length } } };
  };
}

function combinarHandlers(...handlers) {
  return (chamada) => {
    for (const h of handlers) {
      const r = h(chamada);
      if (r !== undefined) return r;
    }
    return { ok: true, status: 200, data: {} };
  };
}

// Views individuais por item, via mapa {itemId: total_visits | "falha"}.
function visitasHandler(mapa) {
  return (chamada) => {
    if (!chamada.path.includes("/visits/time_window")) return undefined;
    const itemId = chamada.path.split("/")[2];
    if (!(itemId in mapa)) return { ok: true, status: 200, data: {} };
    if (mapa[itemId] === "falha") return { ok: false, status: 500, data: null };
    return { ok: true, status: 200, data: { total_visits: mapa[itemId] } };
  };
}

async function run() {
  // 1. Vendas: agrega por item_id, soma quantidade de múltiplos order_items,
  //    ignora item fora do conjunto pedido, e usa 1 SÓ chamada de pedidos.
  {
    mlChamadas = [];
    const orders = [
      { order_items: [{ item: { id: "MLB-A" }, quantity: 2 }] },
      { order_items: [{ item: { id: "MLB-A" }, quantity: 1 }, { item: { id: "MLB-B" }, quantity: 3 }] },
      { order_items: [{ item: { id: "MLB-FORA" }, quantity: 99 }] }, // não pedido — tem de ser ignorado
    ];
    mlHandler = ordersHandler(orders);

    const r = await metricas7d.buscarVendas7dPorItens({
      clienteId: 1, mlUserId: "111", itemIds: ["MLB-A", "MLB-B"],
    });

    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.porItem["MLB-A"], 3, "2 + 1 = 3");
    assert.strictEqual(r.porItem["MLB-B"], 3);
    assert.strictEqual(r.porItem["MLB-FORA"], undefined, "item fora do lote pedido não pode aparecer no resultado");
    const buscasPedidos = mlChamadas.filter((c) => c.path.startsWith("/orders/search"));
    assert.strictEqual(buscasPedidos.length, 1, "1 busca de pedidos cobre o lote inteiro — não é 1 por item");
    ok("vendas: agrega por item_id, soma order_items, ignora item fora do lote, 1 única chamada de pedidos");
  }

  // 2. Vendas: busca de pedidos falha por completo -> ok:false, nenhum item
  //    pode afirmar "vendeu 0" (não sabemos).
  {
    mlChamadas = [];
    mlHandler = () => { throw new Error("Falha de rede"); };
    const r = await metricas7d.buscarVendas7dPorItens({
      clienteId: 1, mlUserId: "111", itemIds: ["MLB-A"],
    });
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.porItem, {});
    ok("vendas: falha da busca inteira vira ok:false — nenhum item recebe um 0 que seria mentira");
  }

  // 3. Views: 1 chamada por item, path/params corretos, agregação correta.
  {
    mlChamadas = [];
    mlHandler = visitasHandler({ "MLB-A": 100, "MLB-B": 50 });
    const r = await metricas7d.buscarVisitas7dPorItens({
      clienteId: 1, mlUserId: "111", itemIds: ["MLB-A", "MLB-B"],
    });
    assert.strictEqual(r["MLB-A"], 100);
    assert.strictEqual(r["MLB-B"], 50);
    const chamadasVisitas = mlChamadas.filter((c) => c.path.includes("/visits/time_window"));
    assert.strictEqual(chamadasVisitas.length, 2, "exatamente 1 chamada por item, nem uma a mais");
    assert.ok(
      chamadasVisitas.every((c) => c.path.includes("last=7") && c.path.includes("unit=day")),
      "janela tem de ser últimos 7 dias, unidade dia"
    );
    ok("views: 1 chamada por item, janela de 7 dias, agregação correta");
  }

  // 4. Views: falha de 1 item não derruba os outros.
  {
    mlChamadas = [];
    mlHandler = visitasHandler({ "MLB-A": 100, "MLB-B": "falha", "MLB-C": 30 });
    const r = await metricas7d.buscarVisitas7dPorItens({
      clienteId: 1, mlUserId: "111", itemIds: ["MLB-A", "MLB-B", "MLB-C"],
    });
    assert.strictEqual(r["MLB-A"], 100);
    assert.strictEqual(r["MLB-B"], null, "falha isolada vira null, nunca derruba o lote");
    assert.strictEqual(r["MLB-C"], 30, "os outros itens do lote continuam corretos");
    ok("views: falha isolada de 1 item vira null e não afeta os demais");
  }

  // 5. montarMetricas7d: junta os dois lados e calcula conversão — nunca
  //    NaN/Infinity, "—" (null) só quando não dá pra calcular de verdade.
  {
    mlChamadas = [];
    const orders = [
      { order_items: [{ item: { id: "MLB-A" }, quantity: 3 }] }, // 3 vendas, 100 views -> 3.0%
      // MLB-B: 0 vendas reais (não aparece nos pedidos)
      // MLB-C: sem views (falha)
    ];
    mlHandler = combinarHandlers(
      ordersHandler(orders),
      visitasHandler({ "MLB-A": 100, "MLB-B": 0, "MLB-C": "falha" })
    );

    const r = await metricas7d.montarMetricas7d({
      clienteId: 1, mlUserId: "111", itemIds: ["MLB-A", "MLB-B", "MLB-C"],
    });

    assert.strictEqual(r["MLB-A"].views, 100);
    assert.strictEqual(r["MLB-A"].vendas, 3);
    assert.strictEqual(r["MLB-A"].conversao, 3, "3/100 = 3.0%");

    assert.strictEqual(r["MLB-B"].views, 0);
    assert.strictEqual(r["MLB-B"].vendas, 0, "0 pedidos no período é fato, não ausência de dado");
    assert.strictEqual(r["MLB-B"].conversao, null, "views=0 -> conversão é '—', nunca divisão por zero");

    assert.strictEqual(r["MLB-C"].views, null, "falha na visita vira null");
    assert.strictEqual(r["MLB-C"].vendas, 0);
    assert.strictEqual(r["MLB-C"].conversao, null, "sem views não dá pra calcular conversão");

    for (const itemId of Object.keys(r)) {
      assert.ok(!Number.isNaN(r[itemId].conversao), `conversao de ${itemId} nunca pode ser NaN`);
      if (r[itemId].conversao !== null) assert.ok(Number.isFinite(r[itemId].conversao));
    }
    ok("montarMetricas7d: conversão real quando dá, '—' quando não dá — nunca NaN/Infinity");
  }

  // 6. calcularConversao isolado: os casos de borda.
  assert.strictEqual(metricas7d.calcularConversao(0, 10), 0, "0 vendas com views>0 é 0%, um número real");
  assert.strictEqual(metricas7d.calcularConversao(5, 0), null);
  assert.strictEqual(metricas7d.calcularConversao(5, null), null);
  assert.strictEqual(metricas7d.calcularConversao(null, 10), null);
  ok("calcularConversao: 0% é um número válido, '—' só quando views é 0/nulo ou vendas é desconhecido");

  // 7. itemIds duplicados: dedup, sem gastar chamada em dobro.
  {
    mlChamadas = [];
    mlHandler = visitasHandler({ "MLB-A": 10 });
    const r = await metricas7d.buscarVisitas7dPorItens({
      clienteId: 1, mlUserId: "111", itemIds: ["MLB-A", "MLB-A", "MLB-A"],
    });
    assert.strictEqual(r["MLB-A"], 10);
    const chamadasVisitas = mlChamadas.filter((c) => c.path.includes("/visits/time_window"));
    assert.strictEqual(chamadasVisitas.length, 1, "item repetido não pode gastar chamada em dobro");
    ok("itemIds duplicados são deduplicados antes de chamar o Mercado Livre");
  }

  // 8. Lote vazio: nenhuma chamada ao ML.
  {
    mlChamadas = [];
    const vendas = await metricas7d.buscarVendas7dPorItens({ clienteId: 1, mlUserId: "111", itemIds: [] });
    const views = await metricas7d.buscarVisitas7dPorItens({ clienteId: 1, mlUserId: "111", itemIds: [] });
    assert.deepStrictEqual(vendas, { ok: true, porItem: {} });
    assert.deepStrictEqual(views, {});
    assert.strictEqual(mlChamadas.length, 0, "lote vazio não pode gastar chamada nenhuma");
    ok("lote vazio: zero chamadas ao Mercado Livre");
  }
}

run()
  .then(() => {
    console.log(`\n✓ ${checks} verificações de métricas últ. 7 dias`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n✗ FALHOU:", err.message);
    console.error(err.stack);
    process.exit(1);
  });
