// server/services/motorMargem/core/marginStatus.js
// ESTADOS do Motor de Margem — módulo puro, sem I/O.
//
// REGRA CENTRAL DO PRODUTO: **margem ruim ≠ dado ruim**.
//   3% com dados confiáveis      → LOW_MARGIN   (problema de preço)
//   3% com frete inconsistente   → SUSPECT_DATA (problema de dado)
//   sem custo na Base            → UNVALIDATED  (nem dá para perguntar)
//   vendeu e o financeiro não conciliou → RECONCILING (o número ainda vai mudar)
//
// A ordem de precedência abaixo é a ordem da AÇÃO do operador, não a da
// gravidade contábil. Está declarada em uma lista justamente para poder ser
// discutida e alterada sem caçar `if` espalhado.

const { LEVELS } = require("./marginConfidence");

const STATUS = {
  HEALTHY: "HEALTHY",
  LOW_MARGIN: "LOW_MARGIN",
  LOSS: "LOSS",
  UNVALIDATED: "UNVALIDATED",
  SUSPECT_DATA: "SUSPECT_DATA",
  RECONCILING: "RECONCILING",
};

// Do mais urgente para o menos urgente. O primeiro que casar vence.
const STATUS_PRECEDENCE = [
  STATUS.UNVALIDATED,  // 1. não dá para calcular  → corrigir a Base
  STATUS.SUSPECT_DATA, // 2. calculável mas duvidoso → investigar o dado
  STATUS.LOSS,         // 3. está perdendo dinheiro  → agir agora
  STATUS.LOW_MARGIN,   // 4. abaixo da meta          → agir no preço
  STATUS.RECONCILING,  // 5. número ainda vai mudar  → aguardar/conciliar
  STATUS.HEALTHY,      // 6. nada a fazer
];

// Meta padrão de margem de contribuição. Espelha o limiar "saudável" que a
// extensão já usa hoje (`thresholdSaudavel: 10`). Sobrescrevível por chamada.
const DEFAULT_TARGET_MARGIN = 0.10;

const SEVERITY = {
  [STATUS.UNVALIDATED]: "bloqueio",
  [STATUS.SUSPECT_DATA]: "investigar",
  [STATUS.LOSS]: "critico",
  [STATUS.LOW_MARGIN]: "atencao",
  [STATUS.RECONCILING]: "aguardando",
  [STATUS.HEALTHY]: "ok",
};

const LABELS = {
  [STATUS.UNVALIDATED]: "Não validado",
  [STATUS.SUSPECT_DATA]: "Dado suspeito",
  [STATUS.LOSS]: "Prejuízo",
  [STATUS.LOW_MARGIN]: "Margem baixa",
  [STATUS.RECONCILING]: "Em conciliação",
  [STATUS.HEALTHY]: "Saudável",
};

/**
 * @param {object} input
 *  - margin            margem usada para julgar (fração; realizada tem
 *                      precedência sobre projetada — quem escolhe é o chamador)
 *  - computable        a margem pôde ser calculada
 *  - missing           variáveis obrigatórias ausentes
 *  - confidenceLevel   confiança geral (LEVELS)
 *  - hasConflict       alguma variável crítica com fontes em conflito
 *  - hasOrders         houve venda no período analisado
 *  - settlementPending venda sem conciliação financeira confirmada
 *  - targetMargin      meta de margem (fração)
 * @returns {{status:string, severity:string, label:string, reasons:string[]}}
 */
function classifyStatus(input = {}) {
  const {
    margin = null,
    computable = false,
    missing = [],
    confidenceLevel = LEVELS.UNKNOWN,
    hasConflict = false,
    hasOrders = false,
    settlementPending = false,
    targetMargin = DEFAULT_TARGET_MARGIN,
  } = input;

  const reasons = [];

  // 1. UNVALIDATED — falta insumo obrigatório. Nem margem ruim, nem boa: nenhuma.
  if (!computable || margin === null) {
    if (missing.length) {
      reasons.push(`Variáveis obrigatórias ausentes: ${missing.join(", ")}.`);
    } else {
      reasons.push("Margem não pôde ser calculada com os dados disponíveis.");
    }
    return finish(STATUS.UNVALIDATED, reasons);
  }

  // 2. SUSPECT_DATA — o número existe, mas não sustenta decisão.
  if (hasConflict) {
    reasons.push("Fontes em conflito em uma variável do cálculo.");
    return finish(STATUS.SUSPECT_DATA, reasons);
  }
  if (confidenceLevel === LEVELS.LOW || confidenceLevel === LEVELS.UNKNOWN) {
    reasons.push(
      confidenceLevel === LEVELS.UNKNOWN
        ? "Uma variável do cálculo não tem nenhuma fonte; o valor entrou como 0."
        : "Confiança baixa em pelo menos uma variável do cálculo."
    );
    return finish(STATUS.SUSPECT_DATA, reasons);
  }

  // 3. LOSS — margem negativa com dado que sustenta a conclusão.
  if (margin < 0) {
    reasons.push(`Margem negativa (${(margin * 100).toFixed(2)}%).`);
    return finish(STATUS.LOSS, reasons);
  }

  // 4. LOW_MARGIN — abaixo da meta, dado confiável: é decisão de preço.
  if (margin < targetMargin) {
    reasons.push(
      `Margem de ${(margin * 100).toFixed(2)}% abaixo da meta de ${(targetMargin * 100).toFixed(2)}%.`
    );
    return finish(STATUS.LOW_MARGIN, reasons);
  }

  // 5. RECONCILING — margem ok, mas o realizado ainda pode mudar.
  if (hasOrders && settlementPending) {
    reasons.push("Venda registrada sem conciliação financeira confirmada.");
    return finish(STATUS.RECONCILING, reasons);
  }

  reasons.push(`Margem de ${(margin * 100).toFixed(2)}% na meta, com dados confiáveis.`);
  return finish(STATUS.HEALTHY, reasons);
}

function finish(status, reasons) {
  return {
    status,
    severity: SEVERITY[status],
    label: LABELS[status],
    reasons,
  };
}

module.exports = {
  STATUS,
  STATUS_PRECEDENCE,
  SEVERITY,
  LABELS,
  DEFAULT_TARGET_MARGIN,
  classifyStatus,
};
