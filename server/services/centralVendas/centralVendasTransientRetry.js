// server/services/centralVendas/centralVendasTransientRetry.js
// Retry curto e LIMITADO para erros transitórios do PostgreSQL na Central de
// Vendas. Só repete o que o PostgreSQL manda repetir:
//   40P01 deadlock_detected      — esta transação foi escolhida como vítima
//   40001 serialization_failure  — idem
// Qualquer outro erro (autenticação, constraint, HTTP, bug) sobe na primeira
// tentativa: repetir esconderia o problema e, em efeito externo, duplicaria.
//
// Quem chama é responsável por só envolver trabalho IDEMPOTENTE e apenas de
// banco (a transação inteira é reexecutada do zero, num client novo).

const PG_CODIGOS_TRANSITORIOS = new Set(["40P01", "40001"]);
const MAX_TENTATIVAS = 3; // totais, incluindo a primeira
const BACKOFF_BASE_MS = 250;

function isTransientPgError(err) {
  return PG_CODIGOS_TRANSITORIOS.has(err?.code);
}

// Exponencial + jitter: com base 250 → ~250–500ms antes da 2ª tentativa e
// ~500–750ms antes da 3ª. O jitter evita que as vítimas de um mesmo deadlock
// voltem juntas e colidam de novo.
function calcularBackoffMs(tentativaFalha, { baseMs = BACKOFF_BASE_MS, random = Math.random } = {}) {
  return baseMs * 2 ** (tentativaFalha - 1) + Math.floor(random() * baseMs);
}

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {(tentativa:number) => Promise<any>} operacao  recebe o nº da tentativa (1..max)
 * @param {object} [opts]
 * @param {number} [opts.maxTentativas]
 * @param {(ms:number)=>Promise<void>} [opts.sleep]
 * @param {()=>number} [opts.random]
 * @param {number} [opts.baseMs]
 * @param {(info:{tentativa:number,maxTentativas:number,err:Error,esperaMs:number})=>void} [opts.onRetry]
 *        chamado antes de dormir; `tentativa` é a PRÓXIMA (2/3, 3/3).
 */
async function comRetryTransitorio(operacao, {
  maxTentativas = MAX_TENTATIVAS, sleep = dormir, random = Math.random, baseMs = BACKOFF_BASE_MS, onRetry = null,
} = {}) {
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      return await operacao(tentativa);
    } catch (err) {
      if (!isTransientPgError(err) || tentativa >= maxTentativas) throw err;
      const esperaMs = calcularBackoffMs(tentativa, { baseMs, random });
      if (typeof onRetry === "function") onRetry({ tentativa: tentativa + 1, maxTentativas, err, esperaMs });
      await sleep(esperaMs);
    }
  }
}

module.exports = {
  isTransientPgError,
  calcularBackoffMs,
  comRetryTransitorio,
  MAX_TENTATIVAS,
  BACKOFF_BASE_MS,
  PG_CODIGOS_TRANSITORIOS,
};
