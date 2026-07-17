const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const controller = require("../controllers/operacaoController");

const router = express.Router();

router.get("/base-cobertura", authMiddleware, controller.baseCobertura);

module.exports = router;
