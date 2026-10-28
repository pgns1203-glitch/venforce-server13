// server/services/centralVendas/centralVendasEnvioCompartilhado.js
//
// Envio (shipment) COMPARTILHADO por 2+ pedidos do mesmo carrinho/pack.
//
// O ML devolve UM custo por shipment (GET /shipments/:id/costs → senders[].cost e
// receiver.cost). Pedidos distintos do mesmo carrinho compartilham shipping.id; aplicar o
// valor cheio a cada pedido soma N× o custo real. Aqui o valor do shipment é rateado entre
// os pedidos PRESENTES, proporcional à RECEITA do pedido (Σ unit_price × quantity), em
// centavos inteiros; o último pedido (ordem estável por pedido_id) leva o resto ⇒ Σ exata.
// Receita total 0 ⇒ rateio igualitário em centavos. Depois, dentro do pedido, o motor da
// Central rateia por unidades entre itens (allocateFrete), como sempre.
//
// Decisão: pedido CANCELADO continua no rateio — o custo do envio é do shipment, não do
// pedido; cancelado já fica fora dos KPIs por status. Usado pela Central
// (buildMotorFromOrders) e pelo Sentinel (sentinelPedidoService).

// Receita do pedido em centavos inteiros (Σ round(unit_price × quantity × 100)).
function receitaDoPedidoCentavos(order) {
  const itens = Array.isArray(order?.order_items) ? order.order_items : [];
  let total = 0;
  for (const oi of itens) {
    const preco = Number(oi?.unit_price);
    const qtd = Number(oi?.quantity);
    if (Number.isFinite(preco) && Number.isFinite(qtd) && qtd > 0) total += Math.round(preco * qtd * 100);
  }
  return total;
}

function compararPedidoId(a, b) {
  const sa = String(a);
  const sb = String(b);
  if (sa.length !== sb.length) return sa.length - sb.length; // ids numéricos: menor primeiro
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

// valor: number|null (valor do shipment). pedidos: [{ pedidoId, receitaCentavos }].
// Devolve Map<pedidoId, number|null>.
//   · valor null/não finito ⇒ todos null (nunca 0);
//   · 1 pedido ⇒ o valor CHEIO, sem arredondar (comportamento anterior, idêntico);
//   · 2+ ⇒ rateio por receita em centavos, Σ == round(valor × 100) / 100.
function ratearEnvioCompartilhado(valor, pedidos) {
  const lista = [...(pedidos || [])].sort((a, b) => compararPedidoId(a.pedidoId, b.pedidoId));
  const out = new Map();
  if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) {
    for (const p of lista) out.set(String(p.pedidoId), null);
    return out;
  }
  if (lista.length <= 1) {
    for (const p of lista) out.set(String(p.pedidoId), Number(valor));
    return out;
  }
  const totalCentavos = BigInt(Math.round(Number(valor) * 100));
  const pesos = lista.map((p) => BigInt(Math.max(0, Math.round(Number(p.receitaCentavos) || 0))));
  const somaPesos = pesos.reduce((s, w) => s + w, 0n);
  const n = BigInt(lista.length);
  let acumulado = 0n;
  lista.forEach((p, i) => {
    let parte;
    if (i === lista.length - 1) parte = totalCentavos - acumulado; // o último leva o resto
    else if (somaPesos > 0n) parte = (totalCentavos * pesos[i]) / somaPesos; // piso
    else parte = totalCentavos / n; // receita 0 ⇒ igualitário
    acumulado += parte;
    out.set(String(p.pedidoId), Number(parte) / 100);
  });
  return out;
}

// Agrupa os pedidos por shipping.id e devolve só os shipments com 2+ pedidos:
//   Map<shipmentId, { n, pedidos: [{ pedidoId, receitaCentavos }] }>
function agruparEnvioCompartilhado(orders) {
  const porShipment = new Map();
  for (const order of orders || []) {
    const shipmentId = order?.shipping?.id != null ? String(order.shipping.id) : null;
    if (!shipmentId || order?.id == null) continue;
    if (!porShipment.has(shipmentId)) porShipment.set(shipmentId, new Map());
    porShipment.get(shipmentId).set(String(order.id), { pedidoId: String(order.id), receitaCentavos: receitaDoPedidoCentavos(order) });
  }
  const out = new Map();
  for (const [shipmentId, pedidos] of porShipment) {
    if (pedidos.size >= 2) out.set(shipmentId, { n: pedidos.size, pedidos: [...pedidos.values()] });
  }
  return out;
}

// Para cada shipment compartilhado, a parcela de frete_seller e de receita_envio de cada pedido.
// freteMap: Map<shipmentId, entry do serviço de frete { status, valor, receitaComprador }>.
// Devolve Map<shipmentId, { n, frete: Map<pedidoId, number|null>, receita: Map<pedidoId, number|null> }>.
function prepararEnvioCompartilhado(orders, freteMap) {
  const out = new Map();
  for (const [shipmentId, grupo] of agruparEnvioCompartilhado(orders)) {
    const entry = freteMap && freteMap.get ? freteMap.get(shipmentId) : null;
    const frete = entry && entry.status === "real" ? entry.valor : null;
    const receita = entry ? entry.receitaComprador ?? null : null;
    out.set(shipmentId, {
      n: grupo.n,
      frete: ratearEnvioCompartilhado(frete, grupo.pedidos),
      receita: ratearEnvioCompartilhado(receita === null ? null : Math.abs(Number(receita)), grupo.pedidos),
    });
  }
  return out;
}

const OBS_ENVIO_COMPARTILHADO = (n) => `Frete do envio compartilhado por ${n} pedidos, rateado pela receita.`;

module.exports = {
  ratearEnvioCompartilhado,
  agruparEnvioCompartilhado,
  prepararEnvioCompartilhado,
  receitaDoPedidoCentavos,
  OBS_ENVIO_COMPARTILHADO,
};
