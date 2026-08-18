"use strict";

// Scroll generico da Central de Gestao Full: consome paginas
// sequencialmente (nunca em paralelo) atraves de um `fetchPage` injetado,
// sem conhecer se o cursor por tras se chama `scroll_id` (scan de itens) ou
// `scroll` (operacoes) — essa traducao de campo e responsabilidade de quem
// fornece `fetchPage` (fullMlGateway).
//
// Nao faz HTTP e nao aplica retry: espera que `fetchPage` ja tenha lidado
// com isso (fullRetry). Aqui a responsabilidade e so cursor, limites,
// deadline, ciclo e expiracao/reinicio.

/**
 * `fetchPage(cursor)` deve devolver `{ items, nextCursor, expired }`.
 * `expired: true` sinaliza que o scroll (5 minutos) venceu no meio da
 * cadeia; o restante dos campos e ignorado nesse caso.
 *
 * Retorna `{ items, pagesFetched, restarted, stoppedReason }`.
 * `stoppedReason` é sempre um destes:
 *   "cursor_absent" | "empty_page" | "max_pages" | "max_records" |
 *   "deadline_exceeded" | "scroll_cycle_detected" | "scroll_expired"
 */
async function runScroll({
  fetchPage,
  initialCursor = null,
  maxPages,
  maxRecords,
  dedupeKeyFn = null,
  allowRestart = true,
  nowFn = () => Date.now(),
  deadlineMs = null,
}) {
  if (typeof fetchPage !== "function") {
    throw new TypeError("fetchPage deve ser uma funcao");
  }
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new TypeError("maxPages deve ser um inteiro >= 1");
  }
  if (!Number.isInteger(maxRecords) || maxRecords < 1) {
    throw new TypeError("maxRecords deve ser um inteiro >= 1");
  }

  const startedAtMs = nowFn();
  const seenCursors = new Set();

  let cursor = initialCursor;
  let items = [];
  let pagesFetched = 0;
  let restarted = false;
  let stoppedReason = null;

  while (true) {
    if (deadlineMs !== null && nowFn() - startedAtMs >= deadlineMs) {
      stoppedReason = "deadline_exceeded";
      break;
    }
    if (pagesFetched >= maxPages) {
      stoppedReason = "max_pages";
      break;
    }

    const page = await fetchPage(cursor);
    pagesFetched += 1;

    if (page && page.expired) {
      if (allowRestart && !restarted) {
        restarted = true;
        cursor = initialCursor;
        seenCursors.clear();
        continue;
      }
      stoppedReason = "scroll_expired";
      break;
    }

    const pageItems = Array.isArray(page && page.items) ? page.items : [];
    items = items.concat(pageItems);

    if (items.length > maxRecords) {
      items = items.slice(0, maxRecords);
      stoppedReason = "max_records";
      break;
    }

    if (pageItems.length === 0) {
      stoppedReason = "empty_page";
      break;
    }

    const nextCursor = page && page.nextCursor;
    if (nextCursor === null || nextCursor === undefined || nextCursor === "") {
      stoppedReason = "cursor_absent";
      break;
    }
    if (seenCursors.has(nextCursor)) {
      stoppedReason = "scroll_cycle_detected";
      break;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  const finalItems = dedupeKeyFn ? dedupeByKey(items, dedupeKeyFn) : items;

  return { items: finalItems, pagesFetched, restarted, stoppedReason };
}

function dedupeByKey(items, keyFn) {
  const seen = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!seen.has(key)) seen.set(key, item);
  }
  return Array.from(seen.values());
}

module.exports = {
  runScroll,
  dedupeByKey,
};
