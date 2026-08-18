// server/routes/fullRoutes.js
// Rotas READ-ONLY da Central de Gestao Full. Montadas em /operacao/full
// (ver server/index.js). Auth: mesmo par usado por Cliente360/Central de
// Margem (JWT + requireAutomacoesAccess). A conta vem do path e e validada
// pelo service; nunca confia em seller_id/cliente_id enviados pelo browser.
//
// [RISCO DE PRODUCAO] Atras de feature flag: com FULL_CENTRAL_ENABLED
// diferente de "true", todo este namespace responde 404 (como se a rota nao
// existisse). Sem link no menu do Portal ate o smoke test do build React
// isolado (proxima fase). Ativar exige setar a env var explicitamente.

const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const controller = require("../controllers/fullController");

const router = express.Router();

function requireFullCentralEnabled(req, res, next) {
  if (process.env.FULL_CENTRAL_ENABLED !== "true") {
    return res.status(404).json({ ok: false, code: "NOT_FOUND" });
  }
  return next();
}

router.use(requireFullCentralEnabled);

router.get("/contas/:clienteContaId/snapshot", authMiddleware, requireAutomacoesAccess, controller.getSnapshot);

router.get(
  "/contas/:clienteContaId/inventories/:inventoryId/movements",
  authMiddleware,
  requireAutomacoesAccess,
  controller.getInventoryMovements
);

router.get(
  "/contas/:clienteContaId/inventories/:inventoryId",
  authMiddleware,
  requireAutomacoesAccess,
  controller.getInventoryDetail
);

module.exports = router;
module.exports.requireFullCentralEnabled = requireFullCentralEnabled;
