// server/services/promoSnapshot/promoSnapshotRuntime.js
// Promo Snapshot — runtime NESTE processo: worker (claim do banco por
// polling) + orquestrador periódico. Mesmo padrão de marginSnapshotRuntime:
// só inicia com PROMO_SNAPSHOT_WORKER_ENABLED=true explícito; sem a flag não
// existe timer nem worker. Chamado pelo boot (server/index.js); testes nunca
// sobem o index.js.
//
// O worker é o genérico do Margin Snapshot (marginSnapshotWorker) com o
// processor/run service do Promo Snapshot: claim FOR UPDATE SKIP LOCKED,
// limite de runs por processo, nunca 2 runs da mesma conta no processo,
// reconciliação periódica de heartbeat parado e parada cooperativa.

const pool = require("../../config/database");
const { resolvePromoSnapshotConfig } = require("./promoSnapshotConfig");

const LOG = "[promoSnapshot]";

let workerAtual = null;
let timerOrquestrador = null;

function habilitado(env = process.env) {
  return resolvePromoSnapshotConfig(env).workerEnabled;
}

function criarWorker({ db = pool, logger = console, config, runService = null, processor = null } = {}) {
  const { createMarginSnapshotWorker } = require("../motorMargem/marginSnapshotWorker");
  const { criarRunService } = require("./promoSnapshotService");
  const { processPromoSnapshotRun } = require("./promoSnapshotProcessor");
  return createMarginSnapshotWorker({
    db,
    logger,
    runService: runService || criarRunService({ db, logger }),
    processor: processor || ((run, ctx) => processPromoSnapshotRun(run, { ...ctx, config })),
    maxConcurrentRuns: config.workerConcurrency,
    staleMinutes: config.runningStaleMinutes,
    rotuloLog: LOG,
    camposExtras: (run) => ({ seller_id: run.sellerId }),
    eventos: {
      iniciado: "promo_snapshot_run_started",
      concluido: "promo_snapshot_run_finished",
      naoConcluido: "promo_snapshot_run_lost",
      falhou: "promo_snapshot_run_error",
      reconciliado: "promo_snapshot_stale_reconciled",
    },
  });
}

async function iniciarSeHabilitado({
  env = process.env, db = pool, logger = console, ensureTables = null, createWorker = null, orquestrar = null,
} = {}) {
  const config = resolvePromoSnapshotConfig(env);
  if (!config.workerEnabled) {
    logger.log?.(`${LOG} worker desabilitado (PROMO_SNAPSHOT_WORKER_ENABLED != true)`);
    return null;
  }
  if (workerAtual) return workerAtual;

  const garantir = ensureTables || require("../schema/schemaEnsure").ensurePromoSnapshotSchema;
  await garantir(db);
  workerAtual = (createWorker || criarWorker)({ db, logger, config });
  workerAtual.start(config.workerPollMs);

  const tick = orquestrar || ((deps) => require("./promoSnapshotOrchestrator").orquestrarTick(deps));
  const rodarTick = () => Promise.resolve()
    .then(() => tick({ db, logger, env }))
    .then((r) => { if (r && r.enfileirados && r.enfileirados.length) kick(); })
    .catch((err) => logger.error?.(`${LOG} orquestrador falhou (ignorado): ${String(err?.message || err).slice(0, 300)}`));
  timerOrquestrador = setInterval(rodarTick, config.orchestratorIntervalMs);
  timerOrquestrador.unref?.();
  setImmediate(rodarTick);

  logger.log?.(
    `${LOG} worker iniciado (runs simultâneos=${config.workerConcurrency}, polling=${config.workerPollMs}ms, ` +
    `orquestrador=${config.orchestratorIntervalMs}ms, frescor=${config.freshMinutes}min)`
  );
  return workerAtual;
}

function kick() {
  if (workerAtual) workerAtual.kick();
}

async function parar() {
  if (timerOrquestrador) clearInterval(timerOrquestrador);
  timerOrquestrador = null;
  if (!workerAtual) return;
  const worker = workerAtual;
  workerAtual = null;
  await worker.stop();
}

function status() {
  return workerAtual ? workerAtual.status() : { stopped: true, running: false, ativos: 0 };
}

module.exports = { habilitado, iniciarSeHabilitado, criarWorker, kick, parar, status };
