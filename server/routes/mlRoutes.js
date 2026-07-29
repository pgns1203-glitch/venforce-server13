// server/routes/mlRoutes.js
// Rotas Mercado Livre OAuth/API.
// Extraído de server/index.js sem alterar endpoints, payloads ou fluxo OAuth.

const express = require("express");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const {
  testarConexaoMlController,
  listarMlItemsController,
  conectarMlLegadoController,
  iniciarConexaoMlController,
  callbackMlController,
} = require("../controllers/mlController");
const {
  receberNotificacaoMlController,
} = require("../controllers/mlWebhookController");

const router = express.Router();

router.get(
  "/ml/teste/:clienteId",
  authMiddleware,
  requireAdmin,
  testarConexaoMlController
);

router.get(
  "/ml/items/:clienteId",
  authMiddleware,
  requireAdmin,
  listarMlItemsController
);

router.get(
  "/ml/conectar",
  conectarMlLegadoController
);

router.get(
  "/ml/conectar/:clienteSlug",
  iniciarConexaoMlController
);

router.get(
  "/callback",
  callbackMlController
);

// Notificações/webhooks do Mercado Livre (topic orders_v2, items, etc.).
// POST /callback é compatibilidade imediata: o app do ML hoje aponta para lá.
// POST /webhooks/meli é a rota canônica — o painel do ML será migrado para
// ela e /callback (POST) deve seguir funcionando durante a transição.
router.post(
  "/callback",
  receberNotificacaoMlController
);

router.post(
  "/webhooks/meli",
  receberNotificacaoMlController
);

module.exports = router;

