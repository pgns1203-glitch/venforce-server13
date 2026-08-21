// server/services/centralVendas/centralVendasMpSettlementCsvParser.js
// MP2 — Parser do CSV do Settlement Report (Mercado Pago).
//
// Cabeçalho real validado no handoff (seção 19):
//   SOURCE_ID;TRANSACTION_TYPE;TRANSACTION_AMOUNT;FEE_AMOUNT;
//   SETTLEMENT_NET_AMOUNT;REAL_AMOUNT;ORDER_ID;SHIPPING_ID;MONEY_RELEASE_DATE
//
// A ORDEM pode variar por configuração — por isso parseia por NOME de
// coluna (via csv-parser, já em server/package.json — seção 12 do spec:
// "audite package.json antes de escrever parser manual"), nunca por posição
// fixa. Separador `;` validado no handoff.
//
// Disciplina null vs zero (mesma de MP1 — numOrNull em
// centralVendasMpPaymentsService.js): campo vazio = null, "0"/"0,00" = zero
// real. SOURCE_ID/ORDER_ID/SHIPPING_ID sempre como STRING (nunca Number —
// perderiam precisão em IDs grandes).

const { Readable } = require("stream");
const csv = require("csv-parser");
const { round2 } = require("../../utils/numberUtils");

// Nomes de coluna vistos no handoff — csv-parser usa a 1a linha como header
// literal; normalizamos para uppercase/trim antes de mapear, então a ordem
// e pequenas variações de espaço não quebram o parse.
function normalizeHeaderKey(header) {
  return String(header || "").trim().toUpperCase();
}

function textOrNull(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

// Aceita "34.90", "34,90", "-12,49", "-12.49", "0", "" (vazio = null).
// Nunca usar Number("34,90") diretamente (vira NaN) — seção 11 do spec.
function parseSettlementAmount(raw) {
  if (raw === null || raw === undefined) return null;
  let text = String(raw).trim();
  if (text === "") return null;

  const hasComma = text.includes(",");
  const hasDot = text.includes(".");
  if (hasComma && hasDot) {
    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");
    // O separador decimal é o último símbolo encontrado; o outro é milhar.
    if (lastComma > lastDot) text = text.replace(/\./g, "").replace(",", ".");
    else text = text.replace(/,/g, "");
  } else if (hasComma) {
    text = text.replace(",", ".");
  }

  const n = Number(text);
  return Number.isFinite(n) ? round2(n) : null;
}

function dateOrNull(value) {
  const v = textOrNull(value);
  return v;
}

// TRANSACTION_TYPE conhecidos no handoff (seção 22) — apenas para
// classificação/observabilidade (typeCounts). NUNCA um enum fechado: um tipo
// desconhecido é preservado e persistido normalmente (seção 16 do spec).
const KNOWN_TRANSACTION_TYPES = new Set([
  "SETTLEMENT",
  "DISPUTE",
  "REFUND",
  "REFUND_SHIPPING",
  "SETTLEMENT_SHIPPING",
]);

function normalizeRow(raw, rowNumber) {
  return {
    rowNumber,
    sourceId: textOrNull(raw.SOURCE_ID),
    orderId: textOrNull(raw.ORDER_ID),
    shippingId: textOrNull(raw.SHIPPING_ID),
    transactionType: textOrNull(raw.TRANSACTION_TYPE),
    transactionAmount: parseSettlementAmount(raw.TRANSACTION_AMOUNT),
    feeAmount: parseSettlementAmount(raw.FEE_AMOUNT),
    settlementNetAmount: parseSettlementAmount(raw.SETTLEMENT_NET_AMOUNT),
    realAmount: parseSettlementAmount(raw.REAL_AMOUNT),
    moneyReleaseDate: dateOrNull(raw.MONEY_RELEASE_DATE),
    // IS_RELEASED é opcional (seção 4/13) — só aparece se a config da conta
    // realmente incluir a coluna; ausência de coluna != false.
    isReleased: raw.IS_RELEASED === undefined ? null : parseBooleanOrNull(raw.IS_RELEASED),
  };
}

function parseBooleanOrNull(value) {
  const v = textOrNull(value);
  if (v === null) return null;
  const lower = v.toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") return true;
  if (lower === "false" || lower === "0" || lower === "no") return false;
  return null;
}

// Parseia o texto do CSV inteiro em memória (relatórios de Settlement não
// são grandes o bastante para justificar streaming em disco aqui) e devolve
// { rows, typeCounts, rowsCount }. `text` é sempre a string crua devolvida
// por mpFetchText — nunca um path de arquivo.
function parseSettlementCsv(text) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const typeCounts = {};
    let rowNumber = 0;

    const source = Readable.from([String(text ?? "")]);
    source
      .pipe(csv({
        separator: ";",
        mapHeaders: ({ header }) => normalizeHeaderKey(header),
      }))
      .on("data", (raw) => {
        rowNumber += 1;
        const row = normalizeRow(raw, rowNumber);
        rows.push(row);
        const tt = row.transactionType || "DESCONHECIDO";
        typeCounts[tt] = (typeCounts[tt] || 0) + 1;
      })
      .on("end", () => resolve({ rows, rowsCount: rows.length, typeCounts }))
      .on("error", (err) => reject(err));
  });
}

module.exports = {
  parseSettlementCsv,
  parseSettlementAmount,
  normalizeRow,
  KNOWN_TRANSACTION_TYPES,
};
