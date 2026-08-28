// server/routes/fechamentosFinanceiroRoutes.js
// Rotas de fechamento financeiro.
// Mantém POST /fechamentos/financeiro quando montado em /fechamentos.

const express = require("express");
const multer = require("multer");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const {
  listarClientesFinanceiroController,
  processarFechamentoFinanceiroController,
} = require("../controllers/fechamentosFinanceiroController");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.get(
  "/financeiro/clientes",
  authMiddleware,
  requireAutomacoesAccess,
  listarClientesFinanceiroController
);

router.post(
  "/financeiro",
  authMiddleware,
  // P2.1 — este POST só tinha authMiddleware (qualquer autenticado). Agora
  // exige role interna. É um processador stateless de planilha enviada pelo
  // usuário; a identidade do cliente é validada contra o cliente_slug do
  // upload (ver fechamentoFinanceiroService), não lê dados por id — carteira
  // por Squad fica como dívida aceitável (BACKEND_V3_AUTHORIZATION_COVERAGE.md).
  requireAutomacoesAccess,
  upload.fields([
    { name: "sales", maxCount: 1 },
    { name: "costs", maxCount: 1 },
    { name: "ordersAll", maxCount: 1 },
    // Onhold do TikTok Shop: opcional e com campo próprio — não reaproveita
    // ordersAll (Shopee), que tem semântica diferente.
    { name: "onhold", maxCount: 1 },
  ]),
  processarFechamentoFinanceiroController
);

module.exports = router;
