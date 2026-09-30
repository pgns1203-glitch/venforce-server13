// server/services/promoSnapshot/promoSnapshotConfig.js
// Promo Snapshot — configuração (env com defaults CONSERVADORES e tetos
// rígidos, mesmo padrão de marginSnapshotConfig). Lida por chamada para
// testes/boot injetarem `env` sem mexer em process.env.
//
// Liga/desliga: PROMO_SNAPSHOT_WORKER_ENABLED=true (opt-in, default
// desligado — mesmo padrão de MARGIN_SNAPSHOT_WORKER_ENABLED). Desligado:
// nenhum worker, nenhum orquestrador, nenhum enqueue automático; a Central
// continua lendo o último snapshot (ou o diagnóstico legado).

function inteiroEntre(raw, { padrao, min, max }) {
  const n = Number(raw);
  if (raw === undefined || raw === null || raw === "" || !Number.isFinite(n)) return padrao;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function fracaoEntre(raw, { padrao, min, max }) {
  const n = Number(raw);
  if (raw === undefined || raw === null || raw === "" || !Number.isFinite(n)) return padrao;
  return Math.min(Math.max(n, min), max);
}

function flagLigada(raw, padrao = false) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return padrao;
  return String(raw).trim().toLowerCase() === "true";
}

function resolvePromoSnapshotConfig(env = process.env) {
  return {
    workerEnabled: flagLigada(env.PROMO_SNAPSHOT_WORKER_ENABLED),

    // Freshness — REUTILIZA PROMO_SNAPSHOT_FRESH_MINUTES da tela antiga
    // (promocoesDiagnosticoService, default 6 h).
    freshMinutes: inteiroEntre(env.PROMO_SNAPSHOT_FRESH_MINUTES, { padrao: 360, min: 15, max: 10080 }),

    // Runs simultâneos por processo (lotes de uma conta nunca em paralelo).
    workerConcurrency: inteiroEntre(env.PROMO_SNAPSHOT_WORKER_CONCURRENCY, { padrao: 1, min: 1, max: 3 }),
    workerPollMs: inteiroEntre(env.PROMO_SNAPSHOT_WORKER_POLL_MS, { padrao: 15000, min: 1000, max: 600000 }),

    // Chamadas ao ML: concorrência por lote, espaçamento mínimo entre
    // requisições no processo e timeout real por requisição.
    itemConcurrency: inteiroEntre(env.PROMO_SNAPSHOT_ITEM_CONCURRENCY, { padrao: 3, min: 1, max: 8 }),
    requestIntervalMs: inteiroEntre(env.PROMO_SNAPSHOT_REQUEST_INTERVAL_MS, { padrao: 100, min: 0, max: 10000 }),
    requestTimeoutMs: inteiroEntre(env.PROMO_SNAPSHOT_REQUEST_TIMEOUT_MS, { padrao: 15000, min: 1000, max: 120000 }),
    batchSize: inteiroEntre(env.PROMO_SNAPSHOT_BATCH_SIZE, { padrao: 20, min: 1, max: 100 }),

    // Retry por requisição (mesma política de marginSnapshotRetry).
    batchMaxAttempts: inteiroEntre(env.PROMO_SNAPSHOT_MAX_ATTEMPTS, { padrao: 3, min: 1, max: 6 }),
    batchBackoffBaseMs: inteiroEntre(env.PROMO_SNAPSHOT_BACKOFF_BASE_MS, { padrao: 2000, min: 0, max: 60000 }),
    batchBackoffMaxMs: inteiroEntre(env.PROMO_SNAPSHOT_BACKOFF_MAX_MS, { padrao: 30000, min: 0, max: 300000 }),
    retryAfterMaxMs: inteiroEntre(env.PROMO_SNAPSHOT_RETRY_AFTER_MAX_MS, { padrao: 120000, min: 0, max: 900000 }),
    // N lotes seguidos com TODOS os itens falhando = falha estrutural.
    maxConsecutiveBatchFailures: inteiroEntre(env.PROMO_SNAPSHOT_MAX_CONSECUTIVE_BATCH_FAILURES, { padrao: 3, min: 1, max: 50 }),

    // Teto do catálogo: estourar = falha explícita, nunca truncamento.
    maxCatalogItems: inteiroEntre(env.PROMO_SNAPSHOT_MAX_CATALOG_ITEMS, { padrao: 20000, min: 1, max: 200000 }),

    // Recovery: running sem heartbeat há mais que isto → failed (STALE).
    runningStaleMinutes: inteiroEntre(env.PROMO_SNAPSHOT_RUNNING_STALE_MINUTES, { padrao: 10, min: 2, max: 1440 }),
    // Retomada: um run interrompido há menos que isto tem os lotes concluídos
    // reaproveitados pelo próximo run da conta.
    resumeMaxMinutes: inteiroEntre(env.PROMO_SNAPSHOT_RESUME_MAX_MINUTES, { padrao: 60, min: 0, max: 1440 }),

    // partial vira snapshot atual só se falhas/total <= isto.
    partialMaxFailRatio: fracaoEntre(env.PROMO_SNAPSHOT_PARTIAL_MAX_FAIL_RATIO, { padrao: 0.05, min: 0, max: 0.5 }),

    // Cooldown do gatilho manual (reusa PROMO_SAME_CLIENT_COOLDOWN_MINUTES da
    // tela antiga, agora por CONTA) e espera depois de uma falha antes de o
    // auto-trigger tentar de novo.
    manualCooldownMinutes: inteiroEntre(env.PROMO_SAME_CLIENT_COOLDOWN_MINUTES, { padrao: 15, min: 0, max: 1440 }),
    failedRetryMinutes: inteiroEntre(env.PROMO_SNAPSHOT_FAILED_RETRY_MINUTES, { padrao: 30, min: 1, max: 1440 }),

    // Orquestrador (mesmo runtime do worker): a cada intervalo enfileira até N
    // contas elegíveis vencidas/sem snapshot.
    orchestratorIntervalMs: inteiroEntre(env.PROMO_SNAPSHOT_ORCHESTRATOR_INTERVAL_MS, { padrao: 300000, min: 10000, max: 86400000 }),
    orchestratorMaxPerTick: inteiroEntre(env.PROMO_SNAPSHOT_ORCHESTRATOR_MAX_PER_TICK, { padrao: 5, min: 1, max: 100 }),

    // Enriquecimentos opcionais (1 chamada por item com promoção started para
    // saber qual forma o preço; 1 por campanha sem vigência, com cache no run).
    resolveActive: flagLigada(env.PROMO_SNAPSHOT_RESOLVE_ACTIVE, true),
    resolveVigencia: flagLigada(env.PROMO_SNAPSHOT_RESOLVE_VIGENCIA, true),
  };
}

module.exports = { resolvePromoSnapshotConfig, flagLigada };
