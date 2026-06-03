const { obterBaseCobertura } = require("../services/operacaoService");

async function baseCobertura(req, res) {
  try {
    const resumo = await obterBaseCobertura();
    return res.json({ ok: true, ...resumo });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      erro: err?.message || "Erro interno.",
    });
  }
}

module.exports = {
  baseCobertura,
};
