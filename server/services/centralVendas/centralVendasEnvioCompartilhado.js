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
// Decisão (Maestro, B3): pedido que NÃO entra no resultado (cancelado/devolvido/não pago — a
// mesma regra de pedidoEntraNoResultado na Central e a elegibilidade no Sentinel) tem PESO ZERO:
// o custo do shipment vai inteiro para os pedidos que entram no resultado (os KPIs conservam o
// custo). Se TODOS estiverem fora do resultado, rateio pela receita (informativo).
// Usado pela Central (buildMotorFromOrders) e pelo Sentinel (sentinelPedidoService).

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

// valor: number|null (valor do shipment).
// pedidos: [{ pedidoId, receitaCentavos, entraNoResultado? }] (entraNoResultado ausente = true).
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
  // Quem entra no resultado participa; fora do resultado = peso 0 (recebe 0). Todos fora ⇒ todos participam.
  let participantes = lista.filter((p) => p.entraNoResultado !== false);
  if (!participantes.length) participantes = lista;
  const ids = new Set(participantes.map((p) => String(p.pedidoId)));
  for (const p of lista) if (!ids.has(String(p.pedidoId))) out.set(String(p.pedidoId), 0);
  const pesos = participantes.map((p) => BigInt(Math.max(0, Math.round(Number(p.receitaCentavos) || 0))));
  const somaPesos = pesos.reduce((s, w) => s + w, 0n);
  const n = BigInt(participantes.length);
  let acumulado = 0n;
  participantes.forEach((p, i) => {
    let parte;
    if (i === participantes.length - 1) parte = totalCentavos - acumulado; // o último leva o resto
    else if (somaPesos > 0n) parte = (totalCentavos * pesos[i]) / somaPesos; // piso
    else parte = totalCentavos / n; // receita 0 ⇒ igualitário
    acumulado += parte;
    out.set(String(p.pedidoId), Number(parte) / 100);
  });
  return out;
}

// Agrupa os pedidos por shipping.id e devolve só os shipments com 2+ pedidos:
//   Map<shipmentId, { n, pedidos: [{ pedidoId, receitaCentavos }] }>
// opts.entra(order) ⇒ boolean: o pedido entra no resultado? (padrão: todos entram)
function agruparEnvioCompartilhado(orders, opts = {}) {
  const porShipment = new Map();
  for (const order of orders || []) {
    const shipmentId = order?.shipping?.id != null ? String(order.shipping.id) : null;
    if (!shipmentId || order?.id == null) continue;
    if (!porShipment.has(shipmentId)) porShipment.set(shipmentId, new Map());
    porShipment.get(shipmentId).set(String(order.id), {
      pedidoId: String(order.id),
      receitaCentavos: receitaDoPedidoCentavos(order),
      entraNoResultado: typeof opts.entra === "function" ? !!opts.entra(order) : true,
    });
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
function prepararEnvioCompartilhado(orders, freteMap, opts = {}) {
  const out = new Map();
  for (const [shipmentId, grupo] of agruparEnvioCompartilhado(orders, opts)) {
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

// Rateio em centavos inteiros pelo MAIOR RESTO: nunca gera parcela negativa, Σ exata.
// total: number|null; pesos: números ≥ 0 (ex.: unidades). Empate de resto: o de maior índice
// recebe primeiro (o último item leva a sobra, como antes). Soma de pesos 0 ⇒ o 1º leva tudo.
function repartirCentavos(total, pesos) {
  if (total === null || total === undefined || !Number.isFinite(Number(total))) return pesos.map(() => null);
  const n = pesos.length;
  if (!n) return [];
  const sinal = Number(total) < 0 ? -1n : 1n;
  const cents = BigInt(Math.round(Math.abs(Number(total)) * 100));
  const w = pesos.map((x) => BigInt(Math.max(0, Math.round((Number(x) || 0) * 1000))));
  const soma = w.reduce((a, b) => a + b, 0n);
  if (soma === 0n) return pesos.map((_, i) => (i === 0 ? Number(sinal * cents) / 100 : 0));
  const base = w.map((x) => (cents * x) / soma);
  const resto = w.map((x, i) => (cents * x) - base[i] * soma); // fração × soma
  let falta = Number(cents - base.reduce((a, b) => a + b, 0n));
  const ordem = base.map((_, i) => i).sort((a, b) => (resto[b] > resto[a] ? 1 : resto[b] < resto[a] ? -1 : b - a));
  for (let k = 0; k < falta; k++) base[ordem[k % n]] += 1n;
  return base.map((x) => Number(sinal * x) / 100);
}

// POLÍTICA ÚNICA de peso no rateio do envio (Central e Sentinel usam esta função):
// entra = venda efetiva — `paid` e `partially_refunded` (venda com ressalva); `pago` é o status
// normalizado da Central. Qualquer outro (confirmed, payment_required, payment_in_process,
// partially_paid, invalid, cancelled, pending_cancel, cancelado/com_problema por pós-venda,
// desconhecido/ausente) ⇒ peso 0. O argumento é o status EFETIVO (pós-venda || status da Orders API).
const STATUS_ENTRA_NO_RATEIO = new Set(["paid", "partially_refunded", "pago"]);
function entraNoRateioEnvio(statusEfetivo) {
  const s = statusEfetivo ? String(statusEfetivo).trim().toLowerCase() : "";
  return STATUS_ENTRA_NO_RATEIO.has(s);
}

const OBS_ENVIO_COMPARTILHADO = (n) => `Frete do envio compartilhado por ${n} pedidos, rateado pela receita.`;

module.exports = {
  ratearEnvioCompartilhado,
  agruparEnvioCompartilhado,
  prepararEnvioCompartilhado,
  repartirCentavos,
  entraNoRateioEnvio,
  receitaDoPedidoCentavos,
  OBS_ENVIO_COMPARTILHADO,
};
