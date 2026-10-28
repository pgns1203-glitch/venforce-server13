// Fixtures do rateio de frete de packs (Central + Sentinel). Dados sintéticos.
const iso = (d) => `2026-10-${String(d).padStart(2, "0")}T12:00:00.000-03:00`;

function pedido(id, { shipment, pack = null, itens, status = "paid", dia = 10, logistic = "cross_docking" }) {
  return {
    id,
    status,
    pack_id: pack,
    seller: { id: 5551 },
    date_created: iso(dia),
    date_last_updated: iso(dia),
    shipping: shipment == null ? {} : { id: shipment, logistic_type: logistic },
    order_items: itens.map(([mlb, qtd, preco, taxa, variacao]) => ({
      item: { id: mlb, title: `Produto ${mlb}`, seller_sku: null, variation_id: variacao ?? null },
      quantity: qtd, unit_price: preco, sale_fee: taxa,
    })),
  };
}

const costRows = [
  { produto_id: "MLB100", custo_produto: 20, imposto_percentual: 10 },
  { produto_id: "MLB200", custo_produto: 35, imposto_percentual: 10 },
  { produto_id: "MLB300", custo_produto: 8, imposto_percentual: 10 },
];

// 3 pedidos INDEPENDENTES (1 shipment cada) + 1 sem shipping: o comportamento que não pode mudar.
const ordersIndependentes = () => [
  pedido(1001, { shipment: 5001, itens: [["MLB100", 2, 100, 12.5], ["MLB200", 1, 80, 10]] }),
  pedido(1002, { shipment: 5002, pack: 9001, itens: [["MLB300", 3, 25.9, 4]] }),
  pedido(1003, { shipment: 5003, itens: [["MLB100", 1, 100, 12.5]] }),
  pedido(1004, { itens: [["MLB200", 1, 80, 10]] }),
];
const freteIndependentes = () => new Map([
  ["5001", { status: "real", valor: 18.4, receitaComprador: 0 }],
  ["5002", { status: "real", valor: 12.35, receitaComprador: 7.9 }],
  ["5003", { status: "ausente", valor: null, receitaComprador: null }],
]);

module.exports = { pedido, costRows, ordersIndependentes, freteIndependentes, iso };
