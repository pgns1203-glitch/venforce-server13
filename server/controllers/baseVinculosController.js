const {
  listarBasesComVinculos,
  criarVinculoManual,
  desativarVinculoBase,
} = require("../services/baseVinculosService");

function responderErro(res, err) {
  const status = err?.statusCode || 500;
  return res.status(status).json({
    ok: false,
    erro: err?.message || "Erro interno.",
  });
}

async function listar(req, res) {
  try {
    const bases = await listarBasesComVinculos();
    return res.json({ ok: true, bases });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function criar(req, res) {
  try {
    const resultado = await criarVinculoManual({
      baseId: req.body?.base_id,
      clienteId: req.body?.cliente_id,
      marketplace: req.body?.marketplace,
      userId: req.user?.id,
    });

    return res.status(201).json({
      ok: true,
      base: resultado.base,
      vinculo: resultado.vinculo,
    });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function remover(req, res) {
  try {
    const resultado = await desativarVinculoBase(req.params.baseId);
    return res.json({
      ok: true,
      base: resultado.base,
      desativado: resultado.desativado,
      vinculo: resultado.vinculo,
    });
  } catch (err) {
    return responderErro(res, err);
  }
}

module.exports = {
  listar,
  criar,
  remover,
};
