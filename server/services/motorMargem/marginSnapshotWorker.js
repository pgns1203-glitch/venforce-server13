// server/services/motorMargem/marginSnapshotWorker.js
// Margin Snapshot — Worker (M2: máquina de estados; M3: concorrência
// controlada + parada cooperativa, ver
// docs/AUDITORIA_WORKERS_E_PLANO_MARGIN_SNAPSHOT.md §10/§13/§14/§16).
//
// Ciclo: claim atômico (UPDATE ... WHERE status='queued' ... FOR UPDATE SKIP
// LOCKED) → processor INJETADO → completed | failed. O run persistido é a
// fonte de verdade; a fila é o próprio banco — qualquer instância pode
// reivindicar um run criado por outra (pickup por polling leve).
//
// Rate control local (M3):
//   - no máximo `maxConcurrentRuns` runs simultâneos neste processo;
//   - nunca 2 runs da MESMA conta neste processo (as contas em execução são
//     excluídas do claim) — lotes de uma conta são sempre sequenciais;
//   - o paralelismo DENTRO de um lote continua sendo o do Motor
//     (enrichBatch/CONCURRENCY), não é alterado aqui.
//
// runOnce() continua processando exatamente 1 run por chamada (testes usam
// sem timer real). start()/kick()/stop() são o loop de produção.

const pool = require("../../config/database");
const defaultRunService = require("./marginSnapshotRunService");
const { redigirSegredos } = require("./marginSnapshotSanitize");

// Nunca persistir stack trace — só a mensagem, truncada e sem segredo.
function sanitizeErrorMessage(err) {
  const mensagem = err?.message || "Erro desconhecido no processor.";
  return redigirSegredos(mensagem, 2000);
}

function createMarginSnapshotWorker({
  runService = defaultRunService,
  processor,
  db = pool,
  logger = console,
  maxConcurrentRuns = 1,
} = {}) {
  if (typeof processor !== "function") {
    throw new Error("createMarginSnapshotWorker: processor é obrigatório (injetado).");
  }

  const limite = Math.max(1, Number(maxConcurrentRuns) || 1);
  let stopped = false;
  let controller = new AbortController();
  let timer = null;
  let tickEmAndamento = false;
  let tickPendente = false;
  // runId -> { contaId, promise }
  const ativos = new Map();

  function contasAtivas() {
    return Array.from(ativos.values()).map((a) => a.contaId);
  }

  // M4 — uma mudança de Base chegou enquanto este run rodava (ver
  // marginSnapshotRunService.REASONS_QUE_PEDEM_RERUN): enfileira UM run novo
  // para a mesma conta. Falha aqui nunca reabre o run já concluído.
  async function reenfileirarSeSolicitado(runFinal) {
    const pedido = runFinal?.metadata?.rerunSolicitado;
    if (!pedido || typeof runService.enqueueMarginSnapshotRun !== "function") return;
    try {
      await runService.enqueueMarginSnapshotRun({
        clienteId: runFinal.clienteId,
        clienteSlug: runFinal.clienteSlug,
        clienteContaId: runFinal.clienteContaId,
        marketplace: runFinal.marketplace,
        reason: pedido.reason || "base_changed",
        db,
      });
    } catch (err) {
      logger.error?.(`[marginSnapshot] run #${runFinal.id}: falha ao re-enfileirar após mudança de Base: ${sanitizeErrorMessage(err)}`);
    }
  }

  async function processarRun(run) {
    const registro = { contaId: run.clienteContaId, promise: null };
    ativos.set(run.id, registro);
    try {
      await processor(run, { db, signal: controller.signal, logger });
      const completado = await runService.markRunCompleted(run.id, db);
      await reenfileirarSeSolicitado(completado);
      return { claimed: true, run: completado, status: "completed" };
    } catch (err) {
      const errorMessage = sanitizeErrorMessage(err);
      logger.error?.(`[marginSnapshot] run #${run.id} falhou no processor: ${errorMessage}`);
      const falhado = await runService.markRunFailed(
        run.id,
        { code: err?.code || "MARGIN_SNAPSHOT_PROCESSOR_ERROR", message: errorMessage },
        db
      );
      return { claimed: true, run: falhado, status: "failed", error: errorMessage };
    } finally {
      ativos.delete(run.id);
    }
  }

  async function runOnce() {
    if (stopped) {
      return { claimed: false, run: null, stopped: true };
    }
    if (ativos.size >= limite) {
      return { claimed: false, run: null, saturated: true };
    }
    const run = await runService.claimNextQueuedRun(db, { excludeContaIds: contasAtivas() });
    if (!run) {
      return { claimed: false, run: null };
    }
    return processarRun(run);
  }

  // Preenche os slots livres sem esperar os runs terminarem. Reentrância
  // protegida: um kick durante um tick vira "rode de novo ao final".
  async function tick() {
    if (stopped) return;
    if (tickEmAndamento) {
      tickPendente = true;
      return;
    }
    tickEmAndamento = true;
    try {
      while (!stopped && ativos.size < limite) {
        const run = await runService.claimNextQueuedRun(db, { excludeContaIds: contasAtivas() });
        if (!run) break;
        const promise = processarRun(run)
          .catch((err) => {
            logger.error?.(`[marginSnapshot] erro inesperado no run #${run.id}: ${sanitizeErrorMessage(err)}`);
          })
          .finally(() => {
            // Slot liberado: tenta pegar o próximo run sem esperar o timer.
            if (!stopped) setImmediate(tick);
          });
        const registro = ativos.get(run.id);
        if (registro) registro.promise = promise;
      }
    } catch (err) {
      logger.error?.(`[marginSnapshot] worker loop erro inesperado: ${sanitizeErrorMessage(err)}`);
    } finally {
      tickEmAndamento = false;
      if (tickPendente && !stopped) {
        tickPendente = false;
        setImmediate(tick);
      }
    }
  }

  // start(): polling leve para pickup de runs criados por outra instância.
  // setInterval com unref (não segura o processo); nunca sobrepõe ticks.
  function start(intervalMs = 5000) {
    stopped = false;
    if (controller.signal.aborted) controller = new AbortController();
    if (timer) clearInterval(timer);
    timer = setInterval(tick, intervalMs);
    timer.unref?.();
    setImmediate(tick);
    return () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
  }

  // Acorda o worker já (ex.: logo depois de um enqueue neste processo).
  function kick() {
    if (!stopped && timer) setImmediate(tick);
  }

  // Parada cooperativa: nenhum claim novo, timer limpo, e os runs em curso
  // recebem abort — o processor interrompe no próximo ponto seguro (entre
  // lotes/esperas) e o run termina failed com MARGIN_SNAPSHOT_WORKER_STOPPED
  // (snapshots já gravados permanecem). Devolve uma Promise que resolve
  // quando os runs em curso terminarem.
  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    controller.abort();
    const pendentes = Array.from(ativos.values()).map((a) => a.promise).filter(Boolean);
    return Promise.allSettled(pendentes).then(() => undefined);
  }

  function status() {
    return { stopped, running: Boolean(timer), ativos: ativos.size, limite, contasAtivas: contasAtivas() };
  }

  return { runOnce, start, stop, kick, tick, status };
}

module.exports = { createMarginSnapshotWorker, sanitizeErrorMessage };
