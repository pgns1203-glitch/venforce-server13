// server/tests/fechamentoFinanceiroTikTok.test.js
// Motor de fechamento financeiro do TikTok Shop:
//   A. IDs de 18–19 dígitos preservados como string
//   B. detecção de cabeçalho (Income e Onhold)
//   C. cruzamento EXCLUSIVAMENTE por ID do SKU (Income) × sku_id (base):
//      o mesmo product_id com vários sku_id devolve o custo de cada variação,
//      e nada de título / Nome do SKU / seller_sku / preço / product_id
//      influencia o resultado
//   D. fórmula (CMV, imposto interno, LC, MC) sem cobrança dupla
//   E. resumo (faturamento, repasse, cobertura, resultado final, TACoS)
//   F. Onhold fora do resultado realizado + aba Em_aberto_TikTok
//   G. contrato HTTP de POST /fechamentos/financeiro

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const XLSX = require("xlsx");

const {
  processTikTok,
  parseTikTokIncomeBuffer,
  parseTikTokOnholdBuffer,
  buildTikTokCostMap,
  normalizeTikTokSkuId,
  parseTikTokMoney,
  parseTikTokQuantity,
  quantidadeEhValida,
  buildDuplicateKey,
  isFullyRefundedIncomeRow,
  isPartiallyRefundedIncomeRow,
} = require("../services/fechamentoFinanceiro/tiktokFinanceiroService");
const {
  processFechamentoFinanceiro,
} = require("../services/fechamentoFinanceiro");

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
function throws(label, fn) {
  let lancou = false;
  try {
    fn();
  } catch (_) {
    lancou = true;
  }
  assert.ok(lancou, `FALHOU (deveria lançar): ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const SKU_19 = "1735907463738524810";
const SKU_18 = "173590746373852481";

// Exemplo real do pedido: UM product_id, TRÊS sku_id, custos diferentes.
const PRODUTO_ID = "1736898364814492810";
const SKU_ID_A = "1736898108355347594"; // custo 13,80
const SKU_ID_B = "1736898108355413130"; // custo 13,80
const SKU_ID_C = "1736898108355871882"; // custo  6,90

// Escreve a planilha marcando as colunas de ID como TEXTO (t: "s"), que é
// exatamente como o TikTok exporta quando a coluna está formatada como texto.
function toBuffer(aoa, { sheetName = "Income", textColumns = [] } = {}) {
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  for (let r = 0; r < aoa.length; r++) {
    for (const c of textColumns) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (cell && typeof cell.v === "string") {
        cell.t = "s";
      }
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function multiSheetBuffer(sheets) {
  const workbook = XLSX.utils.book_new();
  for (const { name, aoa } of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

const INCOME_HEADER = [
  "ID do pedido",
  "ID do pagamento",
  "ID do demonstrativo",
  "Data",
  "Status",
  "ID do SKU",
  "Nome do produto",
  "Nome do SKU",
  "Quantidade",
  "Subtotal antes dos descontos",
  "Vendas líquidas dos produtos",
  "Valor total a ser liquidado",
  "Descontos financiados pelo vendedor",
  "Reembolsos",
  "Custo líquido de frete",
  "Comissão da plataforma",
  "Taxas de serviço",
  "Comissões de afiliados",
  "Impostos cobrados pelo TikTok",
  "Ajustes",
];

// Fixture da seção 25.D: bruto 100, líquido 90, repasse 70, qtd 2, custo 10,
// imposto 10% → CMV 20, imposto 9, LC 41, MC 0,41.
function linhaIncome(overrides = {}) {
  const base = {
    pedido: "PED-1",
    pagamento: "PAG-1",
    demonstrativo: "DEM-1",
    data: "2026-07-01",
    status: "Liquidado",
    sku: SKU_19,
    produto: "Furadeira X",
    variacao: "Azul",
    quantidade: 2,
    subtotal: 100,
    liquidas: 90,
    liquidar: 70,
    descontos: -10,
    reembolsos: 0,
    frete: -5,
    comissao: -15,
    servico: -3,
    afiliados: -2,
    impostos: 0,
    ajustes: 0,
  };
  const r = { ...base, ...overrides };
  return [
    r.pedido, r.pagamento, r.demonstrativo, r.data, r.status,
    r.sku, r.produto, r.variacao, r.quantidade,
    r.subtotal, r.liquidas, r.liquidar,
    r.descontos, r.reembolsos, r.frete, r.comissao, r.servico,
    r.afiliados, r.impostos, r.ajustes,
  ];
}

const COL_SKU_INCOME = 5;

function incomeBuffer(linhas, { avisos = [], sheetName = "Income" } = {}) {
  return toBuffer([...avisos, INCOME_HEADER, ...linhas], {
    sheetName,
    textColumns: [COL_SKU_INCOME],
  });
}

const ONHOLD_HEADER = [
  "ID do pedido",
  "ID do SKU",
  "Nome do produto",
  "Nome do SKU",
  "Quantidade",
  "Valor total a ser liquidado",
  "Status",
  "Data",
];

function onholdBuffer(linhas, { avisos = [] } = {}) {
  return toBuffer([...avisos, ONHOLD_HEADER, ...linhas], {
    sheetName: "Onhold",
    textColumns: [1],
  });
}

// Formato devolvido por buildCostRowsFromBase para o TikTok:
//   "ID"        = produto_id (product_id, informativo — pode repetir)
//   "ID do SKU" = sku_id     (chave ÚNICA de cruzamento)
// `skuId` é obrigatório nas fixtures; `id` (produto) é opcional de propósito,
// para provar que o cruzamento não depende dele.
function custosBase(rows) {
  return rows.map((r) => ({
    "ID": r.id != null ? r.id : "",
    "ID do SKU": r.skuId,
    "Custo unitário": r.custo,
    "Imposto (%)": r.imposto,
    "Nome do produto": r.produto || "",
    "Nome da variação": r.variacao || "",
  }));
}

const CUSTOS_PADRAO = custosBase([
  { id: PRODUTO_ID, skuId: SKU_19, custo: 10, imposto: 0.1, produto: "Furadeira X", variacao: "Azul" },
]);

// As três variações do MESMO produto, com os custos do exemplo real.
const CUSTOS_TRES_VARIACOES = custosBase([
  { id: PRODUTO_ID, skuId: SKU_ID_A, custo: 13.8, imposto: 0.06, produto: "Kit Bibi", variacao: "KIT2BIBI" },
  { id: PRODUTO_ID, skuId: SKU_ID_B, custo: 13.8, imposto: 0.06, produto: "Kit Bibi", variacao: "KIT3BIBI" },
  { id: PRODUTO_ID, skuId: SKU_ID_C, custo: 6.9, imposto: 0.06, produto: "Kit Bibi", variacao: "KIT4BIBI" },
]);

// ── A. IDs ──────────────────────────────────────────────────────────────────

console.log("\n▸ A. ID do SKU — string sempre, sem perda de dígitos");
eq("preserva ID de 19 dígitos", normalizeTikTokSkuId(SKU_19), SKU_19);
eq("preserva ID de 18 dígitos", normalizeTikTokSkuId(SKU_18), SKU_18);
eq("remove aspas externas", normalizeTikTokSkuId(`"${SKU_19}"`), SKU_19);
eq("remove BOM", normalizeTikTokSkuId(`﻿${SKU_19}`), SKU_19);
eq("remove .0 seguro", normalizeTikTokSkuId(`${SKU_19}.0`), SKU_19);
eq("não adiciona prefixo MLB", normalizeTikTokSkuId("123456789012345678").startsWith("MLB"), false);
throws("rejeita notação científica", () => normalizeTikTokSkuId("1.7359074637385248E+18"));
throws("rejeita célula numérica insegura", () => normalizeTikTokSkuId(1735907463738524810));
eq("aceita número seguro como string", normalizeTikTokSkuId(12345), "12345");

{
  const buffer = incomeBuffer([linhaIncome()]);
  const { rows } = parseTikTokIncomeBuffer(buffer);
  eq("ID lido da planilha continua string", typeof rows[0].skuId, "string");
  eq("ID lido da planilha mantém 19 dígitos", rows[0].skuId, SKU_19);
  eq("nenhum arredondamento nos últimos dígitos", rows[0].skuId.slice(-4), "4810");
}

console.log("\n▸ A2. Valores monetários");
eq("valor com R$ e vírgula", parseTikTokMoney("R$ 1.234,56"), 1234.56);
eq("valor negativo", parseTikTokMoney("-15,50"), -15.5);
eq("valor entre parênteses vira negativo", parseTikTokMoney("(10,00)"), -10);
eq("célula vazia é ausência (null)", parseTikTokMoney(""), null);
eq("célula sem dígito é ausência (null)", parseTikTokMoney("—"), null);
eq("zero é zero", parseTikTokMoney("0"), 0);

// ── B. Cabeçalhos ───────────────────────────────────────────────────────────

console.log("\n▸ B. Detecção de cabeçalho");
{
  const { rows, header } = parseTikTokIncomeBuffer(incomeBuffer([linhaIncome()]));
  eq("Income com cabeçalho na primeira linha", header.rowIndex, 0);
  eq("uma linha de dados lida", rows.length, 1);
  eq("alias de quantidade", rows[0].quantity, 2);
  eq("repasse reconhecido", rows[0].settlementLine, 70);
  eq("vendas líquidas reconhecidas", rows[0].netProductSalesLine, 90);
  eq("subtotal reconhecido", rows[0].grossRevenueLine, 100);
  eq("produto reconhecido", rows[0].productName, "Furadeira X");
  eq("variação reconhecida", rows[0].variationName, "Azul");
  eq("comissão da plataforma normalizada como negativa", rows[0].platformCommission, -15);
  eq("taxas de serviço normalizadas", rows[0].serviceFees, -3);
  eq("afiliados normalizados", rows[0].affiliateCommission, -2);
  eq("frete normalizado", rows[0].netShippingCost, -5);
}
{
  const avisos = [
    ["Relatório de receitas — TikTok Shop"],
    ["Período: 01/07/2026 a 31/07/2026"],
    [],
  ];
  const { rows, header } = parseTikTokIncomeBuffer(incomeBuffer([linhaIncome()], { avisos }));
  eq("Income com linhas de aviso antes do cabeçalho", header.rowIndex, 3);
  eq("linha de dados lida após avisos", rows[0].skuId, SKU_19);
}
{
  // Aliases alternativos + sinais positivos nas deduções.
  const aoa = [
    ["SKU ID", "Qtd", "Subtotal antes dos descontos", "Valor total a ser liquidado", "Comissão da plataforma"],
    [SKU_19, 1, "R$ 50,00", "R$ 40,00", "5,00"],
  ];
  const buffer = toBuffer(aoa, { textColumns: [0] });
  const { rows } = parseTikTokIncomeBuffer(buffer);
  eq("alias 'SKU ID' reconhecido", rows[0].skuId, SKU_19);
  eq("alias 'Qtd' reconhecido", rows[0].quantity, 1);
  eq("dedução positiva na planilha vira negativa", rows[0].platformCommission, -5);
  eq("valor original preservado para auditoria", rows[0].platformCommissionOriginal, 5);
}
{
  // Múltiplas abas: a aba com cabeçalho financeiro vence, não o índice 0.
  const buffer = multiSheetBuffer([
    { name: "Instruções", aoa: [["Leia antes de usar"], ["Contate o suporte"]] },
    { name: "Dados", aoa: [INCOME_HEADER, linhaIncome()] },
  ]);
  const { rows, sheetName } = parseTikTokIncomeBuffer(buffer);
  eq("escolhe a aba com cabeçalho reconhecível", sheetName, "Dados");
  eq("lê os dados da aba correta", rows.length, 1);
}
{
  const buffer = onholdBuffer(
    [["PED-9", SKU_18, "Serra Y", "Verde", 3, 120, "Em processamento", "2026-07-20"]],
    { avisos: [["Pedidos com valores em aberto"], []] }
  );
  const { rows, header } = parseTikTokOnholdBuffer(buffer);
  eq("Onhold com avisos antes do cabeçalho", header.rowIndex, 2);
  eq("Onhold lê o ID do SKU", rows[0].skuId, SKU_18);
  eq("Onhold lê o valor em aberto", rows[0].openAmount, 120);
  eq("Onhold lê a quantidade", rows[0].quantity, 3);
}

// ── C. Cruzamento ───────────────────────────────────────────────────────────

console.log("\n▸ C. Cruzamento SÓ por ID do SKU (sku_id) — sem nenhum fallback");
{
  const { map } = buildTikTokCostMap(CUSTOS_PADRAO);
  eq("mapa de custos indexado por sku_id", map.get(SKU_19).cost, 10);
  eq("mapa NÃO cria entrada pelo product_id", map.has(PRODUTO_ID), false);
  eq("mapa NÃO cria entrada por nome do produto", map.has("Furadeira X"), false);
  eq("mapa NÃO cria entrada por Nome do SKU", map.has("Azul"), false);
  eq("um sku_id, uma entrada", map.size, 1);
}
{
  // sku_id que não existe na base: sem custo, mesmo com título/variação iguais.
  const result = processTikTok({
    salesBuffer: incomeBuffer([linhaIncome({ sku: SKU_18 })]),
    costRowsRaw: CUSTOS_PADRAO,
    ads: 0,
    venforce: 0,
  });
  eq("nome igual não gera cruzamento", result.detailedRows[0].status_calculo, "sem_custo");
  eq("custo ausente não vira zero", result.detailedRows[0].custo_unitario, null);
  eq("LC não é calculado sem custo", result.detailedRows[0].lc, null);
  eq("ID do SKU entra em unmatchedIds", result.unmatchedIds[0], SKU_18);
  eq(
    "unmatchedSkuKeys expõe o próprio ID DO SKU que faltou",
    result.unmatchedSkuKeys.some((u) => u.id_sku === SKU_18),
    true
  );
  ok(
    "auditoria diz que o ID do SKU não está na base",
    result.auditRows.some((a) => a.motivo.includes(SKU_18) && /não encontrado na Base TikTok/.test(a.motivo))
  );
}
{
  // ── §11 do pedido: mesmo product_id, três sku_id, custos diferentes ──
  const { map } = buildTikTokCostMap(CUSTOS_TRES_VARIACOES);
  eq("mesmo product_id com 3 sku_id gera 3 entradas", map.size, 3);
  eq("entrada da variação A", map.get(SKU_ID_A).cost, 13.8);
  eq("entrada da variação B", map.get(SKU_ID_B).cost, 13.8);
  eq("entrada da variação C", map.get(SKU_ID_C).cost, 6.9);
  eq("product_id não vira chave", map.has(PRODUTO_ID), false);

  // Income com títulos, seller SKU e preços IDÊNTICOS — só o sku_id difere.
  const comumIncome = { produto: "Kit Bibi", variacao: "KIT2BIBI", quantidade: 1, subtotal: 100, liquidas: 100, liquidar: 90 };

  const rA = processTikTok({
    salesBuffer: incomeBuffer([linhaIncome({ ...comumIncome, sku: SKU_ID_A })]),
    costRowsRaw: CUSTOS_TRES_VARIACOES, ads: 0, venforce: 0,
  });
  eq("sku_id A → custo 13,80", rA.detailedRows[0].custo_unitario, 13.8);
  eq("sku_id A calcula normalmente", rA.detailedRows[0].status_calculo, "calculado");

  const rC = processTikTok({
    salesBuffer: incomeBuffer([linhaIncome({ ...comumIncome, sku: SKU_ID_C })]),
    costRowsRaw: CUSTOS_TRES_VARIACOES, ads: 0, venforce: 0,
  });
  eq("sku_id C → custo 6,90", rC.detailedRows[0].custo_unitario, 6.9);
  ok("sku_id C não herda o custo da variação A", rC.detailedRows[0].custo_unitario !== 13.8);
  eq("CMV usa o custo da própria variação", rC.detailedRows[0].cmv, 6.9);

  // Título igual, seller SKU igual, preço igual: nada disso muda o custo.
  eq("título idêntico não altera o custo", rA.detailedRows[0].produto, rC.detailedRows[0].produto);
  eq("Nome do SKU idêntico não altera o custo", rA.detailedRows[0].sku, rC.detailedRows[0].sku);
  eq("preço de venda idêntico não altera o custo", rA.detailedRows[0].subtotal_antes_descontos, rC.detailedRows[0].subtotal_antes_descontos);
  ok("mesmo assim os custos são diferentes", rA.detailedRows[0].custo_unitario !== rC.detailedRows[0].custo_unitario);

  // As três na mesma planilha, cada uma com o seu custo.
  const rTodas = processTikTok({
    salesBuffer: incomeBuffer([
      linhaIncome({ ...comumIncome, pedido: "P-A", sku: SKU_ID_A }),
      linhaIncome({ ...comumIncome, pedido: "P-B", sku: SKU_ID_B }),
      linhaIncome({ ...comumIncome, pedido: "P-C", sku: SKU_ID_C }),
    ]),
    costRowsRaw: CUSTOS_TRES_VARIACOES, ads: 0, venforce: 0,
  });
  eq("três linhas calculadas", rTodas.summary.contributionProfitRowsCount, 3);
  eq("CMV total = 13,80 + 13,80 + 6,90", rTodas.summary.cmvTotal, 34.5);
  eq("cobertura total da base", rTodas.summary.calculatedCoveragePercent, 100);

  // sku_id inexistente do MESMO produto: não cai para nenhuma variação irmã.
  const rInexistente = processTikTok({
    salesBuffer: incomeBuffer([linhaIncome({ ...comumIncome, sku: "1736898108355999999" })]),
    costRowsRaw: CUSTOS_TRES_VARIACOES, ads: 0, venforce: 0,
  });
  eq("sku_id inexistente fica sem_custo", rInexistente.detailedRows[0].status_calculo, "sem_custo");
  eq("sku_id inexistente não herda custo de variação irmã", rInexistente.detailedRows[0].custo_unitario, null);
  eq("sku_id inexistente NÃO vira custo zero", rInexistente.detailedRows[0].cmv, null);
  eq(
    "pendência registra o ID DO SKU exato que faltou",
    rInexistente.unmatchedSkuKeys.some((u) => u.id_sku === "1736898108355999999"),
    true
  );
  eq("faturamento preservado mesmo sem custo", rInexistente.summary.grossRevenueTotal, 100);
}
{
  // §12: imposto vem da MESMA linha da base encontrada pelo sku_id.
  const custosImpostosDiferentes = custosBase([
    { id: PRODUTO_ID, skuId: SKU_ID_A, custo: 13.8, imposto: 0.06 },
    { id: PRODUTO_ID, skuId: SKU_ID_C, custo: 6.9, imposto: 0.04 },
  ]);
  const linhaBaseComum = { quantidade: 1, subtotal: 100, liquidas: 100, liquidar: 90 };

  const rA = processTikTok({
    salesBuffer: incomeBuffer([linhaIncome({ ...linhaBaseComum, sku: SKU_ID_A })]),
    costRowsRaw: custosImpostosDiferentes, ads: 0, venforce: 0,
  });
  eq("variação A usa imposto 6%", rA.detailedRows[0].imposto_percentual, 6);
  eq("valor do imposto da variação A", rA.detailedRows[0].imposto_valor, 6);

  const rC = processTikTok({
    salesBuffer: incomeBuffer([linhaIncome({ ...linhaBaseComum, sku: SKU_ID_C })]),
    costRowsRaw: custosImpostosDiferentes, ads: 0, venforce: 0,
  });
  eq("variação C usa imposto 4%", rC.detailedRows[0].imposto_percentual, 4);
  eq("valor do imposto da variação C", rC.detailedRows[0].imposto_valor, 4);
  ok("cada variação usa a própria alíquota", rA.detailedRows[0].imposto_valor !== rC.detailedRows[0].imposto_valor);
}
{
  // §7: o fechamento funciona sem SKU textual em lado nenhum.
  const custosSemNomes = custosBase([{ id: PRODUTO_ID, skuId: SKU_19, custo: 10, imposto: 0.1 }]);
  const result = processTikTok({
    salesBuffer: incomeBuffer([linhaIncome({ produto: "", variacao: "" })]),
    costRowsRaw: custosSemNomes,
    ads: 0, venforce: 0,
  });
  const row = result.detailedRows[0];
  eq("cruza sem Nome do SKU no Income e sem nomes na base", row.status_calculo, "calculado");
  eq("CMV calculado normalmente", row.cmv, 20);
  eq("LC calculado normalmente", row.lc, 41);
  eq("confiança confiável", result.summary.financialConfidence, "confiavel");
}
{
  // A base sem a coluna "ID" (product_id) continua cruzando: só sku_id importa.
  const custosSemProdutoId = custosBase([{ skuId: SKU_19, custo: 10, imposto: 0.1 }]);
  const result = processTikTok({
    salesBuffer: incomeBuffer([linhaIncome()]),
    costRowsRaw: custosSemProdutoId,
    ads: 0, venforce: 0,
  });
  eq("base sem product_id ainda resolve o custo", result.detailedRows[0].custo_unitario, 10);
  eq("e calcula o LC", result.detailedRows[0].lc, 41);
}
{
  // product_id da base NUNCA é usado como chave: um Income cujo "ID do SKU"
  // por acaso é igual ao product_id não pode achar custo.
  const result = processTikTok({
    salesBuffer: incomeBuffer([linhaIncome({ sku: PRODUTO_ID })]),
    costRowsRaw: CUSTOS_TRES_VARIACOES,
    ads: 0, venforce: 0,
  });
  eq("product_id não resolve custo", result.detailedRows[0].status_calculo, "sem_custo");
  eq("nenhum custo atribuído pelo product_id", result.detailedRows[0].custo_unitario, null);
}
{
  // Duas vendas do mesmo SKU continuam duas linhas financeiras.
  const result = processTikTok({
    salesBuffer: incomeBuffer([
      linhaIncome({ pedido: "PED-1" }),
      linhaIncome({ pedido: "PED-2" }),
    ]),
    costRowsRaw: CUSTOS_PADRAO,
    ads: 0,
    venforce: 0,
  });
  eq("duas vendas do mesmo SKU = duas linhas", result.detailedRows.length, 2);
  eq("faturamento soma as duas linhas", result.summary.grossRevenueTotal, 200);
  eq("LC soma as duas linhas", result.summary.contributionProfitTotal, 82);
}

// ── D. Fórmula ──────────────────────────────────────────────────────────────

console.log("\n▸ D. Fórmula (CMV, imposto, LC, MC)");
const base = processTikTok({
  salesBuffer: incomeBuffer([linhaIncome()]),
  costRowsRaw: CUSTOS_PADRAO,
  ads: 0,
  venforce: 0,
});
{
  const row = base.detailedRows[0];
  eq("CMV = quantidade × custo", row.cmv, 20);
  eq("imposto interno = vendas líquidas × alíquota", row.imposto_valor, 9);
  eq("LC = repasse − CMV − imposto", row.lc, 41);
  eq("MC = LC / faturamento bruto da linha", row.mc, 0.41);
  eq("status calculado", row.status_calculo, "calculado");
  eq("id_sku exposto como string", typeof row.id_sku, "string");
  eq("comissão aparece no detalhamento", row.comissao_plataforma, -15);
}
{
  // Cobrança dupla: LC não pode descontar comissão/frete/afiliados de novo.
  const semComponentes = processTikTok({
    salesBuffer: incomeBuffer([
      linhaIncome({ comissao: 0, servico: 0, afiliados: 0, frete: 0 }),
    ]),
    costRowsRaw: CUSTOS_PADRAO,
    ads: 0,
    venforce: 0,
  });
  eq(
    "LC idêntico com e sem componentes preenchidos (sem cobrança dupla)",
    semComponentes.summary.contributionProfitTotal,
    base.summary.contributionProfitTotal
  );
  eq(
    "afiliados do relatório não deduzidos do resultado final",
    semComponentes.summary.finalResult,
    base.summary.finalResult
  );
}
{
  // Alíquota gravada como 10 (pontos percentuais) tem o mesmo efeito de 0.1.
  const comPercentual = processTikTok({
    salesBuffer: incomeBuffer([linhaIncome()]),
    costRowsRaw: custosBase([{ id: PRODUTO_ID, skuId: SKU_19, custo: 10, imposto: 10 }]),
    ads: 0,
    venforce: 0,
  });
  eq("imposto 10 e 0.1 produzem o mesmo valor", comPercentual.detailedRows[0].imposto_valor, 9);
  eq("nenhuma dupla conversão de percentual", comPercentual.summary.taxValueTotal, 9);
}
{
  const semFaturamento = processTikTok({
    salesBuffer: incomeBuffer([linhaIncome({ subtotal: 0, liquidas: 0, liquidar: 0 })]),
    costRowsRaw: CUSTOS_PADRAO,
    ads: 100,
    venforce: 0,
  });
  eq("MC da linha é null quando o faturamento é zero", semFaturamento.detailedRows[0].mc, null);
  eq("TACoS é null quando não há faturamento", semFaturamento.summary.tacos, null);
  ok(
    "nenhum NaN/Infinity no resumo",
    Object.values(semFaturamento.summary).every(
      (v) => typeof v !== "number" || Number.isFinite(v)
    )
  );
}

// ── E. Resumo ───────────────────────────────────────────────────────────────

console.log("\n▸ E. Resumo do fechamento");
const misto = processTikTok({
  salesBuffer: incomeBuffer([
    linhaIncome(),                                        // com custo, liquidado
    linhaIncome({ pedido: "PED-2", sku: SKU_18, subtotal: 50, liquidas: 45, liquidar: 30 }), // sem custo
    linhaIncome({ pedido: "PED-3", subtotal: 40, liquidas: 36, liquidar: "" }),              // sem repasse
  ]),
  costRowsRaw: CUSTOS_PADRAO,
  ads: 10,
  venforce: 5,
});
{
  const s = misto.summary;
  eq("modo de cálculo", s.calculationMode, "real_tiktok_income");
  eq("faturamento total preserva linhas sem custo", s.grossRevenueTotal, 190);
  eq("repasse total soma só o que foi liquidado", s.paidRevenueTotal, 100);
  eq("receita com custo", s.revenueWithCost, 140);
  eq("receita sem custo", s.revenueWithoutCost, 50);
  eq("cobertura da base (%)", s.calculatedCoveragePercent, 73.68);
  eq("LC total só das linhas calculáveis", s.contributionProfitTotal, 41);
  eq("resultado final = LC − ads − venforce", s.finalResult, 26);
  eq("afiliados sempre zero no TikTok", s.affiliates, 0);
  eq("TACoS = ads / faturamento", Number(s.tacos.toFixed(6)), Number((10 / 190).toFixed(6)));
  eq("TACoX = (ads + venforce) / faturamento", Number(s.tacox.toFixed(6)), Number((15 / 190).toFixed(6)));
  eq("confiança parcial", s.financialConfidence, "parcial");
  eq("linha sem repasse contada como pendente", s.salesPendingFinancialIncomeCount, 1);
  eq("faturamento pendente (Income)", s.revenuePendingFinancialIncome, 40);
  eq("receita sem custo também em ignoredRevenue", misto.ignoredRevenue, 50);
  eq("linha sem repasse tem status próprio", misto.detailedRows[2].status_calculo, "financeiro_pendente");
  eq("componentes do relatório somados", s.platformCommissionTotal, -45);
}
{
  const confiavel = processTikTok({
    salesBuffer: incomeBuffer([linhaIncome()]),
    costRowsRaw: CUSTOS_PADRAO,
    ads: 0,
    venforce: 0,
  });
  eq("confiança confiável quando tudo cruza", confiavel.summary.financialConfidence, "confiavel");

  const insuficiente = processTikTok({
    salesBuffer: incomeBuffer([linhaIncome({ sku: SKU_18 })]),
    costRowsRaw: CUSTOS_PADRAO,
    ads: 0,
    venforce: 0,
  });
  eq("confiança insuficiente sem nenhuma linha calculável", insuficiente.summary.financialConfidence, "insuficiente");
}

// ── F. Onhold ───────────────────────────────────────────────────────────────

console.log("\n▸ F. Onhold — pendência, nunca resultado realizado");
const comOnhold = processTikTok({
  salesBuffer: incomeBuffer([linhaIncome()]),
  onholdBuffer: onholdBuffer([
    ["PED-9", SKU_19, "Furadeira X", "Azul", 1, 55, "Em processamento", "2026-07-25"],
    ["PED-10", SKU_18, "Serra Y", "Verde", 2, 80, "Aguardando envio", "2026-07-26"],
  ]),
  costRowsRaw: CUSTOS_PADRAO,
  ads: 0,
  venforce: 0,
});
{
  const s = comOnhold.summary;
  eq("Onhold contado", s.onholdCount, 2);
  eq("valor em aberto somado à parte", s.onholdRevenueTotal, 135);
  eq("SKUs únicos em aberto", s.onholdUniqueSkuCount, 2);
  eq("Onhold com custo na base", s.onholdWithCostCount, 1);
  eq("Onhold sem custo na base", s.onholdWithoutCostCount, 1);
  eq("Onhold não entra no faturamento realizado", s.grossRevenueTotal, base.summary.grossRevenueTotal);
  eq("Onhold não entra no repasse", s.paidRevenueTotal, base.summary.paidRevenueTotal);
  eq("Onhold não entra no LC", s.contributionProfitTotal, base.summary.contributionProfitTotal);
  eq("Onhold não entra no resultado final", s.finalResult, base.summary.finalResult);
  eq("Onhold alimenta o pendente total", s.revenuePendingFinancial, 135);
  eq("linhas pendentes expostas", comOnhold.pendingRows.length, 2);
  eq("origem preservada nas linhas do Income", comOnhold.detailedRows[0].origem, "Income");
  eq("origem preservada nas linhas em aberto", comOnhold.pendingRows[0].origem, "Onhold");
  eq("Onhold com custo é o do sku_id cadastrado", comOnhold.pendingRows[0].custo_na_base, "sim");
  eq("Onhold sem sku_id na base acusa falta", comOnhold.pendingRows[1].custo_na_base, "não");
}
{
  // §12: o Onhold usa a MESMA identidade (sku_id) do Income — e continua
  // fora do resultado realizado (semântica contábil inalterada).
  const r = processTikTok({
    salesBuffer: incomeBuffer([linhaIncome()]),
    onholdBuffer: onholdBuffer([
      ["PED-A", SKU_ID_A, "Kit Bibi", "KIT2BIBI", 1, 40, "Em processamento", "2026-07-25"],
      ["PED-C", SKU_ID_C, "Kit Bibi", "KIT4BIBI", 1, 20, "Em processamento", "2026-07-25"],
      ["PED-X", "1736898108355999999", "Kit Bibi", "KIT9BIBI", 1, 10, "Em processamento", "2026-07-25"],
    ]),
    costRowsRaw: CUSTOS_TRES_VARIACOES,
    ads: 0, venforce: 0,
  });
  eq("Onhold resolve custo por sku_id (2 de 3)", r.summary.onholdWithCostCount, 2);
  eq("Onhold sem sku_id na base fica sem custo", r.summary.onholdWithoutCostCount, 1);
  eq("Onhold não entra no LC", r.summary.contributionProfitTotal, 0);
  eq("Onhold não entra no faturamento realizado", r.summary.grossRevenueTotal, 100);
  eq("Onhold só soma valor em aberto", r.summary.onholdRevenueTotal, 70);
  eq("Onhold não altera o resultado final", r.summary.finalResult, 0);
  eq("linhas do Onhold têm status em_aberto", r.pendingRows[0].status_calculo, "em_aberto");
  eq("ID DO SKU preservado no Onhold", r.pendingRows[0].id_sku, SKU_ID_A);
}
{
  // §16.15: TikTok nunca recebe prefixo MLB em nenhum ID, nem na base.
  const r = processTikTok({
    salesBuffer: incomeBuffer([linhaIncome({ sku: SKU_ID_A, quantidade: 1, subtotal: 100, liquidas: 100, liquidar: 90 })]),
    costRowsRaw: CUSTOS_TRES_VARIACOES,
    ads: 0, venforce: 0,
  });
  const serializado = JSON.stringify(r);
  ok("nenhum MLB aparece no resultado TikTok", !/MLB/.test(serializado));
  eq("id_sku sai como string exata", r.detailedRows[0].id_sku, SKU_ID_A);
  eq("id_sku mantém 19 dígitos", r.detailedRows[0].id_sku.length, 19);
}

// ── G. Contrato HTTP ────────────────────────────────────────────────────────

console.log("\n▸ G. Contrato do POST /fechamentos/financeiro");

// A base vinculada é resolvida no banco; o stub precisa entrar ANTES do
// controller ser carregado (ele desestrutura o export no require).
const baseCustosService = require("../services/bases/baseCustosService");
// Guardado antes do stub: a seção I testa a implementação REAL (com pool duplo).
const buildCostRowsFromBaseReal = baseCustosService.buildCostRowsFromBase;
baseCustosService.buildCostRowsFromBase = async ({ marketplace }) => ({
  base: { id: 7, slug: "cliente-teste", nome: "Base TikTok Teste" },
  costRows: marketplace === "tiktok" ? CUSTOS_PADRAO : [],
});

const {
  processarFechamentoFinanceiroController,
  buildFechamentoContextRows,
} = require("../controllers/fechamentosFinanceiroController");

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

async function runTikTokController({ files = {}, body = {} } = {}) {
  const req = {
    files,
    body: {
      marketplace: "tiktok",
      cliente_slug: "cliente-teste",
      costsBaseId: "7",
      ads: "10",
      venforce: "5",
      affiliates: "0",
      ...body,
    },
  };
  const res = fakeRes();
  await processarFechamentoFinanceiroController(req, res);
  return res;
}

async function main() {
{
  const res = await runTikTokController({
    files: {
      sales: [{ buffer: incomeBuffer([linhaIncome()]) }],
      onhold: [{ buffer: onholdBuffer([["PED-9", SKU_19, "Furadeira X", "Azul", 1, 55, "Em processamento", "2026-07-25"]]) }],
    },
  });

  eq("HTTP 200", res.statusCode, 200);
  const body = res.body;
  ok("ok = true", body.ok === true);

  for (const campo of [
    "summary", "detailedRows", "excelBase64", "unmatchedIds", "unmatchedCancelled",
    "ignoredRowsWithoutCost", "ignoredRevenue", "message", "costsSource", "costsBase",
  ]) {
    ok(`contrato preserva "${campo}"`, Object.prototype.hasOwnProperty.call(body, campo));
  }
  ok("campo novo pendingRows presente", Array.isArray(body.pendingRows));
  ok("campo novo onholdSummary presente", !!body.onholdSummary);
  eq("custos vieram da base vinculada", body.costsSource, "base");
  eq("base identificada na resposta", body.costsBase.nome, "Base TikTok Teste");
  eq("não exigiu upload de custos", body.summary.calculationMode, "real_tiktok_income");

  const workbook = XLSX.read(Buffer.from(body.excelBase64, "base64"), { type: "buffer" });
  ok("aba Painel gerada", workbook.SheetNames.includes("Painel"));
  ok("aba Detalhamento gerada", workbook.SheetNames.includes("Detalhamento"));
  ok("aba Fechamento gerada", workbook.SheetNames.includes("Fechamento"));
  ok("aba Em_aberto_TikTok gerada com Onhold", workbook.SheetNames.includes("Em_aberto_TikTok"));

  const detalhe = XLSX.utils.sheet_to_json(workbook.Sheets["Detalhamento"]);
  eq("ID do SKU escrito por extenso no Excel", String(detalhe[0]["id_sku"]), SKU_19);

  const fechamento = XLSX.utils.sheet_to_json(workbook.Sheets["Fechamento"]);
  const itens = fechamento.map((r) => String(r.Item));
  for (const item of [
    "Marketplace",
    "Repasse total (valor liquidado)",
    "Componente TikTok: comissão da plataforma",
    "Componente TikTok: taxas de serviço",
    "Componente TikTok: frete líquido",
    "Componente TikTok: comissões de afiliados (relatório)",
    "Componente TikTok: reembolsos",
    "Componente TikTok: ajustes",
    "Linhas em aberto (Onhold)",
  ]) {
    ok(`aba Fechamento traz "${item}"`, itens.includes(item));
  }

  const valores = JSON.stringify(body);
  ok("resposta sem NaN", !/\bNaN\b/.test(valores));
  ok("resposta sem Infinity", !/Infinity/.test(valores));
}
{
  const res = await runTikTokController({
    files: { sales: [{ buffer: incomeBuffer([linhaIncome()]) }] },
  });
  const workbook = XLSX.read(Buffer.from(res.body.excelBase64, "base64"), { type: "buffer" });
  ok("sem Onhold não cria aba Em_aberto_TikTok", !workbook.SheetNames.includes("Em_aberto_TikTok"));
}
{
  // 13. Sem costsBaseId (mesmo com cliente informado), a seleção manual é
  // obrigatória — mensagem exata pedida.
  const res = await runTikTokController({
    files: { sales: [{ buffer: incomeBuffer([linhaIncome()]) }] },
    body: { costsBaseId: "" },
  });
  eq("sem Base TikTok selecionada, o fechamento é recusado", res.statusCode, 400);
  eq(
    "mensagem exata pede seleção manual da base",
    res.body.error,
    "Selecione uma Base TikTok antes de processar o fechamento."
  );
}
{
  // 15. Cliente vazio + Base TikTok selecionada: processa normalmente — a
  // base não precisa estar vinculada ao cliente.
  const res = await runTikTokController({
    files: { sales: [{ buffer: incomeBuffer([linhaIncome()]) }] },
    body: { cliente_slug: "", costsBaseId: "7" },
  });
  eq("cliente vazio não bloqueia o fechamento TikTok", res.statusCode, 200);
  ok("processa normalmente sem cliente", res.body.ok === true);
}
{
  const rows = buildFechamentoContextRows({ calculationMode: "real_meli_vendas" }, "meli");
  const itens = rows.map((r) => String(r.Item));
  ok("aba Fechamento do MELI não recebe itens do TikTok", !itens.some((i) => i.includes("TikTok")));
}
{
  const res = await runTikTokController({
    files: {
      sales: [{
        buffer: toBuffer(
          [["ID do SKU", "Quantidade", "Subtotal antes dos descontos", "Valor total a ser liquidado"],
           ["1.7359074637385248E+18", 1, 100, 70]],
          { textColumns: [0] }
        ),
      }],
    },
  });
  eq("ID em notação científica é recusado", res.statusCode, 422);
  ok("mensagem pede coluna como Texto", /Texto/.test(res.body.error));
}

// ── Orquestrador ────────────────────────────────────────────────────────────

console.log("\n▸ H. Orquestrador");
{
  const result = processFechamentoFinanceiro({
    marketplace: "tiktok",
    salesBufferRaw: incomeBuffer([linhaIncome()]),
    costRowsRaw: CUSTOS_PADRAO,
    ads: 0,
    venforce: 0,
    affiliates: 999, // ignorado no TikTok: já está no repasse
  });
  eq("orquestrador roteia TikTok", result.summary.calculationMode, "real_tiktok_income");
  eq("afiliados enviados não afetam o resultado", result.summary.finalResult, 41);
}
{
  let mensagem = "";
  try {
    processFechamentoFinanceiro({ marketplace: "amazon" });
  } catch (error) {
    mensagem = error.message;
  }
  ok("mensagem de marketplace inválido cita TikTok", /tiktok/i.test(mensagem));
}

  await testesPrePush();

  console.log(`\n✓ fechamentoFinanceiroTikTok: ${checks} verificações OK\n`);
}

// ═══════════════════════════════════════════════════════════════════════════
// AJUSTES PRÉ-PUSH — bloqueadores da auditoria
//   I.  base vinculada estrita (cliente + marketplace + vínculo ativo)
//   J.  quantidade válida = inteiro positivo (nunca vira 1)
//   K.  margem usa só a receita das linhas com LC calculado
//   L.  salvar/publicar bloqueados no TikTok (MELI/Shopee intactos)
//   M.  possíveis duplicidades sinalizadas, nunca removidas
// ═══════════════════════════════════════════════════════════════════════════

const {
  vinculoBaseEhValido,
  resolverBaseVinculadaEstrita,
  resolverBaseTikTokPorId,
  exigeVinculoEstrito,
} = baseCustosService;
const buildCostRowsFromBase = buildCostRowsFromBaseReal;

// Candidato = uma linha do JOIN bases × base_cliente_vinculos × clientes.
function candidato(over = {}) {
  return {
    id: 7,
    slug: "base-tiktok",
    nome: "Base TikTok Teste",
    base_ativa: true,
    base_marketplace: "tiktok",
    vinculo_ativo: true,
    vinculo_marketplace: "tiktok",
    cliente_slug: "cliente-teste",
    ...over,
  };
}
const PEDIDO_TIKTOK = { clienteSlug: "cliente-teste", marketplace: "tiktok", baseId: 7 };

async function testesPrePush() {
  // ── I. Base vinculada ───────────────────────────────────────────────────
  // NOTA: a Base TikTok passou a ser escolhida MANUALMENTE em /financeiro
  // (sem vínculo com cliente — ver §6 do pedido). O mecanismo de vínculo
  // estrito abaixo (vinculoBaseEhValido/resolverBaseVinculadaEstrita) continua
  // existindo e correto como função pura, mas buildCostRowsFromBase NÃO o usa
  // mais para TikTok — ver resolverBaseTikTokPorId logo depois.
  console.log("\n▸ I. Base TikTok — vínculo estrito (mecanismo legado, não usado pelo TikTok)");
  eq("TikTok exige vínculo estrito", exigeVinculoEstrito("tiktok"), true);
  eq("MELI mantém a resolução histórica", exigeVinculoEstrito("meli"), false);
  eq("Shopee mantém a resolução histórica", exigeVinculoEstrito("shopee"), false);

  ok("base TikTok vinculada ao cliente correto é aceita", vinculoBaseEhValido(candidato(), PEDIDO_TIKTOK));
  ok(
    "base de outro cliente é rejeitada",
    !vinculoBaseEhValido(candidato({ cliente_slug: "outro-cliente" }), PEDIDO_TIKTOK)
  );
  ok(
    "base MELI enviada como TikTok é rejeitada",
    !vinculoBaseEhValido(candidato({ base_marketplace: "meli" }), PEDIDO_TIKTOK)
  );
  ok(
    "vínculo inativo é rejeitado",
    !vinculoBaseEhValido(candidato({ vinculo_ativo: false }), PEDIDO_TIKTOK)
  );
  ok(
    "vínculo de outro marketplace é rejeitado",
    !vinculoBaseEhValido(candidato({ vinculo_marketplace: "meli" }), PEDIDO_TIKTOK)
  );
  ok(
    "base inativa é rejeitada",
    !vinculoBaseEhValido(candidato({ base_ativa: false }), PEDIDO_TIKTOK)
  );
  ok(
    "baseId de outra base é rejeitado (sem fallback)",
    !vinculoBaseEhValido(candidato({ id: 99 }), PEDIDO_TIKTOK)
  );
  ok(
    "base legado sem marketplace é decidida pelo vínculo",
    vinculoBaseEhValido(candidato({ base_marketplace: null }), PEDIDO_TIKTOK)
  );
  ok(
    "sem cliente informado nada é aceito",
    !vinculoBaseEhValido(candidato(), { clienteSlug: "", marketplace: "tiktok", baseId: 7 })
  );

  // Integração com o SQL do mecanismo legado (candidatosDoBanco = vínculo).
  const pool = require("../config/database");
  const queryOriginal = pool.query;
  let candidatosDoBanco = [];
  let basesDoBanco = [];
  // O duplo respeita os MESMOS filtros do SQL ($1 = slug do cliente,
  // $2 = base id opcional) — senão o teste não distingue 404 de 422.
  pool.query = async (sql, params = []) => {
    const texto = String(sql);
    if (texto.includes("base_cliente_vinculos")) {
      const [slug, id] = params;
      return {
        rows: candidatosDoBanco.filter(
          (c) =>
            String(c.cliente_slug).toLowerCase() === String(slug).toLowerCase() &&
            (id === null || id === undefined || Number(c.id) === Number(id))
        ),
      };
    }
    // Resolução manual da Base TikTok (resolverBaseTikTokPorId): SELECT
    // direto por id, sem cliente/vínculo envolvido.
    if (/FROM bases WHERE id = \$1/.test(texto)) {
      const [id] = params;
      return { rows: basesDoBanco.filter((b) => Number(b.id) === Number(id)) };
    }
    if (texto.includes("FROM custos")) {
      return {
        rows: [{
          produto_id: PRODUTO_ID, sku_id: SKU_19, sku: "", custo_produto: 10,
          imposto_percentual: 0.1, id_model: null, produto_nome: "Furadeira X",
          variacao_nome: "",
        }],
      };
    }
    return { rows: [] };
  };

  try {
    candidatosDoBanco = [candidato()];
    const base = await resolverBaseVinculadaEstrita({ baseId: 7, clienteSlug: "cliente-teste", marketplace: "tiktok" });
    eq("resolve a base quando o vínculo prova a posse (mecanismo legado)", base.id, 7);

    candidatosDoBanco = [candidato({ cliente_slug: "outro-cliente" })];
    let erro = null;
    try {
      await resolverBaseVinculadaEstrita({ baseId: 7, clienteSlug: "cliente-teste", marketplace: "tiktok" });
    } catch (e) { erro = e; }
    ok("base de outro cliente não resolve (mecanismo legado)", !!erro);
    eq("recusa por cliente errado responde 404", erro.statusCode, 404);
  } finally {
    pool.query = queryOriginal;
  }

  // ── I-bis. Base TikTok — seleção manual (contrato atual) ────────────────
  // A Base TikTok não exige mais vínculo com cliente: o usuário escolhe a
  // base manualmente em /financeiro (select "Base de custos TikTok"). O
  // backend só confirma que a base existe, está ativa e é do TikTok.
  console.log("\n▸ I-bis. Base TikTok — seleção manual (sem vínculo com cliente)");
  const queriesDoBanco = [];
  pool.query = async (sql, params = []) => {
    const texto = String(sql);
    queriesDoBanco.push(texto);
    if (/FROM bases WHERE id = \$1/.test(texto)) {
      const [id] = params;
      return { rows: basesDoBanco.filter((b) => Number(b.id) === Number(id)) };
    }
    if (texto.includes("FROM custos")) {
      return {
        rows: [{
          produto_id: PRODUTO_ID, sku_id: SKU_19, sku: "", custo_produto: 10,
          imposto_percentual: 0.1, id_model: null, produto_nome: "Furadeira X",
          variacao_nome: "",
        }],
      };
    }
    return { rows: [] };
  };

  try {
    // 13/15. Base ativa e do TikTok resolve — SEM cliente/vínculo nenhum.
    basesDoBanco = [{ id: 7, slug: "base-tiktok", nome: "Base TikTok Teste", marketplace: "tiktok", ativo: true }];
    const baseManual = await resolverBaseTikTokPorId(7);
    eq("resolve a base só pelo id, sem cliente envolvido", baseManual.id, 7);

    const custosManual = await buildCostRowsFromBase({ baseId: 7, clienteSlug: "", marketplace: "tiktok" });
    eq("costRows expõe o sku_id como 'ID do SKU'", custosManual.costRows[0]["ID do SKU"], SKU_19);
    eq("costRows expõe o product_id como 'ID'", custosManual.costRows[0]["ID"], PRODUTO_ID);
    ok("costRows não expõe mais SKU textual", !("SKU" in custosManual.costRows[0]));
    eq("base resolvida sem cliente_slug algum", custosManual.base.id, 7);
    // O SELECT da base precisa ler a coluna nova, senão o cruzamento perde a chave.
    const selectCustos = queriesDoBanco.find((q) => /FROM custos/.test(q));
    ok("SELECT da base de custos inclui sku_id", /sku_id/.test(String(selectCustos)));

    // 13. Sem costsBaseId, a seleção é obrigatória.
    let erro = null;
    try {
      await resolverBaseTikTokPorId(null);
    } catch (e) { erro = e; }
    ok("baseId ausente é recusado", !!erro);
    eq("mensagem pede para selecionar a base", erro.statusCode, 400);
    ok("mensagem do erro pede seleção manual", /Selecione uma Base TikTok/.test(erro.payload.erro));

    // 14. Base de outro marketplace é rejeitada mesmo com id certo.
    basesDoBanco = [{ id: 8, slug: "base-meli", nome: "Base MELI", marketplace: "meli", ativo: true }];
    erro = null;
    try {
      await resolverBaseTikTokPorId(8);
    } catch (e) { erro = e; }
    ok("base de outro marketplace é recusada", !!erro);
    eq("recusa por marketplace responde 422", erro.statusCode, 422);
    ok("mensagem explica o motivo", /não é uma Base TikTok/i.test(erro.payload.erro));

    // Base inativa também é recusada.
    basesDoBanco = [{ id: 9, slug: "base-tiktok-inativa", nome: "Base Inativa", marketplace: "tiktok", ativo: false }];
    erro = null;
    try {
      await resolverBaseTikTokPorId(9);
    } catch (e) { erro = e; }
    ok("base inativa é recusada", !!erro);
    eq("recusa por base inativa responde 422", erro.statusCode, 422);

    // baseId inexistente → 404.
    basesDoBanco = [];
    erro = null;
    try {
      await resolverBaseTikTokPorId(999);
    } catch (e) { erro = e; }
    ok("baseId inexistente não resolve", !!erro);
    eq("base inexistente responde 404", erro.statusCode, 404);
  } finally {
    pool.query = queryOriginal;
  }

  // ── J. Quantidade ───────────────────────────────────────────────────────
  console.log("\n▸ J. Quantidade — inteiro positivo ou nada");
  eq("quantidade decimal NÃO é arredondada", parseTikTokQuantity("1,6"), 1.6);
  eq("quantidade decimal com ponto preservada", parseTikTokQuantity("2.5"), 2.5);
  eq("quantidade ausente é null", parseTikTokQuantity(""), null);
  eq("quantidade textual inválida é null", parseTikTokQuantity("—"), null);
  eq("inteiro positivo é válido", quantidadeEhValida(3), true);
  eq("zero é inválido", quantidadeEhValida(0), false);
  eq("negativo é inválido", quantidadeEhValida(-2), false);
  eq("decimal é inválido", quantidadeEhValida(1.6), false);
  eq("null é inválido", quantidadeEhValida(null), false);

  for (const [rotulo, valor] of [
    ["ausente", ""],
    ["zero", 0],
    ["negativa", -2],
    ["decimal", 1.5],
    ["texto", "abc"],
  ]) {
    const r = processTikTok({
      salesBuffer: incomeBuffer([linhaIncome({ quantidade: valor })]),
      costRowsRaw: CUSTOS_PADRAO,
      ads: 0,
      venforce: 0,
    });
    const row = r.detailedRows[0];
    eq(`quantidade ${rotulo}: status_calculo`, row.status_calculo, "quantidade_invalida");
    eq(`quantidade ${rotulo}: CMV não calculado`, row.cmv, null);
    eq(`quantidade ${rotulo}: imposto não calculado`, row.imposto_valor, null);
    eq(`quantidade ${rotulo}: LC não calculado`, row.lc, null);
    eq(`quantidade ${rotulo}: MC não calculada`, row.mc, null);
    eq(`quantidade ${rotulo}: faturamento preservado`, r.summary.grossRevenueTotal, 100);
    eq(`quantidade ${rotulo}: repasse preservado para auditoria`, r.summary.paidRevenueTotal, 70);
    eq(`quantidade ${rotulo}: fora do LC total`, r.summary.contributionProfitTotal, 0);
    // Fixture de uma linha só: sem nenhuma linha calculável a confiança é
    // "insuficiente" (mais severa que "parcial"). O que não pode, nunca, é
    // continuar "confiavel" — ver o caso misto logo abaixo.
    ok(
      `quantidade ${rotulo}: confiança rebaixada`,
      ["parcial", "insuficiente"].includes(r.summary.financialConfidence)
    );
    eq(`quantidade ${rotulo}: contada no resumo`, r.summary.rowsWithInvalidQuantity, 1);
    const audit = r.auditRows.find((a) => /Quantidade/.test(a.motivo));
    ok(`quantidade ${rotulo}: linha em auditRows`, !!audit);
    ok(`quantidade ${rotulo}: auditoria cita pedido e SKU`, /PED-1/.test(audit.motivo) && audit.motivo.includes(SKU_19));
  }
  {
    // Uma linha boa + uma com quantidade inválida: o fechamento existe, mas
    // deixa de ser confiável.
    const r = processTikTok({
      salesBuffer: incomeBuffer([
        linhaIncome(),
        linhaIncome({ pedido: "PED-2", quantidade: 0 }),
      ]),
      costRowsRaw: CUSTOS_PADRAO,
      ads: 0,
      venforce: 0,
    });
    eq("quantidade inválida ao lado de linha boa: confiança parcial", r.summary.financialConfidence, "parcial");
    eq("linha inválida não entra no LC", r.summary.contributionProfitTotal, 41);
    eq("linha inválida não entra no denominador", r.summary.revenueWithCalculatedProfit, 100);
    eq("faturamento das duas linhas preservado", r.summary.grossRevenueTotal, 200);
  }
  {
    const r = processTikTok({
      salesBuffer: incomeBuffer([linhaIncome({ quantidade: "" })]),
      costRowsRaw: CUSTOS_PADRAO,
      ads: 0,
      venforce: 0,
    });
    ok(
      "quantidade ausente NÃO vira 1 unidade",
      !r.summary.executiveNotes.some((n) => /1 unidade/.test(n))
    );
    ok(
      "nota executiva explica a quantidade inválida",
      r.summary.executiveNotes.some((n) => /quantidade inválida/i.test(n))
    );
  }

  // ── K. Denominador das margens ──────────────────────────────────────────
  console.log("\n▸ K. Margem só sobre receita com LC calculado");
  {
    const r = processTikTok({
      salesBuffer: incomeBuffer([
        linhaIncome(),                                                       // calculada
        linhaIncome({ pedido: "PED-2", subtotal: 60, liquidas: 54, liquidar: "" }), // custo, sem repasse
      ]),
      costRowsRaw: CUSTOS_PADRAO,
      ads: 0,
      venforce: 0,
    });
    const s = r.summary;
    eq("linha pendente entra na cobertura estrutural", s.revenueWithCost, 160);
    eq("denominador da margem ignora a linha pendente", s.revenueWithCalculatedProfit, 100);
    eq("LC total só da linha calculada", s.contributionProfitTotal, 41);
    eq("MC calculada = LC / receita com LC", s.contributionMarginCalculated, 0.41);
    ok(
      "MC não é diluída pela receita sem LC",
      s.contributionMarginCalculated !== 41 / 160
    );
    eq("MC final usa o mesmo denominador", s.finalMarginCalculated, 0.41);
    eq("linha pendente segue visível", r.detailedRows[1].status_calculo, "financeiro_pendente");
  }
  {
    const r = processTikTok({
      salesBuffer: incomeBuffer([linhaIncome({ sku: SKU_18 })]),
      costRowsRaw: CUSTOS_PADRAO,
      ads: 0,
      venforce: 0,
    });
    eq("sem nenhuma linha calculada, denominador é zero", r.summary.revenueWithCalculatedProfit, 0);
    eq("MC calculada vira null (nunca NaN/Infinity)", r.summary.contributionMarginCalculated, null);
    eq("MC final vira null", r.summary.finalMarginCalculated, null);
  }

  // ── M. Possíveis duplicidades ───────────────────────────────────────────
  console.log("\n▸ M. Duplicidade sinalizada, nunca removida");
  {
    const linha = linhaIncome();
    const r = processTikTok({
      salesBuffer: incomeBuffer([linha, [...linha]]),
      costRowsRaw: CUSTOS_PADRAO,
      ads: 0,
      venforce: 0,
    });
    eq("as duas linhas continuam no detalhamento", r.detailedRows.length, 2);
    eq("nenhuma linha foi removida do faturamento", r.summary.grossRevenueTotal, 200);
    eq("nenhuma linha foi removida do LC", r.summary.contributionProfitTotal, 82);
    eq("contador de possíveis duplicidades", r.summary.possibleDuplicateRowsCount, 1);
    eq("grupos de duplicidade", r.summary.possibleDuplicateGroupsCount, 1);
    eq("confiança cai para parcial", r.summary.financialConfidence, "parcial");
    ok(
      "auditoria registra a possível duplicidade",
      r.auditRows.some((a) => /Possível duplicidade/.test(a.motivo))
    );
    ok(
      "nota executiva alerta sem decidir",
      r.summary.executiveNotes.some((n) => /repetem integralmente a chave/.test(n))
    );
  }
  {
    // Mesmo SKU em pedidos diferentes NÃO é duplicidade.
    const r = processTikTok({
      salesBuffer: incomeBuffer([
        linhaIncome({ pedido: "PED-1" }),
        linhaIncome({ pedido: "PED-2" }),
      ]),
      costRowsRaw: CUSTOS_PADRAO,
      ads: 0,
      venforce: 0,
    });
    eq("mesmo SKU em pedidos diferentes não é duplicidade", r.summary.possibleDuplicateRowsCount, 0);
    eq("confiança segue confiável", r.summary.financialConfidence, "confiavel");
  }
  {
    const chave = buildDuplicateKey({
      statementId: "", paymentId: "", orderId: "", skuId: SKU_19,
      settlementLine: 10, grossRevenueLine: 20, date: "2026-07-01",
    });
    eq("sem identidade não há chave de duplicidade", chave, null);
  }

  // ── N. Reembolso total ──────────────────────────────────────────────────
  console.log("\n▸ N. Pedido totalmente reembolsado — visível, fora do lucro");
  await testesReembolso();

  // ── L. Salvar/publicar bloqueados no TikTok ─────────────────────────────
  console.log("\n▸ L. Entrega ao cliente — TikTok bloqueado, MELI/Shopee intactos");
  await testeEntregaCliente();
}

// Fixture espelhando o Income real: pedido de R$ 99 com desconto do vendedor,
// reembolso integral, vendas líquidas e repasse zerados.
function linhaReembolsoTotal(over = {}) {
  return linhaIncome({
    pedido: "PED-REEMB",
    subtotal: 99,
    descontos: -42.57,
    reembolsos: -56.43,
    liquidas: 0,
    liquidar: 0,
    comissao: 0,
    servico: 0,
    afiliados: 0,
    frete: 0,
    ...over,
  });
}

async function testesReembolso() {
  // 1. Venda normal com repasse positivo não é reembolso total.
  {
    const r = processTikTok({
      salesBuffer: incomeBuffer([linhaIncome()]),
      costRowsRaw: CUSTOS_PADRAO, ads: 0, venforce: 0,
    });
    eq("venda normal segue calculada", r.detailedRows[0].status_calculo, "calculado");
    eq("venda normal não conta como reembolso total", r.summary.fullyRefundedCount, 0);
    eq("venda normal mantém o LC", r.summary.contributionProfitTotal, 41);
  }

  // 2. Repasse zero SEM reembolso não é reembolso total.
  {
    const r = processTikTok({
      salesBuffer: incomeBuffer([linhaIncome({ liquidar: 0, liquidas: 0, reembolsos: 0 })]),
      costRowsRaw: CUSTOS_PADRAO, ads: 0, venforce: 0,
    });
    eq("repasse zero sem reembolso NÃO vira reembolso total", r.summary.fullyRefundedCount, 0);
    eq("linha segue a regra atual", r.detailedRows[0].status_calculo, "calculado");
  }

  // 3. Reembolso total confirmado.
  const totalComCusto = processTikTok({
    salesBuffer: incomeBuffer([linhaReembolsoTotal()]),
    costRowsRaw: CUSTOS_PADRAO, ads: 0, venforce: 0,
  });
  {
    const row = totalComCusto.detailedRows[0];
    const s = totalComCusto.summary;
    eq("status do reembolso total", row.status_calculo, "reembolso_total_pendente_regra");
    eq("CMV não calculado", row.cmv, null);
    eq("imposto interno não calculado", row.imposto_valor, null);
    eq("LC não calculado", row.lc, null);
    eq("MC não calculada", row.mc, null);

    // 5. Reembolso total COM custo cadastrado: o custo aparece, o CMV não.
    eq("custo unitário segue visível", row.custo_unitario, 10);
    eq("pedido preservado no detalhamento", row.id_pedido, "PED-REEMB");
    eq("SKU preservado no detalhamento", row.id_sku, SKU_19);
    eq("produto preservado", row.produto, "Furadeira X");
    eq("quantidade preservada", row.quantidade, 2);
    eq("faturamento original preservado", row.subtotal_antes_descontos, 99);
    eq("vendas líquidas preservadas", row.vendas_liquidas_produtos, 0);
    eq("repasse preservado", row.valor_total_liquidar, 0);
    eq("reembolso preservado", row.reembolsos, -56.43);
    eq("desconto do vendedor preservado", row.descontos_vendedor, -42.57);

    // 7 e 8. Fora do lucro e fora da base das margens.
    eq("não entra no LC total", s.contributionProfitTotal, 0);
    eq("não entra na base das margens", s.revenueWithCalculatedProfit, 0);
    eq("MC calculada é null", s.contributionMarginCalculated, null);
    eq("MC final é null", s.finalMarginCalculated, null);
    eq("resultado final não recebe prejuízo inventado", s.finalResult, 0);

    // 9 a 12. Faturamento preservado e contadores.
    eq("grossRevenueTotal preserva a venda original", s.grossRevenueTotal, 99);
    eq("fullyRefundedCount", s.fullyRefundedCount, 1);
    eq("fullyRefundedGrossRevenue", s.fullyRefundedGrossRevenue, 99);
    eq("fullyRefundedAmount (negativo, como as demais deduções)", s.fullyRefundedAmount, -56.43);
    eq("cobertura estrutural continua contando a base", s.revenueWithCost, 99);

    // 13. Auditoria com pedido e SKU.
    const audit = totalComCusto.auditRows.find((a) => /totalmente reembolsado/i.test(a.motivo));
    ok("linha em auditRows", !!audit);
    ok("auditoria cita o pedido", audit.motivo.includes("PED-REEMB"));
    ok("auditoria cita o SKU", audit.motivo.includes(SKU_19));
    eq("auditoria traz o reembolso", audit.reembolsos, -56.43);
    eq("auditoria informa se havia custo", audit.tem_custo_na_base, "sim");

    // 14. Confiança. Fixture de uma linha só: como nada ficou calculável, o
    // estado é "insuficiente" (mais severo que "parcial"). O caso realista —
    // reembolso total ao lado de venda saudável — é exatamente "parcial",
    // testado no cenário misto abaixo.
    ok(
      "confiança rebaixada com reembolso total pendente",
      ["parcial", "insuficiente"].includes(s.financialConfidence)
    );
    ok(
      "nota executiva explica a pendência de regra",
      s.executiveNotes.some((n) => /totalmente reembolsados/i.test(n) && /recuperação de produto/i.test(n))
    );
  }

  // 4. Reembolso parcial segue a regra atual.
  {
    const r = processTikTok({
      salesBuffer: incomeBuffer([
        linhaIncome({ pedido: "PED-PARCIAL", subtotal: 100, liquidas: 60, liquidar: 40, reembolsos: -30 }),
      ]),
      costRowsRaw: CUSTOS_PADRAO, ads: 0, venforce: 0,
    });
    const row = r.detailedRows[0];
    eq("reembolso parcial NÃO vira reembolso total", r.summary.fullyRefundedCount, 0);
    eq("reembolso parcial continua calculado", row.status_calculo, "calculado");
    eq("reembolso parcial mantém CMV", row.cmv, 20);
    // repasse 40 − CMV 20 − imposto (60 × 10%) 6 = 14
    eq("reembolso parcial mantém LC", row.lc, 14);
    eq("reembolso parcial contado à parte", r.summary.partiallyRefundedCount, 1);
    eq("valor do reembolso parcial", r.summary.partiallyRefundedAmount, -30);
    eq("reembolso parcial visível no detalhamento", row.reembolsos, -30);
    eq("reembolso parcial entra na base das margens", r.summary.revenueWithCalculatedProfit, 100);
  }

  // 6. Reembolso total SEM custo cadastrado.
  {
    const r = processTikTok({
      salesBuffer: incomeBuffer([linhaReembolsoTotal({ sku: SKU_18 })]),
      costRowsRaw: CUSTOS_PADRAO, ads: 0, venforce: 0,
    });
    const s = r.summary;
    eq("sem custo, o status do reembolso total prevalece", r.detailedRows[0].status_calculo, "reembolso_total_pendente_regra");
    eq("CMV segue nulo", r.detailedRows[0].cmv, null);
    eq("faturamento preservado", s.grossRevenueTotal, 99);
    eq("contado como reembolso total", s.fullyRefundedCount, 1);
    eq("cobertura acusa a falta de custo", s.revenueWithoutCost, 99);
    ok("SKU sem custo continua listado", r.unmatchedIds.includes(SKU_18));
    const audit = r.auditRows.find((a) => /totalmente reembolsado/i.test(a.motivo));
    eq("auditoria informa que não havia custo", audit.tem_custo_na_base, "não");
  }

  // Cenário misto: reembolso total ao lado de venda saudável.
  {
    const r = processTikTok({
      salesBuffer: incomeBuffer([linhaIncome(), linhaReembolsoTotal()]),
      costRowsRaw: CUSTOS_PADRAO, ads: 10, venforce: 5,
    });
    const s = r.summary;
    eq("faturamento soma venda boa + venda reembolsada", s.grossRevenueTotal, 199);
    eq("LC só da venda boa", s.contributionProfitTotal, 41);
    eq("base das margens só da venda boa", s.revenueWithCalculatedProfit, 100);
    eq("MC não é diluída pela venda reembolsada", s.contributionMarginCalculated, 0.41);
    eq("resultado final = LC − ads − venforce", s.finalResult, 26);
    eq("fullyRefundedCount no cenário misto", s.fullyRefundedCount, 1);
    eq("fullyRefundedGrossRevenue no cenário misto", s.fullyRefundedGrossRevenue, 99);
    eq("confiança parcial com reembolso total pendente de regra", s.financialConfidence, "parcial");
    eq("as duas linhas continuam visíveis", r.detailedRows.length, 2);
    ok(
      "nenhum NaN/Infinity no resumo",
      Object.values(s).every((v) => typeof v !== "number" || Number.isFinite(v))
    );
  }

  // Função pura, isolada.
  {
    const base = {
      refunds: -56.43, settlementLine: 0, netProductSalesLine: 0, grossRevenueLine: 99,
    };
    ok("função pura reconhece o reembolso total", isFullyRefundedIncomeRow(base));
    ok("sem reembolso não é total", !isFullyRefundedIncomeRow({ ...base, refunds: 0 }));
    ok("reembolso null não é total", !isFullyRefundedIncomeRow({ ...base, refunds: null }));
    ok("com repasse não é total", !isFullyRefundedIncomeRow({ ...base, settlementLine: 10 }));
    ok("repasse ausente não é total", !isFullyRefundedIncomeRow({ ...base, settlementLine: null }));
    ok("com venda líquida não é total", !isFullyRefundedIncomeRow({ ...base, netProductSalesLine: 5 }));
    ok("sem venda original não é total", !isFullyRefundedIncomeRow({ ...base, grossRevenueLine: 0 }));
    ok("centavo de arredondamento é tolerado", isFullyRefundedIncomeRow({ ...base, settlementLine: 0.001, netProductSalesLine: -0.002 }));
    ok("parcial é o complemento", isPartiallyRefundedIncomeRow({ ...base, settlementLine: 10, netProductSalesLine: 5 }));
    ok("linha sem reembolso não é parcial", !isPartiallyRefundedIncomeRow({ ...base, refunds: 0 }));
  }

  // Excel: aba Fechamento e Auditoria.
  {
    const res = await runTikTokController({
      files: { sales: [{ buffer: incomeBuffer([linhaIncome(), linhaReembolsoTotal()]) }] },
    });
    eq("controller responde 200 com reembolso total", res.statusCode, 200);
    const workbook = XLSX.read(Buffer.from(res.body.excelBase64, "base64"), { type: "buffer" });
    const fechamento = XLSX.utils.sheet_to_json(workbook.Sheets["Fechamento"]);
    const itens = fechamento.map((r) => String(r.Item));
    for (const item of [
      "Pedidos totalmente reembolsados",
      "Faturamento original totalmente reembolsado",
      "Valor total reembolsado",
    ]) {
      ok(`aba Fechamento traz "${item}"`, itens.includes(item));
    }
    eq(
      "aba Fechamento mostra a contagem correta",
      String(fechamento.find((r) => r.Item === "Pedidos totalmente reembolsados").Valor),
      "1"
    );
    ok("aba Auditoria gerada", workbook.SheetNames.includes("Auditoria"));
    const auditoria = XLSX.utils.sheet_to_json(workbook.Sheets["Auditoria"]);
    ok(
      "auditoria do Excel traz o pedido reembolsado",
      auditoria.some((r) => String(r.motivo || "").includes("PED-REEMB"))
    );
    ok("resposta sem NaN", !/\bNaN\b/.test(JSON.stringify(res.body)));
  }
}

// DOM mínimo para carregar Portal/financeiro.js e checar o gate de entrega.
async function testeEntregaCliente() {
  const fs = require("fs");
  const path = require("path");
  const vm = require("vm");

  const elementos = new Map();
  function criarElemento(id) {
    const classes = new Set();
    const filhos = new Map();
    const el = {
      id, hidden: false, disabled: false, value: "", title: "",
      files: [], options: [], selectedIndex: -1, style: {},
      _text: "", _html: "",
      classList: {
        add: (...n) => n.forEach((x) => classes.add(x)),
        remove: (...n) => n.forEach((x) => classes.delete(x)),
        toggle: (n, on) => (on ? classes.add(n) : classes.delete(n)),
        contains: (n) => classes.has(n),
      },
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
      setAttribute() {}, removeAttribute() { el.title = ""; }, getAttribute: () => null,
      appendChild() {}, click() {}, focus() {}, select() {},
      scrollIntoView() {}, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
      querySelectorAll: () => [],
      closest: () => el,
      parentElement: null,
    };
    el.querySelector = (sel) => {
      if (!filhos.has(sel)) filhos.set(sel, criarElemento(`${id}${sel}`));
      return filhos.get(sel);
    };
    Object.defineProperty(el, "textContent", {
      get: () => el._text,
      set: (v) => { el._text = v == null ? "" : String(v); },
    });
    Object.defineProperty(el, "innerHTML", {
      get: () => el._html,
      set: (v) => { el._html = v == null ? "" : String(v); },
    });
    return el;
  }
  function byId(id) {
    if (!elementos.has(id)) elementos.set(id, criarElemento(id));
    return elementos.get(id);
  }

  let chamadasDeRede = 0;
  globalThis.window = globalThis;
  globalThis.initLayout = () => {};
  globalThis.fetch = () => {
    chamadasDeRede += 1;
    return Promise.reject(new Error("sem rede no teste"));
  };
  globalThis.localStorage = {
    getItem: (k) => (k === "vf-token" ? "token-de-teste" : null),
    setItem() {}, removeItem() {},
  };
  globalThis.location = { replace() {}, href: "", origin: "https://teste" };
  globalThis.window.location = globalThis.location;
  globalThis.URL = { createObjectURL: () => "blob:fake", revokeObjectURL() {} };
  globalThis.navigator = { clipboard: { writeText: async () => {} } };
  globalThis.document = {
    getElementById: byId,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => criarElemento("tmp"),
    addEventListener() {}, removeEventListener() {},
    body: criarElemento("body"),
  };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.confirm = () => true;

  const arquivo = path.join(__dirname, "..", "..", "Portal", "financeiro.js");
  vm.runInThisContext(fs.readFileSync(arquivo, "utf8"), { filename: arquivo });

  const aviso = vm.runInThisContext("MSG_TIKTOK_SEM_ENTREGA");
  ok("aviso do TikTok tem o texto combinado", aviso.startsWith("O processamento TikTok está disponível para análise e download."));

  const snapshot = (mk) =>
    `ultimoFechamentoFinanceiro = { data: { summary: { grossRevenueTotal: 100 }, detailedRows: [], unmatchedIds: [], _vf_meta: { marketplace: "${mk}" } }, marketplace: "${mk}" };`;

  // ── TikTok: bloqueado ───────────────────────────────────────────────────
  byId("fin-marketplace").value = "tiktok";
  vm.runInThisContext(snapshot("tiktok"));
  eq("TikTok não permite entrega ao cliente", fechamentoPermiteEntregaCliente(), false);

  aplicarEstadoEntregaCliente();
  eq("TikTok: botão Salvar escondido", byId("btn-fin-salvar").hidden, true);
  eq("TikTok: botão Salvar desabilitado", byId("btn-fin-salvar").disabled, true);
  eq("TikTok: aba Entrega desabilitada", byId("vft-btn-entrega").disabled, true);
  eq("TikTok: botão Gerar link desabilitado", byId("btn-vft-gerar").disabled, true);
  ok("TikTok: botão Salvar explica o motivo", byId("btn-fin-salvar").title === aviso);

  chamadasDeRede = 0;
  await salvarFechamentoFinanceiro();
  eq("TikTok: salvar não chama a API", chamadasDeRede, 0);
  eq("TikTok: salvar avisa o usuário", byId("fin-status").textContent, aviso);

  chamadasDeRede = 0;
  await _gerarLinkComEntrega();
  eq("TikTok: publicar não chama a API", chamadasDeRede, 0);

  chamadasDeRede = 0;
  await gerarLinkClienteFinanceiro();
  eq("TikTok: link legado não chama a API", chamadasDeRede, 0);

  // ── MELI e Shopee: inalterados ──────────────────────────────────────────
  for (const mk of ["meli", "shopee"]) {
    byId("fin-marketplace").value = mk;
    vm.runInThisContext(snapshot(mk));
    eq(`${mk}: entrega ao cliente continua permitida`, fechamentoPermiteEntregaCliente(), true);

    aplicarEstadoEntregaCliente();
    eq(`${mk}: botão Salvar habilitado`, byId("btn-fin-salvar").disabled, false);
    eq(`${mk}: botão Salvar visível após processar`, byId("btn-fin-salvar").hidden, false);
    eq(`${mk}: botão Gerar link habilitado`, byId("btn-vft-gerar").disabled, false);

    chamadasDeRede = 0;
    await salvarFechamentoFinanceiro();
    ok(`${mk}: salvar segue chamando a API`, chamadasDeRede > 0);

    chamadasDeRede = 0;
    await _gerarLinkComEntrega();
    ok(`${mk}: publicar segue chamando a API`, chamadasDeRede > 0);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
