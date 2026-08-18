// Prova o controller HTTP interno da Central de Gestao Full: validacao de
// parametros, mascara recursiva de segredos (guarda final mesmo se algo
// vazar de uma camada interna), mascara de seller_id, mapeamento de erro
// para os codigos do contrato (secao 12) e resposta parcial 200 vs falha
// mapeada. Usa um `fullService` falso via `createFullController` — nunca
// toca Postgres/Mercado Livre real.

const assert = require("assert");
const { createFullController, maskSensitiveData, maskSellerId, mapError } = require("../controllers/fullController");

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; if (res.statusCode === null) res.statusCode = 200; return res; };
  return res;
}

function baseSnapshot(overrides = {}) {
  return {
    account: { clienteContaId: 123, clienteId: 1, sellerId: "384324657", marketplace: "meli" },
    period: { from: "2026-08-04", to: "2026-08-17" },
    quality: { status: "complete", sources: {} },
    inventories: [],
    unresolvedReferences: [],
    _internal: { movementsByInventory: new Map() },
    ...overrides,
  };
}

function run() {
  return (async () => {
    // maskSensitiveData: recursivo, inclusive dentro de arrays
    {
      const masked = maskSensitiveData({
        ok: true,
        nested: { access_token: "abc", list: [{ refresh_token: "xyz", fine: 1 }] },
      });
      assert.strictEqual(masked.nested.access_token, "[REDACTED]");
      assert.strictEqual(masked.nested.list[0].refresh_token, "[REDACTED]");
      assert.strictEqual(masked.nested.list[0].fine, 1);
      console.log("  ✓ maskSensitiveData redige segredos recursivamente, inclusive dentro de arrays");
    }

    // maskSellerId
    {
      assert.strictEqual(maskSellerId("384324657"), "***4657");
      assert.strictEqual(maskSellerId("12"), "***12");
      assert.strictEqual(maskSellerId(null), null);
      assert.strictEqual(maskSellerId(undefined), null);
      console.log("  ✓ maskSellerId mascara mantendo so os ultimos digitos");
    }

    // mapError: cobre os codigos do contrato (secao 12)
    {
      assert.strictEqual(mapError({ code: "MULTIPLE_MARKETPLACE_ACCOUNTS", contas: [1] }).statusCode, 409);
      assert.strictEqual(mapError({ code: "INVALID_FULL_QUERY" }).statusCode, 400);
      assert.strictEqual(mapError({ code: "INVENTORY_NOT_FOUND" }).statusCode, 404);
      assert.strictEqual(mapError({ code: "ML_GRANT_REVOKED" }).statusCode, 424);
      assert.strictEqual(mapError({ code: "ML_GRANT_REVOKED" }).body.code, "ML_GRANT_UNAVAILABLE");
      assert.strictEqual(mapError({ status: 429 }).statusCode, 429);
      assert.strictEqual(mapError({ code: "ITEMS_SCAN_FAILED" }).statusCode, 502);
      assert.strictEqual(mapError({ statusCode: 403, code: "FULL_ACCESS_DENIED" }).statusCode, 403);
      assert.strictEqual(mapError(new Error("boom")).statusCode, 500);
      assert.strictEqual(mapError(new Error("boom")).body.code, "INTERNAL_ERROR");
      console.log("  ✓ mapError traduz cada erro de dominio para o codigo/HTTP do contrato");
    }

    // getSnapshot: caminho feliz — sellerId nunca aparece, so sellerIdMasked; _internal nunca vaza
    {
      const fullService = { buildSnapshot: async () => baseSnapshot() };
      const controller = createFullController({ fullService });
      const res = fakeRes();
      await controller.getSnapshot({ params: { clienteContaId: "123" }, query: {} }, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.account.sellerIdMasked, "***4657");
      assert.strictEqual(res.body.account.sellerId, undefined, "sellerId cru nunca pode sair na resposta publica");
      assert.strictEqual(res.body._internal, undefined, "campos internos (movimentos crus) nunca podem vazar no snapshot publico");
      console.log("  ✓ getSnapshot: 200 com sellerIdMasked, sem sellerId cru e sem _internal");
    }

    // getSnapshot: clienteContaId invalido nunca chega ao service
    {
      let called = false;
      const fullService = { buildSnapshot: async () => { called = true; return baseSnapshot(); } };
      const controller = createFullController({ fullService });
      const res = fakeRes();
      await controller.getSnapshot({ params: { clienteContaId: "abc" }, query: {} }, res);
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.code, "INVALID_FULL_QUERY");
      assert.strictEqual(called, false, "parametro invalido nao pode nem chamar o service");
      console.log("  ✓ getSnapshot: clienteContaId invalido vira 400 sem chamar o service");
    }

    // getSnapshot: windowDays diferente de 14 vira 400 (contrato so aceita 14 no V1)
    {
      const fullService = { buildSnapshot: async () => baseSnapshot() };
      const controller = createFullController({ fullService });
      const res = fakeRes();
      await controller.getSnapshot({ params: { clienteContaId: "123" }, query: { windowDays: "abc" } }, res);
      assert.strictEqual(res.statusCode, 400);
      console.log("  ✓ getSnapshot: windowDays invalido vira 400");
    }

    // getSnapshot: multiplas contas (409) e falha total (500) mapeadas corretamente
    {
      const controllerConflito = createFullController({
        fullService: { buildSnapshot: async () => { throw Object.assign(new Error("multiplas contas"), { code: "MULTIPLE_MARKETPLACE_ACCOUNTS", contas: [{ id: 1 }] }); } },
      });
      const resConflito = fakeRes();
      await controllerConflito.getSnapshot({ params: { clienteContaId: "123" }, query: {} }, resConflito);
      assert.strictEqual(resConflito.statusCode, 409);
      assert.deepStrictEqual(resConflito.body.contas, [{ id: 1 }]);

      const controllerFalha = createFullController({
        fullService: { buildSnapshot: async () => { throw new Error("falha inesperada"); } },
      });
      const resFalha = fakeRes();
      await controllerFalha.getSnapshot({ params: { clienteContaId: "123" }, query: {} }, resFalha);
      assert.strictEqual(resFalha.statusCode, 500);
      assert.strictEqual(resFalha.body.ok, false);
      console.log("  ✓ getSnapshot: 409 em conflito de contas, 500 em falha inesperada mapeada, resposta sempre ok:false");
    }

    // getSnapshot: resposta parcial (quality=partial) continua 200, nunca vira erro
    {
      const fullService = { buildSnapshot: async () => baseSnapshot({ quality: { status: "partial", sources: {} } }) };
      const controller = createFullController({ fullService });
      const res = fakeRes();
      await controller.getSnapshot({ params: { clienteContaId: "123" }, query: {} }, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.quality.status, "partial");
      console.log("  ✓ getSnapshot: qualidade parcial continua 200, nunca e tratada como erro");
    }

    // getInventoryDetail: caminho feliz e 404 explicito
    {
      const fullService = { getInventoryDetail: async () => ({ inventoryId: "INV-1", stock: {} }) };
      const controller = createFullController({ fullService });
      const res = fakeRes();
      await controller.getInventoryDetail({ params: { clienteContaId: "123", inventoryId: "INV-1" } }, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.inventoryId, "INV-1");

      const controllerNotFound = createFullController({
        fullService: { getInventoryDetail: async () => { throw Object.assign(new Error("nao encontrado"), { code: "INVENTORY_NOT_FOUND", statusCode: 404 }); } },
      });
      const resNotFound = fakeRes();
      await controllerNotFound.getInventoryDetail({ params: { clienteContaId: "123", inventoryId: "INV-X" } }, resNotFound);
      assert.strictEqual(resNotFound.statusCode, 404);
      assert.strictEqual(resNotFound.body.code, "INVENTORY_NOT_FOUND");
      console.log("  ✓ getInventoryDetail: 200 no caminho feliz, 404 explicito quando o inventory nao pertence ao snapshot");
    }

    // getInventoryMovements: valida limit e repassa cursor opaco
    {
      let receivedArgs = null;
      const fullService = {
        getInventoryMovements: async (args) => {
          receivedArgs = args;
          return { inventoryId: args.inventoryId, movements: [], nextCursor: null, total: 0, salesStatus: "ok" };
        },
      };
      const controller = createFullController({ fullService });
      const res = fakeRes();
      await controller.getInventoryMovements(
        { params: { clienteContaId: "123", inventoryId: "INV-1" }, query: { cursor: "OPAQUE123", limit: "50" } },
        res
      );
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(receivedArgs.cursor, "OPAQUE123");
      assert.strictEqual(receivedArgs.limit, 50);

      const resLimiteInvalido = fakeRes();
      await controller.getInventoryMovements(
        { params: { clienteContaId: "123", inventoryId: "INV-1" }, query: { limit: "500" } },
        resLimiteInvalido
      );
      assert.strictEqual(resLimiteInvalido.statusCode, 400, "limit acima de 200 deve ser rejeitado");
      console.log("  ✓ getInventoryMovements: repassa cursor opaco/limit validado, rejeita limit fora de 1-200");
    }

    // Guarda final: mesmo se o service vazar um segredo por engano, a resposta HTTP nunca expoe
    {
      const fullService = { buildSnapshot: async () => baseSnapshot({ leaked: { access_token: "NUNCA" } }) };
      const controller = createFullController({ fullService });
      const res = fakeRes();
      await controller.getSnapshot({ params: { clienteContaId: "123" }, query: {} }, res);
      assert.strictEqual(res.body.leaked.access_token, "[REDACTED]");
      console.log("  ✓ guarda recursiva final redige qualquer segredo, mesmo se vazado de uma camada interna");
    }

    console.log("fullController.test.js passed");
  })();
}

run();
