// server/tests/fechamentoFinanceiroShopeePonte.test.js
// Ponte de custo da Shopee: Order.all (financeiro real) -> performance
// (identidade produto/variação -> Model ID; SKU auxiliar) -> base de custos.
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
  eq("B: custo diferente mantém CMV nulo", linha.CMV, null);
  eq("LC fica desconhecido", linha.LC, null);
  eq("linha entra como sem custo", linha["Cobertura de custo"], "sem custo");
  eq("B: custo diferente continua ambíguo", r.summary.bridgeAmbiguousCount, 1);
  eq("nenhum custo resolvido pela ponte", r.summary.bridgeCostMatchCount, 0);
  ok(
    "nota executiva usa o código COST_BRIDGE_AMBIGUOUS",
    r.summary.executiveNotes.some((note) => note.includes("COST_BRIDGE_AMBIGUOUS"))
  );
  ok("o SKU ambíguo é informado", r.summary.bridgeAmbiguousKeys.includes("7862"));
  eq("faturamento é preservado", r.summary.grossRevenueTotal, 180);

  // A) Identidade ainda ambígua, mas resultado financeiro equivalente.
  const costRowsIguais = [
    { id: "16256858358", Custo: 45, imposto: 14.5 },
    { id: "58253291069", Custo: 45, imposto: 14.5 },
  ];
  const rIguais = processShopee(performance, costRowsIguais, 0, 0, 0, orderAll);
  eq("A: custo equivalente é aplicado", rIguais.detailedRows[0].CMV, 45);
  eq("A: imposto equivalente é aplicado", rIguais.detailedRows[0].Imposto, 26.1);
  eq("A: identidade ambígua equivalente não bloqueia", rIguais.summary.bridgeAmbiguousCount, 0);
  eq("A: match informa equivalência financeira", rIguais.detailedRows[0]["Match de custo"], "bridge_equivalent_cost");

  // C) Mesmo custo com imposto diferente continua bloqueado.
  const rImpostoDiferente = processShopee(performance, [
    { id: "16256858358", Custo: 45, imposto: 14.5 },
    { id: "58253291069", Custo: 45, imposto: 10 },
  ], 0, 0, 0, orderAll);
  eq("C: imposto diferente mantém custo vazio", rImpostoDiferente.detailedRows[0].CMV, null);
  eq("C: imposto diferente continua ambíguo", rImpostoDiferente.summary.bridgeAmbiguousCount, 1);
}

// ── Casos obrigatórios A–E — identidade por Model ID ─────────────────────
console.log("\n▸ Casos A–E — Model ID define o custo; SKU é apenas auxiliar");
{
  // A) SKU único continua resolvendo normalmente.
  const orderA = [linhaOrderAll({
    "ID do pedido": "CASE-A",
    "Nº de referência do SKU principal": "SKU-A",
    "Subtotal do produto": 100,
    "Preço acordado": 100,
  })];
  const performanceA = [
    linhaPerformance({ "ID do Item": "ITEM-A", "ID da Variação": "-", "SKU Principle": "SKU-A" }),
    linhaPerformance({
      "ID do Item": "ITEM-A",
      "ID da Variação": "MODEL-A",
      "SKU da Variação": "SKU-A",
    }),
  ];
  const resultA = processShopee(performanceA, [
    { id: "ITEM-A", "model id": "MODEL-A", Custo: 20, imposto: 0 },
  ], 0, 0, 0, orderA);
  eq("A: mesmo SKU → um Model ID resolve", resultA.detailedRows[0].CMV, 20);

  // B) Mesmo SKU, Model IDs e custos distintos: produto + nome da variação
  // selecionam exatamente a identidade da linha vendida.
  const productB = "Estufa de Salgados Reta Tripla 3 Andares 09 Bandejas Grand Alta Capacidade e Eficiência 127v/220v";
  const orderB = [linhaOrderAll({
    "ID do pedido": "CASE-B",
    "Nome do Produto": productB,
    "Nome da variação": "220V",
    "Nº de referência do SKU principal": "816",
    "Subtotal do produto": 1638.9,
    "Preço acordado": 1638.9,
  })];
  const performanceB = [
    linhaPerformance({ "ID do Item": "23698827488", "ID da Variação": "189610928129", "Nome da Variação": "220v", "SKU Principle": "816", Produto: productB }),
    linhaPerformance({ "ID do Item": "23698827488", "ID da Variação": "219613990608", "Nome da Variação": "127v", "SKU Principle": "816", Produto: productB }),
  ];
  const resultB = processShopee(performanceB, [
    { id: "23698827488", "model id": "189610928129", Custo: 1156, imposto: 14.5 },
    { id: "23698827488", "model id": "219613990608", Custo: 999, imposto: 14.5 },
  ], 0, 0, 0, orderB);
  eq("B: produto + 220V escolhem o Model ID de 220V", resultB.detailedRows[0]["ID resolvido pela ponte"], "189610928129");
  eq("B: custo vem somente da variação de 220V", resultB.detailedRows[0].CMV, 1156);
  eq("B: múltiplos Model IDs no SKU não geram ambiguidade", resultB.summary.bridgeAmbiguousCount, 0);

  // C) SKU renomeado, mas mesma identidade de produto/variação e Model ID.
  const orderC = [linhaOrderAll({
    "ID do pedido": "CASE-C",
    "Nome do Produto": "Produto X",
    "Nome da variação": "220V",
    "Nº de referência do SKU principal": "5444",
    "Número de referência SKU": "5444",
    "Subtotal do produto": 200,
    "Preço acordado": 200,
  })];
  const performanceC = [
    linhaPerformance({ "ID do Item": "ITEM-X", "ID da Variação": "310974457230", "Nome da Variação": "220V", "SKU da Variação": "5444", Produto: "Produto X" }),
    linhaPerformance({ "ID do Item": "ITEM-X", "ID da Variação": "310974457230", "Nome da Variação": "220V", "SKU da Variação": "5444-V", Produto: "Produto X" }),
  ];
  const resultC = processShopee(performanceC, [
    { id: "ITEM-X", "model id": "310974457230", Custo: 73, imposto: 0 },
  ], 0, 0, 0, orderC);
  eq("C: SKU antigo e atual convergem ao mesmo Model ID", resultC.detailedRows[0]["ID resolvido pela ponte"], "310974457230");
  eq("C: renomear SKU não altera o custo", resultC.detailedRows[0].CMV, 73);

  // D) Sem variação/produto suficiente, SKU compartilhado não escolhe.
  const orderD = [linhaOrderAll({
    "ID do pedido": "CASE-D",
    "Nome do Produto": "Produto sem identidade suficiente",
    "Nº de referência do SKU principal": "SKU-D",
    "Subtotal do produto": 100,
    "Preço acordado": 100,
  })];
  const performanceD = [
    linhaPerformance({ "ID do Item": "ITEM-D", "ID da Variação": "MODEL-D1", "Nome da Variação": "127V", "SKU Principle": "SKU-D", Produto: "Outro produto" }),
    linhaPerformance({ "ID do Item": "ITEM-D", "ID da Variação": "MODEL-D2", "Nome da Variação": "220V", "SKU Principle": "SKU-D", Produto: "Outro produto" }),
  ];
  const resultD = processShopee(performanceD, [
    { id: "ITEM-D", "model id": "MODEL-D1", Custo: 40, imposto: 0 },
    { id: "ITEM-D", "model id": "MODEL-D2", Custo: 60, imposto: 0 },
  ], 0, 0, 0, orderD);
  eq("D: informação insuficiente mantém custo vazio", resultD.detailedRows[0].CMV, null);
  ok("D: candidatos mostram os dois Model IDs", resultD.unmatchedCosts[0].candidates.includes("MODEL-D1") && resultD.unmatchedCosts[0].candidates.includes("MODEL-D2"));

  // E) Encontrado o Model ID, o item pai não pode virar fallback de custo.
  const orderE = [linhaOrderAll({
    "ID do pedido": "CASE-E",
    "Nome do Produto": "Produto E",
    "Nome da variação": "220V",
    "Nº de referência do SKU principal": "SKU-E",
    "Subtotal do produto": 100,
    "Preço acordado": 100,
  })];
  const performanceE = [linhaPerformance({
    "ID do Item": "ITEM-E",
    "ID da Variação": "MODEL-E",
    "Nome da Variação": "220V",
    "SKU Principle": "SKU-E",
    Produto: "Produto E",
  })];
  const resultE = processShopee(performanceE, [
    { id: "ITEM-E", Custo: 999, imposto: 0 },
  ], 0, 0, 0, orderE);
  eq("E: Model ID ausente na base não cai no custo do item pai", resultE.detailedRows[0].CMV, null);
  eq("E: pendência informa o Model ID exato", resultE.unmatchedCosts[0].value, "MODEL-E");

  const directE = processShopeeFinancialOrders({
    salesRowsRaw: [
      linhaOrderAll({
        "ID do pedido": "E-DIRECT",
        "ID da Variação": "MODEL-E-DIRECT",
        "ID do Item": "ITEM-E-DIRECT",
        "Nº de referência do SKU principal": "SKU-E-DIRECT",
        "Subtotal do produto": 100,
        "Preço acordado": 100,
      }),
    ],
    costMap: buildShopeeCostMap([
      { id: "ITEM-E-DIRECT", "model id": "OUTRO-MODEL", Custo: 999, imposto: 0 },
      { id: "SKU-E-DIRECT", "model id": "OUTRO-SKU-MODEL", Custo: 888, imposto: 0 },
    ]),
    costBridge: buildShopeeCostBridge([
      linhaPerformance({
        "ID do Item": "ITEM-E-DIRECT",
        "ID da Variação": "OUTRO-MODEL",
        "SKU Principle": "SKU-E-DIRECT",
      }),
    ]),
    ads: 0,
    venforce: 0,
    affiliates: 0,
  });
  eq("E: Model ID direto também não cai em item, SKU ou ponte", directE.detailedRows[0].CMV, null);
  eq("E: pendência direta preserva o Model ID informado", directE.unmatchedCosts[0].value, "MODEL-E-DIRECT");
}

// ── Regressão real — índices de SKU separados ───────────────────
console.log("\n▸ Regressão A–E — índices separados de SKU da Variação e SKU Principle");
{
  // A/B/D) 1155 é SKU da Variação de Prata e SKU Principle de três
  // opções. Os custos das irmãs não podem contaminar o Model ID de Prata.
  const productB = "Base de Mesa Florença Aço Carbono P/ Tampos Até 80x80cm Moderna Resistente Sala Jantar Cozinha";
  const performanceB = [
    linhaPerformance({ "ID do Item": "19199703630", "ID da Variação": "219174272058", "Nome da Variação": "Prata", "SKU da Variação": "1155", "SKU Principle": "1155", Produto: productB }),
    linhaPerformance({ "ID do Item": "19199703630", "ID da Variação": "229420852966", "Nome da Variação": "Branco", "SKU da Variação": "1153", "SKU Principle": "1155", Produto: productB }),
    linhaPerformance({ "ID do Item": "19199703630", "ID da Variação": "238784409845", "Nome da Variação": "Preta", "SKU da Variação": "1154", "SKU Principle": "1155", Produto: productB }),
  ];
  const bridgeB = buildShopeeCostBridge(performanceB);
  assert.deepStrictEqual(bridgeB.variationSkuIndex.get("1155").variationIds, ["219174272058"]);
  checks += 1;
  console.log("  ok  B: SKU da Variação 1155 fica isolado do SKU Principle 1155");
  assert.deepStrictEqual(
    bridgeB.principalSkuIndex.get("1155").variationIds,
    ["219174272058", "229420852966", "238784409845"]
  );
  checks += 1;
  console.log("  ok  B: SKU Principle mantém seu conjunto no índice separado");

  const resultB = processShopee(performanceB, [
    { id: "19199703630", "model id": "219174272058", Custo: 31.34, imposto: 10 },
    { id: "19199703630", "model id": "229420852966", Custo: 34.57, imposto: 10 },
    { id: "19199703630", "model id": "238784409845", Custo: 31.34, imposto: 10 },
  ], 0, 0, 0, [linhaOrderAll({
    "ID do pedido": "INDEX-B",
    "Nome do Produto": productB,
    "Nome da variação": "Prata",
    "Nº de referência do SKU principal": "1155",
    "Número de referência SKU": "1155",
    "Subtotal do produto": 100,
    "Preço acordado": 100,
  })]);
  eq("A: SKU da Variação único resolve um Model ID", resultB.detailedRows[0]["ID resolvido pela ponte"], "219174272058");
  eq("B: o mesmo texto no SKU Principle não mistura candidatos", resultB.summary.bridgeAmbiguousCount, 0);
  eq("D: custos diferentes das outras variações não criam ambiguidade", resultB.detailedRows[0].CMV, 31.34);

  // C) Mesmo SKU da Variação em anúncios diferentes.
  const performanceC = [
    linhaPerformance({ "ID do Item": "ITEM-C1", "ID da Variação": "MODEL-C1", "SKU da Variação": "DUP-C", Produto: "Produto C1", "Nome da Variação": "220V" }),
    linhaPerformance({ "ID do Item": "ITEM-C2", "ID da Variação": "MODEL-C2", "SKU da Variação": "DUP-C", Produto: "Produto C2", "Nome da Variação": "127V" }),
  ];
  const resultC = processShopee(performanceC, [
    { id: "ITEM-C1", "model id": "MODEL-C1", Custo: 80, imposto: 0 },
    { id: "ITEM-C2", "model id": "MODEL-C2", Custo: 40, imposto: 0 },
  ], 0, 0, 0, [linhaOrderAll({
    "ID do pedido": "INDEX-C",
    "Nome do Produto": "Produto C2",
    "Nome da variação": "127V",
    "Número de referência SKU": "DUP-C",
    "Subtotal do produto": 100,
    "Preço acordado": 100,
  })]);
  eq("C: produto + variação desambiguam SKU da Variação repetido", resultC.detailedRows[0]["ID resolvido pela ponte"], "MODEL-C2");
  eq("C: custo vem exclusivamente do Model ID escolhido", resultC.detailedRows[0].CMV, 40);

  // E) Mesmo SKU, produto e variação: faltam campos para escolher.
  const performanceE = [
    linhaPerformance({ "ID do Item": "ITEM-E1", "ID da Variação": "MODEL-E1", "SKU da Variação": "DUP-E", Produto: "Produto E", "Nome da Variação": "Única" }),
    linhaPerformance({ "ID do Item": "ITEM-E2", "ID da Variação": "MODEL-E2", "SKU da Variação": "DUP-E", Produto: "Produto E", "Nome da Variação": "Única" }),
  ];
  const resultE = processShopee(performanceE, [
    { id: "ITEM-E1", "model id": "MODEL-E1", Custo: 10, imposto: 0 },
    { id: "ITEM-E2", "model id": "MODEL-E2", Custo: 20, imposto: 0 },
  ], 0, 0, 0, [linhaOrderAll({
    "ID do pedido": "INDEX-E",
    "Nome do Produto": "Produto E",
    "Nome da variação": "Única",
    "Número de referência SKU": "DUP-E",
    "Subtotal do produto": 100,
    "Preço acordado": 100,
  })]);
  eq("E: identidade insuficiente deixa custo vazio", resultE.detailedRows[0].CMV, null);
  assert.deepStrictEqual(resultE.unmatchedCosts[0].candidates, ["MODEL-E1", "MODEL-E2"]);
  checks += 1;
  console.log("  ok  E: somente os Model IDs candidatos são exibidos");
}

// ── Regressão de SKU histórico ──────────────────────────────────
// Regressão D–H — fallback controlado de SKU histórico.
console.log("\n▸ Regressão D–H — SKU histórico com sufixos -V e -0");
{
  // D) O SKU literal sempre vence a alternativa normalizada.
  const resultD = processShopee([
    linhaPerformance({ "ID do Item": "ITEM-D1", "ID da Variação": "MODEL-D-EXATO", "SKU da Variação": "5454", Produto: "Produto D", "Nome da Variação": "Opção" }),
    linhaPerformance({ "ID do Item": "ITEM-D2", "ID da Variação": "MODEL-D-HIST", "SKU da Variação": "5454-V", Produto: "Produto D", "Nome da Variação": "Opção" }),
  ], [
    { id: "ITEM-D1", "model id": "MODEL-D-EXATO", Custo: 10, imposto: 0 },
    { id: "ITEM-D2", "model id": "MODEL-D-HIST", Custo: 20, imposto: 0 },
  ], 0, 0, 0, [linhaOrderAll({
    "ID do pedido": "HIST-D", "Nome do Produto": "Produto D", "Nome da variação": "Opção",
    "Número de referência SKU": "5454", "Subtotal do produto": 100, "Preço acordado": 100,
  })]);
  eq("D: SKU exato tem prioridade", resultD.detailedRows[0]["ID resolvido pela ponte"], "MODEL-D-EXATO");
  eq("D: normalização não substitui match exato", resultD.detailedRows[0].CMV, 10);

  // E) Caso real 5454 -> 5454-V.
  const productE = "Mesa de Canto P/ Sala Austria Design Moderno Industrial Minimalista Em Aço";
  const resultE = processShopee([
    linhaPerformance({ "ID do Item": "20998990904", "ID da Variação": "446064281548", "SKU da Variação": "5454-V", Produto: productE, "Nome da Variação": "Dourado/Branco" }),
  ], [
    { id: "20998990904", "model id": "446064281548", Custo: 75.21, imposto: 10 },
  ], 0, 0, 0, [linhaOrderAll({
    "ID do pedido": "HIST-E", "Nome do Produto": productE, "Nome da variação": "Dourado/Branco",
    "Número de referência SKU": "5454", "Subtotal do produto": 100, "Preço acordado": 100,
  })]);
  eq("E: 5454 encontra 5454-V", resultE.detailedRows[0]["ID resolvido pela ponte"], "446064281548");
  eq("E: custo do Model ID histórico é aplicado", resultE.detailedRows[0].CMV, 75.21);
  eq("E: match histórico é contabilizado", resultE.summary.bridgeHistoricalSkuMatchCount, 1);

  // F) Caso real 5470 -> 5470-0.
  const resultF = processShopee([
    linhaPerformance({ "ID do Item": "20398289024", "ID da Variação": "426030428544", "SKU da Variação": "5470-0", Produto: "Base Kansas", "Nome da Variação": "Dourado" }),
  ], [
    { id: "20398289024", "model id": "426030428544", Custo: 83.79, imposto: 10 },
  ], 0, 0, 0, [linhaOrderAll({
    "ID do pedido": "HIST-F", "Nome do Produto": "Base Kansas", "Nome da variação": "Dourado",
    "Número de referência SKU": "5470", "Subtotal do produto": 100, "Preço acordado": 100,
  })]);
  eq("F: 5470 encontra 5470-0", resultF.detailedRows[0]["ID resolvido pela ponte"], "426030428544");
  eq("F: custo correto é aplicado", resultF.detailedRows[0].CMV, 83.79);

  const resultFInverso = processShopee([
    linhaPerformance({ "ID do Item": "ITEM-FI", "ID da Variação": "MODEL-FI", "SKU da Variação": "8000", Produto: "Produto FI", "Nome da Variação": "Única" }),
  ], [
    { id: "ITEM-FI", "model id": "MODEL-FI", Custo: 30, imposto: 0 },
  ], 0, 0, 0, [linhaOrderAll({
    "ID do pedido": "HIST-FI", "Nome do Produto": "Produto FI", "Nome da variação": "Única",
    "Número de referência SKU": "8000-V", "Subtotal do produto": 100, "Preço acordado": 100,
  })]);
  eq("F: caminho inverso remove somente -V", resultFInverso.detailedRows[0]["ID resolvido pela ponte"], "MODEL-FI");

  // G) Dois anúncios no SKU histórico: nomes compartilhados desambiguam.
  const resultG = processShopee([
    linhaPerformance({ "ID do Item": "ITEM-G1", "ID da Variação": "MODEL-G1", "SKU da Variação": "7000-V", Produto: "Produto G1", "Nome da Variação": "Azul" }),
    linhaPerformance({ "ID do Item": "ITEM-G2", "ID da Variação": "MODEL-G2", "SKU da Variação": "7000-V", Produto: "Produto G2", "Nome da Variação": "Verde" }),
  ], [
    { id: "ITEM-G1", "model id": "MODEL-G1", Custo: 10, imposto: 0 },
    { id: "ITEM-G2", "model id": "MODEL-G2", Custo: 20, imposto: 0 },
  ], 0, 0, 0, [linhaOrderAll({
    "ID do pedido": "HIST-G", "Nome do Produto": "Produto G2", "Nome da variação": "Verde",
    "Número de referência SKU": "7000", "Subtotal do produto": 100, "Preço acordado": 100,
  })]);
  eq("G: produto + variação desambiguam SKU histórico", resultG.detailedRows[0]["ID resolvido pela ponte"], "MODEL-G2");
  eq("G: custo vem do Model ID desambiguado", resultG.detailedRows[0].CMV, 20);

  // H) Sem 5444, 5444-V ou 5444-0 na Performance, continua sem custo.
  const resultH = processShopee([
    linhaPerformance({ "ID do Item": "ITEM-H", "ID da Variação": "MODEL-H", "SKU da Variação": "OUTRO-SKU", Produto: "Outro produto" }),
  ], [
    { id: "ITEM-H", "model id": "MODEL-H", Custo: 10, imposto: 0 },
  ], 0, 0, 0, [linhaOrderAll({
    "ID do pedido": "HIST-H", "Nome do Produto": "Prateleira Tripla Hone", "Nome da variação": "Dourado/Branco",
    "Número de referência SKU": "5444", "Subtotal do produto": 100, "Preço acordado": 100,
  })]);
  eq("H: 5444 sem correspondência segura continua sem custo", resultH.detailedRows[0].CMV, null);
  eq("H: 5444 permanece como SKU não encontrado", resultH.unmatchedCosts[0].value, "5444");
}

// Teste 5 — sem Order.all, nada muda no motor estimado.
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
