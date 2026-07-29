const express = require("express");
const multer = require("multer");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireDesignAccess } = require("../middlewares/accessMiddleware");
const controller = require("../controllers/designImageController");
const validator = require("../services/designImage/designImageValidator");

const router = express.Router();

// Memória, igual ao restante do servidor: nada toca o disco efêmero do Render.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: validator.MAX_UPLOAD_BYTES, files: 1 },
});

// Erros do Multer (arquivo grande, campo inesperado) viram o mesmo formato
// de resposta dos demais erros do módulo, em vez de estourar como 500.
function tratarErroUpload(err, req, res, next) {
  if (!err) return next();
  if (err.code === "LIMIT_FILE_SIZE") {
    const limite = Math.round(validator.MAX_UPLOAD_BYTES / (1024 * 1024));
    return res.status(413).json({
      ok: false,
      erro: `Imagem muito grande. O limite é de ${limite} MB.`,
      codigo: "ARQUIVO_GRANDE",
    });
  }
  if (err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT") {
    return res.status(400).json({
      ok: false,
      erro: "Envie exatamente um arquivo no campo \"imagem\".",
      codigo: "CAMPO_INVALIDO",
    });
  }
  return next(err);
}

router.get("/capacidades", authMiddleware, requireDesignAccess, controller.obterCapacidades);

router.post(
  "/normalizar",
  authMiddleware,
  requireDesignAccess,
  upload.single("imagem"),
  tratarErroUpload,
  controller.normalizarImagem
);

router.post("/ia/:operacao", authMiddleware, requireDesignAccess, controller.executarIa);

module.exports = router;
