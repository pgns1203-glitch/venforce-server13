// server/routes/cliente360Routes.js
// Rotas do Cliente 360. Montado em server/index.js:
//   app.use("/operacao/cliente-360", cliente360Routes);
//
// Leitura  → authMiddleware + requireAutomacoesAccess (admin/user/membro)
// Pesadas  → authMiddleware + requireAdmin (admin only)

const express = require("express");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
const controller = require("../controllers/cliente360Controller");

const router = express.Router();

// IMPORTANTE: /clientes antes de /:slug para não ser capturado como slug.
// A lista já sai filtrada pela carteira autorizada do usuário (V3 S4) —
// admin vê todos; interno só os do seu Squad; interno sem Squad vê [].
router.get("/clientes", authMiddleware, requireAutomacoesAccess, controller.listarClientesOperacional);

// Leitura (admin/user/membro) — autorização real por carteira no /:slug.
router.get("/:slug", authMiddleware, requireAutomacoesAccess, requireClienteNaCarteira("slug"), controller.obterCliente360);
router.get("/:slug/diagnosticos", authMiddleware, requireAutomacoesAccess, requireClienteNaCarteira("slug"), controller.listarDiagnosticos);
router.get("/:slug/frete-historico", authMiddleware, requireAutomacoesAccess, requireClienteNaCarteira("slug"), controller.obterFreteHistorico);
router.get("/:slug/oportunidades", authMiddleware, requireAutomacoesAccess, requireClienteNaCarteira("slug"), controller.listarOportunidades);

// Ações pesadas (admin only)
router.post("/:slug/sincronizar", authMiddleware, requireAdmin, controller.sincronizarCliente360);
router.post("/:slug/diagnostico-automatico", authMiddleware, requireAdmin, controller.gerarDiagnosticoAutomatico);

module.exports = router;
