// server/tests/motorMargemEngine.test.js
// Testes do NÚCLEO PURO do Motor de Margem.
// Cobre os 13 cenários exigidos no briefing do Motor, um bloco por cenário.
// Nenhuma dependência de banco, rede ou Mercado Livre.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const C = require("../services/motorMargem/core");

const NOW = new Date("2026-08-12T12:00:00.000Z");
const RECENTE = NOW;

// ── Helpers ──────────────────────────────────────────────────────────────────

function base(bag, { cost, taxRate = 0.1, fixedFee = 0 }) {
  const comum = {
    source: C.SOURCES.VENFORCE_BASE,
    kind: C.EVIDENCE_KINDS.PROJECTED,
    quality: C.EVIDENCE_QUALITY.DECLARED,
    observedAt: RECENTE,
  };
  if (cost !== undefined) bag.add(C.FIELDS.COST, { ...comum, value: cost });
  bag.add(C.FIELDS.TAX_RATE, { ...comum, value: taxRate });
  bag.add(C.FIELDS.FIXED_FEE, { ...comum, value: fixedFee });
}

function meliApi(bag, { price, commission, commissionRate, freight }) {
  const comum = {
    source: C.SOURCES.MELI_API,
    kind: C.EVIDENCE_KINDS.PROJECTED,
    quality: C.EVIDENCE_QUALITY.MEASURED,
    observedAt: RECENTE,
  };
  if (price !== undefined) bag.add(C.FIELDS.PRICE, { ...comum, value: price });
  if (commission !== undefined) bag.add(C.FIELDS.COMMISSION, { ...comum, value: commission });
  if (commissionRate !== undefined)
    bag.add(C.FIELDS.COMMISSION_RATE, { ...comum, value: commissionRate });
  if (freight !== undefined) bag.add(C.FIELDS.FREIGHT, { ...comum, value: freight });
}

// `cost`/`taxRate` simulam o histórico persistido pela Central de Vendas
// (custo_produto/imposto_interno da venda) — fonte VENFORCE_BASE, mas kind
// REALIZED, porque é o que valia NAQUELA venda, não a Base de hoje. Sem
// evidência REALIZED própria, custo/imposto ficam ausentes no realizado (ver
// marginItem.js — o realizado NUNCA cai para o projetado).
function pedido(bag, { price, commission, freight, cost, taxRate }) {
  const comumMedido = {
    source: C.SOURCES.MELI_ORDER,
    kind: C.EVIDENCE_KINDS.REALIZED,
    quality: C.EVIDENCE_QUALITY.MEASURED,
    observedAt: RECENTE,
  };
  if (price !== undefined) bag.add(C.FIELDS.PRICE, { ...comumMedido, value: price });
  if (commission !== undefined) bag.add(C.FIELDS.COMMISSION, { ...comumMedido, value: commission });
  if (freight !== undefined) bag.add(C.FIELDS.FREIGHT, { ...comumMedido, value: freight });

  const comumDeclarado = {
    source: C.SOURCES.VENFORCE_BASE,
    kind: C.EVIDENCE_KINDS.REALIZED,
    quality: C.EVIDENCE_QUALITY.DECLARED,
    observedAt: RECENTE,
  };
  if (cost !== undefined) bag.add(C.FIELDS.COST, { ...comumDeclarado, value: cost });
  if (taxRate !== undefined) bag.add(C.FIELDS.TAX_RATE, { ...comumDeclarado, value: taxRate });
}

function montar(bag, { hasOrders = false, settlementAvailable = false, targetMargin } = {}) {
  return C.buildMarginItem({
    identity: { clienteSlug: "cliente-teste", marketplace: "meli", itemId: "MLB1", titulo: "Item" },
    bag,
    sales: hasOrders ? { hasOrders: true, unidades: 3, pedidos: 2 } : { hasOrders: false },
    settlement: {
      available: settlementAvailable,
      motivo: settlementAvailable ? null : "MERCADO_PAGO_NAO_INTEGRADO",
    },
    targetMargin,
    now: NOW,
  });
}

function temMotivo(reasons, code) {
  return reasons.some((r) => r.code === code);
}

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

// ── 1. Item saudável ─────────────────────────────────────────────────────────
cenario("item saudável → HEALTHY, confiança HIGH", () => {
  const bag = C.createEvidenceBag();
  base(bag, { cost: 40 });
  meliApi(bag, { price: 100, commission: 12, commissionRate: 0.12, freight: 20 });

  const item = montar(bag);

  // 100 − 10 (imposto) − 12 (comissão) − 20 (frete) − 0 (taxa fixa) − 40 = 18
  assert.strictEqual(item.margin.projected.profit, 18);
  assert.strictEqual(item.margin.projected.marginPercent, 18);
  assert.strictEqual(item.margin.projected.strict, true, "nenhuma variável assumida");
  assert.strictEqual(item.quality.confidence, C.LEVELS.HIGH);
  assert.strictEqual(item.quality.status, C.STATUS.HEALTHY);
  assert.deepStrictEqual(item.quality.divergences, []);
});

// ── 2. Margem baixa ──────────────────────────────────────────────────────────
cenario("margem baixa com dados confiáveis → LOW_MARGIN (não SUSPECT_DATA)", () => {
  const bag = C.createEvidenceBag();
  base(bag, { cost: 60 });
  meliApi(bag, { price: 100, commission: 12, commissionRate: 0.12, freight: 15 });

  const item = montar(bag);

  assert.strictEqual(item.margin.projected.profit, 3);
  assert.strictEqual(item.margin.projected.marginPercent, 3);
  assert.strictEqual(item.quality.confidence, C.LEVELS.HIGH);
  // A regra do produto: margem ruim com dado bom é problema de PREÇO.
  assert.strictEqual(item.quality.status, C.STATUS.LOW_MARGIN);
});

// ── 3. Prejuízo ──────────────────────────────────────────────────────────────
cenario("prejuízo → LOSS", () => {
  const bag = C.createEvidenceBag();
  base(bag, { cost: 45 });
  meliApi(bag, { price: 50, commission: 10, commissionRate: 0.2, freight: 5 });

  const item = montar(bag);

  assert.strictEqual(item.margin.projected.profit, -15);
  assert.ok(item.margin.projected.margin < 0);
  assert.strictEqual(item.quality.status, C.STATUS.LOSS);
  assert.strictEqual(item.quality.statusSeverity, "critico");
});

// ── 4. Custo ausente ─────────────────────────────────────────────────────────
cenario("custo ausente na Base → UNVALIDATED, margem null (nunca 0)", () => {
  const bag = C.createEvidenceBag();
  // Sem `cost`: imposto e taxa fixa existem, o custo não.
  base(bag, { cost: undefined });
  meliApi(bag, { price: 100, commission: 12, commissionRate: 0.12, freight: 20 });

  const item = montar(bag);

  assert.strictEqual(item.margin.projected.computable, false);
  assert.strictEqual(item.margin.projected.profit, null, "ausência nunca vira lucro 0");
  assert.strictEqual(item.margin.projected.margin, null);
  assert.deepStrictEqual(item.margin.projected.missing, [C.FIELDS.COST]);
  assert.strictEqual(item.quality.status, C.STATUS.UNVALIDATED);
  assert.strictEqual(item.costs.cost.status, "unavailable");
  assert.strictEqual(item.quality.confidenceByField.cost.level, C.LEVELS.UNKNOWN);
});

// ── 5. Custo zero ────────────────────────────────────────────────────────────
cenario("custo zero → calcula, mas rebaixa para LOW e vira SUSPECT_DATA", () => {
  const bag = C.createEvidenceBag();
  base(bag, { cost: 0 });
  meliApi(bag, { price: 100, commission: 12, commissionRate: 0.12, freight: 20 });

  const item = montar(bag);

  // Zero real é calculável — o que muda é a confiança, não o número.
  assert.strictEqual(item.margin.projected.computable, true);
  assert.strictEqual(item.margin.projected.profit, 58);
  assert.strictEqual(item.quality.confidenceByField.cost.level, C.LEVELS.LOW);
  assert.ok(temMotivo(item.quality.confidenceByField.cost.reasons, C.REASONS.CUSTO_ZERO));
  assert.strictEqual(item.quality.status, C.STATUS.SUSPECT_DATA);
});

// ── 6. Frete divergente (exemplo literal do briefing) ────────────────────────
cenario("frete previsto 23.40 × realizado 18.70 → DRIFT, frete LOW, SUSPECT_DATA", () => {
  const bag = C.createEvidenceBag();
  base(bag, { cost: 40 });
  meliApi(bag, { price: 100, commission: 12, commissionRate: 0.12, freight: 23.4 });
  pedido(bag, { price: 100, commission: 12, freight: 18.7 });

  const item = montar(bag, { hasOrders: true });

  const frete = item.quality.confidenceByField.freight;
  assert.strictEqual(frete.level, C.LEVELS.LOW);
  assert.ok(temMotivo(frete.reasons, C.REASONS.DIVERGENCIA_PREVISTO_REALIZADO));

  const divergencia = item.quality.divergences.find((d) => d.field === C.FIELDS.FREIGHT);
  assert.ok(divergencia, "divergência de frete registrada");
  assert.strictEqual(divergencia.type, C.DIVERGENCE_TYPES.DRIFT);
  assert.strictEqual(divergencia.absolute, 4.7);
  assert.strictEqual(divergencia.a.value, 23.4);
  assert.strictEqual(divergencia.b.value, 18.7);

  assert.strictEqual(item.quality.status, C.STATUS.SUSPECT_DATA);
});

// ── 7. Preço divergente ──────────────────────────────────────────────────────
cenario("preço do anúncio × preço vendido divergem → DRIFT em price", () => {
  const bag = C.createEvidenceBag();
  base(bag, { cost: 40 });
  meliApi(bag, { price: 120, commission: 14.4, commissionRate: 0.12, freight: 20 });
  pedido(bag, { price: 100, commission: 12, freight: 20 });

  const item = montar(bag, { hasOrders: true });

  const divergencia = item.quality.divergences.find((d) => d.field === C.FIELDS.PRICE);
  assert.ok(divergencia, "divergência de preço registrada");
  assert.strictEqual(divergencia.type, C.DIVERGENCE_TYPES.DRIFT);
  assert.strictEqual(divergencia.absolute, 20);
  assert.strictEqual(item.quality.confidenceByField.price.level, C.LEVELS.LOW);
  // Os dois preços continuam visíveis e separados no contrato.
  assert.strictEqual(item.pricing.current.value, 120);
  assert.strictEqual(item.pricing.sold.value, 100);
});

// ── 8. Sem pedido ────────────────────────────────────────────────────────────
cenario("sem pedido no período → realizada não calculável, projetada intacta", () => {
  const bag = C.createEvidenceBag();
  base(bag, { cost: 40 });
  meliApi(bag, { price: 100, commission: 12, commissionRate: 0.12, freight: 20 });

  const item = montar(bag, { hasOrders: false });

  assert.strictEqual(item.margin.projected.computable, true);
  assert.strictEqual(item.margin.realized.computable, false);
  assert.strictEqual(item.margin.realized.margin, null);
  assert.deepStrictEqual(item.margin.realized.missing, ["order"]);
  assert.strictEqual(item.margin.projectionError.comparable, false);
  // Sem venda não há o que conciliar: RECONCILING não se aplica.
  assert.notStrictEqual(item.quality.status, C.STATUS.RECONCILING);
  assert.strictEqual(item.sales.hasOrders, false);
});

// ── 9. Pedido sem Mercado Pago ───────────────────────────────────────────────
cenario("pedido sem conciliação do Mercado Pago → RECONCILING", () => {
  const bag = C.createEvidenceBag();
  base(bag, { cost: 40 });
  meliApi(bag, { price: 100, commission: 12, commissionRate: 0.12, freight: 20 });
  pedido(bag, { price: 100, commission: 12, freight: 20, cost: 40, taxRate: 0.1 });

  const item = montar(bag, { hasOrders: true, settlementAvailable: false });

  assert.strictEqual(item.margin.realized.computable, true);
  assert.strictEqual(item.quality.confidence, C.LEVELS.HIGH);
  assert.strictEqual(item.quality.status, C.STATUS.RECONCILING);
  assert.strictEqual(item.settlement.available, false);
  assert.strictEqual(item.settlement.netReceipt.status, "unavailable");
  assert.ok(temMotivo(item.quality.reasons, C.REASONS.SEM_CONCILIACAO_FINANCEIRA));
});

// ── 10. Mercado Pago conciliado ──────────────────────────────────────────────
cenario("Mercado Pago conciliado → sai de RECONCILING e vira HEALTHY", () => {
  const bag = C.createEvidenceBag();
  base(bag, { cost: 40 });
  meliApi(bag, { price: 100, commission: 12, commissionRate: 0.12, freight: 20 });
  pedido(bag, { price: 100, commission: 12, freight: 20 });
  bag.add(C.FIELDS.NET_RECEIPT, {
    source: C.SOURCES.MERCADO_PAGO,
    value: 68,
    kind: C.EVIDENCE_KINDS.REALIZED,
    quality: C.EVIDENCE_QUALITY.MEASURED,
    observedAt: RECENTE,
  });

  const item = montar(bag, { hasOrders: true, settlementAvailable: true });

  assert.strictEqual(item.quality.status, C.STATUS.HEALTHY);
  assert.strictEqual(item.settlement.available, true);
  assert.strictEqual(item.settlement.netReceipt.value, 68);
  assert.strictEqual(item.settlement.netReceipt.source, C.SOURCES.MERCADO_PAGO);
  assert.ok(!temMotivo(item.quality.reasons, C.REASONS.SEM_CONCILIACAO_FINANCEIRA));
});

// ── 11. Projetada ≠ realizada ────────────────────────────────────────────────
cenario("margem projetada ≠ realizada → erro de projeção em pontos percentuais", () => {
  const bag = C.createEvidenceBag();
  base(bag, { cost: 40 });
  // Projetado: 100 − 10 − 12 − 20 − 40 = 18 → 18,0%
  meliApi(bag, { price: 100, commission: 12, commissionRate: 0.12, freight: 20 });
  // Realizado: 100 − 10 − 12 − 21 − 40 = 17 → 17,0%
  pedido(bag, { price: 100, commission: 12, freight: 21, cost: 40, taxRate: 0.1 });

  const item = montar(bag, { hasOrders: true });

  assert.strictEqual(item.margin.projected.marginPercent, 18);
  assert.strictEqual(item.margin.realized.marginPercent, 17);
  assert.strictEqual(item.margin.projectionError.comparable, true);
  assert.strictEqual(item.margin.projectionError.deltaPp, -1);
  // Frete dentro da tolerância (1,00 em 21 ≈ 4,8% > 2% e > R$0,05) ⇒ é DRIFT.
  assert.ok(item.quality.hasDrift);
});

// ── 12. Fonte ausente ────────────────────────────────────────────────────────
cenario("fonte de frete ausente → assumido 0, variável UNKNOWN, item SUSPECT_DATA", () => {
  const bag = C.createEvidenceBag();
  base(bag, { cost: 40 });
  meliApi(bag, { price: 100, commission: 12, commissionRate: 0.12 }); // sem frete

  const item = montar(bag);

  assert.strictEqual(item.margin.projected.computable, true, "frete é opcional no cálculo");
  assert.deepStrictEqual(item.margin.projected.assumed, [C.FIELDS.FREIGHT]);
  assert.strictEqual(item.margin.projected.strict, false, "o número existe, mas não é estrito");
  assert.strictEqual(item.quality.confidenceByField.freight.level, C.LEVELS.UNKNOWN);
  assert.ok(temMotivo(item.quality.confidenceByField.freight.reasons, C.REASONS.ASSUMIDO_ZERO));
  assert.ok(temMotivo(item.quality.confidenceByField.freight.reasons, C.REASONS.DADO_AUSENTE));
  assert.strictEqual(item.quality.confidence, C.LEVELS.UNKNOWN);
  assert.strictEqual(item.quality.status, C.STATUS.SUSPECT_DATA);
});

// ── 13. Duas fontes em conflito ──────────────────────────────────────────────
cenario("API e extensão discordam do frete no MESMO momento → CONFLICT", () => {
  const bag = C.createEvidenceBag();
  base(bag, { cost: 40 });
  meliApi(bag, { price: 100, commission: 12, commissionRate: 0.12, freight: 23.4 });
  bag.add(C.FIELDS.FREIGHT, {
    source: C.SOURCES.EXTENSION_DOM,
    value: 35,
    kind: C.EVIDENCE_KINDS.PROJECTED,
    quality: C.EVIDENCE_QUALITY.MEASURED,
    observedAt: RECENTE,
  });

  const item = montar(bag);

  const divergencia = item.quality.divergences.find((d) => d.field === C.FIELDS.FREIGHT);
  assert.ok(divergencia, "conflito registrado");
  assert.strictEqual(divergencia.type, C.DIVERGENCE_TYPES.CONFLICT);
  assert.strictEqual(item.quality.hasConflict, true);
  assert.strictEqual(item.quality.confidenceByField.freight.level, C.LEVELS.LOW);
  assert.ok(temMotivo(item.quality.confidenceByField.freight.reasons, C.REASONS.FONTES_EM_CONFLITO));
  assert.strictEqual(item.quality.status, C.STATUS.SUSPECT_DATA);
  // A fonte mais forte (API) vence a escolha do valor; o DOM fica como evidência.
  assert.strictEqual(item.marketplaceCosts.freightProjected.source, C.SOURCES.MELI_API);
  assert.strictEqual(item.marketplaceCosts.freightProjected.value, 23.4);
});

// ── Complementares: fórmulas puras e regras de borda ─────────────────────────

cenario("preço alvo e break-even seguem a fórmula histórica do projeto", () => {
  // (custo + taxaFixa + frete) / (1 − imposto − comissão% − margemAlvo)
  const alvo = C.computeTargetPrice({
    cost: 40,
    fixedFee: 2,
    freight: 20,
    taxRate: 0.1,
    commissionRate: 0.12,
    targetMargin: 0.15,
  });
  assert.strictEqual(alvo.computable, true);
  assert.strictEqual(alvo.price, 98.41); // 62 / 0.63

  // Round-trip: vender pelo preço alvo devolve exatamente a margem alvo.
  const noAlvo = C.computeMargin({
    price: alvo.price,
    cost: 40,
    fixedFee: 2,
    freight: 20,
    taxRate: 0.1,
    commission: alvo.price * 0.12,
  });
  assert.ok(Math.abs(noAlvo.margin - 0.15) < 0.0001, `margem no preço alvo: ${noAlvo.margin}`);

  const breakEven = C.computeBreakEvenPrice({
    cost: 40,
    fixedFee: 2,
    freight: 20,
    taxRate: 0.1,
    commissionRate: 0.12,
  });
  assert.strictEqual(breakEven.price, 79.49); // 62 / 0.78

  // Margem alvo inviável não devolve preço absurdo: devolve o motivo.
  const inviavel = C.computeTargetPrice({
    cost: 40,
    freight: 0,
    taxRate: 0.5,
    commissionRate: 0.4,
    targetMargin: 0.2,
  });
  assert.strictEqual(inviavel.computable, false);
  assert.strictEqual(inviavel.reason, "MARGEM_ALVO_INVIAVEL");
  assert.strictEqual(inviavel.price, null);
});

cenario("dado antigo da API rebaixa a confiança um nível", () => {
  const bag = C.createEvidenceBag();
  base(bag, { cost: 40 });
  const antigo = new Date("2026-07-01T12:00:00.000Z"); // 42 dias antes de NOW
  bag.add(C.FIELDS.PRICE, {
    source: C.SOURCES.MELI_API,
    value: 100,
    kind: C.EVIDENCE_KINDS.PROJECTED,
    quality: C.EVIDENCE_QUALITY.MEASURED,
    observedAt: antigo,
  });
  meliApi(bag, { commission: 12, commissionRate: 0.12, freight: 20 });

  const item = montar(bag);
  assert.strictEqual(item.quality.confidenceByField.price.level, C.LEVELS.MEDIUM);
  assert.ok(temMotivo(item.quality.confidenceByField.price.reasons, C.REASONS.DADO_ANTIGO));
});

cenario("divergência dentro da tolerância NÃO vira divergência", () => {
  const bag = C.createEvidenceBag();
  base(bag, { cost: 40 });
  meliApi(bag, { price: 100, commission: 12, commissionRate: 0.12, freight: 20 });
  pedido(bag, { price: 100, commission: 12, freight: 20.02 }); // 2 centavos

  const item = montar(bag, { hasOrders: true });
  assert.deepStrictEqual(item.quality.divergences, []);
  assert.strictEqual(item.quality.confidenceByField.freight.level, C.LEVELS.HIGH);
  assert.ok(
    temMotivo(item.quality.confidenceByField.freight.reasons, C.REASONS.CONFIRMADO_POR_DUAS_FONTES)
  );
});

cenario("preço zero não vira margem 0 — vira variável obrigatória ausente", () => {
  const resultado = C.computeMargin({ price: 0, cost: 10 });
  assert.strictEqual(resultado.computable, false);
  assert.ok(resultado.missing.includes(C.FIELDS.PRICE));
  assert.strictEqual(resultado.margin, null);
});

cenario("houve venda mas nenhuma evidência realizada de frete → rebaixa a variável", () => {
  const bag = C.createEvidenceBag();
  base(bag, { cost: 40 });
  meliApi(bag, { price: 100, commission: 12, commissionRate: 0.12, freight: 20 });
  pedido(bag, { price: 100, commission: 12 }); // sem frete realizado

  const item = montar(bag, { hasOrders: true });
  const frete = item.quality.confidenceByField.freight;
  assert.strictEqual(frete.level, C.LEVELS.MEDIUM);
  assert.ok(temMotivo(frete.reasons, C.REASONS.SEM_EVIDENCIA_REALIZADA));
  // MEDIUM não é LOW: o item não é declarado suspeito por isso.
  assert.notStrictEqual(item.quality.status, C.STATUS.SUSPECT_DATA);
});

// ── O passado não pode mudar (AUDITORIA_ARQUITETURAL_CENTRAL_MARGEM §3/§4) ──

cenario("realizado usa custo/imposto HISTÓRICOS da venda, nunca a Base atual", () => {
  const bag = C.createEvidenceBag();
  // Base MUDOU depois da venda: custo atual é 999, muito diferente do
  // histórico. O projetado deve refletir o custo atual; o realizado NÃO.
  base(bag, { cost: 999, taxRate: 0.3 });
  meliApi(bag, { price: 100, commission: 12, commissionRate: 0.12, freight: 20 });
  // Histórico persistido pela Central de Vendas no momento da venda.
  pedido(bag, { price: 100, commission: 12, freight: 20, cost: 40, taxRate: 0.1 });

  const item = montar(bag, { hasOrders: true, settlementAvailable: true });

  // Projetado usa a Base de HOJE (999).
  assert.strictEqual(item.margin.projected.computable, true);
  assert.strictEqual(item.margin.projected.profit, 100 - 100 * 0.3 - 12 - 20 - 999);

  // Realizado usa o histórico (40/0.1), nunca os 999/0.3 da Base atual.
  assert.strictEqual(item.margin.realized.computable, true);
  assert.strictEqual(item.margin.realized.profit, 18); // 100 − 10 − 12 − 20 − 40
  assert.strictEqual(item.margin.realized.marginPercent, 18);
});

cenario("sem custo histórico da venda, realizado fica não-computável mesmo com custo atual disponível", () => {
  const bag = C.createEvidenceBag();
  base(bag, { cost: 40 }); // Base atual TEM custo
  meliApi(bag, { price: 100, commission: 12, commissionRate: 0.12, freight: 20 });
  // Central de Vendas não persistiu custo/imposto para esta venda.
  pedido(bag, { price: 100, commission: 12, freight: 20 });

  const item = montar(bag, { hasOrders: true, settlementAvailable: true });

  assert.strictEqual(item.margin.projected.computable, true, "projetado usa a Base normalmente");
  assert.strictEqual(item.margin.realized.computable, false, "custo é obrigatório e não pode vir do projetado");
  assert.strictEqual(item.margin.realized.margin, null);
  assert.ok(item.margin.realized.missing.includes(C.FIELDS.COST));
});

cenario("taxa fixa ausente no realizado permanece ausente, mesmo com taxa fixa atual disponível", () => {
  const bag = C.createEvidenceBag();
  base(bag, { cost: 40, fixedFee: 5 }); // Base atual TEM taxa fixa
  meliApi(bag, { price: 100, commission: 12, commissionRate: 0.12, freight: 20 });
  // Central de Vendas não preserva taxa fixa histórica hoje (gap documentado).
  pedido(bag, { price: 100, commission: 12, freight: 20, cost: 40, taxRate: 0.1 });

  const item = montar(bag, { hasOrders: true, settlementAvailable: true });

  assert.strictEqual(item.margin.projected.profit, 100 - 10 - 12 - 20 - 5 - 40, "projetado desconta a taxa fixa atual");
  // Realizado: taxa fixa é OPCIONAL (assumida 0), nunca herdada da Base atual.
  assert.strictEqual(item.margin.realized.computable, true);
  assert.ok(item.margin.realized.assumed.includes(C.FIELDS.FIXED_FEE), "taxa fixa entrou como assumida, não como 5");
  assert.strictEqual(item.margin.realized.strict, false);
  assert.strictEqual(item.margin.realized.profit, 18, "100 − 10 − 12 − 20 − 0(assumido) − 40, nunca −5");
});

// ── Equivalência do projetado antes/depois da refatoração (AUDITORIA §9) ─────
// `marginEngine` não foi tocado nesta rodada — só a ALIMENTAÇÃO do Motor
// mudou (prepareWorkspaceContext, projeção da Central de Vendas). Estes
// valores são um "golden set": mesmos inputs projetados devem sempre produzir
// o mesmo LC/MC, sem depender de nenhum adapter.
cenario("equivalência: mesmos inputs projetados produzem sempre o mesmo LC/MC (golden set)", () => {
  const casosGolden = [
    { input: { price: 100, cost: 40, taxRate: 0.1, fixedFee: 0, commission: 12, freight: 20 }, profit: 18, margin: 0.18 },
    { input: { price: 100, cost: 60, taxRate: 0.1, fixedFee: 0, commission: 12, freight: 15 }, profit: 3, margin: 0.03 },
    { input: { price: 100, cost: 40, taxRate: 0.1, fixedFee: 2, commission: 12, freight: 20 }, profit: 16, margin: 0.16 },
    { input: { price: 250, cost: 120, taxRate: 0.12, fixedFee: 5, commission: 30, freight: 18 }, profit: 47, margin: 0.188 },
  ];
  for (const { input, profit, margin } of casosGolden) {
    const resultado = C.computeMargin(input);
    assert.strictEqual(resultado.computable, true);
    assert.strictEqual(resultado.profit, profit, `profit para ${JSON.stringify(input)}`);
    assert.ok(Math.abs(resultado.margin - margin) < 1e-9, `margin para ${JSON.stringify(input)}`);
  }
});

// ── Runner ───────────────────────────────────────────────────────────────────

let falhas = 0;
for (const caso of casos) {
  try {
    caso.fn();
    console.log(`  ✓ ${caso.nome}`);
  } catch (err) {
    falhas += 1;
    console.error(`  ✗ ${caso.nome}\n    ${err.message}`);
  }
}

if (falhas > 0) {
  console.error(`motorMargemEngine: ${falhas} de ${casos.length} cenários falharam`);
  process.exitCode = 1;
} else {
  console.log(`motorMargemEngine: ok (${casos.length} cenários)`);
}
