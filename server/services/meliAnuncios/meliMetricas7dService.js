// server/services/meliAnuncios/meliMetricas7dService.js
// -----------------------------------------------------------------------------
// Métricas "últ. 7 dias" (views/vendas/conversão) da tela de Anúncios ML.
//
// AO VIVO, sem persistência: nada aqui grava em banco, nada aqui roda em
// segundo plano. Cada chamada busca só o que foi pedido, no momento em que
// foi pedido — ver server/controllers/meliAnunciosController.js (performance).
//
// Vendas: reaproveita o MESMO padrão de server/services/metricasService.js
// (`fetchAllOrders`, GET /orders/search por `seller` + janela de datas,
// status=null — igual à chamada de "vendas" de buscarResumo, sem filtrar por
// status). Agregado por item_id em JS. NUNCA usa `sold_quantity` acumulado do
// item (esse número é vitalício, não é "últimos 7 dias").
//
// Views: não existe endpoint em lote por item na API do ML
// (documentacao_api_meli/recurso-visits.md) — só agregado do vendedor
// inteiro (inútil aqui, não é por item) ou um item por chamada
// (GET /items/{id}/visits/time_window). Por isso 1 chamada por item_id,
// limitada por `mapWithConcurrency` (mesmo utilitário do Motor de Margem)
// para não abrir uma rajada de requisições simultâneas ao Mercado Livre.
//
// Falha de UM item (visita) ou da busca de pedidos inteira nunca derruba a
// resposta: vira `null`/"sem dado" para o que falhou, os outros seguem.
// -----------------------------------------------------------------------------

const { mlFetch } = require("../../utils/mlClient");
const { fetchAllOrders } = require("../metricasService");
const { mapWithConcurrency } = require("../motorMargem/motorMargemService");

const JANELA_DIAS = 7;
const VISITAS_CONCURRENCY = 5;

function dataISO(d) {
  return d.toISOString().slice(0, 10);
}

// Últimos 7 dias terminando hoje — mesma janela que `last=7&unit=day` usa
// por padrão na API de visitas do ML (`ending` = "data e hora atuais").
function janela7dias(agora = new Date()) {
  const to = new Date(agora);
  const from = new Date(agora);
  from.setDate(from.getDate() - (JANELA_DIAS - 1));
  return { dateFrom: dataISO(from), dateTo: dataISO(to) };
}

// { ok: true, porItem: {itemId: quantidade} } — ok:false quando a busca de
// pedidos falhou por completo (token, rede, erro do ML): nesse caso NENHUM
// item pode afirmar "vendeu 0", porque não sabemos. `porItem` ausente de um
// item (ok:true) significa zero pedidos DAQUELE item no período — fato, não
// ausência de dado.
async function buscarVendas7dPorItens({ clienteId, mlUserId, itemIds }) {
  const alvo = new Set((itemIds || []).map(String));
  if (!alvo.size) return { ok: true, porItem: {} };

  const { dateFrom, dateTo } = janela7dias();
  let orders;
  try {
    orders = await fetchAllOrders(clienteId, mlUserId, dateFrom, dateTo, null);
  } catch (err) {
    return { ok: false, porItem: {} };
  }

  const porItem = {};
  for (const order of orders) {
    for (const oi of order.order_items || []) {
      const itemId = oi.item && oi.item.id != null ? String(oi.item.id) : null;
      if (!itemId || !alvo.has(itemId)) continue;
      const qty = Number(oi.quantity) || 0;
      porItem[itemId] = (porItem[itemId] || 0) + qty;
    }
  }
  return { ok: true, porItem };
}

// { itemId: número | null } — null é "não sabemos" (chamada falhou para
// ESTE item especificamente); os demais itens do lote não são afetados.
async function buscarVisitas7dPorItens({ clienteId, mlUserId, itemIds }) {
  const ids = Array.from(new Set((itemIds || []).map(String)));
  const porItem = {};
  if (!ids.length) return porItem;

  await mapWithConcurrency(ids, VISITAS_CONCURRENCY, async (itemId) => {
    try {
      const resp = await mlFetch(
        clienteId,
        `/items/${encodeURIComponent(itemId)}/visits/time_window?last=${JANELA_DIAS}&unit=day`,
        { mlUserId }
      );
      porItem[itemId] =
        resp && resp.ok && resp.data && typeof resp.data.total_visits === "number"
          ? resp.data.total_visits
          : null;
    } catch (err) {
      porItem[itemId] = null;
    }
  });

  return porItem;
}

// vendas7d / views7d, em porcentagem, 1 casa decimal. "—" (null) quando
// views for 0/nulo/desconhecido, ou vendas for desconhecido — nunca
// NaN/Infinity (vendas=0 com views>0 é 0%, um número real, não "—").
function calcularConversao(vendas, views) {
  if (views === null || views === undefined || views === 0) return null;
  if (vendas === null || vendas === undefined) return null;
  const pct = (vendas / views) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.round(pct * 10) / 10;
}

// Junta os dois lados e calcula a conversão. `itemIds` é a lista EXATA vinda
// do chamador (o controller decide quem está visível) — esta função nunca
// decide sozinha o que buscar.
async function montarMetricas7d({ clienteId, mlUserId, itemIds }) {
  const ids = Array.from(new Set((itemIds || []).map(String)));
  const [vendas, visitasPorItem] = await Promise.all([
    buscarVendas7dPorItens({ clienteId, mlUserId, itemIds: ids }),
    buscarVisitas7dPorItens({ clienteId, mlUserId, itemIds: ids }),
  ]);

  const metricas = {};
  for (const itemId of ids) {
    const views = Object.prototype.hasOwnProperty.call(visitasPorItem, itemId)
      ? visitasPorItem[itemId]
      : null;
    const vendasItem = vendas.ok
      ? (Object.prototype.hasOwnProperty.call(vendas.porItem, itemId) ? vendas.porItem[itemId] : 0)
      : null;
    metricas[itemId] = {
      views,
      vendas: vendasItem,
      conversao: calcularConversao(vendasItem, views),
    };
  }
  return metricas;
}

module.exports = {
  JANELA_DIAS,
  janela7dias,
  buscarVendas7dPorItens,
  buscarVisitas7dPorItens,
  calcularConversao,
  montarMetricas7d,
};
