// Pós-venda da Central de Vendas — Claims API do Mercado Livre.
//
// A Orders API mantém `order.status = paid` em vendas devolvidas. Por isso os
// claims são buscados uma vez por período, paginados, e cruzados em memória por
// `resource_id` (o id do pedido). Não existe chamada por pedido.

const { mlFetch } = require("../../utils/mlClient");

const CLAIMS_PAGE_LIMIT = 100;
const CLAIMS_MAX_PAGES = 100; // offset máximo documentado: 9.999
const CLAIMS_MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const REFUND_RESOLUTIONS = new Set([
  "item_returned",
  "partial_refunded",
  "payment_refunded",
  "reimbursed",
  "charged_back",
  "low_cost",
]);

const RETURN_WITHOUT_LOSS_RESOLUTIONS = new Set([
  "return_canceled",
  "return_expired",
  "opened_claim_by_mistake",
  "prefered_to_keep_product",
  "found_missing_parts",
  "worked_out_with_seller",
  "seller_explained_functions",
  "seller_sent_product",
  "shipment_not_stopped",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelayMs(attempt, retryAfterSeconds) {
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 10000);
  }
  return Math.min(250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 150), 4000);
}

function nextIsoDate(isoDate) {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function buildClaimsRange(dateFrom, dateTo) {
  return `date_created:after:${dateFrom}T00:00:00.000-0300,before:${nextIsoDate(dateTo)}T00:00:00.000-0300`;
}

function claimHasReturn(claim) {
  const type = String(claim?.type || "").toLowerCase();
  if (type === "return" || type === "returns") return true;

  return (Array.isArray(claim?.related_entities) ? claim.related_entities : []).some((entity) => {
    if (typeof entity === "string") return entity.toLowerCase() === "return";
    const marker = String(entity?.type || entity?.resource || entity?.name || "").toLowerCase();
    return marker === "return" || marker === "returns";
  });
}

function resolutionBenefited(claim, role) {
  const benefited = claim?.resolution?.benefited;
  const roles = Array.isArray(benefited) ? benefited : benefited ? [benefited] : [];
  return roles.some((value) => String(value).toLowerCase() === role);
}

// Combinações adotadas conforme a documentação oficial:
// https://developers.mercadolivre.com.br/pt_br/gerenciar-reclamacoes
// - resolution.reason item_returned/payment_refunded/partial_refunded/reimbursed
//   (e equivalentes monetários) => perda efetivada, status "cancelado";
// - status opened com type return(s)/mediations ou stage dispute => pós-venda
//   ainda não resolvido, status "com_problema";
// - status closed, beneficiado respondent, sem devolução/reembolso => sem impacto.
// A presença de `related_entities: ["return"]` é o indicador oficial de uma
// devolução associada. O detalhe v2 não é necessário para essas decisões.
function classificarClaim(claim) {
  if (!claim || typeof claim !== "object") return null;

  const status = String(claim.status || "").toLowerCase();
  const type = String(claim.type || "").toLowerCase();
  const stage = String(claim.stage || "").toLowerCase();
  const reason = String(claim.resolution?.reason || "").toLowerCase();
  const hasReturn = claimHasReturn(claim);

  if (REFUND_RESOLUTIONS.has(reason)) {
    return { status: "cancelado", tipo: "devolucao", motivo: reason };
  }

  if (status === "opened" && (hasReturn || type === "mediations" || stage === "dispute")) {
    return {
      status: "com_problema",
      tipo: hasReturn ? "devolucao" : "mediacao",
      motivo: hasReturn ? "devolucao_em_andamento" : "mediacao_em_aberto",
    };
  }

  if (status === "closed") {
    if (RETURN_WITHOUT_LOSS_RESOLUTIONS.has(reason)) return null;
    if (hasReturn) {
      return { status: "cancelado", tipo: "devolucao", motivo: reason || "devolucao_finalizada" };
    }
    if (resolutionBenefited(claim, "respondent")) return null;
  }

  return null;
}

function classificarClaimsDoPedido(claims) {
  const lista = Array.isArray(claims) ? claims : claims ? [claims] : [];
  if (!lista.length) return null;

  const classificadas = lista
    .map((claim) => ({ claim, classificacao: classificarClaim(claim) }))
    .filter((entry) => entry.classificacao);
  if (!classificadas.length) return null;

  const escolhida =
    classificadas.find((entry) => entry.classificacao.status === "cancelado") || classificadas[0];

  return {
    ...escolhida.classificacao,
    claimId: escolhida.claim.id != null ? String(escolhida.claim.id) : null,
    claimIds: lista.map((claim) => claim?.id).filter((id) => id != null).map(String),
  };
}

function buildClaimsMap(claims) {
  const claimsMap = new Map();
  for (const claim of claims || []) {
    // `resource_id` só é id de pedido quando resource=order. Não usamos
    // order_id, pack_id nem posição no array como atalhos de cruzamento.
    if (String(claim?.resource || "").toLowerCase() !== "order") continue;
    if (claim.resource_id === null || claim.resource_id === undefined) continue;
    const orderId = String(claim.resource_id);
    if (!claimsMap.has(orderId)) claimsMap.set(orderId, []);
    claimsMap.get(orderId).push(claim);
  }
  return claimsMap;
}

function createCentralVendasClaimsService({ mlFetchFn = mlFetch, sleepFn = sleep } = {}) {
  async function fetchPage(clienteId, path, maxAttempts) {
    let lastReason = "erro_fetch";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await mlFetchFn(clienteId, path);
        if (response?.ok) return { ok: true, data: response.data, attempts: attempt };

        lastReason = `http_${response?.status || "desconhecido"}`;
        if (RETRYABLE_STATUS.has(response?.status) && attempt < maxAttempts) {
          await sleepFn(backoffDelayMs(attempt, response?.retryAfter));
          continue;
        }
        return { ok: false, motivo: lastReason, attempts: attempt };
      } catch (_) {
        lastReason = "erro_fetch";
        if (attempt < maxAttempts) {
          await sleepFn(backoffDelayMs(attempt, null));
          continue;
        }
      }
    }

    return { ok: false, motivo: lastReason, attempts: maxAttempts };
  }

  async function buscarClaimsPorPeriodo({
    clienteId,
    sellerId,
    dateFrom,
    dateTo,
    limit = CLAIMS_PAGE_LIMIT,
    maxAttempts = CLAIMS_MAX_ATTEMPTS,
  }) {
    const pageLimit = Math.min(CLAIMS_PAGE_LIMIT, Math.max(1, Number(limit) || CLAIMS_PAGE_LIMIT));
    const claims = [];
    let offset = 0;
    let attempts = 0;
    let pages = 0;
    let apiTotal = null;

    for (let page = 0; page < CLAIMS_MAX_PAGES; page++) {
      const qs = new URLSearchParams({
        "players.user_id": String(sellerId),
        "players.role": "respondent",
        range: buildClaimsRange(dateFrom, dateTo),
        limit: String(pageLimit),
        offset: String(offset),
        sort: "date_created:asc",
      });
      const path = `/post-purchase/v1/claims/search?${qs}`;
      const response = await fetchPage(clienteId, path, maxAttempts);
      attempts += response.attempts || 0;

      if (!response.ok) {
        // Descarta páginas parciais: mapa incompleto não pode significar que os
        // pedidos não encontrados são vendas boas.
        return {
          claimsMap: new Map(),
          claims: [],
          indisponivel: true,
          motivo: response.motivo,
          pages,
          attempts,
          totalApi: apiTotal,
        };
      }

      pages++;
      const data = Array.isArray(response.data?.data) ? response.data.data : [];
      claims.push(...data);
      apiTotal = Number.isFinite(Number(response.data?.paging?.total))
        ? Number(response.data.paging.total)
        : apiTotal;

      if (!data.length) break;
      offset += data.length;
      if (apiTotal !== null && offset >= apiTotal) break;
      if (offset > 9999) {
        return {
          claimsMap: new Map(),
          claims: [],
          indisponivel: true,
          motivo: "limite_paginacao_excedido",
          pages,
          attempts,
          totalApi: apiTotal,
        };
      }
    }

    const claimsMap = buildClaimsMap(claims);
    return {
      claimsMap,
      claims,
      indisponivel: false,
      motivo: null,
      pages,
      attempts,
      totalApi: apiTotal,
      pedidosComClaims: claimsMap.size,
    };
  }

  return { buscarClaimsPorPeriodo };
}

const defaultService = createCentralVendasClaimsService();

module.exports = {
  buscarClaimsPorPeriodo: defaultService.buscarClaimsPorPeriodo,
  createCentralVendasClaimsService,
  buildClaimsMap,
  buildClaimsRange,
  claimHasReturn,
  classificarClaim,
  classificarClaimsDoPedido,
  CLAIMS_PAGE_LIMIT,
  CLAIMS_MAX_ATTEMPTS,
};
