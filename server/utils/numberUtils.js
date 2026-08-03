// server/utils/numberUtils.js
// Helpers numéricos puros extraídos de server/index.js.
// NÃO alterar comportamento sem revisar todos os usos.

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  let text = String(value).trim();
  if (!text) return 0;

  text = text
    .replace(/\s+/g, "")
    .replace(/R\$/gi, "")
    .replace(/US\$/gi, "")
    .replace(/€/g, "")
    .replace(/%/g, "")
    .replace(/[^\d,.-]/g, "");

  if (!text) return 0;

  const hasComma = text.includes(",");
  const hasDot = text.includes(".");

  if (hasComma && hasDot) {
    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");

    if (lastComma > lastDot) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (hasComma) {
    text = text.replace(/\./g, "").replace(",", ".");
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positive(value) {
  return Math.abs(toNumber(value));
}

function round2(value) {
  return Number((Number.isFinite(value) ? value : 0).toFixed(2));
}

// Parser estrito para valores digitados no formulário financeiro. Formatos
// ambíguos não podem ser reinterpretados silenciosamente como milhares.
function parseMoneyValue(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return { valid: true, value: 0 };
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { valid: true, value }
      : { valid: false, value: null };
  }

  const text = String(value)
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/\s+/g, "");

  let normalized = null;
  if (/^\d+$/.test(text)) {
    normalized = text;
  } else if (/^\d+[.,]\d{1,2}$/.test(text)) {
    normalized = text.replace(",", ".");
  } else if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(text)) {
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(text)) {
    normalized = text.replace(/,/g, "");
  }

  if (normalized === null) return { valid: false, value: null };
  const parsed = Number(normalized);
  return Number.isFinite(parsed)
    ? { valid: true, value: parsed }
    : { valid: false, value: null };
}

module.exports = { toNumber, positive, round2, parseMoneyValue };
