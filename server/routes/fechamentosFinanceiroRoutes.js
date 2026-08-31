// server/routes/fechamentosFinanceiroRoutes.js
// Rotas de fechamento financeiro.
// Mantém POST /fechamentos/financeiro quando montado em /fechamentos.

const express = require("express");
const multer = require("multer");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
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
  // P2.1 — exige role interna. É um processador stateless de planilha enviada
  // pelo usuário; não lê dados por id (só custos da base, que já são scoped
  // por cliente_slug em resolverBaseVinculada).
  requireAutomacoesAccess,
  upload.fields([
    { name: "sales", maxCount: 1 },
    { name: "costs", maxCount: 1 },
    { name: "ordersAll", maxCount: 1 },
    // Onhold do TikTok Shop: opcional e com campo próprio — não reaproveita
    // ordersAll (Shopee), que tem semântica diferente.
    { name: "onhold", maxCount: 1 },
  ]),
  // V3 Pós-Convergência #2 — BLOCO 8/15: a "dívida aceitável" de carteira
  // deste POST deixa de ser dívida. DEPOIS do multer (o cliente_slug vem no
  // corpo multipart) e antes do controller: quando `cliente_slug` é
  // informado, ele TEM que estar na carteira do usuário (pass-through se
  // ausente — upload legado sem slug segue funcionando; com SQUADS_ENFORCEMENT
  // OFF, vira só "o cliente precisa existir"). A validação de que a
  // ClienteConta pertence ao cliente é feita no controller (erro canônico).
  requireClienteNaCarteira({ body: "cliente_slug", query: "cliente_slug" }),
  processarFechamentoFinanceiroController
);

module.exports = router;
