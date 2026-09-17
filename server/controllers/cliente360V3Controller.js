// server/controllers/cliente360V3Controller.js
// GET /operacao/cliente-360-v3/:slug/bootstrap?conta=&periodo=&compararCom=
// — ver services/cliente360/cliente360V3BootstrapService.js.
const { obterBootstrap } = require("../services/cliente360/cliente360V3BootstrapService");

function responderErro(res, err) {
  const statusCode = Number.isFinite(Number(err?.statusCode)) && Number(err.statusCode) >= 400 ? Number(err.statusCode) : 500;
  if (statusCode >= 500) console.error("[cliente360-v3]", err?.message);
  const payload = { ok: false, erro: err?.message || "Erro interno." };
  if (err?.code) payload.code = err.code;
  return res.status(statusCode).json(payload);
}

async function bootstrap(req, res) {
  try {
    const dados = await obterBootstrap({
      clienteSlugRaw: req.params.slug,
      clienteContaIdRaw: req.query.conta,
      competenciaRaw: req.query.periodo,
      compararComRaw: req.query.compararCom,
    });
    return res.json({ ok: true, ...dados });
  } catch (err) {
    return responderErro(res, err);
  }
}

module.exports = { bootstrap };
