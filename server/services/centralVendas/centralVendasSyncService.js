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
// Fluxo completo: Orders API → coleta shipment IDs → Shipments Costs API (GET
// /shipments/:id/costs, em lotes via centralVendasFreteService) → frete seller
// real por pedido → motor do fechamento (buildMotorFromOrders) → persistencia
// dos componentes (centralVendasRepository) → Cliente 360 V2. Quando o frete
// real nao e encontrado, o componente frete_seller fica com valor null e
// confianca "ausente" — nunca um frete estimado ou zero inventado.

const pool = require("../../config/database");
const { mlFetch } = require("../../utils/mlClient");
const { createMlTokenService } = require("../mlTokenService");
const { toNumber, round2 } = require("../../utils/numberUtils");
const { normalizeId } = require("../../utils/textUtils");
const {
  periodoFromCompetencia,
  pedidoEntraNoResultado,
  TIPOS_COMPONENTE,
} = require("./centralVendasService");
const { buildResumoCentralVendas } = require("./centralVendasImportService");
const { buscarFretesEmLote } = require("./centralVendasFreteService");
const {
  buscarClaimsPorPeriodo,
  classificarClaimsDoPedido,
} = require("./centralVendasClaimsService");

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

    const { ok, status, data } = await mlFetch(clienteId, `/orders/search?${qs}`, { mlUserId: sellerId });

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

// Reembolso efetivado do pedido — Orders API, `order.payments[]`.
// Usa somente `transaction_amount_refunded`, que é o valor já devolvido ao
// comprador. Nada é derivado de total_paid_amount, shipping_cost ou
// marketplace_fee. null = ausente (nenhum pagamento informou reembolso);
// reembolso 0 não gera componente — ausência nunca vira "zero real" falso.
function extrairReembolso(order) {
  const payments = Array.isArray(order?.payments) ? order.payments : [];
  let total = null;

  for (const payment of payments) {
    const bruto = payment?.transaction_amount_refunded;
    if (bruto === null || bruto === undefined) continue;
    const valor = Number(bruto);
    if (!Number.isFinite(valor) || valor <= 0) continue;
    total = round2((total || 0) + valor);
  }

  return total;
}

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

function buildMotorFromOrders({
  orders,
  costMap,
  freteMap = new Map(),
  claimsMap = new Map(),
  claimsIndisponivel = false,
  claimsMotivo = null,
  claimsReturnsNaoResolvidos = 0,
  clienteSlug,
  competencia,
}) {
  const pedidos = [];
  const itens = [];
  const componentes = [];

  for (const order of orders) {
    const orderItems = Array.isArray(order.order_items) ? order.order_items : [];
    const pedidoId = String(order.id);
    const logisticType = order.shipping?.logistic_type || null;
    const logistica = logisticType ? (logisticType === "fulfillment" ? "full" : "normal") : null;
    const claimsEntry = claimsMap.get(pedidoId);
    const claimsPedido = Array.isArray(claimsEntry) ? claimsEntry : claimsEntry ? [claimsEntry] : [];
    const posVenda = classificarClaimsDoPedido(claimsPedido);

    const pedido = {
      pedidoId,
      packId: order.pack_id != null ? String(order.pack_id) : null,
      shipmentId: order.shipping?.id != null ? String(order.shipping.id) : null,
      clienteSlug,
      competencia,
      dataPedido: order.date_created || null,
      status: posVenda?.status || order.status || null,
      statusOriginal: order.status || null,
      posVendaTipo: posVenda?.tipo || null,
      posVendaMotivo: posVenda?.motivo || null,
      // Devolução PARCIAL não cancela o pedido: `posVenda.status` vem null, o
      // status original da Orders API é preservado e o pedido continua no
      // resultado. As quantidades ficam persistidas para auditoria.
      posVendaParcial: posVenda?.parcial === true,
      posVendaQuantidadeComprada: posVenda?.quantidadeComprada ?? null,
      posVendaQuantidadeDevolvida: posVenda?.quantidadeDevolvida ?? null,
      claimId: posVenda?.claimId || null,
      claimIds: claimsPedido.map((claim) => claim?.id).filter((id) => id != null).map(String),
      logisticType,
      logistica,
      full: logistica ? logistica === "full" : null,
      quantidadeItens: 0,
      faturamento: 0,
      receitaEnvio: null,
      reembolso: null,
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

    // ── Componentes de PEDIDO (sem item, não entram no rateio) ─────────────
    // Receita de envio paga pelo COMPRADOR (`receiver.cost` da mesma resposta de
    // GET /shipments/:id/costs). Valor positivo, fonte shipments_api. Não é
    // contrapartida nem fallback de `frete_seller` e NÃO entra na fórmula do
    // Resultado Parcial — fica persistida e exposta no payload para conciliação.
    if (pedido.shipmentId) {
      const receitaEnvio = freteEntry ? freteEntry.receitaComprador ?? null : null;
      const temReceitaEnvio = receitaEnvio !== null;
      if (temReceitaEnvio) pedido.receitaEnvio = round2(Math.abs(receitaEnvio));
      componentes.push(
        buildComponent({
          pedidoId,
          itemId: null,
          tipo: "receita_envio",
          valor: temReceitaEnvio ? Math.abs(receitaEnvio) : null,
          fonte: temReceitaEnvio ? "shipments_api" : "ausente",
          confianca: temReceitaEnvio ? "real" : "ausente",
          obs: temReceitaEnvio ? null : "receiver.cost ausente na resposta de /shipments/:id/costs.",
        })
      );
    }

    // Reembolso efetivado (Orders API, payments[].transaction_amount_refunded).
    // Só existe quando há valor real: ausência não gera componente zero falso.
    // O valor NÃO é somado ao Resultado Parcial — quando o pedido sai do
    // resultado, a receita já foi excluída; descontar o reembolso de novo seria
    // dupla contagem. Fica persistido para a visão de conciliação financeira.
    const reembolso = extrairReembolso(order);
    if (reembolso !== null) {
      pedido.reembolso = round2(reembolso);
      componentes.push(
        buildComponent({
          pedidoId,
          itemId: null,
          tipo: "cancelamento_reembolso",
          valor: -Math.abs(reembolso),
          fonte: "orders_api_payments",
          confianca: "real",
          obs: "Reembolso efetivado ao comprador. Fora do Resultado Parcial (a receita do pedido ja e excluida) — usar apenas na conciliacao financeira.",
        })
      );
    }

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

  // O pedido pós-venda continua persistido e auditável, mas os agregados do
  // motor usam o mesmo predicado compartilhado por Fechamento e Cliente 360.
  const pedidosResultado = pedidos.filter(pedidoEntraNoResultado);
  const pedidoIdsResultado = new Set(pedidosResultado.map((p) => p.pedidoId));

  // resumo interno (mesmos campos de processMeliForCentralVendas)
  const receitaConfiavel = round2(
    pedidosResultado.filter((p) => p.confianca === "confiavel").reduce((s, p) => s + Number(p.faturamento || 0), 0)
  );
  const receitaParcial = round2(
    pedidosResultado.filter((p) => p.confianca === "parcial").reduce((s, p) => s + Number(p.faturamento || 0), 0)
  );
  const receitaBloqueada = round2(
    pedidosResultado.filter((p) => p.confianca === "bloqueado").reduce((s, p) => s + Number(p.faturamento || 0), 0)
  );
  const faturamento = round2(receitaConfiavel + receitaParcial);
  const pedidosComResultado = pedidosResultado.filter((p) => p.lucroContribuicao !== null && p.lucroContribuicao !== undefined);
  const lucroContribuicao = pedidosComResultado.length
    ? round2(pedidosComResultado.reduce((s, p) => s + Number(p.lucroContribuicao || 0), 0))
    : null;

  const totaisPorTipo = {};
  for (const tipo of TIPOS_COMPONENTE) {
    totaisPorTipo[tipo] = round2(
      componentes
        .filter((c) => pedidoIdsResultado.has(c.pedidoId) && c.tipo === tipo && c.valor !== null)
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
      pedidosValidos: pedidosResultado.length,
      pedidosForaResultado: pedidos.length - pedidosResultado.length,
      pedidosConfiaveis: pedidosResultado.filter((p) => p.confianca === "confiavel").length,
      pedidosParciais: pedidosResultado.filter((p) => p.confianca === "parcial").length,
      pedidosBloqueados: pedidosResultado.filter((p) => p.confianca === "bloqueado").length,
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
      claimsIndisponivel: !!claimsIndisponivel,
      claimsVerificados: !claimsIndisponivel,
      claimsMotivo: claimsIndisponivel ? claimsMotivo || "consulta_indisponivel" : null,
      claimsEncontrados: pedidos.filter((p) => p.claimIds.length > 0).length,
      devolucoes: pedidos.filter((p) => p.posVendaTipo === "devolucao").length,
      devolucoesParciais: pedidos.filter((p) => p.posVendaTipo === "devolucao_parcial").length,
      mediacoes: pedidos.filter((p) => p.posVendaTipo === "mediacao").length,
      // Devolução cujo pedido não pôde ser resolvido pelo detalhe v2: continua
      // não verificada, jamais "sem devolução".
      claimsReturnsNaoResolvidos: Number(claimsReturnsNaoResolvidos) || 0,
      pedidosComReembolso: pedidos.filter((p) => p.reembolso !== null).length,
      confianca: claimsIndisponivel || Number(claimsReturnsNaoResolvidos) > 0 ? "parcial" : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Orquestrador
// ---------------------------------------------------------------------------

function createCentralVendasSyncService(repository = getRepository(), db = pool) {
  const tokenService = createMlTokenService({ db });
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
    let sellerId;
    try {
      sellerId = (await tokenService.resolveMlGrant({ clienteId: cliente.id, requireUsable: true })).ml_user_id;
    } catch (_) {
      sellerId = null;
    }
    if (!sellerId) throw criarErroHttp(422, "Cliente sem Mercado Livre conectado.");

    // Base vinculada oficial + custos (tolerante: sem base ⇒ tudo bloqueado, mas persiste)
    const { base, custos } = await buscarBaseECustos(cliente.id, db);
    const costMap = buildCostMap(custos);

    // Pedidos via Orders API (intervalo inteiro numa paginacao)
    const orders = await fetchAllOrders(cliente.id, sellerId, from, to);

    // Frete e pós-venda são independentes e rodam em paralelo. Claims são
    // buscados por período + seller, nunca uma vez por pedido. A documentação
    // atual exige players.user_id/role para buscas globais por intervalo.
    //
    // `orderIds` é o conjunto de pedidos DO PERÍODO. A janela de claims é maior
    // (CLAIMS_LOOKAHEAD_DAYS) para alcançar o pós-venda aberto depois do mês da
    // venda, e esse conjunto garante que só claims desses pedidos entrem no
    // fechamento — claim de pedido externo é descartado.
    const shipmentIds = orders.map((o) => o.shipping?.id).filter((v) => v != null);
    const orderIds = new Set(orders.map((o) => String(o.id)));
    const [freteLote, claimsLote] = await Promise.all([
      buscarFretesEmLote({ clienteId: cliente.id, sellerId, shipmentIds }),
      buscarClaimsPorPeriodo({ clienteId: cliente.id, sellerId, dateFrom: from, dateTo: to, orderIds }),
    ]);
    const freteMap = freteLote.freteMap;
    const claimsMap = claimsLote.claimsMap;

    // Auditoria do caminho barato: registra apenas uma amostra curta das tags
    // de pedidos cuja Claims API confirmou devolução. Tags continuam sendo
    // observadas, mas não decidem o resultado porque não informam resolução,
    // beneficiário nem reembolso efetivado.
    const posVendaClassificados = orders
      .map((order) => ({
        orderId: String(order.id),
        tags: Array.isArray(order.tags) ? order.tags : [],
        posVenda: classificarClaimsDoPedido(claimsMap.get(String(order.id))),
      }))
      .filter((entry) => entry.posVenda);
    const devolucoesClassificadas = posVendaClassificados
      .filter((entry) => entry.posVenda.tipo === "devolucao").length;
    const parciaisClassificadas = posVendaClassificados
      .filter((entry) => entry.posVenda.tipo === "devolucao_parcial").length;
    const mediacoesClassificadas = posVendaClassificados
      .filter((entry) => entry.posVenda.tipo === "mediacao").length;
    console.log(
      `[centralVendas] claims classificados: devolucoes=${devolucoesClassificadas}`
        + ` devolucoesParciais=${parciaisClassificadas}`
        + ` mediacoes=${mediacoesClassificadas} pedidos=${posVendaClassificados.length}`
    );

    const tagsDevolucoes = posVendaClassificados
      .filter((entry) => entry.posVenda.tipo === "devolucao")
      .slice(0, 5)
      .map(({ orderId, tags }) => ({ orderId, tags }));
    if (tagsDevolucoes.length) {
      console.log("[centralVendas] amostra order.tags de devoluções confirmadas:", tagsDevolucoes);
    }

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
        claimsMap,
        claimsIndisponivel: claimsLote.indisponivel,
        claimsMotivo: claimsLote.motivo,
        claimsReturnsNaoResolvidos: claimsLote.returnsNaoResolvidos || 0,
        clienteSlug: slug,
        competencia: comp,
      });
      if (!motorResult.pedidos.length) continue;

      const resumoCalculado = buildResumoCentralVendas(motorResult);
      const resumo = {
        ...resumoCalculado,
        // Devolução sem pedido resolvido também rebaixa a confiança: o pós-venda
        // ficou incompleto, e incompleto nunca é "confiável".
        confianca:
          claimsLote.indisponivel || (claimsLote.returnsNaoResolvidos || 0) > 0
            ? "parcial"
            : resumoCalculado.confianca,
      };
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
        ` shipments=${freteLote.buscados}/${freteLote.total} comFrete=${freteLote.comFrete}` +
        ` semFrete=${freteLote.ausentes} erros=${freteLote.erros} lotes=${freteLote.lotes}`
        + ` comReceitaEnvio=${freteLote.comReceitaEnvio}`
        + ` claims=${claimsLote.claims.length} pedidosComClaims=${claimsMap.size}`
        + ` claimsPaginas=${claimsLote.pages} claimsIndisponivel=${claimsLote.indisponivel ? 1 : 0}`
        + ` claimsJanela=${claimsLote.janela ? `${claimsLote.janela.from}..${claimsLote.janela.to}` : "n/d"}`
        + ` claimsForaDoPeriodo=${claimsLote.claimsForaDoPeriodo || 0}`
        + ` returnsNaoResolvidos=${claimsLote.returnsNaoResolvidos || 0}`
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
        semFrete: freteLote.ausentes,
        erros: freteLote.erros,
        lotes: freteLote.lotes,
        capExcedido: freteLote.capExcedido,
      },
      posVenda: {
        claimsEncontrados: claimsLote.claims.length,
        pedidosComClaims: claimsMap.size,
        paginas: claimsLote.pages,
        tentativas: claimsLote.attempts,
        indisponivel: claimsLote.indisponivel,
        motivo: claimsLote.motivo,
        status: claimsLote.status ?? null,
        janela: claimsLote.janela || null,
        timezoneFormato: claimsLote.timezoneFormato || null,
        resourceCounts: claimsLote.resourceCounts || {},
        claimsForaDoPeriodo: claimsLote.claimsForaDoPeriodo || 0,
        returnsResolvidos: claimsLote.returnsResolvidos || 0,
        returnsNaoResolvidos: claimsLote.returnsNaoResolvidos || 0,
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
  extrairReembolso,
  buildCostMap,
  getCost,
  buscarBaseECustos,
  fetchAllOrders,
};
