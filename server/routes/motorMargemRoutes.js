// server/routes/motorMargemRoutes.js
// Rotas da Central de Margem. Montadas em /operacao/central-margem.
//
// Nenhuma rota escreve preço, promoção ou Base — quando existir, será uma
// rota separada, com admin + validação de backend (ver
// CENTRAL_MARGEM_API_CONTRACT §Fora de escopo). A única escrita aqui é
// `POST .../snapshot/refresh` (Margin Snapshot, M4): enfileira um run de
// atualização da leitura (202) — não altera nada no marketplace nem na Base.
//
// Auth: mesmo par usado pela Central de Vendas e pelas automações
// (JWT + requireAutomacoesAccess → admin/user/membro).

const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
const controller = require("../controllers/motorMargemController");
const snapshotController = require("../controllers/marginSnapshotController");

const router = express.Router();

// P2.1 — autorização por carteira. Todas as rotas são client-scoped por
// `:clienteSlug`. Grant/Base continuam sendo integração, não autorização.
const naCarteira = requireClienteNaCarteira("clienteSlug");

// Margin Snapshot (M4+) — leitura persistida da margem projetada, sempre por
// conta (`clienteContaId`), validada contra o cliente no service. Registradas
// antes de `/:clienteSlug/itens/:itemId` e da raiz.
router.get("/:clienteSlug/snapshot/resumo", authMiddleware, requireAutomacoesAccess, naCarteira, snapshotController.obterResumo);
router.get("/:clienteSlug/snapshot/itens", authMiddleware, requireAutomacoesAccess, naCarteira, snapshotController.listarItens);
router.post("/:clienteSlug/snapshot/refresh", authMiddleware, requireAutomacoesAccess, naCarteira, snapshotController.solicitarRefresh);
router.get("/:clienteSlug/snapshot/refresh/:runId", authMiddleware, requireAutomacoesAccess, naCarteira, snapshotController.obterStatusRefresh);

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
