// server/controllers/meController.js
// GET /me/context e GET /me/portfolio — ver services/meService.js.
const meService = require("../services/meService");

async function contexto(req, res) {
  try {
    const dados = await meService.obterContexto(req.user || {});
    return res.json({ ok: true, ...dados });
  } catch (err) {
    console.error("[me] contexto:", err.message);
    return res.status(500).json({ ok: false, erro: "Erro ao montar o contexto do usuário." });
  }
}

async function portfolio(req, res) {
  try {
    const dados = await meService.obterPortfolio(req.user || {});
    return res.json({ ok: true, ...dados });
  } catch (err) {
    console.error("[me] portfolio:", err.message);
    return res.status(500).json({ ok: false, erro: "Erro ao montar a carteira do usuário." });
  }
}

module.exports = { contexto, portfolio };
