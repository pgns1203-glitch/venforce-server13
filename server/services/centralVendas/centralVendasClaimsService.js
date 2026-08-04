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

// Detalhe de devolução: usado apenas para claims de devolução SEM vínculo direto
// e confiável com um pedido. Teto para não transformar isso numa chamada por claim.
const CLAIMS_RETURNS_MAX_DETALHES = 300;
const CLAIMS_RETURNS_CONCURRENCY = 4;

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
function buildClaimsSearchPath({ sellerId, dateFrom, dateTo, timezoneFormat, limit, offset }) {
  const qs = new URLSearchParams({
    "players.user_id": String(sellerId),
    "players.role": "respondent",
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

function buildClaimsMap(claims) {
  const claimsMap = new Map();
  for (const claim of claims || []) {
    // `resource_id` só é id de pedido quando resource=order. Não usamos
    // order_id, pack_id nem posição no array como atalhos de cruzamento.
    // A única exceção é o claim cujo detalhe v2 de devolução devolveu o
    // `order_id` real — nesse caso o vínculo veio da API, não de suposição.
    const resolvidoPorDetalhe = claim?.returnDetalhe?.orderId || null;
    const porResource =
      String(claim?.resource || "").toLowerCase() === "order"
      && claim?.resource_id !== null
      && claim?.resource_id !== undefined
        ? String(claim.resource_id)
        : null;
    const orderId = porResource || resolvidoPorDetalhe;
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

function createCentralVendasClaimsService({ mlFetchFn = mlFetch, sleepFn = sleep } = {}) {
  async function fetchPage(clienteId, path, maxAttempts) {
    let lastReason = "erro_fetch";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await mlFetchFn(clienteId, path);
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
  async function buscarDetalheReturn({ clienteId, claimId, maxAttempts = CLAIMS_MAX_ATTEMPTS }) {
    const id = String(claimId || "").trim();
    if (!id) return { ok: false, motivo: "sem_claim_id", detalhe: null };

    let motivo = "erro_fetch";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await mlFetchFn(clienteId, `/post-purchase/v2/claims/${encodeURIComponent(id)}/returns`);
        if (response?.ok) return { ok: true, motivo: null, detalhe: extrairReturnDetalhe(response.data) };

        motivo = `http_${response?.status || "desconhecido"}`;
        if (RETRYABLE_STATUS.has(response?.status) && attempt < maxAttempts) {
          await sleepFn(backoffDelayMs(attempt, response?.retryAfter));
          continue;
        }
        return { ok: false, motivo, detalhe: null };
      } catch (_) {
        motivo = "erro_fetch";
        if (attempt < maxAttempts) {
          await sleepFn(backoffDelayMs(attempt, null));
          continue;
        }
      }
    }
    return { ok: false, motivo, detalhe: null };
  }

  // Resolve o pedido de claims de devolução que NÃO têm vínculo direto com order.
  // Não há chamada indiscriminada: só entram claims com indicação de devolução e
  // sem `resource=order`.
  async function resolverReturnsSemVinculo({ clienteId, claims, maxAttempts }) {
    const pendentes = (claims || []).filter((claim) => {
      if (String(claim?.resource || "").toLowerCase() === "order") return false;
      return claimHasReturn(claim) && claim?.id != null;
    });

    if (!pendentes.length) {
      return { tentados: 0, resolvidos: 0, naoResolvidos: 0, truncados: 0 };
    }

    const alvos = pendentes.slice(0, CLAIMS_RETURNS_MAX_DETALHES);
    const truncados = pendentes.length - alvos.length;
    const limit = pLimit(CLAIMS_RETURNS_CONCURRENCY);
    let resolvidos = 0;
    let naoResolvidos = 0;

    await Promise.all(
      alvos.map((claim) =>
        limit(async () => {
          const resultado = await buscarDetalheReturn({ clienteId, claimId: claim.id, maxAttempts });
          if (resultado.ok && resultado.detalhe && resultado.detalhe.orderId) {
            claim.returnDetalhe = resultado.detalhe;
            resolvidos++;
          } else {
            naoResolvidos++;
          }
        })
      )
    );

    console.log(
      `[centralVendas] claims returns detalhe: pendentes=${pendentes.length}`
        + ` tentados=${alvos.length} resolvidos=${resolvidos}`
        + ` naoResolvidos=${naoResolvidos + truncados}`
    );

    return { tentados: alvos.length, resolvidos, naoResolvidos: naoResolvidos + truncados, truncados };
  }

  async function buscarClaimsPorPeriodo({
    clienteId,
    sellerId,
    dateFrom,
    dateTo,
    orderIds = null,
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
    let apiTotal = null;
    let tzIndex = 0;
    let fallbackTzUsado = false;

    const falha = (motivo, extra = {}) => ({
      claimsMap: new Map(),
      claims: [],
      indisponivel: true,
      motivo,
      pages,
      attempts,
      totalApi: apiTotal,
      janela,
      timezoneFormato: CLAIMS_TIMEZONE_FORMATS[tzIndex],
      resourceCounts: {},
      returnsResolvidos: 0,
      returnsNaoResolvidos: 0,
      claimsForaDoPeriodo: 0,
      pedidosComClaims: 0,
      ...extra,
    });

    for (let page = 0; page < CLAIMS_MAX_PAGES; page++) {
      const buildPath = () => buildClaimsSearchPath({
        sellerId,
        dateFrom: janela.from,
        dateTo: janela.to,
        timezoneFormat: CLAIMS_TIMEZONE_FORMATS[tzIndex],
        limit: pageLimit,
        offset,
      });

      let response = await fetchPage(clienteId, buildPath(), maxAttempts);
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
        response = await fetchPage(clienteId, buildPath(), maxAttempts);
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
        return falha(response.motivo, { status: response.status ?? null });
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
        logClaimsIndisponivel({
          motivo: "limite_paginacao_excedido",
          status: null,
          data: null,
          page,
          sellerId,
          dateFrom: janela.from,
          dateTo: janela.to,
          limit: pageLimit,
          offset,
          timezoneFormat: CLAIMS_TIMEZONE_FORMATS[tzIndex],
        });
        return falha("limite_paginacao_excedido");
      }
    }

    const resourceCounts = contarResources(claims);
    console.log("[centralVendas] claims por resource:", resourceCounts);

    const returns = await resolverReturnsSemVinculo({ clienteId, claims, maxAttempts });

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

    console.log(
      `[centralVendas] claims: total=${claims.length} paginas=${pages}`
        + ` pedidosComClaims=${claimsMap.size} foraDoPeriodo=${claimsForaDoPeriodo}`
        + ` janela=${janela.from}..${janela.to} fuso=${CLAIMS_TIMEZONE_FORMATS[tzIndex]}`
    );

    return {
      claimsMap,
      claims,
      indisponivel: false,
      motivo: null,
      status: 200,
      pages,
      attempts,
      totalApi: apiTotal,
      janela,
      timezoneFormato: CLAIMS_TIMEZONE_FORMATS[tzIndex],
      resourceCounts,
      returnsResolvidos: returns.resolvidos,
      returnsNaoResolvidos: returns.naoResolvidos,
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
  buildClaimsRange,
  buildClaimsSearchPath,
  buildClaimsWindow,
  claimHasReturn,
  classificarClaim,
  classificarClaimsDoPedido,
  contarResources,
  extrairReturnDetalhe,
  CLAIMS_PAGE_LIMIT,
  CLAIMS_MAX_ATTEMPTS,
  CLAIMS_LOOKAHEAD_DAYS,
  CLAIMS_TIMEZONE_FORMATS,
};
