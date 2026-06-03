const express = require("express");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const controller = require("../controllers/baseVinculosController");

const router = express.Router();

router.use(authMiddleware, requireAdmin);

router.get("/", controller.listar);
router.post("/", controller.criar);
router.delete("/:baseId", controller.remover);

module.exports = router;
