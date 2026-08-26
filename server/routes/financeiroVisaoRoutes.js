// server/routes/financeiroVisaoRoutes.js
// Montado em server/index.js: app.use("/financeiro", financeiroVisaoRoutes).
// Não confundir com /fechamentos (fechamentosFinanceiroRoutes.js — fluxo de
// upload/processamento, intocado).
const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const controller = require("../controllers/financeiroVisaoController");

const router = express.Router();

router.get("/:cliente", authMiddleware, requireAutomacoesAccess, controller.financeiro);

module.exports = router;
