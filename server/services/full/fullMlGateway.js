"use strict";

// Unico lugar da Central de Gestao Full que conhece URL, querystring e
// envelope de resposta do Mercado Livre. Toda chamada passa por `mlFetch`
// (server/utils/mlClient.js) e exige `clienteId` + `mlUserId` explicitos —
// nunca ha grant implicito nem fallback silencioso entre contas.
//
// Cada metodo aplica a politica de retry de `fullRetry.executeWithRetry`.
// Paginacao (scan/scroll) NAO acontece aqui: cada metodo busca uma pagina;
// quem varre o scroll inteiro e `fullPagination.runScroll`, ainda nao
// conectado neste PR (isso e orquestracao, fica para o service da fase 3).
//
// Nenhuma rota chama este arquivo ainda.

const { mlFetch: defaultMlFetch } = require("../../utils/mlClient");
const { executeWithRetry } = require("./fullRetry");

const DEFAULT_RETRY_CONFIG = Object.freeze({
  maxAttempts: 3,
  baseMs: 250,
  capMs: 4000,
  retryAfterCapMs: 10000,
});

const MULTIGET_MAX_IDS = 20;

function assertPresent(value, message) {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new TypeError(message);
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cria um gateway Full. Dependencias injetaveis para teste:
 *   requestFn(clienteId, path, { mlUserId }) -> { ok, status, data, retryAfter }
 *   sleepFn, randomFn, nowFn -> repassados ao fullRetry
 */
function createFullMlGateway({
  requestFn = defaultMlFetch,
  sleepFn = defaultSleep,
  randomFn = Math.random,
  nowFn = () => Date.now(),
  retryConfig = DEFAULT_RETRY_CONFIG,
} = {}) {
  async function callMl({ clienteId, mlUserId, path, deadlineMs = null }) {
    assertPresent(clienteId, "clienteId e obrigatorio para qualquer chamada Full ao Mercado Livre");
    assertPresent(mlUserId, "mlUserId e obrigatorio para qualquer chamada Full ao Mercado Livre");

    return executeWithRetry({
      attempt: async () => {
        const res = await requestFn(clienteId, path, { mlUserId });
        return {
          ok: !!(res && res.ok),
          status: res ? res.status : null,
          data: res ? res.data : null,
          retryAfterHeader: res ? res.retryAfter : null,
        };
      },
      maxAttempts: retryConfig.maxAttempts,
      baseMs: retryConfig.baseMs,
      capMs: retryConfig.capMs,
      retryAfterCapMs: retryConfig.retryAfterCapMs,
      sleepFn,
      randomFn,
      nowFn,
      deadlineMs,
    });
  }

  /**
   * Uma pagina do scan de itens Full da conta.
   * GET /users/{seller_id}/items/search?logistic_type=fulfillment&search_type=scan&limit=100[&scroll_id=...]
   */
  async function searchFullItems({ clienteId, mlUserId, sellerId, scrollId = null, limit = 100, deadlineMs }) {
    assertPresent(sellerId, "sellerId e obrigatorio para listar itens Full");

    const query = new URLSearchParams({
      logistic_type: "fulfillment",
      search_type: "scan",
      limit: String(limit),
    });
    if (scrollId) query.set("scroll_id", scrollId);

    const path = `/users/${encodeURIComponent(sellerId)}/items/search?${query.toString()}`;
    const result = await callMl({ clienteId, mlUserId, path, deadlineMs });
    if (!result.ok) return result;

    const ids = Array.isArray(result.data && result.data.results) ? result.data.results : [];
    const nextCursor = (result.data && result.data.scroll_id) || null;
    return { ...result, ids, nextCursor };
  }

  /**
   * Multiget de detalhes de itens. Maximo oficial de 20 ids por chamada.
   * Desembrulha o envelope `{code, body}` do multiget: `items` traz os
   * bodies com HTTP 200; `itemErrors` traz os ids que falharam no lote.
   */
  async function multigetItems({ clienteId, mlUserId, ids, deadlineMs }) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new TypeError("ids deve ser um array nao vazio para multiget");
    }
    if (ids.length > MULTIGET_MAX_IDS) {
      throw new TypeError(`multiget aceita no maximo ${MULTIGET_MAX_IDS} ids por chamada`);
    }

    const path = `/items?ids=${ids.map((id) => encodeURIComponent(id)).join(",")}`;
    const result = await callMl({ clienteId, mlUserId, path, deadlineMs });
    if (!result.ok) return result;

    const entries = Array.isArray(result.data) ? result.data : [];
    const items = [];
    const itemErrors = [];
    for (const entry of entries) {
      if (entry && entry.code === 200 && entry.body) {
        items.push(entry.body);
      } else {
        itemErrors.push({ id: entry && entry.body && entry.body.id, code: entry ? entry.code : null });
      }
    }
    return { ...result, items, itemErrors };
  }

  /**
   * Estoque fisico de um inventory_id.
   * GET /inventories/{inventory_id}/stock/fulfillment?include_attributes=conditions
   */
  async function getInventoryStock({ clienteId, mlUserId, inventoryId, deadlineMs }) {
    assertPresent(inventoryId, "inventoryId e obrigatorio para consultar estoque");
    const path = `/inventories/${encodeURIComponent(inventoryId)}/stock/fulfillment?include_attributes=conditions`;
    return callMl({ clienteId, mlUserId, path, deadlineMs });
  }

  /**
   * Uma pagina de operacoes de estoque para uma lista de inventory_ids.
   * GET /stock/fulfillment/operations/search
   */
  async function searchStockOperations({
    clienteId,
    mlUserId,
    sellerId,
    inventoryIds,
    dateFrom,
    dateTo,
    scroll = null,
    limit = 1000,
    deadlineMs,
  }) {
    assertPresent(sellerId, "sellerId e obrigatorio para buscar operacoes de estoque");
    if (!Array.isArray(inventoryIds) || inventoryIds.length === 0) {
      throw new TypeError("inventoryIds deve ser um array nao vazio para buscar operacoes");
    }
    assertPresent(dateFrom, "dateFrom e obrigatorio para buscar operacoes");
    assertPresent(dateTo, "dateTo e obrigatorio para buscar operacoes");

    const query = new URLSearchParams({
      seller_id: String(sellerId),
      inventory_ids: inventoryIds.join(","),
      date_from: dateFrom,
      date_to: dateTo,
      limit: String(limit),
    });
    if (scroll) query.set("scroll", scroll);

    const path = `/stock/fulfillment/operations/search?${query.toString()}`;
    const result = await callMl({ clienteId, mlUserId, path, deadlineMs });
    if (!result.ok) return result;

    const operations = Array.isArray(result.data && result.data.results) ? result.data.results : [];
    const nextCursor = (result.data && result.data.scroll) || null;
    return { ...result, operations, nextCursor };
  }

  /**
   * Detalhe de uma operacao especifica. Uso pontual sob demanda do usuario,
   * nunca em loop de carregamento inicial.
   * GET /stock/fulfillment/operations/{operation_id}
   */
  async function getStockOperationDetail({ clienteId, mlUserId, operationId, deadlineMs }) {
    assertPresent(operationId, "operationId e obrigatorio para detalhar uma operacao");
    const path = `/stock/fulfillment/operations/${encodeURIComponent(operationId)}`;
    return callMl({ clienteId, mlUserId, path, deadlineMs });
  }

  return {
    searchFullItems,
    multigetItems,
    getInventoryStock,
    searchStockOperations,
    getStockOperationDetail,
  };
}

module.exports = {
  createFullMlGateway,
  DEFAULT_RETRY_CONFIG,
  MULTIGET_MAX_IDS,
};
