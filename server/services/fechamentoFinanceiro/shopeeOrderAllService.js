// server/services/fechamentoFinanceiro/shopeeOrderAllService.js
// MOTOR FINANCEIRO REAL da Shopee (planilha de pedidos / Order.all).
//
// Este é o motor "real_financial": usa repasse e taxas efetivamente cobradas,
// por pedido, sem faixa de tarifa estimada por ticket médio.
// O motor "estimated_performance" (planilha de performance) vive em
// shopeePerformanceService.js.
//
// Aliases de coluna confirmados: ver docs/fechamento-shopee-colunas.md.

const { toNumber, round2 } = require("../../utils/numberUtils");
const {
  normalizeText,
  normalizeKey,
  normalizeMatchKey,
  normalizeShopeeId,
  findField,
} = require("../../utils/textUtils");
const {
  allocateByRevenue,
  buildCoverage,
  computeTacos,
  computeTacox,
  legacyRatio,
  safeRatio,
} = require("../../utils/fechamento/financeiroShared");

function getNormalizedColumns(rows) {
  const first = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (!first || typeof first !== "object") return [];
  return Object.keys(first).map((k) => normalizeKey(k));
}





function hasAnyColumn(columns, candidates) {
  return candidates.some((candidate) =>
    columns.some((col) => col.includes(normalizeKey(candidate)))
  );
}





function isShopeeFinancialOrderSheet(rows) {
  const cols = getNormalizedColumns(rows);
  if (!cols.length) return false;

  const hasOrderId = hasAnyColumn(cols, ["id do pedido", "order id", "pedido id"]);
  const hasStatusPedido = hasAnyColumn(cols, ["status do pedido"]);
  const supportingSignals = [
    ["status da devolucao / reembolso", "status da devolução / reembolso", "status de devolucao/reembolso", "status de devolução/reembolso"],
    ["nome do produto", "produto"],
    ["preco acordado", "preço acordado"],
    ["quantidade"],
    ["subtotal do produto"],
    ["taxa de transacao", "taxa de transação"],
    ["taxa de comissao bruta", "taxa de comissão bruta"],
    ["taxa de comissao liquida", "taxa de comissão líquida"],
    ["taxa de servico bruta", "taxa de serviço bruta"],
    ["taxa de servico liquida", "taxa de serviço líquida"],
    ["total global"],
    ["valor estimado do frete"],
    ["repasse"],
  ];
  const supportHits = supportingSignals.filter((group) => hasAnyColumn(cols, group)).length;

  const hasReturnStatus = hasAnyColumn(cols, [
    "status da devolucao / reembolso",
    "status da devolução / reembolso",
    "status de devolucao/reembolso",
    "status de devolução/reembolso",
  ]);

  // Regra principal para Order.all: ID + status + sinais adicionais de fechamento.
  return hasOrderId && hasStatusPedido && (supportHits >= 2 || hasReturnStatus);
}





// Classificação única de status de pedido Shopee, usada pelo motor financeiro
// e pela reconciliação operacional do motor de performance.
// Retorna: completed | delivered | shipped | intermediate | cancelledConfirmed |
//          returnOrRefund | unpaid | other
function classifyShopeeOrderStatus(statusNorm, motivoNorm, devolucaoNorm) {
  // Verifica se campo de devolução/reembolso tem conteúdo real
  const devEmpty =
    !devolucaoNorm ||
    devolucaoNorm === "-" || devolucaoNorm === "–" || devolucaoNorm === "" ||
    devolucaoNorm === "65" || devolucaoNorm === "n/a" || devolucaoNorm === "na";

  const devReturnTerms = [
    "devolucao", "reembolso", "refund", "return", "solicitacao aprovada",
  ];
  const devActive =
    !devEmpty && devReturnTerms.some((t) => devolucaoNorm.includes(t));
  const devPending =
    !devEmpty && !devActive &&
    (devolucaoNorm.includes("aguardando") ||
      devolucaoNorm.includes("aberta") ||
      devolucaoNorm.includes("pendente"));

  // 1. Devolução/reembolso ativo — verificar antes de "entregue" para pegar
  //    casos de entrega com devolução posterior
  if (devActive) return "returnOrRefund";

  // 2. Concluído
  if (statusNorm.includes("concluido") || statusNorm.includes("concluído")) {
    return "completed";
  }

  // 3. Entregue (sem devolução ativa)
  if (statusNorm.includes("entregue")) return "delivered";

  // 4. Enviado / em trânsito
  const shippedTerms = [
    "enviado", "em transito", "em trânsito", "a caminho",
    "coletado", "saiu para entrega",
  ];
  if (shippedTerms.some((t) => statusNorm.includes(t))) return "shipped";

  // 5. Não pago — verificar antes de cancelledConfirmed porque "cancelado"
  //    com motivo "pedido não pago" deve cair aqui
  const isNaoPago =
    statusNorm.includes("nao pago") || statusNorm.includes("não pago");
  const isCancelled = statusNorm === "cancelado";
  const motivoIsUnpaid =
    motivoNorm.includes("nao pago") ||
    motivoNorm.includes("pedido nao pago") ||
    motivoNorm.includes("nao houve pagamento");
  if (isNaoPago || (isCancelled && motivoIsUnpaid)) return "unpaid";

  // 6. Cancelado confirmado (não é não-pago, não é devolução)
  if (isCancelled) return "cancelledConfirmed";

  // 7. Intermediário / aguardando
  const intermediateTerms = [
    "a enviar", "aguardando", "comprador pode pedir", "comprador pode solicitar",
  ];
  if (
    intermediateTerms.some((t) => statusNorm.includes(t)) ||
    devPending
  ) {
    return "intermediate";
  }

  // 8. Outros
  return "other";
}

// Status que NÃO representam venda reconhecida no fechamento financeiro.
const SHOPEE_KINDS_OUT_OF_REVENUE = new Set([
  "cancelledConfirmed",
  "unpaid",
  "returnOrRefund",
]);

// "Preenchido" = a célula existe e não está vazia. Zero é um valor válido.
function rawProvided(raw) {
  return String(raw ?? "").trim() !== "";
}

// "0", "0.00", "0,00" — o placeholder numérico que a Shopee grava em colunas
// de TEXTO na linha de TOTAL do Order.all, nunca visto em pedido real.
function isZeroPlaceholder(value) {
  const text = String(value ?? "").trim();
  return text !== "" && /^0+([.,]0+)?$/.test(text);
}

// A linha de TOTAL/resumo do Order.all real (confirmada num export do
// cliente) repete esse placeholder em ID do pedido, Status do pedido E Nome
// do Produto — três colunas que todo pedido de verdade preenche com texto
// (o "ID do pedido" da Shopee é sempre alfanumérico, nunca só dígitos/zeros).
// Exige o ID mais pelo menos um dos outros dois para não confundir um
// pedido real cujo nome de produto por acaso viesse vazio/zerado.
function isShopeeOrderAllTotalRow(orderId, statusRaw, product) {
  return (
    isZeroPlaceholder(orderId) &&
    (isZeroPlaceholder(statusRaw) || isZeroPlaceholder(product))
  );
}

function parseShopeeFinancialRows(rows) {
  const parsed = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const orderId = String(
      findField(row, ["id do pedido", "pedido id", "order id"]) || ""
    ).trim();
    const product = String(
      findField(row, ["nome do produto", "produto", "product name"]) || ""
    ).trim();

    // Linha de TOTAL/resumo da planilha, não um pedido: não entra em
    // nenhuma métrica (faturamento, contagem, cobertura, LC/MC).
    const statusRawForTotalCheck = String(
      findField(row, ["status do pedido", "status pedido"]) || ""
    ).trim();
    if (isShopeeOrderAllTotalRow(orderId, statusRawForTotalCheck, product)) {
      continue;
    }

    const itemIdRaw = findField(row, [
      "id do item",
      "id do produto",
      "item id",
      "product id",
      "item_id",
      "product_id",
      "id do anuncio",
      "id anúncio",
      "id anuncio",
    ]);
    const productIdRaw = findField(row, [
      "id do produto",
      "product id",
      "product_id",
      "id do item",
      "item id",
      "item_id",
    ]);
    const variationIdRaw = findField(row, [
      "id da variacao",
      "id da variação",
      "id de variacao",
      "id de variação",
      "id da variacao do produto",
      "id da variação do produto",
      "variation id",
      "variation_id",
    ]);
    const modelIdRaw = findField(row, [
      "id do modelo",
      "id do model",
      "model id",
      "model_id",
      "modelid",
      "id da variacao",
      "id da variação",
    ]);
    const skuRaw = findField(row, ["sku", "sku da variacao", "sku da variação"]);
    const skuVariationRaw = findField(row, ["sku da variacao", "sku da variação"]);
    const skuPrincipleRaw = findField(row, ["sku principle", "sku principal"]);
    const skuMainRefRaw = findField(row, ["nº de referencia do sku principal", "no de referencia do sku principal"]);
    const skuRefNumberRaw = findField(row, ["numero de referencia sku", "número de referência sku"]);

    const itemId = normalizeShopeeId(itemIdRaw);
    const productId = normalizeShopeeId(productIdRaw);
    const variationId = normalizeShopeeId(variationIdRaw);
    const modelId = normalizeShopeeId(modelIdRaw);
    const sku = normalizeMatchKey(skuRaw);
    const skuVariation = normalizeMatchKey(skuVariationRaw);
    const skuPrinciple = normalizeMatchKey(skuPrincipleRaw);
    const skuMainRef = normalizeMatchKey(skuMainRefRaw);
    const skuRefNumber = normalizeMatchKey(skuRefNumberRaw);

    const quantityRaw = toNumber(findField(row, ["quantidade", "qty"]));
    const quantity = quantityRaw > 0 ? quantityRaw : 1;

    const subtotalRaw = toNumber(findField(row, ["subtotal do produto"]));
    const faturamentoRaw = toNumber(findField(row, ["faturamento"]));
    const agreedPriceRaw = toNumber(findField(row, ["preco acordado", "preço acordado"]));
    const grossRevenueRaw = toNumber(
      findField(row, [
        "faturamento",
        "subtotal do produto",
        "valor total",
        "total do pedido",
      ])
    );
    const computedFromPrice = round2(agreedPriceRaw * quantity);
    const itemRevenue = round2(
      subtotalRaw || faturamentoRaw || computedFromPrice || grossRevenueRaw || 0
    );

    const paidRevenueRaw = toNumber(
      findField(row, ["repasse", "faturamento", "subtotal do produto", "valor total"])
    );
    const totalGlobalRaw = toNumber(findField(row, ["total global"]));

    const taxRaw = toNumber(findField(row, ["imposto"]));
    const cmvRaw = toNumber(findField(row, ["cmv"]));
    const profitRaw = toNumber(findField(row, ["lucro", "profit"]));

    const transactionFeeRaw = findField(row, ["taxa de transação", "taxa de transacao"]);
    const commissionNetRaw = findField(row, ["taxa de comissão líquida", "taxa de comissao liquida"]);
    const commissionGrossRaw = findField(row, ["taxa de comissão bruta", "taxa de comissao bruta"]);
    const serviceNetRaw = findField(row, ["taxa de serviço líquida", "taxa de servico liquida"]);
    const serviceGrossRaw = findField(row, ["taxa de serviço bruta", "taxa de servico bruta"]);

    const transactionFee = toNumber(transactionFeeRaw);
    const commissionNet = toNumber(commissionNetRaw);
    const commissionGross = toNumber(commissionGrossRaw);
    const serviceNet = toNumber(serviceNetRaw);
    const serviceGross = toNumber(serviceGrossRaw);
    const commissionNetProvided = String(commissionNetRaw ?? "").trim() !== "";
    const commissionGrossProvided = String(commissionGrossRaw ?? "").trim() !== "";
    const serviceNetProvided = String(serviceNetRaw ?? "").trim() !== "";
    const serviceGrossProvided = String(serviceGrossRaw ?? "").trim() !== "";

    const statusPedido = normalizeText(findField(row, ["status do pedido", "status pedido"]));
    const statusDevolucao = normalizeText(
      findField(row, [
        "status da devolucao / reembolso",
        "status da devolução / reembolso",
        "status de devolucao/reembolso",
        "status de devolução/reembolso",
      ])
    );
    const cancelarMotivo = normalizeText(
      findField(row, [
        "cancelar motivo",
        "motivo cancelamento",
        "motivo do cancelamento",
        "motivo cancelar",
        "cancel reason",
      ])
    );
    const kind = classifyShopeeOrderStatus(statusPedido, cancelarMotivo, statusDevolucao);
    const isCancelled = statusPedido.includes("cancel");
    const statusDevolucaoClean = String(statusDevolucao || "").trim();
    const hasReturnText =
      statusDevolucaoClean &&
      ![
        "-",
        "--",
        "n/a",
        "na",
        "none",
        "sem devolucao",
        "sem devolução",
        "sem reembolso",
        "nao",
        "não",
      ].includes(statusDevolucaoClean);
    const isReturn =
      !!hasReturnText &&
      (
        statusDevolucao.includes("devol") ||
        statusDevolucao.includes("reemb") ||
        statusDevolucao.includes("refund") ||
        statusDevolucao.includes("return")
      );

    const hasSignal =
      !!orderId ||
      !!itemId ||
      !!variationId ||
      !!product ||
      Math.abs(grossRevenueRaw) > 0 ||
      Math.abs(paidRevenueRaw) > 0 ||
      quantity > 0;
    if (!hasSignal) continue;

    parsed.push({
      id: orderId || String(parsed.length + 1),
      product: product || "—",
      itemId,
      productId,
      variationId,
      modelId,
      sku,
      skuVariation,
      skuPrinciple,
      skuMainRef,
      skuRefNumber,
      statusPedido,
      statusDevolucao,
      cancelarMotivo,
      kind,
      quantity,
      grossRevenue: itemRevenue,
      paidRevenue: round2(paidRevenueRaw || itemRevenue || totalGlobalRaw || 0),
      totalGlobal: totalGlobalRaw,
      tax: taxRaw,
      taxProvided: rawProvided(findField(row, ["imposto"])),
      cmv: cmvRaw,
      cmvProvided: rawProvided(findField(row, ["cmv"])),
      repasse: toNumber(findField(row, ["repasse"])),
      repasseProvided: rawProvided(findField(row, ["repasse"])),
      transactionFee,
      transactionFeeProvided: rawProvided(transactionFeeRaw),
      commissionNet,
      commissionGross,
      serviceNet,
      serviceGross,
      commissionNetProvided,
      commissionGrossProvided,
      serviceNetProvided,
      serviceGrossProvided,
      shipping: toNumber(findField(row, ["valor estimado do frete", "frete", "shipping"])),
      shippingProvided: rawProvided(
        findField(row, ["valor estimado do frete", "frete", "shipping"])
      ),
      profit: profitRaw,
      isCancelled,
      isReturn,
    });
  }

  return parsed;
}





// ── Motor financeiro real ───────────────────────────────────────────────────

// Colunas de cupom/rebate/promoção/ajuste NÃO fazem parte do contrato conhecido
// da planilha (ver docs/fechamento-shopee-colunas.md). Quando aparecem, são
// listadas para auditoria e NÃO entram na conta — o Repasse já é líquido delas,
// e aplicar de novo seria contagem dupla.
const SHOPEE_ADJUSTMENT_HINTS = [
  "cupom",
  "voucher",
  "rebate",
  "promocao",
  "promoção",
  "subsidio",
  "subsídio",
  "desconto",
  "ajuste",
];

function detectShopeeAdjustmentColumns(rows) {
  const first = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (!first || typeof first !== "object") return [];

  return Object.keys(first).filter((key) => {
    const normalized = normalizeKey(key);
    return SHOPEE_ADJUSTMENT_HINTS.some((hint) => normalized.includes(hint));
  });
}

// Escolhe a taxa efetivamente descontada: líquida quando presente, bruta só
// como fallback. NUNCA soma as duas.
function resolveFeeComponent(netRaw, netProvided, grossRaw, grossProvided) {
  if (netProvided) {
    return { value: Math.abs(toNumber(netRaw)), source: "liquida", present: true };
  }
  if (grossProvided) {
    return { value: Math.abs(toNumber(grossRaw)), source: "bruta", present: true };
  }
  return { value: 0, source: "ausente", present: false };
}

// Campos de nível PEDIDO se repetem em cada linha de item do mesmo pedido.
// Se todos os valores preenchidos são idênticos, é um campo repetido (conta uma
// vez). Se divergem, é um campo por linha (soma). Evita multiplicar repasse e
// taxas pelo número de itens.
function collapseOrderLevelValue(values) {
  const provided = values.filter((entry) => entry.present);
  if (provided.length === 0) return { value: 0, present: false, mode: "ausente" };
  if (provided.length === 1) {
    return { value: provided[0].value, present: true, mode: "pedido" };
  }

  const first = round2(provided[0].value);
  const allEqual = provided.every((entry) => round2(entry.value) === first);
  if (allEqual) return { value: first, present: true, mode: "pedido" };

  return {
    value: round2(provided.reduce((sum, entry) => sum + entry.value, 0)),
    present: true,
    mode: "linha",
  };
}

// Ordem real de tentativa de match do motor real. Extraída como constante
// só para o Debug Financeiro conseguir nomear cada tentativa — o LOOP e a
// prioridade continuam sendo os mesmos de sempre.
const SHOPEE_COST_LOOKUP_FIELDS = Object.freeze([
  "variationId",
  "modelId",
  "itemId",
  "productId",
  "skuVariation",
  "skuPrinciple",
  "skuMainRef",
  "skuRefNumber",
  "sku",
]);

// Nome do "costMatchSource" de cada campo do match DIRETO. Só rotula o que já
// acontecia — a ordem de tentativa continua sendo SHOPEE_COST_LOOKUP_FIELDS.
const SHOPEE_DIRECT_MATCH_SOURCE = Object.freeze({
  variationId: "direct_variation_id",
  modelId: "direct_model_id",
  itemId: "direct_item_id",
  productId: "direct_product_id",
  skuVariation: "direct_sku",
  skuPrinciple: "direct_sku",
  skuMainRef: "direct_sku",
  skuRefNumber: "direct_sku",
  sku: "direct_sku",
});

// Campos de SKU do Order.all, na ordem em que a ponte deve tentá-los: do mais
// específico (SKU da variação) para o mais genérico.
const SHOPEE_BRIDGE_SKU_FIELDS = Object.freeze([
  "skuVariation",
  "skuPrinciple",
  "skuMainRef",
  "skuRefNumber",
  "sku",
]);

// debugCollector é opcional e só existe quando chamado a partir do Debug
// Financeiro (POST /fechamentos/financeiro/debug). Sem ele, o comportamento
// e o retorno desta função são IDÊNTICOS ao anterior — mesmo loop, mesmo
// early return no primeiro hit.
function lookupShopeeCostDetailed(costMap, line, debugCollector) {
  if (!costMap || typeof costMap.get !== "function") return { row: null, field: null };

  for (const field of SHOPEE_COST_LOOKUP_FIELDS) {
    const candidate = line[field];
    const key = normalizeMatchKey(candidate);

    if (!key) {
      if (debugCollector) {
        debugCollector.recordMatchAttempt({
          engine: "shopee_real",
          stage: "cost_lookup",
          orderId: line.id,
          field,
          rawValue: candidate ?? null,
          normalizedKey: null,
          result: "skip",
        });
      }
      continue;
    }

    const hit = costMap.get(key);
    if (debugCollector) {
      debugCollector.recordMatchAttempt({
        engine: "shopee_real",
        stage: "cost_lookup",
        orderId: line.id,
        field,
        rawValue: candidate,
        normalizedKey: key,
        result: hit ? "hit" : "miss",
      });
    }
    if (hit) return { row: hit, field };
  }

  return { row: null, field: null };
}

function lookupShopeeCost(costMap, line, debugCollector) {
  return lookupShopeeCostDetailed(costMap, line, debugCollector).row;
}

// Dois candidatos que apontam para a MESMA linha de custo (ou para custos
// idênticos) não são ambiguidade — só duplicidade de chave na base.
function sameCostRow(a, b) {
  if (a === b) return true;
  return (
    round2(Number(a.cost || 0)) === round2(Number(b.cost || 0)) &&
    round2(Number(a.taxPercent || 0)) === round2(Number(b.taxPercent || 0))
  );
}

// Resolve custo a partir de uma lista de IDs vindos da ponte. Se dois IDs
// distintos levarem a custos DIFERENTES, devolve ambiguous — nunca escolhe.
function resolveBridgeCandidates(costMap, ids) {
  const rows = [];
  const hitIds = [];

  for (const id of Array.isArray(ids) ? ids : []) {
    const key = normalizeMatchKey(id);
    if (!key) continue;
    const row = costMap.get(key);
    if (!row) continue;
    if (!rows.includes(row)) {
      rows.push(row);
      hitIds.push(id);
    }
  }

  if (rows.length === 0) return { row: null, ambiguous: false, id: null };
  if (rows.length === 1) return { row: rows[0], ambiguous: false, id: hitIds[0] };

  const allEquivalent = rows.every((row) => sameCostRow(row, rows[0]));
  if (allEquivalent) return { row: rows[0], ambiguous: false, id: hitIds[0] };

  return { row: null, ambiguous: true, id: null, candidateIds: hitIds };
}

// Conciliação de custo de UMA linha do Order.all.
//
//   1. match DIRETO (comportamento de sempre, prioridade intacta);
//   2. em MISS, e só então, a ponte de identidade da planilha de performance:
//      SKU do Order.all -> ID da Variação / ID do Item -> base de custos.
//
// A ponte é APENAS identidade: nenhum valor financeiro da performance entra
// aqui. Ambiguidade nunca é resolvida por escolha arbitrária.
function resolveShopeeLineCost(costMap, line, costBridge, debugCollector) {
  const direct = lookupShopeeCostDetailed(costMap, line, debugCollector);
  if (direct.row) {
    return {
      costRow: direct.row,
      source: SHOPEE_DIRECT_MATCH_SOURCE[direct.field] || "direct_sku",
      // Valor bruto que efetivamente bateu — usado só pelo diagnóstico de
      // itens sem custo (describeShopeeCostGap), nunca pelo cálculo.
      matchedValue: line[direct.field],
      bridgeUsed: false,
      bridgeIds: null,
      ambiguous: false,
    };
  }

  const hasBridge = costBridge && typeof costBridge.get === "function" && costBridge.size > 0;
  if (!hasBridge || !costMap || typeof costMap.get !== "function") {
    return { costRow: null, source: "miss", bridgeUsed: false, bridgeIds: null, ambiguous: false };
  }

  // Primeiro SKU da linha que existe na ponte vence: do mais específico
  // (SKU da variação) para o mais genérico.
  let bridgeIds = null;
  let bridgeSku = null;
  // Primeiro SKU não vazio tentado, HIT ou MISS — é o valor que o
  // diagnóstico mostra quando nenhum deles bate na performance.
  let skuTried = null;
  for (const field of SHOPEE_BRIDGE_SKU_FIELDS) {
    const sku = normalizeShopeeId(line[field]);
    if (!sku) continue;
    if (skuTried === null) skuTried = sku;
    const found = costBridge.get(sku);
    if (debugCollector) {
      debugCollector.recordMatchAttempt({
        engine: "shopee_real",
        stage: "cost_bridge_sku",
        orderId: line.id,
        field,
        rawValue: line[field],
        normalizedKey: sku,
        result: found ? "hit" : "miss",
      });
    }
    if (found) {
      bridgeIds = found;
      bridgeSku = sku;
      break;
    }
  }

  if (!bridgeIds) {
    return { costRow: null, source: "miss", bridgeUsed: true, bridgeIds: null, skuTried, ambiguous: false };
  }

  // ID da Variação antes do ID do Item: a base pode ter custo por variação.
  for (const [ids, sourceName, stage] of [
    [bridgeIds.variationIds, "bridge_variation_id", "cost_bridge_variation"],
    [bridgeIds.itemIds, "bridge_item_id", "cost_bridge_item"],
  ]) {
    const resolved = resolveBridgeCandidates(costMap, ids);
    if (debugCollector && Array.isArray(ids) && ids.length > 0) {
      debugCollector.recordMatchAttempt({
        engine: "shopee_real",
        stage,
        orderId: line.id,
        field: sourceName,
        rawValue: bridgeSku,
        normalizedKey: resolved.id || ids.join(" | "),
        result: resolved.ambiguous ? "ambiguous" : resolved.row ? "hit" : "miss",
      });
    }
    if (resolved.ambiguous) {
      return {
        costRow: null,
        source: "ambiguous",
        bridgeUsed: true,
        bridgeIds,
        bridgeSku,
        ambiguous: true,
        ambiguousCandidates: resolved.candidateIds || [],
      };
    }
    if (resolved.row) {
      return {
        costRow: resolved.row,
        source: sourceName,
        bridgeUsed: true,
        bridgeIds,
        bridgeSku,
        matchedId: resolved.id,
        matchedValue: resolved.id,
        ambiguous: false,
      };
    }
  }

  return { costRow: null, source: "miss", bridgeUsed: true, bridgeIds, bridgeSku, skuTried: bridgeSku, ambiguous: false };
}

// Diagnóstico legível de "por que este item ficou sem custo". Nunca mistura
// SKU e ID sem dizer o tipo — resolve a confusão da tela ("ID(s) não
// encontrados" mostrando SKU) sem tocar em nenhum valor financeiro.
//
//   type   "variation_id" | "item_id" | "model_id" | "product_id" | "sku" | "order_id"
//   value  o identificador cru (nunca normalizado/arredondado)
//   sku    o SKU do Order.all que originou o diagnóstico (quando houver)
//   reason "not_found_in_performance_bridge" | "not_found_in_cost_base" |
//          "ambiguous_bridge_candidates" | "zero_cost_in_base" | "not_found_direct"
function describeShopeeCostGap(line, costMatch, orderId) {
  if (costMatch.ambiguous) {
    const sku = costMatch.bridgeSku || line.skuVariation || line.skuPrinciple || line.sku || "";
    return { type: "sku", value: sku, sku: sku || null, reason: "ambiguous_bridge_candidates" };
  }

  if (costMatch.costRow) {
    // A base TEM a linha (achada direto ou pela ponte), só que com custo <= 0.
    const type = String(costMatch.source || "").replace(/^(direct|bridge)_/, "") || "sku";
    const value = costMatch.matchedValue ?? "";
    const sku = costMatch.bridgeUsed ? costMatch.bridgeSku : null;
    return { type, value: String(value), sku, reason: "zero_cost_in_base" };
  }

  if (costMatch.bridgeUsed) {
    if (costMatch.bridgeIds) {
      // O SKU foi encontrado na performance e virou ID — mas o ID não existe
      // na base. Variação antes de item, mesma prioridade do lookup.
      const variationId = (costMatch.bridgeIds.variationIds || [])[0];
      const itemId = (costMatch.bridgeIds.itemIds || [])[0];
      if (variationId) {
        return { type: "variation_id", value: variationId, sku: costMatch.bridgeSku, reason: "not_found_in_cost_base" };
      }
      if (itemId) {
        return { type: "item_id", value: itemId, sku: costMatch.bridgeSku, reason: "not_found_in_cost_base" };
      }
    }
    // O SKU do Order.all não foi encontrado na planilha de performance.
    const sku = costMatch.skuTried || "";
    return { type: "sku", value: sku, sku: sku || null, reason: "not_found_in_performance_bridge" };
  }

  // Sem ponte disponível (performance não enviada): mesmo fallback de
  // sempre, agora com o tipo explícito em vez de um valor solto.
  if (line.variationId) return { type: "variation_id", value: line.variationId, sku: null, reason: "not_found_direct" };
  if (line.itemId) return { type: "item_id", value: line.itemId, sku: null, reason: "not_found_direct" };
  if (line.skuVariation) return { type: "sku", value: line.skuVariation, sku: line.skuVariation, reason: "not_found_direct" };
  if (line.sku) return { type: "sku", value: line.sku, sku: line.sku, reason: "not_found_direct" };
  return { type: "order_id", value: orderId, sku: null, reason: "not_found_direct" };
}

// Motor financeiro real da Shopee. Calcula POR PEDIDO/LINHA, com taxas reais.
// costMap é montado por quem chama (shopeePerformanceService) para evitar
// dependência circular.
//
// costBridge (opcional) é a ponte de IDENTIDADE SKU -> ID do Item/ID da
// Variação extraída da planilha de performance. Ela só muda COMO o custo é
// localizado; receita, taxas, frete, status e cancelamentos continuam vindo
// exclusivamente do Order.all.
function processShopeeFinancialOrders({
  salesRowsRaw,
  costMap,
  costBridge = null,
  ads = 0,
  venforce = 0,
  affiliates = 0,
  // Opcional — só existe vindo do Debug Financeiro. Sem ele, resultado idêntico.
  debugCollector = null,
}) {
  const lines = parseShopeeFinancialRows(salesRowsRaw);
  const executiveNotes = [];
  const missingColumns = [];

  const adjustmentColumns = detectShopeeAdjustmentColumns(salesRowsRaw);
  if (adjustmentColumns.length > 0) {
    executiveNotes.push(
      `Colunas de cupom/rebate/ajuste detectadas e NÃO reaplicadas (o repasse já é líquido delas): ${adjustmentColumns.join(", ")}.`
    );
  }

  // 1. Agrupa por pedido. Um pedido com N produtos continua sendo 1 pedido.
  const orders = new Map();
  for (const line of lines) {
    const orderId = String(line.id || "").trim() || "SEM_PEDIDO";
    if (!orders.has(orderId)) orders.set(orderId, []);
    orders.get(orderId).push(line);
  }

  const detailedRows = [];
  const auditRows = [];
  const unmatchedIdsSet = new Set();
  // Diagnóstico tipado, aditivo ao unmatchedIds legado — deduplicado por
  // tipo+valor+SKU+motivo para não repetir a mesma pendência linha a linha.
  const unmatchedCostsMap = new Map();
  const unmatchedCancelled = [];

  const statusTotals = {
    completed: { count: 0, revenue: 0 },
    delivered: { count: 0, revenue: 0 },
    shipped: { count: 0, revenue: 0 },
    intermediate: { count: 0, revenue: 0 },
    cancelledConfirmed: { count: 0, revenue: 0 },
    returnOrRefund: { count: 0, revenue: 0 },
    unpaid: { count: 0, revenue: 0 },
    other: { count: 0, revenue: 0 },
  };

  let grossRevenueTotal = 0;
  let netRevenueTotal = 0;
  let revenueWithCost = 0;
  let revenueWithoutCost = 0;
  let contributionProfitTotal = 0;
  let marketplaceFeesTotal = 0;
  let shippingFeesTotal = 0;
  let shippingFeesPresent = false;
  let taxValueTotal = 0;
  let cmvTotal = 0;
  let ignoredRevenue = 0;
  let shippingIndeterminateOrders = 0;
  let feesMissingOrders = 0;

  // Observabilidade da conciliação de custo (não substitui nenhum campo já
  // existente — é diagnóstico adicional).
  const bridgeAvailable =
    !!costBridge && typeof costBridge.get === "function" && costBridge.size > 0;
  let directCostMatchCount = 0;
  let bridgeCostMatchCount = 0;
  let bridgeMissCount = 0;
  let bridgeAmbiguousCount = 0;
  let zeroCostRowsCount = 0;
  let revenueDirectMatched = 0;
  let revenueBridgeMatched = 0;
  const bridgeAmbiguousKeys = [];

  for (const [orderId, orderLines] of orders.entries()) {
    // Status do PEDIDO: o mais severo entre as linhas (uma devolução em
    // qualquer linha marca o pedido).
    const kindPriority = [
      "cancelledConfirmed",
      "returnOrRefund",
      "unpaid",
      "intermediate",
      "shipped",
      "delivered",
      "completed",
      "other",
    ];
    const orderKind =
      kindPriority.find((kind) => orderLines.some((line) => line.kind === kind)) ||
      "other";

    const orderGross = round2(
      orderLines.reduce((sum, line) => sum + Number(line.grossRevenue || 0), 0)
    );

    statusTotals[orderKind].count += 1;
    statusTotals[orderKind].revenue = round2(
      statusTotals[orderKind].revenue + orderGross
    );

    // Cancelado / não pago / devolvido: fora da receita reconhecida, mas
    // registrado na auditoria com o valor completo.
    if (SHOPEE_KINDS_OUT_OF_REVENUE.has(orderKind)) {
      for (const line of orderLines) {
        auditRows.push({
          "ID do pedido": orderId,
          Produto: line.product,
          Quantidade: line.quantity,
          "Receita bruta": round2(line.grossRevenue),
          "Status do pedido": line.statusPedido,
          "Status da devolução / reembolso": line.statusDevolucao,
          Classificação: orderKind,
        });
      }

      if (orderKind === "cancelledConfirmed") {
        const cost = resolveShopeeLineCost(
          costMap,
          orderLines[0],
          costBridge,
          debugCollector
        ).costRow;
        if (!cost) {
          unmatchedCancelled.push({
            orderId,
            productName: orderLines[0].product,
            skuPrincipal: orderLines[0].skuPrinciple || orderLines[0].sku,
            subtotal: orderGross,
          });
        }
      }
      continue;
    }

    // 2. Componentes financeiros de nível pedido (não multiplicar por item).
    const repasse = collapseOrderLevelValue(
      orderLines.map((line) => ({ present: line.repasseProvided, value: line.repasse }))
    );
    const transactionFee = collapseOrderLevelValue(
      orderLines.map((line) => ({
        present: line.transactionFeeProvided,
        value: Math.abs(line.transactionFee),
      }))
    );
    const commissionFee = collapseOrderLevelValue(
      orderLines.map((line) => {
        const resolved = resolveFeeComponent(
          line.commissionNet,
          line.commissionNetProvided,
          line.commissionGross,
          line.commissionGrossProvided
        );
        return { present: resolved.present, value: resolved.value };
      })
    );
    const serviceFee = collapseOrderLevelValue(
      orderLines.map((line) => {
        const resolved = resolveFeeComponent(
          line.serviceNet,
          line.serviceNetProvided,
          line.serviceGross,
          line.serviceGrossProvided
        );
        return { present: resolved.present, value: resolved.value };
      })
    );
    const shippingRaw = collapseOrderLevelValue(
      orderLines.map((line) => ({
        present: line.shippingProvided,
        value: line.shipping,
      }))
    );

    const feesSum = round2(
      transactionFee.value + commissionFee.value + serviceFee.value
    );

    let orderNet;
    let netSource;
    let shippingApplied = 0;

    if (repasse.present) {
      // Repasse já é líquido de taxas, frete, cupons e rebates. Os componentes
      // ficam informativos — descontar de novo seria contagem dupla.
      orderNet = round2(repasse.value);
      netSource = "repasse";
    } else if (transactionFee.present || commissionFee.present || serviceFee.present) {
      // Frete: só é deduzido quando o sinal na planilha indica custo do
      // vendedor (negativo). Valor positivo é ambíguo => não aplicado.
      if (shippingRaw.present) {
        if (shippingRaw.value < 0) {
          shippingApplied = Math.abs(shippingRaw.value);
        } else if (shippingRaw.value > 0) {
          shippingIndeterminateOrders += 1;
        }
      }
      orderNet = round2(orderGross - feesSum - shippingApplied);
      netSource = "componentes";
    } else {
      feesMissingOrders += 1;
      orderNet = round2(orderGross);
      netSource = "ausente";
    }

    if (shippingApplied > 0) {
      shippingFeesPresent = true;
      shippingFeesTotal = round2(shippingFeesTotal + shippingApplied);
    }
    marketplaceFeesTotal = round2(marketplaceFeesTotal + feesSum);

    // 3. Rateio dos componentes do pedido entre as linhas, por valor vendido.
    const allocationRows = orderLines.map((line) => ({
      units: line.quantity,
      productRevenue: line.grossRevenue,
    }));
    const netByLine = allocateByRevenue(orderNet, allocationRows);

    grossRevenueTotal = round2(grossRevenueTotal + orderGross);
    netRevenueTotal = round2(netRevenueTotal + orderNet);

    for (let i = 0; i < orderLines.length; i++) {
      const line = orderLines[i];
      const lineGross = round2(line.grossRevenue);
      const lineNet = netByLine[i];

      // CMV real da planilha tem prioridade; senão, base de custos (match
      // direto e, em MISS, ponte SKU -> ID da performance).
      const costMatch = resolveShopeeLineCost(costMap, line, costBridge, debugCollector);
      const costRow = costMatch.costRow;
      let cmvLine = null;
      let costSource = "ausente";

      if (costMatch.ambiguous) {
        bridgeAmbiguousCount += 1;
        if (bridgeAmbiguousKeys.length < 50 && !bridgeAmbiguousKeys.includes(costMatch.bridgeSku)) {
          bridgeAmbiguousKeys.push(costMatch.bridgeSku);
        }
      } else if (costMatch.bridgeUsed && !costRow) {
        bridgeMissCount += 1;
      }

      if (line.cmvProvided && Math.abs(line.cmv) > 0) {
        cmvLine = round2(Math.abs(line.cmv));
        costSource = "planilha_financeira";
      } else if (costRow && costRow.cost > 0) {
        cmvLine = round2(costRow.cost * line.quantity);
        if (costMatch.bridgeUsed) {
          costSource = "base_custos_ponte";
          bridgeCostMatchCount += 1;
          revenueBridgeMatched = round2(revenueBridgeMatched + lineGross);
        } else {
          costSource = "base_custos";
          directCostMatchCount += 1;
          revenueDirectMatched = round2(revenueDirectMatched + lineGross);
        }
      } else if (costRow) {
        // Linha existe na base, mas com custo <= 0: continua "sem custo"
        // (regra de sempre) — não vira CMV zero.
        zeroCostRowsCount += 1;
      }

      let taxLine = null;
      if (line.taxProvided && Math.abs(line.tax) > 0) {
        taxLine = round2(Math.abs(line.tax));
      } else if (costRow && costRow.taxPercent > 0) {
        taxLine = round2(lineGross * (costRow.taxPercent / 100));
      } else {
        taxLine = 0;
      }

      const hasCost = cmvLine !== null;
      const lc = hasCost ? round2(lineNet - cmvLine - taxLine) : null;
      const mc = lc === null ? null : safeRatio(lc, lineGross);

      if (hasCost) {
        revenueWithCost = round2(revenueWithCost + lineGross);
        contributionProfitTotal = round2(contributionProfitTotal + lc);
        cmvTotal = round2(cmvTotal + cmvLine);
        taxValueTotal = round2(taxValueTotal + taxLine);
      } else {
        revenueWithoutCost = round2(revenueWithoutCost + lineGross);
        ignoredRevenue = round2(ignoredRevenue + lineGross);
        unmatchedIdsSet.add(
          line.variationId || line.itemId || line.skuVariation || line.sku || orderId
        );
        const gap = describeShopeeCostGap(line, costMatch, orderId);
        const gapKey = `${gap.type}|${gap.value}|${gap.sku || ""}|${gap.reason}`;
        if (!unmatchedCostsMap.has(gapKey)) unmatchedCostsMap.set(gapKey, gap);
      }

      detailedRows.push({
        Marketplace: "Shopee",
        "ID do pedido": orderId,
        Produto: line.product,
        SKU: line.skuVariation || line.sku || line.skuPrinciple || "",
        Quantidade: line.quantity,
        "Receita bruta": lineGross,
        "Receita líquida": lineNet,
        "Origem da receita líquida": netSource,
        "Taxa de transação": round2(transactionFee.value),
        "Taxa de comissão": round2(commissionFee.value),
        "Taxa de serviço": round2(serviceFee.value),
        CMV: cmvLine,
        Imposto: taxLine,
        "Origem do custo": costSource,
        // direct_* | bridge_* | miss | ambiguous — diagnóstico da conciliação.
        "Match de custo": costMatch.source,
        "ID resolvido pela ponte": costMatch.matchedId || "",
        LC: lc,
        MC: mc === null ? null : round2(mc * 100),
        "Cobertura de custo": hasCost ? "com custo" : "sem custo",
        "Status do pedido": line.statusPedido,
      });
    }
  }

  const coverage = buildCoverage({ revenueWithCost, revenueWithoutCost });

  if (shippingIndeterminateOrders > 0) {
    missingColumns.push("Valor estimado do frete (sinal indeterminado)");
    executiveNotes.push(
      `Frete não aplicado em ${shippingIndeterminateOrders} pedido(s): a coluna "Valor estimado do frete" veio positiva e não é possível afirmar se é custo do vendedor. Componente marcado como ausente.`
    );
  }
  if (feesMissingOrders > 0) {
    missingColumns.push("Repasse / taxas financeiras");
    executiveNotes.push(
      `${feesMissingOrders} pedido(s) sem repasse e sem taxas: a receita líquida usou a receita bruta e o resultado desses pedidos está superestimado.`
    );
  }
  if (bridgeAvailable) {
    executiveNotes.push(
      "Ponte de identidade ativa: a planilha de performance forneceu apenas a relação SKU → ID do Item / ID da Variação. " +
      "Receita, taxas, frete, status e cancelamentos continuam vindo integralmente do Order.all."
    );
  }
  if (bridgeAmbiguousCount > 0) {
    executiveNotes.push(
      `COST_BRIDGE_AMBIGUOUS: ${bridgeAmbiguousCount} linha(s) tiveram o mesmo SKU apontando para variações com custos ` +
      `diferentes na base. O custo foi mantido em branco (nenhum custo é escolhido por arbitragem)` +
      `${bridgeAmbiguousKeys.length ? `. SKUs afetados: ${bridgeAmbiguousKeys.join(", ")}` : ""}.`
    );
  }
  if (coverage.financialConfidence !== "confiavel") {
    executiveNotes.push(
      "Fechamento parcial: existem vendas sem custo cadastrado. O faturamento total está completo; LC e MC cobrem apenas a receita com custo identificado."
    );
  }

  const recognizedRevenue = round2(revenueWithCost + revenueWithoutCost);
  const coveragePercent = (value) =>
    recognizedRevenue > 0 ? round2((value / recognizedRevenue) * 100) : 0;

  const finalResult = round2(contributionProfitTotal - ads - venforce - affiliates);

  return {
    summary: {
      calculationMode: "real_financial",
      engine: "shopee_financeiro",
      grossRevenueTotal,
      paidRevenueTotal: netRevenueTotal,
      revenueWithCost: coverage.revenueWithCost,
      revenueWithoutCost: coverage.revenueWithoutCost,
      calculatedCoveragePercent: coverage.calculatedCoveragePercent,
      financialConfidence: coverage.financialConfidence,
      contributionProfitTotal,
      averageContributionMargin: legacyRatio(contributionProfitTotal, revenueWithCost),
      contributionMarginCalculated: safeRatio(contributionProfitTotal, revenueWithCost),
      finalResult,
      finalMarginCalculated: safeRatio(finalResult, revenueWithCost),
      tacos: computeTacos(ads, grossRevenueTotal),
      tacox: computeTacox(ads, venforce, affiliates, grossRevenueTotal),
      // Cancelamentos, devoluções e não pagos — contados POR PEDIDO.
      cancelledCount: statusTotals.cancelledConfirmed.count,
      cancelledLostRevenue: statusTotals.cancelledConfirmed.revenue,
      returnRefundCount: statusTotals.returnOrRefund.count,
      returnRefundRevenue: statusTotals.returnOrRefund.revenue,
      unpaidCount: statusTotals.unpaid.count,
      unpaidLostRevenue: statusTotals.unpaid.revenue,
      refundsTotal: round2(-statusTotals.returnOrRefund.revenue),
      refundsCount: statusTotals.returnOrRefund.count,
      cancelledRevenue: statusTotals.cancelledConfirmed.revenue,
      cancellationsTotal: round2(-statusTotals.cancelledConfirmed.revenue),
      returnsTotal: round2(-statusTotals.returnOrRefund.revenue),
      lostRevenueTotal: statusTotals.cancelledConfirmed.revenue,
      // Componentes financeiros
      marketplaceFeesTotal: round2(-marketplaceFeesTotal),
      shippingFeesTotal: shippingFeesPresent ? round2(-shippingFeesTotal) : null,
      taxValueTotal: round2(-taxValueTotal),
      cmvTotal: round2(-cmvTotal),
      discountsBonusesTotal: null,
      platformAdjustmentTotal: 0,
      platformAdjustmentRowsCount: 0,
      adsTotal: round2(ads),
      venforceTotal: round2(venforce),
      affiliatesTotal: round2(affiliates),
      grossProfitTotal: contributionProfitTotal,
      grossMargin: legacyRatio(contributionProfitTotal, revenueWithCost),
      ordersTotalCount: orders.size,
      orderAllTotalCount: orders.size,
      orderAllTotalRevenue: round2(
        Object.values(statusTotals).reduce((sum, entry) => sum + entry.revenue, 0)
      ),
      orderAllCompletedCount: statusTotals.completed.count,
      orderAllCompletedRevenue: statusTotals.completed.revenue,
      orderAllDeliveredCount: statusTotals.delivered.count,
      orderAllDeliveredRevenue: statusTotals.delivered.revenue,
      orderAllShippedCount: statusTotals.shipped.count,
      orderAllShippedRevenue: statusTotals.shipped.revenue,
      orderAllIntermediateCount: statusTotals.intermediate.count,
      orderAllIntermediateRevenue: statusTotals.intermediate.revenue,
      orderAllCancelledConfirmedCount: statusTotals.cancelledConfirmed.count,
      orderAllCancelledConfirmedRevenue: statusTotals.cancelledConfirmed.revenue,
      orderAllReturnRefundCount: statusTotals.returnOrRefund.count,
      orderAllReturnRefundRevenue: statusTotals.returnOrRefund.revenue,
      orderAllUnpaidCount: statusTotals.unpaid.count,
      orderAllUnpaidRevenue: statusTotals.unpaid.revenue,
      orderAllTopCancelledItems: [],
      // Diagnóstico da conciliação de custo (aditivo — não substitui
      // revenueWithCost/calculatedCoveragePercent).
      costBridgeAvailable: bridgeAvailable,
      costBridgeSkuCount: bridgeAvailable ? costBridge.size : 0,
      directCostMatchCount,
      bridgeCostMatchCount,
      bridgeMissCount,
      bridgeAmbiguousCount,
      bridgeAmbiguousKeys,
      zeroCostRowsCount,
      directCoverage: coveragePercent(revenueDirectMatched),
      bridgeResolvedCoverage: coveragePercent(revenueBridgeMatched),
      // finalCoverage inclui também as linhas cujo CMV veio da própria
      // planilha financeira (coluna CMV), por isso pode ser maior que a soma
      // de directCoverage + bridgeResolvedCoverage.
      finalCoverage: coverage.calculatedCoveragePercent,
      detectedAdjustmentColumns: adjustmentColumns,
      missingColumns,
      executiveNotes,
    },
    detailedRows,
    auditRows,
    excelFileName: "fechamento-shopee.xlsx",
    // Mantido por compatibilidade — mistura SKU e ID sem dizer o tipo.
    unmatchedIds: Array.from(unmatchedIdsSet),
    // Diagnóstico tipado: { type, value, sku, reason } por pendência única.
    unmatchedCosts: Array.from(unmatchedCostsMap.values()),
    excludedVariationIds: [],
    ignoredRowsWithoutCost: unmatchedIdsSet.size,
    ignoredRevenue,
    unmatchedCancelled,
    message:
      unmatchedIdsSet.size > 0
        ? "Fechamento por dados financeiros. Alguns produtos não possuem custo cadastrado: o faturamento foi preservado e o lucro cobre apenas a receita com custo."
        : "Fechamento por dados financeiros concluído com sucesso.",
  };
}

module.exports = {
  isShopeeFinancialOrderSheet,
  parseShopeeFinancialRows,
  classifyShopeeOrderStatus,
  collapseOrderLevelValue,
  resolveFeeComponent,
  detectShopeeAdjustmentColumns,
  processShopeeFinancialOrders,
  SHOPEE_KINDS_OUT_OF_REVENUE,
  lookupShopeeCost,
  lookupShopeeCostDetailed,
  resolveShopeeLineCost,
  SHOPEE_COST_LOOKUP_FIELDS,
  SHOPEE_BRIDGE_SKU_FIELDS,
  SHOPEE_DIRECT_MATCH_SOURCE,
  isShopeeOrderAllTotalRow,
  describeShopeeCostGap,
};
