// server/tests/marginSnapshotTriggers.test.js
// Margin Snapshot — M4: gatilhos automáticos (Central de Vendas, Base) e
// rerun após mudança de Base durante um run. Fake db em memória, sem ML,
// sem Postgres.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const syncRunService = require("../services/centralVendas/centralVendasSyncRunService");
const syncWorker = require("../services/centralVendas/centralVendasSyncWorker");
const publicationService = require("../services/centralVendas/centralVendasPublicationService");
const triggers = require("../services/motorMargem/marginSnapshotTriggers");
const runService = require("../services/motorMargem/marginSnapshotRunService");
const { createMarginSnapshotWorker } = require("../services/motorMargem/marginSnapshotWorker");
const { makeMarginSnapshotFakeDb } = require("./helpers/marginSnapshotFakeDb");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

const ENV_LIGADO = { MARGIN_SNAPSHOT_WORKER_ENABLED: "true" };
const ENV_BASE_LIGADO = { MARGIN_SNAPSHOT_WORKER_ENABLED: "true", MARGIN_SNAPSHOT_BASE_TRIGGER_ENABLED: "true" };
const SILENCIOSO = { log() {}, warn() {}, error() {} };

// ── Fake db mínimo de central_vendas_sync_runs (caminho de sucesso) ──────
function makeSyncDb() {
  const runs = [];
  return {
    runs,
    async query(sql, params = []) {
      if (sql.includes("UPDATE central_vendas_sync_runs") && sql.includes("status = 'running'") && sql.includes("started_at = NOW()")) {
        const row = runs.find((r) => r.id === params[0] && r.status === "queued");
        if (!row) return { rows: [] };
        Object.assign(row, { status: "running", started_at: new Date().toISOString() });
        return { rows: [row] };
      }
      if (sql.includes("UPDATE central_vendas_sync_runs") && sql.includes("status = 'completed'")) {
        const row = runs.find((r) => r.id === params[0] && r.status === "running");
        if (!row) return { rows: [] };
        Object.assign(row, { status: "completed", finished_at: new Date().toISOString(), metadata_json: JSON.parse(params[1]) });
        return { rows: [row] };
      }
      if (sql.includes("UPDATE central_vendas_sync_runs") && sql.includes("completeness_status = $2")) {
        const row = runs.find((r) => r.id === params[0]);
        if (row) row.completeness_status = params[1];
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("SELECT * FROM central_vendas_sync_sources WHERE sync_run_id = $1")) {
        return { rows: [] };
      }
      throw new Error(`fake sync db: SQL nao mapeado -> ${sql.slice(0, 120)}`);
    },
  };
}

function novoSyncRun(db, { clienteContaId = 5 } = {}) {
  const row = {
    id: db.runs.length + 1, status: "queued", cliente_id: 1, cliente_slug: "loja-teste",
    cliente_conta_id: clienteContaId, marketplace: "meli", external_account_id: null, grant_id: null,
    base_id: null, base_resolution_mode: null, date_from: "2026-08-01", date_to: "2026-08-31",
    requested_by: null, created_at: new Date().toISOString(), started_at: null, finished_at: null,
    error_code: null, error_message: null, metadata_json: {}, completeness_status: null,
    updated_at: new Date().toISOString(),
  };
  db.runs.push(row);
  return syncRunService.sanitizeRun(row);
}

async function rodarSync({ db, run, marginSnapshotEnqueue }) {
  return syncWorker.executarSyncRun({
    run,
    context: { conta: { id: run.clienteContaId }, mlUserId: "9", grant: null, base: null },
    params: { clienteSlug: "loja-teste", dateFrom: "2026-08-01", dateTo: "2026-08-31", marketplace: "meli" },
    db,
    sincronizarVendasMeli: async () => ({ ordersEncontrados: 0, pedidosPersistidos: 0, itensPersistidos: 0 }),
    marginSnapshotEnqueue,
  });
}

// Silencia os console.log/error do worker da Central durante o cenário.
async function semLogs(fn) {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// A. Central de Vendas → enqueue (nunca calcula)
// ═══════════════════════════════════════════════════════════════════════════

cenario("sync concluído → enqueue de margem chamado DEPOIS do run completed e da publicação", async () => {
  const db = makeSyncDb();
  const run = novoSyncRun(db);
  const ordem = [];
  const publicarOriginal = publicationService.publicarRun;
  publicationService.publicarRun = async () => { ordem.push("publicar"); return { published: true, importIds: [] }; };
  try {
    await semLogs(() => rodarSync({
      db, run,
      marginSnapshotEnqueue: async ({ run: r }) => {
        ordem.push(`enqueue:status=${db.runs.find((x) => x.id === r.id).status}`);
        return { enfileirado: true, runId: 99, reaproveitado: false };
      },
    }));
  } finally {
    publicationService.publicarRun = publicarOriginal;
  }
  assert.deepStrictEqual(ordem, ["publicar", "enqueue:status=completed"]);
});

cenario("erro ao enfileirar margem NÃO falha o sync já concluído", async () => {
  const db = makeSyncDb();
  const run = novoSyncRun(db);
  const publicarOriginal = publicationService.publicarRun;
  publicationService.publicarRun = async () => ({ published: false, reason: "teste" });
  let resultado;
  try {
    resultado = await semLogs(() => rodarSync({
      db, run,
      marginSnapshotEnqueue: async () => { throw new Error("banco de margem indisponível"); },
    }));
  } finally {
    publicationService.publicarRun = publicarOriginal;
  }
  assert.ok(resultado, "executarSyncRun devolve o resultado normalmente");
  assert.strictEqual(db.runs[0].status, "completed", "run de vendas continua completed");
});

cenario("gatilho real: com worker desligado (default) não enfileira nada", async () => {
  const marginDb = makeMarginSnapshotFakeDb();
  const r = await triggers.enfileirarAposSyncCentralVendas(
    { run: { id: 1, clienteId: 1, clienteSlug: "loja", clienteContaId: 5, marketplace: "meli" } },
    { db: marginDb, env: {}, kick: () => {} }
  );
  assert.deepStrictEqual(r, { enfileirado: false, motivo: "WORKER_DESABILITADO" });
  assert.strictEqual(marginDb.runs.length, 0);
});

cenario("gatilho real: worker ligado → run 'central_vendas_sync_completed' da MESMA conta; 2º sync reaproveita", async () => {
  const marginDb = makeMarginSnapshotFakeDb();
  let kicks = 0;
  const syncRun = { id: 7, clienteId: 1, clienteSlug: "loja", clienteContaId: 5, marketplace: "meli" };
  const a = await triggers.enfileirarAposSyncCentralVendas({ run: syncRun }, { db: marginDb, env: ENV_LIGADO, kick: () => { kicks += 1; } });
  const b = await triggers.enfileirarAposSyncCentralVendas({ run: syncRun }, { db: marginDb, env: ENV_LIGADO, kick: () => { kicks += 1; } });
  assert.strictEqual(a.enfileirado, true);
  assert.strictEqual(a.reaproveitado, false);
  assert.strictEqual(b.reaproveitado, true, "dedupe reaproveita o run ativo");
  assert.strictEqual(a.runId, b.runId);
  assert.strictEqual(marginDb.runs.length, 1);
  assert.strictEqual(marginDb.runs[0].reason, "central_vendas_sync_completed");
  assert.strictEqual(marginDb.runs[0].cliente_conta_id, 5);
  assert.strictEqual(kicks, 2);
});

cenario("gatilho real: sync legado sem conta ou de outro marketplace não enfileira", async () => {
  const marginDb = makeMarginSnapshotFakeDb();
  const semConta = await triggers.enfileirarAposSyncCentralVendas(
    { run: { id: 1, clienteId: 1, clienteSlug: "loja", clienteContaId: null, marketplace: "meli" } },
    { db: marginDb, env: ENV_LIGADO, kick: () => {} }
  );
  const shopee = await triggers.enfileirarAposSyncCentralVendas(
    { run: { id: 2, clienteId: 1, clienteSlug: "loja", clienteContaId: 5, marketplace: "shopee" } },
    { db: marginDb, env: ENV_LIGADO, kick: () => {} }
  );
  assert.strictEqual(semConta.motivo, "SEM_CONTA");
  assert.strictEqual(shopee.motivo, "MARKETPLACE_NAO_SUPORTADO");
  assert.strictEqual(marginDb.runs.length, 0);
});

cenario("a Central de Vendas não importa nenhum módulo de cálculo de margem", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "../services/centralVendas/centralVendasSyncWorker.js"), "utf8");
  const requires = src.match(/require\(["'][^"']+["']\)/g) || [];
  const margem = requires.filter((r) => r.includes("motorMargem"));
  assert.deepStrictEqual(margem, ['require("../motorMargem/marginSnapshotTriggers")'], "só o módulo de gatilho (enqueue) é importado");
  assert.ok(!/prepareWorkspaceContext|enrichBatch|computeMargin|buildMarginItem/.test(src));
});

// ═══════════════════════════════════════════════════════════════════════════
// D. Mudança de Base → contas afetadas
// ═══════════════════════════════════════════════════════════════════════════

function dbContasAfetadas(linhas, chamadas = []) {
  const inner = makeMarginSnapshotFakeDb();
  return {
    ...inner,
    runs: inner.runs,
    async query(sql, params) {
      if (sql.includes("FROM base_cliente_vinculos v")) {
        chamadas.push({ sql, params });
        return { rows: linhas };
      }
      return inner.query(sql, params);
    },
  };
}

cenario("resolverContasAfetadasPorBase: mesma regra do Motor (vínculo da conta OU legado client-level), só MELI ativa", async () => {
  const chamadas = [];
  const db = dbContasAfetadas([{ cliente_conta_id: "5", cliente_id: "1", cliente_slug: "loja" }], chamadas);
  const contas = await triggers.resolverContasAfetadasPorBase({ baseId: 42 }, db);
  assert.deepStrictEqual(contas, [{ clienteContaId: 5, clienteId: 1, clienteSlug: "loja" }]);
  const { sql, params } = chamadas[0];
  assert.deepStrictEqual(params, [42, "42"]);
  assert.ok(/v\.cliente_conta_id IS NULL OR v\.cliente_conta_id = c\.id/.test(sql), "vínculo legado vale para as contas do cliente; explícito só para a conta dele");
  assert.ok(/c\.ativo = true/.test(sql) && /c\.marketplace = 'meli'/.test(sql) && /v\.ativo = true/.test(sql));
  assert.ok(/c\.cliente_id = v\.cliente_id/.test(sql), "nunca conta de outro cliente");
});

cenario("mudança de Base enfileira APENAS as contas afetadas (e nada com o gatilho desligado)", async () => {
  const db = dbContasAfetadas([
    { cliente_conta_id: 5, cliente_id: 1, cliente_slug: "loja" },
    { cliente_conta_id: 8, cliente_id: 1, cliente_slug: "loja" },
  ]);
  const desligado = await triggers.enfileirarPorMudancaDeBase({ baseId: 42 }, { db, env: ENV_LIGADO, kick: () => {} });
  assert.strictEqual(desligado.motivo, "TRIGGER_BASE_DESABILITADO", "precisa das DUAS flags");
  assert.strictEqual(db.runs.length, 0);

  const r = await triggers.enfileirarPorMudancaDeBase({ baseId: 42 }, { db, env: ENV_BASE_LIGADO, kick: () => {} });
  assert.deepStrictEqual(r.enfileirados.map((e) => e.clienteContaId), [5, 8]);
  assert.deepStrictEqual(db.runs.map((x) => [x.cliente_conta_id, x.reason]), [[5, "base_changed"], [8, "base_changed"]]);
});

cenario("tempestade de mudanças de Base: N eventos → 1 run ativo por conta", async () => {
  const db = dbContasAfetadas([{ cliente_conta_id: 5, cliente_id: 1, cliente_slug: "loja" }]);
  for (let i = 0; i < 25; i += 1) {
    await triggers.enfileirarPorMudancaDeBase({ baseId: 42 }, { db, env: ENV_BASE_LIGADO, kick: () => {} });
  }
  assert.strictEqual(db.runs.length, 1);
});

cenario("falha ao enfileirar uma conta não impede as outras", async () => {
  const db = dbContasAfetadas([
    { cliente_conta_id: 5, cliente_id: 1, cliente_slug: "loja" },
    { cliente_conta_id: 8, cliente_id: 1, cliente_slug: "loja" },
  ]);
  const r = await triggers.enfileirarPorMudancaDeBase({ baseId: 42 }, {
    db, env: ENV_BASE_LIGADO, kick: () => {}, logger: SILENCIOSO,
    enqueue: async (args) => {
      if (args.clienteContaId === 5) throw new Error("falha simulada");
      return runService.enqueueMarginSnapshotRun(args);
    },
  });
  assert.deepStrictEqual(r.enfileirados.map((e) => e.clienteContaId), [8]);
});

cenario("mudança de Base durante run EM EXECUÇÃO: marca rerun; ao concluir, o worker enfileira 1 run novo", async () => {
  const db = makeMarginSnapshotFakeDb();
  const { run } = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "loja", clienteContaId: 5, reason: "manual_refresh", db });

  let durante = null;
  const worker = createMarginSnapshotWorker({
    db,
    logger: SILENCIOSO,
    processor: async () => {
      // Base muda 3x enquanto o run está running.
      for (let i = 0; i < 3; i += 1) {
        durante = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "loja", clienteContaId: 5, reason: "base_changed", db });
      }
      // Clique manual durante o run NÃO pede rerun.
      await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "loja", clienteContaId: 5, reason: "manual_refresh", db });
    },
  });
  await worker.runOnce();

  assert.strictEqual(durante.reaproveitado, true);
  assert.strictEqual(durante.run.id, run.id);
  const runs = db.runs.slice().sort((a, b) => a.id - b.id);
  assert.strictEqual(runs.length, 2, "exatamente 1 rerun, não 3");
  assert.strictEqual(runs[0].status, "completed");
  assert.strictEqual(runs[1].status, "queued");
  assert.strictEqual(runs[1].reason, "base_changed");
  assert.strictEqual(runs[1].cliente_conta_id, 5);
});

cenario("run QUEUED + mudança de Base: só reaproveita (o run ainda vai ler a Base nova), sem rerun", async () => {
  const db = makeMarginSnapshotFakeDb();
  await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "loja", clienteContaId: 5, reason: "manual_refresh", db });
  const r = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "loja", clienteContaId: 5, reason: "base_changed", db });
  assert.strictEqual(r.reaproveitado, true);
  assert.ok(!r.run.metadata.rerunSolicitado);
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
    console.error(`marginSnapshotTriggers: ${falhas} de ${casos.length} cenários falharam`);
    process.exitCode = 1;
  } else {
    console.log(`marginSnapshotTriggers: ok (${casos.length} cenários)`);
  }
}

main();
