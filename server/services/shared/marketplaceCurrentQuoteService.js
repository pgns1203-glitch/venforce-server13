// server/services/shared/marketplaceCurrentQuoteService.js
// COTAÇÃO CORRENTE do marketplace — preço vigente, promoção, comissão prevista
// e frete previsto de UM anúncio, num contrato único.
//
// Por que este arquivo existe: a auditoria arquitetural da Central de Margem
// (docs/AUDITORIA_ARQUITETURAL_CENTRAL_MARGEM.md) encontrou a MESMA consulta a
// `/sites/MLB/listing_prices` e `/users/{seller}/shipping_options/free`
// implementada de forma independente em:
//   - server/services/motorMargem/adapters/meliApiEvidenceAdapter.js (Motor)
//   - server/services/automacoes/precificacaoService.js (Automações/preview)
//   - server/services/automacoes/diagnosticoService.js (Diagnóstico)
//
// Esta é a extração da MENOR abstração compartilhada segura: só a cotação
// corrente (preço + comissão + frete previstos), reaproveitando
// `precoItemService.resolverPrecosItem` (que já era compartilhado) para o
// preço. NESTA RODADA só o Motor foi migrado para este helper — Automações e
// Diagnóstico continuam com suas implementações próprias. Migrá-los também é
// simples em teoria, mas amplia o raio de teste para rotas de precificação
// ativamente usadas; ver proposta de Fase 2 no relatório de entrega.
//
// SOMENTE LEITURA: toda chamada ao Mercado Livre aqui é GET.

const { mlFetch } = require("../../utils/mlClient");
const { resolverPrecosItem } = require("../automacoes/precoItemService");

function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Comissão + frete previstos de UM item, no preço efetivo informado.
 * Qualquer falha vira `null` (ausente) — nunca 0.
 */
async function buscarComissaoEFrete(
  { clienteId, itemId, precoEfetivo, listingTypeId, categoryId, sellerId, logisticType, mlUserId = null },
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
        // Path seller-scoped (/users/{seller}/…): sem mlUserId o token cai no
        // principal e o ML pode responder 403 quando a conta selecionada não
        // é a principal do cliente (mesmo bug do fix de Automações).
        return await fetchFn(clienteId, query, { mlUserId });
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

  const comissaoValor = numOrNull(root?.sale_fee_amount);
  const comissaoPercentualBruta = numOrNull(root?.sale_fee_details?.percentage_fee);

  const fretePrevisto =
    shippingResp && shippingResp.ok
      ? numOrNull(shippingResp.data?.coverage?.all_country?.list_cost)
      : null;

  return {
    comissaoValor,
    // O ML devolve o percentual em escala 0–100; o resto do backend trabalha
    // em decimal (0.12 = 12%) — mesma convenção de `custos.imposto_percentual`.
    comissaoPercentual: comissaoPercentualBruta === null ? null : comissaoPercentualBruta / 100,
    fretePrevisto,
  };
}

/**
 * Cotação corrente completa de UM anúncio: preço vigente + promoção +
 * comissão prevista + frete previsto, num contrato único.
 *
 * @param {object} params
 *  - clienteId          id interno do cliente (para o token ML)
 *  - itemId              MLB do anúncio
 *  - precoListaFallback  preço de tabela conhecido (do /items?ids=), usado só
 *                        se /sale_price falhar (mesmo fallback de sempre)
 *  - listingTypeId, categoryId, sellerId, logisticType  metadados do anúncio,
 *                        necessários para consultar listing_prices/shipping
 * @returns {Promise<object>}
 */
async function obterCotacaoAtual(
  { clienteId, itemId, precoListaFallback = null, listingTypeId, categoryId, sellerId, logisticType, mlUserId = null },
  deps = {}
) {
  const fetchFn = deps.mlFetchFn || mlFetch;
  const precosFn = deps.resolverPrecosItemFn || resolverPrecosItem;

  const { precoCheio, precoPromocional, precoEfetivo, fonte } = await precosFn({
    clienteId,
    itemId,
    precoListaFallback,
    mlUserId,
  });

  const { comissaoValor, comissaoPercentual, fretePrevisto } = await buscarComissaoEFrete(
    { clienteId, itemId, precoEfetivo, listingTypeId, categoryId, sellerId, logisticType, mlUserId },
    fetchFn
  );

  const faltantes = [
    precoEfetivo === null ? "preco" : null,
    comissaoValor === null ? "comissao" : null,
    fretePrevisto === null ? "frete" : null,
  ].filter(Boolean);

  return {
    precoAtual: precoEfetivo,
    precoOriginal: precoCheio,
    precoPromocional,
    precoEfetivo,
    fontePreco: fonte,
    comissaoValor,
    comissaoPercentual,
    fretePrevisto,
    listingType: listingTypeId || null,
    logisticType: logisticType || null,
    faltantes,
  };
}

module.exports = {
  obterCotacaoAtual,
  buscarComissaoEFrete,
};
