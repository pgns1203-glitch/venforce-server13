// server/tests/marginSnapshotHardening.test.js
// Margin Snapshot — M8: Retry-After de ponta a ponta (adapter → Motor →
// worker), claim concorrente, recovery por heartbeat, restart simulado,
// limpeza de timers, logs estruturados e ausência de segredo em log/
// metadata/erro. Fake db + fetch fake do ML; nenhuma rede, nenhum Postgres.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const meliApi = require("../services/motorMargem/adapters/meliApiEvidenceAdapter");
const { parseRetryAfter } = require("../utils/mlClient");
const { processMarginSnapshotRun } = require("../services/motorMargem/marginSnapshotProcessor");
const { createMarginSnapshotWorker } = require("../services/motorMargem/marginSnapshotWorker");
const { createRateLimiter } = require("../services/motorMargem/marginSnapshotRateLimiter");
const { resolveMarginSnapshotConfig } = require("../services/motorMargem/marginSnapshotConfig");
const runService = require("../services/motorMargem/marginSnapshotRunService");
const runRepository = require("../services/motorMargem/marginSnapshotRunRepository");
const snapshotRepository = require("../services/motorMargem/marginSnapshotRepository");
const { makeMarginSnapshotFakeDb } = require("./helpers/marginSnapshotFakeDb");
const fixture = require("./helpers/motorMargemFixture");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

const SILENCIOSO = { log() {}, warn() {}, error() {} };
const TOKEN = "APP_USR-1234567890-abcdefghij";
const REFRESH = "TG-9876543210-zyxwv";

function loggerCaptura() {
  const linhas = [];
  const push = (nivel) => (linha) => linhas.push({ nivel, linha: String(linha) });
  return { linhas, logger: { log: push("log"), warn: push("warn"), error: push("error") } };
}

function eventos(linhas) {
  return linhas.map((l) => { try { return JSON.parse(l.linha); } catch (_) { return null; } }).filter(Boolean);
}

function config(overrides = {}) {
  return { ...resolveMarginSnapshotConfig({}), batchPauseMs: 0, batchBackoffBaseMs: 1000, ...overrides };
}

function limiterZero() {
  return createRateLimiter({ minIntervalMs: 0, now: () => 0, sleep: async () => {} });
}

// ═══════════════════════════════════════════════════════════════════════════
// 9.1 Retry-After: adapter → Motor → worker (uma camada só decide)
// ═══════════════════════════════════════════════════════════════════════════

cenario("regressão do mlClient: parseRetryAfter continua lendo segundos e ignorando o resto", () => {
  const res = (valor) => ({ headers: { get: (h) => (h === "retry-after" ? valor : null) } });
  assert.strictEqual(parseRetryAfter(res("7")), 7);
  assert.strictEqual(parseRetryAfter(res("0")), 0);
  assert.strictEqual(parseRetryAfter(res(null)), null);
  assert.strictEqual(parseRetryAfter(res("Wed, 21 Oct 2026 07:28:00 GMT")), null, "HTTP-date → null (worker cai no backoff)");
  assert.strictEqual(parseRetryAfter(null), null);
});

cenario("adapter do Motor: 429 preserva contrato atual e carrega mlStatus/retryAfter", async () => {
  const fetch429 = async () => ({ ok: false, status: 429, retryAfter: 9, data: { message: "Too many requests" } });
  const fetch401 = async () => ({ ok: false, status: 401, retryAfter: null, data: { message: "invalid token" } });

  const e1 = await meliApi.buscarDetalhesItens({ clienteId: 1, ids: ["MLB1"] }, fetch429).catch((e) => e);
  assert.strictEqual(e1.statusCode, 429, "rate limit preserva o status real formalizado pelo adapter");
  assert.strictEqual(e1.codigo, "MELI_RATE_LIMIT");
  assert.strictEqual(e1.message, "Rate limit do Mercado Livre (429): Too many requests");
  assert.strictEqual(e1.mlStatus, 429);
  assert.strictEqual(e1.retryAfter, 9);

  const e2 = await meliApi.buscarItensAtivos({ clienteId: 1, mlUserId: "5", offset: 0, limit: 20 }, fetch401).catch((e) => e);
  assert.strictEqual(e2.statusCode, 422, "auth continua 422");
  assert.strictEqual(e2.mlStatus, 401);
});

cenario("429 atravessa o Motor REAL: o worker espera o Retry-After do ML, re-tenta o lote e não duplica", async () => {
  const db = makeMarginSnapshotFakeDb();
  const { run } = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: 5, reason: "manual_refresh", db });
  const running = await runRepository.updateRunStatus({ runId: run.id, status: "running", db });
  const motor = fixture.motorDeps({ comVendas: false });
  let chamadasDetalhe = 0;
  const sleeps = [];
  // O multiget do ML responde 429 + Retry-After: 4 na 1ª vez.
  const fetchMl = async (_clienteId, path) => {
    chamadasDetalhe += 1;
    if (chamadasDetalhe === 1) return { ok: false, status: 429, retryAfter: 4, data: { message: "rate limited" } };
    const ids = decodeURIComponent(path.split("ids=")[1]).split(",");
    const corpos = await motor.buscarDetalhesItens({ ids });
    return { ok: true, status: 200, data: corpos.map((body) => ({ code: 200, body })) };
  };
  await processMarginSnapshotRun(running, {
    ...motor,
    db, logger: SILENCIOSO, config: config(), rateLimiter: limiterZero(),
    sleep: async (ms) => { sleeps.push(ms); },
    listarIdsCatalogo: async () => ({ ids: ["MLB1", "MLB2", "MLB3"], totalAtivos: 3, totalPausados: 0 }),
    // enrichBatch REAL do Motor + adapter REAL de detalhes com fetch fake.
    buscarDetalhesItens: (args) => meliApi.buscarDetalhesItens(args, fetchMl),
  });
  assert.deepStrictEqual(sleeps, [4000], "esperou exatamente o Retry-After (sem retry duplo no mlClient)");
  assert.strictEqual(chamadasDetalhe, 2);
  assert.strictEqual(db.snapshots.length, 3);
  const final = await runRepository.getRunById({ runId: run.id, clienteContaId: 5, db });
  assert.strictEqual(final.metadata.processor.rateLimitedRetries, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// 9.3 Recovery / pickup
// ═══════════════════════════════════════════════════════════════════════════

cenario("dois workers (duas instâncias) disputando o mesmo run QUEUED: só um processa", async () => {
  const db = makeMarginSnapshotFakeDb();
  await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "x", clienteContaId: 5, reason: "manual_refresh", db });
  const processados = [];
  const w1 = createMarginSnapshotWorker({ db, logger: SILENCIOSO, processor: async (run) => { processados.push(["w1", run.id]); } });
  const w2 = createMarginSnapshotWorker({ db, logger: SILENCIOSO, processor: async (run) => { processados.push(["w2", run.id]); } });
  const resultados = await Promise.all([w1.runOnce(), w2.runOnce(), w1.runOnce(), w2.runOnce()]);
  assert.strictEqual(processados.length, 1, "exatamente um worker processou o run");
  assert.strictEqual(resultados.filter((r) => r.claimed).length, 1);
});

async function runMorto(db, { conta = 5, minutosSemHeartbeat = 30 } = {}) {
  const { run } = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "x", clienteContaId: conta, reason: "manual_refresh", db });
  await runRepository.updateRunStatus({ runId: run.id, status: "running", db });
  const row = db.runs.find((r) => r.id === run.id);
  row.heartbeat_at = new Date(Date.now() - minutosSemHeartbeat * 60000);
  return run;
}

cenario("heartbeat stale: novo refresh da conta reconcilia o run morto (failed + código) e cria um run novo", async () => {
  const db = makeMarginSnapshotFakeDb();
  const morto = await runMorto(db, { minutosSemHeartbeat: 30 });
  const novo = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "x", clienteContaId: 5, reason: "manual_refresh", db, staleMinutes: 10 });
  assert.strictEqual(novo.reaproveitado, false, "o run morto não bloqueia mais o refresh");
  const antigo = await runRepository.getRunById({ runId: morto.id, clienteContaId: 5, db });
  assert.strictEqual(antigo.status, "failed");
  assert.strictEqual(antigo.errorCode, "MARGIN_SNAPSHOT_RUN_STALE_RUNNING");
});

cenario("heartbeat recente NÃO é reconciliado (run vivo é reaproveitado)", async () => {
  const db = makeMarginSnapshotFakeDb();
  const vivo = await runMorto(db, { minutosSemHeartbeat: 2 });
  const r = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "x", clienteContaId: 5, reason: "manual_refresh", db, staleMinutes: 10 });
  assert.strictEqual(r.reaproveitado, true);
  assert.strictEqual(r.run.id, vivo.id);
});

cenario("reconciliação escopada nunca toca outra conta, run queued nem estado terminal", async () => {
  const db = makeMarginSnapshotFakeDb();
  const morto6 = await runMorto(db, { conta: 6, minutosSemHeartbeat: 60 });
  const { run: fila7 } = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "x", clienteContaId: 7, reason: "manual_refresh", db });
  db.runs.find((r) => r.id === fila7.id).created_at = new Date(Date.now() - 3 * 3600000);
  const concluido = await runMorto(db, { conta: 8, minutosSemHeartbeat: 60 });
  await runRepository.updateRunStatus({ runId: concluido.id, status: "completed", db });

  await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "x", clienteContaId: 5, reason: "manual_refresh", db, staleMinutes: 10 });
  assert.strictEqual(db.runs.find((r) => r.id === morto6.id).status, "running", "escopo por conta: a conta 6 fica para o loop global");
  assert.strictEqual(db.runs.find((r) => r.id === fila7.id).status, "queued", "queued nunca é reconciliado");

  const globais = await runService.reconcileStaleRuns({ staleMinutes: 10, db });
  assert.deepStrictEqual(globais.map((r) => r.id), [morto6.id]);
  assert.strictEqual(db.runs.find((r) => r.id === concluido.id).status, "completed", "terminal nunca é reaberto");
  assert.strictEqual(await runRepository.updateRunStatus({ runId: morto6.id, status: "completed", db }), null, "failed → completed é recusado");
});

cenario("restart simulado: run órfão é reconciliado pelo loop do novo worker e a conta volta a ser processada; snapshots preservados", async () => {
  const db = makeMarginSnapshotFakeDb();
  // Instância A processou 1 lote e "morreu" (deploy/restart) sem concluir.
  await snapshotRepository.upsertProjectionSnapshot({ clienteId: 1, clienteContaId: 5, itemId: "MLB1", status: "HEALTHY", price: 100, profit: 18, margin: 0.18, marginPercent: 18, quality: { evidencias: {} } }, db);
  const orfao = await runMorto(db, { minutosSemHeartbeat: 45 });

  // Instância B sobe com o loop real (tick) e o recovery ligado.
  const processados = [];
  const b = createMarginSnapshotWorker({
    db, logger: SILENCIOSO, staleMinutes: 10, reconcileIntervalMs: 0,
    processor: async (run) => { processados.push(run.id); },
  });
  await b.tick();
  assert.strictEqual(db.runs.find((r) => r.id === orfao.id).status, "failed", "órfão reconciliado pelo loop");

  const { run: novo } = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "x", clienteContaId: 5, reason: "manual_refresh", db });
  await b.tick();
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(processados, [novo.id]);
  assert.strictEqual((await snapshotRepository.getProjectionSnapshot({ clienteContaId: 5, itemId: "MLB1", db })).price, 100, "snapshot anterior intacto");
  await b.stop();
});

// ═══════════════════════════════════════════════════════════════════════════
// Timers / cleanup
// ═══════════════════════════════════════════════════════════════════════════

cenario("start/stop do worker não deixa timer vivo (nenhum Timeout pendurado)", async () => {
  const contar = () => process.getActiveResourcesInfo().filter((t) => t === "Timeout").length;
  const antes = contar();
  const db = makeMarginSnapshotFakeDb();
  const w = createMarginSnapshotWorker({ db, logger: SILENCIOSO, processor: async () => {} });
  w.start(50);
  await new Promise((r) => setTimeout(r, 120));
  await w.stop();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(contar(), antes, "timer do polling limpo no stop");
});

// ═══════════════════════════════════════════════════════════════════════════
// 9.4 Observabilidade + segredos
// ═══════════════════════════════════════════════════════════════════════════

cenario("logs estruturados respondem: qual run, conta, motivo, total, progresso, retries/429, duração", async () => {
  const db = makeMarginSnapshotFakeDb();
  await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "x", clienteContaId: 5, reason: "base_changed", db });
  const { linhas, logger } = loggerCaptura();
  let chamadas = 0;
  const motor = fixture.motorDeps({ comVendas: false });
  const w = createMarginSnapshotWorker({
    db, logger,
    processor: (run, ctx) => processMarginSnapshotRun(run, {
      ...ctx, ...motor, config: config(), rateLimiter: limiterZero(), sleep: async () => {},
      listarIdsCatalogo: async () => ({ ids: Object.keys(fixture.ANUNCIOS), totalAtivos: 3, totalPausados: 0 }),
      enrichBatch: async (prepared, args, deps) => {
        chamadas += 1;
        if (chamadas === 1) throw Object.assign(new Error("rate limited"), { statusCode: 502, mlStatus: 429, retryAfter: 1 });
        return require("../services/motorMargem/motorMargemService").enrichBatch(prepared, args, deps);
      },
    }),
  });
  await w.runOnce();
  const ev = eventos(linhas);
  const nomes = ev.map((e) => e.event);
  for (const nome of ["margin_snapshot_run_started", "margin_snapshot_catalog_listed", "margin_snapshot_retry", "margin_snapshot_batch_progress", "margin_snapshot_processed", "margin_snapshot_run_completed"]) {
    assert.ok(nomes.includes(nome), `evento ${nome} presente`);
  }
  const inicio = ev.find((e) => e.event === "margin_snapshot_run_started");
  assert.strictEqual(inicio.cliente_conta_id, 5);
  assert.strictEqual(inicio.reason, "base_changed");
  const retry = ev.find((e) => e.event === "margin_snapshot_retry");
  assert.strictEqual(retry.rate_limited, true);
  assert.strictEqual(retry.status, 429);
  const fim = ev.find((e) => e.event === "margin_snapshot_run_completed");
  assert.strictEqual(fim.total, 3);
  assert.ok(typeof fim.duracao_ms === "number");
});

cenario("nenhum token/refresh token aparece em log, metadata do run, error_message nem last_error", async () => {
  const db = makeMarginSnapshotFakeDb();
  const { linhas, logger } = loggerCaptura();
  // Run 1: lote falha com mensagem contendo token → last_error + logs.
  await snapshotRepository.upsertProjectionSnapshot({ clienteId: 1, clienteContaId: 5, itemId: "MLB1000", status: "HEALTHY", price: 100, quality: { evidencias: {} } }, db);
  await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "x", clienteContaId: 5, reason: "manual_refresh", db });
  const vazamento = `Authorization: Bearer ${TOKEN} refresh_token=${REFRESH} access_token=${TOKEN}`;
  const w = createMarginSnapshotWorker({
    db, logger,
    processor: (run, ctx) => processMarginSnapshotRun(run, {
      ...ctx, config: config({ batchMaxAttempts: 2, maxConsecutiveBatchFailures: 1 }), rateLimiter: limiterZero(), sleep: async () => {},
      prepareWorkspaceContext: async () => ({ now: new Date(), cliente: { id: 1 }, base: { id: 1 }, mlUserId: "9" }),
      listarIdsCatalogo: async () => ({ ids: ["MLB1000", "MLB1001"], totalAtivos: 2, totalPausados: 0 }),
      enrichBatch: async () => { throw Object.assign(new Error(`ML recusou: ${vazamento}`), { statusCode: 502 }); },
    }),
  });
  const r = await w.runOnce();
  assert.strictEqual(r.status, "failed");

  const tudo = [
    ...linhas.map((l) => l.linha),
    JSON.stringify(db.runs),
    JSON.stringify(db.snapshots),
  ].join("\n");
  assert.ok(!tudo.includes(TOKEN), "access token nunca aparece");
  assert.ok(!tudo.includes(REFRESH), "refresh token nunca aparece");
  assert.ok(tudo.includes("[REDACTED]"), "a mensagem continua útil, só com o segredo redigido");
  const linha = await snapshotRepository.getProjectionSnapshot({ clienteContaId: 5, itemId: "MLB1000", db });
  assert.strictEqual(linha.refreshStatus, "failed");
  await assert.rejects(() => runRepository.mergeRunMetadata({ runId: 1, patch: { nested: { refresh_token: "x" } }, db }), /sensivel/);
});

async function main() {
  let falhas = 0;
  for (const caso of casos) {
    try {
      await caso.fn();
      console.log(`  ✓ ${caso.nome}`);
    } catch (err) {
      falhas += 1;
      console.error(`  ✗ ${caso.nome}\n    ${err.stack || err.message}`);
    }
  }
  if (falhas > 0) {
    console.error(`marginSnapshotHardening: ${falhas} de ${casos.length} cenários falharam`);
    process.exitCode = 1;
  } else {
    console.log(`marginSnapshotHardening: ok (${casos.length} cenários)`);
  }
}

main();
