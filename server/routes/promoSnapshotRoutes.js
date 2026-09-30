// server/routes/promoSnapshotRoutes.js
// Promo Snapshot por conta, consumido pela Central de Margem. Montado em
// /operacao/central-margem, separado de motorMargemRoutes (só GET) e de
// margemPrecificacaoRoutes (escrita atrás de rollout).
//
// Autorização em cadeia: JWT (usuário autenticado) → requireAutomacoesAccess
// → requireClienteNaCarteira (cliente acessível pela carteira/squad) → no
// service, clienteContaId do cliente, MELI e ativa. Nenhuma resposta mistura
// contas.
//
// SOMENTE LEITURA no Mercado Livre: GETs leem o banco; o POST /sync só
// enfileira uma leitura (cooldown + dedupe), nunca aplica promoção.

const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
const controller = require("../controllers/promoSnapshotController");

const router = express.Router();
const guarda = [authMiddleware, requireAutomacoesAccess, requireClienteNaCarteira("clienteSlug")];

router.get("/:clienteSlug/promocoes/snapshot", ...guarda, controller.snapshot);
router.get("/:clienteSlug/promocoes/status", ...guarda, controller.status);
router.get("/:clienteSlug/promocoes/oportunidades", ...guarda, controller.listarOportunidades);
router.post("/:clienteSlug/promocoes/sync", ...guarda, controller.sync);

module.exports = router;
