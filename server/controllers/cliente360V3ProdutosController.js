// server/controllers/cliente360V3ProdutosController.js
// GET /operacao/cliente-360-v3/:slug/produtos-margem?conta=&periodo=&mlbs=
// — ver services/cliente360/cliente360V3MargemCompositor.js.
//
// FASE 3 (Projeto_cliente360) — endpoint LAZY (arquitetura de carregamento,
// prompt master seção 8): NUNCA chamado no bootstrap da Fase 1. O frontend
// só chama isto quando a seção "Produtos" é aberta, e só com os MLBs já
// visíveis em `resultado.dados.produtos` (nunca o catálogo inteiro, nunca
// uma chamada por produto).
const {
  resolverContaObrigatoria,
  resolverPeriodo,
} = require("../services/cliente360/cliente360V3BootstrapService");
const { comporMargemPorMlb } = require("../services/cliente360/cliente360V3MargemCompositor");
const { rangeDaCompetencia } = require("../services/cliente360/cliente360Periodo");
const {
  resolverClientePorIdOuSlug,
  obterConta,
  sanitizarConta,
} = require("../services/clienteContas/clienteContaService");

// resolverContaObrigatoria não tem default interno de deps (é um helper puro
// que espera receber as 3 funções reais) — mesmo padrão de wiring que
// cliente360V3Controller.js usa para obterBootstrap.
const DEPS_CONTA = { resolverClientePorIdOuSlug, obterConta, sanitizarConta };

function responderErro(res, err) {
  const statusCode = Number.isFinite(Number(err?.statusCode)) && Number(err.statusCode) >= 400 ? Number(err.statusCode) : 500;
  if (statusCode >= 500) console.error("[cliente360-v3-produtos]", err?.message);
  const payload = { ok: false, erro: err?.message || "Erro interno." };
  if (err?.code) payload.code = err.code;
  return res.status(statusCode).json(payload);
}

// `deps` é opcional e só existe para teste (nunca fornecido pelo Express em
// produção) — mesmo motivo que já expôs o bug real desta unidade: sem um
// jeito de injetar fake em resolverContaObrigatoria/comporMargemPorMlb, o
// erro de wiring (deps vazio passado pra resolverContaObrigatoria) só
// apareceria em produção, na primeira requisição.
async function produtosMargem(req, res, deps = {}) {
  try {
    const { cliente, conta } = await resolverContaObrigatoria(
      { clienteSlugRaw: req.params.slug, clienteContaIdRaw: req.query.conta },
      { ...DEPS_CONTA, ...deps.deposContaOverrides }
    );
    const competencia = resolverPeriodo(req.query.periodo);
    // Mesma competência que o Resultado da 360 está mostrando — nunca o
    // default de "últimos 30 dias" do Motor de Margem (ver comentário no
    // compositor: universo tem que ser compatível com o que a tela mostra).
    const { inicio: dateFrom, fim: dateTo } = rangeDaCompetencia(competencia);

    const mlbs = String(req.query.mlbs || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const resultado = await (deps.comporMargemPorMlb || comporMargemPorMlb)({
      clienteId: cliente.id,
      clienteSlug: cliente.slug,
      marketplace: conta.marketplace,
      mlbs,
      dateFrom,
      dateTo,
    });

    return res.json({
      ok: true,
      contexto: { clienteContaId: conta.id, marketplace: conta.marketplace, competencia },
      ...resultado,
    });
  } catch (err) {
    return responderErro(res, err);
  }
}

module.exports = { produtosMargem };
