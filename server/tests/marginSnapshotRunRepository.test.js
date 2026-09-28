// server/tests/marginSnapshotRunRepository.test.js
// M1 da fundação de Margin Snapshot — repository de margin_snapshot_runs.
// Roda 100% contra fake db em memória (tests/helpers/marginSnapshotFakeDb.js
// — mesmo padrão de tests/helpers/mpSettlementFakeDb.js), sem Postgres real,
// conforme exigido pelo prompt de M1 (§4/§12).

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

// ── 1. cria run ──────────────────────────────────────────────────────────

cenario("createRun cria um run queued com os campos preservados", async () => {
  const db = novoDb();
  const run = await runRepo.createRun({
    clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, marketplace: "meli",
    baseId: 9, reason: "manual_refresh", requestedBy: 42, db,
  });

  assert.strictEqual(run.status, "queued");
  assert.strictEqual(run.clienteId, 1);
  assert.strictEqual(run.clienteContaId, 5);
  assert.strictEqual(run.marketplace, "meli");
  assert.strictEqual(run.baseId, 9);
  assert.strictEqual(run.reason, "manual_refresh");
  assert.strictEqual(run.requestedBy, 42);
  assert.strictEqual(run.totalItems, null);
  assert.strictEqual(run.processedItems, 0);
  assert.strictEqual(run.successItems, 0);
  assert.strictEqual(run.failedItems, 0);
  assert.strictEqual(run.cursorOffset, 0);
});

cenario("createRun exige clienteId, clienteContaId e reason", async () => {
  const db = novoDb();
  await assert.rejects(() => runRepo.createRun({ clienteSlug: "x", clienteContaId: 5, reason: "manual_refresh", db }), /clienteId/);
  await assert.rejects(() => runRepo.createRun({ clienteId: 1, clienteSlug: "x", reason: "manual_refresh", db }), /clienteContaId/);
  await assert.rejects(() => runRepo.createRun({ clienteId: 1, clienteSlug: "x", clienteContaId: 5, db }), /reason/);
});

// ── Dedupe (§14 do prompt: só a fundação de banco, sem lógica de fila) ──

cenario("dois runs ativos para a MESMA conta colidem com erro 23505 (fundação do índice único, sem tratamento de fila)", async () => {
  const db = novoDb();
  await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });

  await assert.rejects(
    () => runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "central_vendas_sync_completed", db }),
    (err) => err.code === "23505"
  );
});

cenario("runs ativos de CONTAS diferentes do mesmo cliente não colidem", async () => {
  const db = novoDb();
  const runConta5 = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });
  const runConta6 = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 6, reason: "manual_refresh", db });

  assert.notStrictEqual(runConta5.id, runConta6.id);
  assert.strictEqual(runConta5.clienteContaId, 5);
  assert.strictEqual(runConta6.clienteContaId, 6);
});

cenario("um novo run para a mesma conta é permitido depois que o anterior termina (completed)", async () => {
  const db = novoDb();
  const run1 = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });
  await runRepo.updateRunStatus({ runId: run1.id, status: "running", db });
  await runRepo.updateRunStatus({ runId: run1.id, status: "completed", db });

  const run2 = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });
  assert.notStrictEqual(run2.id, run1.id);
});

// ── 2/6. lê por id, account-scoped (P0) ─────────────────────────────────

cenario("getRunById devolve o run quando a conta bate", async () => {
  const db = novoDb();
  const run = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 6, reason: "manual_refresh", db });

  const lido = await runRepo.getRunById({ runId: run.id, clienteContaId: 6, db });
  assert.strictEqual(lido.id, run.id);
});

cenario("getRunById NUNCA devolve o run de outra conta do mesmo cliente (conta 6 não lê run da conta 5)", async () => {
  const db = novoDb();
  const runConta5 = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });

  const lidoComContaErrada = await runRepo.getRunById({ runId: runConta5.id, clienteContaId: 6, db });
  assert.strictEqual(lidoComContaErrada, null, "conta 6 nunca pode ler o run da conta 5");
});

cenario("getRunById exige clienteContaId (leitura sempre account-scoped)", async () => {
  const db = novoDb();
  await assert.rejects(() => runRepo.getRunById({ runId: 1, db }), /clienteContaId/);
});

// ── findActiveRunForAccount ──────────────────────────────────────────────

cenario("findActiveRunForAccount encontra o run queued/running mais recente da conta", async () => {
  const db = novoDb();
  const run = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });

  const ativo = await runRepo.findActiveRunForAccount({ clienteId: 1, clienteContaId: 5, db });
  assert.strictEqual(ativo.id, run.id);
});

cenario("findActiveRunForAccount não encontra nada para uma conta sem run ativo", async () => {
  const db = novoDb();
  const ativo = await runRepo.findActiveRunForAccount({ clienteId: 1, clienteContaId: 999, db });
  assert.strictEqual(ativo, null);
});

// ── 3. atualiza status (transições estritas) ────────────────────────────

cenario("updateRunStatus transita queued -> running -> completed", async () => {
  const db = novoDb();
  const run = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });

  const rodando = await runRepo.updateRunStatus({ runId: run.id, status: "running", db });
  assert.strictEqual(rodando.status, "running");
  assert.ok(rodando.startedAt, "started_at precisa ser preenchido ao entrar em running");

  const concluido = await runRepo.updateRunStatus({ runId: run.id, status: "completed", db });
  assert.strictEqual(concluido.status, "completed");
  assert.ok(concluido.finishedAt, "finished_at precisa ser preenchido ao terminar");
});

cenario("updateRunStatus transita running -> failed preservando error_code/error_message", async () => {
  const db = novoDb();
  const run = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });
  await runRepo.updateRunStatus({ runId: run.id, status: "running", db });

  const falhado = await runRepo.updateRunStatus({ runId: run.id, status: "failed", errorCode: "ML_429", errorMessage: "rate limited", db });
  assert.strictEqual(falhado.status, "failed");
  assert.strictEqual(falhado.errorCode, "ML_429");
  assert.strictEqual(falhado.errorMessage, "rate limited");
});

cenario("updateRunStatus NUNCA pula estado — completed->running é rejeitado silenciosamente (guarda estrita)", async () => {
  const db = novoDb();
  const run = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });
  await runRepo.updateRunStatus({ runId: run.id, status: "running", db });
  await runRepo.updateRunStatus({ runId: run.id, status: "completed", db });

  // Tentar "reabrir" um run completed chamando running de novo não pode
  // funcionar — a guarda exige status='queued' para virar running.
  const tentativa = await runRepo.updateRunStatus({ runId: run.id, status: "running", db });
  assert.strictEqual(tentativa, null, "um run completed nunca pode voltar para running");
});

cenario("updateRunStatus NUNCA pula estado — queued->completed direto é rejeitado (precisa passar por running)", async () => {
  const db = novoDb();
  const run = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });

  const tentativa = await runRepo.updateRunStatus({ runId: run.id, status: "completed", db });
  assert.strictEqual(tentativa, null, "queued->completed direto não é uma transição válida");
});

// ── 8. status inválido rejeitado ────────────────────────────────────────

cenario("updateRunStatus rejeita um status fora da máquina de estados aprovada (sem PARTIAL/CANCELLED em M1)", async () => {
  const db = novoDb();
  const run = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });

  await assert.rejects(
    () => runRepo.updateRunStatus({ runId: run.id, status: "partial", db }),
    /não é suportada/
  );
  await assert.rejects(
    () => runRepo.updateRunStatus({ runId: run.id, status: "cancelled", db }),
    /não é suportada/
  );
});

// ── 4. atualiza progresso ────────────────────────────────────────────────

cenario("updateRunProgress atualiza contadores e heartbeat só enquanto o run está running", async () => {
  const db = novoDb();
  const run = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });
  await runRepo.updateRunStatus({ runId: run.id, status: "running", db });

  const progresso = await runRepo.updateRunProgress({
    runId: run.id, processedItems: 20, successItems: 19, failedItems: 1, cursorOffset: 20, totalItems: 5000, db,
  });

  assert.strictEqual(progresso.processedItems, 20);
  assert.strictEqual(progresso.successItems, 19);
  assert.strictEqual(progresso.failedItems, 1);
  assert.strictEqual(progresso.cursorOffset, 20);
  assert.strictEqual(progresso.totalItems, 5000);
  assert.ok(progresso.heartbeatAt);
});

cenario("updateRunProgress não faz nada num run que ainda não começou (status queued)", async () => {
  const db = novoDb();
  const run = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });

  const resultado = await runRepo.updateRunProgress({
    runId: run.id, processedItems: 20, successItems: 20, failedItems: 0, cursorOffset: 20, db,
  });
  assert.strictEqual(resultado, null, "progresso só é gravável em running");
});

// ── 7. timestamps ────────────────────────────────────────────────────────

cenario("timestamps: created_at sempre presente; started_at/finished_at/heartbeat_at só depois da transição correspondente", async () => {
  const db = novoDb();
  const run = await runRepo.createRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });

  assert.ok(run.createdAt);
  assert.strictEqual(run.startedAt, null);
  assert.strictEqual(run.finishedAt, null);
  assert.strictEqual(run.heartbeatAt, null);

  const rodando = await runRepo.updateRunStatus({ runId: run.id, status: "running", db });
  assert.ok(rodando.startedAt);
  assert.ok(rodando.heartbeatAt);
  assert.strictEqual(rodando.finishedAt, null);

  const concluido = await runRepo.updateRunStatus({ runId: run.id, status: "completed", db });
  assert.ok(concluido.finishedAt);
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
    console.error(`marginSnapshotRunRepository: ${falhas} de ${casos.length} cenários falharam`);
    process.exitCode = 1;
  } else {
    console.log(`marginSnapshotRunRepository: ok (${casos.length} cenários)`);
  }
}

main();
