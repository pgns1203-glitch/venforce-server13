// server/tests/fechamentoFinanceiroShopeeOrderAllTotal.test.js
// Correção cirúrgica: o Order.all real do cliente tem uma linha de
// TOTAL/resumo (ID do pedido = "0.00", Status do pedido = "0.00", Nome do
// Produto = "0.00") que o parser estava tratando como pedido, inflando
// faturamento e derrubando a cobertura de custo (35,19% em vez de ~97,27%).
//
// Regra adicionada em shopeeOrderAllService.js: uma linha só é "TOTAL" se o
// ID do pedido bater o placeholder numérico E (o status OU o produto também
// baterem) — não é um `if (!orderId) continue` cego, porque pedidos reais
// legítimos sem ID continuam recebendo o fallback de sempre.

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
  parseShopeeFinancialRows,
  isShopeeOrderAllTotalRow,
} = require("../services/fechamentoFinanceiro/shopeeOrderAllService");
const { buildShopeeCostMap } = require("../services/fechamentoFinanceiro/shopeePerformanceService");

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
    "Nº de referência do SKU principal": "SKU-1",
    "Número de referência SKU": "SKU-1",
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

// A linha de TOTAL real do cliente, reproduzida com os mesmos valores
// (inclusive separador de milhar no subtotal, como no arquivo real).
function linhaTotalReal() {
  return {
    "ID do pedido": "0.00",
    "Status do pedido": "0.00",
    "Nome do Produto": "0.00",
    "Nº de referência do SKU principal": "0.00",
    "Número de referência SKU": "0.00",
    Quantidade: "0.00",
    "Preço acordado": "41,632.19",
    "Subtotal do produto": "42,071.64",
  };
}

// ── Teste 1 — linha normal com ID do pedido é processada normalmente ──────
console.log("\n▸ Teste 1 — linha normal com ID do pedido é processada");
{
  const linhas = parseShopeeFinancialRows([
    linhaOrderAll({ "ID do pedido": "260401KVVA9S0V", "Subtotal do produto": 47.9, "Preço acordado": 47.9 }),
  ]);
  eq("1 linha processada", linhas.length, 1);
  eq("ID do pedido preservado", linhas[0].id, "260401KVVA9S0V");
}

// ── Teste 2 — linha TOTAL sem identidade de pedido é ignorada ─────────────
console.log("\n▸ Teste 2 — linha TOTAL (placeholder 0.00) é ignorada pelo parser");
{
  eq("isShopeeOrderAllTotalRow reconhece o caso real", isShopeeOrderAllTotalRow("0.00", "0.00", "0.00"), true);
  eq("pedido normal não é confundido com TOTAL", isShopeeOrderAllTotalRow("260401KVVA9S0V", "Concluído", "Produto X"), false);
  // Corroboração: exige ID placeholder + pelo menos status OU produto também.
  eq("ID placeholder sozinho, sem corroboração, não vira TOTAL", isShopeeOrderAllTotalRow("0.00", "Concluído", "Produto real"), false);
  eq("vírgula decimal também é reconhecida como placeholder", isShopeeOrderAllTotalRow("0,00", "0,00", "Produto"), true);

  const linhas = parseShopeeFinancialRows([
    linhaOrderAll({ "ID do pedido": "260401KVVA9S0V", "Subtotal do produto": 47.9, "Preço acordado": 47.9 }),
    linhaTotalReal(),
  ]);
  eq("a linha TOTAL não entra no array parseado", linhas.length, 1);
  eq("sobrou só o pedido real", linhas[0].id, "260401KVVA9S0V");
}

// ── Teste 3 — linha TOTAL não aumenta faturamento nem receita líquida ─────
console.log("\n▸ Teste 3 — linha TOTAL não entra no faturamento");
{
  const semTotal = [
    linhaOrderAll({
      "ID do pedido": "P-1",
      "Subtotal do produto": 100,
      "Preço acordado": 100,
      "Taxa de comissão líquida": 10,
    }),
  ];
  const comTotal = [...semTotal, linhaTotalReal()];
  const costMap = buildShopeeCostMap([{ sku: "SKU-1", Custo: 30, imposto: 0 }]);

  const rSemTotal = processShopeeFinancialOrders({ salesRowsRaw: semTotal, costMap });
  const rComTotal = processShopeeFinancialOrders({ salesRowsRaw: comTotal, costMap });

  eq("faturamento idêntico com ou sem a linha de TOTAL", rComTotal.summary.grossRevenueTotal, rSemTotal.summary.grossRevenueTotal);
  eq("faturamento não inclui os 42.071,64 da linha de TOTAL", rComTotal.summary.grossRevenueTotal, 100);
  eq("receita líquida idêntica", rComTotal.summary.paidRevenueTotal, rSemTotal.summary.paidRevenueTotal);
}

// ── Teste 4 — linha TOTAL não aumenta a quantidade de pedidos ─────────────
console.log("\n▸ Teste 4 — linha TOTAL não vira um pedido a mais");
{
  const rows = [
    linhaOrderAll({ "ID do pedido": "P-1", "Subtotal do produto": 50, "Preço acordado": 50 }),
    linhaOrderAll({ "ID do pedido": "P-2", "Subtotal do produto": 70, "Preço acordado": 70 }),
    linhaTotalReal(),
  ];
  const costMap = new Map();
  const r = processShopeeFinancialOrders({ salesRowsRaw: rows, costMap });
  eq("ordersTotalCount conta só os 2 pedidos reais", r.summary.ordersTotalCount, 2);
  eq("orderAllTotalCount idem", r.summary.orderAllTotalCount, 2);
  eq("detailedRows não tem linha da TOTAL", r.detailedRows.length, 2);
  ok(
    "nenhuma linha do detalhamento tem ID '0.00'",
    !r.detailedRows.some((row) => row["ID do pedido"] === "0.00")
  );
}

// ── Teste 5 — linha TOTAL não derruba a cobertura de custo ────────────────
console.log("\n▸ Teste 5 — linha TOTAL não derruba a cobertura");
{
  const rows = [
    linhaOrderAll({
      "ID do pedido": "P-1",
      "Subtotal do produto": 100,
      "Preço acordado": 100,
      "Taxa de comissão líquida": 10,
    }),
    linhaTotalReal(),
  ];
  const costMap = buildShopeeCostMap([{ sku: "SKU-1", Custo: 30, imposto: 0 }]);
  const r = processShopeeFinancialOrders({ salesRowsRaw: rows, costMap });

  eq("cobertura 100% — a linha sem custo real não existe mais (era só a TOTAL)", r.summary.calculatedCoveragePercent, 100);
  eq("confiança confiável", r.summary.financialConfidence, "confiavel");
  eq("revenueWithoutCost zerado", r.summary.revenueWithoutCost, 0);
}

// ── Teste 6 — a ponte de custo continua funcionando com a linha TOTAL presente ──
console.log("\n▸ Teste 6 — ponte SKU → ID continua funcionando mesmo com a linha TOTAL no arquivo");
{
  const { processShopee, buildShopeeCostBridge } = require("../services/fechamentoFinanceiro/shopeePerformanceService");

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
    linhaTotalReal(),
  ];
  const performance = [
    {
      "ID do Item": "58259874628",
      "ID da Variação": "189188911747",
      Produto: "Resistência Elétrica 250W",
      "Status Atual do Item": "Normal",
      "Nome da Variação": "-",
      "Status Atual da Variação": "-",
      "SKU da Variação": "662",
      "SKU Principle": "662",
      "Vendas (Pedido pago) (BRL)": 0,
      "Unidades (Pedido pago)": 0,
      "Impressão do Produto": 0,
      "Cliques Por Produto": 0,
      CTR: "0%",
    },
  ];
  const costRows = [{ id: "58259874628", "model id": "189188911747", Custo: 100, imposto: 14.5 }];

  const bridge = buildShopeeCostBridge(performance);
  ok("a ponte foi construída normalmente", bridge.get("662") !== undefined);

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("modo continua real_financial", r.summary.calculationMode, "real_financial");
  eq("1 pedido processado (a TOTAL não conta)", r.summary.ordersTotalCount, 1);
  const linha = r.detailedRows.find((row) => row["ID do pedido"] === "260401KVVA9S0V");
  eq("custo resolvido pela ponte", linha["Origem do custo"], "base_custos_ponte");
  eq("CMV correto", linha.CMV, 100);
  eq("cobertura 100% (a TOTAL nunca entrou na conta)", r.summary.calculatedCoveragePercent, 100);
}

console.log(`\n${checks} verificações passaram. Linha de TOTAL do Order.all corretamente ignorada.`);
