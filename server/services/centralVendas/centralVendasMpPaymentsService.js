// server/services/centralVendas/centralVendasMpPaymentsService.js
// MP1 — Ingestão canônica de Mercado Pago Payments + charges_details.
//
// Ver docs/mercado_pago/HANDOFF_MERCADO_PAGO_LIQUIDACAO_REAL_COMPLETO.md —
// evidência primária desta rodada (fluxo Order -> payment_id -> GET
// /v1/payments/{id} validado manualmente em API real).
//
// Este módulo NÃO chama /orders/search de novo: recebe os Orders que o sync
// atual já carregou em memória (centralVendasSyncService) e extrai
// order.payments[].id — nunca order.payments[0], um Order pode ter mais de
// um Payment.
//
// Regras de honestidade do dado (mesmas do resto da Central):
//   null = ausente · 0 = zero real · nunca Number(x) || 0.
//
// MP1 é ingestão, não conciliação: não soma charges ao ledger M6, não altera
// Resultado Parcial, margem, confiança do fechamento ou podeConcluir. Só
// coleta, normaliza e persiste (via centralVendasMpPaymentsRepository) com
// completude auditável por Sync Run.

const { mpFetch } = require("../../utils/mercadoPagoClient");
const { round2 } = require("../../utils/numberUtils");

const MP_PAYMENTS_BATCH_SIZE = 200;  // payments por lote — próximo lote só inicia após este concluir
const MP_PAYMENTS_CONCURRENCY = 6;   // requisições simultâneas dentro de um lote (mesmo teto de Frete)
const MP_PAYMENTS_MAX_RETRIES = 3;   // tentativas por payment (1 inicial + retries)

// 429/5xx são retryáveis (rate limit / instabilidade transitória). 400/401
// (já tratado via refresh dentro de mpFetch)/403/404 NÃO são retry
// automático — não vão se resolver tentando de novo.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelayMs(attempt, retryAfterSeconds) {
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 10000);
  }
  const base = 250 * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 150);
  return Math.min(base + jitter, 4000);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Pool simples de concorrência (mesmo padrão de centralVendasFreteService.pLimit).
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

// ---------------------------------------------------------------------------
// 1. Universo de payment IDs — exclusivamente order.payments[].id.
// Nunca order.payments[0]. Nunca inventa vínculo por valor/data/SKU/MLB/
// posição/buyer/shipment — o vínculo inicial vem só daqui.
// ---------------------------------------------------------------------------
function extractPaymentIds(orders) {
  const paymentIdToOrderIds = new Map();
  let ordersWithPaymentId = 0;
  let ordersWithoutPaymentId = 0;
  const ordersWithoutPaymentIdSample = [];
  let paymentIdsRaw = 0;

  for (const order of orders || []) {
    const orderId = order?.id != null ? String(order.id) : null;
    const payments = Array.isArray(order?.payments) ? order.payments : [];
    const ids = payments
      .map((p) => (p?.id != null ? String(p.id) : null))
      .filter(Boolean);

    if (ids.length) {
      ordersWithPaymentId += 1;
    } else {
      ordersWithoutPaymentId += 1;
      if (orderId && ordersWithoutPaymentIdSample.length < 10) {
        ordersWithoutPaymentIdSample.push(orderId);
      }
    }

    for (const paymentId of ids) {
      paymentIdsRaw += 1;
      if (!paymentIdToOrderIds.has(paymentId)) paymentIdToOrderIds.set(paymentId, []);
      const arr = paymentIdToOrderIds.get(paymentId);
      if (orderId && !arr.includes(orderId)) arr.push(orderId);
    }
  }

  const paymentIdsUnique = [...paymentIdToOrderIds.keys()];
  const duplicatePaymentRefs = Math.max(0, paymentIdsRaw - paymentIdsUnique.length);

  return {
    paymentIdToOrderIds,
    paymentIdsUnique,
    ordersCount: (orders || []).length,
    ordersWithPaymentId,
    ordersWithoutPaymentId,
    ordersWithoutPaymentIdSample,
    paymentIdsRaw,
    duplicatePaymentRefs,
  };
}

// ---------------------------------------------------------------------------
// 2. Normalização — null = ausente, 0 = zero real, nunca Number(x) || 0.
// ---------------------------------------------------------------------------
function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? round2(n) : null;
}

function textOrNull(value) {
  return value === null || value === undefined || value === "" ? null : String(value);
}

// Datas do Payment chegam em ISO 8601 com offset (ex.: "...-04:00") — o
// próprio Postgres/pg interpreta essa string como TIMESTAMPTZ, nenhuma
// conversão local é necessária aqui.
function dateOrNull(value) {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function normalizeCharge(raw) {
  const refundCharges = Array.isArray(raw?.refund_charges) ? raw.refund_charges : null;
  const updateCharges = Array.isArray(raw?.update_charges) ? raw.update_charges : null;
  return {
    chargeId: textOrNull(raw?.id),
    name: textOrNull(raw?.name),
    type: textOrNull(raw?.type),
    amountOriginal: numOrNull(raw?.amounts?.original),
    amountRefunded: numOrNull(raw?.amounts?.refunded),
    accountFrom: textOrNull(raw?.accounts?.from),
    accountTo: textOrNull(raw?.accounts?.to),
    metadataShipmentId: textOrNull(raw?.metadata?.shipment_id),
    metadataSource: textOrNull(raw?.metadata?.source),
    metadataSourceDetail: textOrNull(raw?.metadata?.source_detail),
    refundCharges,
    updateCharges,
  };
}

// Distingue "refunds ausente no payload" (null) de "refunds: [] presente"
// (0 real) — a mesma disciplina null vs zero aplicada a uma lista.
function normalizePayment(raw) {
  const refundsRaw = Array.isArray(raw?.refunds) ? raw.refunds : null;
  const chargesRaw = Array.isArray(raw?.charges_details) ? raw.charges_details : [];

  return {
    status: textOrNull(raw?.status),
    statusDetail: textOrNull(raw?.status_detail),
    transactionAmount: numOrNull(raw?.transaction_amount),
    transactionAmountRefunded: numOrNull(raw?.transaction_amount_refunded),
    netReceivedAmount: numOrNull(raw?.transaction_details?.net_received_amount),
    totalPaidAmount: numOrNull(raw?.transaction_details?.total_paid_amount),
    shippingAmount: numOrNull(raw?.shipping_amount),
    moneyReleaseDate: dateOrNull(raw?.money_release_date),
    moneyReleaseStatus: textOrNull(raw?.money_release_status),
    currencyId: textOrNull(raw?.currency_id),
    dateCreated: dateOrNull(raw?.date_created),
    dateApproved: dateOrNull(raw?.date_approved),
    dateLastUpdated: dateOrNull(raw?.date_last_updated),
    refundCount: refundsRaw !== null ? refundsRaw.length : null,
    refundIds: refundsRaw !== null
      ? refundsRaw.map((r) => (r?.id != null ? String(r.id) : null)).filter(Boolean)
      : null,
    charges: chargesRaw.map(normalizeCharge),
  };
}

function createCentralVendasMpPaymentsService({ mpFetchFn = mpFetch, sleepFn = sleep } = {}) {
  // Consulta 1 Payment com retry seguro. Resultado sempre no formato
  // { collected, payment, httpStatus, motivo, tentativas, erro }.
  //   collected: true SOMENTE quando GET /v1/payments/{id} respondeu 200 —
  //   401 (tratado via refresh dentro de mpFetchFn)/403/404/429-exaurido/
  //   5xx-exaurido/erro de rede NUNCA são "coleta completa".
  async function buscarPayment({ clienteId, sellerId, paymentId, maxRetries = MP_PAYMENTS_MAX_RETRIES }) {
    let motivoFalha = "erro_fetch";
    let httpStatusFalha = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // mlUserId=sellerId: a conta já foi congelada pelo sync run — nunca
        // deixar o cliente MP resolver "qualquer grant válido do cliente"
        // (isolamento entre contas ML do mesmo cliente, seção 12 do spec).
        const resp = await mpFetchFn(clienteId, `/v1/payments/${encodeURIComponent(paymentId)}`, { mlUserId: sellerId });
        const { ok, status, data, retryAfter } = resp || {};

        if (ok) {
          return {
            collected: true,
            payment: normalizePayment(data),
            httpStatus: status,
            motivo: null,
            tentativas: attempt,
            erro: false,
          };
        }

        motivoFalha = `http_${status}`;
        httpStatusFalha = status;
        if (RETRYABLE_STATUS.has(status) && attempt < maxRetries) {
          await sleepFn(backoffDelayMs(attempt, retryAfter));
          continue;
        }
        return {
          collected: false,
          payment: null,
          httpStatus: status,
          motivo: motivoFalha,
          tentativas: attempt,
          erro: RETRYABLE_STATUS.has(status),
        };
      } catch (err) {
        motivoFalha = "erro_fetch";
        if (attempt < maxRetries) {
          await sleepFn(backoffDelayMs(attempt, null));
          continue;
        }
        return {
          collected: false,
          payment: null,
          httpStatus: null,
          motivo: "erro_fetch",
          tentativas: attempt,
          erro: true,
        };
      }
    }

    return {
      collected: false,
      payment: null,
      httpStatus: httpStatusFalha,
      motivo: motivoFalha,
      tentativas: maxRetries,
      erro: true,
    };
  }

  // Busca TODOS os payment IDs únicos extraídos dos Orders já carregados, em
  // lotes sequenciais com concorrência controlada dentro de cada lote. Falha
  // de UM payment nunca derruba os demais (nem os já coletados no mesmo run).
  async function coletarPaymentsMp({
    clienteId,
    sellerId,
    orders,
    batchSize = MP_PAYMENTS_BATCH_SIZE,
    concorrencia = MP_PAYMENTS_CONCURRENCY,
    maxRetries = MP_PAYMENTS_MAX_RETRIES,
  }) {
    const extraido = extractPaymentIds(orders);
    const { paymentIdsUnique, paymentIdToOrderIds } = extraido;
    const total = paymentIdsUnique.length;

    const resultsMap = new Map(); // paymentId -> { collected, payment, httpStatus, motivo, tentativas, erro }
    const lotesArr = chunk(paymentIdsUnique, Math.max(1, batchSize));

    let processados = 0;
    let coletados = 0;
    let naoColetados = 0;
    let erros = 0;
    let tentativasExtras = 0;
    const statusCounts = {};
    const moneyReleaseStatusCounts = {};
    let chargesCount = 0;
    let paymentsWithCharges = 0;
    let paymentsWithoutCharges = 0;

    for (let i = 0; i < lotesArr.length; i++) {
      const lote = lotesArr[i];
      const limit = pLimit(concorrencia);

      await Promise.all(
        lote.map((paymentId) =>
          limit(async () => {
            const r = await buscarPayment({ clienteId, sellerId, paymentId, maxRetries });
            resultsMap.set(paymentId, r);

            processados += 1;
            if (r.collected) {
              coletados += 1;
              const st = r.payment?.status || "desconhecido";
              statusCounts[st] = (statusCounts[st] || 0) + 1;
              const mrs = r.payment?.moneyReleaseStatus || "desconhecido";
              moneyReleaseStatusCounts[mrs] = (moneyReleaseStatusCounts[mrs] || 0) + 1;
              const nCharges = Array.isArray(r.payment?.charges) ? r.payment.charges.length : 0;
              chargesCount += nCharges;
              if (nCharges > 0) paymentsWithCharges += 1;
              else paymentsWithoutCharges += 1;
            } else {
              naoColetados += 1;
            }
            if (r.erro) erros += 1;
            tentativasExtras += Math.max(0, (r.tentativas || 1) - 1);
          })
        )
      );

      console.log(`[centralVendas][mp] payments lote ${i + 1}/${lotesArr.length} concluído: ${processados}/${total}`);
    }

    console.log(
      `[centralVendas][mp] payments: total=${total} buscados=${processados}` +
        ` coletados=${coletados} naoColetados=${naoColetados} erros=${erros}` +
        ` chargesCount=${chargesCount} tentativasExtras=${tentativasExtras} lotes=${lotesArr.length}`
    );

    return {
      paymentIdToOrderIds,
      paymentIdsUnique,
      resultsMap,
      total,
      buscados: processados,
      coletados,
      naoColetados,
      erros,
      tentativasExtras,
      lotes: lotesArr.length,
      statusCounts,
      moneyReleaseStatusCounts,
      chargesCount,
      paymentsWithCharges,
      paymentsWithoutCharges,
      ordersCount: extraido.ordersCount,
      ordersWithPaymentId: extraido.ordersWithPaymentId,
      ordersWithoutPaymentId: extraido.ordersWithoutPaymentId,
      ordersWithoutPaymentIdSample: extraido.ordersWithoutPaymentIdSample,
      paymentIdsRaw: extraido.paymentIdsRaw,
      duplicatePaymentRefs: extraido.duplicatePaymentRefs,
    };
  }

  return { buscarPayment, coletarPaymentsMp, extractPaymentIds, normalizePayment, normalizeCharge };
}

const defaultService = createCentralVendasMpPaymentsService();

module.exports = {
  extractPaymentIds,
  normalizePayment,
  normalizeCharge,
  buscarPayment: defaultService.buscarPayment,
  coletarPaymentsMp: defaultService.coletarPaymentsMp,
  createCentralVendasMpPaymentsService,
  MP_PAYMENTS_BATCH_SIZE,
  MP_PAYMENTS_CONCURRENCY,
  MP_PAYMENTS_MAX_RETRIES,
};
