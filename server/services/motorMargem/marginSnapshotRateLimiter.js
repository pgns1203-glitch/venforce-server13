// server/services/motorMargem/marginSnapshotRateLimiter.js
// Margin Snapshot — rate limiter LOCAL ao processo (M8).
//
// Não é um limitador distribuído (sem Redis, por decisão do plano): vale
// para os runs que ESTE processo executa. Duas regras, sem busy wait:
//
//   1. Espaçamento: dois inícios de lote (de qualquer run/conta do processo)
//      ficam a pelo menos `minIntervalMs` um do outro. Cada chamador
//      RESERVA seu horário (reserva sequencial) e dorme só o necessário —
//      nunca polling de "já posso?".
//   2. Cooldown global após 429: o rate limit do Mercado Livre é por
//      aplicação, não por conta — quando um lote de qualquer conta recebe
//      429/Retry-After, TODOS os runs do processo esperam aquele tempo antes
//      do próximo lote, em vez de cada um continuar batendo no ML.
//
// O paralelismo DENTRO de um lote (CONCURRENCY do enrichBatch) não é
// alterado aqui; o retry do lote continua em marginSnapshotRetry.

const { esperar } = require("./marginSnapshotRetry");

function createRateLimiter({ minIntervalMs = 0, now = () => Date.now(), sleep = esperar } = {}) {
  let proximoInicio = 0;
  let pausaAte = 0;

  async function aguardarVez(signal) {
    const agora = now();
    const inicio = Math.max(agora, proximoInicio, pausaAte);
    proximoInicio = inicio + minIntervalMs;
    const espera = inicio - agora;
    if (espera > 0) await sleep(espera, signal);
    return espera;
  }

  function penalizar(ms) {
    if (!(ms > 0)) return;
    pausaAte = Math.max(pausaAte, now() + ms);
  }

  function estado() {
    const agora = now();
    return {
      minIntervalMs,
      cooldownRestanteMs: Math.max(0, pausaAte - agora),
      proximoInicioEmMs: Math.max(0, proximoInicio - agora),
    };
  }

  return { aguardarVez, penalizar, estado };
}

// Um limiter por processo (compartilhado por todos os runs deste worker).
let limiterDoProcesso = null;

function obterLimiterDoProcesso(config) {
  if (!limiterDoProcesso) limiterDoProcesso = createRateLimiter({ minIntervalMs: config.batchPauseMs });
  return limiterDoProcesso;
}

module.exports = { createRateLimiter, obterLimiterDoProcesso };
