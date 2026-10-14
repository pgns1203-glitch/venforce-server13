// server/tests/motorMargemCustoSuspeito.test.js
// Integridade `custo_suspeito`: custo >= preço é problema de DADO, não de preço.
// Puro — sem banco, sem ML.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/dead";

const assert = require("assert");
const C = require("../services/motorMargem/core");
const read = require("../services/motorMargem/marginSnapshotReadService");
const processor = require("../services/motorMargem/marginSnapshotProcessor");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

const PROJ = { source: C.SOURCES.MELI_API, kind: C.EVIDENCE_KINDS.PROJECTED, quality: C.EVIDENCE_QUALITY.MEASURED, observedAt: "2026-10-13T00:00:00Z" };
const BASE = { source: C.SOURCES.VENFORCE_BASE, kind: C.EVIDENCE_KINDS.PROJECTED, quality: C.EVIDENCE_QUALITY.DECLARED, observedAt: "2026-10-01T00:00:00Z" };

// Mesmo desenho do MLB4809824089: preço 100, imposto 10%, comissão 12, frete 20.
function itemComCusto(custo) {
  const bag = C.createEvidenceBag();
  bag.add(C.FIELDS.PRICE, { ...PROJ, value: 100 });
  bag.add(C.FIELDS.COMMISSION, { ...PROJ, value: 12 });
  bag.add(C.FIELDS.FREIGHT, { ...PROJ, value: 20 });
  bag.add(C.FIELDS.COST, { ...BASE, value: custo });
  bag.add(C.FIELDS.TAX_RATE, { ...BASE, value: 0.1 });
  bag.add(C.FIELDS.FIXED_FEE, { ...BASE, value: 0 });
  return C.buildMarginItem({ identity: { itemId: "MLB4809824089" }, bag, now: new Date("2026-10-14T00:00:00Z") });
}

cenario("detectIntegrityIssue: custo >= preço (inclusive igual) é custo_suspeito; abaixo não; ausente não", () => {
  assert.strictEqual(C.detectIntegrityIssue({ price: 100, cost: 171.09 }).code, "custo_suspeito");
  assert.strictEqual(C.detectIntegrityIssue({ price: 100, cost: 100 }).code, "custo_suspeito");
  assert.strictEqual(C.detectIntegrityIssue({ price: "100.00", cost: "171.09" }).code, "custo_suspeito", "colunas numeric do pg chegam como string");
  assert.strictEqual(C.detectIntegrityIssue({ price: 100, cost: 99.99 }), null);
  assert.strictEqual(C.detectIntegrityIssue({ price: 100, cost: null }), null);
  assert.strictEqual(C.detectIntegrityIssue({ price: null, cost: 50 }), null);
  assert.strictEqual(C.detectIntegrityIssue({ price: 0, cost: 50 }), null, "preço 0 é dado impossível tratado pelo núcleo, não custo suspeito");
  assert.ok(/171\.09/.test(C.detectIntegrityIssue({ price: 100, cost: 171.09 }).reason));
});

cenario("núcleo: custo 171,09 sobre preço 100 → margem −1,1309 e status SUSPECT_DATA (não LOSS) com custo_suspeito", () => {
  const item = itemComCusto(171.09);
  assert.strictEqual(item.margin.projected.margin, -1.1309);
  assert.strictEqual(item.quality.status, "SUSPECT_DATA");
  assert.strictEqual(item.quality.integrityCode, "custo_suspeito");
  assert.ok(item.quality.statusReasons[0].includes("Custo"), item.quality.statusReasons[0]);
});

cenario("núcleo: custo abaixo do preço com margem negativa continua LOSS, sem integridade", () => {
  // 100 − 10 − 12 − 20 − 85 = −27 → margem −0,27 com custo < preço
  const item = itemComCusto(85);
  assert.strictEqual(item.margin.projected.margin, -0.27);
  assert.strictEqual(item.quality.status, "LOSS");
  assert.strictEqual(item.quality.integrityCode, null);
});

cenario("snapshot gravado: o processador persiste integrityCode em quality", () => {
  const linha = processor.mapItemParaSnapshot({
    item: itemComCusto(171.09),
    run: { id: 1, clienteId: 1, clienteContaId: 9, marketplace: "meli" },
    base: null,
    observedAt: "2026-10-14T00:00:00Z",
  });
  assert.strictEqual(linha.status, "SUSPECT_DATA");
  assert.strictEqual(linha.quality.integrityCode, "custo_suspeito");
  assert.strictEqual(linha.margin, -1.1309);
});

function linhaAntiga(custo) {
  return {
    itemId: "MLB4809824089", sku: "S", titulo: "P", marketplace: "meli", imageUrl: null,
    // `numeric` do pg chega como string
    price: "100.00", cost: String(custo),
    profit: -113.09, margin: -1.1309, marginPercent: -113.09, status: "LOSS", confidenceLevel: "HIGH",
    assumed: [], missing: [], refreshStatus: "fresh", calculatedAt: "2026-10-13T06:00:00Z", observedAt: "2026-10-13T06:00:00Z", runId: 7,
    quality: { targetMargin: 0.1, statusReasons: ["Margem negativa (-113.09%)."], evidencias: {} },
  };
}
const SEM_VENDAS = { porMlb: new Map(), reembolsoPorMlb: new Map(), fallbackObservedAt: null };

cenario("leitura: linha calculada ANTES da regra (status LOSS) já expõe custo_suspeito, sem reprocessar", () => {
  const item = read.comporItem(linhaAntiga(171.09), SEM_VENDAS);
  assert.strictEqual(item.quality.integrityCode, "custo_suspeito");
  assert.strictEqual(item.problema, item.quality.integrityReason);
  assert.strictEqual(item.projected.margin, -1.1309, "margem do snapshot intacta");
  assert.strictEqual(item.status, "LOSS", "o status persistido só muda no próximo cálculo");
});

cenario("leitura: linha com custo abaixo do preço não ganha integridade", () => {
  const item = read.comporItem(linhaAntiga(40), SEM_VENDAS);
  assert.strictEqual(item.quality.integrityCode, null);
  assert.strictEqual(item.problema, "Margem negativa (-113.09%).");
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
    console.log(`motorMargemCustoSuspeito: ${falhas} de ${casos.length} cenários falharam`);
    process.exit(1);
  }
  console.log(`motorMargemCustoSuspeito: ok (${casos.length} cenários)`);
})();
