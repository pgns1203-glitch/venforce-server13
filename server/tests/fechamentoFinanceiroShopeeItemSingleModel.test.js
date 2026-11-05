// server/tests/fechamentoFinanceiroShopeeItemSingleModel.test.js
// FIN-865 — Item comprovado + EXATAMENTE UM Model válido na Base de custos.
//
// Causa real: a linha do Order.all tem SKU ("PENTE 248 + CERA 15G RICCA") que
// não casa com o SKU da Performance ("ESCOVA 248 + CERA 15G RICCA"), então
// nenhuma estratégia de identidade resolvia. O Item era identificável pelo
// título, mas a equivalência financeira recusa item com um candidato só e a
// Base tinha um único Model para ele -> "sem custo" (falso ambíguo).
//
// Regra: o Item é comprovado pelas estratégias existentes (corte de título
// de selectShopeeBridgeItemFinancialEquivalence). Se a Base tem EXATAMENTE UM
// Model válido para esse Item (e a Performance não lista outro), esse Model
// está determinado. 0 ou 2+ Models: nunca escolhe — 2+ sem equivalência
// financeira é ambiguidade real (custo/LC/MC nulos).
//
// Fixtures sintéticas e anônimas — as planilhas reais do FIN-865 não entram
// no repositório.

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

let checks = 0;
function ok(label, condition) { assert.ok(condition, label); checks += 1; console.log(`  ok  ${label}`); }
function eq(label, actual, expected) {
  assert.strictEqual(actual, expected, `${label}: ${actual} !== ${expected}`);
  checks += 1; console.log(`  ok  ${label}`);
}

function linhaOrderAll(overrides) {
  return {
    "ID do pedido": "PED-1", "Status do pedido": "Concluído", "Status da Devolução / Reembolso": "",
    "Nome do Produto": "Produto", "Nome da variação": "",
    "Nº de referência do SKU principal": "", "Número de referência SKU": "",
    Quantidade: 1, "Preço acordado": 100, "Subtotal do produto": 100,
    "Taxa de transação": "", "Taxa de comissão líquida": "", "Taxa de serviço líquida": "",
    "Valor estimado do frete": "", Imposto: "", CMV: "",
    ...overrides,
  };
}
function linhaPerformance(overrides) {
  return {
    "ID do Item": "", Produto: "Produto", "Status Atual do Item": "Normal",
    "ID da Variação": "-", "Nome da Variação": "-", "Status Atual da Variação": "-",
    "SKU da Variação": "-", "SKU Principle": "",
    "Vendas (Pedido pago) (BRL)": 0, "Unidades (Pedido pago)": 0,
    "Impressão do Produto": 0, "Cliques Por Produto": 0, CTR: "0%",
    ...overrides,
  };
}

const TITULO = "Pente Vertix e Cera Fixadora Modeladora 15g Acabamento Perfeito";
// Order.all com SKU que NÃO existe na Performance (a mudança textual do caso real).
const pedido = (extra) => linhaOrderAll({
  "Nome do Produto": TITULO,
  "Número de referência SKU": "PENTE 248 + CERA 15G",
  "Nº de referência do SKU principal": "PENTE 248 + CERA 15G",
  ...extra,
});
const perfItem = (itemId, extra) => linhaPerformance({
  "ID do Item": itemId, Produto: TITULO, "SKU Principle": "ESCOVA 248 + CERA 15G", ...extra,
});
const perfModel = (itemId, modelId, nome) => perfItem(itemId, {
  "ID da Variação": modelId, "Nome da Variação": nome, "SKU da Variação": `SKU-${modelId}`,
});
const custo = (id, model, c, imposto) => ({ id, "model id": model, Custo: c, imposto });

console.log("\n▸ Caso A — Item sem variação na Performance, 1 Model na Base → resolve o Model");
{
  const r = processShopee([perfItem("100")], [custo("100", "1001", 20, 5)], 0, 0, 0, [pedido()]);
  const row = r.detailedRows[0];
  eq("CMV = custo do único Model", row.CMV, 20);
  eq("origem do custo", row["Origem do custo"], "base_custos_ponte");
  eq("match", row["Match de custo"], "bridge_item_single_model");
  ok("LC calculável", row.LC !== null && row.LC !== undefined);
  ok("MC calculável", row.MC !== null && row.MC !== undefined);
  eq("contador", r.summary.bridgeItemSingleModelMatchCount, 1);
  eq("Model resolvido", String(row["ID resolvido pela ponte"]), "1001");
}

console.log("\n▸ Caso A2 — variação DECLARADA no Order.all que as estratégias recusaram → não resolve (G x GG)");
{
  const r = processShopee([perfModel("110", "1101", "Preto,GG")], [custo("110", "1101", 20, 5)], 0, 0, 0,
    [pedido({ "Nome da variação": "Preto,G" })]);
  eq("CMV nulo — variação declarada contradiz o único Model", r.detailedRows[0].CMV, null);
  eq("contador zerado", r.summary.bridgeItemSingleModelMatchCount, 0);
}

console.log("\n▸ Caso B — Item com 2 Models de custos diferentes → NÃO resolve, ambíguo");
{
  const perf = [perfModel("200", "2001", "Azul"), perfModel("200", "2002", "Rosa")];
  const base = [custo("200", "2001", 20, 5), custo("", "2002", 35, 5)];
  const r = processShopee(perf, base, 0, 0, 0, [pedido()]);
  const row = r.detailedRows[0];
  eq("CMV nulo", row.CMV, null);
  eq("LC nulo", row.LC, null);
  eq("MC nulo", row.MC, null);
  eq("sem custo", row["Cobertura de custo"], "sem custo");
  ok("nenhum Model afirmado", row["Match de custo"] !== "bridge_item_single_model");
  eq("marcado ambíguo", row["Match de custo"], "ambiguous");
  eq("contador de single-model zerado", r.summary.bridgeItemSingleModelMatchCount, 0);
}

console.log("\n▸ Caso B2 — Base com 2 Models, Performance sem variação (só o Item) → ambíguo");
{
  const base = [custo("210", "2101", 20, 5), custo("", "2102", 35, 5)];
  const r = processShopee([perfItem("210")], base, 0, 0, 0, [pedido()]);
  eq("CMV nulo", r.detailedRows[0].CMV, null);
  eq("marcado ambíguo", r.detailedRows[0]["Match de custo"], "ambiguous");
}

console.log("\n▸ Caso C — 2 Models financeiramente equivalentes → equivalência existente, sem afirmar Model");
{
  const perf = [perfModel("300", "3001", "Azul"), perfModel("300", "3002", "Rosa")];
  const base = [custo("300", "3001", 20, 5), custo("", "3002", 20, 5)];
  const r = processShopee(perf, base, 0, 0, 0, [pedido()]);
  const row = r.detailedRows[0];
  eq("CMV", row.CMV, 20);
  eq("origem preservada", row["Match de custo"], "bridge_item_financial_equivalent");
  eq("contador single-model zerado", r.summary.bridgeItemSingleModelMatchCount, 0);
}

console.log("\n▸ Caso D — Model ID direto no Order.all → comportamento atual preservado");
{
  const perf = [perfModel("400", "4001", "Azul"), perfModel("400", "4002", "Rosa")];
  const base = [custo("400", "4001", 20, 5), custo("", "4002", 35, 5)];
  const r = processShopee(perf, base, 0, 0, 0, [pedido({ "ID do modelo": "4002" })]);
  eq("CMV do Model exato", r.detailedRows[0].CMV, 35);
  eq("match direto", r.detailedRows[0]["Match de custo"], "direct_model_id");
}

console.log("\n▸ Caso E — Item comprovado, nenhum Model válido na Base → sem custo");
{
  const r = processShopee([perfItem("500")], [custo("999", "9991", 20, 5)], 0, 0, 0, [pedido()]);
  eq("CMV nulo (item ausente da Base)", r.detailedRows[0].CMV, null);
  const r2 = processShopee([perfItem("510")], [custo("510", "5101", "#N/A", 5)], 0, 0, 0, [pedido()]);
  eq("CMV nulo (único Model com custo inválido)", r2.detailedRows[0].CMV, null);
  const r3 = processShopee([perfItem("520")], [custo("520", "5201", 0, 5)], 0, 0, 0, [pedido()]);
  eq("CMV nulo (único Model com custo zero)", r3.detailedRows[0].CMV, null);
  eq("nenhum single-model", r2.summary.bridgeItemSingleModelMatchCount, 0);
}

console.log("\n▸ Guardas extras");
{
  // Performance lista 2 Models, Base só tem 1: o vendido pode ser o outro.
  const perf = [perfModel("600", "6001", "Azul"), perfModel("600", "6002", "Rosa")];
  const r = processShopee(perf, [custo("600", "6001", 20, 5)], 0, 0, 0, [pedido()]);
  eq("Performance com 2 Models e Base com 1 → não resolve", r.detailedRows[0].CMV, null);

  // Mesmo Model duplicado na Base com custos diferentes: nunca escolhe por ordem.
  const r2 = processShopee([perfItem("610")], [custo("610", "6101", 20, 5), custo("610", "6101", 30, 5)], 0, 0, 0, [pedido()]);
  eq("Model duplicado com custos divergentes → não resolve", r2.detailedRows[0].CMV, null);

  // Mesmo Model duplicado e idêntico conta como UM Model.
  const r3 = processShopee([perfItem("620")], [custo("620", "6201", 20, 5), custo("620", "6201", 20, 5)], 0, 0, 0, [pedido()]);
  eq("Model duplicado idêntico = 1 Model", r3.detailedRows[0].CMV, 20);

  // Item que só tem custo no pai (sem Model) NÃO é este caso.
  const r4 = processShopee([perfItem("630")], [{ id: "630", Custo: 20, imposto: 5 }], 0, 0, 0, [pedido()]);
  ok("pai sem Model não vira single-model", r4.summary.bridgeItemSingleModelMatchCount === 0);

  // Dois Itens com o mesmo título: Item não comprovado → nunca resolve.
  const r5 = processShopee([perfItem("640"), perfItem("641")],
    [custo("640", "6401", 20, 5), custo("641", "6411", 99, 5)], 0, 0, 0, [pedido()]);
  eq("2 Itens empatados → não resolve", r5.detailedRows[0].CMV, null);

  // Ordem das linhas nunca muda o resultado.
  const perfO = [perfModel("650", "6501", "Azul"), perfModel("650", "6502", "Rosa")];
  const baseO = [custo("650", "6501", 20, 5), custo("", "6502", 35, 5)];
  const a = processShopee(perfO, baseO, 0, 0, 0, [pedido()]).detailedRows[0].CMV;
  const b = processShopee([...perfO].reverse(), [...baseO].reverse(), 0, 0, 0, [pedido()]).detailedRows[0].CMV;
  eq("ordem não importa", a, b);

  // Título só PARECIDO (não igual) nunca prova o Item para esta regra.
  const perfP = [linhaPerformance({ "ID do Item": "660", Produto: `${TITULO} Edicao Limitada`, "SKU Principle": "OUTRO" })];
  const r6 = processShopee(perfP, [custo("660", "6601", 20, 5)], 0, 0, 0, [pedido()]);
  eq("título parecido mas diferente → não resolve", r6.detailedRows[0].CMV, null);

  // SKU quase igual (só zeros à esquerda) a um SKU registrado = outra identidade.
  const perfZ = [perfItem("670", { "SKU da Variação": "0007654352998", "ID da Variação": "6701", "Nome da Variação": "Unico" })];
  const r7 = processShopee(perfZ, [custo("670", "6701", 20, 5)], 0, 0, 0,
    [pedido({ "Número de referência SKU": "7654352998", "Nº de referência do SKU principal": "7654352998" })]);
  eq("SKU só diferente pelos zeros não herda custo", r7.detailedRows[0].CMV, null);
}

console.log(`\n${checks} verificações OK`);
