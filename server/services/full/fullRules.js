"use strict";

// Funcoes puras da Central de Gestao Full: tendencia, ritmo equivalente,
// giro, cobertura, classificacao operacional e reposicao base.
//
// Sem banco, HTTP, filesystem, process.env, relogio implicito ou logger.
// Ausencia de dado nunca vira zero: use `null` e um status de fonte
// explicito. Nenhuma funcao aqui retorna Infinity ou NaN no contrato.

const DEFAULT_OPERATIONAL_STATUS_CONFIG = Object.freeze({
  criticalMaxDays: 7,
  reorderMaxDays: 15,
  healthyMaxDays: 45,
  highMaxDays: 60,
});

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeFiniteNumber(value) {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveFiniteNumber(value) {
  return isFiniteNumber(value) && value > 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Tendencia entre duas janelas de unidades vendidas (SALE_CONFIRMATION).
 * Cobre explicitamente 0->0, 0->N, N->0 e N->M sem jamais gerar Infinity.
 */
function calculateTrend(previousUnits, currentUnits) {
  if (!isNonNegativeInteger(previousUnits)) {
    throw new TypeError("previousUnits deve ser um inteiro nao negativo");
  }
  if (!isNonNegativeInteger(currentUnits)) {
    throw new TypeError("currentUnits deve ser um inteiro nao negativo");
  }

  const deltaUnits = currentUnits - previousUnits;

  if (previousUnits === 0) {
    return {
      deltaUnits,
      variationPct: null,
      variationKind: currentUnits === 0 ? "no_movement" : "new_movement",
    };
  }

  return {
    deltaUnits,
    variationPct: (deltaUnits / previousUnits) * 100,
    variationKind: "comparable",
  };
}

/**
 * Ritmo equivalente de 30 dias a partir de unidades de uma janela de 7 dias.
 * Representa ritmo equivalente, nao previsao garantida.
 */
function equivalentThirtyDayPace(sevenDayUnits) {
  if (sevenDayUnits === null) return null;
  if (!isNonNegativeFiniteNumber(sevenDayUnits)) {
    throw new TypeError("sevenDayUnits deve ser um numero nao negativo ou null");
  }
  return (sevenDayUnits / 7) * 30;
}

/**
 * Giro diario. Dado ausente (salesStatus != "ok" ou units ausente) nunca
 * vira zero: retorna value=null com status "sales_unavailable".
 */
function calculateDailyTurnover({ units, days, salesStatus = "ok" }) {
  if (salesStatus !== "ok" || units === null || units === undefined) {
    return { value: null, status: "sales_unavailable" };
  }
  if (!isNonNegativeFiniteNumber(units) || !isPositiveFiniteNumber(days)) {
    return { value: null, status: "invalid_input" };
  }
  return { value: units / days, status: "ok" };
}

/**
 * Cobertura em dias com estados explicitos. Nunca usa Infinity para
 * representar "sem giro"; giro real zero vira o estado "no_demand".
 */
function calculateCoverage({ availableStock, stockStatus = "ok", dailyTurnover, turnoverStatus }) {
  if (stockStatus !== "ok" || availableStock === null || availableStock === undefined) {
    return { coverageDays: null, coverageState: "stock_unavailable" };
  }
  if (!isNonNegativeFiniteNumber(availableStock)) {
    return { coverageDays: null, coverageState: "invalid_input" };
  }
  if (turnoverStatus !== "ok" || dailyTurnover === null || dailyTurnover === undefined) {
    return { coverageDays: null, coverageState: "sales_unavailable" };
  }
  if (!isNonNegativeFiniteNumber(dailyTurnover)) {
    return { coverageDays: null, coverageState: "invalid_input" };
  }
  if (dailyTurnover === 0) {
    return { coverageDays: null, coverageState: "no_demand" };
  }
  return { coverageDays: availableStock / dailyTurnover, coverageState: "numeric" };
}

/**
 * Classificacao operacional configuravel. Precedencia fixa:
 * 1) SEM_DADO  2) RUPTURA  3) SEM_GIRO  4) faixas de cobertura.
 */
function classifyOperationalStatus(input, config = DEFAULT_OPERATIONAL_STATUS_CONFIG) {
  const { availableStock, stockStatus = "ok", coverageDays, coverageState } = input;

  const sourceIncomplete =
    stockStatus !== "ok" ||
    coverageState === "stock_unavailable" ||
    coverageState === "sales_unavailable" ||
    coverageState === "invalid_input";

  if (sourceIncomplete) {
    return "SEM_DADO";
  }

  if (coverageState === "numeric" && availableStock === 0 && coverageDays === 0) {
    return "RUPTURA";
  }

  if (coverageState === "no_demand") {
    return "SEM_GIRO";
  }

  if (coverageState !== "numeric" || !isNonNegativeFiniteNumber(coverageDays)) {
    return "SEM_DADO";
  }

  if (coverageDays < config.criticalMaxDays) return "CRITICO";
  if (coverageDays < config.reorderMaxDays) return "REPOR";
  if (coverageDays <= config.healthyMaxDays) return "SAUDAVEL";
  if (coverageDays <= config.highMaxDays) return "ALTO";
  return "EXCESSO";
}

/**
 * Reposicao base: sem estoque em transito, sem uplift. Se algum dado
 * necessario estiver ausente, sendQuantity=null com o motivo explicito.
 */
function calculateBaseReplenishment({
  dailyTurnover,
  turnoverStatus,
  availableStock,
  stockStatus = "ok",
  targetCoverageDays,
}) {
  if (turnoverStatus !== "ok" || !isNonNegativeFiniteNumber(dailyTurnover)) {
    return { sendQuantity: null, targetStock: null, reason: "sales_unavailable" };
  }
  if (stockStatus !== "ok" || !isNonNegativeFiniteNumber(availableStock)) {
    return { sendQuantity: null, targetStock: null, reason: "stock_unavailable" };
  }
  if (!isPositiveFiniteNumber(targetCoverageDays)) {
    return { sendQuantity: null, targetStock: null, reason: "invalid_target_coverage" };
  }

  const targetStock = dailyTurnover * targetCoverageDays;
  const sendQuantity = Math.max(0, Math.ceil(targetStock - availableStock));

  return { sendQuantity, targetStock, reason: null };
}

module.exports = {
  DEFAULT_OPERATIONAL_STATUS_CONFIG,
  calculateTrend,
  equivalentThirtyDayPace,
  calculateDailyTurnover,
  calculateCoverage,
  classifyOperationalStatus,
  calculateBaseReplenishment,
};
