// server/tests/fechamentoFinanceiroShopeeBridgeTituloVariacaoAlias.test.js
// FIN-24: segunda classe de falha da ponte de identidade Shopee — além do
// título do anúncio mudar (FIN-21), a NOTAÇÃO da variação também muda entre
// Order.all e Performance (ex.: "Pink,G" vira "2 Pink,G" quando o anúncio é
// um kit). Só é tentado quando SKU, produto+variação exatos E o fallback do
// FIN-21 (variação exata + título) já falharam.
//
// Fixtures mínimas, sintéticas e anônimas — NÃO usam as planilhas reais do
// caso FIN-24 (essas ficam fora do repositório, em
// ~/Documentos/venforce_financeiro_cases/FIN-24, e nunca são commitadas).
//
// Regras protegidas aqui:
//  - quantidade/kit é extraída de forma ESTRUTURADA (quantityHint +
//    atributos), nunca por normalização cega ("2 X" -> "X" para todo mundo);
//  - atributos (cor/tamanho) exigem igualdade EXATA após a remoção da
//    quantidade — nunca stemming de plural/gênero;
//  - um candidato UNITÁRIO nunca vence para um pedido de KIT, mesmo com os
//    mesmos atributos e um título parecido (conflito de pack bloqueia);
//  - kit 2 nunca cruza com kit 4 (packSize diferente);
//  - atributos diferentes (G vs GG) nunca resolvem;
//  - candidato único e seguro -> bridge_title_variation_alias;
//  - candidatos empatados com custo/imposto iguais -> equivalência
//    financeira (bridge_title_variation_alias_equivalent);
//  - candidatos empatados com custo OU imposto divergentes -> AMBIGUOUS,
//    sem custo;
//  - Model ID/SKU diretos, e o próprio fallback do FIN-21, sempre vencem
//    antes deste — nunca perdem prioridade;
//  - Model ID ausente na base e custo #N/A continuam sem custo, como sempre.

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
} = require("../services/fechamentoFinanceiro/shopeePerformanceService");
const {
  processShopeeFinancialOrders,
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

const KIT_ORDER_ALL_PRODUCT =
  "2 Blusas Tapa Bumbum Academia Fitness Longline Viscolycra Fit Feminina Kit";
const KIT_PERFORMANCE_PRODUCT =
  "Kit 2 Blusas Tapa Bumbum Feminina Longline Viscolycra Academia Camiseta";
const UNIT_PERFORMANCE_PRODUCT =
  "Blusa Feminina Longline Cobre Bumbum Camiseta Academia Fitness Alongada";

// ── Caso 1 — candidato único e seguro → resolve ────────────────────────────
console.log("\n▸ Caso 1 — kit com notação de quantidade diferente, candidato único → resolve");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-1",
      "Nome do Produto": KIT_ORDER_ALL_PRODUCT,
      "Nome da variação": "Pink,G",
      "Subtotal do produto": 37.9,
      "Preço acordado": 37.9,
      "Taxa de comissão líquida": 6.62,
    }),
  ];
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-KIT",
      "ID da Variação": "MODEL-KIT-PINK-G",
      "Nome da Variação": "2 Pink,G",
      Produto: KIT_PERFORMANCE_PRODUCT,
    }),
  ];
  const costRows = [{ id: "ITEM-KIT", "model id": "MODEL-KIT-PINK-G", Custo: 19, imposto: 4 }];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  const linha = r.detailedRows[0];
  eq("origem é bridge_title_variation_alias", linha["Match de custo"], "bridge_title_variation_alias");
  eq("Model ID resolvido é o único candidato", linha["ID resolvido pela ponte"], "MODEL-KIT-PINK-G");
  eq("CMV vem do custo do KIT", linha.CMV, 19);
  eq("nenhuma ambiguidade", r.summary.bridgeAmbiguousCount, 0);
  eq("contador do fallback FIN-24 é incrementado", r.summary.bridgeTitleVariationAliasMatchCount, 1);
  ok(
    "nota executiva do fallback FIN-24 aparece",
    r.summary.executiveNotes.some((note) => note.includes("COST_BRIDGE_TITLE_VARIATION_ALIAS"))
  );
}

// ── Caso 2 — existe também produto UNITÁRIO com a mesma variação → não pode vencer ──
console.log("\n▸ Caso 2 — produto unitário com mesma variação/custo diferente → kit nunca vira unitário");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-2",
      "Nome do Produto": KIT_ORDER_ALL_PRODUCT,
      "Nome da variação": "Pink,G",
      "Subtotal do produto": 37.9,
      "Preço acordado": 37.9,
      "Taxa de comissão líquida": 6.62,
    }),
  ];
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-KIT",
      "ID da Variação": "MODEL-KIT-PINK-G",
      "Nome da Variação": "2 Pink,G",
      Produto: KIT_PERFORMANCE_PRODUCT,
    }),
    // Mesmos atributos (Pink,G) — mas é uma peça UNITÁRIA (sem "kit"/número
    // no título, sem quantidade na variação) e custo menor.
    linhaPerformance({
      "ID do Item": "ITEM-UNIT",
      "ID da Variação": "MODEL-UNIT-PINK-G",
      "Nome da Variação": "Pink,G",
      Produto: UNIT_PERFORMANCE_PRODUCT,
    }),
  ];
  const costRows = [
    { id: "ITEM-KIT", "model id": "MODEL-KIT-PINK-G", Custo: 19, imposto: 4 },
    { id: "ITEM-UNIT", "model id": "MODEL-UNIT-PINK-G", Custo: 9.5, imposto: 4 },
  ];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  const linha = r.detailedRows[0];
  eq("resolve pelo fallback FIN-24 (título do kit é muito mais compatível)", linha["Match de custo"], "bridge_title_variation_alias");
  eq("Model ID resolvido é o do KIT, nunca o unitário", linha["ID resolvido pela ponte"], "MODEL-KIT-PINK-G");
  eq("CMV é o custo do kit (19), não o do unitário (9.5)", linha.CMV, 19);
}

// ── Caso 3 — Order.all kit 2 vs Performance kit 4 → não resolve ───────────
console.log("\n▸ Caso 3 — kit 2 no Order.all vs kit 4 na Performance → conflito de pack, não resolve");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-3",
      "Nome do Produto": KIT_ORDER_ALL_PRODUCT,
      "Nome da variação": "Pink,G",
      "Subtotal do produto": 37.9,
      "Preço acordado": 37.9,
      "Taxa de comissão líquida": 6.62,
    }),
  ];
  const performance = [
    // Único candidato disponível é um KIT DE 4, não de 2 — mesmo produto
    // "família" e mesmo atributo Pink,G, mas quantidade diferente.
    linhaPerformance({
      "ID do Item": "ITEM-KIT4",
      "ID da Variação": "MODEL-KIT4-PINK-G",
      "Nome da Variação": "4 Pink,G",
      Produto: "Kit 4 Blusas Tapa Bumbum Feminina Longline Viscolycra Academia Camiseta",
    }),
  ];
  const costRows = [{ id: "ITEM-KIT4", "model id": "MODEL-KIT4-PINK-G", Custo: 30, imposto: 4 }];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("CMV continua nulo — packSize 2 != 4 bloqueia o candidato", r.detailedRows[0].CMV, null);
  eq("nenhum match do fallback FIN-24 é contabilizado", r.summary.bridgeTitleVariationAliasMatchCount, 0);
  eq("não é tratado como ambíguo (o candidato nem chega a concorrer)", r.summary.bridgeAmbiguousCount, 0);
}

// ── Caso 4 — atributos diferentes (G vs GG) → não resolve ─────────────────
console.log("\n▸ Caso 4 — atributos diferentes (G vs GG) → nunca resolve");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-4",
      "Nome do Produto": KIT_ORDER_ALL_PRODUCT,
      "Nome da variação": "Pink,G",
      "Subtotal do produto": 37.9,
      "Preço acordado": 37.9,
      "Taxa de comissão líquida": 6.62,
    }),
  ];
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-KIT",
      "ID da Variação": "MODEL-KIT-PINK-GG",
      "Nome da Variação": "2 Pink,GG",
      Produto: KIT_PERFORMANCE_PRODUCT,
    }),
  ];
  const costRows = [{ id: "ITEM-KIT", "model id": "MODEL-KIT-PINK-GG", Custo: 19, imposto: 4 }];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("CMV continua nulo — atributos diferentes nunca cruzam", r.detailedRows[0].CMV, null);
  eq("nenhum match do fallback FIN-24 é contabilizado", r.summary.bridgeTitleVariationAliasMatchCount, 0);
}

// ── Caso 5 — dois Model IDs, custos diferentes → AMBIGUOUS ────────────────
console.log("\n▸ Caso 5 — dois candidatos de kit com custos diferentes → AMBIGUOUS, sem custo");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-5",
      "Nome do Produto": KIT_ORDER_ALL_PRODUCT,
      "Nome da variação": "Pink,G",
      "Subtotal do produto": 37.9,
      "Preço acordado": 37.9,
      "Taxa de comissão líquida": 6.62,
    }),
  ];
  // Dois anúncios de kit distintos, mesmo título "família" e mesma
  // notação de atributo, mas custos diferentes na base.
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-KIT-X",
      "ID da Variação": "MODEL-KIT-X",
      "Nome da Variação": "2 Pink,G",
      Produto: KIT_PERFORMANCE_PRODUCT,
    }),
    linhaPerformance({
      "ID do Item": "ITEM-KIT-Y",
      "ID da Variação": "MODEL-KIT-Y",
      "Nome da Variação": "2 Pink,G",
      Produto: KIT_PERFORMANCE_PRODUCT,
    }),
  ];
  const costRows = [
    { id: "ITEM-KIT-X", "model id": "MODEL-KIT-X", Custo: 19, imposto: 4 },
    { id: "ITEM-KIT-Y", "model id": "MODEL-KIT-Y", Custo: 22, imposto: 4 },
  ];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  const linha = r.detailedRows[0];
  eq("custo diferente entre candidatos empatados mantém CMV nulo", linha.CMV, null);
  eq("marcado como ambíguo", r.summary.bridgeAmbiguousCount, 1);
  eq("faturamento é preservado mesmo sem custo", r.summary.grossRevenueTotal, 37.9);

  const gap = r.unmatchedCosts[0];
  eq("diagnóstico tipado como ambiguous_ids", gap.type, "ambiguous_ids");
  ok(
    "os dois Model IDs conflitantes aparecem no diagnóstico",
    gap.candidates.includes("MODEL-KIT-X") && gap.candidates.includes("MODEL-KIT-Y")
  );
}

// ── Caso 6 — dois Model IDs, custo e imposto iguais → equivalência ────────
console.log("\n▸ Caso 6 — dois candidatos de kit com custo/imposto iguais → equivalência financeira");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-6",
      "Nome do Produto": KIT_ORDER_ALL_PRODUCT,
      "Nome da variação": "Pink,G",
      "Subtotal do produto": 37.9,
      "Preço acordado": 37.9,
      "Taxa de comissão líquida": 6.62,
    }),
  ];
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-KIT-X",
      "ID da Variação": "MODEL-KIT-X",
      "Nome da Variação": "2 Pink,G",
      Produto: KIT_PERFORMANCE_PRODUCT,
    }),
    linhaPerformance({
      "ID do Item": "ITEM-KIT-Y",
      "ID da Variação": "MODEL-KIT-Y",
      "Nome da Variação": "2 Pink,G",
      Produto: KIT_PERFORMANCE_PRODUCT,
    }),
  ];
  const costRows = [
    { id: "ITEM-KIT-X", "model id": "MODEL-KIT-X", Custo: 19, imposto: 4 },
    { id: "ITEM-KIT-Y", "model id": "MODEL-KIT-Y", Custo: 19, imposto: 4 },
  ];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  const linha = r.detailedRows[0];
  eq("origem é bridge_title_variation_alias_equivalent", linha["Match de custo"], "bridge_title_variation_alias_equivalent");
  eq("custo equivalente é aplicado", linha.CMV, 19);
  eq("identidade ambígua equivalente não bloqueia o cálculo", r.summary.bridgeAmbiguousCount, 0);
  eq("contabilizado como equivalência", r.summary.bridgeEquivalentCostMatchCount, 1);
}

// ── Caso 7 — Model ID direto disponível → fallback FIN-24 nunca roda ──────
console.log("\n▸ Caso 7 — ID da Variação direto no Order.all → fallback FIN-24 nunca interfere");
{
  const directResult = processShopeeFinancialOrders({
    salesRowsRaw: [
      linhaOrderAll({
        "ID do pedido": "CASE-7",
        "ID da Variação": "MODEL-DIRETO",
        "Nome do Produto": KIT_ORDER_ALL_PRODUCT,
        "Nome da variação": "Pink,G",
        "Subtotal do produto": 37.9,
        "Preço acordado": 37.9,
      }),
    ],
    costMap: buildShopeeCostMap([
      { id: "IRRELEVANTE", "model id": "MODEL-DIRETO", Custo: 19, imposto: 4 },
    ]),
    // Ponte existe e teria um candidato de kit plausível — mas o match
    // direto nunca chega a consultá-la.
    costBridge: null,
  });
  eq("match direto pelo ID da variação", directResult.detailedRows[0]["Match de custo"], "direct_variation_id");
  eq("CMV vem do match direto", directResult.detailedRows[0].CMV, 19);
}

// ── Caso 8 — SKU direto disponível → fallback FIN-24 nunca roda ───────────
console.log("\n▸ Caso 8 — SKU direto disponível → fallback FIN-24 nunca interfere");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-8",
      "Nome do Produto": KIT_ORDER_ALL_PRODUCT,
      "Nome da variação": "Pink,G",
      "Nº de referência do SKU principal": "SKU-DIRETO-8",
      "Subtotal do produto": 37.9,
      "Preço acordado": 37.9,
      "Taxa de comissão líquida": 6.62,
    }),
  ];
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-KIT-PONTE",
      "ID da Variação": "MODEL-KIT-PONTE",
      "Nome da Variação": "2 Pink,G",
      Produto: KIT_PERFORMANCE_PRODUCT,
    }),
  ];
  const costRowsAmbos = [
    { sku: "SKU-DIRETO-8", Custo: 18, imposto: 0 },
    { id: "ITEM-KIT-PONTE", "model id": "MODEL-KIT-PONTE", Custo: 999, imposto: 0 },
  ];
  const comPonte = processShopee(orderAll, costRowsAmbos, 0, 0, 0, performance);
  eq("continua sendo match direto por SKU", comPonte.detailedRows[0]["Match de custo"], "direct_sku");
  eq("CMV não é substituído pela ponte FIN-24", comPonte.detailedRows[0].CMV, 18);
}

// ── Caso 9 — regra FIN-21 (variação exata + título) continua igual ────────
console.log("\n▸ Caso 9 — regra FIN-21 (variação exata, só o título muda) continua funcionando igual");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-9",
      "Nome do Produto": "Capa Protetora Anti Impacto Silicone Reforçada Universal Celular Kit",
      "Nome da variação": "Azul,M",
      "Subtotal do produto": 40,
      "Preço acordado": 40,
      "Taxa de comissão líquida": 4,
    }),
  ];
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-A",
      "ID da Variação": "MODEL-A1",
      "Nome da Variação": "Azul,M",
      Produto: "Kit Capa Silicone Reforçada Anti Impacto Universal Protetora Celular",
    }),
  ];
  const costRows = [{ id: "ITEM-A", "model id": "MODEL-A1", Custo: 12, imposto: 5 }];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  const linha = r.detailedRows[0];
  eq("continua resolvendo como bridge_title_variation (FIN-21)", linha["Match de custo"], "bridge_title_variation");
  eq("CMV vem do custo da base", linha.CMV, 12);
  eq("contador FIN-21 é incrementado normalmente", r.summary.bridgeTitleVariationMatchCount, 1);
  eq("fallback FIN-24 nunca é acionado quando o FIN-21 já resolveu", r.summary.bridgeTitleVariationAliasMatchCount, 0);
}

// ── Caso 10 — Model ID ausente na base → continua sem custo ───────────────
console.log("\n▸ Caso 10 — Model ID resolvido pela ponte, mas ausente na base → continua sem custo");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-10",
      "Nome do Produto": KIT_ORDER_ALL_PRODUCT,
      "Nome da variação": "Pink,G",
      "Subtotal do produto": 37.9,
      "Preço acordado": 37.9,
      "Taxa de comissão líquida": 6.62,
    }),
  ];
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-KIT",
      "ID da Variação": "MODEL-KIT-SEM-CUSTO",
      "Nome da Variação": "2 Pink,G",
      Produto: KIT_PERFORMANCE_PRODUCT,
    }),
  ];
  // Base de custos não contém "MODEL-KIT-SEM-CUSTO".
  const costRows = [{ id: "OUTRO-ITEM", "model id": "OUTRO-MODEL", Custo: 19, imposto: 4 }];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("CMV continua nulo — Model ID resolvido não existe na base", r.detailedRows[0].CMV, null);
  const gap = r.unmatchedCosts.find((g) => g.value === "MODEL-KIT-SEM-CUSTO");
  ok("diagnóstico aponta ausência na base de custos", !!gap && gap.reason === "not_found_in_cost_base");
}

// ── Caso 11 — CUSTO #N/A → continua sem custo ──────────────────────────────
console.log("\n▸ Caso 11 — CUSTO = #N/A na base → continua sem custo, mesmo resolvido pelo fallback FIN-24");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-11",
      "Nome do Produto": KIT_ORDER_ALL_PRODUCT,
      "Nome da variação": "Pink,G",
      "Subtotal do produto": 37.9,
      "Preço acordado": 37.9,
      "Taxa de comissão líquida": 6.62,
    }),
  ];
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-KIT",
      "ID da Variação": "MODEL-KIT-NA",
      "Nome da Variação": "2 Pink,G",
      Produto: KIT_PERFORMANCE_PRODUCT,
    }),
  ];
  const costRows = [{ id: "ITEM-KIT", "model id": "MODEL-KIT-NA", Custo: "#N/A", imposto: 4 }];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("CMV permanece nulo — #N/A nunca vira custo", r.detailedRows[0].CMV, null);
  const gap = r.unmatchedCosts[0];
  eq("motivo é custo zero/inválido na base", gap.reason, "zero_cost_in_base");
  eq("costValid é false para #N/A", gap.costValid, false);
}

// ── Caso 12 — CUSTO 0 → continua sem custo ─────────────────────────────────
console.log("\n▸ Caso 12 — CUSTO = 0 na base → continua sem custo, mesmo resolvido pelo fallback FIN-24");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-12",
      "Nome do Produto": KIT_ORDER_ALL_PRODUCT,
      "Nome da variação": "Pink,G",
      "Subtotal do produto": 37.9,
      "Preço acordado": 37.9,
      "Taxa de comissão líquida": 6.62,
    }),
  ];
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-KIT",
      "ID da Variação": "MODEL-KIT-ZERO",
      "Nome da Variação": "2 Pink,G",
      Produto: KIT_PERFORMANCE_PRODUCT,
    }),
  ];
  const costRows = [{ id: "ITEM-KIT", "model id": "MODEL-KIT-ZERO", Custo: 0, imposto: 4 }];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("CMV permanece nulo — custo <= 0 nunca calcula LC/MC", r.detailedRows[0].CMV, null);
  const gap = r.unmatchedCosts[0];
  eq("motivo é custo zero/inválido na base", gap.reason, "zero_cost_in_base");
  eq("costValid é true para 0 (é um número real, só não positivo)", gap.costValid, true);
}

console.log(`\n${checks} verificações passaram. Ponte Shopee — atributos + título + pack (FIN-24) OK.`);
