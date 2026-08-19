const express = require("express");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const controller = require("../controllers/baseVinculosController");

const router = express.Router();

router.use(authMiddleware);

// Leitura fica para qualquer autenticado (mesma política atual). Escrita
// (vincular/trocar/remover vínculo) é estrutura/identidade da base — alinhada
// à mesma regra admin-only já aplicada em PUT /cliente-contas/:id/base
// (achado P1 da auditoria: o legado aceitava qualquer autenticado enquanto o
// caminho account-aware novo já exigia admin).
router.get("/", controller.listar);
router.get("/clientes", controller.listarClientes);
router.post("/", requireAdmin, controller.criar);
router.delete("/:baseId", requireAdmin, controller.remover);

module.exports = router;
