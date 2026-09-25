// server/controllers/painelContasController.js
// Handlers FINOS do Painel de Controle de Contas por Squad. Nenhuma regra
// financeira aqui — mora inteira em painelContasService/painelContasMetricas.
// Padrão espelhado de cliente360ResultadoController.js (mesmo guard final de
// máscara de dados sensíveis).

const service = require("../services/painelContas/painelContasService");

const CAMPOS_SENSIVEIS = new Set([
  "access_token", "refresh_token", "api_key", "apikey", "password",
  "authorization", "token", "secret", "client_secret",
]);

function maskSensitiveData(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(maskSensitiveData);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = CAMPOS_SENSIVEIS.has(k.toLowerCase()) ? "[REDACTED]" : maskSensitiveData(v);
  }
  return out;
}

function responder(res, code, body) {
  return res.status(code).json(maskSensitiveData(body));
}

function tratarErro(res, err, ctx) {
  const status = Number.isFinite(Number(err?.statusCode)) ? Number(err.statusCode) : 500;
  if (status >= 500) console.error(`[painelContas] ${ctx}:`, err?.message);
  return responder(res, status, { ok: false, code: err?.code, erro: err?.message || "Erro interno." });
}

// GET /painel-contas?ano=&squadId=&busca=
async function listar(req, res) {
  try {
    const data = await service.listar(req.user || {}, {
      ano: req.query.ano,
      squadId: req.query.squadId,
      busca: req.query.busca,
    });
    return responder(res, 200, data);
  } catch (err) { return tratarErro(res, err, "listar"); }
}

// GET /painel-contas/:clienteId/meses?ano=
async function listarMeses(req, res) {
  try {
    const data = await service.listarMeses(req.user || {}, req.params.clienteId, { ano: req.query.ano });
    return responder(res, 200, data);
  } catch (err) { return tratarErro(res, err, "listarMeses"); }
}

// GET /painel-contas/:clienteId/meses/:competencia/semanas
async function listarSemanas(req, res) {
  try {
    const data = await service.listarSemanas(req.user || {}, req.params.clienteId, req.params.competencia);
    return responder(res, 200, data);
  } catch (err) { return tratarErro(res, err, "listarSemanas"); }
}

module.exports = { listar, listarMeses, listarSemanas, maskSensitiveData };
