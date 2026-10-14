const express = require("express");
const {
  authMiddleware,
  requireAdmin,
} = require("../middlewares/authMiddleware");
const { createService } = require("../services/clientesUnificacao/service");
const { safeError } = require("../services/clientesUnificacao/contracts");
function createRouter({
  service,
  authenticate = authMiddleware,
  admin = requireAdmin,
} = {}) {
  const router = express.Router();
  router.use(authenticate, admin);
  const handle = (fn) => async (req, res) => {
    try {
      res.json({ ok: true, ...(await fn(req)) });
    } catch (raw) {
      const e = safeError(raw);
      res.status(e.statusCode).json({ ok: false, code: e.code, erro: e.code });
    }
  };
  router.post(
    "/preview",
    handle((req) => service.preview(req.body?.manifest, req.user)),
  );
  router.post(
    "/execute",
    handle(async (req) => ({
      operation: await service.execute(req.body, req.user),
    })),
  );
  router.get(
    "/candidatos",
    handle((req) => service.candidates(req.user)),
  );
  router.get(
    "/busca",
    handle((req) => service.search(req.query, req.user)),
  );
  router.get(
    "/",
    handle((req) => service.history(req.query, req.user)),
  );
  router.get(
    "/:id",
    handle(async (req) => ({
      operation: await service.detail(req.params.id, req.user),
    })),
  );
  router.post(
    "/:id/rollback",
    handle(async (req) => ({
      operation: await service.rollback(req.params.id, req.body, req.user),
    })),
  );
  return router;
}
const router = createRouter({
  service: createService({ pool: require("../config/database") }),
});
module.exports = router;
module.exports.createRouter = createRouter;
