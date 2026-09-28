// server/services/motorMargem/marginSnapshotRetry.js
// Margin Snapshot — política de retry/backoff por LOTE (M3; Retry-After
// propagado pelo adapter em M8).
//
// DIVISÃO DE RESPONSABILIDADE (uma camada só faz sleep/retry):
//   mlClient.mlFetch        → NÃO faz retry de 429/5xx; só normaliza a
//                             resposta ({ status, retryAfter }) e renova o
//                             token em 401 (infra de token, fora daqui).
//   meliApiEvidenceAdapter  → transforma resposta ruim de lote em exceção,
//                             carregando o status real do ML (`mlStatus`) e o
//                             `retryAfter` em segundos quando o ML mandou.
//   ESTE módulo (worker)    → decide se o lote é recuperável, quanto esperar
//                             e quantas vezes tentar. Nunca existe retry duplo
//                             (mlClient + worker) sobre a mesma chamada.
//
// A cotação por ITEM (sale_price/listing_prices/shipping) nunca lança — já é
// engolida pelo Motor e vira `null` — então nada aqui tenta "consertar" item.

class MarginSnapshotStopError extends Error {
  constructor(message = "Margin Snapshot: worker encerrado durante o processamento do run.") {
    super(message);
    this.name = "MarginSnapshotStopError";
    this.code = "MARGIN_SNAPSHOT_WORKER_STOPPED";
  }
}

function numeroOuNull(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * Classifica a falha de um lote. `mlStatus` (status HTTP real do Mercado
 * Livre) tem precedência sobre `statusCode` (status que o adapter escolheu
 * para a resposta HTTP da Central — 422 para auth, 502 para o resto).
 */
function classificarErroDeLote(err) {
  const retryAfterSeg = numeroOuNull(err?.retryAfter);
  const retryAfterMs = retryAfterSeg !== null && retryAfterSeg >= 0 ? Math.round(retryAfterSeg * 1000) : null;
  const status = numeroOuNull(err?.mlStatus) ?? numeroOuNull(err?.statusCode);
  const rateLimited = status === 429;

  // Retry-After (429 ou 503) é pausa imposta pelo servidor: sempre conta
  // como rate limit, e o tempo pedido é respeitado em vez do backoff.
  if (retryAfterMs !== null) {
    return { retryable: true, rateLimited: true, retryAfterMs, status };
  }
  if (status !== null) {
    if (status === 429 || status === 408 || status >= 500) {
      return { retryable: true, rateLimited, retryAfterMs: null, status };
    }
    // 4xx restante (auth/permissão mapeada para 422, 404, 400) não melhora
    // tentando de novo.
    return { retryable: false, rateLimited: false, retryAfterMs: null, status };
  }
  // Sem status: falha de rede/timeout do fetch. Recuperável, mas sempre
  // limitada pelo número máximo de tentativas.
  return { retryable: true, rateLimited: false, retryAfterMs: null, status: null };
}

function calcularBackoffMs(tentativa, { batchBackoffBaseMs, batchBackoffMaxMs }) {
  const bruto = batchBackoffBaseMs * 2 ** Math.max(0, tentativa - 1);
  return Math.min(bruto, batchBackoffMaxMs);
}

// setTimeout cancelável por AbortSignal — sem busy wait, sem timer órfão.
// Deliberadamente SEM unref(): um run em andamento deve manter o processo
// vivo (senão um processo sem servidor HTTP — CLI/teste — sairia no meio do
// run com exit 0). O encerramento limpo é pelo abort do worker.stop().
function esperar(ms, signal) {
  return new Promise((resolve) => {
    if (!(ms > 0)) return resolve();
    if (signal?.aborted) return resolve();
    let onAbort = null;
    const timer = setTimeout(() => {
      if (onAbort) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal) {
      onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Executa `fn` com a política de retry do lote. Nunca lança por causa de
 * `fn`: devolve `{ ok, value | error, attempts, ... }` para o chamador decidir
 * (o processor trata falha de lote como falha parcial, não como exceção).
 * Só lança MarginSnapshotStopError quando o worker foi encerrado.
 */
async function executarComRetry(fn, { config, sleep = esperar, signal = null, onRetry = null } = {}) {
  const maxTentativas = config.batchMaxAttempts;
  let ultima = null;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa += 1) {
    if (signal?.aborted) throw new MarginSnapshotStopError();
    try {
      const value = await fn(tentativa);
      return { ok: true, value, attempts: tentativa, retries: tentativa - 1, rateLimitedRetries: ultima?.rateLimitedRetries || 0 };
    } catch (error) {
      // Parada do worker nunca é "falha recuperável do lote".
      if (error instanceof MarginSnapshotStopError) throw error;
      const classificacao = classificarErroDeLote(error);
      const rateLimitedRetries = (ultima?.rateLimitedRetries || 0) + (classificacao.rateLimited ? 1 : 0);
      ultima = { error, classificacao, rateLimitedRetries };

      if (!classificacao.retryable) {
        return { ok: false, error, attempts: tentativa, retries: tentativa - 1, classificacao, motivo: "NAO_RECUPERAVEL", rateLimitedRetries };
      }
      if (tentativa >= maxTentativas) {
        return { ok: false, error, attempts: tentativa, retries: tentativa - 1, classificacao, motivo: "TENTATIVAS_ESGOTADAS", rateLimitedRetries };
      }
      if (classificacao.retryAfterMs !== null && classificacao.retryAfterMs > config.retryAfterMaxMs) {
        return { ok: false, error, attempts: tentativa, retries: tentativa - 1, classificacao, motivo: "RETRY_AFTER_EXCEDE_LIMITE", rateLimitedRetries };
      }

      const delayMs = classificacao.retryAfterMs !== null
        ? classificacao.retryAfterMs
        : calcularBackoffMs(tentativa, config);
      if (onRetry) onRetry({ tentativa, delayMs, classificacao, error });
      await sleep(delayMs, signal);
      if (signal?.aborted) throw new MarginSnapshotStopError();
    }
  }
  /* istanbul ignore next — o loop sempre retorna antes */
  return { ok: false, error: ultima?.error, attempts: maxTentativas, classificacao: ultima?.classificacao, motivo: "TENTATIVAS_ESGOTADAS" };
}

module.exports = {
  MarginSnapshotStopError,
  classificarErroDeLote,
  calcularBackoffMs,
  esperar,
  executarComRetry,
};
