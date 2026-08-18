// Prova o adapter comercial bulk e account-aware da Central de Gestao Full
// (PR6). Ponto central: enquanto nenhuma fonte comprovar linhagem por
// `cliente_conta_id` (secao 6, divergencia #4 do plano auditado), o
// enriquecimento comercial deve ficar inerte — sempre `status=unavailable`,
// nunca inventar numero cruzando contas do mesmo cliente — e NUNCA pode
// lancar, mesmo se as dependencias injetadas quebrarem o contrato.

const assert = require("assert");
const { createFullCommercialAdapter, unavailableResult, UNVERIFIED_REASON } = require("../services/full/fullCommercialAdapter");

function run() {
  return (async () => {
    // Padrao (nenhuma dependencia injetada): sempre unavailable, motivo padrao
    {
      const adapter = createFullCommercialAdapter();
      const result = await adapter.fetchBulkCommercial({
        clienteContaId: 1,
        clienteId: 10,
        sellerId: "SELLER1",
        period: { from: "2026-08-01", to: "2026-08-14" },
        inventories: [{ inventoryId: "INV-1" }, { inventoryId: "INV-2" }],
      });
      assert.strictEqual(result.account.status, "unavailable");
      assert.strictEqual(result.account.reason, UNVERIFIED_REASON);
      assert.strictEqual(result.byInventoryId.size, 0);
      console.log("  ✓ sem lineageVerifier/fetchAccountCommercial injetados, o adapter fica inerte (unavailable) por padrao");
    }

    // clienteContaId/clienteId ausentes: unavailable imediato, sem chamar lineageVerifier
    {
      let verifierCalls = 0;
      const adapter = createFullCommercialAdapter({
        lineageVerifier: async () => {
          verifierCalls += 1;
          return true;
        },
      });
      const result = await adapter.fetchBulkCommercial({ clienteContaId: null, clienteId: 10, inventories: [] });
      assert.strictEqual(result.account.status, "unavailable");
      assert.strictEqual(verifierCalls, 0, "sem conta/cliente explicitos, o adapter nunca deve tentar verificar linhagem");
      console.log("  ✓ clienteContaId/clienteId ausentes rejeitam antes de verificar linhagem (guard account-aware)");
    }

    // lineageVerifier confirma, mas nenhum fetchAccountCommercial foi conectado: continua inerte
    {
      const adapter = createFullCommercialAdapter({ lineageVerifier: async () => true });
      const result = await adapter.fetchBulkCommercial({ clienteContaId: 1, clienteId: 10, inventories: [] });
      assert.strictEqual(result.account.status, "unavailable");
      console.log("  ✓ linhagem comprovada sem fonte real conectada continua unavailable (nao inventa dado)");
    }

    // lineageVerifier lanca: nunca propaga, vira unavailable
    {
      const adapter = createFullCommercialAdapter({
        lineageVerifier: async () => {
          throw new Error("fonte de linhagem instavel");
        },
        fetchAccountCommercial: async () => ({ byInventoryId: {} }),
      });
      const result = await adapter.fetchBulkCommercial({ clienteContaId: 1, clienteId: 10, inventories: [] });
      assert.strictEqual(result.account.status, "unavailable");
      console.log("  ✓ falha no lineageVerifier nunca propaga; vira unavailable");
    }

    // fetchAccountCommercial lanca: nunca propaga, vira unavailable com motivo especifico
    {
      const adapter = createFullCommercialAdapter({
        lineageVerifier: async () => true,
        fetchAccountCommercial: async () => {
          throw new Error("fonte comercial fora do ar");
        },
      });
      const result = await adapter.fetchBulkCommercial({ clienteContaId: 1, clienteId: 10, inventories: [] });
      assert.strictEqual(result.account.status, "unavailable");
      assert.strictEqual(result.account.reason, "commercial_source_failed");
      console.log("  ✓ falha na fonte comercial nunca propaga; vira unavailable com motivo sanitizado");
    }

    // Caminho feliz: uma unica leitura bulk devolve dados por inventory, nunca por linha
    {
      let fetchCalls = 0;
      const adapter = createFullCommercialAdapter({
        lineageVerifier: async () => true,
        fetchAccountCommercial: async ({ inventories }) => {
          fetchCalls += 1;
          const byInventoryId = {};
          for (const inv of inventories) byInventoryId[inv.inventoryId] = { status: "ok", gmv30d: 100 };
          return { byInventoryId };
        },
      });

      const manyInventories = Array.from({ length: 250 }, (_, i) => ({ inventoryId: `INV-${i}` }));
      const result = await adapter.fetchBulkCommercial({
        clienteContaId: 1,
        clienteId: 10,
        sellerId: "SELLER1",
        period: { from: "2026-08-01", to: "2026-08-14" },
        inventories: manyInventories,
      });

      assert.strictEqual(fetchCalls, 1, "deve ser uma unica leitura bulk por conta/periodo, nunca uma chamada por inventory (N+1)");
      assert.strictEqual(result.account.status, "ok");
      assert.strictEqual(result.byInventoryId.get("INV-0").gmv30d, 100);
      assert.strictEqual(result.byInventoryId.size, 250);
      console.log("  ✓ caminho feliz: uma unica leitura bulk enriquece todos os inventories, sem N+1 comercial");
    }

    // fetchAccountCommercial devolve algo invalido: nunca inventa numero, vira unavailable
    {
      const adapter = createFullCommercialAdapter({ lineageVerifier: async () => true, fetchAccountCommercial: async () => null });
      const result = await adapter.fetchBulkCommercial({ clienteContaId: 1, clienteId: 10, inventories: [] });
      assert.strictEqual(result.account.status, "unavailable");
      assert.strictEqual(result.account.reason, "empty_commercial_source");
      console.log("  ✓ resposta vazia/invalida da fonte comercial vira unavailable explicito, nunca dado inventado");
    }

    // unavailableResult() helper usa o motivo padrao quando nenhum e passado
    {
      assert.deepStrictEqual(unavailableResult(), { status: "unavailable", reason: UNVERIFIED_REASON });
      console.log("  ✓ unavailableResult() sem argumento usa o motivo padrao account_scope_unverified");
    }

    console.log("fullCommercialAdapter.test.js passed");
  })();
}

run();
