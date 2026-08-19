// server/tests/centralVendasOrdersCompleteness.test.js
//
// M3 da fundação V3 da Central de Vendas — completude da Orders API.
// Cobre o novo contrato de fetchAllOrders: {data, completeness}. Nunca mais
// pode terminar com sucesso silencioso quando paging.total não foi coberto.
//
// Estuba mlFetch via Module._load (mesma técnica de
// centralVendasSyncRuns.test.js) porque centralVendasSyncService destrutura
// `mlFetch` em tempo de require — não dá para stubar depois.

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

// `paginas` é um array de respostas cruas { results, total } na ordem em que
// devem ser servidas (uma por chamada a /orders/search). Se as páginas
// acabarem antes do loop parar, a última é repetida (evita crash em testes
// que precisam de muitas páginas idênticas, como o teto de segurança).
function carregarComPaginas(paginas) {
  const originalLoad = Module._load;
  let chamada = 0;
  Module._load = function loadWithStub(request, parent, isMain) {
    if (request === "../../utils/mlClient") {
      return {
        async mlFetch(_clienteId, path) {
          if (!path.startsWith("/orders/search")) return { ok: true, status: 200, data: {} };
          const pagina = paginas[Math.min(chamada, paginas.length - 1)];
          chamada += 1;
          if (pagina.erro) return { ok: false, status: pagina.status || 500, data: null };
          return { ok: true, status: 200, data: { results: pagina.results, paging: { total: pagina.total } } };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve("../services/centralVendas/centralVendasSyncService")];
    return require("../services/centralVendas/centralVendasSyncService");
  } finally {
    Module._load = originalLoad;
  }
}

function order(id) {
  return { id, date_created: "2026-08-10T10:00:00.000-03:00", order_items: [] };
}

function paginaDe(ids, total) {
  return { results: ids.map(order), total };
}

async function run() {
  // 1. total=0, received=0 → complete.
  {
    const svc = carregarComPaginas([{ results: [], total: 0 }]);
    const { data, completeness } = await svc.fetchAllOrders(1, "seller1", "2026-08-01", "2026-08-31");
    eq("1: data vazio", data.length, 0);
    ok("1: complete=true", completeness.complete === true);
    eq("1: expected", completeness.expectedCount, 0);
    eq("1: received", completeness.receivedCount, 0);
    ok("1: reason null", completeness.reason === null);
  }

  // 2. total=50, received=50 (uma página) → complete.
  {
    const ids = Array.from({ length: 50 }, (_, i) => 1000 + i);
    const svc = carregarComPaginas([paginaDe(ids, 50)]);
    const { data, completeness } = await svc.fetchAllOrders(1, "seller1", "2026-08-01", "2026-08-31");
    eq("2: received", data.length, 50);
    ok("2: complete=true", completeness.complete === true);
    eq("2: pagesReceived", completeness.pagesReceived, 1);
  }

  // 3. total=587, múltiplas páginas → complete.
  {
    const paginas = [];
    for (let offset = 0; offset < 587; offset += 50) {
      const tamanho = Math.min(50, 587 - offset);
      const ids = Array.from({ length: tamanho }, (_, i) => offset + i);
      paginas.push(paginaDe(ids, 587));
    }
    const svc = carregarComPaginas(paginas);
    const { data, completeness } = await svc.fetchAllOrders(1, "seller1", "2026-08-01", "2026-08-31");
    eq("3: received", data.length, 587);
    ok("3: complete=true", completeness.complete === true);
    eq("3: pagesReceived", completeness.pagesReceived, 12);
  }

  // 4. total=5000, received=5000 (exatamente no teto) → complete, NUNCA truncado.
  {
    const paginas = [];
    for (let offset = 0; offset < 5000; offset += 50) {
      const ids = Array.from({ length: 50 }, (_, i) => offset + i);
      paginas.push(paginaDe(ids, 5000));
    }
    const svc = carregarComPaginas(paginas);
    const { data, completeness } = await svc.fetchAllOrders(1, "seller1", "2026-08-01", "2026-08-31");
    eq("4: received", data.length, 5000);
    ok("4: complete=true", completeness.complete === true);
    ok("4: truncated=false", completeness.truncated === false);
  }

  // 5. total=5001, cap=5000 → incomplete/truncated (ORDERS_TRUNCATED_BY_SAFETY_LIMIT).
  {
    const pagina = paginaDe(Array.from({ length: 50 }, (_, i) => i), 5001);
    // Repete a mesma página (100 chamadas — teto MAX_PAGINAS) para simular
    // um universo maior do que o teto de segurança sem gerar 5001 fixtures.
    const svc = carregarComPaginas([pagina]);
    const { data, completeness } = await svc.fetchAllOrders(1, "seller1", "2026-08-01", "2026-08-31");
    // Cada página devolve os MESMOS 50 ids (dedupe) — então receivedCount real
    // fica em 50, mas o que importa aqui é: nunca "complete", sempre truncado.
    ok("5: complete=false", completeness.complete === false);
    ok("5: truncated=true", completeness.truncated === true);
    eq("5: reason", completeness.reason, "ORDERS_TRUNCATED_BY_SAFETY_LIMIT");
    eq("5: expected preserva 5001 (nunca reescreve o total pro que foi coletado)", completeness.expectedCount, 5001);
    ok("5: data nao e usado para provar cobertura", Array.isArray(data));
  }

  // 6. total=7300, received=5000 (cap) → incomplete, expected preserva 7300.
  {
    const paginas = [];
    for (let offset = 0; offset < 5000; offset += 50) {
      const ids = Array.from({ length: 50 }, (_, i) => offset + i);
      paginas.push(paginaDe(ids, 7300));
    }
    const svc = carregarComPaginas(paginas);
    const { data, completeness } = await svc.fetchAllOrders(1, "seller1", "2026-08-01", "2026-08-31");
    eq("6: received (cap)", data.length, 5000);
    eq("6: expected preservado", completeness.expectedCount, 7300);
    ok("6: complete=false", completeness.complete === false);
    eq("6: reason", completeness.reason, "ORDERS_TRUNCATED_BY_SAFETY_LIMIT");
  }

  // 7. Página vazia antes do total → incomplete (ORDERS_EARLY_EMPTY_PAGE).
  {
    const svc = carregarComPaginas([
      paginaDe(Array.from({ length: 50 }, (_, i) => i), 1000),
      paginaDe(Array.from({ length: 50 }, (_, i) => 50 + i), 1000),
      { results: [], total: 1000 }, // página vazia com só 100/1000 recebidos
    ]);
    const { data, completeness } = await svc.fetchAllOrders(1, "seller1", "2026-08-01", "2026-08-31");
    eq("7: received", data.length, 100);
    ok("7: complete=false", completeness.complete === false);
    eq("7: reason", completeness.reason, "ORDERS_EARLY_EMPTY_PAGE");
  }

  // 8. Contagem final diferente do total (sem página vazia explícita) → incomplete.
  // Página curta (40 itens, limit=50) mas offset (50) já alcança o total (50)
  // reportado — o loop encerra por offset>=total, nunca por página vazia. A
  // comparação final (received=40 vs expected=50) é quem pega a divergência.
  {
    const svc = carregarComPaginas([paginaDe(Array.from({ length: 40 }, (_, i) => i), 50)]);
    const { completeness } = await svc.fetchAllOrders(1, "seller1", "2026-08-01", "2026-08-31");
    ok("8: complete=false", completeness.complete === false);
    eq("8: reason", completeness.reason, "ORDERS_COUNT_MISMATCH");
  }

  // 9. Duplicata entre páginas → dedupe + metadata. Páginas precisam ter
  // PAGE_LIMIT(50) itens cheios (como a API real) para o offset não pular a
  // segunda página — só a última página pode ser curta.
  {
    const pagina1 = Array.from({ length: 50 }, (_, i) => i); // 0..49
    const pagina2 = Array.from({ length: 50 }, (_, i) => 49 + i); // 49..98 (id 49 repetido)
    const svc = carregarComPaginas([paginaDe(pagina1, 99), paginaDe(pagina2, 99)]);
    const { data, completeness } = await svc.fetchAllOrders(1, "seller1", "2026-08-01", "2026-08-31");
    eq("9: unicos", data.length, 99);
    eq("9: receivedRaw", completeness.receivedRaw, 100);
    eq("9: duplicateCount", completeness.duplicateCount, 1);
    ok("9: complete=true", completeness.complete === true);
  }

  // 10. HTTP error na Orders API → lança, nunca devolve sucesso parcial.
  {
    const svc = carregarComPaginas([{ erro: true, status: 500 }]);
    let lancou = false;
    try {
      await svc.fetchAllOrders(1, "seller1", "2026-08-01", "2026-08-31");
    } catch (err) {
      lancou = true;
      ok("10: mlStatus preservado", err.mlStatus === 500);
      ok("10: code ORDERS_HTTP_ERROR", err.code === "ORDERS_HTTP_ERROR");
    }
    ok("10: lancou", lancou);
  }

  // computeBaseStats — cobertura de custo por MLB único nos pedidos.
  {
    const svc = carregarComPaginas([{ results: [], total: 0 }]);
    const orders = [
      { order_items: [{ item: { id: "MLB1" } }, { item: { id: "MLB2" } }] },
      { order_items: [{ item: { id: "MLB1" } }] },
    ];
    const costMap = svc.buildCostMap([
      { produto_id: "MLB1", custo_produto: 10, imposto_percentual: 5 },
    ]);
    const stats = svc.computeBaseStats(orders, costMap);
    eq("base: itemsInOrders", stats.itemsInOrders, 2);
    eq("base: itemsMatched", stats.itemsMatched, 1);
    eq("base: itemsMissingCost", stats.itemsMissingCost, 1);
    eq("base: itemsMissingTax", stats.itemsMissingTax, 1);
  }

  console.log(`centralVendasOrdersCompleteness.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
