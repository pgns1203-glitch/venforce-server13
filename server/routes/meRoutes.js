// server/routes/meRoutes.js
// VenForce V3 — GET /me/context (boot de toda página) e GET /me/portfolio
// (Carteira). Auth: qualquer usuário autenticado — o payload é dele mesmo;
// nunca 403 por falta de carteira (usuário sem clientes recebe `clientes: []`,
// que é NO_PORTFOLIO no frontend, não erro). Ver Master Spec §18.2.
const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const controller = require("../controllers/meController");

const router = express.Router();

router.use(authMiddleware);

router.get("/context", controller.contexto);
router.get("/portfolio", controller.portfolio);

module.exports = router;
