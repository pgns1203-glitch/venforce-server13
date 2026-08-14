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

  // =========================================================================
  // V9 — composição por fonte, cenário e derivações de apresentação
  // =========================================================================

  function evidence(source, kind, value, observedAt) {
    return { source, kind, value, observedAt: observedAt || null, quality: "MEASURED", note: null };
  }

  function canonicalField(evidences, divergences) {
    const list = evidences.filter((entry) => entry && entry.value !== null);
    const realized = list.find((entry) => entry.kind === "REALIZED") || null;
    const projected = list.find((entry) => entry.kind === "PROJECTED") || null;
    return {
      present: Boolean(realized || projected),
      selectedValue: realized ? realized.value : projected && projected.value,
      selectedSource: realized ? realized.source : projected && projected.source,
      projected,
      realized,
      evidences: list,
      divergences: divergences || [],
    };
  }

  function canonicalItem(overrides = {}) {
    return Object.assign({
      identity: { itemId: "MLB-V9", sku: "V9", titulo: "Produto V9", marketplace: "meli" },
      itemId: "MLB-V9",
      sku: "V9",
      title: "Produto V9",
      status: "LOW_MARGIN",
      confidence: "MEDIUM",
      targetMargin: 0.12,
      projected: { margin: 0.05, profit: 5 },
      realized: { margin: 0.07, profit: 7 },
      fields: {
        price: canonicalField([
          evidence("MELI_API", "PROJECTED", 100, "2026-08-12T10:00:00Z"),
          evidence("MELI_ORDER", "REALIZED", 96, "2026-08-10T10:00:00Z"),
        ]),
        cost: canonicalField([evidence("VENFORCE_BASE", "PROJECTED", 40)]),
        taxRate: canonicalField([evidence("VENFORCE_BASE", "PROJECTED", 0.06)]),
        fixedFee: canonicalField([evidence("VENFORCE_BASE", "PROJECTED", 0)]),
        commission: canonicalField([
          evidence("MELI_API", "PROJECTED", 16.5, "2026-08-12T10:00:00Z"),
          evidence("MELI_ORDER", "REALIZED", 15.9, "2026-08-10T10:00:00Z"),
        ]),
        commissionRate: canonicalField([evidence("MELI_API", "PROJECTED", 0.165)]),
        freight: canonicalField([
          evidence("MELI_API", "PROJECTED", 23.4, "2026-08-12T10:00:00Z"),
          evidence("MELI_ORDER", "REALIZED", 18.7, "2026-08-10T10:00:00Z"),
        ], [{
          type: "DRIFT",
          a: { source: "MELI_API", kind: "PROJECTED", value: 23.4, observedAt: "2026-08-12T10:00:00Z" },
          b: { source: "MELI_ORDER", kind: "REALIZED", value: 18.7, observedAt: "2026-08-10T10:00:00Z" },
        }]),
        netReceipt: canonicalField([]),
      },
      quality: { confidence: "MEDIUM", confidenceByField: {}, statusReasons: ["Margem abaixo da meta."] },
      sales: { hasOrders: true, unidades: 3 },
      settlement: { available: false, motivo: "MERCADO_PAGO_NAO_INTEGRADO" },
    }, overrides);
  }

  function normalizedItem(overrides) {
    return api.normalizeCanonicalItem(canonicalItem(overrides), { client: { slug: "loja-teste", name: "Loja" }, marketplace: "meli" });
  }

  await test("evidências viram mapa fonte -> observação, com effectiveAt sempre Não informado", () => {
    const item = normalizedItem();
    const price = item.sources.price;
    assert.deepStrictEqual(price.order, ["MELI_API", "EXTENSION_DOM", "MELI_ORDER"]);
    assert.strictEqual(price.entries.MELI_API.value, 100);
    assert.strictEqual(price.entries.MELI_API.observedAt, "2026-08-12T10:00:00Z");
    // O contrato do Motor não possui effectiveAt: nenhum horário é inventado.
    assert.strictEqual(price.entries.MELI_API.effectiveAt, null);
    // Fonte declarada no catálogo mas sem evidência continua ausente.
    assert.strictEqual(price.entries.EXTENSION_DOM.available, false);
    assert.strictEqual(price.entries.EXTENSION_DOM.value, null);
  });

  await test("escolha do Motor é exposta separada da composição da planilha", () => {
    const item = normalizedItem();
    // resolveField: realizado tem precedência sobre projetado.
    assert.strictEqual(item.motorChoice.freight.source, "MELI_ORDER");
    assert.strictEqual(item.motorChoice.freight.value, 18.7);
    assert.strictEqual(item.motorChoice.freight.kind, "REALIZED");
    // A planilha em modo Projetado usa a outra ponta — e as duas coexistem.
    assert.strictEqual(api.resolveComposition(item, api.PRESETS.projected).entries.freight.source, "MELI_API");
    // Variável declarada só tem a Base.
    assert.strictEqual(item.motorChoice.cost.source, "VENFORCE_BASE");
    // Sem evidência, não há escolha inventada.
    const noCost = normalizedItem({ fields: Object.assign({}, canonicalItem().fields, { cost: canonicalField([]) }) });
    assert.strictEqual(noCost.motorChoice.cost.available, false);
    assert.strictEqual(noCost.motorChoice.cost.value, null);
  });

  await test("preset Projetado e preset Realizado resolvem as fontes reais de cada momento", () => {
    const item = normalizedItem();
    const projected = api.resolveComposition(item, api.PRESETS.projected);
    const realized = api.resolveComposition(item, api.PRESETS.realized);
    assert.strictEqual(projected.values.price, 100);
    assert.strictEqual(projected.values.freight, 23.4);
    assert.strictEqual(projected.values.commission, 16.5);
    assert.strictEqual(realized.values.price, 96);
    assert.strictEqual(realized.values.freight, 18.7);
    assert.strictEqual(realized.values.commission, 15.9);
    // custo/imposto/taxa fixa são declarados: o realizado usa a mesma Base,
    // como `valueForKind` faz no backend. Não existe "custo realizado".
    assert.strictEqual(realized.values.cost, 40);
    assert.strictEqual(realized.values.tax, 0.06);
    assert.strictEqual(realized.entries.cost.source, "VENFORCE_BASE");
    assert.strictEqual(projected.preset, "projected");
    assert.strictEqual(realized.preset, "realized");
  });

  await test("alterar uma fonte manualmente resulta em modo Personalizado", () => {
    const custom = Object.assign(api.clonePreset("projected"), { freight: "MELI_ORDER" });
    assert.strictEqual(api.presetFor(custom), "custom");
    assert.strictEqual(api.presetFor(api.clonePreset("projected")), "projected");
    assert.strictEqual(api.presetFor(api.clonePreset("realized")), "realized");
    // clonePreset devolve cópia: mexer no resultado não contamina o preset.
    const clone = api.clonePreset("projected");
    clone.price = "MELI_ORDER";
    assert.strictEqual(api.PRESETS.projected.price, "MELI_API");
  });

  await test("núcleo espelha marginEngine: preço e custo obrigatórios, opcional vira zero declarado", () => {
    const complete = api.computeMargin({ price: 100, cost: 40, tax: 0.06, commission: 16.5, freight: 23.4, fixedFee: 0 });
    assert.strictEqual(complete.computable, true);
    assert.strictEqual(complete.profit, 14.1);
    assert.strictEqual(complete.margin, 0.141);
    assert.strictEqual(complete.strict, true);

    const missingCost = api.computeMargin({ price: 100, cost: null, tax: 0.06, commission: 1, freight: 1, fixedFee: 0 });
    assert.strictEqual(missingCost.computable, false);
    assert.deepStrictEqual(missingCost.missing, ["cost"]);
    assert.strictEqual(missingCost.profit, null);
    assert.strictEqual(missingCost.margin, null);

    // Opcional ausente entra como zero DECLARADO, nunca como zero silencioso.
    const assumedFreight = api.computeMargin({ price: 100, cost: 40, tax: 0.06, commission: 16.5, freight: null, fixedFee: null });
    assert.strictEqual(assumedFreight.computable, true);
    assert.deepStrictEqual(assumedFreight.assumed, ["freight", "fixedFee"]);
    assert.strictEqual(assumedFreight.strict, false);

    // Preço zero não é margem zero: é dado impossível.
    assert.strictEqual(api.computeMargin({ price: 0, cost: 10 }).computable, false);
  });

  await test("fonte sem evidência mantém null e impede o cálculo em vez de zerar", () => {
    const item = normalizedItem();
    const composition = api.resolveComposition(item, Object.assign(api.clonePreset("projected"), { price: "EXTENSION_DOM" }));
    assert.strictEqual(composition.values.price, null);
    assert.deepStrictEqual(composition.unavailable, ["price"]);
    assert.strictEqual(composition.computable, false);
    assert.strictEqual(composition.profit, null);
    assert.strictEqual(composition.margin, null);
  });

  await test("simulatePrice continua idêntico à implementação anterior", () => {
    // Oráculo: cópia literal da fórmula que existia antes da centralização.
    function round(value, digits) {
      if (value === null) return null;
      const factor = Math.pow(10, digits === undefined ? 2 : digits);
      return Math.round((value + Number.EPSILON) * factor) / factor;
    }
    function legacySimulatePrice(item, newPrice) {
      const price = Number.isFinite(Number(newPrice)) && newPrice !== null && newPrice !== "" ? Number(newPrice) : null;
      const inputs = (item && item.simulationInputs) || {};
      const missing = [];
      const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
      if (price === null || price <= 0) missing.push("price");
      if (num(inputs.cost) === null) missing.push("cost");
      if (num(inputs.taxRate) === null) missing.push("taxRate");
      if (num(inputs.commissionRate) === null) missing.push("commissionRate");
      if (num(inputs.freight) === null) missing.push("freight");
      if (missing.length) return { computable: false, missing, profit: null, margin: null };
      const cost = Number(inputs.cost);
      const taxRate = Number(inputs.taxRate);
      const commissionRate = Number(inputs.commissionRate);
      const freight = Number(inputs.freight);
      const fixedFee = num(inputs.fixedFee) || 0;
      const profit = price - price * taxRate - price * commissionRate - freight - fixedFee - cost;
      const margin = profit / price;
      const currentMargin = item.projected && item.projected.margin;
      const targetMargin = item.targetMargin;
      return {
        computable: true,
        price: round(price, 2),
        profit: round(profit, 2),
        margin: round(margin, 6),
        currentMargin,
        deltaCurrentPp: currentMargin === null || currentMargin === undefined ? null : round((margin - currentMargin) * 100, 2),
        targetMargin,
        deltaTargetPp: targetMargin === null || targetMargin === undefined ? null : round((margin - targetMargin) * 100, 2),
        source: inputs.source || "Motor de Margem",
        missing: [],
      };
    }

    const cases = [];
    [null, 0, 1, 47, 99.9, 119.9, 1234.56].forEach((price) => {
      [
        { cost: 40, taxRate: 0.06, commissionRate: 0.165, freight: 23.4, fixedFee: 0, source: "Motor de Margem" },
        { cost: 83.33, taxRate: 0.115, commissionRate: 0.1499, freight: 18.7, fixedFee: 6.75, source: "Adapter" },
        { cost: null, taxRate: 0.06, commissionRate: 0.165, freight: 23.4, fixedFee: 0 },
        { cost: 40, taxRate: 0.06, commissionRate: null, freight: null, fixedFee: null },
      ].forEach((inputs) => {
        [null, 0.12, 0].forEach((targetMargin) => {
          cases.push({ simulationInputs: inputs, targetMargin, projected: { margin: 0.05 } });
          cases.push({ simulationInputs: inputs, targetMargin, projected: { margin: null } });
        });
        cases.forEach((item) => { item.__price = price; });
      });
    });

    let compared = 0;
    cases.forEach((item) => {
      [null, 0, 1, 47, 99.9, 120, 1234.56].forEach((price) => {
        assert.deepStrictEqual(api.simulatePrice(item, price), legacySimulatePrice(item, price),
          `divergiu para preço ${price} e inputs ${JSON.stringify(item.simulationInputs)}`);
        compared += 1;
      });
    });
    assert.ok(compared >= 100, `poucos casos comparados: ${compared}`);
  });

  await test("cenário é local: overrides não viram evidência nem alteram o item", () => {
    const item = normalizedItem();
    const before = JSON.stringify(item.sources);
    const scenario = {
      price: { source: "MELI_API", value: 150, manual: true },
      cost: { source: "VENFORCE_BASE", value: null, manual: false },
      tax: { source: "VENFORCE_BASE", value: null, manual: false },
      commission: { source: "MELI_API", value: null, manual: false },
      freight: { source: "MELI_ORDER", value: null, manual: false },
      fixedFee: { source: "VENFORCE_BASE", value: null, manual: false },
    };
    const simulation = api.simulateScenario(item, scenario, api.PRESETS.projected);
    assert.strictEqual(simulation.computable, true);
    assert.strictEqual(simulation.values.price, 150);
    assert.strictEqual(simulation.values.freight, 18.7);
    assert.deepStrictEqual(simulation.changed.sort(), ["freight", "price"]);
    assert.strictEqual(simulation.persisted, false);
    assert.ok(simulation.deltaMarginPp !== null);
    // Nada do item foi mutado pela simulação.
    assert.strictEqual(JSON.stringify(item.sources), before);
  });

  await test("cenário sem variável obrigatória não calcula e não assume zero", () => {
    const item = normalizedItem();
    const scenario = {
      price: { source: "MELI_API", value: null, manual: false },
      cost: { source: "VENFORCE_BASE", value: null, manual: true },
      tax: { source: "VENFORCE_BASE", value: null, manual: false },
      commission: { source: "MELI_API", value: null, manual: false },
      freight: { source: "MELI_API", value: null, manual: false },
      fixedFee: { source: "VENFORCE_BASE", value: null, manual: false },
    };
    const simulation = api.simulateScenario(item, scenario, api.PRESETS.projected);
    assert.strictEqual(simulation.computable, false);
    assert.deepStrictEqual(simulation.missing, ["cost"]);
    assert.strictEqual(simulation.profit, null);
    assert.strictEqual(simulation.margin, null);
  });

  await test("resultado financeiro usa o status do Motor e só deriva quando ele é de qualidade", () => {
    const backend = normalizedItem({ status: "LOSS" });
    assert.strictEqual(api.financialResult(backend).key, "LOSS");
    assert.strictEqual(api.financialResult(backend).origin, "backend");

    // Status ocupado por qualidade: o resultado financeiro é derivado das
    // margens que o próprio Motor calculou, sem reescrever `status`.
    const suspect = normalizedItem({ status: "SUSPECT_DATA", realized: { margin: 0.07 }, projected: { margin: 0.05 } });
    assert.strictEqual(suspect.status, "SUSPECT_DATA");
    assert.strictEqual(api.financialResult(suspect).key, "LOW_MARGIN");
    assert.strictEqual(api.financialResult(suspect).origin, "derived");

    const lossHidden = normalizedItem({ status: "RECONCILING", realized: { margin: -0.2 }, projected: { margin: -0.1 } });
    assert.strictEqual(api.financialResult(lossHidden).key, "LOSS");

    const noMargin = normalizedItem({ status: "UNVALIDATED", realized: { margin: null }, projected: { margin: null } });
    assert.strictEqual(api.financialResult(noMargin).key, "UNKNOWN");
    assert.strictEqual(api.financialResult(noMargin).margin, null);
  });

  await test("integridade do dado é uma leitura separada do resultado financeiro", () => {
    assert.strictEqual(api.dataIntegrity(normalizedItem({ status: "UNVALIDATED" })).key, "MISSING");
    assert.strictEqual(api.dataIntegrity(normalizedItem({ status: "SUSPECT_DATA" })).key, "SUSPECT");
    assert.strictEqual(api.dataIntegrity(normalizedItem({ status: "RECONCILING" })).key, "RECONCILING");

    // Prejuízo com dado confiável: financeiro ruim, integridade boa.
    const reliableLoss = normalizedItem({ status: "LOSS", realized: { margin: -0.3 } });
    assert.strictEqual(api.financialResult(reliableLoss).key, "LOSS");
    assert.strictEqual(api.dataIntegrity(reliableLoss).key, "RELIABLE");

    // Custo ausente com status financeiro: a integridade acusa mesmo assim.
    const noCost = normalizedItem({
      status: "HEALTHY",
      fields: Object.assign({}, canonicalItem().fields, { cost: canonicalField([]) }),
    });
    assert.strictEqual(api.dataIntegrity(noCost).key, "MISSING");

    const summary = api.summarizeItems([reliableLoss, noCost]);
    assert.strictEqual(summary.financial.LOSS, 1);
    assert.strictEqual(summary.integrity.MISSING, 1);
  });

  await test("fila de divergências usa divergência real e calcula o impacto na MC", () => {
    const item = normalizedItem();
    const rows = api.divergenceQueue([item], api.PRESETS.projected);
    assert.strictEqual(rows.length, 1);
    const row = rows[0];
    assert.strictEqual(row.variable, "freight");
    assert.strictEqual(row.selectedSource, "MELI_API");
    assert.strictEqual(row.selectedValue, 23.4);
    assert.strictEqual(row.alternativeSource, "MELI_ORDER");
    assert.strictEqual(row.alternativeValue, 18.7);
    // Frete menor melhora a MC: (23,40 − 18,70) / 100 = +4,7 pp.
    assert.strictEqual(row.impactPp, 4.7);
    assert.strictEqual(row.type, "DRIFT");
    assert.strictEqual(row.origin, "motor");

    // O Motor publica a mesma divergência em fields[x].divergences e em
    // quality.divergences; a fila mostra uma linha só.
    const duplicated = api.normalizeCanonicalItem(
      Object.assign(canonicalItem(), {
        divergences: [{
          field: "freight",
          type: "DRIFT",
          a: { source: "MELI_API", kind: "PROJECTED", value: 23.4, observedAt: "2026-08-12T10:00:00Z" },
          b: { source: "MELI_ORDER", kind: "REALIZED", value: 18.7, observedAt: "2026-08-10T10:00:00Z" },
        }],
      }),
      { client: { slug: "loja-teste", name: "Loja" }, marketplace: "meli" }
    );
    assert.strictEqual(duplicated.divergences.length, 1);
    assert.strictEqual(api.divergenceQueue([duplicated], api.PRESETS.projected).length, 1);

    // Sem divergência relatada, a fila fica vazia: nada é inventado.
    const clean = normalizedItem({
      fields: Object.assign({}, canonicalItem().fields, {
        freight: canonicalField([evidence("MELI_API", "PROJECTED", 23.4), evidence("MELI_ORDER", "REALIZED", 23.4)]),
      }),
    });
    assert.strictEqual(api.divergenceQueue([clean], api.PRESETS.projected).length, 0);
  });

  await test("saúde das fontes não inventa Mercado Pago nem Extensão", () => {
    const response = api.normalizeCanonicalResponse({ ok: true, itens: [canonicalItem()] }, context());
    const health = Object.fromEntries(api.sourceHealth(response).map((entry) => [entry.key, entry]));
    assert.strictEqual(health.MELI_API.state, "OK");
    assert.strictEqual(health.VENFORCE_BASE.state, "OK");
    assert.strictEqual(health.MELI_ORDER.state, "OK");
    assert.strictEqual(health.MERCADO_PAGO.state, "PENDING");
    assert.strictEqual(health.MERCADO_PAGO.detail, "integração pendente");
    assert.strictEqual(health.EXTENSION_DOM.state, "PENDING");
    assert.strictEqual(health.EXTENSION_DOM.detail, "ingestão pendente");
    // Recebimento líquido continua ausente: nunca derivado do preço vendido.
    assert.strictEqual(response.items[0].variables.netReceipt.value, null);
    assert.strictEqual(response.items[0].variables.mercadoPago.value, null);
  });

  await test("adapter legado expõe fontes reais e deriva divergência com a tolerância do núcleo", () => {
    const fixture = legacyFixture();
    // Preço de catálogo 100 × último vendido 100: dentro da tolerância.
    const same = api.adaptLegacyResponse(fixture.catalog, fixture.sales, context());
    const itemA = same.items.find((entry) => entry.id === "MLB-A");
    assert.strictEqual(itemA.sources.price.entries.MELI_API.value, 100);
    assert.strictEqual(itemA.sources.price.entries.MELI_ORDER.value, 100);
    assert.strictEqual(itemA.divergences.length, 0);
    // O adapter não tem frete previsto nem taxa fixa: ausência explícita.
    assert.strictEqual(itemA.sources.freight.entries.MELI_API.available, false);
    assert.strictEqual(itemA.sources.fixedFee.entries.VENFORCE_BASE.available, false);
    assert.strictEqual(api.resolveComposition(itemA, api.PRESETS.projected).values.freight, null);

    // Agora com preço vendido bem diferente do catálogo.
    const drifted = JSON.parse(JSON.stringify(fixture));
    drifted.sales.pedidos[0].itens[0].valorUnitario = 80;
    const result = api.adaptLegacyResponse(drifted.catalog, drifted.sales, context());
    const item = result.items.find((entry) => entry.id === "MLB-A");
    assert.strictEqual(item.divergences.length, 1);
    assert.strictEqual(item.divergences[0].type, "DRIFT");
    assert.strictEqual(item.divergences[0].origin, "adapter");
    assert.strictEqual(item.divergences[0].variableKey, "price");
    // DRIFT não é defeito de dado: o status permanece o que era.
    assert.strictEqual(item.status, "HEALTHY");
  });

  console.log(`# ${passed} testes concluídos`);
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
