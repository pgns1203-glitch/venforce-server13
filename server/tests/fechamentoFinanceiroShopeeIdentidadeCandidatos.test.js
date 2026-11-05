// server/tests/fechamentoFinanceiroShopeeIdentidadeCandidatos.test.js
// FIN-865 (2ª missão) — identidade por CONJUNTO DE CANDIDATOS reduzido por
// TODAS as evidências da venda (SKU da variação ∩ SKU principal ∩ produto ∩
// variação), antes de declarar ambiguidade.
//
// Causa real: selectShopeeIdentityFromRecords (a) nunca usava o SKU principal
// para reduzir candidatos de um SKU de variação repetido em vários anúncios
// ("ROSA"); (b) devolvia `ambiguous` já quando o título do Order.all não era
// igual ao de NENHUM candidato, sem deixar a variação exata decidir.
//
// Custo nunca é evidência de identidade: os fixtures usam custos diferentes
// entre os Models para provar que a escolha vem só da identidade.
// Fixtures sintéticos e anônimos.

const assert = require("assert");
const Module = require("module");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "xlsx") return { utils: { aoa_to_sheet: () => ({}), json_to_sheet: () => ({}) } };
  return originalLoad.call(this, request, parent, isMain);
};
const { processShopee } = require("../services/fechamentoFinanceiro/shopeePerformanceService");
Module._load = originalLoad;

let checks = 0;
const eq = (l, a, e) => { assert.strictEqual(a, e, `${l}: ${a} !== ${e}`); checks += 1; console.log(`  ok  ${l}`); };

const pedido = (o) => ({
  "ID do pedido": "P1", "Status do pedido": "Concluído", "Status da Devolução / Reembolso": "",
  "Nome do Produto": "Titulo do anuncio no pedido", "Nome da variação": "",
  "Nº de referência do SKU principal": "", "Número de referência SKU": "",
  Quantidade: 1, "Preço acordado": 100, "Subtotal do produto": 100,
  "Taxa de transação": "", "Taxa de comissão líquida": "", "Taxa de serviço líquida": "",
  "Valor estimado do frete": "", Imposto: "", CMV: "", ...o,
});
const perf = (item, model, produto, varName, varSku, principal) => ({
  "ID do Item": item, Produto: produto, "Status Atual do Item": "Normal",
  "ID da Variação": model, "Nome da Variação": varName, "Status Atual da Variação": "Normal",
  "SKU da Variação": varSku, "SKU Principle": principal,
  "Vendas (Pedido pago) (BRL)": 0, "Unidades (Pedido pago)": 0,
  "Impressão do Produto": 0, "Cliques Por Produto": 0, CTR: "0%",
});
const custo = (id, model, c) => ({ id, "model id": model, Custo: c, imposto: 5 });

console.log("\n▸ 1 — mesmo SKU de variação em 3 anúncios; SKU principal diferencia");
{
  const P = [
    perf("1", "11", "Combo Escova Flex Fitagem Pente", "COMBO ROSA", "ROSA", "COMBO FITAGEM RICCA"),
    perf("2", "22", "Mini Escova Cristal", "Rosa com verde", "ROSA", "MINI ESCOVA CRYSTAL"),
    perf("3", "33", "Pentes Basic Pack", "Rosa", "ROSA", "PENTES BASIC PACK"),
  ];
  const C = [custo("1", "11", 20.99), custo("2", "22", 11), custo("3", "33", 7)];
  const r = processShopee(P, C, 0, 0, 0, [pedido({
    "Nº de referência do SKU principal": "COMBO FITAGEM RICCA", "Número de referência SKU": "ROSA",
    "Nome da variação": "COMBO ROSA",
  })]);
  eq("CMV do Model correto", r.detailedRows[0].CMV, 20.99);
  eq("Model resolvido", String(r.detailedRows[0]["ID resolvido pela ponte"]), "11");
  const ordem = processShopee([...P].reverse(), [...C].reverse(), 0, 0, 0, [pedido({
    "Nº de referência do SKU principal": "COMBO FITAGEM RICCA", "Número de referência SKU": "ROSA",
    "Nome da variação": "COMBO ROSA" })]);
  eq("ordem das linhas não muda o resultado", ordem.detailedRows[0].CMV, 20.99);
}

console.log("\n▸ 2 — mesmo nome de variação em dois anúncios; SKU principal diferencia (título do pedido ≠ Performance)");
{
  const P = [
    perf("10", "101", "Bastao Facial Skincare Esfoliante", "Area Dos Olhos", "AREADOSOLHOS", "BASTAO"),
    perf("20", "201", "Bastao Facial Stick Hidratante", "Area Dos Olhos", "AREADOSOLHOS", "BASTAO RICCA"),
    perf("20", "202", "Bastao Facial Stick Hidratante", "Esfoliante", "ESFOLIANTE", "BASTAO RICCA"),
    perf("20", "203", "Bastao Facial Stick Hidratante", "Hidratante + Apaga Poros", "", "BASTAO RICCA"),
  ];
  const C = [custo("10", "101", 9), custo("20", "201", 12), custo("", "202", 13), custo("", "203", 14)];
  // (a) variação por SKU repetido + principal
  const a = processShopee(P, C, 0, 0, 0, [pedido({
    "Nº de referência do SKU principal": "BASTAO RICCA", "Número de referência SKU": "AREADOSOLHOS",
    "Nome da variação": "Area Dos Olhos" })]);
  eq("SKU variação repetido + principal → Model do anúncio certo", a.detailedRows[0].CMV, 12);
  // (b) só principal + nome da variação exato (sem SKU de variação), título diferente
  const b = processShopee(P, C, 0, 0, 0, [pedido({
    "Nº de referência do SKU principal": "BASTAO RICCA", "Nome da variação": "Hidratante + Apaga Poros" })]);
  eq("principal + variação exata, título do pedido diferente → Model", b.detailedRows[0].CMV, 14);
  eq("Model resolvido", String(b.detailedRows[0]["ID resolvido pela ponte"]), "203");
}

console.log("\n▸ 3 — evidências insuficientes → continua ambíguo, nada escolhido");
{
  // 2 anúncios com MESMO SKU principal, MESMO SKU de variação e MESMA variação; título do pedido não é igual a nenhum.
  const P = [
    perf("30", "301", "Anuncio A", "Rosa", "ROSA", "COMBO X"),
    perf("40", "401", "Anuncio B", "Rosa", "ROSA", "COMBO X"),
  ];
  const C = [custo("30", "301", 10), custo("40", "401", 25)];
  const r = processShopee(P, C, 0, 0, 0, [pedido({
    "Nº de referência do SKU principal": "COMBO X", "Número de referência SKU": "ROSA", "Nome da variação": "Rosa" })]);
  const row = r.detailedRows[0];
  eq("CMV nulo", row.CMV, null);
  eq("LC nulo", row.LC, null);
  eq("MC nulo", row.MC, null);
  eq("ambíguo", row["Match de custo"], "ambiguous");

  // Sem variação: 2 Itens sem Model, mesmo principal, títulos diferentes do pedido (caso GEL BASE).
  const G = [perf("50", "-", "Gel A", "-", "-", "GEL BASE"), perf("60", "-", "Gel B", "-", "-", "GEL BASE")];
  const GC = [{ id: "50", "model id": "5001", Custo: "", imposto: 4.4 }, { id: "60", "model id": "6001", Custo: 19.49, imposto: 4.4 }];
  const g = processShopee(G, GC, 0, 0, 0, [pedido({ "Nº de referência do SKU principal": "GEL BASE", "Número de referência SKU": "GEL BASE" })]);
  eq("2 anúncios mesmo principal, sem variação → ambíguo", g.detailedRows[0]["Match de custo"], "ambiguous");
  eq("custo do outro anúncio nunca vira escolha", g.detailedRows[0].CMV, null);
}

console.log("\n▸ 4 — Model ID direto no Order.all preservado");
{
  const P = [perf("70", "701", "A", "Rosa", "ROSA", "X"), perf("80", "801", "B", "Rosa", "ROSA", "Y")];
  const C = [custo("70", "701", 10), custo("80", "801", 25)];
  const r = processShopee(P, C, 0, 0, 0, [pedido({ "ID do modelo": "801", "Número de referência SKU": "ROSA" })]);
  eq("Model direto", r.detailedRows[0].CMV, 25);
  eq("origem", r.detailedRows[0]["Match de custo"], "direct_model_id");
}

console.log("\n▸ 5 — FIN-865 anterior continua em bridge_item_single_model");
{
  const T = "Pente vertix e Cera Fixa e modela 15g Ricca Acabamento Perfeito";
  const P = [perf("22894704027", "-", T, "-", "-", "ESCOVA 248 + CERA 15G RICCA")];
  const C = [custo("22894704027", "209615407282", 37.61)];
  const r = processShopee(P, C, 0, 0, 0, [pedido({
    "Nome do Produto": T, "Nº de referência do SKU principal": "PENTE 248 + CERA 15G RICCA",
    "Número de referência SKU": "PENTE 248 + CERA 15G RICCA" })]);
  eq("CMV", r.detailedRows[0].CMV, 37.61);
  eq("origem", r.detailedRows[0]["Match de custo"], "bridge_item_single_model");
}
console.log(`\n${checks} verificações OK`);
