// server/services/promoSnapshot/promoSnapshotOrchestrator.js
// Promo Snapshot — orquestrador da sincronização automática.
//
// A cada tick (no mesmo runtime do worker, sem cron paralelo): lê as contas
// elegíveis (MELI, ativas, cliente ativo, seller vinculado, grant utilizável,
// sem run ativo, snapshot vencido/inexistente, fora da espera pós-falha) e
// enfileira até `orchestratorMaxPerTick`. Conta inativa, revogada ou sem
// grant nunca entra. Duas instâncias orquestrando ao mesmo tempo são seguras:
// o enqueue é idempotente (índice único de run ativo por conta).

const pool = require("../../config/database");
const repoPadrao = require("./promoSnapshotRepository");
const { resolvePromoSnapshotConfig } = require("./promoSnapshotConfig");
const { enqueuePromoSnapshotRun } = require("./promoSnapshotService");
const { logEvento } = require("../motorMargem/marginSnapshotLog");
const { redigirSegredos } = require("../motorMargem/marginSnapshotSanitize");

async function orquestrarTick(deps = {}) {
  const db = deps.db || pool;
  const repo = deps.repo || repoPadrao;
  const logger = deps.logger || console;
  const config = resolvePromoSnapshotConfig(deps.env || process.env);
  if (!config.workerEnabled) return { enfileirados: [], motivo: "WORKER_DESABILITADO" };

  const contas = await repo.listarContasElegiveis({
    limit: config.orchestratorMaxPerTick, failedRetryMinutes: config.failedRetryMinutes,
  }, db);
  const enfileirados = [];
  for (const conta of contas) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { run, reaproveitado } = await enqueuePromoSnapshotRun(
        { ...conta, marketplace: "meli" }, { reason: "scheduled_refresh" }, { ...deps, db, repo }
      );
      enfileirados.push({ clienteContaId: conta.clienteContaId, runId: run.id, reaproveitado });
    } catch (err) {
      // Uma conta com problema não impede as outras.
      logEvento(logger, "error", "promo_snapshot_orchestrator_enqueue_failed", {
        cliente_id: conta.clienteId, cliente_conta_id: conta.clienteContaId, seller_id: conta.sellerId,
        erro: redigirSegredos(err?.message || String(err), 300),
      });
    }
  }
  if (enfileirados.length) {
    logEvento(logger, "log", "promo_snapshot_orchestrator_tick", {
      elegiveis: contas.length, enfileirados: enfileirados.filter((e) => !e.reaproveitado).length,
    });
  }
  return { enfileirados };
}

module.exports = { orquestrarTick };
