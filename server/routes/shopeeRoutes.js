const express = require("express");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const {
  callbackShopeeController,
  iniciarAutorizacaoTestController,
  statusTestController,
  iniciarAutorizacaoLiveController,
  statusLiveController,
  gerarLinksLiveController,
  contasLiveController,
  refreshLiveController,
} = require("../controllers/shopeeController");

const router = express.Router();

router.get("/callback", callbackShopeeController);
// OAuth Shopee de TESTE: só admin gera link de autorização e vê o status.
router.post("/test/autorizar", authMiddleware, requireAdmin, iniciarAutorizacaoTestController);
router.get("/test/status", authMiddleware, requireAdmin, statusTestController);
// OAuth Shopee LIVE (grant por Conta): só admin nesta fase.
router.post("/live/autorizar", authMiddleware, requireAdmin, iniciarAutorizacaoLiveController);
router.get("/live/status", authMiddleware, requireAdmin, statusLiveController);
// Operação LIVE: lista de Contas Shopee, links em lote (state novo por Conta) e
// refresh manual do grant. Nada disso devolve token.
router.get("/live/contas", authMiddleware, requireAdmin, contasLiveController);
router.post("/live/links", authMiddleware, requireAdmin, gerarLinksLiveController);
router.post("/live/refresh", authMiddleware, requireAdmin, refreshLiveController);

module.exports = router;
