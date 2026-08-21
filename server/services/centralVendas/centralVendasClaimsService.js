// Pós-venda da Central de Vendas — Claims API do Mercado Livre.
//
// A Orders API mantém `order.status = paid` em vendas devolvidas. Por isso os
// claims são buscados uma vez por período, paginados, e cruzados em memória por
// `resource_id` (o id do pedido). Não existe chamada por pedido.
//
// Janela temporal: os PEDIDOS vêm do período do fechamento, mas o pós-venda de
// uma venda de julho pode ser aberto em agosto. A busca de claims usa a janela
// ampliada `[inicio do periodo, min(hoje, fim do periodo + CLAIMS_LOOKAHEAD_DAYS)]`
// e o resultado é filtrado pelo conjunto de pedidos do período — claim de pedido
// externo nunca entra no fechamento.
//
// Contrato observado no projeto (docs/prompt-codex-devolucoes.md, doc oficial
// "gerenciar reclamações"): `range=date_created:after:{ISO},before:{ISO}`. Não há
// evidência no projeto de que `range=last_updated:...` seja aceito, portanto o
// filtro continua sendo `date_created` + janela ampliada. Nenhum parâmetro novo
// foi inventado.
//
// Causa raiz comprovada do CLAIMS_HTTP_400 (21/08, probes reais contra a API
// com o grant/seller do run 5 — ver relatório da rodada): a API rejeita
// `players.user_id`/`players.role` com `atLeastOneFilterProvided: at least
// one filter parameter must be provided`, MESMO documentados como parâmetros
// de filtro válidos e MESMO combinados com `range`. `range` isolado também não
// conta como filtro. Filtros reconhecidos e testados com sucesso: `order_id`,
// `stage`, `site_id`. A doc confirma que a busca já é implicitamente
// escopada ao dono do token ("The search for claims will help you know which
// ones belong to the user of a valid token") — não é preciso repetir o
// vendedor via `players.*`. A correção usa `site_id=MLB` (mercado exclusivo
// do produto) só para satisfazer a exigência de "ao menos um filtro"; o
// escopo por conta continua garantido pelo token (`mlUserId` propagado a
// `mlFetch`), nunca por um parâmetro de query.
//
// RETURNS_UNRESOLVED (21/08, syncRunId 6, cliente red_fish): com o
// CLAIMS_HTTP_400 resolvido, Claims fechou 39/39 e sobrou exatamente 1
// devolução sem vínculo (`resource != order`) cujo detalhe v2 não trouxe
// `order_id`. Não havia, até então, nenhum registro de QUAL claim era esse
// nem do que a resposta do detalhe realmente trazia — só o contador agregado
// chegava ao Sync Source. `extractReturnDetalheDiagnostic` e o campo
// `returnsDiagnosticos` (propagados até
// central_vendas_sync_sources.metadata_json.unresolvedDiagnostics) existem
// para que a PRÓXIMA sincronização real explique sozinha a causa — sem
// inventar vínculo nenhum, e sem gravar payload completo, token ou dado de
// comprador. Tentativa de auditar a doc oficial do endpoint nesta rodada
// (developers.mercadolivre.com.br e global-selling.mercadolibre.com) foi
// bloqueada por 403 nas ferramentas de fetch disponíveis — o endpoint não
// foi alterado por falta de evidência (ver regra do próprio prompt).
//
// RETURNS_UNRESOLVED por claim.resource="shipment" (21/08, syncRunId 7,
// diagnóstico do claim 5553953268): o detalhe do endpoint respondeu HTTP 200
// (`status: "delivered"`, `hasResourceId: true`, `resource: null`,
// `hasOrderId: false`) — não é falha de rede nem de permissão, o claim
// original só está associado a um SHIPMENT, não a um order. A Orders API já
// fornece a relação oficial `order.shipping.id` — a mesma que o claim carrega
// em `resource_id` quando `resource="shipment"`. `buildShipmentOrderIndex`
// constrói, em memória e só com os Orders reais do período (nunca API
// extra), o índice `shipmentId -> Set<orderId>`; `resolveClaimOrderLink` usa
// esse índice para resolver o vínculo SOMENTE quando ele é unívoco (exatamente
// 1 order no shipment). Shipment compartilhado por 2+ orders (pack) fica
// `ambiguous: true` e nunca escolhe um dos dois — só o detalhe de returns
// trazendo `order_id` explícito resolve esse caso. ORDER LINK e RETURN DETAIL
// são responsabilidades separadas (o vínculo pode vir do shipment mesmo que o
// detalhe não repita `order_id`); por isso o detalhe continua sendo buscado
// mesmo após o vínculo por shipment, só para enriquecer quantidade/
// parcialidade/status_money — nunca para desfazer o vínculo já resolvido.
//
// RUN 8 (21/08, mesmo claim 5553953268): a sincronização real seguinte ao
// fix acima permaneceu com o MESMO RETURNS_UNRESOLVED (1/1). O código de
// resolveClaimOrderLink/buildShipmentOrderIndex não mudou nesta rodada —
// só observabilidade foi adicionada, porque não havia prova de qual dos 3
// cenários realmente ocorre em produção: (A) 0 matches no índice shipment->
// order, (B) 1 match que por algum motivo não foi usado, ou (C) 2+ matches
// (pack ambíguo). `returnsDiagnosticos` ganhou `claimResourceId`,
// `shipmentMatchCount`, `shipmentCandidateOrderIds` (máx. 5),
// `shipmentAmbiguous`, `resolvedOrderId`, `resolvedOrderSource` e
// `ordersWithShippingIdCount` (soma dos tamanhos dos sets do índice — prova
// se `orders` chegou com `shipping.id` populado até aqui). NENHUM vínculo
// novo foi inventado nesta rodada: a próxima sincronização real explica
// sozinha, pelo diagnóstico, qual dos 3 cenários é o real.

const { mlFetch } = require("../../utils/mlClient");

const CLAIMS_PAGE_LIMIT = 100;
const CLAIMS_MAX_PAGES = 100; // offset máximo documentado: 9.999
const CLAIMS_MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// Janela de pós-venda além do fim do período analisado. Determinística e única —
// nunca um número mágico espalhado pelos serviços.
const CLAIMS_LOOKAHEAD_DAYS = 90;

// Formato do offset de fuso no `range`. A primeira variante é a adotada pelo
// projeto (mesma da Orders API em fetchAllOrders e dos testes): `-03:00`. A
// segunda só é tentada UMA vez, e somente quando a API responde HTTP 400.
const CLAIMS_TIMEZONE_FORMATS = ["-03:00", "-0300"];

// Filtro exigido pela API além de `range` (ver causa raiz acima). O produto só
// opera Mercado Livre Brasil — nunca outro site do Mercado Livre/Libre.
const CLAIMS_SITE_ID = "MLB";

// Detalhe de devolução: usado apenas para claims de devolução SEM vínculo direto
// e confiável com um pedido. Teto para não transformar isso numa chamada por claim.
const CLAIMS_RETURNS_MAX_DETALHES = 300;
const CLAIMS_RETURNS_CONCURRENCY = 4;

// Teto do diagnóstico seguro de returns não resolvidos (whitelist de campos,
// nunca o payload completo) que sobrevive até o Sync Source. Não é o mesmo
// teto de CLAIMS_RETURNS_MAX_DETALHES: aqui só limitamos quantas ENTRADAS de
// diagnóstico persistem por run, para não crescer sem limite se muitas
// devoluções ficarem sem vínculo.
const CLAIMS_RETURNS_DIAGNOSTIC_MAX = 20;

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

function addDaysIso(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextIsoDate(isoDate) {
  return addDaysIso(isoDate, 1);
}

// Janela de consulta do pós-venda: começa no início do período da venda e vai
// até min(hoje, fim do período + CLAIMS_LOOKAHEAD_DAYS).
function buildClaimsWindow(dateFrom, dateTo, { lookaheadDays = CLAIMS_LOOKAHEAD_DAYS, hoje = new Date() } = {}) {
  const hojeIso = hoje instanceof Date ? hoje.toISOString().slice(0, 10) : String(hoje).slice(0, 10);
  const limite = addDaysIso(dateTo, Math.max(0, Number(lookaheadDays) || 0));
  const to = limite <= hojeIso ? limite : hojeIso;
  return {
    from: dateFrom,
    to: to < dateTo ? dateTo : to,
    lookaheadDays: Math.max(0, Number(lookaheadDays) || 0),
  };
}

function buildClaimsRange(dateFrom, dateTo, timezoneFormat = CLAIMS_TIMEZONE_FORMATS[0]) {
  const tz = String(timezoneFormat || CLAIMS_TIMEZONE_FORMATS[0]);
  return `date_created:after:${dateFrom}T00:00:00.000${tz},before:${nextIsoDate(dateTo)}T00:00:00.000${tz}`;
}

// Único lugar que monta a query da busca de claims — evita query string duplicada.
// Não filtra por `players.user_id`/`players.role` (ver causa raiz do
// CLAIMS_HTTP_400 no cabeçalho do arquivo): a API rejeita esses parâmetros com
// `atLeastOneFilterProvided`. O escopo por vendedor vem do token
// (`mlUserId` propagado a `mlFetch`), nunca da query string.
function buildClaimsSearchPath({ dateFrom, dateTo, timezoneFormat, limit, offset }) {
  const qs = new URLSearchParams({
    site_id: CLAIMS_SITE_ID,
    range: buildClaimsRange(dateFrom, dateTo, timezoneFormat),
    limit: String(limit),
    offset: String(offset),
  });
  return `/post-purchase/v1/claims/search?${qs}`;
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

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Lê o detalhe de GET /post-purchase/v2/claims/{claim_id}/returns.
// Só usa campos realmente presentes na resposta: nada é estimado. Quando a
// resposta não traz quantidades, `quantidadeDevolvida` fica null e o claim segue
// tratado como devolução total (comportamento atual preservado).
function extrairReturnDetalhe(data) {
  if (!data || typeof data !== "object") return null;

  const orderIdDireto = data.order_id ?? data.orderId ?? null;
  const orderIdPorResource =
    String(data.resource || "").toLowerCase() === "order" ? data.resource_id ?? null : null;
  const orderId = orderIdDireto ?? orderIdPorResource;

  const itens = Array.isArray(data.items) ? data.items : [];
  let compradas = null;
  let devolvidas = null;
  for (const item of itens) {
    const comprada = numberOrNull(item?.quantity);
    const devolvida = numberOrNull(
      item?.quantity_returned ?? item?.returned_quantity ?? item?.quantity_to_return
    );
    if (comprada !== null) compradas = (compradas || 0) + comprada;
    if (devolvida !== null) devolvidas = (devolvidas || 0) + devolvida;
  }

  const parcial =
    compradas !== null && devolvidas !== null && devolvidas > 0 && devolvidas < compradas;

  return {
    orderId: orderId === null || orderId === undefined ? null : String(orderId),
    quantidadeComprada: compradas,
    quantidadeDevolvida: devolvidas,
    statusDinheiro: data.status_money ?? data.refund_at ?? null,
    estado: data.status ?? null,
    subtipo: data.subtype ?? null,
    parcial,
  };
}

// Diagnóstico SEGURO do detalhe de GET .../claims/{id}/returns — usado só
// quando o detalhe respondeu OK mas não trouxe vínculo (orderId null), para
// entender a causa sem guardar o payload inteiro. Whitelist fixa: nenhum
// dado de comprador, endereço, nome ou token. `resource`/`status`/`subtype`
// são rótulos curtos documentados pela API (ex.: "order", "closed",
// "dispute"), nunca texto livre do usuário.
function extractReturnDetalheDiagnostic(data) {
  if (!data || typeof data !== "object") return null;
  const orderIdDireto = data.order_id ?? data.orderId ?? null;
  const resourceId = data.resource_id ?? null;
  const itens = Array.isArray(data.items) ? data.items : [];
  return {
    hasOrderId: orderIdDireto !== null && orderIdDireto !== undefined,
    resource: data.resource != null ? String(data.resource).slice(0, 40) : null,
    hasResourceId: resourceId !== null && resourceId !== undefined,
    itemsCount: itens.length,
    status: data.status != null ? String(data.status).slice(0, 40) : null,
    subtype: data.subtype != null ? String(data.subtype).slice(0, 40) : null,
  };
}

// Combinações adotadas conforme a documentação oficial:
// https://developers.mercadolivre.com.br/pt_br/gerenciar-reclamacoes
// - resolution.reason item_returned/payment_refunded/partial_refunded/reimbursed
//   (e equivalentes monetários) => perda efetivada, status "cancelado";
// - status opened com type return(s)/mediations ou stage dispute => pós-venda
//   ainda não resolvido, status "com_problema";
// - status closed, beneficiado respondent, sem devolução/reembolso => sem impacto.
// A presença de `related_entities: ["return"]` é o indicador oficial de uma
// devolução associada. O detalhe v2 só é consultado quando o claim não tem
// vínculo direto com um pedido — nunca para decidir a classificação.
//
// Devolução PARCIAL (o detalhe v2 comprovou devolvidas < compradas) não zera o
// pedido: `status` fica null, o motor mantém o status original da Orders API e o
// pedido continua no resultado, marcado como parcial e auditável.
function classificarClaim(claim) {
  if (!claim || typeof claim !== "object") return null;

  const status = String(claim.status || "").toLowerCase();
  const type = String(claim.type || "").toLowerCase();
  const stage = String(claim.stage || "").toLowerCase();
  const reason = String(claim.resolution?.reason || "").toLowerCase();
  const hasReturn = claimHasReturn(claim);
  const detalhe = claim.returnDetalhe || null;

  if (detalhe && detalhe.parcial === true) {
    return {
      status: null,
      tipo: "devolucao_parcial",
      motivo: reason || "devolucao_parcial",
      parcial: true,
      quantidadeComprada: detalhe.quantidadeComprada,
      quantidadeDevolvida: detalhe.quantidadeDevolvida,
    };
  }

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

// Normalização de id de order/shipment: só string trim, igual ao resto do
// arquivo (`String(claim.resource_id)`, `String(order.id)`). Não é o mesmo
// `normalizeId` de utils/textUtils — aquele é específico de MLB de
// item/produto (força prefixo "MLB" e descarta tudo que não é dígito), o que
// corromperia ids de order/shipment (numéricos, sem prefixo MLB).
function normalizeCrossId(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

// Índice em memória shipmentId -> Set<orderId>, construído SOMENTE com os
// Orders reais já carregados para o período (nunca banco, nunca API extra —
// a Orders API já forneceu `order.shipping.id`). Chave de cruzamento única e
// oficial: `claim.resource_id === order.shipping.id`.
function buildShipmentOrderIndex(orders) {
  const index = new Map();
  for (const order of orders || []) {
    const shipmentId = normalizeCrossId(order?.shipping?.id);
    const orderId = normalizeCrossId(order?.id);
    if (!shipmentId || !orderId) continue;
    if (!index.has(shipmentId)) index.set(shipmentId, new Set());
    index.get(shipmentId).add(orderId);
  }
  return index;
}

// Resolve o vínculo order de um claim usando SOMENTE relações oficiais das
// próprias APIs do Mercado Livre: `resource="order"` (id direto, comportamento
// já existente) ou `resource="shipment"` cruzado com `shipmentToOrderIds`
// (seção 4 do prompt). NUNCA por SKU, MLB, valor, data, posição no array ou
// `pack_id == order_id` — essas heurísticas foram explicitamente proibidas.
// Shipment com 2+ orders (pack compartilhado) nunca escolhe um: fica
// `ambiguous: true` e só o detalhe de returns com `order_id` explícito
// resolve esse caso (ver resolverReturnsSemVinculo).
function resolveClaimOrderLink(claim, shipmentToOrderIds) {
  const resource = String(claim?.resource || "").toLowerCase();
  const resourceId = normalizeCrossId(claim?.resource_id);
  if (!resourceId) return { orderId: null, source: null, ambiguous: false };

  if (resource === "order") {
    return { orderId: resourceId, source: "resource_order", ambiguous: false };
  }

  if (resource === "shipment" && shipmentToOrderIds instanceof Map) {
    const candidatos = shipmentToOrderIds.get(resourceId);
    if (candidatos && candidatos.size === 1) {
      return { orderId: [...candidatos][0], source: "shipment_resource", ambiguous: false };
    }
    if (candidatos && candidatos.size > 1) {
      return { orderId: null, source: null, ambiguous: true };
    }
  }

  return { orderId: null, source: null, ambiguous: false };
}

function buildClaimsMap(claims) {
  const claimsMap = new Map();
  for (const claim of claims || []) {
    // `resource_id` só é id de pedido quando resource=order. Não usamos
    // order_id, pack_id nem posição no array como atalhos de cruzamento.
    // As duas exceções são vínculos que vieram da própria API: o claim cujo
    // detalhe v2 de devolução devolveu o `order_id` real, e o claim
    // `resource=shipment` resolvido de forma unívoca por
    // resolverReturnsSemVinculo (claim.resolvedOrderId — ver
    // resolveClaimOrderLink/buildShipmentOrderIndex).
    const resolvidoPorDetalhe = claim?.returnDetalhe?.orderId || null;
    const porResource =
      String(claim?.resource || "").toLowerCase() === "order"
      && claim?.resource_id !== null
      && claim?.resource_id !== undefined
        ? String(claim.resource_id)
        : null;
    const orderId = porResource || claim?.resolvedOrderId || resolvidoPorDetalhe;
    if (!orderId) continue;
    if (!claimsMap.has(orderId)) claimsMap.set(orderId, []);
    claimsMap.get(orderId).push(claim);
  }
  return claimsMap;
}

// Distribuição agregada de `claim.resource` — nunca um log por claim.
function contarResources(claims) {
  const contagem = {};
  for (const claim of claims || []) {
    const chave = String(claim?.resource || "").toLowerCase() || "desconhecido";
    contagem[chave] = (contagem[chave] || 0) + 1;
  }
  return contagem;
}

// Pool simples de concorrência (mesmo padrão de centralVendasFreteService).
function pLimit(concorrencia) {
  const fila = [];
  let ativos = 0;
  const proximo = () => {
    ativos--;
    if (fila.length > 0) fila.shift()();
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      const run = () => {
        ativos++;
        Promise.resolve()
          .then(fn)
          .then((v) => { proximo(); resolve(v); })
          .catch((e) => { proximo(); reject(e); });
      };
      if (ativos < concorrencia) run();
      else fila.push(run);
    });
}

// Log seguro: só status, motivo, página, corpo de diagnóstico e a query. Nunca
// token, header de autorização ou resposta completa.
function logClaimsIndisponivel({ motivo, status, data, page, sellerId, dateFrom, dateTo, limit, offset, timezoneFormat }) {
  console.log("[centralVendas] claims indisponivel", {
    motivo,
    status: status ?? null,
    pagina: page,
    error: data?.error || null,
    message: data?.message || null,
    cause: data?.cause || null,
    query: {
      sellerId: String(sellerId),
      dateFrom,
      dateTo,
      limit,
      offset,
      timezoneFormat,
    },
  });
}

// Diagnóstico seguro do corpo de erro do Mercado Livre — sobrevive até o Sync
// Source (antes só chegava ao console.log via logClaimsIndisponivel e se
// perdia dali em diante). Apenas os três campos documentados de erro
// (error/message/cause), truncados: nunca o corpo completo, nunca headers,
// nunca token/Authorization.
function extractClaimsDiagnostic(data) {
  if (!data || typeof data !== "object") return null;
  const truncate = (value) => {
    if (value === null || value === undefined) return null;
    const str = typeof value === "string" ? value : JSON.stringify(value);
    return str.slice(0, 300);
  };
  const diagnostic = {
    mlError: truncate(data.error),
    mlMessage: truncate(data.message),
    mlCause: truncate(data.cause),
  };
  if (diagnostic.mlError === null && diagnostic.mlMessage === null && diagnostic.mlCause === null) return null;
  return diagnostic;
}

// Completude de Claims (Hardening M3, seções 5-10): mesma filosofia já
// aplicada a Orders em centralVendasSyncService.fetchAllOrders — nunca
// devolver "completo" sem prova. `paging.total` ausente em TODAS as páginas
// NUNCA vira "zero claims confirmado", mesmo com lista vazia (seção 6);
// `expectedCount` usa a maior `paging.total` já reportada entre páginas
// (estratégia conservadora, seção 8), nunca a última sobrescrevendo a
// anterior; página vazia antes do total conhecido e o teto de paginação
// (CLAIMS_MAX_PAGES/offset>9999) geram motivos tipados próprios em vez de
// mismatch genérico.
function computeClaimsCompleteness({
  receivedCount, firstReportedTotal, lastReportedTotal, maxReportedTotal,
  earlyEmptyReason, cappedBySafetyLimit,
}) {
  let complete;
  let reason = earlyEmptyReason || null;

  if (maxReportedTotal === null) {
    // API nunca informou paging.total confiável em nenhuma página — não há
    // como provar cobertura, mesmo que a lista recebida esteja vazia.
    complete = false;
    reason = reason || "CLAIMS_TOTAL_UNKNOWN";
  } else if (cappedBySafetyLimit && receivedCount < maxReportedTotal) {
    complete = false;
    reason = "CLAIMS_TRUNCATED_BY_SAFETY_LIMIT";
  } else if (receivedCount !== maxReportedTotal) {
    complete = false;
    reason = reason || "CLAIMS_COUNT_MISMATCH";
  } else {
    // Inclui total=0/received=0: zero é resultado válido quando a API
    // realmente informou o total (não quando ele está ausente).
    complete = true;
    reason = null;
  }

  return {
    expectedCount: maxReportedTotal,
    receivedCount,
    complete,
    truncated: !complete,
    reason,
    metadata: {
      firstReportedTotal,
      lastReportedTotal,
      maxReportedTotal,
      totalChanged: firstReportedTotal !== null && lastReportedTotal !== null && firstReportedTotal !== lastReportedTotal,
    },
  };
}

function createCentralVendasClaimsService({ mlFetchFn = mlFetch, sleepFn = sleep } = {}) {
  async function fetchPage(clienteId, path, maxAttempts, mlUserId) {
    let lastReason = "erro_fetch";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // mlUserId: identidade já congelada pelo sync run (M1/M2) — nunca
        // deixar o mlClient re-resolver "qualquer grant válido do cliente"
        // (ver docs/AUDITORIA_IDENTIDADE_CENTRAL_VENDAS_CLAIMS_FRETE.md).
        const response = await mlFetchFn(clienteId, path, { mlUserId });
        if (response?.ok) return { ok: true, data: response.data, status: response.status ?? 200, attempts: attempt };

        lastReason = `http_${response?.status || "desconhecido"}`;
        if (RETRYABLE_STATUS.has(response?.status) && attempt < maxAttempts) {
          await sleepFn(backoffDelayMs(attempt, response?.retryAfter));
          continue;
        }
        // O corpo devolvido pelo ML é preservado: sem ele não há como saber qual
        // parâmetro foi rejeitado.
        return {
          ok: false,
          motivo: lastReason,
          status: response?.status ?? null,
          data: response?.data ?? null,
          attempts: attempt,
        };
      } catch (_) {
        lastReason = "erro_fetch";
        if (attempt < maxAttempts) {
          await sleepFn(backoffDelayMs(attempt, null));
          continue;
        }
      }
    }

    return { ok: false, motivo: lastReason, status: null, data: null, attempts: maxAttempts };
  }

  // GET /post-purchase/v2/claims/{claim_id}/returns — retry apenas para 429/5xx.
  // Falha aqui NUNCA vira "pedido sem devolução": o claim fica sem vínculo e é
  // contado em `returnsNaoResolvidos`.
  async function buscarDetalheReturn({ clienteId, claimId, mlUserId, maxAttempts = CLAIMS_MAX_ATTEMPTS }) {
    const id = String(claimId || "").trim();
    if (!id) return { ok: false, motivo: "sem_claim_id", status: null, detalhe: null, diagnostic: null };

    let motivo = "erro_fetch";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await mlFetchFn(clienteId, `/post-purchase/v2/claims/${encodeURIComponent(id)}/returns`, { mlUserId });
        if (response?.ok) {
          return {
            ok: true,
            motivo: null,
            status: response.status ?? 200,
            detalhe: extrairReturnDetalhe(response.data),
            // Diagnóstico estrutural: sobrevive mesmo quando a resposta é OK
            // mas não trouxe orderId — é exatamente o caso que precisa de
            // explicação (ver extractReturnDetalheDiagnostic acima).
            diagnostic: extractReturnDetalheDiagnostic(response.data),
          };
        }

        motivo = `http_${response?.status || "desconhecido"}`;
        // Corpo de erro do ML: mesmos 3 campos documentados (error/message/
        // cause) já usados em extractClaimsDiagnostic para a busca — nunca o
        // corpo completo.
        const diagnosticoErro = extractClaimsDiagnostic(response?.data);
        if (RETRYABLE_STATUS.has(response?.status) && attempt < maxAttempts) {
          await sleepFn(backoffDelayMs(attempt, response?.retryAfter));
          continue;
        }
        return { ok: false, motivo, status: response?.status ?? null, detalhe: null, diagnostic: diagnosticoErro };
      } catch (_) {
        motivo = "erro_fetch";
        if (attempt < maxAttempts) {
          await sleepFn(backoffDelayMs(attempt, null));
          continue;
        }
      }
    }
    return { ok: false, motivo, status: null, detalhe: null, diagnostic: null };
  }

  // Resolve o pedido de claims de devolução que NÃO têm vínculo direto com order.
  // Não há chamada indiscriminada: só entram claims com indicação de devolução e
  // sem `resource=order`.
  async function resolverReturnsSemVinculo({ clienteId, claims, mlUserId, maxAttempts, shipmentToOrderIds }) {
    const pendentes = (claims || []).filter((claim) => {
      if (String(claim?.resource || "").toLowerCase() === "order") return false;
      return claimHasReturn(claim) && claim?.id != null;
    });

    if (!pendentes.length) {
      return { tentados: 0, resolvidos: 0, naoResolvidos: 0, truncados: 0, pendentesTotal: 0, diagnosticos: [] };
    }

    // Diagnóstico de chegada de `orders` (RUN 8): a soma dos tamanhos dos
    // sets do índice shipment->orders é o número de orders do período que
    // tinham `shipping.id` válido e entraram no índice. Se isso vier 0 com
    // orders reais existindo, o problema é `orders` não chegar até aqui —
    // não o cruzamento em si. Persistido 1x por run no diagnóstico (nunca
    // um valor por claim, o índice é o mesmo para todos).
    let ordersWithShippingIdCount = 0;
    if (shipmentToOrderIds instanceof Map) {
      for (const candidatos of shipmentToOrderIds.values()) ordersWithShippingIdCount += candidatos.size;
    }

    // ORDER LINK primeiro (independente do detalhe — seção 5 do prompt):
    // `resource="shipment"` cruzado em memória com os Orders do período. Roda
    // para TODOS os pendentes, mesmo os que vão ficar de fora do teto de
    // detalhe abaixo — é lookup em memória (nenhuma chamada de API), então não
    // faz sentido deixar de tentar. Nunca escolhe entre 2+ orders do mesmo
    // shipment (pack): esse caso fica `ambiguous` e cai no fluxo de detalhe.
    for (const claim of pendentes) {
      const link = resolveClaimOrderLink(claim, shipmentToOrderIds);
      if (link.orderId) {
        claim.resolvedOrderId = link.orderId;
        claim.resolvedOrderSource = link.source;
      }
    }

    const alvos = pendentes.slice(0, CLAIMS_RETURNS_MAX_DETALHES);
    const truncados = pendentes.length - alvos.length;
    const limit = pLimit(CLAIMS_RETURNS_CONCURRENCY);
    // Diagnóstico seguro (whitelist fixa) de cada devolução que ficou sem
    // vínculo — teto CLAIMS_RETURNS_DIAGNOSTIC_MAX, nunca o payload inteiro.
    // Objetivo: a próxima sincronização real explica SOZINHA a causa do
    // RETURNS_UNRESOLVED, sem precisar reproduzir o caso manualmente.
    const diagnosticos = [];

    await Promise.all(
      alvos.map((claim) =>
        limit(async () => {
          const resultado = await buscarDetalheReturn({ clienteId, claimId: claim.id, mlUserId, maxAttempts });

          if (resultado.ok && resultado.detalhe) {
            // RETURN DETAIL fica sempre disponível para enriquecer quantidade/
            // parcialidade/status_money — mesmo quando não traz `order_id` e o
            // vínculo já veio do shipment (seção 5: são responsabilidades
            // separadas). Só usa o `order_id` do detalhe para o ORDER LINK
            // quando o shipment não resolveu (0 orders ou pack ambíguo).
            claim.returnDetalhe = resultado.detalhe;
            if (claim.resolvedOrderId == null && resultado.detalhe.orderId) {
              claim.resolvedOrderId = resultado.detalhe.orderId;
              claim.resolvedOrderSource = "return_detail";
            }
          }

          if (claim.resolvedOrderId == null && diagnosticos.length < CLAIMS_RETURNS_DIAGNOSTIC_MAX) {
            // Resultado REAL de resolveClaimOrderLink/buildShipmentOrderIndex
            // para este claim (RUN 8 — micro-investigação cirúrgica): permite
            // distinguir, sem reproduzir o caso manualmente, se foi (A) 0
            // matches, (B) 1 match que por algum motivo não foi usado — nunca
            // deveria acontecer, já que resolveClaimOrderLink usa o match
            // único direto, mas o diagnóstico prova isso em vez de assumir —
            // ou (C) 2+ matches (pack ambíguo).
            const claimResource = String(claim?.resource || "").toLowerCase();
            const claimResourceId = normalizeCrossId(claim?.resource_id);
            const candidatosShipment =
              claimResource === "shipment" && shipmentToOrderIds instanceof Map && claimResourceId
                ? shipmentToOrderIds.get(claimResourceId) || null
                : null;
            diagnosticos.push({
              claimId: claim.id != null ? String(claim.id) : null,
              // Estrutura do claim já trazida pela busca por período —
              // responde à seção 4 do prompt (resource/resource_id do
              // PRÓPRIO claim já bastariam?) sem inventar vínculo.
              claimResource: claim?.resource != null ? String(claim.resource).slice(0, 40) : null,
              // ID técnico do shipment/order do PRÓPRIO claim (resource_id) —
              // nunca token, nunca dado de comprador. Necessário para provar
              // qual chave foi usada no cruzamento com o índice.
              claimResourceId,
              claimHasResourceId: claim?.resource_id !== null && claim?.resource_id !== undefined,
              claimHasOrderIdField: claim?.order_id !== null && claim?.order_id !== undefined,
              shipmentMatchCount: candidatosShipment ? candidatosShipment.size : 0,
              shipmentCandidateOrderIds: candidatosShipment ? [...candidatosShipment].slice(0, 5) : [],
              shipmentAmbiguous: candidatosShipment ? candidatosShipment.size > 1 : false,
              resolvedOrderId: claim.resolvedOrderId ?? null,
              resolvedOrderSource: claim.resolvedOrderSource ?? null,
              ordersWithShippingIdCount,
              httpStatus: resultado.status ?? null,
              motivo: resultado.motivo ?? null,
              ...(resultado.diagnostic ? { detalhe: resultado.diagnostic } : {}),
            });
          }
        })
      )
    );

    // Contagem final a partir do estado real de cada claim (não do resultado
    // da chamada isolada): um claim truncado pelo teto de detalhe, mas
    // resolvido pelo shipment no laço acima, é resolvido de verdade — nunca
    // API extra, e o vínculo já existia em memória (seção 6/10 do prompt).
    let resolvidos = 0;
    let naoResolvidos = 0;
    for (const claim of pendentes) {
      if (claim.resolvedOrderId != null) resolvidos++;
      else naoResolvidos++;
    }

    console.log(
      `[centralVendas] claims returns detalhe: pendentes=${pendentes.length}`
        + ` tentados=${alvos.length} resolvidos=${resolvidos}`
        + ` naoResolvidos=${naoResolvidos}`
    );

    return {
      tentados: alvos.length,
      resolvidos,
      naoResolvidos,
      truncados,
      // Universo esperado real de Returns (seção 29/30 da spec M3): todos os
      // claims de devolução que precisavam de detalhe, não apenas os que
      // couberam no teto CLAIMS_RETURNS_MAX_DETALHES.
      pendentesTotal: pendentes.length,
      diagnosticos,
    };
  }

  async function buscarClaimsPorPeriodo({
    clienteId,
    sellerId,
    dateFrom,
    dateTo,
    orderIds = null,
    // Orders reais do período (mesmos objetos já carregados pelo sync, com
    // `.id`/`.shipping.id`) — usados SOMENTE para montar o índice em memória
    // shipmentId->orderIds (buildShipmentOrderIndex). Nenhuma chamada de API
    // adicional é feita a partir daqui.
    orders = null,
    limit = CLAIMS_PAGE_LIMIT,
    maxAttempts = CLAIMS_MAX_ATTEMPTS,
    lookaheadDays = CLAIMS_LOOKAHEAD_DAYS,
    hoje = new Date(),
  }) {
    const pageLimit = Math.min(CLAIMS_PAGE_LIMIT, Math.max(1, Number(limit) || CLAIMS_PAGE_LIMIT));
    const janela = buildClaimsWindow(dateFrom, dateTo, { lookaheadDays, hoje });
    const claims = [];
    let offset = 0;
    let attempts = 0;
    let pages = 0;
    let firstReportedTotal = null;
    let lastReportedTotal = null;
    let maxReportedTotal = null;
    let earlyEmptyReason = null;
    let cappedBySafetyLimit = false;
    let tzIndex = 0;
    let fallbackTzUsado = false;

    const falha = (motivo, extra = {}) => ({
      claimsMap: new Map(),
      claims: [],
      indisponivel: true,
      motivo,
      pages,
      attempts,
      totalApi: maxReportedTotal,
      completeness: null,
      janela,
      timezoneFormato: CLAIMS_TIMEZONE_FORMATS[tzIndex],
      resourceCounts: {},
      returnsResolvidos: 0,
      returnsNaoResolvidos: 0,
      returnsPendentesTotal: 0,
      returnsDiagnosticos: [],
      claimsForaDoPeriodo: 0,
      pedidosComClaims: 0,
      diagnostic: null,
      ...extra,
    });

    for (let page = 0; page < CLAIMS_MAX_PAGES; page++) {
      const buildPath = () => buildClaimsSearchPath({
        dateFrom: janela.from,
        dateTo: janela.to,
        timezoneFormat: CLAIMS_TIMEZONE_FORMATS[tzIndex],
        limit: pageLimit,
        offset,
      });

      let response = await fetchPage(clienteId, buildPath(), maxAttempts, sellerId);
      attempts += response.attempts || 0;

      // HTTP 400 = parâmetro/formato rejeitado. Testa a segunda variante de fuso
      // UMA única vez em toda a sincronização; se ela funcionar, todas as páginas
      // seguintes já usam essa variante.
      if (
        !response.ok
        && response.status === 400
        && !fallbackTzUsado
        && tzIndex + 1 < CLAIMS_TIMEZONE_FORMATS.length
      ) {
        logClaimsIndisponivel({
          motivo: response.motivo,
          status: response.status,
          data: response.data,
          page,
          sellerId,
          dateFrom: janela.from,
          dateTo: janela.to,
          limit: pageLimit,
          offset,
          timezoneFormat: CLAIMS_TIMEZONE_FORMATS[tzIndex],
        });
        fallbackTzUsado = true;
        tzIndex += 1;
        console.log(
          `[centralVendas] claims: testando variante de fuso "${CLAIMS_TIMEZONE_FORMATS[tzIndex]}"`
            + ` apos http_400 na variante "${CLAIMS_TIMEZONE_FORMATS[tzIndex - 1]}"`
        );
        response = await fetchPage(clienteId, buildPath(), maxAttempts, sellerId);
        attempts += response.attempts || 0;
      }

      if (!response.ok) {
        // Descarta páginas parciais: mapa incompleto não pode significar que os
        // pedidos não encontrados são vendas boas. Erro nunca vira lista vazia
        // "confiável" — `indisponivel: true` mantém a confiança parcial.
        logClaimsIndisponivel({
          motivo: response.motivo,
          status: response.status,
          data: response.data,
          page,
          sellerId,
          dateFrom: janela.from,
          dateTo: janela.to,
          limit: pageLimit,
          offset,
          timezoneFormat: CLAIMS_TIMEZONE_FORMATS[tzIndex],
        });
        if (response.status === 401 || response.status === 403) {
          console.log(
            "[centralVendas] claims sem permissao: a aplicacao pode nao ter o topico"
              + " Post Purchase/Claims habilitado no painel do Mercado Livre."
          );
        }
        return falha(response.motivo, {
          status: response.status ?? null,
          diagnostic: extractClaimsDiagnostic(response.data),
        });
      }

      pages++;
      const data = Array.isArray(response.data?.data) ? response.data.data : [];
      claims.push(...data);

      // Estratégia conservadora (Hardening M3, seção 8): usa o MAIOR total já
      // reportado, nunca sobrescreve com o último visto — se a API variar o
      // total entre páginas, isso fica registrado em metadata.totalChanged,
      // nunca escondido atrás de "100 == 100" por coincidência de arredondar
      // no último valor.
      const totalPagina = Number.isFinite(Number(response.data?.paging?.total))
        ? Number(response.data.paging.total)
        : null;
      if (totalPagina !== null) {
        if (firstReportedTotal === null) firstReportedTotal = totalPagina;
        lastReportedTotal = totalPagina;
        maxReportedTotal = maxReportedTotal === null ? totalPagina : Math.max(maxReportedTotal, totalPagina);
      }

      if (!data.length) {
        // Página vazia antes do total conhecido (seção 9): nunca considerar
        // completo só porque a API parou de mandar resultado.
        if (maxReportedTotal !== null && claims.length < maxReportedTotal) {
          earlyEmptyReason = "CLAIMS_EARLY_EMPTY_PAGE";
        }
        break;
      }

      offset += data.length;
      if (maxReportedTotal !== null && offset >= maxReportedTotal) break;

      // Teto de paginação (seção 10): antes isto retornava `indisponivel:true`
      // genérico (limite_paginacao_excedido), escondendo uma causa que agora
      // conseguimos provar. Em vez de abortar a coleta inteira, encerra o
      // loop com os claims já coletados — a comparação final contra
      // maxReportedTotal marca a fonte como incompleta/truncada
      // (CLAIMS_TRUNCATED_BY_SAFETY_LIMIT), no mesmo espírito de Orders.
      if (offset > 9999 || page === CLAIMS_MAX_PAGES - 1) {
        cappedBySafetyLimit = true;
        console.log(
          `[centralVendas] claims: teto de paginacao atingido (offset=${offset}, paginas=${pages})`
            + ` maxReportedTotal=${maxReportedTotal ?? "n/d"} claimsColetados=${claims.length}`
        );
        break;
      }
    }

    const resourceCounts = contarResources(claims);
    console.log("[centralVendas] claims por resource:", resourceCounts);

    const shipmentToOrderIds = buildShipmentOrderIndex(orders);
    const returns = await resolverReturnsSemVinculo({
      clienteId, claims, mlUserId: sellerId, maxAttempts, shipmentToOrderIds,
    });

    const claimsMapCompleto = buildClaimsMap(claims);

    // Só permanecem claims de pedidos do período analisado. A janela de busca é
    // maior para capturar o pós-venda posterior, nunca para trazer pedidos novos.
    const filtro = orderIds instanceof Set ? orderIds : Array.isArray(orderIds) ? new Set(orderIds.map(String)) : null;
    let claimsForaDoPeriodo = 0;
    let claimsMap = claimsMapCompleto;
    if (filtro && filtro.size) {
      claimsMap = new Map();
      for (const [orderId, lista] of claimsMapCompleto) {
        if (filtro.has(String(orderId))) claimsMap.set(orderId, lista);
        else claimsForaDoPeriodo += lista.length;
      }
    }

    const completeness = computeClaimsCompleteness({
      receivedCount: claims.length,
      firstReportedTotal,
      lastReportedTotal,
      maxReportedTotal,
      earlyEmptyReason,
      cappedBySafetyLimit,
    });

    console.log(
      `[centralVendas] claims: total=${claims.length} paginas=${pages}`
        + ` pedidosComClaims=${claimsMap.size} foraDoPeriodo=${claimsForaDoPeriodo}`
        + ` janela=${janela.from}..${janela.to} fuso=${CLAIMS_TIMEZONE_FORMATS[tzIndex]}`
        + ` completude=${completeness.complete ? "complete" : `incomplete(${completeness.reason})`}`
    );

    return {
      claimsMap,
      claims,
      indisponivel: false,
      motivo: null,
      status: 200,
      pages,
      attempts,
      // totalApi preservado por compatibilidade (Hardening M3 renomeia o
      // conceito para completeness.expectedCount, que usa maxReportedTotal
      // em vez do último valor sobrescrito — ver seção 8).
      totalApi: maxReportedTotal,
      completeness,
      janela,
      timezoneFormato: CLAIMS_TIMEZONE_FORMATS[tzIndex],
      resourceCounts,
      returnsResolvidos: returns.resolvidos,
      returnsNaoResolvidos: returns.naoResolvidos,
      returnsPendentesTotal: returns.pendentesTotal,
      returnsDiagnosticos: returns.diagnosticos,
      claimsForaDoPeriodo,
      pedidosComClaims: claimsMap.size,
    };
  }

  return { buscarClaimsPorPeriodo, buscarDetalheReturn };
}

const defaultService = createCentralVendasClaimsService();

module.exports = {
  buscarClaimsPorPeriodo: defaultService.buscarClaimsPorPeriodo,
  buscarDetalheReturn: defaultService.buscarDetalheReturn,
  createCentralVendasClaimsService,
  buildClaimsMap,
  buildShipmentOrderIndex,
  resolveClaimOrderLink,
  buildClaimsRange,
  buildClaimsSearchPath,
  buildClaimsWindow,
  claimHasReturn,
  classificarClaim,
  classificarClaimsDoPedido,
  contarResources,
  extrairReturnDetalhe,
  extractReturnDetalheDiagnostic,
  extractClaimsDiagnostic,
  computeClaimsCompleteness,
  CLAIMS_PAGE_LIMIT,
  CLAIMS_MAX_ATTEMPTS,
  CLAIMS_MAX_PAGES,
  CLAIMS_LOOKAHEAD_DAYS,
  CLAIMS_TIMEZONE_FORMATS,
  CLAIMS_SITE_ID,
  CLAIMS_RETURNS_MAX_DETALHES,
  CLAIMS_RETURNS_DIAGNOSTIC_MAX,
};
