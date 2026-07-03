// server/routes/basesRoutes.js
// Rotas do editor rápido de base de custos.

const express = require("express");
const multer = require("multer");
const { authMiddleware } = require("../middlewares/authMiddleware");

const {
  importarBaseIncrementalController,
  obterPadraoCustoBaseController,
  upsertCustoBaseController,
} = require("../controllers/basesController");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.post("/bases/:baseSlug/importar-incremental", authMiddleware, upload.single("arquivo"), importarBaseIncrementalController);
router.get("/bases/:baseSlug/custos/padrao", authMiddleware, obterPadraoCustoBaseController);
router.post("/bases/:baseSlug/custos/upsert", authMiddleware, upsertCustoBaseController);

module.exports = router;
