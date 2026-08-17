const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { summary } = require("../controllers/dashboardController");

const router = express.Router();

router.get("/summary", authMiddleware, requireAutomacoesAccess, summary);

module.exports = router;
