const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
const {
  getAdsClientes,
  getAdsAcompanhamento,
  putAdsAcompanhamento,
  getAdsResumoMensal,
  putAdsResumoMensal,
  getAdsPerformance,
} = require("../controllers/adsController");

const router = express.Router();

// P2.1 — Ads já é account-aware; agora também portfolio-aware. O cliente
// chega por `clienteSlug` (query nas leituras, body nas escritas). O seam
// não toca a resolução de conta (409 de conta ambígua preservado).
const naCarteira = requireClienteNaCarteira({ query: "clienteSlug", body: "clienteSlug" });

router.get("/clientes",       authMiddleware, requireAutomacoesAccess, getAdsClientes);
router.get("/performance",    authMiddleware, requireAutomacoesAccess, naCarteira, getAdsPerformance);
router.get("/acompanhamento", authMiddleware, requireAutomacoesAccess, naCarteira, getAdsAcompanhamento);
router.put("/acompanhamento", authMiddleware, requireAutomacoesAccess, naCarteira, putAdsAcompanhamento);
router.get("/resumo-mensal",  authMiddleware, requireAutomacoesAccess, naCarteira, getAdsResumoMensal);
router.put("/resumo-mensal",  authMiddleware, requireAutomacoesAccess, naCarteira, putAdsResumoMensal);

module.exports = router;
