// server/tests/fechamentoFinanceiroPendente.test.js
// Vendas do Mercado Livre cujo financeiro (tarifas/repasse) ainda não foi
// publicado no relatório. Campo vazio NÃO é zero: a venda continua no
// faturamento, mas fica fora de LC, MC e Resultado Final.

const assert = require("assert");

const {
  parseMeliRows,
  buildMeliCostIndex,
  processMeli,
} = require("../services/fechamentoFinanceiro/meliFinanceiroService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.strictEqual(actual, expected, `${label}: ${actual} !== ${expected}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// ── Fixture: 23 vendas, 4 com financeiro publicado e 19 pendentes ──────────
//
// Faturamento total    = 4.399,75  (unidades × preço de todas as 23)
// Faturamento com dados=   683,02  (as 4 com Total (BRL))
// Faturamento pendente = 3.716,73
// LC                   =   166,29  (Total - imposto×venda - custo×unidades)

// 4 vendas completas: [mlb, unidades, preço, receita, total, custo]
const VENDAS_COMPLETAS = [
  ["MLB101", 1, 189.90, 189.90, 158.40, 95.00],   // LC 63.40
  ["MLB102", 1, 149.90, 149.90, 124.30, 80.00],   // LC 44.30
  ["MLB103", 2, 89.95, 179.90, 149.20, 60.00],    // LC 29.20
  ["MLB104", 1, 163.32, 163.32, 135.50, 106.11],  // LC 29.39
];

// 19 vendas com financeiro pendente: 18 × 195,00 + 1 × 206,73 = 3.716,73
const VENDAS_PENDENTES = [];
for (let i = 0; i < 19; i++) {
  const price = i < 18 ? 195.00 : 206.73;
  VENDAS_PENDENTES.push([`MLB2${String(i).padStart(2, "0")}`, 1, price, 70.00]);
}

const HEADER_KEYS = {
  sale: "N.º de venda",
  date: "Data da venda",
  status: "Estado",
  ad: "# de anúncio",
  title: "Título do anúncio",
  units: "Unidades",
  price: "Preço unitário de venda do anúncio (BRL)",
  revenue: "Receita por produtos (BRL)",
  fee: "Tarifa de venda e impostos (BRL)",
  shipping: "Tarifas de envio (BRL)",
  total: "Total (BRL)",
};

const salesRows = [];
let saleSeq = 0;

for (const [mlb, units, price, revenue, total, ,] of VENDAS_COMPLETAS) {
  saleSeq += 1;
  salesRows.push({
    [HEADER_KEYS.sale]: `V-${saleSeq}`,
    [HEADER_KEYS.date]: "03/08/2026",
    [HEADER_KEYS.status]: "Pago",
    [HEADER_KEYS.ad]: mlb,
    [HEADER_KEYS.title]: `Produto ${mlb}`,
    [HEADER_KEYS.units]: units,
    [HEADER_KEYS.price]: price,
    [HEADER_KEYS.revenue]: revenue,
    [HEADER_KEYS.fee]: -20,
    [HEADER_KEYS.shipping]: -10,
    [HEADER_KEYS.total]: total,
  });
}

// Financeiro pendente: receita, tarifas e total chegam VAZIOS da planilha.
for (const [mlb, units, price] of VENDAS_PENDENTES) {
  saleSeq += 1;
  salesRows.push({
    [HEADER_KEYS.sale]: `V-${saleSeq}`,
    [HEADER_KEYS.date]: "03/08/2026",
    [HEADER_KEYS.status]: "Pago",
    [HEADER_KEYS.ad]: mlb,
    [HEADER_KEYS.title]: `Produto ${mlb}`,
    [HEADER_KEYS.units]: units,
    [HEADER_KEYS.price]: price,
    [HEADER_KEYS.revenue]: "",
    [HEADER_KEYS.fee]: "",
    [HEADER_KEYS.shipping]: "",
    [HEADER_KEYS.total]: "",
  });
}

// TODAS as 23 têm custo cadastrado na base.
const costRows = [
  ...VENDAS_COMPLETAS.map(([mlb, , , , , custo]) => ({
    "# de anúncio": mlb,
    custo,
    imposto: 0,
  })),
  ...VENDAS_PENDENTES.map(([mlb, , , custo]) => ({
    "# de anúncio": mlb,
    custo,
    imposto: 0,
  })),
];

console.log("\n▸ MELI — vendas com financeiro ainda não publicado");

eq("23 vendas na planilha", salesRows.length, 23);
eq("23 custos na base", costRows.length, 23);

// ── 1. Flags de presença ───────────────────────────────────────────────────
const parsed = parseMeliRows(salesRows);
ok("venda completa marca hasFinancialTotal", parsed[0].hasFinancialTotal === true);
ok("venda completa marca hasProductRevenue", parsed[0].hasProductRevenue === true);
ok("venda completa marca hasSaleFee", parsed[0].hasSaleFee === true);
ok("venda completa marca hasShippingFee", parsed[0].hasShippingFee === true);
ok("venda pendente NÃO marca hasFinancialTotal", parsed[4].hasFinancialTotal === false);
ok("venda pendente NÃO marca hasProductRevenue", parsed[4].hasProductRevenue === false);
ok("venda pendente NÃO marca hasSaleFee", parsed[4].hasSaleFee === false);
ok("venda pendente NÃO marca hasShippingFee", parsed[4].hasShippingFee === false);

// Zero explícito é presença, não ausência.
const comZeroExplicito = parseMeliRows([{
  [HEADER_KEYS.sale]: "V-ZERO",
  [HEADER_KEYS.ad]: "MLB999",
  [HEADER_KEYS.units]: 1,
  [HEADER_KEYS.price]: 10,
  [HEADER_KEYS.total]: 0,
  [HEADER_KEYS.fee]: 0,
}]);
ok("Total = 0 explícito conta como presente", comZeroExplicito[0].hasFinancialTotal === true);
ok("tarifa = 0 explícita conta como presente", comZeroExplicito[0].hasSaleFee === true);

// ── 2. Fechamento ──────────────────────────────────────────────────────────
const result = processMeli(salesRows, costRows, 0, 0, 0);
const s = result.summary;

eq("faturamento total das vendas", s.grossRevenueTotal, 4399.75);
eq("faturamento com financeiro disponível", s.revenueWithFinancialData, 683.02);
eq("faturamento com financeiro pendente", s.revenuePendingFinancial, 3716.73);
eq("cobertura financeira percentual", s.financialDataCoveragePercent, 15.52);
eq("4 vendas com financeiro disponível", s.salesWithFinancialDataCount, 4);
eq("19 vendas com financeiro pendente", s.salesPendingFinancialCount, 19);

eq("LC considera somente o financeiro disponível", s.contributionProfitTotal, 166.29);
eq(
  "MC calculável ≈ 24,35%",
  Number((s.contributionMarginCalculated * 100).toFixed(2)),
  24.35
);
eq("Resultado Final parte do LC calculável", s.finalResult, 166.29);

// ── 3. Faturamento preservado, LC/MC nunca zerados ─────────────────────────
const linhasPendentes = result.detailedRows.filter(
  (row) => row["Cobertura de custo"] === "financeiro pendente"
);
eq("19 linhas marcadas como financeiro pendente", linhasPendentes.length, 19);
ok("linha pendente mantém LC desconhecido", linhasPendentes.every((row) => row.LC === null));
ok("linha pendente mantém MC desconhecida", linhasPendentes.every((row) => row.MC === null));
ok(
  "linha pendente NÃO vira Total 0",
  linhasPendentes.every((row) => row["Total (BRL)"] === null)
);
ok(
  "linha pendente mantém o faturamento visível",
  linhasPendentes.every((row) => row["Venda Total"] > 0)
);
eq(
  "faturamento das linhas pendentes soma 3.716,73",
  Number(
    linhasPendentes
      .reduce((sum, row) => sum + row["Venda Total"], 0)
      .toFixed(2)
  ),
  3716.73
);

// ── 4. Confiança e aviso ───────────────────────────────────────────────────
ok("nenhum anúncio ficou sem custo", result.unmatchedIds.length === 0);
eq("fechamento não é confiável com pendências", s.financialConfidence, "parcial");
eq(
  "aviso de financeiro pendente",
  s.pendingFinancialWarning,
  "Parte das vendas ainda não possui tarifas e repasse disponíveis no relatório " +
  "do Mercado Livre. LC, MC e Resultado Final consideram somente as vendas com " +
  "dados financeiros completos."
);
ok(
  "aviso aparece nas notas executivas",
  s.executiveNotes.includes(s.pendingFinancialWarning)
);

// ── 5. Fórmulas das vendas completas intactas ──────────────────────────────
const completas = result.detailedRows.filter((row) =>
  ["MLB101", "MLB102", "MLB103", "MLB104"].includes(row["# de anúncio"])
);
eq("4 linhas completas calculadas", completas.length, 4);
const porId = new Map(completas.map((row) => [row["# de anúncio"], row]));
eq("LC MLB101 inalterado", porId.get("MLB101").LC, 63.40);
eq("LC MLB102 inalterado", porId.get("MLB102").LC, 44.30);
eq("LC MLB103 inalterado", porId.get("MLB103").LC, 29.20);
eq("LC MLB104 inalterado", porId.get("MLB104").LC, 29.39);
ok("linha completa mantém cobertura com custo",
  completas.every((row) => row["Cobertura de custo"] === "com custo"));

// ── 6. Regressão: sem pendências nada muda ─────────────────────────────────
console.log("\n▸ Regressão — planilha inteiramente completa");
const somenteCompletas = salesRows.slice(0, 4);
const completoResult = processMeli(somenteCompletas, costRows, 0, 0, 0);
eq("faturamento das 4 completas", completoResult.summary.grossRevenueTotal, 683.02);
eq("LC das 4 completas", completoResult.summary.contributionProfitTotal, 166.29);
eq("confiança volta a confiável", completoResult.summary.financialConfidence, "confiavel");
eq("sem pendência financeira", completoResult.summary.revenuePendingFinancial, 0);
eq("aviso ausente sem pendência", completoResult.summary.pendingFinancialWarning, null);
eq("cobertura financeira 100%", completoResult.summary.financialDataCoveragePercent, 100);

// ── 7. Duplicidade na base de custos ───────────────────────────────────────
console.log("\n▸ Base de custos — MLB duplicado com custos divergentes");

const baseConflitante = [
  { "# de anúncio": "MLB101", custo: 95.00, imposto: 0 },
  { "# de anúncio": "MLB101", custo: 42.00, imposto: 0 },
];
const indexConflitante = buildMeliCostIndex(baseConflitante);
eq("um conflito detectado", indexConflitante.conflicts.length, 1);
eq("conflito identifica o MLB", indexConflitante.conflicts[0].id, "MLB101");
assert.deepStrictEqual(
  indexConflitante.conflicts[0].values,
  [{ cost: 95, taxPercent: 0 }, { cost: 42, taxPercent: 0 }]
);
checks += 1;
console.log("  ok  conflito informa os valores em disputa");
ok(
  "sem variação, o custo não resolve silenciosamente no primeiro",
  indexConflitante.map.get("MLB101").ambiguous === true
);

const vendaConflitante = [{
  [HEADER_KEYS.sale]: "V-CONF",
  [HEADER_KEYS.date]: "03/08/2026",
  [HEADER_KEYS.status]: "Pago",
  [HEADER_KEYS.ad]: "MLB101",
  [HEADER_KEYS.title]: "Produto conflitante",
  [HEADER_KEYS.units]: 1,
  [HEADER_KEYS.price]: 189.90,
  [HEADER_KEYS.revenue]: 189.90,
  [HEADER_KEYS.total]: 158.40,
}];
const conflitoResult = processMeli(vendaConflitante, baseConflitante, 0, 0, 0);
eq(
  "MLB ambíguo é bloqueado, não calculado",
  conflitoResult.detailedRows[0]["Cobertura de custo"],
  "custo ambíguo"
);
eq("LC do MLB ambíguo fica desconhecido", conflitoResult.detailedRows[0].LC, null);
eq(
  "faturamento do MLB ambíguo é preservado",
  conflitoResult.summary.grossRevenueTotal,
  189.90
);
ok(
  "aviso informa MLB e valores conflitantes",
  conflitoResult.summary.costConflictWarnings.some(
    (warning) =>
      warning.includes("MLB101") && warning.includes("95.00") && warning.includes("42.00")
  )
);
ok(
  "MLB ambíguo não é contado como 'sem custo cadastrado'",
  conflitoResult.unmatchedIds.length === 0
);

// ── 8. Variação desempata o custo ──────────────────────────────────────────
console.log("\n▸ Base de custos — variações com model_id");

const baseVariacoes = [
  { "# de anúncio": "MLB101", model_id: "AZUL", custo: 95.00, imposto: 0 },
  { "# de anúncio": "MLB101", model_id: "VERDE", custo: 42.00, imposto: 0 },
];
const indexVariacoes = buildMeliCostIndex(baseVariacoes);
ok("conflito é marcado como resolvível por variação",
  indexVariacoes.conflicts[0].resolvableByVariation === true);

const vendaComVariacao = [{
  [HEADER_KEYS.sale]: "V-VAR",
  [HEADER_KEYS.date]: "03/08/2026",
  [HEADER_KEYS.status]: "Pago",
  [HEADER_KEYS.ad]: "MLB101",
  "model_id": "VERDE",
  [HEADER_KEYS.title]: "Produto verde",
  [HEADER_KEYS.units]: 1,
  [HEADER_KEYS.price]: 189.90,
  [HEADER_KEYS.revenue]: 189.90,
  [HEADER_KEYS.total]: 158.40,
}];
const variacaoResult = processMeli(vendaComVariacao, baseVariacoes, 0, 0, 0);
eq(
  "venda com model_id usa o custo da variação",
  variacaoResult.detailedRows[0]["Preço de custo"],
  42.00
);
eq(
  "LC da variação usa o custo correto",
  variacaoResult.detailedRows[0].LC,
  round2Local(158.40 - 42.00)
);

function round2Local(value) {
  return Number(value.toFixed(2));
}

// Sem identificador de variação, o mesmo MLB continua ambíguo.
const vendaSemVariacao = [{ ...vendaComVariacao[0], "model_id": "" }];
const semVariacaoResult = processMeli(vendaSemVariacao, baseVariacoes, 0, 0, 0);
eq(
  "sem identificador de variação o custo é ambíguo",
  semVariacaoResult.detailedRows[0]["Cobertura de custo"],
  "custo ambíguo"
);

console.log(`\n${checks} verificações passaram. Financeiro pendente do MELI protegido.`);
