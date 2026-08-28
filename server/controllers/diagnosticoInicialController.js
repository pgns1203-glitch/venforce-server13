const service = require("../services/diagnosticoInicial/diagnosticoInicialService");
// P2.1 — seam de carteira. O Diagnóstico recebe o cliente por query
// (?clienteId), body (criação) ou pelo registro (:id). A autorização vem
// SEMPRE da fonte única (authorizationService); nada de SQL de Squad aqui.
const {
  canAccessCliente,
  assertClienteNaCarteira,
  resolvePortfolioClientes,
  ehAdmin,
} = require("../services/squads/authorizationService");

function tratarErro(res, err, contexto) {
  const statusCode =
    Number.isFinite(Number(err?.statusCode)) && Number(err.statusCode) >= 400
      ? Number(err.statusCode)
      : 500;
  if (statusCode >= 500) console.error(`[diagnosticoInicial] ${contexto}:`, err?.message);
  const payload = { ok: false, erro: err?.message || "Erro interno." };
  if (err?.code) payload.code = err.code;
  return res.status(statusCode).json(payload);
}

function parseId(req) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    const e = new Error("id inválido.");
    e.statusCode = 400;
    throw e;
  }
  return id;
}

function erroCarteira(status, code, mensagem) {
  const e = new Error(mensagem);
  e.statusCode = status;
  e.code = code;
  return e;
}

// Resolve o diagnóstico por id e confirma que o usuário acessa o cliente dele.
async function autorizarPorRegistro(req, id) {
  const diagnostico = await service.obterPorId(id); // lança 404 se não existe
  if (diagnostico.cliente_id != null) {
    const ok = await canAccessCliente(req.user || {}, diagnostico.cliente_id);
    if (!ok) throw erroCarteira(403, "CLIENTE_FORA_DA_CARTEIRA", "Cliente fora da sua carteira.");
  }
  return diagnostico;
}

async function listarDiagnosticos(req, res) {
  try {
    const user = req.user || {};
    if (req.query.clienteId !== undefined && req.query.clienteId !== "") {
      await assertClienteNaCarteira(user, req.query.clienteId);
    }
    let diagnosticos = await service.listar({
      clienteId: req.query.clienteId,
      marketplace: req.query.marketplace,
    });
    // Sem filtro de cliente: restringe à carteira do usuário (admin vê tudo).
    if (!ehAdmin(user) && (req.query.clienteId === undefined || req.query.clienteId === "")) {
      const permitidos = new Set((await resolvePortfolioClientes(user)).map((c) => c.id));
      diagnosticos = diagnosticos.filter((d) => d.cliente_id != null && permitidos.has(d.cliente_id));
    }
    return res.json({ ok: true, diagnosticos });
  } catch (err) {
    return tratarErro(res, err, "listarDiagnosticos");
  }
}

async function obterDiagnostico(req, res) {
  try {
    const id = parseId(req);
    const diagnostico = await autorizarPorRegistro(req, id);
    return res.json({ ok: true, diagnostico });
  } catch (err) {
    return tratarErro(res, err, "obterDiagnostico");
  }
}

async function criarDiagnostico(req, res) {
  try {
    const { clienteId, marketplace, dataDiagnostico } = req.body || {};
    if (clienteId !== undefined && clienteId !== "" && clienteId !== null) {
      await assertClienteNaCarteira(req.user || {}, clienteId);
    }
    const diagnostico = await service.obterOuCriarRascunho({
      clienteId,
      marketplace,
      dataDiagnostico,
      responsavelUserId: req.user.id,
    });
    return res.status(201).json({ ok: true, diagnostico });
  } catch (err) {
    return tratarErro(res, err, "criarDiagnostico");
  }
}

async function atualizarDiagnostico(req, res) {
  try {
    const id = parseId(req);
    await autorizarPorRegistro(req, id);
    const { respostasJson, dataDiagnostico, diagnosticoRevisadoJson } = req.body || {};
    const diagnostico = await service.atualizarRespostas(id, {
      respostasJson,
      dataDiagnostico,
      diagnosticoRevisadoJson,
    });
    return res.json({ ok: true, diagnostico });
  } catch (err) {
    return tratarErro(res, err, "atualizarDiagnostico");
  }
}

async function gerarDiagnostico(req, res) {
  try {
    const id = parseId(req);
    await autorizarPorRegistro(req, id);
    const geradoPor = req.user?.nome || req.user?.email || `user:${req.user?.id}`;
    const diagnostico = await service.gerar(id, { geradoPor });
    return res.json({ ok: true, diagnostico });
  } catch (err) {
    return tratarErro(res, err, "gerarDiagnostico");
  }
}

async function concluirDiagnostico(req, res) {
  try {
    const id = parseId(req);
    await autorizarPorRegistro(req, id);
    const diagnostico = await service.concluir(id);
    return res.json({ ok: true, diagnostico });
  } catch (err) {
    return tratarErro(res, err, "concluirDiagnostico");
  }
}

module.exports = {
  listarDiagnosticos,
  obterDiagnostico,
  criarDiagnostico,
  atualizarDiagnostico,
  gerarDiagnostico,
  concluirDiagnostico,
};
