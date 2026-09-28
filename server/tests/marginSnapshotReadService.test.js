// server/tests/marginSnapshotReadService.test.js
// Margin Snapshot — M5: a Central de Margem lê a PROJETADA do snapshot
// persistido e combina a REALIZADA da Central de Vendas, atrás de feature
// flag. Fake db + fake de contas + Motor fixture; nenhum ML, nenhum Postgres.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const read = require("../services/motorMargem/marginSnapshotReadService");
const motorMargem = require("../services/motorMargem/motorMargemService");
const core = require("../services/motorMargem/core");
const { processMarginSnapshotRun } = require("../services/motorMargem/marginSnapshotProcessor");
const { resolveMarginSnapshotConfig } = require("../services/motorMargem/marginSnapshotConfig");
const runService = require("../services/motorMargem/marginSnapshotRunService");
const runRepository = require("../services/motorMargem/marginSnapshotRunRepository");
const snapshotRepository = require("../services/motorMargem/marginSnapshotRepository");
const { createMarginSnapshotController } = require("../controllers/marginSnapshotController");
const { makeMarginSnapshotFakeDb } = require("./helpers/marginSnapshotFakeDb");
const { clienteContaServiceFake } = require("./helpers/marginSnapshotContasFake");
const fixture = require("./helpers/motorMargemFixture");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

const LIGADO = { MARGIN_SNAPSHOT_READ_ENABLED: "true" };
const SILENCIOSO = { log() {}, warn() {}, error() {} };

async function esperaErro(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error("era esperado um erro");
}

// Deps de leitura: fake db + contas fake + vendas do fixture. Qualquer
// tentativa de tocar o Motor ao vivo/ML explode.
function depsLeitura(db, { env = LIGADO, comVendas = true, ...extra } = {}) {
  const motor = fixture.motorDeps({ comVendas });
  const proibido = (nome) => async () => { throw new Error(`${nome} NÃO pode ser chamado na leitura por snapshot`); };
  return {
    db,
    env,
    now: fixture.NOW,
    clienteContaService: clienteContaServiceFake,
    contarContasAtivas: async () => 2,
    carregarVendas: motor.carregarVendas,
    agregarPorMlb: motor.agregarPorMlb,
    prepareWorkspaceContext: proibido("prepareWorkspaceContext"),
    enrichBatch: proibido("enrichBatch"),
    buscarDetalhesItens: proibido("buscarDetalhesItens"),
    ...extra,
  };
}

// Popula o snapshot da conta 5 (cliente 1) com o Motor REAL (fixture).
async function popularSnapshot(db, { clienteContaId = 5, anuncios = fixture.ANUNCIOS } = {}) {
  const { run } = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "loja-a", clienteContaId, reason: "manual_refresh", db });
  const running = await runRepository.updateRunStatus({ runId: run.id, status: "running", db });
  await processMarginSnapshotRun(running, {
    ...fixture.motorDeps({ comVendas: true, anuncios }),
    db,
    logger: SILENCIOSO,
    config: { ...resolveMarginSnapshotConfig({}), batchPauseMs: 0 },
    sleep: async () => {},
    listarIdsCatalogo: async () => ({
      ids: Object.keys(anuncios),
      totalAtivos: Object.values(anuncios).filter((a) => (a.status || "active") === "active").length,
      totalPausados: Object.values(anuncios).filter((a) => a.status === "paused").length,
    }),
  });
  await runRepository.updateRunStatus({ runId: run.id, status: "completed", db });
  return run;
}

// ═══════════════════════════════════════════════════════════════════════════
// Feature flag
// ═══════════════════════════════════════════════════════════════════════════

cenario("feature OFF: resumo diz modo legado; itens por snapshot respondem desabilitado; /workspace ao vivo intacto", async () => {
  const db = makeMarginSnapshotFakeDb();
  const resumo = await read.obterResumo({ clienteSlug: "loja-a", clienteContaId: 5 }, depsLeitura(db, { env: {} }));
  assert.deepStrictEqual(resumo, { ok: true, habilitado: false, modo: "legacy" });

  const erro = await esperaErro(() => read.listarItens({ clienteSlug: "loja-a", clienteContaId: 5 }, depsLeitura(db, { env: {} })));
  assert.strictEqual(erro.statusCode, 404);
  assert.strictEqual(erro.payload.code, "MARGIN_SNAPSHOT_READ_DISABLED");

  // O caminho legado continua exatamente o mesmo (Motor ao vivo).
  const legado = await motorMargem.obterWorkspace({ clienteSlug: "cliente-teste" }, fixture.motorDeps());
  assert.strictEqual(legado.itens.length, 3);
  assert.strictEqual(legado.resumo.escopo, "workspace");
});

cenario("rollout por cliente: MARGIN_SNAPSHOT_READ_CLIENTES liga só os slugs listados", () => {
  const env = { MARGIN_SNAPSHOT_READ_CLIENTES: " loja-a , outra " };
  assert.strictEqual(read.leituraHabilitada({ clienteSlug: "loja-a" }, env), true);
  assert.strictEqual(read.leituraHabilitada({ clienteSlug: "LOJA-A" }, env), true);
  assert.strictEqual(read.leituraHabilitada({ clienteSlug: "loja-b" }, env), false);
  assert.strictEqual(read.leituraHabilitada({ clienteSlug: "loja-b" }, {}), false);
  assert.strictEqual(read.leituraHabilitada({ clienteSlug: "loja-b" }, { MARGIN_SNAPSHOT_READ_ENABLED: "true" }), true);
});

// ═══════════════════════════════════════════════════════════════════════════
// Missing — nunca "0 itens saudáveis"
// ═══════════════════════════════════════════════════════════════════════════

cenario("feature ON + conta sem snapshot: estado 'missing' explícito, ação refresh, total null (não 0)", async () => {
  const db = makeMarginSnapshotFakeDb();
  const resumo = await read.obterResumo({ clienteSlug: "loja-a", clienteContaId: 5 }, depsLeitura(db));
  assert.strictEqual(resumo.habilitado, true);
  assert.strictEqual(resumo.estado, "missing");
  assert.strictEqual(resumo.acao, "refresh");
  assert.strictEqual(resumo.snapshot.totalItens, null, "missing não é 0");
  assert.ok(resumo.mensagem);

  const itens = await read.listarItens({ clienteSlug: "loja-a", clienteContaId: 5 }, depsLeitura(db));
  assert.strictEqual(itens.estado, "missing");
  assert.deepStrictEqual(itens.itens, []);
  assert.strictEqual(itens.paginacao.total, null);
  assert.strictEqual(itens.acao, "refresh");
});

cenario("missing com run ativo: sem ação de refresh (já está calculando) e com o progresso do run", async () => {
  const db = makeMarginSnapshotFakeDb();
  await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "loja-a", clienteContaId: 5, reason: "manual_refresh", db });
  const resumo = await read.obterResumo({ clienteSlug: "loja-a", clienteContaId: 5 }, depsLeitura(db));
  assert.strictEqual(resumo.estado, "missing");
  assert.strictEqual(resumo.acao, null);
  assert.strictEqual(resumo.refresh.runAtivo.status, "queued");
});

cenario("catálogo vazio de verdade (run completou com 0 itens) é 'ready' com total 0 — diferente de missing", async () => {
  const db = makeMarginSnapshotFakeDb();
  const { run } = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "loja-a", clienteContaId: 5, reason: "manual_refresh", db });
  await runRepository.updateRunStatus({ runId: run.id, status: "running", db });
  await runRepository.updateRunStatus({ runId: run.id, status: "completed", db });
  const itens = await read.listarItens({ clienteSlug: "loja-a", clienteContaId: 5 }, depsLeitura(db));
  assert.strictEqual(itens.estado, "ready");
  assert.strictEqual(itens.paginacao.total, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Snapshot → leitura
// ═══════════════════════════════════════════════════════════════════════════

cenario("feature ON + snapshot existente: lê do banco, sem Motor ao vivo nem ML (deps proibidas nunca chamadas)", async () => {
  const db = makeMarginSnapshotFakeDb();
  await popularSnapshot(db);
  const r = await read.listarItens({ clienteSlug: "loja-a", clienteContaId: 5 }, depsLeitura(db));
  assert.strictEqual(r.estado, "ready");
  assert.strictEqual(r.itens.length, 3);
  assert.strictEqual(r.paginacao.total, 3);
  assert.ok(r.itens.every((i) => i.statusBase === "projected"));
  assert.ok(r.itens.every((i) => i.snapshot.refreshStatus === "fresh"));

  const src = fs.readFileSync(path.join(__dirname, "../services/motorMargem/marginSnapshotReadService.js"), "utf8");
  const requires = (src.match(/require\(["'][^"']+["']\)/g) || []).join(" ");
  for (const modulo of ["mlClient", "meliApiEvidenceAdapter", "marketplaceCurrentQuoteService"]) {
    assert.ok(!requires.includes(modulo), `leitura por snapshot não importa ${modulo}`);
  }
  for (const chamada of ["enrichBatch(", "prepareWorkspaceContext(", "mlFetch(", "buscarDetalhesItens(", "obterWorkspace("]) {
    assert.ok(!src.includes(chamada), `leitura por snapshot não chama ${chamada}`);
  }
});

cenario("processor persiste active/paused no quality_json e a leitura filtra sem nova chamada ao ML", async () => {
  const db = makeMarginSnapshotFakeDb();
  const anuncios = {
    MLB1: { ...fixture.ANUNCIOS.MLB1, status: "active" },
    MLB2: { ...fixture.ANUNCIOS.MLB2, status: "paused" },
    MLB3: { ...fixture.ANUNCIOS.MLB3, status: "active" },
  };
  await popularSnapshot(db, { anuncios });
  assert.strictEqual(db.snapshots.find((s) => s.item_id === "MLB2").quality_json.statusAnuncio, "paused");

  const pausados = await read.listarItens({ clienteSlug: "loja-a", clienteContaId: 5, statusAnuncio: "paused" }, depsLeitura(db));
  assert.deepStrictEqual(pausados.itens.map((i) => i.itemId), ["MLB2"]);
  assert.strictEqual(pausados.itens[0].diagnostico.statusAnuncio, "paused");

  const resumo = await read.obterResumo({ clienteSlug: "loja-a", clienteContaId: 5 }, depsLeitura(db));
  assert.deepStrictEqual(resumo.kpis.anuncios, { total: 3, ativos: 2, pausados: 1 });
});

cenario("projetada vem da linha persistida — nunca recalculada na leitura", async () => {
  const db = makeMarginSnapshotFakeDb();
  await popularSnapshot(db);
  // Adultera o lucro persistido: se a leitura recalculasse a projetada a
  // partir das evidências, o valor voltaria a 18.
  const linha = db.snapshots.find((r) => r.item_id === "MLB1");
  linha.profit = 999.99;
  linha.margin_percent = 77.7;

  const chamadasComputeMargin = [];
  const r = await read.listarItens({ clienteSlug: "loja-a", clienteContaId: 5 }, depsLeitura(db, {
    computeMargin: (inputs) => { chamadasComputeMargin.push(inputs); return core.computeMargin(inputs); },
  }));
  const mlb1 = r.itens.find((i) => i.itemId === "MLB1");
  assert.strictEqual(mlb1.margin.projected.profit, 999.99);
  assert.strictEqual(mlb1.margin.projected.marginPercent, 77.7);
  assert.strictEqual(mlb1.projected.profit, 999.99);
  // computeMargin só roda para a REALIZADA, e só de itens com venda (MLB1, MLB3).
  assert.strictEqual(chamadasComputeMargin.length, 2);
  assert.ok(chamadasComputeMargin.every((inputs) => inputs.fixedFee === null), "entradas realizadas (taxa fixa não tem histórico)");
});

cenario("realizada continua vindo da Central de Vendas — igual à do Motor ao vivo no mesmo período", async () => {
  const db = makeMarginSnapshotFakeDb();
  await popularSnapshot(db);
  const chamadasVendas = [];
  const deps = depsLeitura(db);
  const carregarOriginal = deps.carregarVendas;
  deps.carregarVendas = async (args, dbArg) => { chamadasVendas.push(args); return carregarOriginal(args, dbArg); };

  const r = await read.listarItens({ clienteSlug: "loja-a", clienteContaId: 5, dateFrom: "2026-08-01", dateTo: "2026-08-31" }, deps);
  assert.strictEqual(chamadasVendas.length, 1, "1 leitura da Central de Vendas por página");
  assert.strictEqual(chamadasVendas[0].clienteContaId, 5, "vendas SEMPRE da conta pedida");
  assert.strictEqual(chamadasVendas[0].dateFrom, "2026-08-01");
  assert.strictEqual(chamadasVendas[0].dateTo, "2026-08-31");
  assert.strictEqual(chamadasVendas[0].includeLegacy, false, "2+ contas ativas → nunca lê import legado ambíguo");

  const aoVivo = await motorMargem.obterWorkspace({ clienteSlug: "cliente-teste", dateFrom: "2026-08-01", dateTo: "2026-08-31" }, fixture.motorDeps({ comVendas: true }));
  for (const vivo of aoVivo.itens) {
    const lido = r.itens.find((i) => i.itemId === vivo.identity.itemId);
    assert.deepStrictEqual(lido.margin.realized.margin, vivo.margin.realized.margin, `${vivo.identity.itemId}: margem realizada`);
    assert.deepStrictEqual(lido.margin.realized.profit, vivo.margin.realized.profit, `${vivo.identity.itemId}: lucro realizado`);
    assert.strictEqual(lido.margin.projected.margin, vivo.margin.projected.margin, `${vivo.identity.itemId}: margem projetada`);
    assert.strictEqual(lido.sales.hasOrders, vivo.sales.hasOrders);
  }
  const mlb3 = r.itens.find((i) => i.itemId === "MLB3");
  assert.strictEqual(mlb3.margin.realized.marginPercent, -7);
  const drift = mlb3.quality.divergences.find((d) => d.field === "freight" && d.type === "DRIFT");
  assert.ok(drift, "divergência previsto × realizado do frete reconstruída pelo núcleo");
  assert.strictEqual(mlb3.fields.freight.projected.value, 10);
  assert.strictEqual(mlb3.fields.freight.realized.value, 25);
});

cenario("isolamento: snapshot da conta 5 nunca aparece na conta 6; conta de outro cliente é 403", async () => {
  const db = makeMarginSnapshotFakeDb();
  await popularSnapshot(db, { clienteContaId: 5 });

  const conta6 = await read.listarItens({ clienteSlug: "loja-a", clienteContaId: 6 }, depsLeitura(db));
  assert.strictEqual(conta6.estado, "missing", "conta 6 não herda a leitura da conta 5");
  assert.deepStrictEqual(conta6.itens, []);

  const outroCliente = await esperaErro(() => read.listarItens({ clienteSlug: "loja-a", clienteContaId: 7 }, depsLeitura(db)));
  assert.strictEqual(outroCliente.statusCode, 403);
  const semConta = await esperaErro(() => read.obterResumo({ clienteSlug: "loja-a" }, depsLeitura(db)));
  assert.strictEqual(semConta.statusCode, 400);
});

cenario("paginação no SQL: páginas sem repetição, total coerente, limit com teto", async () => {
  const db = makeMarginSnapshotFakeDb();
  const anuncios = {};
  for (let i = 0; i < 45; i += 1) {
    anuncios[`MLB${100 + i}`] = { price: 100, commission: 12, commissionRate: 0.12, freight: 10 + (i % 7), titulo: `Produto ${i}` };
  }
  await popularSnapshot(db, { anuncios });
  const vistos = new Set();
  for (const page of [1, 2, 3]) {
    const r = await read.listarItens({ clienteSlug: "loja-a", clienteContaId: 5, page, limit: 20 }, depsLeitura(db));
    assert.strictEqual(r.paginacao.total, 45);
    assert.strictEqual(r.paginacao.totalPaginas, 3);
    for (const item of r.itens) {
      assert.ok(!vistos.has(item.itemId), `item ${item.itemId} repetido entre páginas`);
      vistos.add(item.itemId);
    }
  }
  assert.strictEqual(vistos.size, 45);
  const teto = await read.listarItens({ clienteSlug: "loja-a", clienteContaId: 5, limit: 100000 }, depsLeitura(db));
  assert.strictEqual(teto.paginacao.limit, read.LIMIT_MAX);
});

cenario("itens fora do catálogo ficam fora da leitura padrão e do total", async () => {
  const db = makeMarginSnapshotFakeDb();
  await popularSnapshot(db);
  await snapshotRepository.markSnapshotsOutsideCatalog({ clienteId: 1, clienteContaId: 5, catalogItemIds: ["MLB1", "MLB2"], db });
  const r = await read.listarItens({ clienteSlug: "loja-a", clienteContaId: 5 }, depsLeitura(db));
  assert.deepStrictEqual(r.itens.map((i) => i.itemId).sort(), ["MLB1", "MLB2"]);
  assert.strictEqual(r.paginacao.total, 2);
});

cenario("item com refresh falho continua visível com os valores anteriores e o erro redigido", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await popularSnapshot(db);
  await snapshotRepository.markSnapshotsRefreshFailed({
    clienteId: 1, clienteContaId: 5, itemIds: ["MLB1"], runId: run.id,
    lastError: "ML 503 com Bearer APP_USR-abc123", db,
  });
  const r = await read.listarItens({ clienteSlug: "loja-a", clienteContaId: 5 }, depsLeitura(db));
  const mlb1 = r.itens.find((i) => i.itemId === "MLB1");
  assert.strictEqual(mlb1.snapshot.refreshStatus, "failed");
  assert.strictEqual(mlb1.margin.projected.marginPercent, 18, "valor anterior preservado e exibido");
  assert.ok(!/APP_USR/.test(mlb1.snapshot.lastError));
});

cenario("controller: resumo/itens delegam ao read service e mapeiam erro de flag para 404", async () => {
  const chamadas = [];
  const controller = createMarginSnapshotController({
    readService: {
      obterResumo: async (args) => { chamadas.push(["resumo", args]); return { ok: true, habilitado: false, modo: "legacy" }; },
      listarItens: async (args) => { chamadas.push(["itens", args]); throw Object.assign(new Error("x"), { statusCode: 404, payload: { ok: false, code: "MARGIN_SNAPSHOT_READ_DISABLED" } }); },
    },
  });
  const res = { status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await controller.obterResumo({ params: { clienteSlug: "Loja-A" }, query: { clienteContaId: "5" } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(chamadas[0], ["resumo", { clienteSlug: "loja-a", clienteContaId: "5" }]);

  const res2 = { status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await controller.listarItens({ params: { clienteSlug: "loja-a" }, query: { clienteContaId: "5", page: "2", limit: "20", statusAnuncio: "paused" } }, res2);
  assert.strictEqual(res2.statusCode, 404);
  assert.strictEqual(res2.body.code, "MARGIN_SNAPSHOT_READ_DISABLED");
  assert.strictEqual(chamadas[1][1].page, "2");
  assert.strictEqual(chamadas[1][1].statusAnuncio, "paused");
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
    console.error(`marginSnapshotReadService: ${falhas} de ${casos.length} cenários falharam`);
    process.exitCode = 1;
  } else {
    console.log(`marginSnapshotReadService: ok (${casos.length} cenários)`);
  }
}

main();
