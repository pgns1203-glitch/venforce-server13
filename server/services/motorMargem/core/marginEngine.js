// server/services/motorMargem/core/marginEngine.js
// NÚCLEO DE CÁLCULO do Motor de Margem — módulo puro, sem I/O, sem banco.
//
// PRINCÍPIO: UMA FÓRMULA · UMA REGRA · VÁRIAS INTERFACES.
//
// Hoje a mesma fórmula de LC/MC existe copiada em quatro lugares:
//   1. server/services/automacoes/precificacaoService.js   (previsto, ML API)
//   2. server/services/automacoes/diagnosticoService.js    (previsto, ML API)
//   3. server/services/centralVendas/centralVendasSyncService.js (realizado)
//   4. extension/content.js                                (previsto, DOM)
// Este módulo é a versão única. Nenhum dos quatro foi alterado nesta rodada
// (fora de escopo); a migração está registrada em MOTOR_MARGEM_IMPLEMENTACAO.
//
// ── CONVENÇÕES ──────────────────────────────────────────────────────────────
// · Todo valor monetário é POR UNIDADE VENDIDA.
// · Percentuais são DECIMAIS: 0.12 = 12% (mesma convenção de `custos`).
// · null = ausente. NUNCA convertido silenciosamente em 0 sem registro.
// · Toda saída diz o que faltou (`missing`) e o que foi assumido (`assumed`).

const { FIELDS } = require("./marginEvidence");

// Sem estes dois não existe margem: não há o que dividir nem o que descontar.
const REQUIRED_FIELDS = [FIELDS.PRICE, FIELDS.COST];

// Ausentes viram 0 no cálculo, mas o nome fica registrado em `assumed`.
// A confiabilidade rebaixa o item por causa disso — o número existe, mas
// declaradamente incompleto. Mesma postura da Central de Vendas, que calcula
// resultado parcial sem frete real e marca o pedido como "parcial".
const OPTIONAL_FIELDS = [
  FIELDS.TAX_RATE,
  FIELDS.FIXED_FEE,
  FIELDS.COMMISSION,
  FIELDS.FREIGHT,
];

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  return value === null ? null : Math.round((value + Number.EPSILON) * 100) / 100;
}

// Margens são frações (0.1284). 6 casas preservam 4 casas em pontos percentuais.
function round6(value) {
  return value === null ? null : Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}

/**
 * Lucro e margem de contribuição a partir de um jogo de variáveis.
 *
 *   lucro  = preço − (preço × imposto) − comissão − frete − taxaFixa − custo
 *   margem = lucro / preço
 *
 * @returns {{
 *   computable: boolean, profit: number|null, margin: number|null,
 *   missing: string[], assumed: string[], strict: boolean, inputs: object
 * }}
 */
function computeMargin(input = {}) {
  const price = num(input[FIELDS.PRICE] ?? input.price);
  const cost = num(input[FIELDS.COST] ?? input.cost);
  const taxRate = num(input[FIELDS.TAX_RATE] ?? input.taxRate);
  const fixedFee = num(input[FIELDS.FIXED_FEE] ?? input.fixedFee);
  const commission = num(input[FIELDS.COMMISSION] ?? input.commission);
  const freight = num(input[FIELDS.FREIGHT] ?? input.freight);

  const values = {
    [FIELDS.PRICE]: price,
    [FIELDS.COST]: cost,
    [FIELDS.TAX_RATE]: taxRate,
    [FIELDS.FIXED_FEE]: fixedFee,
    [FIELDS.COMMISSION]: commission,
    [FIELDS.FREIGHT]: freight,
  };

  const missing = REQUIRED_FIELDS.filter((key) => values[key] === null);
  const assumed = OPTIONAL_FIELDS.filter((key) => values[key] === null);

  // Preço 0 ou negativo não é "margem 0", é dado impossível: sem denominador
  // não existe margem. Fica como preço ausente para o consumidor.
  if (price !== null && price <= 0 && !missing.includes(FIELDS.PRICE)) {
    missing.push(FIELDS.PRICE);
  }

  if (missing.length > 0) {
    return {
      computable: false,
      profit: null,
      margin: null,
      missing,
      assumed,
      strict: false,
      inputs: values,
    };
  }

  const profit =
    price - price * (taxRate ?? 0) - (commission ?? 0) - (freight ?? 0) - (fixedFee ?? 0) - cost;

  return {
    computable: true,
    profit: round2(profit),
    margin: round6(profit / price),
    missing: [],
    assumed,
    // strict = nenhuma variável foi assumida como zero.
    strict: assumed.length === 0,
    inputs: values,
  };
}

/**
 * Preço necessário para atingir uma margem alvo.
 *
 *   preçoAlvo = (custo + taxaFixa + frete) / (1 − imposto − comissão% − margemAlvo)
 *
 * Usa a comissão em PERCENTUAL (`commissionRate`), não em reais: a comissão em
 * reais depende do próprio preço que estamos procurando. Sem `commissionRate` o
 * preço alvo não é calculável — devolve `null` com o motivo, nunca um chute.
 */
function computeTargetPrice(input = {}) {
  const cost = num(input[FIELDS.COST] ?? input.cost);
  const fixedFee = num(input[FIELDS.FIXED_FEE] ?? input.fixedFee) ?? 0;
  const freight = num(input[FIELDS.FREIGHT] ?? input.freight);
  const taxRate = num(input[FIELDS.TAX_RATE] ?? input.taxRate);
  const commissionRate = num(input[FIELDS.COMMISSION_RATE] ?? input.commissionRate);
  const targetMargin = num(input.targetMargin) ?? 0;

  const missing = [];
  if (cost === null) missing.push(FIELDS.COST);
  if (freight === null) missing.push(FIELDS.FREIGHT);
  if (taxRate === null) missing.push(FIELDS.TAX_RATE);
  if (commissionRate === null) missing.push(FIELDS.COMMISSION_RATE);

  if (missing.length > 0) {
    return { computable: false, price: null, profit: null, missing, reason: "DADOS_AUSENTES" };
  }

  const denominator = 1 - taxRate - commissionRate - targetMargin;
  if (!(denominator > 0)) {
    // Imposto + comissão + margem alvo consomem 100% do preço: não existe preço
    // que feche a conta. É um resultado legítimo, não um erro de cálculo.
    return {
      computable: false,
      price: null,
      profit: null,
      missing: [],
      reason: "MARGEM_ALVO_INVIAVEL",
    };
  }

  const price = (cost + fixedFee + freight) / denominator;
  return {
    computable: true,
    price: round2(price),
    profit: round2(price * targetMargin),
    missing: [],
    reason: null,
  };
}

/** Preço de equilíbrio: preço alvo com margem 0. */
function computeBreakEvenPrice(input = {}) {
  return computeTargetPrice({ ...input, targetMargin: 0 });
}

/**
 * Erro de projeção: quanto a margem realizada ficou distante da projetada.
 * Expresso em PONTOS PERCENTUAIS (projetamos 12.8%, realizou 11.9% ⇒ −0.9 pp).
 */
function compareMargins(projectedMargin, realizedMargin) {
  const projected = num(projectedMargin);
  const realized = num(realizedMargin);
  if (projected === null || realized === null) {
    return { comparable: false, deltaPp: null, deltaRelative: null };
  }
  const deltaPp = (realized - projected) * 100;
  return {
    comparable: true,
    deltaPp: Math.round((deltaPp + Number.EPSILON) * 100) / 100,
    deltaRelative: projected !== 0 ? round6((realized - projected) / Math.abs(projected)) : null,
  };
}

module.exports = {
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  computeMargin,
  computeTargetPrice,
  computeBreakEvenPrice,
  compareMargins,
  round2,
  round6,
};
