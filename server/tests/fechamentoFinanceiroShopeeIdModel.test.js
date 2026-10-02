// FIN-328 — regressões do cabeçalho compacto IDMODEL e da validação da
// identidade pai/variação. Fixtures sintéticas: nenhum dado do cliente.

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
  buildShopeeCostMap,
  processShopee,
} = require("../services/fechamentoFinanceiro/shopeePerformanceService");

Module._load = originalLoad;

let checks = 0;
function eq(label, actual, expected) {
  assert.strictEqual(actual, expected, `${label}: ${actual} !== ${expected}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function ok(label, condition) {
  assert.ok(condition, label);
  checks += 1;
  console.log(`  ok  ${label}`);
}

function performanceRow(overrides) {
  return {
    "ID do Item": "",
    Produto: "Produto sintético",
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

function variation(itemId, modelId, sku, name = "Única", product = "Produto sintético") {
  return performanceRow({
    "ID do Item": itemId,
    Produto: product,
    "ID da Variação": modelId,
    "Nome da Variação": name,
    "Status Atual da Variação": "Normal",
    "SKU da Variação": sku,
    "SKU Principle": sku,
    "Impressão do Produto": "-",
  });
}

function order(orderId, sku, product = "Produto sintético", variationName = "Única") {
  return {
    "ID do pedido": orderId,
    "Status do pedido": "Concluído",
    "Status da Devolução / Reembolso": "",
    "Nome do Produto": product,
    "Nome da variação": variationName,
    "Nº de referência do SKU principal": sku,
    "Número de referência SKU": sku,
    Quantidade: 1,
    "Preço acordado": 50,
    "Subtotal do produto": 50,
    "Taxa de transação": 1,
    "Taxa de comissão líquida": 5,
    "Taxa de serviço líquida": 2,
    "Valor estimado do frete": "",
    Imposto: "",
    CMV: "",
  };
}

console.log("\n▸ FIN-328.1 — cabeçalho IDMODEL é reconhecido");
{
  const map = buildShopeeCostMap([
    { ID: "ITEM-1", IDMODEL: "MODEL-1", Custo: "R$ 4,20", Imposto: "10%" },
  ]);
  const row = map.get("MODEL-1");
  ok("Model ID vira chave do mapa", !!row);
  eq("Model ID é preservado", row.modelId, "MODEL-1");
  eq("custo do Model ID é preservado", row.cost, 4.2);
}

console.log("\n▸ FIN-328.2 — identificação direta pela ponte usa o Model ID");
{
  const result = processShopee(
    [variation("ITEM-2", "MODEL-2", "SKU-2")],
    [{ ID: "ITEM-2", IDMODEL: "MODEL-2", Custo: 8.2, Imposto: 0.1 }],
    0,
    0,
    0,
    [order("ORDER-2", "SKU-2")]
  );
  eq("CMV vem do Model ID", result.detailedRows[0].CMV, 8.2);
  eq("origem registra Model ID da ponte", result.detailedRows[0]["Match de custo"], "bridge_variation_id");
  eq("ID resolvido é a variação", result.detailedRows[0]["ID resolvido pela ponte"], "MODEL-2");
}

console.log("\n▸ FIN-328.3 — pai com variações de custos diferentes");
{
  const performance = [
    variation("ITEM-3", "MODEL-3A", "SKU-3A", "Azul"),
    variation("ITEM-3", "MODEL-3B", "SKU-3B", "Verde"),
  ];
  const costs = [
    { ID: "ITEM-3", IDMODEL: "MODEL-3A", Custo: 4, Imposto: 0.1 },
    { ID: "ITEM-3", IDMODEL: "MODEL-3B", Custo: 9, Imposto: 0.1 },
  ];
  const result = processShopee(performance, costs, 0, 0, 0, [
    order("ORDER-3A", "SKU-3A", "Produto sintético", "Azul"),
    order("ORDER-3B", "SKU-3B", "Produto sintético", "Verde"),
  ]);
  eq("variação A usa seu próprio custo", result.detailedRows.find((r) => r["ID do pedido"] === "ORDER-3A").CMV, 4);
  eq("variação B usa seu próprio custo", result.detailedRows.find((r) => r["ID do pedido"] === "ORDER-3B").CMV, 9);
}

console.log("\n▸ FIN-328.4 — Model ID ausente da base permanece pendente");
{
  const result = processShopee(
    [variation("ITEM-4", "MODEL-4-MISSING", "SKU-4")],
    [{ ID: "OUTRO-ITEM", IDMODEL: "OUTRO-MODEL", Custo: 10, Imposto: 0.1 }],
    0,
    0,
    0,
    [order("ORDER-4", "SKU-4")]
  );
  eq("CMV continua vazio", result.detailedRows[0].CMV, null);
  eq("motivo é ausência na base", result.unmatchedCosts[0].reason, "not_found_in_cost_base");
  eq("pendência preserva o Model ID", result.unmatchedCosts[0].value, "MODEL-4-MISSING");
}

console.log("\n▸ FIN-328.5 — custo zero, vazio ou inválido nunca vira CMV");
{
  for (const [suffix, rawCost, issue] of [["ZERO", 0, "zero"], ["EMPTY", "", "empty"], ["INVALID", "#N/A", "invalid"]]) {
    const itemId = `ITEM-5-${suffix}`;
    const modelId = `MODEL-5-${suffix}`;
    const sku = `SKU-5-${suffix}`;
    const result = processShopee(
      [variation(itemId, modelId, sku)],
      [{ ID: itemId, IDMODEL: modelId, Custo: rawCost, Imposto: 0.1 }],
      0,
      0,
      0,
      [order(`ORDER-5-${suffix}`, sku)]
    );
    eq(`${issue}: CMV continua vazio`, result.detailedRows[0].CMV, null);
    eq(`${issue}: diagnóstico preservado`, result.unmatchedCosts[0].costIssue, issue);
  }
}

console.log("\n▸ FIN-328.6 — divergência de pai bloqueia o Model ID");
{
  const result = processShopee(
    [variation("ITEM-PERFORMANCE", "MODEL-CONFLICT", "SKU-CONFLICT")],
    [{ ID: "ITEM-BASE", IDMODEL: "MODEL-CONFLICT", Custo: 2.95, Imposto: 0.1 }],
    0,
    0,
    0,
    [order("ORDER-CONFLICT", "SKU-CONFLICT")]
  );
  eq("CMV não é atribuído ao pai divergente", result.detailedRows[0].CMV, null);
  const gap = result.unmatchedCosts[0];
  eq("motivo explicita a divergência", gap.reason, "model_item_mismatch");
  eq("pai da base é preservado", gap.costBaseItemId, "ITEM-BASE");
  eq("pai da Performance é preservado", gap.performanceItemId, "ITEM-PERFORMANCE");
}

console.log("\n▸ FIN-328.7 — candidatos ambíguos com custos diferentes não são arbitrados");
{
  const product = "Produto ambíguo";
  const performance = [
    variation("ITEM-7A", "MODEL-7A", "SKU-7", "Única", product),
    variation("ITEM-7B", "MODEL-7B", "SKU-7", "Única", product),
  ];
  const costs = [
    { ID: "ITEM-7A", IDMODEL: "MODEL-7A", Custo: 10, Imposto: 0.1 },
    { ID: "ITEM-7B", IDMODEL: "MODEL-7B", Custo: 20, Imposto: 0.1 },
  ];
  const result = processShopee(performance, costs, 0, 0, 0, [order("ORDER-7", "SKU-7", product)]);
  eq("CMV permanece vazio", result.detailedRows[0].CMV, null);
  eq("match permanece ambíguo", result.detailedRows[0]["Match de custo"], "ambiguous");
  eq("motivo é ambiguidade de candidatos", result.unmatchedCosts[0].reason, "ambiguous_bridge_candidates");
  eq("os dois candidatos são mantidos", result.unmatchedCosts[0].candidates.length, 2);
}

console.log(`\n✓ ${checks} verificações FIN-328 passaram`);
