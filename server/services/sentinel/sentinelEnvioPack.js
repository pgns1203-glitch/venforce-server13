// server/services/sentinel/sentinelEnvioPack.js
// Envio compartilhado (carrinho/pack) no Sentinel.
//
// Pedidos distintos do mesmo pack compartilham shipping.id e o ML devolve UM custo por
// shipment. Para ratear (função pura da Central: ratearEnvioCompartilhado) é preciso conhecer
// TODOS os pedidos do shipment:
//   · pedido sem pack_id: irmãos = pedidos conhecidos (janela/reprocessamento) com o mesmo shipment;
//   · pedido com pack_id: GET /packs/:id (documentacao_api_meli/gestao-packs.md — devolve
//     shipment.id e orders[].id; só vê pedidos DESTE vendedor) + GET /orders/:id dos irmãos que
//     não estão no conjunto. Chamadas sempre pelo mlFetch noRefresh do Sentinel, dentro do
//     orçamento de chamadas da conta e do mesmo escopo/lock do ciclo.
// Sem dados confiáveis (pack/irmão indisponível, orçamento, token, pack sem o pedido,
// shipment divergente) ⇒ { tipo: "incompleto" }: o pedido NÃO recebe o frete cheio — frete
// NULL + pendência "frete_pack_incompleto" (provisória; inconclusiva para detectores).
// Pedido cancelado continua no rateio (o custo do envio é do shipment).

function shipmentDe(order) {
  return order?.shipping?.id != null ? String(order.shipping.id) : null;
}

// env: { ctx, conhecidos: Map<id, order>, cachePack: Map, cachePedidos: Map, fetchPack, fetchOrder }
// Devolve { tipo: "unico" } | { tipo: "compartilhado", pedidos: [order...] } | { tipo: "incompleto", motivo }.
async function resolverEnvio(order, env) {
  const shipmentId = shipmentDe(order);
  if (!shipmentId) return { tipo: "unico" };
  const id = String(order.id);
  const packId = order.pack_id != null ? String(order.pack_id) : null;

  if (!packId) {
    const irmaos = [...env.conhecidos.values()].filter((o) => String(o.id) !== id && shipmentDe(o) === shipmentId);
    return irmaos.length ? { tipo: "compartilhado", pedidos: [order, ...irmaos] } : { tipo: "unico" };
  }

  try {
    let pack = env.cachePack.get(packId);
    if (!pack) {
      pack = await env.fetchPack(env.ctx, packId);
      env.cachePack.set(packId, pack);
    }
    const ids = (pack.orderIds || []).map(String);
    if (!ids.includes(id)) return { tipo: "incompleto", motivo: `pack ${packId} não lista o pedido ${id}` };
    if (pack.shipmentId && pack.shipmentId !== shipmentId) {
      return { tipo: "incompleto", motivo: `pack ${packId} com shipment ${pack.shipmentId} ≠ ${shipmentId} do pedido` };
    }
    if (ids.length === 1) return { tipo: "unico" };
    const pedidos = [order];
    for (const outro of ids) {
      if (outro === id) continue;
      let o = env.conhecidos.get(outro) || env.cachePedidos.get(outro);
      if (!o) {
        o = await env.fetchOrder(env.ctx, outro);
        env.cachePedidos.set(outro, o);
      }
      if (shipmentDe(o) === shipmentId) pedidos.push(o);
    }
    return pedidos.length > 1 ? { tipo: "compartilhado", pedidos } : { tipo: "unico" };
  } catch (err) {
    return { tipo: "incompleto", motivo: `${err.code ? `${err.code}: ` : ""}${err.message}` };
  }
}

function criarEnvioPack({ ctx, fetchPack, fetchOrder }) {
  return {
    ctx, fetchPack, fetchOrder,
    conhecidos: new Map(),
    cachePack: new Map(),
    cachePedidos: new Map(),
    cacheFrete: new Map(), // shipmentId → entry do frete (só coletas bem-sucedidas)
  };
}

module.exports = { resolverEnvio, criarEnvioPack, shipmentDe };
