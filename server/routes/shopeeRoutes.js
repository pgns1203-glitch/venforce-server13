const express = require("express");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const {
  callbackShopeeController,
  iniciarAutorizacaoTestController,
  statusTestController,
  iniciarAutorizacaoLiveController,
  statusLiveController,
} = require("../controllers/shopeeController");

const router = express.Router();

router.get("/callback", callbackShopeeController);
// OAuth Shopee de TESTE: só admin gera link de autorização e vê o status.
router.post("/test/autorizar", authMiddleware, requireAdmin, iniciarAutorizacaoTestController);
router.get("/test/status", authMiddleware, requireAdmin, statusTestController);
// OAuth Shopee LIVE (grant por Conta): só admin nesta fase.
router.post("/live/autorizar", authMiddleware, requireAdmin, iniciarAutorizacaoLiveController);
router.get("/live/status", authMiddleware, requireAdmin, statusLiveController);

module.exports = router;
