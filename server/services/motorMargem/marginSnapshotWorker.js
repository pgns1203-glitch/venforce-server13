// server/services/motorMargem/marginSnapshotWorker.js
// Margin Snapshot — Worker básico (M2, ver
// docs/AUDITORIA_WORKERS_E_PLANO_MARGIN_SNAPSHOT.md §10/§13/§14).
//
// Este worker é SÓ a fundação de execução: acorda -> tenta claim -> chama
// processor INJETADO -> atualiza lifecycle. NÃO existe processor real de
// Mercado Livre aqui (isso é M3) — em produção este módulo não é
// instanciado/iniciado em lugar nenhum (não há bootstrap em
// server/index.js para ele, por instrução explícita do plano de M2).
//
// 1 run por chamada de runOnce() (§14 do prompt de M2: "não criar
// Promise.all de runs" — concorrência de múltiplos runs simultâneos fica
// para M3/M8). Loop controlável via start()/stop() para uso futuro fora de
// teste; os testes usam runOnce() diretamente, sem timers reais (§13).

const pool = require("../../config/database");
const defaultRunService = require("./marginSnapshotRunService");

// Nunca persistir stack trace — só a mensagem, truncada (§18 do prompt:
// "não salvar stack gigante no banco"). O truncamento final a 2000
// caracteres já é reforçado por marginSnapshotRunRepository.updateRunStatus;
// aqui aplicamos o mesmo teto por clareza e para não depender de detalhe
// interno do repository.
function sanitizeErrorMessage(err) {
  const mensagem = err?.message || "Erro desconhecido no processor.";
  return String(mensagem).slice(0, 2000);
}

function createMarginSnapshotWorker({
  runService = defaultRunService,
  processor,
  db = pool,
  logger = console,
} = {}) {
  if (typeof processor !== "function") {
    throw new Error("createMarginSnapshotWorker: processor é obrigatório (injetado — M2 não tem processor real de ML).");
  }

  let stopped = false;

  async function runOnce() {
    if (stopped) {
      return { claimed: false, run: null, stopped: true };
    }

    const run = await runService.claimNextQueuedRun(db);
    if (!run) {
      return { claimed: false, run: null };
    }

    try {
      await processor(run, { db });
      const completado = await runService.markRunCompleted(run.id, db);
      return { claimed: true, run: completado, status: "completed" };
    } catch (err) {
      const errorMessage = sanitizeErrorMessage(err);
      logger.error?.(`[marginSnapshot] run #${run.id} falhou no processor:`, errorMessage);
      const falhado = await runService.markRunFailed(
        run.id,
        { code: err?.code || "MARGIN_SNAPSHOT_PROCESSOR_ERROR", message: errorMessage },
        db
      );
      return { claimed: true, run: falhado, status: "failed", error: errorMessage };
    }
  }

  function stop() {
    stopped = true;
  }

  // start()/resume(): só para uso manual futuro fora de teste — nunca
  // chamado pelo bootstrap do servidor neste marco. setInterval simples,
  // sem busy-wait (nunca dispara uma nova execução antes da anterior
  // terminar, mesma disciplina de 1-run-por-vez do runOnce).
  function start(intervalMs = 5000) {
    stopped = false;
    let emExecucao = false;
    const timer = setInterval(async () => {
      if (emExecucao || stopped) return;
      emExecucao = true;
      try {
        await runOnce();
      } catch (err) {
        logger.error?.("[marginSnapshot] worker loop erro inesperado:", err?.message);
      } finally {
        emExecucao = false;
      }
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { runOnce, start, stop };
}

module.exports = { createMarginSnapshotWorker };
