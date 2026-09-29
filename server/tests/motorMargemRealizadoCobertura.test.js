// server/tests/motorMargemRealizadoCobertura.test.js
// Corretude do REALIZADO por anúncio (centralVendasEvidenceAdapter): média
// ponderada, valor por unidade sobre as unidades COBERTAS, cobertura
// explícita, rateio de frete, imposto histórico, taxa fixa ausente,
// reembolso e venda sem MLB. Puro — sem banco, sem ML.
//
// Ver docs/AUDITORIA_REALIZADO_MARGIN_SYNC.md §4.6 (R-04).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/dead";

const assert = require("assert");
const C = require("../services/motorMargem/core");
const cv = require("../services/motorMargem/adapters/centralVendasEvidenceAdapter");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

// ── Construtores de linhas no formato das tabelas da Central de Vendas ─────
let seq = 0;
function pedido(id, { status = "paid", data = "2026-09-10" } = {}) {
  return { id, pedido_id: `P${id}`, status, data_pedido: data };
}
function item(pedidoRowId, mlb, { qtd = 1, unit = 100, receita, custo = null, imposto = null, resultado = null } = {}) {
  seq += 1;
  return {
    id: 1000 + seq, pedido_row_id: pedidoRowId, mlb, sku: mlb ? `SKU-${mlb}` : null, titulo: mlb || "(sem mlb)",
    quantidade: qtd, valor_unitario: unit, receita_produto: receita === undefined ? unit * qtd : receita,
    custo_produto: custo, imposto_interno: imposto, resultado,
  };
}
function comp(it, tipo, valor) {
  return { item_row_id: it.id, pedido_row_id: it.pedido_row_id, tipo, valor };
}
function reembolso(pedidoRowId, valor) {
  return { item_row_id: null, pedido_row_id: pedidoRowId, tipo: "cancelamento_reembolso", valor: -Math.abs(valor) };
}

function agregar({ pedidos, itens, componentes }) {
  const resultado = pedidos.filter((p) => !/cancel|devolu|reembolso|problema|media/.test(p.status));
  return cv.agregarPorMlb({ pedidosTodos: pedidos, pedidosResultado: resultado, itens, componentes });
}

function realizar(agregado) {
  const bag = C.createEvidenceBag();
  const resumo = cv.aplicarEvidenciasRealizadas(bag, { agregado });
  return { bag, resumo, ev: (campo) => bag.list(campo)[0] || null };
}

// ═══════════════════════════════════════════════════════════════════════════

cenario("preço realizado é receita ÷ unidades (ponderado), nunca média simples das linhas", () => {
  const p1 = pedido(1);
  const p2 = pedido(2);
  const a = item(1, "MLB1", { qtd: 2, unit: 100 });
  const b = item(2, "MLB1", { qtd: 1, unit: 130 });
  const { porMlb } = agregar({ pedidos: [p1, p2], itens: [a, b], componentes: [] });
  const { resumo, ev } = realizar(porMlb.get("MLB1"));
  assert.strictEqual(resumo.unidades, 3);
  assert.strictEqual(resumo.receita, 330);
  assert.strictEqual(resumo.precoUnitarioMedio, 110, "330 / 3 = 110 (média simples daria 115)");
  assert.strictEqual(ev(C.FIELDS.PRICE).value, 110);
  assert.strictEqual(ev(C.FIELDS.PRICE).quality, C.EVIDENCE_QUALITY.DERIVED, "2 linhas completas = derivado");
  assert.strictEqual(resumo.pedidos, 2);
  assert.strictEqual(resumo.cobertura.preco.completa, true);
});

cenario("linha sem receita não dilui o preço: média só das unidades com receita, ESTIMATED", () => {
  const a = item(1, "MLB1", { qtd: 2, unit: 100 });
  const b = item(1, "MLB1", { qtd: 1, unit: null, receita: null });
  const { porMlb } = agregar({ pedidos: [pedido(1)], itens: [a, b], componentes: [] });
  const { resumo, ev } = realizar(porMlb.get("MLB1"));
  assert.strictEqual(resumo.unidades, 3, "a unidade sem receita continua vendida");
  assert.strictEqual(resumo.receita, 200, "receita é só a observada");
  assert.strictEqual(ev(C.FIELDS.PRICE).value, 100, "200 / 2 unidades com receita (não 200/3 = 66,67)");
  assert.strictEqual(ev(C.FIELDS.PRICE).quality, C.EVIDENCE_QUALITY.ESTIMATED);
  assert.strictEqual(resumo.cobertura.preco.fracao, 0.6667);
});

cenario("comissão completa: soma ÷ unidades, DERIVED, cobertura 100%", () => {
  const a = item(1, "MLB1", { qtd: 2, unit: 100 });
  const b = item(2, "MLB1", { qtd: 1, unit: 100 });
  const { porMlb } = agregar({
    pedidos: [pedido(1), pedido(2)], itens: [a, b],
    componentes: [comp(a, "tarifa_venda", -32), comp(b, "tarifa_venda", -16)],
  });
  const { resumo, ev } = realizar(porMlb.get("MLB1"));
  assert.strictEqual(ev(C.FIELDS.COMMISSION).value, 16, "48 / 3");
  assert.strictEqual(ev(C.FIELDS.COMMISSION).quality, C.EVIDENCE_QUALITY.DERIVED);
  assert.strictEqual(resumo.comissaoPorUnidade, 16);
  assert.deepStrictEqual(
    { l: resumo.cobertura.comissao.linhasComValor, u: resumo.cobertura.comissao.unidadesComValor, f: resumo.cobertura.comissao.fracao, c: resumo.cobertura.comissao.completa },
    { l: 2, u: 3, f: 1, c: true }
  );
});

cenario("comissão parcial (17 de 20 linhas): média das unidades cobertas, ESTIMATED, cobertura NUNCA 100%", () => {
  const pedidos = [];
  const itens = [];
  const componentes = [];
  for (let i = 1; i <= 20; i += 1) {
    pedidos.push(pedido(i));
    const it = item(i, "MLB1", { qtd: 1, unit: 100 });
    itens.push(it);
    // 17 linhas com tarifa R$ 16; 3 sem tarifa importada.
    componentes.push(comp(it, "tarifa_venda", i <= 17 ? -16 : null));
  }
  const { porMlb } = agregar({ pedidos, itens, componentes });
  const { resumo, ev } = realizar(porMlb.get("MLB1"));
  assert.strictEqual(resumo.cobertura.comissao.linhasComValor, 17);
  assert.strictEqual(resumo.cobertura.comissao.linhas, 20);
  assert.strictEqual(resumo.cobertura.comissao.fracao, 0.85);
  assert.strictEqual(resumo.cobertura.comissao.completa, false);
  assert.strictEqual(resumo.comissaoCobertura, 0.85, "compat: fração de linhas");
  // 17 × 16 / 17 unidades = 16. O cálculo antigo (÷ 20) dava 13,60 — as 3
  // unidades sem tarifa virariam comissão ZERO (lucro artificial).
  assert.strictEqual(ev(C.FIELDS.COMMISSION).value, 16);
  assert.strictEqual(ev(C.FIELDS.COMMISSION).quality, C.EVIDENCE_QUALITY.ESTIMATED);
  assert.ok(/17\/20 linha/.test(ev(C.FIELDS.COMMISSION).note), ev(C.FIELDS.COMMISSION).note);
});

cenario("ausência de componente nunca vira lucro: margem com cobertura parcial = margem das vendas cobertas", () => {
  // 3 vendas idênticas; só 2 têm frete importado. A margem realizada tem de
  // ser a MESMA de quando as 3 têm frete — nunca maior.
  function montar(fretes) {
    const pedidos = [pedido(1), pedido(2), pedido(3)];
    const itens = pedidos.map((p) => item(p.id, "MLB1", { qtd: 1, unit: 100, custo: 50, imposto: 10 }));
    const componentes = itens.flatMap((it, i) => [comp(it, "tarifa_venda", -12), comp(it, "frete_seller", fretes[i])]);
    const { porMlb } = agregar({ pedidos, itens, componentes });
    const { bag } = realizar(porMlb.get("MLB1"));
    const fields = C.resolveAllFields(bag);
    const campos = [C.FIELDS.PRICE, C.FIELDS.COST, C.FIELDS.TAX_RATE, C.FIELDS.FIXED_FEE, C.FIELDS.COMMISSION, C.FIELDS.FREIGHT];
    return C.computeMargin(Object.fromEntries(campos.map((k) => [k, C.valueForKind(fields[k], C.EVIDENCE_KINDS.REALIZED)])));
  }
  const completo = montar([-20, -20, -20]);
  const parcial = montar([-20, -20, null]);
  assert.strictEqual(completo.margin, 0.08, "100 - 10 - 12 - 20 - 50 = 8");
  assert.strictEqual(parcial.margin, completo.margin, "frete ausente não pode inflar a margem");
});

cenario("frete de pedido multi-item é rateio da Central de Vendas → ESTIMATED com linhas rateadas contadas", () => {
  const a = item(1, "MLB1", { qtd: 1, unit: 100 });
  const b = item(1, "MLB2", { qtd: 1, unit: 50 });
  const c = item(2, "MLB1", { qtd: 1, unit: 100 });
  const { porMlb } = agregar({
    pedidos: [pedido(1), pedido(2)], itens: [a, b, c],
    componentes: [comp(a, "frete_seller", -15), comp(b, "frete_seller", -15), comp(c, "frete_seller", -22)],
  });
  const { resumo, ev } = realizar(porMlb.get("MLB1"));
  assert.strictEqual(ev(C.FIELDS.FREIGHT).value, 18.5, "(15 + 22) / 2");
  assert.strictEqual(resumo.cobertura.frete.completa, true);
  assert.strictEqual(resumo.cobertura.frete.linhasRateadas, 1);
  assert.strictEqual(ev(C.FIELDS.FREIGHT).quality, C.EVIDENCE_QUALITY.ESTIMATED, "rateio = aproximação (vocabulário do núcleo)");
  assert.ok(/rateado/.test(ev(C.FIELDS.FREIGHT).note));

  // Pedido de item único com frete completo continua DERIVED.
  const { porMlb: unico } = agregar({ pedidos: [pedido(9)], itens: [item(9, "MLB9", {})], componentes: [] });
  const d = item(10, "MLB8", { qtd: 2 });
  const { porMlb: single } = agregar({ pedidos: [pedido(10)], itens: [d], componentes: [comp(d, "frete_seller", -30)] });
  assert.strictEqual(realizar(single.get("MLB8")).ev(C.FIELDS.FREIGHT).quality, C.EVIDENCE_QUALITY.DERIVED);
  assert.strictEqual(realizar(single.get("MLB8")).ev(C.FIELDS.FREIGHT).value, 15);
  assert.strictEqual(realizar(unico.get("MLB9")).ev(C.FIELDS.FREIGHT), null, "sem frete importado, sem evidência");
});

cenario("custo histórico: total da linha ÷ unidades cobertas; parcial vira ESTIMATED, nunca a Base atual", () => {
  const a = item(1, "MLB1", { qtd: 2, unit: 100, custo: 80 }); // 40/un
  const b = item(2, "MLB1", { qtd: 1, unit: 100, custo: null }); // sem custo na Base à época
  const { porMlb } = agregar({ pedidos: [pedido(1), pedido(2)], itens: [a, b], componentes: [] });
  const { resumo, ev } = realizar(porMlb.get("MLB1"));
  const custo = ev(C.FIELDS.COST);
  assert.strictEqual(custo.value, 40, "80 / 2 (não 80/3 = 26,67)");
  assert.strictEqual(custo.kind, C.EVIDENCE_KINDS.REALIZED);
  assert.strictEqual(custo.source, C.SOURCES.VENFORCE_BASE);
  assert.strictEqual(custo.quality, C.EVIDENCE_QUALITY.ESTIMATED);
  assert.strictEqual(resumo.custoPorUnidade, 40);
  assert.strictEqual(resumo.cobertura.custo.fracao, 0.6667);
});

cenario("imposto histórico: alíquota = imposto ÷ receita DAS LINHAS com imposto", () => {
  const a = item(1, "MLB1", { qtd: 1, unit: 100, imposto: 10 });
  const b = item(2, "MLB1", { qtd: 1, unit: 300, imposto: null });
  const { porMlb } = agregar({ pedidos: [pedido(1), pedido(2)], itens: [a, b], componentes: [] });
  const { resumo, ev } = realizar(porMlb.get("MLB1"));
  assert.strictEqual(ev(C.FIELDS.TAX_RATE).value, 0.1, "10 / 100 (não 10 / 400 = 2,5%)");
  assert.strictEqual(ev(C.FIELDS.TAX_RATE).quality, C.EVIDENCE_QUALITY.ESTIMATED);
  assert.strictEqual(resumo.aliquotaImposto, 0.1);

  const c = item(3, "MLB2", { qtd: 2, unit: 50, imposto: 12 });
  const { porMlb: completo } = agregar({ pedidos: [pedido(3)], itens: [c], componentes: [] });
  const r = realizar(completo.get("MLB2"));
  assert.strictEqual(r.ev(C.FIELDS.TAX_RATE).value, 0.12);
  assert.strictEqual(r.ev(C.FIELDS.TAX_RATE).quality, C.EVIDENCE_QUALITY.DECLARED);
});

cenario("taxa fixa não tem histórico: nenhuma evidência realizada, cobertura declara SEM_HISTORICO", () => {
  const a = item(1, "MLB1", { qtd: 1, unit: 100, custo: 40, imposto: 10 });
  const { porMlb } = agregar({ pedidos: [pedido(1)], itens: [a], componentes: [] });
  const { bag, resumo } = realizar(porMlb.get("MLB1"));
  assert.deepStrictEqual(bag.list(C.FIELDS.FIXED_FEE), []);
  assert.deepStrictEqual(resumo.cobertura.taxaFixa, { disponivel: false, motivo: "SEM_HISTORICO" });
});

cenario("sem venda no período: nenhum agregado, nenhuma evidência (nunca zero)", () => {
  const { porMlb } = agregar({ pedidos: [], itens: [], componentes: [] });
  assert.strictEqual(porMlb.size, 0);
  const bag = C.createEvidenceBag();
  assert.strictEqual(cv.aplicarEvidenciasRealizadas(bag, { agregado: porMlb.get("MLB1") || null }), null);
  assert.deepStrictEqual(bag.fields(), []);
});

cenario("pedido cancelado sai de unidades/receita, mas o reembolso de item único continua atribuído", () => {
  const ok = item(1, "MLB1", { qtd: 1, unit: 100 });
  const cancelado = item(2, "MLB1", { qtd: 5, unit: 100 });
  const { porMlb, reembolsoPorMlb, reembolsos } = agregar({
    pedidos: [pedido(1), pedido(2, { status: "cancelled" })],
    itens: [ok, cancelado],
    componentes: [reembolso(2, 500)],
  });
  assert.strictEqual(porMlb.get("MLB1").unidades, 1, "as 5 unidades canceladas não contam");
  assert.strictEqual(reembolsoPorMlb.get("MLB1").soma, 500);
  assert.strictEqual(reembolsos.atribuidoMlb, 500);
});

cenario("reembolso de pedido multi-item nunca é rateado entre os MLBs", () => {
  const a = item(1, "MLB1", {});
  const b = item(1, "MLB2", {});
  const { reembolsoPorMlb, reembolsos, naoAtribuido } = agregar({
    pedidos: [pedido(1)], itens: [a, b], componentes: [reembolso(1, 80)],
  });
  assert.strictEqual(reembolsoPorMlb.size, 0);
  assert.strictEqual(reembolsos.atribuidoPedido, 80);
  assert.strictEqual(naoAtribuido.reembolso, 80);
});

cenario("venda sem MLB não some: vira total próprio (semMlb) e reembolso dela é não atribuível", () => {
  const semMlb = item(1, null, { qtd: 2, unit: 40 });
  const { porMlb, semMlb: total, reembolsos } = agregar({
    pedidos: [pedido(1)], itens: [semMlb], componentes: [reembolso(1, 10)],
  });
  assert.strictEqual(porMlb.size, 0);
  assert.deepStrictEqual(total, { linhas: 1, unidades: 2, receita: 80 });
  assert.strictEqual(reembolsos.naoAtribuivel, 10);
});

cenario("componente duplicado para a mesma linha soma o valor, mas nunca conta cobertura duas vezes", () => {
  const a = item(1, "MLB1", { qtd: 1, unit: 100 });
  const b = item(2, "MLB1", { qtd: 1, unit: 100 });
  const { porMlb } = agregar({
    pedidos: [pedido(1), pedido(2)], itens: [a, b],
    componentes: [comp(a, "tarifa_venda", -10), comp(a, "tarifa_venda", -2)],
  });
  const { resumo } = realizar(porMlb.get("MLB1"));
  assert.strictEqual(resumo.cobertura.comissao.linhasComValor, 1, "1 de 2 linhas, não 2 de 2");
  assert.strictEqual(resumo.cobertura.comissao.completa, false);
  assert.strictEqual(resumo.comissaoTotal, 12);
});

cenario("resultado persistido da Central de Vendas é exposto como contraprova (null quando ausente)", () => {
  const a = item(1, "MLB1", { resultado: 12.5 });
  const b = item(2, "MLB2", {});
  const { porMlb } = agregar({ pedidos: [pedido(1), pedido(2)], itens: [a, b], componentes: [] });
  assert.strictEqual(realizar(porMlb.get("MLB1")).resumo.resultadoPersistido, 12.5);
  assert.strictEqual(realizar(porMlb.get("MLB2")).resumo.resultadoPersistido, null);
});

(async () => {
  let falhas = 0;
  for (const { nome, fn } of casos) {
    try {
      await fn();
      console.log(`  ✓ ${nome}`);
    } catch (err) {
      falhas += 1;
      console.log(`  ✗ ${nome}\n    ${err.message}`);
    }
  }
  if (falhas) {
    console.log(`motorMargemRealizadoCobertura: ${falhas} de ${casos.length} cenários falharam`);
    process.exit(1);
  }
  console.log(`motorMargemRealizadoCobertura: ok (${casos.length} cenários)`);
})();
