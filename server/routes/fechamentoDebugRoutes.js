// server/routes/fechamentoDebugRoutes.js
// Rota do Debug Financeiro (Fechamento Inspector) — ADMIN ONLY, ponta a ponta.
//
// Arquivo separado de fechamentosFinanceiroRoutes.js de propósito: o
// fechamento real (POST /fechamentos/financeiro) não precisa saber que esta
// rota existe, e esta rota nunca é montada/usada pelo fluxo de produção.
// Mesmo prefixo (/fechamentos) — dois routers Express podem coexistir nele.

const express = require("express");
const multer = require("multer");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const { debugFechamentoFinanceiroController } = require("../controllers/fechamentoDebugController");

const router = express.Router();

// Upload livre: o Debug Financeiro classifica o PAPEL de cada arquivo pelo
// conteúdo, não pelo nome do campo — por isso um único campo "files[]",
// diferente do upload rígido (sales/costs/ordersAll/onhold) do fechamento real.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 12 },
});

router.post(
  "/financeiro/debug",
  authMiddleware,
  requireAdmin,
  upload.array("files", 12),
  debugFechamentoFinanceiroController
);

module.exports = router;
