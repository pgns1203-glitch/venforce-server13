const {
  listarBasesComVinculos,
  listarClientesDisponiveis,
  criarVinculoManual,
  desativarVinculoBase,
} = require("../services/baseVinculosService");

function responderErro(res, err) {
  const status = err?.statusCode || 500;
  const payload = { ok: false, erro: err?.message || "Erro interno." };
  if (err?.code) payload.code = err.code;
  if (err?.contas) payload.contas = err.contas;
  return res.status(status).json(payload);
}

async function listar(req, res) {
  try {
    const bases = await listarBasesComVinculos();
    return res.json({ ok: true, bases });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function listarClientes(req, res) {
  try {
    const clientes = await listarClientesDisponiveis();
    return res.json({ ok: true, clientes });
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
      clienteContaId: req.body?.cliente_conta_id ?? null,
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
  listarClientes,
  criar,
  remover,
};
