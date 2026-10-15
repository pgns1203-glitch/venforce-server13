const express = require("express");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const { statusMatrizController } = require("../controllers/integracoesMatrizController");

const router = express.Router();

router.get("/matriz/status", authMiddleware, requireAdmin, statusMatrizController);

module.exports = router;
