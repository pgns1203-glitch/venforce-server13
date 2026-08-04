// server/utils/excelUtils.js
// Helpers de leitura/parsing de planilhas XLSX. As detecções de cabeçalho
// dependem de repairWorksheetRef ter sido aplicado antes.

const XLSX = require("xlsx");
const { normalizeHeaderName, normalizeText } = require("./textUtils");

const MELI_HEADER_FIELDS = Object.freeze({
  saleNumber: [
    "número de venda", "número da venda", "id de venda", "id da venda",
    "venda número", "venda id",
  ],
  saleDate: [
    "data da venda", "data de venda", "data e hora da venda",
    "data e hora de venda", "data/hora da venda", "data",
  ],
  units: [
    "unidades", "unidade", "quantidade", "quantidade de unidades",
    "quantidade de produtos", "qtd", "qtde",
  ],
  total: [
    "total (brl)", "total", "valor total (brl)", "valor total",
    "receita líquida", "receita liquida", "valor líquido", "valor liquido",
  ],
  productRevenue: [
    "receita por produtos (brl)", "receita por produtos",
    "receita dos produtos (brl)", "receita dos produtos",
    "receita de produtos", "receita por venda", "valor dos produtos", "subtotal dos produtos",
  ],
  adId: [
    "# de anúncio", "# do anúncio", "número do anúncio", "número de anúncio",
    "id do anúncio", "id de anúncio", "código do anúncio", "anúncio id", "mlb",
  ],
  unitPrice: [
    "preço unitário de venda do anúncio (brl)",
    "preço unitário de venda do anúncio", "preço unitário (brl)",
    "preço unitário", "valor unitário (brl)", "valor unitário",
  ],
  saleFee: [
    "tarifa de venda e impostos (brl)", "tarifa de venda e impostos",
    "tarifas de venda e impostos", "tarifas por venda (brl)",
    "tarifas por venda", "tarifa por venda", "tarifa de venda",
  ],
  shippingFee: [
    "tarifas de envio (brl)", "tarifas de envio", "tarifa de envio",
    "custo de envio", "frete (brl)", "frete",
  ],
  refund: [
    "cancelamentos e reembolsos (brl)", "cancelamentos e reembolsos",
    "cancelamento e reembolso", "devoluções e reembolsos (brl)",
    "devoluções e reembolsos", "reembolsos (brl)", "reembolsos",
  ],
});

const NORMALIZED_MELI_HEADER_FIELDS = Object.fromEntries(
  Object.entries(MELI_HEADER_FIELDS).map(([field, aliases]) => [
    field,
    aliases.map(normalizeHeaderName),
  ])
);

function headerMatchesAlias(header, alias) {
  if (!header || !alias) return false;
  return header === alias || ` ${header} `.includes(` ${alias} `);
}

function repairWorksheetRef(sheet) {
  if (!sheet || typeof sheet !== "object") return sheet;

  const cells = Object.keys(sheet).filter((key) => key && key[0] !== "!");
  if (!cells.length) return sheet;

  let minR = Infinity;
  let minC = Infinity;
  let maxR = 0;
  let maxC = 0;

  for (const addr of cells) {
    try {
      const cell = XLSX.utils.decode_cell(addr);
      minR = Math.min(minR, cell.r);
      minC = Math.min(minC, cell.c);
      maxR = Math.max(maxR, cell.r);
      maxC = Math.max(maxC, cell.c);
    } catch (_) {
      // ignora chaves não compatíveis com endereço de célula
    }
  }

  if (Number.isFinite(minR) && Number.isFinite(minC)) {
    sheet["!ref"] = XLSX.utils.encode_range({
      s: { r: minR, c: minC },
      e: { r: maxR, c: maxC },
    });
  }

  return sheet;
}

// CSV vem como bytes crus: sem codepage, o xlsx assume a página padrão e
// "Custo unitário" chega como "Custo unitÃ¡rio", quebrando a detecção por
// cabeçalho. Só forçamos UTF-8 quando o buffer realmente decodifica como UTF-8
// (ASCII puro também passa e fica idêntico ao comportamento anterior).
function bufferEhUtf8(buffer) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch (_) {
    return false;
  }
}

function lerWorkbookPlanilha(fileBuffer, originalName) {
  const ext = String(originalName || "").toLowerCase().slice(-4);
  const opcoes = { type: "buffer" };
  if (ext === ".csv" && bufferEhUtf8(fileBuffer)) opcoes.codepage = 65001;
  return XLSX.read(fileBuffer, opcoes);
}

function readSheetRows(fileBuffer) {
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error("A planilha enviada está vazia.");
  }

  const sheet = workbook.Sheets[firstSheetName];
  repairWorksheetRef(sheet);

  const decodedRange = sheet["!ref"]
    ? XLSX.utils.decode_range(sheet["!ref"])
    : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const firstRowIndex = decodedRange.s.r;

  const rowsAsArrays = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  return { workbook, sheet, rowsAsArrays, firstRowIndex };
}

function parseSpreadsheet(fileBuffer, skipRows = 0) {
  const { sheet } = readSheetRows(fileBuffer);

  return XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
    range: skipRows,
  });
}

function analyzeMeliHeaderCells(cells) {
  const headers = (cells || [])
    .map((cell) => String(cell ?? "").trim())
    .filter(Boolean);
  const normalizedHeaders = headers.map(normalizeHeaderName);
  const matchedFields = [];

  for (const [field, aliases] of Object.entries(NORMALIZED_MELI_HEADER_FIELDS)) {
    if (normalizedHeaders.some((header) => aliases.some((alias) => headerMatchesAlias(header, alias)))) {
      matchedFields.push(field);
    }
  }

  return { headers, matchedFields, score: matchedFields.length };
}

function validateMeliHeaderAtRow(fileBuffer, rowIndex) {
  const { sheet } = readSheetRows(fileBuffer);
  const decodedRange = sheet["!ref"]
    ? XLSX.utils.decode_range(sheet["!ref"])
    : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const absoluteRowIndex = Math.max(0, Number(rowIndex) || 0);
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
    range: {
      s: { r: absoluteRowIndex, c: decodedRange.s.c },
      e: { r: absoluteRowIndex, c: decodedRange.e.c },
    },
  });
  const analysis = analyzeMeliHeaderCells(rows[0] || []);
  const hasSaleNumber = analysis.matchedFields.includes("saleNumber");
  const hasUnits = analysis.matchedFields.includes("units");
  const hasRevenue = analysis.matchedFields.some(
    (field) => field === "productRevenue" || field === "total"
  );
  const hasAdId = analysis.matchedFields.includes("adId");

  return {
    ...analysis,
    rowIndex: absoluteRowIndex,
    valid: hasSaleNumber && hasUnits && hasRevenue && hasAdId,
  };
}

function detectMeliHeader(fileBuffer) {
  const { rowsAsArrays, firstRowIndex } = readSheetRows(fileBuffer);
  let best = null;

  for (let i = 0; i < rowsAsArrays.length; i++) {
    const { headers, matchedFields, score } = analyzeMeliHeaderCells(rowsAsArrays[i]);
    const absoluteRowIndex = firstRowIndex + i;
    if (!best || score > best.score || (score === best.score && headers.length > best.headers.length)) {
      best = {
        rowIndex: absoluteRowIndex,
        relativeRowIndex: i,
        firstRowIndex,
        headers,
        matchedFields,
        score,
      };
    }
  }

  const hasIdentity = best?.matchedFields.some((field) => field === "saleNumber" || field === "adId");
  const hasQuantity = best?.matchedFields.includes("units");
  const hasRevenue = best?.matchedFields.some(
    (field) => field === "total" || field === "productRevenue" || field === "unitPrice"
  );
  const found = Boolean(best && best.score >= 3 && hasIdentity && hasQuantity && hasRevenue);

  if (!best) {
    return {
      rowIndex: firstRowIndex,
      relativeRowIndex: 0,
      firstRowIndex,
      headers: [],
      matchedFields: [],
      score: 0,
      found: false,
    };
  }

  return { ...best, found };
}

function detectMeliHeaderRow(fileBuffer) {
  return detectMeliHeader(fileBuffer).rowIndex;
}

function detectShopeeHeaderRow(fileBuffer) {
  const { rowsAsArrays } = readSheetRows(fileBuffer);

  for (let i = 0; i < rowsAsArrays.length; i++) {
    const joined = (rowsAsArrays[i] || [])
      .map((cell) => normalizeText(cell))
      .join(" | ");

    if (
      joined.includes("id do item") ||
      joined.includes("item id") ||
      joined.includes("id da variacao") ||
      joined.includes("id da variação") ||
      joined.includes("vendas (pedido pago)") ||
      joined.includes("unidades (pedido pago)") ||
      joined.includes("id do pedido") ||
      joined.includes("status do pedido") ||
      joined.includes("nome do produto") ||
      joined.includes("faturamento") ||
      joined.includes("subtotal do produto") ||
      joined.includes("repasse")
    ) {
      return i;
    }
  }

  return 0;
}

function createBadRequestError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

module.exports = {
  repairWorksheetRef,
  lerWorkbookPlanilha,
  readSheetRows,
  parseSpreadsheet,
  MELI_HEADER_FIELDS,
  detectMeliHeader,
  detectMeliHeaderRow,
  validateMeliHeaderAtRow,
  detectShopeeHeaderRow,
  createBadRequestError,
};
