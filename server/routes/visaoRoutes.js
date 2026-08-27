// server/routes/visaoRoutes.js
// Montado em server/index.js: app.use("/operacao/visao", visaoRoutes).
// Mesmo padrão de autorização de leitura do resto de /operacao (Cliente 360,
// Central de Vendas): authMiddleware + requireAutomacoesAccess.
const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
const controller = require("../controllers/visaoController");

const router = express.Router();

// Autorização real por carteira (V3 S4): interno só vê cliente do seu Squad,
// seller só do seller_clientes, admin bypass. 403 CLIENTE_FORA_DA_CARTEIRA.
router.get("/:cliente", authMiddleware, requireAutomacoesAccess, requireClienteNaCarteira("cliente"), controller.visao);

module.exports = router;
