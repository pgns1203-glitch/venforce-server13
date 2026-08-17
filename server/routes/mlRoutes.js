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
  iniciarConexaoContaMlController,
  callbackMlController,
  listarMlTokensAdminController,
  definirGrantPrincipalController,
  revelarCredenciaisGrantController,
  testarGrantAdminController,
  statusClienteMlController,
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

// Fundação de Contas: link account-scoped, identifica a cliente_conta
// específica (não o cliente todo). Mantém o legado acima intacto por
// compatibilidade — /clientes.html usa exclusivamente esta rota nova.
router.get(
  "/ml/conectar-conta/:clienteContaId",
  iniciarConexaoContaMlController
);

router.get(
  "/callback",
  callbackMlController
);

router.get(
  "/admin/ml-tokens",
  authMiddleware,
  requireAdmin,
  listarMlTokensAdminController
);

router.patch(
  "/admin/ml-tokens/:tokenId/principal",
  authMiddleware,
  requireAdmin,
  definirGrantPrincipalController
);

router.post(
  "/admin/ml-tokens/:tokenId/testar",
  authMiddleware,
  requireAdmin,
  testarGrantAdminController
);

// Área dev-admin explícita: access_token/refresh_token só saem daqui, nunca
// de /admin/ml-tokens (listagem) ou das rotas de cliente-contas.
router.get(
  "/admin/ml-tokens/:tokenId/credentials",
  authMiddleware,
  requireAdmin,
  revelarCredenciaisGrantController
);

router.get(
  "/clientes/:slug/ml-status",
  authMiddleware,
  requireAdmin,
  statusClienteMlController
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
