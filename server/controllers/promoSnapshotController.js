// server/controllers/promoSnapshotController.js
// Promo Snapshot por conta — endpoints da Central de Margem. Nenhum deles
// chama o Mercado Livre: leem o snapshot persistido; o POST de sync só
// ENFILEIRA leitura (nunca aplica promoção, nunca altera preço).
// Mesmo padrão de margemPrecificacaoController (service injetável, erro por
// statusCode, payload mascarado).

const { maskSensitiveData } = require("./motorMargemController");
const defaultRead = require("../services/promoSnapshot/promoSnapshotReadService");
const defaultOportunidades = require("../services/motorMargem/precificacao/precificacaoOportunidadesService");

function responder(res, statusCode, payload) {
  return res.status(statusCode).json(maskSensitiveData(payload));
}

function tratarErro(res, err, contexto) {
  const statusCode =
    Number.isFinite(Number(err?.statusCode)) && Number(err.statusCode) >= 400 ? Number(err.statusCode) : 500;
  if (statusCode >= 500) console.error(`[promoSnapshot] ${contexto}:`, err?.message);
  if (err?.payload) return responder(res, statusCode, err.payload);
  if (statusCode >= 500) return responder(res, 500, { ok: false, erro: "Erro interno." });
  return responder(res, statusCode, { ok: false, erro: err?.message || "Erro.", code: err?.code || null });
}

function createPromoSnapshotController({ read = defaultRead, oportunidades = defaultOportunidades } = {}) {
  function comSlug(handler, contexto) {
    return async (req, res) => {
      try {
        const clienteSlug = String(req.params.clienteSlug || "").trim().toLowerCase();
        if (!clienteSlug) return responder(res, 400, { ok: false, erro: "clienteSlug é obrigatório." });
        return await handler(req, res, clienteSlug);
      } catch (err) {
        return tratarErro(res, err, contexto);
      }
    };
  }

  const status = comSlug(async (req, res, clienteSlug) => responder(res, 200, await read.obterStatus({
    clienteSlug, clienteContaId: req.query.clienteContaId,
  })), "status");

  const snapshot = comSlug(async (req, res, clienteSlug) => responder(res, 200, await read.obterSnapshot({
    clienteSlug,
    clienteContaId: req.query.clienteContaId,
    page: req.query.page,
    limit: req.query.limit,
    itemId: req.query.itemId,
    status: req.query.status,
    tipo: req.query.tipo,
  })), "snapshot");

  const listarOportunidades = comSlug(async (req, res, clienteSlug) => responder(res, 200, await oportunidades.listarOportunidades({
    clienteSlug,
    clienteContaId: req.query.clienteContaId,
    periodo: req.query.periodo,
    page: req.query.page,
    limit: req.query.limit,
  })), "oportunidades");

  // 202: pedido aceito para processamento em background (ou reaproveitado).
  const sync = comSlug(async (req, res, clienteSlug) => {
    const b = req.body || {};
    const r = await read.solicitarSync({
      clienteSlug,
      clienteContaId: b.clienteContaId ?? b.cliente_conta_id ?? req.query.clienteContaId,
      requestedBy: req.user?.id ?? null,
    });
    return responder(res, r.enfileirado || r.reaproveitado ? 202 : 200, r);
  }, "sync");

  return { status, snapshot, listarOportunidades, sync };
}

module.exports = { createPromoSnapshotController, ...createPromoSnapshotController() };
