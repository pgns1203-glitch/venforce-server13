// server/services/sentinel/sentinelOrdersFetch.js
// Busca incremental de pedidos ML por data de ATUALIZAÇÃO
// (order.date_last_updated.from/.to), em janelas.
//
// Por que janelas: a Orders API não garante ordenação por date_last_updated, e
// uma busca que bate no teto de páginas não diz quais pedidos ficaram de fora.
// Avançar o checkpoint até o maior date_last_updated visto poderia pular
// pedidos para sempre. Então:
//   · o intervalo checkpoint → agora é fatiado em janelas de até
//     SENTINEL_WINDOW_MAX_MIN (default 360 = 6h);
//   · janela truncada é dividida ao meio e repetida, enquanto a metade tiver
//     pelo menos SENTINEL_WINDOW_MIN_MIN (default 15);
//   · se nem a menor janela couber, ela volta marcada `complete:false`
//     (SENTINEL_TRUNCATED) e NENHUMA janela posterior é buscada — o checkpoint
//     só pode avançar até o fim da última janela completa.
//
// Pedidos voltam no MESMO formato de /orders/search que buildMotorFromOrders
// (centralVendasSyncService) já consome. mlFetch é usado sem modificação, com o
// mesmo prazo por chamada da Central (comPrazoPadrao "mlMs") e mlUserId da conta
// (nunca "qualquer grant do cliente").

const { criarMlFetchSentinel } = require("./sentinelMlClient");
const { isErroTransitorioDeRede, ordersBackoffDelayMs } = require("../centralVendas/centralVendasSyncService");

// Padrão (sem escopo injetado): noRefresh + prazo da Central. O worker injeta um
// mlFetchFn com escopo por conta (orçamento/token) — ver sentinelPollingWorker.
const mlFetchSentinel = criarMlFetchSentinel();

const PAGE_LIMIT = 50;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const MIN_MS = 60 * 1000;

function lerInteiroPositivo(valor, padrao) {
  const n = Number.parseInt(valor, 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

function configFetch(env = process.env) {
  return {
    maxPages: lerInteiroPositivo(env.SENTINEL_MAX_PAGES, 20),
    windowMaxMs: lerInteiroPositivo(env.SENTINEL_WINDOW_MAX_MIN, 360) * MIN_MS,
    windowMinMs: lerInteiroPositivo(env.SENTINEL_WINDOW_MIN_MIN, 15) * MIN_MS,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mesmo formato de data da documentação da Orders API (offset explícito).
function isoMl(ms) {
  return new Date(ms).toISOString().replace("Z", "-00:00");
}

function criarErro(code, mensagem, extra = {}) {
  const err = new Error(mensagem);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

async function mlGetComRetry(clienteId, path, sellerId, { mlFetchFn, sleepFn }) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let resp;
    try {
      resp = await mlFetchFn(clienteId, path, { mlUserId: sellerId });
    } catch (err) {
      if (isErroTransitorioDeRede(err) && attempt < MAX_ATTEMPTS) {
        await sleepFn(ordersBackoffDelayMs(attempt, null));
        continue;
      }
      throw err;
    }
    if (resp?.status === 401) {
      throw criarErro("SENTINEL_TOKEN_INDISPONIVEL", "Mercado Livre respondeu 401 (Sentinel não renova token).");
    }
    if (!resp?.ok && RETRYABLE_STATUS.has(resp?.status) && attempt < MAX_ATTEMPTS) {
      await sleepFn(ordersBackoffDelayMs(attempt, resp?.retryAfter));
      continue;
    }
    return resp;
  }
  throw criarErro("SENTINEL_ML_RETRY_EXHAUSTED", "Tentativas esgotadas na API do Mercado Livre.");
}

// Uma janela [fromMs, toMs]. Completa só quando paging.total foi informado e
// coberto (mesmo contrato de completude de fetchAllOrders).
async function buscarJanela(contaCtx, fromMs, toMs, opts) {
  const { mlFetchFn = mlFetchSentinel, sleepFn = sleep, maxPages = configFetch().maxPages } = opts;
  const seen = new Map();
  let total = null;
  let offset = 0;
  let bateuTeto = false;

  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({
      seller: String(contaCtx.sellerId),
      "order.date_last_updated.from": isoMl(fromMs),
      "order.date_last_updated.to": isoMl(toMs),
      limit: String(PAGE_LIMIT),
      offset: String(offset),
    });
    const resp = await mlGetComRetry(contaCtx.clienteId, `/orders/search?${qs}`, contaCtx.sellerId, { mlFetchFn, sleepFn });
    if (!resp?.ok) {
      throw criarErro("SENTINEL_ORDERS_HTTP_ERROR", `Orders API respondeu HTTP ${resp?.status ?? "?"}.`, { mlStatus: resp?.status ?? null });
    }
    const reportado = Number(resp.data?.paging?.total);
    if (Number.isFinite(reportado)) total = total === null ? reportado : Math.max(total, reportado);

    const results = Array.isArray(resp.data?.results) ? resp.data.results : [];
    for (const order of results) {
      if (order?.id != null && !seen.has(String(order.id))) seen.set(String(order.id), order);
    }
    if (!results.length) break;
    offset += PAGE_LIMIT;
    if (total !== null && offset >= total) break;
    if (page === maxPages - 1) bateuTeto = true;
  }

  const orders = [...seen.values()];
  const complete = total !== null && !bateuTeto && orders.length >= total;
  return { fromMs, toMs, orders, complete, total };
}

// Janela com bissecção. Devolve as sub-janelas em ordem cronológica; se a
// última vier `complete:false`, nada depois dela foi buscado.
async function buscarComBisseccao(contaCtx, fromMs, toMs, opts, cfg) {
  const janela = await buscarJanela(contaCtx, fromMs, toMs, opts);
  if (janela.complete) return [janela];
  const meio = fromMs + Math.floor((toMs - fromMs) / 2);
  if (meio - fromMs < cfg.windowMinMs) return [janela];
  const esquerda = await buscarComBisseccao(contaCtx, fromMs, meio, opts, cfg);
  if (!esquerda[esquerda.length - 1].complete) return esquerda;
  const direita = await buscarComBisseccao(contaCtx, meio, toMs, opts, cfg);
  return esquerda.concat(direita);
}

// Gerador de janelas, da mais antiga para a mais nova, uma de cada vez (o
// consumidor processa a janela antes de pedir a próxima — o orçamento/checkpoint
// atuam janela a janela). Para na primeira janela que não pôde ser completada.
async function* iterarOrdersUpdatedSince(contaCtx, sinceIso, opts = {}) {
  const cfg = { ...configFetch(), ...(opts.config || {}) };
  const nowMs = opts.nowMs ?? Date.now();
  const sinceMs = Date.parse(sinceIso);
  if (!Number.isFinite(sinceMs)) throw criarErro("SENTINEL_SINCE_INVALIDO", `since inválido: ${sinceIso}`);
  const fetchOpts = { ...opts, maxPages: cfg.maxPages };

  let inicio = sinceMs;
  while (inicio < nowMs) {
    const fim = Math.min(inicio + cfg.windowMaxMs, nowMs);
    const partes = await buscarComBisseccao(contaCtx, inicio, fim, fetchOpts, cfg);
    for (const parte of partes) yield parte;
    if (!partes[partes.length - 1].complete) return;
    inicio = fim;
  }
}

// contaCtx: { clienteId, sellerId }. sinceIso: checkpoint. Devolve
// { janelas: [{ fromMs, toMs, orders, complete }] } da mais antiga para a mais
// nova, parando na primeira janela que não pôde ser completada.
async function fetchOrdersUpdatedSince(contaCtx, sinceIso, opts = {}) {
  const janelas = [];
  for await (const janela of iterarOrdersUpdatedSince(contaCtx, sinceIso, opts)) janelas.push(janela);
  return { janelas };
}

// Um pedido isolado (reprocessamento das provisórias). Mesmo objeto de pedido
// que vem em /orders/search.results[].
async function fetchOrderById(contaCtx, pedidoId, opts = {}) {
  const { mlFetchFn = mlFetchSentinel, sleepFn = sleep } = opts;
  const resp = await mlGetComRetry(
    contaCtx.clienteId, `/orders/${encodeURIComponent(String(pedidoId))}`, contaCtx.sellerId, { mlFetchFn, sleepFn }
  );
  if (!resp?.ok || !resp.data?.id) {
    throw criarErro("SENTINEL_ORDER_HTTP_ERROR", `GET /orders/${pedidoId} respondeu HTTP ${resp?.status ?? "?"}.`, { mlStatus: resp?.status ?? null });
  }
  return resp.data;
}

// Um pack (GET /packs/:id — documentacao_api_meli/gestao-packs.md). Devolve só o que o rateio
// de envio precisa: shipment e ids dos pedidos DESTE vendedor.
async function fetchPackById(contaCtx, packId, opts = {}) {
  const { mlFetchFn = mlFetchSentinel, sleepFn = sleep } = opts;
  const resp = await mlGetComRetry(
    contaCtx.clienteId, `/packs/${encodeURIComponent(String(packId))}`, contaCtx.sellerId, { mlFetchFn, sleepFn }
  );
  if (!resp?.ok || !Array.isArray(resp.data?.orders)) {
    throw criarErro("SENTINEL_PACK_HTTP_ERROR", `GET /packs/${packId} respondeu HTTP ${resp?.status ?? "?"}.`, { mlStatus: resp?.status ?? null });
  }
  return {
    packId: String(packId),
    shipmentId: resp.data.shipment?.id != null ? String(resp.data.shipment.id) : null,
    orderIds: resp.data.orders.map((o) => String(o.id)).filter((x) => x && x !== "undefined"),
  };
}

module.exports = {
  fetchPackById,
  fetchOrdersUpdatedSince,
  iterarOrdersUpdatedSince,
  fetchOrderById,
  buscarJanela,
  configFetch,
  isoMl,
  PAGE_LIMIT,
};
