// server/tests/fechamentoFinanceiroShopeeMultiItem.test.js
//
// Pedido Shopee com VÁRIOS itens, no formato do Order.all real (set/2026):
// sem coluna Repasse; "Valor Total", taxas de comissão/serviço/transação e
// "Valor estimado do frete" são de NÍVEL PEDIDO e vêm REPETIDOS em cada linha
// de item (no export real a comissão é 18% do pedido e o serviço R$ 4 por
// item + 2% do pedido — só fecham sobre o pedido, nunca sobre a linha).
//
// Arquitetura protegida: Order.all = verdade financeira; Performance = ponte
// de identidade (SKU → ID do Item/Variação); Base = custo/imposto. O pedido
// soma as suas linhas uma vez: taxa de pedido conta uma vez e é rateada por
// valor vendido; receita nunca duplica; sem custo é melhor que custo errado.

const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function loadWithXlsxStub(request, parent, isMain) {
  if (request === "xlsx") {
    return { utils: { aoa_to_sheet: () => ({}), json_to_sheet: () => ({}) } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { processShopee } = require("../services/fechamentoFinanceiro/shopeePerformanceService");
Module._load = originalLoad;

const { round2 } = require("../utils/numberUtils");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// Order.all: colunas reais; os campos de pedido são passados uma vez em
// `pedido` e repetidos em todas as linhas, como no export.
function pedido(id, campos, itens) {
  return itens.map((item) => ({
    "ID do pedido": id,
    "Status do pedido": "Concluído",
    "Cancelar Motivo": "",
    "Status da Devolução / Reembolso": "",
    "Nº de referência do SKU principal": item.skuPai || "",
    "Nome do Produto": item.produto,
    "Número de referência SKU": item.sku,
    "Nome da variação": item.variacao || "",
    "Preço acordado": String(item.preco),
    Quantidade: String(item.qtd || 1),
    "Subtotal do produto": String(round2(item.preco * (item.qtd || 1))),
    "Valor Total": "",
    "Taxa de transação": "0.00",
    "Taxa de comissão bruta": "",
    "Taxa de comissão líquida": "",
    "Taxa de serviço bruta": "",
    "Taxa de serviço líquida": "",
    "Total global": "",
    "Valor estimado do frete": "",
    "Número de produtos pedidos": String(itens.length),
    ...campos,
  }));
}
// Performance (parentskudetail): ponte SKU → ID do Item / ID da Variação.
function perf(itemId, variationId, sku, produto, variacao = "-") {
  return {
    "ID do Item": itemId, Produto: produto, "Status Atual do Item": "Normal",
    "ID da Variação": variationId, "Nome da Variação": variacao, "Status Atual da Variação": "Normal",
    "SKU da Variação": sku, "SKU Principle": "", "Vendas (Pedido pago) (BRL)": 0, "Unidades (Pedido pago)": 0,
    "Impressão do Produto": 0, "Cliques Por Produto": 0, CTR: "0%",
  };
}
const base = (itemId, modelId, custo, imposto = 10) => ({ id: itemId, "model id": modelId, Custo: custo, imposto });

const PERFORMANCE = [
  perf("1001", "5001", "CAN-BRANCO", "Caneca", "Branco"),
  perf("1001", "5002", "CAN-PRETO", "Caneca", "Preto"),
  perf("1002", "5003", "PRATO-G", "Prato"),
  perf("1003", "5004", "COPO-1", "Copo"),
];
const BASE = [base("1001", "5001", 9), base("1001", "5002", 11), base("1002", "5003", 20), base("1003", "5004", 5)];

const linhasDo = (r, id) => r.detailedRows.filter((l) => l["ID do pedido"] === id);
const soma = (rows, campo) => round2(rows.reduce((s, l) => s + Number(l[campo] || 0), 0));

// ── 1 pedido / 1 item ─────────────────────────────────────────────────────
console.log("\n▸ 1 pedido / 1 item");
{
  const oa = pedido("P1", { "Valor Total": "50.00", "Taxa de comissão líquida": "9.00", "Taxa de serviço líquida": "5.00" },
    [{ produto: "Copo", sku: "COPO-1", preco: 50 }]);
  const r = processShopee(PERFORMANCE, [base("1003", "5004", 5)], 0, 0, 0, oa);
  const [l] = linhasDo(r, "P1");
  eq("bruto = subtotal", l["Receita bruta"], 50);
  eq("líquido = bruto − comissão − serviço", l["Receita líquida"], 36);
  eq("custo pela ponte", l.CMV, 5);
  eq("LC = líquido − CMV − imposto", l.LC, 26);
}

// ── 1 pedido / 2 produtos diferentes (taxas de pedido repetidas) ──────────
console.log("\n▸ 1 pedido / 2 produtos de preços diferentes");
{
  const oa = pedido("P2", { "Valor Total": "100.00", "Taxa de comissão líquida": "18.00", "Taxa de serviço líquida": "10.00" }, [
    { produto: "Caneca", sku: "CAN-BRANCO", variacao: "Branco", preco: 60 },
    { produto: "Prato", sku: "PRATO-G", preco: 40 },
  ]);
  const r = processShopee(PERFORMANCE, BASE, 0, 0, 0, oa);
  const ls = linhasDo(r, "P2");
  eq("2 linhas", ls.length, 2);
  eq("Σ bruto = Valor Total do pedido (sem duplicar)", soma(ls, "Receita bruta"), 100);
  eq("taxas do pedido contadas UMA vez (18 + 10, não 56)", soma(ls, "Receita líquida"), 72);
  eq("rateio por valor vendido: 60% do líquido", ls[0]["Receita líquida"], 43.2);
  eq("rateio por valor vendido: 40% do líquido", ls[1]["Receita líquida"], 28.8);
  eq("cada linha com o SEU custo", ls.map((l) => l.CMV), [9, 20]);
  eq("faturamento do fechamento", r.summary.grossRevenueTotal, 100);
}

// ── 2 linhas iguais (caso do export real) ─────────────────────────────────
console.log("\n▸ 1 pedido / 2 variações do mesmo item, mesmo preço (export real)");
{
  const oa = pedido("P3", { "Valor Total": "51.78", "Taxa de comissão líquida": "9.32", "Taxa de serviço líquida": "9.04", "Valor estimado do frete": "15.80" }, [
    { produto: "Caneca", sku: "CAN-BRANCO", variacao: "Branco", preco: 25.89 },
    { produto: "Caneca", sku: "CAN-PRETO", variacao: "Preto", preco: 25.89 },
  ]);
  const r = processShopee(PERFORMANCE, BASE, 0, 0, 0, oa);
  const ls = linhasDo(r, "P3");
  eq("Σ bruto = 51,78", soma(ls, "Receita bruta"), 51.78);
  eq("Σ líquido = 51,78 − 9,32 − 9,04", soma(ls, "Receita líquida"), 33.42);
  eq("cada variação com o custo do SEU Model ID", ls.map((l) => l.CMV), [9, 11]);
  eq("frete positivo não é descontado (sinal indeterminado — regra existente)", r.summary.shippingFeesTotal ?? 0, 0);
}

// ── quantidade > 1 ────────────────────────────────────────────────────────
console.log("\n▸ 1 pedido / 2 unidades do mesmo SKU");
{
  const oa = pedido("P4", { "Valor Total": "79.78", "Taxa de comissão líquida": "14.36", "Taxa de serviço líquida": "9.60" },
    [{ produto: "Prato", sku: "PRATO-G", preco: 39.89, qtd: 2 }]);
  const r = processShopee(PERFORMANCE, BASE, 0, 0, 0, oa);
  const [l] = linhasDo(r, "P4");
  eq("bruto = preço × quantidade", l["Receita bruta"], 79.78);
  eq("CMV = custo × quantidade", l.CMV, 40);
  eq("imposto sobre o bruto", l.Imposto, 7.98);
}

// ── custo parcial × completo ──────────────────────────────────────────────
console.log("\n▸ pedido multi-item com custo parcial");
{
  const oa = pedido("P5", { "Valor Total": "100.00", "Taxa de comissão líquida": "18.00", "Taxa de serviço líquida": "10.00" }, [
    { produto: "Caneca", sku: "CAN-BRANCO", variacao: "Branco", preco: 60 },
    { produto: "Prato", sku: "PRATO-G", preco: 40 },
  ]);
  const r = processShopee(PERFORMANCE, BASE.filter((b) => b.id !== "1002"), 0, 0, 0, oa);
  const ls = linhasDo(r, "P5");
  eq("linha com custo calcula LC", typeof ls[0].LC, "number");
  eq("linha sem custo: LC desconhecido (null, nunca 0)", ls[1].LC, null);
  eq("a linha sem custo continua com a SUA parcela do líquido", ls[1]["Receita líquida"], 28.8);
  eq("receita com custo", r.summary.revenueWithCost, 60);
  eq("receita sem custo", r.summary.revenueWithoutCost, 40);
  eq("LC só da parcela calculável (43,20 − 9 − 6)", r.summary.contributionProfitTotal, 28.2);
}
{
  const oa = pedido("P6", { "Valor Total": "100.00", "Taxa de comissão líquida": "18.00", "Taxa de serviço líquida": "10.00" }, [
    { produto: "Caneca", sku: "CAN-BRANCO", variacao: "Branco", preco: 60 },
    { produto: "Prato", sku: "PRATO-G", preco: 40 },
  ]);
  const r = processShopee(PERFORMANCE, BASE, 0, 0, 0, oa);
  eq("custo completo: cobertura 100%", r.summary.calculatedCoveragePercent, 100);
  // (43,20 − 9 − 6) + (28,80 − 20 − 4)
  eq("LC do pedido = Σ LC das linhas", r.summary.contributionProfitTotal, 33);
}

// ── identidade em conflito ────────────────────────────────────────────────
console.log("\n▸ SKU que a Performance liga a dois Model IDs de custos diferentes → sem custo");
{
  const performance = [...PERFORMANCE, perf("1004", "5005", "PRATO-G", "Prato")];
  const oa = pedido("P7", { "Valor Total": "100.00", "Taxa de comissão líquida": "18.00", "Taxa de serviço líquida": "10.00" }, [
    { produto: "Caneca", sku: "CAN-BRANCO", variacao: "Branco", preco: 60 },
    { produto: "Prato", sku: "PRATO-G", preco: 40 },
  ]);
  const r = processShopee(performance, [...BASE, base("1004", "5005", 33)], 0, 0, 0, oa);
  const ls = linhasDo(r, "P7");
  eq("linha sem conflito mantém o custo", ls[0].CMV, 9);
  eq("linha em conflito fica sem custo (não escolhe por arbitragem)", ls[1].CMV, null);
  eq("pedido continua com o bruto inteiro", soma(ls, "Receita bruta"), 100);
}

// ── status do pedido ──────────────────────────────────────────────────────
console.log("\n▸ cancelado / não pago / devolução em pedido multi-item");
for (const [status, devolucao, rotulo] of [
  ["Cancelado", "", "cancelado"],
  ["Não pago", "", "não pago"],
  ["Concluído", "Reembolso concluído", "reembolso"],
]) {
  const oa = [
    ...pedido("OK", { "Valor Total": "50.00", "Taxa de comissão líquida": "9.00", "Taxa de serviço líquida": "5.00" },
      [{ produto: "Copo", sku: "COPO-1", preco: 50 }]),
    ...pedido("X", { "Status do pedido": status, "Status da Devolução / Reembolso": devolucao, "Valor Total": "100.00",
      "Taxa de comissão líquida": "18.00", "Taxa de serviço líquida": "10.00" }, [
      { produto: "Caneca", sku: "CAN-BRANCO", variacao: "Branco", preco: 60 },
      { produto: "Prato", sku: "PRATO-G", preco: 40 },
    ]),
  ];
  const r = processShopee(PERFORMANCE, BASE, 0, 0, 0, oa);
  eq(`${rotulo}: nenhuma linha do pedido no fechamento`, linhasDo(r, "X").length, 0);
  eq(`${rotulo}: as 2 linhas na auditoria, com o bruto de cada uma`, r.auditRows.filter((a) => a["ID do pedido"] === "X").map((a) => a["Receita bruta"]), [60, 40]);
  eq(`${rotulo}: faturamento só do pedido válido`, r.summary.grossRevenueTotal, 50);
}

// ── totalizador do Order.all ──────────────────────────────────────────────
console.log("\n▸ linha de TOTAL do Order.all não vira item nem pedido");
{
  const oa = [
    ...pedido("P8", { "Valor Total": "100.00", "Taxa de comissão líquida": "18.00", "Taxa de serviço líquida": "10.00" }, [
      { produto: "Caneca", sku: "CAN-BRANCO", variacao: "Branco", preco: 60 },
      { produto: "Prato", sku: "PRATO-G", preco: 40 },
    ]),
    { ...pedido("0", {}, [{ produto: "0", sku: "", preco: 0 }])[0], "ID do pedido": "0", "Status do pedido": "0",
      "Nome do Produto": "0", "Subtotal do produto": "100.00", "Valor Total": "100.00" },
  ];
  const r = processShopee(PERFORMANCE, BASE, 0, 0, 0, oa);
  eq("só as 2 linhas do pedido", r.detailedRows.length, 2);
  eq("faturamento sem o totalizador", r.summary.grossRevenueTotal, 100);
}

console.log(`\nfechamentoFinanceiroShopeeMultiItem.test.js: ${checks} verificações OK`);
