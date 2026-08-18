"use strict";

// Cache curto em memoria + single-flight por chave, para a coleta on-demand
// da Central de Gestao Full (secao 10 do plano auditado). Sem Express, sem
// Mercado Livre, sem process.env — apenas Map + Promise, com relogio
// injetavel.
//
// Duas nocoes de tempo sao mantidas separadas de proposito:
//   freshUntil     -> so avanca em carga bem sucedida; define `stale` para
//                     quem consome o cache (a verdade sobre a idade do dado).
//   retryNotBefore -> so importa apos uma falha; define quando a PROXIMA
//                     chamada pode tentar recarregar de novo, para nao
//                     martelar o Mercado Livre durante o TTL curto de erro.
// Um valor marcado como erro e sempre `stale=true` para quem consome,
// mesmo enquanto ainda esta dentro do cooldown de retry.
//
// Responsabilidade que este arquivo NAO tem: nunca guardar token,
// Authorization ou cursor de scroll. Isso e obrigacao de quem monta o
// `value` armazenado (fullService/controller), nao deste cache generico.

function createFullCache({
  successTtlMs = 3 * 60 * 1000,
  errorTtlMs = 15 * 1000,
  maxEntries = 200,
  nowFn = () => Date.now(),
} = {}) {
  if (!Number.isFinite(successTtlMs) || successTtlMs < 0) {
    throw new TypeError("successTtlMs deve ser um numero >= 0");
  }
  if (!Number.isFinite(errorTtlMs) || errorTtlMs < 0) {
    throw new TypeError("errorTtlMs deve ser um numero >= 0");
  }
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError("maxEntries deve ser um inteiro >= 1");
  }

  const entries = new Map(); // key -> { value, generatedAt, freshUntil, retryNotBefore, retryAt, isError }
  const inFlight = new Map(); // key -> Promise<void>

  function touch(key) {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    entries.set(key, entry); // reinsercao = mais recentemente usado (LRU simples)
  }

  function evict() {
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      entries.delete(oldestKey);
    }
  }

  /** Estado atual da chave, sem disparar carregamento. */
  function snapshot(key) {
    const entry = entries.get(key);
    if (!entry) {
      return { hit: false, stale: false, value: undefined, generatedAt: null, expiresAt: null, retryAt: null, isError: false };
    }
    touch(key);
    const stale = entry.isError || nowFn() >= entry.freshUntil;
    return {
      hit: true,
      stale,
      value: entry.value,
      generatedAt: entry.generatedAt,
      expiresAt: entry.freshUntil,
      retryAt: entry.retryAt,
      isError: entry.isError,
    };
  }

  function canAttemptReload(key) {
    const entry = entries.get(key);
    if (!entry) return true;
    const now = nowFn();
    return entry.isError ? now >= entry.retryNotBefore : now >= entry.freshUntil;
  }

  function storeSuccess(key, value, retryAt) {
    const now = nowFn();
    entries.set(key, {
      value,
      generatedAt: now,
      freshUntil: now + successTtlMs,
      retryNotBefore: now,
      retryAt,
      isError: false,
    });
    touch(key);
    evict();
  }

  /** Preserva o `generatedAt` original: o dado nao ficou mais novo so porque a tentativa de atualizar falhou. */
  function storeErrorFallback(key, previous, retryAt) {
    const now = nowFn();
    entries.set(key, {
      value: previous.value,
      generatedAt: previous.generatedAt,
      freshUntil: previous.expiresAt,
      retryNotBefore: now + errorTtlMs,
      retryAt,
      isError: true,
    });
    touch(key);
    evict();
  }

  /**
   * Devolve o valor fresco em cache; senao dispara `loadFn` uma unica vez
   * por chave, mesmo com chamadas concorrentes (single-flight). Enquanto um
   * erro anterior estiver dentro do seu cooldown curto, novas chamadas
   * apenas repetem o ultimo snapshot (stale/erro) em vez de martelar a
   * origem de novo. Se `loadFn` falhar e houver um valor anterior, esse
   * valor e preservado e devolvido marcado como erro/stale — uma coleta
   * ruim nunca apaga o ultimo snapshot bom. Sem valor anterior, a falha e
   * propagada para quem chamou.
   *
   * `loadFn` deve devolver `{ value, retryAt? }`.
   */
  async function getOrLoad(key, loadFn) {
    const current = snapshot(key);
    if (current.hit && !current.stale) {
      return { ...current, source: "cache" };
    }

    if (current.hit && current.stale && !canAttemptReload(key)) {
      return { ...current, source: "cache-cooldown" };
    }

    if (inFlight.has(key)) {
      await inFlight.get(key);
      return { ...snapshot(key), source: "single-flight" };
    }

    const promise = (async () => {
      try {
        const loaded = await loadFn();
        storeSuccess(key, loaded.value, loaded && loaded.retryAt !== undefined ? loaded.retryAt : null);
      } catch (error) {
        if (current.hit) {
          storeErrorFallback(key, current, current.retryAt);
        } else {
          entries.delete(key);
          throw error;
        }
      } finally {
        inFlight.delete(key);
      }
    })();

    inFlight.set(key, promise);
    await promise;
    return { ...snapshot(key), source: current.hit ? "reload" : "load" };
  }

  return { snapshot, getOrLoad, size: () => entries.size };
}

module.exports = { createFullCache };
