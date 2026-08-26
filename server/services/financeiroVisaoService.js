// server/services/financeiroVisaoService.js
//
// GET /financeiro/:cliente?conta=&periodo=YYYY-MM (VenForce V3 Master Spec
// §12.4, §18.4) — LEITURA de composição, não o fluxo de processamento de
// fechamento (que continua em server/controllers/fechamentosFinanceiroController.js,
// intocado). Nome do arquivo evita colidir com o financeiroController do
// fluxo de upload já existente.
//
// Mesma regra de visaoService.js: cada bloco resolvido de forma
// independente, `disponivel`/`escopoConta` honestos, nenhum cálculo novo.
// `composicao[].disponivel` é OBRIGATÓRIO no sentido do Master Spec M6:
// "não disponível" != 0 — aqui herdado do próprio payload_json da entrega
// (estrutura livre, ver §15 do deliverable), nunca preenchido com zero
// quando a fonte não existe.

const {
  resolverClientePorIdOuSlug,
  obterConta,
  sanitizarConta,
} = require("./clienteContas/clienteContaService");
const { CODIGOS_CANONICOS } = require("../utils/erroContextoCanonico");
const { getMercadoPagoReconciliationForRange } = require("./centralVendas/centralVendasMp3ReadService");
const { listarEntregas } = require("./entregasClienteService");

function criarErroHttp(statusCode, mensagem, extra = {}) {
  const err = new Error(mensagem);
  err.statusCode = statusCode;
  Object.assign(err, extra);
  return err;
}

function parsePeriodo(periodoRaw) {
  const m = String(periodoRaw || "").trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) throw criarErroHttp(400, "periodo é obrigatório no formato YYYY-MM.");
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dateFrom = `${m[1]}-${m[2]}-01`;
  const dateTo = new Date(ano, mes, 0).toISOString().slice(0, 10); // último dia do mês
  return { periodo: `${m[1]}-${m[2]}`, dateFrom, dateTo };
}

// Mesma validação de conta obrigatória de visaoService.js — Financeiro
// também é `scope="account"`, nunca escolhe a conta em silêncio.
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

// Extrai o "resultado" e a "composição" de um fechamento já salvo — o
// payload_json de entregas_cliente é uma estrutura LIVRE (cards/secoes/
// tabelas, autorada manualmente via POST/PATCH admin, não um schema
// financeiro fixo). Nunca inventa uma chave que não existe no registro:
// devolve o que está lá (cards/secoes) e deixa a ausência honesta.
function extrairComposicaoDoFechamento(entrega) {
  if (!entrega) return { status: "nao_gerado", geradoEm: null, cards: [], composicao: [] };
  const payload = entrega.payload_json || {};
  return {
    status: entrega.status || "rascunho",
    geradoEm: entrega.created_at || null,
    publicadoEm: entrega.published_at || null,
    cards: Array.isArray(payload.cards) ? payload.cards : [],
    // composicao[].disponivel obrigatório (M6): aqui é sempre true porque só
    // entram itens que o próprio fechamento já gravou; nada é completado com 0.
    composicao: Array.isArray(payload.cards)
      ? payload.cards.map((c) => ({ chave: c.chave || c.label || null, rotulo: c.label || c.titulo || null, valor: c.valor ?? null, disponivel: c.valor != null }))
      : [],
  };
}

async function obterFinanceiro({ clienteSlugRaw, clienteContaIdRaw, periodoRaw }, deps = {}) {
  const d = {
    resolverClientePorIdOuSlug,
    obterConta,
    sanitizarConta,
    getMercadoPagoReconciliationForRange,
    listarEntregas,
    ...deps,
  };

  const { cliente, conta } = await resolverContaObrigatoria({ clienteSlugRaw, clienteContaIdRaw }, d);
  const periodo = parsePeriodo(periodoRaw);
  const isMeli = conta.marketplace === "meli";

  const [entregasDoPeriodo, historico, conciliacao] = await Promise.all([
    bloco({ escopoConta: false }, async () => {
      const { entregas } = await d.listarEntregas({
        query: { cliente_slug: cliente.slug, tipo: "fechamento_mensal", limit: 24 },
      });
      return (entregas || []).find((e) => String(e.periodo || "").includes(periodo.periodo)) || null;
    }),

    // Histórico: mesma fonte, sem filtrar o período — escopo cliente inteiro
    // (entregas_cliente não tem cliente_conta_id).
    bloco({ escopoConta: false }, async () => {
      const { entregas } = await d.listarEntregas({
        query: { cliente_slug: cliente.slug, tipo: "fechamento_mensal", limit: 24 },
      });
      return (entregas || []).map((e) => ({
        periodo: e.periodo, status: e.status, geradoEm: e.created_at,
        publicado: !!e.publicado, token: e.publicado ? e.token_publico : null,
      }));
    }),

    // Conciliação Mercado Pago: account-aware, só MELI (MP é o meio de
    // pagamento do Mercado Livre neste backend).
    bloco({ escopoConta: true, aplicavel: isMeli, motivoInaplicavel: "Conciliação Mercado Pago está disponível só para operações Mercado Livre." }, () =>
      d.getMercadoPagoReconciliationForRange(cliente.slug, {
        dateFrom: periodo.dateFrom, dateTo: periodo.dateTo,
        marketplace: conta.marketplace, clienteContaId: conta.id,
      })
    ),
  ]);

  const fechamentoExtraido = entregasDoPeriodo.disponivel
    ? extrairComposicaoDoFechamento(entregasDoPeriodo.dados)
    : null;

  return {
    contexto: { clienteId: cliente.id, clienteSlug: cliente.slug, clienteContaId: conta.id, marketplace: conta.marketplace, periodo: periodo.periodo },
    resultado: {
      disponivel: entregasDoPeriodo.disponivel && !!entregasDoPeriodo.dados,
      escopoConta: false,
      dados: fechamentoExtraido,
      motivo: entregasDoPeriodo.disponivel && !entregasDoPeriodo.dados ? "Nenhum fechamento gerado para este período." : entregasDoPeriodo.motivo,
    },
    conciliacao,
    relatorios: historico,
  };
}

module.exports = { obterFinanceiro, resolverContaObrigatoria, parsePeriodo, extrairComposicaoDoFechamento };
