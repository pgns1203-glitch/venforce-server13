// server/controllers/painelContasController.js
// Handlers FINOS do Painel de Controle de Contas por Squad. Nenhuma regra
// financeira aqui — mora inteira em painelContasService/painelContasMetricas.
// Padrão espelhado de cliente360ResultadoController.js (mesmo guard final de
// máscara de dados sensíveis).

const service = require("../services/painelContas/painelContasService");
const atualizacaoService = require("../services/painelContas/painelContasAtualizacao");

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
  return responder(res, status, {
    ok: false, code: err?.code, erro: err?.message || "Erro interno.",
    ...(err?.atualizacao ? { atualizacao: err.atualizacao } : {}),
  });
}

// GET /painel-contas?competencia=&squadId=&busca=&status=&marketplace=&mostrarLegado=
async function listar(req, res) {
  try {
    const data = await service.listar(req.user || {}, {
      competencia: req.query.competencia,
      squadId: req.query.squadId,
      busca: req.query.busca,
      status: req.query.status,
      marketplace: req.query.marketplace,
      mostrarLegado: req.query.mostrarLegado,
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

// GET /painel-contas/:clienteId/contas/semanas?competencia=
async function listarSemanasDasContas(req, res) {
  try {
    const data = await service.listarSemanasDasContas(req.user || {}, req.params.clienteId, req.query.competencia);
    return responder(res, 200, data);
  } catch (err) { return tratarErro(res, err, "listarSemanasDasContas"); }
}

// PUT /painel-contas/:clienteId/contas/:contaId/manual/:competencia
async function salvarLancamentoManual(req, res) {
  try {
    const { clienteId, contaId, competencia } = req.params;
    const data = await service.salvarLancamentoManual(req.user || {}, clienteId, contaId, competencia, req.body || {});
    return responder(res, 200, data);
  } catch (err) { return tratarErro(res, err, "salvarLancamentoManual"); }
}

// DELETE /painel-contas/:clienteId/contas/:contaId/manual/:competencia
async function removerLancamentoManual(req, res) {
  try {
    const { clienteId, contaId, competencia } = req.params;
    const data = await service.removerLancamentoManual(req.user || {}, clienteId, contaId, competencia);
    return responder(res, 200, data);
  } catch (err) { return tratarErro(res, err, "removerLancamentoManual"); }
}

// GET /painel-contas/:clienteId/contas/:contaId/manual
async function listarLancamentosDaConta(req, res) {
  try {
    const { clienteId, contaId } = req.params;
    return responder(res, 200, await service.listarLancamentosDaConta(req.user || {}, clienteId, contaId));
  } catch (err) { return tratarErro(res, err, "listarLancamentosDaConta"); }
}

// GET /painel-contas/:clienteId/contas/:contaId/manual/:competencia/historico
async function listarHistoricoLancamento(req, res) {
  try {
    const { clienteId, contaId, competencia } = req.params;
    return responder(res, 200, await service.listarHistoricoLancamento(req.user || {}, clienteId, contaId, competencia));
  } catch (err) { return tratarErro(res, err, "listarHistoricoLancamento"); }
}

// POST /painel-contas/:clienteId/atualizar/:competencia — 202: a execução
// segue em segundo plano; o progresso é lido pelo GET abaixo.
async function iniciarAtualizacao(req, res) {
  try {
    const { clienteId, competencia } = req.params;
    const { atualizacao } = await atualizacaoService.iniciarAtualizacao(req.user || {}, clienteId, competencia);
    return responder(res, 202, { ok: true, atualizacao });
  } catch (err) { return tratarErro(res, err, "iniciarAtualizacao"); }
}

// GET /painel-contas/:clienteId/atualizar/:competencia
async function obterAtualizacao(req, res) {
  try {
    const { clienteId, competencia } = req.params;
    const atualizacao = await atualizacaoService.obterAtualizacao(req.user || {}, clienteId, competencia);
    return responder(res, 200, { ok: true, atualizacao });
  } catch (err) { return tratarErro(res, err, "obterAtualizacao"); }
}

module.exports = {
  listar, listarMeses, listarSemanas, listarSemanasDasContas, salvarLancamentoManual, removerLancamentoManual,
  listarLancamentosDaConta, listarHistoricoLancamento,
  iniciarAtualizacao, obterAtualizacao, maskSensitiveData,
};
