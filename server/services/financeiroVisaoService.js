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
//
// ---------------------------------------------------------------------------
// V3 P2.6 — o que mudou e por quê (auditoria BLOCO A→G)
// ---------------------------------------------------------------------------
// BLOCO C — `parsePeriodo` local virou `exigirCompetencia` (competenciaCanonica),
//   que distingue PERIODO_OBRIGATORIO de PERIODO_INVALIDO e nunca cai no mês
//   atual em silêncio.
//
// BLOCO E — a seleção do fechamento do período usava
//   `String(e.periodo || "").includes(periodo)`. Como `entregas_cliente.periodo`
//   é VARCHAR(100) de texto livre, uma entrega gravada como "2026-07 a 2026-08"
//   respondia por Julho E por Agosto — exatamente o "Julho ser processado como
//   Agosto" que a missão proíbe. Agora a comparação é de igualdade sobre a
//   competência normalizada (`mesmaCompetencia`).
//
// BLOCO E — não existe UNIQUE(cliente, tipo, periodo) na tabela e o INSERT não
//   tem ON CONFLICT, então DUPLICATAS são possíveis (e prováveis: o único
//   anti-duplicata era uma variável de memória do browser). Quando há mais de
//   um fechamento para a mesma competência, escolhemos de forma DETERMINÍSTICA
//   (publicado > mais recente > maior id) e DECLARAMOS a ambiguidade em
//   `resultado.ambiguidade` em vez de escolher em silêncio.
//
// BLOCO F + D1 — `resultado.escopoConta` deixou de ser um `false` fixo.
//   `entregas_cliente` ganhou `cliente_conta_id` (aditivo, NULLABLE, sem
//   backfill — ver sql/migrations/20260828_entregas_cliente_conta_p26.sql), então
//   a partir de agora a entrega registra a OPERAÇÃO que gerou o número.
//   O campo passa a dizer a verdade sobre CADA resposta:
//     true  → a entrega encontrada registra esta operação;
//     false → não há entrega, ou a entrega é legada (sem operação registrada)
//             e portanto é do CLIENTE, não desta conta — declarado em
//             `resultado.origemClientLevel`, nunca escondido.
//   O bloco `relatorios` mantém `escopoConta: false` de propósito: a lista
//   MISTURA, deliberadamente, as entregas desta operação com as legadas sem
//   operação registrada (esconder as antigas fingiria que o histórico do
//   cliente começa na migração). Cada item carrega `clienteContaId` para o
//   frontend distinguir os três casos sem que o envelope precise mentir.
//   Nenhuma entrega histórica foi atribuída a uma conta — isso exigiria
//   decisão humana e está proibido nesta missão.
//
// BLOCO G — `relatorios[].periodo` era devolvido cru: podia vir null, ISO,
//   "Maio 2026" ou texto livre, e o frontend não tinha como comparar nem
//   ordenar. Agora `periodo` é sempre `YYYY-MM` OU `null` (honesto), e o valor
//   original fica em `periodoBruto` para diagnóstico. Nada é fabricado.
//
// BLOCO S — `listarEntregas` era chamado DUAS vezes, com argumentos idênticos,
//   dentro do mesmo `Promise.all` (fan-out desnecessário). Agora é uma chamada
//   só, e os dois blocos derivam dela.

const {
  resolverClientePorIdOuSlug,
  obterConta,
  sanitizarConta,
} = require("./clienteContas/clienteContaService");
const { CODIGOS_CANONICOS } = require("../utils/erroContextoCanonico");
const {
  exigirCompetencia,
  rangeDaCompetencia,
  normalizarCompetencia,
  mesmaCompetencia,
} = require("../utils/competenciaCanonica");
const { getMercadoPagoReconciliationForRange } = require("./centralVendas/centralVendasMp3ReadService");
const { listarEntregas } = require("./entregasClienteService");

// Quantas entregas do histórico são consideradas. Mantido em 24 (2 anos de
// fechamento mensal) — o mesmo valor de antes.
const LIMITE_HISTORICO = 24;

function criarErroHttp(statusCode, mensagem, extra = {}) {
  const err = new Error(mensagem);
  err.statusCode = statusCode;
  Object.assign(err, extra);
  return err;
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

// Compatibilidade: `parsePeriodo` continua exportado com a MESMA forma de
// retorno de antes ({ periodo, dateFrom, dateTo }), agora sem o fallback
// silencioso. Não é usado internamente — permanece para não quebrar quem
// já importava.
function parsePeriodo(periodoRaw) {
  const { competencia, dateFrom, dateTo } = rangeDaCompetencia(periodoRaw);
  return { periodo: competencia, dateFrom, dateTo };
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

// Ordem determinística entre entregas concorrentes da MESMA competência.
// Sem UNIQUE na tabela, duplicatas existem; o que não pode existir é a
// resposta MUDAR entre dois requests idênticos.
//   1. publicada vence rascunho (é o que o cliente final enxerga);
//   2. mais recente vence;
//   3. maior id vence (desempate final, sempre total).
function compararEntregas(a, b, clienteContaId = null) {
  // V3 P2.6 D1 — a entrega DESTA operacao vence a entrega sem operacao
  // registrada. Sem isso, uma entrega legada poderia responder no lugar da
  // entrega especifica da conta que o usuario esta olhando.
  if (clienteContaId != null) {
    const daContaA = Number(a.cliente_conta_id) === Number(clienteContaId) ? 1 : 0;
    const daContaB = Number(b.cliente_conta_id) === Number(clienteContaId) ? 1 : 0;
    if (daContaA !== daContaB) return daContaB - daContaA;
  }

  const pubA = a.publicado === true || a.status === "publicado" ? 1 : 0;
  const pubB = b.publicado === true || b.status === "publicado" ? 1 : 0;
  if (pubA !== pubB) return pubB - pubA;

  const tA = Date.parse(a.created_at || "") || 0;
  const tB = Date.parse(b.created_at || "") || 0;
  if (tA !== tB) return tB - tA;

  return Number(b.id || 0) - Number(a.id || 0);
}

// Seleciona o fechamento da competência pedida. Devolve também quantos
// candidatos existiam, para o chamador poder DECLARAR a ambiguidade.
function selecionarFechamentoDoPeriodo(entregas, competencia, clienteContaId = null) {
  const candidatos = (entregas || []).filter((e) => mesmaCompetencia(e.periodo, competencia));
  if (!candidatos.length) return { entrega: null, candidatos: [] };
  const ordenados = candidatos.slice().sort((a, b) => compararEntregas(a, b, clienteContaId));
  return { entrega: ordenados[0], candidatos: ordenados };
}

// BLOCO G — histórico com competência canônica. `periodo` é sempre YYYY-MM ou
// null; `periodoBruto` preserva o que está gravado (diagnóstico e migração).
function montarHistorico(entregas) {
  return (entregas || []).map((e) => ({
    id: e.id ?? null,
    periodo: normalizarCompetencia(e.periodo),
    periodoBruto: e.periodo ?? null,
    // V3 P2.6 D1 — null significa "sem operacao registrada" (entrega antiga),
    // NUNCA "conta 0". O frontend distingue os tres casos: desta operacao,
    // de outra operacao, sem operacao registrada.
    clienteContaId: e.cliente_conta_id ?? null,
    status: e.status,
    geradoEm: e.created_at,
    publicado: !!e.publicado,
    token: e.publicado ? e.token_publico : null,
  }));
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
  // BLOCO C — competência EXPLÍCITA. Ausente e inválida são erros distintos e
  // nenhum dos dois vira "mês atual".
  const competencia = exigirCompetencia(periodoRaw);
  const { dateFrom, dateTo } = rangeDaCompetencia(competencia);
  const isMeli = conta.marketplace === "meli";

  // BLOCO S — UMA leitura de entregas serve os dois blocos (resultado e
  // relatórios). Antes eram duas chamadas idênticas em paralelo.
  const [entregasBloco, conciliacao] = await Promise.all([
    bloco({ escopoConta: false }, async () => {
      const { entregas } = await d.listarEntregas({
        query: {
          cliente_slug: cliente.slug,
          tipo: "fechamento_mensal",
          limit: LIMITE_HISTORICO,
          // V3 P2.6 D1 — desta operacao, mais as entregas antigas sem operacao
          // registrada (elas nao sao de OUTRA conta; elas nao tem conta).
          cliente_conta_id: conta.id,
          incluir_sem_conta: "true",
        },
      });
      return entregas || [];
    }),

    // Conciliação Mercado Pago: account-aware, só MELI (MP é o meio de
    // pagamento do Mercado Livre neste backend).
    bloco({ escopoConta: true, aplicavel: isMeli, motivoInaplicavel: "Conciliação Mercado Pago está disponível só para operações Mercado Livre." }, () =>
      d.getMercadoPagoReconciliationForRange(cliente.slug, {
        dateFrom, dateTo,
        marketplace: conta.marketplace, clienteContaId: conta.id,
      })
    ),
  ]);

  const entregas = entregasBloco.disponivel ? entregasBloco.dados : [];
  const { entrega, candidatos } = entregasBloco.disponivel
    ? selecionarFechamentoDoPeriodo(entregas, competencia, conta.id)
    : { entrega: null, candidatos: [] };

  // V3 P2.6 BLOCO F — escopoConta deixa de ser um `false` fixo e passa a dizer
  // a VERDADE sobre a resposta que esta sendo devolvida:
  //   true  → a entrega encontrada registra esta operacao (pos-D1);
  //   false → nao ha entrega, ou a entrega e legada (sem operacao registrada),
  //           e portanto e do CLIENTE, nao desta conta.
  // Nao viramos o campo para true no nivel do bloco: enquanto existir entrega
  // legada, o bloco continua podendo responder client-level, e mentir sobre
  // isso seria pior que declarar.
  const entregaDestaConta = !!entrega && Number(entrega.cliente_conta_id) === Number(conta.id);

  const resultado = {
    disponivel: entregasBloco.disponivel && !!entrega,
    escopoConta: entregaDestaConta,
    dados: entrega ? extrairComposicaoDoFechamento(entrega) : null,
    motivo: entregasBloco.disponivel
      ? (entrega ? undefined : "Nenhum fechamento gerado para este período.")
      : entregasBloco.motivo,
  };
  if (entrega && !entregaDestaConta) {
    // Declarado, nunca escondido: o numero na tela e do cliente, nao desta conta.
    resultado.origemClientLevel = {
      motivo: "Este fechamento foi salvo antes de a operacao passar a ser registrada; ele e do cliente, nao desta conta.",
      clienteContaId: entrega.cliente_conta_id ?? null,
    };
  }
  if (candidatos.length > 1) {
    // Não escondemos a duplicata: a UI e a auditoria de migração precisam vê-la.
    resultado.ambiguidade = {
      total: candidatos.length,
      escolhidoId: entrega?.id ?? null,
      ids: candidatos.map((c) => c.id ?? null),
      motivo: "Mais de um fechamento gravado para esta competência (a tabela não tem chave única por cliente/tipo/período).",
    };
  }

  return {
    contexto: {
      clienteId: cliente.id,
      clienteSlug: cliente.slug,
      clienteContaId: conta.id,
      marketplace: conta.marketplace,
      periodo: competencia,
      // A competência SEMPRE veio do request neste endpoint (é obrigatória).
      // O campo existe para o contrato ser simétrico com /operacao/visao, onde
      // o período é opcional por compatibilidade.
      periodoInferido: false,
    },
    resultado,
    conciliacao,
    // relatorios: escopoConta continua false no nivel do bloco porque a lista
    // MISTURA, de proposito, as entregas desta operacao com as legadas sem
    // operacao registrada. Cada item carrega `clienteContaId` para o frontend
    // distinguir os casos sem que o backend precise mentir no envelope.
    relatorios: entregasBloco.disponivel
      ? { disponivel: true, escopoConta: false, dados: montarHistorico(entregas) }
      : entregasBloco,
  };
}

module.exports = {
  obterFinanceiro,
  resolverContaObrigatoria,
  parsePeriodo,
  extrairComposicaoDoFechamento,
  selecionarFechamentoDoPeriodo,
  montarHistorico,
};
