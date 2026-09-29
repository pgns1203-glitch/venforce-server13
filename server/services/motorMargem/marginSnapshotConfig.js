// server/services/motorMargem/marginSnapshotConfig.js
// Margin Snapshot — configuração do worker/processor (M3).
//
// Tudo vem de env, com defaults CONSERVADORES e tetos rígidos: um valor
// absurdo em env nunca vira "retry infinito" nem "20 runs simultâneos". A
// leitura é por chamada (não no load do módulo) para que testes e o boot
// possam injetar um `env` próprio sem monkeypatch de process.env.

function inteiroEntre(raw, { padrao, min, max }) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function flagLigada(raw) {
  return String(raw ?? "").trim().toLowerCase() === "true";
}

function resolveMarginSnapshotConfig(env = process.env) {
  return {
    // Tentativas por lote (a 1ª conta). 1 = sem retry.
    batchMaxAttempts: inteiroEntre(env.MARGIN_SNAPSHOT_BATCH_MAX_ATTEMPTS, { padrao: 3, min: 1, max: 6 }),
    // Backoff exponencial do lote: base * 2^(tentativa-1), limitado ao teto.
    batchBackoffBaseMs: inteiroEntre(env.MARGIN_SNAPSHOT_BATCH_BACKOFF_BASE_MS, { padrao: 2000, min: 0, max: 60000 }),
    batchBackoffMaxMs: inteiroEntre(env.MARGIN_SNAPSHOT_BATCH_BACKOFF_MAX_MS, { padrao: 30000, min: 0, max: 300000 }),
    // Retry-After maior que isto não é esperado dentro do worker: o lote é
    // dado como falho (o ML está pedindo uma pausa longa demais para segurar
    // um run aberto com heartbeat).
    retryAfterMaxMs: inteiroEntre(env.MARGIN_SNAPSHOT_RETRY_AFTER_MAX_MS, { padrao: 120000, min: 0, max: 900000 }),
    // Circuit breaker: N lotes seguidos falhando definitivamente = falha
    // estrutural (ML fora, rate limit persistente) → o run termina failed.
    maxConsecutiveBatchFailures: inteiroEntre(env.MARGIN_SNAPSHOT_MAX_CONSECUTIVE_BATCH_FAILURES, { padrao: 3, min: 1, max: 50 }),
    // Intervalo mínimo entre INÍCIOS de lote no processo inteiro (todos os
    // runs/contas — marginSnapshotRateLimiter). Não substitui o CONCURRENCY
    // interno de enrichBatch — só espaça os lotes.
    batchPauseMs: inteiroEntre(env.MARGIN_SNAPSHOT_BATCH_PAUSE_MS, { padrao: 250, min: 0, max: 60000 }),
    // Recovery (M8): run `running` sem heartbeat há mais que isto é tratado
    // como morto (processo reiniciado/travado) e vira failed. O heartbeat é
    // renovado a cada lote; um lote nunca espera mais que o teto de
    // Retry-After/backoff (minutos), então 10 min é folgado.
    runningStaleMinutes: inteiroEntre(env.MARGIN_SNAPSHOT_RUNNING_STALE_MINUTES, { padrao: 10, min: 2, max: 1440 }),
    // Runs simultâneos por processo. Lotes de UMA conta nunca rodam em
    // paralelo (loop sequencial + no máximo 1 run ativo por conta).
    workerConcurrency: inteiroEntre(env.MARGIN_SNAPSHOT_WORKER_CONCURRENCY, { padrao: 1, min: 1, max: 3 }),
    // Polling de pickup de runs criados por outra instância/processo.
    workerPollMs: inteiroEntre(env.MARGIN_SNAPSHOT_WORKER_POLL_MS, { padrao: 15000, min: 1000, max: 600000 }),
    // Teto de segurança do catálogo listado. Estourar = falha explícita do
    // run (nunca truncamento silencioso, que deixaria itens fora do snapshot
    // sem ninguém saber).
    maxCatalogItems: inteiroEntre(env.MARGIN_SNAPSHOT_MAX_CATALOG_ITEMS, { padrao: 20000, min: 1, max: 200000 }),
    // Cadência do gatilho "sync da Central de Vendas concluído": se a conta
    // já tem um refresh COMPLETADO há menos que isto, o sync não enfileira
    // outra varredura completa do catálogo (o snapshot é projeção pura — a
    // venda nova não muda nada nele). Evita a varredura ML duplicada quando
    // o noturno roda 2 janelas seguidas (dias 2..5) ou há syncs manuais em
    // sequência. 0 = sem cooldown (comportamento anterior). Não afeta o
    // refresh manual nem o gatilho de Base.
    syncTriggerCooldownMinutes: inteiroEntre(env.MARGIN_SNAPSHOT_SYNC_TRIGGER_COOLDOWN_MINUTES, { padrao: 360, min: 0, max: 2880 }),
    workerEnabled: flagLigada(env.MARGIN_SNAPSHOT_WORKER_ENABLED),
  };
}

module.exports = { resolveMarginSnapshotConfig, flagLigada };
