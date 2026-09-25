// server/services/motorMargem/marginSnapshotRunService.js
// Margin Snapshot — Run Service (M2, ver
// docs/AUDITORIA_WORKERS_E_PLANO_MARGIN_SNAPSHOT.md).
//
// Camada de orquestração sobre marginSnapshotRunRepository (M1+M2):
// enqueue/dedupe idempotente, consulta de status account-scoped e
// lifecycle (claim/completed/failed). Espelha o padrão real de
// centralVendasSyncRunService.criarSyncRun, com UMA diferença deliberada
// (§9.2 do plano): dedupe é só por cliente_id + cliente_conta_id +
// marketplace, SEM período — o Margin Snapshot Worker sempre processa "o
// catálogo inteiro atual da conta", nunca um recorte de datas. `reason`
// nunca entra na chave de dedupe (é metadado/observabilidade).
//
// M2 não toca no Mercado Livre e não resolve identidade de conta
// (resolveMarketplaceAccountContext) — isso já aconteceu no chamador (ex.:
// centralVendasSyncWorker, M4) antes de enfileirar. Este service só
// persiste/orquestra o run.

const pool = require("../../config/database");
const runRepo = require("./marginSnapshotRunRepository");

function assertIdentidadeMinima({ clienteId, clienteContaId, reason }) {
  if (!clienteId) throw new Error("enqueueMarginSnapshotRun: clienteId é obrigatório.");
  if (!clienteContaId) throw new Error("enqueueMarginSnapshotRun: clienteContaId é obrigatório.");
  if (!reason) throw new Error("enqueueMarginSnapshotRun: reason é obrigatório.");
}

// ---------------------------------------------------------------------------
// Enqueue idempotente (§7/§9.2 do plano): procura/reutiliza run ativo antes
// de tentar criar; se uma corrida real vencer a checagem prévia, o índice
// único (uq_margin_snapshot_runs_ativo) garante 23505 no INSERT — tratado
// aqui como dedupe, nunca propagado como erro 500 (mesmo espírito de
// centralVendasSyncRunService.criarSyncRun).
// ---------------------------------------------------------------------------
async function enqueueMarginSnapshotRun({
  clienteId, clienteSlug = null, clienteContaId, marketplace = "meli", baseId = null,
  reason, requestedBy = null, db = pool,
}) {
  assertIdentidadeMinima({ clienteId, clienteContaId, reason });
  const marketplaceNorm = String(marketplace || "meli").trim().toLowerCase();

  const ativoAntes = await runRepo.findActiveRunForAccount({
    clienteId, clienteContaId, marketplace: marketplaceNorm, db,
  });
  if (ativoAntes) return { run: ativoAntes, reaproveitado: true };

  try {
    const run = await runRepo.createRun({
      clienteId, clienteSlug, clienteContaId, marketplace: marketplaceNorm, baseId, reason, requestedBy, db,
    });
    return { run, reaproveitado: false };
  } catch (err) {
    // Corrida real: outro enqueue criou o run ativo entre o SELECT acima e
    // este INSERT. Devolve o run que "ganhou" a corrida em vez de propagar.
    if (err && err.code === "23505") {
      const ativoDepois = await runRepo.findActiveRunForAccount({
        clienteId, clienteContaId, marketplace: marketplaceNorm, db,
      });
      if (ativoDepois) return { run: ativoDepois, reaproveitado: true };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Consulta — sempre account-scoped (mesma disciplina de getRunById).
// ---------------------------------------------------------------------------
async function getRunStatus({ runId, clienteContaId, db = pool }) {
  return runRepo.getRunById({ runId, clienteContaId, db });
}

// ---------------------------------------------------------------------------
// Claim/lifecycle — usados pelo worker (M2, seção C do prompt).
// ---------------------------------------------------------------------------
async function claimNextQueuedRun(db = pool) {
  return runRepo.claimNextQueuedRun({ db });
}

async function markRunCompleted(runId, db = pool) {
  return runRepo.updateRunStatus({ runId, status: "completed", db });
}

async function markRunFailed(runId, { code = null, message = null } = {}, db = pool) {
  return runRepo.updateRunStatus({ runId, status: "failed", errorCode: code, errorMessage: message, db });
}

module.exports = {
  enqueueMarginSnapshotRun,
  getRunStatus,
  claimNextQueuedRun,
  markRunCompleted,
  markRunFailed,
};
