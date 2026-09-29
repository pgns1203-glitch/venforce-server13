// server/routes/painelContasRoutes.js
// Montado em server/index.js: app.use("/painel-contas", painelContasRoutes).
//
// Autorização por carteira SEMPRE: resolvePortfolioClientes dentro do service
// (lista) e requireClienteNaCarteira nas rotas com :clienteId (Auditoria
// §4/§15 — nunca "o cliente existe, logo acessa"). Papel: mesmo padrão de
// clienteContasRoutes.js / cliente360ResultadoRoutes.js — authMiddleware +
// requireAutomacoesAccess (admin/user/membro; não inclui `seller`, que não é
// o público deste painel interno de carteira por Squad).

const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
const controller = require("../controllers/painelContasController");

const router = express.Router();
const naCarteira = requireClienteNaCarteira("clienteId");

router.get("/", authMiddleware, requireAutomacoesAccess, controller.listar);
router.get("/:clienteId/meses", authMiddleware, requireAutomacoesAccess, naCarteira, controller.listarMeses);
router.get("/:clienteId/meses/:competencia/semanas", authMiddleware, requireAutomacoesAccess, naCarteira, controller.listarSemanas);
// Lançamento manual por conta × competência. Mesmo gate de PUT
// /ads/resumo-mensal (o outro lançamento gerencial manual): papel de
// automações + cliente na carteira; o service ainda exige que a conta
// pertença ao cliente do path.
const manual = "/:clienteId/contas/:contaId/manual/:competencia";
router.put(manual, authMiddleware, requireAutomacoesAccess, naCarteira, controller.salvarLancamentoManual);
router.delete(manual, authMiddleware, requireAutomacoesAccess, naCarteira, controller.removerLancamentoManual);

module.exports = router;
