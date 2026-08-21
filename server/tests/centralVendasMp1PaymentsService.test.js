// server/tests/centralVendasMp1PaymentsService.test.js
//
// MP1 — Ingestão canônica de Mercado Pago Payments + charges_details.
// Cobre a extração de payment IDs (order.payments[].id, nunca [0], dedupe
// preservando o vínculo paymentId->orderIds), a normalização honesta
// (null=ausente, 0=zero real, nunca Number(x)||0) e a coleta em lote com
// concorrência limitada, retry seguro e completude expected/received.
//
// Ver docs/mercado_pago/HANDOFF_MERCADO_PAGO_LIQUIDACAO_REAL_COMPLETO.md —
// evidência primária, incluindo o payment_id real 174959925172 usado no
// teste de fixture (caso 19 do spec MP1).

const assert = require("assert");
const {
  extractPaymentIds,
  normalizePayment,
  normalizeCharge,
  createCentralVendasMpPaymentsService,
} = require("../services/centralVendas/centralVendasMpPaymentsService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

const semEspera = async () => {};

function order(id, paymentIds, extra = {}) {
  return {
    id,
    payments: (paymentIds || []).map((pid) => ({ id: pid, order_id: id })),
    ...extra,
  };
}

async function run() {
  // ── extractPaymentIds ──────────────────────────────────────────────────

  // 1. Order com 1 Payment.
  {
    const r = extractPaymentIds([order("O1", ["P1"])]);
    eq("1: 1 payment unico", r.paymentIdsUnique, ["P1"]);
    eq("1: vinculo paymentId->orderIds", r.paymentIdToOrderIds.get("P1"), ["O1"]);
    eq("1: ordersWithPaymentId", r.ordersWithPaymentId, 1);
    eq("1: ordersWithoutPaymentId", r.ordersWithoutPaymentId, 0);
  }

  // 2. Order com 2 Payments — ambos extraidos (nunca payments[0]).
  {
    const r = extractPaymentIds([order("O2", ["P1", "P2"])]);
    eq("2: 2 payments unicos", r.paymentIdsUnique.sort(), ["P1", "P2"]);
    eq("2: P1 vinculado a O2", r.paymentIdToOrderIds.get("P1"), ["O2"]);
    eq("2: P2 vinculado a O2", r.paymentIdToOrderIds.get("P2"), ["O2"]);
  }

  // 3. Dois Orders referenciando o MESMO paymentId — dedupe, sem inventar
  // vinculo por qualquer outro criterio.
  {
    const r = extractPaymentIds([order("O3", ["PX"]), order("O4", ["PX"])]);
    eq("3: PX aparece uma unica vez no universo", r.paymentIdsUnique, ["PX"]);
    eq("3: PX vinculado aos dois orders", r.paymentIdToOrderIds.get("PX").sort(), ["O3", "O4"]);
    eq("3: paymentIdsRaw conta as 2 referencias", r.paymentIdsRaw, 2);
    eq("3: duplicatePaymentRefs=1", r.duplicatePaymentRefs, 1);
  }

  // Order sem payment_id — nunca inventa payment_id, fica registrado em
  // metadata (seção 10 do spec).
  {
    const r = extractPaymentIds([order("O5", []), order("O6", null)]);
    eq("order sem payment_id: ordersWithoutPaymentId=2", r.ordersWithoutPaymentId, 2);
    eq("order sem payment_id: amostra inclui os ids", r.ordersWithoutPaymentIdSample.sort(), ["O5", "O6"]);
    eq("order sem payment_id: nenhum payment inventado", r.paymentIdsUnique, []);
  }

  // 15. 0 Orders -> universo de payment IDs vazio (0/0 valido).
  {
    const r = extractPaymentIds([]);
    eq("15: 0 orders -> 0 payment ids", r.paymentIdsUnique.length, 0);
  }

  // ── normalizePayment / normalizeCharge ─────────────────────────────────

  // 4. Payment 200 com transaction_amount/net_received_amount/money_release_status.
  {
    const p = normalizePayment({
      status: "approved",
      status_detail: "accredited",
      transaction_amount: 34.90,
      transaction_amount_refunded: 0,
      transaction_details: { net_received_amount: 22.41, total_paid_amount: 34.90 },
      shipping_amount: 0,
      money_release_date: "2026-09-18T12:36:32.000-04:00",
      money_release_status: "pending",
      currency_id: "BRL",
    });
    eq("4: status", p.status, "approved");
    eq("4: statusDetail", p.statusDetail, "accredited");
    eq("4: transactionAmount", p.transactionAmount, 34.90);
    eq("4: netReceivedAmount", p.netReceivedAmount, 22.41);
    eq("4: moneyReleaseStatus", p.moneyReleaseStatus, "pending");
    eq("4: moneyReleaseDate preservada", p.moneyReleaseDate, "2026-09-18T12:36:32.000-04:00");
  }

  // 5. charges_details com shipping/financing/processing/ml_sale_fee.
  {
    const p = normalizePayment({
      transaction_amount: 34.90,
      charges_details: [
        { amounts: { original: 7.95, refunded: 0 }, metadata: { shipment_id: 47824942815, source: "deferred-charges", source_detail: "shipping-account-movements" }, name: "shp_cross_docking", type: "shipping" },
        { amounts: { original: 0.04, refunded: 0 }, accounts: { from: "collector", to: "mp" }, name: "mp_financing_1x_fee", type: "fee" },
        { amounts: { original: 0.96, refunded: 0 }, accounts: { from: "collector", to: "mp" }, name: "mp_processing_fee", type: "fee" },
        { amounts: { original: 3.54, refunded: 0 }, accounts: { from: "collector", to: "ml" }, name: "ml_sale_fee", type: "fee" },
      ],
    });
    eq("5: 4 charges normalizadas", p.charges.length, 4);
    eq("5: shipping metadata.shipmentId", p.charges[0].metadataShipmentId, "47824942815");
    eq("5: financing amountOriginal", p.charges[1].amountOriginal, 0.04);
    eq("5: processing name", p.charges[2].name, "mp_processing_fee");
    eq("5: ml_sale_fee accountTo", p.charges[3].accountTo, "ml");
  }

  // 6. amounts.original = 0 -> preservado como zero real.
  {
    const c = normalizeCharge({ amounts: { original: 0, refunded: 0 }, name: "zero_fee", type: "fee" });
    eq("6: amountOriginal=0 (zero real)", c.amountOriginal, 0);
    ok("6: nao e null", c.amountOriginal !== null);
  }

  // 7. Campo ausente -> preserva null (nunca Number(x)||0).
  {
    const p = normalizePayment({ transaction_amount: 34.90 });
    eq("7: netReceivedAmount ausente -> null", p.netReceivedAmount, null);
    eq("7: moneyReleaseStatus ausente -> null", p.moneyReleaseStatus, null);
    eq("7: moneyReleaseDate ausente -> null", p.moneyReleaseDate, null);
    eq("7: refundCount ausente -> null (refunds nao veio no payload)", p.refundCount, null);
  }

  // 8. transaction_amount_refunded = 0 -> zero real.
  {
    const p = normalizePayment({ transaction_amount: 34.90, transaction_amount_refunded: 0 });
    eq("8: transactionAmountRefunded=0", p.transactionAmountRefunded, 0);
  }

  // 9. refunds: [] presente (vazio) -> refundCount=0 REAL, distinto de ausente.
  {
    const p = normalizePayment({ transaction_amount: 34.90, refunds: [] });
    eq("9: refunds vazio -> refundCount=0 (nao null)", p.refundCount, 0);
    eq("9: refundIds=[]", p.refundIds, []);
  }

  // 10. Payment sem charges_details -> nao inventa charge.
  {
    const p = normalizePayment({ transaction_amount: 34.90 });
    eq("10: charges=[] (nenhuma charge inventada)", p.charges, []);
  }

  // 19. Fixture real do handoff — payment_id 174959925172.
  {
    const raw = {
      id: 174959925172,
      status: "approved",
      status_detail: "accredited",
      transaction_amount: 34.90,
      transaction_amount_refunded: 0,
      transaction_details: { net_received_amount: 22.41, total_paid_amount: 34.90 },
      shipping_amount: 0,
      money_release_date: "2026-09-18T12:36:32.000-04:00",
      money_release_status: "pending",
      refunds: [],
      charges_details: [
        { amounts: { original: 7.95, refunded: 0 }, metadata: { shipment_id: 47824942815, source: "deferred-charges", source_detail: "shipping-account-movements" }, name: "shp_cross_docking", type: "shipping" },
        { amounts: { original: 0.04, refunded: 0 }, accounts: { from: "collector", to: "mp" }, name: "mp_financing_1x_fee", type: "fee" },
        { amounts: { original: 0.96, refunded: 0 }, accounts: { from: "collector", to: "mp" }, name: "mp_processing_fee", type: "fee" },
        { amounts: { original: 3.54, refunded: 0 }, accounts: { from: "collector", to: "ml" }, name: "ml_sale_fee", type: "fee" },
      ],
    };
    const p = normalizePayment(raw);
    eq("19: transactionAmount = 34.90", p.transactionAmount, 34.90);
    eq("19: netReceivedAmount = 22.41", p.netReceivedAmount, 22.41);
    eq("19: moneyReleaseStatus = pending", p.moneyReleaseStatus, "pending");
    const somaCharges = p.charges.reduce((s, c) => s + c.amountOriginal, 0);
    eq("19: soma(charges.original) = 12.49 (evidencia deste payload real, nao regra universal)", Number(somaCharges.toFixed(2)), 12.49);
  }

  // ── coletarPaymentsMp (lote) ────────────────────────────────────────────

  await (async () => {
    const orderA = order("OA", ["PA1", "PA2"]);
    const orderB = order("OB", ["PB1"]);

    // 11. HTTP 404 em 1 Payment -> os demais continuam coletados/persistiveis.
    {
      const svc = createCentralVendasMpPaymentsService({
        sleepFn: semEspera,
        mpFetchFn: async (_c, path) => {
          if (path.includes("PA2")) return { ok: false, status: 404, data: null };
          return { ok: true, status: 200, data: { id: 1, status: "approved", transaction_amount: 10 } };
        },
      });
      const r = await svc.coletarPaymentsMp({ clienteId: 1, sellerId: "111", orders: [orderA, orderB] });
      eq("11: total=3", r.total, 3);
      eq("11: coletados=2", r.coletados, 2);
      eq("11: naoColetados=1", r.naoColetados, 1);
      const pa2 = r.resultsMap.get("PA2");
      eq("11: PA2 collected=false", pa2.collected, false);
      eq("11: PA2 httpStatus=404", pa2.httpStatus, 404);
      const pa1 = r.resultsMap.get("PA1");
      ok("11: PA1 continua coletado apesar da falha de PA2", pa1.collected === true);
    }

    // 12. HTTP 429 -> retry bounded + Retry-After respeitado.
    {
      let tentativa = 0;
      const delays = [];
      const svc = createCentralVendasMpPaymentsService({
        sleepFn: async (ms) => { delays.push(ms); },
        mpFetchFn: async () => {
          tentativa++;
          if (tentativa === 1) return { ok: false, status: 429, data: null, retryAfter: 2 };
          return { ok: true, status: 200, data: { id: 2, status: "approved", transaction_amount: 5 } };
        },
      });
      const r = await svc.buscarPayment({ clienteId: 1, sellerId: "111", paymentId: "PR" });
      eq("12: sucesso apos retry", r.collected, true);
      eq("12: 2 tentativas", r.tentativas, 2);
      eq("12: respeitou Retry-After (2s = 2000ms)", delays[0], 2000);
    }

    // Teto de tentativas: 429 exaurido nunca fica retryando indefinidamente.
    {
      let tentativa = 0;
      const svc = createCentralVendasMpPaymentsService({
        sleepFn: semEspera,
        mpFetchFn: async () => { tentativa++; return { ok: false, status: 429, data: null }; },
      });
      const r = await svc.buscarPayment({ clienteId: 1, sellerId: "111", paymentId: "PE" });
      eq("teto: nao coletado apos exaurir tentativas", r.collected, false);
      eq("teto: exatamente 3 tentativas (nunca infinito)", tentativa, 3);
      eq("teto: erro=true (retryable exaurido)", r.erro, true);
    }

    // 400/403/404 -> NAO faz retry (nao vai se resolver tentando de novo).
    {
      let tentativa = 0;
      const svc = createCentralVendasMpPaymentsService({
        sleepFn: semEspera,
        mpFetchFn: async () => { tentativa++; return { ok: false, status: 403, data: null }; },
      });
      const r = await svc.buscarPayment({ clienteId: 1, sellerId: "111", paymentId: "PF" });
      eq("403: apenas 1 tentativa (sem retry)", tentativa, 1);
      eq("403: collected=false", r.collected, false);
      eq("403: erro=false (nao e falha tecnica retryable)", r.erro, false);
    }

    // 16. 100 IDs / 99 sucesso -> incomplete (nunca 99/100 vira complete).
    {
      const orders100 = Array.from({ length: 100 }, (_, i) => order(`ORD${i}`, [`PID${i}`]));
      const svc = createCentralVendasMpPaymentsService({
        sleepFn: semEspera,
        mpFetchFn: async (_c, path) => {
          if (path.includes("PID99")) return { ok: false, status: 404, data: null };
          return { ok: true, status: 200, data: { id: 1, status: "approved", transaction_amount: 1 } };
        },
      });
      const r = await svc.coletarPaymentsMp({ clienteId: 1, sellerId: "111", orders: orders100 });
      eq("16: total=100", r.total, 100);
      eq("16: coletados=99", r.coletados, 99);
      eq("16: naoColetados=1 (fonte NUNCA pode ser complete)", r.naoColetados, 1);
    }

    // 15 (nivel coletarPaymentsMp): 0 Orders -> 0/0.
    {
      const svc = createCentralVendasMpPaymentsService({ sleepFn: semEspera, mpFetchFn: async () => { throw new Error("nao deveria chamar API"); } });
      const r = await svc.coletarPaymentsMp({ clienteId: 1, sellerId: "111", orders: [] });
      eq("15: total=0", r.total, 0);
      eq("15: coletados=0", r.coletados, 0);
      eq("15: naoColetados=0", r.naoColetados, 0);
    }

    // Erro de rede exaurido -> nao coletado, nao derruba o lote.
    {
      const svc = createCentralVendasMpPaymentsService({
        sleepFn: semEspera,
        mpFetchFn: async () => { throw new Error("timeout"); },
      });
      const r = await svc.coletarPaymentsMp({ clienteId: 1, sellerId: "111", orders: [order("OZ", ["PZ"])] });
      eq("erro de rede: naoColetados=1", r.naoColetados, 1);
      eq("erro de rede: erros=1", r.erros, 1);
    }
  })();

  console.log(`centralVendasMp1PaymentsService.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
