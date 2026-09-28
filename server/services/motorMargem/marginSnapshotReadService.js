// server/services/motorMargem/marginSnapshotReadService.js
// Margin Snapshot — leitura da Central de Margem pelo snapshot (M5).
//
//   GET .../snapshot/resumo  → estado da leitura da conta (missing/ready),
//                              run ativo/último run, contagens
//   GET .../snapshot/itens   → página de itens: PROJETADA do snapshot +
//                              REALIZADA da Central de Vendas no período
//
// Regras (não negociáveis):
//   - Nenhuma chamada ao Mercado Livre e nenhum recálculo da projetada: os
//     números projetados saem da linha persistida pelo worker. Este módulo
//     não importa mlClient, meliApiEvidenceAdapter nem enrichBatch.
//   - A REALIZADA continua vindo da Central de Vendas (mesmo adapter e mesma
//     política de import legado do Motor ao vivo) e é calculada pelo MESMO
//     núcleo (resolveField + valueForKind + computeMargin), só para a página.
//   - Sempre por conta explícita, validada contra o cliente.
//   - Conta sem snapshot NUNCA vira "0 itens": estado `missing` + ação.
//
// Feature flag (rollout): MARGIN_SNAPSHOT_READ_ENABLED=true liga para todos;
// MARGIN_SNAPSHOT_READ_CLIENTES=slug-a,slug-b liga só para esses clientes.
// Desligada, a tela usa o caminho legado (/workspace ao vivo) e as rotas de
// leitura por snapshot respondem que o modo está desabilitado.

const pool = require("../../config/database");
const snapshotRepository = require("./marginSnapshotRepository");
const runRepository = require("./marginSnapshotRunRepository");
const api = require("./marginSnapshotApiService");
const core = require("./core");
const centralVendas = require("./adapters/centralVendasEvidenceAdapter");
const settlement = require("./adapters/settlementEvidenceAdapter");
const { flagLigada } = require("./marginSnapshotConfig");
const { redigirSegredos } = require("./marginSnapshotSanitize");

const MARKETPLACE = "meli";
const LIMIT_PADRAO = 50;
const LIMIT_MAX = 200; // teto de UMA página da API (nunca o catálogo inteiro)

function leituraHabilitada({ clienteSlug } = {}, env = process.env) {
  if (flagLigada(env.MARGIN_SNAPSHOT_READ_ENABLED)) return true;
  const lista = String(env.MARGIN_SNAPSHOT_READ_CLIENTES || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(clienteSlug) && lista.includes(String(clienteSlug).trim().toLowerCase());
}

function erroDesabilitado() {
  return api.criarErroHttp(
    404,
    "Leitura da Central de Margem por snapshot desabilitada para este cliente.",
    "MARGIN_SNAPSHOT_READ_DISABLED"
  );
}

function paginacao({ page, limit }) {
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || LIMIT_PADRAO, 1), LIMIT_MAX);
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  return { page: pageNum, limit: limitNum, offset: (pageNum - 1) * limitNum };
}

// ---------------------------------------------------------------------------
// Filtros e ordenação da lista (M6) — validados aqui, montados no builder do
// repository. Valor fora do enum/whitelist = 400 explícito, nunca ignorado
// em silêncio (um filtro ignorado mostraria "tudo" como se fosse o filtro).
// ---------------------------------------------------------------------------

const BUSCA_MAX = 100;

function listaDeEnum(raw, validos, { maiusculo = true, nome }) {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const valores = String(raw).split(",").map((v) => v.trim()).filter(Boolean).map((v) => (maiusculo ? v.toUpperCase() : v.toLowerCase()));
  const invalidos = valores.filter((v) => !validos.includes(v));
  if (invalidos.length) {
    throw api.criarErroHttp(400, `Filtro "${nome}" inválido. Aceitos: ${validos.join(", ")}.`, "FILTRO_INVALIDO");
  }
  return Array.from(new Set(valores));
}

function lerFiltros(params = {}, repo = snapshotRepository) {
  const buscaBruta = params.busca ?? params.q ?? null;
  const busca = typeof buscaBruta === "string" ? buscaBruta.trim().slice(0, BUSCA_MAX) : null;
  return {
    status: listaDeEnum(params.status, repo.STATUS_VALIDOS, { nome: "status" }),
    refreshStatus: listaDeEnum(params.refreshStatus, repo.REFRESH_STATUS_VALIDOS, { maiusculo: false, nome: "refreshStatus" }),
    confianca: listaDeEnum(params.confianca, repo.CONFIANCA_VALIDOS, { nome: "confianca" }),
    statusAnuncio: listaDeEnum(params.statusAnuncio, repo.STATUS_ANUNCIO_VALIDOS, { maiusculo: false, nome: "statusAnuncio" }),
    busca: busca || null,
  };
}

function lerOrdenacao(params = {}, repo = snapshotRepository) {
  const ordem = repo.resolverOrdenacao({ ordenacao: params.ordenacao, direcao: params.direcao });
  if (!ordem) {
    throw api.criarErroHttp(
      400,
      "Ordenação inválida. Aceitas: margin_percent, profit, status, updated_at, calculated_at, titulo (ASC|DESC).",
      "ORDENACAO_INVALIDA"
    );
  }
  return ordem;
}

// ---------------------------------------------------------------------------
// Estado da leitura da conta
// ---------------------------------------------------------------------------

async function carregarEstado({ cliente, conta }, deps = {}) {
  const db = deps.db || pool;
  const repo = deps.snapshotRepository || snapshotRepository;
  const runs = deps.runRepository || runRepository;

  const filtro = repo.montarFiltroSnapshots({ clienteId: cliente.id, clienteContaId: conta.id, marketplace: MARKETPLACE });
  const [contagem, runAtivo, ultimoRun, ultimoCompleto] = await Promise.all([
    repo.countProjectionSnapshotsFiltrado({ filtro, db }),
    runs.findActiveRunForAccount({ clienteId: cliente.id, clienteContaId: conta.id, marketplace: MARKETPLACE, db }),
    runs.findLatestFinishedRunForAccount({ clienteId: cliente.id, clienteContaId: conta.id, marketplace: MARKETPLACE, db }),
    runs.findLatestCompletedRunForAccount({ clienteId: cliente.id, clienteContaId: conta.id, marketplace: MARKETPLACE, db }),
  ]);

  // `ready`: existe leitura persistida (linhas), OU um run já completou com
  // catálogo vazio (vazio de verdade, não "nunca calculado").
  const estado = contagem.total > 0 || ultimoCompleto ? "ready" : "missing";
  return { estado, contagem, runAtivo, ultimoRun, filtro };
}

function mensagemEstado(estado, runAtivo) {
  if (estado === "ready") return null;
  return runAtivo
    ? "A primeira leitura desta conta está sendo calculada. Os itens aparecem ao final da atualização."
    : "Esta conta ainda não tem leitura de margem calculada. Clique em \"Atualizar leitura\" para calcular.";
}

async function obterResumo({ clienteSlug, clienteContaId }, deps = {}) {
  const env = deps.env || process.env;
  if (!leituraHabilitada({ clienteSlug }, env)) {
    return { ok: true, habilitado: false, modo: "legacy" };
  }
  const db = deps.db || pool;
  const repo = deps.snapshotRepository || snapshotRepository;
  const { cliente, conta } = await api.resolverContaDoCliente({ clienteSlug, clienteContaId }, deps);
  const { estado, contagem, runAtivo, ultimoRun, filtro } = await carregarEstado({ cliente, conta }, deps);

  // KPIs: agregação no banco sobre a conta inteira (independe de página ou
  // filtro da lista). `missing` → null: nunca placar zerado fingindo leitura.
  let kpis = null;
  let foraDoCatalogo = null;
  if (estado === "ready") {
    const filtroFora = repo.montarFiltroSnapshots({
      clienteId: cliente.id, clienteContaId: conta.id, marketplace: MARKETPLACE, somenteForaDoCatalogo: true,
    });
    const [agregado, fora] = await Promise.all([
      repo.summarizeProjectionSnapshots({ filtro, db }),
      repo.countProjectionSnapshotsFiltrado({ filtro: filtroFora, db }),
    ]);
    const { ultimoCalculoEm, ...placar } = agregado;
    kpis = placar;
    foraDoCatalogo = fora.total;
  }

  return {
    ok: true,
    habilitado: true,
    modo: "snapshot",
    cliente,
    conta,
    marketplace: MARKETPLACE,
    estado,
    acao: estado === "missing" && !runAtivo ? "refresh" : null,
    mensagem: mensagemEstado(estado, runAtivo),
    snapshot: {
      totalItens: estado === "missing" ? null : contagem.total,
      ultimoCalculoEm: contagem.ultimoCalculoEm,
      foraDoCatalogo,
    },
    kpis,
    refresh: {
      runAtivo: api.runPublico(runAtivo),
      ultimoRun: api.runPublico(ultimoRun),
    },
  };
}

// ---------------------------------------------------------------------------
// Composição do item: projetada (snapshot) + realizada (Central de Vendas)
// ---------------------------------------------------------------------------

async function carregarRealizadaDoPeriodo({ cliente, conta, dateFrom, dateTo }, deps = {}) {
  const db = deps.db || pool;
  // Lazy: motorMargemService carrega adapters do ML — só as funções de
  // período/política de legado são usadas aqui.
  const motor = require("./motorMargemService");
  const periodo = motor.resolverPeriodo({ dateFrom, dateTo, now: deps.now || new Date() });
  const includeLegacy = await motor.resolverIncludeLegacy({ clienteId: cliente.id, contaId: conta.id }, deps);
  const vendasRaw = await (deps.carregarVendas || centralVendas.carregarVendasDoPeriodo)(
    {
      clienteSlug: cliente.slug,
      dateFrom: periodo.dateFrom,
      dateTo: periodo.dateTo,
      marketplace: MARKETPLACE,
      clienteContaId: conta.id,
      includeLegacy,
    },
    db
  );
  const agregado = (deps.agregarPorMlb || centralVendas.agregarPorMlb)({
    pedidosTodos: vendasRaw.pedidosTodos || vendasRaw.pedidos,
    pedidosResultado: vendasRaw.pedidos,
    itens: vendasRaw.itens,
    componentes: vendasRaw.componentes,
  });
  return {
    periodo,
    sincronizado: vendasRaw.sincronizado === true,
    pedidosNoPeriodo: Array.isArray(vendasRaw.pedidos) ? vendasRaw.pedidos.length : 0,
    porMlb: agregado.porMlb,
    reembolsoPorMlb: agregado.reembolsoPorMlb,
    fallbackObservedAt: vendasRaw.importSnapshotAt || null,
  };
}

const CAMPOS_MARGEM = [
  core.FIELDS.PRICE, core.FIELDS.COST, core.FIELDS.TAX_RATE,
  core.FIELDS.FIXED_FEE, core.FIELDS.COMMISSION, core.FIELDS.FREIGHT,
];

function percentual(margin) {
  return margin === null || margin === undefined ? null : Math.round(margin * 10000) / 100;
}

/**
 * Monta o item no mesmo contrato que a Central já consome (fields/quality/
 * projected/realized + aliases planos), com:
 *  - projected: EXATAMENTE os números da linha do snapshot (sem recálculo);
 *  - fields: evidências projetadas persistidas + evidências realizadas da
 *    Central de Vendas, resolvidas pelo núcleo (divergência previsto ×
 *    realizado incluída);
 *  - realized: núcleo (computeMargin) sobre as evidências REALIZADAS;
 *  - status/confiança: os do snapshot (classificação da PROJETADA —
 *    `statusBase: "projected"`).
 */
function comporItem(row, realizada, deps = {}) {
  const computeMargin = deps.computeMargin || core.computeMargin;
  const bag = core.createEvidenceBag();

  for (const [campo, lista] of Object.entries(row.quality?.evidencias || {})) {
    for (const e of lista || []) {
      bag.add(campo, {
        source: e.source, kind: core.EVIDENCE_KINDS.PROJECTED, quality: e.quality,
        value: e.value, observedAt: e.observedAt, note: e.note,
      });
    }
  }

  const agregado = realizada.porMlb.get(row.itemId) || null;
  const realizado = centralVendas.aplicarEvidenciasRealizadas(bag, { agregado, fallbackObservedAt: realizada.fallbackObservedAt });
  const reembolso = realizada.reembolsoPorMlb.get(row.itemId) || null;
  centralVendas.aplicarEvidenciaReembolso(bag, { reembolso, fallbackObservedAt: realizada.fallbackObservedAt });

  const fields = core.resolveAllFields(bag);
  const hasOrders = Boolean(realizado);

  // Mesmo cálculo do realizado de buildMarginItem: só com venda; valores
  // REALIZED de cada variável — nunca caindo para o projetado.
  const realized = hasOrders
    ? computeMargin(Object.fromEntries(CAMPOS_MARGEM.map((k) => [k, core.valueForKind(fields[k], core.EVIDENCE_KINDS.REALIZED)])))
    : { computable: false, profit: null, margin: null, missing: ["order"], assumed: [], strict: false };

  const conciliacao = settlement.avaliarConciliacao({ hasOrders });
  const divergences = [];
  for (const key of Object.keys(fields)) {
    for (const d of fields[key].divergences) divergences.push({ field: key, ...d });
  }

  const quality = row.quality || {};
  const projected = {
    profit: row.profit,
    margin: row.margin,
    marginPercent: row.marginPercent,
    computable: row.margin !== null,
    strict: (row.assumed || []).length === 0 && row.margin !== null,
    missing: row.missing || [],
    assumed: row.assumed || [],
  };
  const realizedContrato = {
    profit: realized.profit,
    margin: realized.margin,
    marginPercent: percentual(realized.margin),
    computable: realized.computable,
    strict: realized.strict,
    missing: realized.missing,
    assumed: realized.assumed,
  };

  return {
    identity: {
      clienteSlug: null, marketplace: row.marketplace, itemId: row.itemId,
      sku: row.sku, titulo: row.titulo, image: row.imageUrl,
    },
    fields,
    margin: {
      projected,
      realized: realizedContrato,
      target: { marginTarget: quality.targetMargin ?? null },
    },
    quality: {
      confidence: row.confidenceLevel,
      confidenceByField: quality.confidenceByField || {},
      reasons: quality.reasons || [],
      divergences,
      hasConflict: quality.hasConflict === true,
      hasDrift: divergences.some((d) => d.type === "DRIFT"),
      status: row.status,
      statusLabel: quality.statusLabel || null,
      statusSeverity: quality.statusSeverity || null,
      statusReasons: quality.statusReasons || [],
    },
    statusBase: "projected",
    sales: {
      hasOrders,
      unidades: realizado?.unidades ?? null,
      pedidos: realizado?.pedidos ?? null,
      receita: realizado?.receita ?? null,
      ultimaVendaEm: realizado?.ultimaVendaEm ?? null,
    },
    settlement: { available: conciliacao.available, motivo: conciliacao.motivo },
    snapshot: {
      refreshStatus: row.refreshStatus,
      calculatedAt: row.calculatedAt,
      observedAt: row.observedAt,
      runId: row.runId,
      lastError: row.lastError ? redigirSegredos(row.lastError, 300) : null,
    },
    diagnostico: {
      temCustoNaBase: quality.temCustoNaBase ?? null,
      faltantesMeliApi: quality.faltantesMeliApi || [],
      statusAnuncio: quality.statusAnuncio || null,
    },

    // Aliases planos que o frontend da Central já lê (mesmos de
    // motorMargemService.comAliasesDeCompatibilidade).
    itemId: row.itemId,
    sku: row.sku,
    title: row.titulo,
    titulo: row.titulo,
    image: row.imageUrl,
    marketplace: row.marketplace,
    status: row.status,
    confidence: row.confidenceLevel,
    confianca: row.confidenceLevel,
    problema: (quality.statusReasons || [])[0] || null,
    targetMargin: quality.targetMargin ?? null,
    projected: {
      margin: projected.margin,
      profit: projected.profit,
      estimated: projected.margin !== null && projected.assumed.length > 0,
      note: projected.assumed.length ? `Assumido 0 para: ${projected.assumed.join(", ")}.` : null,
    },
    realized: {
      margin: realizedContrato.margin,
      profit: realizedContrato.profit,
      pending: realizedContrato.computable === false,
    },
    divergences,
    conciliacao: conciliacao.available ? "Disponível" : "Pendente",
  };
}

// ---------------------------------------------------------------------------
// Lista paginada
// ---------------------------------------------------------------------------

async function listarItens(params = {}, deps = {}) {
  const env = deps.env || process.env;
  const { clienteSlug, clienteContaId } = params;
  if (!leituraHabilitada({ clienteSlug }, env)) throw erroDesabilitado();

  const db = deps.db || pool;
  const repo = deps.snapshotRepository || snapshotRepository;
  // Filtros/ordenação validados ANTES de qualquer consulta.
  const filtros = lerFiltros(params, repo);
  const ordem = lerOrdenacao(params, repo);
  const { cliente, conta } = await api.resolverContaDoCliente({ clienteSlug, clienteContaId }, deps);
  const pag = paginacao(params);
  const { estado, runAtivo, ultimoRun } = await carregarEstado({ cliente, conta }, deps);
  const filtro = repo.montarFiltroSnapshots({
    clienteId: cliente.id, clienteContaId: conta.id, marketplace: MARKETPLACE, ...filtros,
  });

  const base = {
    ok: true,
    modo: "snapshot",
    cliente,
    conta,
    marketplace: MARKETPLACE,
    estado,
    filtros,
    ordenacao: { chave: ordem.chave, direcao: ordem.direcao },
    refresh: { runAtivo: api.runPublico(runAtivo), ultimoRun: api.runPublico(ultimoRun) },
  };

  if (estado === "missing") {
    return {
      ...base,
      acao: runAtivo ? null : "refresh",
      mensagem: mensagemEstado(estado, runAtivo),
      // null, não 0: "não sabemos" nunca vira "nenhum item".
      paginacao: { page: pag.page, limit: pag.limit, total: null, totalPaginas: null },
      itens: [],
    };
  }

  const [linhas, contagem] = await Promise.all([
    repo.queryProjectionSnapshotsPage({ filtro, orderBy: ordem.orderBy, limit: pag.limit, offset: pag.offset, db }),
    repo.countProjectionSnapshotsFiltrado({ filtro, db }),
  ]);
  const realizada = await carregarRealizadaDoPeriodo({ cliente, conta, dateFrom: params.dateFrom, dateTo: params.dateTo }, deps);

  return {
    ...base,
    periodo: realizada.periodo,
    vendas: { sincronizado: realizada.sincronizado, pedidosNoPeriodo: realizada.pedidosNoPeriodo },
    paginacao: {
      page: pag.page,
      limit: pag.limit,
      total: contagem.total,
      totalPaginas: Math.max(Math.ceil(contagem.total / pag.limit), 1),
    },
    ultimoCalculoEm: contagem.ultimoCalculoEm,
    itens: linhas.map((row) => comporItem(row, realizada, deps)),
  };
}

module.exports = {
  LIMIT_PADRAO,
  LIMIT_MAX,
  leituraHabilitada,
  obterResumo,
  listarItens,
  comporItem,
  carregarRealizadaDoPeriodo,
};
