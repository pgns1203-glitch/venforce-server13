// server/tests/fechamentoFinanceiroShopeeSkuPrincipalExato.test.js
// FIN-865 (3ª etapa) — desempate FINAL por SKU principal BRUTO.
//
// A normalização dos índices (maiúsculas, sem espaços) faz anúncios cujo SKU
// difere só na grafia colidirem ("Gel Base Beltrat 10ml" x "GEL BASE BELTRAT
// 10ML"). Só depois de TODAS as reduções por evidência, e só se EXATAMENTE
// um candidato tiver o mesmo SKU principal bruto do pedido (case-sensitive,
// trim, sem uppercase/espaços/acentos/tokens/fuzzy), ele é escolhido.
// Custo, título, preço, quantidade e ordem NUNCA decidem.
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

const SRC = "bridge_principal_sku_raw_exact";
const pedido = (sku, o) => ({
  "ID do pedido": "P1", "Status do pedido": "Concluído", "Status da Devolução / Reembolso": "",
  "Nome do Produto": "Titulo antigo do anuncio", "Nome da variação": "",
  "Nº de referência do SKU principal": sku, "Número de referência SKU": sku,
  Quantidade: 1, "Preço acordado": 100, "Subtotal do produto": 100,
  "Taxa de transação": "", "Taxa de comissão líquida": "", "Taxa de serviço líquida": "",
  "Valor estimado do frete": "", Imposto: "", CMV: "", ...o,
});
const perf = (item, titulo, principal) => ({
  "ID do Item": item, Produto: titulo, "Status Atual do Item": "Normal",
  "ID da Variação": "-", "Nome da Variação": "-", "Status Atual da Variação": "-",
  "SKU da Variação": "-", "SKU Principle": principal,
  "Vendas (Pedido pago) (BRL)": 0, "Unidades (Pedido pago)": 0,
  "Impressão do Produto": 0, "Cliques Por Produto": 0, CTR: "0%",
});
const base = (id, model, c) => ({ id, "model id": model, Custo: c, imposto: 4.4 });

const A = "Gel Base Beltrat 10ml", B = "GEL BASE BELTRAT 10ML";
const P = [perf("111", "Anuncio A atual", A), perf("222", "Anuncio B atual", B)];
const C = [base("111", "1111", ""), base("222", "2222", 19.49)];

console.log("\n▸ 1 — colisão só por caixa: grafia A → Item A (identidade conhecida, custo vazio na Base)");
{
  const r = processShopee(P, C, 0, 0, 0, [pedido(A)]);
  const row = r.detailedRows[0];
  eq("deixa de ser ambíguo", row["Match de custo"], SRC);
  eq("CMV nulo (custo vazio, nunca inventado)", row.CMV, null);
  eq("LC nulo", row.LC, null);
  eq("MC nulo", row.MC, null);
  eq("sem custo", row["Cobertura de custo"], "sem custo");
  eq("contador", r.summary.bridgeAmbiguousCount, 0);
  eq("contador da regra", r.summary.bridgePrincipalSkuRawExactMatchCount, 0); // sem custo não conta como match com custo
}

console.log("\n▸ 2 — outra grafia → Item B (custo do Item B)");
{
  const r = processShopee(P, C, 0, 0, 0, [pedido(B)]);
  const row = r.detailedRows[0];
  eq("origem explícita", row["Match de custo"], SRC);
  eq("CMV do Item B", row.CMV, 19.49);
  eq("Item resolvido pela identidade (SKU bruto)", String(row["ID resolvido pela ponte"]), "222");
  eq("contador da regra", r.summary.bridgePrincipalSkuRawExactMatchCount, 1);
  const inv = processShopee([...P].reverse(), [...C].reverse(), 0, 0, 0, [pedido(B)]);
  eq("ordem das linhas não muda", inv.detailedRows[0].CMV, 19.49);
}

console.log("\n▸ 3 — mesmo raw em dois candidatos → continua ambíguo");
{
  const P3 = [perf("111", "Anuncio A", B), perf("222", "Anuncio B", B)];
  const r = processShopee(P3, C, 0, 0, 0, [pedido(B)]);
  eq("ambíguo", r.detailedRows[0]["Match de custo"], "ambiguous");
  eq("CMV nulo", r.detailedRows[0].CMV, null);
}

console.log("\n▸ 4 — nenhum raw igual (caixa diferente) → continua ambíguo, sem case-insensitive");
{
  const r = processShopee(P, C, 0, 0, 0, [pedido("gel base beltrat 10ml")]);
  eq("ambíguo", r.detailedRows[0]["Match de custo"], "ambiguous");
  eq("CMV nulo", r.detailedRows[0].CMV, null);
  const esp = processShopee(P, C, 0, 0, 0, [pedido("Gel Base Beltrat  10ml")]);
  eq("espaçamento diferente também não casa", esp.detailedRows[0]["Match de custo"], "ambiguous");
}

console.log("\n▸ 5 — custo nunca decide: inverter quem tem custo não muda a identidade");
{
  const Cinv = [base("111", "1111", 50), base("222", "2222", "")];
  const r = processShopee(P, Cinv, 0, 0, 0, [pedido(A)]);
  eq("grafia A continua no Item A (custo 50)", r.detailedRows[0].CMV, 50);
  const r2 = processShopee(P, Cinv, 0, 0, 0, [pedido(B)]);
  eq("grafia B continua no Item B (custo vazio → nulo)", r2.detailedRows[0].CMV, null);
  eq("e não é ambíguo", r2.detailedRows[0]["Match de custo"], SRC);
}

console.log("\n▸ 6 — Item com 2 Models na Base: item pai NÃO escolhe Model ao acaso");
{
  const C6 = [base("111", "1111", 10), base("", "1112", 30), base("222", "2222", 19.49)];
  const r = processShopee(P, C6, 0, 0, 0, [pedido(A)]);
  eq("bloco do Item diverge → sem custo", r.detailedRows[0].CMV, null);
}
console.log(`\n${checks} verificações OK`);
