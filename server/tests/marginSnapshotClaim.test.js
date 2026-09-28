// server/tests/marginSnapshotClaim.test.js
// Margin Snapshot — M2: claim atômico de margin_snapshot_runs
// (docs/AUDITORIA_WORKERS_E_PLANO_MARGIN_SNAPSHOT.md §8/§16/§23). Roda 100%
// contra fake db em memória, sem Postgres real — o claim é uma única
// instrução SQL (UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED
// LIMIT 1) RETURNING *), então a "prova de concorrência" aqui é pelo
// contrato/query: nenhum ponto do código lê o candidato e decide fora dessa
// única instrução, o que já é o suficiente para provar exclusividade — ver
// comentário em marginSnapshotRunRepository.claimNextQueuedRun.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const runRepo = require("../services/motorMargem/marginSnapshotRunRepository");
const { makeMarginSnapshotFakeDb } = require("./helpers/marginSnapshotFakeDb");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

function novoDb() {
  return makeMarginSnapshotFakeDb();
}

cenario("claimNextQueuedRun pega o run QUEUED e transiciona para RUNNING", async () => {
  const db = novoDb();
  const run = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });

  const claimado = await runRepo.claimNextQueuedRun({ db });
  assert.ok(claimado, "deveria claimar o run queued");
  assert.strictEqual(claimado.id, run.id);
  assert.strictEqual(claimado.status, "running");
  assert.ok(claimado.startedAt);
  assert.ok(claimado.heartbeatAt);
});

cenario("claimNextQueuedRun devolve null quando não há nenhum run QUEUED", async () => {
  const db = novoDb();
  const claimado = await runRepo.claimNextQueuedRun({ db });
  assert.strictEqual(claimado, null);
});

cenario("claimNextQueuedRun respeita ordem determinística created_at ASC, id ASC", async () => {
  const db = novoDb();
  const runA = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });
  const runB = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 6, reason: "manual_refresh", db });

  const primeiro = await runRepo.claimNextQueuedRun({ db });
  assert.strictEqual(primeiro.id, runA.id, "o mais antigo/menor id deve ser claimado primeiro");

  const segundo = await runRepo.claimNextQueuedRun({ db });
  assert.strictEqual(segundo.id, runB.id);
});

cenario("claimNextQueuedRun NUNCA pega RUNNING/COMPLETED/FAILED — só QUEUED", async () => {
  const db = novoDb();
  const runCompleted = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });
  await runRepo.updateRunStatus({ runId: runCompleted.id, status: "running", db });
  await runRepo.updateRunStatus({ runId: runCompleted.id, status: "completed", db });

  const runFailed = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 6, reason: "manual_refresh", db });
  await runRepo.updateRunStatus({ runId: runFailed.id, status: "running", db });
  await runRepo.updateRunStatus({ runId: runFailed.id, status: "failed", errorCode: "X", errorMessage: "y", db });

  const runQueued = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 7, reason: "manual_refresh", db });

  const claimado = await runRepo.claimNextQueuedRun({ db });
  assert.strictEqual(claimado.id, runQueued.id, "só o run queued (conta 7) pode ser claimado");

  const nada = await runRepo.claimNextQueuedRun({ db });
  assert.strictEqual(nada, null, "não há mais nenhum queued para claimar");
});

cenario("dois claims concorrentes (Promise.all) NUNCA recebem o mesmo run — só 1 dos dois ganha", async () => {
  const db = novoDb();
  const run = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });

  const [claimA, claimB] = await Promise.all([
    runRepo.claimNextQueuedRun({ db }),
    runRepo.claimNextQueuedRun({ db }),
  ]);

  const ganhadores = [claimA, claimB].filter(Boolean);
  assert.strictEqual(ganhadores.length, 1, "exatamente um dos dois claims deve ganhar o run");
  assert.strictEqual(ganhadores[0].id, run.id);
});

cenario("touchHeartbeat atualiza heartbeat_at só enquanto o run está RUNNING", async () => {
  const db = novoDb();
  const run = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });

  const antesDeRunning = await runRepo.touchHeartbeat(run.id, db);
  assert.strictEqual(antesDeRunning, null, "heartbeat não pode ser tocado num run ainda queued");

  await runRepo.claimNextQueuedRun({ db });
  const tocado = await runRepo.touchHeartbeat(run.id, db);
  assert.ok(tocado);
  assert.ok(tocado.heartbeatAt);
});

// ── Runner ───────────────────────────────────────────────────────────────

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
    console.error(`marginSnapshotClaim: ${falhas} de ${casos.length} cenários falharam`);
    process.exitCode = 1;
  } else {
    console.log(`marginSnapshotClaim: ok (${casos.length} cenários)`);
  }
}

main();
