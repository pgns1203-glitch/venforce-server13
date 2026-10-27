#!/usr/bin/env node
// server/workers/sentinelWorker.js
// Sentinel — processo PRÓPRIO (node server/workers/sentinelWorker.js). NÃO é
// iniciado pelo Express (server/index.js não referencia o Sentinel).
//
// IMPLEMENTAÇÃO LOCAL PROVISÓRIA — bloqueada para ativação (E0 não validada).
//
//   SENTINEL_WORKER_ENABLED        ausente/≠true ⇒ OFF (loga e sai com código 0)
//   SENTINEL_CONTAS_ALLOWLIST      ids de cliente_contas separados por vírgula
//                                  (ex.: "41"). Vazia/ausente ⇒ não processa nada.
//   SENTINEL_DB_POOL_MAX           pool PRÓPRIO do worker (padrão 2)
//   SENTINEL_STATEMENT_TIMEOUT_MS  statement_timeout das queries (padrão 30000)
//   SENTINEL_POLL_INTERVAL_MS / SENTINEL_OVERLAP_MS / SENTINEL_CICLO_MAX_MS /
//   SENTINEL_MAX_CHAMADAS_POR_CONTA / SENTINEL_MAX_TENTATIVAS — ver sentinelPollingWorker
//
// Não carrega server/.env: o ambiente vem do processo (Render/shell). Nada inicia
// em require(): só `main()` quando executado direto.
//
// SIGTERM/SIGINT: termina a conta corrente (checkpoint só avança por janela
// completa — nunca parcial), não inicia outra, fecha o pool e sai.

const { Pool } = require("pg");
const { configConexao, lerMsPositivo, protegerConexoesDoPool } = require("../config/databaseConexao");
const { verificarSentinelSchema } = require("../services/sentinel/sentinelSchema");
const { executarCiclo, configWorker } = require("../services/sentinel/sentinelPollingWorker");

const FLAGS_ON = new Set(["true", "1", "on", "yes"]);
const SHUTDOWN_FORCADO_MS = 90000;

function workerHabilitado(env = process.env) {
  return FLAGS_ON.has(String(env.SENTINEL_WORKER_ENABLED || "").trim().toLowerCase());
}

// "41, 52" → [41, 52]; ignora entradas inválidas.
function lerAllowlist(env = process.env) {
  return [...new Set(String(env.SENTINEL_CONTAS_ALLOWLIST || "")
    .split(",").map((x) => x.trim()).filter(Boolean)
    .map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))];
}

function criarPoolSentinel(env = process.env) {
  const pool = new Pool({
    ...configConexao(),
    max: lerMsPositivo(env.SENTINEL_DB_POOL_MAX, 2),
    statement_timeout: lerMsPositivo(env.SENTINEL_STATEMENT_TIMEOUT_MS, 30000),
    connectionTimeoutMillis: lerMsPositivo(env.PG_POOL_CONNECTION_TIMEOUT_MS, 30000),
  });
  protegerConexoesDoPool(pool);
  return pool;
}

// Só as contas da allowlist que existem como conta ML ativa. Fora da allowlist
// nunca é processada, mesmo que esteja ativa.
async function selecionarContas(db, allowlist) {
  if (!allowlist.length) return [];
  const r = await db.query(
    `SELECT id FROM cliente_contas
      WHERE ativo = true AND marketplace = 'meli' AND external_account_id IS NOT NULL
        AND id = ANY($1::int[])
      ORDER BY id`,
    [allowlist]
  );
  return r.rows.map((row) => row.id);
}

// Um tick: seleciona contas da allowlist e roda um ciclo. Injetável para teste.
async function executarTick({ db, allowlist, deveParar, executar = executarCiclo, ...deps }) {
  const contaIds = await selecionarContas(db, allowlist);
  if (!contaIds.length) {
    console.log("[sentinel-worker] nenhuma conta da allowlist elegível (ativa/ML/seller) — nada a processar.");
    return { pulado: false, contas: [], semContas: true };
  }
  return executar({ contaIds, db, deveParar, ...deps });
}

// Retorna { iniciado:false } sem tocar banco/timer quando OFF ou sem allowlist.
async function iniciar({ env = process.env, logger = console, criarPool = criarPoolSentinel, executar = executarCiclo } = {}) {
  if (!workerHabilitado(env)) {
    logger.log("[sentinel-worker] OFF (SENTINEL_WORKER_ENABLED != true) — saindo sem fazer nada.");
    return { iniciado: false, motivo: "flag_off" };
  }
  const allowlist = lerAllowlist(env);
  if (!allowlist.length) {
    logger.log("[sentinel-worker] SENTINEL_CONTAS_ALLOWLIST vazia — não processa nenhuma conta; saindo.");
    return { iniciado: false, motivo: "allowlist_vazia" };
  }
  const cfg = configWorker(env);
  const db = criarPool(env);
  let parando = false;
  let timer = null;
  let cicloEmCurso = null;
  let resolverFim;
  const fim = new Promise((resolve) => { resolverFim = resolve; });

  // Somente leitura: o worker NUNCA aplica migration (etapa separada, com aprovação).
  try {
    await verificarSentinelSchema(db);
  } catch (err) {
    await db.end().catch(() => {});
    throw err;
  }
  logger.log(`[sentinel-worker] ON — contas ${allowlist.join(",")}, intervalo ${cfg.intervalMs}ms, pool max ${db.options?.max ?? "?"}`);

  const agendar = (ms) => {
    if (parando) return;
    timer = setTimeout(tick, ms);
  };
  const tick = async () => {
    timer = null;
    cicloEmCurso = (async () => {
      try {
        await executarTick({ db, allowlist, deveParar: () => parando, executar });
      } catch (err) {
        logger.error(`[sentinel-worker] ciclo falhou: ${err.message}`);
      }
    })();
    await cicloEmCurso;
    cicloEmCurso = null;
    agendar(cfg.intervalMs);
  };

  const parar = async (sinal) => {
    if (parando) return;
    parando = true;
    logger.log(`[sentinel-worker] ${sinal}: terminando a conta corrente e encerrando.`);
    if (timer) clearTimeout(timer);
    const forcado = setTimeout(() => {
      logger.error("[sentinel-worker] encerramento forçado (a conta corrente não terminou a tempo).");
      process.exit(1);
    }, SHUTDOWN_FORCADO_MS);
    if (typeof forcado.unref === "function") forcado.unref();
    if (cicloEmCurso) await cicloEmCurso;
    await db.end().catch(() => {});
    clearTimeout(forcado);
    resolverFim();
  };

  agendar(0);
  return { iniciado: true, parar, fim, db };
}

async function main() {
  const w = await iniciar();
  if (!w.iniciado) return;
  process.on("SIGTERM", () => w.parar("SIGTERM"));
  process.on("SIGINT", () => w.parar("SIGINT"));
  await w.fim;
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error(`[sentinel-worker] falhou: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { workerHabilitado, lerAllowlist, criarPoolSentinel, selecionarContas, executarTick, iniciar, main };
