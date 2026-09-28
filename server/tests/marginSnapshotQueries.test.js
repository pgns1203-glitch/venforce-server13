// server/tests/marginSnapshotQueries.test.js
// Margin Snapshot — M6: paginação, busca, filtros, ordenação (whitelist) e
// KPIs calculados no banco (fake db que interpreta o SQL gerado pelo
// builder). Sem ML, sem Postgres.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const repo = require("../services/motorMargem/marginSnapshotRepository");
const read = require("../services/motorMargem/marginSnapshotReadService");
const runService = require("../services/motorMargem/marginSnapshotRunService");
const runRepository = require("../services/motorMargem/marginSnapshotRunRepository");
const { makeMarginSnapshotFakeDb } = require("./helpers/marginSnapshotFakeDb");
const { clienteContaServiceFake } = require("./helpers/marginSnapshotContasFake");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

const LIGADO = { MARGIN_SNAPSHOT_READ_ENABLED: "true" };

async function esperaErro(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error("era esperado um erro");
}

const STATUS_CICLO = ["HEALTHY", "LOW_MARGIN", "LOSS", "UNVALIDATED", "SUSPECT_DATA", "HEALTHY", "HEALTHY"];

// 5.000 itens na conta 5 + 30 na conta 6 (mesmos MLBs no início).
async function popular(db, { total = 120, conta6 = 30 } = {}) {
  for (let i = 0; i < total; i += 1) {
    const status = STATUS_CICLO[i % STATUS_CICLO.length];
    const semMargem = status === "UNVALIDATED";
    const marginPercent = semMargem ? null : ((i * 37) % 61) - 20; // -20..40, com repetições
    await repo.upsertProjectionSnapshot({
      clienteId: 1, clienteContaId: 5, itemId: `MLB${1000 + i}`,
      sku: i % 10 === 0 ? `KIT-${i}` : `SKU-${i}`,
      titulo: i % 13 === 0 ? `Camiseta Azul 100% algodão ${i}` : `Produto ${i}`,
      price: 100, cost: semMargem ? null : 40,
      profit: semMargem ? null : marginPercent, margin: semMargem ? null : marginPercent / 100, marginPercent,
      status, confidenceLevel: i % 4 === 0 ? "LOW" : "HIGH",
      refreshStatus: i % 11 === 0 ? "failed" : "fresh",
      quality: { evidencias: {} },
    }, db);
  }
  for (let i = 0; i < conta6; i += 1) {
    await repo.upsertProjectionSnapshot({
      clienteId: 1, clienteContaId: 6, itemId: `MLB${1000 + i}`, sku: `SKU-${i}`, titulo: `Conta seis ${i}`,
      price: 100, profit: 99, margin: 0.99, marginPercent: 99, status: "LOSS", quality: { evidencias: {} },
    }, db);
  }
}

function deps(db, extra = {}) {
  return {
    db, env: LIGADO, clienteContaService: clienteContaServiceFake, contarContasAtivas: async () => 2,
    carregarVendas: async () => ({ sincronizado: false, pedidos: [], itens: [], componentes: [], imports: [] }),
    ...extra,
  };
}

async function listar(db, params) {
  return read.listarItens({ clienteSlug: "loja-a", clienteContaId: 5, ...params }, deps(db));
}

// ═══════════════════════════════════════════════════════════════════════════
// Paginação
// ═══════════════════════════════════════════════════════════════════════════

cenario("paginação: 5.000 itens navegados em páginas de 200 sem duplicar nem pular; total coerente", async () => {
  const db = makeMarginSnapshotFakeDb();
  await popular(db, { total: 5000, conta6: 0 });
  const vistos = new Set();
  let paginas = 0;
  for (let page = 1; ; page += 1) {
    const r = await listar(db, { page, limit: 200 });
    assert.strictEqual(r.paginacao.total, 5000);
    assert.ok(r.itens.length <= 200, "nunca mais que 1 página por request");
    if (!r.itens.length) break;
    paginas += 1;
    for (const item of r.itens) {
      assert.ok(!vistos.has(item.itemId), `duplicado: ${item.itemId}`);
      vistos.add(item.itemId);
    }
  }
  assert.strictEqual(paginas, 25);
  assert.strictEqual(vistos.size, 5000);
});

cenario("paginação com filtro: total é o do filtro, não o do catálogo", async () => {
  const db = makeMarginSnapshotFakeDb();
  await popular(db);
  const r = await listar(db, { status: "LOSS", limit: 5 });
  const esperado = db.snapshots.filter((s) => s.cliente_conta_id === 5 && s.status === "LOSS").length;
  assert.strictEqual(r.paginacao.total, esperado);
  assert.strictEqual(r.itens.length, 5);
});

// ═══════════════════════════════════════════════════════════════════════════
// Busca
// ═══════════════════════════════════════════════════════════════════════════

cenario("busca por MLB, SKU e título (case-insensitive, parcial)", async () => {
  const db = makeMarginSnapshotFakeDb();
  await popular(db);
  const porMlb = await listar(db, { busca: "mlb1007" });
  assert.deepStrictEqual(porMlb.itens.map((i) => i.itemId), ["MLB1007"]);

  const porSku = await listar(db, { busca: "kit-", limit: 200 });
  assert.ok(porSku.itens.length > 0 && porSku.itens.every((i) => i.sku.startsWith("KIT-")));

  const porTitulo = await listar(db, { q: "camiseta AZUL", limit: 200 });
  assert.ok(porTitulo.itens.length > 0 && porTitulo.itens.every((i) => /camiseta azul/i.test(i.titulo)));
});

cenario("busca com % e _ é literal (escapada) — nunca vira curinga", async () => {
  const db = makeMarginSnapshotFakeDb();
  await popular(db);
  const r = await listar(db, { busca: "100%", limit: 200 });
  assert.ok(r.itens.length > 0);
  assert.ok(r.itens.every((i) => i.titulo.includes("100%")), "'%' do usuário não casa qualquer coisa");
  const sublinhado = await listar(db, { busca: "SKU_1" });
  assert.strictEqual(sublinhado.paginacao.total, 0, "'_' do usuário não casa um caractere qualquer");
});

// ═══════════════════════════════════════════════════════════════════════════
// Filtros
// ═══════════════════════════════════════════════════════════════════════════

cenario("filtros combinados: status (lista) + refreshStatus + confiança + busca", async () => {
  const db = makeMarginSnapshotFakeDb();
  await popular(db);
  const r = await listar(db, { status: "HEALTHY,LOSS", refreshStatus: "failed", confianca: "LOW", busca: "Produto", limit: 200 });
  const esperado = db.snapshots.filter((s) => s.cliente_conta_id === 5
    && ["HEALTHY", "LOSS"].includes(s.status) && s.refresh_status === "failed"
    && s.confidence_level === "LOW" && /produto/i.test(s.titulo));
  assert.ok(esperado.length > 0, "pré-condição: combinação existe na massa");
  assert.deepStrictEqual(r.itens.map((i) => i.itemId).sort(), esperado.map((s) => s.item_id).sort());
});

cenario("filtro com valor fora do enum é rejeitado (400), nunca interpolado", async () => {
  const db = makeMarginSnapshotFakeDb();
  await popular(db, { total: 5, conta6: 0 });
  for (const params of [{ status: "HEALTHY' OR 1=1 --" }, { refreshStatus: "qualquer" }, { confianca: "ALTISSIMA" }]) {
    const err = await esperaErro(() => listar(db, params));
    assert.strictEqual(err.statusCode, 400);
    assert.strictEqual(err.payload.code, "FILTRO_INVALIDO");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Ordenação
// ═══════════════════════════════════════════════════════════════════════════

function margens(itens) {
  return itens.map((i) => i.margin.projected.marginPercent);
}

cenario("ordenação ASC/DESC por margem, lucro e updated_at; nulos sempre no fim; desempate estável", async () => {
  const db = makeMarginSnapshotFakeDb();
  await popular(db);
  const asc = await listar(db, { ordenacao: "margin_percent", direcao: "asc", limit: 200 });
  const m = margens(asc.itens);
  const n = m.indexOf(null);
  assert.ok(n > 0 && m.slice(n).every((x) => x === null), "NULLS LAST no ASC");
  assert.deepStrictEqual(m.slice(0, n), m.slice(0, n).slice().sort((a, b) => a - b));

  const desc = await listar(db, { ordenacao: "margin_percent", direcao: "DESC", limit: 200 });
  const md = margens(desc.itens);
  const nd = md.indexOf(null);
  assert.ok(md.slice(nd).every((x) => x === null), "NULLS LAST também no DESC");
  assert.deepStrictEqual(md.slice(0, nd), md.slice(0, nd).slice().sort((a, b) => b - a));

  const lucro = await listar(db, { ordenacao: "profit", direcao: "desc", limit: 200 });
  const p = lucro.itens.map((i) => i.margin.projected.profit).filter((x) => x !== null);
  assert.deepStrictEqual(p, p.slice().sort((a, b) => b - a));

  const recentes = await listar(db, { ordenacao: "updated_at", direcao: "desc", limit: 5 });
  assert.strictEqual(recentes.itens.length, 5);

  // Aliases do contrato ao vivo continuam aceitos.
  const alias = await listar(db, { ordenacao: "margem_desc", limit: 200 });
  assert.deepStrictEqual(margens(alias.itens), md);
});

cenario("ordenação por status segue a precedência de ação do Motor (mais urgente primeiro)", async () => {
  const db = makeMarginSnapshotFakeDb();
  await popular(db);
  const r = await listar(db, { ordenacao: "status", direcao: "asc", limit: 200 });
  const ordem = ["UNVALIDATED", "SUSPECT_DATA", "LOSS", "LOW_MARGIN", "RECONCILING", "HEALTHY"];
  const ranks = r.itens.map((i) => ordem.indexOf(i.status));
  assert.deepStrictEqual(ranks, ranks.slice().sort((a, b) => a - b));
});

cenario("ordenação por coluna fora da whitelist (ou direção inválida) é rejeitada — nunca interpolada", async () => {
  const db = makeMarginSnapshotFakeDb();
  await popular(db, { total: 5, conta6: 0 });
  for (const params of [{ ordenacao: "cost; DROP TABLE margin_projection_snapshots" }, { ordenacao: "cliente_conta_id" }, { ordenacao: "profit", direcao: "sideways" }]) {
    const err = await esperaErro(() => listar(db, params));
    assert.strictEqual(err.statusCode, 400);
    assert.strictEqual(err.payload.code, "ORDENACAO_INVALIDA");
  }
  assert.strictEqual(db.snapshots.length, 5);
});

// ═══════════════════════════════════════════════════════════════════════════
// KPIs no banco
// ═══════════════════════════════════════════════════════════════════════════

cenario("KPIs vêm de uma agregação no banco e independem da página/filtro da lista", async () => {
  const db = makeMarginSnapshotFakeDb();
  await popular(db);
  const queries = [];
  const dbEspiao = { ...db, query: (sql, params) => { queries.push(String(sql)); return db.query(sql, params); } };
  const resumo = await read.obterResumo({ clienteSlug: "loja-a", clienteContaId: 5 }, deps(dbEspiao));

  const conta5 = db.snapshots.filter((s) => s.cliente_conta_id === 5);
  const contar = (fn) => conta5.filter(fn).length;
  assert.strictEqual(resumo.kpis.total, conta5.length);
  for (const status of ["HEALTHY", "LOW_MARGIN", "LOSS", "UNVALIDATED", "SUSPECT_DATA", "RECONCILING"]) {
    assert.strictEqual(resumo.kpis.porStatus[status], contar((s) => s.status === status), `KPI ${status}`);
  }
  assert.strictEqual(resumo.kpis.porRefreshStatus.failed, contar((s) => s.refresh_status === "failed"));
  assert.strictEqual(resumo.kpis.porRefreshStatus.fresh, contar((s) => s.refresh_status === "fresh"));
  assert.strictEqual(resumo.kpis.comMargem, contar((s) => s.margin !== null));
  assert.ok(queries.some((q) => q.includes("/* ms:kpis */") && q.includes("FILTER (WHERE status = 'HEALTHY')")), "contagem via COUNT FILTER no SQL");

  // Uma página filtrada não muda o placar.
  await listar(db, { status: "LOSS", page: 3, limit: 5 });
  const denovo = await read.obterResumo({ clienteSlug: "loja-a", clienteContaId: 5 }, deps(db));
  assert.deepStrictEqual(denovo.kpis, resumo.kpis);
});

cenario("KPIs isolados por conta: a conta 6 não entra no placar da conta 5 e vice-versa", async () => {
  const db = makeMarginSnapshotFakeDb();
  await popular(db, { total: 20, conta6: 30 });
  const r5 = await read.obterResumo({ clienteSlug: "loja-a", clienteContaId: 5 }, deps(db));
  const r6 = await read.obterResumo({ clienteSlug: "loja-a", clienteContaId: 6 }, deps(db));
  assert.strictEqual(r5.kpis.total, 20);
  assert.strictEqual(r6.kpis.total, 30);
  assert.strictEqual(r6.kpis.porStatus.LOSS, 30);
  const l6 = await read.listarItens({ clienteSlug: "loja-a", clienteContaId: 6, busca: "MLB1000" }, deps(db));
  assert.strictEqual(l6.itens.length, 1);
  assert.strictEqual(l6.itens[0].margin.projected.marginPercent, 99, "mesmo MLB, linha da conta 6");
});

cenario("KPIs de conta 'missing' são null (nunca zeros)", async () => {
  const db = makeMarginSnapshotFakeDb();
  const r = await read.obterResumo({ clienteSlug: "loja-a", clienteContaId: 5 }, deps(db));
  assert.strictEqual(r.estado, "missing");
  assert.strictEqual(r.kpis, null);
});

cenario("KPIs refletem o último run: fora do catálogo não conta", async () => {
  const db = makeMarginSnapshotFakeDb();
  await popular(db, { total: 10, conta6: 0 });
  const { run } = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "loja-a", clienteContaId: 5, reason: "manual_refresh", db });
  await runRepository.updateRunStatus({ runId: run.id, status: "running", db });
  await repo.markSnapshotsOutsideCatalog({ clienteId: 1, clienteContaId: 5, catalogItemIds: ["MLB1000", "MLB1001", "MLB1002"], runId: run.id, db });
  const r = await read.obterResumo({ clienteSlug: "loja-a", clienteContaId: 5 }, deps(db));
  assert.strictEqual(r.kpis.total, 3);
  assert.strictEqual(r.snapshot.foraDoCatalogo, 7);
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
    console.error(`marginSnapshotQueries: ${falhas} de ${casos.length} cenários falharam`);
    process.exitCode = 1;
  } else {
    console.log(`marginSnapshotQueries: ok (${casos.length} cenários)`);
  }
}

main();
