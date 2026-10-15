// server/tests/fechamentoFinanceiroShopeeCustoUploadPrecisao.test.js
//
// FIN-508 — upload direto da Base de Custos Shopee no fechamento
// (POST /fechamentos/financeiro, campo `costs`). O Model de 12 dígitos numa
// célula numérica "Geral" do Excel chegava ao motor como "2.39435E+11" e
// nenhuma variação batia (Red Fish real: 0% pelo upload, 100% pela base
// vinculada com a MESMA planilha). Regra: inteiro exato da célula → ID exato;
// texto científico sem os dígitos → nunca inventa, só diagnostica.
//
// IDs anônimos com a estrutura do Red Fish: Item de 11 dígitos (texto) e
// Models de 12 dígitos (número), vários por Item, com custos diferentes.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const XLSX = require("xlsx");
const { parseSpreadsheet, parseShopeeCostSpreadsheet } = require("../utils/excelUtils");
const { processShopee } = require("../services/fechamentoFinanceiro/shopeePerformanceService");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), `${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

function xlsx(aoa) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Custos");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

const ITEM_A = "58200000001";
const ITEM_B = "23900000002";
const BASE_AOA = [
  ["ID", "ID Model", "Custo", "Imposto"],
  [ITEM_A, 239435155271, 9, 0.11],
  [ITEM_A, 239435155272, 20, 0.11],
  [ITEM_A, 239435155273, 20, 0.11],
  [ITEM_B, 129645100001, 12.5, 0.08],
  [ITEM_B, 129645100002, 15, 0.08],
];
const BASE = xlsx(BASE_AOA);
// O que a base vinculada (buildCostRowsFromBase) entrega ao motor para a
// mesma planilha persistida por Item + Model.
const BASE_VINCULADA = BASE_AOA.slice(1).map(([item, model, custo, imposto]) => ({
  "id do item": item, "id model": String(model), sku: "", custo, imposto,
}));

console.log("\n▸ Leitor da base de custos Shopee (upload)");
{
  const antes = parseSpreadsheet(BASE);
  ok("parseSpreadsheet global continua como era (texto exibido pelo Excel)", antes[0]["ID Model"] === "2.39435E+11");
  const linhas = parseShopeeCostSpreadsheet(BASE);
  eq("Model de 12 dígitos chega EXATO, um por linha",
    linhas.map((l) => l["ID Model"]), ["239435155271", "239435155272", "239435155273", "129645100001", "129645100002"]);
  eq("Item de 11 dígitos inalterado", [...new Set(linhas.map((l) => l.ID))], [ITEM_A, ITEM_B]);
  eq("custo e imposto inalterados (mesmo texto do leitor global)",
    linhas.map((l) => [l.Custo, l.Imposto]), antes.map((l) => [l.Custo, l.Imposto]));
  ok("nunca 2.39435E+11 nem 239435000000", linhas.every((l) => !/E\+|000000$/.test(l["ID Model"])));
}
{
  // CSV com o texto científico: os dígitos já se perderam (o valor da célula
  // é 239435000000) — o leitor NÃO inventa o ID.
  const csv = Buffer.from(`ID,ID Model,Custo\n${ITEM_A},2.39435E+11,10\n${ITEM_A},239435155272,10\n`);
  const linhas = parseShopeeCostSpreadsheet(csv);
  eq("CSV: texto científico fica como veio; ID exato fica exato",
    linhas.map((l) => l["ID Model"]), ["2.39435E+11", "239435155272"]);
}
{
  // Inteiro exato que coincide com o texto científico: não há prova de
  // dígitos a mais — fica o texto (diagnosticado), não um ID adivinhado.
  const linhas = parseShopeeCostSpreadsheet(xlsx([["ID", "ID Model", "Custo"], [ITEM_A, 239435000000, 10]]));
  eq("valor == texto científico → sem substituição", linhas[0]["ID Model"], "2.39435E+11");
  // Acima de 2^53 o número já não é exato: nunca vira ID.
  const grande = parseShopeeCostSpreadsheet(xlsx([["ID", "ID Model", "Custo"], [ITEM_A, 12345678901234567890, 10]]));
  ok("inteiro acima de Number.MAX_SAFE_INTEGER → sem substituição", /E\+/.test(grande[0]["ID Model"]));
}

console.log("\n▸ Motor: upload direto = base vinculada (mesma planilha)");
const perf = (itemId, variationId, sku, produto, variacao) => ({
  "ID do Item": itemId, Produto: produto, "Status Atual do Item": "Normal", "ID da Variação": variationId, "Nome da Variação": variacao,
  "Status Atual da Variação": "Normal", "SKU da Variação": sku, "SKU Principle": "", "Vendas (Pedido pago) (BRL)": 0,
  "Unidades (Pedido pago)": 0, "Impressão do Produto": 0, "Cliques Por Produto": 0, CTR: "0%",
});
const venda = (id, sku, produto, variacao, preco) => ({
  "ID do pedido": id, "Status do pedido": "Concluído", "Cancelar Motivo": "", "Status da Devolução / Reembolso": "",
  "Nº de referência do SKU principal": "", "Nome do Produto": produto, "Número de referência SKU": sku, "Nome da variação": variacao,
  "Preço acordado": String(preco), Quantidade: "1", "Subtotal do produto": String(preco), "Valor Total": String(preco),
  "Taxa de transação": "0.00", "Taxa de comissão líquida": (preco * 0.18).toFixed(2), "Taxa de serviço líquida": "4.00",
  "Valor estimado do frete": "",
});
const PERFORMANCE = [
  perf(ITEM_A, "239435155271", "VEST-P", "Vestido", "P"),
  perf(ITEM_A, "239435155272", "VEST-M", "Vestido", "M"),
  perf(ITEM_A, "239435155273", "VEST-G", "Vestido", "G"),
  perf(ITEM_B, "129645100001", "BLUSA-AZ", "Blusa", "Azul"),
  perf(ITEM_B, "129645100002", "BLUSA-VD", "Blusa", "Verde"),
];
const ORDER_ALL = [
  venda("P1", "VEST-P", "Vestido", "P", 60),
  venda("P2", "VEST-M", "Vestido", "M", 70),
  venda("P3", "VEST-G", "Vestido", "G", 70),
  venda("P4", "BLUSA-AZ", "Blusa", "Azul", 40),
  venda("P5", "BLUSA-VD", "Blusa", "Verde", 45),
];
const fechar = (costRows) => processShopee(PERFORMANCE, costRows, 0, 0, 0, ORDER_ALL);
{
  const vinculada = fechar(BASE_VINCULADA);
  const upload = fechar(parseShopeeCostSpreadsheet(BASE));
  const antes = fechar(parseSpreadsheet(BASE));
  const por = Object.fromEntries(upload.detailedRows.map((d) => [d["ID do pedido"], d]));
  eq("upload: cada Model com o SEU custo", ["P1", "P2", "P3", "P4", "P5"].map((p) => por[p].CMV), [9, 20, 20, 12.5, 15]);
  ok("upload: Models do mesmo Item com LC/MC diferentes", por.P1.LC !== por.P2.LC && por.P1.MC !== por.P2.MC);
  eq("upload: Model resolvido pela ponte é o exato",
    ["P1", "P2", "P4"].map((p) => por[p]["ID resolvido pela ponte"]), ["239435155271", "239435155272", "129645100001"]);
  eq("upload: 100% de cobertura", upload.summary.calculatedCoveragePercent, 100);
  eq("upload = base vinculada: linhas detalhadas idênticas", upload.detailedRows, vinculada.detailedRows);
  eq("upload = base vinculada: summary idêntico", upload.summary, vinculada.summary);
  eq("upload: sem ID em notação científica no diagnóstico", upload.summary.costBaseDiagnostics.scientificNotationIds, []);
  // Antes da correção (leitor global): nenhuma variação batia.
  eq("antes: 0% pelo upload", antes.summary.calculatedCoveragePercent, 0);
  ok("antes: o motor já diagnosticava os IDs destruídos", antes.summary.costBaseDiagnostics.scientificNotationIds.includes("2.39435E+11"));
}
{
  // CSV com os dígitos perdidos: nada inventado — sem custo + diagnóstico.
  const csv = Buffer.from(`ID,ID Model,Custo,Imposto\n${ITEM_A},2.39435E+11,9,0.11\n`);
  const r = processShopee(PERFORMANCE.slice(0, 1), parseShopeeCostSpreadsheet(csv), 0, 0, 0, ORDER_ALL.slice(0, 1));
  ok("CSV científico: venda sem custo (nunca o custo de outro ID)", r.detailedRows[0].CMV === null);
  ok("CSV científico: diagnóstico explícito COST_BASE_QUALITY",
    (r.summary.executiveNotes || []).some((n) => /COST_BASE_QUALITY/.test(n) && /2\.39435E\+11/.test(n)));
}

console.log("\n▸ Controller real (POST /fechamentos/financeiro, campo costs)");
(async () => {
  require("../services/fechamentoFinanceiro/incidente/fechamentoIncidentStorageService").saveIncidente = async () => null;
  const { processarFechamentoFinanceiroController } = require("../controllers/fechamentosFinanceiroController");
  const planilha = (rows) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "S");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  };
  const arquivo = (buffer, originalname) => [{ buffer, originalname, mimetype: "application/octet-stream" }];
  async function post(files) {
    let out = null;
    const res = { status(c) { this.code = c; return this; }, json(j) { out = { code: this.code || 200, ...j }; return this; } };
    await processarFechamentoFinanceiroController(
      { body: { marketplace: "shopee", ads: "0", venforce: "0", affiliates: "0" }, files, user: { id: 1 } }, res);
    return out;
  }
  const out = await post({
    sales: arquivo(planilha(PERFORMANCE), "parentskudetail.xlsx"),
    ordersAll: arquivo(planilha(ORDER_ALL), "Order.all.xlsx"),
    costs: arquivo(BASE, "Base Shopee.xlsx"),
  });
  ok("resposta ok, custos do upload", out && out.ok === true && out.costsSource === "upload");
  eq("controller: 100% de cobertura pelo upload", out.summary.calculatedCoveragePercent, 100);
  eq("controller: cada venda com o custo do seu Model",
    out.detailedRows.map((d) => [d["ID resolvido pela ponte"], d.CMV]),
    [["239435155271", 9], ["239435155272", 20], ["239435155273", 20], ["129645100001", 12.5], ["129645100002", 15]]);
  eq("controller = motor com a base vinculada", out.summary, fechar(BASE_VINCULADA).summary);

  console.log(`\nfechamentoFinanceiroShopeeCustoUploadPrecisao: ${checks}/${checks} OK`);
})().catch((e) => { console.error(e); process.exit(1); });
