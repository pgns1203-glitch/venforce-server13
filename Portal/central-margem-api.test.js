/* Testes puros do contrato/adaptador da Central de Margem. */
"use strict";

const assert = require("assert");
const api = require("./central-margem-api.js");

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`ok ${passed} - ${name}`);
    });
}

function context() {
  return {
    client: { slug: "loja-teste", name: "Loja Teste" },
    marketplace: "meli",
    page: 1,
    limit: 50,
  };
}

function legacyFixture() {
  const catalog = {
    ok: true,
    anuncios: [
      { item_id: "MLB-A", titulo: "Produto saudável", sku: "A", preco: 100, last_synced_at: "2026-08-12T12:00:00Z" },
      { item_id: "MLB-B", titulo: "Produto em prejuízo", sku: "B", preco: 50 },
      { item_id: "MLB-C", titulo: "Produto suspeito", sku: "C", preco: 80 },
      { item_id: "MLB-D", titulo: "Produto sem custo", sku: "D", preco: 90 },
      { item_id: "MLB-E", titulo: "Margem real pendente", sku: "E", preco: 70 },
    ],
    paginacao: { page: 1, limit: 50, total: 5, totalPaginas: 1 },
  };

  function order(id, revenue, cost, tax, result, confidence, commission, freight) {
    return {
      pedidoId: `ORDER-${id}`,
      data: "2026-08-10",
      confianca: confidence,
      itens: [{
        itemId: id,
        mlb: id,
        sku: id,
        quantidade: 1,
        valorUnitario: revenue,
        receitaProduto: revenue,
        custoProduto: cost,
        impostoInterno: tax,
        resultado: result,
        confianca: confidence,
      }],
      componentes: [
        { itemId: id, tipo: "tarifa_venda", valor: -commission, fonte: "orders_api", confianca: confidence },
        { itemId: id, tipo: "frete_seller", valor: -freight, fonte: "orders_api", confianca: confidence },
      ],
    };
  }

  const sales = {
    ok: true,
    motor: { status: "persistido", geradoEm: "2026-08-12T12:30:00Z" },
    periodo: { label: "Últimos 30 dias", inicio: "2026-07-14", fim: "2026-08-12" },
    produtos: {
      "MLB-A": { base: { custo: 40, imposto: 10, status: "real" } },
      "MLB-B": { base: { custo: 40, imposto: 10, status: "real" } },
      "MLB-C": { base: { custo: 20, imposto: 10, status: "real" } },
      "MLB-D": { base: { custo: null, imposto: null, status: "ausente" } },
      "MLB-E": { base: { custo: 20, imposto: 10, status: "real" } },
    },
    pedidos: [
      order("MLB-A", 100, 40, 10, 30, "confiavel", 10, 5),
      order("MLB-B", 50, 40, 5, -10, "confiavel", 10, 5),
      order("MLB-C", 80, 20, 8, 20, "bloqueado", 8, 4),
    ],
  };

  return { catalog, sales };
}

async function run() {
  await test("normaliza confiança categórica sem inventar score", () => {
    assert.deepStrictEqual(api.normalizeConfidence("confiavel").level, "HIGH");
    assert.deepStrictEqual(api.normalizeConfidence("parcial").level, "MEDIUM");
    assert.deepStrictEqual(api.normalizeConfidence("bloqueado").level, "LOW");
    assert.strictEqual(api.normalizeConfidence("UNKNOWN").score, null);
  });

  await test("preserva score numérico somente quando o backend o fornece", () => {
    const result = api.normalizeConfidence({ level: "HIGH", score: 96, explanation: "score do Motor" });
    assert.strictEqual(result.level, "HIGH");
    assert.strictEqual(result.score, 96);
    assert.strictEqual(result.explanation, "score do Motor");
  });

  await test("adapter real cobre saudável, prejuízo, suspeito, custo ausente e realizado pendente", () => {
    const fixture = legacyFixture();
    const result = api.adaptLegacyResponse(fixture.catalog, fixture.sales, context());
    const byId = Object.fromEntries(result.items.map((item) => [item.id, item]));
    assert.strictEqual(result.sourceMode, "legacy-adapter");
    assert.strictEqual(result.partial, true);
    assert.strictEqual(byId["MLB-A"].status, "HEALTHY");
    assert.strictEqual(byId["MLB-A"].realized.margin, 0.3);
    assert.strictEqual(byId["MLB-A"].variables.cost.value, 40);
    assert.strictEqual(byId["MLB-A"].variables.freightActual.value, 5);
    assert.strictEqual(byId["MLB-B"].status, "LOSS");
    assert.strictEqual(byId["MLB-C"].status, "SUSPECT_DATA");
    assert.strictEqual(byId["MLB-D"].status, "UNVALIDATED");
    assert.strictEqual(byId["MLB-D"].variables.cost.value, null);
    assert.strictEqual(byId["MLB-E"].realized.pending, true);
    assert.strictEqual(byId["MLB-E"].realized.margin, null);
  });

  await test("não chama API por linha e degrada para os dois endpoints agregados", async () => {
    const fixture = legacyFixture();
    const calls = [];
    const client = api.createClient({
      request(path) {
        calls.push(path);
        if (path.startsWith("/operacao/central-margem/")) return { ok: false, status: 404, error: "ausente" };
        if (path.startsWith("/anuncios-meli?")) return { ok: true, status: 200, data: fixture.catalog };
        if (path.startsWith("/operacao/central-vendas/")) return { ok: true, status: 200, data: fixture.sales };
        throw new Error(`rota inesperada: ${path}`);
      },
    });
    const result = await client.getCentral({ clientSlug: "loja-teste", clientName: "Loja Teste", page: 1, limit: 50 });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(calls.length, 3);
    assert.strictEqual(calls.filter((path) => path.includes("MLB-")).length, 0);
  });

  await test("erro real do Motor é exibido e não mascarado pelo fallback", async () => {
    let calls = 0;
    const client = api.createClient({
      request() {
        calls += 1;
        return { ok: false, status: 500, error: "motor indisponível" };
      },
    });
    const result = await client.getCentral({ clientSlug: "loja-teste" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "motor indisponível");
    assert.strictEqual(calls, 1);
  });

  await test("resposta financeira parcial mantém o catálogo e sinaliza pendências", () => {
    const fixture = legacyFixture();
    const result = api.adaptLegacyResponse(fixture.catalog, null, context(), { status: 503 });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.items.length, 5);
    assert.ok(result.warnings.some((warning) => warning.includes("leitura financeira falhou")));
    assert.ok(result.items.every((item) => item.realized.margin === null));
  });

  await test("contrato canônico suporta todos os estados e divergência de frete", () => {
    const statuses = ["HEALTHY", "LOW_MARGIN", "LOSS", "UNVALIDATED", "SUSPECT_DATA", "RECONCILING"];
    const payload = {
      ok: true,
      items: statuses.map((status, index) => ({
        itemId: `MLB-${index}`,
        title: status,
        status,
        confidence: { level: index % 2 ? "MEDIUM" : "HIGH" },
        projected: { margin: 0.12, profit: 12 },
        realized: { margin: index === 3 ? null : 0.1, profit: 10 },
        variables: {
          price: {
            evidences: [
              { kind: "PROJECTED", source: "MELI_API", value: 100 },
              { kind: "REALIZED", source: "MELI_ORDER", value: 98 },
            ],
          },
          cost: { value: 40, source: "VENFORCE_BASE", confidence: "HIGH" },
          taxRate: { value: 0.1, source: "VENFORCE_BASE" },
          commission: { value: 10, source: "MELI_API" },
          commissionRate: { value: 0.1 },
          freight: {
            projected: { value: 5, source: "MELI_API" },
            realized: { value: 8, source: "MELI_ORDER" },
            divergences: [{ type: "DRIFT", a: { source: "MELI_API", value: 5 }, b: { source: "MELI_ORDER", value: 8 } }],
          },
        },
      })),
      pagination: { page: 1, limit: 50, total: 6, totalPages: 1 },
    };
    const result = api.normalizeCanonicalResponse(payload, context());
    assert.deepStrictEqual(result.items.map((item) => item.status), statuses);
    assert.strictEqual(result.items[0].variables.freightExpected.value, 5);
    assert.strictEqual(result.items[0].variables.freightActual.value, 8);
    assert.strictEqual(result.items[0].divergences.length, 1);
  });

  await test("normaliza o contrato canônico real do Motor e sua paginação limitada", () => {
    const field = (projected, realized = null) => ({
      present: projected !== null || realized !== null,
      selectedValue: realized ? realized.value : projected && projected.value,
      selectedSource: realized ? realized.source : projected && projected.source,
      projected,
      realized,
      evidences: [projected, realized].filter(Boolean),
      divergences: [],
    });
    const payload = {
      ok: true,
      parcial: true,
      itens: [{
        identity: { itemId: "MLB-REAL", sku: "REAL", titulo: "Contrato real", marketplace: "meli" },
        itemId: "MLB-REAL",
        sku: "REAL",
        title: "Contrato real",
        status: "LOW_MARGIN",
        confidence: "MEDIUM",
        problema: "Margem abaixo da meta.",
        targetMargin: 0.1,
        projected: { margin: 0.08, profit: 8, estimated: false },
        realized: { margin: 0.07, profit: 7, pending: false },
        fields: {
          price: field({ value: 100, source: "MELI_API", observedAt: "2026-08-12T10:00:00Z" }, { value: 98, source: "MELI_ORDER", observedAt: "2026-08-10T10:00:00Z" }),
          cost: field({ value: 40, source: "VENFORCE_BASE" }),
          taxRate: field({ value: 0.1, source: "VENFORCE_BASE" }),
          fixedFee: field({ value: 0, source: "VENFORCE_BASE" }),
          commission: field({ value: 10, source: "MELI_API" }, { value: 11, source: "MELI_ORDER" }),
          commissionRate: field({ value: 0.1, source: "MELI_API" }),
          freight: field({ value: 5, source: "MELI_API" }, { value: 6, source: "MELI_ORDER" }),
          netReceipt: field(null),
        },
        quality: {
          confidence: "MEDIUM",
          reasons: [{ message: "Frete realizado divergiu do previsto." }],
          confidenceByField: {
            price: { level: "HIGH", reasons: [] },
            cost: { level: "HIGH", reasons: [] },
            taxRate: { level: "HIGH", reasons: [] },
            commission: { level: "MEDIUM", reasons: [{ message: "Valor realizado disponível." }] },
            freight: { level: "LOW", reasons: [{ message: "Frete divergiu." }] },
            netReceipt: { level: "UNKNOWN", reasons: [{ message: "Mercado Pago não integrado." }] },
          },
          statusReasons: ["Margem abaixo da meta."],
        },
        sales: { receita: 980, hasOrders: true },
        settlement: { available: false, motivo: "NAO_INTEGRADO" },
        divergences: [{ field: "freight", type: "DRIFT", a: { source: "MELI_API", value: 5 }, b: { source: "MELI_ORDER", value: 6 } }],
        conciliacao: "Pendente",
      }],
      paginacao: { page: 2, limit: 20, totalItensMl: 87, itensNaPagina: 1, itensCarregados: 20 },
      resumo: { escopo: "pagina", totalItensMl: 87, porStatus: { LOW_MARGIN: 1 } },
      periodo: { dateFrom: "2026-07-14", dateTo: "2026-08-12" },
    };
    const result = api.normalizeCanonicalResponse(payload, context());
    const normalized = result.items[0];
    assert.strictEqual(result.pagination.page, 2);
    assert.strictEqual(result.pagination.limit, 20);
    assert.strictEqual(result.pagination.total, 87);
    assert.strictEqual(result.pagination.totalPages, 5);
    assert.strictEqual(result.summary.monitored, 87);
    assert.strictEqual(result.summary.scope, "page");
    assert.strictEqual(result.summary.counts.LOW_MARGIN, 1);
    assert.strictEqual(normalized.variables.price.value, 100);
    assert.strictEqual(normalized.variables.lastSoldPrice.value, 98);
    assert.strictEqual(normalized.variables.freightExpected.value, 5);
    assert.strictEqual(normalized.variables.freightActual.value, 6);
    assert.strictEqual(normalized.variables.freightActual.confidence.level, "LOW");
    assert.strictEqual(normalized.variables.soldValue.value, 980);
    assert.strictEqual(normalized.confidence.explanation, "Frete realizado divergiu do previsto.");
    assert.strictEqual(result.lastUpdated, "2026-08-12T10:00:00Z");
  });

  await test("simulação calcula margem, lucro e comparações sem escrever preço", () => {
    const fixture = legacyFixture();
    const result = api.adaptLegacyResponse(fixture.catalog, fixture.sales, context());
    const item = result.items.find((entry) => entry.id === "MLB-A");
    const simulation = api.simulatePrice(item, 120);
    assert.strictEqual(simulation.computable, true);
    assert.strictEqual(simulation.profit, 51);
    assert.strictEqual(simulation.margin, 0.425);
    assert.strictEqual(simulation.targetMargin, null);
  });

  await test("simulação explica dados ausentes", () => {
    const fixture = legacyFixture();
    const result = api.adaptLegacyResponse(fixture.catalog, fixture.sales, context());
    const item = result.items.find((entry) => entry.id === "MLB-D");
    const simulation = api.simulatePrice(item, 120);
    assert.strictEqual(simulation.computable, false);
    assert.ok(simulation.missing.includes("cost"));
    assert.ok(simulation.missing.includes("commissionRate"));
  });

  console.log(`# ${passed} testes concluídos`);
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
