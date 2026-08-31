// server/routes/clienteResponsaveisRoutes.js
// Montado em server/index.js: app.use("/clientes", clienteResponsaveisRoutes).
// P2.4 — Responsabilidades de Cliente (gestor / auxiliar / designer).
//
// RESPONSABILIDADE NÃO É AUTORIZAÇÃO. `requireClienteNaCarteira` aqui só
// garante que o solicitante enxerga o Cliente (mesma regra dos outros
// módulos client-scoped); a ESCRITA exige, além disso, admin ou coordenador
// do Squad do Cliente (requireResponsabilidadeAdmin no controller).
//
//   GET    /clientes/:cliente/responsaveis            leitura (carteira)
//   POST   /clientes/:cliente/responsaveis            atribuir  (admin|coord)
//   PATCH  /clientes/:cliente/responsaveis/:papel     trocar    (admin|coord)
//   DELETE /clientes/:cliente/responsaveis/:userId/:papel  remover (admin|coord)

const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
const c = require("../controllers/clienteResponsaveisController");

const router = express.Router();

const carteira = requireClienteNaCarteira("cliente");

router.use(authMiddleware);

router.get(
  "/:cliente/responsaveis",
  requireAutomacoesAccess, carteira,
  c.listar
);
router.post(
  "/:cliente/responsaveis",
  requireAutomacoesAccess, carteira, c.requireResponsabilidadeAdmin,
  c.atribuir
);
router.patch(
  "/:cliente/responsaveis/:papel",
  requireAutomacoesAccess, carteira, c.requireResponsabilidadeAdmin,
  c.trocar
);
router.delete(
  "/:cliente/responsaveis/:userId/:papel",
  requireAutomacoesAccess, carteira, c.requireResponsabilidadeAdmin,
  c.remover
);

module.exports = router;
