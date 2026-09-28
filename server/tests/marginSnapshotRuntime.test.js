// server/tests/marginSnapshotRuntime.test.js
// Margin Snapshot — M4: runtime do worker no processo (bootstrap opt-in).
// Nada de index.js/app.listen: o runtime é exercitado com fakes.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const runtime = require("../services/motorMargem/marginSnapshotRuntime");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

const SILENCIOSO = { log() {}, warn() {}, error() {} };

function fakeWorker(registro) {
  return () => ({
    start: (ms) => { registro.push(`start:${ms}`); },
    stop: async () => { registro.push("stop"); },
    kick: () => { registro.push("kick"); },
    status: () => ({ running: true }),
  });
}

cenario("sem MARGIN_SNAPSHOT_WORKER_ENABLED=true: nada é criado, nenhuma tabela garantida", async () => {
  const registro = [];
  for (const env of [{}, { MARGIN_SNAPSHOT_WORKER_ENABLED: "false" }, { MARGIN_SNAPSHOT_WORKER_ENABLED: "1" }]) {
    const w = await runtime.iniciarSeHabilitado({
      env, logger: SILENCIOSO,
      ensureTables: async () => registro.push("ensure"),
      createWorker: fakeWorker(registro),
    });
    assert.strictEqual(w, null);
  }
  assert.deepStrictEqual(registro, []);
  runtime.kick(); // sem worker: no-op, não lança
});

cenario("com a flag: garante schema ANTES de iniciar; kick/parar delegam ao worker; parar é idempotente", async () => {
  const registro = [];
  const w = await runtime.iniciarSeHabilitado({
    env: { MARGIN_SNAPSHOT_WORKER_ENABLED: "true", MARGIN_SNAPSHOT_WORKER_POLL_MS: "20000" },
    logger: SILENCIOSO,
    ensureTables: async () => registro.push("ensure"),
    createWorker: fakeWorker(registro),
  });
  assert.ok(w);
  runtime.kick();
  await runtime.parar();
  await runtime.parar();
  assert.deepStrictEqual(registro, ["ensure", "start:20000", "kick", "stop"]);
});

cenario("falha ao garantir o schema: worker não inicia (erro propaga para o .catch do boot)", async () => {
  const registro = [];
  await assert.rejects(() => runtime.iniciarSeHabilitado({
    env: { MARGIN_SNAPSHOT_WORKER_ENABLED: "true" },
    logger: SILENCIOSO,
    ensureTables: async () => { throw new Error("sem permissão de DDL"); },
    createWorker: fakeWorker(registro),
  }), /DDL/);
  assert.deepStrictEqual(registro, []);
  assert.strictEqual(runtime.status().running, false);
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
    console.error(`marginSnapshotRuntime: ${falhas} de ${casos.length} cenários falharam`);
    process.exitCode = 1;
  } else {
    console.log(`marginSnapshotRuntime: ok (${casos.length} cenários)`);
  }
}

main();
