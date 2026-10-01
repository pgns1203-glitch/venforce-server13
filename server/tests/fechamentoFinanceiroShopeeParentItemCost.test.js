// server/tests/fechamentoFinanceiroShopeeParentItemCost.test.js
// Custo cadastrado SÓ no item pai — motor real (Order.all) da Shopee.
//
// Causa real (Paula e Anselmo, set/2026): a base de custos do cliente tem uma
// linha por ID do ITEM (anúncio), sem ID da Variação. O Order.all não traz ID
// nenhum — a ponte (Performance) resolve a linha vendida para o Model ID, e o
// motor real se recusa (corretamente) a degradar do Model ID para o pai. O
// motor de Performance, ao contrário, cai no pai em silêncio
// (saleModelId -> id -> itemId), inclusive para itens com várias variações de
// custo diferente. Resultado: a mesma base cobria 96% na Performance e 73% no
// Order.all.
//
// Regra testada aqui — o custo do pai só vale para a variação quando há
// EVIDÊNCIA de que ele representa o produto vendido:
//   - o anúncio tem UM ÚNICO Model ID na Performance (que lista inclusive
//     variações sem venda) e é exatamente o Model ID resolvido;
//   - o pai está na base por ID (não por SKU), com custo válido e > 0;
//   - todas as linhas da base com esse ID concordam em custo e imposto, e
//     nenhuma delas é de variação (ID Model preenchido);
//   - não há linhas SEM identificador logo abaixo do pai na planilha (sinal de
//     custos por variação que o sistema não consegue endereçar);
//   - a quantidade explícita da variação não contradiz o pack do título.
// Faltando qualquer evidência, a linha continua sem custo e o diagnóstico diz
// por quê (cost_only_on_parent_item + blockedBy).
//
// Fixtures mínimas, sintéticas e anônimas — NÃO usam as planilhas reais.

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
  processShopee,
  buildShopeeCostMap,
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
    "Nome da variação": "",
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

// Anúncio na Performance: a linha agregada do pai + uma linha por variação.
function anuncio(itemId, titulo, variacoes) {
  const linhas = [
    linhaPerformance({ "ID do Item": itemId, Produto: titulo, "SKU Principle": `PAI-${itemId}` }),
  ];
  for (const v of variacoes) {
    linhas.push(
      linhaPerformance({
        "ID do Item": itemId,
        Produto: titulo,
        "ID da Variação": v.modelId,
        "Nome da Variação": v.nome,
        "Status Atual da Variação": "Normal",
        "SKU da Variação": v.sku,
        "SKU Principle": `PAI-${itemId}`,
        "Impressão do Produto": "-",
      })
    );
  }
  return linhas;
}

function pedido(id, titulo, variacao, sku, subtotal, extra = {}) {
  return linhaOrderAll({
    "ID do pedido": id,
    "Nome do Produto": titulo,
    "Nome da variação": variacao,
    "Número de referência SKU": sku,
    "Nº de referência do SKU principal": sku,
    "Subtotal do produto": subtotal,
    "Preço acordado": subtotal,
    "Taxa de comissão líquida": 10,
    "Taxa de serviço líquida": 5,
    ...extra,
  });
}

const TITULO_KIT2 = "Kit 2 Perfumes Amadeirados Masculinos 100ml";
const TITULO_GEL = "Gel Modelador Capilar Fixacao Forte";

// ── 1. Model ID com custo próprio ───────────────────────────────────────────
console.log("\n▸ 1. Model ID com custo próprio vence o pai (match forte)");
{
  const perf = anuncio("1001", TITULO_KIT2, [{ modelId: "900101", nome: "Kit 2 Amadeirado", sku: "SKU-K2" }]);
  const custos = [
    { id: "1001", custo: "15", imposto: "6" },
    { id: "1001", "id model": "900101", custo: "18", imposto: "6" },
  ];
  const r = processShopee(perf, custos, 0, 0, 0, [pedido("P1", TITULO_KIT2, "Kit 2 Amadeirado", "SKU-K2", 60)]);
  eq("CMV vem do Model ID (18), não do pai (15)", r.detailedRows[0].CMV, 18);
  eq("origem é o Model ID resolvido pela ponte", r.detailedRows[0]["Match de custo"], "bridge_variation_id");
  eq("nenhum fallback de pai contado", r.summary.bridgeParentItemSingleModelMatchCount, 0);
}

// ── 2. Pai com custo, anúncio com UMA variação ──────────────────────────────
console.log("\n▸ 2. Pai com custo + anúncio de variação única → custo do pai, com evidência");
{
  const perf = anuncio("1002", TITULO_KIT2, [{ modelId: "900201", nome: "Kit 2 Amadeirado", sku: "SKU-K2B" }]);
  const custos = [{ id: "1002", custo: "15", imposto: "6" }];
  const r = processShopee(perf, custos, 0, 0, 0, [
    pedido("P2", TITULO_KIT2, "Kit 2 Amadeirado", "SKU-K2B", 60, { Quantidade: 2, "Subtotal do produto": 120 }),
  ]);
  const row = r.detailedRows[0];
  eq("CMV = custo do pai × quantidade", row.CMV, 30);
  eq("imposto = % do pai sobre a receita", row.Imposto, 7.2);
  eq("origem nomeada como fallback do pai de variação única", row["Match de custo"], "bridge_parent_item_single_model");
  eq("ID usado no custo é o do pai", row["ID resolvido pela ponte"], "1002");
  eq("contador do fallback", r.summary.bridgeParentItemSingleModelMatchCount, 1);
  eq("cobertura 100%", r.summary.calculatedCoveragePercent, 100);
  eq("sem pendências", r.unmatchedCosts.length, 0);
  ok(
    "nota executiva explica o fallback",
    r.summary.executiveNotes.some((n) => n.startsWith("COST_BRIDGE_PARENT_ITEM_SINGLE_MODEL"))
  );
}

// ── 3. Pai com várias variações ─────────────────────────────────────────────
console.log("\n▸ 3. Pai com várias variações (inclusive sem venda) → nunca usa o pai");
{
  const perf = anuncio("1003", TITULO_GEL, [
    { modelId: "900301", nome: "1 gel", sku: "GEL-1" },
    { modelId: "900302", nome: "2 gel", sku: "GEL-2" },
    { modelId: "900303", nome: "3 gel", sku: "GEL-3" },
  ]);
  const custos = [{ id: "1003", custo: "6.5", imposto: "6" }];
  const r = processShopee(perf, custos, 0, 0, 0, [pedido("P3", TITULO_GEL, "1 gel", "GEL-1", 20)]);
  eq("continua sem custo", r.detailedRows[0].CMV, null);
  eq("origem continua miss", r.detailedRows[0]["Match de custo"], "miss");
  const gap = r.unmatchedCosts[0];
  eq("diagnóstico: custo só no pai", gap.reason, "cost_only_on_parent_item");
  eq("diagnóstico: tipo é a variação", gap.type, "variation_id");
  eq("diagnóstico: valor é o Model ID", gap.value, "900301");
  eq("diagnóstico: pai identificado", gap.parentItemId, "1003");
  eq("diagnóstico: custo do pai exposto", gap.parentCost, 6.5);
  eq("diagnóstico: bloqueio por várias variações", gap.blockedBy, "multiple_variations_in_performance");
  eq("contador do fallback é zero", r.summary.bridgeParentItemSingleModelMatchCount, 0);
}

// ── 4. Variações com custo/imposto equivalentes (todas na base) ──────────────
console.log("\n▸ 4. Equivalência financeira continua sendo o caminho para várias variações");
{
  // Mesmo SKU da variação em dois Model IDs: identidade ambígua, mas ambos
  // na base com custo e imposto idênticos -> equivalência existente resolve.
  const perf = anuncio("1004", TITULO_GEL, [
    { modelId: "900401", nome: "Azul", sku: "GEL-EQ" },
    { modelId: "900402", nome: "Verde", sku: "GEL-EQ" },
  ]);
  const custos = [
    { id: "1004", "id model": "900401", custo: "7", imposto: "6" },
    { id: "1004", "id model": "900402", custo: "7", imposto: "6" },
  ];
  const r = processShopee(perf, custos, 0, 0, 0, [pedido("P4", TITULO_GEL, "", "GEL-EQ", 20)]);
  eq("custo resolvido pela equivalência", r.detailedRows[0].CMV, 7);
  eq("origem é a equivalência de sempre", r.detailedRows[0]["Match de custo"], "bridge_equivalent_cost");
  eq("fallback de pai não participa", r.summary.bridgeParentItemSingleModelMatchCount, 0);

  // Mesmo cenário, só que a base tem SÓ o pai: não há como provar
  // equivalência entre as variações -> permanece ambíguo, sem custo.
  const r2 = processShopee(perf, [{ id: "1004", custo: "7", imposto: "6" }], 0, 0, 0, [
    pedido("P4b", TITULO_GEL, "", "GEL-EQ", 20),
  ]);
  eq("só pai + identidade ambígua → sem custo", r2.detailedRows[0].CMV, null);
  eq("continua ambíguo", r2.detailedRows[0]["Match de custo"], "ambiguous");
}

// ── 5. Custo zero ───────────────────────────────────────────────────────────
console.log("\n▸ 5. Custo zero no pai → nunca vira custo");
{
  const perf = anuncio("1005", TITULO_KIT2, [{ modelId: "900501", nome: "Kit 2 Amadeirado", sku: "SKU-Z" }]);
  const r = processShopee(perf, [{ id: "1005", custo: "R$ 0.00", imposto: "6" }], 0, 0, 0, [
    pedido("P5", TITULO_KIT2, "Kit 2 Amadeirado", "SKU-Z", 60),
  ]);
  eq("sem custo", r.detailedRows[0].CMV, null);
  const gap = r.unmatchedCosts[0];
  eq("motivo: custo só no pai", gap.reason, "cost_only_on_parent_item");
  eq("bloqueio: custo do pai inválido", gap.blockedBy, "parent_cost_invalid");
  eq("custo do pai é 0", gap.parentCostIssue, "zero");

  // Custo zero na linha que bateu DIRETO (item sem variação): diagnóstico
  // de sempre, agora com costIssue.
  const perfSemVar = [linhaPerformance({ "ID do Item": "1055", Produto: TITULO_KIT2, "SKU Principle": "SKU-Z2" })];
  const rz = processShopee(perfSemVar, [{ id: "1055", custo: "0", imposto: "6" }], 0, 0, 0, [
    pedido("P5b", TITULO_KIT2, "", "SKU-Z2", 60),
  ]);
  eq("item sem variação com custo 0 → zero_cost_in_base", rz.unmatchedCosts[0].reason, "zero_cost_in_base");
  eq("costIssue = zero", rz.unmatchedCosts[0].costIssue, "zero");
}

// ── 6. Custo vazio ou inválido ──────────────────────────────────────────────
console.log("\n▸ 6. Custo vazio ou inválido (#N/A) → nunca vira custo");
{
  const perf = anuncio("1006", TITULO_KIT2, [{ modelId: "900601", nome: "Kit 2 Amadeirado", sku: "SKU-V" }]);
  for (const [raw, issue] of [["", "empty"], ["#N/A", "invalid"]]) {
    const r = processShopee(perf, [{ id: "1006", custo: raw, imposto: "6" }], 0, 0, 0, [
      pedido("P6", TITULO_KIT2, "Kit 2 Amadeirado", "SKU-V", 60),
    ]);
    eq(`custo "${raw}" no pai → sem custo`, r.detailedRows[0].CMV, null);
    eq(`custo "${raw}" → bloqueio parent_cost_invalid`, r.unmatchedCosts[0].blockedBy, "parent_cost_invalid");
    eq(`custo "${raw}" → parentCostIssue ${issue}`, r.unmatchedCosts[0].parentCostIssue, issue);
  }
  const perfSemVar = [linhaPerformance({ "ID do Item": "1066", Produto: TITULO_KIT2, "SKU Principle": "SKU-V2" })];
  for (const [raw, issue] of [["", "empty"], ["#N/A", "invalid"]]) {
    const r = processShopee(perfSemVar, [{ id: "1066", custo: raw, imposto: "6" }], 0, 0, 0, [
      pedido("P6b", TITULO_KIT2, "", "SKU-V2", 60),
    ]);
    eq(`linha direta com custo "${raw}" → zero_cost_in_base`, r.unmatchedCosts[0].reason, "zero_cost_in_base");
    eq(`linha direta com custo "${raw}" → costIssue ${issue}`, r.unmatchedCosts[0].costIssue, issue);
  }
}

// ── 7. Model ID inexistente (nem variação nem pai na base) ──────────────────
console.log("\n▸ 7. Model ID e pai ausentes da base");
{
  const perf = anuncio("1007", TITULO_KIT2, [{ modelId: "900701", nome: "Kit 2 Amadeirado", sku: "SKU-X" }]);
  const r = processShopee(perf, [{ id: "9999", custo: "15", imposto: "6" }], 0, 0, 0, [
    pedido("P7", TITULO_KIT2, "Kit 2 Amadeirado", "SKU-X", 60),
  ]);
  eq("sem custo", r.detailedRows[0].CMV, null);
  const gap = r.unmatchedCosts[0];
  eq("motivo de sempre: não encontrado na base", gap.reason, "not_found_in_cost_base");
  eq("valor é o Model ID", gap.value, "900701");
  eq("pai identificado", gap.parentItemId, "1007");
  eq("pai também ausente da base", gap.parentInCostBase, false);
}

// ── 8. IDs / SKUs ambíguos ──────────────────────────────────────────────────
console.log("\n▸ 8. Mesmo SKU em dois anúncios de variação única → continua ambíguo");
{
  const perf = [
    ...anuncio("1081", TITULO_KIT2, [{ modelId: "908101", nome: "Kit 2 Amadeirado", sku: "SKU-DUP" }]),
    ...anuncio("1082", TITULO_KIT2, [{ modelId: "908201", nome: "Kit 2 Amadeirado", sku: "SKU-DUP" }]),
  ];
  const custos = [
    { id: "1081", custo: "15", imposto: "6" },
    { id: "1082", custo: "22", imposto: "6" },
  ];
  const r = processShopee(perf, custos, 0, 0, 0, [pedido("P8", TITULO_KIT2, "Kit 2 Amadeirado", "SKU-DUP", 60)]);
  eq("sem custo", r.detailedRows[0].CMV, null);
  eq("origem ambígua", r.detailedRows[0]["Match de custo"], "ambiguous");
  eq("nenhum pai escolhido", r.summary.bridgeParentItemSingleModelMatchCount, 0);
}

// ── 9. Unitário x kit ───────────────────────────────────────────────────────
console.log("\n▸ 9. Quantidade da variação contradiz o pack do título → não usa o pai");
{
  // Título sem kit (unidade), variação única "2 Luxury" -> o custo do pai
  // pode ser da unidade; atribuí-lo a um kit de 2 subestimaria o CMV.
  const perf = anuncio("1009", "Body Splash Arabe 200ml Feminino", [
    { modelId: "900901", nome: "2 Luxury Black", sku: "BS-2LB" },
  ]);
  const r = processShopee(perf, [{ id: "1009", custo: "8.5", imposto: "6" }], 0, 0, 0, [
    pedido("P9", "Body Splash Arabe 200ml Feminino", "2 Luxury Black", "BS-2LB", 45),
  ]);
  eq("unitário x variação de 2 → sem custo", r.detailedRows[0].CMV, null);
  eq("bloqueio pack_conflict", r.unmatchedCosts[0].blockedBy, "pack_conflict");

  // Kit 4 no título, variação "Kit 2": conflito explícito.
  const perfK = anuncio("1019", "Kit 4 Perfumes Masculinos 100ml", [
    { modelId: "901901", nome: "Kit 2 Sortido", sku: "K4-K2" },
  ]);
  const rk = processShopee(perfK, [{ id: "1019", custo: "32", imposto: "6" }], 0, 0, 0, [
    pedido("P9b", "Kit 4 Perfumes Masculinos 100ml", "Kit 2 Sortido", "K4-K2", 90),
  ]);
  eq("Kit 4 x Kit 2 → sem custo", rk.detailedRows[0].CMV, null);
  eq("bloqueio pack_conflict (kit)", rk.unmatchedCosts[0].blockedBy, "pack_conflict");

  // Kit 2 no título e na variação: compatível -> resolve.
  const perfOk = anuncio("1029", TITULO_KIT2, [{ modelId: "902901", nome: "Kit 2 Amadeirado", sku: "K2-OK" }]);
  const rOk = processShopee(perfOk, [{ id: "1029", custo: "15", imposto: "6" }], 0, 0, 0, [
    pedido("P9c", TITULO_KIT2, "Kit 2 Amadeirado", "K2-OK", 60),
  ]);
  eq("Kit 2 x Kit 2 → custo do pai", rOk.detailedRows[0].CMV, 15);
}

// ── 10. Prioridade dos matches fortes / proteções da base ───────────────────
console.log("\n▸ 10. Proteções da base e prioridade dos matches fortes");
{
  const perf = anuncio("1010", TITULO_KIT2, [{ modelId: "901001", nome: "Kit 2 Amadeirado", sku: "SKU-P" }]);
  const venda = [pedido("P10", TITULO_KIT2, "Kit 2 Amadeirado", "SKU-P", 60)];

  // a) linhas duplicadas do pai com custos diferentes
  const ra = processShopee(perf, [
    { id: "1010", custo: "15", imposto: "6" },
    { id: "1010", custo: "17", imposto: "6" },
  ], 0, 0, 0, venda);
  eq("pai duplicado com custos diferentes → sem custo", ra.detailedRows[0].CMV, null);
  eq("bloqueio conflicting_parent_rows", ra.unmatchedCosts[0].blockedBy, "conflicting_parent_rows");

  // b) duplicadas idênticas não são conflito
  const rb = processShopee(perf, [
    { id: "1010", custo: "15", imposto: "6" },
    { id: "1010", custo: "15", imposto: "6" },
  ], 0, 0, 0, venda);
  eq("pai duplicado idêntico → custo do pai", rb.detailedRows[0].CMV, 15);

  // c) a base tem custo por variação para OUTRO Model ID desse item: o cliente
  //    cadastra por variação, então o pai não representa esta variação.
  const rc = processShopee(perf, [
    { id: "1010", custo: "15", imposto: "6" },
    { id: "1010", "id model": "999999", custo: "30", imposto: "6" },
  ], 0, 0, 0, venda);
  eq("base com linha de outra variação do item → sem custo", rc.detailedRows[0].CMV, null);
  eq("bloqueio cost_base_has_variation_rows_for_item", rc.unmatchedCosts[0].blockedBy, "cost_base_has_variation_rows_for_item");

  // d) linhas sem identificador logo abaixo do pai na planilha
  const rd = processShopee(perf, [
    { id: "1010", custo: "15", imposto: "6" },
    { id: "", custo: "30", imposto: "6" },
    { id: "2020", custo: "9", imposto: "6" },
  ], 0, 0, 0, venda);
  eq("pai seguido de linhas sem ID → sem custo", rd.detailedRows[0].CMV, null);
  eq("bloqueio unidentified_rows_below_parent", rd.unmatchedCosts[0].blockedBy, "unidentified_rows_below_parent");
  eq("diagnóstico da base conta a linha sem ID", rd.summary.costBaseDiagnostics.unidentifiedRowsCount, 1);
  eq("diagnóstico da base aponta o pai afetado", rd.summary.costBaseDiagnostics.itemsWithUnidentifiedRowsBelow[0], "1010");

  // e) a linha sem ID abaixo de OUTRO item não bloqueia este
  const re = processShopee(perf, [
    { id: "2020", custo: "9", imposto: "6" },
    { id: "", custo: "9", imposto: "6" },
    { id: "1010", custo: "15", imposto: "6" },
  ], 0, 0, 0, venda);
  eq("linha sem ID abaixo de outro item não bloqueia", re.detailedRows[0].CMV, 15);

  // f) Order.all com Model ID + ID do item explícitos (export com colunas de
  //    ID): Model ID com custo próprio vence; sem ele, a mesma regra do pai
  //    vale usando a Performance como evidência.
  const vendaComIds = [pedido("P10f", TITULO_KIT2, "Kit 2 Amadeirado", "", 60, {
    "ID do item": "1010",
    "ID do modelo": "901001",
  })];
  const rf1 = processShopee(perf, [
    { id: "1010", custo: "15", imposto: "6" },
    { id: "1010", "id model": "901001", custo: "19", imposto: "6" },
  ], 0, 0, 0, vendaComIds);
  eq("Model ID direto com custo próprio vence", rf1.detailedRows[0].CMV, 19);
  eq("origem direct_model_id", rf1.detailedRows[0]["Match de custo"], "direct_model_id");
  const rf2 = processShopee(perf, [{ id: "1010", custo: "15", imposto: "6" }], 0, 0, 0, vendaComIds);
  eq("Model ID direto sem custo + pai de variação única → pai", rf2.detailedRows[0].CMV, 15);
  eq("origem bridge_parent_item_single_model", rf2.detailedRows[0]["Match de custo"], "bridge_parent_item_single_model");

  // g) sem Performance não há evidência de variação única: nunca usa o pai.
  const {
    processShopeeFinancialOrders,
  } = require("../services/fechamentoFinanceiro/shopeeOrderAllService");
  const rg = processShopeeFinancialOrders({
    salesRowsRaw: vendaComIds,
    costMap: buildShopeeCostMap([{ id: "1010", custo: "15", imposto: "6" }]),
    costBridge: null,
  });
  eq("sem Performance → Model ID sem custo continua sem custo", rg.detailedRows[0].CMV, null);
}

// ── 11. Receita, repasse, taxas e frete não mudam ───────────────────────────
console.log("\n▸ 11. Fallback do pai só muda CMV/imposto/LC — nunca receita, repasse ou taxas");
{
  const perf = anuncio("1011", TITULO_KIT2, [{ modelId: "901101", nome: "Kit 2 Amadeirado", sku: "SKU-R" }]);
  const vendas = [
    pedido("P11a", TITULO_KIT2, "Kit 2 Amadeirado", "SKU-R", 60, { "Valor estimado do frete": "-7" }),
    pedido("P11b", TITULO_KIT2, "Kit 2 Amadeirado", "SKU-R", 120, { Quantidade: 2 }),
    pedido("P11c", TITULO_KIT2, "Kit 2 Amadeirado", "SKU-R", 60, { "Status do pedido": "Cancelado" }),
  ];
  const semCusto = processShopee(perf, [{ id: "9999", custo: "15", imposto: "6" }], 100, 50, 25, vendas);
  const viaPai = processShopee(perf, [{ id: "1011", custo: "15", imposto: "6" }], 100, 50, 25, vendas);
  const viaModel = processShopee(perf, [{ id: "1011", "id model": "901101", custo: "15", imposto: "6" }], 100, 50, 25, vendas);
  for (const campo of [
    "grossRevenueTotal",
    "paidRevenueTotal",
    "marketplaceFeesTotal",
    "shippingFeesTotal",
    "cancelledCount",
    "cancelledLostRevenue",
    "returnRefundRevenue",
    "unpaidLostRevenue",
    "adsTotal",
    "venforceTotal",
    "affiliatesTotal",
  ]) {
    eq(`${campo} igual sem custo x via pai`, viaPai.summary[campo], semCusto.summary[campo]);
  }
  for (const campo of ["cmvTotal", "taxValueTotal", "contributionProfitTotal", "finalResult", "revenueWithCost"]) {
    eq(`${campo} via pai = via Model ID cadastrado`, viaPai.summary[campo], viaModel.summary[campo]);
  }
  eq("cobertura via pai 100%", viaPai.summary.calculatedCoveragePercent, 100);
  eq("cobertura sem custo 0%", semCusto.summary.calculatedCoveragePercent, 0);
}

// ── 12. Diagnóstico da base: ID em notação científica ───────────────────────
console.log("\n▸ 12. ID em notação científica é apontado na base (não é cruzável)");
{
  const perf = anuncio("1012", TITULO_KIT2, [{ modelId: "228811826223", nome: "Kit 2 Amadeirado", sku: "SKU-S" }]);
  const r = processShopee(perf, [{ id: "2.28812E+11", custo: "9", imposto: "6" }], 0, 0, 0, [
    pedido("P12", TITULO_KIT2, "Kit 2 Amadeirado", "SKU-S", 30),
  ]);
  eq("sem custo (o ID foi destruído pelo Excel)", r.detailedRows[0].CMV, null);
  eq("ID científico listado", r.summary.costBaseDiagnostics.scientificNotationIds[0], "2.28812E+11");
  ok(
    "nota executiva aponta a base",
    r.summary.executiveNotes.some((n) => n.startsWith("COST_BASE_QUALITY"))
  );
}

// ── 13. Ordem das linhas não muda o resultado ───────────────────────────────
console.log("\n▸ 13. Ordem da Performance não muda o resultado");
{
  const perf = anuncio("1013", TITULO_KIT2, [{ modelId: "901301", nome: "Kit 2 Amadeirado", sku: "SKU-O" }]);
  const custos = [{ id: "1013", custo: "15", imposto: "6" }];
  const venda = [pedido("P13", TITULO_KIT2, "Kit 2 Amadeirado", "SKU-O", 60)];
  const r1 = processShopee(perf, custos, 0, 0, 0, venda);
  const r2 = processShopee(perf.slice().reverse(), custos, 0, 0, 0, venda);
  eq("CMV igual com a Performance invertida", r1.detailedRows[0].CMV, r2.detailedRows[0].CMV);
  eq("origem igual com a Performance invertida", r1.detailedRows[0]["Match de custo"], r2.detailedRows[0]["Match de custo"]);
}

console.log(`\n${checks} verificações passaram. Custo do item pai no Order.all Shopee OK.`);
