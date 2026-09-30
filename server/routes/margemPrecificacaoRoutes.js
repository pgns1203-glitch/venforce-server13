// server/routes/margemPrecificacaoRoutes.js
// Camada SEGURA de precificação da Central de Margem. Montada em
// /operacao/central-margem, separada de motorMargemRoutes (que continua
// somente leitura). As únicas escritas no Mercado Livre saem de
// `.../aplicar`, e só com: rollout ligado (MARGIN_PRICING_WRITE_*), preview
// válido, chave de idempotência, 1 aplicação por item e gates reavaliados
// AO VIVO no backend.
//
// Auth: mesmo trio da Central (JWT + requireAutomacoesAccess + carteira).

const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
const controller = require("../controllers/margemPrecificacaoController");

const router = express.Router();
const guarda = [authMiddleware, requireAutomacoesAccess, requireClienteNaCarteira("clienteSlug")];

// Leitura / cálculo (nenhuma escrita no ML).
router.post("/:clienteSlug/precificacao/simular", ...guarda, controller.simular);
router.post("/:clienteSlug/precificacao/preview", ...guarda, controller.preview);
router.get("/:clienteSlug/precificacao/historico", ...guarda, controller.historico);
router.get("/:clienteSlug/precificacao/aplicacoes/:aplicacaoId", ...guarda, controller.obterAplicacao);
router.get("/:clienteSlug/precificacao/promocoes", ...guarda, controller.promocoes);
router.get("/:clienteSlug/precificacao/oportunidades", ...guarda, controller.listarOportunidades);
router.post("/:clienteSlug/promocoes/:promotionId/preview", ...guarda, controller.previewPromocao);

// Escrita real (atrás do rollout + gates).
router.post("/:clienteSlug/precificacao/aplicar", ...guarda, controller.aplicar);
router.post("/:clienteSlug/promocoes/:promotionId/aplicar", ...guarda, controller.aplicar);

module.exports = router;
