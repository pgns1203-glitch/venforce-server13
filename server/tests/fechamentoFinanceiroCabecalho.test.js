// server/tests/fechamentoFinanceiroCabecalho.test.js
// Teste 7 — o mesmo conteúdo com o cabeçalho em linhas diferentes tem que
// gerar exatamente o mesmo fechamento. O controller usa detectMeliHeaderRow.

const assert = require("assert");
const XLSX = require("xlsx");

const { detectMeliHeaderRow, parseSpreadsheet } = require("../utils/excelUtils");
const { processMeli } = require("../services/fechamentoFinanceiro/meliFinanceiroService");

let checks = 0;
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const HEADER = [
  "N.º de venda",
  "Data da venda",
  "# de anúncio",
  "Título do anúncio",
  "Unidades",
  "Preço unitário de venda do anúncio (BRL)",
  "Receita por produtos (BRL)",
  "Total (BRL)",
  "Tarifa de venda e impostos (BRL)",
  "Tarifas de envio (BRL)",
  "Cancelamentos e reembolsos (BRL)",
  "Descontos e bônus",
  "Estado",
];

const DATA = [
  ["5001", "2026-06-10", "", "", "", "", 300, 260, -40, 0, 0, 0, "Pago"],
  ["5001", "2026-06-10", "MLB111", "Produto A", 1, 200, "", "", "", "", "", "", "Pago"],
  ["5001", "2026-06-10", "MLB222", "Produto B", 1, 100, "", "", "", "", "", "", "Pago"],
  ["5002", "2026-06-11", "MLB333", "Produto C", 2, 50, 100, 90, -10, 0, 0, 0, "Pago"],
];

const COST_ROWS = [
  { "# de anuncio": "MLB111", custo: 80, imposto: 10 },
  { "# de anuncio": "MLB222", custo: 30, imposto: 10 },
  { "# de anuncio": "MLB333", custo: 20, imposto: 10 },
];

// Monta um .xlsx com N linhas de lixo antes do cabeçalho, como a exportação
// real do Mercado Livre faz.
function buildWorkbookBuffer(headerRowIndex) {
  const aoa = [];
  for (let i = 0; i < headerRowIndex; i++) {
    aoa.push([`Relatório de vendas — linha de cabeçalho ${i + 1}`]);
  }
  aoa.push(HEADER);
  for (const row of DATA) aoa.push(row);

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Vendas");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

console.log("\n▸ Teste 7 — cabeçalho variável do Mercado Livre");

const resultados = [];
for (const headerRow of [0, 3, 5, 7]) {
  const buffer = buildWorkbookBuffer(headerRow);
  const detectada = detectMeliHeaderRow(buffer);
  eq(`cabeçalho detectado na linha ${headerRow}`, detectada, headerRow);

  const salesRowsRaw = parseSpreadsheet(buffer, detectada);
  resultados.push(processMeli(salesRowsRaw, COST_ROWS, 10, 20, 5).summary);
}

const referencia = resultados[0];
for (let i = 1; i < resultados.length; i++) {
  eq(`fechamento idêntico ao da linha 0 (variação ${i})`, resultados[i], referencia);
}

// Sanidade: o fechamento realmente leu os dados.
eq("faturamento reconhecido", referencia.grossRevenueTotal, 400);
eq("confiança do fechamento", referencia.financialConfidence, "confiavel");

console.log(`\n${checks} verificações passaram. Cabeçalho automático OK.`);
