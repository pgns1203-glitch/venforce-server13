// server/controllers/motorMargemController.js
// Controller READ-ONLY da Central de Margem.
//
// Segue o padrão dos controllers existentes (centralVendasController):
// máscara de campos sensíveis, `responder`, `tratarErro` com `statusCode`.
// Nenhuma rota de escrita — preço/promoção/base não são alterados aqui.

const motorMargemService = require("../services/motorMargem/motorMargemService");

const CAMPOS_SENSIVEIS = new Set([
  "access_token", "refresh_token", "api_key", "apikey", "password",
  "authorization", "token", "secret", "client_secret",
]);

function maskSensitiveData(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(maskSensitiveData);
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (CAMPOS_SENSIVEIS.has(String(key).toLowerCase())) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = maskSensitiveData(value);
    }
  }
  return out;
}

function responder(res, statusCode, payload) {
  return res.status(statusCode).json(maskSensitiveData(payload));
}

function tratarErro(res, err, contexto) {
  const statusCode =
    Number.isFinite(Number(err?.statusCode)) && Number(err.statusCode) >= 400
      ? Number(err.statusCode)
      : 500;
  if (statusCode >= 500) console.error(`[motorMargem] ${contexto}:`, err?.message);
  // Erros de contexto (sem grant ML, sem base vinculada) já vêm com `payload`
  // e `codigo` do contextoPrecificacaoService — a Central usa o código para
  // mostrar a ação certa em vez de um erro genérico.
  if (err?.payload) return responder(res, statusCode, err.payload);
  return responder(res, statusCode, { ok: false, erro: err?.message || "Erro interno." });
}

function slugParam(req) {
  return String(req.params.clienteSlug || "").trim().toLowerCase();
}

function periodoQuery(req) {
  return {
    dateFrom: req.query.dateFrom,
    dateTo: req.query.dateTo,
    margemAlvo: req.query.margemAlvo,
    baseSlug: req.query.baseSlug,
  };
}

async function obterContexto(req, res) {
  try {
    const clienteSlug = slugParam(req);
    if (!clienteSlug) return responder(res, 400, { ok: false, erro: "clienteSlug é obrigatório." });
    const data = await motorMargemService.obterContextoMargem({
      clienteSlug,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
    });
    return responder(res, 200, data);
  } catch (err) {
    return tratarErro(res, err, "obterContexto");
  }
}

/**
 * Raiz da Central: resumo da página + itens no mesmo payload.
 * Aceita os aliases de query do frontend (`q` = busca, `view` = ordenação).
 */
async function obterCentral(req, res) {
  try {
    const clienteSlug = slugParam(req);
    if (!clienteSlug) return responder(res, 400, { ok: false, erro: "clienteSlug é obrigatório." });
    const data = await motorMargemService.obterCentralMargem({
      clienteSlug,
      ...periodoQuery(req),
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
      confianca: req.query.confianca,
      busca: req.query.busca || req.query.q,
      ordenacao: req.query.ordenacao,
      comDivergencia: req.query.comDivergencia,
      semCusto: req.query.semCusto,
    });
    return responder(res, 200, data);
  } catch (err) {
    return tratarErro(res, err, "obterCentral");
  }
}

async function listarItens(req, res) {
  try {
    const clienteSlug = slugParam(req);
    if (!clienteSlug) return responder(res, 400, { ok: false, erro: "clienteSlug é obrigatório." });
    const data = await motorMargemService.listarItens({
      clienteSlug,
      ...periodoQuery(req),
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
      confianca: req.query.confianca,
      busca: req.query.busca,
      ordenacao: req.query.ordenacao,
      comDivergencia: req.query.comDivergencia,
      semCusto: req.query.semCusto,
    });
    return responder(res, 200, data);
  } catch (err) {
    return tratarErro(res, err, "listarItens");
  }
}

/**
 * Workspace: uma única varredura (batches <=20 no ML) que alimenta planilha,
 * filtros, KPIs e fila de divergências no frontend. Paginação visual e
 * filtro/busca acontecem no cliente sobre o array `itens` inteiro.
 */
async function obterWorkspace(req, res) {
  try {
    const clienteSlug = slugParam(req);
    if (!clienteSlug) return responder(res, 400, { ok: false, erro: "clienteSlug é obrigatório." });
    const data = await motorMargemService.obterWorkspace({
      clienteSlug,
      ...periodoQuery(req),
      maxItens: req.query.maxItens,
    });
    return responder(res, 200, data);
  } catch (err) {
    return tratarErro(res, err, "obterWorkspace");
  }
}

async function obterResumo(req, res) {
  try {
    const clienteSlug = slugParam(req);
    if (!clienteSlug) return responder(res, 400, { ok: false, erro: "clienteSlug é obrigatório." });
    const data = await motorMargemService.obterResumo({
      clienteSlug,
      ...periodoQuery(req),
      maxItens: req.query.maxItens,
    });
    return responder(res, 200, data);
  } catch (err) {
    return tratarErro(res, err, "obterResumo");
  }
}

async function obterItem(req, res) {
  try {
    const clienteSlug = slugParam(req);
    if (!clienteSlug) return responder(res, 400, { ok: false, erro: "clienteSlug é obrigatório." });
    const data = await motorMargemService.obterItem({
      clienteSlug,
      itemId: req.params.itemId,
      ...periodoQuery(req),
    });
    return responder(res, 200, data);
  } catch (err) {
    return tratarErro(res, err, "obterItem");
  }
}

/** Evidências e divergências de um item, sem o resto do contrato. */
async function obterEvidencias(req, res) {
  try {
    const clienteSlug = slugParam(req);
    if (!clienteSlug) return responder(res, 400, { ok: false, erro: "clienteSlug é obrigatório." });
    const data = await motorMargemService.obterItem({
      clienteSlug,
      itemId: req.params.itemId,
      ...periodoQuery(req),
    });
    const { item } = data;
    return responder(res, 200, {
      ok: true,
      cliente: data.cliente,
      periodo: data.periodo,
      identity: item.identity,
      confidence: item.quality.confidence,
      confidenceByField: item.quality.confidenceByField,
      divergences: item.quality.divergences,
      reasons: item.quality.reasons,
      evidencias: {
        price: item.pricing,
        costs: item.costs,
        marketplaceCosts: item.marketplaceCosts,
        settlement: item.settlement,
      },
      diagnostico: item.diagnostico,
    });
  } catch (err) {
    return tratarErro(res, err, "obterEvidencias");
  }
}

module.exports = {
  obterCentral,
  obterContexto,
  listarItens,
  obterResumo,
  obterWorkspace,
  obterItem,
  obterEvidencias,
  maskSensitiveData,
};
