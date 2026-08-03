const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const controller = require("../controllers/diagnosticoInicialController");

const router = express.Router();

router.get("/", authMiddleware, controller.listarDiagnosticos);
router.get("/:id", authMiddleware, controller.obterDiagnostico);
router.post("/", authMiddleware, controller.criarDiagnostico);
router.patch("/:id", authMiddleware, controller.atualizarDiagnostico);
router.post("/:id/gerar", authMiddleware, controller.gerarDiagnostico);
router.post("/:id/concluir", authMiddleware, controller.concluirDiagnostico);

module.exports = router;
