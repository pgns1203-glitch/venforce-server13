// server/tests/marginSnapshotRunService.test.js
// Margin Snapshot — M2: run service (enqueue/dedupe/status/lifecycle),
// docs/AUDITORIA_WORKERS_E_PLANO_MARGIN_SNAPSHOT.md §9.2/§18/§19 (D5).
// Mesmo espírito de centralVendasSyncRunService.criarSyncRun, mas SEM
// período (dedupe só por cliente_id + cliente_conta_id + marketplace, ver
// §9.2 do plano — decisão deliberadamente diferente do sync de vendas) e
// SEM resolveMarketplaceAccountContext (M2 não toca no ML; identidade já
// vem resolvida do chamador). Roda 100% contra fake db em memória.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const runService = require("../services/motorMargem/marginSnapshotRunService");
const { makeMarginSnapshotFakeDb } = require("./helpers/marginSnapshotFakeDb");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

function novoDb() {
  return makeMarginSnapshotFakeDb();
}

// ── 1. enqueue cria run QUEUED ──────────────────────────────────────────

cenario("enqueueMarginSnapshotRun cria um run queued na primeira chamada", async () => {
  const db = novoDb();
  const { run, reaproveitado } = await runService.enqueueMarginSnapshotRun({
    clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, marketplace: "meli", reason: "manual_refresh", db,
  });

  assert.strictEqual(run.status, "queued");
  assert.strictEqual(run.clienteContaId, 5);
  assert.strictEqual(reaproveitado, false);
});

// ── 2. segundo enqueue equivalente reutiliza/deduplica ──────────────────

cenario("um segundo enqueue equivalente reutiliza o run ativo (não cria um segundo)", async () => {
  const db = novoDb();
  const primeiro = await runService.enqueueMarginSnapshotRun({
    clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db,
  });
  const segundo = await runService.enqueueMarginSnapshotRun({
    clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "central_vendas_sync_completed", db,
  });

  assert.strictEqual(segundo.run.id, primeiro.run.id);
  assert.strictEqual(segundo.reaproveitado, true);
});

cenario("enqueue A, B, C para a mesma conta resultam em 1 único run ativo", async () => {
  const db = novoDb();
  const a = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });
  const b = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });
  const c = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "base_changed", db });

  assert.strictEqual(a.run.id, b.run.id);
  assert.strictEqual(b.run.id, c.run.id);
  assert.strictEqual(a.reaproveitado, false);
  assert.strictEqual(b.reaproveitado, true);
  assert.strictEqual(c.reaproveitado, true);
});

// ── 3. conta 5 e conta 6 geram runs distintos ───────────────────────────

cenario("contas diferentes do mesmo cliente geram runs distintos (conta 5 nunca vê conta 6)", async () => {
  const db = novoDb();
  const conta5 = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });
  const conta6 = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 6, reason: "manual_refresh", db });

  assert.notStrictEqual(conta5.run.id, conta6.run.id);
  assert.strictEqual(conta5.reaproveitado, false);
  assert.strictEqual(conta6.reaproveitado, false);
});

// ── 4. marketplace distinto gera run distinto ───────────────────────────

cenario("marketplaces diferentes para a mesma conta geram runs distintos", async () => {
  const db = novoDb();
  const meli = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, marketplace: "meli", reason: "manual_refresh", db });
  const shopee = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, marketplace: "shopee", reason: "manual_refresh", db });

  assert.notStrictEqual(meli.run.id, shopee.run.id);
});

// ── 5. race de unique é tratada como dedupe, não erro fatal ────────────

cenario("uma corrida de INSERT (23505) simultânea é tratada como dedupe — nunca propaga erro fatal", async () => {
  const db = novoDb();
  // Simula a corrida: dois enqueues concorrentes via Promise.all — o fake db
  // lança 23505 no segundo INSERT porque o índice único já foi violado pelo
  // primeiro (mesmo contrato real do Postgres).
  const [a, b] = await Promise.all([
    runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db }),
    runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "central_vendas_sync_completed", db }),
  ]);

  assert.strictEqual(a.run.id, b.run.id, "os dois devem convergir no mesmo run, nunca lançar 500");
  const reaproveitados = [a.reaproveitado, b.reaproveitado].filter(Boolean).length;
  assert.strictEqual(reaproveitados, 1, "exatamente um dos dois deve reconhecer que reaproveitou");
});

// ── 6. status pode ser consultado ───────────────────────────────────────

cenario("getRunStatus devolve o status account-scoped do run", async () => {
  const db = novoDb();
  const { run } = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });

  const status = await runService.getRunStatus({ runId: run.id, clienteContaId: 5, db });
  assert.strictEqual(status.id, run.id);
  assert.strictEqual(status.status, "queued");
});

cenario("getRunStatus nunca devolve run de outra conta", async () => {
  const db = novoDb();
  const { run } = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });

  const status = await runService.getRunStatus({ runId: run.id, clienteContaId: 6, db });
  assert.strictEqual(status, null);
});

// ── 7. identidade inválida é rejeitada ──────────────────────────────────

cenario("enqueueMarginSnapshotRun rejeita identidade incompleta (clienteId/clienteContaId/reason)", async () => {
  const db = novoDb();
  await assert.rejects(() => runService.enqueueMarginSnapshotRun({ clienteContaId: 5, reason: "manual_refresh", db }), /clienteId/);
  await assert.rejects(() => runService.enqueueMarginSnapshotRun({ clienteId: 1, reason: "manual_refresh", db }), /clienteContaId/);
  await assert.rejects(() => runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteContaId: 5, db }), /reason/);
});

// ── lifecycle: markRunCompleted / markRunFailed ─────────────────────────

cenario("markRunCompleted transiciona running -> completed", async () => {
  const db = novoDb();
  const { run } = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });
  await runService.claimNextQueuedRun(db);

  const concluido = await runService.markRunCompleted(run.id, db);
  assert.strictEqual(concluido.status, "completed");
  assert.ok(concluido.finishedAt);
});

cenario("markRunFailed transiciona running -> failed preservando erro sanitizado", async () => {
  const db = novoDb();
  const { run } = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });
  await runService.claimNextQueuedRun(db);

  const falhado = await runService.markRunFailed(run.id, { code: "PROCESSOR_ERROR", message: "falhou" }, db);
  assert.strictEqual(falhado.status, "failed");
  assert.strictEqual(falhado.errorCode, "PROCESSOR_ERROR");
  assert.strictEqual(falhado.errorMessage, "falhou");
});

// ── claim passthrough ────────────────────────────────────────────────────

cenario("claimNextQueuedRun (passthrough do service) pega o run mais antigo", async () => {
  const db = novoDb();
  const { run } = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });

  const claimado = await runService.claimNextQueuedRun(db);
  assert.strictEqual(claimado.id, run.id);
  assert.strictEqual(claimado.status, "running");
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
    console.error(`marginSnapshotRunService: ${falhas} de ${casos.length} cenários falharam`);
    process.exitCode = 1;
  } else {
    console.log(`marginSnapshotRunService: ok (${casos.length} cenários)`);
  }
}

main();
