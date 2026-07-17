// server/services/centralVendas/centralVendasSyncService.js
// Central de Vendas — caminho API-first (Mercado Livre Orders API).
//
// Fluxo: clienteSlug → cliente_id → token ML → /orders/search no periodo da
// competencia → normaliza pedido/itens → busca base vinculada oficial do
// cliente → cruza MLB com custos → monta motorPayload (pedidos/itens/
// componentes) → persiste via centralVendasRepository.
//
// Regras de honestidade do dado:
//   null = ausente   ·   0 = zero real   ·   nunca inventar frete 0.
//   Pedido sem custo na base e PERSISTIDO mesmo assim, com confianca
//   bloqueada/parcial. Custo vem SEMPRE da base vinculada (nunca planilha).
//
// Nesta fase NAO chamamos GET /shipments/:id: o frete real por pedido fica
// como componente frete_seller com valor null e confianca "ausente".

const pool = require("../../config/database");
const { mlFetch } = require("../../utils/mlClient");
const { toNumber, round2 } = require("../../utils/numberUtils");
const { normalizeId } = require("../../utils/textUtils");
const { periodoFromCompetencia } = require("./centralVendasService");
const { buildResumoCentralVendas } = require("./centralVendasImportService");
const { buscarFretesEmLote } = require("./centralVendasFreteService");

const MAX_PAGINAS = 100; // 100 * 50 = 5.000 pedidos — teto de seguranca (Render)
const PAGE_LIMIT = 50;

function getRepository() {
  return require("./centralVendasRepository");
}

function normalizeSlug(slug) {
  return String(slug || "").trim().toLowerCase();
}

function normalizeCompetencia(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(text)) return text;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function isValidIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function criarErroHttp(statusCode, mensagem) {
  const err = new Error(mensagem);
  err.statusCode = statusCode;
  return err;
}

// ---------------------------------------------------------------------------
// API Mercado Livre — paginacao de pedidos do periodo
// (mesmo padrao de metricasService.fetchAllOrders, replicado para nao acoplar)
// ---------------------------------------------------------------------------

async function fetchAllOrders(clienteId, sellerId, dateFrom, dateTo) {
  let offset = 0;
  const all = [];

  for (let page = 0; page < MAX_PAGINAS; page++) {
    const qs = new URLSearchParams({
      seller: String(sellerId),
      "order.date_created.from": `${dateFrom}T00:00:00.000-03:00`,
      "order.date_created.to": `${dateTo}T23:59:59.999-03:00`,
      limit: String(PAGE_LIMIT),
      offset: String(offset),
    });

    const { ok, status, data } = await mlFetch(clienteId, `/orders/search?${qs}`);

    if (!ok) {
      const statusCode = status === 401 || status === 403 ? 422 : 502;
      const err = criarErroHttp(
        statusCode,
        status === 401 || status === 403
          ? "Token Mercado Livre invalido ou sem permissao para pedidos deste cliente."
          : "Nao foi possivel carregar os pedidos na Orders API do Mercado Livre."
      );
      err.mlStatus = status;
      throw err;
    }

    const results = Array.isArray(data?.results) ? data.results : [];
    all.push(...results);

    if (!results.length) break;
    offset += PAGE_LIMIT;
    if (offset >= (data?.paging?.total || 0)) break;
  }

  return all;
}

// ---------------------------------------------------------------------------
// Base vinculada oficial + custos (preserva null = ausente, 0 = zero real)
// ---------------------------------------------------------------------------

async function buscarBaseECustos(clienteId, db) {
  const vinculoResult = await db.query(
    `SELECT b.id AS base_id, b.nome AS base_nome
       FROM bases b
       INNER JOIN base_cliente_vinculos v ON v.base_id = b.id
      WHERE v.cliente_id = $1
        AND v.ativo = true
        AND b.ativo = true
        AND v.marketplace = 'meli'
      ORDER BY v.updated_at DESC
      LIMIT 1`,
    [clienteId]
  );

  if (!vinculoResult.rows.length) {
    return { base: null, custos: [] };
  }

  const { base_id, base_nome } = vinculoResult.rows[0];
  const custosResult = await db.query(
    `SELECT produto_id, custo_produto, imposto_percentual
       FROM custos
      WHERE base_id = $1`,
    [base_id]
  );

  return {
    base: { id: base_id, nome: base_nome },
    custos: custosResult.rows,
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// 3 variantes de chave (MLB completo, sem prefixo, com prefixo) — mesmo padrao
// de cruzamento ja usado no diagnostico/financeiro.
function buildCostMap(custosRows) {
  const map = new Map();

  for (const row of custosRows || []) {
    const id = normalizeId(row.produto_id);
    if (!id) continue;

    const custoNum = numberOrNull(row.custo_produto);
    const impostoNum = numberOrNull(row.imposto_percentual);
    const entry = {
      cost: custoNum,
      taxPercent: impostoNum,
      hasCost: custoNum !== null && custoNum > 0,
      hasTax: impostoNum !== null,
    };

    const noPrefix = id.replace(/^MLB/i, "");
    if (!map.has(id)) map.set(id, entry);
    if (noPrefix && !map.has(noPrefix)) map.set(noPrefix, entry);
    if (noPrefix && !map.has(`MLB${noPrefix}`)) map.set(`MLB${noPrefix}`, entry);
  }

  return map;
}

function getCost(costMap, mlb) {
  const id = normalizeId(mlb);
  if (!id) return null;
  const noPrefix = id.replace(/^MLB/i, "");
  return costMap.get(id) || costMap.get(noPrefix) || costMap.get(`MLB${noPrefix}`) || null;
}

// ---------------------------------------------------------------------------
// Normalizacao Orders API → motorPayload (pedidos / itens / componentes)
// Mesmo contrato que processMeliForCentralVendas, para o GET ler igual.
// ---------------------------------------------------------------------------

function buildComponent({ pedidoId, itemId, tipo, valor, fonte, confianca, obs }) {
  return {
    pedidoId,
    itemId,
    tipo,
    valor: valor === null || valor === undefined ? null : round2(valor),
    fonte,
    confianca,
    obs: obs || null,
  };
}

// Rateia o frete do pedido entre os itens por unidades (último leva o resto).
// total null ⇒ todos null (ausente). Nunca inventa 0.
function allocateFrete(total, unitsArr) {
  if (total == null) return unitsArr.map(() => null);
  const totalUnits = unitsArr.reduce((s, u) => s + (u || 0), 0);
  if (totalUnits <= 0) return unitsArr.map((_, i) => (i === 0 ? round2(total) : 0));
  const out = [];
  let acc = 0;
  for (let i = 0; i < unitsArr.length; i++) {
    if (i === unitsArr.length - 1) {
      out.push(round2(total - acc));
    } else {
      const v = round2((total / totalUnits) * (unitsArr[i] || 0));
      out.push(v);
      acc = round2(acc + v);
    }
  }
  return out;
}

function buildMotorFromOrders({ orders, costMap, freteMap = new Map(), clienteSlug, competencia }) {
  const pedidos = [];
  const itens = [];
  const componentes = [];

  for (const order of orders) {
    const orderItems = Array.isArray(order.order_items) ? order.order_items : [];
    const pedidoId = String(order.id);
    const logisticType = order.shipping?.logistic_type || null;
    const logistica = logisticType ? (logisticType === "fulfillment" ? "full" : "normal") : null;

    const pedido = {
      pedidoId,
      packId: order.pack_id != null ? String(order.pack_id) : null,
      shipmentId: order.shipping?.id != null ? String(order.shipping.id) : null,
      clienteSlug,
      competencia,
      dataPedido: order.date_created || null,
      status: order.status || null,
      logisticType,
      logistica,
      full: logistica ? logistica === "full" : null,
      quantidadeItens: 0,
      faturamento: 0,
      lucroContribuicao: 0,
      resultado: 0,
      margemContribuicaoPercentual: null,
      confianca: "confiavel",
      pendencias: [],
      _temResultado: false,
    };

    // Frete real do pedido (shipments API), rateado por unidades entre os itens.
    const freteEntry = pedido.shipmentId ? freteMap.get(pedido.shipmentId) : null;
    const orderFrete = freteEntry && freteEntry.status === "real" ? freteEntry.valor : null;
    const freteAlloc = allocateFrete(orderFrete, orderItems.map((oi) => toNumber(oi.quantity)));

    orderItems.forEach((oi, idx) => {
      const mlb = normalizeId(oi.item?.id);
      const sku = String(oi.item?.seller_sku || "").trim() || null;
      const titulo = String(oi.item?.title || "").trim() || null;
      const quantidade = toNumber(oi.quantity);
      const valorUnitario = oi.unit_price != null ? toNumber(oi.unit_price) : null;
      const saleFeeUnit = oi.sale_fee != null ? toNumber(oi.sale_fee) : null;

      const receitaProduto =
        valorUnitario != null && quantidade > 0 ? round2(valorUnitario * quantidade) : null;
      const tarifaVendaTotal =
        saleFeeUnit != null && quantidade > 0 ? round2(saleFeeUnit * quantidade) : null;

      const costEntry = getCost(costMap, mlb);
      const hasProduct = !!mlb && quantidade > 0 && receitaProduto != null;
      const hasCost = !!costEntry && costEntry.hasCost;
      const hasTax = !!costEntry && costEntry.hasTax;
      const hasTarifa = tarifaVendaTotal != null;

      const custoProduto = hasCost ? round2(costEntry.cost * quantidade) : null;
      const impostoDec = hasTax
        ? costEntry.taxPercent > 1
          ? costEntry.taxPercent / 100
          : costEntry.taxPercent
        : 0;
      const impostoInterno =
        hasTax && receitaProduto != null ? round2(receitaProduto * impostoDec) : null;

      // Frete real do item (rateado do pedido). null = ausente; usa no LC só se real.
      const freteItem = freteAlloc[idx];
      const hasFrete = freteItem != null;

      const pendencias = [];
      if (!hasProduct) pendencias.push("produto_ausente");
      if (!hasCost) pendencias.push("custo_produto_ausente");
      if (!hasTarifa) pendencias.push("tarifa_venda_ausente");
      if (!hasTax) pendencias.push("imposto_interno_ausente");
      if (!hasFrete) pendencias.push("frete_seller_ausente");

      const bloqueado = !hasProduct || !hasCost;
      const parcial = !bloqueado && (!hasTax || !hasTarifa || !hasFrete);
      const confianca = bloqueado ? "bloqueado" : parcial ? "parcial" : "confiavel";

      let lucroContribuicao = null;
      let margemContribuicaoPercentual = null;
      if (!bloqueado) {
        // Resultado/LC só desconta frete quando ele for real.
        lucroContribuicao = round2(
          receitaProduto - (tarifaVendaTotal || 0) - (custoProduto || 0) - (impostoInterno || 0) - (hasFrete ? freteItem : 0)
        );
        margemContribuicaoPercentual =
          receitaProduto > 0 ? round2((lucroContribuicao / receitaProduto) * 100) : 0;
      }

      const itemId = `${pedidoId}:${mlb || "SEM_ID"}:${idx}`;
      itens.push({
        pedidoId,
        itemId,
        mlb: mlb || null,
        sku,
        titulo,
        quantidade,
        valorUnitario,
        receitaProduto,
        custoProduto,
        impostoInterno,
        lucroContribuicao,
        resultado: lucroContribuicao,
        margemContribuicaoPercentual,
        confianca,
        pendencias,
      });

      componentes.push(
        buildComponent({
          pedidoId,
          itemId,
          tipo: "receita_produto",
          valor: receitaProduto,
          fonte: hasProduct ? "orders_api" : "ausente",
          confianca: hasProduct ? "real" : "bloqueado",
          obs: hasProduct ? null : "Produto ausente ou incompleto na Orders API.",
        }),
        buildComponent({
          pedidoId,
          itemId,
          tipo: "tarifa_venda",
          valor: tarifaVendaTotal == null ? null : -tarifaVendaTotal,
          fonte: hasTarifa ? "orders_api" : "ausente",
          confianca: hasTarifa ? "real" : "ausente",
          obs: hasTarifa ? null : "Tarifa de venda (sale_fee) ausente na Orders API.",
        }),
        buildComponent({
          pedidoId,
          itemId,
          tipo: "custo_produto",
          valor: custoProduto == null ? null : -custoProduto,
          fonte: hasCost ? "base_vinculada" : "ausente",
          confianca: hasCost ? "real" : "bloqueado",
          obs: hasCost ? null : "MLB sem custo na base vinculada do cliente.",
        }),
        buildComponent({
          pedidoId,
          itemId,
          tipo: "imposto_interno",
          valor: impostoInterno == null ? null : -impostoInterno,
          fonte: hasTax ? "base_vinculada" : "ausente",
          confianca: hasTax ? "real" : "ausente",
          obs: hasTax ? null : "Imposto interno ausente na base vinculada.",
        }),
        buildComponent({
          pedidoId,
          itemId,
          tipo: "frete_seller",
          valor: hasFrete ? -freteItem : null,
          fonte: hasFrete ? "shipments_api" : "ausente",
          confianca: hasFrete ? "real" : "ausente",
          obs: hasFrete ? null : "Frete real indisponível para este envio (shipment).",
        })
      );

      pedido.quantidadeItens = round2(pedido.quantidadeItens + quantidade);
      pedido.faturamento = round2(pedido.faturamento + (receitaProduto || 0));
      if (lucroContribuicao !== null) {
        pedido.lucroContribuicao = round2(pedido.lucroContribuicao + lucroContribuicao);
        pedido.resultado = pedido.lucroContribuicao;
        pedido._temResultado = true;
      }
      for (const pend of pendencias) {
        if (!pedido.pendencias.includes(pend)) pedido.pendencias.push(pend);
      }
      if (confianca === "bloqueado") pedido.confianca = "bloqueado";
      else if (confianca === "parcial" && pedido.confianca !== "bloqueado") pedido.confianca = "parcial";
    });

    // finishPedido: ausencia nunca vira 0 — sem resultado confiavel ⇒ null.
    if (pedido.confianca === "bloqueado" || !pedido._temResultado) {
      pedido.lucroContribuicao = null;
      pedido.resultado = null;
      pedido.margemContribuicaoPercentual = null;
    } else {
      pedido.lucroContribuicao = round2(pedido.lucroContribuicao);
      pedido.resultado = pedido.lucroContribuicao;
      pedido.margemContribuicaoPercentual =
        pedido.faturamento > 0
          ? round2((pedido.lucroContribuicao / pedido.faturamento) * 100)
          : 0;
    }
    delete pedido._temResultado;
    pedidos.push(pedido);
  }

  // resumo interno (mesmos campos de processMeliForCentralVendas)
  const receitaConfiavel = round2(
    pedidos.filter((p) => p.confianca === "confiavel").reduce((s, p) => s + Number(p.faturamento || 0), 0)
  );
  const receitaParcial = round2(
    pedidos.filter((p) => p.confianca === "parcial").reduce((s, p) => s + Number(p.faturamento || 0), 0)
  );
  const receitaBloqueada = round2(
    pedidos.filter((p) => p.confianca === "bloqueado").reduce((s, p) => s + Number(p.faturamento || 0), 0)
  );
  const faturamento = round2(receitaConfiavel + receitaParcial);
  const pedidosComResultado = pedidos.filter((p) => p.lucroContribuicao !== null && p.lucroContribuicao !== undefined);
  const lucroContribuicao = pedidosComResultado.length
    ? round2(pedidosComResultado.reduce((s, p) => s + Number(p.lucroContribuicao || 0), 0))
    : null;

  const totaisPorTipo = {};
  for (const tipo of ["receita_produto", "tarifa_venda", "frete_seller", "custo_produto", "imposto_interno"]) {
    totaisPorTipo[tipo] = round2(
      componentes
        .filter((c) => c.tipo === tipo && c.valor !== null)
        .reduce((s, c) => s + Number(c.valor || 0), 0)
    );
  }

  return {
    pedidos,
    itens,
    componentes,
    resumo: {
      clienteSlug,
      competencia,
      pedidosTotal: pedidos.length,
      pedidosConfiaveis: pedidos.filter((p) => p.confianca === "confiavel").length,
      pedidosParciais: pedidos.filter((p) => p.confianca === "parcial").length,
      pedidosBloqueados: pedidos.filter((p) => p.confianca === "bloqueado").length,
      faturamento,
      lucroContribuicao,
      margemContribuicaoPercentual:
        lucroContribuicao !== null && faturamento > 0
          ? round2((lucroContribuicao / faturamento) * 100)
          : null,
      receitaConfiavel,
      receitaParcial,
      receitaBloqueada,
      totaisPorTipo,
    },
  };
}

// ---------------------------------------------------------------------------
// Orquestrador
// ---------------------------------------------------------------------------

function createCentralVendasSyncService(repository = getRepository(), db = pool) {
  // Aceita { dateFrom, dateTo } (periodo de analise) OU competencia (legado).
  // Busca os pedidos do intervalo numa unica paginacao, agrupa por mes
  // (competencia) e persiste um import por mes — preserva o agrupamento mensal
  // do banco sem prender a UI a um unico mes.
  async function sincronizarVendasMeli({ clienteSlug, competencia, dateFrom, dateTo, marketplace = "meli" }) {
    const slug = normalizeSlug(clienteSlug);
    const marketplaceNorm = String(marketplace || "meli").trim().toLowerCase();

    if (!slug) throw criarErroHttp(400, "slug e obrigatorio.");
    if (marketplaceNorm !== "meli") {
      throw criarErroHttp(400, "Marketplace invalido para Central de Vendas nesta fase.");
    }

    // Resolve o intervalo: dateFrom/dateTo tem prioridade; senao deriva da competencia.
    let from;
    let to;
    if (isValidIsoDate(dateFrom) && isValidIsoDate(dateTo)) {
      from = dateFrom <= dateTo ? dateFrom : dateTo;
      to = dateFrom <= dateTo ? dateTo : dateFrom;
    } else {
      const periodo = periodoFromCompetencia(normalizeCompetencia(competencia));
      from = periodo.inicio;
      to = periodo.fim;
    }

    await repository.ensureCentralVendasTables();

    const cliente = await repository.getClienteBySlug(slug);
    if (!cliente) throw criarErroHttp(404, "Cliente nao encontrado.");

    // Token / seller ML
    const tokenResult = await db.query(
      "SELECT ml_user_id FROM ml_tokens WHERE cliente_id = $1 LIMIT 1",
      [cliente.id]
    );
    const sellerId = tokenResult.rows[0]?.ml_user_id;
    if (!sellerId) throw criarErroHttp(422, "Cliente sem Mercado Livre conectado.");

    // Base vinculada oficial + custos (tolerante: sem base ⇒ tudo bloqueado, mas persiste)
    const { base, custos } = await buscarBaseECustos(cliente.id, db);
    const costMap = buildCostMap(custos);

    // Pedidos via Orders API (intervalo inteiro numa paginacao)
    const orders = await fetchAllOrders(cliente.id, sellerId, from, to);

    // Frete real por pedido (shipments API): busca em lote, cache + concorrencia
    // baixa + cap de seguranca. Falha por shipment NAO trava o sync.
    const shipmentIds = orders.map((o) => o.shipping?.id).filter((v) => v != null);
    const freteLote = await buscarFretesEmLote({ clienteId: cliente.id, shipmentIds });
    const freteMap = freteLote.freteMap;

    // Agrupa por competencia (mes de date_created)
    const grupos = new Map();
    for (const order of orders) {
      const comp = String(order.date_created || "").slice(0, 7);
      const compKey = /^\d{4}-\d{2}$/.test(comp) ? comp : normalizeCompetencia();
      if (!grupos.has(compKey)) grupos.set(compKey, []);
      grupos.get(compKey).push(order);
    }

    let pedidosPersistidos = 0;
    let itensPersistidos = 0;
    let componentesPersistidos = 0;
    const porCompetencia = [];

    for (const [comp, groupOrders] of grupos) {
      const motorResult = buildMotorFromOrders({
        orders: groupOrders,
        costMap,
        freteMap,
        clienteSlug: slug,
        competencia: comp,
      });
      if (!motorResult.pedidos.length) continue;

      const resumo = buildResumoCentralVendas(motorResult);
      const motorPayload = { ...motorResult, resumo };
      const persisted = await repository.persistCentralVendasImport({
        cliente,
        marketplace: marketplaceNorm,
        competencia: comp,
        fonte: "orders_api",
        motorPayload,
        resumo,
      });

      pedidosPersistidos += persisted.pedidosPersistidos;
      itensPersistidos += persisted.itensPersistidos;
      componentesPersistidos += persisted.componentesPersistidos;
      porCompetencia.push({
        competencia: comp,
        importId: persisted.importacao.id,
        pedidos: persisted.pedidosPersistidos,
      });
    }

    console.log(
      `[centralVendas] sync ${slug} ${from}..${to}:` +
        ` orders=${orders.length} meses=${grupos.size} pedidos=${pedidosPersistidos}` +
        ` baseVinculada=${base ? base.id : "nenhuma"} custosNaBase=${custos.length}` +
        ` shipments=${freteLote.buscados}/${freteLote.total} comFrete=${freteLote.comFrete}`
    );

    return {
      ok: true,
      fonte: "orders_api",
      cliente,
      marketplace: marketplaceNorm,
      periodo: { dateFrom: from, dateTo: to },
      porCompetencia,
      baseVinculada: base ? { id: base.id, nome: base.nome, custos: custos.length } : null,
      ordersEncontrados: orders.length,
      frete: {
        shipmentsUnicos: freteLote.total,
        shipmentsBuscados: freteLote.buscados,
        comFreteReal: freteLote.comFrete,
        capExcedido: freteLote.capExcedido,
      },
      pedidosPersistidos,
      itensPersistidos,
      componentesPersistidos,
    };
  }

  return { sincronizarVendasMeli };
}

module.exports = {
  sincronizarVendasMeli: (params) => createCentralVendasSyncService().sincronizarVendasMeli(params),
  createCentralVendasSyncService,
  buildMotorFromOrders,
  buildCostMap,
  getCost,
  buscarBaseECustos,
  fetchAllOrders,
};
