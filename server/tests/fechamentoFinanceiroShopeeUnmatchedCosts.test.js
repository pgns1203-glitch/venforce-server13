// server/tests/fechamentoFinanceiroShopeeUnmatchedCosts.test.js
// Diagnóstico tipado de itens sem custo (unmatchedCosts) — correção pequena
// e aditiva de apresentação. unmatchedIds (legado, mistura SKU e ID sem
// dizer o tipo) é preservado por compatibilidade; unmatchedCosts é o novo
// campo com { type, value, sku, reason }.
//
// Nenhum valor financeiro (receita, taxa, LC, MC) muda com esta correção —
// só COMO a pendência de custo é descrita.

const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function loadWithXlsxStub(request, parent, isMain) {
  if (request === "xlsx") {
    return { utils: { aoa_to_sheet: () => ({}), json_to_sheet: () => ({}) } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  processShopeeFinancialOrders,
  describeShopeeCostGap,
} = require("../services/fechamentoFinanceiro/shopeeOrderAllService");
const {
  processShopee,
  buildShopeeCostMap,
  buildShopeeCostBridge,
} = require("../services/fechamentoFinanceiro/shopeePerformanceService");

Module._load = originalLoad;

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, label);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.strictEqual(actual, expected, `${label}: ${actual} !== ${expected}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

function linhaOrderAll(overrides) {
  return {
    "ID do pedido": "PED-1",
    "Status do pedido": "Concluído",
    "Status da Devolução / Reembolso": "",
    "Nome do Produto": "Produto",
    "Nº de referência do SKU principal": "",
    "Número de referência SKU": "",
    Quantidade: 1,
    "Preço acordado": 0,
    "Subtotal do produto": 0,
    "Taxa de transação": "",
    "Taxa de comissão líquida": "",
    "Taxa de serviço líquida": "",
    "Valor estimado do frete": "",
    Imposto: "",
    CMV: "",
    ...overrides,
  };
}

function linhaPerformance(overrides) {
  return {
    "ID do Item": "",
    Produto: "Produto",
    "Status Atual do Item": "Normal",
    "ID da Variação": "-",
    "Nome da Variação": "-",
    "Status Atual da Variação": "-",
    "SKU da Variação": "-",
    "SKU Principle": "",
    "Vendas (Pedido pago) (BRL)": 0,
    "Unidades (Pedido pago)": 0,
    "Impressão do Produto": 0,
    "Cliques Por Produto": 0,
    CTR: "0%",
    ...overrides,
  };
}

// ── Caso 1 — SKU → performance → ID → base MISS: mostra o ID resolvido ────
console.log("\n▸ Caso 1 — ID resolvido pela ponte, mas ausente na base de custos");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "P-1",
      "Nº de referência do SKU principal": "5470",
      "Subtotal do produto": 100,
      "Preço acordado": 100,
      "Taxa de comissão líquida": 10,
    }),
  ];
  const performance = [
    linhaPerformance({ "ID do Item": "58259874628", "ID da Variação": "189188911747", "SKU Principle": "5470" }),
  ];
  // Base SEM a variação/item resolvidos pela ponte — MISS na base.
  const costRows = [{ sku: "OUTRO-SKU-QUALQUER", Custo: 30, imposto: 0 }];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("1 pendência", r.unmatchedCosts.length, 1);
  const item = r.unmatchedCosts[0];
  eq("tipo é ID da variação (prioridade sobre item)", item.type, "variation_id");
  eq("mostra o ID resolvido pela ponte, não o SKU", item.value, "189188911747");
  eq("motivo: achou na performance, não achou na base", item.reason, "not_found_in_cost_base");
  eq("SKU de origem é informado à parte, não misturado no value", item.sku, "5470");

  // unmatchedIds legado continua existindo, sem quebrar compatibilidade.
  ok("unmatchedIds legado preservado", Array.isArray(r.unmatchedIds) && r.unmatchedIds.length === 1);

  // Confere prioridade: se só houver ID do Item (sem variação), usa item_id.
  const performanceSoItem = [
    linhaPerformance({ "ID do Item": "77000000001", "ID da Variação": "-", "SKU Principle": "5470" }),
  ];
  const rItem = processShopee(performanceSoItem, costRows, 0, 0, 0, orderAll);
  eq("sem variação, cai para item_id", rItem.unmatchedCosts[0].type, "item_id");
  eq("ID do item mostrado", rItem.unmatchedCosts[0].value, "77000000001");
}

// ── Caso 2 — SKU não encontrado na performance ─────────────────────────────
console.log("\n▸ Caso 2 — SKU do Order.all não existe na planilha de performance");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "P-2",
      "Nº de referência do SKU principal": "5127-V-0",
      "Subtotal do produto": 80,
      "Preço acordado": 80,
      "Taxa de comissão líquida": 8,
    }),
  ];
  // Performance existe, mas não tem esse SKU — a ponte não encontra nada.
  const performance = [
    linhaPerformance({ "ID do Item": "999999", "SKU Principle": "OUTRO-SKU" }),
  ];
  const costRows = [{ id: "999999", Custo: 30, imposto: 0 }];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("1 pendência", r.unmatchedCosts.length, 1);
  const item = r.unmatchedCosts[0];
  eq("tipo é SKU (não achou ID nenhum)", item.type, "sku");
  eq("mostra o SKU tentado", item.value, "5127-V-0");
  eq("motivo é 'não encontrado na performance'", item.reason, "not_found_in_performance_bridge");
  eq("sku de diagnóstico é o próprio valor", item.sku, "5127-V-0");
}

// ── Caso 3 — receita sem custo continua no faturamento ────────────────────
console.log("\n▸ Caso 3 — receita sem custo permanece no faturamento total");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "P-3",
      "Nome do Produto": "Com custo",
      "Nº de referência do SKU principal": "SKU-OK",
      "Subtotal do produto": 100,
      "Preço acordado": 100,
      "Taxa de comissão líquida": 10,
    }),
    linhaOrderAll({
      "ID do pedido": "P-4",
      "Nome do Produto": "Sem custo",
      "Nº de referência do SKU principal": "SKU-SEM-PERF",
      "Subtotal do produto": 50,
      "Preço acordado": 50,
      "Taxa de comissão líquida": 5,
    }),
  ];
  const costMap = buildShopeeCostMap([{ sku: "SKU-OK", Custo: 40, imposto: 0 }]);
  const r = processShopeeFinancialOrders({ salesRowsRaw: orderAll, costMap });

  eq("faturamento bruto inclui as duas linhas", r.summary.grossRevenueTotal, 150);
  eq("receita com custo é só a linha resolvida", r.summary.revenueWithCost, 100);
  eq("receita sem custo é a linha sem match", r.summary.revenueWithoutCost, 50);
  eq("ignoredRevenue reflete a mesma receita sem custo", r.ignoredRevenue, 50);
  eq("1 pendência de custo", r.unmatchedCosts.length, 1);
  eq("pendência é do SKU sem match", r.unmatchedCosts[0].value, "SKU-SEM-PERF");
  eq("motivo é 'sem ponte disponível'", r.unmatchedCosts[0].reason, "not_found_direct");
}

// ── Caso 4 — nenhum cálculo financeiro muda com o diagnóstico novo ────────
console.log("\n▸ Caso 4 — LC/MC/receita idênticos ao comportamento anterior");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "P-5",
      "Nome do Produto": "Item A",
      "Nº de referência do SKU principal": "SKU-A",
      "Subtotal do produto": 120,
      "Preço acordado": 120,
      "Taxa de transação": 1.2,
      "Taxa de comissão líquida": 12,
      "Taxa de serviço líquida": 6,
    }),
    linhaOrderAll({
      "ID do pedido": "P-6",
      "Nome do Produto": "Item sem custo",
      "Nº de referência do SKU principal": "SKU-B",
      "Subtotal do produto": 60,
      "Preço acordado": 60,
      "Taxa de comissão líquida": 6,
    }),
  ];
  const costMap = buildShopeeCostMap([{ sku: "SKU-A", Custo: 30, imposto: 10 }]);

  const r = processShopeeFinancialOrders({ salesRowsRaw: orderAll, costMap });

  // Receita líquida = bruta − transação − comissão − serviço = 120 − 1,2 − 12 − 6 = 100,80.
  const linhaA = r.detailedRows.find((row) => row["ID do pedido"] === "P-5");
  eq("receita bruta inalterada", linhaA["Receita bruta"], 120);
  eq("receita líquida inalterada", linhaA["Receita líquida"], 100.8);
  eq("CMV inalterado", linhaA.CMV, 30);
  eq("Imposto inalterado", linhaA.Imposto, round2(120 * 0.1));
  eq("LC inalterado", linhaA.LC, round2(100.8 - 30 - 12));
  eq("summary.contributionProfitTotal inalterado", r.summary.contributionProfitTotal, round2(100.8 - 30 - 12));
  eq("summary.finalResult inalterado", r.summary.finalResult, round2(100.8 - 30 - 12));

  // Mesmo teste, agora com uma base de custos vazia (Map) — só muda o
  // diagnóstico, não a fórmula.
  const rSemBase = processShopeeFinancialOrders({ salesRowsRaw: orderAll, costMap: new Map() });
  eq("sem base: receita bruta idêntica", rSemBase.summary.grossRevenueTotal, r.summary.grossRevenueTotal);
  eq("sem base: nenhum LC calculado (custo ausente para tudo)", rSemBase.summary.contributionProfitTotal, 0);
  ok("unmatchedCosts tem uma pendência por linha sem custo", rSemBase.unmatchedCosts.length === 2);
}

// ── Caso ambíguo, ponta a ponta — nunca mostra SKU, só os IDs conflitantes ─
console.log("\n▸ Caso ambíguo (real) — unmatchedCosts mostra os IDs conflitantes, não o SKU");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "P-AMB",
      "Nº de referência do SKU principal": "7862",
      "Subtotal do produto": 180,
      "Preço acordado": 180,
      "Taxa de comissão líquida": 18,
    }),
  ];
  // Caso real do cliente: o mesmo SKU aparece em dois itens com custos diferentes.
  const performance = [
    linhaPerformance({ "ID do Item": "16256858358", "SKU Principle": "7862", Produto: "Par de Discos" }),
    linhaPerformance({ "ID do Item": "58253291069", "SKU Principle": "7862", Produto: "Kit 4 Discos" }),
  ];
  const costRows = [
    { id: "16256858358", Custo: 45, imposto: 14.5 },
    { id: "58253291069", Custo: 180, imposto: 14.5 },
  ];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("1 pendência ambígua", r.unmatchedCosts.length, 1);
  const item = r.unmatchedCosts[0];
  eq("tipo é ambiguous_ids", item.type, "ambiguous_ids");
  eq("sku nunca aparece no diagnóstico ambíguo", item.sku, null);
  ok("value não contém o texto 'SKU'", !String(item.value).includes("SKU"));
  ok(
    "os dois IDs conflitantes aparecem em candidates",
    item.candidates.includes("16256858358") && item.candidates.includes("58253291069")
  );
  eq("value é a junção legível dos candidatos", item.value, item.candidates.join(", "));

  // Financeiro continua intocado: mesmos números do teste de ambiguidade original.
  eq("faturamento preservado", r.summary.grossRevenueTotal, 180);
  eq("LC continua nulo na linha ambígua", r.detailedRows[0].LC, null);
  eq("bridgeAmbiguousCount inalterado", r.summary.bridgeAmbiguousCount, 1);
}

// ── describeShopeeCostGap isolado (unidade) ────────────────────────────────
console.log("\n▸ describeShopeeCostGap — unidade");
{
  const line = { variationId: "", itemId: "", skuVariation: "SKU-Z", sku: "SKU-Z" };

  const semBridge = describeShopeeCostGap(line, { costRow: null, bridgeUsed: false, ambiguous: false }, "PED-X");
  eq("sem ponte usa skuVariation e reason not_found_direct", semBridge.type, "sku");
  eq("valor é o SKU direto", semBridge.value, "SKU-Z");
  eq("reason correto", semBridge.reason, "not_found_direct");

  const bridgeMiss = describeShopeeCostGap(
    line,
    { costRow: null, bridgeUsed: true, bridgeIds: null, skuTried: "SKU-Z", ambiguous: false },
    "PED-X"
  );
  eq("bridge miss vira tipo sku", bridgeMiss.type, "sku");
  eq("reason correto para SKU não achado na performance", bridgeMiss.reason, "not_found_in_performance_bridge");

  const bridgeFoundBaseMiss = describeShopeeCostGap(
    line,
    {
      costRow: null,
      bridgeUsed: true,
      bridgeIds: { variationIds: ["V1", "V2"], itemIds: ["I1"] },
      bridgeSku: "SKU-Z",
      ambiguous: false,
    },
    "PED-X"
  );
  eq("variação tem prioridade sobre item", bridgeFoundBaseMiss.type, "variation_id");
  eq("primeiro candidato de variação é usado", bridgeFoundBaseMiss.value, "V1");
  eq("sku de origem preservado", bridgeFoundBaseMiss.sku, "SKU-Z");

  const ambiguous = describeShopeeCostGap(
    line,
    {
      costRow: null,
      bridgeUsed: true,
      bridgeSku: "SKU-Z",
      ambiguous: true,
      ambiguousCandidates: ["123456789", "987654321"],
    },
    "PED-X"
  );
  eq("ambíguo vira tipo ambiguous_ids, nunca sku", ambiguous.type, "ambiguous_ids");
  eq("value junta os IDs conflitantes", ambiguous.value, "123456789, 987654321");
  eq("candidates expõe os IDs crus", JSON.stringify(ambiguous.candidates), JSON.stringify(["123456789", "987654321"]));
  eq("sku não aparece no diagnóstico ambíguo", ambiguous.sku, null);
  eq("reason ambíguo", ambiguous.reason, "ambiguous_bridge_candidates");

  const zeroCost = describeShopeeCostGap(
    line,
    { costRow: { cost: 0 }, source: "bridge_variation_id", matchedValue: "V9", bridgeUsed: true, bridgeSku: "SKU-Z", ambiguous: false },
    "PED-X"
  );
  eq("custo zero: tipo derivado da fonte do match", zeroCost.type, "variation_id");
  eq("custo zero: valor é o ID que bateu", zeroCost.value, "V9");
  eq("custo zero: motivo correto", zeroCost.reason, "zero_cost_in_base");
}

function round2(value) {
  return Number(value.toFixed(2));
}

console.log(`\n${checks} verificações passaram. Diagnóstico de custo Shopee (unmatchedCosts) OK.`);
