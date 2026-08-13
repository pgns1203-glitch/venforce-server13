// server/utils/fechamento/debugCollector.js
// Coletor opcional de observabilidade para o Debug Financeiro (Fechamento Inspector).
//
// Regra de ouro: quando NENHUM collector é passado para um motor (processMeli,
// processShopee, processShopeeFinancialOrders, lookupShopeeCost, ...), o
// comportamento e o resultado desses motores continuam IDÊNTICOS ao atual —
// todo ponto de instrumentação é guardado por `if (debugCollector) { ... }`.
// Este arquivo não importa nada de services/ para não criar dependência
// circular; é puro armazenamento em memória, descartado ao fim do request.

// Códigos estáveis de warning/erro usados pelo Debug Financeiro. Mantidos
// aqui (não em cada service) para não duplicar taxonomia por engine.
const WARNING_CODES = Object.freeze({
  COST_MATCH_FAILED: "COST_MATCH_FAILED",
  BRIDGE_AVAILABLE_NOT_USED: "BRIDGE_AVAILABLE_NOT_USED",
  SHEET_IGNORED: "SHEET_IGNORED",
  COLUMN_UNUSED: "COLUMN_UNUSED",
  COLUMN_MISSING: "COLUMN_MISSING",
  HEADER_UNCERTAIN: "HEADER_UNCERTAIN",
  SHIPPING_SIGN_AMBIGUOUS: "SHIPPING_SIGN_AMBIGUOUS",
  ADJUSTMENT_NOT_APPLIED: "ADJUSTMENT_NOT_APPLIED",
  FINANCIAL_DATA_MISSING: "FINANCIAL_DATA_MISSING",
  PARSE_ERROR: "PARSE_ERROR",
  DUPLICATE_KEY: "DUPLICATE_KEY",
  ZERO_COST: "ZERO_COST",
  COST_MISSING: "COST_MISSING",
  FILE_UNRECOGNIZED: "FILE_UNRECOGNIZED",
});

function createDebugCollector() {
  const state = {
    files: [],
    sheets: [],
    columns: [],
    matchAttempts: [],
    warnings: [],
    calculations: [],
    bridges: {},
  };

  return {
    recordFile(entry) {
      state.files.push(entry);
    },
    recordSheet(entry) {
      state.sheets.push(entry);
    },
    recordColumn(entry) {
      state.columns.push(entry);
    },
    // engine: "meli" | "shopee_real" | "shopee_performance" | "tiktok"
    // stage: "cost_lookup" (por enquanto o único estágio instrumentado)
    // result: "hit" | "miss" | "skip"
    recordMatchAttempt(entry) {
      state.matchAttempts.push(entry);
    },
    // code deve vir de WARNING_CODES quando existir um código estável aplicável.
    recordWarning(entry) {
      state.warnings.push(entry);
    },
    recordCalculation(entry) {
      state.calculations.push(entry);
    },
    setBridge(name, value) {
      state.bridges[name] = value;
    },
    snapshot() {
      return {
        files: state.files,
        sheets: state.sheets,
        columns: state.columns,
        matchAttempts: state.matchAttempts,
        warnings: state.warnings,
        calculations: state.calculations,
        bridges: state.bridges,
      };
    },
  };
}

module.exports = { createDebugCollector, WARNING_CODES };
