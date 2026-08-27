// server/routes/fullRoutes.js
// Rotas READ-ONLY da Central de Gestao Full. Montadas em /operacao/full
// (ver server/index.js). Auth: mesmo par usado por Cliente360/Central de
// Margem (JWT + requireAutomacoesAccess). A conta vem do path e e validada
// pelo service; nunca confia em seller_id/cliente_id enviados pelo browser.
//
// [RISCO DE PRODUCAO] Atras de feature flag: com FULL_CENTRAL_ENABLED
// diferente de "true", todo este namespace responde 404 (como se a rota nao
// existisse), mesmo com o link ja disponivel no menu do Portal (Marketplace
// > Central Full). Ativar em producao exige setar FULL_CENTRAL_ENABLED=true
// nas env vars do servico no Render — sem isso, o link no menu leva a uma
// tela que so recebe 404 do backend.

const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireClienteContaNaCarteira } = require("../middlewares/carteiraMiddleware");
const controller = require("../controllers/fullController");

const router = express.Router();

// P2.1 — autorização por carteira. O identificador é o ID da CLIENTE_CONTA:
// resolve conta → cliente → Squad. "A conta existe" nunca é "pode acessar".
const naCarteira = requireClienteContaNaCarteira("clienteContaId");

function requireFullCentralEnabled(req, res, next) {
  if (process.env.FULL_CENTRAL_ENABLED !== "true") {
    return res.status(404).json({ ok: false, code: "NOT_FOUND" });
  }
  return next();
}

router.use(requireFullCentralEnabled);

router.get("/contas/:clienteContaId/snapshot", authMiddleware, requireAutomacoesAccess, naCarteira, controller.getSnapshot);

router.get(
  "/contas/:clienteContaId/inventories/:inventoryId/movements",
  authMiddleware,
  requireAutomacoesAccess,
  naCarteira,
  controller.getInventoryMovements
);

router.get(
  "/contas/:clienteContaId/inventories/:inventoryId",
  authMiddleware,
  requireAutomacoesAccess,
  naCarteira,
  controller.getInventoryDetail
);

module.exports = router;
module.exports.requireFullCentralEnabled = requireFullCentralEnabled;
