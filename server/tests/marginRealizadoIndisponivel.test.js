// server/tests/marginRealizadoIndisponivel.test.js
// Realizado INDISPONÍVEL: quando a Central de Vendas falha (ou nenhum import
// cobre o período) o contrato é `realizado: null` + `realizado_motivo`.
// Receita, unidades, pedidos e lucro nunca viram 0. Sem banco real, sem ML.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/dead";

const assert = require("assert");
const read = require("../services/motorMargem/marginSnapshotReadService");
const runRepository = require("../services/motorMargem/marginSnapshotRunRepository");
const runService = require("../services/motorMargem/marginSnapshotRunService");
const { montarCandidata } = require("../services/motorMargem/precificacao/precificacaoOportunidadesService");
const { makeMarginSnapshotFakeDb } = require("./helpers/marginSnapshotFakeDb");
const { clienteContaServiceFake } = require("./helpers/marginSnapshotContasFake");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

const LIGADO = { MARGIN_SNAPSHOT_READ_ENABLED: "true" };

function deps(db, carregarVendas, logs = []) {
  return {
    db,
    env: LIGADO,
    now: new Date("2026-09-28T15:00:00Z"),
    clienteContaService: clienteContaServiceFake,
    contarContasAtivas: async () => 2,
    carregarVendas,
    buscarSyncAtivo: async () => null,
    logger: { error: (linha) => logs.push(linha), log() {}, warn() {} },
  };
}

const FALHA = async () => { throw new Error("connection terminated (access_token=APP_USR-123)"); };
const SEM_IMPORT = async () => ({ sincronizado: false, pedidos: [], pedidosTodos: [], itens: [], componentes: [], imports: [], competencias: [] });

async function comRunVazio(db) {
  const { run } = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "loja-a", clienteContaId: 5, reason: "manual_refresh", db });
  await runRepository.updateRunStatus({ runId: run.id, status: "running", db });
  await runRepository.updateRunStatus({ runId: run.id, status: "completed", db });
}

cenario("Central de Vendas falhou: /realizado devolve realizado null + motivo, KPIs null (nunca 0) e o erro vai redigido ao log", async () => {
  const db = makeMarginSnapshotFakeDb();
  const logs = [];
  const r = await read.obterRealizado({ clienteSlug: "loja-a", clienteContaId: 5 }, deps(db, FALHA, logs));
  assert.strictEqual(r.ok, true, "a leitura não cai: o projetado não depende da Central de Vendas");
  assert.strictEqual(r.realizado, null);
  assert.strictEqual(r.realizado_motivo, "CENTRAL_VENDAS_FALHOU");
  assert.ok(r.realizado_mensagem.includes("nenhum valor foi zerado"));
  assert.strictEqual(r.kpis, null, "nenhum receita:0 / pedidos:0 / produtosComVenda:0");
  assert.strictEqual(r.cobertura, null);
  assert.strictEqual(r.freshness.estado, "INDISPONIVEL");
  assert.strictEqual(r.freshness.sincronizadoAte, null);
  assert.strictEqual(r.periodo.dateTo, "2026-09-27", "o período resolvido continua informado");
  assert.strictEqual(logs.length, 1);
  assert.ok(logs[0].includes("margin_snapshot.realizado_indisponivel"));
  assert.ok(!logs[0].includes("APP_USR-123"), logs[0]);
});

cenario("nenhum import cobre o período: realizado null + SEM_SINCRONIZACAO (não é 'R$ 0 em 0 pedidos')", async () => {
  const db = makeMarginSnapshotFakeDb();
  const r = await read.obterRealizado({ clienteSlug: "loja-a", clienteContaId: 5 }, deps(db, SEM_IMPORT));
  assert.strictEqual(r.realizado, null);
  assert.strictEqual(r.realizado_motivo, "SEM_SINCRONIZACAO");
  assert.strictEqual(r.kpis, null);
  assert.strictEqual(r.freshness.estado, "SEM_SINCRONIZACAO");
});

cenario("conta de outro cliente continua 403 (a falha da Central de Vendas não mascara erro de acesso)", async () => {
  const db = makeMarginSnapshotFakeDb();
  await assert.rejects(() => read.obterRealizado({ clienteSlug: "loja-a", clienteContaId: 7 }, deps(db, FALHA)), (err) => err.statusCode === 403);
});

cenario("itens: com a Central de Vendas fora a página continua com o projetado e marca o realizado como indisponível (não 'sem venda')", async () => {
  const db = makeMarginSnapshotFakeDb();
  await comRunVazio(db);
  const r = await read.listarItens({ clienteSlug: "loja-a", clienteContaId: 5 }, deps(db, FALHA));
  assert.strictEqual(r.estado, "ready");
  assert.strictEqual(r.vendas.realizado, null);
  assert.strictEqual(r.vendas.realizado_motivo, "CENTRAL_VENDAS_FALHOU");
  assert.strictEqual(r.vendas.pedidosNoPeriodo, null, "pedidos: null, não 0");
  assert.strictEqual(r.vendas.cobertura, null);
});

cenario("item composto com realizado indisponível: realizado_motivo, projectedVsRealized null (nunca NO_SALES) e sales sem zeros", () => {
  const row = {
    itemId: "MLB1", sku: "S", titulo: "P", marketplace: "meli", imageUrl: null, price: "100.00", cost: "40.00",
    profit: 18, margin: 0.18, marginPercent: 18, status: "HEALTHY", confidenceLevel: "HIGH",
    assumed: [], missing: [], refreshStatus: "fresh", calculatedAt: "2026-09-27T06:00:00Z", observedAt: "2026-09-27T06:00:00Z", runId: 7,
    quality: { targetMargin: 0.1, evidencias: {} },
  };
  const realizada = { porMlb: new Map(), reembolsoPorMlb: new Map(), fallbackObservedAt: null, indisponivel: { motivo: "CENTRAL_VENDAS_FALHOU" } };
  const item = read.comporItem(row, realizada);
  assert.strictEqual(item.realizado_motivo, "CENTRAL_VENDAS_FALHOU");
  assert.strictEqual(item.projectedVsRealized, null);
  assert.strictEqual(item.sales.unidades, null);
  assert.strictEqual(item.sales.receita, null);
  assert.strictEqual(item.projected.margin, 0.18, "o projetado segue intacto");
  const normal = read.comporItem(row, { porMlb: new Map(), reembolsoPorMlb: new Map(), fallbackObservedAt: null });
  assert.strictEqual(normal.realizado_motivo, null);
  assert.strictEqual(normal.projectedVsRealized.status, "NO_SALES", "sem indisponibilidade, 'sem venda' segue sendo NO_SALES");
});

cenario("oportunidades: vendas indisponíveis → unidades/receita null na linha, nunca 0 un.", () => {
  const snap = { price: 94.9, cost: 40, tax_rate: 0.1, fixed_fee: 0, commission_rate: 0.14, freight: 10, margin: 0.2, titulo: "P" };
  const base = { itemId: "MLB1", promocao: { id: "P1" }, precoPromo: 89.77, retornoMl: 3.3, snap, vendasPorMlb: new Map() };
  const com = montarCandidata({ ...base, vendasIndisponivel: true });
  assert.strictEqual(com.unidades, null);
  assert.strictEqual(com.receita, null);
  assert.ok(!com.motivo.includes("vendidas"));
  const sem = montarCandidata(base);
  assert.strictEqual(sem.unidades, 0, "sem indisponibilidade, 'sem venda' continua 0");
});

(async () => {
  let falhas = 0;
  for (const { nome, fn } of casos) {
    try {
      await fn();
      console.log(`  ✓ ${nome}`);
    } catch (err) {
      falhas += 1;
      console.log(`  ✗ ${nome}\n    ${err.message}\n    ${(err.stack.split("\n").find((l) => l.includes(".test.js")) || "").trim()}`);
    }
  }
  if (falhas) {
    console.log(`marginRealizadoIndisponivel: ${falhas} de ${casos.length} cenários falharam`);
    process.exit(1);
  }
  console.log(`marginRealizadoIndisponivel: ok (${casos.length} cenários)`);
})();
