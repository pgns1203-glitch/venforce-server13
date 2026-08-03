// server/tests/fechamentoFinanceiroMeli.test.js
// Regressões do fechamento financeiro do Mercado Livre:
// rateio por valor vendido, filhos cancelados, receita sem custo,
// TACoX com afiliados e cabeçalho automático da planilha.

const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function loadWithXlsxStub(request, parent, isMain) {
  if (request === "xlsx") {
    return { utils: { aoa_to_sheet: () => ({}) } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  processMeli,
  parseMeliRows,
  analyzeMeliParsing,
  isMainRow,
  isDetailRow,
  isEffectiveItemRow,
  enrichDetailsFromMain,
  allocateByRevenue,
  classifyMeliSaleStatus,
} = require("../services/fechamentoFinanceiro/meliFinanceiroService");

Module._load = originalLoad;

const { round2 } = require("../utils/numberUtils");

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

// ── Teste 3 — Rateio Mercado Livre proporcional à receita ───────────────────
console.log("\n▸ Teste 3 — rateio proporcional ao valor vendido");
{
  const componentes = [
    { units: 1, unitSalePrice: 100 }, // Produto A: R$ 100,00
    { units: 1, unitSalePrice: 20 },  // Produto B: R$  20,00
  ];
  const parcelas = allocateByRevenue(90, componentes);

  eq("Produto A recebe R$ 75,00", parcelas[0], 75);
  eq("Produto B recebe R$ 15,00", parcelas[1], 15);
  ok("não divide igualmente (R$ 45,00 cada)", parcelas[0] !== 45);
  eq("soma das parcelas fecha com o total", round2(parcelas[0] + parcelas[1]), 90);
}

console.log("\n▸ Rateio: bordas");
{
  const negativo = allocateByRevenue(-90, [
    { units: 1, unitSalePrice: 100 },
    { units: 1, unitSalePrice: 20 },
  ]);
  eq("valor negativo mantém proporção (A)", negativo[0], -75);
  eq("valor negativo mantém proporção (B)", negativo[1], -15);

  const semPreco = allocateByRevenue(60, [
    { units: 1, productRevenue: 40 },
    { units: 1, productRevenue: 20 },
  ]);
  eq("fallback por receita do produto (A)", semPreco[0], 40);
  eq("fallback por receita do produto (B)", semPreco[1], 20);

  const soUnidades = allocateByRevenue(30, [{ units: 1 }, { units: 2 }]);
  eq("último fallback por quantidade (A)", soUnidades[0], 10);
  eq("último fallback por quantidade (B)", soUnidades[1], 20);

  const semPeso = allocateByRevenue(50, [{ units: 0 }, { units: 0 }]);
  ok("sem peso não gera NaN", semPeso.every((v) => Number.isFinite(v)));
  eq("sem peso devolve zeros", semPeso[0] + semPeso[1], 0);

  const arredondamento = allocateByRevenue(100, [
    { units: 1, unitSalePrice: 1 },
    { units: 1, unitSalePrice: 1 },
    { units: 1, unitSalePrice: 1 },
  ]);
  eq(
    "última parcela corrige o arredondamento",
    round2(arredondamento.reduce((a, b) => a + b, 0)),
    100
  );
  ok("nenhuma parcela é NaN", arredondamento.every((v) => Number.isFinite(v)));

  eq("lista vazia devolve lista vazia", allocateByRevenue(10, []).length, 0);
}

// ── classifyMeliSaleStatus ─────────────────────────────────────────────────
console.log("\n▸ classifyMeliSaleStatus");
{
  eq("pago", classifyMeliSaleStatus({ estado: "Pago" }), "paid");
  eq("cancelado", classifyMeliSaleStatus({ estado: "Cancelada" }), "cancelled");
  eq("devolvido", classifyMeliSaleStatus({ estado: "Devolução" }), "returned");
  eq("reembolsado", classifyMeliSaleStatus({ estado: "Reembolsado" }), "refunded");
  eq("mediação", classifyMeliSaleStatus({ estado: "Em mediação" }), "mediation");
  eq("sem estado", classifyMeliSaleStatus({}), "other");
  eq(
    "descrição do status também é lida",
    classifyMeliSaleStatus({ "descricao do status": "Cancelada pelo comprador" }),
    "cancelled"
  );
}

// ── Estrutura real MELI: venda principal + detalhe sem campos repetidos ────
console.log("\n▸ Estrutura pai/filho real do Mercado Livre");
{
  const salesRowsRaw = [
    {
      "N.º de venda": "10001",
      "Data da venda": "2026-08-01",
      Estado: "Pago",
      Unidades: 2,
      "Receita por produtos (BRL)": 200,
      "Tarifa de venda e impostos (BRL)": -20,
      "Tarifas de envio (BRL)": 0,
      "Cancelamentos e reembolsos (BRL)": 0,
      "Total (BRL)": 180,
    },
    {
      "# de anúncio": "MLB555",
      "Título do anúncio": "Produto detalhado",
      "Preço unitário de venda do anúncio (BRL)": 100,
      // O export real não repete venda, data, estado nem unidades aqui.
    },
  ];
  const costRowsRaw = [{ "# de anúncio": "MLB555", custo: 40, imposto: 0 }];

  const result = processMeli(salesRowsRaw, costRowsRaw, 0, 0, 0);
  const item = result.detailedRows[0];

  eq("uma venda principal reconhecida", result.parsingDiagnostics.recognizedSalesCount, 1);
  eq("um item associado à venda", result.parsingDiagnostics.associatedItemsCount, 1);
  eq("MLB do detalhe preservado", item["# de anúncio"], "MLB555");
  eq("unidades herdadas da venda principal", item.Unidades, 2);
  eq("receita bruta reconhecida", result.summary.grossRevenueTotal, 200);
  eq("receita líquida rateada", result.summary.paidRevenueTotal, 180);
  eq("custo unitário encontrado na base", item["Preço de custo"], 40);
  eq("custo total calculado", item["Preço de custo total"], 80);
  eq("LC calculado sem mudar a fórmula", result.summary.contributionProfitTotal, 100);
  eq("MC calculada", item.MC, 50);
  eq("cobertura calculada", result.summary.calculatedCoveragePercent, 100);
  eq("confiança integral", result.summary.financialConfidence, "confiavel");
  eq("nenhum item foi enviado à auditoria", result.auditRows.length, 0);
}

console.log("\n▸ Pai com múltiplos detalhes sem unidades");
{
  const rows = [
    {
      "N.º de venda": "10002",
      "Data da venda": "2026-08-02",
      Estado: "Pago",
      Unidades: 3,
      "Receita por produtos (BRL)": 300,
      "Total (BRL)": 270,
    },
    { "# de anúncio": "MLB556", "Título do anúncio": "Produto A", "Preço unitário": 100 },
    { "# de anúncio": "MLB557", "Título do anúncio": "Produto B", "Preço unitário": 100 },
  ];
  let error = null;
  try {
    processMeli(rows, [], 0, 0, 0);
  } catch (caught) {
    error = caught;
  }
  eq("quantidades ambíguas retornam 422", error?.statusCode, 422);
  ok("mensagem explica a ambiguidade das unidades", /vários detalhes.*unidades/i.test(error?.message || ""));
}

console.log("\n▸ Rateio financeiro pai/filhos enriquecidos");
{
  const rawRows = [
    {
      "N.º de venda": "10003",
      "Data da venda": "2026-08-03",
      Estado: "Pago",
      Unidades: 3,
      "Receita por produtos (BRL)": 300,
      "Tarifa de venda e impostos (BRL)": -30,
      "Tarifas de envio (BRL)": -10,
      "Cancelamentos e reembolsos (BRL)": -5,
      "Total (BRL)": 250,
    },
    { "# de anúncio": "MLB558", Unidades: 1, "Preço unitário": 100 },
    { "# de anúncio": "MLB559", Unidades: 2, "Preço unitário": 100 },
  ];
  const parsed = parseMeliRows(rawRows);
  const diagnostics = analyzeMeliParsing(rawRows);
  const effective = enrichDetailsFromMain(parsed[0], parsed.slice(1), diagnostics);

  ok("predicado separa a linha financeira principal", isMainRow(parsed[0]));
  ok("predicado aceita detalhe apenas com MLB", isDetailRow(parsed[1]));
  ok("detalhes enriquecidos tornam-se itens efetivos", effective.every(isEffectiveItemRow));
  eq("total rateado fecha", round2(effective.reduce((sum, item) => sum + item.total, 0)), 250);
  eq("tarifa rateada fecha", round2(effective.reduce((sum, item) => sum + item.tarifaVenda, 0)), -30);
  eq("frete rateado fecha", round2(effective.reduce((sum, item) => sum + item.tarifaEnvio, 0)), -10);
  eq("cancelamentos rateados fecham", round2(effective.reduce((sum, item) => sum + item.cancelRefund, 0)), -5);
  eq("ajuste de plataforma rateado fecha", round2(effective.reduce((sum, item) => sum + item.platformAdjustment, 0)), 10);
  eq("primeiro item recebe 1/3 do total", effective[0].total, 83.33);
  eq("segundo item absorve arredondamento", effective[1].total, 166.67);
}

// ── Teste 4 — Filho cancelado dentro de pedido agrupado ────────────────────
console.log("\n▸ Teste 4 — filho cancelado em pedido agrupado");
{
  const salesRowsRaw = [
    {
      "numero de venda": "2001",
      "data da venda": "2026-06-01",
      "receita por produtos": 200,
      total: 180,
      "tarifa de venda e impostos": -20,
      "tarifas de envio": 0,
      "cancelamentos e reembolsos": 0,
      "descontos e bonus": 0,
      estado: "Pago",
    },
    {
      "numero de venda": "2001",
      "data da venda": "2026-06-01",
      "# de anuncio": "MLB111",
      unidades: 1,
      "preco unitario de venda do anuncio": 100,
      "titulo do anuncio": "Produto A",
      estado: "Pago",
    },
    {
      "numero de venda": "2001",
      "data da venda": "2026-06-01",
      "# de anuncio": "MLB222",
      unidades: 1,
      "preco unitario de venda do anuncio": 100,
      "titulo do anuncio": "Produto B",
      estado: "Cancelada",
    },
  ];
  const costRowsRaw = [
    { "# de anuncio": "MLB111", custo: 40, imposto: 0 },
    { "# de anuncio": "MLB222", custo: 40, imposto: 0 },
  ];

  const resultado = processMeli(salesRowsRaw, costRowsRaw, 0, 0, 0);
  const ids = resultado.detailedRows.map((row) => row["# de anúncio"]);

  ok("Produto A entra no LC", ids.includes("MLB111"));
  ok("Produto B NÃO entra no LC", !ids.includes("MLB222"));

  const auditados = resultado.auditRows.map((row) => row["# de anúncio"]);
  ok("Produto B aparece na auditoria", auditados.includes("MLB222"));
  eq("auditoria registra o status", resultado.auditRows[0]["Status da venda"], "cancelled");
  ok(
    "Produto B mantém o valor que lhe cabia no pedido",
    Number(resultado.auditRows[0]["Total rateado (BRL)"]) === 90
  );
  eq("summary conta o item fora do LC", resultado.summary.excludedStatusCount, 1);
  eq("faturamento do LC só considera o item pago", resultado.summary.grossRevenueTotal, 100);
}

// ── Teste 2 — Receita sem custo não desaparece ─────────────────────────────
console.log("\n▸ Teste 2 — receita sem custo é preservada");
{
  const salesRowsRaw = [
    {
      "numero de venda": "3001",
      "data da venda": "2026-06-02",
      "# de anuncio": "MLB111",
      unidades: 1,
      "preco unitario de venda do anuncio": 100,
      "receita por produtos": 100,
      total: 100,
      "titulo do anuncio": "Produto A (com custo)",
      estado: "Pago",
    },
    {
      "numero de venda": "3002",
      "data da venda": "2026-06-03",
      "# de anuncio": "MLB999",
      unidades: 1,
      "preco unitario de venda do anuncio": 100,
      "receita por produtos": 100,
      total: 100,
      "titulo do anuncio": "Produto B (sem custo)",
      estado: "Pago",
    },
  ];
  const costRowsRaw = [{ "# de anuncio": "MLB111", custo: 40, imposto: 0 }];

  const r = processMeli(salesRowsRaw, costRowsRaw, 20, 0, 0);

  eq("grossRevenueTotal = 200", r.summary.grossRevenueTotal, 200);
  eq("revenueWithCost = 100", r.summary.revenueWithCost, 100);
  eq("revenueWithoutCost = 100", r.summary.revenueWithoutCost, 100);
  eq("tacos = 0.10 (sobre o faturamento total)", round2(r.summary.tacos * 100) / 100, 0.1);
  eq("financialConfidence = parcial", r.summary.financialConfidence, "parcial");
  eq("cobertura = 50%", r.summary.calculatedCoveragePercent, 50);

  const ids = r.detailedRows.map((row) => row["# de anúncio"]);
  ok("Produto B não desaparece do detalhamento", ids.includes("MLB999"));

  const semCusto = r.detailedRows.find((row) => row["# de anúncio"] === "MLB999");
  eq("LC do produto sem custo é null (não zero)", semCusto.LC, null);
  eq("MC do produto sem custo é null", semCusto.MC, null);
  eq("custo do produto sem custo é null", semCusto["Preço de custo"], null);
  eq("linha marcada como sem custo", semCusto["Cobertura de custo"], "sem custo");

  eq("unmatchedIds preservado", r.unmatchedIds.length, 1);
  eq("MC calculada usa só a receita com custo", r.summary.averageContributionMargin, 0.6);
  ok(
    "lucro não considera a receita sem custo",
    r.summary.contributionProfitTotal === 60
  );
}

// ── Teste 6 — TACoX inclui afiliados ──────────────────────────────────────
console.log("\n▸ Teste 6 — TACoX inclui afiliados (Meli)");
{
  const salesRowsRaw = [
    {
      "numero de venda": "4001",
      "data da venda": "2026-06-04",
      "# de anuncio": "MLB111",
      unidades: 10,
      "preco unitario de venda do anuncio": 100,
      "receita por produtos": 1000,
      total: 1000,
      "titulo do anuncio": "Produto A",
      estado: "Pago",
    },
  ];
  const costRowsRaw = [{ "# de anuncio": "MLB111", custo: 40, imposto: 0 }];

  const r = processMeli(salesRowsRaw, costRowsRaw, 50, 100, 20);

  eq("faturamento = 1000", r.summary.grossRevenueTotal, 1000);
  eq("TACoS = 5%", round2(r.summary.tacos * 100), 5);
  eq("TACoX = 17%", round2(r.summary.tacox * 100), 17);
}

// ── Sem divisão por zero ──────────────────────────────────────────────────
console.log("\n▸ Bordas numéricas");
{
  const r = processMeli([], [{ "# de anuncio": "MLB111", custo: 10 }], 100, 50, 10);
  eq("faturamento zero não gera NaN no TACoS", r.summary.tacos, 0);
  eq("faturamento zero não gera NaN no TACoX", r.summary.tacox, 0);
  eq("confiança sem dados é insuficiente", r.summary.financialConfidence, "insuficiente");
  eq("cobertura sem faturamento é null", r.summary.calculatedCoveragePercent, null);
  ok(
    "nenhum campo numérico do summary é NaN/Infinity",
    Object.values(r.summary).every(
      (value) => typeof value !== "number" || Number.isFinite(value)
    )
  );
}

console.log(`\n${checks} verificações passaram. Fechamento MELI OK.`);
