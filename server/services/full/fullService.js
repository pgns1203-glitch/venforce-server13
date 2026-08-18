"use strict";

// Orquestrador on-demand da Central de Gestao Full (PR3): resolve a conta
// uma unica vez, varre os itens Full, resolve identidade, busca estoque com
// pool limitado e operacoes em lotes de inventory_id, agrega e aplica as
// regras puras do PR1. Sem persistencia: tudo em memoria, via
// `fullCache.getOrLoad` para single-flight/TTL.
//
// Falha total de uma fonte fundamental (scan de itens) propaga o erro para
// fora do `loadFn` passado ao cache — e o cache (ja testado) que decide se
// devolve o ultimo snapshot bom como stale ou propaga a falha adiante.
// Falhas parciais (um lote de multiget, um inventory de estoque, um lote de
// operacoes) NUNCA derrubam a coleta inteira: apenas degradam a fonte ou a
// linha afetada, e ausencia nunca vira zero (ver buildInventoryRow).
//
// Nenhuma rota chama este arquivo ainda.

const { runScroll } = require("./fullPagination");
const { parseItemsBatch } = require("./fullItemParser");
const { dedupeInventories } = require("./fullIdentity");
const { createConcurrencyLimiter } = require("./fullRetry");
const { createFullCache } = require("./fullCache");
const { createFullCommercialAdapter } = require("./fullCommercialAdapter");
const {
  buildCompletedDayWindow,
  splitFourteenDayWindow,
  aggregateOperationsByInventory,
  dedupeOperationsById,
  normalizeOperation,
  saleUnitsFromOperation,
} = require("./fullOperationsEngine");
const {
  calculateTrend,
  equivalentThirtyDayPace,
  calculateDailyTurnover,
  calculateCoverage,
  classifyOperationalStatus,
  calculateBaseReplenishment,
} = require("./fullRules");

const DEFAULT_CONFIG = Object.freeze({
  windowDays: 14,
  itemScanPageLimit: 100,
  itemScanMaxPages: 100,
  itemScanMaxRecords: 20000,
  multigetBatchSize: 20,
  stockConcurrency: 4,
  operationsInventoryBatchSize: 50, // [VALIDAR] tamanho seguro real (secao 24 do plano)
  operationsMaxPages: 50,
  operationsMaxRecords: 200000,
  targetCoverageDays: 30,
});

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

function numericOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoDateFromMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function combineQualityStatus(statuses) {
  return statuses.every((status) => status === "ok") ? "complete" : "partial";
}

/**
 * Agrupa operacoes ja deduplicadas por inventory_id, mais novas primeiro,
 * para servir o endpoint de movimentos (secao 12: "serve os movimentos ja
 * coletados/cacheados da janela de 14 dias", nunca uma nova chamada ML por
 * inventario). Inventories degradados (lote de operacoes que falhou) NAO
 * aparecem aqui — o chamador deve tratar como sales.status="unavailable",
 * nao como "sem movimentos".
 */
function buildMovementsByInventory(operations, degradedInventoryIds) {
  const byInventory = new Map();
  for (const raw of operations) {
    const operation = normalizeOperation(raw);
    if (!operation.valid || !operation.inventoryId || !operation.date) continue;
    if (degradedInventoryIds.has(operation.inventoryId)) continue;

    const sale = saleUnitsFromOperation(operation);
    const list = byInventory.get(operation.inventoryId) || [];
    list.push({
      operationId: operation.operationId,
      type: operation.type,
      date: operation.date,
      units: sale.applicable ? sale.units : null,
    });
    byInventory.set(operation.inventoryId, list);
  }
  for (const list of byInventory.values()) {
    list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }
  return byInventory;
}

function encodeMovementsCursor(offset) {
  return Buffer.from(String(offset), "utf8").toString("base64");
}

function decodeMovementsCursor(cursor) {
  if (!cursor) return 0;
  try {
    const n = Number(Buffer.from(String(cursor), "base64").toString("utf8"));
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function findInventoryOrThrow(snapshot, inventoryId) {
  const row = snapshot.inventories.find((r) => r.inventoryId === inventoryId);
  if (!row) {
    throw Object.assign(new Error("Inventario nao encontrado no snapshot desta conta."), {
      code: "INVENTORY_NOT_FOUND",
      statusCode: 404,
    });
  }
  return row;
}

/**
 * Monta a linha de um inventario aplicando as regras puras do PR1.
 * `sales`:
 *   undefined -> nenhuma operacao SALE_CONFIRMATION encontrada para esse
 *                inventario numa janela de operacoes bem sucedida: zero real.
 *   null      -> o lote de operacoes que cobriria esse inventario degradou
 *                (falhou/parou mal): ausencia, nunca zero.
 *   objeto    -> agregado de `aggregateOperationsByInventory`; se alguma das
 *                semanas ficou "degraded" internamente, tambem vira ausencia.
 */
function buildInventoryRow({ inv, stock, sales, config }) {
  const stockStatus = stock ? stock.status : "unavailable";
  const availableStock = stock ? stock.available : null;

  let previous7dUnits = 0;
  let current7dUnits = 0;
  let salesStatus = "ok";

  if (sales === null) {
    salesStatus = "unavailable";
    previous7dUnits = null;
    current7dUnits = null;
  } else if (sales === undefined) {
    previous7dUnits = 0;
    current7dUnits = 0;
  } else if (sales.previous7dStatus !== "ok" || sales.current7dStatus !== "ok") {
    salesStatus = "unavailable";
    previous7dUnits = null;
    current7dUnits = null;
  } else {
    previous7dUnits = sales.previous7dUnits;
    current7dUnits = sales.current7dUnits;
  }

  const unitsAreIntegers = Number.isInteger(previous7dUnits) && Number.isInteger(current7dUnits);
  const trend = salesStatus === "ok" && unitsAreIntegers ? calculateTrend(previous7dUnits, current7dUnits) : null;

  const pace30dPrevious = salesStatus === "ok" ? equivalentThirtyDayPace(previous7dUnits) : null;
  const pace30dCurrent = salesStatus === "ok" ? equivalentThirtyDayPace(current7dUnits) : null;
  const total14dUnits = salesStatus === "ok" ? previous7dUnits + current7dUnits : null;

  const normalizedStockStatus = stockStatus === "ok" ? "ok" : "unavailable";

  const turnover = calculateDailyTurnover({ units: total14dUnits, days: 14, salesStatus });
  const coverage = calculateCoverage({
    availableStock,
    stockStatus: normalizedStockStatus,
    dailyTurnover: turnover.value,
    turnoverStatus: turnover.status,
  });
  const operationalStatus = classifyOperationalStatus({
    availableStock,
    stockStatus: normalizedStockStatus,
    coverageDays: coverage.coverageDays,
    coverageState: coverage.coverageState,
  });
  const replenishment = calculateBaseReplenishment({
    dailyTurnover: turnover.value,
    turnoverStatus: turnover.status,
    availableStock,
    stockStatus: normalizedStockStatus,
    targetCoverageDays: config.targetCoverageDays,
  });

  return {
    inventoryId: inv.inventoryId,
    clienteContaId: inv.clienteContaId,
    sellerId: inv.sellerId,
    references: inv.references,
    identityStatus: inv.identityStatus,
    stock: {
      available: availableStock,
      total: stock ? stock.total : null,
      notAvailable: stock ? stock.notAvailable : null,
      status: normalizedStockStatus,
    },
    sales: { previous7d: previous7dUnits, current7d: current7dUnits, total14d: total14dUnits, status: salesStatus },
    trend,
    pace30dPrevious,
    pace30dCurrent,
    dailyTurnover: turnover.value,
    coverageDays: coverage.coverageDays,
    coverageState: coverage.coverageState,
    operationalStatus,
    targetCoverageDays: config.targetCoverageDays,
    sendQuantity: replenishment.sendQuantity,
    replenishmentReason: replenishment.reason,
  };
}

/**
 * `mlGateway` (PR2) e `resolveAccountContext` (clienteContaService, real
 * por padrao) sao sempre injetaveis — nenhum teste deste arquivo faz rede
 * ou Postgres reais.
 */
function createFullService({
  mlGateway,
  resolveAccountContext,
  cache = createFullCache(),
  nowFn = () => Date.now(),
  config = DEFAULT_CONFIG,
  commercialAdapter = createFullCommercialAdapter(),
} = {}) {
  if (typeof mlGateway !== "object" || mlGateway === null) {
    throw new TypeError("mlGateway e obrigatorio");
  }
  if (typeof resolveAccountContext !== "function") {
    throw new TypeError("resolveAccountContext e obrigatorio e deve ser injetavel");
  }
  if (typeof commercialAdapter !== "object" || commercialAdapter === null || typeof commercialAdapter.fetchBulkCommercial !== "function") {
    throw new TypeError("commercialAdapter e obrigatorio e deve expor fetchBulkCommercial");
  }

  /** Varre todo o scan de itens Full da conta, ids brutos (MLBs). */
  async function scanAllFullItemIds({ clienteId, mlUserId, sellerId }) {
    return runScroll({
      fetchPage: async (cursor) => {
        const page = await mlGateway.searchFullItems({
          clienteId,
          mlUserId,
          sellerId,
          scrollId: cursor,
          limit: config.itemScanPageLimit,
        });
        if (!page.ok) {
          throw Object.assign(new Error("full_items_scan_failed"), { code: "ITEMS_SCAN_FAILED", status: page.status });
        }
        return { items: page.ids, nextCursor: page.nextCursor };
      },
      maxPages: config.itemScanMaxPages,
      maxRecords: config.itemScanMaxRecords,
    });
  }

  /** Multiget em lotes de 20 + parser (PR2) + dedupe de identidade (PR1). Falha de um lote so degrada aquele lote. */
  async function fetchAndParseItems({ clienteId, mlUserId, clienteContaId, sellerId, ids }) {
    const batches = chunk(ids, config.multigetBatchSize);
    const identities = [];
    const unresolvedReferences = [];
    const warnings = [];
    let received = 0;
    let anyBatchFailed = false;

    for (const batch of batches) {
      const result = await mlGateway.multigetItems({ clienteId, mlUserId, ids: batch });
      if (!result.ok) {
        anyBatchFailed = true;
        continue;
      }
      received += result.items.length;
      const parsed = parseItemsBatch(result.items, { clienteContaId, sellerId });
      identities.push(...parsed.identities);
      unresolvedReferences.push(...parsed.unresolvedReferences);
      warnings.push(...parsed.warnings);
    }

    const { inventories, invalid } = dedupeInventories(identities);

    return {
      inventories,
      invalidIdentities: invalid,
      unresolvedReferences,
      warnings,
      quality: { status: anyBatchFailed ? "partial" : "ok", expected: ids.length, received },
    };
  }

  /** Estoque por inventory_id, um por chamada, com pool pequeno. Falha isolada vira so aquela linha unavailable. */
  async function fetchStockForInventories({ clienteId, mlUserId, inventories }) {
    const limit = createConcurrencyLimiter(config.stockConcurrency);
    const stockById = new Map();
    let failures = 0;

    await Promise.all(
      inventories.map((inv) =>
        limit(async () => {
          const result = await mlGateway.getInventoryStock({ clienteId, mlUserId, inventoryId: inv.inventoryId });
          if (!result.ok) {
            failures += 1;
            stockById.set(inv.inventoryId, { status: "unavailable", available: null, total: null, notAvailable: null });
            return;
          }
          const data = result.data || {};
          stockById.set(inv.inventoryId, {
            status: "ok",
            available: numericOrNull(data.available_quantity),
            total: numericOrNull(data.total),
            notAvailable: numericOrNull(data.not_available_quantity),
          });
        })
      )
    );

    const status = inventories.length === 0 || failures === 0 ? "ok" : failures === inventories.length ? "unavailable" : "partial";
    return { stockById, quality: { status, expected: inventories.length, received: inventories.length - failures } };
  }

  /**
   * Operacoes por lotes de inventory_id (scroll sequencial por lote via
   * fullPagination). Um lote que falha/para mal degrada SO os inventories
   * daquele lote (marcados em `degradedInventoryIds`), nunca a coleta inteira.
   */
  async function fetchOperations({ clienteId, mlUserId, sellerId, inventoryIds, window }) {
    if (inventoryIds.length === 0) {
      return { operations: [], degradedInventoryIds: new Set(), quality: { status: "ok", pages: 0, records: 0 } };
    }

    const batches = chunk(inventoryIds, config.operationsInventoryBatchSize);
    const degradedInventoryIds = new Set();
    let allOperations = [];
    let pages = 0;
    let anyDegraded = false;

    for (const batch of batches) {
      let scrollResult;
      try {
        scrollResult = await runScroll({
          fetchPage: async (cursor) => {
            const page = await mlGateway.searchStockOperations({
              clienteId,
              mlUserId,
              sellerId,
              inventoryIds: batch,
              dateFrom: window.from,
              dateTo: window.to,
              scroll: cursor,
            });
            if (!page.ok) {
              throw Object.assign(new Error("operations_search_failed"), { code: "OPERATIONS_SEARCH_FAILED", status: page.status });
            }
            return { items: page.operations, nextCursor: page.nextCursor };
          },
          maxPages: config.operationsMaxPages,
          maxRecords: config.operationsMaxRecords,
          dedupeKeyFn: (op) => op && op.id,
        });
      } catch (error) {
        anyDegraded = true;
        batch.forEach((id) => degradedInventoryIds.add(id));
        continue;
      }

      pages += scrollResult.pagesFetched;
      allOperations = allOperations.concat(scrollResult.items || []);

      const stoppedBadly = scrollResult.stoppedReason && !["cursor_absent", "empty_page"].includes(scrollResult.stoppedReason);
      if (stoppedBadly) {
        anyDegraded = true;
        batch.forEach((id) => degradedInventoryIds.add(id));
      }
    }

    const deduped = dedupeOperationsById(allOperations);
    return {
      operations: deduped,
      degradedInventoryIds,
      quality: { status: anyDegraded ? "partial" : "ok", pages, records: deduped.length },
    };
  }

  async function collectSnapshot({ clienteContaId, clienteId, clienteSlug, marketplace = "meli", windowDays }) {
    const account = await resolveAccountContext({
      clienteId,
      clienteSlug,
      marketplace,
      clienteContaId,
      requireUsableGrant: true,
    });

    const resolvedClienteId = account.cliente.id;
    const sellerId = account.mlUserId;

    const scan = await scanAllFullItemIds({ clienteId: resolvedClienteId, mlUserId: sellerId, sellerId });

    const itemsResult = await fetchAndParseItems({
      clienteId: resolvedClienteId,
      mlUserId: sellerId,
      clienteContaId,
      sellerId,
      ids: scan.items,
    });

    const stockResult = await fetchStockForInventories({
      clienteId: resolvedClienteId,
      mlUserId: sellerId,
      inventories: itemsResult.inventories,
    });

    const endExclusiveIso = isoDateFromMs(nowFn());
    const window = buildCompletedDayWindow({ endExclusiveIso, days: windowDays });
    const { previousWeek, currentWeek } = splitFourteenDayWindow(window);

    const operationsResult = await fetchOperations({
      clienteId: resolvedClienteId,
      mlUserId: sellerId,
      sellerId,
      inventoryIds: itemsResult.inventories.map((inv) => inv.inventoryId),
      window,
    });

    const salesById = new Map(
      aggregateOperationsByInventory({ operations: operationsResult.operations, previousWeek, currentWeek }).map((s) => [
        s.inventoryId,
        s,
      ])
    );

    // PR6: enriquecimento comercial. Uma unica leitura bulk por conta/periodo
    // (nunca por inventory — ver secao 9 "Evitar N+1"). `fetchBulkCommercial`
    // por contrato nunca rejeita, mas o try/catch aqui e defesa em
    // profundidade: um `commercialAdapter` injetado que quebrar esse
    // contrato NUNCA pode derrubar o snapshot operacional (secao 22, PR6:
    // "Nao bloquear metricas operacionais").
    let commercialResult;
    try {
      commercialResult = await commercialAdapter.fetchBulkCommercial({
        clienteContaId,
        clienteId: resolvedClienteId,
        sellerId,
        period: { from: window.from, to: window.to },
        inventories: itemsResult.inventories,
      });
    } catch {
      commercialResult = { account: { status: "unavailable", reason: "commercial_adapter_error" }, byInventoryId: new Map() };
    }

    const inventoryRows = itemsResult.inventories.map((inv) => {
      const sales = operationsResult.degradedInventoryIds.has(inv.inventoryId) ? null : salesById.get(inv.inventoryId);
      const row = buildInventoryRow({ inv, stock: stockResult.stockById.get(inv.inventoryId), sales, config });
      return { ...row, commercial: commercialResult.byInventoryId.get(inv.inventoryId) || commercialResult.account };
    });

    const movementsByInventory = buildMovementsByInventory(operationsResult.operations, operationsResult.degradedInventoryIds);

    return {
      _internal: { movementsByInventory },
      account: { clienteContaId, clienteId: resolvedClienteId, sellerId, marketplace },
      period: { from: window.from, to: window.to, previousWeek, currentWeek },
      quality: {
        // `commercial` fica de fora do calculo de status geral de proposito:
        // e opcional e tem status independente (secao 12), nunca degrada
        // "complete" para "partial" nem bloqueia o restante do snapshot.
        status: combineQualityStatus([itemsResult.quality.status, stockResult.quality.status, operationsResult.quality.status]),
        sources: {
          items: itemsResult.quality,
          stock: stockResult.quality,
          operations: operationsResult.quality,
          commercial: commercialResult.account,
        },
      },
      inventories: inventoryRows,
      unresolvedReferences: itemsResult.unresolvedReferences,
      invalidIdentities: itemsResult.invalidIdentities,
    };
  }

  async function buildSnapshot({ clienteContaId, clienteId, clienteSlug, marketplace = "meli", windowDays = config.windowDays }) {
    if (windowDays !== 14) {
      throw Object.assign(new Error("janela nao suportada"), { code: "INVALID_FULL_QUERY" });
    }
    if (clienteContaId === null || clienteContaId === undefined) {
      throw new TypeError("clienteContaId e obrigatorio");
    }

    const cacheKey = `${clienteContaId}:${windowDays}:v1`;
    const loaded = await cache.getOrLoad(cacheKey, async () => ({
      value: await collectSnapshot({ clienteContaId, clienteId, clienteSlug, marketplace, windowDays }),
    }));

    return {
      ...loaded.value,
      cache: {
        hit: loaded.source === "cache" || loaded.source === "cache-cooldown" || loaded.source === "single-flight",
        stale: loaded.stale,
        generatedAt: loaded.generatedAt,
        expiresAt: loaded.expiresAt,
        retryAt: loaded.retryAt,
      },
    };
  }

  /** Product360 operacional: detalhe de um inventory_id dentro do snapshot ja coletado/cacheado da conta. */
  async function getInventoryDetail(params) {
    const snapshot = await buildSnapshot(params);
    const row = findInventoryOrThrow(snapshot, params.inventoryId);
    return { ...row, account: snapshot.account, period: snapshot.period };
  }

  /**
   * Movimentos de um inventory_id, servidos do MESMO snapshot cacheado da
   * janela de 14 dias (nunca dispara uma nova chamada ML por inventario).
   * `cursor` e interno/opaco (offset codificado); nunca e o scroll do ML.
   */
  async function getInventoryMovements({ inventoryId, cursor = null, limit = 100, ...rest }) {
    if (!inventoryId) throw new TypeError("inventoryId e obrigatorio");
    const normalizedLimit = Math.min(Math.max(1, Number(limit) || 100), 200);

    const snapshot = await buildSnapshot(rest);
    const row = findInventoryOrThrow(snapshot, inventoryId);
    const movements = (snapshot._internal && snapshot._internal.movementsByInventory.get(inventoryId)) || [];

    const offset = decodeMovementsCursor(cursor);
    const page = movements.slice(offset, offset + normalizedLimit);
    const nextOffset = offset + page.length;

    return {
      inventoryId,
      salesStatus: row.sales.status,
      movements: page,
      nextCursor: nextOffset < movements.length ? encodeMovementsCursor(nextOffset) : null,
      total: movements.length,
    };
  }

  return {
    buildSnapshot,
    getInventoryDetail,
    getInventoryMovements,
    scanAllFullItemIds,
    fetchAndParseItems,
    fetchStockForInventories,
    fetchOperations,
  };
}

module.exports = { createFullService, DEFAULT_CONFIG };
