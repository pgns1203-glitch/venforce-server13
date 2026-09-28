// server/services/motorMargem/core/marginComparison.js
// PROJETADO × REALIZADO — módulo puro, sem I/O.
//
// Responde, para UM anúncio:
//   Projetado  "se o anúncio operar agora com o que se conhece hoje, qual a margem?"
//   Realizado  "no período, o que as vendas entregaram?"
//   Desvio     "quanto o realizado desviou do projetado, e em qual componente?"
//
// Não calcula margem: recebe o resultado de `computeMargin` dos dois momentos
// (o mesmo núcleo de sempre) e só organiza as variáveis e as diferenças. É o
// ÚNICO lugar onde o desvio por componente é calculado — o frontend exibe,
// não recalcula.
//
// Convenções (as mesmas do núcleo):
//   · dinheiro POR UNIDADE vendida; alíquota como fração (0.12 = 12%);
//   · desvio = realizado − projetado (positivo = realizado maior);
//   · null = ausente/não comparável. Um lado ausente NUNCA vira zero: o
//     desvio daquele componente sai null.
//
// Taxa fixa não tem contrapartida histórica (centralVendasEvidenceAdapter):
// o realizado não a desconta, o projetado desconta. Isso é declarado em
// `notComparable` com o valor projetado — nunca "fechado" copiando a taxa
// fixa atual para o realizado.

const { FIELDS } = require("./marginEvidence");
const { EVIDENCE_KINDS } = require("./marginSources");
const { compareMargins, round2, round6 } = require("./marginEngine");

const COMPARISON_STATUS = {
  COMPARABLE: "COMPARABLE",
  NO_SALES: "NO_SALES",
  REALIZED_NOT_COMPUTABLE: "REALIZED_NOT_COMPUTABLE",
  PROJECTED_NOT_COMPUTABLE: "PROJECTED_NOT_COMPUTABLE",
};

const COMPARED_FIELDS = [
  FIELDS.PRICE,
  FIELDS.COMMISSION,
  FIELDS.FREIGHT,
  FIELDS.COST,
  FIELDS.TAX_RATE,
  FIELDS.FIXED_FEE,
];

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function valueOf(field, kind) {
  if (!field || !field.present) return null;
  const side = kind === EVIDENCE_KINDS.REALIZED ? field.realized : field.projected;
  return side ? num(side.value) : null;
}

function difference(projected, realized, round) {
  if (projected === null || realized === null) return null;
  return round(realized - projected);
}

function percent(margin) {
  return margin === null || margin === undefined ? null : Math.round(margin * 10000) / 100;
}

function sideValues(fields, kind) {
  const out = {};
  for (const key of COMPARED_FIELDS) out[key] = valueOf(fields[key], kind);
  return out;
}

/**
 * @param {object} params
 *  - fields     saída de resolveAllFields (evidências dos dois momentos)
 *  - projected  { profit, margin, computable, assumed } (computeMargin projetado)
 *  - realized   { profit, margin, computable, assumed, missing } (computeMargin realizado)
 *  - sales      { hasOrders, unidades, pedidos, receita, ultimaVendaEm }
 *  - coverage   cobertura por componente do adapter da Central de Vendas (opcional)
 */
function buildProjectedVsRealized({ fields = {}, projected = {}, realized = {}, sales = {}, coverage = null } = {}) {
  const hasOrders = Boolean(sales.hasOrders);
  const projectedValues = sideValues(fields, EVIDENCE_KINDS.PROJECTED);
  const realizedValues = sideValues(fields, EVIDENCE_KINDS.REALIZED);

  let status = COMPARISON_STATUS.COMPARABLE;
  if (!hasOrders) status = COMPARISON_STATUS.NO_SALES;
  else if (!realized.computable) status = COMPARISON_STATUS.REALIZED_NOT_COMPUTABLE;
  else if (!projected.computable) status = COMPARISON_STATUS.PROJECTED_NOT_COMPUTABLE;

  const units = num(sales.unidades);
  const realizedProfit = realized.computable ? num(realized.profit) : null;

  const notComparable = [];
  if (hasOrders && realizedValues[FIELDS.FIXED_FEE] === null) {
    notComparable.push({
      field: FIELDS.FIXED_FEE,
      reason: "SEM_HISTORICO",
      projectedValue: projectedValues[FIELDS.FIXED_FEE],
    });
  }

  let drift = null;
  if (hasOrders) {
    const margins = compareMargins(
      projected.computable ? projected.margin : null,
      realized.computable ? realized.margin : null
    );
    const taxRate = difference(projectedValues[FIELDS.TAX_RATE], realizedValues[FIELDS.TAX_RATE], round6);
    drift = {
      price: difference(projectedValues[FIELDS.PRICE], realizedValues[FIELDS.PRICE], round2),
      commission: difference(projectedValues[FIELDS.COMMISSION], realizedValues[FIELDS.COMMISSION], round2),
      freight: difference(projectedValues[FIELDS.FREIGHT], realizedValues[FIELDS.FREIGHT], round2),
      cost: difference(projectedValues[FIELDS.COST], realizedValues[FIELDS.COST], round2),
      taxRate,
      taxRatePp: taxRate === null ? null : Math.round(taxRate * 10000) / 100,
      // Taxa fixa nunca tem desvio calculável (ver notComparable).
      fixedFee: null,
      profit: difference(
        projected.computable ? num(projected.profit) : null,
        realizedProfit,
        round2
      ),
      marginPercentagePoints: margins.deltaPp,
    };
  }

  return {
    status,
    projected: {
      ...projectedValues,
      profit: projected.computable ? num(projected.profit) : null,
      margin: projected.computable ? num(projected.margin) : null,
      marginPercent: projected.computable ? percent(num(projected.margin)) : null,
      computable: projected.computable === true,
      assumed: Array.isArray(projected.assumed) ? projected.assumed : [],
    },
    realized: {
      available: hasOrders,
      ...realizedValues,
      profit: realizedProfit,
      margin: realized.computable ? num(realized.margin) : null,
      marginPercent: realized.computable ? percent(num(realized.margin)) : null,
      computable: realized.computable === true,
      assumed: hasOrders && Array.isArray(realized.assumed) ? realized.assumed : [],
      missing: hasOrders && Array.isArray(realized.missing) ? realized.missing : [],
      units,
      orders: num(sales.pedidos),
      revenue: num(sales.receita),
      lastSaleAt: sales.ultimaVendaEm || null,
      // Lucro do período recalculado pelo núcleo (lucro/un × unidades).
      totalProfit: realizedProfit === null || units === null ? null : round2(realizedProfit * units),
      coverage: hasOrders ? coverage || null : null,
    },
    drift,
    notComparable,
  };
}

module.exports = {
  COMPARISON_STATUS,
  COMPARED_FIELDS,
  buildProjectedVsRealized,
};
