// server/services/centralVendas/centralVendasSyncWorker.js
// Central de Vendas — execução do Sync Run (M2 da fundação V3).
//
// `executarSyncRun` é o ÚNICO caminho de execução: tanto o endpoint legado
// POST /sincronizar (que o aguarda inline, preservando a resposta síncrona
// de sempre) quanto o novo POST /sync-runs (que o enfileira e responde 202
// antes dele terminar) chamam esta mesma função. Não existem dois motores.
//
// Fila in-process (mesmo padrão de
// server/services/automacoes/promocoesDiagnosticoService.js): array em
// memória + setImmediate. LIMITAÇÃO CONHECIDA: não há fila externa (Redis/
// BullMQ/SQS) — se o processo Node reiniciar com um run em 'running', ele
// fica preso nesse estado (não vira 'completed' magicamente, mas também não
// é retomado sozinho). A reconciliação é preguiçosa: só acontece quando o
// operador tenta criar um novo run equivalente (ver
// centralVendasSyncRunService — o índice único de runs ativos cobre queued/
// running, então um run travado bloquearia uma nova tentativa idêntica até
// alguém investigar). Trocar por fila externa no futuro é uma troca desta
// implementação sem mudar o contrato de central_vendas_sync_runs.

const pool = require("../../config/database");
const runService = require("./centralVendasSyncRunService");
const sourceService = require("./centralVendasSyncSourceService");

const CONCORRENCIA = Number(process.env.CENTRAL_VENDAS_SYNC_CONCURRENCY) || 1;

const fila = [];
let ativos = 0;

function enfileirar(job) {
  fila.push(job);
  setImmediate(processarFila);
}

async function processarFila() {
  if (ativos >= CONCORRENCIA) return;
  const job = fila.shift();
  if (!job) return;

  ativos++;
  try {
    await executarSyncRun(job); // job pode incluir db/sincronizarVendasMeli (injeção de teste)
  } catch (err) {
    // executarSyncRun já tenta marcar o run como failed internamente; isto é
    // apenas uma rede de segurança para não deixar a fila travada.
    console.error(`[centralVendas] sync-run #${job?.run?.id} falhou na fila:`, err?.message);
  } finally {
    ativos--;
    setImmediate(processarFila);
  }
}

// Extrai só o essencial do payload de sincronizarVendasMeli para
// metadata_json — nunca o payload inteiro da Orders API (isso é M3).
function resumoDoResultado(resultado) {
  return {
    ordersEncontrados: resultado?.ordersEncontrados ?? null,
    pedidosPersistidos: resultado?.pedidosPersistidos ?? null,
    itensPersistidos: resultado?.itensPersistidos ?? null,
    componentesPersistidos: resultado?.componentesPersistidos ?? null,
    porCompetencia: Array.isArray(resultado?.porCompetencia)
      ? resultado.porCompetencia.map((c) => ({ competencia: c.competencia, importId: c.importId, pedidos: c.pedidos }))
      : [],
  };
}

// `db` e `sincronizarVendasMeli` são pontos de injeção só para teste (mesmo
// espírito de createCentralVendasSyncService(repo, db)) — em produção usam
// sempre os defaults reais (pool global, motor de sync real).
async function executarSyncRun({ run, context, params, db = pool, sincronizarVendasMeli: syncFnOverride = null }) {
  const marcado = await runService.marcarRunRunning(run.id, db);
  if (!marcado) {
    // Já estava running/completed/failed (corrida entre a fila e uma chamada
    // inline, ou reprocessamento acidental) — nada a fazer, estado final não
    // volta para running.
    return null;
  }

  // Lazy require: evita qualquer ciclo de módulo em tempo de carga.
  const sincronizarVendasMeli = syncFnOverride
    || require("./centralVendasSyncService").createCentralVendasSyncService().sincronizarVendasMeli;

  try {
    const resultado = await sincronizarVendasMeli({
      clienteSlug: params.clienteSlug,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      marketplace: params.marketplace,
      accountContext: context, // identidade congelada — não re-resolvida aqui
      runId: run.id,
    });

    // M3 — completude por fonte: eixo separado do status técnico (run.status
    // continua completed/failed exatamente como no M2). Nunca calculado no
    // frontend nem duplicado em outro lugar — sempre via
    // calcularCompletudeDoRun (verdade única em central_vendas_sync_sources).
    // runStatus:"completed" — o run está prestes a ser marcado completed
    // logo abaixo; uma fonte obrigatória que nunca foi registrada até aqui é
    // lacuna real (Hardening M3, P0 seção 1), não "ainda vai rodar".
    const completeness = await sourceService.calcularCompletudeDoRun(run.id, { runStatus: "completed", db });
    await runService.atualizarCompletenessRun(run.id, completeness.status, db);
    await runService.marcarRunCompleted(run.id, resumoDoResultado(resultado), db);

    const fontes = await sourceService.listarFontesDoRun(run.id, db);
    console.log(
      `[centralVendas] sync-run #${run.id} completeness`,
      Object.fromEntries(fontes.map((f) => [
        f.source,
        `${f.status}${f.expectedCount != null && f.receivedCount != null ? ` ${f.receivedCount}/${f.expectedCount}` : ""}`,
      ])),
      completeness.missingSources.length ? `missing=${completeness.missingSources.join(",")}` : "",
      `overall=${completeness.status}`
    );

    return resultado;
  } catch (err) {
    const code = err?.code || "SYNC_EXECUTION_ERROR";
    // Rede de segurança (seção 54): fecha qualquer fonte ainda pending/
    // running deste run como failed antes de marcar o run como failed —
    // nunca deixa "run failed, sources todas running".
    await sourceService.falharFontesEmAndamento(run.id, { errorCode: code, errorMessage: err?.message }, db);
    // Um run failed nunca pode ser lido como completude confiável — o eixo
    // de completude segue o técnico aqui, sem exceção.
    await runService.atualizarCompletenessRun(run.id, "failed", db);
    await runService.marcarRunFailed(run.id, { code, message: err?.message || "Erro desconhecido na sincronizacao." }, db);
    throw err;
  }
}

module.exports = {
  enfileirar,
  executarSyncRun,
};
