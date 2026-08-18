// Prova o gateway ML da Central de Gestao Full: mlUserId/clienteId
// obrigatorios em toda chamada, construcao/encoding correto de path e
// querystring por endpoint, desembrulho do envelope de multiget, retry
// integrado (429->200) e ausencia de retry em 404 — tudo com um
// `requestFn` falso, nunca rede real.

const assert = require("assert");
const { createFullMlGateway, MULTIGET_MAX_IDS } = require("../services/full/fullMlGateway");

function instantSleep() {
  return async () => {};
}

function makeGateway({ responses, sleepFn = instantSleep() } = {}) {
  const calls = [];
  let index = 0;
  const requestFn = async (clienteId, path, options) => {
    calls.push({ clienteId, path, options });
    const response = Array.isArray(responses) ? responses[Math.min(index, responses.length - 1)] : responses;
    index += 1;
    return response;
  };
  const gateway = createFullMlGateway({ requestFn, sleepFn, randomFn: () => 0.5 });
  return { gateway, calls };
}

const okResponse = (data) => ({ ok: true, status: 200, data, retryAfter: null });

async function run() {
  // mlUserId e clienteId sao obrigatorios em toda chamada
  {
    const { gateway } = makeGateway({ responses: okResponse({}) });
    await assert.rejects(
      () => gateway.searchFullItems({ clienteId: 1, mlUserId: null, sellerId: "S1" }),
      TypeError
    );
    await assert.rejects(
      () => gateway.searchFullItems({ clienteId: null, mlUserId: "U1", sellerId: "S1" }),
      TypeError
    );
    await assert.rejects(
      () => gateway.getInventoryStock({ clienteId: 1, mlUserId: "", inventoryId: "INV-1" }),
      TypeError
    );
    console.log("  ✓ mlUserId e clienteId sao obrigatorios em toda chamada (sem grant implicito)");
  }

  // searchFullItems: path/query sem scrollId
  {
    const { gateway, calls } = makeGateway({ responses: okResponse({ results: ["MLB1", "MLB2"], scroll_id: "CURSOR-1" }) });
    const result = await gateway.searchFullItems({ clienteId: 1, mlUserId: "U1", sellerId: "384324657" });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].options.mlUserId, "U1");
    const path = calls[0].path;
    assert.ok(path.startsWith("/users/384324657/items/search?"));
    assert.ok(path.includes("logistic_type=fulfillment"));
    assert.ok(path.includes("search_type=scan"));
    assert.ok(path.includes("limit=100"));
    assert.ok(!path.includes("scroll_id="));

    assert.deepStrictEqual(result.ids, ["MLB1", "MLB2"]);
    assert.strictEqual(result.nextCursor, "CURSOR-1");
    console.log("  ✓ searchFullItems monta o path/query correto sem scrollId e mapeia results/scroll_id");
  }

  // searchFullItems: com scrollId e sellerId com caractere especial (encoding)
  {
    const { gateway, calls } = makeGateway({ responses: okResponse({ results: [], scroll_id: null }) });
    await gateway.searchFullItems({ clienteId: 1, mlUserId: "U1", sellerId: "seller com espaco", scrollId: "ABC&123" });
    const path = calls[0].path;
    assert.ok(path.startsWith("/users/seller%20com%20espaco/items/search?"));
    assert.ok(path.includes(`scroll_id=${encodeURIComponent("ABC&123")}`));
    console.log("  ✓ searchFullItems escapa sellerId/scrollId corretamente");
  }

  // multigetItems: desembrulha {code, body}, separa erros, exige mlUserId e limite de 20
  {
    const { gateway, calls } = makeGateway({
      responses: okResponse([
        { code: 200, body: { id: "MLB1" } },
        { code: 404, body: { id: "MLB2" } },
        { code: 200, body: { id: "MLB3" } },
      ]),
    });

    const result = await gateway.multigetItems({ clienteId: 1, mlUserId: "U1", ids: ["MLB1", "MLB2", "MLB3"] });
    assert.strictEqual(calls[0].path, "/items?ids=MLB1,MLB2,MLB3");
    assert.strictEqual(result.items.length, 2);
    assert.deepStrictEqual(result.items.map((i) => i.id), ["MLB1", "MLB3"]);
    assert.strictEqual(result.itemErrors.length, 1);
    assert.strictEqual(result.itemErrors[0].id, "MLB2");
    assert.strictEqual(result.itemErrors[0].code, 404);

    await assert.rejects(() => gateway.multigetItems({ clienteId: 1, mlUserId: "U1", ids: [] }), TypeError);
    const tooMany = Array.from({ length: MULTIGET_MAX_IDS + 1 }, (_, i) => `MLB${i}`);
    await assert.rejects(() => gateway.multigetItems({ clienteId: 1, mlUserId: "U1", ids: tooMany }), TypeError);
    console.log("  ✓ multigetItems desembrulha o envelope code/body, separa erros e respeita o maximo de 20 ids");
  }

  // getInventoryStock: path correto com encoding
  {
    const { gateway, calls } = makeGateway({ responses: okResponse({ total: { total: 10 } }) });
    await gateway.getInventoryStock({ clienteId: 1, mlUserId: "U1", inventoryId: "INV/COM/BARRA" });
    assert.strictEqual(
      calls[0].path,
      `/inventories/${encodeURIComponent("INV/COM/BARRA")}/stock/fulfillment?include_attributes=conditions`
    );
    console.log("  ✓ getInventoryStock monta o path correto com inventoryId escapado");
  }

  // searchStockOperations: query real gerada -- [FIX] a documentacao oficial
  // de GET /stock/fulfillment/operations/search usa `inventory_id` no
  // singular (lista separada por virgula); `inventory_ids` (plural) nao
  // existe na API real e a ML responde 400 "The field inventory_id is
  // required" -- confirmado ao vivo contra a API antes desta correcao.
  {
    const { gateway, calls } = makeGateway({ responses: okResponse({ results: [{ id: "OP1" }], scroll: "SCR-1" }) });
    const result = await gateway.searchStockOperations({
      clienteId: 1,
      mlUserId: "U1",
      sellerId: "S1",
      inventoryIds: ["INV-1", "INV-2"],
      dateFrom: "2026-08-01",
      dateTo: "2026-08-14",
      scroll: "SCROLL-ANTERIOR",
      limit: 500,
    });

    const path = calls[0].path;
    assert.ok(path.startsWith("/stock/fulfillment/operations/search?"));
    const query = new URLSearchParams(path.split("?")[1]);
    assert.strictEqual(query.get("inventory_id"), "INV-1,INV-2", "deve enviar inventory_id (singular) com a lista separada por virgula");
    assert.strictEqual(query.has("inventory_ids"), false, "inventory_ids (plural) nunca deve ser enviado -- nao existe na API real");
    assert.strictEqual(query.get("seller_id"), "S1");
    assert.strictEqual(query.get("date_from"), "2026-08-01");
    assert.strictEqual(query.get("date_to"), "2026-08-14");
    assert.strictEqual(query.get("limit"), "500");
    assert.strictEqual(query.get("scroll"), "SCROLL-ANTERIOR");
    assert.deepStrictEqual(result.operations, [{ id: "OP1" }]);
    assert.strictEqual(result.nextCursor, "SCR-1");

    // limit default (1000) e nenhum parametro scroll quando e a primeira pagina
    const { gateway: gatewayPrimeiraPagina, calls: callsPrimeiraPagina } = makeGateway({ responses: okResponse({ results: [], scroll: null }) });
    await gatewayPrimeiraPagina.searchStockOperations({
      clienteId: 1,
      mlUserId: "U1",
      sellerId: "S1",
      inventoryIds: ["INV-1"],
      dateFrom: "2026-08-01",
      dateTo: "2026-08-14",
    });
    const queryPrimeiraPagina = new URLSearchParams(callsPrimeiraPagina[0].path.split("?")[1]);
    assert.strictEqual(queryPrimeiraPagina.get("limit"), "1000");
    assert.strictEqual(queryPrimeiraPagina.has("scroll"), false, "sem scroll informado (primeira pagina), o parametro nao deve ser enviado");

    await assert.rejects(
      () => gateway.searchStockOperations({ clienteId: 1, mlUserId: "U1", sellerId: "S1", inventoryIds: [], dateFrom: "a", dateTo: "b" }),
      TypeError
    );
    await assert.rejects(
      () => gateway.searchStockOperations({ clienteId: 1, mlUserId: "U1", sellerId: "S1", inventoryIds: ["INV-1"], dateFrom: null, dateTo: "b" }),
      TypeError
    );
    console.log("  ✓ searchStockOperations monta a query real com inventory_id (singular) e preserva seller_id/date_from/date_to/limit/scroll");
  }

  // getStockOperationDetail: path com encoding, uso pontual
  {
    const { gateway, calls } = makeGateway({ responses: okResponse({ id: "OP-1" }) });
    await gateway.getStockOperationDetail({ clienteId: 1, mlUserId: "U1", operationId: "OP 1" });
    assert.strictEqual(calls[0].path, `/stock/fulfillment/operations/${encodeURIComponent("OP 1")}`);
    console.log("  ✓ getStockOperationDetail monta o path correto com operationId escapado");
  }

  // Retry integrado: 429 -> 200 recupera com sleep injetado (sem rede/tempo real)
  {
    const sleeps = [];
    const responses = [
      { ok: false, status: 429, data: null, retryAfter: null },
      okResponse({ results: ["MLB1"], scroll_id: null }),
    ];
    const { gateway, calls } = makeGateway({ responses, sleepFn: async (ms) => sleeps.push(ms) });

    const result = await gateway.searchFullItems({ clienteId: 1, mlUserId: "U1", sellerId: "S1" });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.attempts, 2);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(sleeps.length, 1);
    console.log("  ✓ 429 seguido de 200 e recuperado pelo retry integrado do gateway");
  }

  // Sem retry em 404: uma unica chamada, mesmo com orcamento de tentativas
  {
    const { gateway, calls } = makeGateway({
      responses: { ok: false, status: 404, data: null, retryAfter: null },
      sleepFn: async () => { throw new Error("nao deveria dormir em 404"); },
    });
    const result = await gateway.getInventoryStock({ clienteId: 1, mlUserId: "U1", inventoryId: "INV-404" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 404);
    assert.strictEqual(result.attempts, 1);
    assert.strictEqual(calls.length, 1);
    console.log("  ✓ 404 nao e retentado pelo gateway");
  }

  console.log("fullMlGateway.test.js passed");
}

run();
