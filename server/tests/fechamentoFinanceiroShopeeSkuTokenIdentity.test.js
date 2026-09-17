// server/tests/fechamentoFinanceiroShopeeSkuTokenIdentity.test.js
// CARMINA (FIN-133): resolvedor de identidade histórica por CONJUNTO DE
// TOKENS do SKU — generaliza para a classe "o SKU mudou de FORMATO (ordem,
// separador, palavra repetida ou uma palavra truncada), mas continua sendo
// o mesmo produto", incluindo produtos SEM variação (onde o fallback de
// título+variação do FIN-21 nem chega a ser tentado, por variationKey vazio).
//
// Fixtures mínimas e anônimas — NÃO usam as planilhas reais de FIN-21/FIN-24/
// FIN-133 (essas ficam fora do repositório, em ~/Documentos/venforce_financeiro_cases).
// Os nomes de token abaixo (KAIAK/BRANCO/BRANC etc.) são só para ilustrar a
// classe do problema encontrado em produção — não há nenhuma regra
// hardcoded para esses termos específicos no código.
//
// Regras protegidas aqui:
//  - conjunto EXATO de tokens (separador/ordem/repetição não importam) ->
//    resolve como qualquer SKU exato, quando o candidato é único;
//  - UM único token truncado/abreviado, com todos os demais exatos e
//    candidato único -> resolve (último recurso, depois de título+variação);
//  - dois ou mais tokens divergentes -> nunca resolve;
//  - candidatos com custo/imposto divergentes -> AMBIGUOUS, nunca "o mais
//    parecido";
//  - candidatos com custo/imposto idênticos -> equivalência financeira;
//  - Model ID/SKU direto sempre vencem, mesmo quando existe colisão de
//    token-set na ponte;
//  - ordem das linhas da performance não muda o resultado.

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
  buildShopeeCostBridge,
} = require("../services/fechamentoFinanceiro/shopeePerformanceService");
const {
  processShopeeFinancialOrders,
  tokenizeShopeeSkuText,
  shopeeSkuTokenSetKey,
  shopeeSkuTokensFuzzyCompatible,
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

// ── Testes unitários dos helpers puros ──────────────────────────────────
console.log("\n▸ Helpers puros — tokenização e compatibilidade de conjuntos");
{
  eq(
    "tokeniza separadores diferentes como o mesmo separador",
    tokenizeShopeeSkuText("FB+FR+KAIAK-BRANC+MLBC").join(","),
    "FB,FR,KAIAK,BRANC,MLBC"
  );
  eq(
    "tokeniza espaço como separador (não colapsa a palavra seguinte)",
    tokenizeShopeeSkuText("FB+FR+KAIAK BRANC+MLBC").join(","),
    "FB,FR,KAIAK,BRANC,MLBC"
  );
  ok(
    "chave de conjunto ignora ordem",
    shopeeSkuTokenSetKey(["A", "B", "C"]) === shopeeSkuTokenSetKey(["C", "A", "B"])
  );
  ok(
    "chave de conjunto ignora repetição",
    shopeeSkuTokenSetKey(["ROSE", "LATAFFA", "DOURADO", "LATAFFA"]) ===
      shopeeSkuTokenSetKey(["ROSE", "DOURADO", "LATAFFA"])
  );
  ok(
    "placeholder '-' não gera token",
    tokenizeShopeeSkuText("-").length === 0
  );
  ok(
    "um único token truncado é compatível (fuzzy)",
    shopeeSkuTokensFuzzyCompatible(
      ["FB", "FR", "KAIAK", "BRANCO", "MLBC"],
      ["FB", "FR", "KAIAK", "BRANC", "MLBC"]
    )
  );
  ok(
    "dois tokens divergentes NÃO são compatíveis",
    !shopeeSkuTokensFuzzyCompatible(
      ["FB", "FR", "KAIAK", "BRANCO", "MLBX"],
      ["FB", "FR", "KAIAK", "BRANC", "MLBC"]
    )
  );
  ok(
    "token curto (<4) não entra na tolerância de truncamento",
    !shopeeSkuTokensFuzzyCompatible(["FB", "FR", "KA", "MLBC"], ["FB", "FR", "K", "MLBC"])
  );
  ok(
    "menos de 3 tokens nunca é fuzzy-compatível",
    !shopeeSkuTokensFuzzyCompatible(["BRANCO", "MLBC"], ["BRANC", "MLBC"])
  );
  ok(
    "conjuntos de tamanhos diferentes nunca são fuzzy-compatíveis",
    !shopeeSkuTokensFuzzyCompatible(["FB", "FR", "KAIAK"], ["FB", "FR", "KAIAK", "MLBC"])
  );
}

// ── Caso A — separador diferente, candidato único → resolve (exato) ───────
console.log("\n▸ Caso A — SKU com separador/ordem diferentes, produto sem variação, candidato único → resolve");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-A",
      "Nome do Produto": "Kit 4 Perfumes Masculinos 100ml",
      "Nome da variação": "",
      "Nº de referência do SKU principal": "FB/FR/Kaiak Branco/Mlbc",
      "Subtotal do produto": 124.16,
      "Preço acordado": 124.16,
      "Taxa de comissão líquida": 12,
    }),
  ];
  // Mesma composição, separador "+", já corresponde EXATAMENTE ao conjunto
  // de tokens do Order.all (nenhuma palavra truncada aqui).
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-A",
      Produto: "Kit 4 Perfumes Masculinos 100ml",
      "SKU Principle": "FB+FR+KAIAK BRANCO+MLBC",
    }),
  ];
  const costRows = [{ id: "ITEM-A", Custo: 20, imposto: 5 }];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  const linha = r.detailedRows[0];
  eq("CMV resolvido pelo conjunto de tokens", linha.CMV, 20);
  eq("contador de token-set incrementado", r.summary.bridgeSkuTokenSetMatchCount, 1);
  eq("nenhuma ambiguidade", r.summary.bridgeAmbiguousCount, 0);
  ok(
    "nota executiva do estágio aparece",
    r.summary.executiveNotes.some((note) => note.includes("COST_BRIDGE_SKU_ALIAS:"))
  );
}

// ── Caso B — palavra repetida some (LATAFFA), candidato único → resolve ───
console.log("\n▸ Caso B — SKU com palavra repetida no Order.all, ausente na performance → resolve");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-B",
      "Nome do Produto": "Kit Perfume Árabe Casal 2x100ml",
      "Nº de referência do SKU principal": "ROSE LATAFFA/DOURADO LATAFFA",
      "Subtotal do produto": 70.4,
      "Preço acordado": 70.4,
      "Taxa de comissão líquida": 7,
    }),
  ];
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-B",
      Produto: "Kit 2 Perfumes Árabes",
      "SKU Principle": "ROSE+DOURADO-LATAFFA",
    }),
  ];
  const costRows = [{ id: "ITEM-B", Custo: 15, imposto: 0 }];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("CMV resolvido apesar da palavra repetida removida", r.detailedRows[0].CMV, 15);
  eq("contador de token-set incrementado", r.summary.bridgeSkuTokenSetMatchCount, 1);
}

// ── Caso C — um único token truncado, candidato único → resolve (fuzzy) ───
console.log("\n▸ Caso C — SKU com uma palavra truncada/abreviada, candidato único → resolve (último recurso)");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-C",
      "Nome do Produto": "Kit 4 Perfumes Antigo",
      "Nº de referência do SKU principal": "FB/FR/Kaiak Branco/Mlbc",
      "Subtotal do produto": 62,
      "Preço acordado": 62,
      "Taxa de comissão líquida": 6,
    }),
  ];
  // Título DIFERENTE (produto foi reeditado) e a palavra "Branco" foi
  // truncada para "Branc" — só um token diverge, todos os outros batem.
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-C",
      Produto: "Kit 4 Perfumes Reformulado Nova Coleção",
      "SKU Principle": "FB+FR+KAIAK BRANC+MLBC",
    }),
  ];
  const costRows = [{ id: "ITEM-C", Custo: 18, imposto: 4 }];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("CMV resolvido pelo fallback de token truncado", r.detailedRows[0].CMV, 18);
  eq("contador de fuzzy incrementado", r.summary.bridgeSkuTokenFuzzyMatchCount, 1);
  eq("token-set exato NÃO contou (não é o mesmo estágio)", r.summary.bridgeSkuTokenSetMatchCount, 0);
  ok(
    "nota executiva do fallback fuzzy aparece",
    r.summary.executiveNotes.some((note) => note.includes("COST_BRIDGE_SKU_ALIAS_FUZZY:"))
  );
}

// ── Caso D — dois tokens divergentes → nunca resolve ───────────────────────
console.log("\n▸ Caso D — dois tokens divergentes → permanece sem custo");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-D",
      "Nome do Produto": "Produto qualquer",
      "Nº de referência do SKU principal": "FB/FR/Kaiak Branco/Mlbx",
      "Subtotal do produto": 40,
      "Preço acordado": 40,
    }),
  ];
  // "MLBX" e "BRANC" divergem de "MLBC"/"BRANCO" — dois tokens diferentes,
  // evidência insuficiente mesmo com o restante do SKU batendo.
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-D",
      Produto: "Produto completamente diferente",
      "SKU Principle": "FB+FR+KAIAK BRANC+MLBC",
    }),
  ];
  const costRows = [{ id: "ITEM-D", Custo: 18, imposto: 4 }];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("CMV permanece nulo — dois tokens divergentes não resolvem", r.detailedRows[0].CMV, null);
  eq("faturamento é preservado mesmo sem custo", r.summary.revenueWithoutCost, 40);
  eq("nenhum match por token contabilizado", r.summary.bridgeSkuTokenFuzzyMatchCount, 0);
  eq("nenhum match por token-set exato contabilizado", r.summary.bridgeSkuTokenSetMatchCount, 0);
}

// ── Caso E — colisão fuzzy entre dois candidatos com custos diferentes → ambíguo ──
console.log("\n▸ Caso E — dois candidatos truncados plausíveis, custos diferentes → AMBIGUOUS");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-E",
      "Nome do Produto": "Produto ambíguo",
      "Nº de referência do SKU principal": "FB/FR/Kaiak Branco/Mlbc",
      "Subtotal do produto": 55,
      "Preço acordado": 55,
    }),
  ];
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-E1",
      Produto: "Produto ambíguo candidato 1",
      // "BRANC" — truncamento de 1 caractere de "BRANCO", compatível.
      "SKU Principle": "FB+FR+KAIAK BRANC+MLBC",
    }),
    // Segundo candidato plausível: "BRAN" — truncamento de 2 caracteres,
    // também fuzzy-compatível, mas custo diferente do primeiro.
    linhaPerformance({
      "ID do Item": "ITEM-E2",
      Produto: "Produto ambíguo candidato 2",
      "SKU Principle": "FB+FR+KAIAK BRAN+MLBC",
    }),
  ];
  const costRows = [
    { id: "ITEM-E1", Custo: 18, imposto: 4 },
    { id: "ITEM-E2", Custo: 25, imposto: 4 },
  ];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("CMV permanece nulo — candidatos com custos diferentes", r.detailedRows[0].CMV, null);
  eq("marcado como ambíguo", r.summary.bridgeAmbiguousCount, 1);
  eq("nenhum dos dois contabilizado como resolvido", r.summary.bridgeSkuTokenFuzzyMatchCount, 0);

  // Invariante: um candidato com match EXATO (mesmo conjunto de tokens, sem
  // nenhum truncamento) sempre vence um candidato apenas fuzzy-compatível —
  // o estágio exato roda antes do estágio fuzzy no pipeline, então a
  // ambiguidade acima nunca é "resolvida" adicionando mais um fuzzy, só um
  // candidato exato pode mudar o resultado.
  const performanceComExato = [
    ...performance,
    linhaPerformance({
      "ID do Item": "ITEM-E-EXATO",
      Produto: "Produto ambíguo candidato exato",
      "SKU Principle": "FB+FR+KAIAK BRANCO+MLBC",
    }),
  ];
  const costRowsComExato = [...costRows, { id: "ITEM-E-EXATO", Custo: 99, imposto: 4 }];
  const rExato = processShopee(performanceComExato, costRowsComExato, 0, 0, 0, orderAll);
  eq(
    "candidato exato único vence os fuzzy, mesmo com custo diferente deles",
    rExato.detailedRows[0].CMV,
    99
  );
  eq(
    "o match exato conta no estágio de token-set, não no fuzzy",
    rExato.summary.bridgeSkuTokenSetMatchCount,
    1
  );
}

// ── Caso F — colisão fuzzy com custo/imposto idênticos → equivalência financeira ──
console.log("\n▸ Caso F — dois candidatos truncados plausíveis, custo/imposto idênticos → equivalência financeira");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-F",
      "Nome do Produto": "Produto equivalente",
      "Nº de referência do SKU principal": "FB/FR/Kaiak Branco/Mlbc",
      "Subtotal do produto": 55,
      "Preço acordado": 55,
    }),
  ];
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-F1",
      Produto: "Produto equivalente candidato 1",
      "SKU Principle": "FB+FR+KAIAK BRANC+MLBC",
    }),
    linhaPerformance({
      "ID do Item": "ITEM-F2",
      Produto: "Produto equivalente candidato 2",
      "SKU Principle": "FB+FR+KAIAK BRAN+MLBC",
    }),
  ];
  const costRows = [
    { id: "ITEM-F1", Custo: 18, imposto: 4 },
    { id: "ITEM-F2", Custo: 18, imposto: 4 },
  ];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("custo equivalente é aplicado", r.detailedRows[0].CMV, 18);
  eq("identidade ambígua equivalente não bloqueia o cálculo", r.summary.bridgeAmbiguousCount, 0);
  eq("contabilizado como equivalência", r.summary.bridgeEquivalentCostMatchCount, 1);
}

// ── Caso G — Model ID direto sempre vence, mesmo com colisão de token-set ──
console.log("\n▸ Caso G — ID da Variação direto disponível → estratégia de token nunca interfere");
{
  const directResult = processShopeeFinancialOrders({
    salesRowsRaw: [
      linhaOrderAll({
        "ID do pedido": "CASE-G",
        "ID da Variação": "MODEL-G-DIRETO",
        "Nome do Produto": "Produto qualquer",
        "Nº de referência do SKU principal": "FB/FR/Kaiak Branco/Mlbc",
        "Subtotal do produto": 70,
        "Preço acordado": 70,
      }),
    ],
    costMap: buildShopeeCostMap([
      { id: "IRRELEVANTE", "model id": "MODEL-G-DIRETO", Custo: 22, imposto: 0 },
    ]),
    costBridge: buildShopeeCostBridge([
      linhaPerformance({
        "ID do Item": "ITEM-G-PONTE",
        Produto: "Produto qualquer completamente diferente",
        "SKU Principle": "FB+FR+KAIAK BRANC+MLBC",
      }),
    ]),
  });
  eq("match direto pelo ID da variação", directResult.detailedRows[0]["Match de custo"], "direct_variation_id");
  eq("CMV vem do match direto, não da ponte", directResult.detailedRows[0].CMV, 22);
  eq("nenhum match por token contabilizado", directResult.summary.bridgeSkuTokenSetMatchCount, 0);
  eq("nenhum match fuzzy contabilizado", directResult.summary.bridgeSkuTokenFuzzyMatchCount, 0);
}

// ── Caso H — pack diferente com mesmos tokens de fragrância + produto ambíguo → não resolve sozinho ──
console.log("\n▸ Caso H — mesmo conjunto de tokens, produtos (packs) diferentes e sem distinção → AMBIGUOUS");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-H",
      "Nome do Produto": "Produto composto",
      "Nº de referência do SKU principal": "AAA-BBB-CCC",
      "Subtotal do produto": 45,
      "Preço acordado": 45,
    }),
  ];
  // Dois anúncios distintos (packs diferentes) cujo SKU principal colide no
  // MESMO conjunto de tokens (ordem trocada) — sem variação/produto para
  // desambiguar e com custos diferentes: precisa ficar ambíguo.
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-H1",
      Produto: "Produto composto",
      "SKU Principle": "CCC-AAA-BBB",
    }),
    linhaPerformance({
      "ID do Item": "ITEM-H2",
      Produto: "Produto composto",
      "SKU Principle": "BBB-CCC-AAA",
    }),
  ];
  const costRows = [
    { id: "ITEM-H1", Custo: 10, imposto: 0 },
    { id: "ITEM-H2", Custo: 30, imposto: 0 },
  ];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("CMV permanece nulo — dois candidatos, custos diferentes", r.detailedRows[0].CMV, null);
  eq("marcado como ambíguo", r.summary.bridgeAmbiguousCount, 1);
}

// ── Caso I — quantidade/pack diferente vira token diferente → nunca cruza ──
console.log("\n▸ Caso I — quantidade do kit expressa como token → pack diferente nunca cruza");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-I",
      "Nome do Produto": "Kit variável",
      "Nº de referência do SKU principal": "KIT2-PERFUME-A-PERFUME-B",
      "Subtotal do produto": 80,
      "Preço acordado": 80,
    }),
  ];
  // Kit de 4 com composição parecida, mas quantidade diferente — o token da
  // quantidade ("KIT2" vs "KIT4") impede a colisão, mesmo com token-set.
  const performance = [
    linhaPerformance({
      "ID do Item": "ITEM-I4",
      Produto: "Kit variável 4 unidades",
      "SKU Principle": "KIT4-PERFUME-A-PERFUME-B",
    }),
  ];
  const costRows = [{ id: "ITEM-I4", Custo: 50, imposto: 0 }];

  const r = processShopee(performance, costRows, 0, 0, 0, orderAll);
  eq("CMV permanece nulo — pack diferente (KIT2 != KIT4) nunca cruza", r.detailedRows[0].CMV, null);
}

// ── Caso J — ordem das linhas da performance não muda o resultado ─────────
console.log("\n▸ Caso J — ordem das linhas da performance não muda o resultado (determinístico)");
{
  const orderAll = [
    linhaOrderAll({
      "ID do pedido": "CASE-J",
      "Nome do Produto": "Produto determinístico",
      "Nº de referência do SKU principal": "FB/FR/Kaiak Branco/Mlbc",
      "Subtotal do produto": 55,
      "Preço acordado": 55,
    }),
  ];
  const perfA = linhaPerformance({
    "ID do Item": "ITEM-J1",
    Produto: "Produto determinístico candidato 1",
    "SKU Principle": "FB+FR+KAIAK BRANC+MLBC",
  });
  const perfB = linhaPerformance({
    "ID do Item": "ITEM-J2",
    Produto: "Produto determinístico candidato 2",
    "SKU Principle": "FB+FR+KAIAK BRAN+MLBC",
  });
  const costRows = [
    { id: "ITEM-J1", Custo: 33, imposto: 2 },
    { id: "ITEM-J2", Custo: 47, imposto: 2 },
  ];

  const rForward = processShopee([perfA, perfB], costRows, 0, 0, 0, orderAll);
  const rReversed = processShopee([perfB, perfA], costRows.slice().reverse(), 0, 0, 0, orderAll);
  eq(
    "resultado (ambíguo) é o mesmo independentemente da ordem das linhas",
    rForward.detailedRows[0].CMV,
    rReversed.detailedRows[0].CMV
  );
  eq("ambos ficam ambíguos", rForward.summary.bridgeAmbiguousCount, 1);
  eq("ambos ficam ambíguos (invertido)", rReversed.summary.bridgeAmbiguousCount, 1);
}

console.log(`\n${checks} verificações passaram. Identidade histórica Shopee por token de SKU (CARMINA) OK.`);
