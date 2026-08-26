// server/controllers/financeiroVisaoController.js
// GET /financeiro/:cliente?conta=&periodo=YYYY-MM — ver services/financeiroVisaoService.js.
// Não confundir com fechamentosFinanceiroController.js (fluxo de upload/
// processamento, intocado, montado em /fechamentos).
const { obterFinanceiro } = require("../services/financeiroVisaoService");

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

module.exports = { financeiro };
