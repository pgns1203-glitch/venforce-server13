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
// REÚSO: a cotação corrente (preço vigente, promoção, comissão prevista e
// frete previsto) vem de `shared/marketplaceCurrentQuoteService`, extraído
// desta mesma lógica na refatoração estrutural da Central de Margem — ver
// docs/AUDITORIA_ARQUITETURAL_CENTRAL_MARGEM.md. Automações e Diagnóstico
// ainda têm suas próprias cópias (migração deles fica para a próxima rodada,
// por escopo — ver relatório de entrega da refatoração).

const { mlFetch } = require("../../../utils/mlClient");
const { obterCotacaoAtual } = require("../../shared/marketplaceCurrentQuoteService");
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
 * Coleta TODAS as evidências projetadas de um item e registra no bag.
 * Preço + comissão prevista + frete previsto vêm de
 * `shared/marketplaceCurrentQuoteService.obterCotacaoAtual` — nenhuma consulta
 * a `listing_prices`/`shipping_options` é reimplementada aqui.
 * @returns {Promise<object>} resumo do que foi observado (para diagnóstico)
 */
async function aplicarEvidenciasProjetadas(
  bag,
  { clienteId, body, observedAt = new Date() },
  deps = {}
) {
  const itemId = String(body?.id || "").trim();
  const listingTypeId = body?.listing_type_id || null;
  const categoryId = body?.category_id || null;
  const sellerId = body?.seller_id || null;
  const logisticType = body?.shipping?.logistic_type || "";

  const precoListaFallback =
    numOrNull(body?.price) !== null && numOrNull(body.price) > 0 ? numOrNull(body.price) : null;

  const cotarFn = deps.obterCotacaoAtualFn || obterCotacaoAtual;
  const cotacao = await cotarFn(
    { clienteId, itemId, precoListaFallback, listingTypeId, categoryId, sellerId, logisticType },
    { mlFetchFn: deps.mlFetchFn, resolverPrecosItemFn: deps.resolverPrecosItemFn }
  );

  const comum = {
    source: SOURCES.MELI_API,
    kind: EVIDENCE_KINDS.PROJECTED,
    quality: EVIDENCE_QUALITY.MEASURED,
    observedAt,
  };

  bag.add(FIELDS.PRICE, { ...comum, value: cotacao.precoEfetivo, note: `sale_price (${cotacao.fontePreco})` });
  bag.add(FIELDS.LIST_PRICE, { ...comum, value: cotacao.precoOriginal, note: `sale_price (${cotacao.fontePreco})` });
  bag.add(FIELDS.PROMO_PRICE, {
    ...comum,
    value: cotacao.precoPromocional,
    note: `sale_price (${cotacao.fontePreco})`,
  });
  bag.add(FIELDS.COMMISSION, {
    ...comum,
    value: cotacao.comissaoValor,
    note: "listing_prices.sale_fee_amount",
  });
  bag.add(FIELDS.COMMISSION_RATE, {
    ...comum,
    value: cotacao.comissaoPercentual,
    note: "listing_prices.sale_fee_details.percentage_fee",
  });
  bag.add(FIELDS.FREIGHT, {
    ...comum,
    value: cotacao.fretePrevisto,
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
    precoEfetivo: cotacao.precoEfetivo,
    precoCheio: cotacao.precoOriginal,
    precoPromocional: cotacao.precoPromocional,
    commission: cotacao.comissaoValor,
    commissionRate: cotacao.comissaoPercentual,
    freight: cotacao.fretePrevisto,
    // Sinaliza para a Central por que uma variável ficou sem valor.
    faltantes: cotacao.faltantes,
  };
}

module.exports = {
  SEARCH_PAGE_LIMIT,
  buscarItensAtivos,
  buscarDetalhesItens,
  aplicarEvidenciasProjetadas,
  extrairImagem,
};
