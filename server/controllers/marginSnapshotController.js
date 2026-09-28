// server/controllers/marginSnapshotController.js
// Controller do Margin Snapshot (Central de Margem lida do banco).
//
// Mesmo padrão de fábrica de fullController: o service é injetável (testes
// usam um fake sem DB/rede); a exportação padrão usa o service real. Mesma
// máscara de campos sensíveis e `tratarErro` por `statusCode` do
// motorMargemController.

const { maskSensitiveData } = require("./motorMargemController");
const defaultService = require("../services/motorMargem/marginSnapshotApiService");

function responder(res, statusCode, payload) {
  return res.status(statusCode).json(maskSensitiveData(payload));
}

function tratarErro(res, err, contexto) {
  const statusCode =
    Number.isFinite(Number(err?.statusCode)) && Number(err.statusCode) >= 400 ? Number(err.statusCode) : 500;
  if (statusCode >= 500) console.error(`[marginSnapshot] ${contexto}:`, err?.message);
  if (err?.payload) return responder(res, statusCode, err.payload);
  if (statusCode >= 500) return responder(res, 500, { ok: false, erro: "Erro interno." });
  return responder(res, statusCode, { ok: false, erro: err?.message || "Erro.", code: err?.code || null });
}

function slugParam(req) {
  return String(req.params.clienteSlug || "").trim().toLowerCase();
}

function createMarginSnapshotController({ service = defaultService } = {}) {
  /** POST /:clienteSlug/snapshot/refresh — 202 + runId, nunca espera o cálculo. */
  async function solicitarRefresh(req, res) {
    try {
      const clienteSlug = slugParam(req);
      if (!clienteSlug) return responder(res, 400, { ok: false, erro: "clienteSlug é obrigatório." });
      const data = await service.solicitarRefresh({
        clienteSlug,
        clienteContaId: req.body?.clienteContaId ?? req.body?.cliente_conta_id,
        requestedBy: req.user?.id ?? null,
      });
      return responder(res, 202, data);
    } catch (err) {
      return tratarErro(res, err, "solicitarRefresh");
    }
  }

  /** GET /:clienteSlug/snapshot/refresh/:runId?clienteContaId= — progresso. */
  async function obterStatusRefresh(req, res) {
    try {
      const clienteSlug = slugParam(req);
      if (!clienteSlug) return responder(res, 400, { ok: false, erro: "clienteSlug é obrigatório." });
      const data = await service.obterStatusRefresh({
        clienteSlug,
        clienteContaId: req.query.clienteContaId,
        runId: req.params.runId,
      });
      return responder(res, 200, data);
    } catch (err) {
      return tratarErro(res, err, "obterStatusRefresh");
    }
  }

  return { solicitarRefresh, obterStatusRefresh };
}

module.exports = { createMarginSnapshotController, ...createMarginSnapshotController() };
