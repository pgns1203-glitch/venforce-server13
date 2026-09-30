// server/controllers/margemPrecificacaoController.js
// Controller da camada segura de precificação da Central de Margem.
// Mesmo padrão de marginSnapshotController: service injetável (testes sem
// DB/ML), `tratarErro` por `statusCode`, payload mascarado.

const { maskSensitiveData } = require("./motorMargemController");
const defaultService = require("../services/motorMargem/precificacao/precificacaoService");
const defaultOportunidades = require("../services/motorMargem/precificacao/precificacaoOportunidadesService");
const { extrairIp } = require("../services/activityLogService");

function responder(res, statusCode, payload) {
  return res.status(statusCode).json(maskSensitiveData(payload));
}

function tratarErro(res, err, contexto) {
  const statusCode =
    Number.isFinite(Number(err?.statusCode)) && Number(err.statusCode) >= 400 ? Number(err.statusCode) : 500;
  if (statusCode >= 500 && statusCode !== 502) console.error(`[margemPrecificacao] ${contexto}:`, err?.message);
  if (err?.payload) return responder(res, statusCode, err.payload);
  if (statusCode >= 500) return responder(res, 500, { ok: false, erro: "Erro interno.", motivo: "Erro interno." });
  return responder(res, statusCode, { ok: false, erro: err?.message || "Erro.", motivo: err?.message || "Erro.", code: err?.code || null });
}

function slugParam(req) {
  return String(req.params.clienteSlug || "").trim().toLowerCase();
}

function usuario(req) {
  const u = req.user || {};
  return { id: u.id ?? null, nome: u.nome || u.name || null, email: u.email || null };
}

function createMargemPrecificacaoController({ service = defaultService, oportunidades = defaultOportunidades } = {}) {
  function comSlug(handler, contexto) {
    return async (req, res) => {
      try {
        const clienteSlug = slugParam(req);
        if (!clienteSlug) return responder(res, 400, { ok: false, erro: "clienteSlug é obrigatório." });
        return await handler(req, res, clienteSlug);
      } catch (err) {
        return tratarErro(res, err, contexto);
      }
    };
  }

  function corpoAvaliacao(req, clienteSlug, tipoForcado) {
    const b = req.body || {};
    return {
      clienteSlug,
      clienteContaId: b.clienteContaId ?? b.cliente_conta_id,
      itemId: b.itemId,
      tipo: tipoForcado || b.tipo,
      novoPreco: b.novoPreco,
      precoVisto: b.precoVisto,
      promotionId: req.params.promotionId ?? b.promotionId,
      user: usuario(req),
    };
  }

  const simular = comSlug(async (req, res, clienteSlug) => {
    return responder(res, 200, await service.simular(corpoAvaliacao(req, clienteSlug)));
  }, "simular");

  const preview = comSlug(async (req, res, clienteSlug) => {
    return responder(res, 200, await service.preview(corpoAvaliacao(req, clienteSlug)));
  }, "preview");

  const previewPromocao = comSlug(async (req, res, clienteSlug) => {
    return responder(res, 200, await service.preview(corpoAvaliacao(req, clienteSlug, "PROMOTION")));
  }, "previewPromocao");

  const aplicar = comSlug(async (req, res, clienteSlug) => {
    const b = req.body || {};
    const data = await service.aplicar({
      clienteSlug,
      clienteContaId: b.clienteContaId ?? b.cliente_conta_id,
      previewId: b.previewId,
      idempotencyKey: b.idempotencyKey,
      promotionId: req.params.promotionId,
      user: usuario(req),
      ip: extrairIp(req),
    });
    // Recusa/falha esperada: 200 + ok:false (mesmo contrato de /anuncios).
    return responder(res, 200, data);
  }, "aplicar");

  const historico = comSlug(async (req, res, clienteSlug) => {
    return responder(res, 200, await service.historico({
      clienteSlug,
      clienteContaId: req.query.clienteContaId,
      itemId: req.query.itemId,
      limit: req.query.limit,
    }));
  }, "historico");

  const obterAplicacao = comSlug(async (req, res, clienteSlug) => {
    return responder(res, 200, await service.obterAplicacao({
      clienteSlug,
      clienteContaId: req.query.clienteContaId,
      id: req.params.aplicacaoId,
    }));
  }, "obterAplicacao");

  const promocoes = comSlug(async (req, res, clienteSlug) => {
    return responder(res, 200, await service.promocoes({
      clienteSlug,
      clienteContaId: req.query.clienteContaId,
      itemId: req.query.itemId,
    }));
  }, "promocoes");

  const listarOportunidades = comSlug(async (req, res, clienteSlug) => {
    return responder(res, 200, await oportunidades.listarOportunidades({
      clienteSlug,
      clienteContaId: req.query.clienteContaId,
      periodo: req.query.periodo,
      limit: req.query.limit,
    }));
  }, "oportunidades");

  return { simular, preview, previewPromocao, aplicar, historico, obterAplicacao, promocoes, listarOportunidades };
}

module.exports = { createMargemPrecificacaoController, ...createMargemPrecificacaoController() };
