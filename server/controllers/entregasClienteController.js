const {
  criarEntrega,
  listarEntregas,
  buscarEntregaPorId,
  atualizarEntrega,
  publicarEntrega,
  despublicarEntrega,
  excluirEntrega,
  buscarEntregaPublicaPorToken,
} = require("../services/entregasClienteService");
// P2.1 — seam de carteira. Fonte única (authorizationService), sem SQL de
// Squad aqui. Entrega é client-scoped: cliente vem do body na criação, da
// query na lista e do registro nas rotas por `:id`.
const {
  canAccessCliente,
  assertClienteNaCarteira,
  resolvePortfolioClientes,
  ehAdmin,
} = require("../services/squads/authorizationService");

function responderErro(res, err) {
  if (err?.code === "CLIENTE_FORA_DA_CARTEIRA" || err?.code === "CLIENTE_NAO_ENCONTRADO") {
    return res.status(err.statusCode || 403).json({ ok: false, code: err.code, erro: err.message });
  }
  if (err?.payload && err?.statusCode) {
    return res.status(err.statusCode).json(err.payload);
  }
  return res.status(500).json({ ok: false, erro: err?.message || "Erro interno do servidor" });
}

function erroCarteira(status, code, mensagem) {
  const e = new Error(mensagem);
  e.statusCode = status;
  e.code = code;
  return e;
}

// Resolve a entrega e confirma acesso ao cliente dela.
async function autorizarPorEntrega(req, idRaw) {
  const resultado = await buscarEntregaPorId({ idRaw }); // lança se não existe
  const clienteId = resultado?.entrega?.cliente_id;
  if (clienteId != null) {
    const ok = await canAccessCliente(req.user || {}, clienteId);
    if (!ok) throw erroCarteira(403, "CLIENTE_FORA_DA_CARTEIRA", "Cliente fora da sua carteira.");
  }
  return resultado;
}

async function criarEntregaController(req, res) {
  try {
    const ref = req.body?.cliente_id ?? req.body?.cliente_slug;
    if (ref !== undefined && ref !== null && ref !== "") {
      await assertClienteNaCarteira(req.user || {}, ref);
    }
    const resultado = await criarEntrega({ userId: req.user?.id, body: req.body });
    return res.status(201).json({ ok: true, entrega: resultado.entrega });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function listarEntregasController(req, res) {
  try {
    const user = req.user || {};
    const ref = req.query?.cliente_id ?? req.query?.cliente_slug;
    if (ref !== undefined && ref !== null && ref !== "") {
      await assertClienteNaCarteira(user, ref);
    }
    const resultado = await listarEntregas({ query: req.query });
    let entregas = resultado.entregas;
    if (!ehAdmin(user) && (ref === undefined || ref === null || ref === "")) {
      const permitidos = new Set((await resolvePortfolioClientes(user)).map((c) => c.id));
      entregas = entregas.filter((e) => e.cliente_id != null && permitidos.has(e.cliente_id));
    }
    return res.json({ ok: true, entregas, total: resultado.total });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function buscarEntregaPorIdController(req, res) {
  try {
    const resultado = await autorizarPorEntrega(req, req.params.id);
    return res.json({ ok: true, entrega: resultado.entrega });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function atualizarEntregaController(req, res) {
  try {
    await autorizarPorEntrega(req, req.params.id);
    const novoRef = req.body?.cliente_id ?? req.body?.cliente_slug;
    if (novoRef !== undefined && novoRef !== null && novoRef !== "") {
      await assertClienteNaCarteira(req.user || {}, novoRef);
    }
    const resultado = await atualizarEntrega({ idRaw: req.params.id, body: req.body });
    return res.json({ ok: true, entrega: resultado.entrega });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function publicarEntregaController(req, res) {
  try {
    await autorizarPorEntrega(req, req.params.id);
    const resultado = await publicarEntrega({ idRaw: req.params.id });
    return res.json({ ok: true, entrega: resultado.entrega });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function despublicarEntregaController(req, res) {
  try {
    await autorizarPorEntrega(req, req.params.id);
    const resultado = await despublicarEntrega({ idRaw: req.params.id });
    return res.json({ ok: true, entrega: resultado.entrega });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function excluirEntregaController(req, res) {
  try {
    await autorizarPorEntrega(req, req.params.id);
    const resultado = await excluirEntrega({ idRaw: req.params.id });
    if (!resultado.ok) return res.status(500).json({ ok: false, erro: "Falha ao excluir entrega." });
    return res.json({ ok: true });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function buscarEntregaPublicaPorTokenController(req, res) {
  try {
    const resultado = await buscarEntregaPublicaPorToken({ tokenRaw: req.params.token });
    return res.json({ ok: true, entrega: resultado.entrega });
  } catch (err) {
    return responderErro(res, err);
  }
}

module.exports = {
  criarEntregaController,
  listarEntregasController,
  buscarEntregaPorIdController,
  atualizarEntregaController,
  publicarEntregaController,
  despublicarEntregaController,
  excluirEntregaController,
  buscarEntregaPublicaPorTokenController,
};

