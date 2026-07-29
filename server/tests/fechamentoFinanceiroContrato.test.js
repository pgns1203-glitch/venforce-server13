// server/tests/fechamentoFinanceiroContrato.test.js
// ETAPA 8 — o contrato de POST /fechamentos/financeiro não pode quebrar:
// campos preservados, Excel ainda gerado e abas novas presentes.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const XLSX = require("xlsx");

const {
  processarFechamentoFinanceiroController,
  buildFechamentoContextRows,
  formatSummaryValue,
} = require("../controllers/fechamentosFinanceiroController");

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

function toBuffer(aoa) {
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Planilha1");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

async function runController({ marketplace, salesBuffer, costsBuffer, body = {} }) {
  const req = {
    files: {
      sales: [{ buffer: salesBuffer }],
      costs: [{ buffer: costsBuffer }],
    },
    body: { marketplace, ads: "50", venforce: "20", affiliates: "10", ...body },
  };
  const res = fakeRes();
  await processarFechamentoFinanceiroController(req, res);
  return res;
}

const CONTRATO = [
  "summary",
  "detailedRows",
  "excelBase64",
  "unmatchedIds",
  "unmatchedCancelled",
  "ignoredRowsWithoutCost",
  "ignoredRevenue",
  "message",
  "costsSource",
  "costsBase",
];

async function main() {
  // ── MELI ───────────────────────────────────────────────────────────────────
  console.log("\n▸ Contrato do endpoint — Mercado Livre");
  {
    const salesBuffer = toBuffer([
      ["Relatório de vendas"],
      [],
      [
        "N.º de venda", "Data da venda", "# de anúncio", "Título do anúncio",
        "Unidades", "Preço unitário de venda do anúncio (BRL)",
        "Receita por produtos (BRL)", "Total (BRL)",
        "Tarifa de venda e impostos (BRL)", "Tarifas de envio (BRL)",
        "Cancelamentos e reembolsos (BRL)", "Descontos e bônus", "Estado",
      ],
      ["9001", "2026-07-01", "MLB111", "Produto A", 2, 100, 200, 180, -20, 0, 0, 0, "Pago"],
      ["9002", "2026-07-02", "MLB999", "Produto sem custo", 1, 100, 100, 90, -10, 0, 0, 0, "Pago"],
    ]);
    const costsBuffer = toBuffer([
      ["id", "custo", "imposto"],
      ["MLB111", 40, "10%"],
    ]);

    const res = await runController({ marketplace: "meli", salesBuffer, costsBuffer });

    eq("status 200", res.statusCode, 200);
    eq("ok = true", res.body.ok, true);
    for (const campo of CONTRATO) {
      ok(`campo preservado: ${campo}`, campo in res.body);
    }

    ok("excelBase64 continua sendo gerado", String(res.body.excelBase64 || "").length > 100);

    const workbook = XLSX.read(Buffer.from(res.body.excelBase64, "base64"), { type: "buffer" });
    ok("aba Base_MeLi presente", workbook.SheetNames.includes("Base_MeLi"));
    ok("aba Fechamento presente", workbook.SheetNames.includes("Fechamento"));

    const contexto = XLSX.utils.sheet_to_json(workbook.Sheets["Fechamento"]);
    const itens = contexto.map((row) => row.Item);
    for (const esperado of [
      "Modo de cálculo",
      "Status de confiança",
      "Receita com custo",
      "Receita sem custo",
      "Cobertura da base (%)",
    ]) {
      ok(`Excel documenta "${esperado}"`, itens.includes(esperado));
    }
    ok(
      "Excel lista componentes financeiros",
      itens.some((item) => String(item).startsWith("Componente:"))
    );

    const s = res.body.summary;
    eq("faturamento inclui a venda sem custo", s.grossRevenueTotal, 300);
    eq("receita com custo", s.revenueWithCost, 200);
    eq("receita sem custo", s.revenueWithoutCost, 100);
    eq("confiança parcial", s.financialConfidence, "parcial");
    ok("TACoS usa o faturamento total", Math.abs(s.tacos - 50 / 300) < 1e-9);
    ok("TACoX inclui afiliados", Math.abs(s.tacox - 80 / 300) < 1e-9);
  }

  // ── SHOPEE — planilha financeira deixou de ser rejeitada ───────────────────
  console.log("\n▸ Contrato do endpoint — Shopee (planilha financeira)");
  {
    const salesBuffer = toBuffer([
      [
        "ID do pedido", "Status do pedido", "Status da devolução / reembolso",
        "Nome do produto", "SKU da variação", "Quantidade",
        "Preço acordado", "Subtotal do produto", "Repasse",
        "Taxa de transação", "Taxa de comissão líquida", "Taxa de serviço líquida",
        "Valor estimado do frete", "Imposto", "CMV",
      ],
      ["P-1", "Concluído", "", "Produto A", "SKU-A", 1, 100, 100, 80, -2, -14, -4, "", "", ""],
      ["P-2", "Cancelado", "", "Produto B", "SKU-B", 1, 50, 50, 0, "", "", "", "", "", ""],
    ]);
    const costsBuffer = toBuffer([
      ["sku", "custo", "imposto"],
      ["SKU-A", 30, "0%"],
      ["SKU-B", 20, "0%"],
    ]);

    const res = await runController({ marketplace: "shopee", salesBuffer, costsBuffer });

    eq("status 200 (não é mais rejeitada)", res.statusCode, 200);
    eq("ok = true", res.body.ok, true);
    for (const campo of CONTRATO) {
      ok(`campo preservado: ${campo}`, campo in res.body);
    }

    const s = res.body.summary;
    eq("modo real", s.calculationMode, "real_financial");
    eq("faturamento reconhecido exclui o cancelado", s.grossRevenueTotal, 100);
    eq("cancelado contado por pedido", s.cancelledCount, 1);
    eq("receita perdida no cancelamento", s.cancelledLostRevenue, 50);
    eq("receita líquida vem do repasse", s.paidRevenueTotal, 80);
    eq("LC = repasse − CMV", s.contributionProfitTotal, 50);
    eq("Resultado Final desconta ads/venforce/afiliados", s.finalResult, -30);
    ok("LC Total e Resultado Final são diferentes", s.contributionProfitTotal !== s.finalResult);

    const workbook = XLSX.read(Buffer.from(res.body.excelBase64, "base64"), { type: "buffer" });
    ok("aba Painel presente", workbook.SheetNames.includes("Painel"));
    ok("aba Detalhamento presente", workbook.SheetNames.includes("Detalhamento"));
    ok("aba Fechamento presente", workbook.SheetNames.includes("Fechamento"));
    ok("aba Auditoria com o pedido cancelado", workbook.SheetNames.includes("Auditoria"));
  }

  // ── SHOPEE — planilha de performance segue funcionando ────────────────────
  console.log("\n▸ Contrato do endpoint — Shopee (performance)");
  {
    const salesBuffer = toBuffer([
      [
        "ID do item", "ID da variação", "Produto", "Vendas (Pedido pago) (BRL)",
        "Unidades (Pedido pago)", "Impressão do produto", "Cliques por produto", "CTR",
      ],
      ["111", "", "Produto A", 200, 2, 10, 2, "20%"],
    ]);
    const costsBuffer = toBuffer([
      ["id", "custo", "imposto"],
      ["111", 20, "0%"],
    ]);

    const res = await runController({ marketplace: "shopee", salesBuffer, costsBuffer });

    eq("status 200", res.statusCode, 200);
    eq("modo estimado", res.body.summary.calculationMode, "estimated_performance");
    eq("confiança confiável", res.body.summary.financialConfidence, "confiavel");
    ok("excelBase64 gerado", String(res.body.excelBase64 || "").length > 100);
  }

  // ── Helpers do Excel ──────────────────────────────────────────────────────
  console.log("\n▸ Helpers do Excel");
  {
    eq("null vira vazio, não zero", formatSummaryValue(null), "");
    eq("undefined vira vazio", formatSummaryValue(undefined), "");
    eq("zero continua zero", formatSummaryValue(0), 0);
    eq("array vira lista legível", formatSummaryValue(["a", "b"]), "a | b");
    ok("NaN não vaza para a planilha", formatSummaryValue(NaN) === "");

    const rows = buildFechamentoContextRows(
      { calculationMode: "real_financial", financialConfidence: "parcial", shippingFeesTotal: null },
      "shopee"
    );
    const frete = rows.find((row) => row.Item === "Componente: Frete");
    eq("componente ausente é marcado como ausente", frete.Origem, "ausente na planilha");
  }


  console.log(`\n${checks} verificações passaram. Contrato do endpoint OK.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
