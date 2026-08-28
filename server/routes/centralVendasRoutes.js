const express = require("express");
const multer = require("multer");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
const controller = require("../controllers/centralVendasController");

const router = express.Router();

// P2.1 — autorização por carteira: toda rota da Central de Vendas é
// client-scoped por `:slug`. O seam roda depois do gate de role (admin bypass
// e seller/seller_clientes preservados pelo authorizationService) e antes do
// controller — que não repete consulta de Squad.
const naCarteira = requireClienteNaCarteira("slug");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.get("/:slug", authMiddleware, requireAutomacoesAccess, naCarteira, controller.obterCentralVendas);

// M7 — Read API canonica e paginada. Aditiva: nao substitui o GET legado
// acima, que continua devolvendo o payload completo do periodo.
router.get("/:slug/read", authMiddleware, requireAutomacoesAccess, naCarteira, controller.obterCentralVendasRead);
router.get(
  "/:slug/read/orders/:rowId",
  authMiddleware,
  requireAutomacoesAccess,
  naCarteira,
  controller.obterCentralVendasReadOrderDetail
);
// M10 — carga inicial em 1 request (ver comentário no controller). Aditiva.
router.get(
  "/:slug/read/bootstrap",
  authMiddleware,
  requireAutomacoesAccess,
  naCarteira,
  controller.obterCentralVendasReadBootstrap
);
// M9 — agregados de leitura (Vendas por dia / Curva ABC), período inteiro.
router.get(
  "/:slug/read/daily",
  authMiddleware,
  requireAutomacoesAccess,
  naCarteira,
  controller.obterCentralVendasReadDaily
);
router.get(
  "/:slug/read/products",
  authMiddleware,
  requireAutomacoesAccess,
  naCarteira,
  controller.obterCentralVendasReadProducts
);
// MP3 — conciliação Mercado Pago range-aware (resultadoConciliadoMp por
// Order). Mesma autorização das demais rotas /read (requireAutomacoesAccess),
// nunca requireAdmin — é leitura de resumo, não uma ação sobre 1 sync_run.
router.get(
  "/:slug/read/mercado-pago/reconciliation",
  authMiddleware,
  requireAutomacoesAccess,
  naCarteira,
  controller.obterCentralVendasReadMercadoPagoReconciliation
);

router.post(
  "/:slug/importar-vendas",
  authMiddleware,
  requireAdmin,
  naCarteira,
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
  naCarteira,
  controller.sincronizarVendas
);

// M2 — Sync Run persistido: cria a execucao e responde 202 sem esperar a
// sincronizacao terminar. Mesma autorizacao do endpoint legado (admin-only).
router.post(
  "/:slug/sync-runs",
  authMiddleware,
  requireAdmin,
  naCarteira,
  controller.criarSyncRunController
);

router.get(
  "/:slug/sync-runs/:runId",
  authMiddleware,
  requireAdmin,
  naCarteira,
  controller.obterSyncRunController
);

router.get(
  "/:slug/sync-runs",
  authMiddleware,
  requireAdmin,
  naCarteira,
  controller.listarSyncRunsController
);

// MP2 — conciliação Payment <-> Settlement (Mercado Pago), escopada pelo
// mesmo runId/clienteSlug validado por obterSyncRun (ver controller).
router.get(
  "/:slug/sync-runs/:runId/mercado-pago/reconciliation",
  authMiddleware,
  requireAdmin,
  naCarteira,
  controller.obterMercadoPagoReconciliationController
);

// MP2 — start/refresh idempotente do Settlement Report do run.
router.post(
  "/:slug/sync-runs/:runId/mercado-pago/settlement",
  authMiddleware,
  requireAdmin,
  naCarteira,
  controller.iniciarOuRetomarMercadoPagoSettlementController
);

module.exports = router;
