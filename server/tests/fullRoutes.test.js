// Prova a montagem das rotas da Central de Gestao Full: as tres rotas
// existem com o par authMiddleware + requireAutomacoesAccess (mesmo padrao
// de Cliente360/Central de Margem), e o namespace inteiro fica atras da
// feature flag FULL_CENTRAL_ENABLED — sem a env var, responde 404 como se a
// rota nao existisse (risco de producao mitigado: nada muda so por
// deployar o codigo).

const assert = require("assert");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const fullRoutes = require("../routes/fullRoutes");
const controller = require("../controllers/fullController");

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; if (res.statusCode === null) res.statusCode = 200; return res; };
  return res;
}

function findRoute(path) {
  const layer = fullRoutes.stack.find((l) => l.route && l.route.path === path);
  return layer ? layer.route : null;
}

function run() {
  return (async () => {
    // Feature flag: primeira camada do router, antes de qualquer rota
    {
      const original = process.env.FULL_CENTRAL_ENABLED;
      delete process.env.FULL_CENTRAL_ENABLED;

      const res = fakeRes();
      let nextCalled = false;
      fullRoutes.requireFullCentralEnabled({}, res, () => { nextCalled = true; });
      assert.strictEqual(res.statusCode, 404, "sem FULL_CENTRAL_ENABLED=true, o namespace inteiro deve responder 404");
      assert.strictEqual(nextCalled, false);

      process.env.FULL_CENTRAL_ENABLED = "true";
      const res2 = fakeRes();
      let nextCalled2 = false;
      fullRoutes.requireFullCentralEnabled({}, res2, () => { nextCalled2 = true; });
      assert.strictEqual(nextCalled2, true, "com a flag ligada, a requisicao deve seguir para as rotas");
      assert.strictEqual(res2.statusCode, null, "quando a flag esta ligada, o middleware nao deve responder nada sozinho");

      if (original === undefined) delete process.env.FULL_CENTRAL_ENABLED;
      else process.env.FULL_CENTRAL_ENABLED = original;
      console.log("  ✓ requireFullCentralEnabled bloqueia com 404 sem a flag e libera com a flag ligada");
    }

    // As tres rotas existem, todas GET, todas com authMiddleware +
    // requireAutomacoesAccess + o seam de carteira (P2.1:
    // carteiraClienteContaGuard resolve clienteContaId -> cliente -> Squad)
    // antes do controller.
    {
      const casos = [
        ["/contas/:clienteContaId/snapshot", controller.getSnapshot],
        ["/contas/:clienteContaId/inventories/:inventoryId/movements", controller.getInventoryMovements],
        ["/contas/:clienteContaId/inventories/:inventoryId", controller.getInventoryDetail],
      ];
      for (const [path, ctrl] of casos) {
        const rota = findRoute(path);
        assert.ok(rota && rota.methods.get, `GET ${path} deve estar registrada`);
        const nomes = rota.stack.map((l) => l.handle.name);
        assert.deepStrictEqual(
          nomes,
          ["authMiddleware", "requireAutomacoesAccess", "carteiraClienteContaGuard", ctrl.name],
          `GET ${path}: gate de role + seam de carteira antes do controller`
        );
      }

      console.log("  ✓ snapshot/movements/detail: authMiddleware + requireAutomacoesAccess + seam de carteira antes do controller");
    }

    console.log("fullRoutes.test.js passed");
  })();
}

run();
