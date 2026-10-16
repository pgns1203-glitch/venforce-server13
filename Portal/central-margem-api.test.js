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

  await test("sem Motor canônico (404) não há leitura de reserva: erro explícito, nenhuma margem calculada na tela", async () => {
    const calls = [];
    const client = api.createClient({
      request(path) {
        calls.push(path);
        return { ok: false, status: 404, error: "ausente" };
      },
    });
    const central = await client.getCentral({ clientSlug: "loja-teste", clientName: "Loja Teste", page: 1, limit: 50 });
    const workspace = await client.getWorkspace({ clientSlug: "loja-teste" });
    for (const result of [central, workspace]) {
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, "MOTOR_INDISPONIVEL");
      assert.strictEqual(result.type, "motor-indisponivel");
      assert.ok(!result.items, "sem itens montados fora do Motor");
    }
    assert.strictEqual(calls.length, 2, "uma chamada por leitura: sem cair em /anuncios-meli nem /central-vendas");
    assert.ok(calls.every((path) => path.startsWith("/operacao/central-margem/")), calls.join(" "));
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
        // Base de HOJE (atualizada em junho) × Base NO MOMENTO DA VENDA
        // (gravada pela Central de Vendas em agosto). A observação histórica é
        // MAIS RECENTE — escolher só pela fonte faria o Projetado usá-la.
        cost: canonicalField([
          evidence("VENFORCE_BASE", "PROJECTED", 40, "2026-06-01T00:00:00Z"),
          evidence("VENFORCE_BASE", "REALIZED", 38, "2026-08-10T10:00:00Z"),
        ]),
        taxRate: canonicalField([
          evidence("VENFORCE_BASE", "PROJECTED", 0.06, "2026-06-01T00:00:00Z"),
          evidence("VENFORCE_BASE", "REALIZED", 0.055, "2026-08-10T10:00:00Z"),
        ]),
        fixedFee: canonicalField([evidence("VENFORCE_BASE", "PROJECTED", 0, "2026-06-01T00:00:00Z")]),
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
    // Custo com venda: o Motor escolhe o valor da Base NO MOMENTO DA VENDA
    // (realizado tem precedência), exposto como slot próprio.
    assert.strictEqual(item.motorChoice.cost.source, "VENFORCE_BASE_HIST");
    assert.strictEqual(item.motorChoice.cost.value, 38);
    assert.strictEqual(item.motorChoice.cost.kind, "REALIZED");
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
    // Custo/imposto têm DOIS momentos na mesma fonte: o Projetado usa a Base
    // de hoje; o Realizado usa o valor que a Base tinha na venda (o mesmo que
    // `valueForKind(REALIZED)` usa no backend).
    assert.strictEqual(projected.values.cost, 40, "Base atual, mesmo com a venda mais recente");
    assert.strictEqual(projected.values.tax, 0.06);
    assert.strictEqual(realized.values.cost, 38, "Base no momento da venda");
    assert.strictEqual(realized.values.tax, 0.055);
    assert.strictEqual(realized.entries.cost.source, "VENFORCE_BASE_HIST");
    assert.strictEqual(realized.entries.cost.origin, "VENFORCE_BASE");
    assert.strictEqual(realized.entries.cost.kind, "REALIZED");
    // Taxa fixa não tem histórico: indisponível no Realizado, nunca a atual.
    assert.strictEqual(realized.values.fixedFee, null);
    assert.ok(realized.unavailable.includes("fixedFee"));
    assert.strictEqual(projected.preset, "projected");
    assert.strictEqual(realized.preset, "realized");
  });

  await test("Base atualizada DEPOIS da venda: Realizado continua com o histórico, Projetado com a atual", () => {
    const item = normalizedItem({
      fields: Object.assign({}, canonicalItem().fields, {
        cost: canonicalField([
          evidence("VENFORCE_BASE", "PROJECTED", 55, "2026-08-11T00:00:00Z"),
          evidence("VENFORCE_BASE", "REALIZED", 38, "2026-08-10T10:00:00Z"),
        ]),
      }),
    });
    assert.strictEqual(api.resolveComposition(item, api.PRESETS.realized).values.cost, 38);
    assert.strictEqual(api.resolveComposition(item, api.PRESETS.projected).values.cost, 55);
  });

  await test("simulação de preço é prospectiva: usa custo/imposto da Base atual, não o histórico da venda", () => {
    const item = normalizedItem();
    assert.strictEqual(item.simulationInputs.cost, 40);
    assert.strictEqual(item.simulationInputs.taxRate, 0.06);
    assert.strictEqual(item.simulationInputs.fixedFee, 0);
  });

  await test("slot = fonte + momento: Base atual e Base na venda são entradas separadas no mapa de fontes", () => {
    const item = normalizedItem();
    assert.deepStrictEqual(item.sources.cost.order, ["VENFORCE_BASE", "VENFORCE_BASE_HIST"]);
    assert.strictEqual(item.sources.cost.entries.VENFORCE_BASE.value, 40);
    assert.strictEqual(item.sources.cost.entries.VENFORCE_BASE.kind, "PROJECTED");
    assert.strictEqual(item.sources.cost.entries.VENFORCE_BASE_HIST.value, 38);
    assert.strictEqual(item.sources.cost.entries.VENFORCE_BASE_HIST.kind, "REALIZED");
    assert.strictEqual(api.slotOf("VENFORCE_BASE", "REALIZED"), "VENFORCE_BASE_HIST");
    assert.strictEqual(api.slotOf("VENFORCE_BASE", "PROJECTED"), "VENFORCE_BASE");
    assert.strictEqual(api.slotOf("MELI_ORDER", "REALIZED"), "MELI_ORDER");
    // A escolha do Motor (realizado tem precedência) aponta para o slot histórico.
    assert.strictEqual(item.motorChoice.cost.source, "VENFORCE_BASE_HIST");
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

  // Linha de /api/margem/composicao como o backend (core.calcularComposicao) devolve.
  function calcRow(id, patch) {
    return Object.assign({
      id: String(id), computavel: true, lc: 14.1, margem_ratio: 0.141, faltando: [], assumido: [], estrito: true,
      delta_lc: null, delta_margem_pp: null, delta_meta_pp: null,
    }, patch || {});
  }

  function customSelection(extra) {
    return Object.assign(api.clonePreset("projected"), { freight: "MELI_ORDER" }, extra || {});
  }

  await test("presets: LC e MC são os do PRÓPRIO item (calculados pelo Motor); nenhum pedido ao backend", () => {
    api.resetCalcs();
    const item = normalizedItem({ margin: { projected: { missing: [], assumed: ["taxRate"] }, realized: { missing: ["fixedFee"], assumed: [] } } });
    const projected = api.resolveComposition(item, api.PRESETS.projected);
    assert.strictEqual(projected.pending, false);
    assert.strictEqual(projected.request, null);
    assert.strictEqual(projected.computable, true);
    assert.strictEqual(projected.margin, item.projected.margin);
    assert.strictEqual(projected.profit, item.projected.profit);
    assert.deepStrictEqual(projected.assumed, ["tax"], "nomes do núcleo viram variáveis da planilha");
    assert.strictEqual(projected.strict, false);
    const realized = api.resolveComposition(item, api.PRESETS.realized);
    assert.strictEqual(realized.margin, item.realized.margin);
    assert.strictEqual(realized.profit, item.realized.profit);
    assert.deepStrictEqual(realized.missing, ["fixedFee"]);
    assert.deepStrictEqual(api.pendingCalcRequests([item], [], api.PRESETS.projected), [], "preset não gera pedido");
  });

  await test("tabela = Composição: a margem da Composição Projetada é a margem projetada do item (inclusive com retorno ML)", () => {
    api.resetCalcs();
    const item = normalizedItem({ projected: { margin: 0.0654, profit: 6.54, rebate: 3.3 } });
    const composition = api.resolveComposition(item, api.PRESETS.projected);
    assert.strictEqual(composition.margin, item.projected.margin);
    assert.strictEqual(composition.profit, item.projected.profit);
    assert.strictEqual(composition.values.rebate, 3.3, "o retorno ML segue indo ao Motor como insumo");
  });

  await test("fonte sem evidência mantém null; seleção personalizada espera o backend e nunca mostra número local", () => {
    api.resetCalcs();
    const item = normalizedItem();
    const selection = Object.assign(api.clonePreset("projected"), { price: "EXTENSION_DOM" });
    const composition = api.resolveComposition(item, selection);
    assert.strictEqual(composition.values.price, null);
    assert.deepStrictEqual(composition.unavailable, ["price"]);
    assert.strictEqual(composition.preset, "custom");
    assert.strictEqual(composition.pending, true);
    assert.strictEqual(composition.computable, false);
    assert.strictEqual(composition.profit, null);
    assert.strictEqual(composition.margin, null);
    assert.strictEqual(composition.request.insumos.preco, null, "ausente segue null (nunca zero)");
    assert.strictEqual(composition.request.insumos.custo, 40);
    // O backend responde que sem preço não há margem.
    api.recordCalcResults([composition.request], [calcRow(0, { computavel: false, lc: null, margem_ratio: null, faltando: ["price"] })]);
    const depois = api.resolveComposition(item, selection);
    assert.strictEqual(depois.pending, false);
    assert.strictEqual(depois.computable, false);
    assert.deepStrictEqual(depois.missing, ["price"]);
    assert.strictEqual(depois.profit, null);
    assert.strictEqual(depois.margin, null);
  });

  await test("seleção personalizada: LC/MC vêm do backend, em lote, sem repetir pedido já feito", () => {
    api.resetCalcs();
    const a = normalizedItem();
    const b = normalizedItem({ itemId: "MLB-V10", identity: { itemId: "MLB-V10", sku: "V10", titulo: "Outro" } });
    const selection = customSelection();
    const pedidos = api.pendingCalcRequests([a, b], [], selection);
    assert.strictEqual(pedidos.length, 1, "a mesma composição de insumos é pedida uma vez");
    assert.deepStrictEqual(pedidos[0].insumos, { preco: 100, custo: 40, aliquota: 0.06, taxa_fixa: 0, comissao: 16.5, frete: 18.7, rebate: null });
    api.markCalcInflight(pedidos);
    assert.deepStrictEqual(api.pendingCalcRequests([a, b], [], selection), [], "pedido a caminho não se repete");
    api.recordCalcResults(pedidos, [calcRow(0, { lc: 18.8, margem_ratio: 0.188 })]);
    const r = api.resolveComposition(a, selection);
    assert.strictEqual(r.pending, false);
    assert.strictEqual(r.computable, true);
    assert.strictEqual(r.profit, 18.8);
    assert.strictEqual(r.margin, 0.188);
    assert.deepStrictEqual(api.pendingCalcRequests([a, b], [], selection), []);
    // Falha do backend: composição indisponível com o motivo, sem tentar de novo em loop.
    const outra = customSelection({ price: "MELI_ORDER" });
    const novo = api.pendingCalcRequests([a], [], outra);
    api.recordCalcFailure(novo, "Cálculo indisponível nesta leitura.");
    const falhou = api.resolveComposition(a, outra);
    assert.strictEqual(falhou.failed, true);
    assert.strictEqual(falhou.computable, false);
    assert.strictEqual(falhou.failureReason, "Cálculo indisponível nesta leitura.");
    assert.strictEqual(falhou.margin, null);
    assert.deepStrictEqual(api.pendingCalcRequests([a], [], outra), []);
  });

  await test("cenário é local: overrides não viram evidência nem alteram o item; o resultado é do backend", () => {
    api.resetCalcs();
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
    const pendente = api.simulateScenario(item, scenario, api.PRESETS.projected);
    assert.strictEqual(pendente.pending, true);
    assert.strictEqual(pendente.computable, false);
    assert.strictEqual(pendente.profit, null, "sem resposta do backend não há número");
    assert.strictEqual(pendente.margin, null);
    assert.strictEqual(pendente.values.price, 150);
    assert.strictEqual(pendente.values.freight, 18.7);
    assert.deepStrictEqual(pendente.changed.slice().sort(), ["freight", "price"]);
    assert.strictEqual(pendente.persisted, false);
    assert.strictEqual(pendente.request.insumos.preco, 150);
    assert.strictEqual(pendente.request.base_insumos.preco, 100, "Δ contra a composição da seleção atual");
    assert.strictEqual(pendente.request.base_insumos.frete, 23.4);
    assert.strictEqual(pendente.request.meta_margem, 0.12);

    api.recordCalcResults([pendente.request], [calcRow(0, { lc: 51, margem_ratio: 0.34, delta_lc: 36.9, delta_margem_pp: 19.9, delta_meta_pp: 22 })]);
    const simulation = api.simulateScenario(item, scenario, api.PRESETS.projected);
    assert.strictEqual(simulation.pending, false);
    assert.strictEqual(simulation.computable, true);
    assert.strictEqual(simulation.profit, 51);
    assert.strictEqual(simulation.margin, 0.34);
    assert.strictEqual(simulation.deltaProfit, 36.9);
    assert.strictEqual(simulation.deltaMarginPp, 19.9);
    assert.strictEqual(simulation.deltaTargetPp, 22);
    // Nada do item foi mutado pela simulação.
    assert.strictEqual(JSON.stringify(item.sources), before);
  });

  await test("cenário sem variável obrigatória: o backend diz o que falta; nada é assumido como zero na tela", () => {
    api.resetCalcs();
    const item = normalizedItem();
    const scenario = {
      price: { source: "MELI_API", value: null, manual: false },
      cost: { source: "VENFORCE_BASE", value: null, manual: true },
      tax: { source: "VENFORCE_BASE", value: null, manual: false },
      commission: { source: "MELI_API", value: null, manual: false },
      freight: { source: "MELI_API", value: null, manual: false },
      fixedFee: { source: "VENFORCE_BASE", value: null, manual: false },
    };
    const pendente = api.simulateScenario(item, scenario, api.PRESETS.projected);
    assert.strictEqual(pendente.request.insumos.custo, null, "custo ausente segue null no pedido");
    api.recordCalcResults([pendente.request], [calcRow(0, { computavel: false, lc: null, margem_ratio: null, faltando: ["cost"] })]);
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

  await test("fila de divergências usa divergência real; o impacto na MC vem do backend", () => {
    api.resetCalcs();
    const item = normalizedItem();
    const pendente = api.divergenceQueue([item], api.PRESETS.projected);
    assert.strictEqual(pendente.length, 1);
    assert.strictEqual(pendente[0].impactPp, null, "sem resposta do backend não há impacto");
    assert.strictEqual(pendente[0].impactPending, true);
    const pedidos = api.pendingCalcRequests([], [item], api.PRESETS.projected);
    assert.strictEqual(pedidos.length, 1);
    assert.strictEqual(pedidos[0].insumos.frete, 18.7, "valor alternativo");
    assert.strictEqual(pedidos[0].base_insumos.frete, 23.4, "composição atual");
    // Frete menor melhora a MC: (23,40 − 18,70) / 100 = +4,7 pp — calculado pelo núcleo.
    api.recordCalcResults(pedidos, [calcRow(0, { delta_margem_pp: 4.7, delta_lc: 4.7 })]);
    const rows = api.divergenceQueue([item], api.PRESETS.projected);
    assert.strictEqual(rows.length, 1);
    const row = rows[0];
    assert.strictEqual(row.variable, "freight");
    assert.strictEqual(row.selectedSource, "MELI_API");
    assert.strictEqual(row.selectedValue, 23.4);
    assert.strictEqual(row.alternativeSource, "MELI_ORDER");
    assert.strictEqual(row.alternativeValue, 18.7);
    assert.strictEqual(row.impactPp, 4.7);
    assert.strictEqual(row.impactPending, false);
    assert.strictEqual(row.type, "DRIFT");
    assert.strictEqual(row.origin, "motor");
    assert.strictEqual(row.severity, "CRITICA", "DRIFT sobe a crítica quando o impacto do backend é material (≥ 2 pp)");
    assert.deepStrictEqual(api.pendingCalcRequests([], [item], api.PRESETS.projected), []);

    // Impacto pequeno: só revisar. Falha do backend: sem comparação, não fica pendente para sempre.
    api.resetCalcs();
    api.recordCalcResults(api.pendingCalcRequests([], [item], api.PRESETS.projected), [calcRow(0, { delta_margem_pp: 0.4 })]);
    assert.strictEqual(api.divergenceQueue([item], api.PRESETS.projected)[0].severity, "REVISAR");
    api.resetCalcs();
    api.recordCalcFailure(api.pendingCalcRequests([], [item], api.PRESETS.projected), "x");
    const falhou = api.divergenceQueue([item], api.PRESETS.projected)[0];
    assert.strictEqual(falhou.impactPp, null);
    assert.strictEqual(falhou.impactPending, false);

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

  await test("client: /api/margem/composicao em lote (POST, escopo da conta, ids por posição, 200 por chamada)", async () => {
    const calls = [];
    const client = api.createClient({
      request(path, options) {
        calls.push({ path, options });
        const itens = options.body.itens.map((entry) => calcRow(entry.id, { lc: Number(entry.id) }));
        return { ok: true, status: 200, data: { ok: true, itens } };
      },
    });
    const pedidos = Array.from({ length: 450 }, (_, i) => ({ insumos: { preco: 100 + i }, base_insumos: i % 2 ? { preco: 1 } : undefined, meta_margem: i === 0 ? 0.1 : undefined }));
    const result = await client.calcularComposicoes({ clienteContaId: 900, requests: pedidos });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.itens.length, 450);
    assert.deepStrictEqual(calls.map((c) => c.options.body.itens.length), [200, 200, 50]);
    assert.ok(calls.every((c) => c.path === "/api/margem/composicao" && c.options.method === "POST" && c.options.body.cliente_conta_id === 900));
    assert.deepStrictEqual(calls[1].options.body.itens[0].id, "200", "id = posição no pedido todo");
    assert.strictEqual(calls[0].options.body.itens[0].meta_margem, 0.1);
    assert.ok(!("base_insumos" in calls[0].options.body.itens[0]));
    assert.deepStrictEqual(calls[0].options.body.itens[1].base_insumos, { preco: 1 });
    // Os resultados casam com os pedidos pela posição.
    api.resetCalcs();
    const subset = pedidos.slice(0, 3).map((p, i) => ({ key: "k" + i }));
    api.recordCalcResults(subset, result.itens.slice(0, 3));
    assert.strictEqual((await client.calcularComposicoes({ clienteContaId: 900, requests: [] })).itens.length, 0);
    const falho = api.createClient({ request: () => ({ ok: false, status: 403, error: "fora da carteira" }) });
    const erro = await falho.calcularComposicoes({ clienteContaId: 1, requests: [{ insumos: {} }] });
    assert.strictEqual(erro.ok, false);
    assert.strictEqual(erro.error, "fora da carteira");
  });

  await test("client: /api/margem/simular (POST por anúncio, escopo da conta; falha vira erro explícito com o payload)", async () => {
    const calls = [];
    const client = api.createClient({
      request(path, options) {
        calls.push({ path, options });
        return { ok: true, status: 200, data: { ok: true, mlb: options.body.mlb, atual: { preco: 110.48 }, cenarios: [{ tipo: "preco", veredito: "entrar" }] } };
      },
    });
    const result = await client.simular({ clienteContaId: 900, mlb: "MLB1", cenarios: [{ tipo: "todas_promos" }, { tipo: "preco_alvo" }] });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.mlb, "MLB1");
    assert.strictEqual(result.cenarios.length, 1);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].path, "/api/margem/simular");
    assert.strictEqual(calls[0].options.method, "POST");
    assert.deepStrictEqual(calls[0].options.body, { cliente_conta_id: 900, mlb: "MLB1", cenarios: [{ tipo: "todas_promos" }, { tipo: "preco_alvo" }] });
    const falho = api.createClient({ request: () => ({ ok: false, status: 403, error: "fora da carteira", data: { code: "FORA_DA_CARTEIRA" } }) });
    const erro = await falho.simular({ clienteContaId: 1, mlb: "MLB1", cenarios: [{ tipo: "preco", preco: 10 }] });
    assert.strictEqual(erro.ok, false);
    assert.strictEqual(erro.status, 403);
    assert.strictEqual(erro.error, "fora da carteira");
  });

  await test("a tela não tem fórmula financeira: nada de computeMargin/simulatePrice nem conta de lucro no código", () => {
    const fs = require("fs");
    const path = require("path");
    for (const arquivo of ["central-margem-api.js", "central-margem.js"]) {
      const codigo = fs.readFileSync(path.join(__dirname, arquivo), "utf8")
        .split("\n").filter((linha) => !/^\s*(\/\/|\*|\/\*)/.test(linha)).join("\n");
      const proibidos = [
        [/computeMargin|simulatePrice|legacySimulate|adaptLegacyResponse|normalizeLegacyItem/, "motor/adapter local"],
        [/\.price\s*\*|price\s*\*\s*(tax|commission|rate)|\*\s*(tax|commission)Rate|\*\s*resolved\./i, "preço × taxa"],
        [/profit\s*\/\s*(price|sold|resolved)|margin\s*=\s*profit|\bmargin\s*[-+]\s*\w+\.margin/, "lucro ÷ preço / diferença de margens"],
        [/(price|preco)\s*-\s*(cost|custo|freight|frete|commission|comissao)\b/i, "preço − custos"],
        [/\.raw\.(profit|margin)/, "margem bruta local"],
        [/>\s*1\s*\?/, "heurística de escala"],
      ];
      for (const [regex, rotulo] of proibidos) {
        const achado = codigo.split("\n").filter((linha) => regex.test(linha));
        assert.deepStrictEqual(achado, [], `${arquivo}: ${rotulo}`);
      }
    }
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

  // ── Leitura persistida (Margin Snapshot) ─────────────────────────────────

  await test("snapshot: resumo desabilitado vira enabled:false (a tela segue o workspace ao vivo)", () => {
    assert.deepStrictEqual(api.normalizeSnapshotResumo({ ok: true, habilitado: false, modo: "legacy" }), { ok: true, enabled: false });
  });

  await test("snapshot: resumo 'missing' mantém totais e KPIs nulos (nunca zero)", () => {
    const r = api.normalizeSnapshotResumo({
      ok: true, habilitado: true, estado: "missing", acao: "refresh", mensagem: "sem leitura",
      snapshot: { totalItens: null, ultimoCalculoEm: null, foraDoCatalogo: null }, kpis: null,
      refresh: { runAtivo: null, ultimoRun: null },
    });
    assert.strictEqual(r.state, "missing");
    assert.strictEqual(r.action, "refresh");
    assert.strictEqual(r.totalItems, null);
    assert.strictEqual(r.kpis, null);
  });

  await test("snapshot: resumo 'ready' normaliza KPIs por status e o run ativo", () => {
    const r = api.normalizeSnapshotResumo({
      ok: true, habilitado: true, estado: "ready", snapshot: { totalItens: 10, ultimoCalculoEm: "2026-09-27T10:00:00Z", foraDoCatalogo: 2 },
      kpis: { total: 10, porStatus: { HEALTHY: 6, LOSS: 4 }, porRefreshStatus: { fresh: 9, failed: 1 }, anuncios: { total: 10, ativos: 7, pausados: 3 }, comMargem: 10 },
      refresh: { runAtivo: { runId: 7, status: "running", totalItems: 5000, processedItems: 820 }, ultimoRun: null },
    });
    assert.strictEqual(r.kpis.total, 10);
    assert.strictEqual(r.kpis.counts.HEALTHY, 6);
    assert.strictEqual(r.kpis.counts.LOW_MARGIN, 0);
    assert.deepStrictEqual(r.kpis.listings, { total: 10, active: 7, paused: 3 });
    assert.strictEqual(r.outsideCatalog, 2);
    assert.strictEqual(r.activeRun.processedItems, 820);
    assert.strictEqual(r.activeRun.totalItems, 5000);
  });

  await test("snapshot: página normalizada pelo MESMO normalizador canônico (fontes/variáveis) + paginação do servidor", () => {
    const evidence = (source, value) => ({ source, kind: "PROJECTED", value, quality: "MEASURED", observedAt: "2026-09-27T10:00:00Z" });
    const field = (e) => ({ present: true, selectedValue: e.value, selectedSource: e.source, selectedKind: "PROJECTED", projected: e, realized: null, evidences: [e], divergences: [] });
    const payload = {
      estado: "ready",
      paginacao: { page: 3, limit: 20, total: 5000, totalPaginas: 250 },
      itens: [{
        itemId: "MLB1", titulo: "Produto 1", sku: "S1", status: "LOSS", confidence: "HIGH",
        fields: { price: field(evidence("MELI_API", 100)), cost: field(evidence("VENFORCE_BASE", 90)) },
        projected: { margin: -0.1, profit: -10 }, realized: { margin: null, profit: null, pending: true },
        quality: { statusReasons: ["Margem negativa."] }, diagnostico: { statusAnuncio: "paused" },
        snapshot: { refreshStatus: "failed", lastError: "ML 503" }, statusBase: "projected",
      }],
      refresh: { runAtivo: null, ultimoRun: { runId: 3, status: "completed" } },
    };
    const r = api.normalizeSnapshotItens(payload, context());
    assert.strictEqual(r.sourceMode, "snapshot");
    assert.strictEqual(r.pagination.page, 3);
    assert.strictEqual(r.pagination.total, 5000);
    assert.strictEqual(r.pagination.totalPages, 250);
    assert.strictEqual(r.items.length, 1);
    assert.strictEqual(r.items[0].sources.price.entries.MELI_API.value, 100);
    assert.strictEqual(r.items[0].variables.cost.value, 90);
    assert.strictEqual(r.items[0].snapshot.refreshStatus, "failed");
    assert.strictEqual(r.items[0].statusAnuncio, "paused");
    assert.strictEqual(r.refresh.lastRun.status, "completed");
  });

  await test("snapshot: filtros da planilha viram status canônicos; combinação impossível = []", () => {
    assert.strictEqual(api.snapshotStatusFilter("", ""), null);
    assert.deepStrictEqual(api.snapshotStatusFilter("LOSS", ""), ["LOSS"]);
    assert.deepStrictEqual(api.snapshotStatusFilter("", "RELIABLE"), ["HEALTHY", "LOW_MARGIN", "LOSS"]);
    assert.deepStrictEqual(api.snapshotStatusFilter("LOSS", "RELIABLE"), ["LOSS"]);
    assert.deepStrictEqual(api.snapshotStatusFilter("UNKNOWN", "MISSING"), ["UNVALIDATED"]);
    assert.deepStrictEqual(api.snapshotStatusFilter("LOSS", "SUSPECT"), []);
    assert.strictEqual(api.isRunTerminal("completed"), true);
    assert.strictEqual(api.isRunTerminal("failed"), true);
    assert.strictEqual(api.isRunTerminal("running"), false);
  });

  await test("snapshot: client monta as rotas por conta (resumo, página, refresh 202, status) sem carregar o catálogo", async () => {
    const calls = [];
    const client = api.createClient({
      request(pathQuery, options) {
        calls.push({ path: pathQuery, method: options.method || "GET", body: options.body });
        if (pathQuery.includes("/snapshot/resumo")) return { ok: true, status: 200, data: { ok: true, habilitado: true, estado: "ready", kpis: null, refresh: {} } };
        if (pathQuery.includes("/snapshot/itens")) return { ok: true, status: 200, data: { ok: true, estado: "ready", itens: [], paginacao: { page: 2, limit: 50, total: 0 } } };
        if (pathQuery.endsWith("/snapshot/refresh")) return { ok: true, status: 202, data: { ok: true, runId: 9, reaproveitado: true, run: { runId: 9, status: "running" } } };
        if (pathQuery.includes("/snapshot/refresh/9")) return { ok: true, status: 200, data: { ok: true, run: { runId: 9, status: "completed", processedItems: 5000, totalItems: 5000 } } };
        throw new Error(`rota inesperada: ${pathQuery}`);
      },
    });
    await client.getSnapshotResumo({ clientSlug: "loja-teste", clienteContaId: 900 });
    await client.getSnapshotItens({ clientSlug: "loja-teste", clienteContaId: 900, page: 2, limit: 50, status: ["LOSS", "LOW_MARGIN"], statusAnuncio: "paused", search: "kit" });
    const refresh = await client.requestSnapshotRefresh({ clientSlug: "loja-teste", clienteContaId: 900 });
    const status = await client.getSnapshotRefreshStatus({ clientSlug: "loja-teste", clienteContaId: 900, runId: 9 });

    assert.ok(calls[0].path.startsWith("/operacao/central-margem/loja-teste/snapshot/resumo?"));
    assert.ok(calls[0].path.includes("clienteContaId=900"));
    const itensPath = calls[1].path;
    assert.ok(itensPath.startsWith("/operacao/central-margem/loja-teste/snapshot/itens?"));
    for (const trecho of ["clienteContaId=900", "page=2", "limit=50", "status=LOSS%2CLOW_MARGIN", "statusAnuncio=paused", "busca=kit"]) {
      assert.ok(itensPath.includes(trecho), `falta ${trecho} em ${itensPath}`);
    }
    assert.strictEqual(calls[2].method, "POST");
    assert.deepStrictEqual(calls[2].body, { clienteContaId: 900 });
    assert.strictEqual(refresh.reused, true);
    assert.ok(calls[3].path.includes("/snapshot/refresh/9?clienteContaId=900"));
    assert.strictEqual(status.run.status, "completed");
    assert.ok(!calls.some((c) => c.path.includes("/workspace")), "modo persistido nunca pede o workspace ao vivo");
  });

  // =========================================================================
  // Projetado × Realizado, período e realizado da conta
  // =========================================================================

  await test("comparação do Motor é normalizada sem recalcular (null preservado, taxa fixa não comparável)", () => {
    const item = normalizedItem({
      projectedVsRealized: {
        status: "COMPARABLE",
        projected: { price: 100, commission: 16, freight: 18, cost: 45, taxRate: 0.03, fixedFee: 2, profit: 16, margin: 0.16, marginPercent: 16, computable: true, assumed: [] },
        realized: { available: true, price: 96.4, commission: 16.8, freight: 21.3, cost: 44.5, taxRate: 0.03, fixedFee: null, profit: 10.91, margin: 0.113154, marginPercent: 11.32, computable: true, assumed: ["fixedFee"], missing: [], units: 73, orders: 62, revenue: 7037.2, lastSaleAt: "2026-09-20", totalProfit: 796.43, coverage: { frete: { linhas: 3, linhasComValor: 2, fracao: 0.6667, completa: false } } },
        drift: { price: -3.6, commission: 0.8, freight: 3.3, cost: -0.5, taxRate: 0, taxRatePp: 0, fixedFee: null, profit: -5.09, marginPercentagePoints: -4.68 },
        notComparable: [{ field: "fixedFee", reason: "SEM_HISTORICO", projectedValue: 2 }],
      },
      sales: { hasOrders: true, unidades: 73, pedidos: 62, receita: 7037.2, precoMedio: 96.4, cobertura: { frete: { completa: false } }, reembolso: { total: 5, pedidos: 1 }, resultadoPersistido: 800, resultadoRecalculado: 796.43 },
    });
    const cmp = item.comparison;
    assert.strictEqual(cmp.status, "COMPARABLE");
    assert.strictEqual(cmp.drift.marginPp, -4.68);
    assert.strictEqual(cmp.drift.freight, 3.3);
    assert.strictEqual(cmp.drift.fixedFee, null);
    assert.strictEqual(cmp.realized.fixedFee, null, "sem histórico continua null");
    assert.strictEqual(cmp.realized.units, 73);
    assert.strictEqual(cmp.realized.coverage.frete.fracao, 0.6667);
    assert.deepStrictEqual(cmp.notComparable, [{ field: "fixedFee", reason: "SEM_HISTORICO", projectedValue: 2 }]);
    assert.strictEqual(item.sales.avgPrice, 96.4);
    assert.deepStrictEqual(item.sales.refund, { total: 5, pedidos: 1 });
    assert.strictEqual(item.sales.persistedResult, 800);
    // Sem o bloco (backend antigo): null, nunca uma comparação inventada.
    assert.strictEqual(normalizedItem().comparison, null);
  });

  await test("comparação com retorno ML em andamento: a MESMA margem do header, retorno em linha própria, embutido no realizado sem somar de novo", () => {
    const item = normalizedItem({
      projected: { margin: 0.21, profit: 21, rebate: 5 },
      projectedVsRealized: {
        status: "COMPARABLE",
        projected: { price: 100, commission: 16, freight: 18, cost: 45, taxRate: 0.03, fixedFee: 2, profit: 21, margin: 0.21, marginPercent: 21, computable: true, assumed: [], rebate: 5, rebateMotivo: null },
        realized: { available: true, price: 100, commission: 11, freight: 18, cost: 45, taxRate: 0.03, fixedFee: null, profit: 23, margin: 0.23, marginPercent: 23, computable: true, assumed: [], missing: [], units: 1, orders: 1, revenue: 100, lastSaleAt: "2026-09-10", totalProfit: 23, coverage: null, rebateEmbutido: 5 },
        drift: { price: 0, commission: 0, freight: 0, cost: 0, taxRate: 0, taxRatePp: 0, fixedFee: null, profit: 2, marginPercentagePoints: 2 },
        notComparable: [],
      },
    });
    const cmp = item.comparison;
    assert.strictEqual(cmp.projected.margin, item.projected.margin, "painel = header, nunca dois números diferentes");
    assert.strictEqual(cmp.projected.rebate, 5);
    assert.strictEqual(cmp.projected.rebateMotivo, null);
    assert.strictEqual(cmp.realized.rebateEmbutido, 5, "informativo: nunca somado de novo");
    assert.strictEqual(cmp.drift.commission, 0, "desvio like-for-like");
  });

  await test("comparação com REBATE_AMBIGUO: motivo repassado, sem número de retorno (não adivinha)", () => {
    const item = normalizedItem({
      projectedVsRealized: {
        status: "COMPARABLE",
        projected: { price: 100, commission: 16, freight: 18, cost: 45, taxRate: 0.03, fixedFee: 2, profit: 16, margin: 0.16, marginPercent: 16, computable: true, assumed: [], rebate: null, rebateMotivo: "REBATE_AMBIGUO" },
        realized: { available: true, price: 100, commission: 11, freight: 18, cost: 45, taxRate: 0.03, fixedFee: null, profit: 18, margin: 0.18, marginPercent: 18, computable: true, assumed: [], missing: [], units: 1, orders: 1, revenue: 100, lastSaleAt: "2026-09-10", totalProfit: 18, coverage: null, rebateEmbutido: null },
        drift: { price: 0, commission: -5, freight: 0, cost: 0, taxRate: 0, taxRatePp: 0, fixedFee: null, profit: 2, marginPercentagePoints: 2 },
        notComparable: [],
      },
    });
    const cmp = item.comparison;
    assert.strictEqual(cmp.projected.rebate, null);
    assert.strictEqual(cmp.projected.rebateMotivo, "REBATE_AMBIGUO");
    assert.strictEqual(cmp.realized.rebateEmbutido, null);
  });

  await test("realizado da conta: KPIs, cobertura e freshness normalizados; flag desligada = enabled false", () => {
    const r = api.normalizeSnapshotRealizado({
      ok: true, habilitado: true,
      periodo: { dateFrom: "2026-08-29", dateTo: "2026-09-27", modo: "ultimos30", periodo: null, rotulo: "Últimos 30 dias (até 27/09/2026)" },
      cobertura: { estado: "PARCIAL", origem: "published", sincronizadoAte: "2026-09-27", ultimaPublicacaoEm: "2026-09-28T06:10:00.000Z", meses: 2, mesesComImport: 1,
        lacunas: [{ competencia: "2026-09", segmento: { dateFrom: "2026-09-01", dateTo: "2026-09-28" }, motivo: "COBERTURA_INSUFICIENTE", publicadoDe: "2026-09-01", publicadoAte: "2026-09-27", publicadoEm: "x" }] },
      freshness: { estado: "PARCIAL", sincronizadoAte: "2026-09-27", ultimaPublicacaoEm: "2026-09-28T06:10:00.000Z", syncEmAndamento: true, syncAtivo: { runId: 7 } },
      kpis: { receita: 1220, receitaSemMlb: 20, unidades: 14, pedidos: 4, produtosComVenda: 3, lucro: { valor: 410, produtos: 2 },
        margem: { percent: 37.27, estado: "parcial", coberturaReceita: 0.9016, produtosCalculaveis: 2, produtosSemMargem: 1, produtosEstimados: 0, semMargemPorMotivo: { cost: 1 } },
        drift: { disponivel: true, pp: -4.55, margemRealizadaMixPercent: 37.27, margemProjetadaMixPercent: 41.82, produtosComparados: 2, limitePp: 2, produtosNegativos: 1, piores: [{ itemId: "MLB1", driftPp: -5 }] } },
    });
    assert.strictEqual(r.enabled, true);
    assert.strictEqual(r.period.label, "Últimos 30 dias (até 27/09/2026)");
    assert.strictEqual(r.coverage.state, "PARCIAL");
    assert.strictEqual(r.coverage.gaps[0].publishedUntil, "2026-09-27");
    assert.strictEqual(r.freshness.syncInProgress, true);
    assert.strictEqual(r.kpis.orders, 4);
    assert.strictEqual(r.kpis.margin.percent, 37.27);
    assert.strictEqual(r.kpis.margin.state, "parcial");
    assert.strictEqual(r.kpis.drift.pp, -4.55);
    assert.strictEqual(r.kpis.drift.worst[0].itemId, "MLB1");
    assert.deepStrictEqual(api.normalizeSnapshotRealizado({ ok: true, habilitado: false }), { ok: true, enabled: false });
  });

  await test("snapshot: período vem do SERVIDOR; client manda periodo=YYYY-MM e nunca inventa datas", async () => {
    const calls = [];
    const client = api.createClient({
      request(pathQuery) {
        calls.push(pathQuery);
        if (pathQuery.includes("/snapshot/itens")) {
          return { ok: true, status: 200, data: { ok: true, estado: "ready", itens: [], paginacao: { page: 1, limit: 50, total: 0 },
            periodo: { dateFrom: "2026-08-01", dateTo: "2026-08-31", modo: "mes", periodo: "2026-08", rotulo: "agosto/2026" },
            vendas: { sincronizado: true, pedidosNoPeriodo: 0, cobertura: { estado: "ATUAL", sincronizadoAte: "2026-08-31", lacunas: [] } } } };
        }
        if (pathQuery.includes("/snapshot/realizado")) return { ok: true, status: 200, data: { ok: true, habilitado: true, kpis: {} } };
        throw new Error(`rota inesperada: ${pathQuery}`);
      },
    });
    const page = await client.getSnapshotItens({ clientSlug: "loja-teste", clienteContaId: 900, periodo: "2026-08" });
    assert.ok(calls[0].includes("periodo=2026-08"), calls[0]);
    assert.ok(!calls[0].includes("dateFrom"), "sem período personalizado, o browser não calcula datas");
    assert.deepStrictEqual([page.period.inicio, page.period.fim, page.period.mode, page.period.label], ["2026-08-01", "2026-08-31", "mes", "agosto/2026"]);
    assert.strictEqual(page.salesCoverage.state, "ATUAL");

    await client.getSnapshotItens({ clientSlug: "loja-teste", clienteContaId: 900 });
    assert.ok(!calls[1].includes("periodo=") && !calls[1].includes("dateTo="), "padrão resolvido no servidor: " + calls[1]);

    await client.getSnapshotRealizado({ clientSlug: "loja-teste", clienteContaId: 900, periodo: "2026-08" });
    assert.ok(calls[2].startsWith("/operacao/central-margem/loja-teste/snapshot/realizado?"), calls[2]);
    assert.ok(calls[2].includes("clienteContaId=900") && calls[2].includes("periodo=2026-08"), calls[2]);
  });

  await test("workspace ao vivo (legado): período padrão termina ONTEM (o que o sync publica)", async () => {
    const calls = [];
    const client = api.createClient({
      request(pathQuery) {
        calls.push(pathQuery);
        return { ok: true, status: 200, data: { ok: true, itens: [], resumo: {}, cobertura: {} } };
      },
    });
    await client.getWorkspace({ clientSlug: "loja-teste" });
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    const iso = ontem.getFullYear() + "-" + String(ontem.getMonth() + 1).padStart(2, "0") + "-" + String(ontem.getDate()).padStart(2, "0");
    assert.ok(calls[0].includes("dateTo=" + iso), `${calls[0]} deveria terminar em ${iso}`);
  });

  await test("razões não têm heurística de escala: fração passa intacta, fora da faixa vira null + motivo", () => {
    const sink = [];
    assert.strictEqual(api.checkedRatio(-1.1309, "margin", "Margem projetada", sink), -1.1309, "prejuízo > 100% é válido, não é percentual");
    assert.strictEqual(api.checkedRatio(0.0425, "margin", "Margem projetada", sink), 0.0425);
    assert.strictEqual(api.checkedRatio(0.15, "rate", "Alíquota", sink), 0.15);
    assert.strictEqual(api.checkedRatio(null, "rate", "Alíquota", sink), null);
    assert.deepStrictEqual(sink, []);
    assert.strictEqual(api.checkedRatio(15, "rate", "Alíquota de imposto", sink), null, "15 NÃO vira 0,15 em silêncio");
    assert.strictEqual(api.checkedRatio(12, "target", "Meta de margem", sink), null);
    assert.strictEqual(api.checkedRatio(113.09, "margin", "Margem projetada", sink), null);
    assert.strictEqual(sink.length, 3);
    assert.ok(/Alíquota de imposto fora da faixa esperada.*15/.test(sink[0].reason), sink[0].reason);
  });

  await test("item: margem −1,1309 do backend chega intacta; alíquota 15 invalida o campo, rebaixa a integridade e explica o motivo", () => {
    const ok = normalizedItem({ projected: { margin: -1.1309, profit: -113.09 } });
    assert.strictEqual(ok.projected.margin, -1.1309);
    assert.deepStrictEqual(ok.invalidFields, []);

    const ruim = normalizedItem({
      projected: { margin: 150, profit: 1 },
      targetMargin: 12,
      fields: Object.assign({}, canonicalItem().fields, {
        taxRate: canonicalField([evidence("VENFORCE_BASE", "PROJECTED", 15, "2026-06-01T00:00:00Z")]),
      }),
    });
    assert.strictEqual(ruim.projected.margin, null);
    assert.strictEqual(ruim.targetMargin, null);
    assert.strictEqual(ruim.variables.tax.value, null);
    assert.strictEqual(ruim.variables.tax.available, false);
    assert.ok(ruim.invalidFields.length >= 3, JSON.stringify(ruim.invalidFields));
    assert.ok(ruim.problem && ruim.problem.includes("fora da faixa"), ruim.problem);
    assert.strictEqual(api.dataIntegrity(ruim).key, "SUSPECT");
  });

  await test("integridade custo_suspeito vem do Motor: mesmo com status LOSS persistido, a integridade é SUSPECT com código e motivo", () => {
    const item = normalizedItem({
      status: "LOSS",
      projected: { margin: -1.1309, profit: -113.09 },
      quality: { confidence: "HIGH", confidenceByField: {}, integrityCode: "custo_suspeito", integrityReason: "Custo (R$ 171.09) igual ou acima do preço (R$ 100.00)." },
    });
    const integridade = api.dataIntegrity(item);
    assert.strictEqual(integridade.key, "SUSPECT");
    assert.strictEqual(integridade.code, "custo_suspeito");
    assert.ok(integridade.reason.includes("171.09"), integridade.reason);
    assert.strictEqual(item.projected.margin, -1.1309);
    assert.strictEqual(api.dataIntegrity(normalizedItem({ status: "LOSS" })).code, undefined, "sem código do Motor não inventa custo_suspeito");
  });

  console.log(`# ${passed} testes concluídos`);
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
