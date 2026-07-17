const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const controller = require("../controllers/diagnosticoInicialController");

const router = express.Router();

router.get("/", authMiddleware, requireAutomacoesAccess, controller.listarDiagnosticos);
router.get("/:id", authMiddleware, requireAutomacoesAccess, controller.obterDiagnostico);
router.post("/", authMiddleware, requireAutomacoesAccess, controller.criarDiagnostico);
router.patch("/:id", authMiddleware, requireAutomacoesAccess, controller.atualizarDiagnostico);
router.post("/:id/gerar", authMiddleware, requireAutomacoesAccess, controller.gerarDiagnostico);
router.post("/:id/concluir", authMiddleware, requireAutomacoesAccess, controller.concluirDiagnostico);

module.exports = router;
