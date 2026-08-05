// server/services/fechamentoFinanceiro/tiktokFinanceiroService.js
// Motor de fechamento financeiro do TikTok Shop (planilhas Income + Onhold).
//
// ── O que este service faz ──────────────────────────────────────────────────
//   1. lê o workbook preservando o "ID do SKU" como STRING (18–19 dígitos);
//   2. detecta a aba e a linha de cabeçalho por conteúdo, não por índice;
//   3. cruza cada linha do Income com a base de custos por ID do SKU + Nome
//      do SKU (buildTikTokCostKey) — nunca só pelo ID;
//   4. calcula CMV, imposto interno, LC, MC, resultado final, TACoS/TACoX;
//   5. trata o Onhold como valor em aberto — nunca como resultado realizado.
//
// ── Chave de cruzamento ─────────────────────────────────────────────────────
// No TikTok, o mesmo ID numérico pode aparecer em várias linhas com SKUs
// textuais diferentes (ex.: KIT2BIBI, KIT3BIBI), cada um com custo próprio.
// A chave de cruzamento é sempre ID do SKU + Nome do SKU (produto_id + sku na
// base) via buildTikTokCostKey — nunca o ID sozinho. Nome do produto existe
// apenas para exibição/auditoria. Nunca cruzar por nome do produto, pedido,
// pagamento, demonstrativo ou posição da linha.
//
// ── ID do SKU ───────────────────────────────────────────────────────────────
// Nada de Number/parseInt/parseFloat/Math.trunc: 1735907463738524810 não cabe
// em double. A normalização é a MESMA da importação de bases
// (normalizarProdutoIdTikTok), inclusive as rejeições de notação científica e
// de célula numérica sem precisão.
//
// ── Convenção de sinais (interna, documentada) ──────────────────────────────
//   • receita e repasse: sinal preservado como veio da planilha
//     (positivos no fluxo normal; uma linha de estorno pode vir negativa);
//   • deduções de custo (comissão, taxas de serviço, frete, afiliados,
//     descontos do vendedor, reembolsos, impostos cobrados pelo TikTok):
//     normalizadas para NEGATIVO (-|valor|), porque a planilha do TikTok não é
//     consistente quanto ao sinal;
//   • ajustes: sinal PRESERVADO — um ajuste pode ser crédito ou débito, então
//     forçar o sinal inventaria informação.
// O valor original de cada dedução fica em `*_original` na linha detalhada.
//
// ── Por que as deduções não entram no LC ────────────────────────────────────
// "Valor total a ser liquidado" (repasse) já é líquido de comissão, taxas de
// serviço, frete, afiliados, descontos, reembolsos, impostos do TikTok e
// ajustes. Descontar de novo seria cobrança dupla. Os componentes aparecem no
// detalhamento e na auditoria apenas como leitura.

const XLSX = require("xlsx");

const { toNumber, round2 } = require("../../utils/numberUtils");
const { normalizeHeaderName, normalizeText } = require("../../utils/textUtils");
const { findField } = require("../../utils/textUtils");
const {
  buildCoverage,
  safeRatio,
} = require("../../utils/fechamento/financeiroShared");
const {
  normalizarProdutoIdTikTok,
  buildTikTokCostKey,
  resolverChaveTikTok,
} = require("../bases/baseCustosService");

const CALCULATION_MODE = "real_tiktok_income";

// Quantas linhas do topo são varridas em busca do cabeçalho (avisos, títulos,
// filtros exportados pelo painel do TikTok ficam acima dele).
const HEADER_SCAN_LIMIT = 40;

function createTikTokError(message, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

// ── ID do SKU ───────────────────────────────────────────────────────────────

// Delegado à regra da base de custos: uma normalização só para os dois lados
// do cruzamento. Erros ganham o contexto (arquivo/linha) de quem chamou.
function normalizeTikTokSkuId(value) {
  return normalizarProdutoIdTikTok(value);
}

function normalizeTikTokSkuIdComContexto(value, contexto) {
  try {
    return normalizeTikTokSkuId(value);
  } catch (error) {
    const base = error?.payload?.erro || error?.message || "ID do SKU inválido.";
    throw createTikTokError(
      `${contexto}: ${base} ` +
        "Formate a coluna do ID do SKU como Texto no Excel e exporte novamente. " +
        "O ID não é reconstruído porque os dígitos originais já podem ter sido perdidos.",
      422
    );
  }
}

// ── Valores ─────────────────────────────────────────────────────────────────

// Ausência (célula vazia / coluna inexistente) devolve null — nunca 0 falso.
// Aceita "R$ 1.234,56", "1234.56", "-10", "(10,00)" (parênteses = negativo).
function parseTikTokMoney(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  let text = String(value).replace(/^﻿/, "").trim();
  if (!text) return null;

  let negative = false;
  while (/^\(.*\)$/.test(text)) {
    negative = !negative;
    text = text.slice(1, -1).trim();
  }
  if (!/\d/.test(text)) return null;

  const parsed = toNumber(text);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

// Quantidade é lida COMO VEIO: nada de arredondar. "1,6" continua 1.6 e cai na
// validação abaixo — arredondar mudaria o CMV silenciosamente.
function parseTikTokQuantity(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text || !/\d/.test(text)) return null;
  const parsed = toNumber(text);
  return Number.isFinite(parsed) ? parsed : null;
}

// Único domínio aceito para calcular CMV: inteiro positivo.
function quantidadeEhValida(quantidade) {
  return Number.isInteger(quantidade) && quantidade > 0;
}

function descreverQuantidade(quantidade) {
  if (quantidade === null || quantidade === undefined) return "ausente";
  if (!Number.isFinite(quantidade)) return "inválida";
  if (quantidade === 0) return "zero";
  if (quantidade < 0) return `negativa (${quantidade})`;
  if (!Number.isInteger(quantidade)) return `decimal (${quantidade})`;
  return String(quantidade);
}

// Dedução sempre negativa: a planilha do TikTok alterna entre "-15" e "15"
// para a mesma coluna dependendo do relatório exportado.
function asDeduction(value) {
  if (value === null || value === undefined) return null;
  return -Math.abs(value);
}

function sumDefined(values) {
  let total = 0;
  let found = false;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    total += value;
    found = true;
  }
  return found ? round2(total) : null;
}

// ── Leitura do workbook preservando tipo de célula ──────────────────────────

// Cada célula vira { text, number, isNumber, raw }. O ID do SKU precisa saber
// se a célula era numérica: nesse caso o Excel já pode ter perdido dígitos.
function cellToValue(cell) {
  if (!cell) return { text: "", number: null, isNumber: false, raw: "" };
  if (cell.t === "n") {
    return {
      text: cell.w != null ? String(cell.w) : String(cell.v),
      number: cell.v,
      isNumber: true,
      raw: cell.v,
    };
  }
  const text = String(cell.w != null ? cell.w : cell.v == null ? "" : cell.v).trim();
  return { text, number: null, isNumber: false, raw: text };
}

function sheetToCellMatrix(sheet) {
  if (!sheet || !sheet["!ref"]) return [];
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const matrix = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      row.push(cellToValue(sheet[XLSX.utils.encode_cell({ r, c })]));
    }
    matrix.push(row);
  }
  return matrix;
}

function cellValueForParsing(cell) {
  if (!cell) return null;
  return cell.isNumber ? cell.number : cell.text;
}

// ── Mapa de colunas ─────────────────────────────────────────────────────────

function normalizeAliases(aliases) {
  return aliases.map(normalizeHeaderName).filter(Boolean);
}

function field(name, aliases, options = {}) {
  return {
    field: name,
    aliases: normalizeAliases(aliases),
    exclude: normalizeAliases(options.exclude || []),
    money: options.money === true,
    identity: options.identity === true,
  };
}

// Ordem = prioridade. Cada coluna é consumida por um único campo, então os
// campos específicos ("id do sku") pegam a coluna antes dos genéricos ("sku").
const INCOME_FIELDS = [
  field("skuId", [
    "id do sku", "id sku", "sku id", "tiktok sku id", "id do sku do tiktok",
    "produto_id", "produto id", "sku",
  ], { exclude: ["nome", "name"], identity: true }),
  field("orderId", ["id do pedido", "numero do pedido", "order id"], { identity: true }),
  field("paymentId", ["id do pagamento", "payment id", "id de pagamento"]),
  field("statementId", [
    "id do demonstrativo", "statement id", "id do extrato", "id da liquidacao",
  ]),
  field("settlementAmount", [
    "valor total a ser liquidado", "total a ser liquidado", "valor a ser liquidado",
    "valor liquidado", "total settlement amount", "settlement amount",
  ], { money: true }),
  field("netProductSales", [
    "vendas liquidas dos produtos", "vendas liquidas do produto", "vendas liquidas",
    "net product sales", "product net sales",
  ], { money: true }),
  field("grossSubtotal", [
    "subtotal antes dos descontos", "subtotal antes de descontos",
    "subtotal do produto antes dos descontos", "subtotal antes do desconto",
    "subtotal before discounts", "subtotal",
  ], { money: true }),
  field("sellerDiscounts", [
    "descontos financiados pelo vendedor", "desconto financiado pelo vendedor",
    "descontos do vendedor", "desconto do vendedor", "seller discounts",
  ], { money: true }),
  field("refunds", ["reembolsos", "reembolso", "refunds", "valor reembolsado"], { money: true }),
  field("netShippingCost", [
    "custo liquido de frete", "custo de frete liquido", "frete liquido",
    "custo de frete", "net shipping cost", "frete",
  ], { money: true }),
  field("platformCommission", [
    "comissao da plataforma", "comissao de plataforma", "comissao plataforma",
    "taxa da plataforma", "platform commission",
  ], { money: true }),
  field("serviceFees", [
    "taxas de servico", "taxa de servico", "tarifa de servico", "service fees",
  ], { money: true }),
  field("affiliateCommission", [
    "comissoes de afiliados", "comissao de afiliados", "comissao afiliados",
    "affiliate commission", "affiliate commissions",
  ], { money: true }),
  // "Impostos" é o nome real da coluna no export do TikTok (validado contra o
  // relatório Income real). Não confundir com "Taxas e impostos", que é o
  // subtotal do grupo — mapear o subtotal duplicaria a leitura.
  field("tiktokTaxes", [
    "impostos cobrados pelo tiktok", "imposto cobrado pelo tiktok",
    "impostos do tiktok", "imposto tiktok", "impostos", "taxes",
  ], { exclude: ["taxas e"], money: true }),
  field("adjustments", ["ajustes", "ajuste", "adjustments", "adjustment"], { money: true }),
  field("quantity", ["quantidade", "qtd", "quantity", "units", "unidades"]),
  field("productName", ["nome do produto", "produto", "product name"], { exclude: ["id", "sku"] }),
  field("variationName", [
    "nome do sku", "nome da variacao", "variacao", "sku name", "variation name",
  ], { exclude: ["id do"] }),
  field("date", [
    "data", "data do pedido", "data de criacao", "data de liquidacao",
    "data do pagamento", "order create time", "statement time",
  ]),
  field("status", ["status", "status do pedido", "situacao", "order status"]),
];

const ONHOLD_FIELDS = [
  field("skuId", [
    "id do sku", "id sku", "sku id", "tiktok sku id", "produto_id", "produto id", "sku",
  ], { exclude: ["nome", "name"], identity: true }),
  field("orderId", ["id do pedido", "numero do pedido", "order id"], { identity: true }),
  field("paymentId", ["id do pagamento", "payment id", "id de pagamento"]),
  field("statementId", ["id do demonstrativo", "statement id", "id do extrato"]),
  field("expectedAmount", [
    "valor total a ser liquidado", "valor estimado a ser liquidado",
    "estimativa de liquidacao", "valor previsto", "valor em aberto",
    "valor a receber", "total a ser liquidado", "valor retido",
    "estimated settlement amount",
  ], { money: true }),
  field("netProductSales", [
    "vendas liquidas dos produtos", "vendas liquidas", "net product sales",
  ], { money: true }),
  field("grossSubtotal", [
    "subtotal antes dos descontos", "subtotal antes de descontos", "subtotal",
  ], { money: true }),
  field("quantity", ["quantidade", "qtd", "quantity", "units", "unidades"]),
  field("productName", ["nome do produto", "produto", "product name"], { exclude: ["id", "sku"] }),
  field("variationName", [
    "nome do sku", "nome da variacao", "variacao", "sku name", "variation name",
  ], { exclude: ["id do"] }),
  field("date", [
    "data", "data do pedido", "data de criacao", "data prevista",
    "order create time",
  ]),
  field("status", ["status", "status do pedido", "situacao", "order status"]),
];

function scoreHeaderCandidate(header, spec) {
  if (!header) return 0;
  for (const excluded of spec.exclude) {
    if (` ${header} `.includes(` ${excluded} `)) return 0;
  }
  for (const alias of spec.aliases) {
    if (header === alias) return 1000;
  }
  for (const alias of spec.aliases) {
    // Palavra inteira: "sku" não pode casar com o meio de outra palavra.
    if (` ${header} `.includes(` ${alias} `)) return 100 + alias.length;
  }
  return 0;
}

function mapHeaderRow(cells, specs) {
  const headers = (cells || []).map((cell) => normalizeHeaderName(cell.text));
  const columns = {};
  const used = new Set();
  let score = 0;

  for (const spec of specs) {
    let best = null;
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i) || !headers[i]) continue;
      const value = scoreHeaderCandidate(headers[i], spec);
      if (value > 0 && (!best || value > best.value)) best = { index: i, value };
    }
    if (best) {
      columns[spec.field] = best.index;
      used.add(best.index);
      score += 1;
    }
  }

  return {
    columns,
    score,
    headers: (cells || []).map((cell) => cell.text).filter(Boolean),
  };
}

function headerIsValid(mapped, specs, minScore) {
  if (mapped.score < minScore) return false;
  const hasIdentity = specs.some(
    (spec) => spec.identity && mapped.columns[spec.field] !== undefined
  );
  const hasMoney = specs.some(
    (spec) => spec.money && mapped.columns[spec.field] !== undefined
  );
  return hasIdentity && hasMoney;
}

// Procura a linha de cabeçalho dentro de uma matriz já lida.
function detectTikTokHeader(matrix, specs, minScore = 3) {
  let best = null;
  const limit = Math.min(matrix.length, HEADER_SCAN_LIMIT);

  for (let i = 0; i < limit; i++) {
    const mapped = mapHeaderRow(matrix[i], specs);
    if (!best || mapped.score > best.score) {
      best = { ...mapped, rowIndex: i };
    }
  }

  if (!best) {
    return { rowIndex: 0, score: 0, columns: {}, headers: [], found: false };
  }

  return { ...best, found: headerIsValid(best, specs, minScore) };
}

// Escolhe a ABA pelo cabeçalho reconhecido, nunca só pelo índice.
function readTikTokWorkbook(buffer, specs, { minScore = 3, label }) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch (error) {
    throw createTikTokError(`Não foi possível ler a planilha ${label}.`, 400);
  }

  let best = null;
  const inspecionadas = [];

  for (const sheetName of workbook.SheetNames) {
    const matrix = sheetToCellMatrix(workbook.Sheets[sheetName]);
    if (!matrix.length) continue;
    const header = detectTikTokHeader(matrix, specs, minScore);
    inspecionadas.push(`${sheetName} (${header.score} campo(s))`);
    const melhor =
      !best ||
      (header.found && !best.header.found) ||
      (header.found === best.header.found && header.score > best.header.score);
    if (melhor) best = { sheetName, matrix, header };
  }

  if (!best || !best.header.found) {
    throw createTikTokError(
      `Não foi possível reconhecer os cabeçalhos da planilha ${label} do TikTok Shop. ` +
        `Abas inspecionadas: ${inspecionadas.join(", ") || "nenhuma"}. ` +
        "Exporte o relatório sem alterar os títulos das colunas.",
      422
    );
  }

  return best;
}

function rowIsEmpty(cells) {
  return !(cells || []).some((cell) => String(cell?.text || "").trim() !== "");
}

function readCell(cells, columns, name) {
  const index = columns[name];
  if (index === undefined) return null;
  return cells[index] || null;
}

function readText(cells, columns, name) {
  const cell = readCell(cells, columns, name);
  const text = String(cell?.text || "").trim();
  return text || null;
}

function readMoney(cells, columns, name) {
  const cell = readCell(cells, columns, name);
  return cell ? parseTikTokMoney(cellValueForParsing(cell)) : null;
}

// ── Parsers ─────────────────────────────────────────────────────────────────

function parseTikTokIncomeBuffer(buffer) {
  const { sheetName, matrix, header } = readTikTokWorkbook(buffer, INCOME_FIELDS, {
    minScore: 3,
    label: "Income",
  });

  const rows = [];
  for (let i = header.rowIndex + 1; i < matrix.length; i++) {
    const cells = matrix[i];
    if (rowIsEmpty(cells)) continue;

    const columns = header.columns;
    const linhaPlanilha = i + 1;
    const skuCell = readCell(cells, columns, "skuId");
    const skuId = skuCell
      ? normalizeTikTokSkuIdComContexto(
          cellValueForParsing(skuCell),
          `Income, linha ${linhaPlanilha}`
        )
      : "";

    const grossSubtotal = readMoney(cells, columns, "grossSubtotal");
    const netProductSales = readMoney(cells, columns, "netProductSales");
    const settlementAmount = readMoney(cells, columns, "settlementAmount");

    const sellerDiscountsRaw = readMoney(cells, columns, "sellerDiscounts");
    const refundsRaw = readMoney(cells, columns, "refunds");
    const netShippingCostRaw = readMoney(cells, columns, "netShippingCost");
    const platformCommissionRaw = readMoney(cells, columns, "platformCommission");
    const serviceFeesRaw = readMoney(cells, columns, "serviceFees");
    const affiliateCommissionRaw = readMoney(cells, columns, "affiliateCommission");
    const tiktokTaxesRaw = readMoney(cells, columns, "tiktokTaxes");
    const adjustments = readMoney(cells, columns, "adjustments");

    const sellerDiscounts = asDeduction(sellerDiscountsRaw);
    const refunds = asDeduction(refundsRaw);

    // Vendas líquidas: usa a coluna quando existir; senão, bruto + descontos
    // + reembolsos (ambos já negativos na convenção interna).
    const netProductSalesLine =
      netProductSales !== null
        ? netProductSales
        : grossSubtotal === null
          ? null
          : round2(grossSubtotal + (sellerDiscounts || 0) + (refunds || 0));

    // Faturamento: subtotal antes dos descontos; sem ele, vendas líquidas.
    const grossRevenueLine =
      grossSubtotal !== null ? grossSubtotal : netProductSalesLine;

    const temAlgumValor =
      grossRevenueLine !== null ||
      netProductSalesLine !== null ||
      settlementAmount !== null;

    if (!skuId && !temAlgumValor) continue;

    rows.push({
      source: "income",
      sheetName,
      spreadsheetRow: linhaPlanilha,

      skuId,
      orderId: readText(cells, columns, "orderId"),
      paymentId: readText(cells, columns, "paymentId"),
      statementId: readText(cells, columns, "statementId"),
      date: readText(cells, columns, "date"),
      status: readText(cells, columns, "status"),
      productName: readText(cells, columns, "productName"),
      variationName: readText(cells, columns, "variationName"),
      quantity: parseTikTokQuantity(
        cellValueForParsing(readCell(cells, columns, "quantity"))
      ),

      grossRevenueLine,
      netProductSalesLine,
      settlementLine: settlementAmount,

      // Componentes: valor normalizado + valor original (auditoria).
      sellerDiscounts,
      sellerDiscountsOriginal: sellerDiscountsRaw,
      refunds,
      refundsOriginal: refundsRaw,
      netShippingCost: asDeduction(netShippingCostRaw),
      netShippingCostOriginal: netShippingCostRaw,
      platformCommission: asDeduction(platformCommissionRaw),
      platformCommissionOriginal: platformCommissionRaw,
      serviceFees: asDeduction(serviceFeesRaw),
      serviceFeesOriginal: serviceFeesRaw,
      affiliateCommission: asDeduction(affiliateCommissionRaw),
      affiliateCommissionOriginal: affiliateCommissionRaw,
      tiktokTaxes: asDeduction(tiktokTaxesRaw),
      tiktokTaxesOriginal: tiktokTaxesRaw,
      adjustments,
    });
  }

  return { rows, sheetName, header };
}

function parseTikTokOnholdBuffer(buffer) {
  const { sheetName, matrix, header } = readTikTokWorkbook(buffer, ONHOLD_FIELDS, {
    minScore: 2,
    label: "Onhold",
  });

  const rows = [];
  for (let i = header.rowIndex + 1; i < matrix.length; i++) {
    const cells = matrix[i];
    if (rowIsEmpty(cells)) continue;

    const columns = header.columns;
    const linhaPlanilha = i + 1;
    const skuCell = readCell(cells, columns, "skuId");
    const skuId = skuCell
      ? normalizeTikTokSkuIdComContexto(
          cellValueForParsing(skuCell),
          `Onhold, linha ${linhaPlanilha}`
        )
      : "";

    const expected = readMoney(cells, columns, "expectedAmount");
    const net = readMoney(cells, columns, "netProductSales");
    const gross = readMoney(cells, columns, "grossSubtotal");
    const openAmount = expected !== null ? expected : net !== null ? net : gross;

    if (!skuId && openAmount === null) continue;

    rows.push({
      source: "onhold",
      sheetName,
      spreadsheetRow: linhaPlanilha,
      skuId,
      orderId: readText(cells, columns, "orderId"),
      paymentId: readText(cells, columns, "paymentId"),
      statementId: readText(cells, columns, "statementId"),
      date: readText(cells, columns, "date"),
      status: readText(cells, columns, "status"),
      productName: readText(cells, columns, "productName"),
      variationName: readText(cells, columns, "variationName"),
      quantity: parseTikTokQuantity(
        cellValueForParsing(readCell(cells, columns, "quantity"))
      ),
      openAmount,
    });
  }

  return { rows, sheetName, header };
}

// ── Base de custos ──────────────────────────────────────────────────────────

const COST_ID_FIELDS = ["id do sku", "id sku", "sku id", "produto_id", "produto id"];
// SKU: campo de identidade obrigatório junto com o ID (ver buildTikTokCostKey).
const COST_SKU_FIELDS = ["sku", "nome do sku", "sku do vendedor", "seller sku", "codigo sku"];
const COST_VALUE_FIELDS = [
  "custo unitario", "custo unitário", "custo do produto", "custo_produto",
  "preco de custo", "preço de custo", "custo",
];
const COST_TAX_FIELDS = [
  "imposto (%)", "imposto %", "imposto", "imposto_percentual",
  "imposto percentual", "aliquota", "alíquota",
];
const COST_PRODUCT_FIELDS = ["nome do produto", "produto_nome", "produto"];
// Variação é só exibição — não faz parte da chave de cruzamento.
const COST_VARIATION_FIELDS = ["nome da variacao", "variacao_nome", "variacao"];

// Mesma leitura de imposto do motor MELI: a base pode gravar 0.08 ou 8 para
// 8%. Vale a MESMA regra dos dois lados — nunca duas conversões.
function taxPercentFromBase(value) {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed === 0) return 0;
  return parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
}

function taxDecimalFromPercent(percent) {
  const value = toNumber(percent);
  if (!Number.isFinite(value) || value === 0) return 0;
  return value > 1 ? value / 100 : value;
}

function parseTikTokCostRows(rows) {
  const parsed = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;

    const rawId = findField(row, COST_ID_FIELDS);
    // O ID da base já foi normalizado na importação; aqui só protegemos o tipo.
    const produtoId = normalizeTikTokSkuId(rawId);
    if (!produtoId) continue; // ID é sempre obrigatório

    // SKU agora é opcional: a planilha real tem produtos com SKU textual e
    // produtos sem SKU. A decisão de quando o ID sozinho pode ser usado como
    // chave (só quando único no lote) é feita depois, em buildTikTokCostMap
    // — aqui só lemos o valor cru.
    const rawSku = findField(row, COST_SKU_FIELDS);
    const sku = String(rawSku == null ? "" : rawSku).trim();

    const rawCost = findField(row, COST_VALUE_FIELDS);
    if (rawCost === "" || rawCost === null || rawCost === undefined) continue;
    const cost = toNumber(rawCost);
    if (!Number.isFinite(cost)) continue;

    const taxPercent = taxPercentFromBase(findField(row, COST_TAX_FIELDS));

    parsed.push({
      produtoId,
      sku,
      cost,
      taxPercent,
      taxDecimal: taxDecimalFromPercent(taxPercent),
      productName: String(findField(row, COST_PRODUCT_FIELDS) || "").trim() || null,
      variationName: String(findField(row, COST_VARIATION_FIELDS) || "").trim() || null,
    });
  }
  return parsed;
}

// Mapa de custos TikTok — usa a MESMA regra de resolverChaveTikTok (função
// única, compartilhada com a importação da base):
//   - SKU preenchido        → chave composta ID+SKU (nunca se mistura com
//                              outro SKU do mesmo ID);
//   - SKU vazio, ID único   → chave é o próprio ID;
//   - SKU vazio, ID repetido → ambíguo, a linha não entra no mapa principal.
//
// `porId` é um índice auxiliar: ID → custo, presente SOMENTE quando esse ID
// tem exatamente UM custo no lote inteiro (com ou sem SKU). É o fallback que
// o motor financeiro usa quando o Income não tem SKU (ou o SKU do Income não
// bate com o cadastrado) mas não há ambiguidade possível — só existe um
// custo candidato. Nunca é populado quando o ID tem mais de um custo.
function buildTikTokCostMap(rows) {
  const parsedRows = parseTikTokCostRows(rows);
  const contagemPorId = new Map();
  for (const r of parsedRows) {
    contagemPorId.set(r.produtoId, (contagemPorId.get(r.produtoId) || 0) + 1);
  }

  const map = new Map();
  const porId = new Map();
  const conflicts = [];

  for (const cost of parsedRows) {
    const resolvido = resolverChaveTikTok(cost.produtoId, cost.sku, contagemPorId);
    if (!resolvido.ambiguo && resolvido.chave) {
      const existing = map.get(resolvido.chave);
      if (!existing) {
        map.set(resolvido.chave, cost);
      } else if (
        round2(existing.cost) !== round2(cost.cost) ||
        round2(existing.taxPercent) !== round2(cost.taxPercent)
      ) {
        conflicts.push({
          id: cost.produtoId,
          sku: cost.sku,
          values: [
            { cost: round2(existing.cost), taxPercent: round2(existing.taxPercent) },
            { cost: round2(cost.cost), taxPercent: round2(cost.taxPercent) },
          ],
        });
      }
    }

    if (contagemPorId.get(cost.produtoId) === 1) {
      porId.set(cost.produtoId, cost);
    }
  }

  return { map, porId, conflicts };
}

// Resolve o custo de uma linha do Income seguindo a mesma regra da base:
// tenta ID+SKU primeiro (quando o Income tem SKU); cai para o ID sozinho
// somente quando existir exatamente um custo cadastrado para esse ID —
// nunca escolhe arbitrariamente entre vários custos do mesmo ID.
function resolverCustoIncome(costMap, costPorId, produtoId, skuText) {
  if (produtoId && skuText) {
    const key = buildTikTokCostKey(produtoId, skuText);
    const found = key ? costMap.get(key) : undefined;
    if (found) return found;
  }
  if (produtoId) return costPorId.get(produtoId);
  return undefined;
}

// ── Status da linha ─────────────────────────────────────────────────────────

const STATUS_FORA_DO_LUCRO = /cancel|reembols|estorn|devolv|refund|return/;

function statusForaDoLucro(status) {
  const text = normalizeText(status);
  return text ? STATUS_FORA_DO_LUCRO.test(text) : false;
}

// ── Reembolso total ─────────────────────────────────────────────────────────
// Pedido devolvido/estornado: a venda aconteceu, o dinheiro voltou inteiro.
// A regra contábil (recuperação da mercadoria, reversão do imposto, perda real
// de CMV, competência do estorno) ainda NÃO está definida, então a linha fica
// fora do lucro em vez de gerar prejuízo inventado — mas continua visível.
//
// Detecção conservadora, só com evidência financeira do próprio Income. Todas
// as condições precisam valer ao mesmo tempo:
//   1. existe reembolso registrado na linha  (|reembolsos| > 0);
//   2. o repasse existe e é zero             (|valor total a ser liquidado| ≈ 0);
//   3. a venda líquida do produto zerou      (|vendas líquidas| ≈ 0);
//   4. houve venda original                  (subtotal antes dos descontos > 0).
//
// A condição 1 é o que impede confundir com repasse zero por outro motivo
// (linha pendente, ajuste sem valor, pedido isento). As condições 2 e 3 juntas
// separam reembolso TOTAL de reembolso parcial — no parcial sobra venda líquida
// e/ou repasse. Tolerância de meio centavo absorve arredondamento da planilha.
const REEMBOLSO_EPSILON = 0.005;

function isFullyRefundedIncomeRow(row) {
  if (!row) return false;

  const reembolso = row.refunds;               // normalizado: negativo
  const repasse = row.settlementLine;
  const vendaLiquida = row.netProductSalesLine;
  const faturamento = row.grossRevenueLine;

  if (reembolso === null || Math.abs(reembolso) <= REEMBOLSO_EPSILON) return false;
  if (repasse === null || Math.abs(repasse) > REEMBOLSO_EPSILON) return false;
  if (vendaLiquida === null || Math.abs(vendaLiquida) > REEMBOLSO_EPSILON) return false;
  if (faturamento === null || faturamento <= REEMBOLSO_EPSILON) return false;

  return true;
}

// Reembolso parcial: houve estorno, mas ainda sobrou venda líquida ou repasse.
// Segue a regra normal de LC — só é contado e destacado.
function isPartiallyRefundedIncomeRow(row) {
  if (!row) return false;
  const reembolso = row.refunds;
  if (reembolso === null || Math.abs(reembolso) <= REEMBOLSO_EPSILON) return false;
  return !isFullyRefundedIncomeRow(row);
}

// ── Possíveis duplicidades ──────────────────────────────────────────────────
// NÃO deduplicamos: duas vendas do mesmo SKU são dois fatos financeiros. O que
// se detecta aqui é a repetição INTEGRAL da chave composta — sinal de export
// duplicado. A decisão fica com quem opera; o motor só sinaliza.
// A chave só é considerada quando há identidade (demonstrativo/pagamento/
// pedido), SKU e algum valor: sem isso, "repetido" não significa nada.
function buildDuplicateKey(row) {
  const temIdentidade = !!(row.statementId || row.paymentId || row.orderId);
  const temValor = row.settlementLine !== null || row.grossRevenueLine !== null;
  if (!temIdentidade || !row.skuId || !temValor) return null;

  return [
    row.statementId,
    row.paymentId,
    row.orderId,
    row.skuId,
    row.settlementLine,
    row.grossRevenueLine,
    row.date,
  ]
    .map((value) => (value === null || value === undefined ? "" : String(value)))
    .join("|");
}

// ── Motor ───────────────────────────────────────────────────────────────────

function processTikTok({
  salesBuffer,
  onholdBuffer = null,
  costRowsRaw,
  ads = 0,
  venforce = 0,
} = {}) {
  if (!salesBuffer) {
    throw createTikTokError(
      "Planilha Income do TikTok Shop não enviada. O Income é obrigatório para o fechamento.",
      400
    );
  }

  const income = parseTikTokIncomeBuffer(salesBuffer);
  const onhold = onholdBuffer ? parseTikTokOnholdBuffer(onholdBuffer) : { rows: [] };
  const { map: costMap, porId: costPorId, conflicts: costConflicts } = buildTikTokCostMap(costRowsRaw);

  const adsValue = round2(toNumber(ads));
  const venforceValue = round2(toNumber(venforce));

  const detailedRows = [];
  const auditRows = [];
  const unmatchedIds = new Set();
  const unmatchedCancelled = new Set();
  // Combinações ID+SKU do Income que não bateram com nenhum custo da base
  // (id e sku existiam, mas a combinação não foi encontrada). Mais preciso
  // que unmatchedIds quando o mesmo ID tem vários SKUs na base.
  const unmatchedSkuKeys = [];
  const unmatchedSkuKeysSeen = new Set();

  let grossRevenueTotal = 0;
  let productNetSalesTotal = 0;
  let paidRevenueTotal = 0;
  let revenueWithCost = 0;
  let revenueWithoutCost = 0;
  let revenueWithFinancialData = 0;
  let revenuePendingFinancialIncome = 0;
  let ignoredRevenue = 0;
  // Denominador das margens: só a receita das linhas que REALMENTE geraram LC
  // (custo + quantidade válida + repasse). revenueWithCost continua medindo
  // cobertura estrutural da base e não serve de denominador.
  let revenueWithCalculatedProfit = 0;

  let cmvTotal = 0;
  let taxValueTotal = 0;
  let contributionProfitTotal = 0;
  let contributionProfitRowsCount = 0;

  let settlementTotal = 0;
  let platformCommissionTotal = 0;
  let serviceFeesTotal = 0;
  let affiliateFeesReportTotal = 0;
  let shippingFeesTotal = 0;
  let refundsTotal = 0;
  let sellerDiscountsTotal = 0;
  let adjustmentsTotal = 0;
  let tiktokTaxesTotal = 0;

  let rowsWithoutId = 0;
  let rowsWithoutCost = 0;
  let salesPendingFinancialIncomeCount = 0;
  let rowsWithInvalidQuantity = 0;
  let fullyRefundedCount = 0;
  let fullyRefundedGrossRevenue = 0;
  let fullyRefundedAmount = 0;
  let partiallyRefundedCount = 0;
  let partiallyRefundedAmount = 0;

  // Chave composta → linhas do Income que a repetem (detecção, nunca remoção).
  const duplicateIndex = new Map();

  for (const row of income.rows) {
    // "Nome do SKU" do Income é o SKU textual usado na chave. Quando ausente,
    // só cruza pelo ID sozinho se houver exatamente um custo para esse ID na
    // base (resolverCustoIncome) — nunca escolhe arbitrariamente entre vários.
    const skuText = String(row.variationName || "").trim();
    const hasSkuText = !!skuText;
    const cost = resolverCustoIncome(costMap, costPorId, row.skuId, skuText);
    const hasCost = !!cost;
    const hasSettlement = row.settlementLine !== null;
    const gross = row.grossRevenueLine;
    const grossValue = gross === null ? 0 : gross;

    if (!row.skuId) rowsWithoutId += 1;

    const duplicateKey = buildDuplicateKey(row);
    if (duplicateKey) {
      if (!duplicateIndex.has(duplicateKey)) duplicateIndex.set(duplicateKey, []);
      duplicateIndex.get(duplicateKey).push(row);
    }

    grossRevenueTotal += grossValue;
    if (row.netProductSalesLine !== null) productNetSalesTotal += row.netProductSalesLine;
    if (hasSettlement) {
      paidRevenueTotal += row.settlementLine;
      settlementTotal += row.settlementLine;
      revenueWithFinancialData += grossValue;
    } else {
      revenuePendingFinancialIncome += grossValue;
      salesPendingFinancialIncomeCount += 1;
    }

    platformCommissionTotal += row.platformCommission || 0;
    serviceFeesTotal += row.serviceFees || 0;
    affiliateFeesReportTotal += row.affiliateCommission || 0;
    shippingFeesTotal += row.netShippingCost || 0;
    refundsTotal += row.refunds || 0;
    sellerDiscountsTotal += row.sellerDiscounts || 0;
    adjustmentsTotal += row.adjustments || 0;
    tiktokTaxesTotal += row.tiktokTaxes || 0;

    // Reembolso parcial continua no LC pela regra atual — só é contado para
    // ficar destacado no resumo.
    if (isPartiallyRefundedIncomeRow(row)) {
      partiallyRefundedCount += 1;
      partiallyRefundedAmount += row.refunds || 0;
    }

    let cmvLine = null;
    let taxValueLine = null;
    let contributionProfitLine = null;
    let contributionMarginLine = null;
    let statusCalculo;

    if (isFullyRefundedIncomeRow(row)) {
      // Pedido totalmente reembolsado: sem regra contábil definida, não se
      // inventa prejuízo (LC = 0 − CMV − imposto). Faturamento, repasse e
      // componentes ficam visíveis; lucro e margem ficam de fora.
      statusCalculo = "reembolso_total_pendente_regra";
      fullyRefundedCount += 1;
      fullyRefundedGrossRevenue += grossValue;
      fullyRefundedAmount += row.refunds || 0;

      // Cobertura de custo é eixo independente: continua medindo a base.
      if (hasCost) {
        revenueWithCost += grossValue;
      } else {
        rowsWithoutCost += 1;
        revenueWithoutCost += grossValue;
        ignoredRevenue += grossValue;
        if (row.skuId) unmatchedIds.add(row.skuId);
      }

      auditRows.push({
        origem: "Income",
        motivo:
          `Pedido totalmente reembolsado (pedido ${row.orderId || "(sem ID)"} / ` +
          `SKU ${row.skuId || "(sem ID)"}): repasse zero, venda líquida zero e reembolso registrado. ` +
          "Fora de LC, MC e Resultado Final até a definição da regra de recuperação de produto, CMV e imposto.",
        id_sku: row.skuId || "",
        id_pedido: row.orderId || "",
        id_pagamento: row.paymentId || "",
        id_demonstrativo: row.statementId || "",
        produto: row.productName || "",
        variacao: row.variationName || "",
        quantidade: row.quantity,
        faturamento: gross,
        vendas_liquidas_produtos: row.netProductSalesLine,
        valor_total_liquidar: row.settlementLine,
        reembolsos: row.refunds,
        tem_custo_na_base: hasCost ? "sim" : "não",
        linha_planilha: row.spreadsheetRow,
      });
    } else if (!hasCost) {
      // Custo ausente NUNCA vira zero: o faturamento fica, o lucro não.
      // Sem SKU no Income, só existe custo aqui quando havia exatamente um
      // candidato para o ID — se não achou, ou o ID não tem custo nenhum, ou
      // tem mais de um e não dá para escolher arbitrariamente.
      statusCalculo = "sem_custo";
      rowsWithoutCost += 1;
      revenueWithoutCost += grossValue;
      ignoredRevenue += grossValue;
      if (row.skuId) {
        unmatchedIds.add(row.skuId);
        if (statusForaDoLucro(row.status)) unmatchedCancelled.add(row.skuId);
      }
      const chaveNaoEncontrada = row.skuId && hasSkuText ? `${row.skuId}::${skuText}` : row.skuId || "";
      if (chaveNaoEncontrada && !unmatchedSkuKeysSeen.has(chaveNaoEncontrada)) {
        unmatchedSkuKeysSeen.add(chaveNaoEncontrada);
        unmatchedSkuKeys.push({ id_sku: row.skuId, sku: skuText });
      }
      auditRows.push({
        origem: "Income",
        motivo: row.skuId
          ? (hasSkuText
              ? `ID do SKU ${row.skuId} + SKU "${skuText}" sem custo cadastrado na Base TikTok`
              : `ID do SKU ${row.skuId} sem SKU informado no Income e sem custo único na Base TikTok ` +
                "(o ID tem mais de um custo cadastrado, ou nenhum)")
          : "Linha sem ID do SKU — impossível cruzar com a base",
        id_sku: row.skuId || "",
        sku: skuText,
        id_pedido: row.orderId || "",
        produto: row.productName || "",
        variacao: row.variationName || "",
        faturamento: gross,
        valor_total_liquidar: row.settlementLine,
        linha_planilha: row.spreadsheetRow,
      });
    } else if (!quantidadeEhValida(row.quantity)) {
      // Quantidade ausente/zero/negativa/decimal NÃO vira 1: sem quantidade
      // confiável não existe CMV, logo não existe LC. O faturamento e o
      // repasse continuam visíveis para auditoria.
      statusCalculo = "quantidade_invalida";
      rowsWithInvalidQuantity += 1;
      revenueWithCost += grossValue;
      auditRows.push({
        origem: "Income",
        motivo:
          `Quantidade ${descreverQuantidade(row.quantity)} no pedido ${row.orderId || "(sem ID)"} / ` +
          `SKU ${row.skuId} — CMV, imposto interno e LC não calculados`,
        id_sku: row.skuId,
        id_pedido: row.orderId || "",
        produto: row.productName || "",
        variacao: row.variationName || "",
        quantidade: row.quantity,
        faturamento: gross,
        valor_total_liquidar: row.settlementLine,
        linha_planilha: row.spreadsheetRow,
      });
    } else {
      revenueWithCost += grossValue;

      cmvLine = round2(row.quantity * cost.cost);

      const taxableRevenueLine =
        row.netProductSalesLine !== null ? row.netProductSalesLine : gross;
      taxValueLine =
        taxableRevenueLine === null ? null : round2(taxableRevenueLine * cost.taxDecimal);

      if (hasSettlement) {
        // Repasse já é líquido de comissão/taxas/frete/afiliados/descontos:
        // só CMV e imposto interno são deduzidos aqui.
        contributionProfitLine = round2(
          row.settlementLine - cmvLine - (taxValueLine || 0)
        );
        contributionMarginLine =
          gross && gross !== 0 ? contributionProfitLine / gross : null;

        contributionProfitTotal += contributionProfitLine;
        contributionProfitRowsCount += 1;
        // Só esta linha entra no denominador das margens.
        revenueWithCalculatedProfit += grossValue;
        cmvTotal += cmvLine;
        taxValueTotal += taxValueLine || 0;
        statusCalculo = "calculado";
      } else {
        statusCalculo = "financeiro_pendente";
        auditRows.push({
          origem: "Income",
          motivo: "Sem 'Valor total a ser liquidado' — fora do LC do período",
          id_sku: row.skuId,
          id_pedido: row.orderId || "",
          produto: row.productName || "",
          variacao: row.variationName || "",
          faturamento: gross,
          valor_total_liquidar: null,
          linha_planilha: row.spreadsheetRow,
        });
      }
    }

    detailedRows.push({
      origem: "Income",
      id_pedido: row.orderId || "",
      id_pagamento: row.paymentId || "",
      id_demonstrativo: row.statementId || "",
      data: row.date || "",
      status: row.status || "",

      id_sku: row.skuId || "",
      sku: skuText,
      produto: row.productName || (cost ? cost.productName : null) || "",
      variacao: row.variationName || (cost ? cost.variationName : null) || "",
      quantidade: row.quantity,

      subtotal_antes_descontos: row.grossRevenueLine,
      vendas_liquidas_produtos: row.netProductSalesLine,
      valor_total_liquidar: row.settlementLine,

      descontos_vendedor: row.sellerDiscounts,
      reembolsos: row.refunds,
      frete_liquido: row.netShippingCost,
      comissao_plataforma: row.platformCommission,
      taxas_servico: row.serviceFees,
      comissao_afiliados: row.affiliateCommission,
      impostos_tiktok: row.tiktokTaxes,
      ajustes: row.adjustments,

      custo_unitario: cost ? round2(cost.cost) : null,
      cmv: cmvLine,
      imposto_percentual: cost ? round2(cost.taxPercent) : null,
      imposto_valor: taxValueLine,

      lc: contributionProfitLine,
      mc: contributionMarginLine === null ? null : Number(contributionMarginLine.toFixed(6)),

      status_calculo: statusCalculo,
    });
  }

  // ── Onhold: só visão de pendência, nunca resultado realizado ──────────────
  const pendingRows = [];
  const onholdSkus = new Set();
  let onholdRevenueTotal = 0;
  let onholdWithCostCount = 0;
  let onholdWithoutCostCount = 0;

  for (const row of onhold.rows) {
    const onholdSkuText = String(row.variationName || "").trim();
    const hasCost = !!resolverCustoIncome(costMap, costPorId, row.skuId, onholdSkuText);
    if (hasCost) onholdWithCostCount += 1;
    else onholdWithoutCostCount += 1;
    if (row.skuId) onholdSkus.add(row.skuId);
    onholdRevenueTotal += row.openAmount === null ? 0 : row.openAmount;

    pendingRows.push({
      origem: "Onhold",
      id_pedido: row.orderId || "",
      id_pagamento: row.paymentId || "",
      id_demonstrativo: row.statementId || "",
      data: row.date || "",
      status: row.status || "",
      id_sku: row.skuId || "",
      sku: onholdSkuText,
      produto: row.productName || "",
      variacao: row.variationName || "",
      quantidade: row.quantity,
      valor_em_aberto: row.openAmount,
      custo_na_base: hasCost ? "sim" : "não",
      status_calculo: "em_aberto",
    });
  }

  // ── Possíveis duplicidades (sinalização, nunca remoção) ──────────────────
  let possibleDuplicateRowsCount = 0;
  let possibleDuplicateGroupsCount = 0;
  for (const [key, rows] of duplicateIndex) {
    if (rows.length < 2) continue;
    possibleDuplicateGroupsCount += 1;
    possibleDuplicateRowsCount += rows.length - 1;
    const primeira = rows[0];
    auditRows.push({
      origem: "Income",
      motivo:
        `Possível duplicidade: ${rows.length} linhas repetem integralmente a chave ` +
        "(demonstrativo/pagamento/pedido/SKU/repasse/faturamento/data). " +
        "As linhas foram mantidas no cálculo — confirme no relatório original se houve export repetido.",
      id_sku: primeira.skuId || "",
      id_pedido: primeira.orderId || "",
      id_pagamento: primeira.paymentId || "",
      id_demonstrativo: primeira.statementId || "",
      produto: primeira.productName || "",
      variacao: primeira.variationName || "",
      faturamento: primeira.grossRevenueLine,
      valor_total_liquidar: primeira.settlementLine,
      linha_planilha: rows.map((r) => r.spreadsheetRow).join(", "),
      chave_repetida: key,
    });
  }

  // ── Totais ───────────────────────────────────────────────────────────────
  grossRevenueTotal = round2(grossRevenueTotal);
  productNetSalesTotal = round2(productNetSalesTotal);
  paidRevenueTotal = round2(paidRevenueTotal);
  revenueWithCost = round2(revenueWithCost);
  revenueWithoutCost = round2(revenueWithoutCost);
  revenueWithFinancialData = round2(revenueWithFinancialData);
  revenueWithCalculatedProfit = round2(revenueWithCalculatedProfit);
  revenuePendingFinancialIncome = round2(revenuePendingFinancialIncome);
  onholdRevenueTotal = round2(onholdRevenueTotal);
  cmvTotal = round2(cmvTotal);
  taxValueTotal = round2(taxValueTotal);
  contributionProfitTotal = round2(contributionProfitTotal);
  ignoredRevenue = round2(ignoredRevenue);
  fullyRefundedGrossRevenue = round2(fullyRefundedGrossRevenue);
  fullyRefundedAmount = round2(fullyRefundedAmount);
  partiallyRefundedAmount = round2(partiallyRefundedAmount);

  const coverage = buildCoverage({ revenueWithCost, revenueWithoutCost });

  // Resultado Final: afiliados do relatório TikTok já estão embutidos no
  // repasse, então NÃO existe dedução manual de afiliados aqui.
  const finalResult = round2(contributionProfitTotal - adsValue - venforceValue);

  const financialDataCoveragePercent =
    grossRevenueTotal > 0
      ? round2((revenueWithFinancialData / grossRevenueTotal) * 100)
      : null;

  // Pendência total = Income sem repasse + Onhold (origens preservadas nas
  // linhas; os totais por origem continuam expostos separadamente).
  const revenuePendingFinancial = round2(
    revenuePendingFinancialIncome + onholdRevenueTotal
  );
  const salesPendingFinancialCount =
    salesPendingFinancialIncomeCount + pendingRows.length;

  let financialConfidence;
  if (contributionProfitRowsCount === 0) {
    financialConfidence = "insuficiente";
  } else if (
    rowsWithoutCost > 0 ||
    rowsWithoutId > 0 ||
    salesPendingFinancialIncomeCount > 0 ||
    rowsWithInvalidQuantity > 0 ||
    possibleDuplicateRowsCount > 0 ||
    fullyRefundedCount > 0
  ) {
    financialConfidence = "parcial";
  } else {
    financialConfidence = "confiavel";
  }

  const executiveNotes = [];
  if (unmatchedIds.size > 0) {
    executiveNotes.push(
      `Fechamento parcial: ${unmatchedIds.size} SKU(s) do TikTok sem custo na base vinculada. ` +
        "O faturamento continua completo; LC, MC e Resultado Final cobrem apenas a receita com custo."
    );
  }
  if (salesPendingFinancialIncomeCount > 0) {
    executiveNotes.push(
      `${salesPendingFinancialIncomeCount} linha(s) do Income sem "Valor total a ser liquidado". ` +
        "Elas entram no faturamento, mas ficam fora de LC, MC e Resultado Final."
    );
  }
  if (pendingRows.length > 0) {
    executiveNotes.push(
      `${pendingRows.length} linha(s) em aberto (Onhold), somando ${onholdRevenueTotal.toFixed(2)}. ` +
        "Valores não liquidados — não entram no resultado realizado."
    );
  }
  if (rowsWithInvalidQuantity > 0) {
    executiveNotes.push(
      `${rowsWithInvalidQuantity} linha(s) com quantidade inválida (ausente, zero, negativa ou decimal): ` +
        "CMV, imposto interno e LC não foram calculados para elas. Veja a aba de auditoria com pedido e SKU."
    );
  }
  if (fullyRefundedCount > 0) {
    executiveNotes.push(
      "Existem pedidos totalmente reembolsados. Eles permanecem visíveis no faturamento e na " +
        "auditoria, mas ficaram fora de LC, MC e Resultado Final até a definição da regra de " +
        "recuperação de produto, CMV e imposto."
    );
  }
  if (partiallyRefundedCount > 0) {
    executiveNotes.push(
      `${partiallyRefundedCount} linha(s) com reembolso parcial seguem no LC pela regra atual ` +
        "(o repasse já é líquido do estorno). Os valores estão detalhados na coluna Reembolsos."
    );
  }
  if (possibleDuplicateRowsCount > 0) {
    executiveNotes.push(
      `${possibleDuplicateRowsCount} linha(s) do Income repetem integralmente a chave financeira ` +
        `(${possibleDuplicateGroupsCount} grupo(s)). Nada foi removido: confirme no relatório original ` +
        "se houve export duplicado antes de considerar o fechamento final."
    );
  }
  for (const conflict of costConflicts) {
    executiveNotes.push(
      `Base de custos: ${conflict.id} aparece com custos divergentes. Foi usado o primeiro registro.`
    );
  }
  executiveNotes.push(
    "Comissões, taxas de serviço, frete, afiliados, descontos e reembolsos do relatório já estão " +
      "descontados no repasse do TikTok e não são reaplicados no LC."
  );

  const emptySales = income.rows.length === 0;

  return {
    emptySales,
    summary: {
      calculationMode: CALCULATION_MODE,
      financialConfidence,

      grossRevenueTotal,
      productNetSalesTotal,
      paidRevenueTotal,

      // Cobertura ESTRUTURAL da base (tem custo cadastrado?).
      revenueWithCost: coverage.revenueWithCost,
      revenueWithoutCost: coverage.revenueWithoutCost,
      calculatedCoveragePercent: coverage.calculatedCoveragePercent,
      // Base das MARGENS: só a receita das linhas com LC efetivamente calculado.
      revenueWithCalculatedProfit,

      revenueWithFinancialData,
      revenuePendingFinancial,
      revenuePendingFinancialIncome,
      financialDataCoveragePercent,
      salesPendingFinancialCount,
      salesPendingFinancialIncomeCount,

      settlementTotal: round2(settlementTotal),
      marketplaceFeesTotal: round2(
        platformCommissionTotal + serviceFeesTotal + affiliateFeesReportTotal
      ),
      platformCommissionTotal: round2(platformCommissionTotal),
      serviceFeesTotal: round2(serviceFeesTotal),
      affiliateFeesReportTotal: round2(affiliateFeesReportTotal),
      shippingFeesTotal: round2(shippingFeesTotal),
      refundsTotal: round2(refundsTotal),
      sellerDiscountsTotal: round2(sellerDiscountsTotal),
      adjustmentsTotal: round2(adjustmentsTotal),
      tiktokTaxesTotal: round2(tiktokTaxesTotal),

      cmvTotal,
      taxValueTotal,

      contributionProfitTotal,
      contributionProfitRowsCount,
      // Denominador = receita das linhas com LC calculado (nunca inclui linha
      // com custo mas sem repasse ou sem quantidade válida).
      contributionMarginCalculated: safeRatio(
        contributionProfitTotal,
        revenueWithCalculatedProfit
      ),

      ads: adsValue,
      venforce: venforceValue,
      affiliates: 0,
      adsTotal: adsValue,
      venforceTotal: venforceValue,
      affiliatesTotal: 0,

      finalResult,
      finalMarginCalculated: safeRatio(finalResult, revenueWithCalculatedProfit),

      tacos: safeRatio(adsValue, grossRevenueTotal),
      tacox: safeRatio(adsValue + venforceValue, grossRevenueTotal),

      // Qualidade dos dados do período.
      rowsWithInvalidQuantity,
      possibleDuplicateRowsCount,
      possibleDuplicateGroupsCount,

      // Reembolsos. fullyRefundedAmount/partiallyRefundedAmount seguem a
      // convenção das demais deduções: valor NEGATIVO (dinheiro que saiu).
      fullyRefundedCount,
      fullyRefundedGrossRevenue,
      fullyRefundedAmount,
      partiallyRefundedCount,
      partiallyRefundedAmount,

      onholdCount: pendingRows.length,
      onholdRevenueTotal,
      onholdUniqueSkuCount: onholdSkus.size,
      onholdWithCostCount,
      onholdWithoutCostCount,

      incomeRowsCount: income.rows.length,
      incomeSheetName: income.sheetName,
      onholdSheetName: onhold.sheetName || null,
      costConflicts,
      executiveNotes,
      pendingFinancialWarning:
        revenuePendingFinancial > 0
          ? "Parte dos valores do TikTok Shop ainda não foi liquidada. LC, MC e Resultado Final " +
            "consideram somente as linhas do Income já liquidadas."
          : null,
    },
    detailedRows,
    pendingRows,
    onholdSummary: {
      count: pendingRows.length,
      revenueTotal: onholdRevenueTotal,
      uniqueSkuCount: onholdSkus.size,
      withCostCount: onholdWithCostCount,
      withoutCostCount: onholdWithoutCostCount,
      sheetName: onhold.sheetName || null,
    },
    auditRows,
    excelFileName: "fechamento-tiktok.xlsx",
    unmatchedIds: Array.from(unmatchedIds),
    unmatchedCancelled: Array.from(unmatchedCancelled),
    unmatchedSkuKeys,
    ignoredRowsWithoutCost: rowsWithoutCost,
    ignoredRevenue,
    message: emptySales
      ? "Planilha Income válida sem linhas de venda."
      : unmatchedIds.size > 0
        ? "Alguns SKUs do TikTok não possuem custo na base vinculada. O faturamento foi preservado; LC e MC cobrem apenas a receita com custo."
        : "OK",
  };
}

module.exports = {
  CALCULATION_MODE,
  processTikTok,
  parseTikTokIncomeBuffer,
  parseTikTokOnholdBuffer,
  parseTikTokCostRows,
  buildTikTokCostMap,
  buildTikTokCostKey,
  resolverCustoIncome,
  normalizeTikTokSkuId,
  parseTikTokMoney,
  parseTikTokQuantity,
  quantidadeEhValida,
  buildDuplicateKey,
  isFullyRefundedIncomeRow,
  isPartiallyRefundedIncomeRow,
  detectTikTokHeader,
  sheetToCellMatrix,
  INCOME_FIELDS,
  ONHOLD_FIELDS,
};
