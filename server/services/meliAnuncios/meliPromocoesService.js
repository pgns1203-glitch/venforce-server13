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

  // Subsídio ML em R$ — NÃO vem de discount_meli_boost_amount/boosted_offer/
  // benefits (auditoria ao vivo: 101 promoções reais de 15 clientes em
  // produção, ZERO com boosted_offer:true — inclusive as 2 SMART reais do
  // item que mostrava "Reduzimos R$0,61" no Mercado Livre). Fonte real:
  // fórmula já validada em produção pela tela "Promoções com Retorno ML"
  // (server/services/automacoes/promocoesRetornoService.js, campo
  // "Retorno ML") — original_price * (meli_percentage/100). Caso real
  // confirmado: item MLB4147165927, promoção "Impulsione suas vendas"
  // (SMART), original_price=119.90, meli_percentage=0.5 → R$0,60, a 1
  // centavo do R$0,61 mostrado pelo ML (diferença compatível com a
  // precisão de 1 casa decimal do meli_percentage retornado pela API).
  // Nome do campo interno (subsidioMl) mantido para não exigir refactor
  // grande no frontend — semanticamente é "Retorno ML" (a fatia do
  // desconto promocional que o Mercado Livre banca), não uma redução de
  // tarifa/comissão. Exige os DOIS campos (original_price E
  // meli_percentage); nunca usa seller_percentage como fonte nem soma os
  // dois percentuais — um cálculo parcial vira null, nunca um valor
  // inventado.
  const meliPercentage = fin(promo && promo.meli_percentage);
  const sellerPercentage = fin(promo && promo.seller_percentage);
  const subsidioMl =
    precoOriginal !== null && meliPercentage !== null
      ? round2(precoOriginal * (meliPercentage / 100))
      : null;

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

// Enriquecimento de vigência — /seller-promotions/items/{itemId} (fonte
// principal) só manda start_date/finish_date de forma confiável para DEAL;
// para SMART, PRICE_MATCHING, PRE_NEGOTIATED, LIGHTNING, UNHEALTHY_STOCK (e
// parte dos PRICE_DISCOUNT) o próprio Mercado Livre só expõe a vigência via
// GET /seller-promotions/promotions/{promotion_id}?promotion_type={tipo}
// (ver auditoria: campanhas-smart-price-matching.md, desconto-pre-acordado-
// por-item.md, ofertas-relampago.md). Chamada OPCIONAL, uma por promoção sem
// data — nunca bloqueia a listagem: falha (ok:false ou exceção) mantém
// inicio/fim como vieram (null), nunca inventa.
async function obterVigenciaCampanha({ clienteId, promotionId, tipo, mlUserId }) {
  try {
    const resp = await mlFetch(
      clienteId,
      `/seller-promotions/promotions/${encodeURIComponent(promotionId)}?promotion_type=${encodeURIComponent(tipo)}&app_version=v2`,
      { mlUserId }
    );
    if (!resp || !resp.ok) return null;
    const inicio = (resp.data && resp.data.start_date) || null;
    const fim = (resp.data && resp.data.finish_date) || null;
    return inicio || fim ? { inicio, fim } : null;
  } catch (_) {
    return null;
  }
}

// Só dispara para promoções que chegaram SEM start_date e SEM finish_date da
// fonte principal E que têm promotion_id + type suficientes para montar a
// consulta de detalhe.
//
// promotion_id: prioriza `bruta.id` (id da CAMPANHA, formato "P-.../LGH-...",
// é o que todos os exemplos oficiais do ML usam em
// /seller-promotions/promotions/{promotion_id} — ver gerenciar-ofertas.md,
// campanhas-smart-price-matching.md, desconto-pre-acordado-por-item.md,
// ofertas-relampago.md). `bruta.ref_id` é documentado como "id da oferta ou
// candidato" (formato "OFFER-..."), um recurso DIFERENTE — em todo exemplo
// oficial onde ref_id aparece, id também aparece junto, nunca sozinho.
// Mesmo assim, cai para ref_id como fallback defensivo quando id vier
// ausente: se ref_id não servir como promotion_id nesse endpoint, o ML só
// devolve erro/ok:false — já tratado, nunca quebra a listagem.
//
// Deduplicação: duas promoções diferentes na mesma lista podem apontar para
// o mesmo id+type (ex.: uma entrada started e outra pending da mesma
// campanha) — `cache` (Map local, recriado a cada chamada de
// listarPromocoesDoItem, NUNCA persistente entre requisições) garante uma
// única chamada de rede por id+type, guardando a PROMISE (não o valor já
// resolvido) para que chamadas concorrentes dentro do mesmo Promise.all
// compartilhem a mesma requisição em voo.
//
// Roda em paralelo (Promise.all) — mutação in-place dos objetos
// normalizados, que acabaram de ser criados aqui dentro (sem referência
// externa ainda).
async function enriquecerVigencia({ clienteId, mlUserId, paresBrutoNormalizado }) {
  const cache = new Map();
  await Promise.all(
    paresBrutoNormalizado.map(async ([bruta, p]) => {
      if (p.inicio != null || p.fim != null) return;
      const promotionId = (bruta && bruta.id) || (bruta && bruta.ref_id);
      const tipo = bruta && bruta.type;
      if (!promotionId || !tipo) return;
      const chave = `${promotionId}::${tipo}`;
      if (!cache.has(chave)) {
        cache.set(chave, obterVigenciaCampanha({ clienteId, promotionId, tipo, mlUserId }));
      }
      const detalhe = await cache.get(chave);
      if (!detalhe) return;
      if (detalhe.inicio != null) p.inicio = detalhe.inicio;
      if (detalhe.fim != null) p.fim = detalhe.fim;
    })
  );
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

  const ordenada = ordenarPorPrioridade(lista);
  const normalizadas = ordenada.map((p, i) => normalizarPromocao(p, i, promotionIdAtivo));

  await enriquecerVigencia({
    clienteId,
    mlUserId,
    paresBrutoNormalizado: ordenada.map((p, i) => [p, normalizadas[i]]),
  });

  return normalizadas;
}

module.exports = {
  listarPromocoesDoItem,
  normalizarPromocao,
  ordenarPorPrioridade,
  rotuloTipoPromocao,
  statusLabelPromocao,
};
