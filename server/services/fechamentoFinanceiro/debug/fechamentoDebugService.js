// server/services/fechamentoFinanceiro/debug/fechamentoDebugService.js
//
// FECHAMENTO INSPECTOR / DEBUG FINANCEIRO — camada de observabilidade.
//
// REGRA DE OURO deste arquivo: nunca reimplementar uma fórmula financeira.
// Tudo aqui é (a) classificação/leitura de planilha reaproveitando os
// detectores reais, (b) chamada direta aos motores reais (processMeli,
// processShopee, processTikTok) com um debugCollector opcional, ou
// (c) composição de funções reais já exportadas (buildShopeePerfSkuBridge,
// buildShopeeCostMap, parseShopeeFinancialRows, lookupShopeeCost) para
// responder "e se a ponte participasse do caminho atual?" sem alterar o
// resultado de produção.
//
// Os "catálogos de coluna" abaixo (MELI_COLUMN_CATALOG, SHOPEE_*_COLUMN_CATALOG)
// são metadado de EXIBIÇÃO — de onde vem o alias e se hoje ele é usado no
// cálculo — espelhando docs/fechamento-shopee-colunas.md e o mapeamento real
// de excelUtils.js. Eles não recalculam nada: servem só para rotular, na
// tela, a mesma decisão que o motor real já tomou.

const XLSX = require("xlsx");
const {
  readSheetRows,
  parseSpreadsheet,
  detectMeliHeader,
  validateMeliHeaderAtRow,
  detectShopeeHeaderRow,
  MELI_HEADER_FIELDS,
} = require("../../../utils/excelUtils");
const { normalizeHeaderName, normalizeShopeeId, normalizeMatchKey } = require("../../../utils/textUtils");
const { toNumber } = require("../../../utils/numberUtils");
const { createDebugCollector, WARNING_CODES } = require("../../../utils/fechamento/debugCollector");

const { processMeli, parseMeliCostRows } = require("../meliFinanceiroService");
const {
  processShopee,
  isShopeePerformanceSheet,
  isShopeeMassUpdateSheet,
  parseShopeeSalesRows,
  parseCostRows: parseShopeeCostRows,
  buildShopeeCostMap,
  buildShopeePerfSkuBridge,
} = require("../shopeePerformanceService");
const {
  isShopeeFinancialOrderSheet,
  parseShopeeFinancialRows,
  detectShopeeAdjustmentColumns,
  lookupShopeeCost,
  SHOPEE_COST_LOOKUP_FIELDS,
} = require("../shopeeOrderAllService");
const {
  processTikTok,
  parseTikTokIncomeBuffer,
  parseTikTokOnholdBuffer,
  parseTikTokCostRows,
  sheetToCellMatrix,
  detectTikTokHeader,
  INCOME_FIELDS,
  ONHOLD_FIELDS,
} = require("../tiktokFinanceiroService");

// ─────────────────────────────────────────────────────────────────────────
// 1. LEITURA DE WORKBOOK / VISÃO GERAL DE ABAS
// ─────────────────────────────────────────────────────────────────────────

function readWorkbook(buffer) {
  return XLSX.read(buffer, { type: "buffer" });
}

// Conta linhas/colunas de uma aba sem materializar tudo em memória como
// objetos — só a matriz crua, que é descartada depois de contar.
function sheetShape(sheet) {
  if (!sheet || !sheet["!ref"]) return { totalRows: 0, totalCols: 0 };
  try {
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    return {
      totalRows: range.e.r - range.s.r + 1,
      totalCols: range.e.c - range.s.c + 1,
    };
  } catch (_) {
    return { totalRows: 0, totalCols: 0 };
  }
}

function overviewSheets(workbook) {
  return workbook.SheetNames.map((name, index) => {
    const shape = sheetShape(workbook.Sheets[name]);
    return { name, index, ...shape };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 2. CLASSIFICAÇÃO DE ARQUIVO — reaproveita os detectores reais de
//    excelUtils.js / shopeeOrderAllService.js / shopeePerformanceService.js /
//    tiktokFinanceiroService.js. Só a PRIMEIRA aba é avaliada para decidir o
//    tipo, porque é a única que parseSpreadsheet() de produção efetivamente
//    lê — as demais abas aparecem aqui marcadas como "ignoradas".
// ─────────────────────────────────────────────────────────────────────────

const FILE_TYPES = Object.freeze({
  MELI_VENDAS: "MELI_VENDAS",
  MELI_CUSTOS: "MELI_CUSTOS",
  SHOPEE_ORDER_ALL: "SHOPEE_ORDER_ALL",
  SHOPEE_PERFORMANCE: "SHOPEE_PERFORMANCE",
  SHOPEE_CUSTOS: "SHOPEE_CUSTOS",
  SHOPEE_MASS_UPDATE: "SHOPEE_MASS_UPDATE",
  TIKTOK_INCOME: "TIKTOK_INCOME",
  TIKTOK_ONHOLD: "TIKTOK_ONHOLD",
  TIKTOK_CUSTOS: "TIKTOK_CUSTOS",
  CUSTOS_AMBIGUO: "CUSTOS_AMBIGUO",
  DESCONHECIDO: "DESCONHECIDO",
});

function looksLikeCostSheet(headers) {
  const norm = headers.map(normalizeHeaderName);
  const hasCusto = norm.some((h) => h.includes("custo"));
  if (!hasCusto) return { isCost: false };

  const hasModelId = norm.some((h) => h.includes("model") || h.includes("id da variacao"));
  const hasMlb = norm.some((h) => h === "id" || h.includes("mlb") || h.includes("numero do anuncio") || h.includes("numero de anuncio"));
  const hasSku = norm.some((h) => h.includes("sku"));
  const hasImposto = norm.some((h) => h.includes("imposto") || h.includes("aliquota"));

  return { isCost: true, hasModelId, hasMlb, hasSku, hasImposto };
}

// Espelha readTikTokWorkbook: o TikTok escolhe a aba pelo cabeçalho
// reconhecido, não pela posição — diferente de MELI/Shopee, que só leem a
// primeira aba. Por isso classificamos TODAS as abas aqui.
function bestTikTokHeaderAcrossSheets(workbook, specs) {
  let best = null;
  for (const sheetName of workbook.SheetNames) {
    const matrix = sheetToCellMatrix(workbook.Sheets[sheetName]);
    if (!matrix.length) continue;
    const header = detectTikTokHeader(matrix, specs, 3);
    if (!best || (header.found && !best.header.found) || (header.found === best.header.found && header.score > best.header.score)) {
      best = { sheetName, header };
    }
  }
  return best;
}

function tryClassifyTikTok(buffer) {
  try {
    const workbook = readWorkbook(buffer);
    const income = bestTikTokHeaderAcrossSheets(workbook, INCOME_FIELDS);
    const onhold = bestTikTokHeaderAcrossSheets(workbook, ONHOLD_FIELDS);
    return { income, onhold };
  } catch (_) {
    return { income: null, onhold: null };
  }
}

function classifyFile({ buffer, originalName, sizeBytes }) {
  const evidence = { originalName };
  let workbook;
  try {
    workbook = readWorkbook(buffer);
  } catch (error) {
    return {
      originalName,
      sizeBytes,
      type: FILE_TYPES.DESCONHECIDO,
      confidence: "nenhuma",
      error: `Falha ao abrir o arquivo como planilha: ${error.message}`,
      sheets: [],
      sheetUsed: null,
      sheetsIgnored: [],
    };
  }

  const sheets = overviewSheets(workbook);
  const sheetUsed = workbook.SheetNames[0] || null;
  const sheetsIgnored = sheets.slice(1);
  const firstSheet = sheetUsed ? workbook.Sheets[sheetUsed] : null;
  const firstSheetRows = firstSheet
    ? XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "", raw: false })
    : [];

  const base = {
    originalName,
    sizeBytes,
    sheets,
    sheetUsed,
    sheetsIgnored: sheetsIgnored.map((s) => ({
      ...s,
      note: `Aba "${s.name}" possui ${s.totalRows} linha(s) e NÃO é lida (o fechamento só processa a primeira aba do arquivo).`,
    })),
  };

  if (!sheetUsed || firstSheetRows.length === 0) {
    return { ...base, type: FILE_TYPES.DESCONHECIDO, confidence: "nenhuma", error: "Planilha vazia." };
  }

  // ── 1. Tenta MELI (vendas) ────────────────────────────────────────────
  const meliDetected = detectMeliHeader(buffer);
  const meliValidated = validateMeliHeaderAtRow(buffer, meliDetected.rowIndex);
  if (meliDetected.found && meliValidated.valid) {
    return {
      ...base,
      type: FILE_TYPES.MELI_VENDAS,
      confidence: meliDetected.score >= 8 ? "alta" : meliDetected.score >= 5 ? "media" : "baixa",
      headerRowIndex: meliDetected.rowIndex,
      headerRow1Based: meliDetected.rowIndex + 1,
      matchedFields: meliDetected.matchedFields,
      headers: meliValidated.headers,
      evidence: { score: meliDetected.score, matchedFields: meliDetected.matchedFields },
    };
  }

  // ── 2. Tenta Shopee (Order.all / performance / mass update) ───────────
  const shopeeHeaderRow = detectShopeeHeaderRow(buffer);
  let shopeeRows = [];
  try {
    shopeeRows = parseSpreadsheet(buffer, shopeeHeaderRow);
  } catch (_) {
    shopeeRows = [];
  }
  if (shopeeRows.length > 0) {
    const headers = Object.keys(shopeeRows[0]);
    if (isShopeeFinancialOrderSheet(shopeeRows)) {
      return {
        ...base,
        type: FILE_TYPES.SHOPEE_ORDER_ALL,
        confidence: "alta",
        headerRowIndex: shopeeHeaderRow,
        headerRow1Based: shopeeHeaderRow + 1,
        headers,
        rowCount: shopeeRows.length,
        evidence: { detector: "isShopeeFinancialOrderSheet" },
      };
    }
    if (isShopeePerformanceSheet(shopeeRows)) {
      return {
        ...base,
        type: FILE_TYPES.SHOPEE_PERFORMANCE,
        confidence: "alta",
        headerRowIndex: shopeeHeaderRow,
        headerRow1Based: shopeeHeaderRow + 1,
        headers,
        rowCount: shopeeRows.length,
        evidence: { detector: "isShopeePerformanceSheet" },
      };
    }
    if (isShopeeMassUpdateSheet(shopeeRows)) {
      return {
        ...base,
        type: FILE_TYPES.SHOPEE_MASS_UPDATE,
        confidence: "alta",
        headers,
        rowCount: shopeeRows.length,
        evidence: { detector: "isShopeeMassUpdateSheet", note: "Reconhecida, mas não suportada pelo fechamento (mesmo comportamento da produção)." },
      };
    }
  }

  // ── 3. Tenta TikTok (Income / Onhold) — escaneia todas as abas, igual à produção ──
  const tiktok = tryClassifyTikTok(buffer);
  if (tiktok.income && tiktok.income.header.found) {
    return {
      ...base,
      type: FILE_TYPES.TIKTOK_INCOME,
      confidence: tiktok.income.header.score >= 5 ? "alta" : "media",
      sheetUsed: tiktok.income.sheetName,
      headers: tiktok.income.header.headers || [],
      evidence: { detector: "detectTikTokHeader(INCOME_FIELDS)", score: tiktok.income.header.score, sheetName: tiktok.income.sheetName },
    };
  }
  if (tiktok.onhold && tiktok.onhold.header.found) {
    return {
      ...base,
      type: FILE_TYPES.TIKTOK_ONHOLD,
      confidence: tiktok.onhold.header.score >= 5 ? "alta" : "media",
      sheetUsed: tiktok.onhold.sheetName,
      headers: tiktok.onhold.header.headers || [],
      evidence: { detector: "detectTikTokHeader(ONHOLD_FIELDS)", score: tiktok.onhold.header.score, sheetName: tiktok.onhold.sheetName },
    };
  }

  // ── 4. Heurística de base de custos (MELI ou Shopee) ───────────────────
  const headerRow = firstSheetRows[0] || [];
  const costLook = looksLikeCostSheet(headerRow.map(String));
  if (costLook.isCost) {
    let costType = FILE_TYPES.CUSTOS_AMBIGUO;
    let confidence = "baixa";
    if (costLook.hasModelId && !costLook.hasMlb) {
      costType = FILE_TYPES.SHOPEE_CUSTOS;
      confidence = "media";
    } else if (costLook.hasMlb && !costLook.hasModelId) {
      costType = FILE_TYPES.MELI_CUSTOS;
      confidence = "media";
    } else if (costLook.hasSku && !costLook.hasMlb) {
      costType = FILE_TYPES.SHOPEE_CUSTOS;
      confidence = "baixa";
    }
    return {
      ...base,
      type: costType,
      confidence,
      headers: headerRow.map(String),
      rowCount: firstSheetRows.length - 1,
      evidence: { heuristic: "looksLikeCostSheet", ...costLook },
      note:
        costType === FILE_TYPES.CUSTOS_AMBIGUO
          ? "Parece base de custos, mas não deu para saber se é MELI ou Shopee só pelo cabeçalho. O Debug tenta usar como custo dos dois motores quando aplicável."
          : undefined,
    };
  }

  const unrecognizedMessage =
    `Nenhum detector (MELI, Shopee, TikTok, base de custos) reconheceu esta planilha. ` +
    `Colunas encontradas: ${headerRow.map(String).filter(Boolean).join(", ") || "nenhuma"}.`;
  return {
    ...base,
    type: FILE_TYPES.DESCONHECIDO,
    confidence: "nenhuma",
    headers: headerRow.map(String),
    rowCount: Math.max(0, firstSheetRows.length - 1),
    error: unrecognizedMessage,
    evidence: { note: unrecognizedMessage },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. RELATÓRIO DE COLUNAS — usa a SAÍDA JÁ CALCULADA pelos parsers reais
//    (flags *Provided, campos normalizados) em vez de reimplementar a
//    detecção de alias.
// ─────────────────────────────────────────────────────────────────────────

// Colunas de dado pessoal nunca aparecem com "exemplo" nem entram no
// relatório de colunas — não são relevantes para depurar o motor financeiro
// e não devem transitar pela resposta do debug (ver seção 22 do pedido).
const PERSONAL_HEADER_HINTS = [
  "cpf",
  "telefone",
  "endereco",
  "endereço",
  "cep",
  "comprador",
  "destinatario",
  "destinatário",
  "nome de usuario",
  "nome de usuário",
  "inscricao estadual",
  "inscrição estadual",
  "observacao do comprador",
  "observação do comprador",
];

function isPersonalColumn(header) {
  const norm = normalizeHeaderName(header);
  return PERSONAL_HEADER_HINTS.some((hint) => norm.includes(normalizeHeaderName(hint)));
}

function nonEmptyStats(rows, headerKey) {
  let nonEmpty = 0;
  let sample = null;
  for (const row of rows) {
    const raw = row ? row[headerKey] : undefined;
    const text = raw === null || raw === undefined ? "" : String(raw).trim();
    if (text !== "") {
      nonEmpty += 1;
      if (sample === null) sample = text.length > 60 ? `${text.slice(0, 60)}…` : text;
    }
  }
  return { nonEmpty, sample };
}

// Catálogo de exibição — fonte de verdade real continua em
// docs/fechamento-shopee-colunas.md / excelUtils.js / MELI_HEADER_FIELDS.
const MELI_COLUMN_NOTES = {
  saleNumber: { usada: "SIM", onde: "parseMeliRows -> agrupamento pai/detalhe" },
  saleDate: { usada: "NÃO (só diagnóstico)", onde: "parseMeliRows" },
  units: { usada: "SIM", onde: "parseMeliRows -> quantidade/rateio" },
  total: { usada: "SIM", onde: "processMeli -> LC (repasse líquido)" },
  productRevenue: { usada: "SIM", onde: "processMeli -> Venda Total" },
  adId: { usada: "SIM", onde: "processMeli -> chave de custo (MLB)" },
  unitPrice: { usada: "SIM (fallback de Venda Total)", onde: "processMeli" },
  saleFee: { usada: "PARCIAL — embutida no Total (BRL), não some como linha própria", onde: "parseMeliRows (hasSaleFee)" },
  shippingFee: { usada: "PARCIAL — embutida no Total (BRL), não some como linha própria", onde: "parseMeliRows (hasShippingFee)" },
  refund: { usada: "SIM", onde: "processMeli -> refundsTotal / lostRevenueTotal" },
};

function buildMeliColumnReport(rawRows) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) return [];
  const headers = Object.keys(rawRows[0]);
  const rows = [];
  const consumedHeaders = new Set();

  for (const [field, aliases] of Object.entries(MELI_HEADER_FIELDS)) {
    const normalizedAliases = aliases.map(normalizeHeaderName);
    const matchedHeader = headers.find((h) => {
      const norm = normalizeHeaderName(h);
      return normalizedAliases.some((a) => norm === a || ` ${norm} `.includes(` ${a} `));
    });
    if (!matchedHeader) {
      rows.push({
        arquivo: "MELI vendas",
        colunaOriginal: null,
        campoNormalizado: field,
        reconhecida: false,
        usada: "N/A",
        onde: null,
        valoresNaoVazios: 0,
        exemplo: null,
        observacao: "Nenhuma coluna do arquivo bate com os aliases conhecidos deste campo.",
      });
      continue;
    }
    consumedHeaders.add(matchedHeader);
    const stats = nonEmptyStats(rawRows, matchedHeader);
    const note = MELI_COLUMN_NOTES[field] || { usada: "SIM", onde: "parseMeliRows" };
    rows.push({
      arquivo: "MELI vendas",
      colunaOriginal: matchedHeader,
      campoNormalizado: field,
      reconhecida: true,
      usada: note.usada,
      onde: note.onde,
      valoresNaoVazios: stats.nonEmpty,
      exemplo: stats.sample,
      observacao: null,
    });
  }

  for (const h of headers) {
    if (consumedHeaders.has(h)) continue;
    if (isPersonalColumn(h)) {
      rows.push({
        arquivo: "MELI vendas",
        colunaOriginal: h,
        campoNormalizado: null,
        reconhecida: false,
        usada: "NÃO",
        onde: null,
        valoresNaoVazios: null,
        exemplo: null,
        observacao: "Dado pessoal — omitido do Debug Financeiro (não é relevante para o cálculo).",
      });
      continue;
    }
    const stats = nonEmptyStats(rawRows, h);
    rows.push({
      arquivo: "MELI vendas",
      colunaOriginal: h,
      campoNormalizado: null,
      reconhecida: false,
      usada: "NÃO",
      onde: null,
      valoresNaoVazios: stats.nonEmpty,
      exemplo: stats.sample,
      observacao: "Coluna real sem alias mapeado neste fluxo — ignorada propositalmente.",
    });
  }

  return rows;
}

function buildMeliCostColumnReport(rawRows) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) return [];
  const parsed = parseMeliCostRows(rawRows);
  const headers = Object.keys(rawRows[0]);
  const withId = parsed.filter((r) => r.id).length;
  const withCost = parsed.filter((r) => r.cost > 0).length;
  const zeroCost = parsed.filter((r) => r.id && r.cost === 0).length;
  return headers.map((h) => {
    const stats = nonEmptyStats(rawRows, h);
    return {
      arquivo: "MELI custos",
      colunaOriginal: h,
      campoNormalizado: null,
      reconhecida: true,
      usada: "SIM (via findField, ver parseMeliCostRows)",
      onde: "buildMeliCostIndex",
      valoresNaoVazios: stats.nonEmpty,
      exemplo: stats.sample,
      observacao: `Linhas com ID reconhecido: ${withId}/${parsed.length}. Com custo > 0: ${withCost}. Custo = 0 explícito: ${zeroCost}.`,
    };
  });
}

const SHOPEE_ORDER_ALL_FIELD_NOTES = [
  { field: "id", label: "ID do pedido", usada: "SIM", onde: "agrupamento por pedido" },
  { field: "product", label: "Nome do produto", usada: "SIM", onde: "exibição / auditoria" },
  { field: "grossRevenue", label: "Subtotal do produto / Faturamento / Preço acordado×qtd", usada: "SIM", onde: "receita bruta" },
  { field: "repasse", providedField: "repasseProvided", label: "Repasse", usada: "SIM quando presente (líquido final)", onde: "orderNet" },
  { field: "transactionFee", providedField: "transactionFeeProvided", label: "Taxa de transação", usada: "SIM (nível pedido)", onde: "feesSum" },
  { field: "commissionNet", providedField: "commissionNetProvided", label: "Taxa de comissão líquida", usada: "SIM (preferida sobre a bruta)", onde: "resolveFeeComponent" },
  { field: "commissionGross", providedField: "commissionGrossProvided", label: "Taxa de comissão bruta", usada: "FALLBACK (só se líquida ausente)", onde: "resolveFeeComponent" },
  { field: "serviceNet", providedField: "serviceNetProvided", label: "Taxa de serviço líquida", usada: "SIM (preferida sobre a bruta)", onde: "resolveFeeComponent" },
  { field: "serviceGross", providedField: "serviceGrossProvided", label: "Taxa de serviço bruta", usada: "FALLBACK (só se líquida ausente)", onde: "resolveFeeComponent" },
  { field: "shipping", providedField: "shippingProvided", label: "Valor estimado do frete", usada: "PARCIAL — só aplicado quando negativo", onde: "shippingApplied" },
  { field: "tax", providedField: "taxProvided", label: "Imposto", usada: "SIM quando presente", onde: "taxLine" },
  { field: "cmv", providedField: "cmvProvided", label: "CMV", usada: "SIM quando presente (prioridade sobre a base de custos)", onde: "cmvLine" },
];

function buildShopeeOrderAllColumnReport(rawRows) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) return [];
  const lines = parseShopeeFinancialRows(rawRows);
  const headers = Object.keys(rawRows[0]);
  const rows = [];

  for (const spec of SHOPEE_ORDER_ALL_FIELD_NOTES) {
    let nonEmpty = 0;
    let example = null;
    for (const line of lines) {
      const provided = spec.providedField ? line[spec.providedField] : line[spec.field] !== undefined && line[spec.field] !== "";
      if (provided) {
        nonEmpty += 1;
        if (example === null) {
          const v = line[spec.field];
          example = v === null || v === undefined ? null : String(v);
        }
      }
    }
    let observacao = null;
    if (spec.field === "shipping" && lines.length) {
      const positivos = lines.filter((l) => l.shippingProvided && l.shipping > 0).length;
      const negativos = lines.filter((l) => l.shippingProvided && l.shipping < 0).length;
      observacao = `${positivos} positivo(s) (não aplicado — sinal indeterminado), ${negativos} negativo(s) (aplicado como custo do frete).`;
    }
    rows.push({
      arquivo: "Shopee Order.all",
      colunaOriginal: spec.label,
      campoNormalizado: spec.field,
      reconhecida: true,
      usada: spec.usada,
      onde: spec.onde,
      valoresNaoVazios: nonEmpty,
      exemplo: example,
      observacao,
    });
  }

  // Colunas de ajuste/cupom — detectadas, nunca somadas de novo.
  const adjustmentCols = detectShopeeAdjustmentColumns(rawRows);
  for (const col of adjustmentCols) {
    const stats = nonEmptyStats(rawRows, col);
    rows.push({
      arquivo: "Shopee Order.all",
      colunaOriginal: col,
      campoNormalizado: "adjustment",
      reconhecida: true,
      usada: "NÃO (listada, não somada — repasse já é líquido dela)",
      onde: "detectShopeeAdjustmentColumns",
      valoresNaoVazios: stats.nonEmpty,
      exemplo: stats.sample,
      observacao: "Ver docs/fechamento-shopee-colunas.md — regra deliberada.",
    });
  }

  const knownRawLabels = new Set(SHOPEE_ORDER_ALL_FIELD_NOTES.map((s) => s.label));
  for (const h of headers) {
    if (adjustmentCols.includes(h)) continue;
    if ([...knownRawLabels].some((label) => normalizeHeaderName(h) === normalizeHeaderName(label))) continue;
    if (isPersonalColumn(h)) {
      rows.push({
        arquivo: "Shopee Order.all",
        colunaOriginal: h,
        campoNormalizado: null,
        reconhecida: false,
        usada: "NÃO",
        onde: null,
        valoresNaoVazios: null,
        exemplo: null,
        observacao: "Dado pessoal — omitido do Debug Financeiro (não é relevante para o cálculo).",
      });
      continue;
    }
    const stats = nonEmptyStats(rawRows, h);
    rows.push({
      arquivo: "Shopee Order.all",
      colunaOriginal: h,
      campoNormalizado: null,
      reconhecida: false,
      usada: "NÃO",
      onde: null,
      valoresNaoVazios: stats.nonEmpty,
      exemplo: stats.sample,
      observacao: "Coluna real sem uso no motor financeiro (dado logístico/pessoal ou não mapeado).",
    });
  }

  return rows;
}

function buildShopeePerformanceColumnReport(rawRows) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) return [];
  const headers = Object.keys(rawRows[0]);
  const usedForClassificationOrCalc = new Set([
    "id do item",
    "id da variacao",
    "id da variação",
    "produto",
    "nome do produto",
    "sku da variacao",
    "sku da variação",
    "sku principle",
    "sku principal",
    "vendas (pedido pago) (brl)",
    "unidades (pedido pago)",
    "impressao do produto",
    "impressão do produto",
    "cliques por produto",
    "ctr",
    "status atual da variacao",
    "status atual da variação",
    "model id",
    "model_id",
  ]);
  return headers.map((h) => {
    const norm = normalizeHeaderName(h);
    const stats = nonEmptyStats(rawRows, h);
    const known = usedForClassificationOrCalc.has(norm);
    return {
      arquivo: "Shopee performance",
      colunaOriginal: h,
      campoNormalizado: known ? norm : null,
      reconhecida: known,
      usada: known ? "SIM" : "NÃO",
      onde: known ? "parseShopeeSalesRows / isShopeePerformanceSheet / buildShopeePerfSkuBridge" : null,
      valoresNaoVazios: stats.nonEmpty,
      exemplo: stats.sample,
      observacao: known ? null : "Coluna real não usada no cálculo financeiro deste motor.",
    };
  });
}

function buildShopeeCostColumnReport(rawRows) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) return [];
  const parsed = parseShopeeCostRows(rawRows);
  const headers = Object.keys(rawRows[0]);
  const withSku = parsed.filter((r) => r.sku).length;
  const withNumericId = parsed.filter((r) => r.id || r.modelId).length;
  return headers.map((h) => {
    const stats = nonEmptyStats(rawRows, h);
    return {
      arquivo: "Shopee custos",
      colunaOriginal: h,
      campoNormalizado: null,
      reconhecida: true,
      usada: "SIM (via findField, ver parseCostRows)",
      onde: "buildShopeeCostMap",
      valoresNaoVazios: stats.nonEmpty,
      exemplo: stats.sample,
      observacao: `Linhas com SKU: ${withSku}/${parsed.length}. Linhas com ID/Model ID numérico: ${withNumericId}/${parsed.length}.`,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 4. PONTE SHOPEE (Order.all -> Performance -> Base) — seção 9 do pedido.
//    Composição de funções REAIS já exportadas. Não é um motor novo: só
//    responde "quanto seria resolvível se a ponte participasse do caminho
//    atual", sem alterar o resultado de produção.
// ─────────────────────────────────────────────────────────────────────────

function buildShopeeBridgeDiagnostic({ orderAllRowsRaw, performanceRowsRaw, costRowsRaw }) {
  const diagnostic = {
    available: Array.isArray(orderAllRowsRaw) && orderAllRowsRaw.length > 0,
    directMatch: { hit: 0, total: 0, percent: 0 },
    orderToPerformance: { hit: 0, total: 0, percent: 0 },
    performanceToBase: { hit: 0, total: 0, percent: 0 },
    fullBridge: { hit: 0, total: 0, percent: 0 },
    items: [],
    conclusion: null,
  };
  if (!diagnostic.available) return diagnostic;

  const orderLines = parseShopeeFinancialRows(orderAllRowsRaw);
  const costMap = Array.isArray(costRowsRaw) && costRowsRaw.length ? buildShopeeCostMap(costRowsRaw) : new Map();
  const perfBridge =
    Array.isArray(performanceRowsRaw) && performanceRowsRaw.length
      ? buildShopeePerfSkuBridge(performanceRowsRaw)
      : new Map();
  const perfAvailable = Array.isArray(performanceRowsRaw) && performanceRowsRaw.length > 0;

  // Performance -> Base: reaproveita os IDs que a própria performance expõe.
  let perfToBaseHit = 0;
  let perfToBaseTotal = 0;
  if (perfAvailable) {
    const perfItems = parseShopeeSalesRows(performanceRowsRaw);
    perfToBaseTotal = perfItems.length;
    for (const item of perfItems) {
      const idKeyCandidates = [item.variationId, item.saleModelId, item.itemId].filter(Boolean);
      const hit = idKeyCandidates.some((id) => costMap.get(normalizeMatchKey(id)));
      if (hit) perfToBaseHit += 1;
    }
  }
  diagnostic.performanceToBase = {
    hit: perfToBaseHit,
    total: perfToBaseTotal,
    percent: perfToBaseTotal ? Number(((perfToBaseHit / perfToBaseTotal) * 100).toFixed(2)) : 0,
  };

  let directHit = 0;
  let bridgeHit = 0;
  let fullBridgeHit = 0;
  const items = [];

  for (const line of orderLines) {
    const skuCandidates = [line.skuVariation, line.skuPrinciple, line.skuMainRef, line.skuRefNumber, line.sku].filter(
      Boolean
    );

    // 1. Match direto: EXATAMENTE o que o motor real faz hoje.
    const directCost = lookupShopeeCost(costMap, line);
    if (directCost) directHit += 1;

    // 2. Order.all -> Performance: a ponte já existente (buildShopeePerfSkuBridge),
    //    hoje só usada para reconciliar status, nunca para custo.
    let bridgeIds = null;
    for (const sku of skuCandidates) {
      const found = perfBridge.get(normalizeShopeeId(sku));
      if (found) {
        bridgeIds = found;
        break;
      }
    }
    if (bridgeIds) bridgeHit += 1;

    // 3. Performance -> Base, aplicado ao ID resolvido pela ponte deste item.
    let bridgeCost = null;
    if (bridgeIds) {
      const idCandidates = [bridgeIds.idVariacao, bridgeIds.idItem].filter(Boolean);
      for (const id of idCandidates) {
        const hit = costMap.get(normalizeMatchKey(id));
        if (hit) {
          bridgeCost = hit;
          break;
        }
      }
    }
    if (bridgeCost) fullBridgeHit += 1;

    items.push({
      orderId: line.id,
      product: line.product,
      skuUsado: skuCandidates[0] || null,
      skuCandidates,
      matchDireto: Boolean(directCost),
      custoDireto: directCost ? { custo: directCost.cost, imposto: directCost.taxPercent } : null,
      bridgeDisponivel: Boolean(bridgeIds),
      bridgeIds: bridgeIds || null,
      matchViaBridge: Boolean(bridgeCost),
      custoViaBridge: bridgeCost ? { custo: bridgeCost.cost, imposto: bridgeCost.taxPercent } : null,
    });
  }

  const total = orderLines.length;
  diagnostic.directMatch = { hit: directHit, total, percent: total ? Number(((directHit / total) * 100).toFixed(2)) : 0 };
  diagnostic.orderToPerformance = {
    hit: bridgeHit,
    total,
    percent: total ? Number(((bridgeHit / total) * 100).toFixed(2)) : 0,
  };
  diagnostic.fullBridge = {
    hit: fullBridgeHit,
    total,
    percent: total ? Number(((fullBridgeHit / total) * 100).toFixed(2)) : 0,
  };
  diagnostic.items = items;

  if (diagnostic.directMatch.percent < diagnostic.fullBridge.percent - 1) {
    diagnostic.conclusion =
      `O financeiro real perdeu cobertura de custo porque a ponte SKU -> ID (performance) não participa do ` +
      `caminho atual: match direto ${diagnostic.directMatch.percent}% vs. ${diagnostic.fullBridge.percent}% ` +
      `resolvível via Order.all -> Performance -> Base.`;
  } else if (total > 0) {
    diagnostic.conclusion = "A ponte não muda a cobertura de forma relevante para este conjunto de arquivos.";
  }

  return diagnostic;
}

// ─────────────────────────────────────────────────────────────────────────
// 5. ORQUESTRAÇÃO — chama os motores REAIS (com debugCollector opcional) e
//    monta o payload de /fechamentos/financeiro/debug. Nenhuma fórmula
//    financeira é recalculada aqui: cada `result.engines.*` é exatamente o
//    retorno de processMeli/processShopee/processTikTok.
// ─────────────────────────────────────────────────────────────────────────

const SAMPLE_LIMIT = 500;
const MATCH_LIMIT = 4000;
const BRIDGE_ITEMS_LIMIT = 1000;

function capArray(arr, limit) {
  const list = Array.isArray(arr) ? arr : [];
  return { items: list.slice(0, limit), totalCount: list.length, truncated: list.length > limit };
}

function rawRowsForFile(fileEntry) {
  if (!fileEntry || !fileEntry.classification.sheetUsed) return [];
  try {
    if (fileEntry.classification.type === FILE_TYPES.MELI_VENDAS) {
      return parseSpreadsheet(fileEntry.buffer, fileEntry.classification.headerRowIndex || 0);
    }
    if (
      [FILE_TYPES.SHOPEE_ORDER_ALL, FILE_TYPES.SHOPEE_PERFORMANCE, FILE_TYPES.SHOPEE_MASS_UPDATE].includes(
        fileEntry.classification.type
      )
    ) {
      return parseSpreadsheet(fileEntry.buffer, fileEntry.classification.headerRowIndex || 0);
    }
    // Bases de custo (MELI/Shopee/ambígua) e desconhecidos: linha 0 (sem cabeçalho especial).
    return parseSpreadsheet(fileEntry.buffer, 0);
  } catch (error) {
    return [];
  }
}

function pickPrimary(entries, type) {
  const matches = entries.filter((e) => e.classification.type === type);
  if (!matches.length) return null;
  matches.slice(1).forEach((e) => {
    e.roleNote = `Papel duplicado (${type}) — já existe outro arquivo com este papel; este foi ignorado na execução dos motores, mas continua listado em Arquivos/Colunas.`;
  });
  return matches[0];
}

function pushWarning(warnings, entry) {
  warnings.push(entry);
}

// input: { uploadedFiles: [{ buffer, originalName, sizeBytes }], ads, venforce, affiliates, fullCost, additionalCosts }
function runFechamentoDebug(input) {
  const uploadedFiles = Array.isArray(input.uploadedFiles) ? input.uploadedFiles : [];
  const ads = toNumber(input.ads);
  const venforce = toNumber(input.venforce);
  const affiliates = toNumber(input.affiliates);
  const fullCost = toNumber(input.fullCost);
  const additionalCosts = toNumber(input.additionalCosts);

  const warnings = [];
  const ignored = [];

  const entries = uploadedFiles.map((f) => ({
    buffer: f.buffer,
    originalName: f.originalName,
    sizeBytes: f.sizeBytes,
    classification: classifyFile({ buffer: f.buffer, originalName: f.originalName, sizeBytes: f.sizeBytes }),
    roleNote: null,
  }));

  for (const entry of entries) {
    for (const ignoredSheet of entry.classification.sheetsIgnored || []) {
      pushWarning(warnings, {
        code: WARNING_CODES.SHEET_IGNORED,
        severity: "info",
        file: entry.originalName,
        message: ignoredSheet.note,
        rowsAffected: ignoredSheet.totalRows,
      });
    }
    if (entry.classification.type === FILE_TYPES.DESCONHECIDO) {
      pushWarning(warnings, {
        code: WARNING_CODES.FILE_UNRECOGNIZED,
        severity: "warning",
        file: entry.originalName,
        message: `Nenhum detector reconheceu "${entry.originalName}". Colunas encontradas: ${(entry.classification.headers || []).join(", ") || "nenhuma"}.`,
      });
      ignored.push({ file: entry.originalName, reason: "tipo não reconhecido" });
    }
    if (entry.classification.type === FILE_TYPES.CUSTOS_AMBIGUO) {
      pushWarning(warnings, {
        code: WARNING_CODES.HEADER_UNCERTAIN,
        severity: "warning",
        file: entry.originalName,
        message: `"${entry.originalName}" parece base de custos, mas não foi possível confirmar se é MELI ou Shopee só pelo cabeçalho.`,
      });
    }
    if (entry.classification.type === FILE_TYPES.SHOPEE_MASS_UPDATE) {
      pushWarning(warnings, {
        code: WARNING_CODES.FILE_UNRECOGNIZED,
        severity: "warning",
        file: entry.originalName,
        message: `"${entry.originalName}" é uma planilha Shopee de atualização em massa — mesmo comportamento da produção, não é suportada pelo fechamento.`,
      });
    }
  }

  const meliVendas = pickPrimary(entries, FILE_TYPES.MELI_VENDAS);
  const meliCustos = pickPrimary(entries, FILE_TYPES.MELI_CUSTOS);
  const shopeeOrderAll = pickPrimary(entries, FILE_TYPES.SHOPEE_ORDER_ALL);
  const shopeePerformance = pickPrimary(entries, FILE_TYPES.SHOPEE_PERFORMANCE);
  const shopeeCustos = pickPrimary(entries, FILE_TYPES.SHOPEE_CUSTOS) || pickPrimary(entries, FILE_TYPES.CUSTOS_AMBIGUO);
  const tiktokIncome = pickPrimary(entries, FILE_TYPES.TIKTOK_INCOME);
  const tiktokOnhold = pickPrimary(entries, FILE_TYPES.TIKTOK_ONHOLD);
  const tiktokCustos = pickPrimary(entries, FILE_TYPES.TIKTOK_CUSTOS);
  const meliCustosResolved = meliCustos || pickPrimary(entries, FILE_TYPES.CUSTOS_AMBIGUO);

  const rawRows = {
    meliVendas: meliVendas ? rawRowsForFile(meliVendas) : [],
    meliCustos: meliCustosResolved ? rawRowsForFile(meliCustosResolved) : [],
    shopeeOrderAll: shopeeOrderAll ? rawRowsForFile(shopeeOrderAll) : [],
    shopeePerformance: shopeePerformance ? rawRowsForFile(shopeePerformance) : [],
    shopeeCustos: shopeeCustos ? rawRowsForFile(shopeeCustos) : [],
  };

  const columns = [];
  if (meliVendas) columns.push(...buildMeliColumnReport(rawRows.meliVendas));
  if (meliCustosResolved) columns.push(...buildMeliCostColumnReport(rawRows.meliCustos));
  if (shopeeOrderAll) columns.push(...buildShopeeOrderAllColumnReport(rawRows.shopeeOrderAll));
  if (shopeePerformance) columns.push(...buildShopeePerformanceColumnReport(rawRows.shopeePerformance));
  if (shopeeCustos) columns.push(...buildShopeeCostColumnReport(rawRows.shopeeCustos));

  const engines = { meli: null, shopee_real: null, shopee_performance: null, tiktok: null };
  const matchAttemptsByEngine = { meli: [], shopee_real: [], shopee_performance: [] };

  // ── MELI ────────────────────────────────────────────────────────────────
  if (meliVendas) {
    const collector = createDebugCollector();
    try {
      const result = processMeli(
        rawRows.meliVendas,
        rawRows.meliCustos,
        ads,
        venforce,
        affiliates,
        fullCost,
        additionalCosts,
        collector
      );
      engines.meli = result;
      matchAttemptsByEngine.meli = collector.snapshot().matchAttempts;
      if (!meliCustosResolved) {
        pushWarning(warnings, {
          code: WARNING_CODES.COST_MISSING,
          severity: "warning",
          file: meliVendas.originalName,
          message: "Nenhuma base de custos MELI foi enviada — o motor rodou com custo vazio (faturamento preservado, LC/MC ausentes em tudo).",
        });
      }
      for (const note of result?.summary?.executiveNotes || []) {
        pushWarning(warnings, { code: "ENGINE_NOTE", severity: "info", engine: "meli", message: note });
      }
    } catch (error) {
      engines.meli = { error: error.message, diagnostics: error.diagnostics || null };
      pushWarning(warnings, {
        code: WARNING_CODES.PARSE_ERROR,
        severity: "error",
        engine: "meli",
        file: meliVendas.originalName,
        message: error.message,
      });
    }
  }

  // ── Shopee real (Order.all) ────────────────────────────────────────────
  if (shopeeOrderAll) {
    const collector = createDebugCollector();
    try {
      const result = processShopee(rawRows.shopeeOrderAll, rawRows.shopeeCustos, ads, venforce, affiliates, null, collector);
      engines.shopee_real = result;
      matchAttemptsByEngine.shopee_real = collector.snapshot().matchAttempts;
      if (!shopeeCustos) {
        pushWarning(warnings, {
          code: WARNING_CODES.COST_MISSING,
          severity: "warning",
          file: shopeeOrderAll.originalName,
          message: "Nenhuma base de custos Shopee foi enviada — motor real rodou com custo vazio.",
        });
      } else if (result?.summary?.revenueWithCost === 0 && result?.summary?.grossRevenueTotal > 0) {
        pushWarning(warnings, {
          code: WARNING_CODES.COST_MATCH_FAILED,
          severity: "error",
          engine: "shopee_real",
          message: `0% de cobertura de custo: nenhuma chave de "${shopeeOrderAll.originalName}" bateu com "${shopeeCustos.originalName}". Veja a aba Ponte Shopee.`,
        });
      }
      for (const note of result?.summary?.executiveNotes || []) {
        pushWarning(warnings, { code: "ENGINE_NOTE", severity: "info", engine: "shopee_real", message: note });
      }
    } catch (error) {
      engines.shopee_real = { error: error.message };
      pushWarning(warnings, {
        code: WARNING_CODES.PARSE_ERROR,
        severity: "error",
        engine: "shopee_real",
        file: shopeeOrderAll.originalName,
        message: error.message,
      });
    }
  }

  // ── Shopee estimado (performance) ──────────────────────────────────────
  if (shopeePerformance) {
    const collector = createDebugCollector();
    try {
      const result = processShopee(
        rawRows.shopeePerformance,
        rawRows.shopeeCustos,
        ads,
        venforce,
        affiliates,
        rawRows.shopeeOrderAll.length ? rawRows.shopeeOrderAll : null,
        collector
      );
      engines.shopee_performance = result;
      matchAttemptsByEngine.shopee_performance = collector.snapshot().matchAttempts;
      for (const note of result?.summary?.executiveNotes || []) {
        pushWarning(warnings, { code: "ENGINE_NOTE", severity: "info", engine: "shopee_performance", message: note });
      }
    } catch (error) {
      engines.shopee_performance = { error: error.message };
      pushWarning(warnings, {
        code: WARNING_CODES.PARSE_ERROR,
        severity: "error",
        engine: "shopee_performance",
        file: shopeePerformance.originalName,
        message: error.message,
      });
    }
  }

  // ── TikTok (v1: sem debugCollector — ver limitações no doc) ────────────
  if (tiktokIncome) {
    try {
      const costRows = tiktokCustos ? rawRowsForFile(tiktokCustos) : [];
      const result = processTikTok({
        salesBuffer: tiktokIncome.buffer,
        onholdBuffer: tiktokOnhold ? tiktokOnhold.buffer : null,
        costRowsRaw: costRows,
        ads,
        venforce,
      });
      engines.tiktok = result;
      if (!tiktokCustos) {
        pushWarning(warnings, {
          code: WARNING_CODES.COST_MISSING,
          severity: "warning",
          file: tiktokIncome.originalName,
          message: "Nenhuma base de custos TikTok foi enviada.",
        });
      }
    } catch (error) {
      engines.tiktok = { error: error.message };
      pushWarning(warnings, {
        code: WARNING_CODES.PARSE_ERROR,
        severity: "error",
        engine: "tiktok",
        file: tiktokIncome.originalName,
        message: error.message,
      });
    }
    pushWarning(warnings, {
      code: "TIKTOK_LIMITED_TRACE",
      severity: "info",
      engine: "tiktok",
      message: "V1 do Debug Financeiro roda o motor real do TikTok, mas ainda não instrumenta match trace linha a linha (ver docs/FINANCEIRO_DEBUG_INSPECTOR_V1.md).",
    });
  }

  // ── Ponte Shopee (seção 9): sempre que houver Order.all e/ou performance ──
  const bridge = buildShopeeBridgeDiagnostic({
    orderAllRowsRaw: rawRows.shopeeOrderAll,
    performanceRowsRaw: rawRows.shopeePerformance,
    costRowsRaw: rawRows.shopeeCustos,
  });
  if (bridge.available && bridge.directMatch.percent < bridge.fullBridge.percent - 1) {
    pushWarning(warnings, {
      code: WARNING_CODES.BRIDGE_AVAILABLE_NOT_USED,
      severity: "warning",
      engine: "shopee_real",
      message: bridge.conclusion,
    });
  }

  // ── Pipeline (seção 5 do pedido) ───────────────────────────────────────
  const filesOk = entries.filter((e) => e.classification.type !== FILE_TYPES.DESCONHECIDO).length;
  const enginesRun = Object.values(engines).filter(Boolean);
  const enginesOk = enginesRun.filter((e) => !e.error).length;
  const pipeline = [
    { stage: "ARQUIVOS", status: entries.length === 0 ? "bloqueado" : filesOk === entries.length ? "ok" : "warning", detail: `${filesOk}/${entries.length} reconhecidos` },
    { stage: "PARSING", status: entries.length === 0 ? "bloqueado" : "ok", detail: `${entries.length} arquivo(s) lidos` },
    {
      stage: "NORMALIZAÇÃO",
      status: "ok",
      detail: `${rawRows.meliVendas.length + rawRows.shopeeOrderAll.length + rawRows.shopeePerformance.length} linha(s) normalizadas`,
    },
    {
      stage: "CLASSIFICAÇÃO",
      status: entries.some((e) => e.classification.type === FILE_TYPES.DESCONHECIDO || e.classification.type === FILE_TYPES.CUSTOS_AMBIGUO) ? "warning" : "ok",
      detail: entries.map((e) => `${e.originalName}: ${e.classification.type}`).join(" | "),
    },
    {
      stage: "CONCILIAÇÃO",
      status: bridge.available ? (bridge.directMatch.percent < 50 ? "warning" : "ok") : "ok",
      detail: bridge.available ? `match direto ${bridge.directMatch.hit}/${bridge.directMatch.total}` : "sem Order.all para conciliar",
    },
    {
      stage: "CÁLCULO",
      status: enginesRun.length === 0 ? "bloqueado" : enginesOk === enginesRun.length ? "ok" : "warning",
      detail: `${enginesOk}/${enginesRun.length} motor(es) calcularam sem erro`,
    },
    {
      stage: "RESULTADO",
      status:
        enginesRun.length === 0
          ? "bloqueado"
          : enginesRun.some((e) => e?.summary?.financialConfidence === "confiavel")
            ? "ok"
            : "warning",
      detail: enginesRun.map((e) => e?.summary?.financialConfidence || e?.error || "—").join(" | "),
    },
  ];

  // Capado POR MOTOR (não globalmente): um dataset MELI grande não pode
  // varrer o trace do Shopee da resposta.
  const matchAttempts = {
    meli: capArray(matchAttemptsByEngine.meli, MATCH_LIMIT),
    shopee_real: capArray(matchAttemptsByEngine.shopee_real, MATCH_LIMIT),
    shopee_performance: capArray(matchAttemptsByEngine.shopee_performance, MATCH_LIMIT),
  };

  return {
    ok: true,
    result: { engines },
    debug: {
      files: entries.map((e) => ({
        originalName: e.originalName,
        sizeBytes: e.sizeBytes,
        classification: e.classification,
        roleNote: e.roleNote,
      })),
      pipeline,
      columns,
      classification: entries.map((e) => e.classification),
      reconciliation: {
        meli: engines.meli && !engines.meli.error ? engines.meli.summary : null,
        shopeeReal: engines.shopee_real && !engines.shopee_real.error ? engines.shopee_real.summary : null,
        shopeePerformance: engines.shopee_performance && !engines.shopee_performance.error ? engines.shopee_performance.summary : null,
      },
      matchAttempts,
      bridges: {
        shopee: { ...bridge, items: capArray(bridge.items, BRIDGE_ITEMS_LIMIT) },
      },
      detailedRowsSample: {
        meli: engines.meli && !engines.meli.error ? capArray(engines.meli.detailedRows, SAMPLE_LIMIT) : null,
        shopeeReal: engines.shopee_real && !engines.shopee_real.error ? capArray(engines.shopee_real.detailedRows, SAMPLE_LIMIT) : null,
        shopeePerformance:
          engines.shopee_performance && !engines.shopee_performance.error
            ? capArray(engines.shopee_performance.detailedRows, SAMPLE_LIMIT)
            : null,
        tiktok: engines.tiktok && !engines.tiktok.error ? capArray(engines.tiktok.detailedRows, SAMPLE_LIMIT) : null,
      },
      warnings,
      ignored,
    },
  };
}

module.exports = {
  FILE_TYPES,
  readWorkbook,
  overviewSheets,
  classifyFile,
  buildMeliColumnReport,
  buildMeliCostColumnReport,
  buildShopeeOrderAllColumnReport,
  buildShopeePerformanceColumnReport,
  buildShopeeCostColumnReport,
  buildShopeeBridgeDiagnostic,
  runFechamentoDebug,
  isPersonalColumn,
  PERSONAL_HEADER_HINTS,
};
