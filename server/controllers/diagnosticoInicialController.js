const service = require("../services/diagnosticoInicial/diagnosticoInicialService");

function tratarErro(res, err, contexto) {
  const statusCode =
    Number.isFinite(Number(err?.statusCode)) && Number(err.statusCode) >= 400
      ? Number(err.statusCode)
      : 500;
  if (statusCode >= 500) console.error(`[diagnosticoInicial] ${contexto}:`, err?.message);
  return res.status(statusCode).json({ ok: false, erro: err?.message || "Erro interno." });
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

async function listarDiagnosticos(req, res) {
  try {
    const diagnosticos = await service.listar({
      clienteId: req.query.clienteId,
      marketplace: req.query.marketplace,
    });
    return res.json({ ok: true, diagnosticos });
  } catch (err) {
    return tratarErro(res, err, "listarDiagnosticos");
  }
}

async function obterDiagnostico(req, res) {
  try {
    const id = parseId(req);
    const diagnostico = await service.obterPorId(id);
    return res.json({ ok: true, diagnostico });
  } catch (err) {
    return tratarErro(res, err, "obterDiagnostico");
  }
}

async function criarDiagnostico(req, res) {
  try {
    const { clienteId, marketplace, dataDiagnostico } = req.body || {};
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
