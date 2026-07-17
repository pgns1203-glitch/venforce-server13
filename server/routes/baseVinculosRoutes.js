const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const controller = require("../controllers/baseVinculosController");

const router = express.Router();

router.use(authMiddleware);

router.get("/", controller.listar);
router.get("/clientes", controller.listarClientes);
router.post("/", controller.criar);
router.delete("/:baseId", controller.remover);

module.exports = router;
