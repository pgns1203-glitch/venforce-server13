// server/controllers/cliente360V3HistoricoController.js
// GET /operacao/cliente-360-v3/:slug/historico?conta=&limite=
// — ver services/cliente360/cliente360V3HistoricoService.js.
//
// FASE 6 (Projeto_cliente360) — LAZY, mesmo padrão de ads/saude na Fase 5:
// não é chamado no bootstrap. Não exige `?periodo=` (histórico é uma janela
// das últimas N ocorrências, não uma competência fechada).

const { resolverContaObrigatoria } = require("../services/cliente360/cliente360V3BootstrapService");
const { listarEventos } = require("../services/cliente360/cliente360V3HistoricoService");
const {
  resolverClientePorIdOuSlug,
  obterConta,
  sanitizarConta,
} = require("../services/clienteContas/clienteContaService");

const DEPS_CONTA = { resolverClientePorIdOuSlug, obterConta, sanitizarConta };

function responderErro(res, err) {
  const statusCode = Number.isFinite(Number(err?.statusCode)) && Number(err.statusCode) >= 400 ? Number(err.statusCode) : 500;
  if (statusCode >= 500) console.error("[cliente360-v3-historico]", err?.message);
  const payload = { ok: false, erro: err?.message || "Erro interno." };
  if (err?.code) payload.code = err.code;
  return res.status(statusCode).json(payload);
}

// `deps` opcional, só para teste (mesmo padrão defensivo do wiring das Fases 3/5).
async function historico(req, res, deps = {}) {
  try {
    const { cliente, conta } = await resolverContaObrigatoria(
      { clienteSlugRaw: req.params.slug, clienteContaIdRaw: req.query.conta },
      { ...DEPS_CONTA, ...deps.deposContaOverrides }
    );

    const resultado = await (deps.listarEventos || listarEventos)({
      clienteSlug: cliente.slug,
      clienteContaId: conta.id,
      marketplace: conta.marketplace,
      limite: req.query.limite,
    });

    return res.json({ ok: true, contexto: { clienteContaId: conta.id, marketplace: conta.marketplace }, historico: resultado });
  } catch (err) {
    return responderErro(res, err);
  }
}

module.exports = { historico };
