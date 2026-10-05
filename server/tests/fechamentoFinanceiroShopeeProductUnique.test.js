// server/tests/fechamentoFinanceiroShopeeProductUnique.test.js
// Ponte de identidade Shopee — produto exato -> UM Item ID (FIN-390).
//
// Causa real (FIN-389 x FIN-390, set/2026): a mesma base e a mesma
// Performance cobriam 92,83% no motor de Performance e 50,70% no motor real
// do Order.all. ~R$ 76 mil vinham de linhas do Order.all SEM SKU (principal e
// de variação) e SEM variação — só com o nome do produto. A Performance
// identifica esses anúncios pelo Item ID nativo, mas nenhuma estratégia da
// ponte do motor real resolvia uma linha só com produto: todas exigem SKU ou
// variação, e a equivalência financeira por item (fuzzy de título) recusa
// item com um único registro e empata "Kit 5 Perfumes" com "ATRACION Kit 5
// Perfumes".
//
// Regra testada aqui — `product_unique` resolve SOMENTE a identidade do
// ITEM. Nunca devolve custo diretamente e nunca escolhe Model ID:
//   - só se aplica com SKU vazio + variação vazia + produto não vazio;
//   - título NORMALIZADO exatamente igual (nada de fuzzy);
//   - mais de um Item ID com esse título -> ambíguo, SEM equivalência
//     financeira entre itens (itens diferentes nunca se equivalem);
//   - um Item ID -> Model IDs desse item pela Performance:
//       1 Model ID -> fluxo normal do Model ID (lookup exato, conflito de
//         item, fallback do pai com evidência);
//       vários -> equivalência financeira existente (todos na base, válidos,
//         custo + imposto iguais) ou sem custo;
//       nenhum (anúncio sem variação na Performance) -> lookup pelo Item ID,
//         mas só se o bloco do item na base não tiver custos/impostos
//         divergentes (a Performance "sem variação" NÃO prova Model ID único);
//   - custo zero, vazio ou #N/A continua sem custo;
//   - qualquer estratégia mais forte (Model ID, SKU, ponte por SKU) vence.
//
// Fixtures mínimas, sintéticas e anônimas — NÃO usam as planilhas reais do
// caso (essas ficam fora do repositório e nunca são commitadas).

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
    "Preço acordado": 100,
    "Subtotal do produto": 100,
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
    "SKU Principle": "-",
    "Vendas (Pedido pago) (BRL)": 0,
    "Unidades (Pedido pago)": 0,
    "Impressão do Produto": 0,
    "Cliques Por Produto": 0,
    CTR: "0%",
    ...overrides,
  };
}

// Anúncio sem variação na Performance: só a linha do item.
function itemSemVariacao(itemId, titulo, extra = {}) {
  return linhaPerformance({ "ID do Item": itemId, Produto: titulo, ...extra });
}

// Anúncio com variações: linha agregada do item + uma linha por Model ID.
function itemComVariacoes(itemId, titulo, modelos) {
  return [
    linhaPerformance({ "ID do Item": itemId, Produto: titulo }),
    ...modelos.map(([modelId, nome]) =>
      linhaPerformance({
        "ID do Item": itemId,
        Produto: titulo,
        "ID da Variação": modelId,
        "Nome da Variação": nome,
      })
    ),
  ];
}

function pedido(titulo, overrides = {}) {
  return linhaOrderAll({ "ID do pedido": "PED-PU", "Nome do Produto": titulo, ...overrides });
}

function rodar(performance, costRows, orderAll) {
  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  return { r, linha: r.detailedRows[0] };
}

const TITULO = "Kit 5 Perfumes Masculino Importado 100ml";
const TITULO_PARECIDO = "ATRACION Kit 5 Perfumes Masculino Importado 100ml";

// ── 1. Model ID direto no Order.all → continua vencendo ────────────────────
console.log("\n▸ Teste 1 — Model ID direto no Order.all → match direto, product_unique nem é tentado");
{
  const performance = [itemSemVariacao("9001", TITULO)];
  const costRows = [
    { id: "9001", "id model": "", custo: 50, imposto: 6 },
    { id: "", "id model": "777001", custo: 12, imposto: 6 },
  ];
  const { linha } = rodar(performance, costRows, [pedido(TITULO, { "ID do modelo": "777001" })]);
  eq("custo vem do Model ID direto", linha.CMV, 12);
  eq("origem é direct_model_id", linha["Match de custo"], "direct_model_id");
}

// ── 2. SKU direto na base → continua vencendo ──────────────────────────────
console.log("\n▸ Teste 2 — SKU do Order.all presente na base → match direto");
{
  const performance = [itemSemVariacao("9002", TITULO)];
  const costRows = [
    { id: "9002", custo: 50, imposto: 6 },
    { sku: "SKU-DIRETO", custo: 21, imposto: 6 },
  ];
  const { linha } = rodar(
    performance,
    costRows,
    [pedido(TITULO, { "Número de referência SKU": "SKU-DIRETO" })]
  );
  eq("custo vem do SKU direto", linha.CMV, 21);
  ok("origem é um match direto", String(linha["Match de custo"]).startsWith("direct_"));
}

// ── 3. SKU vazio + variação vazia + produto único (item sem variação) ──────
console.log("\n▸ Teste 3 — sem SKU, sem variação, título exato → um Item ID sem variação → custo do item");
{
  const performance = [
    itemSemVariacao("9003", TITULO),
    itemSemVariacao("9099", "Perfume Feminino Floral 50ml"),
  ];
  const costRows = [
    { id: "9003", "id model": "555003", custo: 48.74, imposto: 6 },
    { id: "9099", "id model": "555099", custo: 10, imposto: 6 },
  ];
  const { r, linha } = rodar(performance, costRows, [pedido(TITULO)]);
  eq("CMV é o custo do item identificado", linha.CMV, 48.74);
  eq("imposto vem da mesma linha da base", linha.Imposto, 6);
  eq("origem é bridge_product_unique", linha["Match de custo"], "bridge_product_unique");
  eq("ID resolvido é o Item ID", linha["ID resolvido pela ponte"], "9003");
  eq("contador da estratégia é incrementado", r.summary.bridgeProductUniqueMatchCount, 1);
  eq("cobertura total", r.summary.calculatedCoveragePercent, 100);
}

// ── 3b. Produto único com UM Model ID na Performance → fluxo do Model ID ───
console.log("\n▸ Teste 3b — título exato → item com UM Model ID → custo exato do Model ID");
{
  const performance = itemComVariacoes("9004", TITULO, [["666004", "Único"]]);
  const costRows = [{ id: "9004", "id model": "666004", custo: 33, imposto: 4 }];
  const { linha } = rodar(performance, costRows, [pedido(TITULO)]);
  eq("CMV é o custo do Model ID", linha.CMV, 33);
  eq("origem é bridge_product_unique", linha["Match de custo"], "bridge_product_unique");
  eq("ID resolvido é o Model ID, nunca o item", linha["ID resolvido pela ponte"], "666004");
}

// ── 4. Mesmo título em dois Item IDs → ambíguo, mesmo com custo igual ──────
console.log("\n▸ Teste 4 — mesmo título em dois Item IDs → ambiguous (sem equivalência entre itens)");
{
  const performance = [itemSemVariacao("9005", TITULO), itemSemVariacao("9006", TITULO)];
  const costRows = [
    { id: "9005", custo: 10.14, imposto: 6 },
    { id: "9006", custo: 10.14, imposto: 6 }, // custo igual NÃO resolve: são itens diferentes.
  ];
  const { r, linha } = rodar(performance, costRows, [pedido(TITULO)]);
  eq("CMV continua nulo", linha.CMV, null);
  eq("origem é ambiguous", linha["Match de custo"], "ambiguous");
  eq("contabilizado como ambíguo", r.summary.bridgeAmbiguousCount, 1);
  const gap = r.unmatchedCosts.find((g) => g.reason === "ambiguous_bridge_candidates");
  ok("diagnóstico lista os dois Item IDs", gap && gap.candidates.includes("9005") && gap.candidates.includes("9006"));
}

// ── 5. Item com vários Model IDs, todos custo/imposto iguais → equivalência ─
console.log("\n▸ Teste 5 — item único com vários Model IDs de custo igual → equivalência financeira existente");
{
  const performance = itemComVariacoes("9007", TITULO, [
    ["667001", "Azul,P"],
    ["667002", "Azul,M"],
    ["667003", "Preto,G"],
  ]);
  const costRows = [
    { id: "9007", "id model": "667001", custo: 29.23, imposto: 6 },
    { id: "", "id model": "667002", custo: 29.23, imposto: 6 },
    { id: "", "id model": "667003", custo: 29.23, imposto: 6 },
  ];
  const { r, linha } = rodar(performance, costRows, [pedido(TITULO)]);
  eq("CMV é o custo comum", linha.CMV, 29.23);
  eq("origem é a equivalência financeira por item", linha["Match de custo"], "bridge_item_financial_equivalent");
  ok("nunca afirma um Model ID específico", !linha["ID resolvido pela ponte"]);
  eq("contador da equivalência por item é incrementado", r.summary.bridgeItemFinancialEquivalentMatchCount, 1);
}

// ── 6. Item com vários Model IDs e custos diferentes → não resolve ─────────
console.log("\n▸ Teste 6 — item único com Model IDs de custos diferentes → sem custo");
{
  const performance = itemComVariacoes("9008", TITULO, [
    ["668001", "1UNID"],
    ["668002", "2 UNID"],
  ]);
  const costRows = [
    { id: "9008", "id model": "668001", custo: 10.14, imposto: 6 },
    { id: "", "id model": "668002", custo: 19.44, imposto: 6 },
  ];
  const { r, linha } = rodar(performance, costRows, [pedido(TITULO)]);
  eq("CMV continua nulo — nenhum custo é escolhido", linha.CMV, null);
  eq("origem é ambiguous", linha["Match de custo"], "ambiguous");
  const gap = r.unmatchedCosts.find((g) => g.reason === "ambiguous_bridge_candidates");
  ok("diagnóstico lista os Model IDs conflitantes", gap && gap.candidates.includes("668001") && gap.candidates.includes("668002"));
}

console.log("\n▸ Teste 6b — vários Model IDs com mesmo custo mas imposto diferente → sem custo");
{
  const performance = itemComVariacoes("9009", TITULO, [
    ["669001", "Azul"],
    ["669002", "Verde"],
  ]);
  const costRows = [
    { id: "9009", "id model": "669001", custo: 20, imposto: 6 },
    { id: "", "id model": "669002", custo: 20, imposto: 4 },
  ];
  const { linha } = rodar(performance, costRows, [pedido(TITULO)]);
  eq("CMV continua nulo", linha.CMV, null);
}

// ── 7. Model ID presente na base → lookup pelo Model ID, não pelo pai ──────
console.log("\n▸ Teste 7 — Model ID único presente na base com custo diferente do pai → usa o Model ID");
{
  const performance = itemComVariacoes("9010", TITULO, [["670001", "Único"]]);
  const costRows = [
    { id: "9010", "id model": "", custo: 99, imposto: 6 },
    { id: "", "id model": "670001", custo: 15, imposto: 6 },
  ];
  const { linha } = rodar(performance, costRows, [pedido(TITULO)]);
  eq("CMV é o do Model ID", linha.CMV, 15);
  eq("ID resolvido é o Model ID", linha["ID resolvido pela ponte"], "670001");
}

// ── 8. Model ID ausente da base → sem custo ────────────────────────────────
console.log("\n▸ Teste 8 — Model ID único ausente da base (e item ausente) → sem custo");
{
  const performance = itemComVariacoes("9011", TITULO, [["671001", "Único"]]);
  const costRows = [{ id: "OUTRO", custo: 10, imposto: 6 }];
  const { linha } = rodar(performance, costRows, [pedido(TITULO)]);
  eq("CMV continua nulo", linha.CMV, null);
  eq("origem é miss", linha["Match de custo"], "miss");
}

console.log("\n▸ Teste 8b — item sem variação ausente da base → sem custo (gap real)");
{
  const performance = [itemSemVariacao("9012", TITULO)];
  const costRows = [{ id: "OUTRO", custo: 10, imposto: 6 }];
  const { r, linha } = rodar(performance, costRows, [pedido(TITULO)]);
  eq("CMV continua nulo", linha.CMV, null);
  const gap = r.unmatchedCosts[0];
  eq("diagnóstico aponta o Item ID ausente da base", gap.value, "9012");
  eq("motivo é not_found_in_cost_base", gap.reason, "not_found_in_cost_base");
}

// ── 9. Custo zero / vazio / #N/A → sem custo ───────────────────────────────
for (const [rotulo, custo] of [["zero", 0], ["vazio", ""], ["#N/A", "#N/A"]]) {
  console.log(`\n▸ Teste 9 — custo ${rotulo} no item identificado → sem custo`);
  const performance = [itemSemVariacao("9013", TITULO)];
  const costRows = [{ id: "9013", custo, imposto: 6 }];
  const { r, linha } = rodar(performance, costRows, [pedido(TITULO)]);
  eq(`custo ${rotulo} nunca vira CMV`, linha.CMV, null);
  eq(`receita ${rotulo} fica sem custo`, r.summary.revenueWithoutCost, 100);
}

console.log("\n▸ Teste 9b — vários Model IDs todos com #N/A → sem custo (equivalência exige custo válido)");
{
  const performance = itemComVariacoes("9014", TITULO, [
    ["672001", "Azul"],
    ["672002", "Verde"],
  ]);
  const costRows = [
    { id: "9014", "id model": "672001", custo: "#N/A", imposto: 6 },
    { id: "", "id model": "672002", custo: "#N/A", imposto: 6 },
  ];
  const { linha } = rodar(performance, costRows, [pedido(TITULO)]);
  eq("CMV continua nulo", linha.CMV, null);
}

// ── 10. Produto parecido, porém não igual → não resolve ────────────────────
console.log("\n▸ Teste 10 — título parecido mas não igual → não resolve (nada de fuzzy)");
{
  const performance = [itemSemVariacao("9015", TITULO_PARECIDO)];
  const costRows = [{ id: "9015", custo: 48.74, imposto: 6 }];
  const { linha } = rodar(performance, costRows, [pedido(TITULO)]);
  eq("CMV continua nulo", linha.CMV, null);
  eq("origem é miss", linha["Match de custo"], "miss");
}

console.log("\n▸ Teste 10b — título exato existe E um parecido também → resolve SÓ o exato");
{
  const performance = [itemSemVariacao("9016", TITULO), itemSemVariacao("9017", TITULO_PARECIDO)];
  const costRows = [
    { id: "9016", custo: 48.74, imposto: 6 },
    { id: "9017", custo: 70, imposto: 6 },
  ];
  const { linha } = rodar(performance, costRows, [pedido(TITULO)]);
  eq("CMV é o do item de título exato", linha.CMV, 48.74);
  eq("ID resolvido é o exato", linha["ID resolvido pela ponte"], "9016");
}

console.log("\n▸ Teste 10c — caixa, acentos e espaços normalizados continuam exatos");
{
  const performance = [itemSemVariacao("9018", "Perfume  Árabe   Masculino 100ML")];
  const costRows = [{ id: "9018", custo: 39.44, imposto: 6 }];
  const { linha } = rodar(performance, costRows, [pedido("perfume arabe masculino 100ml")]);
  eq("CMV resolvido pelo título normalizado", linha.CMV, 39.44);
}

// ── Guardas de aplicabilidade ───────────────────────────────────────────────
console.log("\n▸ Teste 11 — linha COM variação → product_unique não se aplica");
{
  const performance = [itemSemVariacao("9019", TITULO)];
  const costRows = [{ id: "9019", custo: 48.74, imposto: 6 }];
  const { linha } = rodar(performance, costRows, [pedido(TITULO, { "Nome da variação": "Azul" })]);
  ok("não resolve por product_unique", linha["Match de custo"] !== "bridge_product_unique");
}

console.log("\n▸ Teste 12 — linha COM SKU que não está na Performance → product_unique não se aplica");
{
  const performance = [itemSemVariacao("9020", TITULO)];
  const costRows = [{ id: "9020", custo: 48.74, imposto: 6 }];
  const { linha } = rodar(
    performance,
    costRows,
    [pedido(TITULO, { "Nº de referência do SKU principal": "SKU-DESCONHECIDO" })]
  );
  eq("CMV continua nulo", linha.CMV, null);
  ok("não resolve por product_unique", linha["Match de custo"] !== "bridge_product_unique");
}

console.log("\n▸ Teste 13 — SKU da ponte vence o product_unique");
{
  const performance = [
    itemSemVariacao("9021", TITULO, { "SKU Principle": "KIT5-A" }),
    itemSemVariacao("9022", "Outro Anuncio Qualquer", { "SKU Principle": "KIT5-B" }),
  ];
  const costRows = [
    { id: "9021", custo: 48.74, imposto: 6 },
    { id: "9022", custo: 70, imposto: 6 },
  ];
  const { linha } = rodar(
    performance,
    costRows,
    [pedido(TITULO, { "Nº de referência do SKU principal": "KIT5-B" })]
  );
  eq("custo segue o SKU, não o título", linha.CMV, 70);
  eq("origem é bridge_item_id", linha["Match de custo"], "bridge_item_id");
}

// ── Base com várias linhas sob um item "sem variação" na Performance ───────
console.log("\n▸ Teste 14 — item sem variação na Performance, mas bloco da base com custos divergentes → sem custo");
{
  const performance = [itemSemVariacao("9023", TITULO)];
  const costRows = [
    { id: "9023", "id model": "673001", custo: 57, imposto: 6 },
    { id: "", "id model": "673002", custo: 76, imposto: 6 },
    { id: "", "id model": "673003", custo: 95, imposto: 6 },
  ];
  const { r, linha } = rodar(performance, costRows, [pedido(TITULO)]);
  eq("CMV continua nulo — o custo da primeira linha nunca é escolhido", linha.CMV, null);
  const gap = r.unmatchedCosts[0];
  eq("diagnóstico aponta o item", gap.value, "9023");
  eq("motivo explica a variação indeterminada", gap.reason, "item_variation_cost_undetermined");
}

console.log("\n▸ Teste 14b — mesmo bloco, imposto divergente → sem custo");
{
  const performance = [itemSemVariacao("9024", TITULO)];
  const costRows = [
    { id: "9024", "id model": "674001", custo: 20, imposto: 6 },
    { id: "", "id model": "674002", custo: 20, imposto: 4 },
  ];
  const { linha } = rodar(performance, costRows, [pedido(TITULO)]);
  eq("CMV continua nulo", linha.CMV, null);
}

console.log("\n▸ Teste 14c — bloco da base com várias linhas de custo/imposto IGUAIS → resolve");
{
  const performance = [itemSemVariacao("9025", TITULO)];
  const costRows = [
    { id: "9025", "id model": "675001", custo: 19, imposto: 6 },
    { id: "", "id model": "675002", custo: 19, imposto: 6 },
  ];
  const { linha } = rodar(performance, costRows, [pedido(TITULO)]);
  eq("CMV é o custo comum", linha.CMV, 19);
}

console.log("\n▸ Teste 14d — linha sem identificador logo abaixo do item → sem custo");
{
  const performance = [itemSemVariacao("9026", TITULO)];
  const costRows = [
    { id: "9026", custo: 19, imposto: 6 },
    { id: "", "id model": "", custo: 30, imposto: 6 },
  ];
  const { linha } = rodar(performance, costRows, [pedido(TITULO)]);
  eq("CMV continua nulo", linha.CMV, null);
}

// ── Ordem não importa ───────────────────────────────────────────────────────
console.log("\n▸ Teste 15 — ordem da Performance não muda o resultado");
{
  const base = [itemSemVariacao("9027", TITULO), itemSemVariacao("9028", "Outro Titulo")];
  const costRows = [
    { id: "9027", custo: 48.74, imposto: 6 },
    { id: "9028", custo: 5, imposto: 6 },
  ];
  const a = rodar(base, costRows, [pedido(TITULO)]).linha;
  const b = rodar(base.slice().reverse(), costRows, [pedido(TITULO)]).linha;
  eq("mesmo CMV nas duas ordens", a.CMV, b.CMV);
  eq("mesma origem nas duas ordens", a["Match de custo"], b["Match de custo"]);
}

// ── Receita/taxas não mudam: só custo ───────────────────────────────────────
console.log("\n▸ Teste 16 — receita bruta e líquida idênticas com e sem a ponte resolver o custo");
{
  const performance = [itemSemVariacao("9029", TITULO)];
  const linhaPedido = pedido(TITULO, {
    "Taxa de transação": "5",
    "Taxa de comissão líquida": "10",
    "Taxa de serviço líquida": "4",
  });
  const comCusto = rodar(performance, [{ id: "9029", custo: 40, imposto: 6 }], [linhaPedido]).r.summary;
  const semCusto = rodar(performance, [{ id: "OUTRO", custo: 40, imposto: 6 }], [linhaPedido]).r.summary;
  eq("receita bruta igual", comCusto.grossRevenueTotal, semCusto.grossRevenueTotal);
  eq("receita líquida igual", comCusto.paidRevenueTotal, semCusto.paidRevenueTotal);
  eq("taxas iguais", comCusto.marketplaceFeesTotal, semCusto.marketplaceFeesTotal);
}

console.log(`\n${checks} verificações OK`);
