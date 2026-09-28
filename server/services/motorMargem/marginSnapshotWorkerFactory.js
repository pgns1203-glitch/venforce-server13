// server/services/motorMargem/marginSnapshotWorkerFactory.js
// Margin Snapshot — composição worker (M2) + processor real (M3).
//
// SÓ composição/injeção: nenhum side effect ao importar este módulo (nenhum
// worker é criado nem iniciado aqui). Quem liga o worker em background é o
// runtime (marginSnapshotRuntime, atrás de MARGIN_SNAPSHOT_WORKER_ENABLED).

const { createMarginSnapshotWorker } = require("./marginSnapshotWorker");
const { processMarginSnapshotRun } = require("./marginSnapshotProcessor");
const { resolveMarginSnapshotConfig } = require("./marginSnapshotConfig");

function createRealMarginSnapshotWorker(overrides = {}) {
  const config = overrides.config || resolveMarginSnapshotConfig(overrides.env);
  const processor = overrides.processor
    || ((run, ctx) => processMarginSnapshotRun(run, { ...ctx, config }));
  return createMarginSnapshotWorker({
    maxConcurrentRuns: config.workerConcurrency,
    staleMinutes: config.runningStaleMinutes,
    ...overrides,
    processor,
  });
}

module.exports = { createRealMarginSnapshotWorker };
