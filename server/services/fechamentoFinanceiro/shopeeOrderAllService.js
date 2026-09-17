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
    const variationName = String(
      findField(row, [
        "nome da variacao",
        "nome da variação",
        "opcao da variacao",
        "opção da variação",
        "variation name",
        "variation option",
      ]) || ""
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
      variationName,
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

  // Model ID / ID da Variação presente no próprio Order.all é uma
  // identidade autoritativa. Se a base não contiver esse ID, não é seguro
  // degradar para item pai ou SKU, que podem representar outra variação.
  const authoritativeFields = ["variationId", "modelId"].filter((field) =>
    normalizeMatchKey(line[field])
  );
  const lookupFields = authoritativeFields.length > 0
    ? authoritativeFields
    : SHOPEE_COST_LOOKUP_FIELDS;

  for (const field of lookupFields) {
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

  return {
    row: null,
    field: null,
    authoritativeField: authoritativeFields[0] || null,
  };
}

function lookupShopeeCost(costMap, line, debugCollector) {
  return lookupShopeeCostDetailed(costMap, line, debugCollector).row;
}

const SHOPEE_IDENTITY_PLACEHOLDERS = new Set(["", "-", "--", "–", "n/a", "na", "0"]);

function normalizeShopeeIdentityText(value) {
  const normalized = normalizeKey(value);
  return SHOPEE_IDENTITY_PLACEHOLDERS.has(normalized) ? "" : normalized;
}

function bridgeRecordIdentity(record) {
  const modelId = normalizeShopeeId(record?.modelId || record?.variationId);
  if (modelId) return `model:${modelId}`;
  const itemId = normalizeShopeeId(record?.itemId);
  return itemId ? `item:${itemId}` : "";
}

function uniqueBridgeRecords(records) {
  const list = Array.isArray(records) ? records : [];
  // A Performance traz uma linha agregada do item pai e, logo abaixo, suas
  // variações. Quando há Model ID para o mesmo item, a linha pai não é uma
  // segunda identidade candidata.
  const itemIdsWithModels = new Set(
    list
      .filter((record) => normalizeShopeeId(record?.modelId || record?.variationId))
      .map((record) => normalizeShopeeId(record?.itemId))
      .filter(Boolean)
  );
  const unique = new Map();
  for (const record of list) {
    const modelId = normalizeShopeeId(record?.modelId || record?.variationId);
    const itemId = normalizeShopeeId(record?.itemId);
    if (!modelId && itemId && itemIdsWithModels.has(itemId)) continue;
    const key = bridgeRecordIdentity(record);
    if (key && !unique.has(key)) unique.set(key, record);
  }
  return Array.from(unique.values());
}

function getShopeeCostBridgeRecords(costBridge) {
  if (!costBridge || typeof costBridge.get !== "function") return [];
  if (Array.isArray(costBridge.records)) return costBridge.records;

  // Compatibilidade defensiva com pontes antigas/manuais no formato
  // Map<SKU, { variationIds, itemIds }>.
  const records = [];
  for (const [sku, entry] of costBridge.entries()) {
    for (const modelId of Array.isArray(entry?.variationIds) ? entry.variationIds : []) {
      records.push({ modelId, variationId: modelId, itemId: "", productName: "", variationName: "", variationSkus: [sku], principalSkus: [] });
    }
    for (const itemId of Array.isArray(entry?.itemIds) ? entry.itemIds : []) {
      records.push({ modelId: "", variationId: "", itemId, productName: "", variationName: "", variationSkus: [sku], principalSkus: [] });
    }
  }
  return records;
}

function getShopeeCostBridgeIndex(costBridge, type) {
  if (!costBridge || typeof costBridge.get !== "function") return null;
  if (type === "variation") {
    return costBridge.variationSkuIndex instanceof Map
      ? costBridge.variationSkuIndex
      : costBridge;
  }
  return costBridge.principalSkuIndex instanceof Map
    ? costBridge.principalSkuIndex
    : null;
}

function hasShopeeCostBridge(costBridge) {
  const principalIndex = getShopeeCostBridgeIndex(costBridge, "principal");
  return (
    !!costBridge &&
    typeof costBridge.get === "function" &&
    (
      costBridge.size > 0 ||
      (principalIndex && principalIndex.size > 0) ||
      getShopeeCostBridgeRecords(costBridge).length > 0
    )
  );
}

function bridgeIdsFromRecords(records) {
  const variationIds = [];
  const itemIds = [];
  for (const record of uniqueBridgeRecords(records)) {
    const modelId = normalizeShopeeId(record.modelId || record.variationId);
    const itemId = normalizeShopeeId(record.itemId);
    if (modelId && !variationIds.includes(modelId)) variationIds.push(modelId);
    if (itemId && !itemIds.includes(itemId)) itemIds.push(itemId);
  }
  return { variationIds, itemIds };
}

function bridgeCandidateIds(records) {
  const ids = bridgeIdsFromRecords(records);
  return ids.variationIds.length > 0 ? ids.variationIds : ids.itemIds;
}

function resolveEquivalentShopeeBridgeCost(costMap, records) {
  const candidateIds = bridgeCandidateIds(records);
  if (candidateIds.length < 2 || !costMap || typeof costMap.get !== "function") {
    return null;
  }

  const costRows = candidateIds.map((id) => costMap.get(normalizeMatchKey(id)) || null);
  // Se qualquer identidade candidata não existir na base, o resultado
  // financeiro dela é desconhecido e não há equivalência segura.
  if (costRows.some((row) => !row)) return null;

  const first = costRows[0];
  const equivalent = costRows.every(
    (row) =>
      round2(Number(row.cost || 0)) === round2(Number(first.cost || 0)) &&
      round2(Number(row.taxPercent || 0)) === round2(Number(first.taxPercent || 0))
  );
  return equivalent ? { costRow: first, candidateIds } : null;
}

function selectShopeeIdentityFromRecords(rawRecords, line, source, bridgeSku) {
  const records = uniqueBridgeRecords(rawRecords);
  if (records.length === 0) return null;
  const productKey = normalizeShopeeIdentityText(line.product);
  const variationKey = normalizeShopeeIdentityText(line.variationName);
  const recordProduct = (record) => normalizeShopeeIdentityText(record.productName);
  const recordVariation = (record) => normalizeShopeeIdentityText(record.variationName);
  const ambiguityKey = line.product && line.variationName
    ? `${line.product} / ${line.variationName}`
    : bridgeSku || line.product;

  if (records.length === 1) {
    return { ambiguous: false, record: records[0], records, source, bridgeSku, ambiguityKey };
  }

  // O mesmo SKU da Variação pode existir em anúncios diferentes. Nessa
  // situação, somente os campos exatos compartilhados pelas duas planilhas
  // podem reduzir os candidatos.
  let narrowed = records;
  if (productKey) {
    const byProduct = narrowed.filter((record) => recordProduct(record) === productKey);
    if (byProduct.length === 0) {
      return { ambiguous: true, record: null, records, source, bridgeSku, ambiguityKey };
    }
    narrowed = byProduct;
  }
  if (variationKey) {
    const byVariation = narrowed.filter((record) => recordVariation(record) === variationKey);
    if (byVariation.length === 0) {
      return { ambiguous: true, record: null, records, source, bridgeSku, ambiguityKey };
    }
    narrowed = byVariation;
  }

  narrowed = uniqueBridgeRecords(narrowed);
  if (narrowed.length === 1) {
    return { ambiguous: false, record: narrowed[0], records: narrowed, source, bridgeSku, ambiguityKey };
  }
  return { ambiguous: true, record: null, records: narrowed, source, bridgeSku, ambiguityKey };
}

// Palavras de conexão que não identificam o produto — filtradas antes do
// token overlap do último fallback para não inflar nem distorcer o score.
const SHOPEE_TITLE_STOPWORDS = new Set([
  "de", "da", "do", "das", "dos", "e", "com", "para", "em", "no", "na", "a", "o", "os", "as",
]);

function normalizeShopeeTitleTokens(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return [];
  const tokens = normalized
    .split(" ")
    .filter((token) => token && !SHOPEE_TITLE_STOPWORDS.has(token));
  return Array.from(new Set(tokens));
}

// Evidência de que dois títulos descrevem o mesmo produto reordenado/editado:
// proporção dos tokens do título menor presentes no outro. É só um insumo do
// corte de segurança em selectShopeeBridgeIdentityByTitleVariation — nunca a
// verdade financeira, e nunca exposto como afirmação de identidade sozinho.
function shopeeTitleOverlapScore(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const token of tokensA) {
    if (setB.has(token)) intersection += 1;
  }
  return intersection / Math.min(tokensA.length, tokensB.length);
}

// Corte conservador: exige que a maioria expressiva dos tokens do título
// menor apareça no outro título. Candidatos empatados nesse corte NUNCA são
// resolvidos por "o primeiro" — ver o tratamento de empate abaixo.
const SHOPEE_TITLE_OVERLAP_THRESHOLD = 0.6;

// Último fallback da ponte, só tentado quando SKU e produto+variação exatos
// (as estratégias acima) não resolveram nada:
//   1. exige VARIAÇÃO EXATA normalizada — nunca cruza "Preto,G" com "Preto,GG";
//   2. só compara título ENTRE os candidatos dessa mesma variação exata;
//   3. um candidato claramente seguro (único no topo do corte) -> resolve;
//   4. mais de um candidato empatado no topo -> quem decide é a equivalência
//      financeira (custo + imposto iguais) já usada pela ponte; sem isso, é
//      AMBIGUOUS e o item permanece sem custo.
function selectShopeeBridgeIdentityByTitleVariation(line, allRecords) {
  const variationKey = normalizeShopeeIdentityText(line.variationName);
  if (!variationKey) return null;

  const productTokens = normalizeShopeeTitleTokens(line.product);
  if (productTokens.length === 0) return null;

  const sameVariation = uniqueBridgeRecords(
    allRecords.filter(
      (record) => normalizeShopeeIdentityText(record.variationName) === variationKey
    )
  );
  if (sameVariation.length === 0) return null;

  const scored = sameVariation.map((record) => ({
    record,
    score: shopeeTitleOverlapScore(
      productTokens,
      normalizeShopeeTitleTokens(record.productName)
    ),
  }));

  const passing = scored.filter((entry) => entry.score >= SHOPEE_TITLE_OVERLAP_THRESHOLD);
  if (passing.length === 0) return null;

  const maxScore = Math.max(...passing.map((entry) => entry.score));
  const topRecords = uniqueBridgeRecords(
    passing.filter((entry) => entry.score === maxScore).map((entry) => entry.record)
  );
  const ambiguityKey = `${line.product} / ${line.variationName}`;

  if (topRecords.length === 1) {
    return {
      ambiguous: false,
      record: topRecords[0],
      records: topRecords,
      source: "title_variation",
      bridgeSku: null,
      ambiguityKey,
      titleScore: maxScore,
    };
  }

  return {
    ambiguous: true,
    record: null,
    records: topRecords,
    source: "title_variation",
    bridgeSku: null,
    ambiguityKey,
    titleScore: maxScore,
  };
}

// FIN-24 — segunda classe de falha da ponte de identidade: além do TÍTULO
// mudar/reordenar (FIN-21), a NOTAÇÃO da variação também muda entre as
// planilhas. Ex.: Order.all traz "Pink,G" (produto já é "... 2 Blusas ...
// Kit") e a Performance traz a mesma peça como "2 Pink,G" — o kit é o
// mesmo, só a forma de escrever a quantidade mudou.
//
// A decomposição abaixo NUNCA normaliza a variação "às cegas": ela separa
// uma quantidade EXPLÍCITA (um número isolado no início de um segmento, ou
// a soma de uma combinação "N cor + M cor") dos atributos restantes. Só a
// quantidade é removida da comparação — os atributos (cor/tamanho/etc)
// continuam exigindo igualdade exata após a normalização de acentos/caixa
// já usada no restante do arquivo.
function decomposeShopeeVariationAttributes(variationName) {
  const raw = String(variationName || "").trim();
  if (!raw) return { quantityHint: null, attributes: [] };

  const normalized = normalizeText(raw).replace(/\s*\+\s*/g, " + ");
  const segments = normalized.split(",").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return { quantityHint: null, attributes: [] };

  let quantityHint = null;
  const attributes = [];

  for (const segment of segments) {
    // "1 pink + 1 preta" — combinação de DUAS cores distintas no mesmo kit.
    // A quantidade é a soma, mas os atributos permanecem os dois valores
    // (nunca colapsam num só, para não confundir combo com cor única).
    const combo = segment.match(/^(\d{1,2})\s+(.+?)\s*\+\s*(\d{1,2})\s+(.+)$/);
    if (combo) {
      const qty = Number(combo[1]) + Number(combo[3]);
      if (quantityHint === null) quantityHint = qty;
      attributes.push(`${combo[2].trim()}+${combo[4].trim()}`);
      continue;
    }

    // "2 pink" — quantidade isolada no início do segmento.
    const simple = segment.match(/^(\d{1,2})\s+(.+)$/);
    if (simple) {
      if (quantityHint === null) quantityHint = Number(simple[1]);
      attributes.push(simple[2].trim());
      continue;
    }

    attributes.push(segment);
  }

  return { quantityHint, attributes };
}

function shopeeVariationAttributesKey(attributes) {
  return attributes.slice().sort().join("|");
}

// Extrai packSize (quantas peças o anúncio representa) do TÍTULO, só em
// padrões inequívocos ("kit N", "kit de N", "N blusas/regatas/..." no
// início do título). NUNCA interpreta número de REF, tamanho (P/M/G/GG) ou
// qualquer outro dígito solto — se o padrão não é claramente uma contagem
// de peças/kit, retorna null (sem inventar).
const SHOPEE_PACK_NOUNS =
  "blusas?|regatas?|camisetas?|camisas?|calcinhas?|cuecas?|pecas?|unidades?|conjuntos?|shorts?|vestidos?";

function extractShopeePackSizeFromTitle(title) {
  const normalized = normalizeText(title);
  if (!normalized) return null;

  const kitMatch = normalized.match(/\bkit\s*(?:de\s*|com\s*)?(\d{1,2})\b/);
  if (kitMatch) return Number(kitMatch[1]);

  const leadingMatch = normalized.match(
    new RegExp(`^(\\d{1,2})\\s+(?:${SHOPEE_PACK_NOUNS})\\b`)
  );
  if (leadingMatch) return Number(leadingMatch[1]);

  return null;
}

// Último recurso da ponte de título/variação, só tentado quando NEM o
// SKU/produto+variação exatos NEM o fallback do FIN-21 (variação exata +
// título) resolveram nada. Aqui a variação em si também pode ter mudado de
// notação — por isso o corte de segurança é mais rígido que o do FIN-21:
//   1. atributos da variação (sem a quantidade) têm que ser EXATAMENTE
//      iguais — nunca normalização de plural/gênero ("Preto" != "Pretas");
//   2. produto do Order.all e da Performance continuam exigindo o mesmo
//      corte de título do FIN-21 (SHOPEE_TITLE_OVERLAP_THRESHOLD);
//   3. quando os dois lados têm evidência de quantidade/kit (da própria
//      variação ou do título), ela NÃO pode divergir — um candidato sem
//      nenhuma marca de kit é tratado como unidade (packSize 1), o que
//      bloqueia um produto unitário de ser escolhido para um kit;
//   4. candidato único no topo do corte -> resolve; empate -> equivalência
//      financeira (custo+imposto iguais) ou AMBIGUOUS, igual ao FIN-21.
function selectShopeeBridgeIdentityByTitleVariationAlias(line, allRecords) {
  const lineDecomp = decomposeShopeeVariationAttributes(line.variationName);
  if (lineDecomp.attributes.length === 0) return null;
  const lineAttrKey = shopeeVariationAttributesKey(lineDecomp.attributes);

  const productTokens = normalizeShopeeTitleTokens(line.product);
  if (productTokens.length === 0) return null;

  const lineTitlePack = extractShopeePackSizeFromTitle(line.product);
  const lineEffectivePack =
    lineDecomp.quantityHint !== null ? lineDecomp.quantityHint : lineTitlePack;

  const scored = [];
  for (const record of allRecords) {
    const recordDecomp = decomposeShopeeVariationAttributes(record.variationName);
    if (recordDecomp.attributes.length === 0) continue;
    if (shopeeVariationAttributesKey(recordDecomp.attributes) !== lineAttrKey) continue;

    // Sem nenhuma evidência de kit (nem na variação, nem no título), o
    // candidato é tratado como peça UNITÁRIA — packSize 1. É essa regra que
    // impede um produto unitário de "Pink,G" vencer para um pedido de kit.
    const recordTitlePack = extractShopeePackSizeFromTitle(record.productName);
    const recordEffectivePack =
      recordDecomp.quantityHint !== null
        ? recordDecomp.quantityHint
        : recordTitlePack !== null
        ? recordTitlePack
        : 1;

    if (
      lineEffectivePack !== null &&
      recordEffectivePack !== null &&
      lineEffectivePack !== recordEffectivePack
    ) {
      continue;
    }

    const score = shopeeTitleOverlapScore(
      productTokens,
      normalizeShopeeTitleTokens(record.productName)
    );
    if (score < SHOPEE_TITLE_OVERLAP_THRESHOLD) continue;

    scored.push({ record, score });
  }

  if (scored.length === 0) return null;

  const maxScore = Math.max(...scored.map((entry) => entry.score));
  const topRecords = uniqueBridgeRecords(
    scored.filter((entry) => entry.score === maxScore).map((entry) => entry.record)
  );
  const ambiguityKey = `${line.product} / ${line.variationName}`;

  if (topRecords.length === 1) {
    return {
      ambiguous: false,
      record: topRecords[0],
      records: topRecords,
      source: "title_variation_alias",
      bridgeSku: null,
      ambiguityKey,
      titleScore: maxScore,
    };
  }

  return {
    ambiguous: true,
    record: null,
    records: topRecords,
    source: "title_variation_alias",
    bridgeSku: null,
    ambiguityKey,
    titleScore: maxScore,
  };
}

// ── Identidade histórica por CONJUNTO de tokens do SKU ──────────────────────
//
// FIN-21/FIN-24 resolvem o caso "o título/a variação mudou, mas o SKU é o
// mesmo". O caso CARMINA mostrou a classe complementar: "o SKU mudou de
// FORMATO, mas continua descrevendo o mesmo produto" — separadores
// diferentes ("/" virou "+"), ordem diferente, palavra repetida removida, ou
// uma palavra abreviada/truncada — em produtos que muitas vezes NÃO têm
// variação (Nome da Variação vazio/"-"), onde o fallback de título+variação
// acima nem chega a ser tentado.
//
// Tokenização é só um GERADOR DE CANDIDATOS: qualquer caractere não
// alfanumérico (/, +, -, espaço, ...) é um separador equivalente. O
// resultado nunca decide sozinho — passa pela mesma narrowing por
// produto/variação, ambiguidade e equivalência financeira que as demais
// estratégias já usam (selectShopeeIdentityFromRecords).
function tokenizeShopeeSkuText(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return [];
  return normalized
    .split(" ")
    .filter(Boolean)
    .map((token) => token.toUpperCase());
}

// Chave estável de um CONJUNTO de tokens (duplicatas colapsam, ordem não
// importa) — usada tanto para indexar a ponte quanto para consultar.
function shopeeSkuTokenSetKey(tokens) {
  if (!tokens.length) return "";
  return Array.from(new Set(tokens)).sort().join("|");
}

// Compatibilidade "quase exata" entre dois conjuntos de tokens: mesma
// contagem, e no MÁXIMO um par divergente — esse par só é aceito quando é
// claramente um truncamento (um token é prefixo do outro, ambos com pelo
// menos 4 caracteres e diferença de até 2 caracteres, ex.: BRANC/BRANCO).
// Dois ou mais tokens divergentes nunca são aceitos: entra em ambíguo/miss,
// nunca em "o mais parecido".
function shopeeSkuTokensFuzzyCompatible(tokensA, tokensB) {
  if (tokensA.length < 3 || tokensB.length < 3) return false;
  if (tokensA.length !== tokensB.length) return false;

  const remainingB = [...tokensB];
  const leftoverA = [];
  for (const token of tokensA) {
    const idx = remainingB.indexOf(token);
    if (idx >= 0) {
      remainingB.splice(idx, 1);
    } else {
      leftoverA.push(token);
    }
  }

  if (leftoverA.length !== 1 || remainingB.length !== 1) return false;

  const [a] = leftoverA;
  const [b] = remainingB;
  if (a.length < 4 || b.length < 4) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function getShopeeCostBridgeTokenIndex(costBridge, type) {
  if (!costBridge) return null;
  if (type === "variation") {
    return costBridge.variationSkuTokenIndex instanceof Map
      ? costBridge.variationSkuTokenIndex
      : null;
  }
  return costBridge.principalSkuTokenIndex instanceof Map
    ? costBridge.principalSkuTokenIndex
    : null;
}

// Tokens de cada valor não vazio/não placeholder dos campos indicados, na
// ordem de prioridade de sempre, deduplicados por conjunto de tokens.
function lineSkuTokenCandidates(line, fields) {
  const seen = new Set();
  const out = [];
  for (const field of fields) {
    const raw = line[field];
    if (!raw) continue;
    const tokens = tokenizeShopeeSkuText(raw);
    if (tokens.length < 2) continue;
    const key = shopeeSkuTokenSetKey(tokens);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ raw, tokens, key });
  }
  return out;
}

// Estágio adicional entre o fallback de sufixo histórico e produto+variação:
// identidade por CONJUNTO EXATO de tokens do SKU. Separadores, ordem e
// palavras repetidas não importam — mas o conjunto tem que ser IDÊNTICO.
// Resolve, por exemplo, "FB+FR+KAIAK-BRANC+MLBC" (Order.all) == "FB+FR+KAIAK
// BRANC+MLBC" (Performance): mesma composição, formatação diferente. É tão
// seguro quanto o match de SKU exato de sempre — só tolera a formatação.
function selectShopeeBridgeIdentityBySkuTokenSet(line, costBridge) {
  const variationTokenIndex = getShopeeCostBridgeTokenIndex(costBridge, "variation");
  const principalTokenIndex = getShopeeCostBridgeTokenIndex(costBridge, "principal");

  const variationFields = costBridge.variationSkuIndex instanceof Map
    ? ["skuRefNumber", "skuVariation", "sku"]
    : SHOPEE_BRIDGE_SKU_FIELDS;

  if (variationTokenIndex) {
    for (const { key, raw } of lineSkuTokenCandidates(line, variationFields)) {
      const entry = variationTokenIndex.get(key);
      if (!entry) continue;
      return selectShopeeIdentityFromRecords(entry.records, line, "sku_token_set", raw);
    }
  }

  if (principalTokenIndex) {
    for (const { key, raw } of lineSkuTokenCandidates(line, ["skuMainRef", "skuPrinciple"])) {
      const entry = principalTokenIndex.get(key);
      if (!entry) continue;
      return selectShopeeIdentityFromRecords(entry.records, line, "sku_token_set", raw);
    }
  }

  return null;
}

// Último recurso da ponte (depois de título+variação): tolera exatamente UM
// token truncado/abreviado quando todos os demais tokens do SKU batem
// exatamente. Cobre o caso dominante do CARMINA ("KAIAK BRANCO" -> "KAIAK
// BRANC") em produtos sem variação, onde o fallback de título não se aplica
// (variação vazia). Nunca decide sozinho quando há mais de um candidato
// divergente compatível — cai em ambíguo/equivalência financeira como as
// demais estratégias.
function selectShopeeBridgeIdentityBySkuTokenFuzzy(line, costBridge) {
  const variationTokenIndex = getShopeeCostBridgeTokenIndex(costBridge, "variation");
  const principalTokenIndex = getShopeeCostBridgeTokenIndex(costBridge, "principal");

  const allFields = Array.from(
    new Set([...SHOPEE_BRIDGE_SKU_FIELDS, "skuMainRef"])
  );
  const lineCandidates = lineSkuTokenCandidates(line, allFields);
  if (!lineCandidates.length) return null;

  for (const index of [variationTokenIndex, principalTokenIndex]) {
    if (!(index instanceof Map)) continue;
    for (const { tokens, raw } of lineCandidates) {
      const matchedRecords = [];
      for (const entry of index.values()) {
        if (shopeeSkuTokensFuzzyCompatible(tokens, entry.tokens)) {
          matchedRecords.push(...entry.records);
        }
      }
      if (matchedRecords.length > 0) {
        return selectShopeeIdentityFromRecords(matchedRecords, line, "sku_token_fuzzy", raw);
      }
    }
  }

  return null;
}

// Ordem estrita da ponte:
//   1. Número de referência SKU -> índice SKU da Variação;
//   2. sufixo histórico controlado (-V / -0);
//   3. conjunto exato de tokens do SKU (formatação mudou, composição não);
//   4. produto + variação exatos (preserva identidade quando o SKU mudou);
//   5. SKU principal, em índice separado e somente se for inequívoco;
//   6. variação exata + evidência de título (FIN-21);
//   7. atributos da variação (sem quantidade) + título + pack compatível
//      (FIN-24, só tentado quando o item 6 não resolveu nada);
//   8. conjunto de tokens do SKU com UM token truncado (último recurso).
function selectShopeeBridgeIdentity(line, costBridge) {
  const allRecords = getShopeeCostBridgeRecords(costBridge);
  if (allRecords.length === 0) return null;

  const variationIndex = getShopeeCostBridgeIndex(costBridge, "variation");
  const principalIndex = getShopeeCostBridgeIndex(costBridge, "principal");
  const uniqueSkus = (fields) => fields
    .map((field) => normalizeShopeeId(line[field]))
    .filter((sku, index, all) => sku && all.indexOf(sku) === index);

  // Em pontes novas, somente campos de SKU de VARIAÇÃO consultam este índice.
  // A lista ampla fica restrita ao formato legado/manual, que não tem índices.
  const variationFields = costBridge.variationSkuIndex instanceof Map
    ? ["skuRefNumber", "skuVariation", "sku"]
    : SHOPEE_BRIDGE_SKU_FIELDS;
  for (const sku of uniqueSkus(variationFields)) {
    const entry = variationIndex && variationIndex.get(sku);
    if (!entry) continue;
    return selectShopeeIdentityFromRecords(entry.records, line, "variation_sku", sku);
  }

  // Fallback controlado para SKU histórico. Somente os sufixos explicitamente
  // conhecidos são adicionados/removidos; nenhuma outra normalização ocorre.
  const historicalSuffixes = ["-V", "-0"];
  const historicalRecords = [];
  const historicalMatches = [];
  for (const sku of uniqueSkus(variationFields)) {
    const candidateSkus = [];
    for (const suffix of historicalSuffixes) {
      candidateSkus.push(`${sku}${suffix}`);
      if (sku.endsWith(suffix) && sku.length > suffix.length) {
        candidateSkus.push(sku.slice(0, -suffix.length));
      }
    }
    for (const candidateSku of candidateSkus) {
      if (historicalMatches.includes(candidateSku)) continue;
      const entry = variationIndex && variationIndex.get(candidateSku);
      if (!entry) continue;
      historicalMatches.push(candidateSku);
      historicalRecords.push(...entry.records);
    }
  }
  if (historicalRecords.length > 0) {
    return selectShopeeIdentityFromRecords(
      historicalRecords,
      line,
      "historical_variation_sku",
      historicalMatches.join(" | ")
    );
  }

  const tokenSetIdentity = selectShopeeBridgeIdentityBySkuTokenSet(line, costBridge);
  if (tokenSetIdentity) return tokenSetIdentity;

  const productKey = normalizeShopeeIdentityText(line.product);
  const variationKey = normalizeShopeeIdentityText(line.variationName);
  if (productKey && variationKey) {
    const exact = allRecords.filter(
      (record) =>
        normalizeShopeeIdentityText(record.productName) === productKey &&
        normalizeShopeeIdentityText(record.variationName) === variationKey
    );
    const selected = selectShopeeIdentityFromRecords(
      exact,
      line,
      "product_variation",
      uniqueSkus(variationFields)[0] || null
    );
    if (selected) return selected;
  }

  for (const sku of uniqueSkus(["skuMainRef", "skuPrinciple"])) {
    const entry = principalIndex && principalIndex.get(sku);
    if (!entry) continue;
    return selectShopeeIdentityFromRecords(entry.records, line, "principal_sku", sku);
  }

  const titleVariationIdentity = selectShopeeBridgeIdentityByTitleVariation(line, allRecords);
  if (titleVariationIdentity) return titleVariationIdentity;

  const titleVariationAliasIdentity = selectShopeeBridgeIdentityByTitleVariationAlias(
    line,
    allRecords
  );
  if (titleVariationAliasIdentity) return titleVariationAliasIdentity;

  return selectShopeeBridgeIdentityBySkuTokenFuzzy(line, costBridge);
}

// ── Equivalência financeira POR ITEM ────────────────────────────────────────
//
// Último recurso de todos, só tentado quando NENHUMA estratégia de
// identidade acima resolveu Model ID/variação nenhum. Diferente de todas as
// outras, esta função NUNCA afirma qual variação foi vendida — ela resolve
// só o RESULTADO FINANCEIRO, quando ele é o mesmo não importa qual variação
// do item tenha sido: o ITEM da Performance é identificado de forma segura
// e única pelo título, mas TODOS os seus Model IDs custam e tributam
// exatamente igual, então a variação exata deixa de ser financeiramente
// relevante.
//
// Guardas (TODAS obrigatórias — qualquer uma falhando, não resolve):
//   1. o item da Performance precisa ser identificado de forma inequívoca
//      (título acima do corte de sempre, SHOPEE_TITLE_OVERLAP_THRESHOLD);
//   2. produto/título/pack não podem estar em conflito (mesma checagem de
//      pack usada no fallback de alias — nunca cruza Kit 2 com Kit 4);
//   3. só UM item pode estar no topo do corte — empate entre ITENS
//      diferentes nunca resolve (itens diferentes podem ter preços
//      diferentes; empate entre VARIAÇÕES do MESMO item é o caso que esta
//      função existe para cobrir);
//   4. usa o conjunto COMPLETO de Model IDs/variações desse item
//      (uniqueBridgeRecords — nunca um subconjunto escolhido a dedo);
//   5-7. TODOS os candidatos desse conjunto precisam existir na base de
//      custos, com costValid !== false e custo > 0 — um único ausente ou
//      inválido (#N/A, vazio, <=0) derruba a equivalência inteira;
//   8-9. TODOS precisam ter EXATAMENTE o mesmo custo e o mesmo taxPercent
//      (arredondado a 2 casas, igual ao resto do arquivo) — um único
//      divergente derruba a equivalência inteira;
//   10. nunca depende de ordem: usa Math.max/every sobre o conjunto
//      completo, nunca a primeira ou última entrada iterada.
//
// Nunca atribui um Model ID (nunca "candidates[0]") e nunca normaliza
// vocabulário de variação (sem "Preto"="Pretas", sem "Multicolorido"=combo
// nenhum) — a causa que este resolvedor ataca é financeira, não linguística.
function selectShopeeBridgeItemFinancialEquivalence(line, costBridge, costMap) {
  if (!costMap || typeof costMap.get !== "function") return null;

  const allRecords = getShopeeCostBridgeRecords(costBridge);
  if (allRecords.length === 0) return null;

  const productTokens = normalizeShopeeTitleTokens(line.product);
  if (productTokens.length === 0) return null;

  const byItem = new Map();
  for (const record of allRecords) {
    const itemId = normalizeShopeeId(record.itemId);
    if (!itemId) continue;
    if (!byItem.has(itemId)) byItem.set(itemId, []);
    byItem.get(itemId).push(record);
  }
  if (byItem.size === 0) return null;

  const lineTitlePack = extractShopeePackSizeFromTitle(line.product);
  const lineVariationDecomp = decomposeShopeeVariationAttributes(line.variationName);
  const lineEffectivePack =
    lineVariationDecomp.quantityHint !== null ? lineVariationDecomp.quantityHint : lineTitlePack;

  const scoredItems = [];
  for (const [itemId, records] of byItem.entries()) {
    const productName = records[0].productName;
    const score = shopeeTitleOverlapScore(
      productTokens,
      normalizeShopeeTitleTokens(productName)
    );
    if (score < SHOPEE_TITLE_OVERLAP_THRESHOLD) continue;

    const itemTitlePack = extractShopeePackSizeFromTitle(productName);
    if (
      lineEffectivePack !== null &&
      itemTitlePack !== null &&
      lineEffectivePack !== itemTitlePack
    ) {
      continue;
    }

    scoredItems.push({ itemId, records, score });
  }

  if (scoredItems.length === 0) return null;

  const maxScore = Math.max(...scoredItems.map((entry) => entry.score));
  const topItems = scoredItems.filter((entry) => entry.score === maxScore);
  if (topItems.length !== 1) return null;

  const { itemId, records } = topItems[0];
  const uniqueRecords = uniqueBridgeRecords(records);
  // Com um candidato SÓ, não há "variação indeterminada" — há uma variação
  // específica que as estratégias de atributo/título acima já viram e
  // recusaram. Essa função nunca serve de segunda chance para esse caso:
  // ela só existe para quando o item tem MÚLTIPLAS variações e nenhuma
  // pôde ser escolhida entre elas.
  if (uniqueRecords.length < 2) return null;

  const costRows = [];
  for (const record of uniqueRecords) {
    const modelId = normalizeShopeeId(record.modelId || record.variationId);
    const recordItemId = normalizeShopeeId(record.itemId);
    const matchedId = modelId || recordItemId;
    if (!matchedId) return null;
    const costRow = costMap.get(normalizeMatchKey(matchedId)) || null;
    if (!costRow || costRow.costValid === false || !(Number(costRow.cost) > 0)) {
      return null;
    }
    costRows.push(costRow);
  }

  const first = costRows[0];
  const firstCost = round2(Number(first.cost || 0));
  const firstTax = round2(Number(first.taxPercent || 0));
  const allEqual = costRows.every(
    (row) =>
      round2(Number(row.cost || 0)) === firstCost &&
      round2(Number(row.taxPercent || 0)) === firstTax
  );
  if (!allEqual) return null;

  return {
    ambiguous: false,
    record: null,
    records: uniqueRecords,
    source: "item_financial_equivalent",
    bridgeSku: null,
    ambiguityKey: `${line.product} / ${line.variationName}`,
    itemId,
    costRow: first,
  };
}

// Conciliação de custo de UMA linha do Order.all.
//
//   1. match DIRETO (comportamento de sempre, prioridade intacta);
//   2. em MISS, e só então, a ponte de identidade da planilha de performance:
//      produto + variação (preferencial) / SKU auxiliar -> Model ID exato -> base.
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

  if (direct.authoritativeField) {
    return {
      costRow: null,
      source: "miss",
      matchedValue: line[direct.authoritativeField],
      bridgeUsed: false,
      bridgeIds: null,
      ambiguous: false,
    };
  }

  const hasBridge = hasShopeeCostBridge(costBridge);
  if (!hasBridge || !costMap || typeof costMap.get !== "function") {
    return { costRow: null, source: "miss", bridgeUsed: false, bridgeIds: null, ambiguous: false };
  }

  const skuTried = SHOPEE_BRIDGE_SKU_FIELDS
    .map((field) => normalizeShopeeId(line[field]))
    .find(Boolean) || null;
  const identity = selectShopeeBridgeIdentity(line, costBridge);

  if (!identity) {
    const itemEquivalence = selectShopeeBridgeItemFinancialEquivalence(line, costBridge, costMap);
    if (itemEquivalence) {
      const bridgeIds = bridgeIdsFromRecords(itemEquivalence.records);
      if (debugCollector) {
        debugCollector.recordMatchAttempt({
          engine: "shopee_real",
          stage: "cost_bridge_identity",
          orderId: line.id,
          field: itemEquivalence.source,
          rawValue: [line.product, line.variationName].filter(Boolean).join(" | "),
          normalizedKey: itemEquivalence.itemId,
          result: "hit",
        });
      }
      return {
        costRow: itemEquivalence.costRow,
        source: "bridge_item_financial_equivalent",
        bridgeUsed: true,
        bridgeIds,
        identitySource: itemEquivalence.source,
        identityAmbiguous: false,
        financiallyEquivalent: true,
        variationUndetermined: true,
        ambiguous: false,
      };
    }
    return { costRow: null, source: "miss", bridgeUsed: true, bridgeIds: null, skuTried, ambiguous: false };
  }

  const bridgeIds = bridgeIdsFromRecords(identity.records);
  if (debugCollector) {
    debugCollector.recordMatchAttempt({
      engine: "shopee_real",
      stage: "cost_bridge_identity",
      orderId: line.id,
      field: identity.source,
      rawValue: [line.product, line.variationName].filter(Boolean).join(" | ") || identity.bridgeSku,
      normalizedKey: bridgeCandidateIds(identity.records).join(" | "),
      result: identity.ambiguous ? "ambiguous" : "hit",
    });
  }

  if (identity.ambiguous) {
    const equivalentCost = resolveEquivalentShopeeBridgeCost(costMap, identity.records);
    if (equivalentCost) {
      return {
        costRow: equivalentCost.costRow,
        source:
          identity.source === "title_variation"
            ? "bridge_title_variation_equivalent"
            : identity.source === "title_variation_alias"
            ? "bridge_title_variation_alias_equivalent"
            : "bridge_equivalent_cost",
        bridgeUsed: true,
        bridgeIds,
        bridgeSku: identity.bridgeSku,
        identitySource: identity.source,
        identityAmbiguous: true,
        financiallyEquivalent: true,
        ambiguous: false,
        ambiguousCandidates: equivalentCost.candidateIds,
      };
    }
    return {
      costRow: null,
      source: "ambiguous",
      bridgeUsed: true,
      bridgeIds,
      bridgeSku: identity.bridgeSku,
      ambiguityKey: identity.ambiguityKey,
      identitySource: identity.source,
      ambiguous: true,
      ambiguousCandidates: bridgeCandidateIds(identity.records),
    };
  }

  const record = identity.record;
  const modelId = normalizeShopeeId(record.modelId || record.variationId);
  const itemId = normalizeShopeeId(record.itemId);
  // Quando a identidade exata fornece Model ID, SOMENTE ele pode fornecer o
  // custo. Não há fallback para o item pai, que pode ter outra variação/custo.
  const matchedId = modelId || itemId;
  const sourceName =
    identity.source === "title_variation"
      ? "bridge_title_variation"
      : identity.source === "title_variation_alias"
      ? "bridge_title_variation_alias"
      : modelId
      ? "bridge_variation_id"
      : "bridge_item_id";
  const stage = modelId ? "cost_bridge_variation" : "cost_bridge_item";
  const costRow = matchedId ? costMap.get(normalizeMatchKey(matchedId)) || null : null;

  if (debugCollector && matchedId) {
    debugCollector.recordMatchAttempt({
      engine: "shopee_real",
      stage,
      orderId: line.id,
      field: sourceName,
      rawValue: identity.bridgeSku,
      normalizedKey: matchedId,
      result: costRow ? "hit" : "miss",
    });
  }

  if (costRow) {
    return {
      costRow,
      source: sourceName,
      bridgeUsed: true,
      bridgeIds,
      bridgeSku: identity.bridgeSku,
      identitySource: identity.source,
      matchedId,
      matchedValue: matchedId,
      ambiguous: false,
    };
  }

  return {
    costRow: null,
    source: "miss",
    bridgeUsed: true,
    bridgeIds,
    bridgeSku: identity.bridgeSku,
    identitySource: identity.source,
    skuTried: identity.bridgeSku || skuTried,
    ambiguous: false,
  };
}

// Diagnóstico legível de "por que este item ficou sem custo". Nunca mistura
// SKU e ID sem dizer o tipo — resolve a confusão da tela ("ID(s) não
// encontrados" mostrando SKU) sem tocar em nenhum valor financeiro.
//
//   type       "variation_id" | "item_id" | "model_id" | "product_id" | "sku" |
//              "order_id" | "ambiguous_ids"
//   value      o identificador cru (nunca normalizado/arredondado) — para
//              "ambiguous_ids", os candidatos já juntados em texto
//   sku        o SKU do Order.all que originou o diagnóstico (quando houver)
//   candidates só em "ambiguous_ids": os IDs conflitantes resolvidos pela
//              ponte, sem pressupor equivalência entre identidades distintas
//   reason     "not_found_in_performance_bridge" | "not_found_in_cost_base" |
//              "ambiguous_bridge_candidates" | "zero_cost_in_base" | "not_found_direct"
function describeShopeeCostGap(line, costMatch, orderId) {
  if (costMatch.ambiguous) {
    // A pendência é o CONFLITO de IDs, não o SKU que os originou — a tela
    // não deve mostrar SKU aqui, só os IDs que a base resolve para custos
    // diferentes (é isso que impede a escolha automática).
    const candidates = Array.isArray(costMatch.ambiguousCandidates)
      ? costMatch.ambiguousCandidates.map((id) => String(id))
      : [];
    return {
      type: "ambiguous_ids",
      value: candidates.join(", "),
      sku: null,
      candidates,
      reason: "ambiguous_bridge_candidates",
    };
  }

  if (costMatch.costRow) {
    // A base TEM a linha (achada direto ou pela ponte), só que com custo <= 0.
    const type = String(costMatch.source || "").replace(/^(direct|bridge)_/, "") || "sku";
    const value = costMatch.matchedValue ?? "";
    const sku = costMatch.bridgeUsed ? costMatch.bridgeSku : null;
    // rawCost/costValid (quando presentes na base) distinguem #N/A (inválido,
    // sem dígito) de custo vazio e de custo 0 real — só diagnóstico, a regra
    // financeira (inválido/vazio/<=0 → sem LC/MC) não muda.
    return {
      type,
      value: String(value),
      sku,
      reason: "zero_cost_in_base",
      rawCost: costMatch.costRow.rawCost ?? null,
      costValid:
        typeof costMatch.costRow.costValid === "boolean" ? costMatch.costRow.costValid : null,
    };
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
// costBridge (opcional) é a ponte de IDENTIDADE da variação extraída da
// planilha de performance. Ela só muda COMO o custo é
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
  const bridgeAvailable = hasShopeeCostBridge(costBridge);
  let directCostMatchCount = 0;
  let bridgeCostMatchCount = 0;
  let bridgeEquivalentCostMatchCount = 0;
  let bridgeHistoricalSkuMatchCount = 0;
  let bridgeTitleVariationMatchCount = 0;
  let bridgeTitleVariationAliasMatchCount = 0;
  let bridgeSkuTokenSetMatchCount = 0;
  let bridgeSkuTokenFuzzyMatchCount = 0;
  let bridgeItemFinancialEquivalentMatchCount = 0;
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
      // direto e, em MISS, ponte de identidade da variação via performance).
      const costMatch = resolveShopeeLineCost(costMap, line, costBridge, debugCollector);
      const costRow = costMatch.costRow;
      let cmvLine = null;
      let costSource = "ausente";

      if (costMatch.ambiguous) {
        bridgeAmbiguousCount += 1;
        const ambiguityKey = costMatch.ambiguityKey || costMatch.bridgeSku || "identidade insuficiente";
        if (bridgeAmbiguousKeys.length < 50 && !bridgeAmbiguousKeys.includes(ambiguityKey)) {
          bridgeAmbiguousKeys.push(ambiguityKey);
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
          if (costMatch.financiallyEquivalent) bridgeEquivalentCostMatchCount += 1;
          if (costMatch.identitySource === "historical_variation_sku") {
            bridgeHistoricalSkuMatchCount += 1;
          }
          if (costMatch.identitySource === "title_variation") {
            bridgeTitleVariationMatchCount += 1;
          }
          if (costMatch.identitySource === "title_variation_alias") {
            bridgeTitleVariationAliasMatchCount += 1;
          }
          if (costMatch.identitySource === "sku_token_set") {
            bridgeSkuTokenSetMatchCount += 1;
          }
          if (costMatch.identitySource === "sku_token_fuzzy") {
            bridgeSkuTokenFuzzyMatchCount += 1;
          }
          if (costMatch.identitySource === "item_financial_equivalent") {
            bridgeItemFinancialEquivalentMatchCount += 1;
          }
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
      "Ponte de identidade ativa: a planilha de performance forneceu produto/variação → Model ID; SKU foi usado apenas como auxiliar. " +
      "Receita, taxas, frete, status e cancelamentos continuam vindo integralmente do Order.all."
    );
  }
  if (bridgeAmbiguousCount > 0) {
    executiveNotes.push(
      `COST_BRIDGE_AMBIGUOUS: ${bridgeAmbiguousCount} linha(s) não tinham campos suficientes para distinguir o Model ID exato. ` +
      `O custo foi mantido em branco (nenhum custo é escolhido por arbitragem)` +
      `${bridgeAmbiguousKeys.length ? `. Identidades afetadas: ${bridgeAmbiguousKeys.join(", ")}` : ""}.`
    );
  }
  if (bridgeEquivalentCostMatchCount > 0) {
    executiveNotes.push(
      `COST_BRIDGE_EQUIVALENT: ${bridgeEquivalentCostMatchCount} linha(s) tinham mais de um Model ID possível, ` +
      "mas todos os candidatos possuíam custo e imposto idênticos; o resultado financeiro foi calculado normalmente."
    );
  }
  if (bridgeHistoricalSkuMatchCount > 0) {
    executiveNotes.push(
      `COST_BRIDGE_HISTORICAL_SKU: ${bridgeHistoricalSkuMatchCount} linha(s) foram conciliadas pelo fallback controlado ` +
      'de SKU histórico (somente sufixos "-V" e "-0").'
    );
  }
  if (bridgeTitleVariationMatchCount > 0) {
    executiveNotes.push(
      `COST_BRIDGE_TITLE_VARIATION: ${bridgeTitleVariationMatchCount} linha(s) foram conciliadas pela variação exata ` +
      "mais evidência de título (o nome do anúncio mudou/foi reordenado entre as planilhas, mas a variação e o " +
      "produto continuam os mesmos)."
    );
  }
  if (bridgeTitleVariationAliasMatchCount > 0) {
    executiveNotes.push(
      `COST_BRIDGE_TITLE_VARIATION_ALIAS: ${bridgeTitleVariationAliasMatchCount} linha(s) foram conciliadas pelos ` +
      "atributos da variação (cor/tamanho, sem a quantidade) mais evidência de título e de pack/kit — a notação da " +
      "variação mudou entre as planilhas (ex.: \"Pink,G\" no Order.all e \"2 Pink,G\" na Performance), mas produto, " +
      "atributos e quantidade de peças continuam batendo."
    );
  }
  if (bridgeSkuTokenSetMatchCount > 0) {
    executiveNotes.push(
      `COST_BRIDGE_SKU_ALIAS: ${bridgeSkuTokenSetMatchCount} linha(s) foram conciliadas por um SKU histórico com ` +
      "formatação diferente (separadores, ordem ou repetição de palavras mudaram, mas o conjunto de termos do SKU " +
      "é idêntico ao da performance)."
    );
  }
  if (bridgeSkuTokenFuzzyMatchCount > 0) {
    executiveNotes.push(
      `COST_BRIDGE_SKU_ALIAS_FUZZY: ${bridgeSkuTokenFuzzyMatchCount} linha(s) foram conciliadas por um SKU histórico ` +
      "abreviado/truncado (um único termo do SKU foi encurtado, todos os demais termos batem exatamente e o " +
      "candidato era único)."
    );
  }
  if (bridgeItemFinancialEquivalentMatchCount > 0) {
    executiveNotes.push(
      `COST_BRIDGE_ITEM_FINANCIAL_EQUIVALENT: ${bridgeItemFinancialEquivalentMatchCount} linha(s) foram conciliadas ` +
      "sem determinar a variação histórica exata — o item da Performance foi identificado de forma única e segura " +
      "pelo título, e todas as suas variações têm custo e imposto financeiramente equivalentes na base, então a " +
      "variação exata não altera o resultado financeiro."
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
      costBridgeIdentityCount: bridgeAvailable
        ? uniqueBridgeRecords(getShopeeCostBridgeRecords(costBridge)).length
        : 0,
      directCostMatchCount,
      bridgeCostMatchCount,
      bridgeEquivalentCostMatchCount,
      bridgeHistoricalSkuMatchCount,
      bridgeTitleVariationMatchCount,
      bridgeTitleVariationAliasMatchCount,
      bridgeSkuTokenSetMatchCount,
      bridgeSkuTokenFuzzyMatchCount,
      bridgeItemFinancialEquivalentMatchCount,
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
  tokenizeShopeeSkuText,
  shopeeSkuTokenSetKey,
  shopeeSkuTokensFuzzyCompatible,
  selectShopeeBridgeIdentity,
};
