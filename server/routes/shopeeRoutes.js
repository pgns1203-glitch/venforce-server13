const express = require("express");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const {
  callbackShopeeController,
  iniciarAutorizacaoTestController,
  statusTestController,
} = require("../controllers/shopeeController");

const router = express.Router();

router.get("/callback", callbackShopeeController);
// OAuth Shopee de TESTE: só admin gera link de autorização e vê o status.
router.post("/test/autorizar", authMiddleware, requireAdmin, iniciarAutorizacaoTestController);
router.get("/test/status", authMiddleware, requireAdmin, statusTestController);

module.exports = router;
