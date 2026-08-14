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

  // Rótulo curto da fonte para o cabeçalho da planilha, onde não cabe o nome longo.
  var SOURCE_SHORT_LABELS = {
    MELI_API: "ML API",
    MELI_ORDER: "Pedido ML",
    MERCADO_PAGO: "Mercado Pago",
    VENFORCE_BASE: "Base",
    EXTENSION_DOM: "Extensão",
    DERIVED: "Derivado",
  };

  // Rótulo ULTRA curto para o controle compacto do cabeçalho da planilha
  // (o nome completo continua disponível via title/aria-label do <select>).
  var SOURCE_SELECT_LABELS = {
    MELI_API: "ML",
    MELI_ORDER: "Pedido",
    MERCADO_PAGO: "Mercado Pago",
    VENFORCE_BASE: "Base",
    EXTENSION_DOM: "Extensão",
    DERIVED: "Derivado",
  };

  /*
   * Composição da planilha
   * ----------------------
   * As seis variáveis que entram na fórmula de LC/MC, com as fontes que o
   * Motor de Margem realmente sabe produzir para cada uma (ver
   * server/services/motorMargem/adapters/*). Fonte que não existe no contrato
   * não vira opção fantasma: ela aparece como "Indisponível" e o valor
   * permanece null.
   *
   * custo, imposto e taxa fixa são variáveis DECLARADAS na Base: o Motor não
   * possui "custo realizado" (marginItem.DECLARED_FIELDS). No preset Realizado
   * elas continuam vindo da Base — exatamente o que `valueForKind` faz no
   * backend —, e não uma segunda fonte inventada.
   */
  var VARIABLES = ["price", "cost", "tax", "commission", "freight", "fixedFee"];

  var VARIABLE_META = {
    price: { label: "Preço", field: "price", format: "money" },
    cost: { label: "Custo", field: "cost", format: "money" },
    tax: { label: "Imposto", field: "taxRate", format: "percent" },
    commission: { label: "Comissão", field: "commission", format: "money" },
    freight: { label: "Frete", field: "freight", format: "money" },
    fixedFee: { label: "Taxa fixa", field: "fixedFee", format: "money" },
  };

  var SOURCE_SLOTS = {
    price: ["MELI_API", "EXTENSION_DOM", "MELI_ORDER"],
    cost: ["VENFORCE_BASE"],
    tax: ["VENFORCE_BASE"],
    commission: ["MELI_API", "MELI_ORDER"],
    freight: ["MELI_API", "EXTENSION_DOM", "MELI_ORDER"],
    fixedFee: ["VENFORCE_BASE"],
  };

  var PRESETS = {
    projected: {
      price: "MELI_API",
      cost: "VENFORCE_BASE",
      tax: "VENFORCE_BASE",
      commission: "MELI_API",
      freight: "MELI_API",
      fixedFee: "VENFORCE_BASE",
    },
    realized: {
      price: "MELI_ORDER",
      cost: "VENFORCE_BASE",
      tax: "VENFORCE_BASE",
      commission: "MELI_ORDER",
      freight: "MELI_ORDER",
      fixedFee: "VENFORCE_BASE",
    },
  };

  // Mesmas tolerâncias de marginEvidence.js: duas observações só "divergem"
  // quando passam da absoluta e da relativa.
  var MONEY_TOLERANCE = { absolute: 0.05, relative: 0.02 };
  var RATE_TOLERANCE = { absolute: 0.001, relative: 0.02 };

  function toleranceFor(variableKey) {
    return VARIABLE_META[variableKey] && VARIABLE_META[variableKey].format === "percent"
      ? RATE_TOLERANCE
      : MONEY_TOLERANCE;
  }

  function isDifferent(a, b, tolerance) {
    if (a === null || a === undefined || b === null || b === undefined) return false;
    var absolute = Math.abs(a - b);
    if (absolute <= tolerance.absolute) return false;
    var scale = Math.max(Math.abs(a), Math.abs(b));
    return scale > 0 ? absolute / scale > tolerance.relative : true;
  }

  function presetFor(selection) {
    var names = Object.keys(PRESETS);
    for (var i = 0; i < names.length; i += 1) {
      var preset = PRESETS[names[i]];
      var equal = VARIABLES.every(function (key) { return selection[key] === preset[key]; });
      if (equal) return names[i];
    }
    return "custom";
  }

  function clonePreset(name) {
    var preset = PRESETS[name] || PRESETS.projected;
    var out = {};
    VARIABLES.forEach(function (key) { out[key] = preset[key]; });
    return out;
  }

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

  /*
   * Camada de fontes por variável
   * -----------------------------
   * Transforma `fields[x].evidences` (contrato do Motor) em um mapa
   * fonte -> observação, preservando exatamente o que veio: valor, momento
   * (PROJECTED/REALIZED), qualidade, observedAt e nota.
   *
   * O contrato NÃO possui `effectiveAt`; ele é sempre exposto como null para
   * a UI dizer "Não informado" em vez de inventar um horário.
   */
  function evidenceEntry(source, raw, options) {
    var opts = options || {};
    var value = raw ? numberOrNull(firstValue(raw.value, raw.valor)) : null;
    return {
      source: source,
      sourceLabel: sourceLabel(source),
      sourceShort: SOURCE_SHORT_LABELS[source] || sourceLabel(source),
      value: value,
      available: value !== null,
      kind: raw ? firstValue(raw.kind, raw.tipo) : opts.kind || null,
      quality: raw ? firstValue(raw.quality, raw.qualidade) : null,
      observedAt: raw ? firstValue(raw.observedAt, raw.observadoEm) : null,
      effectiveAt: null,
      note: raw ? firstValue(raw.note, raw.nota, raw.detail) : null,
      declared: opts.declared === true,
      estimated: opts.estimated === true,
    };
  }

  function strongestEvidenceOf(evidences, source) {
    var chosen = null;
    (evidences || []).forEach(function (evidence) {
      if (!evidence) return;
      var evidenceSource = firstValue(evidence.source, evidence.fonte);
      if (evidenceSource !== source) return;
      if (numberOrNull(firstValue(evidence.value, evidence.valor)) === null) return;
      if (!chosen) { chosen = evidence; return; }
      var current = String(firstValue(evidence.observedAt, evidence.observadoEm) || "");
      var best = String(firstValue(chosen.observedAt, chosen.observadoEm) || "");
      if (current > best) chosen = evidence;
    });
    return chosen;
  }

  /**
   * Monta `item.sources`: para cada variável, uma entrada por fonte conhecida.
   * Fontes declaradas no catálogo aparecem sempre (mesmo ausentes, como
   * "Indisponível"); fontes observadas fora do catálogo são acrescentadas ao
   * final para que a aba Evidências nunca esconda uma observação real.
   */
  function buildSourceMap(fieldsByVariable) {
    var sources = {};
    VARIABLES.forEach(function (variableKey) {
      var field = fieldsByVariable[variableKey] || {};
      var evidences = arrayOf(field.evidences || field.evidencias);
      var entries = {};
      var order = SOURCE_SLOTS[variableKey].slice();
      order.forEach(function (source) {
        entries[source] = evidenceEntry(source, strongestEvidenceOf(evidences, source), {
          declared: source === "VENFORCE_BASE",
        });
      });
      evidences.forEach(function (evidence) {
        var source = firstValue(evidence && evidence.source, evidence && evidence.fonte);
        if (!source || entries[source]) return;
        order.push(source);
        entries[source] = evidenceEntry(source, evidence, {});
      });
      sources[variableKey] = { order: order, entries: entries };
    });
    return sources;
  }

  /**
   * O que o PRÓPRIO Motor escolheu para cada variável (`resolveField`:
   * realizado tem precedência sobre projetado). É diferente do que a planilha
   * escolheu via preset, e a aba Evidências mostra os dois lado a lado.
   */
  function buildMotorChoice(fieldsByVariable, sources) {
    var choice = {};
    VARIABLES.forEach(function (variableKey) {
      var field = fieldsByVariable[variableKey] || {};
      var source = firstValue(field.selectedSource, field.fonteSelecionada);
      var value = numberOrNull(firstValue(field.selectedValue, field.valorSelecionado));
      var kind = firstValue(field.selectedKind, field.tipoSelecionado);
      if (source === null || value === null) {
        // Sem os campos `selected*` do contrato, reproduz a mesma regra:
        // realizado vence; dentro do momento, a ordem do catálogo já reflete a
        // força relativa das fontes.
        var bucket = sources[variableKey];
        var realized = null;
        var projected = null;
        bucket.order.forEach(function (candidate) {
          var entry = bucket.entries[candidate];
          if (!entry || !entry.available) return;
          if (entry.kind === "REALIZED") { if (!realized) realized = entry; return; }
          if (!projected) projected = entry;
        });
        var selected = realized || projected;
        source = selected ? selected.source : null;
        value = selected ? selected.value : null;
        kind = selected ? selected.kind : null;
      }
      // `selectedKind` é opcional no contrato: quando não vem, o momento sai
      // da própria evidência escolhida em vez de ficar nulo.
      if (!kind && source) {
        var picked = sources[variableKey] && sources[variableKey].entries[source];
        kind = picked ? picked.kind : null;
      }
      choice[variableKey] = {
        source: source,
        sourceLabel: source ? sourceLabel(source) : null,
        value: value,
        kind: kind,
        available: value !== null,
      };
    });
    return choice;
  }

  /**
   * Fonte declarada (custo/imposto/taxa fixa) responde pelos dois momentos:
   * é o mesmo `valueForKind` do backend, que devolve a evidência projetada
   * quando o preset pede o realizado de uma variável declarada.
   */
  function sourceEntry(item, variableKey, source) {
    var bucket = item && item.sources && item.sources[variableKey];
    if (!bucket) return null;
    return bucket.entries[source] || null;
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

  var DIVERGENCE_EXPLANATIONS = {
    // Vocabulário do Motor (marginEvidence.DIVERGENCE_TYPES): conflito é
    // defeito de dado; drift é previsto × realizado e não é defeito.
    CONFLICT: "Duas fontes descreveram o mesmo momento e discordaram: alguma delas está errada.",
    DRIFT: "O previsto e o realizado ficaram diferentes. Não é defeito de dado: é o desvio da projeção.",
  };

  function normalizeDivergence(input, fieldName) {
    input = input || {};
    var a = input.a || input.sourceA || input.fonteA || {};
    var b = input.b || input.sourceB || input.fonteB || {};
    var type = String(firstValue(input.type, input.tipo, "CONFLICT")).toUpperCase();
    var fieldKey = firstValue(input.field, input.campo, input.variable, input.variavel, fieldName);
    var variableKey = variableOfField(fieldKey);
    return {
      // `field` preserva a chave canônica do Motor; `variable` continua sendo o
      // rótulo humano que a UI já usava.
      field: fieldKey || null,
      variableKey: variableKey,
      variable: variableKey
        ? VARIABLE_META[variableKey].label
        : firstValue(input.variable, input.variavel, fieldKey, "Dado"),
      type: type,
      sourceAKey: firstValue(a.source, a.fonte, input.sourceA, input.fonteA),
      sourceBKey: firstValue(b.source, b.fonte, input.sourceB, input.fonteB),
      sourceA: sourceLabel(firstValue(a.source, a.fonte, input.sourceA, input.fonteA)),
      sourceB: sourceLabel(firstValue(b.source, b.fonte, input.sourceB, input.fonteB)),
      kindA: firstValue(a.kind, a.tipo),
      kindB: firstValue(b.kind, b.tipo),
      observedAtA: firstValue(a.observedAt, a.observadoEm),
      observedAtB: firstValue(b.observedAt, b.observadoEm),
      valueA: numberOrNull(firstValue(a.value, a.valor, input.valueA, input.valorA)),
      valueB: numberOrNull(firstValue(b.value, b.valor, input.valueB, input.valorB)),
      explanation: firstValue(
        input.explanation, input.explicacao, input.reason, input.motivo,
        DIVERGENCE_EXPLANATIONS[type],
        "As fontes informaram valores diferentes."
      ),
      // "motor" = relatada pelo Motor. "adapter" = comparação feita na leitura
      // de compatibilidade, com a mesma tolerância do núcleo.
      origin: firstValue(input.origin, "motor"),
      format: firstValue(input.format, input.formato, variableKey ? VARIABLE_META[variableKey].format : null, "money"),
    };
  }

  /*
   * O Motor publica a MESMA divergência em dois lugares: dentro de
   * `fields[x].divergences` e achatada em `quality.divergences` (com `field`).
   * Ler os dois é o que garante compatibilidade com payloads parciais — mas
   * exige deduplicar, senão a fila mostraria cada conflito duas vezes.
   */
  function collectDivergences(item, fields) {
    var all = arrayOf(firstValue(item.divergences, item.divergencias, []));
    Object.keys(fields || {}).forEach(function (key) {
      var raw = fields[key];
      arrayOf(raw && firstValue(raw.divergences, raw.divergencias, [])).forEach(function (entry) {
        all.push(Object.assign({ field: key }, entry));
      });
    });
    var seen = {};
    return all.map(function (entry) {
      return normalizeDivergence(entry, firstValue(entry.field, entry.variable));
    }).filter(function (entry) {
      var key = [entry.field, entry.type, entry.sourceAKey, entry.sourceBKey, entry.valueA, entry.valueB].join("|");
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
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

    // Mapa fonte -> observação por variável, direto das evidências do Motor.
    var fieldsByVariable = {
      price: priceField,
      cost: costField,
      tax: taxField,
      commission: commissionField,
      freight: freightField,
      fixedFee: fields.fixedFee || fields.taxaFixa || {},
    };
    var sources = buildSourceMap(fieldsByVariable);
    var motorChoice = buildMotorChoice(fieldsByVariable, sources);

    // Confiança indexada pelas variáveis da planilha (o mapa `variables` usa
    // nomes de exibição como freightExpected/freightActual e não serve aqui).
    var confidenceByVariable = {
      price: normalizeConfidence(confidenceFor("price")),
      cost: normalizeConfidence(confidenceFor("cost")),
      tax: normalizeConfidence(confidenceFor("taxRate")),
      commission: normalizeConfidence(confidenceFor("commission")),
      freight: normalizeConfidence(confidenceFor("freight")),
      fixedFee: normalizeConfidence(confidenceFor("fixedFee")),
    };

    var salesBlock = raw.sales || raw.vendas || {};
    var settlementBlock = raw.settlement || raw.conciliacaoFinanceira || {};
    var marginBlock = raw.margin || {};

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
      sources: sources,
      motorChoice: motorChoice,
      confidenceByVariable: confidenceByVariable,
      divergences: divergences,
      hasOrders: salesBlock.hasOrders === true || numberOrNull(salesBlock.pedidos) > 0,
      settlementAvailable: settlementBlock.available === true,
      settlementReason: firstValue(settlementBlock.motivo, settlementBlock.reason),
      reconciliation: firstValue(raw.reconciliation, raw.conciliacao, realizedMargin === null ? "Pendente" : "Disponível"),
      latestOrderId: firstValue(realizedBlock.orderId, realizedBlock.pedidoId, raw.latestOrderId),
      links: raw.links || {},
      simulationInputs: simulationInputs,
      // Rastro da LEITURA ATUAL (não é histórico persistido — o backend não
      // guarda audit trail da Central).
      audit: {
        itemId: itemId,
        sku: firstValue(raw.sku, raw.sellerSku, raw.seller_sku),
        marketplace: firstValue(raw.marketplace, context.marketplace, "meli"),
        clientSlug: context.client && context.client.slug,
        statusReasons: arrayOf(firstValue(quality.statusReasons, quality.motivosStatus, [])),
        qualityReasons: overallReasons,
        projectedMissing: arrayOf(marginBlock.projected && marginBlock.projected.missing),
        projectedAssumed: arrayOf(marginBlock.projected && marginBlock.projected.assumed),
        realizedMissing: arrayOf(marginBlock.realized && marginBlock.realized.missing),
        realizedAssumed: arrayOf(marginBlock.realized && marginBlock.realized.assumed),
        hasConflict: quality.hasConflict === true,
        hasDrift: quality.hasDrift === true,
        settlementReason: firstValue(settlementBlock.motivo, settlementBlock.reason),
        lastSoldAt: firstValue(salesBlock.ultimaVendaEm, salesBlock.lastSoldAt),
        orders: numberOrNull(salesBlock.pedidos),
        units: numberOrNull(salesBlock.unidades),
      },
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

  /*
   * WORKSPACE — normaliza o payload de `/operacao/central-margem/:slug/workspace`.
   * Diferente de `normalizeCanonicalResponse` (paginação do servidor), aqui
   * `items` é O CATÁLOGO CARREGADO inteiro (até o teto seguro do backend) e a
   * cobertura (`loaded`/`total`/`partial`) é o que a UI usa para nunca
   * apresentar uma amostra como se fosse o catálogo inteiro.
   */
  function normalizeWorkspaceResponse(payload, context) {
    payload = payload || {};
    context = context || {};
    var rows = arrayOf(firstValue(payload.items, payload.itens, []));
    var items = rows.map(function (row) { return normalizeCanonicalItem(row, context); });
    var coverageRaw = payload.coverage || payload.cobertura || {};
    var loaded = numberOrNull(firstValue(coverageRaw.loaded, coverageRaw.carregados, items.length));
    if (loaded === null) loaded = items.length;
    var total = numberOrNull(firstValue(coverageRaw.total, coverageRaw.totalItensMl, loaded));
    if (total === null) total = loaded;
    var summaryRaw = payload.summary || payload.resumo || {};
    var statusSummary = summaryRaw.counts || summaryRaw.porStatus || {};
    var counts = countStatuses(items);
    var partial = payload.partial === true || payload.parcial === true || coverageRaw.parcial === true || loaded < total;

    return {
      ok: true,
      sourceMode: "motor",
      sourceLabel: "Motor de Margem",
      client: context.client,
      marketplace: context.marketplace || "meli",
      items: items,
      partial: partial,
      coverage: { loaded: loaded, total: total, partial: partial },
      summary: {
        counts: {
          HEALTHY: numberOrNull(firstValue(statusSummary.HEALTHY, counts.HEALTHY)) || 0,
          LOW_MARGIN: numberOrNull(firstValue(statusSummary.LOW_MARGIN, counts.LOW_MARGIN)) || 0,
          LOSS: numberOrNull(firstValue(statusSummary.LOSS, counts.LOSS)) || 0,
          UNVALIDATED: numberOrNull(firstValue(statusSummary.UNVALIDATED, counts.UNVALIDATED)) || 0,
          SUSPECT_DATA: numberOrNull(firstValue(statusSummary.SUSPECT_DATA, counts.SUSPECT_DATA)) || 0,
          RECONCILING: numberOrNull(firstValue(statusSummary.RECONCILING, counts.RECONCILING)) || 0,
        },
        scope: "workspace",
      },
      lastUpdated: firstValue(payload.lastUpdated, payload.updatedAt, payload.ultimaAtualizacao, payload.geradoEm),
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
    var commissionRealized = aggregate && aggregate.commissionPresent && units ? aggregate.commissionTotal / units : null;
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
      // Mapa fonte -> observação com os valores que o adapter realmente
      // consegue ler. Fonte sem leitura fica ausente e a UI mostra
      // "Indisponível" — o adapter não tem frete/comissão previstos da API,
      // taxa fixa nem evidência da extensão.
      sources: buildSourceMap({
        price: {
          evidences: [
            { source: "MELI_API", kind: "PROJECTED", value: currentPrice, quality: "MEASURED", observedAt: catalogItem.last_synced_at, note: "Preço atual sincronizado em Anúncios ML." },
            { source: "MELI_ORDER", kind: "REALIZED", value: aggregate && aggregate.lastSoldPrice, quality: "MEASURED", observedAt: aggregate && aggregate.lastSoldAt, note: "Último preço unitário vendido no período." },
          ],
        },
        cost: {
          evidences: [
            { source: "VENFORCE_BASE", kind: "PROJECTED", value: cost, quality: "DECLARED", note: "Custo lido pela Central de Vendas a partir da Base vinculada." },
          ],
        },
        tax: {
          evidences: [
            { source: "VENFORCE_BASE", kind: "PROJECTED", value: taxRate, quality: "DECLARED", note: "Percentual de imposto lido pela Central de Vendas." },
          ],
        },
        commission: {
          evidences: [
            { source: "MELI_ORDER", kind: "REALIZED", value: commissionRealized, quality: "MEASURED", observedAt: aggregate && aggregate.lastSoldAt, note: "Tarifa realizada por unidade no período." },
          ],
        },
        freight: {
          evidences: [
            { source: "MELI_ORDER", kind: "REALIZED", value: freightAverage, quality: "ESTIMATED", observedAt: aggregate && aggregate.lastSoldAt, note: "Média realizada por unidade no período." },
          ],
        },
        fixedFee: { evidences: [] },
      }),
      confidenceByVariable: {
        price: normalizeConfidence("HIGH", "Preço atual armazenado pela sincronização de Anúncios ML."),
        cost: normalizeConfidence(cost !== null ? (base.status === "real" ? "HIGH" : "MEDIUM") : "UNKNOWN",
          cost !== null ? null : "Nenhum custo foi exposto para este produto no período."),
        tax: normalizeConfidence(taxRate !== null ? "HIGH" : "UNKNOWN"),
        commission: normalizeConfidence(commissionRealized !== null ? confidence.level : "UNKNOWN",
          commissionRealized !== null ? null : "Tarifa realizada indisponível no período."),
        freight: normalizeConfidence(freightAverage !== null ? "MEDIUM" : "UNKNOWN",
          freightAverage !== null ? "Média realizada por unidade; o adapter não expõe frete previsto." : "Frete indisponível no período."),
        fixedFee: normalizeConfidence("UNKNOWN", "O adapter de compatibilidade não expõe taxa fixa da Base."),
      },
      divergences: [],
      hasOrders: Boolean(aggregate),
      settlementAvailable: false,
      settlementReason: "MERCADO_PAGO_NAO_INTEGRADO",
      reconciliation: aggregate ? (confidence.level === "LOW" ? "Bloqueada" : confidence.level === "MEDIUM" ? "Parcial" : "Conciliada") : "Sem venda no período",
      reconciling: reconciling,
      latestOrderId: aggregate && aggregate.latestOrderId,
      links: {},
      audit: {
        itemId: itemId,
        sku: firstValue(catalogItem.sku, product.sku),
        marketplace: context.marketplace || "meli",
        clientSlug: context.client && context.client.slug,
        statusReasons: [],
        qualityReasons: confidence.explanation ? [confidence.explanation] : [],
        projectedMissing: [],
        projectedAssumed: [],
        realizedMissing: [],
        realizedAssumed: [],
        hasConflict: false,
        hasDrift: false,
        settlementReason: "MERCADO_PAGO_NAO_INTEGRADO",
        lastSoldAt: aggregate && aggregate.lastSoldAt,
        orders: null,
        units: units,
        catalogSyncedAt: catalogItem.last_synced_at || null,
      },
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
    item.motorChoice = buildMotorChoice({}, item.sources);
    // DRIFT não é defeito de dado (marginEvidence): previsto × realizado
    // diferentes é informação, não suspeita. O status não muda por causa dele;
    // quem mostra o desvio é a fila de divergências.
    item.divergences = deriveDivergences(item);
    return item;
  }

  /**
   * O adapter legado não tem camada de evidências, então o Motor não relata
   * divergência nenhuma por ele. Aqui as observações REAIS que o adapter já
   * leu (previsto × realizado da mesma variável) são comparadas com a MESMA
   * regra de tolerância do núcleo (marginEvidence.isDifferent) e marcadas com
   * `origin: "adapter"`, para nunca serem confundidas com um CONFLICT do Motor.
   * Nenhum valor é inventado: só entram pares em que as duas pontas existem.
   */
  function deriveDivergences(item) {
    var rows = [];
    VARIABLES.forEach(function (variableKey) {
      var bucket = item.sources && item.sources[variableKey];
      if (!bucket) return;
      var projected = null;
      var realized = null;
      bucket.order.forEach(function (source) {
        var entry = bucket.entries[source];
        if (!entry || !entry.available) return;
        if (entry.kind === "REALIZED") { if (!realized) realized = entry; return; }
        if (!projected) projected = entry;
      });
      if (!projected || !realized) return;
      if (!isDifferent(projected.value, realized.value, toleranceFor(variableKey))) return;
      rows.push(normalizeDivergence({
        field: VARIABLE_META[variableKey].field,
        type: "DRIFT",
        origin: "adapter",
        a: { source: projected.source, kind: projected.kind, value: projected.value, observedAt: projected.observedAt },
        b: { source: realized.source, kind: realized.kind, value: realized.value, observedAt: realized.observedAt },
        explanation: "Comparação feita na leitura de compatibilidade entre as duas observações disponíveis, com a mesma tolerância do núcleo do Motor.",
      }, VARIABLE_META[variableKey].field));
    });
    return rows;
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

  /*
   * NÚCLEO DE CÁLCULO — espelho fiel de
   * server/services/motorMargem/core/marginEngine.js#computeMargin.
   *
   *   lucro  = preço − (preço × imposto) − comissão − frete − taxaFixa − custo
   *   margem = lucro / preço
   *
   * Mesmas regras do backend, e por isso mesmas consequências:
   *  - preço e custo são OBRIGATÓRIOS: sem eles não existe margem (`missing`);
   *  - imposto/taxa fixa/comissão/frete ausentes entram como 0, mas o nome fica
   *    registrado em `assumed` e `strict` vira false. Ausente nunca vira zero
   *    silencioso: vira zero declarado.
   *
   * Esta é a ÚNICA fórmula financeira do frontend. `simulatePrice`,
   * `simulateScenario` e a planilha consomem daqui.
   */
  var REQUIRED_VARIABLES = ["price", "cost"];
  var OPTIONAL_VARIABLES = ["tax", "commission", "freight", "fixedFee"];

  function computeMargin(values) {
    var input = values || {};
    var resolved = {
      price: numberOrNull(firstValue(input.price, input.preco)),
      cost: numberOrNull(firstValue(input.cost, input.custo)),
      tax: numberOrNull(firstValue(input.tax, input.taxRate)),
      commission: numberOrNull(input.commission),
      freight: numberOrNull(input.freight),
      fixedFee: numberOrNull(input.fixedFee),
    };

    var missing = REQUIRED_VARIABLES.filter(function (key) { return resolved[key] === null; });
    var assumed = OPTIONAL_VARIABLES.filter(function (key) { return resolved[key] === null; });
    // Preço zero ou negativo não é "margem zero", é dado impossível.
    if (resolved.price !== null && resolved.price <= 0 && missing.indexOf("price") === -1) missing.push("price");

    if (missing.length) {
      return { computable: false, profit: null, margin: null, missing: missing, assumed: assumed, strict: false, values: resolved };
    }

    var profit = resolved.price
      - resolved.price * (resolved.tax === null ? 0 : resolved.tax)
      - (resolved.commission === null ? 0 : resolved.commission)
      - (resolved.freight === null ? 0 : resolved.freight)
      - (resolved.fixedFee === null ? 0 : resolved.fixedFee)
      - resolved.cost;

    return {
      computable: true,
      profit: round(profit, 2),
      margin: round(profit / resolved.price, 6),
      missing: [],
      assumed: assumed,
      strict: assumed.length === 0,
      values: resolved,
      // Valores sem arredondamento, para quem precisa comparar margens em pp
      // sem acumular o erro do arredondamento de exibição.
      raw: { profit: profit, margin: profit / resolved.price },
    };
  }

  /**
   * Resolve a composição de um item para uma seleção de fontes e calcula
   * LC/MC. Fonte ausente devolve valor null — nunca zero implícito.
   */
  function resolveComposition(item, selection) {
    var chosen = selection && typeof selection === "object" ? selection : PRESETS.projected;
    var values = {};
    var entries = {};
    var unavailable = [];
    VARIABLES.forEach(function (variableKey) {
      var source = chosen[variableKey] || PRESETS.projected[variableKey];
      var entry = sourceEntry(item, variableKey, source);
      entries[variableKey] = entry || evidenceEntry(source, null, {});
      values[variableKey] = entry ? entry.value : null;
      if (!entry || entry.value === null) unavailable.push(variableKey);
    });
    var result = computeMargin(values);
    return {
      selection: chosen,
      preset: presetFor(chosen),
      values: values,
      entries: entries,
      unavailable: unavailable,
      computable: result.computable,
      profit: result.profit,
      margin: result.margin,
      missing: result.missing,
      assumed: result.assumed,
      strict: result.strict,
      raw: result.raw || { profit: null, margin: null },
    };
  }

  /**
   * Cenário do drawer: overrides LOCAIS por variável.
   * `{ price: { source, value, manual } }`. Nada aqui é evidência, nada é
   * gravado em Bases e nada altera o produto ou o marketplace.
   */
  function simulateScenario(item, scenario, baselineSelection) {
    var overrides = scenario && typeof scenario === "object" ? scenario : {};
    var baseline = resolveComposition(item, baselineSelection || PRESETS.projected);
    var values = {};
    var entries = {};
    var changed = [];
    VARIABLES.forEach(function (variableKey) {
      var override = overrides[variableKey] || {};
      var source = override.source || baseline.selection[variableKey];
      var entry = sourceEntry(item, variableKey, source) || evidenceEntry(source, null, {});
      var manual = override.manual === true;
      var value = manual ? numberOrNull(override.value) : entry.value;
      values[variableKey] = value;
      entries[variableKey] = entry;
      if (manual || source !== baseline.selection[variableKey]) changed.push(variableKey);
    });
    var result = computeMargin(values);
    var raw = result.raw || { profit: null, margin: null };
    var deltaProfit = raw.profit === null || baseline.raw.profit === null ? null : round(raw.profit - baseline.raw.profit, 2);
    var deltaMarginPp = raw.margin === null || baseline.raw.margin === null ? null : round((raw.margin - baseline.raw.margin) * 100, 2);
    var targetMargin = item && item.targetMargin;
    return {
      computable: result.computable,
      profit: result.profit,
      margin: result.margin,
      missing: result.missing,
      assumed: result.assumed,
      strict: result.strict,
      values: values,
      entries: entries,
      changed: changed,
      baseline: baseline,
      deltaProfit: deltaProfit,
      deltaMarginPp: deltaMarginPp,
      targetMargin: targetMargin === undefined ? null : targetMargin,
      deltaTargetPp: raw.margin === null || targetMargin === null || targetMargin === undefined
        ? null
        : round((raw.margin - targetMargin) * 100, 2),
      // Sempre local. O backend revalidaria tudo antes de qualquer escrita.
      persisted: false,
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

    var commissionRate = Number(inputs.commissionRate);
    // A comissão em reais acompanha o preço simulado; o resto da fórmula é o
    // mesmo núcleo usado pela planilha e pelo cenário.
    var computed = computeMargin({
      price: price,
      cost: Number(inputs.cost),
      tax: Number(inputs.taxRate),
      commission: price * commissionRate,
      freight: Number(inputs.freight),
      fixedFee: numberOrNull(inputs.fixedFee) || 0,
    });
    var profit = computed.raw.profit;
    var margin = computed.raw.margin;
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

  /* =========================================================================
   * DERIVAÇÕES DE APRESENTAÇÃO
   *
   * O backend classifica cada item em UM status (marginStatus.STATUS_PRECEDENCE):
   * UNVALIDATED > SUSPECT_DATA > LOSS > LOW_MARGIN > RECONCILING > HEALTHY.
   * A precedência é correta para decidir a AÇÃO, mas esconde o resultado
   * financeiro sempre que a qualidade do dado tem precedência — um item em
   * prejuízo com custo ausente aparece só como "Não validado".
   *
   * A Central separa as duas leituras. Estas funções são PURAS e
   * DETERMINÍSTICAS e nunca reescrevem o status canônico:
   *  - quando o status do backend já é financeiro, ele é usado como está;
   *  - só quando o status canônico está ocupado por qualidade de dado é que o
   *    resultado financeiro é derivado das margens que o próprio Motor calculou.
   * O status original continua disponível em `item.status`.
   * ========================================================================= */

  var FINANCIAL_STATUSES = ["HEALTHY", "LOW_MARGIN", "LOSS"];
  var QUALITY_STATUSES = ["UNVALIDATED", "SUSPECT_DATA", "RECONCILING"];

  var FINANCIAL_RESULTS = {
    HEALTHY: { label: "Saudável", tone: "is-success" },
    LOW_MARGIN: { label: "Margem baixa", tone: "is-warning" },
    LOSS: { label: "Prejuízo", tone: "is-danger" },
    UNKNOWN: { label: "Indeterminado", tone: "is-neutral" },
  };

  var INTEGRITY_STATES = {
    RELIABLE: { label: "Confiável", tone: "is-success" },
    SUSPECT: { label: "Suspeito", tone: "is-warning" },
    MISSING: { label: "Não validado", tone: "is-neutral" },
    RECONCILING: { label: "Em conciliação", tone: "is-info" },
  };

  /** Margem que o Motor exibe: a realizada quando existe, senão a projetada. */
  function displayedMargin(item) {
    if (!item) return null;
    if (item.realized && item.realized.margin !== null && item.realized.margin !== undefined) return item.realized.margin;
    if (item.projected && item.projected.margin !== null && item.projected.margin !== undefined) return item.projected.margin;
    return null;
  }

  function financialResult(item) {
    if (!item) return { key: "UNKNOWN", label: FINANCIAL_RESULTS.UNKNOWN.label, tone: FINANCIAL_RESULTS.UNKNOWN.tone, origin: "derived", margin: null, reason: "Item indisponível." };
    if (FINANCIAL_STATUSES.indexOf(item.status) !== -1) {
      return {
        key: item.status,
        label: FINANCIAL_RESULTS[item.status].label,
        tone: FINANCIAL_RESULTS[item.status].tone,
        origin: "backend",
        margin: displayedMargin(item),
        reason: "Classificação financeira informada pelo Motor.",
      };
    }
    var margin = displayedMargin(item);
    if (margin === null) {
      return { key: "UNKNOWN", label: FINANCIAL_RESULTS.UNKNOWN.label, tone: FINANCIAL_RESULTS.UNKNOWN.tone, origin: "derived", margin: null, reason: "Nenhuma margem calculável com os dados disponíveis." };
    }
    if (margin < 0) {
      return { key: "LOSS", label: FINANCIAL_RESULTS.LOSS.label, tone: FINANCIAL_RESULTS.LOSS.tone, origin: "derived", margin: margin, reason: "Margem calculada pelo Motor é negativa." };
    }
    var target = item.targetMargin;
    if (target !== null && target !== undefined && margin < target) {
      return { key: "LOW_MARGIN", label: FINANCIAL_RESULTS.LOW_MARGIN.label, tone: FINANCIAL_RESULTS.LOW_MARGIN.tone, origin: "derived", margin: margin, reason: "Margem abaixo da meta informada pelo Motor." };
    }
    return {
      key: "HEALTHY",
      label: FINANCIAL_RESULTS.HEALTHY.label,
      tone: FINANCIAL_RESULTS.HEALTHY.tone,
      origin: "derived",
      margin: margin,
      reason: target === null || target === undefined
        ? "Margem positiva; nenhuma meta foi informada para comparar."
        : "Margem igual ou acima da meta informada pelo Motor.",
    };
  }

  function dataIntegrity(item) {
    if (!item) return { key: "MISSING", label: INTEGRITY_STATES.MISSING.label, tone: INTEGRITY_STATES.MISSING.tone, origin: "derived", reason: "Item indisponível." };
    var map = { UNVALIDATED: "MISSING", SUSPECT_DATA: "SUSPECT", RECONCILING: "RECONCILING" };
    if (QUALITY_STATUSES.indexOf(item.status) !== -1) {
      var key = map[item.status];
      return {
        key: key,
        label: INTEGRITY_STATES[key].label,
        tone: INTEGRITY_STATES[key].tone,
        origin: "backend",
        reason: item.problem || "Estado de qualidade informado pelo Motor.",
      };
    }
    // Status canônico financeiro: a integridade é derivada das mesmas
    // evidências que o Motor expôs, sem inventar sinal novo.
    var variables = item.variables || {};
    if (!variables.price || variables.price.value === null || !variables.cost || variables.cost.value === null) {
      return { key: "MISSING", label: INTEGRITY_STATES.MISSING.label, tone: INTEGRITY_STATES.MISSING.tone, origin: "derived", reason: "Variável obrigatória ausente (preço ou custo)." };
    }
    var divergences = item.divergences || [];
    if (divergences.some(function (entry) { return String(entry.type).toUpperCase() === "CONFLICT"; })) {
      return { key: "SUSPECT", label: INTEGRITY_STATES.SUSPECT.label, tone: INTEGRITY_STATES.SUSPECT.tone, origin: "derived", reason: "Fontes do mesmo momento informaram valores diferentes." };
    }
    if (item.confidence && item.confidence.level === "LOW") {
      return { key: "SUSPECT", label: INTEGRITY_STATES.SUSPECT.label, tone: INTEGRITY_STATES.SUSPECT.tone, origin: "derived", reason: "Confiança baixa em pelo menos uma variável do cálculo." };
    }
    // `reconciling` é estado de PROCESSAMENTO informado pela Central de Vendas.
    // Mercado Pago indisponível não conta: a integração nunca existiu, e tratar
    // ausência permanente como "conciliando" marcaria o catálogo inteiro.
    if (item.reconciling === true) {
      return { key: "RECONCILING", label: INTEGRITY_STATES.RECONCILING.label, tone: INTEGRITY_STATES.RECONCILING.tone, origin: "derived", reason: "A leitura financeira do período ainda está sendo processada." };
    }
    return { key: "RELIABLE", label: INTEGRITY_STATES.RELIABLE.label, tone: INTEGRITY_STATES.RELIABLE.tone, origin: "derived", reason: "Sem dado obrigatório ausente, conflito ou conciliação pendente." };
  }

  /** Placar das duas leituras sobre os itens carregados. */
  function summarizeItems(items) {
    var financial = { HEALTHY: 0, LOW_MARGIN: 0, LOSS: 0, UNKNOWN: 0 };
    var integrity = { RELIABLE: 0, SUSPECT: 0, MISSING: 0, RECONCILING: 0 };
    (items || []).forEach(function (item) {
      financial[financialResult(item).key] += 1;
      integrity[dataIntegrity(item).key] += 1;
    });
    return { financial: financial, integrity: integrity, total: (items || []).length };
  }

  /* =========================================================================
   * FILA DE DIVERGÊNCIAS
   * Uma linha por divergência REAL relatada pelo Motor (CONFLICT/DRIFT).
   * O impacto é recalculado com o núcleo: MC com o valor alternativo menos a
   * MC da composição atual. Nenhuma divergência é inventada.
   * ========================================================================= */

  function variableOfField(fieldKey) {
    var normalized = String(fieldKey || "").trim();
    var keys = Object.keys(VARIABLE_META);
    for (var i = 0; i < keys.length; i += 1) {
      if (VARIABLE_META[keys[i]].field === normalized || keys[i] === normalized) return keys[i];
    }
    return null;
  }

  /**
   * Alguma outra fonte disponível desta variável discorda da selecionada?
   * Usa a mesma tolerância do núcleo — é o marcador "outra fonte difere" da
   * célula, não uma divergência nova.
   */
  function hasSourceDisagreement(item, variableKey, source) {
    var bucket = item && item.sources && item.sources[variableKey];
    if (!bucket) return false;
    var selected = bucket.entries[source];
    if (!selected || !selected.available) return false;
    var tolerance = toleranceFor(variableKey);
    return bucket.order.some(function (other) {
      if (other === source) return false;
      var entry = bucket.entries[other];
      return entry && entry.available && isDifferent(selected.value, entry.value, tolerance);
    });
  }

  function divergenceQueue(items, selection) {
    var chosen = selection || PRESETS.projected;
    var rows = [];
    (items || []).forEach(function (item) {
      var composition = resolveComposition(item, chosen);
      (item.divergences || []).forEach(function (divergence) {
        var variableKey = variableOfField(divergence.field);
        if (!variableKey) return;
        var selectedSource = chosen[variableKey];
        var sideA = { source: divergence.sourceAKey, value: divergence.valueA };
        var sideB = { source: divergence.sourceBKey, value: divergence.valueB };
        var alternative = sideA.source === selectedSource ? sideB : sideB.source === selectedSource ? sideA : sideB;
        var selectedValue = composition.values[variableKey];
        if (alternative.value === null || alternative.value === undefined) return;

        var alternativeValues = Object.assign({}, composition.values);
        alternativeValues[variableKey] = alternative.value;
        var alternativeMargin = computeMargin(alternativeValues);
        var impactPp = alternativeMargin.raw && alternativeMargin.raw.margin !== null && composition.raw.margin !== null
          ? round((alternativeMargin.raw.margin - composition.raw.margin) * 100, 2)
          : null;

        // CONFLICT é defeito de dado: duas fontes do mesmo momento discordam.
        // DRIFT é previsto × realizado — informação, não defeito — e só sobe a
        // crítica quando o impacto na MC é material.
        var type = String(divergence.type || "").toUpperCase();
        var critical = type === "CONFLICT" || (impactPp !== null && Math.abs(impactPp) >= 2);

        rows.push({
          itemId: item.id,
          title: item.title,
          sku: item.sku,
          variable: variableKey,
          variableLabel: VARIABLE_META[variableKey].label,
          format: VARIABLE_META[variableKey].format,
          type: type || "CONFLICT",
          origin: divergence.origin || "motor",
          selectedSource: selectedSource,
          selectedSourceLabel: sourceLabel(selectedSource),
          selectedValue: selectedValue,
          alternativeSource: alternative.source,
          alternativeSourceLabel: sourceLabel(alternative.source),
          alternativeValue: numberOrNull(alternative.value),
          impactPp: impactPp,
          severity: critical ? "CRITICA" : "REVISAR",
          explanation: divergence.explanation,
        });
      });
    });
    return rows;
  }

  /* =========================================================================
   * SAÚDE DAS FONTES — derivada apenas do que a resposta carregada informa.
   * Nada é presumido disponível: Mercado Pago e Extensão continuam pendentes
   * enquanto nenhuma evidência real chegar por eles.
   * ========================================================================= */

  var SOURCE_HEALTH_SPEC = [
    { key: "MELI_API", name: "Mercado Livre API", variable: "price", pendingLabel: "sem leitura da API nesta página" },
    { key: "VENFORCE_BASE", name: "Bases VenForce", variable: "cost", pendingLabel: "nenhum custo exposto nesta página" },
    { key: "MELI_ORDER", name: "Pedidos ML", variable: "price", pendingLabel: "sem venda no período" },
    { key: "MERCADO_PAGO", name: "Mercado Pago", variable: null, pendingLabel: "integração pendente" },
    { key: "EXTENSION_DOM", name: "Extensão", variable: "price", pendingLabel: "ingestão pendente" },
  ];

  function sourceHealth(response) {
    var items = (response && response.items) || [];
    var total = items.length;
    return SOURCE_HEALTH_SPEC.map(function (spec) {
      if (spec.key === "MERCADO_PAGO") {
        // Só o adapter de settlement alimentaria esta fonte; enquanto ele não
        // existir no backend, a Central não pode fabricar recebimento líquido.
        var settled = items.filter(function (item) { return item.settlementAvailable === true; }).length;
        if (!total) return { key: spec.key, name: spec.name, state: "UNAVAILABLE", detail: spec.pendingLabel, covered: 0, total: 0 };
        if (settled === 0) return { key: spec.key, name: spec.name, state: "PENDING", detail: spec.pendingLabel, covered: 0, total: total };
        return { key: spec.key, name: spec.name, state: settled === total ? "OK" : "PARTIAL", detail: settled + "/" + total + " conciliados", covered: settled, total: total };
      }
      var covered = items.filter(function (item) {
        var entry = sourceEntry(item, spec.variable, spec.key);
        if (entry && entry.available) return true;
        // Fonte pode alimentar outras variáveis além da amostrada.
        return VARIABLES.some(function (variableKey) {
          var other = sourceEntry(item, variableKey, spec.key);
          return other && other.available;
        });
      }).length;
      if (!total) return { key: spec.key, name: spec.name, state: "UNAVAILABLE", detail: "sem itens carregados", covered: 0, total: 0 };
      if (covered === 0) return { key: spec.key, name: spec.name, state: "PENDING", detail: spec.pendingLabel, covered: 0, total: total };
      return {
        key: spec.key,
        name: spec.name,
        state: covered === total ? "OK" : "PARTIAL",
        detail: covered + "/" + total + " itens nesta página",
        covered: covered,
        total: total,
      };
    });
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

    /*
     * WORKSPACE — uma única leitura que alimenta planilha, filtros, KPIs e
     * fila de divergências. Diferente de `getCentral` (paginado no servidor),
     * aqui a página inteira do catálogo carregado (até o teto seguro do
     * backend) volta em `items`; filtro, busca e paginação visual acontecem
     * no cliente sobre esse array. Nenhuma chamada por linha nesta função.
     */
    function getWorkspace(params, signal) {
      params = params || {};
      var slug = String(params.clientSlug || "").trim();
      if (!slug) return Promise.resolve({ ok: false, status: 400, error: "Selecione um cliente.", type: "no-client" });
      var context = {
        client: { slug: slug, name: params.clientName || slug },
        marketplace: params.marketplace || "meli",
      };
      var range = dateRange(params);
      context.period = { inicio: range.dateFrom, fim: range.dateTo, label: "Últimos 30 dias" };
      var workspaceQuery = buildQuery({
        marketplace: context.marketplace,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        maxItens: params.maxItens,
      });

      return call("/operacao/central-margem/" + encodeURIComponent(slug) + "/workspace" + workspaceQuery, { signal: signal })
        .then(function (canonical) {
          if (canonical.ok) return normalizeWorkspaceResponse(canonical.data, context);
          if (canonical.aborted) return canonical;
          if ([404, 501].indexOf(canonical.status) === -1) {
            return { ok: false, status: canonical.status, error: canonical.error || "O Motor de Margem não respondeu.", code: canonical.code || null, type: canonical.type || "api" };
          }

          // Fallback legado: o catálogo sincronizado (DB) não tem o teto de
          // batch ao vivo do Motor — pede um limite maior para aproximar um
          // workspace sem nunca chamar o Mercado Livre por linha.
          var maxItens = numberOrNull(params.maxItens) || 200;
          var catalogQuery = buildQuery({ clienteSlug: slug, limit: maxItens, page: 1 });
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
            var legacy = adaptLegacyResponse(catalog.data, sales.ok ? sales.data : null, context, sales.ok ? null : sales);
            var total = legacy.pagination.total || legacy.items.length;
            var partial = legacy.items.length < total;
            return {
              ok: true,
              sourceMode: legacy.sourceMode,
              sourceLabel: legacy.sourceLabel,
              client: legacy.client,
              marketplace: legacy.marketplace,
              items: legacy.items,
              partial: partial,
              coverage: { loaded: legacy.items.length, total: total, partial: partial },
              summary: { counts: legacy.summary.counts, scope: "workspace" },
              lastUpdated: legacy.lastUpdated,
              period: legacy.period,
              warnings: legacy.warnings,
              gaps: legacy.gaps,
            };
          });
        });
    }

    return { getClients: getClients, getCentral: getCentral, getWorkspace: getWorkspace, call: call };
  }

  return {
    STATUSES: STATUSES,
    LEVELS: LEVELS,
    SOURCE_LABELS: SOURCE_LABELS,
    SOURCE_SHORT_LABELS: SOURCE_SHORT_LABELS,
    SOURCE_SELECT_LABELS: SOURCE_SELECT_LABELS,
    VARIABLES: VARIABLES,
    VARIABLE_META: VARIABLE_META,
    SOURCE_SLOTS: SOURCE_SLOTS,
    PRESETS: PRESETS,
    FINANCIAL_RESULTS: FINANCIAL_RESULTS,
    INTEGRITY_STATES: INTEGRITY_STATES,
    presetFor: presetFor,
    clonePreset: clonePreset,
    computeMargin: computeMargin,
    resolveComposition: resolveComposition,
    simulateScenario: simulateScenario,
    sourceEntry: sourceEntry,
    buildSourceMap: buildSourceMap,
    financialResult: financialResult,
    dataIntegrity: dataIntegrity,
    summarizeItems: summarizeItems,
    divergenceQueue: divergenceQueue,
    hasSourceDisagreement: hasSourceDisagreement,
    sourceHealth: sourceHealth,
    displayedMargin: displayedMargin,
    sourceLabel: sourceLabel,
    normalizeConfidence: normalizeConfidence,
    normalizeStatus: normalizeStatus,
    normalizeCanonicalItem: normalizeCanonicalItem,
    normalizeCanonicalResponse: normalizeCanonicalResponse,
    normalizeWorkspaceResponse: normalizeWorkspaceResponse,
    adaptLegacyResponse: adaptLegacyResponse,
    buildSalesIndex: buildSalesIndex,
    simulatePrice: simulatePrice,
    countStatuses: countStatuses,
    createClient: createClient,
    numberOrNull: numberOrNull,
    marginFraction: marginFraction,
  };
});
