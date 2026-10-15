#!/usr/bin/env node
// server/scripts/marginSnapshotSqlCheck.js
// Validação do SQL do Margin Snapshot contra um Postgres REAL em memória
// (PGlite = Postgres compilado para WASM). Não é teste da suíte (a suíte usa
// fake db); é a checagem de semântica SQL que o fake db não prova sozinho:
// índice único parcial, FOR UPDATE SKIP LOCKED, ON CONFLICT, ANY(text[]),
// ILIKE com escape, array_position, COUNT(*) FILTER, make_interval.
//
// SEGURANÇA: nunca lê DATABASE_URL e nunca abre conexão de rede — o banco é
// criado em memória e descartado no fim. Seguro em qualquer máquina.
//
// Uso (a partir de server/, sem alterar package.json):
//   npm install --no-save @electric-sql/pglite@0.3
//   node scripts/marginSnapshotSqlCheck.js

// Garante que nenhum módulo do projeto consiga usar um banco real: o pool
// padrão (config/database) aponta para um endereço que não existe.
process.env.DATABASE_URL = "postgres://127.0.0.1:1/margin-snapshot-sql-check-nunca-conecta";

const assert = require("assert");

let PGlite;
try {
  ({ PGlite } = require("@electric-sql/pglite"));
} catch (_) {
  console.error("Instale antes (sem salvar no package.json): npm install --no-save @electric-sql/pglite@0.3");
  process.exit(2);
}

const repo = require("../services/motorMargem/marginSnapshotRepository");
const runRepo = require("../services/motorMargem/marginSnapshotRunRepository");
const runService = require("../services/motorMargem/marginSnapshotRunService");
const triggers = require("../services/motorMargem/marginSnapshotTriggers");

async function criarDb() {
  const pg = new PGlite();
  // Tabelas mínimas referenciadas por FK no schema do snapshot.
  await pg.exec(`
    CREATE TABLE clientes (id BIGSERIAL PRIMARY KEY, slug TEXT, nome TEXT);
    CREATE TABLE cliente_contas (id BIGSERIAL PRIMARY KEY, cliente_id BIGINT REFERENCES clientes(id), marketplace TEXT, ativo BOOLEAN DEFAULT true);
    CREATE TABLE bases (id BIGSERIAL PRIMARY KEY, slug TEXT, nome TEXT);
    CREATE TABLE users (id BIGSERIAL PRIMARY KEY, nome TEXT);
    CREATE TABLE base_cliente_vinculos (id BIGSERIAL PRIMARY KEY, base_id BIGINT, cliente_id BIGINT, cliente_conta_id BIGINT, marketplace TEXT, ativo BOOLEAN);
    INSERT INTO clientes (slug, nome) VALUES ('a','A'),('b','B');
    INSERT INTO cliente_contas (cliente_id, marketplace) VALUES (1,'meli'),(1,'meli'),(2,'meli');
    INSERT INTO bases (slug, nome) VALUES ('base-a','Base A'),('base-b','Base B');
    INSERT INTO base_cliente_vinculos (base_id, cliente_id, cliente_conta_id, marketplace, ativo) VALUES (1,1,2,'meli',true),(2,1,NULL,'meli',true);
  `);
  const db = {
    async query(sql, params = []) {
      if (!params.length && /;\s*\S/.test(sql)) {
        const r = await pg.exec(sql);
        return { rows: r[r.length - 1]?.rows || [] };
      }
      const r = await pg.query(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows };
    },
  };
  return { pg, db };
}

const checks = [];
function check(nome, fn) { checks.push({ nome, fn }); }

check("schema idempotente", async ({ db }) => {
  await repo.ensureMarginSnapshotTables(db);
  await repo.ensureMarginSnapshotTables(db);
});

check("dedupe de run ativo + 23505 do índice único parcial + claim + transições estritas", async ({ db }) => {
  const a = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "a", clienteContaId: 1, reason: "manual_refresh", db });
  const b = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "a", clienteContaId: 1, reason: "base_changed", db });
  assert.strictEqual(b.reaproveitado, true);
  assert.strictEqual(a.run.id, b.run.id);
  await assert.rejects(() => runRepo.createRun({ clienteId: 1, clienteSlug: "a", clienteContaId: 1, reason: "manual_refresh", db }), (e) => e.code === "23505");
  assert.strictEqual(await runRepo.claimNextQueuedRun({ db, excludeContaIds: [1] }), null, "exclusão de conta no claim");
  const claimed = await runRepo.claimNextQueuedRun({ db });
  assert.strictEqual(claimed.status, "running");
  assert.strictEqual(await runRepo.claimNextQueuedRun({ db }), null);
  await runRepo.updateRunStatus({ runId: claimed.id, status: "completed", db });
  assert.strictEqual(await runRepo.updateRunStatus({ runId: claimed.id, status: "failed", db }), null);
});

check("upsert idempotente, falha parcial preserva valores, fora do catálogo marca sem apagar", async ({ db }) => {
  const base = { clienteId: 1, clienteContaId: 1, status: "HEALTHY", price: 100, profit: 18, margin: 0.18, marginPercent: 18, quality: { evidencias: {} } };
  await repo.upsertProjectionSnapshot({ ...base, itemId: "MLB1" }, db);
  await repo.upsertProjectionSnapshot({ ...base, itemId: "MLB1", price: 120 }, db);
  await repo.upsertProjectionSnapshot({ ...base, itemId: "MLB2" }, db);
  await repo.markSnapshotsRefreshFailed({ clienteId: 1, clienteContaId: 1, itemIds: ["MLB1"], lastError: "x", db });
  const s1 = await repo.getProjectionSnapshot({ clienteContaId: 1, itemId: "MLB1", db });
  assert.strictEqual(s1.price, 120);
  assert.strictEqual(s1.refreshStatus, "failed");
  await repo.markSnapshotsOutsideCatalog({ clienteId: 1, clienteContaId: 1, catalogItemIds: ["MLB1"], db });
  const s2 = await repo.getProjectionSnapshot({ clienteContaId: 1, itemId: "MLB2", db });
  assert.ok(s2.catalogMissingSince);
  assert.strictEqual(s2.price, 100);
});

check("leitura: filtros ANY, busca literal (ILIKE com escape), whitelist de ordenação, KPIs COUNT FILTER", async ({ db }) => {
  for (let i = 0; i < 30; i += 1) {
    const status = ["HEALTHY", "LOSS", "UNVALIDATED"][i % 3];
    const mp = status === "UNVALIDATED" ? null : i - 10;
    await repo.upsertProjectionSnapshot({
      clienteId: 1, clienteContaId: 2, itemId: `MLB${100 + i}`, sku: `SKU_${i}`, titulo: i === 7 ? "Kit 100% algodão" : `Produto ${i}`,
      status, profit: mp, margin: mp === null ? null : mp / 100, marginPercent: mp, quality: { evidencias: {} },
    }, db);
  }
  const filtro = repo.montarFiltroSnapshots({ clienteId: 1, clienteContaId: 2, status: ["LOSS", "HEALTHY"], busca: "100%" });
  const itens = await repo.queryProjectionSnapshotsPage({ filtro, orderBy: repo.resolverOrdenacao({ ordenacao: "status" }).orderBy, limit: 50, offset: 0, db });
  assert.deepStrictEqual(itens.map((i) => i.itemId), ["MLB107"]);
  const nulos = await repo.queryProjectionSnapshotsPage({
    filtro: repo.montarFiltroSnapshots({ clienteId: 1, clienteContaId: 2 }),
    orderBy: repo.resolverOrdenacao({ ordenacao: "margin_percent", direcao: "DESC" }).orderBy, limit: 50, offset: 0, db,
  });
  const m = nulos.map((i) => i.marginPercent);
  assert.ok(m.slice(m.indexOf(null)).every((x) => x === null), "NULLS LAST");
  const kpis = await repo.summarizeProjectionSnapshots({ filtro: repo.montarFiltroSnapshots({ clienteId: 1, clienteContaId: 2 }), db });
  assert.strictEqual(kpis.total, 30);
  assert.strictEqual(kpis.porStatus.LOSS, 10);
});

check("status EFETIVO (overrides do retorno ML): filtro, contagem, KPIs e ordenação por status em Postgres real", async ({ db }) => {
  const mk = (itemId, status, margem) => ({
    clienteId: 1, clienteContaId: 2, itemId, titulo: itemId, status, profit: margem, margin: margem / 100, marginPercent: margem, quality: { evidencias: {} },
  });
  // Conta 2 já tem 30 itens do check anterior; usa itens novos e filtra por busca para isolar.
  await repo.upsertProjectionSnapshot({ ...mk("EFET1", "LOSS", -5), titulo: "efet-a" }, db);
  await repo.upsertProjectionSnapshot({ ...mk("EFET2", "LOSS", -5), titulo: "efet-b" }, db);
  await repo.upsertProjectionSnapshot({ ...mk("EFET3", "LOSS", -5), titulo: "efet-c" }, db);
  await repo.upsertProjectionSnapshot({ ...mk("EFET4", "HEALTHY", 20), titulo: "efet-d" }, db);
  const overrides = { itemIds: ["EFET1", "EFET2"], statuses: ["LOW_MARGIN", "HEALTHY"] };
  const base = { clienteId: 1, clienteContaId: 2, busca: "efet-" };

  const ids = async (filtro, ordenacao = null) => (await repo.queryProjectionSnapshotsPage({
    filtro, orderBy: repo.resolverOrdenacao({ ordenacao, direcao: "ASC" }).orderBy, limit: 50, offset: 0, db,
  })).map((i) => i.itemId);

  // Sem override: SQL de sempre, persistido.
  const semOv = repo.montarFiltroSnapshots({ ...base, status: ["LOSS"] });
  assert.strictEqual(semOv.statusExpr, "status");
  assert.deepStrictEqual((await ids(semOv)).sort(), ["EFET1", "EFET2", "EFET3"]);

  // Com override: o filtro por status vê o EFETIVO.
  assert.deepStrictEqual((await ids(repo.montarFiltroSnapshots({ ...base, status: ["LOSS"], statusOverrides: overrides }))).sort(), ["EFET3"]);
  assert.deepStrictEqual((await ids(repo.montarFiltroSnapshots({ ...base, status: ["LOW_MARGIN"], statusOverrides: overrides }))).sort(), ["EFET1"], "persistido LOSS, efetivo LOW_MARGIN");
  assert.deepStrictEqual((await ids(repo.montarFiltroSnapshots({ ...base, status: ["HEALTHY"], statusOverrides: overrides }))).sort(), ["EFET2", "EFET4"]);
  const fOv = repo.montarFiltroSnapshots({ ...base, status: ["LOSS", "LOW_MARGIN"], statusOverrides: overrides });
  assert.strictEqual((await repo.countProjectionSnapshotsFiltrado({ filtro: fOv, db })).total, 2, "contagem acompanha o filtro efetivo");

  // KPIs: cada anúncio conta uma vez, pelo status efetivo.
  const k = await repo.summarizeProjectionSnapshots({ filtro: repo.montarFiltroSnapshots({ ...base, statusOverrides: overrides }), db });
  assert.deepStrictEqual([k.total, k.porStatus.LOSS, k.porStatus.LOW_MARGIN, k.porStatus.HEALTHY], [4, 1, 1, 2]);
  const kPersistido = await repo.summarizeProjectionSnapshots({ filtro: repo.montarFiltroSnapshots(base), db });
  assert.deepStrictEqual([kPersistido.porStatus.LOSS, kPersistido.porStatus.HEALTHY], [3, 1]);

  // Ordenação por status usa o efetivo (precedência de AÇÃO: LOSS antes de LOW_MARGIN antes de HEALTHY).
  const ord = await ids(repo.montarFiltroSnapshots({ ...base, statusOverrides: overrides }), "status");
  assert.strictEqual(ord[0], "EFET3");
  assert.strictEqual(ord[1], "EFET1");
  assert.deepStrictEqual(ord.slice(2).sort(), ["EFET2", "EFET4"]);

  // Linhas completas de um lote (para reclassificar), só do catálogo atual.
  const lote = await repo.listProjectionSnapshotsByItemIds({ clienteId: 1, clienteContaId: 2, itemIds: ["EFET1", "EFET9"], db });
  assert.deepStrictEqual(lote.map((l) => l.itemId), ["EFET1"]);

  // Listas paralelas inconsistentes ou status inválido são recusados antes do SQL.
  assert.throws(() => repo.montarFiltroSnapshots({ ...base, statusOverrides: { itemIds: ["A"], statuses: [] } }), /statusOverrides inválido/);
  assert.throws(() => repo.montarFiltroSnapshots({ ...base, statusOverrides: { itemIds: ["A"], statuses: ["NAO_EXISTE"] } }), /statusOverrides inválido/);
});

check("worklist (prejuízo → abaixo da meta → resto, maior receita primeiro) e LC somado em prejuízo em Postgres real", async ({ db }) => {
  const mk = (itemId, status, lc) => ({
    clienteId: 1, clienteContaId: 2, itemId, titulo: `wl-${itemId}`, status, profit: lc, margin: lc / 100, marginPercent: lc, quality: { evidencias: {} },
  });
  const itens = [["WL1", "HEALTHY", 20], ["WL2", "LOSS", -5], ["WL3", "LOW_MARGIN", 3], ["WL4", "LOSS", -8], ["WL5", "HEALTHY", 25], ["WL6", "LOSS", -2], ["WL7", "LOW_MARGIN", 4]];
  for (const [id, status, lc] of itens) await repo.upsertProjectionSnapshot(mk(id, status, lc), db);
  const receitas = { WL1: 500, WL2: 100, WL3: 50, WL4: 900, WL5: 20, WL7: 400 }; // WL6 sem receita conhecida = 0
  const base = { clienteId: 1, clienteContaId: 2, busca: "wl-" };
  const ordem = repo.resolverOrdenacao({ ordenacao: "worklist" });
  assert.strictEqual(ordem.direcao, "ASC");
  assert.strictEqual(repo.resolverOrdenacao({ ordenacao: "worklist", direcao: "DESC" }), null, "direção DESC não existe nessa ordem");
  const ids = async (filtro, offset = 0, limit = 50) => (await repo.queryProjectionSnapshotsPage({ filtro, orderBy: ordem.orderBy, limit, offset, receitas, db })).map((i) => i.itemId);

  // Status persistido: LOSS por receita (WL4 900 > WL2 100 > WL6 0), LOW por receita (WL7 400 > WL3 50), resto (WL1 500 > WL5 20).
  assert.deepStrictEqual(await ids(repo.montarFiltroSnapshots(base)), ["WL4", "WL2", "WL6", "WL7", "WL3", "WL1", "WL5"]);
  // Página estável (sem repetir/pular).
  const p1 = await ids(repo.montarFiltroSnapshots(base), 0, 3);
  const p2 = await ids(repo.montarFiltroSnapshots(base), 3, 3);
  const p3 = await ids(repo.montarFiltroSnapshots(base), 6, 3);
  assert.deepStrictEqual([...p1, ...p2, ...p3], ["WL4", "WL2", "WL6", "WL7", "WL3", "WL1", "WL5"]);

  // Status EFETIVO: WL2 saiu de Prejuízo (retorno ML) → entra no grupo "abaixo da meta" pela receita.
  const overrides = { itemIds: ["WL2"], statuses: ["LOW_MARGIN"] };
  assert.deepStrictEqual(await ids(repo.montarFiltroSnapshots({ ...base, statusOverrides: overrides })), ["WL4", "WL6", "WL7", "WL2", "WL3", "WL1", "WL5"]);

  // Sem receita nenhuma: desempate por item_id (determinístico).
  const semReceita = (await repo.queryProjectionSnapshotsPage({ filtro: repo.montarFiltroSnapshots(base), orderBy: ordem.orderBy, limit: 50, offset: 0, receitas: null, db })).map((i) => i.itemId);
  assert.deepStrictEqual(semReceita, ["WL2", "WL4", "WL6", "WL3", "WL7", "WL1", "WL5"]);

  // KPI: LC somado em Prejuízo (persistido e efetivo).
  const k = await repo.summarizeProjectionSnapshots({ filtro: repo.montarFiltroSnapshots(base), db });
  assert.strictEqual(k.lcPrejuizo, -15);
  const kEf = await repo.summarizeProjectionSnapshots({ filtro: repo.montarFiltroSnapshots({ ...base, statusOverrides: overrides }), db });
  assert.strictEqual(kEf.lcPrejuizo, -10, "o anúncio que saiu de Prejuízo não entra na soma");
  const sem = await repo.summarizeProjectionSnapshots({ filtro: repo.montarFiltroSnapshots({ ...base, busca: "nada-assim" }), db });
  assert.strictEqual(sem.lcPrejuizo, 0);
});

check("fan-out de Base: vínculo da conta e vínculo legado client-level", async ({ db }) => {
  const a = await triggers.resolverContasAfetadasPorBase({ baseId: 1 }, db);
  assert.deepStrictEqual(a.map((c) => c.clienteContaId), [2]);
  const b = await triggers.resolverContasAfetadasPorBase({ baseId: "base-b" }, db);
  assert.deepStrictEqual(b.map((c) => c.clienteContaId), [1, 2]);
});

check("recovery: run running sem heartbeat vira failed; vivo e terminal intactos", async ({ db, pg }) => {
  const { run } = await runService.enqueueMarginSnapshotRun({ clienteId: 2, clienteSlug: "b", clienteContaId: 3, reason: "manual_refresh", db });
  await runRepo.updateRunStatus({ runId: run.id, status: "running", db });
  await pg.query("UPDATE margin_snapshot_runs SET heartbeat_at = NOW() - make_interval(mins => 30) WHERE id = $1", [run.id]);
  const mortos = await runRepo.reconcileStaleRunningRuns({ staleMinutes: 10, db });
  assert.deepStrictEqual(mortos.map((r) => r.id), [run.id]);
  const novo = await runService.enqueueMarginSnapshotRun({ clienteId: 2, clienteSlug: "b", clienteContaId: 3, reason: "manual_refresh", db });
  assert.strictEqual(novo.reaproveitado, false, "índice único liberado");
});

(async () => {
  const ctx = await criarDb();
  let falhas = 0;
  for (const { nome, fn } of checks) {
    try {
      await fn(ctx);
      console.log(`  ✓ ${nome}`);
    } catch (err) {
      falhas += 1;
      console.error(`  ✗ ${nome}\n    ${err.stack || err.message}`);
    }
  }
  await ctx.pg.close();
  if (falhas) {
    console.error(`marginSnapshotSqlCheck: ${falhas} de ${checks.length} checagens falharam`);
    process.exitCode = 1;
  } else {
    console.log(`marginSnapshotSqlCheck: ok (${checks.length} checagens em Postgres/PGlite in-memory)`);
  }
})();
