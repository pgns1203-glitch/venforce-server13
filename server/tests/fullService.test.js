// Prova o orquestrador on-demand da Central de Gestao Full: resolucao de
// conta explicita, N+1 evitado (multiget em lotes de 20, estoque 1
// chamada/inventory, operacoes em lotes), contagem de chamadas em escala
// (30/100/500), single-flight via fullCache, e o ponto mais sensivel do
// plano — falha isolada de estoque ou de um lote de operacoes nunca vira
// zero/SEM_GIRO, so degrada a linha ou o lote afetado.

const assert = require("assert");
const { createFullService } = require("../services/full/fullService");
const { createFullCache } = require("../services/full/fullCache");
const { createFullCommercialAdapter } = require("../services/full/fullCommercialAdapter");

function makeFakeGateway({ totalItems, failStockIds = new Set(), failOperationsBatchIndexes = new Set() } = {}) {
  const calls = { searchFullItems: 0, multigetItems: 0, getInventoryStock: 0, searchStockOperations: 0 };
  const allIds = Array.from({ length: totalItems }, (_, i) => `MLB${i + 1}`);
  let operationsBatchCounter = -1;

  const gateway = {
    async searchFullItems({ scrollId, limit }) {
      calls.searchFullItems += 1;
      const start = scrollId ? Number(scrollId) : 0;
      const end = Math.min(start + limit, allIds.length);
      const page = allIds.slice(start, end);
      const nextCursor = end < allIds.length ? String(end) : null;
      return { ok: true, status: 200, ids: page, nextCursor };
    },

    async multigetItems({ ids }) {
      calls.multigetItems += 1;
      const items = ids.map((id) => ({ id, inventory_id: `INV-${id}` }));
      return { ok: true, status: 200, items, itemErrors: [] };
    },

    async getInventoryStock({ inventoryId }) {
      calls.getInventoryStock += 1;
      if (failStockIds.has(inventoryId)) {
        return { ok: false, status: 500, data: null };
      }
      return { ok: true, status: 200, data: { available_quantity: 10, total: 10, not_available_quantity: 0 } };
    },

    async searchStockOperations({ inventoryIds, dateFrom }) {
      calls.searchStockOperations += 1;
      operationsBatchCounter += 1;
      if (failOperationsBatchIndexes.has(operationsBatchCounter)) {
        return { ok: false, status: 500, data: null };
      }
      const operations = inventoryIds.map((invId) => ({
        id: `OP-${invId}-${dateFrom}`,
        type: "SALE_CONFIRMATION",
        inventory_id: invId,
        date: `${dateFrom}T00:00:00Z`,
        detail: { available_quantity: -2 },
      }));
      return { ok: true, status: 200, operations, nextCursor: null };
    },
  };

  return { gateway, calls };
}

function fakeAccountContext() {
  return async () => ({ cliente: { id: 1 }, mlUserId: "SELLER1", marketplace: "meli" });
}

function run() {
  return (async () => {
    // Coleta basica: contrato completo, sem falhas
    {
      const { gateway } = makeFakeGateway({ totalItems: 3 });
      const service = createFullService({ mlGateway: gateway, resolveAccountContext: fakeAccountContext() });
      const snapshot = await service.buildSnapshot({ clienteContaId: 123, windowDays: 14 });

      assert.strictEqual(snapshot.account.clienteContaId, 123);
      assert.strictEqual(snapshot.account.sellerId, "SELLER1");
      assert.strictEqual(snapshot.quality.status, "complete");
      assert.strictEqual(snapshot.inventories.length, 3);
      assert.strictEqual(snapshot.cache.hit, false);

      const row = snapshot.inventories[0];
      assert.strictEqual(row.stock.available, 10);
      assert.strictEqual(row.stock.status, "ok");
      assert.strictEqual(row.sales.status, "ok");
      console.log("  ✓ coleta basica monta o contrato completo sem falhas (quality=complete)");
    }

    // Falha isolada de estoque: so aquela linha fica unavavailable/SEM_DADO, as demais normais
    {
      const { gateway } = makeFakeGateway({ totalItems: 3, failStockIds: new Set(["INV-MLB2"]) });
      const service = createFullService({ mlGateway: gateway, resolveAccountContext: fakeAccountContext() });
      const snapshot = await service.buildSnapshot({ clienteContaId: 123, windowDays: 14 });

      const bad = snapshot.inventories.find((r) => r.inventoryId === "INV-MLB2");
      const good = snapshot.inventories.find((r) => r.inventoryId === "INV-MLB1");

      assert.strictEqual(bad.stock.status, "unavailable");
      assert.strictEqual(bad.stock.available, null, "estoque indisponivel nunca pode virar 0");
      assert.strictEqual(bad.operationalStatus, "SEM_DADO");
      assert.strictEqual(good.stock.status, "ok");
      assert.notStrictEqual(good.operationalStatus, "SEM_DADO");
      assert.strictEqual(snapshot.quality.sources.stock.status, "partial");
      assert.strictEqual(snapshot.quality.status, "partial");
      console.log("  ✓ falha isolada de um estoque vira SEM_DADO so naquela linha; as demais continuam normais");
    }

    // Falha de um lote de operacoes: inventories daquele lote ficam com vendas indisponiveis, nunca zero/SEM_GIRO
    {
      const { gateway } = makeFakeGateway({ totalItems: 3, failOperationsBatchIndexes: new Set([0]) });
      const service = createFullService({
        mlGateway: gateway,
        resolveAccountContext: fakeAccountContext(),
        config: { ...require("../services/full/fullService").DEFAULT_CONFIG, operationsInventoryBatchSize: 50 },
      });
      const snapshot = await service.buildSnapshot({ clienteContaId: 123, windowDays: 14 });

      for (const row of snapshot.inventories) {
        assert.strictEqual(row.sales.status, "unavailable");
        assert.strictEqual(row.sales.previous7d, null, "operacoes indisponiveis nunca podem virar 0 vendido");
        assert.strictEqual(row.sales.total14d, null);
        assert.notStrictEqual(row.operationalStatus, "SEM_GIRO", "sem dado de operacoes nunca pode virar SEM_GIRO");
        assert.strictEqual(row.operationalStatus, "SEM_DADO");
      }
      assert.strictEqual(snapshot.quality.sources.operations.status, "partial");
      console.log("  ✓ lote de operacoes degradado vira ausencia (nao zero) e nunca gera SEM_GIRO, so SEM_DADO");
    }

    // Single-flight: duas coletas concorrentes para a mesma conta fazem uma unica varredura
    {
      const { gateway, calls } = makeFakeGateway({ totalItems: 5 });
      const cache = createFullCache();
      const service = createFullService({ mlGateway: gateway, resolveAccountContext: fakeAccountContext(), cache });

      const [a, b] = await Promise.all([
        service.buildSnapshot({ clienteContaId: 999, windowDays: 14 }),
        service.buildSnapshot({ clienteContaId: 999, windowDays: 14 }),
      ]);

      assert.strictEqual(calls.multigetItems, 1, "duas coletas concorrentes da mesma conta devem compartilhar uma unica varredura");
      assert.deepStrictEqual(a.inventories.map((r) => r.inventoryId), b.inventories.map((r) => r.inventoryId));
      console.log("  ✓ duas coletas concorrentes da mesma conta compartilham uma unica coleta (single-flight)");
    }

    // Escala: contagem de chamadas segue a formula esperada para 30/100/500 inventarios
    for (const total of [30, 100, 500]) {
      const { gateway, calls } = makeFakeGateway({ totalItems: total });
      const service = createFullService({ mlGateway: gateway, resolveAccountContext: fakeAccountContext() });
      const snapshot = await service.buildSnapshot({ clienteContaId: total, windowDays: 14 });

      const expectedScanCalls = Math.ceil(total / 100); // itemScanPageLimit=100
      const expectedMultiget = Math.ceil(total / 20); // multigetBatchSize=20
      const expectedStock = total; // 1 chamada por inventory distinto, sem batch oficial
      const expectedOperationsBatches = Math.ceil(total / 50); // operationsInventoryBatchSize=50

      assert.strictEqual(snapshot.inventories.length, total);
      assert.strictEqual(calls.searchFullItems, expectedScanCalls, `scan: total=${total}`);
      assert.strictEqual(calls.multigetItems, expectedMultiget, `multiget: total=${total}`);
      assert.strictEqual(calls.getInventoryStock, expectedStock, `estoque: total=${total}`);
      assert.strictEqual(calls.searchStockOperations, expectedOperationsBatches, `operacoes: total=${total}`);
      console.log(
        `  ✓ escala ${total}: scan=${calls.searchFullItems} multiget=${calls.multigetItems} estoque=${calls.getInventoryStock} operacoes=${calls.searchStockOperations} (nenhuma chamada por item isolado)`
      );
    }

    // Resolucao de conta explicita: falha ao resolver a conta propaga (sem grant implicito, sem stale para inventar)
    {
      const { gateway } = makeFakeGateway({ totalItems: 1 });
      const service = createFullService({
        mlGateway: gateway,
        resolveAccountContext: async () => {
          throw Object.assign(new Error("conta nao encontrada"), { code: "CLIENT_ACCOUNT_NOT_FOUND" });
        },
      });
      await assert.rejects(() => service.buildSnapshot({ clienteContaId: 1, windowDays: 14 }), /conta nao encontrada/);
      console.log("  ✓ falha ao resolver a conta explicita propaga, nunca cai para outro grant silenciosamente");
    }

    // Validacao de entrada
    {
      const { gateway } = makeFakeGateway({ totalItems: 1 });
      const service = createFullService({ mlGateway: gateway, resolveAccountContext: fakeAccountContext() });
      await assert.rejects(() => service.buildSnapshot({ clienteContaId: 1, windowDays: 30 }), (err) => err.code === "INVALID_FULL_QUERY");
      await assert.rejects(() => service.buildSnapshot({ clienteContaId: null, windowDays: 14 }), TypeError);
      assert.throws(() => createFullService({ resolveAccountContext: fakeAccountContext() }), TypeError, "mlGateway e obrigatorio");
      assert.throws(() => createFullService({ mlGateway: gateway }), TypeError, "resolveAccountContext e obrigatorio");
      console.log("  ✓ windowDays != 14 e clienteContaId ausente sao rejeitados; dependencias obrigatorias sao exigidas");
    }

    // Product360 operacional: detalhe de um inventory dentro do snapshot ja coletado
    {
      const { gateway } = makeFakeGateway({ totalItems: 2 });
      const service = createFullService({ mlGateway: gateway, resolveAccountContext: fakeAccountContext() });

      const detail = await service.getInventoryDetail({ clienteContaId: 55, windowDays: 14, inventoryId: "INV-MLB1" });
      assert.strictEqual(detail.inventoryId, "INV-MLB1");
      assert.strictEqual(detail.account.clienteContaId, 55);

      await assert.rejects(
        () => service.getInventoryDetail({ clienteContaId: 55, windowDays: 14, inventoryId: "INV-INEXISTENTE" }),
        (err) => err.code === "INVENTORY_NOT_FOUND" && err.statusCode === 404
      );
      console.log("  ✓ getInventoryDetail devolve a linha do snapshot ou INVENTORY_NOT_FOUND (404) sem inventar");
    }

    // Movimentos: servidos do mesmo snapshot cacheado, cursor opaco pagina sem duplicar/pular
    {
      const { gateway, calls } = makeFakeGateway({ totalItems: 1 });
      const service = createFullService({ mlGateway: gateway, resolveAccountContext: fakeAccountContext() });

      const page1 = await service.getInventoryMovements({ clienteContaId: 77, windowDays: 14, inventoryId: "INV-MLB1", limit: 100 });
      assert.strictEqual(page1.salesStatus, "ok");
      assert.ok(page1.movements.length >= 1);
      assert.strictEqual(page1.nextCursor, null, "menos de 100 movimentos cabe em uma pagina, sem proximo cursor");

      const callsAfterFirst = calls.searchStockOperations;
      const page1Again = await service.getInventoryMovements({ clienteContaId: 77, windowDays: 14, inventoryId: "INV-MLB1", limit: 100 });
      assert.strictEqual(calls.searchStockOperations, callsAfterFirst, "movimentos devem vir do snapshot cacheado, nunca uma nova chamada ML por inventario");
      assert.deepStrictEqual(page1Again.movements, page1.movements);

      await assert.rejects(
        () => service.getInventoryMovements({ clienteContaId: 77, windowDays: 14, inventoryId: "INV-INEXISTENTE" }),
        (err) => err.code === "INVENTORY_NOT_FOUND"
      );
      console.log("  ✓ movimentos vem do snapshot ja cacheado (sem nova chamada ML) e inventory inexistente vira 404");
    }

    // Movimentos: inventory degradado (lote de operacoes falhou) reporta ausencia, nao lista vazia enganosa
    {
      const { gateway } = makeFakeGateway({ totalItems: 1, failOperationsBatchIndexes: new Set([0]) });
      const service = createFullService({ mlGateway: gateway, resolveAccountContext: fakeAccountContext() });
      const result = await service.getInventoryMovements({ clienteContaId: 88, windowDays: 14, inventoryId: "INV-MLB1" });
      assert.strictEqual(result.salesStatus, "unavailable", "lote de operacoes degradado deve marcar salesStatus unavailable, nao apenas devolver lista vazia");
      assert.deepStrictEqual(result.movements, []);
      console.log("  ✓ movimentos de um inventory degradado reportam salesStatus=unavailable, nunca uma lista vazia silenciosa");
    }

    // PR6: sem commercialAdapter injetado, o padrao e inerte (unavailable)
    // em toda linha e em quality.sources.commercial, e isso NUNCA rebaixa
    // quality.status geral (comercial e independente/opcional).
    {
      const { gateway } = makeFakeGateway({ totalItems: 3 });
      const service = createFullService({ mlGateway: gateway, resolveAccountContext: fakeAccountContext() });
      const snapshot = await service.buildSnapshot({ clienteContaId: 321, windowDays: 14 });

      assert.strictEqual(snapshot.quality.status, "complete");
      assert.strictEqual(snapshot.quality.sources.commercial.status, "unavailable");
      for (const row of snapshot.inventories) {
        assert.strictEqual(row.commercial.status, "unavailable", "sem linhagem de conta comprovada, comercial nunca pode inventar dado");
      }
      console.log("  ✓ sem commercialAdapter real conectado, todo inventory e quality.sources.commercial ficam unavailable, sem rebaixar quality.status");
    }

    // PR6: commercialAdapter injetado enriquece cada linha em uma unica leitura bulk (nunca N+1)
    {
      const { gateway } = makeFakeGateway({ totalItems: 3 });
      let fetchCalls = 0;
      const commercialAdapter = createFullCommercialAdapter({
        lineageVerifier: async () => true,
        fetchAccountCommercial: async ({ inventories }) => {
          fetchCalls += 1;
          const byInventoryId = {};
          for (const inv of inventories) byInventoryId[inv.inventoryId] = { status: "ok", gmv30d: 42 };
          return { byInventoryId };
        },
      });
      const service = createFullService({ mlGateway: gateway, resolveAccountContext: fakeAccountContext(), commercialAdapter });
      const snapshot = await service.buildSnapshot({ clienteContaId: 322, windowDays: 14 });

      assert.strictEqual(fetchCalls, 1, "enriquecimento comercial deve ser uma unica leitura bulk por coleta, nunca uma por inventory");
      assert.strictEqual(snapshot.quality.sources.commercial.status, "ok");
      for (const row of snapshot.inventories) {
        assert.strictEqual(row.commercial.status, "ok");
        assert.strictEqual(row.commercial.gmv30d, 42);
      }
      console.log("  ✓ commercialAdapter com linhagem comprovada enriquece todas as linhas em uma unica leitura bulk");
    }

    // PR6: um commercialAdapter que quebra o proprio contrato (lanca) nunca derruba o snapshot operacional
    {
      const { gateway } = makeFakeGateway({ totalItems: 2 });
      const commercialAdapter = { fetchBulkCommercial: async () => { throw new Error("adapter comercial mal implementado"); } };
      const service = createFullService({ mlGateway: gateway, resolveAccountContext: fakeAccountContext(), commercialAdapter });
      const snapshot = await service.buildSnapshot({ clienteContaId: 323, windowDays: 14 });

      assert.strictEqual(snapshot.inventories.length, 2, "falha do adapter comercial nao pode derrubar o snapshot operacional inteiro");
      assert.strictEqual(snapshot.quality.sources.commercial.status, "unavailable");
      console.log("  ✓ commercialAdapter que quebra o contrato (lanca) nunca bloqueia metricas operacionais");
    }

    console.log("fullService.test.js passed");
  })();
}

run();
