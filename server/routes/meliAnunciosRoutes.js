// server/routes/meliAnunciosRoutes.js
// -----------------------------------------------------------------------------
// Módulo: Anúncios Meli — rotas.
//
// Montagem esperada em server/index.js:
//   const meliAnunciosRoutes = require("./routes/meliAnunciosRoutes");
//   app.use("/anuncios-meli", meliAnunciosRoutes);
//
// Proteção: mesma do módulo Ads / Automações
//   authMiddleware + requireAutomacoesAccess  (admin | user | membro)
//
// Endpoints finais:
//   GET    /anuncios-meli/clientes
//   POST   /anuncios-meli/sync
//   GET    /anuncios-meli/resumo
//   GET    /anuncios-meli
//   GET    /anuncios-meli/:itemId
//   PATCH  /anuncios-meli/:itemId/revisao
// -----------------------------------------------------------------------------

const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const ctrl = require("../controllers/meliAnunciosController");

// Todas as rotas exigem usuário autenticado com acesso a automações.
router.use(authMiddleware, requireAutomacoesAccess);

// Rotas estáticas declaradas ANTES de "/:itemId" para evitar conflito.
router.get("/clientes", ctrl.listarClientes);
router.post("/sync", ctrl.sincronizar);
router.get("/resumo", ctrl.resumo);
router.get("/", ctrl.listar);

router.get("/:itemId", ctrl.detalhe);
router.patch("/:itemId/revisao", ctrl.marcarRevisado);

module.exports = router;
