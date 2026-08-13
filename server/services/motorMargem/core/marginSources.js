// server/services/motorMargem/core/marginSources.js
// Vocabulário de FONTES do Motor de Margem — módulo puro, sem I/O.
//
// Uma fonte responde "de onde veio este número?". O Motor nunca guarda um valor
// solto: todo valor chega acompanhado da fonte que o observou. Isso é o que
// permite responder as duas perguntas separadas do produto:
//   1) qual é a margem?
//   2) quanto confiamos nos dados usados para calculá-la?
//
// Regra de honestidade herdada do resto do backend (financeiroShared,
// centralVendas): null = ausente, 0 = zero real. Nunca inventar zero.

// ── Fontes ────────────────────────────────────────────────────────────────────

const SOURCES = {
  // GET /items, /items/:id/sale_price, /sites/MLB/listing_prices,
  // /users/:id/shipping_options/free — estado ATUAL do anúncio.
  MELI_API: "MELI_API",
  // GET /orders/search + /shipments/:id/costs — o que REALMENTE aconteceu na
  // venda. Hoje chega ao Motor já normalizado pela Central de Vendas.
  MELI_ORDER: "MELI_ORDER",
  // Mercado Pago (payments/settlement). NÃO IMPLEMENTADO no backend atual —
  // ver MOTOR_MARGEM_FONTES_E_GAPS. A constante existe para que o contrato e a
  // confiabilidade já saibam lidar com a ausência dela.
  MERCADO_PAGO: "MERCADO_PAGO",
  // Tabela `custos` da base vinculada ao cliente (custo, imposto, taxa fixa).
  VENFORCE_BASE: "VENFORCE_BASE",
  // Extensão Chrome lendo o DOM do Mercado Livre. Evidência secundária.
  EXTENSION_DOM: "EXTENSION_DOM",
  // Valor calculado pelo próprio Motor a partir de outras evidências.
  DERIVED: "DERIVED",
};

const SOURCE_LIST = Object.values(SOURCES);

function isSource(value) {
  return SOURCE_LIST.includes(value);
}

// ── Tipo da evidência (momento) ──────────────────────────────────────────────
// PROJECTED = estado atual/esperado (antes da venda).
// REALIZED  = o que aconteceu de fato (depois da venda).

const EVIDENCE_KINDS = {
  PROJECTED: "PROJECTED",
  REALIZED: "REALIZED",
};

// ── Qualidade da observação ──────────────────────────────────────────────────
// MEASURED  = a fonte informou o número diretamente (API respondeu 23.40).
// DECLARED  = alguém declarou (planilha de custo importada na Base).
// DERIVED   = o Motor calculou a partir de outros valores.
// ESTIMATED = aproximação assumida (média, rateio). Sempre rebaixa a confiança.

const EVIDENCE_QUALITY = {
  MEASURED: "MEASURED",
  DECLARED: "DECLARED",
  DERIVED: "DERIVED",
  ESTIMATED: "ESTIMATED",
};

// ── Força relativa das fontes ────────────────────────────────────────────────
// Usada para (a) escolher o valor quando há mais de uma evidência e (b) definir
// o teto de confiança de uma variável. Número maior = fonte mais forte.
//
// MERCADO_PAGO lidera no realizado porque é o dinheiro que efetivamente entrou.
// EXTENSION_DOM é sempre a mais fraca: é leitura de tela, não de contrato.
const SOURCE_STRENGTH = {
  [SOURCES.MERCADO_PAGO]: 100,
  [SOURCES.MELI_ORDER]: 90,
  [SOURCES.VENFORCE_BASE]: 80,
  [SOURCES.MELI_API]: 70,
  [SOURCES.DERIVED]: 40,
  [SOURCES.EXTENSION_DOM]: 20,
};

function sourceStrength(source) {
  return SOURCE_STRENGTH[source] ?? 0;
}

module.exports = {
  SOURCES,
  SOURCE_LIST,
  SOURCE_STRENGTH,
  EVIDENCE_KINDS,
  EVIDENCE_QUALITY,
  isSource,
  sourceStrength,
};
