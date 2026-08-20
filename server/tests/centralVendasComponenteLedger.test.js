// M6 — Ledger financeiro auditável: classificarComponenteFinanceiro() e o
// invariante "resultado_item === soma(componentes incluídos)".
//
// Testa a FUNÇÃO PURA de classificação e prova o invariante contra os
// componentes REAIS produzidos pelos dois motores existentes:
//   - buildMotorFromOrders (API-first, M5, centralVendasSyncService.js)
//   - processMeliForCentralVendas (planilha, meliFinanceiroService.js)
// Nenhum dos dois motores é alterado ou reimplementado aqui.

const assert = require("assert");
const Module = require("module");

const {
  classificarComponenteFinanceiro,
} = require("../services/centralVendas/centralVendasComponenteLedger");
const {
  buildMotorFromOrders,
  buildCostMap,
} = require("../services/centralVendas/centralVendasSyncService");
const { round2 } = require("../utils/numberUtils");

// meliFinanceiroService carrega "xlsx" no topo — mesmo stub usado por
// meliFinanceiroCentralVendas.test.js.
const originalLoad = Module._load;
Module._load = function loadWithXlsxStub(request, parent, isMain) {
  if (request === "xlsx") return { utils: { aoa_to_sheet: () => ({}) } };
  return originalLoad.call(this, request, parent, isMain);
};
const { processMeliForCentralVendas } = require("../services/fechamentoFinanceiro/meliFinanceiroService");
Module._load = originalLoad;

function fakeItem({ mlb, sku = null, qty, price, saleFee }) {
  return { item: { id: mlb, seller_sku: sku, title: mlb }, quantity: qty, unit_price: price, sale_fee: saleFee };
}
function fakeOrder({ id, shipmentId = null, status = "paid", items, payments = [] }) {
  return {
    id, pack_id: null, date_created: "2026-07-10T10:00:00.000-03:00", status,
    shipping: shipmentId ? { id: shipmentId, logistic_type: "cross_docking" } : {},
    order_items: items, payments,
  };
}

function classificar(componente) {
  return classificarComponenteFinanceiro({ tipo: componente.tipo, itemId: componente.itemId || null });
}

function somaIncluidos(componentes) {
  return round2(
    componentes
      .map((c) => ({ ...c, ...classificar(c) }))
      .filter((c) => c.incluidoNoResultado === true)
      .reduce((sum, c) => sum + Number(c.valor || 0), 0)
  );
}

function run() {
  // ── Matriz de classificação (pura, sem motor) ─────────────────────────
  {
    const casos = [
      ["receita_produto", "item123", "credito", true],
      ["tarifa_venda", "item123", "debito", true],
      ["custo_produto", "item123", "debito", true],
      ["imposto_interno", "item123", "debito", true],
      ["frete_seller", "item123", "debito", true],
      ["receita_envio", null, "credito", false],
      ["cancelamento_reembolso", null, "debito", false],
      // Caso D — divergência real de escopo entre origens: mesmo tipo,
      // escopo derivado do itemId (fato persistido), nunca assumido por tipo.
      ["cancelamento_reembolso", "item123", "debito", false], // planilha: mesmo tipo, escopo=item
    ];
    for (const [tipo, itemId, efeitoEsperado, incluidoEsperado] of casos) {
      const r = classificarComponenteFinanceiro({ tipo, itemId });
      assert.strictEqual(r.efeito, efeitoEsperado, `efeito de ${tipo}`);
      assert.strictEqual(r.incluidoNoResultado, incluidoEsperado, `incluidoNoResultado de ${tipo}`);
      assert.strictEqual(r.escopo, itemId ? "item" : "pedido", `escopo de ${tipo}/${itemId}`);
    }
    // tipo desconhecido nunca inventa classificação.
    const desconhecido = classificarComponenteFinanceiro({ tipo: "tipo_novo_nao_mapeado", itemId: "x" });
    assert.strictEqual(desconhecido.efeito, null);
    assert.strictEqual(desconhecido.incluidoNoResultado, null);
    console.log("  ✓ matriz de classificação: efeito/incluidoNoResultado corretos para os 7 tipos conhecidos");
  }

  // ── Caso A — motor API-first (M5): resultado_item === soma dos incluídos ──
  // Também cobre o Caso I (multi-item: A não usa componentes de B).
  {
    const costMap = buildCostMap([
      { produto_id: "MLB2222222221", custo_produto: 40, imposto_percentual: 5 },
      { produto_id: "MLB2222222222", custo_produto: 15, imposto_percentual: 2 },
    ]);
    const order = fakeOrder({
      id: "P1",
      shipmentId: "S1",
      items: [
        fakeItem({ mlb: "MLB2222222221", qty: 1, price: 100, saleFee: 10 }),
        fakeItem({ mlb: "MLB2222222222", qty: 3, price: 50, saleFee: 5 }),
      ],
      payments: [{ transaction_amount_refunded: 12 }],
    });
    const freteMap = new Map([["S1", { valor: 20, status: "real", motivo: null, receitaComprador: 7 }]]);

    const motor = buildMotorFromOrders({ orders: [order], costMap, freteMap, clienteSlug: "c", competencia: "2026-07" });
    const itemA = motor.itens.find((i) => i.mlb === "MLB2222222221");
    const itemB = motor.itens.find((i) => i.mlb === "MLB2222222222");
    const pedido = motor.pedidos[0];

    const compsA = motor.componentes.filter((c) => c.itemId === itemA.itemId);
    const compsB = motor.componentes.filter((c) => c.itemId === itemB.itemId);

    // Caso A: soma dos incluídos por item === resultado do item.
    assert.strictEqual(somaIncluidos(compsA), itemA.resultado, "ledger de A === resultado de A");
    assert.strictEqual(somaIncluidos(compsB), itemB.resultado, "ledger de B === resultado de B");

    // Caso I: A nunca usa nada de B.
    const custoA = compsA.find((c) => c.tipo === "custo_produto").valor;
    const custoB = compsB.find((c) => c.tipo === "custo_produto").valor;
    assert.strictEqual(custoA, -40);
    assert.strictEqual(custoB, -45);
    assert.notStrictEqual(custoA, custoB);

    // Pedido = soma dos itens via ledger.
    assert.strictEqual(round2(somaIncluidos(compsA) + somaIncluidos(compsB)), pedido.resultado);

    // Caso B/C — componentes de PEDIDO (receita_envio, cancelamento_reembolso):
    // escopo=pedido, incluidoNoResultado=false, não alteram o resultado.
    const compReceitaEnvio = motor.componentes.find((c) => c.tipo === "receita_envio");
    const compReembolso = motor.componentes.find((c) => c.tipo === "cancelamento_reembolso");
    assert.ok(compReceitaEnvio, "receita_envio foi emitida (receitaComprador presente)");
    assert.ok(compReembolso, "cancelamento_reembolso foi emitida (reembolso presente)");
    const clsReceitaEnvio = classificar(compReceitaEnvio);
    const clsReembolso = classificar(compReembolso);
    assert.strictEqual(clsReceitaEnvio.escopo, "pedido");
    assert.strictEqual(clsReceitaEnvio.incluidoNoResultado, false);
    assert.strictEqual(clsReembolso.escopo, "pedido");
    assert.strictEqual(clsReembolso.incluidoNoResultado, false);
    // Resultado do pedido não muda com esses dois presentes — já provado
    // acima (pedido.resultado === soma dos DOIS itens, sem entrar receita_envio/reembolso).
    console.log("  ✓ caso A/I: ledger por item (API-first) bate exatamente com resultado_item e resultado_pedido");
    console.log("  ✓ caso B/C: receita_envio/cancelamento_reembolso são escopo=pedido, incluidoNoResultado=false, não alteram o resultado");
  }

  // ── Caso E — ausência: null continua null, classificação não empresta confiança ──
  {
    const costMap = buildCostMap([{ produto_id: "MLB5555555551", custo_produto: 10, imposto_percentual: 5 }]);
    const order = fakeOrder({
      id: "P6", shipmentId: "S6",
      items: [fakeItem({ mlb: "MLB5555555551", qty: 1, price: 50, saleFee: 5 })],
    });
    // S6 propositalmente ausente do freteMap.
    const motor = buildMotorFromOrders({ orders: [order], costMap, freteMap: new Map(), clienteSlug: "c", competencia: "2026-07" });
    const compFrete = motor.componentes.find((c) => c.tipo === "frete_seller");
    const cls = classificar(compFrete);

    assert.strictEqual(compFrete.valor, null, "frete ausente continua null");
    assert.strictEqual(compFrete.confianca, "ausente");
    // Classificação estrutural (escopo/efeito/incluidoNoResultado) é sobre a
    // NATUREZA do tipo, não sobre presença de valor — continua íntegra mesmo
    // com valor ausente. Isso NÃO faz a confiança virar "confiavel".
    assert.strictEqual(cls.escopo, "item");
    assert.strictEqual(cls.efeito, "debito");
    assert.strictEqual(cls.incluidoNoResultado, true);
    assert.notStrictEqual(compFrete.confianca, "confiavel");
    console.log("  ✓ caso E: componente ausente mantém valor=null/confianca=ausente; classificação não inventa confiança");
  }

  // ── Motor de planilha: mesma classificação, empiricamente verificada ────
  {
    const salesRowsRaw = [
      {
        "numero de venda": "9001", "data da venda": "2026-05-02", "# de anuncio": "MLB333",
        unidades: 1, "preco unitario de venda do anuncio": 100, "receita por produtos": 100,
        total: 85, "tarifa de venda e impostos": -10, "tarifas de envio": -5,
        "cancelamentos e reembolsos": 0, "descontos e bonus": 0, "titulo do anuncio": "Produto",
        estado: "Pago",
      },
    ];
    const costRowsRaw = [{ "# de anuncio": "MLB333", custo: 50, imposto: 5 }];
    const central = processMeliForCentralVendas({ salesRowsRaw, costRowsRaw, clienteSlug: "c", competencia: "2026-05" });
    const item = central.itens[0];
    const comps = central.componentes.filter((c) => c.itemId === item.itemId);

    // Caso A (planilha, pedido bem-formado, sem ajuste de plataforma):
    // a mesma classificação de 5 tipos reconcilia exatamente — auditoria
    // empírica do M6, ver nota em centralVendasComponenteLedger.js.
    assert.strictEqual(somaIncluidos(comps), item.resultado, "ledger da planilha === resultado do item (pedido bem-formado)");
    console.log("  ✓ planilha (pedido bem-formado): mesma classificação reconcilia exatamente com resultado_item");
  }

  // ── GAP DOCUMENTADO — planilha com ajuste de plataforma: a soma dos
  // componentes incluídos NÃO reconcilia com resultado_item. Isso não é um
  // bug do M6 nem foi corrigido por ele — é uma lacuna pré-existente do
  // motor de planilha (nenhum componente persiste o ajuste), sinalizada
  // pela pendência `ajuste_plataforma_presente`. Documentado, não corrigido
  // por adivinhação (instrução explícita do M6).
  {
    const salesRowsRaw = [
      {
        "numero de venda": "9002", "data da venda": "2026-05-02", "# de anuncio": "MLB444",
        unidades: 1, "preco unitario de venda do anuncio": 100, "receita por produtos": 100,
        // total (80) não bate com 100 - 10 - 5 + 0 = 85 → ajuste de plataforma = 5.
        total: 80, "tarifa de venda e impostos": -10, "tarifas de envio": -5,
        "cancelamentos e reembolsos": 0, "descontos e bonus": 0, "titulo do anuncio": "Produto com ajuste",
        estado: "Pago",
      },
    ];
    const costRowsRaw = [{ "# de anuncio": "MLB444", custo: 20, imposto: 5 }];
    const central = processMeliForCentralVendas({ salesRowsRaw, costRowsRaw, clienteSlug: "c", competencia: "2026-05" });
    const pedido = central.pedidos[0];
    const item = central.itens[0];
    const comps = central.componentes.filter((c) => c.itemId === item.itemId);

    assert.ok(pedido.pendencias.includes("ajuste_plataforma_presente"), "pendencia pre-existente sinaliza o gap");
    assert.notStrictEqual(somaIncluidos(comps), item.resultado, "GAP: ledger nao reconcilia quando ha ajuste de plataforma nao persistido");
    assert.strictEqual(round2(somaIncluidos(comps) - item.resultado), 5, "divergencia bate exatamente com o ajuste de plataforma (5)");
    console.log("  ✓ GAP documentado: pedido com ajuste_plataforma_presente diverge do ledger exatamente pelo valor do ajuste (nao corrigido no M6)");
  }

  console.log("centralVendasComponenteLedger.test.js passed");
}

run();
