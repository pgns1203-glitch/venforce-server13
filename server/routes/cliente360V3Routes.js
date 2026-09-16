// server/routes/cliente360V3Routes.js
// Montado em server/index.js: app.use("/operacao/cliente-360-v3", cliente360V3Routes).
// Prefixo NOVO e próprio (auditoria técnica §21), não aninhado em
// /operacao/cliente-360 — mesmo padrão de /operacao/visao e /financeiro:
// cada ilha Shell V3 tem seu prefixo, o legado (/operacao/cliente-360) não
// é tocado. Contrato puramente aditivo — FASE 1 de Projeto_cliente360.
//
// Autorização real por carteira (V3 S4), mesmo modelo do resto de
// /operacao — nenhum modelo de acesso novo (master prompt §13).
const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
const controller = require("../controllers/cliente360V3Controller");
const produtosController = require("../controllers/cliente360V3ProdutosController");
const saudeAdsController = require("../controllers/cliente360V3SaudeAdsController");
const historicoController = require("../controllers/cliente360V3HistoricoController");

const router = express.Router();

router.get("/:slug/bootstrap", authMiddleware, requireAutomacoesAccess, requireClienteNaCarteira("slug"), controller.bootstrap);

// FASE 3 — lazy, chamado só quando a seção "Produtos" abre (ver
// cliente360V3ProdutosController.js).
router.get(
  "/:slug/produtos-margem",
  authMiddleware,
  requireAutomacoesAccess,
  requireClienteNaCarteira("slug"),
  produtosController.produtosMargem
);

// FASE 5A/5C — lazy, chamados só quando as seções "Ads"/"Saúde" abrem (ver
// cliente360V3SaudeAdsController.js).
router.get("/:slug/ads", authMiddleware, requireAutomacoesAccess, requireClienteNaCarteira("slug"), saudeAdsController.ads);
router.get("/:slug/saude", authMiddleware, requireAutomacoesAccess, requireClienteNaCarteira("slug"), saudeAdsController.saude);

// FASE 6 — lazy, chamado só quando a seção "Histórico" abre (ver
// cliente360V3HistoricoController.js).
router.get("/:slug/historico", authMiddleware, requireAutomacoesAccess, requireClienteNaCarteira("slug"), historicoController.historico);

module.exports = router;
