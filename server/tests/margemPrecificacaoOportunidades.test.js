// server/tests/margemPrecificacaoOportunidades.test.js
// Oportunidades de preço/promoção da Central de Margem (sem N+1) e refresh
// pontual do Margin Snapshot pós-escrita. Fake db, nenhum ML.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/vf-test";

const assert = require("assert");
const { listarOportunidades } = require("../services/motorMargem/precificacao/precificacaoOportunidadesService");
const { atualizarSnapshotDoItem } = require("../services/motorMargem/precificacao/precificacaoSnapshotItem");
const { computeMargin } = require("../services/motorMargem/core/marginEngine");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

function snapRow(itemId, o = {}) {
  return {
    item_id: itemId, titulo: `Produto ${itemId}`, image_url: null, price: o.price ?? 100, cost: o.cost ?? 40,
    tax_rate: o.tax === undefined ? 0.1 : o.tax, fixed_fee: 0, commission_rate: o.rate === undefined ? 0.12 : o.rate, freight: o.freight ?? 15,
    margin: 0.2, status: "HEALTHY", quality_json: {},
  };
}

function diagRow(itemId, o = {}) {
  return {
    item_id: itemId, titulo: null, campanha: o.campanha || "Campanha", campanha_id: o.id || `P-${itemId}`,
    tipo_promocao: o.tipo || "DEAL", preco_original: 100, preco_promocao: o.preco ?? 90, desconto_total: 10,
    seller_percentage: 5, meli_percentage: o.meli ?? 5, retorno_ml: o.retorno ?? 0, payload_raw: { status: o.status || "candidate" },
  };
}

function fakeDb({ head = [{ id: 11, created_at: new Date().toISOString(), parcial: false, itens_scaneados: 120 }], itens = [], snaps = [] } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM promocoes_diagnosticos/.test(sql)) {
        if (head === "sem-tabela") { const e = new Error("relation does not exist"); e.code = "42P01"; throw e; }
        return { rows: head };
      }
      if (/FROM promocoes_diagnostico_itens/.test(sql)) return { rows: itens };
      if (/FROM margin_projection_snapshots/.test(sql)) return { rows: snaps };
      throw new Error("SQL inesperado: " + sql);
    },
  };
}

function deps(db, vendas = new Map()) {
  return {
    db,
    resolverContaDoCliente: async () => ({ cliente: { id: 3, slug: "loja-a" }, conta: { id: 7, nome: "Conta A" } }),
    obterConta: async () => ({ id: 7, external_account_id: "555" }),
    carregarRealizada: async () => ({ porMlb: vendas, periodo: { dateFrom: "2026-08-31", dateTo: "2026-09-29" } }),
    now: () => new Date(),
  };
}

cenario("sem diagnóstico concluído (ou tabela inexistente): indisponível, com a explicação da dependência bulk", async () => {
  const r = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7 }, deps(fakeDb({ head: [] })));
  assert.strictEqual(r.disponivel, false);
  assert.strictEqual(r.motivo, "SEM_DIAGNOSTICO_PROMOCOES");
  const r2 = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7 }, deps(fakeDb({ head: "sem-tabela" })));
  assert.strictEqual(r2.disponivel, false);
});

cenario("diagnóstico filtrado pela CONTA (seller_id = conta ML), nunca pelo cliente inteiro", async () => {
  const db = fakeDb({ head: [] });
  await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7 }, deps(db));
  const q = db.queries.find((x) => /promocoes_diagnosticos/.test(x.sql));
  assert.deepStrictEqual(q.params, [3, "555"]);
});

cenario("ranking explicável: com retorno ML > mais unidades > maior margem; margem pelo marginEngine; 1 linha por item", async () => {
  const itens = [
    diagRow("MLB1", { retorno: 0 }),
    diagRow("MLB2", { retorno: 4.5 }),
    diagRow("MLB3", { retorno: 0 }),
    diagRow("MLB3", { id: "P-MLB3-b", retorno: 0, preco: 95 }),
    diagRow("MLB4", { retorno: 0, preco: 50 }), // prejuízo → fora
    diagRow("MLB5", { status: "finished" }), // indisponível → fora
    diagRow("MLB6", {}), // sem snapshot → fora
  ];
  const snaps = [snapRow("MLB1"), snapRow("MLB2"), snapRow("MLB3"), snapRow("MLB4"), snapRow("MLB5")];
  const vendas = new Map([["MLB1", { unidades: 3, receita: 300 }], ["MLB3", { unidades: 10, receita: 900 }]]);
  const r = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7 }, deps(fakeDb({ itens, snaps }), vendas));
  assert.strictEqual(r.disponivel, true);
  assert.deepStrictEqual(r.oportunidades.map((o) => o.itemId), ["MLB2", "MLB3", "MLB1"]);
  const mlb2 = r.oportunidades[0];
  const esperado = computeMargin({ price: 90, cost: 40, taxRate: 0.1, fixedFee: 0, commission: 10.8, freight: 15, rebate: 4.5 });
  assert.strictEqual(mlb2.margemDepois, esperado.margin);
  assert.strictEqual(mlb2.estimado, true);
  assert.ok(/retorno ML/.test(mlb2.motivo));
  assert.strictEqual(r.oportunidades[1].precoPromocao, 95, "MLB3: a promoção de maior margem do mesmo item");
  assert.strictEqual(r.fonte.frescor, "atual");
});

cenario("sem taxa de comissão ou imposto no snapshot: fica fora (nunca assume zero numa oportunidade)", async () => {
  const r = await listarOportunidades(
    { clienteSlug: "loja-a", clienteContaId: 7 },
    deps(fakeDb({ itens: [diagRow("MLB1"), diagRow("MLB2")], snaps: [snapRow("MLB1", { rate: null }), snapRow("MLB2", { tax: null })] }))
  );
  assert.strictEqual(r.oportunidades.length, 0);
});

cenario("performance: exatamente 3 consultas ao banco para a conta inteira, zero ML", async () => {
  const itens = Array.from({ length: 300 }, (_, i) => diagRow(`MLB${i + 1}`));
  const snaps = itens.map((r) => snapRow(r.item_id));
  const db = fakeDb({ itens, snaps });
  const r = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7, limit: 20 }, deps(db));
  assert.strictEqual(db.queries.length, 3);
  assert.strictEqual(r.oportunidades.length, 20);
});

// ── Refresh pontual do snapshot ────────────────────────────────────────────

cenario("snapshot do item: contexto SEM vendas, 1 item, run_id nulo, upsert com a conta explícita", async () => {
  const chamadas = { prepare: null, enrich: null, upsert: null };
  const item = {
    identity: { itemId: "MLB100", sku: "S", titulo: "T", image: null },
    fields: { price: { projected: { value: 114.9 } } },
    margin: { projected: { profit: 19.6, margin: 0.17, marginPercent: 17, missing: [], assumed: [] }, target: { marginTarget: 0.1 } },
    quality: { status: "HEALTHY", confidence: "HIGH", confidenceByField: {}, reasons: [], divergences: [] },
  };
  const r = await atualizarSnapshotDoItem(
    { clienteSlug: "loja-a", clienteId: 3, clienteContaId: 7, itemId: "MLB100" },
    {
      limiter: { aguardarVez: async () => {} },
      prepareWorkspaceContext: async (params, d) => { chamadas.prepare = { params, vendas: await d.carregarVendas() }; return { base: { id: 4 }, now: new Date("2026-09-30T12:00:00Z") }; },
      enrichBatch: async (_p, opts) => { chamadas.enrich = opts; return { itens: [item] }; },
      upsertProjectionSnapshot: async (dados) => { chamadas.upsert = dados; },
    }
  );
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(chamadas.prepare.params, { clienteSlug: "loja-a", clienteContaId: 7 });
  assert.deepStrictEqual(chamadas.prepare.vendas.pedidos, []);
  assert.deepStrictEqual(chamadas.enrich, { itemIds: ["MLB100"] });
  assert.strictEqual(chamadas.upsert.runId, null);
  assert.strictEqual(chamadas.upsert.clienteContaId, 7);
  assert.strictEqual(chamadas.upsert.baseId, 4);
  assert.strictEqual(chamadas.upsert.margin, 0.17);
});

cenario("snapshot do item: chamadas concorrentes do mesmo item compartilham 1 leitura (single-flight)", async () => {
  let enrich = 0;
  let liberar;
  const trava = new Promise((r) => { liberar = r; });
  const d = {
    limiter: { aguardarVez: async () => {} },
    prepareWorkspaceContext: async () => ({ base: null, now: null }),
    enrichBatch: async () => { enrich += 1; await trava; return { itens: [] }; },
    upsertProjectionSnapshot: async () => {},
  };
  const p = { clienteSlug: "loja-a", clienteId: 3, clienteContaId: 7, itemId: "MLB200" };
  const a = atualizarSnapshotDoItem(p, d);
  const b = atualizarSnapshotDoItem(p, d);
  assert.strictEqual(a, b);
  await new Promise((r) => setImmediate(r));
  liberar();
  const r = await a;
  assert.strictEqual(r.ok, false);
  assert.strictEqual(enrich, 1);
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
    console.error(`margemPrecificacaoOportunidades: ${falhas} de ${casos.length} cenários falharam`);
    process.exitCode = 1;
  } else {
    console.log(`margemPrecificacaoOportunidades: ok (${casos.length} cenários)`);
  }
}

main();
