// server/routes/visaoRoutes.js
// Montado em server/index.js: app.use("/operacao/visao", visaoRoutes).
// Mesmo padrão de autorização de leitura do resto de /operacao (Cliente 360,
// Central de Vendas): authMiddleware + requireAutomacoesAccess.
const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const controller = require("../controllers/visaoController");

const router = express.Router();

router.get("/:cliente", authMiddleware, requireAutomacoesAccess, controller.visao);

module.exports = router;
