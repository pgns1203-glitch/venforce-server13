// server/services/cliente360/cliente360V3HistoricoService.js
//
// FASE 6 (Projeto_cliente360) — Histórico compõe EVENTOS TIPADOS de fontes
// reais que já têm timestamp verdadeiro. Nunca finge que `activity_logs`
// (tabela genérica de auditoria de usuário, sem cliente_id/cliente_conta_id
// — ver activityLogService.js) é uma timeline account-scoped: essa fonte
// fica de fora, é um gap real e documentado, não contornado com parsing de
// `detalhes` textual.
//
// Fontes usadas, cada uma um `blocoSeguro` independente (a falha de uma não
// derruba as outras — mesmo padrão da Fase 5):
//   - entregas (entregas_cliente, via listarEntregas): já é account-aware
//     (cliente_conta_id + fallback legado NULL, nunca escondido, nunca
//     backfillado — ver entregasClienteService.js). Cada evento herda o
//     escopo REAL da linha (account se cliente_conta_id bate com a conta
//     ativa, client_legacy se a linha é anterior à Fundação de Contas).
//   - sincronização (central_vendas_sync_runs, via listarSyncRuns):
//     genuinamente account-scoped (clienteContaId é filtro de SQL).
//   - ações do consultor (cliente_360_acoes, via cliente360AcoesRepository):
//     a tabela NÃO tem cliente_conta_id — client_legacy sempre, rotulado
//     como tal, sem inventar uma coluna nova sem decisão humana (prompt
//     master Fase 6: "não criar novo ledger/schema sem necessidade").
//
// "Fechamentos" como fonte separada do prompt master: não existe timestamp
// real de "quando o fechamento foi apurado" fora do próprio evento de
// entrega tipo `fechamento_mensal` — inventar um timestamp para o fechamento
// em si violaria "não inventar dado". Por isso fechamento vira só um dos
// SUBTIPOS do evento "entrega" (tipo=fechamento_mensal), não uma 4ª fonte.

const { listarEntregas } = require("../entregasClienteService");
const { listarSyncRuns } = require("../centralVendas/centralVendasSyncRunService");
const acoesRepoDefault = require("./cliente360AcoesRepository");
const { blocoSeguro } = require("./cliente360V3Envelope");

const FATOR_LABEL = {
  custo: "Correção de custo", frete: "Renegociação de frete", preco: "Reprecificação",
  comissao: "Correção de comissão", imposto: "Correção de imposto",
  mix: "Melhoria de mix", produto: "Pausa/retomada de produto", base: "Correção de base",
  ads: "Ação de mídia (legado)", tacos: "Ação de mídia (legado)",
};

function timestampOuNulo(...candidatos) {
  for (const c of candidatos) if (c) return c;
  return null;
}

async function eventosDeEntregas({ clienteSlug, clienteContaId, limite }, deps = {}) {
  return blocoSeguro(async () => {
    const { entregas } = await (deps.listarEntregas || listarEntregas)({
      query: { cliente_slug: clienteSlug, cliente_conta_id: clienteContaId, limit: limite },
    });
    return (entregas || []).map((e) => ({
      tipo: "entrega",
      subtipo: e.tipo,
      fonte: "entregas_cliente",
      // Escopo REAL por linha — não é uma etiqueta fixa: entregas criadas
      // antes da Fundação de Contas têm cliente_conta_id NULL e continuam
      // legado, entregas criadas depois já nascem com a conta.
      escopo: e.cliente_conta_id != null ? "account" : "client_legacy",
      clienteContaId: e.cliente_conta_id ?? null,
      timestamp: timestampOuNulo(e.published_at, e.updated_at, e.created_at),
      ator: e.created_by ?? null,
      competencia: e.periodo ?? null,
      titulo: e.titulo ?? null,
      status: e.status ?? null,
      publicado: Boolean(e.publicado),
    }));
  }, { escopo: "account", fonteNome: "entregas_cliente_service" });
}

async function eventosDeSincronizacao({ clienteSlug, clienteContaId, limite }, deps = {}) {
  return blocoSeguro(async () => {
    const runs = await (deps.listarSyncRuns || listarSyncRuns)({ clienteSlug, clienteContaId, limit: limite });
    return (runs || []).map((r) => ({
      tipo: "sincronizacao",
      subtipo: r.status,
      fonte: "central_vendas_sync_run_service",
      escopo: "account",
      clienteContaId: r.clienteContaId ?? clienteContaId,
      timestamp: timestampOuNulo(r.finishedAt, r.startedAt, r.createdAt),
      // sanitizeRun() não expõe quem pediu a sincronização — não inventado.
      ator: null,
      competencia: null,
      titulo: r.dateFrom && r.dateTo ? `Sincronização ${r.dateFrom} a ${r.dateTo}` : "Sincronização",
      status: r.status ?? null,
      erro: r.error || null,
    }));
  }, { escopo: "account", fonteNome: "central_vendas_sync_run_service" });
}

async function eventosDeAcoes({ clienteSlug, marketplace, limite }, deps = {}) {
  const acoesRepo = deps.acoesRepo || acoesRepoDefault;
  return blocoSeguro(async () => {
    const acoes = await acoesRepo.listarAcoes(clienteSlug, { marketplace });
    return acoes.slice(-limite).reverse().map((a) => ({
      tipo: "acao_consultor",
      subtipo: a.fator,
      fonte: "cliente_360_acoes",
      // cliente_360_acoes não tem cliente_conta_id — sempre o cliente
      // inteiro, nunca uma conta específica (mesmo achado estrutural do
      // Motor de Margem na Fase 3 e do cliente360AdsService na Fase 5).
      escopo: "client_legacy",
      clienteContaId: null,
      timestamp: a.created_at ?? null,
      ator: a.autor ?? null,
      competencia: a.competencia ?? null,
      titulo: FATOR_LABEL[String(a.fator || "").toLowerCase()] || a.fator,
      mlb: a.mlb ?? null,
      produtoTitulo: a.titulo ?? null,
    }));
  }, { escopo: "client_legacy", fonteNome: "cliente_360_acoes_repository" });
}

// Junta as fontes que resolveram; cada uma é um bloco independente — a
// falha de uma nunca esconde as outras (mesmo padrão da Fase 5: Promise.all
// de blocoSeguro, nunca um try/catch único que perde tudo).
async function listarEventos({ clienteSlug, clienteContaId, marketplace, limite = 30 }, deps = {}) {
  const limiteSeguro = Math.max(1, Math.min(200, Number(limite) || 30));

  const [entregasEnv, syncEnv, acoesEnv] = await Promise.all([
    eventosDeEntregas({ clienteSlug, clienteContaId, limite: limiteSeguro }, deps),
    eventosDeSincronizacao({ clienteSlug, clienteContaId, limite: limiteSeguro }, deps),
    eventosDeAcoes({ clienteSlug, marketplace, limite: limiteSeguro }, deps),
  ]);

  const eventos = [
    ...(entregasEnv.disponivel ? entregasEnv.dados : []),
    ...(syncEnv.disponivel ? syncEnv.dados : []),
    ...(acoesEnv.disponivel ? acoesEnv.dados : []),
  ]
    .filter((ev) => ev.timestamp)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limiteSeguro);

  return {
    eventos,
    fontes: {
      entregas: { disponivel: entregasEnv.disponivel, motivo: entregasEnv.motivo || null },
      sincronizacao: { disponivel: syncEnv.disponivel, motivo: syncEnv.motivo || null },
      acoes: { disponivel: acoesEnv.disponivel, motivo: acoesEnv.motivo || null },
    },
  };
}

module.exports = { listarEventos };
