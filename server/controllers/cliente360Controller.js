// server/controllers/cliente360Controller.js
// Handlers finos do Cliente 360. Validam params, chamam o service e aplicam
// máscara final em dados sensíveis antes de responder. Sem SQL pesado aqui.

const service = require("../services/cliente360/cliente360Service");
const syncService = require("../services/cliente360/cliente360SyncService");

// Guard final: remove recursivamente qualquer campo sensível que escape do service.
const CAMPOS_SENSIVEIS = new Set([
  "access_token", "refresh_token", "api_key", "apikey", "password",
  "authorization", "token", "secret", "client_secret",
]);

function maskSensitiveData(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(maskSensitiveData);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (CAMPOS_SENSIVEIS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = maskSensitiveData(v);
    }
  }
  return out;
}

function responder(res, statusCode, payload) {
  return res.status(statusCode).json(maskSensitiveData(payload));
}

function tratarErro(res, err, contexto) {
  const status = err?.statusCode || 500;
  if (status >= 500) console.error(`[cliente360] ${contexto}:`, err?.message);
  const body = { ok: false, erro: err?.message || "Erro interno." };
  if (err?.jobId) body.jobId = err.jobId;
  return responder(res, status, body);
}

function slugParam(req) {
  return String(req.params.slug || "").trim().toLowerCase();
}

// GET /operacao/cliente-360/clientes
async function listarClientesOperacional(req, res) {
  try {
    const data = await service.getClientesOperacional();
    return responder(res, 200, data);
  } catch (err) {
    return tratarErro(res, err, "listarClientesOperacional");
  }
}

// GET /operacao/cliente-360/:slug
async function obterCliente360(req, res) {
  try {
    const slug = slugParam(req);
    if (!slug) return responder(res, 400, { ok: false, erro: "slug é obrigatório." });
    const data = await service.getCliente360(slug, { competencia: req.query.competencia });
    return responder(res, 200, data);
  } catch (err) {
    return tratarErro(res, err, "obterCliente360");
  }
}

// POST /operacao/cliente-360/:slug/sincronizar  (admin only)
async function sincronizarCliente360(req, res) {
  try {
    const slug = slugParam(req);
    if (!slug) return responder(res, 400, { ok: false, erro: "slug é obrigatório." });
    const competencia = req.body?.competencia || null;
    const data = await syncService.sincronizarResumoMensal(slug, competencia, req.user?.id);
    return responder(res, 200, data);
  } catch (err) {
    return tratarErro(res, err, "sincronizarCliente360");
  }
}

// POST /operacao/cliente-360/:slug/diagnostico-automatico  (admin only)
async function gerarDiagnosticoAutomatico(req, res) {
  try {
    const slug = slugParam(req);
    if (!slug) return responder(res, 400, { ok: false, erro: "slug é obrigatório." });
    const data = await service.gerarDiagnosticoPersistido(
      slug, { competencia: req.body?.competencia }, req.user?.id
    );
    return responder(res, 201, data);
  } catch (err) {
    return tratarErro(res, err, "gerarDiagnosticoAutomatico");
  }
}

// GET /operacao/cliente-360/:slug/diagnosticos
async function listarDiagnosticos(req, res) {
  try {
    const slug = slugParam(req);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const data = await service.getDiagnosticos(slug, limit);
    return responder(res, 200, data);
  } catch (err) {
    return tratarErro(res, err, "listarDiagnosticos");
  }
}

// GET /operacao/cliente-360/:slug/frete-historico
async function obterFreteHistorico(req, res) {
  try {
    const slug = slugParam(req);
    const data = await service.getFreteHistorico(slug, { competencia: req.query.competencia });
    return responder(res, 200, data);
  } catch (err) {
    return tratarErro(res, err, "obterFreteHistorico");
  }
}

// GET /operacao/cliente-360/:slug/oportunidades
async function listarOportunidades(req, res) {
  try {
    const slug = slugParam(req);
    const data = await service.getOportunidades(slug, { competencia: req.query.competencia });
    return responder(res, 200, data);
  } catch (err) {
    return tratarErro(res, err, "listarOportunidades");
  }
}

module.exports = {
  listarClientesOperacional,
  obterCliente360,
  sincronizarCliente360,
  gerarDiagnosticoAutomatico,
  listarDiagnosticos,
  obterFreteHistorico,
  listarOportunidades,
};
