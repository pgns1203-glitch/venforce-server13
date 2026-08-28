const {
  listarBasesComVinculos,
  listarClientesDisponiveis,
  criarVinculoManual,
  desativarVinculoBase,
} = require("../services/baseVinculosService");
// P2.1 — a leitura de bases/vínculos revela quais clientes têm qual base.
// Restringe as linhas à carteira do usuário (admin vê tudo). Fonte única.
const { ehAdmin, clientesAutorizadosSet } = require("../services/squads/authorizationService");

function responderErro(res, err) {
  const status = err?.statusCode || 500;
  const payload = { ok: false, erro: err?.message || "Erro interno." };
  if (err?.code) payload.code = err.code;
  if (err?.contas) payload.contas = err.contas;
  return res.status(status).json(payload);
}

async function listar(req, res) {
  try {
    const user = req.user || {};
    let bases = await listarBasesComVinculos();
    if (!ehAdmin(user)) {
      const permitidos = await clientesAutorizadosSet(user);
      // mantém bases órfãs (sem vínculo) e as que cobrem cliente da carteira
      bases = bases.filter((b) => {
        const clienteId = b.vinculo?.cliente_id ?? null;
        return clienteId == null || permitidos.has(clienteId);
      });
    }
    return res.json({ ok: true, bases });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function listarClientes(req, res) {
  try {
    const user = req.user || {};
    let clientes = await listarClientesDisponiveis();
    if (!ehAdmin(user)) {
      const permitidos = await clientesAutorizadosSet(user);
      clientes = clientes.filter((c) => permitidos.has(c.id));
    }
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
