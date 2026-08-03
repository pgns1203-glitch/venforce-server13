// Regressão do formato atual da planilha de vendas do Mercado Livre.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const {
  detectMeliHeader,
  parseSpreadsheet,
  readSheetRows,
  validateMeliHeaderAtRow,
} = require("../utils/excelUtils");
const { parseMoneyValue } = require("../utils/numberUtils");
const { processMeli } = require("../services/fechamentoFinanceiro/meliFinanceiroService");
const {
  processarFechamentoFinanceiroController,
} = require("../controllers/fechamentosFinanceiroController");

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

function workbookBuffer(rows) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Vendas");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function shiftedRealWorkbookBuffer() {
  const header = [
    "N.º de venda",
    "Data da venda",
    "Estado",
    "Unidades",
    "Receita por produtos (BRL)",
    "Total (BRL)",
    "# de anúncio",
    "Título do anúncio",
    "Preço unitário de venda do anúncio (BRL)",
  ];
  const rows = [
    ["Relatório de vendas Mercado Livre"],
    ["Período de referência"],
    [],
    ["Vendas", "Publicidade", "Anúncios"],
    header,
  ];

  for (let i = 0; i < 3906; i++) {
    const hasItem = i < 3811;
    rows.push([
      `V-REAL-${i + 1}`,
      "03/08/2026",
      "Pago",
      hasItem ? 1 : "",
      hasItem ? 100 : "",
      hasItem ? 90 : "",
      hasItem ? "MLB111" : "",
      hasItem ? "Produto real" : "",
      hasItem ? 100 : "",
    ]);
  }

  const sheet = {};
  XLSX.utils.sheet_add_aoa(sheet, rows, { origin: "A2" });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Vendas BR");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

const CURRENT_HEADERS = [
  "Número da venda",
  "Data e hora da venda",
  "Quantidade",
  "Valor total (BRL)",
  "Receita dos produtos (BRL)",
  "ID do anúncio",
  "Preço unitário (BRL)",
  "Tarifas por venda (BRL)",
  "Devoluções e reembolsos (BRL)",
];

const SALES_ROWS = [
  ["Relatório de vendas Mercado Livre"],
  [],
  CURRENT_HEADERS,
  ["V-1001", "01/08/2026", 2, 180, 200, "MLB111", 100, -20, 0],
  ["V-1002", "02/08/2026", 1, 135, 150, "MLB222", 150, -15, 0],
];

const COST_ROWS = [
  ["id", "custo", "imposto"],
  ["MLB111", 40, 0],
  ["MLB222", 50, 0],
];

async function main() {
  console.log("\n▸ Mercado Livre — parsing do formato atual");

  const salesBuffer = workbookBuffer(SALES_ROWS);
  const costsBuffer = workbookBuffer(COST_ROWS);
  const header = detectMeliHeader(salesBuffer);
  eq("linha de cabeçalho detectada", header.rowIndex, 2);
  ok("cabeçalho foi reconhecido com confiança", header.found);
  eq("nove grupos de campos reconhecidos", header.matchedFields.length, 9);

  const salesRows = parseSpreadsheet(salesBuffer, header.rowIndex);
  const costsRows = parseSpreadsheet(costsBuffer, 0);
  const result = processMeli(salesRows, costsRows, 0, 0, 0);

  eq("duas linhas lidas", result.parsingDiagnostics.totalRowsRead, 2);
  eq("duas linhas com número de venda", result.parsingDiagnostics.rowsWithSaleNumber, 2);
  eq("duas linhas com anúncio", result.parsingDiagnostics.rowsWithAd, 2);
  eq("duas linhas com unidades", result.parsingDiagnostics.rowsWithUnits, 2);
  eq("duas vendas reconhecidas", result.parsingDiagnostics.recognizedSalesCount, 2);
  eq("duas linhas financeiras criadas", result.parsingDiagnostics.financialRowsCount, 2);
  eq("receita encontrada no diagnóstico", result.parsingDiagnostics.revenueFound, 350);
  eq("receita bruta não zera silenciosamente", result.summary.grossRevenueTotal, 350);
  eq("receita líquida reconhecida", result.summary.paidRevenueTotal, 315);
  eq("LC preserva a fórmula existente", result.summary.contributionProfitTotal, 185);

  const validReq = {
    files: {
      sales: [{ buffer: salesBuffer }],
      costs: [{ buffer: costsBuffer }],
    },
    body: {
      marketplace: "meli",
      ads: "3.011,00",
      venforce: "1950.00",
      affiliates: "0",
      fullCost: "0",
      additionalCosts: "0",
    },
  };
  const validRes = fakeRes();
  await processarFechamentoFinanceiroController(validReq, validRes);
  eq("controller processa o formato atual", validRes.statusCode, 200);
  eq("controller devolve a receita reconhecida", validRes.body.summary.grossRevenueTotal, 350);
  ok("controller não marca planilha com vendas como vazia", !validRes.body.emptySales);

  const parentChildBuffer = workbookBuffer([
    [
      "N.º de venda", "Data da venda", "Estado", "Unidades",
      "Receita por produtos (BRL)", "Tarifa de venda e impostos (BRL)",
      "Total (BRL)", "# de anúncio", "Título do anúncio",
      "Preço unitário de venda do anúncio (BRL)",
    ],
    ["V-PAI-1", "03/08/2026", "Pago", 2, 200, -20, 180, "", "", ""],
    ["", "", "", "", "", "", "", "MLB111", "Produto filho", 100],
  ]);
  const parentChildReq = {
    files: {
      sales: [{ buffer: parentChildBuffer }],
      costs: [{ buffer: costsBuffer }],
    },
    body: { marketplace: "meli", ads: "0", venforce: "0", affiliates: "0" },
  };
  const parentChildRes = fakeRes();
  await processarFechamentoFinanceiroController(parentChildReq, parentChildRes);
  eq("estrutura pai/filho responde 200, não 422", parentChildRes.statusCode, 200);
  eq("controller reconhece a receita do pai", parentChildRes.body.summary.grossRevenueTotal, 200);
  eq("controller calcula o LC do item filho", parentChildRes.body.summary.contributionProfitTotal, 100);
  eq("controller encontra o custo pelo MLB filho", parentChildRes.body.detailedRows[0]["Preço de custo"], 40);
  eq("controller calcula cobertura integral", parentChildRes.body.summary.calculatedCoveragePercent, 100);

  console.log("\n▸ Mercado Livre — !ref em A2 e cabeçalho absoluto na linha 6");
  const shiftedSalesBuffer = shiftedRealWorkbookBuffer();
  const shiftedSheet = readSheetRows(shiftedSalesBuffer);
  const shiftedHeader = detectMeliHeader(shiftedSalesBuffer);
  const shiftedHeaderValidation = validateMeliHeaderAtRow(
    shiftedSalesBuffer,
    shiftedHeader.rowIndex
  );
  eq("primeira linha absoluta do !ref é A2", shiftedSheet.firstRowIndex, 1);
  eq("índice relativo detectado é 4", shiftedHeader.relativeRowIndex, 4);
  eq("índice absoluto usado pelo parser é 5", shiftedHeader.rowIndex, 5);
  ok(
    "linha 5 do Excel com títulos de seção é rejeitada pela proteção",
    !validateMeliHeaderAtRow(shiftedSalesBuffer, 4).valid
  );
  ok("linha absoluta contém os quatro grupos obrigatórios", shiftedHeaderValidation.valid);

  const shiftedReq = {
    files: {
      sales: [{ buffer: shiftedSalesBuffer }],
      costs: [{ buffer: costsBuffer }],
    },
    body: { marketplace: "meli", ads: "0", venforce: "0", affiliates: "0" },
  };
  const shiftedRes = fakeRes();
  await processarFechamentoFinanceiroController(shiftedReq, shiftedRes);
  eq("processamento com !ref deslocado não retorna 422", shiftedRes.statusCode, 200);
  eq("diagnóstico exibe a linha 6 do Excel", shiftedRes.body.diagnostico.linhaCabecalho, 6);
  eq("3906 linhas de dados lidas", shiftedRes.body.diagnostico.totalLinhasLidas, 3906);
  const shiftedParsedRows = parseSpreadsheet(shiftedSalesBuffer, shiftedHeader.rowIndex);
  const shiftedResult = processMeli(shiftedParsedRows, costsRows, 0, 0, 0);
  eq("3906 números de venda reconhecidos", shiftedResult.parsingDiagnostics.rowsWithSaleNumber, 3906);
  eq("3811 linhas possuem MLB", shiftedResult.parsingDiagnostics.rowsWithAd, 3811);
  eq("3811 linhas possuem unidades", shiftedResult.parsingDiagnostics.rowsWithUnits, 3811);
  ok("ao menos uma venda foi reconhecida", shiftedResult.parsingDiagnostics.recognizedSalesCount > 0);

  console.log("\n▸ Mercado Livre — formato não reconhecido retorna 422");
  const invalidSales = workbookBuffer([
    ["Relatório"],
    ["Número da venda", "Data da venda", "Itens vendidos", "Faturamento desconhecido"],
    ["V-ERRO", "03/08/2026", 2, 500],
  ]);
  const req = {
    files: {
      sales: [{ buffer: invalidSales }],
      costs: [{ buffer: costsBuffer }],
    },
    body: { marketplace: "meli", ads: "0", venforce: "0", affiliates: "0" },
  };
  const res = fakeRes();
  await processarFechamentoFinanceiroController(req, res);
  eq("status de formato não reconhecido", res.statusCode, 422);
  eq(
    "mensagem clara e estável",
    res.body.error,
    "Não foi possível reconhecer as vendas desta planilha do Mercado Livre. Verifique o formato ou os cabeçalhos."
  );
  assert.deepStrictEqual(Object.keys(res.body.diagnostico), [
    "cabecalhosDetectados",
    "linhaCabecalho",
    "totalLinhasLidas",
    "totalLinhasReconhecidas",
    "totalVendasReconhecidas",
  ]);
  checks += 1;
  console.log("  ok  erro expõe somente o diagnóstico permitido");
  eq("linha escolhida informada", res.body.diagnostico.linhaCabecalho, 2);
  eq("total de linhas informado", res.body.diagnostico.totalLinhasLidas, 1);
  eq("nenhuma linha falsamente reconhecida", res.body.diagnostico.totalLinhasReconhecidas, 0);
  eq("nenhuma venda falsamente reconhecida", res.body.diagnostico.totalVendasReconhecidas, 0);

  let revenueHeaderError = null;
  try {
    processMeli([{
      "Número da venda": "V-SEM-RECEITA",
      "Data da venda": "03/08/2026",
      Quantidade: 1,
      "ID do anúncio": "MLB111",
      "Faturamento em novo formato": "500,00",
    }], costsRows, 0, 0, 0);
  } catch (error) {
    revenueHeaderError = error;
  }
  eq("coluna de receita desconhecida também retorna 422", revenueHeaderError?.statusCode, 422);
  ok("receita desconhecida nunca retorna resultado zero com OK", /colunas de receita/.test(revenueHeaderError?.message || ""));

  console.log("\n▸ Mercado Livre — planilha válida sem vendas");
  const emptyResult = processMeli([], costsRows, 3111, 1950, 0);
  ok("planilha vazia válida não lança erro", emptyResult.emptySales);
  eq("mensagem diferencia vazio válido", emptyResult.message, "Planilha válida sem vendas.");

  console.log("\n▸ Valores monetários");
  for (const [raw, expected] of [["3011", 3011], ["3011.00", 3011], ["3.011,00", 3011]]) {
    const parsed = parseMoneyValue(raw);
    ok(`${raw} é aceito`, parsed.valid);
    eq(`${raw} mantém o valor`, parsed.value, expected);
  }
  ok("3.01100 é rejeitado como ambíguo", !parseMoneyValue("3.01100").valid);

  const html = fs.readFileSync(
    path.join(__dirname, "..", "..", "Portal", "financeiro.html"),
    "utf8"
  );
  for (const id of ["fin-ads", "fin-venforce", "fin-affiliates", "fin-full-cost", "fin-additional-costs"]) {
    ok(`${id} permite formato brasileiro`, new RegExp(`type="text" id="${id}"`).test(html));
  }

  console.log(`\n${checks} verificações passaram. Formato atual do MELI protegido.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
