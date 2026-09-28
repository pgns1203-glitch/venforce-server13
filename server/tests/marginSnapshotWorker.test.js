// server/tests/marginSnapshotWorker.test.js
// Margin Snapshot — M2: worker básico testável por injeção de dependência
// (docs/AUDITORIA_WORKERS_E_PLANO_MARGIN_SNAPSHOT.md §10/§13/§14/§24).
//
// O worker de M2 NÃO tem processor real — todo teste aqui usa processor
// fake injetado. Nenhuma chamada a prepareWorkspaceContext/enrichBatch/
// mlFetch/Mercado Livre acontece neste arquivo nem no módulo testado
// (confirmado por não haver nenhum import desses símbolos aqui).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const { createMarginSnapshotWorker } = require("../services/motorMargem/marginSnapshotWorker");
const runService = require("../services/motorMargem/marginSnapshotRunService");
const { makeMarginSnapshotFakeDb } = require("./helpers/marginSnapshotFakeDb");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

function novoDb() {
  return makeMarginSnapshotFakeDb();
}

// ── Sucesso: QUEUED -> claim -> processor 1x -> COMPLETED ──────────────

cenario("runOnce: com 1 run QUEUED, claima, chama o processor 1x e marca COMPLETED", async () => {
  const db = novoDb();
  const { run } = await runService.enqueueMarginSnapshotRun({
    clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db,
  });

  let chamadas = 0;
  const processor = async (runClaimado) => {
    chamadas += 1;
    assert.strictEqual(runClaimado.id, run.id);
    assert.strictEqual(runClaimado.status, "running", "o worker deve entregar o run já em running ao processor");
  };

  const worker = createMarginSnapshotWorker({ processor, db });
  const resultado = await worker.runOnce();

  assert.strictEqual(chamadas, 1, "processor deve ser chamado exatamente 1 vez");
  assert.strictEqual(resultado.status, "completed");
  assert.strictEqual(resultado.run.status, "completed");

  const statusFinal = await runService.getRunStatus({ runId: run.id, clienteContaId: 5, db });
  assert.strictEqual(statusFinal.status, "completed");
});

// ── Erro: QUEUED -> claim -> processor lança -> FAILED, last_error salvo ─

cenario("runOnce: se o processor lançar, marca FAILED e preserva o erro sanitizado", async () => {
  const db = novoDb();
  const { run } = await runService.enqueueMarginSnapshotRun({
    clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db,
  });

  const processor = async () => {
    throw new Error("falha simulada do processor fake");
  };

  const worker = createMarginSnapshotWorker({ processor, db });
  const resultado = await worker.runOnce();

  assert.strictEqual(resultado.status, "failed");
  assert.strictEqual(resultado.run.status, "failed");
  assert.ok(resultado.run.errorMessage.includes("falha simulada"));

  const statusFinal = await runService.getRunStatus({ runId: run.id, clienteContaId: 5, db });
  assert.strictEqual(statusFinal.status, "failed");
  assert.ok(statusFinal.errorMessage);
});

cenario("runOnce: erro do processor nunca salva stack gigante — só a mensagem, truncada", async () => {
  const db = novoDb();
  await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });

  const mensagemGigante = "x".repeat(5000);
  const processor = async () => { throw new Error(mensagemGigante); };

  const worker = createMarginSnapshotWorker({ processor, db });
  const resultado = await worker.runOnce();

  assert.strictEqual(resultado.status, "failed");
  assert.ok(resultado.run.errorMessage.length <= 2000, "mensagem de erro persistida deve ser truncada, nunca ilimitada");
  assert.ok(!resultado.run.errorMessage.includes("at ("), "nunca deve conter frame de stack trace");
});

// ── Vazio: sem QUEUED -> processor não chamado ──────────────────────────

cenario("runOnce: sem nenhum run QUEUED, o processor NUNCA é chamado", async () => {
  const db = novoDb();
  let chamadas = 0;
  const processor = async () => { chamadas += 1; };

  const worker = createMarginSnapshotWorker({ processor, db });
  const resultado = await worker.runOnce();

  assert.strictEqual(chamadas, 0);
  assert.strictEqual(resultado.claimed, false);
  assert.strictEqual(resultado.run, null);
});

// ── Stop: depois de stop(), não pega run novo ───────────────────────────

cenario("stop(): depois de chamado, runOnce não claima nenhum run novo", async () => {
  const db = novoDb();
  await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });

  let chamadas = 0;
  const processor = async () => { chamadas += 1; };
  const worker = createMarginSnapshotWorker({ processor, db });

  worker.stop();
  const resultado = await worker.runOnce();

  assert.strictEqual(chamadas, 0, "processor não pode ser chamado depois de stop()");
  assert.strictEqual(resultado.claimed, false);
  assert.strictEqual(resultado.stopped, true);
});

// ── Multi-run: 1 run por chamada, nunca processa em paralelo ────────────

cenario("runOnce processa só 1 run por chamada — chamar de novo processa o próximo", async () => {
  const db = novoDb();
  const a = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });
  const b = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 6, reason: "manual_refresh", db });

  const processados = [];
  const processor = async (run) => { processados.push(run.id); };
  const worker = createMarginSnapshotWorker({ processor, db });

  const r1 = await worker.runOnce();
  const r2 = await worker.runOnce();
  const r3 = await worker.runOnce();

  assert.deepStrictEqual(processados, [a.run.id, b.run.id]);
  assert.strictEqual(r1.claimed, true);
  assert.strictEqual(r2.claimed, true);
  assert.strictEqual(r3.claimed, false, "não há um terceiro run — idle, não erro");
});

// ── M3: loop de produção (start/kick/stop) ──────────────────────────────

cenario("start(): faz pickup de run QUEUED sem chamada explícita; stop() limpa o timer e drena", async () => {
  const db = novoDb();
  await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });
  const processados = [];
  const worker = createMarginSnapshotWorker({ processor: async (run) => { processados.push(run.id); }, db, logger: { error() {} } });

  worker.start(60000); // intervalo longo: o 1º tick é imediato (setImmediate)
  for (let i = 0; i < 20 && !processados.length; i += 1) await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(processados, [1]);
  assert.strictEqual(worker.status().running, true);

  await worker.stop();
  assert.strictEqual(worker.status().running, false, "timer limpo no stop");
  assert.strictEqual(worker.status().ativos, 0);
});

cenario("kick(): um run enfileirado depois do start é processado sem esperar o intervalo", async () => {
  const db = novoDb();
  const processados = [];
  const worker = createMarginSnapshotWorker({ processor: async (run) => { processados.push(run.id); }, db, logger: { error() {} } });
  worker.start(60000);
  await new Promise((r) => setImmediate(r));

  const { run } = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });
  worker.kick();
  for (let i = 0; i < 20 && !processados.length; i += 1) await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(processados, [run.id]);
  await worker.stop();
});

cenario("runOnce() saturado (limite atingido) não reivindica run novo", async () => {
  const db = novoDb();
  await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 5, reason: "manual_refresh", db });
  await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 6, reason: "manual_refresh", db });
  let liberar;
  const worker = createMarginSnapshotWorker({
    processor: () => new Promise((r) => { liberar = r; }), db, maxConcurrentRuns: 1, logger: { error() {} },
  });
  const primeiro = worker.runOnce();
  await new Promise((r) => setImmediate(r));
  const segundo = await worker.runOnce();
  assert.strictEqual(segundo.saturated, true);
  assert.strictEqual(db.runs.filter((r) => r.status === "queued").length, 1);
  liberar();
  await primeiro;
});

// ── processor precisa ser injetável e é obrigatório ─────────────────────

cenario("createMarginSnapshotWorker exige um processor (nenhum default real de ML)", () => {
  assert.throws(() => createMarginSnapshotWorker({}), /processor/);
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
    console.error(`marginSnapshotWorker: ${falhas} de ${casos.length} cenários falharam`);
    process.exitCode = 1;
  } else {
    console.log(`marginSnapshotWorker: ok (${casos.length} cenários)`);
  }
}

main();
