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
const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
const controller = require("../controllers/motorMargemController");

const router = express.Router();

// P2.1 — autorização por carteira. Todas as rotas são client-scoped por
// `:clienteSlug`. Grant/Base continuam sendo integração, não autorização.
const naCarteira = requireClienteNaCarteira("clienteSlug");

router.get("/:clienteSlug/contexto", authMiddleware, requireAutomacoesAccess, naCarteira, controller.obterContexto);
router.get("/:clienteSlug/resumo", authMiddleware, requireAutomacoesAccess, naCarteira, controller.obterResumo);
router.get("/:clienteSlug/workspace", authMiddleware, requireAutomacoesAccess, naCarteira, controller.obterWorkspace);
router.get("/:clienteSlug/itens", authMiddleware, requireAutomacoesAccess, naCarteira, controller.listarItens);
router.get(
  "/:clienteSlug/itens/:itemId/evidencias",
  authMiddleware,
  requireAutomacoesAccess,
  naCarteira,
  controller.obterEvidencias
);
router.get("/:clienteSlug/itens/:itemId", authMiddleware, requireAutomacoesAccess, naCarteira, controller.obterItem);

// Raiz — registrada por ÚLTIMO para não capturar os subcaminhos acima.
// É a rota que `Portal/central-margem-api.js` chama primeiro; devolve resumo da
// página + itens (com aliases planos) no mesmo payload.
router.get("/:clienteSlug", authMiddleware, requireAutomacoesAccess, naCarteira, controller.obterCentral);

module.exports = router;
