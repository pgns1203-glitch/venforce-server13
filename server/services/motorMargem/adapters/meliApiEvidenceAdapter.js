// server/services/motorMargem/adapters/meliApiEvidenceAdapter.js
// Fonte MELI_API — estado ATUAL do anúncio (margem projetada).
//
// SOMENTE LEITURA. Todas as chamadas são GET; nada de preço, promoção ou
// estoque é escrito no Mercado Livre nesta rodada.
//
// Endpoints usados (os mesmos que o Otimizador de Precificação já consome):
//   GET /users/{ml_user_id}/items/search?status=active   → ids dos anúncios
//   GET /items?ids=…                                     → título, listing_type, categoria
//   GET /items/{id}/sale_price                           → preço cheio/promo/efetivo
//   GET /sites/MLB/listing_prices                        → comissão (R$ e %)
//   GET /users/{seller}/shipping_options/free            → frete previsto
//
// REÚSO: `mlFetch` (utils/mlClient) e `resolverPrecosItem`
// (automacoes/precoItemService) são os mesmos helpers do Otimizador — o preço
// promocional não é reimplementado aqui.
//
// ⚠️ DUPLICAÇÃO CONHECIDA: a montagem das queries de `listing_prices` e
// `shipping_options/free` já existe copiada em precificacaoService.js e
// diagnosticoService.js. Esta é a terceira cópia. Unificar as três é
// refatoração fora do escopo desta rodada — registrado em
// MOTOR_MARGEM_IMPLEMENTACAO §Próximos passos.

const { mlFetch } = require("../../../utils/mlClient");
const { resolverPrecosItem } = require("../../automacoes/precoItemService");
const { SOURCES, EVIDENCE_KINDS, EVIDENCE_QUALITY } = require("../core/marginSources");
const { FIELDS } = require("../core/marginEvidence");

const SEARCH_PAGE_LIMIT = 20; // teto do /items?ids= do ML

function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Imagem do anúncio — extraída do MESMO `body` que `/items?ids=` já devolve.
 * ZERO chamada nova: é metadado de identidade/apresentação, não evidência
 * financeira. Defensivo porque o contrato do ML nem sempre traz as três
 * variantes; a primeira disponível vence.
 */
function extrairImagem(body) {
  const secureThumb = typeof body?.secure_thumbnail === "string" ? body.secure_thumbnail.trim() : "";
  if (secureThumb) return secureThumb;
  const thumb = typeof body?.thumbnail === "string" ? body.thumbnail.trim() : "";
  if (thumb) return thumb;
  const pictures = Array.isArray(body?.pictures) ? body.pictures : [];
  for (const picture of pictures) {
    const url = (picture && (picture.secure_url || picture.url) || "").trim();
    if (url) return url;
  }
  return null;
}

/** Página de anúncios ativos do vendedor. Somente leitura. */
async function buscarItensAtivos({ clienteId, mlUserId, offset = 0, limit = SEARCH_PAGE_LIMIT }, fetchFn = mlFetch) {
  const resp = await fetchFn(
    clienteId,
    `/users/${mlUserId}/items/search?status=active&offset=${offset}&limit=${limit}`
  );
  if (!resp.ok) {
    const err = new Error(resp.data?.message || "Erro ao buscar itens no Mercado Livre.");
    err.statusCode = resp.status === 401 || resp.status === 403 ? 422 : 502;
    throw err;
  }
  return {
    ids: Array.isArray(resp.data?.results) ? resp.data.results : [],
    total: resp.data?.paging?.total ?? 0,
  };
}

/** Detalhes em lote. Devolve os `body` já desembrulhados do multiget. */
async function buscarDetalhesItens({ clienteId, ids }, fetchFn = mlFetch) {
  if (!ids || ids.length === 0) return [];
  const resp = await fetchFn(clienteId, `/items?ids=${ids.join(",")}`);
  if (!resp.ok) {
    const err = new Error(resp.data?.message || "Erro ao buscar detalhes dos itens no Mercado Livre.");
    err.statusCode = resp.status === 401 || resp.status === 403 ? 422 : 502;
    throw err;
  }
  const entries = Array.isArray(resp.data) ? resp.data : [];
  return entries.map((entry) => entry?.body || null).filter(Boolean);
}

/**
 * Comissão + frete previstos de UM item, no preço efetivo informado.
 * Qualquer falha vira `null` (ausente) — nunca 0.
 */
async function buscarCustosMarketplace(
  { clienteId, itemId, precoEfetivo, listingTypeId, categoryId, sellerId, logisticType },
  fetchFn = mlFetch
) {
  const [listingPricesResp, shippingResp] = await Promise.all([
    (async () => {
      if (precoEfetivo === null || !listingTypeId || !categoryId) return null;
      const query =
        `/sites/MLB/listing_prices?price=${encodeURIComponent(precoEfetivo)}` +
        `&listing_type_id=${encodeURIComponent(listingTypeId)}` +
        `&category_id=${encodeURIComponent(categoryId)}`;
      try {
        return await fetchFn(clienteId, query);
      } catch (_) {
        return null;
      }
    })(),
    (async () => {
      // Frete combinável (não especificado/custom) não tem custo previsto pelo
      // ML — pedir mesmo assim devolveria um número que não se aplica.
      const isCombinable = ["not_specified", "custom", ""].includes(logisticType || "");
      if (isCombinable) return null;
      if (precoEfetivo === null || !sellerId || !listingTypeId || !itemId) return null;
      const query =
        `/users/${encodeURIComponent(sellerId)}/shipping_options/free` +
        `?item_id=${encodeURIComponent(itemId)}&verbose=true` +
        `&item_price=${encodeURIComponent(precoEfetivo)}` +
        `&listing_type_id=${encodeURIComponent(listingTypeId)}&mode=me2`;
      try {
        return await fetchFn(clienteId, query);
      } catch (_) {
        return null;
      }
    })(),
  ]);

  const listingPricesData = listingPricesResp && listingPricesResp.ok ? listingPricesResp.data : null;
  const root = Array.isArray(listingPricesData)
    ? listingPricesData[0]
    : Array.isArray(listingPricesData?.results)
      ? listingPricesData.results[0]
      : listingPricesData;

  const commission = numOrNull(root?.sale_fee_amount);
  const commissionPercent = numOrNull(root?.sale_fee_details?.percentage_fee);

  const freight =
    shippingResp && shippingResp.ok
      ? numOrNull(shippingResp.data?.coverage?.all_country?.list_cost)
      : null;

  return {
    commission,
    // O ML devolve o percentual em escala 0–100; o núcleo trabalha em decimal.
    commissionRate: commissionPercent === null ? null : commissionPercent / 100,
    freight,
  };
}

/**
 * Coleta TODAS as evidências projetadas de um item e registra no bag.
 * @returns {Promise<object>} resumo do que foi observado (para diagnóstico)
 */
async function aplicarEvidenciasProjetadas(
  bag,
  { clienteId, body, observedAt = new Date() },
  deps = {}
) {
  const fetchFn = deps.mlFetchFn || mlFetch;
  const precosFn = deps.resolverPrecosItemFn || resolverPrecosItem;

  const itemId = String(body?.id || "").trim();
  const listingTypeId = body?.listing_type_id || null;
  const categoryId = body?.category_id || null;
  const sellerId = body?.seller_id || null;
  const logisticType = body?.shipping?.logistic_type || "";

  const precoListaFallback =
    numOrNull(body?.price) !== null && numOrNull(body.price) > 0 ? numOrNull(body.price) : null;

  const { precoCheio, precoPromocional, precoEfetivo, fonte } = await precosFn({
    clienteId,
    itemId,
    precoListaFallback,
  });

  const comum = {
    source: SOURCES.MELI_API,
    kind: EVIDENCE_KINDS.PROJECTED,
    quality: EVIDENCE_QUALITY.MEASURED,
    observedAt,
  };

  bag.add(FIELDS.PRICE, { ...comum, value: precoEfetivo, note: `sale_price (${fonte})` });
  bag.add(FIELDS.LIST_PRICE, { ...comum, value: precoCheio, note: `sale_price (${fonte})` });
  bag.add(FIELDS.PROMO_PRICE, { ...comum, value: precoPromocional, note: `sale_price (${fonte})` });

  const { commission, commissionRate, freight } = await buscarCustosMarketplace(
    { clienteId, itemId, precoEfetivo, listingTypeId, categoryId, sellerId, logisticType },
    fetchFn
  );

  bag.add(FIELDS.COMMISSION, { ...comum, value: commission, note: "listing_prices.sale_fee_amount" });
  bag.add(FIELDS.COMMISSION_RATE, {
    ...comum,
    value: commissionRate,
    note: "listing_prices.sale_fee_details.percentage_fee",
  });
  bag.add(FIELDS.FREIGHT, {
    ...comum,
    value: freight,
    note: "shipping_options/free.coverage.all_country.list_cost",
  });

  return {
    itemId,
    titulo: body?.title || null,
    sku: body?.seller_custom_field || null,
    status: body?.status || null,
    image: extrairImagem(body),
    listingTypeId,
    categoryId,
    logisticType: logisticType || null,
    precoEfetivo,
    precoCheio,
    precoPromocional,
    commission,
    commissionRate,
    freight,
    // Sinaliza para a Central por que uma variável ficou sem valor.
    faltantes: [
      precoEfetivo === null ? "preco" : null,
      commission === null ? "comissao" : null,
      freight === null ? "frete" : null,
    ].filter(Boolean),
  };
}

module.exports = {
  SEARCH_PAGE_LIMIT,
  buscarItensAtivos,
  buscarDetalhesItens,
  buscarCustosMarketplace,
  aplicarEvidenciasProjetadas,
  extrairImagem,
};
