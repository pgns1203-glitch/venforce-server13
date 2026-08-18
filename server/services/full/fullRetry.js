"use strict";

// Politica testavel de retry/backoff/deadline/concorrencia da Central de
// Gestao Full. Nada aqui faz I/O: relogio, sleep e aleatoriedade sao sempre
// injetaveis, para que os testes sejam deterministicos.
//
// Retry apenas em GET idempotente com 429/500/502/503/504. 400/401/403/404
// nunca sao retentados aqui: 401 e responsabilidade do refresh unico do
// mlFetch: se persistir, quem chama fullRetry deve tratar como grant_invalid,
// nao insistir.

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function isRetryableStatus(status) {
  return RETRYABLE_STATUSES.has(status);
}

/**
 * Converte um valor de Retry-After (segundos ou HTTP-date) em milissegundos
 * a partir de `nowMs`. Retorna null quando ausente ou nao interpretavel.
 * `mlFetch` hoje so expoe a forma numerica (ja documentado como limitacao);
 * esta funcao aceita as duas formas para nao travar o contrato quando essa
 * limitacao for resolvida a montante.
 */
function parseRetryAfterMs(headerValue, { nowMs } = {}) {
  if (headerValue === null || headerValue === undefined || headerValue === "") {
    return null;
  }

  const trimmed = String(headerValue).trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
  }

  const parsedMs = Date.parse(trimmed);
  if (Number.isNaN(parsedMs)) return null;

  const reference = typeof nowMs === "number" ? nowMs : Date.now();
  const deltaMs = parsedMs - reference;
  return deltaMs > 0 ? deltaMs : 0;
}

/**
 * Backoff exponencial com full jitter: random(0, min(capMs, baseMs*2^attempt)).
 * `attempt` e 0-based (primeira nova tentativa = attempt 0).
 */
function computeBackoffDelayMs({ attempt, baseMs, capMs, randomFn = Math.random }) {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new TypeError("attempt deve ser um inteiro >= 0");
  }
  if (!Number.isFinite(baseMs) || baseMs < 0) {
    throw new TypeError("baseMs deve ser um numero >= 0");
  }
  if (!Number.isFinite(capMs) || capMs < 0) {
    throw new TypeError("capMs deve ser um numero >= 0");
  }

  const exponential = baseMs * 2 ** attempt;
  const cappedMax = Math.min(capMs, exponential);
  return randomFn() * cappedMax;
}

/**
 * Executa `attempt(attemptIndex)` com retry controlado.
 *
 * `attempt` deve devolver `{ ok, status, data, retryAfterHeader }`. Em
 * sucesso (`ok`), retorna imediatamente. Em falha retryavel dentro do
 * orcamento de tentativas e do deadline, aguarda (Retry-After se presente,
 * senao backoff+jitter) e tenta de novo. Nunca insiste em 400/401/403/404.
 *
 * `deadlineMs`, quando informado, e um teto de tempo decorrido total
 * (medido via `nowFn`); ao estourar, para sem nova tentativa e marca
 * `timedOut: true`.
 */
async function executeWithRetry({
  attempt,
  maxAttempts,
  baseMs,
  capMs,
  retryAfterCapMs,
  sleepFn,
  randomFn = Math.random,
  nowFn = () => Date.now(),
  deadlineMs = null,
}) {
  if (typeof attempt !== "function") {
    throw new TypeError("attempt deve ser uma funcao");
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError("maxAttempts deve ser um inteiro >= 1");
  }
  if (typeof sleepFn !== "function") {
    throw new TypeError("sleepFn e obrigatorio e deve ser injetavel");
  }

  const startedAtMs = nowFn();
  let lastResult = null;

  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    if (deadlineMs !== null && nowFn() - startedAtMs >= deadlineMs) {
      return {
        ok: false,
        status: lastResult ? lastResult.status : null,
        data: lastResult ? lastResult.data : null,
        attempts: attemptIndex,
        exhausted: true,
        timedOut: true,
      };
    }

    lastResult = await attempt(attemptIndex);

    if (lastResult.ok) {
      return { ...lastResult, attempts: attemptIndex + 1, exhausted: false, timedOut: false };
    }

    const canRetry = isRetryableStatus(lastResult.status) && attemptIndex < maxAttempts - 1;
    if (!canRetry) {
      return { ...lastResult, attempts: attemptIndex + 1, exhausted: true, timedOut: false };
    }

    const retryAfterMs = parseRetryAfterMs(lastResult.retryAfterHeader, { nowMs: nowFn() });
    const delayMs =
      retryAfterMs !== null
        ? Math.min(retryAfterMs, retryAfterCapMs)
        : computeBackoffDelayMs({ attempt: attemptIndex, baseMs, capMs, randomFn });

    await sleepFn(delayMs);
  }

  return { ...lastResult, attempts: maxAttempts, exhausted: true, timedOut: false };
}

/**
 * Pool simples de concorrencia (mesmo espirito do pLimit usado em
 * centralVendasFreteService/diagnosticoService, reproduzido aqui sem
 * importar aqueles modulos). `limit(fn)` enfileira `fn` quando o numero de
 * execucoes ativas atinge `concurrency`.
 */
function createConcurrencyLimiter(concurrency) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError("concurrency deve ser um inteiro >= 1");
  }

  const queue = [];
  let active = 0;

  function next() {
    active -= 1;
    if (queue.length > 0) queue.shift()();
  }

  return function limit(fn) {
    return new Promise((resolve, reject) => {
      const run = () => {
        active += 1;
        Promise.resolve()
          .then(fn)
          .then((value) => {
            next();
            resolve(value);
          })
          .catch((error) => {
            next();
            reject(error);
          });
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
  };
}

module.exports = {
  isRetryableStatus,
  parseRetryAfterMs,
  computeBackoffDelayMs,
  executeWithRetry,
  createConcurrencyLimiter,
};
