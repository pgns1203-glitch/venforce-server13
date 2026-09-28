// server/tests/marginSnapshotRepository.test.js
// M1 da fundação de Margin Snapshot — repository de
// margin_projection_snapshots. Roda 100% contra fake db em memória
// (tests/helpers/marginSnapshotFakeDb.js), sem Postgres real, conforme
// exigido pelo prompt de M1 (§4/§12).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const repo = require("../services/motorMargem/marginSnapshotRepository");
const { makeMarginSnapshotFakeDb } = require("./helpers/marginSnapshotFakeDb");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

function novoDb() {
  return makeMarginSnapshotFakeDb();
}

function snapshotBase(overrides = {}) {
  return {
    clienteId: 1, clienteContaId: 5, marketplace: "meli", itemId: "MLB111",
    sku: "SKU-1", titulo: "Produto 1", baseId: 9,
    price: 100, listPrice: 120, promoPrice: null, cost: 40, taxRate: 0.1, fixedFee: 0,
    commission: 12, commissionRate: 0.12, freight: 20,
    profit: 28, margin: 0.28, marginPercent: 28, status: "HEALTHY",
    confidenceLevel: "HIGH", quality: { price: "MEASURED" }, missing: [], assumed: [], divergences: [],
    observedAt: new Date("2026-09-25T10:00:00Z"), calculatedAt: new Date("2026-09-25T10:00:05Z"), sourceUpdatedAt: null,
    runId: 1, refreshStatus: "fresh", lastError: null,
    ...overrides,
  };
}

// ── bootstrap ─────────────────────────────────────────────────────────────

cenario("ensureMarginSnapshotTables lê server/sql/margin_snapshot_schema.sql sem lançar erro", async () => {
  const db = novoDb();
  await repo.ensureMarginSnapshotTables(db);
});

// ── 1. cria snapshot ─────────────────────────────────────────────────────

cenario("upsertProjectionSnapshot cria uma linha nova quando não existe snapshot para conta+item", async () => {
  const db = novoDb();
  const salvo = await repo.upsertProjectionSnapshot(snapshotBase(), db);

  assert.strictEqual(salvo.clienteContaId, 5);
  assert.strictEqual(salvo.itemId, "MLB111");
  assert.strictEqual(salvo.status, "HEALTHY");
  assert.strictEqual(salvo.margin, 0.28);
  assert.strictEqual(salvo.marginPercent, 28);
  assert.strictEqual(db.snapshots.length, 1);
});

cenario("upsertProjectionSnapshot exige clienteId, clienteContaId, itemId e status", async () => {
  const db = novoDb();
  await assert.rejects(() => repo.upsertProjectionSnapshot(snapshotBase({ clienteId: undefined }), db), /clienteId/);
  await assert.rejects(() => repo.upsertProjectionSnapshot(snapshotBase({ clienteContaId: undefined }), db), /clienteContaId/);
  await assert.rejects(() => repo.upsertProjectionSnapshot(snapshotBase({ itemId: undefined }), db), /itemId/);
  await assert.rejects(() => repo.upsertProjectionSnapshot(snapshotBase({ status: undefined }), db), /status/);
});

// ── 2/11. upsert idempotente: conta 6 + MLB X -> upsert A -> upsert B -> 1 linha final ──

cenario("upsertProjectionSnapshot processado duas vezes atualiza a MESMA linha, nunca duplica", async () => {
  const db = novoDb();

  await repo.upsertProjectionSnapshot(snapshotBase({ clienteContaId: 6, itemId: "MLBX", price: 100, status: "HEALTHY" }), db);
  const segundo = await repo.upsertProjectionSnapshot(snapshotBase({ clienteContaId: 6, itemId: "MLBX", price: 150, status: "LOW_MARGIN" }), db);

  assert.strictEqual(db.snapshots.length, 1, "conta 6 + MLBX processado 2x precisa resultar em 1 única linha");
  assert.strictEqual(segundo.price, 150, "o upsert mais recente prevalece");
  assert.strictEqual(segundo.status, "LOW_MARGIN");

  const lido = await repo.getProjectionSnapshot({ clienteContaId: 6, itemId: "MLBX", db });
  assert.strictEqual(lido.price, 150);
});

// ── 3/12. isolamento multi-conta (P0) ────────────────────────────────────

cenario("cliente A com conta 5 e conta 6, MESMO MLB nas duas contas: são 2 snapshots distintos", async () => {
  const db = novoDb();
  await repo.upsertProjectionSnapshot(snapshotBase({ clienteId: 1, clienteContaId: 5, itemId: "MLB123", price: 100 }), db);
  await repo.upsertProjectionSnapshot(snapshotBase({ clienteId: 1, clienteContaId: 6, itemId: "MLB123", price: 200 }), db);

  assert.strictEqual(db.snapshots.length, 2, "mesmo MLB em 2 contas do mesmo cliente precisa gerar 2 linhas");

  const daConta5 = await repo.getProjectionSnapshot({ clienteContaId: 5, itemId: "MLB123", db });
  const daConta6 = await repo.getProjectionSnapshot({ clienteContaId: 6, itemId: "MLB123", db });
  assert.strictEqual(daConta5.price, 100);
  assert.strictEqual(daConta6.price, 200);
});

cenario("getProjectionSnapshot da conta 6 NUNCA devolve o snapshot da conta 5 (mesmo item_id)", async () => {
  const db = novoDb();
  await repo.upsertProjectionSnapshot(snapshotBase({ clienteId: 1, clienteContaId: 5, itemId: "MLB123" }), db);

  const consultaContaErrada = await repo.getProjectionSnapshot({ clienteContaId: 6, itemId: "MLB123", db });
  assert.strictEqual(consultaContaErrada, null, "conta 6 nunca pode ler o snapshot da conta 5");
});

cenario("listProjectionSnapshots filtra por conta — conta 6 nunca vê linhas da conta 5", async () => {
  const db = novoDb();
  await repo.upsertProjectionSnapshot(snapshotBase({ clienteContaId: 5, itemId: "MLB_A" }), db);
  await repo.upsertProjectionSnapshot(snapshotBase({ clienteContaId: 5, itemId: "MLB_B" }), db);
  await repo.upsertProjectionSnapshot(snapshotBase({ clienteContaId: 6, itemId: "MLB_C" }), db);

  const daConta5 = await repo.listProjectionSnapshots({ clienteContaId: 5, db });
  const daConta6 = await repo.listProjectionSnapshots({ clienteContaId: 6, db });

  assert.strictEqual(daConta5.length, 2);
  assert.strictEqual(daConta6.length, 1);
  assert.ok(daConta5.every((s) => s.clienteContaId === 5));
  assert.ok(daConta6.every((s) => s.clienteContaId === 6));
});

// ── 4. marketplace participa do escopo ───────────────────────────────────

cenario("mesmo item_id em marketplaces diferentes (mesma conta) são snapshots distintos", async () => {
  const db = novoDb();
  await repo.upsertProjectionSnapshot(snapshotBase({ clienteContaId: 5, marketplace: "meli", itemId: "ITEM1", price: 100 }), db);
  await repo.upsertProjectionSnapshot(snapshotBase({ clienteContaId: 5, marketplace: "shopee", itemId: "ITEM1", price: 200 }), db);

  assert.strictEqual(db.snapshots.length, 2);
  const doMeli = await repo.getProjectionSnapshot({ clienteContaId: 5, marketplace: "meli", itemId: "ITEM1", db });
  const doShopee = await repo.getProjectionSnapshot({ clienteContaId: 5, marketplace: "shopee", itemId: "ITEM1", db });
  assert.strictEqual(doMeli.price, 100);
  assert.strictEqual(doShopee.price, 200);
});

// ── 5. item_id participa da identidade ───────────────────────────────────

cenario("dois item_id diferentes na mesma conta nunca colidem", async () => {
  const db = novoDb();
  await repo.upsertProjectionSnapshot(snapshotBase({ clienteContaId: 5, itemId: "MLB1" }), db);
  await repo.upsertProjectionSnapshot(snapshotBase({ clienteContaId: 5, itemId: "MLB2" }), db);

  assert.strictEqual(db.snapshots.length, 2);
});

// ── 6/7. null vs zero financeiro (§16 do prompt) ─────────────────────────

cenario("campo financeiro ausente (undefined) é gravado como null, nunca 0", async () => {
  const db = novoDb();
  const salvo = await repo.upsertProjectionSnapshot(snapshotBase({
    itemId: "MLB_NULL", cost: undefined, fixedFee: undefined, commission: undefined, profit: undefined, margin: undefined,
  }), db);

  assert.strictEqual(salvo.cost, null);
  assert.strictEqual(salvo.fixedFee, null);
  assert.strictEqual(salvo.commission, null);
  assert.strictEqual(salvo.profit, null);
  assert.strictEqual(salvo.margin, null);
});

cenario("campo financeiro com ZERO real continua 0, nunca vira null (fixedFee=0, taxRate=0)", async () => {
  const db = novoDb();
  const salvo = await repo.upsertProjectionSnapshot(snapshotBase({
    itemId: "MLB_ZERO", fixedFee: 0, taxRate: 0, freight: 0,
  }), db);

  assert.strictEqual(salvo.fixedFee, 0);
  assert.strictEqual(salvo.taxRate, 0);
  assert.strictEqual(salvo.freight, 0);
  assert.notStrictEqual(salvo.fixedFee, null, "0 real não pode virar null");
});

cenario("custo ZERO sobrevive a um upsert subsequente sem virar null (repository nunca usa `valor || 0`/apaga zero)", async () => {
  const db = novoDb();
  await repo.upsertProjectionSnapshot(snapshotBase({ itemId: "MLB_ZERO2", cost: 40 }), db);
  const segundo = await repo.upsertProjectionSnapshot(snapshotBase({ itemId: "MLB_ZERO2", cost: 0 }), db);

  assert.strictEqual(segundo.cost, 0);
});

// ── 8. JSONB round-trip ──────────────────────────────────────────────────

cenario("quality_json/missing_json/assumed_json/divergences_json fazem round-trip sem perder estrutura", async () => {
  const db = novoDb();
  const salvo = await repo.upsertProjectionSnapshot(snapshotBase({
    itemId: "MLB_JSON",
    quality: { price: "MEASURED", cost: "DECLARED" },
    missing: ["fixedFee"],
    assumed: ["taxRate"],
    divergences: [{ field: "freight", kind: "DRIFT", impactPp: 1.2 }],
  }), db);

  assert.deepStrictEqual(salvo.quality, { price: "MEASURED", cost: "DECLARED" });
  assert.deepStrictEqual(salvo.missing, ["fixedFee"]);
  assert.deepStrictEqual(salvo.assumed, ["taxRate"]);
  assert.deepStrictEqual(salvo.divergences, [{ field: "freight", kind: "DRIFT", impactPp: 1.2 }]);

  const lido = await repo.getProjectionSnapshot({ clienteContaId: 5, itemId: "MLB_JSON", db });
  assert.deepStrictEqual(lido.divergences, [{ field: "freight", kind: "DRIFT", impactPp: 1.2 }]);
});

cenario("quality_json/missing_json/assumed_json/divergences_json usam default vazio quando omitidos", async () => {
  const db = novoDb();
  const salvo = await repo.upsertProjectionSnapshot(snapshotBase({
    itemId: "MLB_JSON_DEFAULT", quality: undefined, missing: undefined, assumed: undefined, divergences: undefined,
  }), db);

  assert.deepStrictEqual(salvo.quality, {});
  assert.deepStrictEqual(salvo.missing, []);
  assert.deepStrictEqual(salvo.assumed, []);
  assert.deepStrictEqual(salvo.divergences, []);
});

// ── 9. listagem filtra por conta (repetido com filtro de status) ────────

cenario("listProjectionSnapshots filtra por status dentro da conta", async () => {
  const db = novoDb();
  await repo.upsertProjectionSnapshot(snapshotBase({ itemId: "MLB_H", status: "HEALTHY" }), db);
  await repo.upsertProjectionSnapshot(snapshotBase({ itemId: "MLB_L", status: "LOSS" }), db);

  const saudaveis = await repo.listProjectionSnapshots({ clienteContaId: 5, status: "HEALTHY", db });
  assert.strictEqual(saudaveis.length, 1);
  assert.strictEqual(saudaveis[0].itemId, "MLB_H");
});

cenario("countProjectionSnapshots conta direto no banco, sem carregar linhas", async () => {
  const db = novoDb();
  await repo.upsertProjectionSnapshot(snapshotBase({ itemId: "MLB_A", status: "HEALTHY" }), db);
  await repo.upsertProjectionSnapshot(snapshotBase({ itemId: "MLB_B", status: "HEALTHY" }), db);
  await repo.upsertProjectionSnapshot(snapshotBase({ itemId: "MLB_C", status: "LOSS" }), db);

  assert.strictEqual(await repo.countProjectionSnapshots({ clienteContaId: 5, db }), 3);
  assert.strictEqual(await repo.countProjectionSnapshots({ clienteContaId: 5, status: "HEALTHY", db }), 2);
  assert.strictEqual(await repo.countProjectionSnapshots({ clienteContaId: 5, status: "LOSS", db }), 1);
});

// ── 10. ordenação básica (parte do contrato M1) ──────────────────────────

cenario("listProjectionSnapshots ordena por margin_percent ASC/DESC", async () => {
  const db = novoDb();
  await repo.upsertProjectionSnapshot(snapshotBase({ itemId: "MLB_10", marginPercent: 10 }), db);
  await repo.upsertProjectionSnapshot(snapshotBase({ itemId: "MLB_30", marginPercent: 30 }), db);
  await repo.upsertProjectionSnapshot(snapshotBase({ itemId: "MLB_20", marginPercent: 20 }), db);

  const asc = await repo.listProjectionSnapshots({ clienteContaId: 5, ordenacao: "margin_percent", direcao: "ASC", db });
  assert.deepStrictEqual(asc.map((s) => s.itemId), ["MLB_10", "MLB_20", "MLB_30"]);

  const desc = await repo.listProjectionSnapshots({ clienteContaId: 5, ordenacao: "margin_percent", direcao: "DESC", db });
  assert.deepStrictEqual(desc.map((s) => s.itemId), ["MLB_30", "MLB_20", "MLB_10"]);
});

cenario("listProjectionSnapshots cai em updated_at DESC quando a coluna de ordenação não é reconhecida", async () => {
  const db = novoDb();
  await repo.upsertProjectionSnapshot(snapshotBase({ itemId: "MLB_QQ" }), db);

  // não deve lançar erro por causa de uma coluna inválida — cai no default.
  const linhas = await repo.listProjectionSnapshots({ clienteContaId: 5, ordenacao: "DROP TABLE clientes;--", db });
  assert.strictEqual(linhas.length, 1);
});

cenario("listProjectionSnapshots pagina (page/limit)", async () => {
  const db = novoDb();
  for (let i = 1; i <= 5; i += 1) {
    await repo.upsertProjectionSnapshot(snapshotBase({ itemId: `MLB_P${i}`, marginPercent: i }), db);
  }

  const pagina1 = await repo.listProjectionSnapshots({ clienteContaId: 5, ordenacao: "margin_percent", direcao: "ASC", page: 1, limit: 2, db });
  const pagina2 = await repo.listProjectionSnapshots({ clienteContaId: 5, ordenacao: "margin_percent", direcao: "ASC", page: 2, limit: 2, db });

  assert.deepStrictEqual(pagina1.map((s) => s.itemId), ["MLB_P1", "MLB_P2"]);
  assert.deepStrictEqual(pagina2.map((s) => s.itemId), ["MLB_P3", "MLB_P4"]);
});

// ── Runner ───────────────────────────────────────────────────────────────

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
    console.error(`marginSnapshotRepository: ${falhas} de ${casos.length} cenários falharam`);
    process.exitCode = 1;
  } else {
    console.log(`marginSnapshotRepository: ok (${casos.length} cenários)`);
  }
}

main();
