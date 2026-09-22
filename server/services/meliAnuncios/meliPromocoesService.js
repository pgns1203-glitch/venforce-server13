// server/services/meliAnuncios/meliPromocoesService.js
// -----------------------------------------------------------------------------
// Módulo: Anúncios Meli — promoções oficiais do item, para o bloco
// "Promoções disponíveis" do modal de detalhe.
//
// Fonte única: GET /seller-promotions/items/{ITEM_ID}?app_version=v2 (ver
// documentacao_api_meli/gerenciar-ofertas.md). Read-only — nunca inscreve o
// item em promoção nenhuma, nunca grava preço no Mercado Livre. O preço final
// de cada linha alimenta, no FRONTEND, a mesma simulação de margem que já
// existe (POST /:itemId/simular-margem, marginEngine.computeMargin) — este
// módulo só busca e normaliza o dado bruto do ML.
//
// Fórmula de margem "de planilha" de
// server/services/automacoes/promocoesRetornoService.js (tela "Promoções com
// Retorno ML") NÃO é reaproveitada aqui — é outra tela, com outra fórmula. O
// que É reaproveitado de lá é `escolherPromocao`, só para ORDENAR (nunca para
// calcular margem).
// -----------------------------------------------------------------------------

const { mlFetch } = require("../../utils/mlClient");
const { escolherPromocao } = require("../automacoes/promocoesRetornoService");

const ROTULO_TIPO = {
  DEAL: "Campanha tradicional",
  MARKETPLACE_CAMPAIGN: "Campanha cofinanciada",
  PRICE_DISCOUNT: "Desconto individual",
  VOLUME: "Desconto por quantidade",
  PRE_NEGOTIATED: "Desconto pré-acordado",
  DOD: "Oferta do dia",
  LIGHTNING: "Oferta relâmpago",
  SELLER_CAMPAIGN: "Campanha própria",
  SMART: "Campanha cofinanciada automatizada",
  PRICE_MATCHING: "Preços competitivos",
  UNHEALTHY_STOCK: "Liquidação de estoque Full",
  SELLER_COUPON_CAMPAIGN: "Cupom do vendedor",
};

function rotuloTipoPromocao(tipo) {
  const t = String(tipo || "").toUpperCase().trim();
  return ROTULO_TIPO[t] || tipo || "Promoção";
}

// candidate/started/pending são os únicos status documentados nas várias
// campanhas (ver gerenciar-ofertas.md/campanhas-tradicionais.md) — "active" é
// aceito também porque aparece como sinônimo de "started" em outro ponto da
// mesma doc (central de promoções).
const STATUS_LABEL = {
  started: "ATIVA",
  active: "ATIVA",
  pending: "AGENDADA",
  candidate: "ELEGÍVEL",
};

function statusLabelPromocao(status) {
  const s = String(status || "").toLowerCase().trim();
  return STATUS_LABEL[s] || (s ? s.toUpperCase() : "—");
}

function fin(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function round2(n) {
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : null;
}

// Normaliza UMA promoção crua do ML. Nunca inventa desconto: quando o ML não
// fornece preço utilizável — started/pending sem `price` > 0, ou candidate
// sem `suggested_discounted_price` — `precoFinal` fica null e a UI mostra
// "sem sugestão do Mercado Livre", nunca um cálculo próprio.
//
// `promotionIdAtivo` (opcional): id/ref_id da promoção que o próprio ML está
// usando AGORA para formar o preço de venda (GET /items/{id}/sale_price →
// metadata.promotion_id, ver obterPromotionIdAtivo). Usado só para decidir
// `statusExibicao` — nunca para recalcular preço/desconto/margem.
function normalizarPromocao(promo, index, promotionIdAtivo = null) {
  const status = String((promo && promo.status) || "").toLowerCase().trim();
  const precoOriginal = fin(promo && promo.original_price);

  let precoFinal = null;
  if (status === "started" || status === "active" || status === "pending") {
    const p = fin(promo && promo.price);
    precoFinal = p != null && p > 0 ? p : null;
  } else if (status === "candidate") {
    precoFinal = fin(promo && promo.suggested_discounted_price);
  }

  const descontoReais =
    precoOriginal != null && precoFinal != null ? round2(precoOriginal - precoFinal) : null;
  const descontoPercentual =
    descontoReais != null && precoOriginal ? round2((descontoReais / precoOriginal) * 100) : null;

  // Subsídio ML em R$ — vem direto de discount_meli_boost_amount: redução
  // real de tarifa/comissão que o ML concede ao vendedor (doc "Campos de
  // descontos automáticos (boost)"), o mesmo valor que a UI do ML mostra
  // como "Reduzimos R$ X das suas tarifas por cada venda". meli_percentage
  // descreve outra coisa (divisão do DESCONTO PROMOCIONAL entre ML e
  // vendedor) e não alimenta mais este campo — segue exposto abaixo como
  // dado próprio. fin(0) é 0 (finite), então boost=0 vira R$ 0,00, nunca "—".
  const meliPercentage = fin(promo && promo.meli_percentage);
  const sellerPercentage = fin(promo && promo.seller_percentage);
  const subsidioMl = fin(promo && promo.discount_meli_boost_amount);

  const idPromo = promo && promo.id;
  const refIdPromo = promo && promo.ref_id;

  // statusExibicao — só a promoção que o próprio ML aponta como responsável
  // pelo preço de venda atual (promotionIdAtivo, casado contra id/ref_id)
  // pode virar ATIVA. Sem esse dado, ou sem bater com nenhuma started/
  // active, NENHUMA fica ATIVA — nunca por eliminação/heurística de preço.
  // `status` (bruto, vindo do ML) nunca muda: isto é só um campo de exibição.
  let statusExibicao;
  if (status === "started" || status === "active") {
    const aplicada =
      promotionIdAtivo != null &&
      ((idPromo != null && String(idPromo) === String(promotionIdAtivo)) ||
        (refIdPromo != null && String(refIdPromo) === String(promotionIdAtivo)));
    statusExibicao = aplicada ? "ATIVA" : "NÃO APLICADA";
  } else if (status === "pending") {
    statusExibicao = "PROGRAMADA";
  } else if (status === "candidate") {
    statusExibicao = "ELEGÍVEL";
  } else {
    statusExibicao = statusLabelPromocao(status);
  }

  return {
    id:
      (idPromo || refIdPromo) ||
      String((promo && promo.type) || "promo") + "-" + (status || "s") + "-" + index,
    tipo: (promo && promo.type) || null,
    tipoLabel: rotuloTipoPromocao(promo && promo.type),
    nome: (promo && promo.name) || null,
    status: status || null,
    statusLabel: statusLabelPromocao(status),
    statusExibicao,
    inicio: (promo && promo.start_date) || null,
    fim: (promo && promo.finish_date) || null,
    precoOriginal,
    precoFinal,
    descontoReais,
    descontoPercentual,
    meliPercentage,
    sellerPercentage,
    subsidioMl,
    // A célula "Preço final" é sempre uma SIMULAÇÃO local (nunca escreve no
    // ML) — não depende de o ML ter enviado preço/sugestão pronta, por isso é
    // sempre editável, mesmo quando precoFinal nasce null.
    editavelPrecoFinal: true,
  };
}

// Reaproveita escolherPromocao (mesma função usada pela tela "Promoções com
// Retorno ML") para ORDENAR em vez de escolher uma só: escolhe repetidamente
// a mais prioritária (ativa/agendada primeiro, depois maior meli_percentage)
// e a remove da fila. Resultado é a lista inteira, ordenada — sem
// reimplementar a régua de prioridade em outro lugar do código.
function ordenarPorPrioridade(lista) {
  const restante = lista.slice();
  const ordenada = [];
  while (restante.length) {
    const escolhida = escolherPromocao(restante, {});
    if (!escolhida) break;
    const idx = restante.indexOf(escolhida);
    if (idx === -1) break;
    restante.splice(idx, 1);
    ordenada.push(escolhida);
  }
  return ordenada;
}

// Fonte de verdade da promoção REALMENTE aplicada agora — GET /items/{id}/
// sale_price?context=channel_marketplace → metadata.promotion_id (doc
// api-de-precos.md). É o mesmo endpoint que precoItemService.resolverPrecosItem
// usa para o Motor de Margem, mas esta é uma chamada INDEPENDENTE: só lê
// metadata.promotion_id, nunca amount/regular_amount — zero import, zero
// alteração em precoItemService.js/motor de margem. Falha ou campo ausente
// vira null (nunca derruba a lista nem inventa uma promoção ATIVA).
async function obterPromotionIdAtivo({ clienteId, itemId, mlUserId }) {
  try {
    const resp = await mlFetch(
      clienteId,
      `/items/${encodeURIComponent(itemId)}/sale_price?context=channel_marketplace`,
      { mlUserId }
    );
    if (!resp || !resp.ok) return null;
    const promotionId = resp.data && resp.data.metadata && resp.data.metadata.promotion_id;
    return promotionId != null ? String(promotionId) : null;
  } catch (_) {
    return null;
  }
}

async function listarPromocoesDoItem({ clienteId, itemId, mlUserId }) {
  const [resp, promotionIdAtivo] = await Promise.all([
    mlFetch(clienteId, `/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`, { mlUserId }),
    obterPromotionIdAtivo({ clienteId, itemId, mlUserId }),
  ]);
  if (!resp || !resp.ok) return [];

  let lista = Array.isArray(resp.data)
    ? resp.data
    : Array.isArray(resp.data && resp.data.results)
      ? resp.data.results
      : [];
  lista = lista.filter((p) => p && typeof p === "object");

  return ordenarPorPrioridade(lista).map((p, i) => normalizarPromocao(p, i, promotionIdAtivo));
}

module.exports = {
  listarPromocoesDoItem,
  normalizarPromocao,
  ordenarPorPrioridade,
  rotuloTipoPromocao,
  statusLabelPromocao,
};
