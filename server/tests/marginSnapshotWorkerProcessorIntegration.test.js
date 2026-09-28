// server/tests/marginSnapshotWorkerProcessorIntegration.test.js
// Margin Snapshot — worker (M2/M3) + processor real (M3) ligados por
// composição (marginSnapshotWorkerFactory.createRealMarginSnapshotWorker),
// com DB fake e Motor fake — NUNCA chama o Mercado Livre real (a listagem do
// catálogo e o sleep também são injetados).
//
// QUEUED -> claim -> processor M3 -> snapshots persistidos -> COMPLETED
// QUEUED -> claim -> processor lança -> FAILED
// concorrência: limite de runs por processo + nunca 2 runs da mesma conta

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const C = require("../services/motorMargem/core");
const { createRealMarginSnapshotWorker } = require("../services/motorMargem/marginSnapshotWorkerFactory");
const { processMarginSnapshotRun } = require("../services/motorMargem/marginSnapshotProcessor");
const { resolveMarginSnapshotConfig } = require("../services/motorMargem/marginSnapshotConfig");
const runService = require("../services/motorMargem/marginSnapshotRunService");
const snapshotRepository = require("../services/motorMargem/marginSnapshotRepository");
const { makeMarginSnapshotFakeDb } = require("./helpers/marginSnapshotFakeDb");

const NOW = new Date("2026-09-25T12:00:00.000Z");
const SILENCIOSO = { log() {}, warn() {}, error() {} };

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

function itemSaudavel(itemId) {
  const bag = C.createEvidenceBag();
  const comumBase = { source: C.SOURCES.VENFORCE_BASE, kind: C.EVIDENCE_KINDS.PROJECTED, quality: C.EVIDENCE_QUALITY.DECLARED, observedAt: NOW };
  const comumMeli = { source: C.SOURCES.MELI_API, kind: C.EVIDENCE_KINDS.PROJECTED, quality: C.EVIDENCE_QUALITY.MEASURED, observedAt: NOW };
  bag.add(C.FIELDS.COST, { ...comumBase, value: 40 });
  bag.add(C.FIELDS.TAX_RATE, { ...comumBase, value: 0.1 });
  bag.add(C.FIELDS.FIXED_FEE, { ...comumBase, value: 0 });
  bag.add(C.FIELDS.PRICE, { ...comumMeli, value: 100 });
  bag.add(C.FIELDS.COMMISSION, { ...comumMeli, value: 12 });
  bag.add(C.FIELDS.COMMISSION_RATE, { ...comumMeli, value: 0.12 });
  bag.add(C.FIELDS.FREIGHT, { ...comumMeli, value: 20 });
  return C.buildMarginItem({
    identity: { clienteSlug: "cliente-teste", marketplace: "meli", itemId },
    bag,
    sales: { hasOrders: false },
    settlement: { available: false, motivo: "MERCADO_PAGO_NAO_INTEGRADO" },
    now: NOW,
  });
}

function preparedFake() {
  return {
    now: NOW,
    cliente: { id: 1, nome: "Cliente Teste", slug: "cliente-teste" },
    base: { id: 900, slug: "base-teste", nome: "Base Teste" },
    mlUserId: 555,
    periodo: { dateFrom: "2026-08-27", dateTo: "2026-09-25" },
    custos: { index: new Map(), total: 0 },
    vendasRaw: { sincronizado: false, pedidos: [], itens: [], componentes: [], imports: [], importSnapshotAt: null },
    porMlb: new Map(),
    reembolsoPorMlb: new Map(),
    naoAtribuido: { reembolso: 0 },
    reembolsos: [],
    fallbackObservedAt: null,
  };
}

function motorFake({ ids = ["MLB8000", "MLB8001", "MLB8002"], enrichDelay = null, falharContexto = false } = {}) {
  return {
    logger: SILENCIOSO,
    config: { ...resolveMarginSnapshotConfig({}), batchPauseMs: 0 },
    sleep: async () => {},
    prepareWorkspaceContext: async () => {
      if (falharContexto) throw new Error("GRANT_ML_NAO_CONECTADO");
      return preparedFake();
    },
    listarIdsCatalogo: async () => ({ ids, totalAtivos: ids.length, totalPausados: 0 }),
    enrichBatch: async (_prepared, { itemIds }) => {
      if (enrichDelay) await enrichDelay();
      return { totalItensMl: itemIds.length, itens: itemIds.map(itemSaudavel) };
    },
  };
}

cenario("QUEUED -> claim -> processor M3 -> snapshots persistidos -> run COMPLETED", async () => {
  const db = makeMarginSnapshotFakeDb();
  const { run } = await runService.enqueueMarginSnapshotRun({
    clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: 5, reason: "manual_refresh", db,
  });

  const worker = createRealMarginSnapshotWorker({
    db,
    logger: SILENCIOSO,
    processor: (runClaimado, deps) => processMarginSnapshotRun(runClaimado, { ...deps, ...motorFake() }),
  });
  const resultado = await worker.runOnce();

  assert.strictEqual(resultado.status, "completed");
  assert.strictEqual(resultado.run.status, "completed");

  for (let i = 0; i < 3; i++) {
    const linha = await snapshotRepository.getProjectionSnapshot({ clienteContaId: 5, itemId: `MLB${8000 + i}`, db });
    assert.ok(linha, `snapshot de MLB${8000 + i} deveria existir`);
    assert.strictEqual(linha.status, "HEALTHY");
  }

  const statusFinal = await runService.getRunStatus({ runId: run.id, clienteContaId: 5, db });
  assert.strictEqual(statusFinal.status, "completed");
  assert.strictEqual(statusFinal.processedItems, 3);
  assert.strictEqual(statusFinal.successItems, 3);
  assert.strictEqual(statusFinal.totalItems, 3);
});

cenario("QUEUED -> claim -> processor lança (erro estrutural) -> run FAILED, nenhum snapshot", async () => {
  const db = makeMarginSnapshotFakeDb();
  const { run } = await runService.enqueueMarginSnapshotRun({
    clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: 5, reason: "manual_refresh", db,
  });

  const worker = createRealMarginSnapshotWorker({
    db,
    logger: SILENCIOSO,
    processor: (runClaimado, deps) => processMarginSnapshotRun(runClaimado, { ...deps, ...motorFake({ falharContexto: true }) }),
  });
  const resultado = await worker.runOnce();

  assert.strictEqual(resultado.status, "failed");
  assert.ok(resultado.run.errorMessage.includes("GRANT_ML_NAO_CONECTADO"));
  const statusFinal = await runService.getRunStatus({ runId: run.id, clienteContaId: 5, db });
  assert.strictEqual(statusFinal.status, "failed");
  assert.strictEqual(db.snapshots.length, 0);
});

cenario("concorrência: o loop respeita o limite de runs simultâneos por processo", async () => {
  const db = makeMarginSnapshotFakeDb();
  for (const conta of [5, 6, 7]) {
    await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: conta, reason: "manual_refresh", db });
  }
  let emVoo = 0;
  let pico = 0;
  const liberar = [];
  const worker = createRealMarginSnapshotWorker({
    db,
    logger: SILENCIOSO,
    config: { ...resolveMarginSnapshotConfig({}), workerConcurrency: 2 },
    processor: async () => {
      emVoo += 1;
      pico = Math.max(pico, emVoo);
      await new Promise((resolve) => liberar.push(resolve));
      emVoo -= 1;
    },
  });

  await worker.tick();
  assert.strictEqual(worker.status().ativos, 2, "2 slots ocupados, o 3º run fica queued");
  assert.strictEqual(db.runs.filter((r) => r.status === "queued").length, 1);

  // Libera tudo: o slot liberado puxa o 3º run.
  while (liberar.length || db.runs.some((r) => r.status !== "completed")) {
    const fn = liberar.shift();
    if (fn) fn();
    await new Promise((r) => setImmediate(r));
  }
  assert.strictEqual(pico, 2, "nunca mais que 2 runs ao mesmo tempo");
  assert.ok(db.runs.every((r) => r.status === "completed"));
  await worker.stop();
});

cenario("claim exclui contas já em processamento neste processo (nunca 2 runs da mesma conta)", async () => {
  const db = makeMarginSnapshotFakeDb();
  // Simula o cenário perigoso: um run da conta 5 ainda em execução local e
  // outro run da MESMA conta enfileirado (ex.: o primeiro foi reconciliado
  // como stale por outra instância). Um run de outra conta também espera.
  await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: 5, reason: "manual_refresh", db });
  const liberar = [];
  const processados = [];
  const worker = createRealMarginSnapshotWorker({
    db,
    logger: SILENCIOSO,
    config: { ...resolveMarginSnapshotConfig({}), workerConcurrency: 3 },
    processor: async (run) => {
      processados.push(run.clienteContaId);
      await new Promise((resolve) => liberar.push(resolve));
    },
  });
  await worker.tick();
  assert.deepStrictEqual(processados, [5]);

  const emExecucao = db.runs.find((r) => r.cliente_conta_id === 5);
  emExecucao.status = "failed"; // "roubado" por reconciliação externa
  await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: 5, reason: "manual_refresh", db });
  await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: 6, reason: "manual_refresh", db });

  await worker.tick();
  assert.deepStrictEqual(processados, [5, 6], "o 2º run da conta 5 NÃO é reivindicado enquanto a conta 5 roda neste processo");
  const segundo5 = db.runs.filter((r) => r.cliente_conta_id === 5).pop();
  assert.strictEqual(segundo5.status, "queued");

  liberar.forEach((fn) => fn());
  await worker.stop();
});

cenario("stop(): aborta o run em curso — processor para entre lotes e o run termina failed com código tipado", async () => {
  const db = makeMarginSnapshotFakeDb();
  const { run } = await runService.enqueueMarginSnapshotRun({
    clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: 5, reason: "manual_refresh", db,
  });
  let worker = null;
  const ids = Array.from({ length: 60 }, (_, i) => `MLB${9000 + i}`);
  worker = createRealMarginSnapshotWorker({
    db,
    logger: SILENCIOSO,
    processor: (runClaimado, deps) => processMarginSnapshotRun(runClaimado, {
      ...deps,
      ...motorFake({ ids, enrichDelay: async () => { worker.stop(); } }),
    }),
  });
  const resultado = await worker.runOnce();
  assert.strictEqual(resultado.status, "failed");
  const final = await runService.getRunStatus({ runId: run.id, clienteContaId: 5, db });
  assert.strictEqual(final.errorCode, "MARGIN_SNAPSHOT_WORKER_STOPPED");
  assert.strictEqual(db.snapshots.length, 20, "lote concluído antes da parada permanece gravado");
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
    console.error(`marginSnapshotWorkerProcessorIntegration: ${falhas} de ${casos.length} cenários falharam`);
    process.exitCode = 1;
  } else {
    console.log(`marginSnapshotWorkerProcessorIntegration: ok (${casos.length} cenários)`);
  }
}

main();
