// server/tests/fechamentoFinanceiroShopeePonte.test.js
// Ponte de custo da Shopee: Order.all (financeiro real) -> performance
// (identidade SKU -> ID) -> base de custos (custo/imposto).
//
// Regras protegidas aqui:
//  - o financeiro continua vindo SÓ do Order.all (a performance nunca vira receita);
//  - match direto tem prioridade sobre a ponte;
//  - ID da Variação vem antes do ID do Item;
//  - SKU é texto (zero à esquerda preservado);
//  - ambiguidade NUNCA escolhe custo;
//  - sem Order.all, o motor estimado continua igual.

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
  buildShopeeCostBridge,
} = require("../services/fechamentoFinanceiro/shopeePerformanceService");
const {
  processShopeeFinancialOrders,
  resolveShopeeLineCost,
  parseShopeeFinancialRows,
} = require("../services/fechamentoFinanceiro/shopeeOrderAllService");

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

// Linha do Order.all com os nomes reais das colunas (arquivo real do cliente).
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

// Linha da planilha de performance (parentskudetail) com os nomes reais.
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

// ── Teste 1 — a ponte resolve o custo que o match direto não resolvia ─────
console.log("\n▸ Teste 1 — SKU do Order.all chega na base pela ponte da performance");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "260401KVVA9S0V",
      "Nome do Produto": "Resistência Elétrica 250W",
      "Nº de referência do SKU principal": "662",
      "Número de referência SKU": "662",
      "Subtotal do produto": 47.9,
      "Preço acordado": 47.9,
      "Taxa de transação": 0,
      "Taxa de comissão líquida": 8.26,
      "Taxa de serviço líquida": 6.07,
    }),
  ];
  const performance = [
    linhaPerformance({
      "ID do Item": "58259874628",
      "ID da Variação": "189188911747",
      "SKU da Variação": "662",
      "SKU Principle": "662",
      Produto: "Resistência Elétrica 250W",
    }),
  ];
  const costRows = [{ id: "58259874628", "model id": "189188911747", Custo: 100, imposto: 14.5 }];

  // Sem ponte: exatamente o comportamento anterior — 0% de cobertura.
  const semPonte = processShopee(orderAll, costRows, 0, 0, 0, null);
  eq("sem ponte o modo continua real", semPonte.summary.calculationMode, "real_financial");
  eq("sem ponte a receita fica sem custo", semPonte.summary.revenueWithCost, 0);
  eq("sem ponte o LC é desconhecido", semPonte.detailedRows[0].LC, null);

  // Com as 3 planilhas: performance no campo de vendas, Order.all no segundo campo.
  const comPonte = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("com ponte o modo continua real_financial", comPonte.summary.calculationMode, "real_financial");
  eq("com ponte a ponte é sinalizada", comPonte.summary.costBridgeAvailable, true);

  const linha = comPonte.detailedRows[0];
  eq("custo veio pela ponte", linha["Origem do custo"], "base_custos_ponte");
  eq("match pelo ID da variação", linha["Match de custo"], "bridge_variation_id");
  eq("ID resolvido é o da variação", linha["ID resolvido pela ponte"], "189188911747");
  eq("CMV é o custo da base", linha.CMV, 100);
  eq("imposto sai da base sobre a receita bruta", linha.Imposto, 6.95);

  // Financeiro segue vindo do Order.all, não da performance.
  eq("receita bruta é a do Order.all", linha["Receita bruta"], 47.9);
  eq("receita líquida = bruta - taxas reais", linha["Receita líquida"], 33.57);
  eq("LC = líquida - CMV - imposto", linha.LC, round(33.57 - 100 - 6.95));
  eq("cobertura final deixa de ser zero", comPonte.summary.finalCoverage, 100);
  eq("contagem de matches pela ponte", comPonte.summary.bridgeCostMatchCount, 1);
  eq("nenhum match direto", comPonte.summary.directCostMatchCount, 0);

  // Order.all no campo de vendas e performance no segundo campo: mesmo resultado.
  const invertido = processShopee(orderAll, costRows, 0, 0, 0, performance);
  assert.deepStrictEqual(
    invertido.summary,
    comPonte.summary,
    "ordem dos uploads não muda o resultado"
  );
  checks += 1;
  console.log("  ok  ordem dos uploads (performance x Order.all) não muda o resultado");
}

function round(value) {
  return Number(value.toFixed(2));
}

// ── Teste 2 — ID da Variação tem prioridade sobre o ID do Item ────────────
console.log("\n▸ Teste 2 — variação vence item quando os custos divergem");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "P-VAR",
      "Nº de referência do SKU principal": "VAR-2",
      "Subtotal do produto": 200,
      "Preço acordado": 200,
      "Taxa de comissão líquida": 20,
    }),
  ];
  // Mesmo item, duas variações com custos diferentes. O SKU VAR-2 aponta só
  // para a segunda variação.
  const performance = [
    linhaPerformance({ "ID do Item": "ITEM-1", "ID da Variação": "VARIACAO-1", "SKU da Variação": "VAR-1" }),
    linhaPerformance({ "ID do Item": "ITEM-1", "ID da Variação": "VARIACAO-2", "SKU da Variação": "VAR-2" }),
  ];
  const costRows = [
    { id: "ITEM-1", "model id": "VARIACAO-1", Custo: 50, imposto: 0 },
    { id: "ITEM-1", "model id": "VARIACAO-2", Custo: 80, imposto: 0 },
  ];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  const linha = r.detailedRows[0];
  eq("match usou o ID da variação", linha["Match de custo"], "bridge_variation_id");
  eq("ID resolvido é o da variação certa", linha["ID resolvido pela ponte"], "VARIACAO-2");
  eq("CMV é o custo da variação, não o do item", linha.CMV, 80);

  // Item sem variação cadastrada: cai para o ID do Item.
  const orderAllItem = [
    linhaOrderAll({
      "ID do pedido": "P-ITEM",
      "Nº de referência do SKU principal": "SO-ITEM",
      "Subtotal do produto": 100,
      "Preço acordado": 100,
      "Taxa de comissão líquida": 10,
    }),
  ];
  const performanceItem = [
    linhaPerformance({ "ID do Item": "ITEM-9", "ID da Variação": "-", "SKU Principle": "SO-ITEM" }),
  ];
  const costRowsItem = [{ id: "ITEM-9", Custo: 30, imposto: 0 }];
  const rItem = processShopee(performanceItem, costRowsItem, 0, 0, 0, orderAllItem);
  eq("sem variação a ponte usa o ID do item", rItem.detailedRows[0]["Match de custo"], "bridge_item_id");
  eq("CMV vem do custo do item", rItem.detailedRows[0].CMV, 30);
  eq('"-" da performance não vira identidade', buildShopeeCostBridge(performanceItem).get("-"), undefined);
}

// ── Teste 3 — SKU é texto: zero à esquerda preservado ─────────────────────
console.log("\n▸ Teste 3 — zero à esquerda do SKU é preservado");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "P-ZERO",
      "Nº de referência do SKU principal": "0007654352998",
      "Número de referência SKU": "0007654352998",
      "Subtotal do produto": 42.99,
      "Preço acordado": 42.99,
      "Taxa de comissão líquida": 7.38,
      "Taxa de serviço líquida": 5.84,
    }),
  ];
  const performance = [
    linhaPerformance({
      "ID do Item": "9466000848",
      "ID da Variação": "169408691877",
      "SKU da Variação": "0007654352998",
    }),
  ];
  const costRows = [{ id: "9466000848", "model id": "169408691877", Custo: 19, imposto: 14.5 }];

  const bridge = buildShopeeCostBridge(performance);
  ok("a ponte guarda o SKU com os zeros", bridge.has("0007654352998"));
  eq("o SKU não vira número", bridge.get("7654352998"), undefined);

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("custo encontrado com zero à esquerda", r.detailedRows[0].CMV, 19);
  eq("cobertura total", r.summary.finalCoverage, 100);

  // SKU diferente só pelos zeros não pode cruzar.
  const orderAllOutro = [
    linhaOrderAll({
      "ID do pedido": "P-ZERO-2",
      "Nº de referência do SKU principal": "7654352998",
      "Subtotal do produto": 42.99,
      "Preço acordado": 42.99,
      "Taxa de comissão líquida": 7.38,
    }),
  ];
  const rOutro = processShopee(performance, costRows, 0, 0, 0, orderAllOutro);
  eq("7654352998 não herda o custo de 0007654352998", rOutro.detailedRows[0].CMV, null);
  eq("e é registrado como miss da ponte", rOutro.summary.bridgeMissCount, 1);
}

// ── Teste 4 — ambiguidade nunca escolhe custo ─────────────────────────────
console.log("\n▸ Teste 4 — mesmo SKU em duas variações com custos diferentes");
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
  // Caso REAL do cliente: o SKU 7862 é usado em dois itens diferentes.
  const performance = [
    linhaPerformance({ "ID do Item": "16256858358", "SKU Principle": "7862", Produto: "Par de Discos" }),
    linhaPerformance({ "ID do Item": "58253291069", "SKU Principle": "7862", Produto: "Kit 4 Discos" }),
  ];
  const costRows = [
    { id: "16256858358", Custo: 45, imposto: 14.5 },
    { id: "58253291069", Custo: 180, imposto: 14.5 },
  ];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  const linha = r.detailedRows[0];
  eq("match marcado como ambíguo", linha["Match de custo"], "ambiguous");
  eq("custo fica nulo", linha.CMV, null);
  eq("LC fica desconhecido", linha.LC, null);
  eq("linha entra como sem custo", linha["Cobertura de custo"], "sem custo");
  eq("contador de ambiguidade", r.summary.bridgeAmbiguousCount, 1);
  eq("nenhum custo resolvido pela ponte", r.summary.bridgeCostMatchCount, 0);
  ok(
    "nota executiva usa o código COST_BRIDGE_AMBIGUOUS",
    r.summary.executiveNotes.some((note) => note.includes("COST_BRIDGE_AMBIGUOUS"))
  );
  ok("o SKU ambíguo é informado", r.summary.bridgeAmbiguousKeys.includes("7862"));
  eq("faturamento é preservado", r.summary.grossRevenueTotal, 180);

  // Dois IDs com o MESMO custo não são ambiguidade — é duplicidade de chave.
  const costRowsIguais = [
    { id: "16256858358", Custo: 45, imposto: 14.5 },
    { id: "58253291069", Custo: 45, imposto: 14.5 },
  ];
  const rIguais = processShopee(performance, costRowsIguais, 0, 0, 0, orderAll);
  eq("custos idênticos resolvem normalmente", rIguais.detailedRows[0].CMV, 45);
  eq("sem ambiguidade quando o custo é o mesmo", rIguais.summary.bridgeAmbiguousCount, 0);
}

// ── Teste 5 — sem Order.all, nada muda no motor estimado ──────────────────
console.log("\n▸ Teste 5 — performance + custos continua estimated_performance");
{
  const performance = [
    linhaPerformance({
      "ID do Item": "111",
      Produto: "Produto A",
      "Vendas (Pedido pago) (BRL)": 200,
      "Unidades (Pedido pago)": 2,
      "Impressão do Produto": 10,
      "Cliques Por Produto": 2,
      CTR: "20%",
    }),
  ];
  const costRows = [{ id: "111", custo: 20, imposto: 0 }];

  const r = processShopee(performance, costRows, 30, 0, 0, null);
  eq("modo continua estimado", r.summary.calculationMode, "estimated_performance");
  eq("motor continua o de performance", r.summary.engine, "shopee_performance");
  eq("faturamento da performance", r.summary.grossRevenueTotal, 200);
  ok(
    "nota de estimativa continua presente",
    r.summary.executiveNotes.some((note) => note.includes("Estimativa por performance"))
  );

  // Um segundo arquivo que NÃO é Order.all não pode ligar o motor real.
  const naoEhOrderAll = [{ Coluna: "valor", Outra: 1 }];
  const rSemOrderAll = processShopee(performance, costRows, 30, 0, 0, naoEhOrderAll);
  eq(
    "arquivo irreconhecível não vira fonte financeira",
    rSemOrderAll.summary.calculationMode,
    "estimated_performance"
  );
}

// ── Teste 6 — match direto continua vencendo a ponte ──────────────────────
console.log("\n▸ Teste 6 — a ponte não atrapalha quem já batia direto");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "P-DIR",
      "Nº de referência do SKU principal": "SKU-DIRETO",
      "Subtotal do produto": 100,
      "Preço acordado": 100,
      "Taxa de comissão líquida": 10,
    }),
  ];
  const costRows = [{ sku: "SKU-DIRETO", Custo: 40, imposto: 10 }];

  const semPonte = processShopee(orderAll, costRows, 0, 0, 0, null);
  eq("match direto pelo SKU", semPonte.detailedRows[0]["Match de custo"], "direct_sku");
  eq("CMV do match direto", semPonte.detailedRows[0].CMV, 40);

  // A ponte aponta o mesmo SKU para outro custo: o match direto tem prioridade.
  const performance = [
    linhaPerformance({ "ID do Item": "ITEM-X", "SKU Principle": "SKU-DIRETO" }),
  ];
  const costRowsAmbos = [
    { sku: "SKU-DIRETO", Custo: 40, imposto: 10 },
    { id: "ITEM-X", Custo: 999, imposto: 10 },
  ];
  const comPonte = processShopee(orderAll, costRowsAmbos, 0, 0, 0, performance);
  eq("continua sendo match direto", comPonte.detailedRows[0]["Match de custo"], "direct_sku");
  eq("CMV não é substituído pela ponte", comPonte.detailedRows[0].CMV, 40);
  eq("contador de match direto", comPonte.summary.directCostMatchCount, 1);
  eq("ponte não foi usada nesta linha", comPonte.summary.bridgeCostMatchCount, 0);
}

// ── Teste 7 — nenhuma regressão financeira ────────────────────────────────
console.log("\n▸ Teste 7 — pedidos que já tinham custo não mudam nada");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "R-1",
      "Nome do Produto": "Já tinha custo",
      "Nº de referência do SKU principal": "SKU-OK",
      "Subtotal do produto": 120,
      "Preço acordado": 120,
      "Taxa de transação": 1.2,
      "Taxa de comissão líquida": 12,
      "Taxa de serviço líquida": 6,
      "Valor estimado do frete": -8,
    }),
    linhaOrderAll({
      "ID do pedido": "R-2",
      "Nome do Produto": "Não tinha custo",
      "Nº de referência do SKU principal": "SKU-PONTE",
      "Subtotal do produto": 80,
      "Preço acordado": 80,
      "Taxa de comissão líquida": 8,
    }),
    linhaOrderAll({
      "ID do pedido": "R-3",
      "Nome do Produto": "Cancelado",
      "Status do pedido": "Cancelado",
      "Nº de referência do SKU principal": "SKU-OK",
      "Subtotal do produto": 60,
      "Preço acordado": 60,
    }),
  ];
  const performance = [
    linhaPerformance({ "ID do Item": "ITEM-P", "ID da Variação": "VAR-P", "SKU da Variação": "SKU-PONTE" }),
  ];
  const costRows = [
    { sku: "SKU-OK", Custo: 30, imposto: 10 },
    { id: "ITEM-P", "model id": "VAR-P", Custo: 25, imposto: 10 },
  ];

  const antes = processShopee(orderAll, costRows, 10, 5, 2, null);
  const depois = processShopee(orderAll, costRows, 10, 5, 2, performance);

  const antesR1 = antes.detailedRows.find((row) => row["ID do pedido"] === "R-1");
  const depoisR1 = depois.detailedRows.find((row) => row["ID do pedido"] === "R-1");

  for (const campo of [
    "Receita bruta",
    "Receita líquida",
    "Taxa de transação",
    "Taxa de comissão",
    "Taxa de serviço",
    "CMV",
    "Imposto",
    "LC",
    "MC",
    "Origem do custo",
    "Status do pedido",
  ]) {
    eq(`R-1 mantém ${campo}`, JSON.stringify(depoisR1[campo]), JSON.stringify(antesR1[campo]));
  }

  // A única diferença permitida: o pedido que não tinha custo passa a ter.
  eq("R-2 não tinha custo antes", antes.detailedRows.find((r) => r["ID do pedido"] === "R-2").LC, null);
  eq(
    "R-2 passa a ter custo pela ponte",
    depois.detailedRows.find((r) => r["ID do pedido"] === "R-2").CMV,
    25
  );
  eq("frete negativo continua aplicado", depoisR1["Receita líquida"], round2(120 - 19.2 - 8));
  eq("cancelado continua fora da receita", depois.summary.cancelledCount, 1);
  eq("faturamento reconhecido não muda", depois.summary.grossRevenueTotal, antes.summary.grossRevenueTotal);
  eq(
    "receita líquida total não muda",
    depois.summary.paidRevenueTotal,
    antes.summary.paidRevenueTotal
  );
  eq("taxas totais não mudam", depois.summary.marketplaceFeesTotal, antes.summary.marketplaceFeesTotal);
  eq("cancelamentos não mudam", depois.summary.cancellationsTotal, antes.summary.cancellationsTotal);
}

function round2(value) {
  return Number(value.toFixed(2));
}

// ── Teste 8 — a performance NUNCA entra como financeiro ───────────────────
console.log("\n▸ Teste 8 — nenhum número da performance contamina o real");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "PURO",
      "Nº de referência do SKU principal": "SKU-P",
      "Subtotal do produto": 100,
      "Preço acordado": 100,
      "Taxa de comissão líquida": 14,
    }),
  ];
  // Performance com números financeiros ABSURDOS: nada disso pode aparecer.
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-Z",
      "ID da Variação": "VAR-Z",
      "SKU da Variação": "SKU-P",
      "Vendas (Pedido pago) (BRL)": 999999,
      "Unidades (Pedido pago)": 500,
      "Impressão do Produto": 100,
      "Cliques Por Produto": 10,
      CTR: "10%",
    }),
  ];
  const costRows = [{ id: "ITEM-Z", "model id": "VAR-Z", Custo: 40, imposto: 0 }];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("faturamento é o do Order.all", r.summary.grossRevenueTotal, 100);
  eq("receita líquida é a do Order.all", r.summary.paidRevenueTotal, 86);
  eq("quantidade vem do Order.all", r.detailedRows[0].Quantidade, 1);
  eq("CMV usa a quantidade do Order.all", r.detailedRows[0].CMV, 40);
  eq("uma única linha (a do pedido)", r.detailedRows.length, 1);
  ok(
    "nota deixa claro que a performance só deu identidade",
    r.summary.executiveNotes.some((note) => note.includes("Ponte de identidade"))
  );
}

// ── Teste 9 — resolveShopeeLineCost isolado ───────────────────────────────
console.log("\n▸ Teste 9 — resolvedor de custo, unidade");
{
  const linhas = parseShopeeFinancialRows([
    linhaOrderAll({ "ID do pedido": "U-1", "Nº de referência do SKU principal": "S1" }),
  ]);
  const costMap = buildShopeeCostMap([{ id: "I1", "model id": "V1", Custo: 10, imposto: 0 }]);

  const semPonte = resolveShopeeLineCost(costMap, linhas[0], null);
  eq("sem ponte o resultado é miss", semPonte.source, "miss");
  eq("sem ponte nada é marcado como usado", semPonte.bridgeUsed, false);

  const bridge = buildShopeeCostBridge([
    linhaPerformance({ "ID do Item": "I1", "ID da Variação": "V1", "SKU Principle": "S1" }),
  ]);
  const comPonte = resolveShopeeLineCost(costMap, linhas[0], bridge);
  eq("com ponte resolve pela variação", comPonte.source, "bridge_variation_id");
  eq("custo resolvido", comPonte.costRow.cost, 10);

  const bridgeVazia = buildShopeeCostBridge([]);
  eq("ponte vazia não é usada", resolveShopeeLineCost(costMap, linhas[0], bridgeVazia).bridgeUsed, false);
}

console.log(`\n${checks} verificações passaram. Ponte de custo Shopee OK.`);
