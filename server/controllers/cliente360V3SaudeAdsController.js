// server/controllers/cliente360V3SaudeAdsController.js
// GET /operacao/cliente-360-v3/:slug/ads?conta=&periodo=
// GET /operacao/cliente-360-v3/:slug/saude?conta=
// — ver services/cliente360/cliente360V3SaudeAdsService.js.
//
// FASE 5A+5C (Projeto_cliente360) — endpoints LAZY: Ads faz chamada real ao
// Mercado Livre (mesmo custo do Motor de Margem na Fase 3); nenhum dos dois
// é chamado no bootstrap da Fase 1.
const {
  resolverContaObrigatoria,
  resolverPeriodo,
} = require("../services/cliente360/cliente360V3BootstrapService");
const { obterAds, obterSaude } = require("../services/cliente360/cliente360V3SaudeAdsService");
const {
  resolverClientePorIdOuSlug,
  obterConta,
  sanitizarConta,
} = require("../services/clienteContas/clienteContaService");

const DEPS_CONTA = { resolverClientePorIdOuSlug, obterConta, sanitizarConta };

function responderErro(res, err) {
  const statusCode = Number.isFinite(Number(err?.statusCode)) && Number(err.statusCode) >= 400 ? Number(err.statusCode) : 500;
  if (statusCode >= 500) console.error("[cliente360-v3-saude-ads]", err?.message);
  const payload = { ok: false, erro: err?.message || "Erro interno." };
  if (err?.code) payload.code = err.code;
  return res.status(statusCode).json(payload);
}

// `deps` é opcional, só para teste (ver nota em cliente360V3ProdutosController.js
// — o mesmo bug de wiring já apareceu uma vez nesta missão).
async function ads(req, res, deps = {}) {
  try {
    const { cliente, conta } = await resolverContaObrigatoria(
      { clienteSlugRaw: req.params.slug, clienteContaIdRaw: req.query.conta },
      { ...DEPS_CONTA, ...deps.deposContaOverrides }
    );
    const competencia = resolverPeriodo(req.query.periodo);

    const resultado = await (deps.obterAds || obterAds)({
      clienteSlug: cliente.slug,
      marketplace: conta.marketplace,
      competencia,
      clienteContaId: conta.id,
    });

    return res.json({ ok: true, contexto: { clienteContaId: conta.id, marketplace: conta.marketplace, competencia }, ads: resultado });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function saude(req, res, deps = {}) {
  try {
    const { cliente, conta } = await resolverContaObrigatoria(
      { clienteSlugRaw: req.params.slug, clienteContaIdRaw: req.query.conta },
      { ...DEPS_CONTA, ...deps.deposContaOverrides }
    );

    const resultado = await (deps.obterSaude || obterSaude)({
      clienteId: cliente.id,
      clienteSlug: cliente.slug,
      clienteContaId: conta.id,
      marketplace: conta.marketplace,
    });

    return res.json({ ok: true, contexto: { clienteContaId: conta.id, marketplace: conta.marketplace }, saude: resultado });
  } catch (err) {
    return responderErro(res, err);
  }
}

module.exports = { ads, saude };
