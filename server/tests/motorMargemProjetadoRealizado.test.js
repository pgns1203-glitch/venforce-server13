// server/tests/motorMargemProjetadoRealizado.test.js
// Contrato PROJETADO × REALIZADO (core/marginComparison) no Motor ao vivo
// (buildMarginItem) e na leitura por snapshot (comporItem). Puro — sem
// banco, sem ML.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/dead";

const assert = require("assert");
const C = require("../services/motorMargem/core");
const cv = require("../services/motorMargem/adapters/centralVendasEvidenceAdapter");
const read = require("../services/motorMargem/marginSnapshotReadService");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

const PROJ = { source: C.SOURCES.MELI_API, kind: C.EVIDENCE_KINDS.PROJECTED, quality: C.EVIDENCE_QUALITY.MEASURED, observedAt: "2026-09-27T00:00:00Z" };
const BASE_PROJ = { source: C.SOURCES.VENFORCE_BASE, kind: C.EVIDENCE_KINDS.PROJECTED, quality: C.EVIDENCE_QUALITY.DECLARED, observedAt: "2026-06-01T00:00:00Z" };
const REAL = { source: C.SOURCES.MELI_ORDER, kind: C.EVIDENCE_KINDS.REALIZED, quality: C.EVIDENCE_QUALITY.DERIVED, observedAt: "2026-09-20T00:00:00Z" };
const BASE_REAL = { source: C.SOURCES.VENFORCE_BASE, kind: C.EVIDENCE_KINDS.REALIZED, quality: C.EVIDENCE_QUALITY.DECLARED, observedAt: "2026-09-20T00:00:00Z" };

// Exemplo conceitual do prompt da rodada: Produto X.
function bagProdutoX({ comVenda = true, custoRealizado = true } = {}) {
  const bag = C.createEvidenceBag();
  bag.add(C.FIELDS.PRICE, { ...PROJ, value: 100 });
  bag.add(C.FIELDS.COMMISSION, { ...PROJ, value: 16 });
  bag.add(C.FIELDS.FREIGHT, { ...PROJ, value: 18 });
  bag.add(C.FIELDS.COST, { ...BASE_PROJ, value: 45 });
  bag.add(C.FIELDS.TAX_RATE, { ...BASE_PROJ, value: 0.03 });
  bag.add(C.FIELDS.FIXED_FEE, { ...BASE_PROJ, value: 2 });
  if (comVenda) {
    bag.add(C.FIELDS.PRICE, { ...REAL, value: 96.4 });
    bag.add(C.FIELDS.COMMISSION, { ...REAL, value: 16.8 });
    bag.add(C.FIELDS.FREIGHT, { ...REAL, value: 21.3 });
    if (custoRealizado) bag.add(C.FIELDS.COST, { ...BASE_REAL, value: 44.5 });
    bag.add(C.FIELDS.TAX_RATE, { ...BASE_REAL, value: 0.03 });
  }
  return bag;
}

function itemProdutoX(opts = {}) {
  const comVenda = opts.comVenda !== false;
  return C.buildMarginItem({
    identity: { itemId: "MLBX" },
    bag: bagProdutoX(opts),
    sales: comVenda
      ? { hasOrders: true, unidades: 73, pedidos: 62, receita: 7037.2, ultimaVendaEm: "2026-09-20", cobertura: { comissao: { fracao: 1 } } }
      : { hasOrders: false },
    now: new Date("2026-09-28T00:00:00Z"),
  });
}

// ═══════════════════════════════════════════════════════════════════════════

cenario("golden (Produto X): projetado, realizado, unidades/pedidos/receita e desvio por componente", () => {
  const item = itemProdutoX();
  const cmp = item.projectedVsRealized;
  assert.strictEqual(cmp.status, C.COMPARISON_STATUS.COMPARABLE);

  // Projetado: 100 − 3 − 16 − 18 − 2 − 45 = 16 → 16%
  assert.strictEqual(cmp.projected.price, 100);
  assert.strictEqual(cmp.projected.fixedFee, 2);
  assert.strictEqual(cmp.projected.profit, 16);
  assert.strictEqual(cmp.projected.marginPercent, 16);

  // Realizado: 96,40 − 2,892 − 16,80 − 21,30 − 44,50 (sem taxa fixa) = 10,908
  assert.strictEqual(cmp.realized.price, 96.4);
  assert.strictEqual(cmp.realized.fixedFee, null, "taxa fixa sem histórico, nunca a atual");
  assert.strictEqual(cmp.realized.profit, 10.91);
  assert.strictEqual(cmp.realized.marginPercent, 11.32);
  assert.deepStrictEqual(
    { u: cmp.realized.units, o: cmp.realized.orders, r: cmp.realized.revenue, l: cmp.realized.lastSaleAt },
    { u: 73, o: 62, r: 7037.2, l: "2026-09-20" }
  );
  assert.strictEqual(cmp.realized.totalProfit, 796.43, "10,91 × 73");
  assert.deepStrictEqual(cmp.realized.coverage, { comissao: { fracao: 1 } });

  // Desvio = realizado − projetado.
  assert.strictEqual(cmp.drift.price, -3.6);
  assert.strictEqual(cmp.drift.commission, 0.8);
  assert.strictEqual(cmp.drift.freight, 3.3);
  assert.strictEqual(cmp.drift.cost, -0.5);
  assert.strictEqual(cmp.drift.taxRate, 0);
  assert.strictEqual(cmp.drift.profit, -5.09);
  assert.strictEqual(cmp.drift.marginPercentagePoints, -4.68);
  assert.strictEqual(cmp.drift.fixedFee, null);
  assert.deepStrictEqual(cmp.notComparable, [{ field: "fixedFee", reason: "SEM_HISTORICO", projectedValue: 2 }]);

  // Coerente com o erro de projeção que o item já expunha.
  assert.strictEqual(item.margin.projectionError.deltaPp, cmp.drift.marginPercentagePoints);
});

cenario("sem venda no período: NO_SALES, realizado indisponível e desvio null (nunca zero)", () => {
  const cmp = itemProdutoX({ comVenda: false }).projectedVsRealized;
  assert.strictEqual(cmp.status, C.COMPARISON_STATUS.NO_SALES);
  assert.strictEqual(cmp.realized.available, false);
  assert.strictEqual(cmp.realized.price, null);
  assert.strictEqual(cmp.realized.units, null);
  assert.strictEqual(cmp.drift, null);
  assert.deepStrictEqual(cmp.notComparable, []);
  assert.strictEqual(cmp.projected.marginPercent, 16, "o projetado continua disponível");
});

cenario("venda sem custo histórico: REALIZED_NOT_COMPUTABLE, desvio de custo e de margem null", () => {
  const cmp = itemProdutoX({ custoRealizado: false }).projectedVsRealized;
  assert.strictEqual(cmp.status, C.COMPARISON_STATUS.REALIZED_NOT_COMPUTABLE);
  assert.strictEqual(cmp.realized.available, true, "houve venda");
  assert.strictEqual(cmp.realized.cost, null);
  assert.strictEqual(cmp.realized.profit, null);
  assert.deepStrictEqual(cmp.realized.missing, ["cost"]);
  assert.strictEqual(cmp.drift.cost, null, "lado ausente nunca vira 0");
  assert.strictEqual(cmp.drift.marginPercentagePoints, null);
  assert.strictEqual(cmp.drift.price, -3.6, "componentes presentes continuam comparáveis");
});

cenario("projetado não calculável (sem custo na Base): PROJECTED_NOT_COMPUTABLE", () => {
  const bag = C.createEvidenceBag();
  bag.add(C.FIELDS.PRICE, { ...PROJ, value: 100 });
  bag.add(C.FIELDS.PRICE, { ...REAL, value: 100 });
  bag.add(C.FIELDS.COST, { ...BASE_REAL, value: 40 });
  const item = C.buildMarginItem({ identity: { itemId: "MLBY" }, bag, sales: { hasOrders: true, unidades: 1, pedidos: 1 } });
  const cmp = item.projectedVsRealized;
  assert.strictEqual(cmp.status, C.COMPARISON_STATUS.PROJECTED_NOT_COMPUTABLE);
  assert.strictEqual(cmp.projected.margin, null);
  assert.strictEqual(cmp.realized.computable, true);
  assert.strictEqual(cmp.drift.marginPercentagePoints, null);
  assert.strictEqual(cmp.drift.cost, null);
});

cenario("componentes assumidos ficam declarados nos dois lados (nunca zero silencioso)", () => {
  const bag = C.createEvidenceBag();
  bag.add(C.FIELDS.PRICE, { ...PROJ, value: 50 });
  bag.add(C.FIELDS.COST, { ...BASE_PROJ, value: 20 });
  bag.add(C.FIELDS.PRICE, { ...REAL, value: 50 });
  bag.add(C.FIELDS.COST, { ...BASE_REAL, value: 20 });
  const cmp = C.buildMarginItem({ identity: {}, bag, sales: { hasOrders: true, unidades: 2, pedidos: 1 } }).projectedVsRealized;
  assert.deepStrictEqual(cmp.projected.assumed.sort(), ["commission", "fixedFee", "freight", "taxRate"]);
  assert.deepStrictEqual(cmp.realized.assumed.sort(), ["commission", "fixedFee", "freight", "taxRate"]);
  assert.strictEqual(cmp.drift.commission, null);
  assert.strictEqual(cmp.drift.freight, null);
});

// ── Leitura por snapshot (comporItem) ────────────────────────────────────────

function linhaSnapshot() {
  return {
    itemId: "MLB1", sku: "SKU-1", titulo: "Produto 1", marketplace: "meli", imageUrl: null,
    profit: 16, margin: 0.16, marginPercent: 16, status: "HEALTHY", confidenceLevel: "HIGH",
    assumed: [], missing: [], refreshStatus: "fresh", calculatedAt: "2026-09-27T06:00:00Z", observedAt: "2026-09-27T06:00:00Z", runId: 7,
    quality: {
      targetMargin: 0.1, statusAnuncio: "active",
      evidencias: {
        price: [{ source: "MELI_API", value: 100, quality: "MEASURED", observedAt: "2026-09-27T06:00:00Z" }],
        commission: [{ source: "MELI_API", value: 16, quality: "MEASURED", observedAt: "2026-09-27T06:00:00Z" }],
        freight: [{ source: "MELI_API", value: 18, quality: "MEASURED", observedAt: "2026-09-27T06:00:00Z" }],
        cost: [{ source: "VENFORCE_BASE", value: 45, quality: "DECLARED", observedAt: "2026-06-01T00:00:00Z" }],
        taxRate: [{ source: "VENFORCE_BASE", value: 0.03, quality: "DECLARED", observedAt: "2026-06-01T00:00:00Z" }],
        fixedFee: [{ source: "VENFORCE_BASE", value: 2, quality: "DECLARED", observedAt: "2026-06-01T00:00:00Z" }],
      },
    },
  };
}

function realizadaDe({ pedidos, itens, componentes }) {
  const resultado = pedidos.filter((p) => p.status !== "cancelled");
  const agg = cv.agregarPorMlb({ pedidosTodos: pedidos, pedidosResultado: resultado, itens, componentes });
  return { porMlb: agg.porMlb, reembolsoPorMlb: agg.reembolsoPorMlb, fallbackObservedAt: null };
}

cenario("snapshot: item traz projectedVsRealized, projectionError, cobertura, reembolso e contraprova", () => {
  const pedidos = [
    { id: 1, status: "paid", data_pedido: "2026-09-10" },
    { id: 2, status: "paid", data_pedido: "2026-09-12" },
  ];
  const itens = [
    { id: 11, pedido_row_id: 1, mlb: "MLB1", quantidade: 1, valor_unitario: 96, receita_produto: 96, custo_produto: 44, imposto_interno: 2.88, resultado: 12 },
    { id: 12, pedido_row_id: 2, mlb: "MLB1", quantidade: 1, valor_unitario: 98, receita_produto: 98, custo_produto: 45, imposto_interno: 2.94, resultado: 11 },
  ];
  const componentes = [
    { item_row_id: 11, pedido_row_id: 1, tipo: "tarifa_venda", valor: -16 },
    { item_row_id: 12, pedido_row_id: 2, tipo: "tarifa_venda", valor: -17 },
    { item_row_id: 11, pedido_row_id: 1, tipo: "frete_seller", valor: -20 },
    { item_row_id: 12, pedido_row_id: 2, tipo: "frete_seller", valor: null },
    { item_row_id: null, pedido_row_id: 2, tipo: "cancelamento_reembolso", valor: -5 },
  ];
  const item = read.comporItem(linhaSnapshot(), realizadaDe({ pedidos, itens, componentes }));
  const cmp = item.projectedVsRealized;

  assert.strictEqual(cmp.status, "COMPARABLE");
  assert.strictEqual(cmp.projected.profit, 16, "projetado = linha do snapshot, sem recálculo");
  assert.strictEqual(cmp.realized.price, 97, "(96 + 98) / 2");
  assert.strictEqual(cmp.realized.freight, 20, "frete só da unidade com frete");
  assert.strictEqual(cmp.realized.coverage.frete.fracao, 0.5);
  assert.strictEqual(cmp.realized.coverage.frete.completa, false);
  assert.strictEqual(cmp.drift.price, -3);
  assert.strictEqual(cmp.drift.freight, 2);
  assert.strictEqual(item.margin.projectionError.deltaPp, cmp.drift.marginPercentagePoints);

  assert.strictEqual(item.sales.precoMedio, 97);
  assert.strictEqual(item.sales.resultadoPersistido, 23);
  assert.ok(item.sales.resultadoRecalculado !== null);
  assert.deepStrictEqual(item.sales.reembolso, { total: 5, pedidos: 1 });
  assert.strictEqual(item.sales.cobertura.comissao.completa, true);
  // Compat: campos que o frontend já lê continuam iguais.
  assert.strictEqual(item.projected.margin, 0.16);
  assert.strictEqual(item.realized.pending, false);
});

cenario("snapshot: produto sem venda no período → NO_SALES, sales vazio e nada vira zero", () => {
  const item = read.comporItem(linhaSnapshot(), realizadaDe({ pedidos: [], itens: [], componentes: [] }));
  assert.strictEqual(item.projectedVsRealized.status, "NO_SALES");
  assert.strictEqual(item.projectedVsRealized.drift, null);
  assert.strictEqual(item.sales.unidades, null);
  assert.strictEqual(item.sales.cobertura, null);
  assert.strictEqual(item.sales.reembolso, null);
  assert.strictEqual(item.margin.projectionError.comparable, false);
});

(async () => {
  let falhas = 0;
  for (const { nome, fn } of casos) {
    try {
      await fn();
      console.log(`  ✓ ${nome}`);
    } catch (err) {
      falhas += 1;
      console.log(`  ✗ ${nome}\n    ${err.message}`);
    }
  }
  if (falhas) {
    console.log(`motorMargemProjetadoRealizado: ${falhas} de ${casos.length} cenários falharam`);
    process.exit(1);
  }
  console.log(`motorMargemProjetadoRealizado: ok (${casos.length} cenários)`);
})();
