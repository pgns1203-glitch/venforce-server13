// server/routes/motorMargemRoutes.js
// Rotas READ-ONLY da Central de Margem. Montadas em /operacao/central-margem.
//
// Apenas GET. Escrita de preço/promoção não existe nesta fase — quando existir,
// será uma rota separada, com admin + validação de backend (ver
// CENTRAL_MARGEM_API_CONTRACT §Fora de escopo).
//
// Auth: mesmo par usado pela Central de Vendas e pelas automações
// (JWT + requireAutomacoesAccess → admin/user/membro).

const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const controller = require("../controllers/motorMargemController");

const router = express.Router();

router.get("/:clienteSlug/contexto", authMiddleware, requireAutomacoesAccess, controller.obterContexto);
router.get("/:clienteSlug/resumo", authMiddleware, requireAutomacoesAccess, controller.obterResumo);
router.get("/:clienteSlug/workspace", authMiddleware, requireAutomacoesAccess, controller.obterWorkspace);
router.get("/:clienteSlug/itens", authMiddleware, requireAutomacoesAccess, controller.listarItens);
router.get(
  "/:clienteSlug/itens/:itemId/evidencias",
  authMiddleware,
  requireAutomacoesAccess,
  controller.obterEvidencias
);
router.get("/:clienteSlug/itens/:itemId", authMiddleware, requireAutomacoesAccess, controller.obterItem);

// Raiz — registrada por ÚLTIMO para não capturar os subcaminhos acima.
// É a rota que `Portal/central-margem-api.js` chama primeiro; devolve resumo da
// página + itens (com aliases planos) no mesmo payload.
router.get("/:clienteSlug", authMiddleware, requireAutomacoesAccess, controller.obterCentral);

module.exports = router;
