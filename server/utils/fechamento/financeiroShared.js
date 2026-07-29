// server/utils/fechamento/financeiroShared.js
// Helpers puros compartilhados entre o fechamento financeiro legado
// (processMeli / processShopee) e a Central de Vendas.
//
// Regra global: a AUSÊNCIA DE CUSTO NUNCA APAGA FATURAMENTO.
// O faturamento reconhecido é sempre total; o lucro representa apenas a
// parcela com custo identificado. Ver buildCoverage().

const { toNumber, round2 } = require("../numberUtils");
const { normalizeText, findField } = require("../textUtils");

// ── Rateio ──────────────────────────────────────────────────────────────────

// Peso do rateio, na ordem exigida pelo negócio:
//   1) unidades * preço unitário
//   2) receita do produto
//   3) quantidade (último fallback)
const ALLOCATION_BASES = [
  {
    name: "revenue_from_unit_price",
    weight: (row) => {
      const units = Math.abs(toNumber(row && row.units));
      const price = Math.abs(toNumber(row && (row.unitSalePrice ?? row.unitPrice)));
      return units > 0 && price > 0 ? units * price : 0;
    },
  },
  {
    name: "product_revenue",
    weight: (row) =>
      Math.abs(
        toNumber(row && (row.productRevenue ?? row.revenue ?? row.grossRevenue))
      ),
  },
  {
    name: "units",
    weight: (row) => Math.abs(toNumber(row && row.units)),
  },
];

// Escolhe a base de rateio. Só aceita uma base quando TODAS as linhas têm peso
// positivo nela — evita que uma linha sem preço unitário receba 0 enquanto as
// outras absorvem o pedido inteiro.
function resolveAllocationBasis(componentRows) {
  for (const basis of ALLOCATION_BASES) {
    const weights = componentRows.map((row) => basis.weight(row));
    const sum = weights.reduce((acc, value) => acc + value, 0);
    if (sum > 0 && weights.every((value) => value > 0)) {
      return { name: basis.name, weights, sum };
    }
  }
  return null;
}

// Rateia totalValue entre componentRows proporcionalmente ao valor vendido.
// A soma das parcelas é exatamente round2(totalValue): a última parcela
// absorve a diferença de arredondamento. Funciona com valores negativos.
function allocateByRevenue(totalValue, componentRows) {
  const rows = Array.isArray(componentRows) ? componentRows : [];
  if (rows.length === 0) return [];

  const total = round2(toNumber(totalValue));
  const basis = resolveAllocationBasis(rows);

  if (!basis) return rows.map(() => 0);

  const allocations = [];
  let accumulated = 0;

  for (let i = 0; i < rows.length; i++) {
    if (i === rows.length - 1) {
      allocations.push(round2(total - accumulated));
      continue;
    }

    const value = round2((total * basis.weights[i]) / basis.sum);
    allocations.push(value);
    accumulated = round2(accumulated + value);
  }

  return allocations;
}

// ── Status de venda do Mercado Livre ────────────────────────────────────────

// Mesmas colunas usadas historicamente pelo fechamento legado.
// NÃO acrescentar "status" genérico: "status do envio" causaria falso positivo.
const MELI_STATUS_FIELDS = [
  "estado",
  "descricao do status",
  "descrição do status",
];

// Classificação única de status usada pelo fechamento legado E pela
// Central de Vendas. Retorna: paid | cancelled | refunded | returned |
// mediation | other.
function classifyMeliSaleStatus(rawRow) {
  const text = normalizeText(findField(rawRow || {}, MELI_STATUS_FIELDS));
  if (!text) return "other";

  if (text.includes("mediac")) return "mediation";
  if (text.includes("devolu")) return "returned";
  if (text.includes("reemb") || text.includes("estorn")) return "refunded";
  if (text.includes("cancelad")) return "cancelled";
  if (
    text.includes("pago") ||
    text.includes("paga") ||
    text.includes("aprovad") ||
    text.includes("entregue") ||
    text.includes("concluid")
  ) {
    return "paid";
  }

  return "other";
}

const MELI_STATUS_OUT_OF_PROFIT = new Set([
  "cancelled",
  "refunded",
  "returned",
  "mediation",
]);

// "other" continua entrando no cálculo — mesmo comportamento do fechamento
// legado, que só excluía cancelado/devolvido/reembolsado/mediação.
function isMeliStatusOutOfProfit(kind) {
  return MELI_STATUS_OUT_OF_PROFIT.has(kind);
}

// ── Cobertura de custos e confiança ─────────────────────────────────────────

const FINANCIAL_CONFIDENCE = {
  CONFIAVEL: "confiavel",
  PARCIAL: "parcial",
  INSUFICIENTE: "insuficiente",
};

// Separa faturamento total, faturamento com custo e receita sem custo, e
// deriva cobertura + confiança. NUNCA inventa custo zero.
function buildCoverage({ revenueWithCost, revenueWithoutCost }) {
  const withCost = round2(toNumber(revenueWithCost));
  const withoutCost = round2(toNumber(revenueWithoutCost));
  const total = round2(withCost + withoutCost);

  let financialConfidence;
  if (withCost <= 0) {
    financialConfidence = FINANCIAL_CONFIDENCE.INSUFICIENTE;
  } else if (withoutCost > 0) {
    financialConfidence = FINANCIAL_CONFIDENCE.PARCIAL;
  } else {
    financialConfidence = FINANCIAL_CONFIDENCE.CONFIAVEL;
  }

  return {
    revenueTotal: total,
    revenueWithCost: withCost,
    revenueWithoutCost: withoutCost,
    // null = desconhecido (não existe faturamento reconhecido), nunca 0 falso.
    calculatedCoveragePercent: total > 0 ? round2((withCost / total) * 100) : null,
    financialConfidence,
  };
}

// ── Razões seguras ──────────────────────────────────────────────────────────

// Divisão que nunca devolve NaN/Infinity. Denominador não positivo => null
// (ausência), nunca 0 falso.
function safeRatio(numerator, denominator) {
  const num = toNumber(numerator);
  const den = toNumber(denominator);
  if (!(den > 0)) return null;
  const ratio = num / den;
  return Number.isFinite(ratio) ? ratio : null;
}

// Compatibilidade: campos legados do summary sempre foram numéricos.
function legacyRatio(numerator, denominator) {
  const ratio = safeRatio(numerator, denominator);
  return ratio === null ? 0 : ratio;
}

// TACoS = Ads / faturamento total (inclui receita sem custo).
function computeTacos(ads, faturamentoTotal) {
  return legacyRatio(toNumber(ads), faturamentoTotal);
}

// TACoX = (Ads + Venforce + Afiliados) / faturamento total.
// Afiliados entram nos DOIS marketplaces.
function computeTacox(ads, venforce, affiliates, faturamentoTotal) {
  return legacyRatio(
    toNumber(ads) + toNumber(venforce) + toNumber(affiliates),
    faturamentoTotal
  );
}

module.exports = {
  ALLOCATION_BASES,
  FINANCIAL_CONFIDENCE,
  MELI_STATUS_FIELDS,
  allocateByRevenue,
  resolveAllocationBasis,
  classifyMeliSaleStatus,
  isMeliStatusOutOfProfit,
  buildCoverage,
  safeRatio,
  legacyRatio,
  computeTacos,
  computeTacox,
};
