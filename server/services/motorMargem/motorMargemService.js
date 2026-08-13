// server/services/motorMargem/motorMargemService.js
// ORQUESTRADOR do Motor de Margem — junta as fontes, chama o núcleo puro e
// devolve o contrato que a Central de Margem consome.
//
//   Bases (custos)          ─┐
//   Mercado Livre API       ─┤
//   Central de Vendas       ─┼→ camada de evidências → núcleo → item de margem
//   Mercado Pago (ausente)  ─┤
//   Extensão (sem canal)    ─┘
//
// SOMENTE LEITURA em tudo: SELECT no Postgres, GET no Mercado Livre. Nenhuma
// escrita de preço, promoção, custo ou base.
//
// REÚSO: `exigirContextoPronto` (contextoPrecificacaoService) é a MESMA
// resolução de cliente + grant ML + base MELI vinculada usada pelo Otimizador
// de Precificação. O Motor não refaz consulta em `base_cliente_vinculos`.

const {
  exigirContextoPronto,
  resolverContextoPrecificacao,
} = require("../automacoes/contextoPrecificacaoService");
const { createEvidenceBag, FIELDS } = require("./core/marginEvidence");
const { buildMarginItem } = require("./core/marginItem");
const { LEVELS } = require("./core/marginConfidence");
const { STATUS, DEFAULT_TARGET_MARGIN } = require("./core/marginStatus");
const baseCustos = require("./adapters/baseCustosEvidenceAdapter");
const meliApi = require("./adapters/meliApiEvidenceAdapter");
const centralVendas = require("./adapters/centralVendasEvidenceAdapter");
const settlement = require("./adapters/settlementEvidenceAdapter");
const extensao = require("./adapters/extensionEvidenceAdapter");

const MARKETPLACE = "meli";
const PAGE_LIMIT_DEFAULT = 20;
const PAGE_LIMIT_MAX = 20; // teto do multiget /items?ids= do Mercado Livre
const RESUMO_MAX_ITENS_DEFAULT = 60;
const RESUMO_MAX_ITENS_TETO = 200;
const CONCURRENCY = 5;

function criarErroHttp(statusCode, payload) {
  const err = new Error(payload?.erro || "Erro");
  err.statusCode = statusCode;
  err.payload = payload;
  return err;
}

function isValidIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Período padrão: últimos 30 dias encerrando hoje. A Central pode sobrescrever.
function resolverPeriodo({ dateFrom, dateTo, now = new Date() }) {
  if (isValidIsoDate(dateFrom) && isValidIsoDate(dateTo)) {
    return dateFrom <= dateTo
      ? { dateFrom, dateTo }
      : { dateFrom: dateTo, dateTo: dateFrom };
  }
  const fim = new Date(now);
  const inicio = new Date(now);
  inicio.setDate(inicio.getDate() - 29);
  return { dateFrom: inicio.toISOString().slice(0, 10), dateTo: fim.toISOString().slice(0, 10) };
}

function parseTargetMargin(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_TARGET_MARGIN;
  // Aceita 0.12 e 12 — a Central pode mandar em qualquer das duas escalas.
  const fraction = n > 1 ? n / 100 : n;
  return fraction > 0 && fraction < 1 ? fraction : DEFAULT_TARGET_MARGIN;
}

// Executa `fn` sobre `items` com paralelismo limitado. Evita disparar 40
// requisições simultâneas ao Mercado Livre por página.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Contexto: quais fontes estão disponíveis para este cliente/período
// ---------------------------------------------------------------------------

/**
 * Diagnóstico barato (nenhuma chamada de item ao ML). É o que a Central deve
 * consultar primeiro para explicar uma tela vazia em vez de mostrar zero.
 */
async function obterContextoMargem({ clienteSlug, dateFrom, dateTo }, deps = {}) {
  const db = deps.db;
  const periodo = resolverPeriodo({ dateFrom, dateTo });
  const contexto = await (deps.resolverContexto || resolverContextoPrecificacao)({
    clienteSlugRaw: clienteSlug,
  });

  let vendas = { sincronizado: false, pedidos: [], itens: [], componentes: [], imports: [] };
  try {
    vendas = await (deps.carregarVendas || centralVendas.carregarVendasDoPeriodo)(
      { clienteSlug, dateFrom: periodo.dateFrom, dateTo: periodo.dateTo, marketplace: MARKETPLACE },
      db
    );
  } catch (err) {
    // Central de Vendas indisponível não pode derrubar o diagnóstico: o Motor
    // reporta a fonte como indisponível e segue.
    vendas = { sincronizado: false, pedidos: [], itens: [], componentes: [], imports: [], erro: err.message };
  }

  let custosTotal = 0;
  if (contexto.base) {
    const custos = await (deps.carregarCustos || baseCustos.carregarCustosDaBase)(
      { baseId: contexto.base.id },
      db
    );
    custosTotal = custos.total;
  }

  return {
    ok: true,
    cliente: contexto.cliente,
    periodo,
    marketplace: MARKETPLACE,
    pronto: contexto.pronto,
    motivo: contexto.motivo,
    mensagem: contexto.mensagem,
    fontes: {
      MELI_API: {
        disponivel: contexto.grant.conectado,
        detalhe: contexto.grant.conectado
          ? `grant ML conectado (ml_user_id ${contexto.grant.ml_user_id})`
          : "cliente sem conta ML conectada",
      },
      VENFORCE_BASE: {
        disponivel: Boolean(contexto.base) && custosTotal > 0,
        detalhe: contexto.base
          ? `base "${contexto.base.slug}" vinculada · ${custosTotal} item(ns) com custo`
          : "nenhuma base MELI vinculada ao cliente",
        baseSlug: contexto.base?.slug || null,
        totalCustos: custosTotal,
      },
      MELI_ORDER: {
        disponivel: vendas.sincronizado && vendas.pedidos.length > 0,
        detalhe: vendas.sincronizado
          ? `${vendas.pedidos.length} pedido(s) sincronizado(s) no período pela Central de Vendas`
          : "nenhuma sincronização da Central de Vendas neste período",
        importes: vendas.imports?.length || 0,
      },
      MERCADO_PAGO: {
        disponivel: settlement.mercadoPagoDisponivel(),
        detalhe: settlement.MENSAGENS[settlement.MOTIVOS.NAO_INTEGRADO],
      },
      EXTENSION_DOM: {
        disponivel: false,
        detalhe:
          "a extensão só consome a base de custos; não há rota que receba observações do DOM.",
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Montagem dos itens
// ---------------------------------------------------------------------------

async function montarItens(
  { clienteSlug, baseSlug, dateFrom, dateTo, offset, limit, targetMargin, itemIds },
  deps = {}
) {
  const db = deps.db;
  const now = deps.now || new Date();
  const periodo = resolverPeriodo({ dateFrom, dateTo, now });

  const { cliente, base, mlUserId } = await (deps.exigirContexto || exigirContextoPronto)({
    clienteSlugRaw: clienteSlug,
    baseSlugRaw: baseSlug,
  });

  const custos = await (deps.carregarCustos || baseCustos.carregarCustosDaBase)(
    { baseId: base.id },
    db
  );

  const vendasRaw = await (deps.carregarVendas || centralVendas.carregarVendasDoPeriodo)(
    { clienteSlug: cliente.slug, dateFrom: periodo.dateFrom, dateTo: periodo.dateTo, marketplace: MARKETPLACE },
    db
  );
  const { porMlb, naoAtribuido } = (deps.agregarPorMlb || centralVendas.agregarPorMlb)(vendasRaw);

  // Lista de anúncios: ou os IDs pedidos explicitamente (detalhe de item), ou
  // uma página dos ativos do vendedor.
  let ids;
  let totalItensMl;
  if (Array.isArray(itemIds) && itemIds.length) {
    ids = itemIds.slice(0, PAGE_LIMIT_MAX);
    totalItensMl = ids.length;
  } else {
    const busca = await (deps.buscarItensAtivos || meliApi.buscarItensAtivos)({
      clienteId: cliente.id,
      mlUserId,
      offset,
      limit,
    });
    ids = busca.ids;
    totalItensMl = busca.total;
  }

  const bodies = await (deps.buscarDetalhesItens || meliApi.buscarDetalhesItens)({
    clienteId: cliente.id,
    ids,
  });

  const aplicarProjetadas = deps.aplicarEvidenciasProjetadas || meliApi.aplicarEvidenciasProjetadas;

  const itens = await mapWithConcurrency(bodies, CONCURRENCY, async (body) => {
    const bag = createEvidenceBag();

    // 1) Estado atual do anúncio (MELI_API).
    const observado = await aplicarProjetadas(bag, { clienteId: cliente.id, body, observedAt: now }, deps);

    // 2) Custo/imposto/taxa fixa declarados na Base (VENFORCE_BASE).
    const temCusto = baseCustos.aplicarEvidenciasDeCusto(bag, {
      itemId: observado.itemId,
      index: custos.index,
      baseSlug: base.slug,
    });

    // 3) O que a venda entregou (MELI_ORDER, via Central de Vendas).
    const agregado = porMlb.get(observado.itemId) || null;
    const realizado = centralVendas.aplicarEvidenciasRealizadas(bag, { agregado, observedAt: now });

    // 4) Extensão: sem canal de ingestão hoje (registra nada, mantém o motivo).
    extensao.aplicarEvidenciasDom(bag, extensao.coletar());

    // 5) Conciliação financeira (MERCADO_PAGO — indisponível).
    const conciliacao = settlement.avaliarConciliacao({ hasOrders: Boolean(realizado) });

    const item = buildMarginItem({
      identity: {
        clienteSlug: cliente.slug,
        marketplace: MARKETPLACE,
        itemId: observado.itemId,
        sku: observado.sku || agregado?.sku || null,
        titulo: observado.titulo || agregado?.titulo || null,
      },
      bag,
      sales: {
        hasOrders: Boolean(realizado),
        unidades: realizado?.unidades ?? null,
        pedidos: realizado?.pedidos ?? null,
        receita: realizado?.receita ?? null,
        ultimaVendaEm: realizado?.ultimaVendaEm ?? null,
        resultadoPersistido: realizado?.resultadoPersistido ?? null,
      },
      settlement: { available: conciliacao.available, motivo: conciliacao.motivo },
      targetMargin,
      now,
    });

    // Anexos de diagnóstico — não fazem parte do cálculo, ajudam a Central a
    // explicar o item sem uma segunda chamada.
    item.diagnostico = {
      temCustoNaBase: temCusto,
      baseSlug: base.slug,
      listingTypeId: observado.listingTypeId,
      logisticType: observado.logisticType,
      statusAnuncio: observado.status,
      faltantesMeliApi: observado.faltantes,
      conciliacao: { ...conciliacao },
      realizado: realizado || null,
    };

    return item;
  });

  return {
    cliente,
    base,
    periodo,
    totalItensMl,
    itens,
    vendas: {
      sincronizado: vendasRaw.sincronizado,
      pedidosNoPeriodo: vendasRaw.pedidos.length,
      anunciosComVenda: porMlb.size,
      reembolsoNaoAtribuido: naoAtribuido.reembolso,
    },
  };
}

// ---------------------------------------------------------------------------
// Filtros / ordenação
// ---------------------------------------------------------------------------

const ORDENACOES = {
  margem_asc: (a, b) => valorOrdenacao(a) - valorOrdenacao(b),
  margem_desc: (a, b) => valorOrdenacao(b) - valorOrdenacao(a),
  titulo_asc: (a, b) => String(a.identity.titulo || "").localeCompare(String(b.identity.titulo || ""), "pt-BR"),
};

// Item sem margem vai para o fim de qualquer ordenação por margem: "não sei"
// não pode competir com "-5%".
function valorOrdenacao(item) {
  const displayed = item.margin.realized.computable ? item.margin.realized : item.margin.projected;
  return displayed.margin === null ? Number.POSITIVE_INFINITY : displayed.margin;
}

function aplicarFiltros(itens, { status, confianca, busca, comDivergencia, semCusto }) {
  let out = itens;

  if (status) {
    const alvos = new Set(String(status).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
    out = out.filter((item) => alvos.has(item.quality.status));
  }
  if (confianca) {
    const alvos = new Set(String(confianca).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
    out = out.filter((item) => alvos.has(item.quality.confidence));
  }
  if (comDivergencia === true) {
    out = out.filter((item) => item.quality.divergences.length > 0);
  }
  if (semCusto === true) {
    out = out.filter((item) => !item.costs.cost.value && item.costs.cost.status !== "available");
  }
  if (busca) {
    const termo = String(busca).trim().toLowerCase();
    out = out.filter(
      (item) =>
        String(item.identity.itemId || "").toLowerCase().includes(termo) ||
        String(item.identity.sku || "").toLowerCase().includes(termo) ||
        String(item.identity.titulo || "").toLowerCase().includes(termo)
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// Endpoints de serviço
// ---------------------------------------------------------------------------

/** Lista paginada de itens de margem. */
async function listarItens(params = {}, deps = {}) {
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const limit = Math.min(Math.max(1, parseInt(params.limit, 10) || PAGE_LIMIT_DEFAULT), PAGE_LIMIT_MAX);
  const targetMargin = parseTargetMargin(params.margemAlvo);

  const montado = await montarItens(
    {
      clienteSlug: params.clienteSlug,
      baseSlug: params.baseSlug,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      offset: (page - 1) * limit,
      limit,
      targetMargin,
    },
    deps
  );

  const filtrados = aplicarFiltros(montado.itens, {
    status: params.status,
    confianca: params.confianca,
    busca: params.busca,
    comDivergencia: params.comDivergencia === true || params.comDivergencia === "true",
    semCusto: params.semCusto === true || params.semCusto === "true",
  });

  const ordenacao = ORDENACOES[params.ordenacao] || ORDENACOES.margem_asc;
  const itens = filtrados.slice().sort(ordenacao);

  return {
    ok: true,
    cliente: montado.cliente,
    base: { id: montado.base.id, slug: montado.base.slug, nome: montado.base.nome },
    periodo: montado.periodo,
    margemAlvo: targetMargin,
    paginacao: {
      page,
      limit,
      totalItensMl: montado.totalItensMl,
      // A paginação é do Mercado Livre; os filtros são aplicados DEPOIS, sobre
      // a página carregada. `itensNaPagina` é o que sobrou do filtro.
      itensNaPagina: itens.length,
      itensCarregados: montado.itens.length,
      filtroAplicadoNaPagina: filtrados.length !== montado.itens.length,
    },
    vendas: montado.vendas,
    itens,
  };
}

// ---------------------------------------------------------------------------
// Camada de compatibilidade com o frontend da Central
// ---------------------------------------------------------------------------

/**
 * Acrescenta ao item um punhado de ALIASES achatados.
 *
 * Motivo: `Portal/central-margem-api.js` (frontend da Central, construído em
 * paralelo) sonda `GET /operacao/central-margem/:slug` e lê o item por chaves
 * planas — `itemId`, `title`, `status`, `confidence`, `projected/realized`,
 * `fields`, `divergences` — caindo num adapter legado quando recebe 404.
 *
 * O contrato canônico (identity/pricing/costs/margin/quality) NÃO muda: os
 * aliases são acrescentados por cima, apontando para os mesmos valores. Se o
 * frontend mudar de ideia, basta apagar esta função — nada mais depende dela.
 */
function comAliasesDeCompatibilidade(item) {
  return {
    ...item,
    itemId: item.identity.itemId,
    sku: item.identity.sku,
    title: item.identity.titulo,
    titulo: item.identity.titulo,
    marketplace: item.identity.marketplace,
    status: item.quality.status,
    confidence: item.quality.confidence,
    confianca: item.quality.confidence,
    problema: item.quality.statusReasons[0] || null,
    targetMargin: item.margin.target.marginTarget,
    projected: {
      margin: item.margin.projected.margin,
      profit: item.margin.projected.profit,
      // `estimated` = alguma variável entrou no cálculo assumida como 0.
      estimated: item.margin.projected.strict === false,
      note: item.margin.projected.assumed.length
        ? `Assumido 0 para: ${item.margin.projected.assumed.join(", ")}.`
        : null,
    },
    realized: {
      margin: item.margin.realized.margin,
      profit: item.margin.realized.profit,
      pending: item.margin.realized.computable === false,
    },
    divergences: item.quality.divergences,
    conciliacao: item.settlement.available ? "Disponível" : "Pendente",
  };
}

/**
 * Payload RAIZ da Central de Margem: resumo + lista na mesma resposta.
 * É a rota que o frontend chama primeiro. Read-only, como todas.
 */
async function obterCentralMargem(params = {}, deps = {}) {
  const lista = await listarItens(params, deps);
  const contagemPorStatus = {};
  for (const key of Object.keys(STATUS)) contagemPorStatus[key] = 0;
  for (const item of lista.itens) {
    contagemPorStatus[item.quality.status] = (contagemPorStatus[item.quality.status] || 0) + 1;
  }

  return {
    ...lista,
    itens: lista.itens.map(comAliasesDeCompatibilidade),
    // A lista é uma PÁGINA do catálogo do ML: o resumo abaixo descreve a página,
    // não o catálogo inteiro. O total do catálogo fica em paginacao.totalItensMl
    // e o placar completo (amostrado) vive em /resumo.
    parcial: lista.paginacao.itensCarregados < lista.paginacao.totalItensMl,
    resumo: {
      escopo: "pagina",
      porStatus: contagemPorStatus,
      itensNaPagina: lista.paginacao.itensNaPagina,
      totalItensMl: lista.paginacao.totalItensMl,
      itensComDivergencia: lista.itens.filter((i) => i.quality.divergences.length > 0).length,
    },
  };
}

/** Detalhe de um item — mesma montagem, escopo de 1 anúncio. */
async function obterItem(params = {}, deps = {}) {
  const itemId = String(params.itemId || "").trim().toUpperCase();
  if (!itemId) throw criarErroHttp(400, { ok: false, erro: "itemId é obrigatório." });

  const targetMargin = parseTargetMargin(params.margemAlvo);
  const montado = await montarItens(
    {
      clienteSlug: params.clienteSlug,
      baseSlug: params.baseSlug,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      offset: 0,
      limit: 1,
      targetMargin,
      itemIds: [itemId],
    },
    deps
  );

  const item = montado.itens[0];
  if (!item) {
    throw criarErroHttp(404, {
      ok: false,
      erro: "Anúncio não encontrado no Mercado Livre para este cliente.",
      codigo: "ITEM_NAO_ENCONTRADO",
    });
  }

  return {
    ok: true,
    cliente: montado.cliente,
    base: { id: montado.base.id, slug: montado.base.slug, nome: montado.base.nome },
    periodo: montado.periodo,
    margemAlvo: targetMargin,
    item,
  };
}

function resumoVazio() {
  const porStatus = {};
  for (const key of Object.keys(STATUS)) porStatus[key] = 0;
  const porConfianca = {};
  for (const key of Object.keys(LEVELS)) porConfianca[key] = 0;
  return { porStatus, porConfianca };
}

/**
 * Resumo/placar do período.
 *
 * ⚠️ COBERTURA PARCIAL POR DESENHO: varre no máximo `maxItens` anúncios (padrão
 * 60). Cada anúncio custa 2 chamadas extras ao Mercado Livre (listing_prices +
 * shipping); varrer um catálogo inteiro estouraria o rate limit. O retorno
 * declara quantos foram analisados de quantos existem — a Central deve exibir
 * "amostra de X de Y", nunca apresentar isso como total do catálogo.
 */
async function obterResumo(params = {}, deps = {}) {
  const targetMargin = parseTargetMargin(params.margemAlvo);
  const maxItens = Math.min(
    Math.max(1, parseInt(params.maxItens, 10) || RESUMO_MAX_ITENS_DEFAULT),
    RESUMO_MAX_ITENS_TETO
  );

  const acumulado = resumoVazio();
  const itensAnalisados = [];
  let totalItensMl = 0;
  let cliente = null;
  let base = null;
  let periodo = null;
  let vendas = null;

  for (let offset = 0; offset < maxItens; offset += PAGE_LIMIT_MAX) {
    const limit = Math.min(PAGE_LIMIT_MAX, maxItens - offset);
    const montado = await montarItens(
      {
        clienteSlug: params.clienteSlug,
        baseSlug: params.baseSlug,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        offset,
        limit,
        targetMargin,
      },
      deps
    );

    cliente = montado.cliente;
    base = montado.base;
    periodo = montado.periodo;
    vendas = montado.vendas;
    totalItensMl = montado.totalItensMl;
    itensAnalisados.push(...montado.itens);

    if (montado.itens.length === 0 || offset + limit >= totalItensMl) break;
  }

  for (const item of itensAnalisados) {
    acumulado.porStatus[item.quality.status] = (acumulado.porStatus[item.quality.status] || 0) + 1;
    acumulado.porConfianca[item.quality.confidence] =
      (acumulado.porConfianca[item.quality.confidence] || 0) + 1;
  }

  const comMargem = itensAnalisados
    .map((item) => (item.margin.realized.computable ? item.margin.realized : item.margin.projected))
    .filter((m) => m.margin !== null);
  const margemMedia =
    comMargem.length > 0
      ? Math.round((comMargem.reduce((s, m) => s + m.margin, 0) / comMargem.length) * 1e6) / 1e6
      : null;

  const comErro = itensAnalisados.filter((item) => item.margin.projectionError.comparable);
  const erroProjecaoMedioPp =
    comErro.length > 0
      ? Math.round(
          (comErro.reduce((s, item) => s + item.margin.projectionError.deltaPp, 0) / comErro.length) * 100
        ) / 100
      : null;

  return {
    ok: true,
    cliente,
    base: base ? { id: base.id, slug: base.slug, nome: base.nome } : null,
    periodo,
    margemAlvo: targetMargin,
    cobertura: {
      itensAnalisados: itensAnalisados.length,
      totalItensMl,
      maxItens,
      parcial: itensAnalisados.length < totalItensMl,
      motivoParcial:
        itensAnalisados.length < totalItensMl
          ? "Amostra limitada pelo teto de chamadas ao Mercado Livre (parâmetro maxItens)."
          : null,
    },
    vendas,
    placar: {
      ...acumulado,
      margemMedia,
      margemMediaPercent: margemMedia === null ? null : Math.round(margemMedia * 10000) / 100,
      itensComMargem: comMargem.length,
      itensSemMargem: itensAnalisados.length - comMargem.length,
      erroProjecaoMedioPp,
      itensComDivergencia: itensAnalisados.filter((item) => item.quality.divergences.length > 0).length,
    },
    // Fila de exceções: o que precisa de ação, do mais urgente para o menos.
    excecoes: itensAnalisados
      .filter((item) => item.quality.status !== STATUS.HEALTHY)
      .sort((a, b) => valorOrdenacao(a) - valorOrdenacao(b))
      .slice(0, 20)
      .map((item) => ({
        itemId: item.identity.itemId,
        titulo: item.identity.titulo,
        status: item.quality.status,
        statusLabel: item.quality.statusLabel,
        confidence: item.quality.confidence,
        margemProjetadaPercent: item.margin.projected.marginPercent,
        margemRealizadaPercent: item.margin.realized.marginPercent,
        problemaPrincipal: item.quality.statusReasons[0] || null,
      })),
  };
}

module.exports = {
  MARKETPLACE,
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  RESUMO_MAX_ITENS_DEFAULT,
  RESUMO_MAX_ITENS_TETO,
  obterContextoMargem,
  obterCentralMargem,
  listarItens,
  obterItem,
  obterResumo,
  comAliasesDeCompatibilidade,
  montarItens,
  aplicarFiltros,
  resolverPeriodo,
  parseTargetMargin,
  mapWithConcurrency,
  criarErroHttp,
  FIELDS,
};
