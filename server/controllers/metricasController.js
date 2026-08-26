// server/controllers/metricasController.js
// Orquestra os endpoints de Métricas ML. Nunca expõe token nem dados sensíveis.
const { listarClientesComML, buscarResumo } = require('../services/metricasService');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /metricas/clientes
async function clientes(req, res) {
  try {
    const lista = await listarClientesComML();
    return res.json({ ok: true, clientes: lista });
  } catch (err) {
    console.error('[metricas] clientes:', err.message);
    return res.status(500).json({ ok: false, motivo: 'Erro ao listar clientes.' });
  }
}

// GET /metricas/resumo?clienteSlug=&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&compare=previous_period
async function resumo(req, res) {
  try {
    const { clienteSlug, dateFrom, dateTo, compare } = req.query || {};
    const clienteContaIdRaw = req.query?.clienteContaId;
    const clienteContaId = /^\d+$/.test(String(clienteContaIdRaw || '')) ? Number(clienteContaIdRaw) : null;

    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: 'clienteSlug é obrigatório.' });
    }
    if (!dateFrom || !DATE_RE.test(dateFrom)) {
      return res.status(400).json({ ok: false, motivo: 'Período inválido. Use dateFrom e dateTo no formato YYYY-MM-DD.' });
    }
    if (!dateTo || !DATE_RE.test(dateTo)) {
      return res.status(400).json({ ok: false, motivo: 'Período inválido. Use dateFrom e dateTo no formato YYYY-MM-DD.' });
    }

    const result = await buscarResumo({ clienteSlug, clienteContaId, dateFrom, dateTo, compare });

    if (result.multiplasContas) {
      return res.status(409).json({
        ok: false,
        code: 'MULTIPLE_MARKETPLACE_ACCOUNTS',
        motivo: 'Este cliente possui mais de uma conta Mercado Livre; informe clienteContaId.',
        contas: result.contas,
      });
    }
    if (result.notFound) {
      return res.status(404).json({ ok: false, motivo: 'Cliente não encontrado ou inativo.' });
    }
    if (result.semToken) {
      return res.json({ ok: false, semDados: true, motivo: 'Cliente sem Mercado Livre conectado.' });
    }
    if (result.tokenInvalido) {
      return res.json({ ok: false, motivo: 'Token Mercado Livre inválido ou sem permissão para pedidos deste cliente.' });
    }
    if (result.erroApi) {
      return res.status(502).json({ ok: false, motivo: 'Não foi possível carregar as métricas agora. Tente novamente em instantes.' });
    }

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[metricas] resumo:', err.message);
    return res.status(500).json({ ok: false, motivo: 'Erro interno ao calcular métricas.' });
  }
}

module.exports = { clientes, resumo };
