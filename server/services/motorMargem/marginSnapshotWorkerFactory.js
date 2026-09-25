// server/services/motorMargem/marginSnapshotWorkerFactory.js
// Margin Snapshot — composição worker (M2) + processor real (M3), ver §23 do
// prompt de M3.
//
// SÓ composição/injeção: nenhum side effect ao importar este módulo (nenhum
// worker é criado nem iniciado aqui). Uso futuro (M4+): quem decidir ativar o
// worker em background chama `createRealMarginSnapshotWorker()` e depois
// `.start()` explicitamente. Nada disso acontece nesta rodada — não há
// nenhum import deste arquivo em `server/index.js` (§24: bootstrap
// inalterado).

const { createMarginSnapshotWorker } = require("./marginSnapshotWorker");
const { processMarginSnapshotRun } = require("./marginSnapshotProcessor");

function createRealMarginSnapshotWorker(overrides = {}) {
  return createMarginSnapshotWorker({ processor: processMarginSnapshotRun, ...overrides });
}

module.exports = { createRealMarginSnapshotWorker };
