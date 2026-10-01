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
const { paginaReferencia } = require("../tests/helpers/oportunidadesReferencia");

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
  const gravadas = await pg.query(`SELECT COUNT(*)::int n FROM promo_snapshot_itens WHERE run_id = $1`, [run.id]);
  assert.strictEqual(gravadas.rows[0].n, 2, "ON CONFLICT deduplica a mesma promoção do item");
  assert.strictEqual(ok.promocoesEncontradas, 2, "contador = linhas efetivamente gravadas");
  assert.strictEqual(ok.retries, 2);
  assert.strictEqual(ok.rateLimits, 1);
  await pg.query(`UPDATE promo_snapshot_runs SET heartbeat_at = NOW() - INTERVAL '30 minutes' WHERE id = $1`, [run.id]);
  const mortos = await repo.reconcileStaleRunningRuns({ staleMinutes: 10 }, db);
  assert.deepStrictEqual(mortos.map((m) => m.id), [run.id]);
  assert.strictEqual(mortos[0].errorCode, "PROMO_SNAPSHOT_RUN_STALE");
  const conta = await repo.obterConta({ clienteContaId: 7, sellerId: "555" }, db);
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
  let c = await repo.obterConta({ clienteContaId: 7, sellerId: "555" }, db);
  assert.strictEqual(c.currentRunId, r1.id);
  assert.ok(c.freshUntil && c.snapshotAt);
  await pg.query(`UPDATE promo_snapshot_contas SET snapshot_at = snapshot_at - INTERVAL '2 hours'`);
  const r2 = await rodarRunManual(db, ID7, [["MLB1"]]);
  await pg.query(`UPDATE promo_snapshot_contas SET snapshot_at = snapshot_at - INTERVAL '2 hours'`);
  const r3 = await rodarRunManual(db, ID7, [["MLB9"]]);
  c = await repo.obterConta({ clienteContaId: 7, sellerId: "555" }, db);
  assert.strictEqual(c.currentRunId, r3.id);
  assert.strictEqual(c.previousRunId, r2.id);
  const porRun = await pg.query(`SELECT run_id, COUNT(*)::int n FROM promo_snapshot_itens WHERE cliente_conta_id = 7 GROUP BY run_id ORDER BY run_id`);
  assert.deepStrictEqual(porRun.rows.map((r) => Number(r.run_id)), [r2.id, r3.id], "run 1 podado");
  // partial acima do limite: não promovido.
  const r4 = await rodarRunManual(db, ID7, [["MLB1", "MLB2"]], { status: "partial", promover: false, falhas: 1 });
  assert.strictEqual(r4.promovido, false);
  c = await repo.obterConta({ clienteContaId: 7, sellerId: "555" }, db);
  assert.strictEqual(c.currentRunId, r3.id);
  assert.strictEqual(c.lastAttemptStatus, "partial");
  assert.strictEqual(c.lastErrorCode, "PROMO_SNAPSHOT_PARCIAL_NAO_PROMOVIDO");
  // partial dentro do limite: promovido e marcado parcial.
  const r5 = await rodarRunManual(db, ID7, [["MLB1", "MLB2", "MLB3"]], { status: "partial", promover: true, falhas: 1 });
  c = await repo.obterConta({ clienteContaId: 7, sellerId: "555" }, db);
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
  const a = await repo.obterConta({ clienteContaId: 7, sellerId: "555" }, db);
  const b = await repo.obterConta({ clienteContaId: 8, sellerId: "666" }, db);
  assert.strictEqual(a.currentRunId, bom.id);
  assert.strictEqual(a.lastAttemptStatus, "failed");
  assert.strictEqual(b.lastAttemptStatus, "completed");
  const la = await repo.listarLinhasSnapshot({ clienteContaId: 7, sellerId: "555", runId: a.currentRunId, page: 1, limit: 50 }, db);
  assert.ok(la.linhas.every((l) => l.itemId === "MLB1"));
  const cruzado = await repo.listarLinhasSnapshot({ clienteContaId: 7, sellerId: "555", runId: b.currentRunId, page: 1, limit: 50 }, db);
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
  const p2 = await repo.listarLinhasSnapshot({ clienteContaId: 7, sellerId: "555", runId: r.id, page: 2, limit: 25 }, db);
  assert.strictEqual(p2.total, 30);
  assert.deepStrictEqual(p2.linhas.map((l) => l.itemId), itens.slice(25));
  const f = await repo.listarLinhasSnapshot({ clienteContaId: 7, sellerId: "555", runId: r.id, page: 1, limit: 25, itemId: "MLB007" }, db);
  assert.strictEqual(f.total, 1);
  const t = await repo.listarLinhasSnapshot({ clienteContaId: 7, sellerId: "555", runId: r.id, page: 1, limit: 25, tipo: "SMART" }, db);
  assert.strictEqual(t.total, 0);
});

// Linhas variadas: preços, retorno ML, 2 promoções no mesmo item, sem preço,
// margem negativa, status indisponível, snapshot sem taxa — para a régua do
// SQL ser comparada com a referência JS em todos os ramos.
function linhaVariada(i) {
  const itemId = `MLB${i}`;
  const base = linha(itemId, { id: `P-${i}`, preco: 60 + (i * 7) % 45, status: i % 17 === 0 ? "finished" : "candidate" });
  base.subsidioMl = i % 5 === 0 ? (i % 3) + 1.5 : null;
  if (i % 23 === 0) base.precoFinal = null;
  const extra = i % 4 === 0 ? [{ ...linha(itemId, { id: `Q-${i}`, tipo: "SMART", preco: 70 + (i % 30) }), subsidioMl: i % 8 === 0 ? 2 : null }] : [];
  return [base, ...extra];
}

async function montarCatalogoOportunidades(db, pg, n) {
  const { run } = await service.enqueuePromoSnapshotRun(ID7, { reason: "manual_sync" }, { db, repo, logger: silencioso });
  const claimed = await repo.claimNextQueuedRun({}, db);
  await repo.registrarTotal({ runId: run.id, itensTotal: n }, db);
  let seq = 0;
  for (let i = 1; i <= n; i += 500) {
    seq += 1;
    const ids = [];
    const linhas = [];
    for (let k = i; k < i + 500 && k <= n; k += 1) { ids.push(`MLB${k}`); linhas.push(...linhaVariada(k)); }
    await repo.registrarLote({ run: claimed, seq, itemIds: ids, linhas }, db);
  }
  await repo.finalizarRun({ runId: run.id, status: "completed", promover: true, freshMinutes: 360 }, db);
  await pg.query(`INSERT INTO margin_projection_snapshots (cliente_conta_id, marketplace, item_id, titulo, price, cost, tax_rate, fixed_fee, commission_rate, freight, margin)
                  SELECT 7, 'meli', 'MLB' || g, 'T' || g, 100, 30 + (g % 40), CASE WHEN g % 29 = 0 THEN NULL ELSE 0.08 + (g % 5) / 100.0 END,
                         g % 3, 0.12 + (g % 4) / 100.0, CASE WHEN g % 11 = 0 THEN NULL ELSE 8 + g % 9 END, 0.2
                    FROM generate_series(1, $1::int) g`, [n]);
  await pg.query(`INSERT INTO margin_projection_snapshots (cliente_conta_id, marketplace, item_id, titulo, price, cost, tax_rate, fixed_fee, commission_rate, freight, margin)
                  VALUES (8, 'meli', 'MLB1', 'outra conta', 1, 1, 0, 0, 0, 0, 0)`);
  await pg.query("ANALYZE");
  return run.id;
}

check("Oportunidades paginadas NO BANCO: 5.000 anúncios → a consulta devolve só `limit` linhas; ordem/filtro/total idênticos à régua JS em todas as páginas", async ({ db, pg }) => {
  const n = 5000;
  const runId = await montarCatalogoOportunidades(db, pg, n);
  const vendas = new Map();
  for (let i = 1; i <= n; i += 13) vendas.set(`MLB${i}`, { unidades: (i % 7) + 1 });

  // Referência JS: todas as promoções disponíveis + snapshots, régua de montarCandidata.
  const todas = await pg.query(
    `SELECT p.item_id, p.promocao_chave AS chave, p.preco_final AS preco_promo, p.subsidio_ml AS retorno, p.herdado AS promo_herdado
       FROM promo_snapshot_itens p
      WHERE p.run_id = $1 AND p.preco_final > 0 AND p.status IN ('candidate','started','active','pending')`, [runId]);
  const snaps = await pg.query(`SELECT * FROM margin_projection_snapshots WHERE cliente_conta_id = 7`);
  const snapPorItem = new Map(snaps.rows.map((s) => [s.item_id, s]));
  const limit = 50;
  const ref1 = paginaReferencia({ promos: todas.rows, snapPorItem, vendasPorMlb: vendas, page: 1, limit });
  const totalRef = Number(ref1.rows[0].total_oportunidades);
  assert.ok(totalRef > 2000 && totalRef < n, `total de referência plausível (${totalRef})`);

  const paginas = Math.ceil(totalRef / limit);
  const vistos = new Set();
  for (let page = 1; page <= paginas + 1; page += 1) {
    const sqlPg = await repo.listarOportunidadesPaginadas({ clienteContaId: 7, sellerId: "555", runId, vendasPorMlb: vendas, page, limit }, db);
    const ref = paginaReferencia({ promos: todas.rows, snapPorItem, vendasPorMlb: vendas, page, limit });
    assert.strictEqual(sqlPg.total, totalRef, `total na página ${page}`);
    assert.ok(sqlPg.rows.length <= limit, "nunca mais que `limit` linhas saem do banco");
    const esperado = ref.rows.filter((r) => r.item_id).map((r) => `${r.item_id}|${r.chave}|${Number(r.margem_depois)}`);
    const obtido = sqlPg.rows.map((r) => `${r.item_id}|${r.chave}|${Number(r.margem_depois)}`);
    assert.deepStrictEqual(obtido, esperado, `página ${page} idêntica à régua JS`);
    for (const r of sqlPg.rows) { assert.ok(!vistos.has(r.item_id), "1 linha por anúncio em todo o conjunto"); vistos.add(r.item_id); }
  }
  assert.strictEqual(vistos.size, totalRef);

  // Plano: LIMIT aplicado na consulta; nada de outra conta.
  const { sqlOportunidadesPaginadas } = require("../services/motorMargem/precificacao/precificacaoOportunidadesSql");
  const pg3 = await repo.listarOportunidadesPaginadas({ clienteContaId: 7, sellerId: "555", runId, vendasPorMlb: vendas, page: 3, limit: 20 }, db);
  assert.strictEqual(pg3.rows.length, 20);
  assert.ok(pg3.rows.every((r) => r.snap_titulo !== "outra conta"));
  const q = sqlOportunidadesPaginadas({
    fonteSql: `SELECT p.item_id, p.promocao_chave AS chave, p.preco_final AS preco_promo, p.subsidio_ml AS retorno FROM promo_snapshot_itens p
                WHERE p.run_id = $1 AND p.cliente_conta_id = $2 AND p.seller_id = $3 AND p.preco_final > 0 AND p.status IN ('candidate','started','active','pending')`,
    paramsFonte: [runId, 7, "555"], clienteContaId: 7, vendasPorMlb: vendas, page: 3, limit: 20,
  });
  const plano = (await pg.query(`EXPLAIN ${q.sql}`, q.params)).rows.map((x) => x["QUERY PLAN"]).join("\n");
  assert.ok(/Limit/.test(plano), plano);
  assert.ok(/idx_promo_snapshot_itens_oportunidades|uq_promo_snapshot_itens_run_item_promo|Index|Bitmap/.test(plano), plano);
});

// ─── Auditoria: achados 1, 2 e 6 contra Postgres real ───────────────────────

check("seller reconectado (SQL real): ponteiro por conta+seller; run do seller anterior encerrado; run zumbi não promove; 1º snapshot do novo seller apaga o anterior", async ({ db, pg }) => {
  const bom = await rodarRunManual(db, ID7, [["MLB1", "MLB2"]]);
  assert.strictEqual((await repo.obterConta({ clienteContaId: 7, sellerId: "555" }, db)).currentRunId, bom.id);
  await pg.query(`UPDATE promo_snapshot_contas SET snapshot_at = snapshot_at - INTERVAL '8 hours', fresh_until = NOW() - INTERVAL '1 hour'`);
  // Run do 555 na fila e outro "zumbi" já em execução seriam do seller antigo.
  const { run: velho } = await service.enqueuePromoSnapshotRun(ID7, { reason: "x" }, { db, repo, logger: silencioso });
  await pg.query(`UPDATE cliente_contas SET external_account_id = '999' WHERE id = 7`);
  await pg.query(`INSERT INTO ml_tokens (cliente_id, ml_user_id, access_token, refresh_token, token_status) VALUES (3, '999', 'a', 'r', 'valid')`);
  const ID7N = { ...ID7, sellerId: "999" };
  assert.strictEqual(await repo.obterConta({ clienteContaId: 7, sellerId: "999" }, db), null, "leitura do 999 não acha o ponteiro do 555");
  const e = await service.estadoSincronizacao({ clienteContaId: 7, sellerId: "999" }, { db, repo, env: {} });
  assert.deepStrictEqual([e.state, e.hasSnapshot, e.activeRun], ["never_synced", false, null]);
  const elegiveis = await repo.listarContasElegiveis({ limit: 10, failedRetryMinutes: 30 }, db);
  assert.ok(elegiveis.some((x) => x.clienteContaId === 7 && x.sellerId === "999"), "conta elegível pelo seller atual");
  const { run: novo, reaproveitado } = await service.enqueuePromoSnapshotRun(ID7N, { reason: "y" }, { db, repo, logger: silencioso });
  assert.strictEqual(reaproveitado, false, "run do 555 nunca é reaproveitado para o 999");
  const v = await pg.query(`SELECT status, error_code FROM promo_snapshot_runs WHERE id = $1`, [velho.id]);
  assert.deepStrictEqual([v.rows[0].status, v.rows[0].error_code], ["failed", "PROMO_SNAPSHOT_SELLER_SUBSTITUIDO"]);
  assert.strictEqual(novo.sellerId, "999");
  // Um run do seller antigo que chegue ao fim (zumbi) é barrado na conclusão.
  await pg.query(`UPDATE promo_snapshot_runs SET status = 'failed' WHERE id = $1`, [novo.id]);
  const zumbi = await repo.createRun({ ...ID7, reason: "zumbi" }, db);
  await repo.claimNextQueuedRun({}, db);
  await repo.registrarLote({ run: { ...zumbi, status: "running" }, seq: 1, itemIds: ["MLB1"], linhas: [linha("MLB1")] }, db);
  const fimZumbi = await repo.finalizarRun({ runId: zumbi.id, status: "completed", promover: true, freshMinutes: 360 }, db);
  assert.deepStrictEqual([fimZumbi.status, fimZumbi.errorCode, fimZumbi.promovido], ["failed", "PROMO_SNAPSHOT_SELLER_DIVERGENTE", false]);
  assert.strictEqual((await repo.obterConta({ clienteContaId: 7, sellerId: "555" }, db)).currentRunId, bom.id, "ponteiro do 555 não mudou");
  // Primeiro snapshot do 999.
  const r999 = await rodarRunManual(db, ID7N, [["MLB9"]]);
  const c999 = await repo.obterConta({ clienteContaId: 7, sellerId: "999" }, db);
  assert.strictEqual(c999.currentRunId, r999.id);
  assert.strictEqual(await repo.obterConta({ clienteContaId: 7, sellerId: "555" }, db), null, "ponteiro do seller anterior apagado");
  const sobra = await pg.query(`SELECT COUNT(*)::int n FROM promo_snapshot_itens WHERE cliente_conta_id = 7 AND seller_id = '555'`);
  assert.strictEqual(sobra.rows[0].n, 0, "linhas do seller anterior apagadas");
  const l = await repo.listarLinhasSnapshot({ clienteContaId: 7, sellerId: "999", runId: bom.id, page: 1, limit: 50 }, db);
  assert.strictEqual(l.total, 0, "run antigo nunca é lido com o seller novo");
});

check("parcial promovido (SQL real): item que falhou herda a última leitura boa (herdado, observed_at e origem originais); os outros são novos", async ({ db, pg }) => {
  const itens = Array.from({ length: 40 }, (_, i) => `MLB${i + 1}`);
  const r1 = await rodarRunManual(db, ID7, [itens]);
  await pg.query(`UPDATE promo_snapshot_itens SET observed_at = NOW() - INTERVAL '2 hours' WHERE run_id = $1`, [r1.id]);
  await pg.query(`UPDATE promo_snapshot_contas SET snapshot_at = snapshot_at - INTERVAL '8 hours'`);
  // Run 2: MLB7 falha (39 lidos). Linhas novas com observed_at de agora.
  const { run } = await service.enqueuePromoSnapshotRun(ID7, { reason: "p" }, { db, repo, logger: silencioso });
  const c = await repo.claimNextQueuedRun({}, db);
  const lidas = itens.filter((x) => x !== "MLB7").map((x) => ({ ...linha(x), observedAt: new Date().toISOString() }));
  await repo.registrarLote({ run: c, seq: 1, itemIds: itens, itensFalhos: ["MLB7"], linhas: lidas }, db);
  const fim = await repo.finalizarRun({ runId: run.id, status: "partial", promover: true, freshMinutes: 360, inheritMaxMinutes: 4320 }, db);
  assert.deepStrictEqual([fim.itensHerdados, fim.promocoesHerdadas], [1, 1]);
  const conta = await repo.obterConta({ clienteContaId: 7, sellerId: "555" }, db);
  assert.deepStrictEqual([conta.currentRunId, conta.parcial, conta.itensSemLeitura, conta.itensHerdados, conta.promocoesTotal], [run.id, true, 1, 1, 40]);
  const rows = await pg.query(`SELECT item_id, herdado, origem_run_id, observed_at < NOW() - INTERVAL '1 hour' AS velha FROM promo_snapshot_itens WHERE run_id = $1 ORDER BY item_id`, [run.id]);
  assert.strictEqual(rows.rows.length, 40, "39 + 1 herdada: nada sumiu");
  const h = rows.rows.find((x) => x.item_id === "MLB7");
  assert.deepStrictEqual([h.herdado, Number(h.origem_run_id), h.velha], [true, r1.id, true]);
  assert.ok(rows.rows.filter((x) => x.item_id !== "MLB7").every((x) => x.herdado === false && !x.velha));
  const pub = await repo.listarLinhasSnapshot({ clienteContaId: 7, sellerId: "555", runId: run.id, page: 1, limit: 5, itemId: "MLB7" }, db);
  assert.strictEqual(pub.linhas[0].herdada, true);
  // Leitura boa velha demais: não herda.
  await pg.query(`UPDATE promo_snapshot_itens SET observed_at = NOW() - INTERVAL '10 days' WHERE run_id = $1`, [run.id]);
  await pg.query(`UPDATE promo_snapshot_contas SET snapshot_at = snapshot_at - INTERVAL '8 hours'`);
  const { run: r3 } = await service.enqueuePromoSnapshotRun(ID7, { reason: "p3" }, { db, repo, logger: silencioso });
  const c3 = await repo.claimNextQueuedRun({}, db);
  await repo.registrarLote({ run: c3, seq: 1, itemIds: itens, itensFalhos: ["MLB8"], linhas: itens.filter((x) => x !== "MLB8").map((x) => linha(x)) }, db);
  const fim3 = await repo.finalizarRun({ runId: r3.id, status: "partial", promover: true, freshMinutes: 360, inheritMaxMinutes: 4320 }, db);
  assert.strictEqual(fim3.itensHerdados, 0);
});

check("lote idempotente (SQL real): replay do mesmo (run, seq) não muda contador nem linha; seq com outros itens é recusado; retomada idempotente", async ({ db, pg }) => {
  const run = await repo.createRun({ ...ID7, reason: "a" }, db);
  const c = await repo.claimNextQueuedRun({}, db);
  const args = { run: c, seq: 1, itemIds: ["MLB1", "MLB2", "MLB3"], itensFalhos: ["MLB3"], linhas: [linha("MLB1"), linha("MLB2")], contadores: { retries: 2, rateLimits: 1 } };
  const r1 = await repo.registrarLote(args, db);
  const campos = (x) => [x.itensProcessados, x.itensComPromocao, x.promocoesEncontradas, x.erros, x.retries, x.rateLimits];
  assert.deepStrictEqual(campos(r1), [3, 2, 2, 1, 2, 1]);
  const r2 = await repo.registrarLote(args, db);
  assert.deepStrictEqual(campos(r2), campos(r1), "replay idêntico");
  const r3 = await repo.registrarLote({ ...args, itemIds: ["MLB3", "MLB1", "MLB2"], itensFalhos: [], linhas: [linha("MLB3")], contadores: { retries: 9, rateLimits: 9 } }, db);
  assert.deepStrictEqual(campos(r3), campos(r1), "replay com contadores diferentes também não soma");
  await assert.rejects(() => repo.registrarLote({ ...args, itemIds: ["MLB9"] }, db), (e) => e.code === "PROMO_SNAPSHOT_LOTE_CONFLITANTE");
  const n = await pg.query(`SELECT COUNT(*)::int n FROM promo_snapshot_itens WHERE run_id = $1`, [run.id]);
  assert.strictEqual(n.rows[0].n, 2);
  const lotes = await pg.query(`SELECT COUNT(*)::int n FROM promo_snapshot_run_lotes WHERE run_id = $1`, [run.id]);
  assert.strictEqual(lotes.rows[0].n, 1);
  // Retomada (lote 0) repetida também não soma.
  await pg.query(`UPDATE promo_snapshot_runs SET heartbeat_at = NOW() - INTERVAL '30 minutes' WHERE id = $1`, [run.id]);
  await repo.reconcileStaleRunningRuns({ staleMinutes: 10 }, db);
  const { run: novo } = await service.enqueuePromoSnapshotRun(ID7, { reason: "b" }, { db, repo, logger: silencioso, env: { PROMO_SNAPSHOT_RESUME_MAX_MINUTES: "60" } });
  const cn = await repo.claimNextQueuedRun({}, db);
  const k1 = await repo.copiarLotesRetomados({ run: cn, fromRunId: run.id, catalogItemIds: ["MLB1", "MLB2", "MLB3"] }, db);
  const k2 = await repo.copiarLotesRetomados({ run: cn, fromRunId: run.id, catalogItemIds: ["MLB1", "MLB2", "MLB3"] }, db);
  assert.deepStrictEqual(k2.itens.slice().sort(), k1.itens.slice().sort());
  const rn = await pg.query(`SELECT itens_processados, promocoes_encontradas FROM promo_snapshot_runs WHERE id = $1`, [novo.id]);
  assert.deepStrictEqual([rn.rows[0].itens_processados, rn.rows[0].promocoes_encontradas], [2, 2]);
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
  const e7 = await service.estadoSincronizacao({ clienteContaId: 7, sellerId: "555" }, base);
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
