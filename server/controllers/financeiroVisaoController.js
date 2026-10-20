// server/controllers/financeiroVisaoController.js
// GET /financeiro/:cliente?conta=&periodo=YYYY-MM — ver services/financeiroVisaoService.js.
// Não confundir com fechamentosFinanceiroController.js (fluxo de upload/
// processamento, intocado, montado em /fechamentos).
const { obterFinanceiro } = require("../services/financeiroVisaoService");
const { obterAdsDoFechamento } = require("../services/financeiroAdsService");
const { obterMiniaturas } = require("../services/financeiroMiniaturasService");

function responderErro(res, err) {
  const statusCode = Number.isFinite(Number(err?.statusCode)) && Number(err.statusCode) >= 400 ? Number(err.statusCode) : 500;
  if (statusCode >= 500) console.error("[financeiro-visao]", err?.message);
  const payload = { ok: false, erro: err?.message || "Erro interno." };
  if (err?.code) payload.code = err.code;
  return res.status(statusCode).json(payload);
}

async function financeiro(req, res) {
  try {
    const dados = await obterFinanceiro({
      clienteSlugRaw: req.params.cliente,
      clienteContaIdRaw: req.query.conta,
      periodoRaw: req.query.periodo,
    });
    return res.json({ ok: true, ...dados });
  } catch (err) {
    return responderErro(res, err);
  }
}

// GET /financeiro/:cliente/ads?conta=&periodo=YYYY-MM[&atualizar=1] — campo
// ADS do Fechamento. Ver services/financeiroAdsService.js.
async function ads(req, res) {
  try {
    const dados = await obterAdsDoFechamento({
      clienteSlugRaw: req.params.cliente,
      clienteContaIdRaw: req.query.conta,
      periodoRaw: req.query.periodo,
      atualizarRaw: req.query.atualizar,
    });
    return res.json({ ok: true, ...dados });
  } catch (err) {
    if (err?.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") {
      return res.status(409).json({ ok: false, code: err.code, erro: err.message, contas: err.contas });
    }
    return responderErro(res, err);
  }
}

// GET /financeiro/:cliente/miniaturas?conta=&itens=MLB1,MLB2 — foto dos
// produtos da lista. Ver services/financeiroMiniaturasService.js.
async function miniaturas(req, res) {
  try {
    const dados = await obterMiniaturas({
      clienteSlugRaw: req.params.cliente,
      clienteContaIdRaw: req.query.conta,
      itensRaw: req.query.itens,
    });
    return res.json({ ok: true, ...dados });
  } catch (err) {
    return responderErro(res, err);
  }
}

module.exports = { financeiro, ads, miniaturas };
