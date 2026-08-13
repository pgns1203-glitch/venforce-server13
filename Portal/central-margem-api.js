/*
 * Central de Margem — contrato único de dados do frontend.
 *
 * Ordem de leitura:
 *   1. GET /operacao/central-margem/:slug (contrato canônico do Motor)
 *   2. Se a rota ainda não existir (404/501), adapter somente-leitura sobre:
 *      - GET /anuncios-meli
 *      - GET /operacao/central-vendas/:slug
 *
 * A página nunca chama endpoints por linha. null continua significando ausente;
 * nenhum valor financeiro inexistente é convertido silenciosamente em zero.
 */
(function (root, factory) {
  var api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VFCentralMargemApi = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  var DEFAULT_API_BASE = "https://venforce-server.onrender.com";
  var STATUSES = ["HEALTHY", "LOW_MARGIN", "LOSS", "UNVALIDATED", "SUSPECT_DATA", "RECONCILING"];
  var LEVELS = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"];

  var SOURCE_LABELS = {
    MELI_API: "API do Mercado Livre",
    MELI_ORDER: "Pedido do Mercado Livre",
    MERCADO_PAGO: "Mercado Pago",
    VENFORCE_BASE: "Base VenForce",
    EXTENSION_DOM: "Extensão VenForce",
    DERIVED: "Derivado pelo Motor",
    central_vendas_db: "Central de Vendas",
    orders_api: "Orders API do Mercado Livre",
    planilha_vendas: "Planilha de vendas",
    planilha_custos: "Base de custos",
    ausente: "Não disponível",
  };

  function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function round(value, digits) {
    var number = numberOrNull(value);
    if (number === null) return null;
    var factor = Math.pow(10, digits === undefined ? 2 : digits);
    return Math.round((number + Number.EPSILON) * factor) / factor;
  }

  function marginFraction(value) {
    var number = numberOrNull(value);
    if (number === null) return null;
    return Math.abs(number) > 1 ? number / 100 : number;
  }

  function firstValue() {
    for (var i = 0; i < arguments.length; i += 1) {
      var value = arguments[i];
      if (value !== null && value !== undefined && value !== "") return value;
    }
    return null;
  }

  function arrayOf(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.keys(value).map(function (key) { return value[key]; });
    return [];
  }

  function sourceLabel(source) {
    if (!source) return "Fonte não informada";
    return SOURCE_LABELS[source] || String(source).replace(/_/g, " ");
  }

  function normalizeConfidence(input, fallbackExplanation) {
    var raw = input;
    var explanation = fallbackExplanation || null;
    var score = null;

    if (input && typeof input === "object") {
      raw = firstValue(input.level, input.nivel, input.value, input.confidence, input.confianca);
      explanation = firstValue(input.explanation, input.explicacao, input.reason, input.motivo, explanation);
      score = numberOrNull(firstValue(input.score, input.percentual, input.percentage));
    }

    var text = String(raw || "UNKNOWN").trim().toUpperCase();
    var level = "UNKNOWN";
    if (LEVELS.indexOf(text) !== -1) level = text;
    else if (["ALTA", "CONFIAVEL", "REAL", "TRUSTED"].indexOf(text) !== -1) level = "HIGH";
    else if (["MEDIA", "MÉDIA", "PARCIAL", "PARTIAL"].indexOf(text) !== -1) level = "MEDIUM";
    else if (["BAIXA", "BLOQUEADO", "BLOCKED", "SUSPEITO"].indexOf(text) !== -1) level = "LOW";
    else if (["AUSENTE", "NAO_INFORMADA", "NÃO_INFORMADA", "UNAVAILABLE"].indexOf(text) !== -1) level = "UNKNOWN";

    return {
      level: level,
      score: score,
      explanation: explanation || (level === "UNKNOWN" ? "O backend não informou a confiabilidade deste dado." : null),
    };
  }

  function normalizeStatus(value) {
    var text = String(value || "").trim().toUpperCase().replace(/[ -]+/g, "_");
    var aliases = {
      SAUDAVEL: "HEALTHY",
      SAUDÁVEL: "HEALTHY",
      MARGEM_BAIXA: "LOW_MARGIN",
      PREJUIZO: "LOSS",
      PREJUÍZO: "LOSS",
      NAO_VALIDADO: "UNVALIDATED",
      NÃO_VALIDADO: "UNVALIDATED",
      DADO_SUSPEITO: "SUSPECT_DATA",
      DADOS_SUSPEITOS: "SUSPECT_DATA",
      EM_CONCILIACAO: "RECONCILING",
      EM_CONCILIAÇÃO: "RECONCILING",
    };
    text = aliases[text] || text;
    return STATUSES.indexOf(text) !== -1 ? text : "UNVALIDATED";
  }

  function variable(value, options) {
    var opts = options || {};
    var numeric = numberOrNull(value);
    return {
      value: numeric,
      rate: numberOrNull(opts.rate),
      format: opts.format || "money",
      source: opts.source || null,
      sourceLabel: sourceLabel(opts.source),
      confidence: normalizeConfidence(opts.confidence, opts.explanation),
      updatedAt: opts.updatedAt || null,
      detail: opts.detail || null,
      available: numeric !== null,
      estimated: opts.estimated === true,
      raw: opts.raw || null,
    };
  }

  function pickEvidence(field, kind, source) {
    if (!field || typeof field !== "object") return null;
    var direct = kind === "REALIZED" ? field.realized : field.projected;
    if (direct && (!source || direct.source === source)) return direct;
    var evidences = arrayOf(field.evidences || field.evidencias);
    for (var i = 0; i < evidences.length; i += 1) {
      var evidence = evidences[i] || {};
      var evidenceKind = String(firstValue(evidence.kind, evidence.tipo) || "").toUpperCase();
      if (kind && evidenceKind !== kind) continue;
      if (source && evidence.source !== source && evidence.fonte !== source) continue;
      return evidence;
    }
    return null;
  }

  function variableFromCanonical(field, options) {
    var opts = options || {};
    if (typeof field === "number" || typeof field === "string") {
      return variable(field, opts);
    }
    field = field || {};
    var evidence = opts.evidence || null;
    var selected = evidence || field.selected || null;
    var value = firstValue(
      opts.value,
      selected && selected.value,
      field.value,
      field.valor,
      field.selectedValue,
      field.valorSelecionado
    );
    var source = firstValue(
      opts.source,
      selected && firstValue(selected.source, selected.fonte),
      field.source,
      field.fonte,
      field.selectedSource
    );
    var updatedAt = firstValue(
      opts.updatedAt,
      selected && firstValue(selected.observedAt, selected.observadoEm),
      field.updatedAt,
      field.observedAt,
      field.atualizadoEm
    );
    return variable(value, {
      rate: firstValue(opts.rate, field.rate, field.percentual),
      format: opts.format,
      source: source,
      confidence: firstValue(opts.confidence, field.confidence, field.confianca),
      explanation: firstValue(opts.explanation, field.explanation, field.explicacao),
      updatedAt: updatedAt,
      detail: firstValue(opts.detail, field.detail, field.detalhe, selected && selected.note),
      estimated: opts.estimated === true || field.estimated === true,
      raw: field,
    });
  }

  function normalizeDivergence(input, fieldName) {
    input = input || {};
    var a = input.a || input.sourceA || input.fonteA || {};
    var b = input.b || input.sourceB || input.fonteB || {};
    return {
      variable: firstValue(input.variable, input.variavel, input.field, input.campo, fieldName, "Dado"),
      type: firstValue(input.type, input.tipo, "CONFLICT"),
      sourceA: sourceLabel(firstValue(a.source, a.fonte, input.sourceA, input.fonteA)),
      sourceB: sourceLabel(firstValue(b.source, b.fonte, input.sourceB, input.fonteB)),
      valueA: numberOrNull(firstValue(a.value, a.valor, input.valueA, input.valorA)),
      valueB: numberOrNull(firstValue(b.value, b.valor, input.valueB, input.valorB)),
      explanation: firstValue(input.explanation, input.explicacao, input.reason, input.motivo, "As fontes informaram valores diferentes."),
      format: firstValue(input.format, input.formato, "money"),
    };
  }

  function collectDivergences(item, fields) {
    var all = arrayOf(firstValue(item.divergences, item.divergencias, []));
    Object.keys(fields || {}).forEach(function (key) {
      var raw = fields[key];
      arrayOf(raw && firstValue(raw.divergences, raw.divergencias, [])).forEach(function (entry) {
        all.push(Object.assign({ variable: key }, entry));
      });
    });
    return all.map(function (entry) { return normalizeDivergence(entry, entry.variable); });
  }

  function normalizeCanonicalItem(raw, context) {
    raw = raw || {};
    var fields = raw.variables || raw.variaveis || raw.fields || raw.campos || {};
    var priceField = fields.price || fields.preco || {};
    var costField = fields.cost || fields.custo || {};
    var taxField = fields.taxRate || fields.imposto || fields.tax || {};
    var commissionField = fields.commission || fields.comissao || {};
    var commissionRateField = fields.commissionRate || fields.comissaoPercentual || {};
    var freightField = fields.freight || fields.frete || {};
    var receiptField = fields.netReceipt || fields.recebimento || {};
    var quality = raw.quality || raw.qualidade || {};
    var confidenceByField = quality.confidenceByField || quality.confiancaPorCampo || {};

    function confidenceFor(fieldKey) {
      var entry = confidenceByField[fieldKey] || {};
      var reasons = arrayOf(firstValue(entry.reasons, entry.motivos, [])).map(function (reason) {
        return typeof reason === "string" ? reason : firstValue(reason.message, reason.mensagem, reason.code, reason.codigo);
      }).filter(Boolean);
      return {
        level: firstValue(entry.level, entry.nivel, "UNKNOWN"),
        explanation: reasons.length ? reasons.join(" ") : null,
      };
    }

    var priceProjected = pickEvidence(priceField, "PROJECTED", "MELI_API") || pickEvidence(priceField, "PROJECTED");
    var priceObserved = pickEvidence(priceField, "PROJECTED", "EXTENSION_DOM");
    var priceRealized = pickEvidence(priceField, "REALIZED", "MELI_ORDER") || pickEvidence(priceField, "REALIZED");
    var freightProjected = pickEvidence(freightField, "PROJECTED", "MELI_API") || pickEvidence(freightField, "PROJECTED");
    var freightRealized = pickEvidence(freightField, "REALIZED", "MELI_ORDER") || pickEvidence(freightField, "REALIZED");
    var receiptRealized = pickEvidence(receiptField, "REALIZED", "MERCADO_PAGO") || pickEvidence(receiptField, "REALIZED");
    var commissionProjected = pickEvidence(commissionField, "PROJECTED", "MELI_API") || pickEvidence(commissionField, "PROJECTED");

    var projectedBlock = raw.projected || raw.projetada || raw.projection || {};
    var realizedBlock = raw.realized || raw.realizada || raw.actual || {};
    var projectedMargin = marginFraction(firstValue(projectedBlock.margin, projectedBlock.margem, raw.projectedMargin, raw.margemProjetada));
    var realizedMargin = marginFraction(firstValue(realizedBlock.margin, realizedBlock.margem, raw.realizedMargin, raw.margemRealizada));
    var overallReasons = arrayOf(firstValue(quality.reasons, quality.motivos, [])).map(function (reason) {
      return typeof reason === "string" ? reason : firstValue(reason.message, reason.mensagem, reason.code, reason.codigo);
    }).filter(Boolean);
    var confidence = normalizeConfidence({
      level: firstValue(raw.confidence, raw.confianca, raw.overallConfidence, raw.confiancaGeral, quality.confidence),
      explanation: overallReasons.length ? overallReasons.join(" ") : null,
    });
    var itemId = String(firstValue(raw.itemId, raw.item_id, raw.mlb, raw.id, "") || "");

    var variables = {
      price: variableFromCanonical(priceField, { evidence: priceProjected, value: firstValue(raw.price, raw.preco), format: "money", confidence: confidenceFor("price") }),
      observedPrice: variableFromCanonical(priceField, { evidence: priceObserved, format: "money", source: priceObserved && firstValue(priceObserved.source, priceObserved.fonte), confidence: confidenceFor("price") }),
      lastSoldPrice: variableFromCanonical(priceField, { evidence: priceRealized, format: "money", confidence: confidenceFor("price") }),
      cost: variableFromCanonical(costField, { format: "money", value: firstValue(raw.cost, raw.custo), confidence: confidenceFor("cost") }),
      tax: variableFromCanonical(taxField, { format: "percent", value: firstValue(raw.taxRate, raw.impostoPercentual), confidence: confidenceFor("taxRate") }),
      commission: variableFromCanonical(commissionField, {
        evidence: commissionProjected,
        format: "money",
        rate: firstValue(commissionRateField.value, commissionRateField.valor, raw.commissionRate, raw.comissaoPercentual),
        confidence: confidenceFor("commission"),
      }),
      freightExpected: variableFromCanonical(freightField, { evidence: freightProjected, format: "money", confidence: confidenceFor("freight") }),
      freightActual: variableFromCanonical(freightField, { evidence: freightRealized, format: "money", confidence: confidenceFor("freight") }),
      soldValue: variable(firstValue(realizedBlock.soldValue, realizedBlock.valorVendido, raw.soldValue, raw.valorVendido, raw.sales && raw.sales.receita), {
        format: "money", source: "MELI_ORDER", confidence: confidence,
      }),
      netReceipt: variableFromCanonical(receiptField, { evidence: receiptRealized, format: "money", confidence: confidenceFor("netReceipt") }),
      mercadoPago: variableFromCanonical(fields.mercadoPago || receiptField, { format: "money", evidence: receiptRealized, confidence: confidenceFor("netReceipt") }),
    };

    if (variables.tax.value !== null && Math.abs(variables.tax.value) > 1) variables.tax.value /= 100;
    if (variables.commission.rate !== null && Math.abs(variables.commission.rate) > 1) variables.commission.rate /= 100;

    var simulationInputs = {
      cost: variables.cost.value,
      taxRate: variables.tax.value,
      commissionRate: numberOrNull(firstValue(variables.commission.rate, commissionRateField.selectedValue)),
      freight: variables.freightExpected.value,
      fixedFee: numberOrNull(firstValue(fields.fixedFee && fields.fixedFee.selectedValue, fields.taxaFixa && fields.taxaFixa.value, 0)),
      complete: variables.cost.value !== null && variables.tax.value !== null &&
        numberOrNull(firstValue(variables.commission.rate, commissionRateField.selectedValue)) !== null &&
        variables.freightExpected.value !== null,
      source: "Motor de Margem",
    };

    var divergences = collectDivergences(raw, fields);
    var status = normalizeStatus(firstValue(raw.status, raw.situacao, raw.operationalStatus, raw.estadoOperacional));
    if (!firstValue(raw.status, raw.situacao, raw.operationalStatus, raw.estadoOperacional) && divergences.length) status = "SUSPECT_DATA";

    return {
      id: itemId,
      itemId: itemId,
      sku: firstValue(raw.sku, raw.sellerSku, raw.seller_sku),
      title: firstValue(raw.title, raw.titulo, itemId || "Produto sem título"),
      image: firstValue(raw.image, raw.thumbnail, raw.imagem),
      permalink: firstValue(raw.permalink, raw.url),
      client: context.client,
      marketplace: firstValue(raw.marketplace, context.marketplace, "meli"),
      status: status,
      confidence: confidence,
      problem: firstValue(raw.problem, raw.problema, raw.mainProblem, raw.problemaPrincipal, arrayOf(quality.statusReasons)[0], divergences.length ? "Fontes divergentes" : null),
      targetMargin: marginFraction(firstValue(raw.targetMargin, raw.margemAlvo)),
      projected: {
        margin: projectedMargin,
        profit: numberOrNull(firstValue(projectedBlock.profit, projectedBlock.lucro, raw.projectedProfit, raw.lucroProjetado)),
        estimated: projectedBlock.estimated === true,
        note: firstValue(projectedBlock.note, projectedBlock.explicacao),
      },
      realized: {
        margin: realizedMargin,
        profit: numberOrNull(firstValue(realizedBlock.profit, realizedBlock.lucro, raw.realizedProfit, raw.lucroRealizado)),
        pending: realizedMargin === null,
      },
      variables: variables,
      divergences: divergences,
      reconciliation: firstValue(raw.reconciliation, raw.conciliacao, realizedMargin === null ? "Pendente" : "Disponível"),
      latestOrderId: firstValue(realizedBlock.orderId, realizedBlock.pedidoId, raw.latestOrderId),
      links: raw.links || {},
      simulationInputs: simulationInputs,
      raw: raw,
    };
  }

  function countStatuses(items) {
    var counts = { HEALTHY: 0, LOW_MARGIN: 0, LOSS: 0, UNVALIDATED: 0, SUSPECT_DATA: 0, RECONCILING: 0 };
    (items || []).forEach(function (item) {
      if (Object.prototype.hasOwnProperty.call(counts, item.status)) counts[item.status] += 1;
    });
    return counts;
  }

  function normalizeCanonicalResponse(payload, context) {
    payload = payload || {};
    context = context || {};
    var rows = arrayOf(firstValue(payload.items, payload.itens, payload.products, payload.produtos, payload.data && payload.data.items, []));
    var items = rows.map(function (row) { return normalizeCanonicalItem(row, context); });
    var pagination = payload.pagination || payload.paginacao || {};
    var total = numberOrNull(firstValue(pagination.total, pagination.totalItensMl, payload.total, items.length));
    var summaryRaw = payload.summary || payload.resumo || {};
    var statusSummary = summaryRaw.counts || summaryRaw.porStatus || {};
    var counts = countStatuses(items);
    var derivedLastUpdated = items.reduce(function (latest, item) {
      Object.keys(item.variables || {}).forEach(function (key) {
        var timestamp = item.variables[key] && item.variables[key].updatedAt;
        if (timestamp && (!latest || String(timestamp) > String(latest))) latest = timestamp;
      });
      return latest;
    }, null);
    var rawScope = firstValue(summaryRaw.scope, summaryRaw.escopo, "dataset");
    var normalizedScope = ["page", "pagina", "página"].indexOf(String(rawScope).toLowerCase()) !== -1 ? "page" : rawScope;

    return {
      ok: true,
      sourceMode: "motor",
      sourceLabel: "Motor de Margem",
      partial: payload.partial === true || payload.parcial === true,
      client: context.client,
      marketplace: context.marketplace || "meli",
      items: items,
      pagination: {
        page: numberOrNull(firstValue(pagination.page, pagination.pagina, context.page, 1)) || 1,
        limit: numberOrNull(firstValue(pagination.limit, pagination.limite, context.limit, 20)) || 20,
        total: total === null ? items.length : total,
        totalPages: numberOrNull(firstValue(pagination.totalPages, pagination.totalPaginas)) || Math.max(Math.ceil((total || items.length) / (numberOrNull(pagination.limit) || context.limit || 20)), 1),
      },
      summary: {
        monitored: numberOrNull(firstValue(summaryRaw.monitored, summaryRaw.monitorados, summaryRaw.totalItensMl, pagination.totalItensMl, total, items.length)) || 0,
        counts: {
          HEALTHY: numberOrNull(firstValue(summaryRaw.healthy, summaryRaw.saudaveis, statusSummary.HEALTHY, counts.HEALTHY)) || 0,
          LOW_MARGIN: numberOrNull(firstValue(summaryRaw.lowMargin, summaryRaw.margemBaixa, statusSummary.LOW_MARGIN, counts.LOW_MARGIN)) || 0,
          LOSS: numberOrNull(firstValue(summaryRaw.loss, summaryRaw.prejuizo, statusSummary.LOSS, counts.LOSS)) || 0,
          UNVALIDATED: numberOrNull(firstValue(summaryRaw.unvalidated, summaryRaw.naoValidados, statusSummary.UNVALIDATED, counts.UNVALIDATED)) || 0,
          SUSPECT_DATA: numberOrNull(firstValue(summaryRaw.suspectData, summaryRaw.dadosSuspeitos, statusSummary.SUSPECT_DATA, counts.SUSPECT_DATA)) || 0,
          RECONCILING: numberOrNull(firstValue(summaryRaw.reconciling, summaryRaw.emConciliacao, statusSummary.RECONCILING, counts.RECONCILING)) || 0,
        },
        scope: normalizedScope,
      },
      lastUpdated: firstValue(payload.lastUpdated, payload.updatedAt, payload.ultimaAtualizacao, payload.geradoEm, derivedLastUpdated),
      period: payload.period || payload.periodo || null,
      warnings: arrayOf(firstValue(payload.warnings, payload.avisos, [])),
      gaps: arrayOf(firstValue(payload.gaps, payload.lacunas, [])),
    };
  }

  function strongestLegacyConfidence(values) {
    var normalized = (values || []).map(function (value) { return normalizeConfidence(value); });
    if (normalized.some(function (entry) { return entry.level === "LOW"; })) {
      return normalizeConfidence("LOW", "Há pedido bloqueado ou componente financeiro ausente no período.");
    }
    if (normalized.some(function (entry) { return entry.level === "MEDIUM"; })) {
      return normalizeConfidence("MEDIUM", "A Central de Vendas marcou parte dos pedidos como parcial.");
    }
    if (normalized.some(function (entry) { return entry.level === "HIGH"; })) {
      return normalizeConfidence("HIGH", "Os pedidos agregados foram classificados como confiáveis pela Central de Vendas.");
    }
    return normalizeConfidence("UNKNOWN", "Ainda não há venda conciliada para este produto no período.");
  }

  function ensureAggregate(map, key) {
    if (!map[key]) {
      map[key] = {
        units: 0,
        soldValue: 0,
        soldValuePresent: false,
        costTotal: 0,
        costPresent: false,
        taxTotal: 0,
        taxPresent: false,
        commissionTotal: 0,
        commissionPresent: false,
        freightTotal: 0,
        freightPresent: false,
        profitTotal: 0,
        profitPresent: false,
        confidences: [],
        lastSoldPrice: null,
        lastSoldAt: null,
        latestOrderId: null,
        sources: {},
      };
    }
    return map[key];
  }

  function addPresent(aggregate, name, value) {
    var numeric = numberOrNull(value);
    if (numeric === null) return;
    aggregate[name] += numeric;
    var presentName = name === "soldValue" ? "soldValuePresent" : name.replace(/Total$/, "Present");
    aggregate[presentName] = true;
  }

  function buildSalesIndex(salesPayload) {
    var index = {};
    arrayOf(salesPayload && salesPayload.pedidos).forEach(function (order) {
      var orderItems = arrayOf(order.itens);
      var components = arrayOf(order.componentes);
      orderItems.forEach(function (orderItem) {
        var key = String(firstValue(orderItem.mlb, orderItem.itemId, orderItem.id, "") || "");
        if (!key) return;
        var aggregate = ensureAggregate(index, key);
        var quantity = numberOrNull(firstValue(orderItem.quantidade, order.unidades, 1));
        aggregate.units += quantity && quantity > 0 ? quantity : 1;
        addPresent(aggregate, "soldValue", orderItem.receitaProduto);
        addPresent(aggregate, "costTotal", orderItem.custoProduto);
        addPresent(aggregate, "taxTotal", orderItem.impostoInterno);
        addPresent(aggregate, "profitTotal", orderItem.resultado);
        aggregate.confidences.push(firstValue(orderItem.confianca, order.confianca));

        var itemRef = String(firstValue(orderItem.itemId, orderItem.id, orderItem.mlb, "") || "");
        var scopedComponents = components.filter(function (component) {
          var componentRef = String(firstValue(component.itemId, component.item_id, "") || "");
          return componentRef ? componentRef === itemRef : orderItems.length === 1;
        });
        scopedComponents.forEach(function (component) {
          var componentValue = numberOrNull(component.valor);
          if (componentValue === null) return;
          if (component.tipo === "tarifa_venda") {
            addPresent(aggregate, "commissionTotal", Math.abs(componentValue));
            aggregate.sources.commission = component.fonte || "MELI_ORDER";
          }
          if (component.tipo === "frete_seller") {
            addPresent(aggregate, "freightTotal", Math.abs(componentValue));
            aggregate.sources.freight = component.fonte || "MELI_ORDER";
          }
        });

        var soldAt = firstValue(order.data, order.dataPedido);
        if (!aggregate.lastSoldAt || (soldAt && String(soldAt) > String(aggregate.lastSoldAt))) {
          aggregate.lastSoldAt = soldAt || aggregate.lastSoldAt;
          aggregate.lastSoldPrice = numberOrNull(orderItem.valorUnitario);
          aggregate.latestOrderId = firstValue(order.pedidoId, order.id);
        }
      });
    });
    return index;
  }

  function legacyStatus(item) {
    if (item.reconciling) return "RECONCILING";
    if (item.variables.cost.value === null) return "UNVALIDATED";
    if (item.confidence.level === "LOW") return "SUSPECT_DATA";
    if ((item.realized.margin !== null && item.realized.margin < 0) ||
        (item.projected.margin !== null && item.projected.margin < 0)) return "LOSS";
    if (item.realized.margin !== null || item.projected.margin !== null) return "HEALTHY";
    return "UNVALIDATED";
  }

  function legacyProblem(item) {
    if (item.reconciling) return "Dados ainda conciliando";
    if (item.variables.cost.value === null) return "Custo ausente na leitura disponível";
    if (item.confidence.level === "LOW") return "Pedido bloqueado ou dado financeiro incompleto";
    if (item.realized.margin !== null && item.realized.margin < 0) return "Margem realizada negativa";
    if (item.projected.margin !== null && item.projected.margin < 0) return "Projeção estimada negativa";
    if (item.realized.margin === null) return "Margem realizada pendente";
    if (item.projected.estimated) return "Projeção estimada com histórico de pedidos";
    return "Sem exceção identificada no recorte";
  }

  function normalizeLegacyItem(catalogItem, salesPayload, salesIndex, context) {
    var itemId = String(firstValue(catalogItem.item_id, catalogItem.itemId, catalogItem.mlb, "") || "");
    var aggregate = salesIndex[itemId] || null;
    var productMap = (salesPayload && salesPayload.produtos) || {};
    var product = productMap[itemId] || {};
    var base = product.base || {};
    var units = aggregate && aggregate.units > 0 ? aggregate.units : null;
    var soldValue = aggregate && aggregate.soldValuePresent ? aggregate.soldValue : null;
    var cost = numberOrNull(base.custo);
    if (cost === null && aggregate && aggregate.costPresent && units) cost = aggregate.costTotal / units;
    var taxRate = numberOrNull(base.imposto);
    if (taxRate !== null && Math.abs(taxRate) > 1) taxRate /= 100;
    if (taxRate === null && aggregate && aggregate.taxPresent && soldValue) taxRate = aggregate.taxTotal / soldValue;
    var commissionRate = aggregate && aggregate.commissionPresent && soldValue ? aggregate.commissionTotal / soldValue : null;
    var freightAverage = aggregate && aggregate.freightPresent && units ? aggregate.freightTotal / units : null;
    var currentPrice = numberOrNull(catalogItem.preco);
    var projectionComplete = currentPrice !== null && currentPrice > 0 && cost !== null && taxRate !== null && commissionRate !== null && freightAverage !== null;
    var projectedProfit = null;
    var projectedMargin = null;
    if (projectionComplete) {
      projectedProfit = currentPrice - cost - currentPrice * taxRate - currentPrice * commissionRate - freightAverage;
      projectedMargin = projectedProfit / currentPrice;
    }
    var realizedProfit = aggregate && aggregate.profitPresent ? aggregate.profitTotal : null;
    var realizedMargin = realizedProfit !== null && soldValue && soldValue > 0 ? realizedProfit / soldValue : null;
    var confidence = strongestLegacyConfidence(aggregate ? aggregate.confidences : []);
    if (projectionComplete && confidence.level === "HIGH") {
      confidence = normalizeConfidence("MEDIUM", "A venda é confiável, mas a projeção usa médias históricas de tarifa e frete até o Motor canônico estar disponível.");
    }
    var motor = (salesPayload && salesPayload.motor) || {};
    var reconciling = motor.status && ["persistido", "sem_dados"].indexOf(String(motor.status)) === -1;

    var item = {
      id: itemId,
      itemId: itemId,
      sku: firstValue(catalogItem.sku, product.sku),
      title: firstValue(catalogItem.titulo, product.titulo, itemId || "Produto sem título"),
      image: firstValue(catalogItem.thumbnail, catalogItem.image),
      permalink: catalogItem.permalink || null,
      client: context.client,
      marketplace: context.marketplace || "meli",
      status: "UNVALIDATED",
      confidence: confidence,
      problem: null,
      targetMargin: null,
      projected: {
        margin: round(projectedMargin, 6),
        profit: round(projectedProfit, 2),
        estimated: projectionComplete,
        note: projectionComplete ? "Estimativa da UI: preço atual + custo/imposto da Base + médias realizadas de tarifa e frete." : null,
      },
      realized: {
        margin: round(realizedMargin, 6),
        profit: round(realizedProfit, 2),
        pending: realizedMargin === null,
      },
      variables: {
        price: variable(currentPrice, {
          source: "MELI_API", confidence: "HIGH", updatedAt: catalogItem.last_synced_at,
          explanation: "Preço atual armazenado pela sincronização de Anúncios ML.",
        }),
        observedPrice: variable(null, {
          source: "EXTENSION_DOM", confidence: "UNKNOWN",
          explanation: "AGUARDANDO_MOTOR: a extensão ainda não expõe evidência para a Central.",
        }),
        lastSoldPrice: variable(aggregate && aggregate.lastSoldPrice, {
          source: "MELI_ORDER", confidence: aggregate ? confidence : "UNKNOWN", updatedAt: aggregate && aggregate.lastSoldAt,
        }),
        cost: variable(cost, {
          source: cost !== null ? "VENFORCE_BASE" : null,
          confidence: cost !== null ? (base.status === "real" ? "HIGH" : "MEDIUM") : "UNKNOWN",
          explanation: cost !== null ? "Custo lido pela Central de Vendas a partir da Base vinculada." : "Nenhum custo foi exposto para este produto no período.",
        }),
        tax: variable(taxRate, {
          format: "percent", source: taxRate !== null ? "VENFORCE_BASE" : null,
          confidence: taxRate !== null ? "HIGH" : "UNKNOWN",
          explanation: taxRate !== null ? "Percentual de imposto lido pela Central de Vendas." : "Imposto indisponível.",
        }),
        commission: variable(currentPrice !== null && commissionRate !== null ? currentPrice * commissionRate : null, {
          rate: commissionRate, source: aggregate && aggregate.sources.commission || (commissionRate !== null ? "MELI_ORDER" : null),
          confidence: commissionRate !== null ? "MEDIUM" : "UNKNOWN", estimated: commissionRate !== null,
          explanation: commissionRate !== null ? "Estimativa por unidade no preço atual, usando a tarifa efetiva do histórico." : "Comissão atual/API ainda não disponível.",
        }),
        freightExpected: variable(null, {
          source: "MELI_API", confidence: "UNKNOWN",
          explanation: "AGUARDANDO_MOTOR: frete previsto/API ainda não exposto.",
        }),
        freightActual: variable(freightAverage, {
          source: aggregate && aggregate.sources.freight || (freightAverage !== null ? "MELI_ORDER" : null),
          confidence: freightAverage !== null ? confidence : "UNKNOWN", updatedAt: aggregate && aggregate.lastSoldAt,
          detail: freightAverage !== null ? "Média realizada por unidade no período." : null,
        }),
        soldValue: variable(soldValue, {
          source: soldValue !== null ? "MELI_ORDER" : null, confidence: soldValue !== null ? confidence : "UNKNOWN",
          detail: soldValue !== null ? "Valor vendido agregado no período." : null,
        }),
        netReceipt: variable(null, {
          source: "MERCADO_PAGO", confidence: "UNKNOWN",
          explanation: "AGUARDANDO_MOTOR: recebimento líquido ainda não conciliado com Mercado Pago.",
        }),
        mercadoPago: variable(null, {
          source: "MERCADO_PAGO", confidence: "UNKNOWN",
          explanation: "AGUARDANDO_MOTOR: integração de recebimentos indisponível.",
        }),
      },
      divergences: [],
      reconciliation: aggregate ? (confidence.level === "LOW" ? "Bloqueada" : confidence.level === "MEDIUM" ? "Parcial" : "Conciliada") : "Sem venda no período",
      reconciling: reconciling,
      latestOrderId: aggregate && aggregate.latestOrderId,
      links: {},
      simulationInputs: {
        cost: cost,
        taxRate: taxRate,
        commissionRate: commissionRate,
        freight: freightAverage,
        fixedFee: 0,
        complete: projectionComplete,
        source: "Adapter: Base + histórico realizado",
      },
      raw: catalogItem,
    };
    item.status = legacyStatus(item);
    item.problem = legacyProblem(item);
    return item;
  }

  function adaptLegacyResponse(catalogPayload, salesPayload, context, salesError) {
    catalogPayload = catalogPayload || {};
    context = context || {};
    var catalog = arrayOf(catalogPayload.anuncios);
    var index = buildSalesIndex(salesPayload || {});
    var items = catalog.map(function (row) { return normalizeLegacyItem(row, salesPayload || {}, index, context); });
    var paginationRaw = catalogPayload.paginacao || {};
    var counts = countStatuses(items);
    var warnings = [
      "Motor de Margem ainda sem endpoint público; usando adapter somente-leitura sobre Anúncios ML e Central de Vendas.",
    ];
    if (salesError) warnings.push("A leitura financeira falhou; margem realizada, custo e frete podem aparecer pendentes.");
    var noBase = items.length > 0 && items.every(function (item) { return item.variables.cost.value === null; });
    if (noBase) warnings.push("Nenhum custo foi exposto para os produtos desta página. Verifique a Base vinculada sem editá-la pela Central.");

    return {
      ok: true,
      sourceMode: "legacy-adapter",
      sourceLabel: "Adapter de dados reais",
      partial: true,
      client: context.client,
      marketplace: context.marketplace || "meli",
      items: items,
      pagination: {
        page: numberOrNull(firstValue(paginationRaw.page, context.page, 1)) || 1,
        limit: numberOrNull(firstValue(paginationRaw.limit, context.limit, 50)) || 50,
        total: numberOrNull(firstValue(paginationRaw.total, items.length)) || 0,
        totalPages: numberOrNull(firstValue(paginationRaw.totalPaginas, paginationRaw.totalPages)) || 1,
      },
      summary: {
        monitored: numberOrNull(firstValue(paginationRaw.total, items.length)) || 0,
        counts: counts,
        scope: "page",
      },
      lastUpdated: firstValue(
        salesPayload && salesPayload.motor && salesPayload.motor.geradoEm,
        catalog.reduce(function (latest, item) {
          return !latest || (item.last_synced_at && item.last_synced_at > latest) ? item.last_synced_at : latest;
        }, null)
      ),
      period: salesPayload && salesPayload.periodo || context.period || null,
      warnings: warnings,
      gaps: ["AGUARDANDO_MOTOR: frete previsto/API", "AGUARDANDO_MOTOR: Mercado Pago", "AGUARDANDO_MOTOR: preço observado pela extensão", "AGUARDANDO_MOTOR: margem alvo"],
    };
  }

  function simulatePrice(item, newPrice) {
    var price = numberOrNull(newPrice);
    var inputs = item && item.simulationInputs || {};
    var missing = [];
    if (price === null || price <= 0) missing.push("price");
    if (numberOrNull(inputs.cost) === null) missing.push("cost");
    if (numberOrNull(inputs.taxRate) === null) missing.push("taxRate");
    if (numberOrNull(inputs.commissionRate) === null) missing.push("commissionRate");
    if (numberOrNull(inputs.freight) === null) missing.push("freight");
    if (missing.length) return { computable: false, missing: missing, profit: null, margin: null };

    var cost = Number(inputs.cost);
    var taxRate = Number(inputs.taxRate);
    var commissionRate = Number(inputs.commissionRate);
    var freight = Number(inputs.freight);
    var fixedFee = numberOrNull(inputs.fixedFee) || 0;
    var profit = price - price * taxRate - price * commissionRate - freight - fixedFee - cost;
    var margin = profit / price;
    var currentMargin = item.projected && item.projected.margin;
    var targetMargin = item.targetMargin;
    return {
      computable: true,
      price: round(price, 2),
      profit: round(profit, 2),
      margin: round(margin, 6),
      currentMargin: currentMargin,
      deltaCurrentPp: currentMargin === null || currentMargin === undefined ? null : round((margin - currentMargin) * 100, 2),
      targetMargin: targetMargin,
      deltaTargetPp: targetMargin === null || targetMargin === undefined ? null : round((margin - targetMargin) * 100, 2),
      source: inputs.source || "Motor de Margem",
      missing: [],
    };
  }

  function apiBase() {
    return String(root.VF_API_BASE || DEFAULT_API_BASE).replace(/\/$/, "");
  }

  function defaultToken() {
    try { return root.localStorage ? root.localStorage.getItem("vf-token") : null; } catch (_) { return null; }
  }

  function buildQuery(params) {
    var query = new URLSearchParams();
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value === null || value === undefined || value === "") return;
      query.set(key, String(value));
    });
    var text = query.toString();
    return text ? "?" + text : "";
  }

  function createClient(options) {
    var opts = options || {};

    function call(path, requestOptions) {
      if (typeof opts.request === "function") return Promise.resolve(opts.request(path, requestOptions || {}));
      var request = requestOptions || {};
      var token = typeof opts.token === "function" ? opts.token() : firstValue(opts.token, defaultToken());
      if (!token) return Promise.resolve({ ok: false, status: 401, error: "Sessão sem token.", type: "auth" });
      var headers = Object.assign({ Authorization: "Bearer " + token }, request.headers || {});
      var init = { method: request.method || "GET", headers: headers, signal: request.signal };
      if (request.body !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(request.body);
      }
      return fetch(apiBase() + path, init).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (data) {
          if (!response.ok || !data || data.ok === false) {
            return {
              ok: false,
              status: response.status,
              data: data,
              error: firstValue(data && data.erro, data && data.motivo, "HTTP " + response.status),
              code: firstValue(data && data.codigo, data && data.code),
              type: response.status === 404 ? "not-found" : "api",
            };
          }
          return { ok: true, status: response.status, data: data };
        });
      }).catch(function (error) {
        if (error && error.name === "AbortError") return { ok: false, status: 0, aborted: true, type: "aborted" };
        return { ok: false, status: 0, error: error && error.message || "Falha de rede.", type: "network" };
      });
    }

    function getClients(signal) {
      return call("/anuncios-meli/clientes", { signal: signal }).then(function (result) {
        if (!result.ok) return result;
        return {
          ok: true,
          clients: arrayOf(result.data.clientes).map(function (client) {
            return {
              id: client.id,
              slug: client.slug,
              name: firstValue(client.nome, client.name, client.slug),
              mlConnected: client.mlConectado === true,
              totalItems: numberOrNull(client.totalAnuncios) || 0,
            };
          }),
        };
      });
    }

    function dateRange(params) {
      if (params.dateFrom && params.dateTo) return { dateFrom: params.dateFrom, dateTo: params.dateTo };
      var end = new Date();
      var start = new Date(end.getTime());
      start.setDate(start.getDate() - 29);
      function iso(date) {
        var year = date.getFullYear();
        var month = String(date.getMonth() + 1).padStart(2, "0");
        var day = String(date.getDate()).padStart(2, "0");
        return year + "-" + month + "-" + day;
      }
      return { dateFrom: iso(start), dateTo: iso(end) };
    }

    function getCentral(params, signal) {
      params = params || {};
      var slug = String(params.clientSlug || "").trim();
      if (!slug) return Promise.resolve({ ok: false, status: 400, error: "Selecione um cliente.", type: "no-client" });
      var context = {
        client: { slug: slug, name: params.clientName || slug },
        marketplace: params.marketplace || "meli",
        page: params.page || 1,
        limit: params.limit || 20,
      };
      var range = dateRange(params);
      context.period = { inicio: range.dateFrom, fim: range.dateTo, label: "Últimos 30 dias" };
      var canonicalQuery = buildQuery({
        marketplace: context.marketplace,
        q: params.search,
        status: params.status,
        view: params.view,
        page: context.page,
        limit: context.limit,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
      });

      return call("/operacao/central-margem/" + encodeURIComponent(slug) + canonicalQuery, { signal: signal })
        .then(function (canonical) {
          if (canonical.ok) return normalizeCanonicalResponse(canonical.data, context);
          if (canonical.aborted) return canonical;
          if ([404, 501].indexOf(canonical.status) === -1) {
            return { ok: false, status: canonical.status, error: canonical.error || "O Motor de Margem não respondeu.", code: canonical.code || null, type: canonical.type || "api" };
          }

          var catalogQuery = buildQuery({
            clienteSlug: slug,
            q: params.search,
            page: context.page,
            limit: context.limit,
          });
          var salesQuery = buildQuery({ marketplace: context.marketplace, dateFrom: range.dateFrom, dateTo: range.dateTo });
          return Promise.all([
            call("/anuncios-meli" + catalogQuery, { signal: signal }),
            call("/operacao/central-vendas/" + encodeURIComponent(slug) + salesQuery, { signal: signal }),
          ]).then(function (results) {
            var catalog = results[0];
            var sales = results[1];
            if (catalog.aborted || sales.aborted) return { ok: false, aborted: true, type: "aborted" };
            if (!catalog.ok) {
              return { ok: false, status: catalog.status, error: catalog.error || "Não foi possível carregar o catálogo do cliente.", type: catalog.type || "api" };
            }
            return adaptLegacyResponse(catalog.data, sales.ok ? sales.data : null, context, sales.ok ? null : sales);
          });
        });
    }

    return { getClients: getClients, getCentral: getCentral, call: call };
  }

  return {
    STATUSES: STATUSES,
    LEVELS: LEVELS,
    SOURCE_LABELS: SOURCE_LABELS,
    sourceLabel: sourceLabel,
    normalizeConfidence: normalizeConfidence,
    normalizeStatus: normalizeStatus,
    normalizeCanonicalItem: normalizeCanonicalItem,
    normalizeCanonicalResponse: normalizeCanonicalResponse,
    adaptLegacyResponse: adaptLegacyResponse,
    buildSalesIndex: buildSalesIndex,
    simulatePrice: simulatePrice,
    countStatuses: countStatuses,
    createClient: createClient,
    numberOrNull: numberOrNull,
    marginFraction: marginFraction,
  };
});
