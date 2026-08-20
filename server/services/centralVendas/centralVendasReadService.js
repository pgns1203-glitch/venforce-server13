// server/services/centralVendas/centralVendasReadService.js
//
// M7 — Read API canônica e paginada.
//
// Não é um segundo motor de leitura: reaproveita integralmente
// `centralVendasService.resolveRangeContext` (seleção published/candidate/
// legacy do M4, account-awareness do M1, cobertura do M4) e
// `buildPayloadFromRange` (motor/summary/completude — M3/M4 — e o contrato
// de pedido por item/componente — M5/M6), exatamente como o GET legado.
//
// O que este arquivo adiciona é só leitura: filtro, busca, ordenação
// determinística e paginação sobre a lista de pedidos JÁ CALCULADA pelo
// motor canônico — nenhuma fórmula financeira nova, nenhuma seleção de
// snapshot paralela.

const pool = require("../../config/database");

function getRepository() {
  return require("./centralVendasRepository");
}

const {
  createCentralVendasService,
  buildPayloadFromRange,
  buildContextoPayload,
  buildResumoFromRange,
  buildDiario,
  buildAbcProdutos,
} = require("./centralVendasService");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampPage(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function clampLimit(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

// Espelha QUICK_FILTERS de Portal/fechamentos-api.js — mesma semântica,
// mesmas chaves, calculada sobre o contrato de pedido já canônico
// (buildPedidoContrato), nunca recalculada a partir de dado bruto.
function pedidoMatchesQuick(o, q) {
  switch (q) {
    case "sem_custo": return !!o.mlb && o.custoStatus === "ausente";
    case "sem_frete": return o.entraNoResultado && o.frete == null;
    case "frete_real": return o.frete != null;
    case "calculavel": return o.resultado != null;
    case "bloqueados": return o.resultadoStatus === "bloqueado" && o.entraNoResultado;
    case "receita_bloqueada": return o.resultadoStatus === "bloqueado" && o.entraNoResultado;
    case "cancel_problema": return o.status === "cancelado" || o.status === "com_problema";
    case "full": return o.full === true;
    case "normal": return o.full !== true;
    default: return true;
  }
}

// Espelha o filtro avançado "status" de Portal/fechamentos-api.js.
function pedidoMatchesStatus(o, s) {
  switch (s) {
    case "valido": return o.status === "pago";
    case "cancelado": return o.status === "cancelado";
    case "problema": return o.status === "com_problema";
    case "bloqueado": return o.resultadoStatus === "bloqueado" && o.entraNoResultado;
    default: return true;
  }
}

// Espelha o filtro avançado "logistica" de Portal/fechamentos-api.js.
function pedidoMatchesLogistica(o, l) {
  if (l === "full") return o.full === true;
  if (l === "nao_full") return o.full !== true;
  return true;
}

// Espelha o filtro avançado "diagbase" de Portal/fechamentos-api.js — só as
// opções com_custo/sem_custo sobrevivem ao M9 (no_diag/fora_diag dependiam
// de `produtos[mlb].diag.presente`, que o motor real nunca preenche —
// sempre `false` — então essas duas opções eram inertes com dado real;
// removidas do frontend nesse marco, não portadas aqui).
function pedidoMatchesDiagbase(o, d) {
  if (d === "com_custo") return o.custoStatus === "real";
  if (d === "sem_custo") return o.custoStatus === "ausente";
  return true;
}

// Mesmos campos que a busca local de Portal/fechamentos-api.js
// (pedidoMatchesSearch) já usa.
function pedidoMatchesSearch(o, term) {
  if (!term) return true;
  return String(o.id || "").toLowerCase().includes(term)
    || String(o.mlb || "").toLowerCase().includes(term)
    || String(o.sku || "").toLowerCase().includes(term)
    || String(o.produto?.titulo || "").toLowerCase().includes(term)
    || String(o.status || "").toLowerCase().includes(term)
    || String(o.logistica || "").toLowerCase().includes(term);
}

// Ordenação determinística: cada critério compara primeiro pelo campo
// pedido, depois SEMPRE por rowId como desempate — nunca dois pedidos
// empatados podem trocar de página entre requisições (seção 12).
const CONF_RANK = { bloqueado: 0, parcial: 1, confiavel: 2 };
function compareByRowId(x, y) {
  return (Number(x.rowId) || 0) - (Number(y.rowId) || 0);
}
function sortPedidos(arr, key) {
  const a = arr.slice();
  const withTieBreak = (cmp) => (x, y) => { const r = cmp(x, y); return r !== 0 ? r : compareByRowId(x, y); };
  const desc = (f) => withTieBreak((x, y) => (Number(f(y)) || 0) - (Number(f(x)) || 0));
  const asc = (f) => withTieBreak((x, y) => (Number(f(x)) || 0) - (Number(f(y)) || 0));
  switch (key) {
    case "data_asc": a.sort(withTieBreak((x, y) => String(x.data || "").localeCompare(String(y.data || "")))); break;
    case "fat_desc": a.sort(desc((o) => o.valor)); break;
    case "fat_asc": a.sort(asc((o) => o.valor)); break;
    case "comissao_desc": a.sort(desc((o) => o.taxas)); break;
    case "frete_desc": a.sort(desc((o) => o.frete)); break;
    case "custo_desc": a.sort(desc((o) => o.custo)); break;
    case "resultado_desc": a.sort(desc((o) => o.resultado)); break;
    case "bloqueada_desc": a.sort(desc((o) => (o.resultadoStatus === "bloqueado" && o.entraNoResultado) ? (o.valor || 0) : 0)); break;
    case "confianca": a.sort(withTieBreak((x, y) => (CONF_RANK[x.confianca] ?? 9) - (CONF_RANK[y.confianca] ?? 9))); break;
    case "data_desc":
    default: a.sort(withTieBreak((x, y) => String(y.data || "").localeCompare(String(x.data || "")))); break;
  }
  return a;
}

function buildSnapshotMeta(snapshot) {
  if (!snapshot?.importacao) return null;
  const importacao = snapshot.importacao;
  return {
    importId: importacao.id,
    fonte: importacao.fonte || null,
    publicationStatus: importacao.publication_status || null,
    coverageDateFrom: importacao.coverage_date_from || null,
    coverageDateTo: importacao.coverage_date_to || null,
    publishedAt: importacao.published_at || null,
    geradoEm: importacao.created_at || null,
  };
}

// Campos "leves" da linha — sem itens/componentes (payload pesado fica só
// no detalhe sob demanda, seção 9 do M7).
function toListRow(pedido) {
  const { itens, componentes, ...resto } = pedido;
  return resto;
}

function createCentralVendasReadService(repository = getRepository(), db = pool) {
  const base = createCentralVendasService(repository, db);

  async function getCentralVendasRead(clienteSlug, params = {}) {
    const {
      dateFrom, dateTo, marketplace = "meli", clienteContaId = null,
      page, limit, sort = "data_desc",
      filtro = "todos", status = "todos", logistica = "todos", diagbase = "todos", search = "",
      // M9 — refinamento de data DENTRO do período já selecionado (clique num
      // dia/linha de "Vendas por dia"). Nunca troca o período de análise
      // (dateFrom/dateTo, que continua definindo `summary`/`motor`/
      // `completude` — seção 10): só recorta quais pedidos entram nas
      // `rows` paginadas, igual ao antigo filtro local `modo:'intervalo'`.
      dataDe = null, dataAte = null,
      // M9 — recorte independente do "Fechamento do período" (Visão Geral):
      // mesmos valores de `filtro` (todos/sem_custo/sem_frete/bloqueados/
      // calculavel), mas nunca lido como o `filtro` das `rows` — ver seção
      // 10: dois conceitos, dois campos, nunca reaproveita `summary` com
      // outro significado.
      resumoFiltro = "todos",
    } = params;

    const { cliente, context, snapshot, dateFrom: from, dateTo: to } =
      await base.resolveRangeContext(clienteSlug, { dateFrom, dateTo, marketplace, clienteContaId });

    const payload = buildPayloadFromRange(cliente, { dateFrom: from, dateTo: to }, snapshot);
    const termo = String(search || "").trim().toLowerCase();

    const dentroDoSubperiodo = (o) =>
      (!dataDe || (o.data && o.data >= dataDe)) && (!dataAte || (o.data && o.data <= dataAte));

    const filtrados = (payload.pedidos || [])
      .filter(dentroDoSubperiodo)
      .filter((o) => pedidoMatchesQuick(o, filtro))
      .filter((o) => pedidoMatchesStatus(o, status))
      .filter((o) => pedidoMatchesLogistica(o, logistica))
      .filter((o) => pedidoMatchesDiagbase(o, diagbase))
      .filter((o) => pedidoMatchesSearch(o, termo));

    const ordenados = sortPedidos(filtrados, sort);

    const limitClamped = clampLimit(limit);
    const total = ordenados.length;
    const totalPages = total ? Math.ceil(total / limitClamped) : 0;
    const pageClamped = clampPage(page);

    const inicio = (pageClamped - 1) * limitClamped;
    const rows = ordenados.slice(inicio, inicio + limitClamped).map(toListRow);

    const pedidosDoResumoFiltrado = (payload.pedidos || []).filter((o) => pedidoMatchesQuick(o, resumoFiltro));
    const filteredSummary = buildResumoFromRange({}, pedidosDoResumoFiltrado);
    // Pós-venda (claims) não verificado é um sinal do SNAPSHOT inteiro, não
    // de um recorte — nunca calculado por subconjunto. Mesmo ajuste que a
    // tela aplicava localmente após buildFechamentoResumo (seção 6 do M9).
    if (payload.resumo?.claimsIndisponivel && pedidosDoResumoFiltrado.length) {
      filteredSummary.confiancaFechamento = "parcial";
    }

    return {
      ok: true,
      cliente,
      periodo: payload.periodo,
      contexto: buildContextoPayload(context),
      snapshot: buildSnapshotMeta(snapshot),
      motor: payload.motor,
      completude: payload.completude,
      summary: payload.resumo,
      filteredSummary,
      rows,
      pagination: { page: pageClamped, limit: limitClamped, total, totalPages },
    };
  }

  // M9 — agregado diário (Vendas por dia), período inteiro, independente de
  // página/filtro da tabela de pedidos. Mesmo snapshot/payload de
  // getCentralVendasRead — nenhuma segunda seleção de snapshot.
  async function getCentralVendasReadDaily(clienteSlug, params = {}) {
    const { dateFrom, dateTo, marketplace = "meli", clienteContaId = null } = params;
    const { cliente, context, snapshot, dateFrom: from, dateTo: to } =
      await base.resolveRangeContext(clienteSlug, { dateFrom, dateTo, marketplace, clienteContaId });
    const payload = buildPayloadFromRange(cliente, { dateFrom: from, dateTo: to }, snapshot);
    return {
      ok: true,
      cliente,
      periodo: payload.periodo,
      contexto: buildContextoPayload(context),
      snapshot: buildSnapshotMeta(snapshot),
      motor: payload.motor,
      dias: buildDiario(payload.pedidos || []),
    };
  }

  // M9 — Curva ABC / Produtos, período inteiro, independente de
  // página/filtro da tabela de pedidos. Mesmo snapshot/payload de
  // getCentralVendasRead — nenhuma segunda seleção de snapshot.
  async function getCentralVendasReadProducts(clienteSlug, params = {}) {
    const { dateFrom, dateTo, marketplace = "meli", clienteContaId = null } = params;
    const { cliente, context, snapshot, dateFrom: from, dateTo: to } =
      await base.resolveRangeContext(clienteSlug, { dateFrom, dateTo, marketplace, clienteContaId });
    const payload = buildPayloadFromRange(cliente, { dateFrom: from, dateTo: to }, snapshot);
    const { produtos, totalFat } = buildAbcProdutos(payload.pedidos || [], payload.produtos || {});
    return {
      ok: true,
      cliente,
      periodo: payload.periodo,
      contexto: buildContextoPayload(context),
      snapshot: buildSnapshotMeta(snapshot),
      motor: payload.motor,
      produtos,
      totalFaturamento: totalFat,
    };
  }

  async function getCentralVendasReadOrderDetail(clienteSlug, rowId, params = {}) {
    const { dateFrom, dateTo, marketplace = "meli", clienteContaId = null } = params;
    const rowIdNum = Number(rowId);

    const { cliente, snapshot } =
      await base.resolveRangeContext(clienteSlug, { dateFrom, dateTo, marketplace, clienteContaId });

    // Nunca aceita rowId isolado: só existe resposta se o pedido pertencer
    // ao MESMO snapshot já resolvido (cliente/conta/marketplace/publicação)
    // acima — o mesmo escopo que getCentralVendasByRange já aplicou.
    // Evita IDOR por construção, sem checagem extra de posse (seção 9).
    if (!snapshot || !Number.isFinite(rowIdNum)) {
      const err = new Error("Pedido nao encontrado neste snapshot.");
      err.statusCode = 404;
      throw err;
    }

    const payload = buildPayloadFromRange(cliente, { dateFrom, dateTo }, snapshot);
    // `pedido_row_id` é bigint no Postgres: o driver `pg` devolve bigint como
    // STRING (evita perda de precisão), então `pedido.rowId` já chega como
    // string em produção mesmo com `numberOrNull`/atribuição direta — nunca
    // comparar com `===` contra o Number(rowId) da URL (achado real, rodando
    // contra o Postgres de produção — nenhum teste com fake db pegou isso
    // porque os fixtures usavam `id` numérico, não string).
    const pedido = (payload.pedidos || []).find((o) => String(o.rowId) === String(rowIdNum));
    if (!pedido) {
      const err = new Error("Pedido nao encontrado neste snapshot.");
      err.statusCode = 404;
      throw err;
    }

    return { ok: true, pedido };
  }

  return {
    getCentralVendasRead,
    getCentralVendasReadOrderDetail,
    getCentralVendasReadDaily,
    getCentralVendasReadProducts,
    resolveRangeContext: base.resolveRangeContext,
  };
}

module.exports = {
  createCentralVendasReadService,
  getCentralVendasRead: (...args) => createCentralVendasReadService().getCentralVendasRead(...args),
  getCentralVendasReadOrderDetail: (...args) => createCentralVendasReadService().getCentralVendasReadOrderDetail(...args),
  getCentralVendasReadDaily: (...args) => createCentralVendasReadService().getCentralVendasReadDaily(...args),
  getCentralVendasReadProducts: (...args) => createCentralVendasReadService().getCentralVendasReadProducts(...args),
  // Exposto para teste direto das funções puras (filtro/ordenação).
  pedidoMatchesQuick,
  pedidoMatchesStatus,
  pedidoMatchesLogistica,
  pedidoMatchesDiagbase,
  pedidoMatchesSearch,
  sortPedidos,
};
