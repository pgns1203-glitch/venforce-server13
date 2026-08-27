// server/routes/basesRoutes.js
// Rotas do editor rápido de base de custos.

const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireBaseNaCarteira } = require("../middlewares/carteiraMiddleware");

const {
  obterPadraoCustoBaseController,
  upsertCustoBaseController,
} = require("../controllers/basesController");

const router = express.Router();

// P2.1 — o editor rápido de custos ficava só atrás de authMiddleware
// (qualquer autenticado, inclusive seller/shopee_reviewer). Agora:
//   1. gate de role (admin/user/membro);
//   2. carteira: só mexe na base quem cobre ao menos um cliente vinculado
//      a ela (admin bypass; base órfã liberada às roles internas).
const naCarteira = requireBaseNaCarteira("baseSlug", { bySlug: true });

router.get("/bases/:baseSlug/custos/padrao", authMiddleware, requireAutomacoesAccess, naCarteira, obterPadraoCustoBaseController);
router.post("/bases/:baseSlug/custos/upsert", authMiddleware, requireAutomacoesAccess, naCarteira, upsertCustoBaseController);

module.exports = router;
