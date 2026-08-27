const express = require("express");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const controller = require("../controllers/baseVinculosController");

const router = express.Router();

router.use(authMiddleware);

// P2.1 — leitura passou a exigir role interna (admin/user/membro): a lista de
// bases + vínculos revela cliente_slug/cliente_nome de toda a base instalada,
// o que seller/shopee_reviewer não devem ver. O controller ainda restringe as
// linhas à carteira do usuário (admin vê tudo). Escrita continua admin-only.
router.get("/", requireAutomacoesAccess, controller.listar);
router.get("/clientes", requireAutomacoesAccess, controller.listarClientes);
router.post("/", requireAdmin, controller.criar);
router.delete("/:baseId", requireAdmin, controller.remover);

module.exports = router;
