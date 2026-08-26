// server/services/visaoService.js
//
// GET /operacao/visao/:cliente?conta=&periodo= (VenForce V3 Master Spec
// §11.4, §18.3). Composição SERVER-SIDE de fontes já existentes — nenhum
// cálculo novo, nenhum dado inventado. Nome deliberadamente `/visao`, não
// `/workspace` (já ocupado por `GET /operacao/central-margem/:slug/workspace`,
// Motor de Margem — Master Spec §3.8 #2).
//
// Cada bloco é resolvido de forma INDEPENDENTE (uma falha não derruba os
// outros, mesmo padrão de `carregarConciliacaoMercadoPago` em
// fechamentos-api.js) e carrega `disponivel` + `escopoConta`:
//   - `escopoConta: true`  → o bloco já é account-aware (recebeu clienteContaId
//     e respeita a conta pedida: Central de Vendas, Ads, atividade/sync runs).
//   - `escopoConta: false` → o bloco ainda é só por CLIENTE (Cliente 360,
//     Central de Margem, fechamento/relatórios) — nunca finge filtrar por
//     conta o que não filtra. Documentado, não escondido (ver
//     Squads_migration/VENFORCE_V3_BACKEND_READINESS.md §14).
//
// Este service NUNCA escolhe a conta sozinho: clienteContaId é obrigatório
// (a Visão só renderiza com o contexto já completo — Master Spec §7.2,
// estado READY) e é validado contra o cliente/ativo antes de qualquer
// composição, com os códigos canônicos já estabelecidos.

const {
  resolverClientePorIdOuSlug,
  obterConta,
  sanitizarConta,
} = require("./clienteContas/clienteContaService");
const { CODIGOS_CANONICOS } = require("../utils/erroContextoCanonico");
const { rangeFromCompetencia, competenciaAtual, parseCompetencia } = require("../utils/periodoUtils");
const { getCliente360 } = require("./cliente360/cliente360Service");
const { getCentralVendasReadBootstrap } = require("./centralVendas/centralVendasReadService");
const { obterResumo: obterResumoMargem } = require("./motorMargem/motorMargemService");
const { buscarPerformanceML } = require("./ads/mlAdsService");
const { listarEntregas } = require("./entregasClienteService");
const { listarSyncRuns } = require("./centralVendas/centralVendasSyncRunService");

function criarErroHttp(statusCode, mensagem, extra = {}) {
  const err = new Error(mensagem);
  err.statusCode = statusCode;
  Object.assign(err, extra);
  return err;
}

// Resolve e valida a conta pedida — marketplace é DERIVADO da conta (D10 do
// Master Spec), nunca um parâmetro separado. clienteContaId é obrigatório:
// a Visão nunca escolhe uma conta em silêncio.
async function resolverContaObrigatoria({ clienteSlugRaw, clienteContaIdRaw }, deps) {
  const cliente = await deps.resolverClientePorIdOuSlug({ clienteSlug: clienteSlugRaw });

  const clienteContaId = Number(clienteContaIdRaw);
  if (!Number.isInteger(clienteContaId) || clienteContaId <= 0) {
    throw criarErroHttp(400, "conta é obrigatória (?conta=<clienteContaId>).");
  }

  const contaRaw = await deps.obterConta(clienteContaId);
  if (contaRaw.cliente_id !== cliente.id) {
    throw criarErroHttp(403, "Esta conta não pertence ao cliente informado.", {
      code: CODIGOS_CANONICOS.CONTA_NAO_PERTENCE_AO_CLIENTE,
    });
  }
  if (contaRaw.ativo === false) {
    throw criarErroHttp(409, `A conta "${contaRaw.nome}" foi desativada.`, {
      code: CODIGOS_CANONICOS.CONTA_INATIVA,
    });
  }

  return { cliente, conta: deps.sanitizarConta(contaRaw) };
}

function resolverPeriodo(periodoRaw) {
  const parsed = periodoRaw ? parseCompetencia(periodoRaw) : null;
  const periodo = parsed || competenciaAtual();
  const { dateFrom, dateTo } = rangeFromCompetencia(periodo.competencia);
  return { competencia: periodo.competencia, dateFrom, dateTo };
}

// Envelope uniforme de bloco — nunca lança para fora, nunca inventa dado
// quando a fonte falha ou não existe para este marketplace.
async function bloco({ escopoConta, aplicavel = true, motivoInaplicavel = null }, fn) {
  if (!aplicavel) {
    return { disponivel: false, escopoConta, motivo: motivoInaplicavel || "Não aplicável a este marketplace." };
  }
  try {
    const dados = await fn();
    return { disponivel: true, escopoConta, dados };
  } catch (err) {
    return { disponivel: false, escopoConta, motivo: err?.message || "Falha ao carregar este bloco." };
  }
}

async function obterVisao({ clienteSlugRaw, clienteContaIdRaw, periodoRaw }, deps = {}) {
  const d = {
    resolverClientePorIdOuSlug,
    obterConta,
    sanitizarConta,
    getCliente360,
    getCentralVendasReadBootstrap,
    obterResumoMargem,
    buscarPerformanceML,
    listarEntregas,
    listarSyncRuns,
    ...deps,
  };

  const { cliente, conta } = await resolverContaObrigatoria({ clienteSlugRaw, clienteContaIdRaw }, d);
  const periodo = resolverPeriodo(periodoRaw);
  const isMeli = conta.marketplace === "meli";

  const [saude, resultado, margem, ads, fechamento, atividade] = await Promise.all([
    // Cliente 360 não é account-aware — prontidão do CLIENTE inteiro, não
    // desta conta especificamente. Sempre disponível quando o cliente existe.
    bloco({ escopoConta: false }, () => d.getCliente360(cliente.slug, { competencia: periodo.competencia })),

    // Central de Vendas: account-aware de verdade.
    bloco({ escopoConta: true }, () =>
      d.getCentralVendasReadBootstrap(cliente.slug, {
        dateFrom: periodo.dateFrom, dateTo: periodo.dateTo,
        marketplace: conta.marketplace, clienteContaId: conta.id,
      })
    ),

    // Central de Margem: só MELI (contextoPrecificacaoService só resolve
    // bases MELI) e ainda não é account-aware — escopo é o cliente inteiro.
    bloco({ escopoConta: false, aplicavel: isMeli, motivoInaplicavel: "Central de Margem está disponível só para operações Mercado Livre." }, () =>
      d.obterResumoMargem({ clienteSlug: cliente.slug, dateFrom: periodo.dateFrom, dateTo: periodo.dateTo })
    ),

    // Ads: só MELI, account-aware.
    bloco({ escopoConta: true, aplicavel: isMeli, motivoInaplicavel: "Ads está disponível só para operações Mercado Livre." }, () =>
      d.buscarPerformanceML(cliente.slug, periodo.competencia, null, conta.id)
    ),

    // Fechamento: entregas_cliente não tem cliente_conta_id — escopo é o
    // cliente inteiro. Filtra pela competência pedida no chamador (a query
    // do serviço não filtra por período).
    bloco({ escopoConta: false }, async () => {
      const { entregas } = await d.listarEntregas({
        query: { cliente_slug: cliente.slug, tipo: "fechamento_mensal", limit: 12 },
      });
      const doPeriodo = (entregas || []).find((e) => String(e.periodo || "").includes(periodo.competencia));
      return doPeriodo || null;
    }),

    // Atividade (sync runs): account-aware.
    bloco({ escopoConta: true }, () =>
      d.listarSyncRuns({ clienteSlug: cliente.slug, clienteContaId: conta.id, limit: 10 })
    ),
  ]);

  return {
    contexto: { clienteId: cliente.id, clienteSlug: cliente.slug, clienteContaId: conta.id, marketplace: conta.marketplace, competencia: periodo.competencia },
    saude,
    resultado,
    margem,
    ads,
    fechamento,
    atividade,
  };
}

module.exports = { obterVisao, resolverContaObrigatoria, resolverPeriodo };
