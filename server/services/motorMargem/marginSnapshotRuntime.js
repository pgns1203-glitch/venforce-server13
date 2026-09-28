// server/services/motorMargem/marginSnapshotRuntime.js
// Margin Snapshot — runtime do worker NESTE processo (M4).
//
// Único ponto que liga/desliga o worker real em background. Só inicia com
// MARGIN_SNAPSHOT_WORKER_ENABLED=true EXPLÍCITO (opt-in, mesmo padrão de
// CENTRAL_VENDAS_NOTURNO_ENABLED): sem a flag, nada é criado, nenhuma tabela
// é garantida, nenhum timer existe. Chamado pelo bootstrap de server/index.js;
// testes nunca sobem o index.js.

const pool = require("../../config/database");
const { resolveMarginSnapshotConfig } = require("./marginSnapshotConfig");

const LOG = "[marginSnapshot]";

let workerAtual = null;

function habilitado(env = process.env) {
  return resolveMarginSnapshotConfig(env).workerEnabled;
}

async function iniciarSeHabilitado({
  env = process.env,
  db = pool,
  logger = console,
  ensureTables = null,
  createWorker = null,
} = {}) {
  const config = resolveMarginSnapshotConfig(env);
  if (!config.workerEnabled) {
    logger.log?.(`${LOG} worker desabilitado (MARGIN_SNAPSHOT_WORKER_ENABLED != true)`);
    return null;
  }
  if (workerAtual) return workerAtual;

  // Lazy require: nenhum custo de import quando a flag está desligada.
  const garantir = ensureTables || require("./marginSnapshotRepository").ensureMarginSnapshotTables;
  const criar = createWorker || require("./marginSnapshotWorkerFactory").createRealMarginSnapshotWorker;

  await garantir(db);
  workerAtual = criar({ db, logger, config });
  workerAtual.start(config.workerPollMs);
  logger.log?.(
    `${LOG} worker iniciado (runs simultâneos=${config.workerConcurrency}, polling=${config.workerPollMs}ms, pausa entre lotes=${config.batchPauseMs}ms)`
  );
  return workerAtual;
}

// Acorda o worker local logo depois de um enqueue. Sem worker neste processo
// (flag desligada, ou job CLI), o run fica queued no banco e é reivindicado
// pelo polling de qualquer instância com o worker ligado.
function kick() {
  if (workerAtual) workerAtual.kick();
}

async function parar() {
  if (!workerAtual) return;
  const worker = workerAtual;
  workerAtual = null;
  await worker.stop();
}

function status() {
  return workerAtual ? workerAtual.status() : { stopped: true, running: false, ativos: 0 };
}

module.exports = { habilitado, iniciarSeHabilitado, kick, parar, status };
