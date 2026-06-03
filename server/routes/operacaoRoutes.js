const express = require("express");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const controller = require("../controllers/operacaoController");

const router = express.Router();

router.get("/base-cobertura", authMiddleware, requireAdmin, controller.baseCobertura);

module.exports = router;
