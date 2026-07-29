// server/routes/observabilityRoutes.js
// Todas as rotas de observabilidade são admin-only. A API é a autoridade da
// permissão — esconder o link no menu é só conveniência visual.

const express = require("express");
const router = express.Router();

const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const controller = require("../controllers/observabilityController");

router.use(authMiddleware, requireAdmin);

router.get("/summary", controller.getSummary);
router.get("/requests", controller.listRequests);
router.get("/requests/:requestId", controller.getRequestDetail);
router.get("/errors", controller.getErrors);
router.get("/sessions", controller.getSessions);
router.post("/client-events", controller.ingestClientEvents);
router.get("/health", controller.getHealth);
router.post("/health/check", controller.postHealthCheck);
router.get("/routes", controller.getRoutes);
router.get("/routes/stats", controller.getRouteStats);
router.get("/export", controller.getExport);
router.post("/purge", controller.postPurge);

module.exports = router;
