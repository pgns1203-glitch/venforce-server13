// server/routes/cliente360Routes.js
// Rotas do Cliente 360. Montado em server/index.js:
//   app.use("/operacao/cliente-360", cliente360Routes);
//
// Leitura  → authMiddleware + requireAutomacoesAccess (admin/user/membro)
// Pesadas  → authMiddleware + requireAdmin (admin only)

const express = require("express");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const controller = require("../controllers/cliente360Controller");

const router = express.Router();

// IMPORTANTE: /clientes antes de /:slug para não ser capturado como slug.
router.get("/clientes", authMiddleware, requireAutomacoesAccess, controller.listarClientesOperacional);

// Leitura (admin/user/membro)
router.get("/:slug", authMiddleware, requireAutomacoesAccess, controller.obterCliente360);
router.get("/:slug/diagnosticos", authMiddleware, requireAutomacoesAccess, controller.listarDiagnosticos);
router.get("/:slug/frete-historico", authMiddleware, requireAutomacoesAccess, controller.obterFreteHistorico);
router.get("/:slug/oportunidades", authMiddleware, requireAutomacoesAccess, controller.listarOportunidades);

// Ações pesadas (admin only)
router.post("/:slug/sincronizar", authMiddleware, requireAdmin, controller.sincronizarCliente360);
router.post("/:slug/diagnostico-automatico", authMiddleware, requireAdmin, controller.gerarDiagnosticoAutomatico);

module.exports = router;
