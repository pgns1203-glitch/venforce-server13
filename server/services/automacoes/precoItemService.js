// server/services/automacoes/precoItemService.js
// Helper único de resolução/normalização de preço por item ML.
// Usado por diagnosticoService.js e precificacaoService.js para evitar
// lógica duplicada de preço cheio/promocional/efetivo entre diagnóstico e preview.

const { mlFetch } = require("../../utils/mlClient");

function numOuNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Fallback legado: replica o comportamento anterior (preço do anúncio +
// GET /items/{id}/prices) para os casos em que /sale_price falhar. Mantido
// apenas como rede de segurança — não deve ser a fonte primária de preço.
async function resolverPrecosLegado({ clienteId, itemId, precoListaFallback }) {
  const precoBase = numOuNull(precoListaFallback);
  const precoCheioFallback = precoBase !== null && precoBase > 0 ? precoBase : null;

  let precoDePrices = null;
  try {
    if (itemId) {
      const r = await mlFetch(clienteId, `/items/${encodeURIComponent(itemId)}/prices`);
      const lista = Array.isArray(r?.data?.prices) ? r.data.prices : [];
      const promoEntry = lista.find((p) => p?.type === "promotion" && numOuNull(p?.amount) > 0);
      const standardEntry = lista.find((p) => p?.type === "standard" && numOuNull(p?.amount) > 0);
      if (promoEntry) {
        precoDePrices = numOuNull(promoEntry.amount);
      } else if (standardEntry) {
        precoDePrices = numOuNull(standardEntry.amount);
      } else {
        const valores = lista.map((p) => numOuNull(p?.amount)).filter((n) => n !== null && n > 0);
        if (valores.length > 0) precoDePrices = Math.min(...valores);
      }
    }
  } catch (_) {
    precoDePrices = null;
  }

  const temPromocao =
    precoDePrices !== null && precoCheioFallback !== null && precoDePrices < precoCheioFallback;

  const precoCheio = precoCheioFallback ?? precoDePrices;
  const precoPromocional = temPromocao ? precoDePrices : null;
  const precoEfetivo = precoPromocional ?? precoCheio;

  return { precoCheio, precoPromocional, precoEfetivo, fonte: "legado_prices" };
}

// Fonte primária: GET /items/{item_id}/sale_price?context=channel_marketplace
// - amount: preço efetivo cobrado (usado em todos os cálculos de lucro/margem).
// - regular_amount: preço cheio/original, presente quando há promoção ativa.
// Promoção só é considerada quando regular_amount > amount; caso contrário
// preço cheio = preço promocional = preço efetivo = amount.
async function resolverPrecosItem({ clienteId, itemId, precoListaFallback = null }) {
  const id = String(itemId || "").trim();
  if (!id) {
    return { precoCheio: null, precoPromocional: null, precoEfetivo: null, fonte: "sem_item_id" };
  }

  try {
    const resp = await mlFetch(clienteId, `/items/${encodeURIComponent(id)}/sale_price?context=channel_marketplace`);
    if (!resp.ok) throw new Error(`sale_price HTTP ${resp.status}`);

    const amount = numOuNull(resp.data?.amount);
    if (amount === null || amount <= 0) throw new Error("sale_price sem amount válido");

    const regularAmount = numOuNull(resp.data?.regular_amount);
    const temPromocao = regularAmount !== null && regularAmount > amount;

    return {
      precoCheio: temPromocao ? regularAmount : amount,
      precoPromocional: temPromocao ? amount : null,
      precoEfetivo: amount,
      fonte: "sale_price",
    };
  } catch (_) {
    // /sale_price indisponível para o item (erro de rede, 4xx/5xx ou payload
    // inesperado) — cai para a lógica legada em vez de deixar o item sem preço.
    return resolverPrecosLegado({ clienteId, itemId: id, precoListaFallback });
  }
}

module.exports = { resolverPrecosItem };
