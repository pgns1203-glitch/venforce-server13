// server/services/promoSnapshot/promoSnapshotService.js
// Promo Snapshot — orquestração dos runs e estado de sincronização por conta.
//
//   enqueuePromoSnapshotRun   dedupe distribuído: reconcilia run parado,
//                             reaproveita run ativo, cria um novo (23505 →
//                             reaproveita o que venceu a corrida)
//   ensureFreshPromoSnapshot  stale-while-revalidate: fresh → nada; stale ou
//                             nunca sincronizado → enfileira; run existente →
//                             reutiliza. NUNCA espera o scan.
//   markRunCompleted          decide completed/partial e promove o snapshot
//   estadoSincronizacao       never_synced | fresh | stale | syncing |
//                             partial | failed (+ idade, progresso, erro)
//
// Nada aqui chama o Mercado Livre: o scan roda no worker, em background.

const pool = require("../../config/database");
const repoPadrao = require("./promoSnapshotRepository");
const { resolvePromoSnapshotConfig } = require("./promoSnapshotConfig");
const { redigirSegredos } = require("../motorMargem/marginSnapshotSanitize");
const { logEvento } = require("../motorMargem/marginSnapshotLog");

function defaults(deps = {}) {
  return {
    db: deps.db || pool,
    repo: deps.repo || repoPadrao,
    env: deps.env || process.env,
    logger: deps.logger || console,
    now: deps.now || (() => new Date()),
    kick: deps.kick || (() => require("./promoSnapshotRuntime").kick()),
  };
}

function ms(v) {
  if (!v) return NaN;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function identidade(conta) {
  const id = {
    clienteId: Number(conta.clienteId),
    clienteSlug: conta.clienteSlug || null,
    clienteContaId: Number(conta.clienteContaId),
    marketplace: String(conta.marketplace || "meli").toLowerCase(),
    sellerId: conta.sellerId != null ? String(conta.sellerId).trim() : "",
  };
  if (!id.clienteId) throw new Error("Promo Snapshot: clienteId é obrigatório.");
  if (!id.clienteContaId) throw new Error("Promo Snapshot: clienteContaId é obrigatório (nunca só cliente_id).");
  if (!id.sellerId) {
    const err = new Error("A conta não tem conexão do Mercado Livre vinculada.");
    err.code = "CONTA_SEM_GRANT_ML";
    throw err;
  }
  if (id.marketplace !== "meli") throw new Error(`Promo Snapshot: marketplace "${id.marketplace}" não suportado.`);
  return id;
}

// ─── Enqueue (dedupe) ────────────────────────────────────────────────────────
async function enqueuePromoSnapshotRun(conta, { reason, requestedBy = null } = {}, deps = {}) {
  const d = defaults(deps);
  const config = resolvePromoSnapshotConfig(d.env);
  const id = identidade(conta);
  if (!reason) throw new Error("enqueuePromoSnapshotRun: reason é obrigatório.");
  const base = { cliente_id: id.clienteId, cliente_conta_id: id.clienteContaId, seller_id: id.sellerId, reason };

  // Run `running` morto desta conta não pode bloquear o refresh para sempre.
  await d.repo.reconcileStaleRunningRuns({ staleMinutes: config.runningStaleMinutes, clienteContaId: id.clienteContaId }, d.db);

  const reusar = (run) => {
    logEvento(d.logger, "log", "promo_snapshot_run_reused", { ...base, run_id: run.id, status: run.status });
    return { run, reaproveitado: true };
  };

  const ativo = await d.repo.findActiveRun({ clienteContaId: id.clienteContaId, marketplace: id.marketplace }, d.db);
  if (ativo) return reusar(ativo);

  const retomavel = await d.repo.findResumableRun({
    clienteContaId: id.clienteContaId, marketplace: id.marketplace, sellerId: id.sellerId,
    resumeMaxMinutes: config.resumeMaxMinutes,
  }, d.db);

  try {
    const run = await d.repo.createRun({
      ...id, reason, requestedBy, resumedFromRunId: retomavel ? retomavel.id : null,
    }, d.db);
    logEvento(d.logger, "log", "promo_snapshot_run_enqueued", {
      ...base, run_id: run.id, retomado_de: run.resumedFromRunId,
    });
    return { run, reaproveitado: false };
  } catch (err) {
    // Corrida real (outra instância criou o run ativo entre o SELECT e o
    // INSERT): o índice único devolve 23505 — reaproveita o vencedor.
    if (err && err.code === "23505") {
      const vencedor = await d.repo.findActiveRun({ clienteContaId: id.clienteContaId, marketplace: id.marketplace }, d.db);
      if (vencedor) return reusar(vencedor);
    }
    throw err;
  }
}

// ─── Estado de sincronização ─────────────────────────────────────────────────
/**
 * Estado simples para a UI + o que for preciso para decidir o auto-trigger.
 * Precedência: syncing > failed (última tentativa falhou depois do snapshot)
 * > partial (snapshot atual é parcial) > stale > fresh; sem snapshot:
 * syncing | failed | never_synced.
 */
async function estadoSincronizacao({ clienteContaId, marketplace = "meli" }, deps = {}) {
  const d = defaults(deps);
  const config = resolvePromoSnapshotConfig(d.env);
  const [conta, ativo] = await Promise.all([
    d.repo.obterConta({ clienteContaId }, d.db),
    d.repo.findActiveRun({ clienteContaId, marketplace }, d.db),
  ]);
  const agora = d.now().getTime();
  const temSnapshot = Boolean(conta && conta.currentRunId);
  const snapshotAtMs = temSnapshot ? ms(conta.snapshotAt) : NaN;
  const freshUntilMs = temSnapshot ? ms(conta.freshUntil) : NaN;
  const snapshotFresco = temSnapshot && Number.isFinite(freshUntilMs) && freshUntilMs > agora;
  const ultimaFalhou = Boolean(conta && conta.lastAttemptStatus && conta.lastAttemptStatus !== "completed" &&
    (conta.lastAttemptStatus === "failed" || (conta.lastAttemptStatus === "partial" && conta.lastAttemptRunId !== conta.currentRunId)) &&
    (!temSnapshot || ms(conta.lastAttemptAt) >= snapshotAtMs));

  let state;
  if (ativo) state = "syncing";
  else if (!temSnapshot) state = ultimaFalhou ? "failed" : "never_synced";
  else if (ultimaFalhou) state = "failed";
  else if (conta.parcial) state = "partial";
  else state = snapshotFresco ? "fresh" : "stale";

  return {
    state,
    hasSnapshot: temSnapshot,
    snapshotState: !temSnapshot ? "none" : snapshotFresco ? "fresh" : "stale",
    snapshotRunId: temSnapshot ? conta.currentRunId : null,
    snapshotAt: temSnapshot ? conta.snapshotAt : null,
    freshUntil: temSnapshot ? conta.freshUntil : null,
    partial: temSnapshot ? conta.parcial : false,
    itemsWithoutRead: temSnapshot ? conta.itensSemLeitura : 0,
    lastSuccessAt: conta ? conta.lastSuccessAt : null,
    lastAttemptAt: conta ? conta.lastAttemptAt : null,
    lastAttemptStatus: conta ? conta.lastAttemptStatus : null,
    ageMinutes: Number.isFinite(snapshotAtMs) ? Math.max(0, Math.floor((agora - snapshotAtMs) / 60000)) : null,
    processed: ativo ? ativo.itensProcessados : temSnapshot ? conta.itensTotal : null,
    total: ativo ? ativo.itensTotal : temSnapshot ? conta.itensTotal : null,
    activeRun: ativo ? { runId: ativo.id, status: ativo.status, reason: ativo.reason, createdAt: ativo.createdAt, heartbeatAt: ativo.heartbeatAt } : null,
    errorCode: ultimaFalhou ? conta.lastErrorCode || null : null,
    freshMinutes: config.freshMinutes,
    workerEnabled: config.workerEnabled,
    _conta: conta,
  };
}

function estadoPublico(estado) {
  if (!estado) return null;
  const { _conta, ...resto } = estado;
  return resto;
}

// ─── Auto-trigger (stale-while-revalidate) ───────────────────────────────────
/**
 * fresh → nada · stale/nunca → enfileira · run ativo → reutiliza.
 * Não enfileira com o worker desligado (evita runs queued que ninguém
 * processa) nem logo depois de uma falha (espera failedRetryMinutes).
 * Nunca executa o scan: devolve na hora.
 */
async function ensureFreshPromoSnapshot(conta, { reason = "auto_refresh", estado = null } = {}, deps = {}) {
  const d = defaults(deps);
  const config = resolvePromoSnapshotConfig(d.env);
  const id = identidade(conta);
  const atual = estado || (await estadoSincronizacao({ clienteContaId: id.clienteContaId, marketplace: id.marketplace }, deps));

  if (atual.activeRun) return { acao: "reutilizado", runId: atual.activeRun.runId, estado: atual };
  if (atual.snapshotState === "fresh" && atual.state !== "failed") return { acao: "nenhuma", estado: atual };
  if (!config.workerEnabled) return { acao: "worker_desabilitado", estado: atual };

  const c = atual._conta;
  if (c && (c.lastAttemptStatus === "failed" || (c.lastAttemptStatus === "partial" && c.lastAttemptRunId !== c.currentRunId))) {
    const desde = d.now().getTime() - ms(c.lastAttemptAt);
    if (Number.isFinite(desde) && desde < config.failedRetryMinutes * 60000) {
      return { acao: "aguardando_nova_tentativa", estado: atual, retryInMinutes: Math.ceil((config.failedRetryMinutes * 60000 - desde) / 60000) };
    }
  }

  const { run, reaproveitado } = await enqueuePromoSnapshotRun(id, {
    reason: atual.hasSnapshot ? reason : "first_sync",
  }, deps);
  d.kick();
  return { acao: reaproveitado ? "reutilizado" : "enfileirado", runId: run.id, estado: atual };
}

// ─── Lifecycle usado pelo worker ─────────────────────────────────────────────
function criarRunService(deps = {}) {
  const d = defaults(deps);
  const config = () => resolvePromoSnapshotConfig(d.env);

  function evento(nivel, nome, run, extra = {}) {
    logEvento(d.logger, nivel, nome, {
      run_id: run.id, cliente_id: run.clienteId, cliente_conta_id: run.clienteContaId, seller_id: run.sellerId,
      processed_count: run.itensProcessados, duration_ms: ms(run.finishedAt) - ms(run.startedAt), ...extra,
    });
  }

  return {
    async claimNextQueuedRun(db = d.db, { excludeContaIds = [] } = {}) {
      return d.repo.claimNextQueuedRun({ excludeContaIds }, db);
    },

    /**
     * Sem falhas → completed e promove. Com falhas → partial; promove só se
     * a fração de itens sem leitura couber em partialMaxFailRatio (e fica
     * marcado como parcial). Catálogo vazio lido com sucesso é um snapshot
     * verdadeiro (vazio).
     */
    async markRunCompleted(runId, db = d.db, resultado = {}) {
      const cfg = config();
      const total = Number(resultado.total || 0);
      const falhas = Number(resultado.falhas || 0);
      const status = falhas > 0 ? "partial" : "completed";
      const promover = status === "completed" || (total > 0 && falhas / total <= cfg.partialMaxFailRatio);
      const run = await d.repo.finalizarRun({
        runId, status, promover, snapshotAt: resultado.snapshotAt || null, freshMinutes: cfg.freshMinutes,
        metadata: { resultado: { total, falhas, processados: Number(resultado.processados || 0) } },
        errorCode: status === "partial" && !promover ? "PROMO_SNAPSHOT_PARCIAL_NAO_PROMOVIDO" : null,
        errorMessage: status === "partial"
          ? `${falhas} de ${total} anúncio(s) sem leitura das promoções${promover ? " (dentro do limite; snapshot promovido e marcado como parcial)" : " (acima do limite; último snapshot bom preservado)"}.`
          : null,
      }, db);
      if (run) {
        evento(status === "completed" ? "log" : "warn", status === "completed" ? "promo_snapshot_completed" : "promo_snapshot_partial", run, {
          total, falhas, promovido: run.promovido, promocoes: run.promocoesEncontradas,
        });
      }
      return run;
    },

    async markRunFailed(runId, { code = null, message = null } = {}, db = d.db) {
      // Parada cooperativa do worker (deploy/restart limpo): código próprio,
      // retomável pelo próximo run da conta.
      if (code === "MARGIN_SNAPSHOT_WORKER_STOPPED") code = d.repo.ERRO_WORKER_PARADO || "PROMO_SNAPSHOT_WORKER_STOPPED";
      const run = await d.repo.marcarFalhou({ runId, code, message: message ? redigirSegredos(message, 2000) : null }, db);
      if (run) evento("error", "promo_snapshot_failed", run, { error_code: code, error_message: redigirSegredos(message || "", 300) });
      return run;
    },

    async reconcileStaleRuns({ staleMinutes, db = d.db } = {}) {
      return d.repo.reconcileStaleRunningRuns({ staleMinutes }, db);
    },
  };
}

module.exports = {
  enqueuePromoSnapshotRun,
  estadoSincronizacao,
  estadoPublico,
  ensureFreshPromoSnapshot,
  criarRunService,
  identidade,
};
