const express = require("express");
const multer = require("multer");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const controller = require("../controllers/centralVendasController");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.get("/:slug", authMiddleware, requireAutomacoesAccess, controller.obterCentralVendas);

// M7 — Read API canonica e paginada. Aditiva: nao substitui o GET legado
// acima, que continua devolvendo o payload completo do periodo.
router.get("/:slug/read", authMiddleware, requireAutomacoesAccess, controller.obterCentralVendasRead);
router.get(
  "/:slug/read/orders/:rowId",
  authMiddleware,
  requireAutomacoesAccess,
  controller.obterCentralVendasReadOrderDetail
);
// M9 — agregados de leitura (Vendas por dia / Curva ABC), período inteiro.
router.get(
  "/:slug/read/daily",
  authMiddleware,
  requireAutomacoesAccess,
  controller.obterCentralVendasReadDaily
);
router.get(
  "/:slug/read/products",
  authMiddleware,
  requireAutomacoesAccess,
  controller.obterCentralVendasReadProducts
);

router.post(
  "/:slug/importar-vendas",
  authMiddleware,
  requireAdmin,
  upload.fields([
    { name: "sales", maxCount: 1 },
    { name: "costs", maxCount: 1 },
  ]),
  controller.importarVendas
);

// API-first: busca pedidos na Orders API do ML e persiste no banco.
// Fluxo pesado (chama API ML); GET da Central continua lendo so do banco.
// Endpoint legado (M2): por baixo agora cria um sync_run e aguarda a mesma
// execucao que o worker roda em background — resposta continua sincrona.
router.post(
  "/:slug/sincronizar",
  authMiddleware,
  requireAdmin,
  controller.sincronizarVendas
);

// M2 — Sync Run persistido: cria a execucao e responde 202 sem esperar a
// sincronizacao terminar. Mesma autorizacao do endpoint legado (admin-only).
router.post(
  "/:slug/sync-runs",
  authMiddleware,
  requireAdmin,
  controller.criarSyncRunController
);

router.get(
  "/:slug/sync-runs/:runId",
  authMiddleware,
  requireAdmin,
  controller.obterSyncRunController
);

router.get(
  "/:slug/sync-runs",
  authMiddleware,
  requireAdmin,
  controller.listarSyncRunsController
);

module.exports = router;
