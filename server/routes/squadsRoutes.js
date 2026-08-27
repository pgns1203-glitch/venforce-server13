// server/routes/squadsRoutes.js
// Montado em server/index.js: app.use("/squads", squadsRoutes).
// APIs administrativas de Squads (mission §24). Sem frontend nesta fase.
//
// authMiddleware sempre. Depois:
//   requireAdmin        -> criar/desativar squad, transferir cliente, auditoria
//   requireSquadAdmin   -> admin OU coordenador do :id (membros, atribuir
//                          cliente do proprio squad, editar nome)
//   qualquer autenticado -> listar (filtrado), historico de cliente

const express = require("express");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const c = require("../controllers/squadsController");

const router = express.Router();
router.use(authMiddleware);

// Migração — admin-only. Antes de /:id para não ser capturado.
router.get("/migracao/auditoria", requireAdmin, c.auditoriaMigracao);

// Histórico de squad de um cliente — admin-only (dado transversal).
router.get("/clientes/:clienteId/historico", requireAdmin, c.historicoCliente);

// Squads
router.get("/", c.listar);
router.post("/", requireAdmin, c.criar);
router.get("/:id", c.obter);
router.patch("/:id", c.requireSquadAdmin, c.editar);
router.patch("/:id/ativo", requireAdmin, c.definirAtivo);

// Membros
router.get("/:id/membros", c.requireSquadAdmin, c.listarMembros);
router.post("/:id/membros", c.requireSquadAdmin, c.adicionarMembro);
router.delete("/:id/membros/:userId", c.requireSquadAdmin, c.removerMembro);
router.patch("/:id/membros/:userId/principal", c.requireSquadAdmin, c.definirPrincipal);
router.patch("/:id/membros/:userId/funcao", requireAdmin, c.definirFuncao);

// Clientes do squad
router.get("/:id/clientes", c.requireSquadAdmin, c.listarClientes);
router.post("/:id/clientes", c.requireSquadAdmin, c.atribuirCliente);
// Transferência para este squad (destino) — admin-only (§26).
router.post("/:id/clientes/:clienteId/transferir", requireAdmin, c.transferirCliente);

module.exports = router;
