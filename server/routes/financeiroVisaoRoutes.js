// server/routes/financeiroVisaoRoutes.js
// Montado em server/index.js: app.use("/financeiro", financeiroVisaoRoutes).
// Não confundir com /fechamentos (fechamentosFinanceiroRoutes.js — fluxo de
// upload/processamento, intocado).
const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
const controller = require("../controllers/financeiroVisaoController");

const router = express.Router();

// Autorização real por carteira (V3 S4).
router.get("/:cliente", authMiddleware, requireAutomacoesAccess, requireClienteNaCarteira("cliente"), controller.financeiro);

module.exports = router;
