#!/usr/bin/env node
// server/scripts/promoSnapshotRunOnce.js
// Promo Snapshot — UMA passada do orquestrador, para um futuro Render Cron Job.
//
//   node scripts/promoSnapshotRunOnce.js [--max-runs=N]
//
// Passos (os mesmos do runtime do serviço web, sem timer):
//   1. reconcilia runs `running` sem heartbeat (stale) — de qualquer instância;
//   2. orquestrarTick: enfileira as contas elegíveis da allowlist
//      (PROMO_SNAPSHOT_CLIENTES, `*` = todos), até ORCHESTRATOR_MAX_PER_TICK;
//   3. processa até N runs da fila, um por vez (padrão = ORCHESTRATOR_MAX_PER_TICK).
//
// Allowlist e locks são os do serviço web: a regra é avaliarPiloto; o enqueue
// é idempotente (índice único de run ativo por conta) e o claim é FOR UPDATE
// SKIP LOCKED com fencing por heartbeat — rodar junto com o worker do serviço
// web (ou com outra execução deste script) nunca processa a mesma conta 2x.
// Run da fila de um cliente que saiu da allowlist é encerrado como falha
// (PROMO_SNAPSHOT_FORA_DO_PILOTO), nunca processado.
//
// Opt-in: só faz algo com PROMO_SNAPSHOT_WORKER_ENABLED=true (mesma chave do
// serviço web). Desligado ou allowlist vazia → nada a fazer, exit 0.
// Exit 1: erro estrutural (banco, argumento) ou algum run processado que não
// terminou (failed/lost). Run `partial` conta como concluído.
//
// ATENÇÃO: usa DATABASE_URL como o serviço web. Nesta máquina de dev,
// server/.env aponta para o banco de PRODUÇÃO.

const { resolvePromoSnapshotConfig, avaliarPiloto } = require("../services/promoSnapshot/promoSnapshotConfig");

const LOG = "[promoSnapshot:run-once]";
const MAX_RUNS_TETO = 100;

function parseArgs(argv) {
  const args = { maxRuns: null };
  for (const raw of argv) {
    const [chave, ...resto] = String(raw).split("=");
    const valor = resto.join("=");
    if (chave === "--max-runs") {
      const n = Number(valor);
      if (!Number.isInteger(n) || n < 1 || n > MAX_RUNS_TETO) throw new Error(`--max-runs deve ser inteiro entre 1 e ${MAX_RUNS_TETO}`);
      args.maxRuns = n;
    } else {
      throw new Error(`Argumento desconhecido: ${raw}`);
    }
  }
  return args;
}

function erroForaDoPiloto(run) {
  const err = new Error(`cliente ${run.clienteSlug} fora de PROMO_SNAPSHOT_CLIENTES — run não processado`);
  err.code = "PROMO_SNAPSHOT_FORA_DO_PILOTO";
  return err;
}

/**
 * Uma passada. Devolve { codigo, motivo?, reconciliados, enfileirados, runs }.
 * Dependências injetáveis para teste: db, logger, env, repo, now, runService,
 * processor, ensureTables, orquestrar, criarWorker.
 */
async function executarPassada(argv = [], deps = {}) {
  const env = deps.env || process.env;
  const logger = deps.logger || console;
  const args = parseArgs(argv);
  const config = resolvePromoSnapshotConfig(env);
  if (!config.workerEnabled) {
    logger.log?.(`${LOG} desabilitado (PROMO_SNAPSHOT_WORKER_ENABLED != true) — nada a fazer`);
    return { codigo: 0, motivo: "WORKER_DESABILITADO", reconciliados: 0, enfileirados: [], runs: [] };
  }
  if (!config.clientesPiloto.length) {
    logger.log?.(`${LOG} PROMO_SNAPSHOT_CLIENTES vazio — nada a fazer`);
    return { codigo: 0, motivo: "PILOTO_VAZIO", reconciliados: 0, enfileirados: [], runs: [] };
  }

  const db = deps.db || require("../config/database");
  const garantir = deps.ensureTables || require("../services/schema/schemaEnsure").ensurePromoSnapshotSchema;
  await garantir(db);

  // Sem worker em processo aqui: o kick do runtime não tem a quem acordar.
  const comuns = {
    db, logger, env, kick: () => {},
    ...(deps.repo ? { repo: deps.repo } : {}), ...(deps.now ? { now: deps.now } : {}),
  };
  const { criarRunService } = require("../services/promoSnapshot/promoSnapshotService");
  const runService = deps.runService || criarRunService(comuns);

  // 1. Runs presos por uma instância que morreu liberam a conta para esta passada.
  const mortos = (await runService.reconcileStaleRuns({ staleMinutes: config.runningStaleMinutes, db })) || [];

  // 2. Enfileira (allowlist + elegibilidade + índice único de run ativo).
  const orquestrar = deps.orquestrar || require("../services/promoSnapshot/promoSnapshotOrchestrator").orquestrarTick;
  const tick = await orquestrar(comuns);
  const enfileirados = (tick && tick.enfileirados) || [];

  // 3. Processa a fila, um run por vez, até o limite.
  const processar = deps.processor || ((run, ctx) => require("../services/promoSnapshot/promoSnapshotProcessor").processPromoSnapshotRun(run, { ...ctx, config }));
  const processor = async (run, ctx) => {
    if (run.clienteSlug && !avaliarPiloto(config, run.clienteSlug).noPiloto) throw erroForaDoPiloto(run);
    return processar(run, ctx);
  };
  const criarWorker = deps.criarWorker || require("../services/promoSnapshot/promoSnapshotRuntime").criarWorker;
  const worker = criarWorker({ db, logger, config, runService, processor });
  const maxRuns = args.maxRuns || config.orchestratorMaxPerTick;
  const runs = [];
  try {
    for (let i = 0; i < maxRuns; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await worker.runOnce();
      if (!r || !r.claimed) break;
      runs.push({ runId: r.run ? r.run.id : null, status: r.run ? r.run.status : r.status, resultado: r.status, erro: r.error || null });
    }
  } finally {
    await Promise.resolve(worker.stop()).catch(() => {});
  }

  const naoConcluidos = runs.filter((r) => r.resultado !== "completed");
  logger.log?.(
    `${LOG} reconciliados=${mortos.length} enfileirados=${enfileirados.filter((e) => !e.reaproveitado).length} ` +
    `processados=${runs.length} nao_concluidos=${naoConcluidos.length}`
  );
  return { codigo: naoConcluidos.length ? 1 : 0, reconciliados: mortos.length, enfileirados, runs };
}

async function main(argv = process.argv.slice(2)) {
  require("dotenv").config();
  let codigo = 0;
  let pool = null;
  try {
    const config = resolvePromoSnapshotConfig(process.env);
    if (config.workerEnabled && config.clientesPiloto.length) pool = require("../config/database");
    codigo = (await executarPassada(argv, { db: pool || undefined })).codigo;
  } catch (err) {
    const { sanitizeErrorMessage } = require("../services/mlTokenService");
    console.error(`${LOG} erro estrutural: ${err?.code ? `${err.code} ` : ""}${sanitizeErrorMessage(String(err?.message || err))}`);
    codigo = 1;
  } finally {
    if (pool && typeof pool.end === "function") await pool.end().catch(() => {});
  }
  process.exitCode = codigo;
  // Rede de segurança: um handle esquecido não pode pendurar o cron.
  setTimeout(() => process.exit(codigo), 10000).unref();
}

if (require.main === module) main();

module.exports = { executarPassada, parseArgs, main };
