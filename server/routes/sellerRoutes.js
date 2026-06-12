// server/routes/sellerRoutes.js
// Rotas da área Seller. Montado em server/index.js:
//   app.use("/seller", sellerRoutes);
//
// Segurança em camadas:
//   1. authMiddleware       → JWT válido + usuário ativo (sempre).
//   2. requireAdmin         → gestão de vínculos seller ↔ cliente.
//   3. requireSellerAccess  → área do seller (role seller ou admin).
//   4. sellerService        → TODA query filtra por seller_clientes do
//      usuário logado; cliente_slug do front nunca é confiado sozinho.

const express = require("express");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const { requireSellerAccess } = require("../middlewares/accessMiddleware");
const controller = require("../controllers/sellerController");

const router = express.Router();

router.use(authMiddleware);

// ── Gestão de vínculos seller ↔ cliente (ADMIN ONLY) ──
router.get("/vinculos", requireAdmin, controller.listarVinculos);
router.post("/vinculos", requireAdmin, controller.criarVinculo);
router.delete("/vinculos/:id", requireAdmin, controller.removerVinculo);

// ── Área do seller (role seller ou admin) ──
router.get("/me", requireSellerAccess, controller.me);
router.get("/produtos-sem-base", requireSellerAccess, controller.produtosSemBase);
router.post("/custos", requireSellerAccess, controller.enviarCusto);
router.get("/custos-submissoes", requireSellerAccess, controller.listarSubmissoes);

module.exports = router;
