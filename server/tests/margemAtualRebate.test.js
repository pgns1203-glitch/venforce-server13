// server/tests/margemAtualRebate.test.js
// Margem ATUAL de anúncio em promoção com retorno ML (rebate): o preço atual já
// é o promocional, mas o snapshot calcula a margem sem o retorno. A correção é
// na LEITURA e é a mesma na tabela, no drawer (mesmo item) e nas Oportunidades.
// Sem banco real, sem ML.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/dead";

const assert = require("assert");
const core = require("../services/motorMargem/core");
const read = require("../services/motorMargem/marginSnapshotReadService");
const { margemAtualComRebate, carregarRebatesAtivos, MOTIVO_REBATE } = require("../services/motorMargem/margemAtualRebate");
const promoRepo = require("../services/promoSnapshot/promoSnapshotRepository");
const { listarOportunidades } = require("../services/motorMargem/precificacao/precificacaoOportunidadesService");
const { paginaReferencia, lerParametrosPagina } = require("./helpers/oportunidadesReferencia");
const snapshotRepository = require("../services/motorMargem/marginSnapshotRepository");
const runRepository = require("../services/motorMargem/marginSnapshotRunRepository");
const runService = require("../services/motorMargem/marginSnapshotRunService");
const { makeMarginSnapshotFakeDb } = require("./helpers/marginSnapshotFakeDb");
const { clienteContaServiceFake } = require("./helpers/marginSnapshotContasFake");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

// Caso da rodada: preço atual (promocional) 89,77, retorno ML 3,30.
const INSUMOS = { price: 89.77, cost: 40, taxRate: 0.1, fixedFee: 0, commission: 12.1, freight: 15 };
const SEM_REBATE = core.computeMargin(INSUMOS);
const COM_REBATE = core.computeMargin({ ...INSUMOS, rebate: 3.3 });

function linha() {
  return {
    itemId: "MLB1", sku: "S", titulo: "P", marketplace: "meli", imageUrl: null,
    ...INSUMOS, profit: SEM_REBATE.profit, margin: SEM_REBATE.margin, marginPercent: Math.round(SEM_REBATE.margin * 10000) / 100,
    status: "HEALTHY", confidenceLevel: "HIGH", assumed: [], missing: [], refreshStatus: "fresh",
    calculatedAt: "2026-10-13T06:00:00Z", observedAt: "2026-10-13T06:00:00Z", runId: 7,
    quality: { targetMargin: 0.1, evidencias: {} },
  };
}
const SEM_VENDAS = { porMlb: new Map(), reembolsoPorMlb: new Map(), fallbackObservedAt: null };

cenario("a premissa: o rebate muda a margem (3,30 sobre 89,77) — senão o teste não prova nada", () => {
  assert.ok(COM_REBATE.margin > SEM_REBATE.margin);
  assert.ok(Math.abs(COM_REBATE.profit - SEM_REBATE.profit - 3.3) < 0.011);
});

cenario("margemAtualComRebate: uma promoção com retorno → margem pelo MESMO motor, rebate exposto", () => {
  const r = margemAtualComRebate(linha(), { promocoes: 1, rebate: 3.3 });
  assert.strictEqual(r.margin, COM_REBATE.margin);
  assert.strictEqual(r.profit, COM_REBATE.profit);
  assert.strictEqual(r.rebate, 3.3);
  assert.strictEqual(r.rebateMotivo, null);
});

cenario("sem promoção em andamento: margem do snapshot, intacta", () => {
  for (const info of [undefined, null]) {
    const r = margemAtualComRebate(linha(), info);
    assert.strictEqual(r.margin, SEM_REBATE.margin);
    assert.strictEqual(r.rebate, null);
    assert.strictEqual(r.rebateMotivo, null);
  }
});

cenario("duas promoções em andamento com retorno: ambíguo — não soma nem escolhe, e diz por quê", () => {
  const r = margemAtualComRebate(linha(), { promocoes: 2, rebate: null });
  assert.strictEqual(r.margin, SEM_REBATE.margin);
  assert.strictEqual(r.rebate, null);
  assert.strictEqual(r.rebateMotivo, MOTIVO_REBATE.AMBIGUO);
});

cenario("Promo Snapshot ilegível: margem do snapshot + motivo; a falha vai ao log e não derruba a leitura", async () => {
  const logs = [];
  const repo = { mapRebatesAtivosPorItem: async () => { throw new Error("db fora (access_token=APP_USR-9)"); } };
  const r = await carregarRebatesAtivos({ clienteContaId: 5, sellerId: "555", itemIds: ["MLB1"], db: {}, promoRepo: repo, logger: { error: (l) => logs.push(l) } });
  assert.strictEqual(r.indisponivel, MOTIVO_REBATE.PROMO_SNAPSHOT_INDISPONIVEL);
  assert.ok(logs.length === 1 && !logs[0].includes("APP_USR-9"), logs[0]);
  const m = margemAtualComRebate(linha(), undefined, r.indisponivel);
  assert.strictEqual(m.margin, SEM_REBATE.margin);
  assert.strictEqual(m.rebateMotivo, MOTIVO_REBATE.PROMO_SNAPSHOT_INDISPONIVEL);
  // Tabela inexistente (conta nunca teve Promo Snapshot) não é falha.
  const semTabela = await carregarRebatesAtivos({ clienteContaId: 5, sellerId: "555", itemIds: ["MLB1"], db: {}, promoRepo: { mapRebatesAtivosPorItem: async () => { const e = new Error("x"); e.code = "42P01"; throw e; } } });
  assert.strictEqual(semTabela.indisponivel, null);
  assert.strictEqual(semTabela.porItem.size, 0);
});

cenario("repositório: UMA consulta para o lote, só started/active com subsídio > 0, só do snapshot atual da conta+seller", async () => {
  const chamadas = [];
  const db = { query: async (sql, params) => { chamadas.push({ sql, params }); return { rows: [{ item_id: "MLB1", promocoes: 1, subsidio: "3.30" }, { item_id: "MLB2", promocoes: 2, subsidio: "5.00" }] }; } };
  const mapa = await promoRepo.mapRebatesAtivosPorItem({ clienteContaId: 5, sellerId: "555", itemIds: ["MLB1", "MLB1", "MLB2", "MLB3"] }, db);
  assert.strictEqual(chamadas.length, 1);
  assert.ok(/current_run_id/.test(chamadas[0].sql) && /IN \('started', 'active'\)/.test(chamadas[0].sql) && /subsidio_ml > 0/.test(chamadas[0].sql));
  assert.deepStrictEqual(chamadas[0].params, [5, "meli", "555", ["MLB1", "MLB2", "MLB3"]]);
  assert.deepStrictEqual(mapa.get("MLB1"), { promocoes: 1, rebate: 3.3 });
  assert.deepStrictEqual(mapa.get("MLB2"), { promocoes: 2, rebate: null }, "2 promoções = ambíguo");
  assert.strictEqual((await promoRepo.mapRebatesAtivosPorItem({ clienteContaId: 5, sellerId: null, itemIds: ["MLB1"] }, db)).size, 0, "sem seller não consulta");
  assert.strictEqual(chamadas.length, 1);
});

// ── Os TRÊS pontos mostram a mesma margem atual ──────────────────────────────

cenario("promo started com subsídio 3,30: tabela, drawer e Oportunidades têm a MESMA margem atual, com o rebate", async () => {
  // 1) Tabela e drawer: o drawer lê o mesmo item.projected da tabela.
  const item = read.comporItem(linha(), SEM_VENDAS, {}, { promocoes: 1, rebate: 3.3 });
  assert.strictEqual(item.projected.margin, COM_REBATE.margin, "tabela/drawer");
  assert.strictEqual(item.margin.projected.margin, COM_REBATE.margin);
  assert.strictEqual(item.projected.rebate, 3.3);
  assert.notStrictEqual(item.projected.margin, SEM_REBATE.margin);
  // O painel Projetado × Realizado segue com a margem persistida (compara componentes, que não têm rebate).
  assert.strictEqual(item.projectedVsRealized.projected.margin, SEM_REBATE.margin);

  // 2) Oportunidades: a MESMA função, com a mesma promoção em andamento.
  const snapRow = { item_id: "MLB1", titulo: "P", image_url: null, price: 89.77, cost: 40, tax_rate: 0.1, fixed_fee: 0, commission_rate: 0.12, freight: 15, margin: SEM_REBATE.margin, commission: 12.1, profit: SEM_REBATE.profit };
  const db = {
    queries: [],
    async query(sql, params) {
      this.queries.push(sql);
      if (/FROM promocoes_diagnosticos\b/.test(sql)) return { rows: [{ id: 11, created_at: new Date().toISOString(), parcial: false, itens_scaneados: 1 }] };
      if (/FROM promo_snapshot_contas c/.test(sql)) return { rows: [{ item_id: "MLB1", promocoes: 1, subsidio: "3.30" }] };
      if (/WITH promos AS/.test(sql)) {
        const { vendasPorMlb, page, limit } = lerParametrosPagina(params, 1);
        // Candidata: outra promoção, ainda não ativa, com preço menor que o atual (89,77).
        const promos = [{ item_id: "MLB1", chave: "000001", preco_promo: 80, retorno: 0, promo_status: "candidate", promo_id: "P2" }];
        return paginaReferencia({ promos, snapPorItem: new Map([["MLB1", snapRow]]), vendasPorMlb, page, limit });
      }
      throw new Error("SQL inesperado: " + sql);
    },
  };
  const deps = {
    db,
    resolverContaDoCliente: async () => ({ cliente: { id: 3, slug: "loja-a" }, conta: { id: 7, nome: "Conta A" } }),
    obterConta: async () => ({ id: 7, external_account_id: "555" }),
    carregarRealizada: async () => ({ porMlb: new Map(), periodo: { dateFrom: "2026-08-31", dateTo: "2026-09-29" } }),
    now: () => new Date(),
    promo: {
      estadoComAutoTrigger: async () => ({ estado: { state: "never_synced", hasSnapshot: false, workerEnabled: false }, gatilho: { acao: "worker_desabilitado" } }),
      syncPublico: (e) => e,
    },
  };
  const r = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7 }, deps);
  assert.strictEqual(r.oportunidades.length, 1);
  assert.strictEqual(r.oportunidades[0].margemAtual, COM_REBATE.margin, "Oportunidades");
  assert.strictEqual(r.oportunidades[0].margemAtual, item.projected.margin, "mesma margem atual nos três pontos");
  assert.strictEqual(r.oportunidades[0].margemAtualRebate, 3.3);
});

cenario("listarItens (a tabela de verdade): rebate lido em UMA consulta para a página e somado só no anúncio com promoção em andamento", async () => {
  const db = makeMarginSnapshotFakeDb();
  const base = { clienteId: 1, clienteContaId: 5, marketplace: "meli", baseId: 9, confidenceLevel: "HIGH", quality: {}, missing: [], assumed: [], divergences: [],
    observedAt: new Date("2026-10-13T06:00:00Z"), calculatedAt: new Date("2026-10-13T06:00:05Z"), runId: 1, refreshStatus: "fresh", lastError: null, status: "HEALTHY" };
  const mk = (itemId) => ({ ...base, itemId, sku: itemId, titulo: itemId, ...INSUMOS, profit: SEM_REBATE.profit, margin: SEM_REBATE.margin, marginPercent: Math.round(SEM_REBATE.margin * 10000) / 100 });
  await snapshotRepository.upsertProjectionSnapshot(mk("MLB1"), db);
  await snapshotRepository.upsertProjectionSnapshot(mk("MLB2"), db);
  const { run } = await runService.enqueueMarginSnapshotRun({ clienteId: 1, clienteSlug: "loja-a", clienteContaId: 5, reason: "manual_refresh", db });
  await runRepository.updateRunStatus({ runId: run.id, status: "running", db });
  await runRepository.updateRunStatus({ runId: run.id, status: "completed", db });

  const consultas = [];
  const deps = {
    db,
    env: { MARGIN_SNAPSHOT_READ_ENABLED: "true" },
    now: new Date("2026-09-28T15:00:00Z"),
    clienteContaService: { ...clienteContaServiceFake, obterConta: async (id) => ({ ...(await clienteContaServiceFake.obterConta(id)), external_account_id: "555" }) },
    contarContasAtivas: async () => 2,
    carregarVendas: async () => ({ sincronizado: true, pedidos: [], pedidosTodos: [], itens: [], componentes: [], imports: [{ id: 1 }], competencias: [] }),
    promoRepository: {
      mapRebatesAtivosPorItem: async (args) => { consultas.push(args); return new Map([["MLB1", { promocoes: 1, rebate: 3.3 }]]); },
    },
  };
  const r = await read.listarItens({ clienteSlug: "loja-a", clienteContaId: 5 }, deps);
  assert.strictEqual(consultas.length, 1, "UMA consulta de rebates para a página inteira");
  assert.deepStrictEqual([consultas[0].clienteContaId, consultas[0].sellerId], [5, "555"]);
  assert.deepStrictEqual(consultas[0].itemIds.slice().sort(), ["MLB1", "MLB2"]);
  const porId = Object.fromEntries(r.itens.map((i) => [i.itemId, i]));
  assert.strictEqual(porId.MLB1.projected.margin, COM_REBATE.margin, "em promoção com retorno: margem atual inclui o rebate");
  assert.strictEqual(porId.MLB1.projected.rebate, 3.3);
  assert.strictEqual(porId.MLB2.projected.margin, SEM_REBATE.margin, "sem promoção: margem do snapshot");
  assert.strictEqual(porId.MLB2.projected.rebate, null);
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
    console.log(`margemAtualRebate: ${falhas} de ${casos.length} cenários falharam`);
    process.exit(1);
  }
  console.log(`margemAtualRebate: ok (${casos.length} cenários)`);
})();
