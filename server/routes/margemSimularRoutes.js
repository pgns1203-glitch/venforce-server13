// server/routes/margemSimularRoutes.js
// Simulação de cenários da Central de Margem, montada em /api/margem.
// Somente leitura (nenhuma escrita no Mercado Livre nem na Base).
//
// Auth: o mesmo par da Central (JWT + requireAutomacoesAccess). A carteira é
// conferida no service pela CONTA do corpo (`cliente_conta_id` → cliente →
// carteira → seller), porque o identificador aqui é a conta, não o slug.

const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const controller = require("../controllers/margemSimularController");

const router = express.Router();
const guarda = [authMiddleware, requireAutomacoesAccess];

router.post("/simular", ...guarda, controller.simular);
router.post("/composicao", ...guarda, controller.composicao);

module.exports = router;
