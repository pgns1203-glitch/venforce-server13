// SKU Principle repetido não pode bloquear nem substituir a identidade da
// variação. Fixtures sintéticas; as planilhas reais não entram no repositório.
const assert = require("assert/strict");
const XLSX = require("xlsx");
const { parseSpreadsheet, parseShopeeCostSpreadsheet } = require("../utils/excelUtils");
const {
  processShopee,
  buildShopeeCostBridge,
  buildShopeeCostMap,
} = require("../services/fechamentoFinanceiro/shopeePerformanceService");
const {
  parseShopeeFinancialRows,
  resolveShopeeLineCost,
} = require("../services/fechamentoFinanceiro/shopeeOrderAllService");

const performance = ["A", "B"].map((suffix, i) => ({
  "ID do Item": `ITEM-${i + 1}`,
  Produto: "Produto de teste",
  "ID da Variação": `MODEL-${i + 1}`,
  "Nome da Variação": "Única",
  "SKU da Variação": `FTWILTEX-${suffix}`,
  "SKU Principle": "FTWILTEX",
  "Vendas (Pedido pago) (BRL)": 100,
  "Unidades (Pedido pago)": 1,
  "Impressão do Produto": 10,
  "Cliques Por Produto": 2,
  CTR: "20%",
}));
const costs = [
  { ID: "ITEM-1", "ID Model": "MODEL-1", Custo: 10, Imposto: 0.08 },
  { ID: "ITEM-2", "ID Model": "MODEL-2", Custo: 27, Imposto: 0.11 },
];
const order = (sku, field = "Número de referência SKU") => ({
  "ID do pedido": "PEDIDO-TESTE",
  "Status do pedido": "Concluído",
  "Nome do Produto": "Produto de teste",
  "Nome da variação": "Única",
  "Nº de referência do SKU principal": "FTWILTEX",
  [field]: sku,
  Quantidade: 1,
  "Subtotal do produto": 100,
  "Taxa de comissão líquida": 10,
  "Taxa de serviço líquida": 5,
});
const permutations = rows => [rows, [...rows].reverse()];
let checks = 0;
function eq(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  checks++;
}
function run(perf, base, sale) {
  return processShopee(perf, base, 0, 0, 0, [sale]);
}
function match(perf, base, sale) {
  return resolveShopeeLineCost(
    buildShopeeCostMap(base),
    parseShopeeFinancialRows([sale])[0],
    buildShopeeCostBridge(perf)
  );
}

console.log("▸ FTWILTEX: variação exata vence SKU Principle repetido, independente da ordem");
for (const perf of permutations(performance)) {
  for (const base of permutations(costs)) {
    for (const field of ["Número de referência SKU", "SKU da Variação", "SKU"]) {
      for (const [sku, item, model, cost, tax] of [
        ["FTWILTEX-A", "ITEM-1", "MODEL-1", 10, 8],
        ["FTWILTEX-B", "ITEM-2", "MODEL-2", 27, 11],
      ]) {
        const sale = order(sku, field);
        const identity = match(perf, base, sale);
        eq(identity.identitySource, "variation_sku", "resolve pelo índice da variação");
        eq(identity.matchedId, model, "Model exato, nunca o primeiro candidato");
        eq(identity.costRow.id, item, "Item da Base corresponde ao Item da Performance");
        eq(identity.ambiguous, false, "SKU principal repetido não cria ambiguidade");
        const result = run(perf, base, sale);
        const row = result.detailedRows[0];
        eq(row["Match de custo"], "bridge_variation_id", "match específico preservado");
        eq(row.CMV, cost, "custo da variação vendida");
        eq(row.Imposto, tax, "imposto da mesma variação");
        eq(row.LC, 85 - cost - tax, "fórmula financeira preservada");
        eq(result.summary.bridgeAmbiguousCount, 0, "nenhuma falsa ambiguidade");
      }
    }
  }
}

console.log("▸ Colisão entre campos: SKU principal não contamina índice de SKU da variação");
{
  const perf = performance.map(p => ({ ...p, "SKU Principle": "FTWILTEX-B" }));
  eq(match(perf, costs, order("FTWILTEX-B")).matchedId, "MODEL-2", "índices separados");
}

console.log("▸ Inverso: evidências indistinguíveis e custo ou imposto diferentes continuam ambíguos");
const indistinguishable = performance.map(p => ({ ...p, "SKU da Variação": "FTWILTEX-IGUAL" }));
for (const perf of permutations(indistinguishable)) {
  for (const baseCase of [costs, costs.map(c => ({ ...c, Custo: 10 }))]) {
    for (const base of permutations(baseCase)) {
      const result = run(perf, base, order("FTWILTEX-IGUAL"));
      const row = result.detailedRows[0];
      eq(row["Match de custo"], "ambiguous", "custo/imposto incompatíveis não são arbitrados");
      eq([row.CMV, row.LC, row.MC], [null, null, null], "ausência nunca vira custo/lucro zero");
      eq(result.summary.grossRevenueTotal, 100, "receita preservada");
      eq(result.summary.revenueWithoutCost, 100, "receita pendente explícita");
      eq(result.unmatchedCosts[0].reason, "ambiguous_bridge_candidates", "motivo preservado");
    }
  }
}
{
  const result = run(performance, costs, order(""));
  eq(result.detailedRows[0]["Match de custo"], "ambiguous", "só o SKU pai não distingue Models");
}

console.log("▸ Equivalência financeira existente continua intacta");
{
  const equivalent = costs.map(c => ({ ...c, Custo: 10, Imposto: 0.08 }));
  const result = run(indistinguishable, equivalent, order("FTWILTEX-IGUAL"));
  eq(result.detailedRows[0]["Match de custo"], "bridge_equivalent_cost", "fallback existente preservado");
  eq(result.detailedRows[0].CMV, 10, "custo comprovadamente equivalente");
  eq(result.summary.bridgeEquivalentCostMatchCount, 1, "contador existente preservado");
  const missing = run(indistinguishable, [equivalent[0]], order("FTWILTEX-IGUAL"));
  eq(missing.detailedRows[0].CMV, null, "candidato ausente não permite ampliar equivalência");
}

console.log("▸ Model encontrado sob outro Item não fornece custo");
{
  const wrongParent = costs.map(c => c.ID === "ITEM-2" ? { ...c, ID: "OUTRO-ITEM" } : c);
  const result = run(performance, wrongParent, order("FTWILTEX-B"));
  eq(result.detailedRows[0].CMV, null, "Model não pode ser tomado de outro Item");
  eq(result.unmatchedCosts[0].reason, "model_item_mismatch", "proteção FIN-328 preservada");
}

console.log("▸ Upload XLSX: mesma cadeia de leitura usada pelo controller (FIN-508)");
function buffer(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Dados");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
{
  const result = run(
    parseSpreadsheet(buffer(performance)),
    parseShopeeCostSpreadsheet(buffer(costs)),
    parseSpreadsheet(buffer([order("FTWILTEX-B")]))[0]
  );
  eq(result.detailedRows[0]["ID resolvido pela ponte"], "MODEL-2", "Model exato após upload");
  eq(result.detailedRows[0].CMV, 27, "custo correto após upload");
  eq(result.summary.bridgeAmbiguousCount, 0, "upload não confunde SKU pai repetido");
}
console.log(`✓ ${checks} verificações de prioridade SKU da Variação concluídas`);
