// Contrato financeiro do Sentinel (puro): pedido ML → evidência normalizada e versionada.
//
// Regras que estes testes travam:
//   · valor ausente NUNCA vira zero; ausência de campo NUNCA prova ausência de promoção;
//   · parcela do ML é LIMITE SUPERIOR (tarifa pode já ser líquida: desconhecido), nunca crédito somado;
//   · gross_price é o TOTAL das unidades; amounts.* são POR UNIDADE;
//   · aritmética em centavos inteiros, sem tolerância silenciosa;
//   · a evidência é função só do pedido (snapshot/anúncio atual não entram).
//
// Grupos: M01–M14 = os 14 cenários da matriz adversarial (§G da revisão arquitetural);
// X* = casos específicos adicionais; A* = afirmar(); P* = preservação/hash.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CONTRATO_VERSAO, CONSTANTES_DO_CONTRATO, extrairEvidencia, afirmar, evidenciaParaPersistir, evidenciaParaHash, preservarEvidenciaMaisRica, rotuloAfirmacao, AFIRMACOES,
} = require("../services/sentinel/sentinelEvidenciaFinanceira");

const OBS = "2026-11-17T12:00:00.000Z";
const CTX = { clienteContaId: 7, sellerId: 555, observadoEm: OBS };
const item = (o = {}) => ({ item: { id: "MLB100", variation_id: null, seller_sku: "A" }, quantity: 1, unit_price: 80, sale_fee: 11.2, currency_id: "BRL", ...o });
const d = (full, seller, extra = {}) => ({ amounts: { full, seller }, ...extra });
const pedido = (itens, extra = {}) => ({
  id: 1001, status: "paid", date_created: "2026-11-10T12:00:00.000-03:00", date_last_updated: "2026-11-10T12:05:00.000-03:00",
  seller: { id: 555 }, order_items: itens, ...extra,
});
const ev = (o, ctx = {}) => extrairEvidencia(o, { ...CTX, ...ctx });
const i0 = (e) => e.itens[0];
const linha = (m, extra = {}) => ({ margem_valor: m, estado_margem: "confirmada", pendencias: [], status_ml: "paid", ...extra });

// ───────────────────────── M01 — venda sem promoção ─────────────────────────
test("M01 gross = unit×q com desconto explícito full=0 ⇒ SEM_DESCONTO observado, crédito 0", () => {
  const e = ev(pedido([item({ unit_price: 100, gross_price: 100, discounts: [d(0, 0)] })]));
  assert.equal(i0(e).estado, "SEM_DESCONTO");
  assert.equal(i0(e).confianca, "OBSERVADA");
  assert.equal(i0(e).credito_max, 0);
  assert.equal(e.credito_max_pedido, 0);
});

test("M01 gross = unit×q SEM campo discounts ⇒ SEM_DESCONTO só INFERIDO (nunca observado)", () => {
  const e = ev(pedido([item({ unit_price: 100, gross_price: 100 })]));
  assert.equal(i0(e).estado, "SEM_DESCONTO");
  assert.equal(i0(e).confianca, "INFERIDA");
  assert.equal(i0(e).credito_max, 0);
  assert.ok(i0(e).ausentes.includes("discounts"));
});

test("M01 lista discounts vazia é tão fraca quanto ausente: sem gross ⇒ NAO_INFORMADO, crédito null (≠ 0)", () => {
  const e = ev(pedido([item({ unit_price: 100, discounts: [] })]));
  assert.equal(i0(e).estado, "NAO_INFORMADO");
  assert.equal(i0(e).confianca, "NAO_VERIFICADA");
  assert.equal(i0(e).credito_max, null);
  assert.equal(e.credito_max_pedido, null);
});

test("M01 gross maior que o pago mas discounts vazio ⇒ desconto existe, repartição DESCONHECIDA (incompleto, crédito null)", () => {
  const e = ev(pedido([item({ unit_price: 80, gross_price: 100, discounts: [] })]));
  assert.equal(i0(e).estado, "REPARTICAO_DESCONHECIDA");
  assert.equal(i0(e).confianca, "INCOMPLETA");
  assert.equal(i0(e).desconto_unit, 2000);
  assert.ok(i0(e).derivados.includes("desconto_unit"));
  assert.equal(i0(e).credito_max, null);
  assert.ok(i0(e).motivos.includes("gross_indica_desconto_sem_discounts"));
});

// ───────────────────────── M02 — 100% do vendedor ─────────────────────────
test("M02 seller = full ⇒ DESCONTO_VENDEDOR, parcela do ML 0, crédito 0", () => {
  const e = ev(pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 20)] })]));
  assert.equal(i0(e).estado, "DESCONTO_VENDEDOR");
  assert.equal(i0(e).confianca, "OBSERVADA");
  assert.equal(i0(e).parcela_ml_unit, 0);
  assert.equal(i0(e).credito_max, 0);
});

// ───────────────────────── M03 / M06 — ML participa ─────────────────────────
test("M03 full > seller ⇒ ML_PARTICIPA; crédito = (full − seller) × q, só LIMITE (não é crédito comprovado)", () => {
  const e = ev(pedido([item({ quantity: 2, unit_price: 80, gross_price: 200, discounts: [d(20, 8)] })]));
  assert.equal(i0(e).estado, "ML_PARTICIPA");
  assert.equal(i0(e).parcela_ml_unit, 1200);
  assert.equal(i0(e).credito_max, 2400);
  assert.equal(e.credito_max_pedido, 2400);
  assert.equal(e.credito_natureza, "limite_superior_nao_comprovado");
  assert.equal(e.tarifa_liquida_de_rebate, "desconhecido");
});

test("M03 fronteira: m + C = 0 ⇒ OBSERVACAO; m + C = −0,01 ⇒ ROBUSTO (centavos exatos)", () => {
  const e = ev(pedido([item({ unit_price: 80, gross_price: 80.1, discounts: [d(0.1, 0.09)] })]));
  assert.equal(i0(e).credito_max, 1);
  assert.equal(afirmar({ evidencia: e, linha: linha(-0.01) }).afirmacao, "OBSERVACAO");
  assert.equal(afirmar({ evidencia: e, linha: linha(-0.02) }).afirmacao, "ROBUSTO");
});

test("M06 a política é a mesma com a tarifa líquida ou bruta: não depende de saber (limite superior)", () => {
  const e = ev(pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10)] })]));
  const a = afirmar({ evidencia: e, linha: linha(-5) });
  assert.equal(a.afirmacao, "OBSERVACAO"); // −5 + 10 ≥ 0
  assert.equal(a.margem_com_credito_max_centavos, 500);
  assert.equal(afirmar({ evidencia: e, linha: linha(-15) }).afirmacao, "ROBUSTO");
});

// ───────────────────────── M04 — participação desconhecida ─────────────────────────
test("M04 seller ausente ⇒ crédito null (NUNCA 0) e parcela_ml_unit null", () => {
  const e = ev(pedido([item({ unit_price: 80, gross_price: 100, discounts: [{ amounts: { full: 20 } }] })]));
  assert.equal(i0(e).estado, "REPARTICAO_DESCONHECIDA");
  assert.equal(i0(e).confianca, "INCOMPLETA");
  assert.equal(i0(e).parcela_ml_unit, null);
  assert.equal(i0(e).credito_max, null);
  assert.ok(i0(e).ausentes.includes("desconto_vendedor_unit"));
  assert.equal(afirmar({ evidencia: e, linha: linha(-3) }).afirmacao, "NAO_VERIFICADO");
});

test("M04 campos promocionais inteiramente ausentes ⇒ NAO_INFORMADO; jamais SEM_DESCONTO", () => {
  const e = ev(pedido([{ item: { id: "MLB100" }, quantity: 1, unit_price: 80 }]));
  assert.equal(i0(e).estado, "NAO_INFORMADO");
  assert.equal(i0(e).confianca, "NAO_VERIFICADA");
  assert.equal(i0(e).credito_max, null);
  assert.deepEqual(i0(e).ausentes.sort(), ["discounts", "gross_price", "sale_fee"].sort());
  assert.equal(e.estado, "NAO_DETERMINADO");
  assert.equal(e.credito_max_pedido, null);
  assert.equal(afirmar({ evidencia: e, linha: linha(-3) }).afirmacao, "NAO_VERIFICADO");
});

// ───────────────────────── M05 / X7 — funding_mode é só indício ─────────────────────────
test("M05 funding_mode: sale_fee é INDÍCIO: não zera o crédito e não declara a tarifa líquida", () => {
  const e = ev(pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10, { funding_mode: "sale_fee" })] })]));
  assert.ok(i0(e).indicios.includes("funding_mode:sale_fee"));
  assert.equal(i0(e).credito_max, 1000);
  assert.equal(e.tarifa_liquida_de_rebate, "desconhecido");
  assert.equal(afirmar({ evidencia: e, linha: linha(-20) }).afirmacao, "ROBUSTO");
});

// ───────────────────────── M07 — legado ─────────────────────────
test("M07 linha sem calculo_versao ⇒ rótulo LEGADO (nunca convertida em evidência)", () => {
  assert.equal(rotuloAfirmacao({ calculo_versao: null, afirmacao_financeira: null }), "LEGADO");
  assert.equal(rotuloAfirmacao({}), "LEGADO");
  assert.equal(rotuloAfirmacao({ calculo_versao: 1, afirmacao_financeira: "CATEGORICO" }), "CATEGORICO");
  assert.equal(CONTRATO_VERSAO, 1);
});

// ───────────────────────── M08 — promoção alterada depois da venda ─────────────────────────
test("M08 a evidência é só do pedido: snapshot/preço atual do anúncio no contexto NÃO entram", () => {
  const o = pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10)] })]);
  const a = ev(o);
  const b = ev(o, { snapshotPromo: { vigente: 50, financiamento: "VENDEDOR_100" }, precoAtualAnuncio: 50 });
  assert.deepEqual(a, b);
});

test("M08 pedido reobservado depois da mudança: data NOVA ⇒ evidência nova vence, mesmo mais pobre", () => {
  const rica = ev(pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10)] })]));
  const nova = ev(pedido([item({ unit_price: 80 })], { date_last_updated: "2026-11-11T09:00:00.000-03:00" }));
  assert.equal(preservarEvidenciaMaisRica(nova, rica), nova);
});

// ───────────────────────── M09 — duas linhas de desconto ─────────────────────────
test("M09 duas linhas ADITIVAS confirmadas pelo gross ⇒ soma (full e seller)", () => {
  const e = ev(pedido([item({ unit_price: 70, gross_price: 100, discounts: [d(20, 20), d(10, 4)] })]));
  assert.equal(i0(e).desconto_unit, 3000);
  assert.equal(i0(e).desconto_vendedor_unit, 2400);
  assert.equal(i0(e).parcela_ml_unit, 600);
  assert.equal(i0(e).credito_max, 600);
  assert.equal(i0(e).estado, "ML_PARTICIPA");
});

test("M09 duas linhas SOBREPOSTAS (gross confirma só a maior) ⇒ NÃO soma duas vezes", () => {
  const e = ev(pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10), d(20, 10)] })]));
  assert.equal(i0(e).desconto_unit, 2000);
  assert.ok(i0(e).motivos.includes("descontos_sobrepostos"));
  assert.equal(i0(e).credito_max, 1000);
});

test("M09 linhas que não reconciliam com o gross ⇒ INCONSISTENTE, sem crédito", () => {
  const e = ev(pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(15, 5), d(10, 5)] })]));
  assert.equal(i0(e).estado, "INCONSISTENTE");
  assert.equal(i0(e).credito_max, null);
  assert.ok(i0(e).motivos.includes("descontos_nao_reconciliam"));
});

test("M09 duas linhas sem gross para desambiguar ⇒ incompleto, crédito null (não escolhe soma nem máximo)", () => {
  const e = ev(pedido([item({ unit_price: 70, discounts: [d(20, 20), d(10, 4)] })]));
  assert.equal(i0(e).estado, "REPARTICAO_DESCONHECIDA");
  assert.equal(i0(e).credito_max, null);
  assert.ok(i0(e).motivos.includes("descontos_multiplos_ambiguos"));
});

test("M09 linha extra zerada não gera ambiguidade", () => {
  const e = ev(pedido([item({ unit_price: 80, discounts: [d(20, 10), d(0, 0)] })]));
  assert.equal(i0(e).desconto_unit, 2000);
  assert.equal(i0(e).credito_max, 1000);
});

// ───────────────────────── M10 / X10 — multi-item e variações ─────────────────────────
test("M10 item A com ML e item B sem desconto ⇒ C = c_A; o desconto de A nunca é aplicado a B", () => {
  const e = ev(pedido([
    item({ item: { id: "MLB100", seller_sku: "A" }, unit_price: 80, gross_price: 100, discounts: [d(20, 10)] }),
    item({ item: { id: "MLB200", seller_sku: "B" }, unit_price: 40, gross_price: 40, discounts: [d(0, 0)] }),
  ]));
  assert.equal(e.itens[0].credito_max, 1000);
  assert.equal(e.itens[1].credito_max, 0);
  assert.equal(e.credito_max_pedido, 1000);
  assert.equal(e.itens[1].desconto_unit, 0);
});

test("M10 qualquer item com crédito null ⇒ crédito do pedido null (não soma parcial)", () => {
  const e = ev(pedido([
    item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10)] }),
    item({ item: { id: "MLB200" }, unit_price: 40 }),
  ]));
  assert.equal(e.itens[0].credito_max, 1000);
  assert.equal(e.itens[1].credito_max, null);
  assert.equal(e.credito_max_pedido, null);
});

test("X10 mesma publicação, DUAS variações com descontos diferentes ⇒ itens independentes por idx/variation_id", () => {
  const e = ev(pedido([
    item({ item: { id: "MLB100", variation_id: 111, seller_sku: "A-P" }, unit_price: 80, gross_price: 100, discounts: [d(20, 20)] }),
    item({ item: { id: "MLB100", variation_id: 222, seller_sku: "A-G" }, unit_price: 80, gross_price: 100, discounts: [d(20, 0)] }),
  ]));
  assert.deepEqual(e.itens.map((i) => [i.idx, i.variation_id, i.estado, i.credito_max]),
    [[0, "111", "DESCONTO_VENDEDOR", 0], [1, "222", "ML_PARTICIPA", 2000]]);
  assert.equal(e.credito_max_pedido, 2000);
});

// ───────────────────────── M11 — identidades violadas ─────────────────────────
test("M11 gross ≠ (unit + full) × q ⇒ INCONSISTENTE e a diferença em centavos fica registrada", () => {
  const e = ev(pedido([item({ quantity: 2, unit_price: 80, gross_price: 201, discounts: [d(20, 10)] })]));
  assert.equal(i0(e).estado, "INCONSISTENTE");
  assert.equal(i0(e).confianca, "CONTRADITORIA");
  assert.equal(i0(e).verificacoes.gross, "falha");
  assert.equal(i0(e).verificacoes.dif_gross_centavos, 100);
  assert.equal(i0(e).credito_max, null);
  assert.equal(e.estado, "INCONSISTENTE");
  assert.equal(afirmar({ evidencia: e, linha: linha(-3) }).afirmacao, "INCONSISTENTE");
});

test("M11 seller > full ⇒ INCONSISTENTE; desconto negativo ⇒ INCONSISTENTE", () => {
  assert.equal(i0(ev(pedido([item({ discounts: [d(10, 12)] })]))).estado, "INCONSISTENTE");
  const neg = ev(pedido([item({ discounts: [d(-5, 0)] })]));
  assert.equal(i0(neg).estado, "INCONSISTENTE");
  assert.ok(i0(neg).motivos.includes("desconto_negativo"));
});

test("M11 sale_fee negativo ou acima do preço ⇒ INCONSISTENTE (faixa)", () => {
  assert.ok(i0(ev(pedido([item({ unit_price: 80, sale_fee: 81 })]))).motivos.includes("sale_fee_fora_da_faixa"));
  assert.equal(i0(ev(pedido([item({ sale_fee: -1 })]))).estado, "INCONSISTENTE");
  assert.equal(i0(ev(pedido([item({ unit_price: 80, sale_fee: 80 })]))).verificacoes.sale_fee, "ok");
});

test("M11 preço ≤ 0 ou quantidade inválida ⇒ INCONSISTENTE", () => {
  for (const o of [{ unit_price: 0 }, { unit_price: -3 }, { quantity: 0 }, { quantity: 1.5 }, { quantity: null }, { unit_price: null }]) {
    const e = ev(pedido([item(o)]));
    assert.equal(i0(e).estado, "INCONSISTENTE", JSON.stringify(o));
    assert.equal(i0(e).credito_max, null);
  }
});

// ───────────────────────── M12 — reprocessamento determinístico ─────────────────────────
test("M12 mesmo pedido 2× ⇒ evidência idêntica e hash idêntico, mesmo com observado_em diferente", () => {
  const o = pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10)] })]);
  const a = ev(o);
  const b = ev(o, { observadoEm: "2026-11-18T01:02:03.000Z" });
  assert.notDeepEqual(a, b);
  assert.deepEqual(evidenciaParaHash(a), evidenciaParaHash(b));
  assert.equal(JSON.stringify(evidenciaParaHash(a)), JSON.stringify(evidenciaParaHash(b)));
  assert.equal("observado_em" in evidenciaParaHash(a), false);
});

test("M12 a ordem das chaves do payload do ML não altera a evidência", () => {
  const o1 = pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10)] })]);
  const o2 = { order_items: [{ discounts: [{ amounts: { seller: 10, full: 20 } }], gross_price: 100, currency_id: "BRL", sale_fee: 11.2, unit_price: 80, quantity: 1, item: { seller_sku: "A", variation_id: null, id: "MLB100" } }],
    seller: { id: 555 }, date_last_updated: o1.date_last_updated, date_created: o1.date_created, status: "paid", id: 1001 };
  assert.deepEqual(ev(o1), ev(o2));
});

test("M12 não muta o pedido de entrada (objeto congelado passa)", () => {
  const o = pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10)] })]);
  const congelar = (x) => { if (x && typeof x === "object") { Object.values(x).forEach(congelar); Object.freeze(x); } return x; };
  assert.doesNotThrow(() => ev(congelar(o)));
});

// ───────────────────────── M13 — cupom / cashback ─────────────────────────
test("M13 cupom do ML (seller = 0) ⇒ ML_PARTICIPA, parcela = full", () => {
  const e = ev(pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 0)] })]));
  assert.equal(i0(e).estado, "ML_PARTICIPA");
  assert.equal(i0(e).parcela_ml_unit, 2000);
});

test("X4 cupom no pedido/pagamento é SINAL: não gera crédito, não zera nada e impede o rótulo categórico", () => {
  const base = pedido([item({ unit_price: 100, gross_price: 100, discounts: [d(0, 0)] })]);
  const limpo = ev(base);
  assert.equal(afirmar({ evidencia: limpo, linha: linha(-3) }).afirmacao, "CATEGORICO");
  const comCupom = ev({ ...base, coupon: { id: "C1", amount: 15 }, payments: [{ coupon_amount: 15 }] });
  assert.equal(comCupom.sinais.cupom_pedido, 1500);
  assert.equal(comCupom.sinais.cupom_pagamentos, 1500);
  assert.ok(comCupom.motivos.includes("cupom_presente_nao_modelado"));
  assert.equal(comCupom.credito_max_pedido, 0); // o cupom não vira crédito
  assert.equal(afirmar({ evidencia: comCupom, linha: linha(-3) }).afirmacao, "NAO_VERIFICADO");
});

test("X4 cupom zerado (coupon.amount 0, coupon_amount 0) não é sinal", () => {
  const e = ev({ ...pedido([item({ unit_price: 100, gross_price: 100, discounts: [d(0, 0)] })]), coupon: { id: null, amount: 0 }, payments: [{ coupon_amount: 0 }] });
  assert.equal(e.sinais.cupom_pedido, null);
  assert.equal(e.sinais.cupom_pagamentos, null);
  assert.equal(e.motivos.includes("cupom_presente_nao_modelado"), false);
});

test("X4 cashback sem campo documentado no pedido: chave desconhecida é IGNORADA e nunca vira crédito", () => {
  const e = ev(pedido([item({ unit_price: 100, gross_price: 100, discounts: [d(0, 0)], cashback: { amount: 50 } })]), {});
  assert.equal(e.credito_max_pedido, 0);
  assert.equal(JSON.stringify(e).includes("cashback"), false);
});

// ───────────────────────── M14 — sale_fee ausente ─────────────────────────
test("M14 sale_fee ausente é registrado como ausente (não zero) e não depende da evidência de desconto", () => {
  const e = ev(pedido([item({ sale_fee: undefined, unit_price: 80, gross_price: 100, discounts: [d(20, 10)] })]));
  assert.ok(i0(e).ausentes.includes("sale_fee"));
  assert.equal(i0(e).sale_fee_unit, null);
  assert.equal(i0(e).estado, "ML_PARTICIPA");
  assert.equal(i0(e).verificacoes.sale_fee, "nao_aplicavel");
});

// ───────────────────────── X1/X2 — gross total × unitário, desconto unitário × total ─────────────────────────
test("X1 gross_price é o TOTAL: q=3, unit 100, full 10 ⇒ gross 330, bruto unitário 110", () => {
  const e = ev(pedido([item({ quantity: 3, unit_price: 100, gross_price: 330, discounts: [d(10, 10)] })]));
  assert.equal(i0(e).preco_bruto_total, 33000);
  assert.equal(i0(e).preco_bruto_unit, 11000);
  assert.equal(i0(e).verificacoes.gross, "ok");
  assert.equal(i0(e).estado, "DESCONTO_VENDEDOR");
});

test("X1 gross lido como UNITÁRIO (110 com q=3) é detectado como inconsistente, não aceito", () => {
  const e = ev(pedido([item({ quantity: 3, unit_price: 100, gross_price: 110, discounts: [d(10, 10)] })]));
  assert.equal(i0(e).estado, "INCONSISTENTE");
  assert.equal(i0(e).verificacoes.dif_gross_centavos, -22000);
  assert.equal(i0(e).credito_max, null);
});

test("X1 gross não divisível por q em centavos ⇒ INCONSISTENTE", () => {
  const e = ev(pedido([item({ quantity: 3, unit_price: 100, gross_price: 300.01 })]));
  assert.equal(i0(e).estado, "INCONSISTENTE");
  assert.ok(i0(e).motivos.includes("gross_nao_divisivel"));
});

test("X2 desconto informado como TOTAL (30 em vez de 10/un, q=3) não reconcilia com o gross ⇒ INCONSISTENTE", () => {
  const e = ev(pedido([item({ quantity: 3, unit_price: 100, gross_price: 330, discounts: [d(30, 0)] })]));
  assert.equal(i0(e).estado, "INCONSISTENTE");
  assert.equal(i0(e).credito_max, null);
});

test("X2 desconto por unidade com q=3: crédito = parcela unitária × 3 (não × 1)", () => {
  const e = ev(pedido([item({ quantity: 3, unit_price: 100, gross_price: 330, discounts: [d(10, 4)] })]));
  assert.equal(i0(e).parcela_ml_unit, 600);
  assert.equal(i0(e).credito_max, 1800);
});

// ───────────────────────── X9 — descontos incoerentes com preço e quantidade ─────────────────────────
test("X9 gross menor que o pago ⇒ INCONSISTENTE (desconto negativo implícito)", () => {
  const e = ev(pedido([item({ quantity: 2, unit_price: 80, gross_price: 150 })]));
  assert.equal(i0(e).estado, "INCONSISTENTE");
  assert.ok(i0(e).motivos.includes("gross_menor_que_pago"));
});

// ───────────────────────── X13 — centavos ─────────────────────────
test("X13 ruído de ponto flutuante é normalizado; fração de centavo NÃO é arredondada em silêncio", () => {
  const ruido = ev(pedido([item({ unit_price: 0.1 * 3, gross_price: 0.1 * 3 })]));
  assert.equal(i0(ruido).preco_unit, 30);
  assert.equal(i0(ruido).verificacoes.gross, "ok");
  const frac = ev(pedido([item({ unit_price: 10.005 })]));
  assert.equal(i0(frac).estado, "INCONSISTENTE");
  assert.ok(i0(frac).motivos.includes("valor_fracionario"));
});

test("X13 diferença de UM centavo no gross não é tolerada", () => {
  const e = ev(pedido([item({ unit_price: 80, gross_price: 100.01, discounts: [d(20, 10)] })]));
  assert.equal(i0(e).estado, "INCONSISTENTE");
  assert.equal(i0(e).verificacoes.dif_gross_centavos, 1);
});

test("X13 valores em string numérica do ML são aceitos; texto não numérico é ausente, não zero", () => {
  const ok = ev(pedido([item({ unit_price: "80.00", gross_price: "100.00", discounts: [d("20.00", "10.00")] })]));
  assert.equal(i0(ok).credito_max, 1000);
  const lixo = ev(pedido([item({ unit_price: 80, gross_price: "n/a", discounts: [d("x", "y")] })]));
  assert.equal(i0(lixo).credito_max, null);
  assert.notEqual(i0(lixo).estado, "SEM_DESCONTO");
});

// ───────────────────────── X14 — isolamento de conta e sanidade do pedido ─────────────────────────
test("X14 a evidência carrega conta e pedido; pedido de OUTRO seller ⇒ INCONSISTENTE sem crédito", () => {
  const ok = ev(pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10)] })]));
  assert.deepEqual(ok.conta, { cliente_conta_id: 7, seller_id: "555" });
  assert.equal(ok.pedido.id, "1001");
  const outro = ev(pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10)] })], { seller: { id: 999 } }));
  assert.equal(outro.estado, "INCONSISTENTE");
  assert.ok(outro.motivos.includes("seller_divergente"));
  assert.equal(outro.credito_max_pedido, null);
});

test("X14 duas contas, mesmo pedido: evidências distintas por conta, sem estado compartilhado", () => {
  const o = pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10)] })]);
  const a = ev(o, { clienteContaId: 7 });
  const b = ev(o, { clienteContaId: 8 });
  assert.equal(a.conta.cliente_conta_id, 7);
  assert.equal(b.conta.cliente_conta_id, 8);
  assert.notEqual(a, b);
  assert.deepEqual({ ...a, conta: null }, { ...b, conta: null });
});

test("X14 moeda diferente de BRL (ex.: exemplo MXN da doc) ⇒ INCONSISTENTE; sem itens ⇒ NAO_INFORMADO", () => {
  const mxn = ev(pedido([item({ currency_id: "MXN", unit_price: 440, quantity: 2, gross_price: 1562, discounts: [d(341, 341)] })]));
  assert.equal(mxn.estado, "INCONSISTENTE");
  assert.ok(mxn.motivos.includes("moeda_inesperada"));
  const vazio = ev(pedido([]));
  assert.equal(vazio.estado, "NAO_DETERMINADO");
  assert.ok(vazio.motivos.includes("sem_itens"));
  assert.equal(vazio.credito_max_pedido, null);
});

test("X14 pedido sem id ⇒ lança (não grava evidência órfã)", () => {
  assert.throws(() => ev({ order_items: [] }), /id/);
  assert.throws(() => extrairEvidencia(pedido([item()]), { sellerId: 555 }), /clienteContaId/);
});

// ───────────────────────── X16 — tamanho ─────────────────────────
test("X16 forma persistida compacta: 1 item típico < 800 B (medido ~780); 10 itens < 5 KB (medido ~4,3 KB); estável no reprocessamento; não copia o pedido do ML", () => {
  const o = pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10, { funding_mode: "sale_fee" })] })]);
  const a = JSON.stringify(evidenciaParaPersistir(ev(o)));
  assert.ok(Buffer.byteLength(a) < 800, `tamanho ${Buffer.byteLength(a)}`);
  assert.equal(JSON.stringify(evidenciaParaPersistir(ev(o))), a);
  const grande = JSON.stringify(evidenciaParaPersistir(ev(pedido(Array.from({ length: 10 }, (_, i) => item({ item: { id: `MLB${i}` }, unit_price: 80, gross_price: 100, discounts: [d(20, 10)] }))))));
  assert.ok(Buffer.byteLength(grande) < 5 * 1024, `10 itens: ${Buffer.byteLength(grande)}`);
  assert.equal(a.includes("title"), false);
});

test("X16 teto de itens: pedido com 150 itens grava no máximo 100 e sinaliza itens_truncados", () => {
  const e = ev(pedido(Array.from({ length: 150 }, (_, i) => item({ item: { id: `MLB${i}` } }))));
  assert.equal(e.itens.length, 100);
  assert.ok(e.motivos.includes("itens_truncados"));
  assert.equal(e.credito_max_pedido, null);
});

test("X16 compactação: omite null/[]/constantes mas PRESERVA zero (ausente ≠ 0)", () => {
  const p = evidenciaParaPersistir(ev(pedido([item({ unit_price: 100, gross_price: 100, discounts: [d(0, 0)] })])));
  assert.equal(p.itens[0].credito_max, 0);
  assert.equal(p.itens[0].desconto_unit, 0);
  assert.equal(p.credito_max_pedido, 0);
  assert.equal("ausentes" in p.itens[0], false); // [] omitido (discounts veio no pedido)
  assert.equal("sinais" in p, false);
  assert.equal("tarifa_liquida_de_rebate" in p, false);
  assert.deepEqual(CONSTANTES_DO_CONTRATO, { unidade_monetaria: "centavos", tarifa_liquida_de_rebate: "desconhecido", credito_natureza: "limite_superior_nao_comprovado" });
  const nulo = evidenciaParaPersistir(ev(pedido([{ item: { id: "MLB1" }, quantity: 1, unit_price: 80 }])));
  assert.equal("credito_max" in nulo.itens[0], false); // null ⇒ omitido, jamais 0
  assert.equal("credito_max_pedido" in nulo, false);
});

// ───────────────────────── A* — afirmar() ─────────────────────────
const eSem = () => ev(pedido([item({ unit_price: 100, gross_price: 100, discounts: [d(0, 0)] })]));
const eMl = () => ev(pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10)] })]));

test("A1 CATEGORICO: m<0, margem confirmada, crédito 0 observado", () => {
  const r = afirmar({ evidencia: eSem(), linha: linha(-0.01) });
  assert.equal(r.afirmacao, "CATEGORICO");
  assert.equal(r.margem_com_credito_max_centavos, -1);
});

test("A1 crédito 0 só INFERIDO (gross sem discounts) ⇒ NAO_VERIFICADO, não categórico", () => {
  const e = ev(pedido([item({ unit_price: 100, gross_price: 100 })]));
  assert.equal(afirmar({ evidencia: e, linha: linha(-5) }).afirmacao, "NAO_VERIFICADO");
});

test("A2 ROBUSTO e OBSERVACAO conforme m + C", () => {
  assert.equal(afirmar({ evidencia: eMl(), linha: linha(-10.01) }).afirmacao, "ROBUSTO");
  assert.equal(afirmar({ evidencia: eMl(), linha: linha(-10) }).afirmacao, "OBSERVACAO");
  assert.equal(afirmar({ evidencia: eMl(), linha: linha(-0.5) }).afirmacao, "OBSERVACAO");
});

test("A3 m ≥ 0 ⇒ SEM_PREJUIZO (a evidência segue registrada, mas não há perda a afirmar)", () => {
  assert.equal(afirmar({ evidencia: eMl(), linha: linha(0) }).afirmacao, "SEM_PREJUIZO");
  assert.equal(afirmar({ evidencia: eMl(), linha: linha(12) }).afirmacao, "SEM_PREJUIZO");
});

test("A4 INDETERMINADO: sem_custo/custo_ambiguo/erro/pack incompleto/margem nula", () => {
  for (const l of [linha(null, { estado_margem: "sem_custo" }), linha(null, { estado_margem: "custo_ambiguo" }),
    linha(null, { estado_margem: "erro" }), linha(-5, { pendencias: ["frete_pack_incompleto"], estado_margem: "provisoria" }),
    linha(null)]) {
    assert.equal(afirmar({ evidencia: eMl(), linha: l }).afirmacao, "INDETERMINADO", JSON.stringify(l));
  }
});

test("A5 margem provisória ou venda com ressalva ⇒ MARGEM_NAO_CONFIRMADA (não afirma nada sobre o crédito)", () => {
  assert.equal(afirmar({ evidencia: eMl(), linha: linha(-5, { estado_margem: "provisoria", pendencias: ["sem_frete"] }) }).afirmacao, "MARGEM_NAO_CONFIRMADA");
  assert.equal(afirmar({ evidencia: eMl(), linha: linha(-5, { status_ml: "partially_refunded" }) }).afirmacao, "MARGEM_NAO_CONFIRMADA");
});

test("A6 pedido cancelado/não pago ⇒ NAO_APLICAVEL", () => {
  assert.equal(afirmar({ evidencia: eMl(), linha: linha(-5, { status_ml: "cancelled" }) }).afirmacao, "NAO_APLICAVEL");
  assert.equal(afirmar({ evidencia: eMl(), linha: linha(-5, { status_ml: null }) }).afirmacao, "NAO_APLICAVEL");
});

test("A7 INCONSISTENTE prevalece sobre crédito; evidência ausente ⇒ NAO_VERIFICADO; nunca altera a margem", () => {
  const incons = ev(pedido([item({ unit_price: 80, gross_price: 999, discounts: [d(20, 10)] })]));
  assert.equal(afirmar({ evidencia: incons, linha: linha(-5) }).afirmacao, "INCONSISTENTE");
  assert.equal(afirmar({ evidencia: null, linha: linha(-5) }).afirmacao, "NAO_VERIFICADO");
  const l = linha(-5);
  const antes = JSON.stringify(l);
  afirmar({ evidencia: eMl(), linha: l });
  assert.equal(JSON.stringify(l), antes);
});

test("A8 todas as afirmações possíveis estão no enum do contrato", () => {
  const vistas = new Set([
    afirmar({ evidencia: eSem(), linha: linha(-1) }).afirmacao, afirmar({ evidencia: eMl(), linha: linha(-30) }).afirmacao,
    afirmar({ evidencia: eMl(), linha: linha(-1) }).afirmacao, afirmar({ evidencia: eMl(), linha: linha(1) }).afirmacao,
    afirmar({ evidencia: null, linha: linha(-1) }).afirmacao, afirmar({ evidencia: eMl(), linha: linha(null, { estado_margem: "erro" }) }).afirmacao,
    afirmar({ evidencia: eMl(), linha: linha(-1, { status_ml: "cancelled" }) }).afirmacao,
  ]);
  for (const a of vistas) assert.ok(AFIRMACOES.includes(a), a);
});

// ───────────────────────── P* — preservação de evidência e hash ─────────────────────────
test("P1 mesma versão do pedido, reobservação mais POBRE ⇒ preserva a evidência rica anterior", () => {
  const rica = ev(pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10)] })]));
  const pobre = ev(pedido([item({ unit_price: 80 })]), { observadoEm: "2026-11-17T13:00:00.000Z" });
  assert.ok(rica.completude > pobre.completude);
  assert.equal(preservarEvidenciaMaisRica(pobre, rica), rica);
});

test("P1 mesma versão, reobservação igual ou mais rica ⇒ a nova vence", () => {
  const pobre = ev(pedido([item({ unit_price: 80 })]));
  const rica = ev(pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10)] })]));
  assert.equal(preservarEvidenciaMaisRica(rica, pobre), rica);
  const igual = ev(pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10)] })]), { observadoEm: "2026-11-18T00:00:00.000Z" });
  assert.equal(preservarEvidenciaMaisRica(igual, rica), igual);
});

test("P1 nunca preserva entre contas, pedidos ou versões do contrato diferentes", () => {
  const rica = ev(pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10)] })]));
  const pobre = ev(pedido([item({ unit_price: 80 })]));
  const outraConta = ev(pedido([item({ unit_price: 80 })]), { clienteContaId: 8 });
  assert.equal(preservarEvidenciaMaisRica(outraConta, rica), outraConta);
  const outroPedido = ev(pedido([item({ unit_price: 80 })], { id: 2002 }));
  assert.equal(preservarEvidenciaMaisRica(outroPedido, rica), outroPedido);
  assert.equal(preservarEvidenciaMaisRica(pobre, { ...rica, v: 0 }), pobre);
  assert.equal(preservarEvidenciaMaisRica(pobre, null), pobre);
  assert.equal(preservarEvidenciaMaisRica(pobre, "lixo"), pobre);
});

test("P3 momentos distintos: venda, atualização do pedido e observação ficam separados", () => {
  const e = ev(pedido([item()]));
  assert.equal(e.pedido.criado_em, "2026-11-10T12:00:00.000-03:00");
  assert.equal(e.pedido.atualizado_em, "2026-11-10T12:05:00.000-03:00");
  assert.equal(e.observado_em, OBS);
  assert.equal(e.v, 1);
  assert.equal(e.fonte, "orders_api");
});

test("P4 exemplo da documentação do ML (formato exato, moeda trocada p/ BRL): reconcilia", () => {
  // gerenciamento-de-vendas.md:313-340 — q=2, unit 440, full 341, seller 341, gross 1562.
  const e = ev(pedido([{ item: { id: "MLB823798303", title: "Versace Pour Homme 100ml Edt Spray" }, quantity: 2, unit_price: 440.0,
    discounts: [{ amounts: { full: 341.0, seller: 341.0 } }], gross_price: 1562.0, currency_id: "BRL" }]));
  assert.equal(i0(e).verificacoes.gross, "ok");
  assert.equal(i0(e).estado, "DESCONTO_VENDEDOR");
  assert.equal(i0(e).preco_bruto_unit, 78100);
  assert.equal(JSON.stringify(e).includes("Versace"), false);
});

// ───────────────────────── C* — preparo p/ conciliação futura (sem contabilizar em dobro) ─────────────────────────
// Fontes futuras (NÃO integradas nesta fase; docs locais): /billing (provisoes.md:172-177, :241-245: sale_fee.gross/net/
// rebate/discount/discount_reason), /orders/{id}/discounts (gerenciamento-de-vendas.md:920-1030).
const { VALIDACOES_PENDENTES, ESTADOS_CONCILIACAO } = require("../services/sentinel/sentinelEvidenciaFinanceira");

test("C1 toda evidência nasce NAO_CONCILIADA: nenhuma fonte de conciliação foi lida nesta fase", () => {
  const e = ev(pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 10, { funding_mode: "sale_fee" })] })]));
  assert.equal(e.conciliacao, "NAO_CONCILIADO");
  assert.equal("conciliacao" in evidenciaParaPersistir(e), false); // padrão omitido: ausente ⇒ NAO_CONCILIADO
  assert.deepEqual([...ESTADOS_CONCILIACAO], ["NAO_CONCILIADO", "TARIFA_LIQUIDA_COMPROVADA", "TARIFA_BRUTA_COMPROVADA", "DIVERGENTE"]);
});

test("C2 desconto financiado pelo ML NUNCA vira crédito confirmado: só limite superior, margem oficial intocada", () => {
  const e = ev(pedido([item({ unit_price: 80, gross_price: 100, discounts: [d(20, 0, { funding_mode: "sale_fee" })] })]));
  assert.equal(e.credito_natureza, "limite_superior_nao_comprovado");
  const l = linha(-5);
  const r = afirmar({ evidencia: e, linha: l });
  assert.equal(l.margem_valor, -5);
  assert.equal(r.margem_centavos, -500); // a margem do motor, sem o crédito
  assert.equal(r.margem_com_credito_max_centavos, 1500); // só leitura de LIMITE, nunca gravada como margem
  assert.notEqual(r.afirmacao, "CATEGORICO");
});

test("C3 a lista do que validar em pedidos BRASILEIROS reais é explícita, rastreável e honesta sobre o que já foi observado", () => {
  const ids = VALIDACOES_PENDENTES.map((v) => v.id);
  for (const id of ["amounts_presentes_em_orders_search_mlb", "gross_price_presente_mlb", "tarifa_liquida_de_rebate",
    "amounts_unidade_pedido_vs_discounts", "payments_nao_e_fonte_de_cupom", "boosted_offer_via_custos_por_venda", "funding_mode_semantica",
    "cupom_do_vendedor_nao_modelado"]) {
    assert.ok(ids.includes(id), id);
  }
  assert.equal(new Set(ids).size, ids.length);
  const STATUS = new Set(["NAO_VALIDADO", "VALIDADO_PARCIAL", "VALIDADO_NEGATIVO"]);
  for (const v of VALIDACOES_PENDENTES) {
    assert.ok(v.fonte && v.o_que_validar && v.bloqueia, v.id);
    assert.ok(STATUS.has(v.status), `${v.id}: ${v.status}`);
    if (v.status !== "NAO_VALIDADO") assert.ok(v.evidencia_real && /17\/11\/2026/.test(v.evidencia_real), `${v.id} precisa citar a evidência real e a data`);
  }
  const por = Object.fromEntries(VALIDACOES_PENDENTES.map((v) => [v.id, v.status]));
  assert.equal(por.amounts_presentes_em_orders_search_mlb, "VALIDADO_NEGATIVO"); // 0 de 284 itens trazem discounts[]
  assert.equal(por.tarifa_liquida_de_rebate, "NAO_VALIDADO"); // sem conciliação com o faturamento nada se afirma
  assert.equal(por.boosted_offer_via_custos_por_venda, "NAO_VALIDADO");
});

test("C4 cupom visto só no nó payments é sinal FRACO: rebaixa a afirmação mas nunca gera crédito", () => {
  const e = ev({ ...pedido([item({ unit_price: 100, gross_price: 100, discounts: [d(0, 0)] })]), payments: [{ coupon_amount: 7.5 }] });
  assert.equal(e.sinais.cupom_pagamentos, 750);
  assert.equal(e.sinais.cupom_pedido ?? null, null);
  assert.equal(e.credito_max_pedido, 0);
  assert.equal(afirmar({ evidencia: e, linha: linha(-3) }).afirmacao, "NAO_VERIFICADO");
});

test("C5 boosted_offer (campo documentado em /seller-promotions, compensado nos custos por venda): se aparecer, a tarifa é incerta", () => {
  const com = ev(pedido([item({ unit_price: 100, gross_price: 100, discounts: [d(0, 0, { boosted_offer: true })] })]));
  assert.ok(com.motivos.includes("boosted_offer_nao_modelado"));
  assert.ok(com.itens[0].indicios.includes("boosted_offer"));
  assert.equal(afirmar({ evidencia: com, linha: linha(-3) }).afirmacao, "NAO_VERIFICADO");
  const sem = ev(pedido([item({ unit_price: 100, gross_price: 100, discounts: [d(0, 0, { boosted_offer: false })] })]));
  assert.equal(sem.motivos.includes("boosted_offer_nao_modelado"), false);
  assert.equal(afirmar({ evidencia: sem, linha: linha(-3) }).afirmacao, "CATEGORICO");
});

// ───────────────────────── R* — formato REAL do GET /orders/{id}/discounts (BR, 17/11/2026) ─────────────────────────
// Fixtures SANITIZADAS de respostas reais das contas piloto (ids trocados; valores mantidos). Achados reais:
//   · /orders/search e /orders/{id} NÃO trazem discounts[] com amounts (0 de 284 itens; by-id traz `discounts: null`);
//   · /orders/{id}/discounts traz details[] {type: discount|coupon, items[{id,variation_id,quantity,amounts{total,seller}}], supplier{funding_mode}};
//   · amounts são TOTAIS da quantidade coberta (items[].quantity), não por unidade; gross − unit×q = soma dos details type "discount";
//   · cupom (type "coupon") é entrada à parte e NÃO entra na identidade do gross.
const DET = (details) => ({ details });
const dsc = (id, total, seller, o = {}) => ({ type: "discount", items: [{ element_id: 1, quantity: o.q ?? 1, id, ...(o.var ? { variation_id: o.var } : {}), amounts: { ...(total != null ? { total } : {}), ...(seller != null ? { seller } : {}) } }],
  supplier: { offer_id: "OFFER-X", ...(o.fm === null ? {} : { funding_mode: o.fm ?? "seller" }) } });
const cup = (id, total, seller, o = {}) => ({ type: "coupon", coupon: { id: 1 }, items: [{ element_id: 1, quantity: 1, id, amounts: { total, seller } }], supplier: { meli_campaign: o.meli ?? null, campaign_id: 1 } });
const evD = (o, det, ctx = {}) => extrairEvidencia(o, { ...CTX, descontosDetalhe: det, ...ctx });
const itBR = (o = {}) => item({ item: { id: "MLB5000000001", variation_id: 111 }, ...o });

test("R1 conta 3 (real): desconto 100% do vendedor (funding_mode seller) ⇒ DESCONTO_VENDEDOR observado, crédito 0, categórico se m<0", () => {
  const o = pedido([itBR({ unit_price: 86.16, gross_price: 120.63, sale_fee: 12.06 })]);
  const e = evD(o, DET([dsc("MLB5000000001", 34.47, 34.47, { var: 111 })]));
  assert.equal(i0(e).estado, "DESCONTO_VENDEDOR");
  assert.equal(i0(e).confianca, "OBSERVADA");
  assert.equal(i0(e).desconto_unit, 3447);
  assert.equal(i0(e).credito_max, 0);
  assert.equal(i0(e).verificacoes.gross, "ok");
  assert.equal(e.fonte, "orders_api+discounts_api");
  assert.equal(afirmar({ evidencia: e, linha: linha(-1) }).afirmacao, "CATEGORICO");
});

test("R2 conta 41 (real): ML participa (R$ 1,59) com funding_mode sale_fee ⇒ ML_PARTICIPA, parcela e limite = 159, indício registrado, tarifa continua 'desconhecido'", () => {
  const o = pedido([itBR({ unit_price: 54, gross_price: 79.9, sale_fee: 5.97 })]);
  const e = evD(o, DET([dsc("MLB5000000001", 25.9, 24.31, { var: 111, fm: "sale_fee" })]));
  assert.equal(i0(e).estado, "ML_PARTICIPA");
  assert.equal(i0(e).parcela_ml_unit, 159);
  assert.equal(i0(e).credito_max, 159);
  assert.ok(i0(e).indicios.includes("funding_mode:sale_fee"));
  assert.equal(e.tarifa_liquida_de_rebate, "desconhecido");
  assert.equal(afirmar({ evidencia: e, linha: linha(-1) }).afirmacao, "OBSERVACAO"); // −1,00 + 1,59 ≥ 0
  assert.equal(afirmar({ evidencia: e, linha: linha(-2) }).afirmacao, "ROBUSTO"); // −2,00 + 1,59 < 0
});

test("R3 conta 41 (real): cupom do VENDEDOR é entrada à parte: não entra no gross, é sinal detalhado e rebaixa a afirmação", () => {
  const o = pedido([itBR({ unit_price: 56.9, gross_price: 79.9, sale_fee: 6.31 })]);
  const e = evD(o, DET([cup("MLB5000000001", 2, 2), dsc("MLB5000000001", 23, 23, { var: 111 })]));
  assert.equal(i0(e).estado, "DESCONTO_VENDEDOR"); // 79,90 − 56,90 = 23,00 = só o desconto; o cupom NÃO conta
  assert.equal(i0(e).verificacoes.gross, "ok");
  assert.deepEqual(e.sinais.cupom_detalhe, { total: 200, seller: 200 });
  assert.ok(e.motivos.includes("cupom_presente_nao_modelado"));
  assert.equal(afirmar({ evidencia: e, linha: linha(-1) }).afirmacao, "NAO_VERIFICADO");
});

test("R3 cupom financiado pelo ML (seller 0) fica registrado, também sem virar crédito", () => {
  const o = pedido([itBR({ unit_price: 80, gross_price: 100 })]);
  const e = evD(o, DET([dsc("MLB5000000001", 20, 20, { var: 111 }), cup("MLB5000000001", 5, 0, { meli: "MLB-CAMP" })]));
  assert.deepEqual(e.sinais.cupom_detalhe, { total: 500, seller: 0 });
  assert.equal(e.credito_max_pedido, 0);
});

test("R4 amounts são do TOTAL da quantidade coberta: q=3, total 30,00 ⇒ 10,00 por unidade; gross reconcilia", () => {
  const o = pedido([itBR({ quantity: 3, unit_price: 100, gross_price: 330 })]);
  const e = evD(o, DET([dsc("MLB5000000001", 30, 12, { q: 3, var: 111, fm: "sale_fee" })]));
  assert.equal(i0(e).desconto_unit, 1000);
  assert.equal(i0(e).desconto_vendedor_unit, 400);
  assert.equal(i0(e).parcela_ml_unit, 600);
  assert.equal(i0(e).credito_max, 1800);
  assert.equal(i0(e).verificacoes.gross, "ok");
});

test("R4 total não divisível pela quantidade coberta ⇒ INCONSISTENTE (sem arredondar em silêncio)", () => {
  const o = pedido([itBR({ quantity: 3, unit_price: 100, gross_price: 330 })]);
  const e = evD(o, DET([dsc("MLB5000000001", 30.01, 12, { q: 3, var: 111 })]));
  assert.equal(i0(e).estado, "INCONSISTENTE");
  assert.ok(i0(e).motivos.includes("desconto_nao_divisivel"));
  assert.equal(i0(e).credito_max, null);
});

test("R5 total do detalhe ≠ gross − unit×q ⇒ INCONSISTENTE (contradição entre as duas fontes)", () => {
  const o = pedido([itBR({ unit_price: 54, gross_price: 79.9 })]);
  const e = evD(o, DET([dsc("MLB5000000001", 20, 20, { var: 111 })]));
  assert.equal(i0(e).estado, "INCONSISTENTE");
  assert.equal(i0(e).verificacoes.dif_gross_centavos, 590);
});

test("R6 detalhe de OUTRO item/variação nunca é aplicado: item sem detalhe próprio segue sem repartição e o pedido é INCONSISTENTE", () => {
  const o = pedido([itBR({ unit_price: 80, gross_price: 100 })]);
  const outro = evD(o, DET([dsc("MLB9999999999", 20, 0, { var: 111 })]));
  assert.equal(outro.estado, "INCONSISTENTE");
  assert.ok(outro.motivos.includes("detalhe_sem_item_correspondente"));
  assert.equal(outro.credito_max_pedido, null);
  const outraVariacao = evD(o, DET([dsc("MLB5000000001", 20, 0, { var: 222 })]));
  assert.ok(outraVariacao.motivos.includes("detalhe_sem_item_correspondente"));
});

test("R6 multi-item: cada item recebe só o próprio detalhe", () => {
  const o = pedido([
    itBR({ unit_price: 80, gross_price: 100 }),
    item({ item: { id: "MLB5000000002", variation_id: null }, unit_price: 40, gross_price: 40 }),
  ]);
  const e = evD(o, DET([dsc("MLB5000000001", 20, 10, { var: 111 })]));
  assert.equal(e.itens[0].credito_max, 1000);
  assert.equal(e.itens[1].estado, "SEM_DESCONTO"); // sem detalhe: só inferido pelo gross, nunca herda o desconto do item 0
  assert.equal(e.itens[1].confianca, "INFERIDA");
  assert.equal(e.itens[1].desconto_unit, 0);
});

test("R7 duas promoções no mesmo item (real: 2 details type discount) somam e reconciliam com o gross", () => {
  const o = pedido([itBR({ unit_price: 70, gross_price: 100 })]);
  const e = evD(o, DET([dsc("MLB5000000001", 20, 20, { var: 111 }), dsc("MLB5000000001", 10, 4, { var: 111, fm: "sale_fee" })]));
  assert.equal(i0(e).desconto_unit, 3000);
  assert.equal(i0(e).parcela_ml_unit, 600);
  assert.equal(i0(e).credito_max, 600);
});

test("R8 seller ausente no amounts ⇒ repartição desconhecida (crédito null); resposta nula/sem details ⇒ nada muda", () => {
  const o = pedido([itBR({ unit_price: 80, gross_price: 100 })]);
  const sem = evD(o, DET([dsc("MLB5000000001", 20, null, { var: 111 })]));
  assert.equal(i0(sem).estado, "REPARTICAO_DESCONHECIDA");
  assert.equal(i0(sem).credito_max, null);
  const base = ev(o);
  for (const d of [null, undefined, {}, DET([]), { details: "x" }]) assert.deepEqual(evD(o, d), base, JSON.stringify(d));
});

test("R9 o detalhe só vale quando o pedido NÃO traz discounts[]: se vierem os dois, o do pedido prevalece e o conflito fica registrado", () => {
  const o = pedido([itBR({ unit_price: 80, gross_price: 100, discounts: [d(20, 20)] })]);
  const e = evD(o, DET([dsc("MLB5000000001", 20, 0, { var: 111 })]));
  assert.equal(i0(e).estado, "DESCONTO_VENDEDOR");
  assert.ok(e.motivos.includes("discounts_duplicado_ignorado"));
});

test("R10 forma persistida segue compacta e determinística com o detalhe (< 1,2 KB, mesmo hash em reprocessamento)", () => {
  const o = pedido([itBR({ unit_price: 54, gross_price: 79.9, sale_fee: 5.97 })]);
  const det = DET([dsc("MLB5000000001", 25.9, 24.31, { var: 111, fm: "sale_fee" })]);
  const a = evD(o, det);
  const b = evD(o, det, { observadoEm: "2026-12-01T00:00:00.000Z" });
  assert.equal(JSON.stringify(evidenciaParaHash(a)), JSON.stringify(evidenciaParaHash(b)));
  assert.ok(Buffer.byteLength(JSON.stringify(evidenciaParaPersistir(a))) < 1200);
});
