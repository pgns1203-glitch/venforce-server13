// server/services/centralVendas/centralVendasPackResolver.js
//
// Para o rateio do envio de pack na Central: o run só conhece os pedidos que o Orders API
// devolveu no intervalo; um irmão fora do intervalo (ex.: pedido A em out e B em nov, runs
// mensais) faria cada pedido receber o valor CHEIO do shipment. Aqui, para cada pack_id distinto
// do run (só pedidos com pack_id e shipment) faz-se 1× GET /packs/:id
// (documentacao_api_meli/gestao-packs.md: shipment.id + orders[].id, só pedidos DESTE vendedor)
// e os pedidos listados que não estão no run são buscados por GET /orders/:id (cache por run).
//
// Falha/indisponível (HTTP, timeout, pack que não lista o pedido, shipment divergente, irmão não
// obtido) ⇒ o pack entra em `packsIncompletos`: o motor grava frete_seller e receita_envio NULL +
// pendência frete_pack_incompleto (nunca o valor cheio, nunca 0).
//
// mlFetchFn é o mlFetch da Central COM prazo por chamada (comPrazoPadrao "mlMs"); este módulo não
// toca mlClient.js. Concorrência limitada; 429/5xx com backoff curto e Retry-After.

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleepPadrao = (ms) => new Promise((r) => setTimeout(r, ms));

function atrasoMs(tentativa, retryAfter) {
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 15000);
  return Math.min(500 * 2 ** (tentativa - 1), 4000);
}

async function getComRetry(mlFetchFn, clienteId, path, sellerId, { maxAttempts, sleepFn, contagem }) {
  let ultima = null;
  for (let tentativa = 1; tentativa <= maxAttempts; tentativa++) {
    contagem.chamadas += 1;
    try {
      const resp = await mlFetchFn(clienteId, path, { mlUserId: sellerId });
      if (resp?.ok) return resp;
      ultima = resp;
      if (!RETRYABLE.has(resp?.status) || tentativa === maxAttempts) return resp;
      await sleepFn(atrasoMs(tentativa, resp?.retryAfter));
    } catch (err) {
      ultima = { ok: false, status: null, erro: err };
      if (tentativa === maxAttempts) return ultima;
      await sleepFn(atrasoMs(tentativa, null));
    }
  }
  return ultima;
}

async function emLotes(itens, concorrencia, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concorrencia, itens.length)) }, async () => {
    while (i < itens.length) {
      const item = itens[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

// → { ordersContexto, packsIncompletos: Set<packId>, resumo }
async function resolverPacksDoRun({ orders, clienteId, sellerId, mlFetchFn, sleepFn = sleepPadrao, concorrencia = 5, maxAttempts = 3 }) {
  const lista = Array.isArray(orders) ? orders : [];
  const porId = new Map(lista.map((o) => [String(o.id), o]));
  const packs = new Map(); // packId → pedidos do run
  for (const o of lista) {
    if (o?.pack_id == null || o?.shipping?.id == null) continue;
    const k = String(o.pack_id);
    if (!packs.has(k)) packs.set(k, []);
    packs.get(k).push(o);
  }
  const contagem = { chamadas: 0 };
  const resumo = { packsConsultados: 0, packsIncompletos: 0, irmaosBuscados: 0, chamadas: 0, packsComVariosPedidos: 0 };
  const incompletos = new Set();
  const extras = new Map(); // irmãos fora do run
  const cacheIrmao = new Map(); // orderId → order | null (falha)
  const opts = { maxAttempts, sleepFn, contagem };

  await emLotes([...packs.keys()], concorrencia, async (packId) => {
    resumo.packsConsultados += 1;
    const resp = await getComRetry(mlFetchFn, clienteId, `/packs/${encodeURIComponent(packId)}`, sellerId, opts);
    if (!resp?.ok || !Array.isArray(resp.data?.orders)) { incompletos.add(packId); return; }
    const ids = resp.data.orders.map((o) => String(o.id));
    const shipmentPack = resp.data.shipment?.id != null ? String(resp.data.shipment.id) : null;
    const doRun = packs.get(packId);
    if (doRun.some((o) => !ids.includes(String(o.id)))) { incompletos.add(packId); return; }
    if (shipmentPack && doRun.some((o) => String(o.shipping.id) !== shipmentPack)) { incompletos.add(packId); return; }
    if (ids.length > 1) resumo.packsComVariosPedidos += 1;
    for (const outro of ids) {
      if (porId.has(outro)) continue;
      if (!cacheIrmao.has(outro)) {
        resumo.irmaosBuscados += 1;
        const r = await getComRetry(mlFetchFn, clienteId, `/orders/${encodeURIComponent(outro)}`, sellerId, opts);
        cacheIrmao.set(outro, r?.ok && r.data?.id != null ? r.data : null);
      }
      const irmao = cacheIrmao.get(outro);
      if (!irmao) { incompletos.add(packId); return; }
      extras.set(outro, irmao);
    }
  });

  resumo.packsIncompletos = incompletos.size;
  resumo.chamadas = contagem.chamadas;
  return { ordersContexto: [...lista, ...extras.values()], packsIncompletos: incompletos, resumo };
}

module.exports = { resolverPacksDoRun };
