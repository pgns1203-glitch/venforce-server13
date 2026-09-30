#!/usr/bin/env node
// server/scripts/promoSnapshotSqlCheck.js
// Validação do SQL do Promo Snapshot contra um Postgres REAL em memória
// (PGlite). Prova o que o repositório fake da suíte não prova: a migration
// versionada (2x, advisory lock), o índice único PARCIAL de run ativo, o
// claim FOR UPDATE SKIP LOCKED, o fencing (escrita só com o run `running`,
// com a linha travada), a reconciliação em CTE, a promoção do ponteiro na
// mesma transação, a poda, a retomada, a paginação, a consulta das
// Oportunidades (EXPLAIN com índice) e a elegibilidade do orquestrador — e
// roda o pipeline inteiro (worker + processor + repositório real) com um ML
// falso, só GET.
//
// SEGURANÇA: nunca lê DATABASE_URL e nunca abre conexão de rede.
//
// Uso (a partir de server/, sem alterar package.json):
//   npm install --no-save @electric-sql/pglite@0.3
//   node scripts/promoSnapshotSqlCheck.js

process.env.DATABASE_URL = "postgres://127.0.0.1:1/promo-snapshot-sql-check-nunca-conecta";

const assert = require("assert");

let PGlite;
try {
  ({ PGlite } = require("@electric-sql/pglite"));
} catch (_) {
  console.error("Instale antes (sem salvar no package.json): npm install --no-save @electric-sql/pglite@0.3");
  process.exit(2);
}

const repo = require("../services/promoSnapshot/promoSnapshotRepository");
const schemaEnsure = require("../services/schema/schemaEnsure");
const service = require("../services/promoSnapshot/promoSnapshotService");
const runtime = require("../services/promoSnapshot/promoSnapshotRuntime");
const { processPromoSnapshotRun } = require("../services/promoSnapshot/promoSnapshotProcessor");
const { resolvePromoSnapshotConfig } = require("../services/promoSnapshot/promoSnapshotConfig");
const { createRateLimiter } = require("../services/motorMargem/marginSnapshotRateLimiter");
const { listarOportunidades } = require("../services/motorMargem/precificacao/precificacaoOportunidadesService");
const F = require("../tests/helpers/promoSnapshotFakes");

const BASE_DDL = `
  CREATE TABLE clientes (id SERIAL PRIMARY KEY, slug TEXT UNIQUE, nome TEXT, ativo BOOLEAN NOT NULL DEFAULT true);
  CREATE TABLE cliente_contas (
    id SERIAL PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    marketplace TEXT NOT NULL, nome TEXT NOT NULL DEFAULT 'c', ativo BOOLEAN NOT NULL DEFAULT true, external_account_id TEXT);
  CREATE TABLE ml_tokens (
    id SERIAL PRIMARY KEY, cliente_id INTEGER, ml_user_id TEXT NOT NULL UNIQUE, access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL, token_status TEXT);
  CREATE TABLE margin_projection_snapshots (
    id SERIAL PRIMARY KEY, cliente_conta_id INTEGER, marketplace TEXT, item_id TEXT, titulo TEXT, image_url TEXT,
    price NUMERIC, cost NUMERIC, tax_rate NUMERIC, fixed_fee NUMERIC, commission_rate NUMERIC, freight NUMERIC,
    margin NUMERIC, catalog_missing_since TIMESTAMPTZ);
  INSERT INTO clientes (id, slug, nome) VALUES (3, 'loja-a', 'Loja A'), (4, 'loja-b', 'Loja B');
  INSERT INTO cliente_contas (id, cliente_id, marketplace, external_account_id) VALUES (7, 3, 'meli', '555'), (8, 3, 'meli', '666'), (9, 4, 'meli', '777');
  INSERT INTO ml_tokens (cliente_id, ml_user_id, access_token, refresh_token, token_status) VALUES (3, '555', 'a', 'r', 'valid'), (3, '666', 'a', 'r', 'valid'), (4, '777', 'a', 'r', 'revoked');
`;

async function criarDb() {
  const pg = new PGlite();
  const queries = [];
  const db = {
    async query(sql, params = []) {
      queries.push(sql);
      if (!params.length && /;\s*\S/.test(sql)) {
        const r = await pg.exec(sql);
        return { rows: r[r.length - 1]?.rows || [], rowCount: r[r.length - 1]?.affectedRows };
      }
      const r = await pg.query(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows };
    },
  };
  await pg.exec(BASE_DDL);
  await schemaEnsure.ensurePromoSnapshotSchema(db);
  return { pg, db, queries };
}

const ID7 = { clienteId: 3, clienteSlug: "loja-a", clienteContaId: 7, marketplace: "meli", sellerId: "555" };
const ID8 = { clienteId: 3, clienteSlug: "loja-a", clienteContaId: 8, marketplace: "meli", sellerId: "666" };

function linha(itemId, o = {}) {
  return {
    itemId, promocaoChave: `${o.id || "P-1"}::${o.tipo || "DEAL"}`, promotionId: o.id || "P-1", promotionType: o.tipo || "DEAL",
    tipoConhecido: true, nome: "Campanha", status: o.status || "candidate", statusExibicao: "ELEGÍVEL",
    precoOriginal: 100, precoFinal: o.preco === undefined ? 90 : o.preco, precoFinalFonte: "sugerido_ml",
    descontoValor: 10, descontoPercentual: 10, sellerPercentage: 5, meliPercentage: 5, subsidioMl: 5,
    elegivel: true, ativa: false, programada: false, naoAplicada: false, observedAt: "2026-10-01T12:00:00Z",
    dataInicio: "2026-10-01T00:00:00Z", dataFim: null,
  };
}

async function rodarRunManual(db, id, lotes, { promover = true, status = "completed", falhas = 0 } = {}) {
  const { run } = await service.enqueuePromoSnapshotRun(id, { reason: "manual_sync" }, { db, repo, logger: silencioso });
  const claimed = await repo.claimNextQueuedRun({}, db);
  assert.strictEqual(claimed.id, run.id);
  await repo.registrarTotal({ runId: run.id, itensTotal: lotes.flat().length }, db);
  let seq = 0;
  for (const itens of lotes) {
    seq += 1;
    await repo.registrarLote({ run: claimed, seq, itemIds: itens, itensFalhos: seq === 1 && falhas ? itens.slice(0, falhas) : [], linhas: itens.map((i) => linha(i)) }, db);
  }
  return repo.finalizarRun({ runId: run.id, status, promover, freshMinutes: 360 }, db);
}

const silencioso = { log() {}, warn() {}, error() {} };
const checks = [];
function check(nome, fn) { checks.push({ nome, fn }); }

check("migration versionada: aplicada 2x (idempotente) dentro de BEGIN + advisory lock + COMMIT; FKs e índices", async ({ db, queries, pg }) => {
  const ini = queries.length;
  await schemaEnsure.ensurePromoSnapshotSchema({ query: (s, p) => db.query(s, p) }); // "outra instância"
  const seq = queries.slice(ini).map((q) => q.trim().split(/\s+/)[0]);
  assert.strictEqual(seq[0], "BEGIN");
  assert.ok(/^SELECT pg_advisory_xact_lock/.test(queries[ini + 1]));
  assert.strictEqual(seq[seq.length - 1], "COMMIT");
  const fks = await pg.query(`SELECT conname FROM pg_constraint WHERE conname LIKE 'fk_promo_snapshot%' ORDER BY 1`);
  assert.deepStrictEqual(fks.rows.map((r) => r.conname), ["fk_promo_snapshot_contas_cliente", "fk_promo_snapshot_contas_conta", "fk_promo_snapshot_runs_cliente", "fk_promo_snapshot_runs_conta"]);
  const idx = await pg.query(`SELECT indexname FROM pg_indexes WHERE tablename LIKE 'promo_snapshot%'`);
  const nomes = idx.rows.map((r) => r.indexname);
  for (const n of ["uq_promo_snapshot_runs_ativo", "idx_promo_snapshot_runs_fila", "idx_promo_snapshot_runs_heartbeat", "idx_promo_snapshot_runs_seller",
    "idx_promo_snapshot_itens_conta_item", "idx_promo_snapshot_itens_oportunidades", "uq_promo_snapshot_itens_run_item_promo", "idx_promo_snapshot_contas_fresh"]) {
    assert.ok(nomes.includes(n), `índice ${n}`);
  }
});

check("dedupe distribuído: índice único parcial recusa 2º run ativo da MESMA conta (23505); outra conta e depois do término podem", async ({ db }) => {
  await repo.createRun({ ...ID7, reason: "a" }, db);
  await assert.rejects(() => repo.createRun({ ...ID7, reason: "b" }, db), (e) => e.code === "23505");
  await repo.createRun({ ...ID8, reason: "a" }, db);
  // O service transforma a corrida em reaproveitamento.
  const r = await service.enqueuePromoSnapshotRun(ID7, { reason: "c" }, { db, repo, logger: silencioso });
  assert.strictEqual(r.reaproveitado, true);
});

check("claim FOR UPDATE SKIP LOCKED: mais antigo primeiro, respeita exclusão de contas, nunca entrega duas vezes", async ({ db }) => {
  const a = await repo.createRun({ ...ID7, reason: "a" }, db);
  const b = await repo.createRun({ ...ID8, reason: "b" }, db);
  const c1 = await repo.claimNextQueuedRun({ excludeContaIds: [7] }, db);
  assert.strictEqual(c1.id, b.id);
  const c2 = await repo.claimNextQueuedRun({}, db);
  assert.strictEqual(c2.id, a.id);
  assert.strictEqual(c2.status, "running");
  assert.strictEqual(await repo.claimNextQueuedRun({}, db), null);
});

check("fencing: lote só grava com o run running; depois da reconciliação (STALE) nada entra e o ponteiro não muda", async ({ db, pg }) => {
  const run = await repo.createRun({ ...ID7, reason: "a" }, db);
  const claimed = await repo.claimNextQueuedRun({}, db);
  const ok = await repo.registrarLote({ run: claimed, seq: 1, itemIds: ["MLB1", "MLB2"], linhas: [linha("MLB1"), linha("MLB1"), linha("MLB2")], contadores: { retries: 2, rateLimits: 1 } }, db);
  assert.strictEqual(ok.itensProcessados, 2);
  assert.strictEqual(ok.promocoesEncontradas, 3, "contador conta as linhas enviadas");
  const gravadas = await pg.query(`SELECT COUNT(*)::int n FROM promo_snapshot_itens WHERE run_id = $1`, [run.id]);
  assert.strictEqual(gravadas.rows[0].n, 2, "ON CONFLICT deduplica a mesma promoção do item");
  assert.strictEqual(ok.retries, 2);
  assert.strictEqual(ok.rateLimits, 1);
  await pg.query(`UPDATE promo_snapshot_runs SET heartbeat_at = NOW() - INTERVAL '30 minutes' WHERE id = $1`, [run.id]);
  const mortos = await repo.reconcileStaleRunningRuns({ staleMinutes: 10 }, db);
  assert.deepStrictEqual(mortos.map((m) => m.id), [run.id]);
  assert.strictEqual(mortos[0].errorCode, "PROMO_SNAPSHOT_RUN_STALE");
  const conta = await repo.obterConta({ clienteContaId: 7 }, db);
  assert.strictEqual(conta.lastAttemptStatus, "failed");
  assert.strictEqual(conta.currentRunId, null);
  assert.strictEqual(await repo.registrarLote({ run: claimed, seq: 2, itemIds: ["MLB3"], linhas: [linha("MLB3")] }, db), null);
  assert.strictEqual(await repo.finalizarRun({ runId: run.id, status: "completed", promover: true, freshMinutes: 360 }, db), null);
  assert.strictEqual(await repo.touchHeartbeat(run.id, db), null);
  const depois = await pg.query(`SELECT COUNT(*)::int n FROM promo_snapshot_itens WHERE run_id = $1`, [run.id]);
  assert.strictEqual(depois.rows[0].n, 2);
});

check("promoção do ponteiro na mesma transação: atual/anterior, poda do mais velho, partial não promovido preserva o bom", async ({ db, pg }) => {
  const r1 = await rodarRunManual(db, ID7, [["MLB1", "MLB2"]]);
  let c = await repo.obterConta({ clienteContaId: 7 }, db);
  assert.strictEqual(c.currentRunId, r1.id);
  assert.ok(c.freshUntil && c.snapshotAt);
  await pg.query(`UPDATE promo_snapshot_contas SET snapshot_at = snapshot_at - INTERVAL '2 hours'`);
  const r2 = await rodarRunManual(db, ID7, [["MLB1"]]);
  await pg.query(`UPDATE promo_snapshot_contas SET snapshot_at = snapshot_at - INTERVAL '2 hours'`);
  const r3 = await rodarRunManual(db, ID7, [["MLB9"]]);
  c = await repo.obterConta({ clienteContaId: 7 }, db);
  assert.strictEqual(c.currentRunId, r3.id);
  assert.strictEqual(c.previousRunId, r2.id);
  const porRun = await pg.query(`SELECT run_id, COUNT(*)::int n FROM promo_snapshot_itens WHERE cliente_conta_id = 7 GROUP BY run_id ORDER BY run_id`);
  assert.deepStrictEqual(porRun.rows.map((r) => Number(r.run_id)), [r2.id, r3.id], "run 1 podado");
  // partial acima do limite: não promovido.
  const r4 = await rodarRunManual(db, ID7, [["MLB1", "MLB2"]], { status: "partial", promover: false, falhas: 1 });
  assert.strictEqual(r4.promovido, false);
  c = await repo.obterConta({ clienteContaId: 7 }, db);
  assert.strictEqual(c.currentRunId, r3.id);
  assert.strictEqual(c.lastAttemptStatus, "partial");
  assert.strictEqual(c.lastErrorCode, "PROMO_SNAPSHOT_PARCIAL_NAO_PROMOVIDO");
  // partial dentro do limite: promovido e marcado parcial.
  const r5 = await rodarRunManual(db, ID7, [["MLB1", "MLB2", "MLB3"]], { status: "partial", promover: true, falhas: 1 });
  c = await repo.obterConta({ clienteContaId: 7 }, db);
  assert.strictEqual(c.currentRunId, r5.id);
  assert.strictEqual(c.parcial, true);
  assert.strictEqual(c.itensSemLeitura, 1);
});

check("falha não toca o snapshot atual; conta B intocada pela conta A", async ({ db }) => {
  const bom = await rodarRunManual(db, ID7, [["MLB1"]]);
  await rodarRunManual(db, ID8, [["MLB8"]]);
  const { run } = await service.enqueuePromoSnapshotRun(ID7, { reason: "x" }, { db, repo, logger: silencioso });
  await repo.claimNextQueuedRun({ excludeContaIds: [8] }, db);
  await repo.marcarFalhou({ runId: run.id, code: "PROMO_SNAPSHOT_CATALOGO_FALHOU", message: "x" }, db);
  const a = await repo.obterConta({ clienteContaId: 7 }, db);
  const b = await repo.obterConta({ clienteContaId: 8 }, db);
  assert.strictEqual(a.currentRunId, bom.id);
  assert.strictEqual(a.lastAttemptStatus, "failed");
  assert.strictEqual(b.lastAttemptStatus, "completed");
  const la = await repo.listarLinhasSnapshot({ clienteContaId: 7, runId: a.currentRunId, page: 1, limit: 50 }, db);
  assert.ok(la.linhas.every((l) => l.itemId === "MLB1"));
  const cruzado = await repo.listarLinhasSnapshot({ clienteContaId: 7, runId: b.currentRunId, page: 1, limit: 50 }, db);
  assert.strictEqual(cruzado.total, 0, "run de outra conta nunca é lido com a conta A");
});

check("retomada: run STALE com lotes vira fonte do próximo; copia só itens concluídos e ainda no catálogo, com origem_run_id", async ({ db, pg }) => {
  const run = await repo.createRun({ ...ID7, reason: "a" }, db);
  const c = await repo.claimNextQueuedRun({}, db);
  await repo.registrarLote({ run: c, seq: 1, itemIds: ["MLB1", "MLB2", "MLB3"], itensFalhos: ["MLB3"], linhas: [linha("MLB1"), linha("MLB2")] }, db);
  await pg.query(`UPDATE promo_snapshot_runs SET heartbeat_at = NOW() - INTERVAL '30 minutes' WHERE id = $1`, [run.id]);
  await repo.reconcileStaleRunningRuns({ staleMinutes: 10, clienteContaId: 7 }, db);
  const retomavel = await repo.findResumableRun({ clienteContaId: 7, sellerId: "555", resumeMaxMinutes: 60 }, db);
  assert.strictEqual(retomavel.id, run.id);
  assert.strictEqual(await repo.findResumableRun({ clienteContaId: 7, sellerId: "999", resumeMaxMinutes: 60 }, db), null, "outro seller nunca retoma");
  const { run: novo } = await service.enqueuePromoSnapshotRun(ID7, { reason: "b" }, { db, repo, logger: silencioso, env: { PROMO_SNAPSHOT_RESUME_MAX_MINUTES: "60" } });
  assert.strictEqual(novo.resumedFromRunId, run.id);
  const n = await repo.claimNextQueuedRun({}, db);
  const copia = await repo.copiarLotesRetomados({ run: n, fromRunId: run.id, catalogItemIds: ["MLB1", "MLB3", "MLB4"] }, db);
  assert.deepStrictEqual(copia.itens, ["MLB1"], "MLB2 saiu do catálogo; MLB3 tinha falhado");
  assert.strictEqual(copia.promocoes, 1);
  const rows = await pg.query(`SELECT item_id, origem_run_id FROM promo_snapshot_itens WHERE run_id = $1`, [n.id]);
  assert.deepStrictEqual(rows.rows.map((r) => [r.item_id, Number(r.origem_run_id)]), [["MLB1", run.id]]);
});

check("paginação e filtros do snapshot no servidor", async ({ db }) => {
  const itens = Array.from({ length: 30 }, (_, i) => `MLB${String(i + 1).padStart(3, "0")}`);
  const r = await rodarRunManual(db, ID7, [itens.slice(0, 20), itens.slice(20)]);
  const p2 = await repo.listarLinhasSnapshot({ clienteContaId: 7, runId: r.id, page: 2, limit: 25 }, db);
  assert.strictEqual(p2.total, 30);
  assert.deepStrictEqual(p2.linhas.map((l) => l.itemId), itens.slice(25));
  const f = await repo.listarLinhasSnapshot({ clienteContaId: 7, runId: r.id, page: 1, limit: 25, itemId: "MLB007" }, db);
  assert.strictEqual(f.total, 1);
  const t = await repo.listarLinhasSnapshot({ clienteContaId: 7, runId: r.id, page: 1, limit: 25, tipo: "SMART" }, db);
  assert.strictEqual(t.total, 0);
});

check("Oportunidades: UMA consulta casa promoções do run atual com o Margin Snapshot da MESMA conta; EXPLAIN usa índice", async ({ db, pg }) => {
  const itens = Array.from({ length: 3000 }, (_, i) => `MLB${i + 1}`);
  const lotes = [];
  for (let i = 0; i < itens.length; i += 500) lotes.push(itens.slice(i, i + 500));
  const r = await rodarRunManual(db, ID7, lotes);
  await pg.query(`INSERT INTO margin_projection_snapshots (cliente_conta_id, marketplace, item_id, titulo, price, cost, tax_rate, fixed_fee, commission_rate, freight, margin)
                  SELECT 7, 'meli', 'MLB' || g, 'T', 100, 40, 0.1, 0, 0.12, 10, 0.2 FROM generate_series(1, 3000) g`);
  await pg.query(`INSERT INTO margin_projection_snapshots (cliente_conta_id, marketplace, item_id, titulo, price, cost, tax_rate, fixed_fee, commission_rate, freight, margin)
                  VALUES (8, 'meli', 'MLB1', 'outra conta', 1, 1, 0, 0, 0, 0, 0)`);
  await pg.query(`UPDATE promo_snapshot_itens SET preco_final = NULL WHERE run_id = $1 AND item_id = 'MLB2'`, [r.id]);
  await pg.query("ANALYZE");
  const rows = await repo.listarBaseOportunidades({ clienteContaId: 7, runId: r.id }, db);
  assert.strictEqual(rows.length, 2999, "sem preço fica fora");
  assert.ok(rows.every((x) => x.titulo === "T"), "nunca casa com o snapshot de margem de outra conta");
  const plano = await pg.query(`EXPLAIN SELECT p.item_id FROM promo_snapshot_itens p WHERE p.run_id = $1 AND p.cliente_conta_id = 7
                                  AND p.preco_final > 0 AND p.status IN ('candidate','started','active','pending')`, [r.id]);
  const texto = plano.rows.map((x) => x["QUERY PLAN"]).join("\n");
  assert.ok(/Index|Bitmap/.test(texto), texto);
});

check("orquestrador (SQL real): só MELI ativa com grant utilizável, sem run ativo, vencida, fora da espera pós-falha", async ({ db, pg }) => {
  let elegiveis = await repo.listarContasElegiveis({ limit: 10, failedRetryMinutes: 30 }, db);
  assert.deepStrictEqual(elegiveis.map((e) => e.clienteContaId), [7, 8], "conta 9 tem grant revogado");
  await pg.query(`UPDATE cliente_contas SET ativo = false WHERE id = 8`);
  await rodarRunManual(db, ID7, [["MLB1"]]); // agora fresca
  elegiveis = await repo.listarContasElegiveis({ limit: 10, failedRetryMinutes: 30 }, db);
  assert.deepStrictEqual(elegiveis, []);
  await pg.query(`UPDATE promo_snapshot_contas SET fresh_until = NOW() - INTERVAL '1 minute', last_attempt_status = 'failed', last_attempt_at = NOW()`);
  assert.deepStrictEqual(await repo.listarContasElegiveis({ limit: 10, failedRetryMinutes: 30 }, db), [], "espera pós-falha");
  await pg.query(`UPDATE promo_snapshot_contas SET last_attempt_at = NOW() - INTERVAL '31 minutes'`);
  elegiveis = await repo.listarContasElegiveis({ limit: 10, failedRetryMinutes: 30 }, db);
  assert.deepStrictEqual(elegiveis.map((e) => [e.clienteContaId, e.sellerId]), [[7, "555"]]);
  await pg.query(`UPDATE clientes SET ativo = false WHERE id = 3`);
  assert.deepStrictEqual(await repo.listarContasElegiveis({ limit: 10, failedRetryMinutes: 30 }, db), [], "cliente inativo");
});

check("pipeline completo com SQL real: worker + processor + repositório; 2 contas; ML falso só GET; Central lê o snapshot", async ({ db, pg }) => {
  const sellers = {
    555: { itens: { MLBA1: [F.promo({ id: "P-1", status: "candidate", suggested: 90, meli: 5 })], MLBA2: [F.promo({ id: "P-2", status: "started", price: 95 })], MLBA3: [] }, saleInfo: { MLBA2: { promotionId: "P-2", amount: 95 } } },
    666: { itens: { MLBB1: [F.promo({ id: "P-9", type: "SMART", status: "candidate", meli: 10, seller: 0 })] } },
  };
  const ml = F.criarMlFake({ sellers });
  const env = { PROMO_SNAPSHOT_WORKER_ENABLED: "true", PROMO_SNAPSHOT_REQUEST_INTERVAL_MS: "0" };
  const config = resolvePromoSnapshotConfig(env);
  const base = { db, repo, env, logger: silencioso, kick() {} };
  const worker = runtime.criarWorker({
    db, logger: silencioso, config, runService: service.criarRunService(base),
    processor: (run, ctx) => processPromoSnapshotRun(run, {
      ...ctx, db, repo, config, mlFetch: ml.mlFetch, sleep: async () => {}, rateLimiter: createRateLimiter({ minIntervalMs: 0 }),
      validarConta: async () => ({}),
    }),
  });
  await service.ensureFreshPromoSnapshot(ID7, {}, base);
  await service.ensureFreshPromoSnapshot(ID8, {}, base);
  assert.strictEqual((await worker.runOnce()).status, "completed");
  assert.strictEqual((await worker.runOnce()).status, "completed");
  const e7 = await service.estadoSincronizacao({ clienteContaId: 7 }, base);
  assert.strictEqual(e7.state, "fresh");
  const linhas = await pg.query(`SELECT item_id, status, ativa, preco_final_fonte, seller_id FROM promo_snapshot_itens WHERE run_id = $1 ORDER BY item_id`, [e7.snapshotRunId]);
  assert.deepStrictEqual(linhas.rows.map((r) => [r.item_id, r.status, r.ativa, r.preco_final_fonte, r.seller_id]), [
    ["MLBA1", "candidate", false, "sugerido_ml", "555"],
    ["MLBA2", "started", true, "ml", "555"],
  ]);
  assert.strictEqual(ml.escritas().length, 0);
  assert.ok(ml.chamadas.every((c) => c.method === "GET"));
  assert.ok(ml.chamadas.filter((c) => /MLBB/.test(c.path)).every((c) => c.mlUserId === "666"));
  await pg.query(`INSERT INTO margin_projection_snapshots (cliente_conta_id, marketplace, item_id, titulo, price, cost, tax_rate, fixed_fee, commission_rate, freight, margin)
                  VALUES (7, 'meli', 'MLBA1', 'A1', 100, 40, 0.1, 0, 0.12, 10, 0.2)`);
  const op = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7 }, {
    db, repo, env, logger: silencioso, kick() {},
    resolverContaDoCliente: async () => ({ cliente: { id: 3, slug: "loja-a" }, conta: { id: 7, nome: "A" } }),
    obterConta: async () => ({ id: 7, external_account_id: "555" }),
    carregarRealizada: async () => ({ porMlb: new Map(), periodo: null }),
  });
  assert.strictEqual(op.fonte.tipo, "promo_snapshot");
  assert.deepStrictEqual(op.oportunidades.map((o) => [o.itemId, o.precoPromocao, o.retornoMl]), [["MLBA1", 90, 5]]);
});

async function main() {
  let ok = 0;
  for (const c of checks) {
    const ctx = await criarDb();
    try {
      await c.fn(ctx);
      ok += 1;
      console.log(`  ✓ ${c.nome}`);
    } catch (err) {
      console.error(`  ✗ ${c.nome}\n    ${err && err.stack ? err.stack.split("\n").slice(0, 8).join("\n    ") : err}`);
      process.exitCode = 1;
    } finally {
      await ctx.pg.close();
    }
  }
  console.log(process.exitCode ? `promoSnapshotSqlCheck: FALHOU (${ok}/${checks.length})` : `promoSnapshotSqlCheck: ok (${ok} checks)`);
}

main();
