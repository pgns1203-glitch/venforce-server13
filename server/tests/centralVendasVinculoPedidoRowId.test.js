// server/tests/centralVendasVinculoPedidoRowId.test.js
// REGRESSAO: itens e componentes devem ser vinculados ao pedido por
// pedido_row_id, nunca por pedido_id.
//
// getCentralVendasByRange le imports de VARIAS competencias no mesmo range, entao
// o mesmo pedido_id do Mercado Livre pode existir em mais de uma importacao
// (pedido de borda de mes, reimportacao). Casar por pedido_id somava os
// componentes das duas importacoes no mesmo pedido: custo, frete e tarifa
// dobrados e itens duplicados, inflando produtos, unidades e a ponte inteira
// do Cliente 360 V2.

const assert = require("assert");
const svc = require("../services/centralVendas/centralVendasService");

let checks = 0;
function eq(label, actual, expected) {
  assert.strictEqual(actual, expected, `${label}: ${actual} !== ${expected}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

/* ── mesmo pedido_id em DUAS importacoes do range ────────────────────────── */

const snapshot = {
  importacao: { id: 1, fonte: "orders_api", created_at: new Date("2026-08-01T00:00:00Z") },
  imports: [{ id: 1 }, { id: 2 }],
  pedidos: [
    { id: 10, pedido_id: "P1", data_pedido: "2026-07-31", status: "pago",
      faturamento: 100, quantidade_itens: 1, resultado: 30, confianca: "confiavel" },
  ],
  itens: [
    { pedido_row_id: 10, pedido_id: "P1", item_id: "I1", mlb: "MLB1", quantidade: 1,
      receita_produto: 100, custo_produto: 40, confianca: "confiavel" },
    // mesma venda, importacao diferente — NAO pode entrar no pedido row 10
    { pedido_row_id: 11, pedido_id: "P1", item_id: "I1", mlb: "MLB1", quantidade: 1,
      receita_produto: 100, custo_produto: 40, confianca: "confiavel" },
  ],
  componentes: [
    { pedido_row_id: 10, pedido_id: "P1", tipo: "custo_produto", valor: 40, confianca: "confiavel" },
    { pedido_row_id: 11, pedido_id: "P1", tipo: "custo_produto", valor: 40, confianca: "confiavel" },
    { pedido_row_id: 10, pedido_id: "P1", tipo: "frete_seller",  valor: 15, confianca: "confiavel" },
    { pedido_row_id: 11, pedido_id: "P1", tipo: "frete_seller",  valor: 15, confianca: "confiavel" },
    { pedido_row_id: 10, pedido_id: "P1", tipo: "tarifa_venda",  valor: 11, confianca: "confiavel" },
    { pedido_row_id: 11, pedido_id: "P1", tipo: "tarifa_venda",  valor: 11, confianca: "confiavel" },
  ],
};

console.log("\n▸ Vinculo item/componente por pedido_row_id");

const payload = svc.buildPayloadFromRange(
  { slug: "cliente-teste" },
  { dateFrom: "2026-07-01", dateTo: "2026-07-31" },
  snapshot
);
const pedido = payload.pedidos[0];

eq("faturamento nao muda", pedido.valor, 100);
eq("custo nao dobra", pedido.custo, 40);
eq("frete nao dobra", pedido.frete, 15);
eq("tarifa nao dobra", pedido.taxas, 11);
eq("item nao duplica", pedido.itens.length, 1);
eq("receita do item nao dobra", pedido.itens[0].receitaProduto, 100);

/* ── fallback: snapshot legado sem pedido_row_id ─────────────────────────── */

console.log("\n▸ Fallback por pedido_id quando nao ha pedido_row_id");

const legado = {
  importacao: { id: 1, fonte: "planilha_vendas", created_at: new Date() },
  pedidos: [
    { id: 10, pedido_id: "P9", data_pedido: "2026-07-10", status: "pago",
      faturamento: 50, quantidade_itens: 1, resultado: 12, confianca: "confiavel" },
  ],
  itens: [
    { pedido_id: "P9", item_id: "I9", mlb: "MLB9", quantidade: 1,
      receita_produto: 50, custo_produto: 20, confianca: "confiavel" },
  ],
  componentes: [
    { pedido_id: "P9", tipo: "custo_produto", valor: 20, confianca: "confiavel" },
  ],
};

const payloadLegado = svc.buildPayloadFromRange(
  { slug: "cliente-teste" },
  { dateFrom: "2026-07-01", dateTo: "2026-07-31" },
  legado
);
const pedidoLegado = payloadLegado.pedidos[0];

eq("legado ainda vincula o item", pedidoLegado.itens.length, 1);
eq("legado ainda vincula o custo", pedidoLegado.custo, 20);

console.log(`\n${checks} verificacoes passaram. Vinculo por pedido_row_id OK.\n`);
