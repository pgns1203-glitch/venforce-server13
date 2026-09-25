// server/tests/marginSnapshotWorkerProcessorIntegration.test.js
// Margin Snapshot — M3 §30: worker (M2) + processor real (M3) ligados por
// composição (marginSnapshotWorkerFactory.createRealMarginSnapshotWorker),
// com DB fake e Motor fake — NUNCA chama o Mercado Livre real.
//
// QUEUED -> claim -> processor M3 -> snapshots fake persistidos -> COMPLETED
// QUEUED -> claim -> processor lança -> FAILED

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const C = require("../services/motorMargem/core");
const { createRealMarginSnapshotWorker } = require("../services/motorMargem/marginSnapshotWorkerFactory");
const { processMarginSnapshotRun } = require("../services/motorMargem/marginSnapshotProcessor");
const runService = require("../services/motorMargem/marginSnapshotRunService");
const snapshotRepository = require("../services/motorMargem/marginSnapshotRepository");
const { makeMarginSnapshotFakeDb } = require("./helpers/marginSnapshotFakeDb");

const NOW = new Date("2026-09-25T12:00:00.000Z");

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

cenario("QUEUED -> claim -> processor M3 -> snapshots persistidos -> run COMPLETED", async () => {
  const db = makeMarginSnapshotFakeDb();
  const { run } = await runService.enqueueMarginSnapshotRun({
    clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: 5, reason: "manual_refresh", db,
  });

  const motorDeps = {
    prepareWorkspaceContext: async () => preparedFake(),
    enrichBatch: async (_prepared, { offset, limit }) => {
      const total = 3;
      const fim = Math.min(offset + limit, total);
      const itens = [];
      for (let i = offset; i < fim; i++) itens.push(itemSaudavel(`MLB${8000 + i}`));
      return { totalItensMl: total, itens };
    },
  };

  const worker = createRealMarginSnapshotWorker({
    db,
    processor: (runClaimado, deps) => processMarginSnapshotRun(runClaimado, { ...deps, ...motorDeps }),
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
});

cenario("QUEUED -> claim -> processor lança (erro estrutural) -> run FAILED", async () => {
  const db = makeMarginSnapshotFakeDb();
  const { run } = await runService.enqueueMarginSnapshotRun({
    clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: 5, reason: "manual_refresh", db,
  });

  const motorDeps = {
    prepareWorkspaceContext: async () => { throw new Error("GRANT_ML_NAO_CONECTADO"); },
    enrichBatch: async () => { throw new Error("enrichBatch não deveria ser chamado"); },
  };

  const worker = createRealMarginSnapshotWorker({
    db,
    processor: (runClaimado, deps) => processMarginSnapshotRun(runClaimado, { ...deps, ...motorDeps }),
  });
  const resultado = await worker.runOnce();

  assert.strictEqual(resultado.status, "failed");
  assert.strictEqual(resultado.run.status, "failed");
  assert.ok(resultado.run.errorMessage.includes("GRANT_ML_NAO_CONECTADO"));

  const statusFinal = await runService.getRunStatus({ runId: run.id, clienteContaId: 5, db });
  assert.strictEqual(statusFinal.status, "failed");

  const linha = await snapshotRepository.getProjectionSnapshot({ clienteContaId: 5, itemId: "MLB8000", db });
  assert.strictEqual(linha, null, "nenhum snapshot deve existir quando o processor falha antes de processar qualquer item");
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
