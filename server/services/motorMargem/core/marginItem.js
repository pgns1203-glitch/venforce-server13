// server/services/motorMargem/core/marginItem.js
// CONTRATO DO ITEM DE MARGEM — módulo puro, sem I/O.
//
// Monta o objeto normalizado que a Central de Margem consome. Recebe apenas
// evidências já coletadas pelos adapters; não sabe de banco, de ML nem de HTTP.
//
// Nada é inventado: variável sem fonte sai `null` com `status: "unavailable"`,
// margem não calculável sai `null` com o motivo. É preferível a Central mostrar
// "não sabemos" a mostrar um número que ninguém consegue defender.

const { FIELDS, resolveAllFields, DIVERGENCE_TYPES } = require("./marginEvidence");
const { EVIDENCE_KINDS } = require("./marginSources");
const {
  computeMargin,
  computeTargetPrice,
  computeBreakEvenPrice,
  compareMargins,
  round2,
} = require("./marginEngine");
const { buildConfidenceReport, LEVELS } = require("./marginConfidence");
const { classifyStatus, DEFAULT_TARGET_MARGIN } = require("./marginStatus");

// Variáveis DECLARADAS na Base: valem para os dois momentos. Não existe "custo
// realizado" vindo da venda — o custo do produto continua sendo o da Base.
const DECLARED_FIELDS = new Set([FIELDS.COST, FIELDS.TAX_RATE, FIELDS.FIXED_FEE]);

function valueForKind(field, kind) {
  if (!field || !field.present) return null;
  if (kind === EVIDENCE_KINDS.REALIZED) {
    if (field.realized) return field.realized.value;
    return DECLARED_FIELDS.has(field.key) && field.projected ? field.projected.value : null;
  }
  return field.projected ? field.projected.value : null;
}

// Projeção pública de uma variável: valor + procedência + divergências.
function fieldContract(field) {
  if (!field) return { status: "unavailable", value: null, source: null, evidences: [], divergences: [] };
  return {
    status: field.present ? "available" : "unavailable",
    value: field.selectedValue,
    source: field.selectedSource,
    kind: field.selectedKind,
    projected: field.projected,
    realized: field.realized,
    evidences: field.evidences,
    divergences: field.divergences,
  };
}

/**
 * @param {object} params
 *  - identity  { clienteSlug, marketplace, itemId, sku, titulo }
 *  - bag       evidence bag (marginEvidence.createEvidenceBag)
 *  - sales     { hasOrders, unidades, pedidos, ultimaVendaEm }
 *  - settlement{ available: boolean, motivo: string|null }
 *  - targetMargin  fração (default 0.10)
 *  - now       Date (injetável para teste)
 */
function buildMarginItem(params = {}) {
  const {
    identity = {},
    bag,
    sales = {},
    settlement = {},
    targetMargin = DEFAULT_TARGET_MARGIN,
    now = new Date(),
    staleDays,
  } = params;

  const fields = resolveAllFields(bag);
  const hasOrders = Boolean(sales.hasOrders);
  const settlementAvailable = settlement.available === true;

  // ── Margem projetada (estado atual do anúncio) ────────────────────────────
  const projectedInputs = {
    [FIELDS.PRICE]: valueForKind(fields[FIELDS.PRICE], EVIDENCE_KINDS.PROJECTED),
    [FIELDS.COST]: valueForKind(fields[FIELDS.COST], EVIDENCE_KINDS.PROJECTED),
    [FIELDS.TAX_RATE]: valueForKind(fields[FIELDS.TAX_RATE], EVIDENCE_KINDS.PROJECTED),
    [FIELDS.FIXED_FEE]: valueForKind(fields[FIELDS.FIXED_FEE], EVIDENCE_KINDS.PROJECTED),
    [FIELDS.COMMISSION]: valueForKind(fields[FIELDS.COMMISSION], EVIDENCE_KINDS.PROJECTED),
    [FIELDS.FREIGHT]: valueForKind(fields[FIELDS.FREIGHT], EVIDENCE_KINDS.PROJECTED),
  };
  const projected = computeMargin(projectedInputs);

  // ── Margem realizada (o que a venda entregou) ─────────────────────────────
  // Só existe com pedido: sem venda não há realizado — e "0" seria mentira.
  const realizedInputs = {
    [FIELDS.PRICE]: valueForKind(fields[FIELDS.PRICE], EVIDENCE_KINDS.REALIZED),
    [FIELDS.COST]: valueForKind(fields[FIELDS.COST], EVIDENCE_KINDS.REALIZED),
    [FIELDS.TAX_RATE]: valueForKind(fields[FIELDS.TAX_RATE], EVIDENCE_KINDS.REALIZED),
    [FIELDS.FIXED_FEE]: valueForKind(fields[FIELDS.FIXED_FEE], EVIDENCE_KINDS.REALIZED),
    [FIELDS.COMMISSION]: valueForKind(fields[FIELDS.COMMISSION], EVIDENCE_KINDS.REALIZED),
    [FIELDS.FREIGHT]: valueForKind(fields[FIELDS.FREIGHT], EVIDENCE_KINDS.REALIZED),
  };
  const realized = hasOrders
    ? computeMargin(realizedInputs)
    : {
        computable: false,
        profit: null,
        margin: null,
        missing: ["order"],
        assumed: [],
        strict: false,
        inputs: realizedInputs,
      };

  // ── Preço alvo e ponto de equilíbrio ──────────────────────────────────────
  const targetPriceInputs = {
    [FIELDS.COST]: projectedInputs[FIELDS.COST],
    [FIELDS.FIXED_FEE]: projectedInputs[FIELDS.FIXED_FEE],
    [FIELDS.FREIGHT]: projectedInputs[FIELDS.FREIGHT],
    [FIELDS.TAX_RATE]: projectedInputs[FIELDS.TAX_RATE],
    [FIELDS.COMMISSION_RATE]: valueForKind(
      fields[FIELDS.COMMISSION_RATE],
      EVIDENCE_KINDS.PROJECTED
    ),
  };
  const targetPrice = computeTargetPrice({ ...targetPriceInputs, targetMargin });
  const breakEven = computeBreakEvenPrice(targetPriceInputs);

  // ── Confiabilidade ────────────────────────────────────────────────────────
  // A margem exibida é a realizada quando existe; senão a projetada. `assumed`
  // vem do cálculo que está sendo exibido — é ele que precisa ser explicado.
  const displayed = realized.computable ? realized : projected;
  const confidence = buildConfidenceReport(fields, {
    now,
    staleDays,
    hasOrders,
    settlementAvailable,
    assumed: displayed.assumed,
  });

  const criticalKeys = [
    FIELDS.PRICE,
    FIELDS.COST,
    FIELDS.TAX_RATE,
    FIELDS.FIXED_FEE,
    FIELDS.COMMISSION,
    FIELDS.FREIGHT,
  ];
  const hasCriticalConflict = criticalKeys.some((key) => fields[key] && fields[key].hasConflict);

  const divergences = [];
  for (const key of Object.keys(fields)) {
    for (const divergence of fields[key].divergences) {
      divergences.push({ field: key, ...divergence });
    }
  }

  // ── Estado ────────────────────────────────────────────────────────────────
  const status = classifyStatus({
    margin: displayed.margin,
    computable: displayed.computable,
    missing: displayed.missing,
    confidenceLevel: confidence.overall.level,
    hasConflict: hasCriticalConflict,
    hasOrders,
    settlementPending: hasOrders && !settlementAvailable,
    targetMargin,
  });

  const projectionError = compareMargins(projected.margin, realized.margin);

  return {
    identity: {
      clienteSlug: identity.clienteSlug || null,
      marketplace: identity.marketplace || null,
      itemId: identity.itemId || null,
      sku: identity.sku || null,
      titulo: identity.titulo || null,
    },

    // Camada de evidências crua, variável por variável (saída de resolveField).
    // É o que sustenta o drawer "de onde veio este número?" sem uma segunda
    // chamada — e o que qualquer outra interface deve ler para comparar fontes.
    fields,

    pricing: {
      current: fieldContract(fields[FIELDS.PRICE]).projected,
      list: fieldContract(fields[FIELDS.LIST_PRICE]).projected,
      promo: fieldContract(fields[FIELDS.PROMO_PRICE]).projected,
      sold: fieldContract(fields[FIELDS.PRICE]).realized,
    },

    costs: {
      cost: fieldContract(fields[FIELDS.COST]),
      taxRate: fieldContract(fields[FIELDS.TAX_RATE]),
      fixedFee: fieldContract(fields[FIELDS.FIXED_FEE]),
    },

    marketplaceCosts: {
      commissionProjected: fields[FIELDS.COMMISSION].projected,
      commissionRealized: fields[FIELDS.COMMISSION].realized,
      commissionRate: fields[FIELDS.COMMISSION_RATE].projected,
      freightProjected: fields[FIELDS.FREIGHT].projected,
      freightRealized: fields[FIELDS.FREIGHT].realized,
    },

    settlement: {
      available: settlementAvailable,
      motivo: settlement.motivo || null,
      netReceipt: fieldContract(fields[FIELDS.NET_RECEIPT]),
      refunds: fieldContract(fields[FIELDS.REFUNDS]),
    },

    sales: {
      hasOrders,
      unidades: sales.unidades ?? null,
      pedidos: sales.pedidos ?? null,
      receita: sales.receita ?? null,
      ultimaVendaEm: sales.ultimaVendaEm ?? null,
      // Resultado que a Central de Vendas já persistiu para este anúncio.
      // Não entra em nenhum cálculo: serve de CONTRAPROVA do núcleo. Divergência
      // aqui indica que os dois caminhos aplicam regras diferentes (hoje a
      // Central de Vendas não desconta `taxa_fixa` — ver MOTOR_MARGEM_FONTES_E_GAPS).
      resultadoPersistido: sales.resultadoPersistido ?? null,
      resultadoRecalculado:
        realized.profit === null ? null : round2(realized.profit * (sales.unidades || 0)),
    },

    margin: {
      projected: {
        profit: projected.profit,
        margin: projected.margin,
        marginPercent: projected.margin === null ? null : Math.round(projected.margin * 10000) / 100,
        computable: projected.computable,
        strict: projected.strict,
        missing: projected.missing,
        assumed: projected.assumed,
      },
      realized: {
        profit: realized.profit,
        margin: realized.margin,
        marginPercent: realized.margin === null ? null : Math.round(realized.margin * 10000) / 100,
        computable: realized.computable,
        strict: realized.strict,
        missing: realized.missing,
        assumed: realized.assumed,
      },
      target: {
        marginTarget: targetMargin,
        price: targetPrice.price,
        computable: targetPrice.computable,
        reason: targetPrice.reason,
        missing: targetPrice.missing,
        breakEvenPrice: breakEven.price,
      },
      projectionError,
    },

    quality: {
      confidence: confidence.overall.level,
      confidenceByField: Object.fromEntries(
        Object.entries(confidence.byField).map(([key, entry]) => [
          key,
          { level: entry.level, reasons: entry.reasons },
        ])
      ),
      reasons: confidence.overall.reasons,
      divergences,
      hasConflict: hasCriticalConflict,
      hasDrift: divergences.some((d) => d.type === DIVERGENCE_TYPES.DRIFT),
      status: status.status,
      statusLabel: status.label,
      statusSeverity: status.severity,
      statusReasons: status.reasons,
    },
  };
}

module.exports = {
  buildMarginItem,
  fieldContract,
  valueForKind,
  DECLARED_FIELDS,
  LEVELS,
};
