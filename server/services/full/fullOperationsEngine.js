"use strict";

// Normalizacao/agregacao de operacoes de estoque Full (SALE_CONFIRMATION e
// afins) e as funcoes puras de janela de periodo que dependem delas.
//
// [FIX] Confirmado com payload real da API (GET /stock/fulfillment/operations/search):
// o campo de data e `date_created`, nao `date` -- esse campo nao existe na
// resposta real. Com `date` a operacao nunca era descartada por campo
// obrigatorio ausente (id/type/inventory_id continuam presentes), mas
// `operation.date` ficava sempre null e `!operation.date` descartava TODA
// operacao silenciosamente, tanto em `aggregateOperationsByInventory` aqui
// quanto em `buildMovementsByInventory` (fullService.js) -- giro/cobertura
// viravam "confirmado zero" e a lista de movimentos ficava sempre vazia,
// mesmo com vendas reais na janela. Este arquivo assume
// `{ id, type, inventory_id, date_created, detail: { available_quantity } }`.
//
// Regra fixa (nao depende da suposicao acima): so SALE_CONFIRMATION conta
// como venda. SALE_CANCELATION, SALE_RETURN etc. nunca sao somadas
// silenciosamente. Ausencia nunca vira zero: uma operacao SALE_CONFIRMATION
// sem delta interpretavel degrada o status da janela para aquele
// inventario, em vez de subestimar a demanda com uma soma parcial.

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Converte uma operacao crua no formato interno. `valid=false` quando os
 * campos minimos (id/type/inventory_id) nao estao presentes — a operacao
 * deve ser descartada pelo chamador, nunca forcada em uma agregacao.
 */
function normalizeOperation(raw) {
  if (!raw || typeof raw !== "object") {
    return { operationId: null, type: null, inventoryId: null, date: null, availableQuantityDelta: null, valid: false };
  }

  const operationId = raw.id !== undefined && raw.id !== null ? String(raw.id) : null;
  const type = isNonEmptyString(raw.type) ? raw.type : null;
  const inventoryId = raw.inventory_id !== undefined && raw.inventory_id !== null ? String(raw.inventory_id) : null;
  const date = isNonEmptyString(raw.date_created) ? raw.date_created : null;
  const availableQuantityDelta =
    raw.detail && typeof raw.detail === "object" && typeof raw.detail.available_quantity === "number"
      ? raw.detail.available_quantity
      : null;

  return {
    operationId,
    type,
    inventoryId,
    date,
    availableQuantityDelta,
    valid: Boolean(operationId && type && inventoryId),
  };
}

/**
 * Unidades vendidas de uma operacao ja normalizada.
 *   applicable=false -> tipo nao e SALE_CONFIRMATION, nunca soma como venda.
 *   applicable=true, units=null -> e uma venda, mas o delta nao pode ser
 *     lido (nunca vira 0 silenciosamente).
 *   applicable=true, units=N -> venda confirmada de N unidades.
 */
function saleUnitsFromOperation(operation) {
  if (!operation || operation.type !== "SALE_CONFIRMATION") {
    return { applicable: false, units: null };
  }
  if (typeof operation.availableQuantityDelta !== "number" || !Number.isFinite(operation.availableQuantityDelta)) {
    return { applicable: true, units: null };
  }
  return { applicable: true, units: Math.abs(operation.availableQuantityDelta) };
}

/**
 * Remove operacoes duplicadas por id (ex.: apos um restart de scroll).
 * Operacoes sem id nao sao deduplicaveis e sao preservadas como vieram.
 */
function dedupeOperationsById(operations) {
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(operations) ? operations : []) {
    const id = raw && raw.id !== undefined && raw.id !== null ? String(raw.id) : null;
    if (id === null) {
      result.push(raw);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(raw);
  }
  return result;
}

/**
 * `${YYYY-MM-DD}` +/- `deltaDays` dias, em aritmetica de calendario UTC
 * (sem fuso horario implicito — a data de entrada ja e o dia de corte
 * fornecido pelo orquestrador, nao um relogio lido aqui).
 */
function addDaysToIsoDate(isoDate, deltaDays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate))) {
    throw new TypeError("isoDate deve estar no formato YYYY-MM-DD");
  }
  const [year, month, day] = isoDate.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, day) + deltaDays * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Janela de `days` dias completos terminando no dia anterior a
 * `endExclusiveIso` (o dia corrente/parcial nunca entra na janela).
 */
function buildCompletedDayWindow({ endExclusiveIso, days }) {
  if (!Number.isInteger(days) || days < 1) {
    throw new TypeError("days deve ser um inteiro >= 1");
  }
  const to = addDaysToIsoDate(endExclusiveIso, -1);
  const from = addDaysToIsoDate(endExclusiveIso, -days);
  return { from, to };
}

/**
 * Divide uma janela de 14 dias em duas janelas de 7 dias (anterior/atual).
 */
function splitFourteenDayWindow(window) {
  if (!window || !isNonEmptyString(window.from) || !isNonEmptyString(window.to)) {
    throw new TypeError("window deve ter from/to no formato YYYY-MM-DD");
  }
  const midpoint = addDaysToIsoDate(window.from, 7);
  return {
    previousWeek: { from: window.from, to: addDaysToIsoDate(midpoint, -1) },
    currentWeek: { from: midpoint, to: window.to },
  };
}

/** Comparacao lexicografica de datas ISO YYYY-MM-DD == comparacao cronologica. Inclusiva nas duas pontas. */
function isDateInsideWindow(isoDate, window) {
  return isoDate >= window.from && isoDate <= window.to;
}

/**
 * Agrega unidades de SALE_CONFIRMATION por inventory_id nas duas janelas de
 * 7 dias. Uma operacao SALE_CONFIRMATION sem delta interpretavel degrada o
 * status daquela janela/inventario para "degraded" e zera o total para
 * `null` (nunca soma parcial disfarcada de total confiavel).
 */
function aggregateOperationsByInventory({ operations, previousWeek, currentWeek }) {
  const byInventory = new Map();

  function ensure(inventoryId) {
    if (!byInventory.has(inventoryId)) {
      byInventory.set(inventoryId, {
        inventoryId,
        previous7dUnits: 0,
        previous7dStatus: "ok",
        current7dUnits: 0,
        current7dStatus: "ok",
      });
    }
    return byInventory.get(inventoryId);
  }

  for (const raw of Array.isArray(operations) ? operations : []) {
    const operation = normalizeOperation(raw);
    if (!operation.valid || !operation.date) continue;

    const sale = saleUnitsFromOperation(operation);
    if (!sale.applicable) continue;

    const isoDate = operation.date.slice(0, 10);
    const bucket = ensure(operation.inventoryId);

    if (isDateInsideWindow(isoDate, previousWeek)) {
      if (sale.units === null) {
        bucket.previous7dStatus = "degraded";
        bucket.previous7dUnits = null;
      } else if (bucket.previous7dStatus === "ok") {
        bucket.previous7dUnits += sale.units;
      }
    } else if (isDateInsideWindow(isoDate, currentWeek)) {
      if (sale.units === null) {
        bucket.current7dStatus = "degraded";
        bucket.current7dUnits = null;
      } else if (bucket.current7dStatus === "ok") {
        bucket.current7dUnits += sale.units;
      }
    }
  }

  return Array.from(byInventory.values());
}

module.exports = {
  normalizeOperation,
  saleUnitsFromOperation,
  dedupeOperationsById,
  buildCompletedDayWindow,
  splitFourteenDayWindow,
  isDateInsideWindow,
  aggregateOperationsByInventory,
};
