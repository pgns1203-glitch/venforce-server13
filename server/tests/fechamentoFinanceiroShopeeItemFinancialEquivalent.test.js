// server/tests/fechamentoFinanceiroShopeeItemFinancialEquivalent.test.js
// Equivalência financeira POR ITEM — último recurso da ponte de identidade
// Shopee, só tentado quando NENHUMA estratégia de identidade (SKU exato,
// sufixo histórico, token-set, produto+variação exato, SKU principal,
// FIN-21 título+variação, FIN-24 alias de atributo, CARMINA token fuzzy)
// resolveu Model ID nenhum.
//
// Causa real: investigação do corpus FIN-24 mostrou R$ 1.478,10 presos no
// MESMO item Shopee — a variação histórica do Order.all (vocabulário de cor
// diferente: singular/plural, rótulo genérico "Multicolorido" vs combos
// nomeados) não bate em NENHUMA estratégia de atributo, mas TODOS os Model
// IDs desse item custam e tributam exatamente igual. Nesses casos, a
// variação exata deixa de ser financeiramente relevante.
//
// Fixtures mínimas, sintéticas e anônimas — NÃO usam as planilhas reais do
// caso FIN-24 (essas ficam fora do repositório, em
// ~/Documentos/venforce_financeiro_cases/FIN-24, e nunca são commitadas).
//
// Regras protegidas aqui:
//  - esta função NUNCA resolve identidade — só resultado financeiro; nunca
//    afirma qual Model ID foi vendido (nunca "candidates[0]");
//  - item identificado de forma inequívoca pelo título + TODOS os seus
//    Model IDs com custo/imposto idênticos -> resolve
//    (bridge_item_financial_equivalent), sem escolher variação;
//  - um único Model ID com custo diferente, imposto diferente, ausente da
//    base ou #N/A -> derruba a equivalência inteira, NUNCA resolve;
//  - dois itens candidatos empatados no topo do corte de título -> nunca
//    resolve (itens diferentes podem ter preços diferentes);
//  - item com UM SÓ Model ID nunca aciona esta regra — não há "variação
//    indeterminada" quando só existe um candidato: se ele não bateu nas
//    estratégias de atributo acima, é porque foi recusado, não porque é
//    desconhecido;
//  - SKU/Model ID direto, FIN-21, FIN-24 (alias exato) e o token-set/fuzzy
//    do CARMINA sempre vencem antes desta regra, mesmo quando o item
//    também teria equivalência financeira;
//  - ordem das linhas da performance/custos nunca muda o resultado.

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

const TITULO = "Kit Presente Sortido Aromas Diversos Especial Colecao";

function modelosDoItem(itemId, n, corPrefix = "Cor") {
  const linhas = [];
  for (let i = 1; i <= n; i += 1) {
    linhas.push(
      linhaPerformance({
        "ID do Item": itemId,
        Produto: TITULO,
        "ID da Variação": `${itemId}-M${i}`,
        "Nome da Variação": `${corPrefix} ${i}`,
      })
    );
  }
  return linhas;
}

function custosUniformes(itemId, n, custo, imposto) {
  const linhas = [];
  for (let i = 1; i <= n; i += 1) {
    linhas.push({ id: itemId, "model id": `${itemId}-M${i}`, Custo: custo, imposto });
  }
  return linhas;
}

function pedidoBase(overrides) {
  return linhaOrderAll({
    "ID do pedido": "PED-EQ",
    "Nome do Produto": TITULO,
    "Nome da variação": "Aroma Surpresa Nao Catalogado",
    "Subtotal do produto": 90,
    "Preço acordado": 90,
    ...overrides,
  });
}

// ── Teste 1 — 10 models, todos custo 19 / imposto 4 → resolve equivalente ──
console.log("\n▸ Teste 1 — 10 Model IDs, todos custo/imposto iguais → resolve equivalência por item");
{
  const orderAll = [pedidoBase()];
  const performance = modelosDoItem("ITEM-EQ10", 10);
  const costRows = custosUniformes("ITEM-EQ10", 10, 19, 4);

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("CMV é o custo uniforme do item", r.detailedRows[0].CMV, 19);
  eq(
    "origem é bridge_item_financial_equivalent",
    r.detailedRows[0]["Match de custo"],
    "bridge_item_financial_equivalent"
  );
  eq("contador do item-equivalent é incrementado", r.summary.bridgeItemFinancialEquivalentMatchCount, 1);
  ok(
    "nota executiva do item-equivalent aparece",
    r.summary.executiveNotes.some((n) => n.includes("COST_BRIDGE_ITEM_FINANCIAL_EQUIVALENT"))
  );
}

// ── Teste 2 — um model com custo diferente → NÃO resolve ───────────────────
console.log("\n▸ Teste 2 — um Model ID com custo diferente → não resolve");
{
  const orderAll = [pedidoBase()];
  const performance = modelosDoItem("ITEM-EQ2", 10);
  const costRows = custosUniformes("ITEM-EQ2", 10, 19, 4);
  costRows[7].Custo = 20; // um único divergente entre 10.

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("CMV continua nulo — um custo diferente derruba a equivalência inteira", r.detailedRows[0].CMV, null);
  eq("nenhum match do item-equivalent é contabilizado", r.summary.bridgeItemFinancialEquivalentMatchCount, 0);
}

// ── Teste 3 — um model com imposto diferente → NÃO resolve ─────────────────
console.log("\n▸ Teste 3 — um Model ID com imposto diferente → não resolve");
{
  const orderAll = [pedidoBase()];
  const performance = modelosDoItem("ITEM-EQ3", 10);
  const costRows = custosUniformes("ITEM-EQ3", 10, 19, 4);
  costRows[3].imposto = 5;

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("CMV continua nulo — um imposto diferente derruba a equivalência inteira", r.detailedRows[0].CMV, null);
  eq("nenhum match do item-equivalent é contabilizado", r.summary.bridgeItemFinancialEquivalentMatchCount, 0);
}

// ── Teste 4 — um model ausente da base → NÃO resolve ────────────────────────
console.log("\n▸ Teste 4 — um Model ID ausente da base de custos → não resolve");
{
  const orderAll = [pedidoBase()];
  const performance = modelosDoItem("ITEM-EQ4", 10);
  const costRows = custosUniformes("ITEM-EQ4", 10, 19, 4).slice(0, 9); // um dos 10 nunca foi cadastrado.

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("CMV continua nulo — um Model ID sem linha na base derruba a equivalência", r.detailedRows[0].CMV, null);
  eq("nenhum match do item-equivalent é contabilizado", r.summary.bridgeItemFinancialEquivalentMatchCount, 0);
}

// ── Teste 5 — um model com custo #N/A → NÃO resolve ─────────────────────────
console.log("\n▸ Teste 5 — um Model ID com custo #N/A na base → não resolve");
{
  const orderAll = [pedidoBase()];
  const performance = modelosDoItem("ITEM-EQ5", 10);
  const costRows = custosUniformes("ITEM-EQ5", 10, 19, 4);
  costRows[5].Custo = "#N/A";

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("CMV continua nulo — #N/A nunca vira custo, derruba a equivalência", r.detailedRows[0].CMV, null);
  eq("nenhum match do item-equivalent é contabilizado", r.summary.bridgeItemFinancialEquivalentMatchCount, 0);
}

// ── Teste 6 — dois itens Performance candidatos → NÃO resolve ──────────────
console.log("\n▸ Teste 6 — dois itens empatados no topo do corte de título → não resolve");
{
  const orderAll = [pedidoBase()];
  const performance = [
    ...modelosDoItem("ITEM-EQ6A", 10),
    ...modelosDoItem("ITEM-EQ6B", 10), // mesmo título exato — empate genuíno de item.
  ];
  const costRows = [
    ...custosUniformes("ITEM-EQ6A", 10, 19, 4),
    ...custosUniformes("ITEM-EQ6B", 10, 19, 4), // preço igual não importa: são ITENS diferentes.
  ];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("CMV continua nulo — dois itens empatados nunca resolvem por equivalência", r.detailedRows[0].CMV, null);
  eq("nenhum match do item-equivalent é contabilizado", r.summary.bridgeItemFinancialEquivalentMatchCount, 0);
  eq("não é tratado como ambíguo — o item nem chega a ser candidato único", r.summary.bridgeAmbiguousCount, 0);
}

// ── Teste 7 — item único, variação desconhecida, todos iguais → resolve sem
//              escolher Model ID ──────────────────────────────────────────
console.log("\n▸ Teste 7 — item único e variação desconhecida → resolve sem afirmar qual Model ID");
{
  const orderAll = [pedidoBase()];
  const performance = modelosDoItem("ITEM-EQ7", 2);
  const costRows = custosUniformes("ITEM-EQ7", 2, 19, 4);

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("CMV resolvido", r.detailedRows[0].CMV, 19);
  eq(
    "origem é bridge_item_financial_equivalent (nunca bridge_variation_id)",
    r.detailedRows[0]["Match de custo"],
    "bridge_item_financial_equivalent"
  );
  ok(
    "diagnóstico não afirma um Model ID específico como a variação vendida",
    !String(r.detailedRows[0]["Match de custo"]).includes("ITEM-EQ7-M1") &&
      !String(r.detailedRows[0]["Match de custo"]).includes("ITEM-EQ7-M2")
  );
}

// ── Teste 8 — Model ID direto disponível → regra direta continua vencendo ──
console.log("\n▸ Teste 8 — Model ID direto no Order.all → vence antes da equivalência por item");
{
  const orderAll = [
    pedidoBase({
      "ID do pedido": "PED-EQ8",
      "ID da Variação": "ITEM-EQ8-M1",
    }),
  ];
  const performance = modelosDoItem("ITEM-EQ8", 10);
  const costRows = custosUniformes("ITEM-EQ8", 10, 19, 4);
  costRows[0].Custo = 41; // só o Model ID direto tem esse custo — prova que NÃO veio da equivalência.

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("match direto pelo ID da variação", r.detailedRows[0]["Match de custo"], "direct_variation_id");
  eq("CMV vem do match direto, não da equivalência por item", r.detailedRows[0].CMV, 41);
}

// ── Teste 9 — FIN-21 (variação exata + título) continua vencendo ───────────
console.log("\n▸ Teste 9 — FIN-21 (variação exata) resolve antes da equivalência por item");
{
  const orderAll = [
    pedidoBase({
      "ID do pedido": "PED-EQ9",
      // Título REORDENADO (mesmos tokens, ordem diferente) — impede o match
      // exato de produto+variação e força a passagem pelo fallback de
      // título do FIN-21. Variação bate EXATO com um dos Model IDs do item.
      "Nome do Produto": "Sortido Kit Presente Aromas Diversos Especial Colecao",
      "Nome da variação": "Cor 3",
    }),
  ];
  const performance = modelosDoItem("ITEM-EQ9", 10);
  const costRows = custosUniformes("ITEM-EQ9", 10, 19, 4);
  costRows[2].Custo = 77; // custo só do model "Cor 3" — prova a origem do match.

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("origem é bridge_title_variation (FIN-21), não item_financial_equivalent", r.detailedRows[0]["Match de custo"], "bridge_title_variation");
  eq("CMV vem do Model ID específico resolvido pelo FIN-21", r.detailedRows[0].CMV, 77);
  eq("nenhum match do item-equivalent é contabilizado", r.summary.bridgeItemFinancialEquivalentMatchCount, 0);
}

// ── Teste 10 — FIN-24 (alias de atributo) continua vencendo ────────────────
console.log("\n▸ Teste 10 — FIN-24 (alias de atributo/pack) resolve antes da equivalência por item");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "PED-EQ10",
      "Nome do Produto": "2 Camisetas Fitness Treino Academia Feminina Longline Kit",
      "Nome da variação": "Azul,M",
      "Subtotal do produto": 80,
      "Preço acordado": 80,
    }),
  ];
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-EQ10B",
      Produto: "Kit 2 Camisetas Fitness Treino Academia Feminina Longline",
      "ID da Variação": "ITEM-EQ10B-M1",
      "Nome da Variação": "2 Azul,M",
    }),
    linhaPerformance({
      "ID do Item": "ITEM-EQ10B",
      Produto: "Kit 2 Camisetas Fitness Treino Academia Feminina Longline",
      "ID da Variação": "ITEM-EQ10B-M2",
      "Nome da Variação": "2 Preta,M",
    }),
  ];
  const costRows = [
    { id: "ITEM-EQ10B", "model id": "ITEM-EQ10B-M1", Custo: 22, imposto: 3 },
    { id: "ITEM-EQ10B", "model id": "ITEM-EQ10B-M2", Custo: 22, imposto: 3 }, // igual de propósito.
  ];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq(
    "origem é bridge_title_variation_alias (FIN-24), não item_financial_equivalent",
    r.detailedRows[0]["Match de custo"],
    "bridge_title_variation_alias"
  );
  eq("CMV resolvido pelo FIN-24", r.detailedRows[0].CMV, 22);
  eq("nenhum match do item-equivalent é contabilizado", r.summary.bridgeItemFinancialEquivalentMatchCount, 0);
}

// ── Teste 11 — SKU histórico Carmina (token-set) continua vencendo ─────────
console.log("\n▸ Teste 11 — token-set de SKU histórico (CARMINA) resolve antes da equivalência por item");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "PED-EQ11",
      "Nome do Produto": "Produto qualquer",
      "Nº de referência do SKU principal": "FB/FR/Kaiak Branco/Mlbc",
      "Subtotal do produto": 60,
      "Preço acordado": 60,
    }),
  ];
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-EQ11",
      Produto: "Produto qualquer",
      "SKU Principle": "FB+FR+KAIAK BRANCO+MLBC", // mesmo conjunto de tokens, separador diferente.
    }),
  ];
  const costRows = [{ id: "ITEM-EQ11", Custo: 15, imposto: 1 }];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("origem é bridge_item_id (via token-set do CARMINA)", r.detailedRows[0]["Match de custo"], "bridge_item_id");
  eq("CMV resolvido pelo token-set", r.detailedRows[0].CMV, 15);
  eq("nenhum match do item-equivalent é contabilizado", r.summary.bridgeItemFinancialEquivalentMatchCount, 0);
}

// ── Teste 12 — ordem dos candidatos não muda o resultado ───────────────────
console.log("\n▸ Teste 12 — ordem das linhas de performance/custo não muda o resultado (determinístico)");
{
  const orderAll = [pedidoBase({ "ID do pedido": "PED-EQ12" })];
  const performance = modelosDoItem("ITEM-EQ12", 10);
  const costRows = custosUniformes("ITEM-EQ12", 10, 19, 4);

  function shuffle(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = (i * 7 + 3) % (i + 1); // embaralho determinístico, sem Math.random.
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  const rForward = processShopee(performance, costRows, 0, 0, 0, orderAll);
  const rShuffled = processShopee(shuffle(performance), shuffle(costRows), 0, 0, 0, orderAll);

  eq("CMV é o mesmo independentemente da ordem", rForward.detailedRows[0].CMV, rShuffled.detailedRows[0].CMV);
  eq(
    "origem é a mesma independentemente da ordem",
    rForward.detailedRows[0]["Match de custo"],
    rShuffled.detailedRows[0]["Match de custo"]
  );
  eq(
    "contador é o mesmo independentemente da ordem",
    rForward.summary.bridgeItemFinancialEquivalentMatchCount,
    rShuffled.summary.bridgeItemFinancialEquivalentMatchCount
  );
}

console.log(`\n${checks} verificações passaram. Equivalência financeira por item Shopee OK.`);
