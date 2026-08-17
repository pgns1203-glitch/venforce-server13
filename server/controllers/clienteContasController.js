const {
  listarContasDoCliente,
  obterConta,
  criarConta,
  atualizarConta,
  definirContaPrincipal,
  obterBaseDaConta,
  vincularBaseNaConta,
  desconectarGrantMlDaConta,
  sanitizarConta,
} = require("../services/clienteContas/clienteContaService");
const { listarBasesComVinculos } = require("../services/baseVinculosService");

function responderErro(res, err) {
  const status = err?.statusCode || 500;
  const payload = { ok: false, erro: err?.message || "Erro interno." };
  if (err?.code) payload.code = err.code;
  if (err?.contas) payload.contas = err.contas;
  return res.status(status).json(payload);
}

async function listar(req, res) {
  try {
    const resultado = await listarContasDoCliente({
      clienteId: /^\d+$/.test(String(req.params.cliente || "")) ? req.params.cliente : null,
      clienteSlug: /^\d+$/.test(String(req.params.cliente || "")) ? null : req.params.cliente,
      marketplace: req.query.marketplace,
    });
    return res.json({ ok: true, ...resultado });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function criar(req, res) {
  try {
    const cliente = String(req.params.cliente || "");
    const isId = /^\d+$/.test(cliente);
    const conta = await criarConta({
      clienteId: isId ? cliente : null,
      clienteSlug: isId ? null : cliente,
      marketplace: req.body?.marketplace,
      nome: req.body?.nome,
      externalAccountId: req.body?.external_account_id ?? null,
      isPrimary: req.body?.is_primary === true,
      metadata: req.body?.metadata_json || {},
    });
    return res.status(201).json({ ok: true, conta });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function obter(req, res) {
  try {
    const conta = await obterConta(req.params.id);
    return res.json({ ok: true, conta: sanitizarConta(conta) });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function atualizar(req, res) {
  try {
    const conta = await atualizarConta(req.params.id, {
      nome: req.body?.nome,
      ativo: req.body?.ativo,
    });
    return res.json({ ok: true, conta });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function definirPrincipal(req, res) {
  try {
    const conta = await definirContaPrincipal(req.params.id);
    return res.json({ ok: true, conta });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function obterBase(req, res) {
  try {
    const base = await obterBaseDaConta(req.params.id);
    return res.json({ ok: true, base });
  } catch (err) {
    return responderErro(res, err);
  }
}

// Bases elegíveis pro picker "Definir base"/"Trocar base" do cliente:
// reaproveita listarBasesComVinculos (mesma leitura que /bases.html usa),
// só filtrando pelo marketplace da própria conta — nunca duplica a lógica
// de vínculo/sugestão de base.
async function basesElegiveis(req, res) {
  try {
    const conta = await obterConta(req.params.id);
    const bases = await listarBasesComVinculos({ marketplace: conta.marketplace });
    return res.json({
      ok: true,
      conta_id: conta.id,
      marketplace: conta.marketplace,
      bases: bases.filter((b) => b.ativo !== false),
    });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function vincularBase(req, res) {
  try {
    const resultado = await vincularBaseNaConta(req.params.id, req.body?.base_id);
    return res.json({ ok: true, ...resultado });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function desconectarMlGrant(req, res) {
  try {
    const resultado = await desconectarGrantMlDaConta(req.params.id);
    return res.json({ ok: true, ...resultado });
  } catch (err) {
    return responderErro(res, err);
  }
}

module.exports = {
  listar,
  criar,
  obter,
  atualizar,
  definirPrincipal,
  obterBase,
  basesElegiveis,
  vincularBase,
  desconectarMlGrant,
};
