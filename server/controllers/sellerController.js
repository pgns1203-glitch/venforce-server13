// server/controllers/sellerController.js
// Controllers da área Seller. Toda a lógica/SQL vive no sellerService.
// As rotas já passaram por authMiddleware (+ requireSellerAccess/requireAdmin).

const sellerService = require("../services/sellerService");
const { extrairIp } = require("../services/activityLogService");

function responderErro(res, err) {
  const status = err?.statusCode || 500;
  return res.status(status).json({
    ok: false,
    erro: err?.message || "Erro interno.",
    ...(err?.codigo ? { codigo: err.codigo } : {}),
  });
}

// GET /seller/me
async function me(req, res) {
  try {
    const payload = await sellerService.getMe(req.user);
    return res.json(payload);
  } catch (err) {
    return responderErro(res, err);
  }
}

// GET /seller/produtos-sem-base?cliente_slug=&status=&busca=&page=&limit=
async function produtosSemBase(req, res) {
  try {
    const payload = await sellerService.listarProdutosSemBase(req.user, {
      clienteSlug: req.query.cliente_slug,
      status: req.query.status,
      busca: req.query.busca,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.json(payload);
  } catch (err) {
    return responderErro(res, err);
  }
}

// POST /seller/custos
async function enviarCusto(req, res) {
  try {
    const payload = await sellerService.salvarSubmissaoCusto(req.user, req.body || {}, extrairIp(req));
    return res.status(201).json(payload);
  } catch (err) {
    return responderErro(res, err);
  }
}

// GET /seller/custos-submissoes?cliente_slug=&status=
async function listarSubmissoes(req, res) {
  try {
    const payload = await sellerService.listarSubmissoes(req.user, {
      clienteSlug: req.query.cliente_slug,
      status: req.query.status,
    });
    return res.json(payload);
  } catch (err) {
    return responderErro(res, err);
  }
}

// PATCH /seller/custos-submissoes/:id  (admin only)
async function revisarSubmissao(req, res) {
  try {
    const payload = await sellerService.revisarSubmissao(req.user, req.params.id, req.body || {}, extrairIp(req));
    return res.json(payload);
  } catch (err) {
    return responderErro(res, err);
  }
}

// ── Gestão de vínculos (admin only — gate nas rotas) ──

// GET /seller/vinculos
async function listarVinculos(req, res) {
  try {
    const payload = await sellerService.listarVinculos();
    return res.json(payload);
  } catch (err) {
    return responderErro(res, err);
  }
}

// POST /seller/vinculos  { user_email | user_id, cliente_slug, marketplace? }
async function criarVinculo(req, res) {
  try {
    const payload = await sellerService.criarVinculo(req.user, req.body || {}, extrairIp(req));
    return res.status(201).json(payload);
  } catch (err) {
    return responderErro(res, err);
  }
}

// DELETE /seller/vinculos/:id  (desativa, não apaga)
async function removerVinculo(req, res) {
  try {
    const payload = await sellerService.desativarVinculo(req.user, req.params.id, extrairIp(req));
    return res.json(payload);
  } catch (err) {
    return responderErro(res, err);
  }
}

module.exports = {
  me,
  produtosSemBase,
  enviarCusto,
  listarSubmissoes,
  revisarSubmissao,
  listarVinculos,
  criarVinculo,
  removerVinculo,
};
