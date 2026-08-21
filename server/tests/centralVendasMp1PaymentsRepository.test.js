// server/tests/centralVendasMp1PaymentsRepository.test.js
//
// MP1 — Persistência de Payments/charges (idempotência dentro do mesmo Sync
// Run, auditoria separada por run, sem duplicação de charge, sem
// token/Authorization persistido). Fake db por casamento de padrão de SQL,
// mesmo estilo de centralVendasSyncSourceService.test.js.

const assert = require("assert");
const {
  persistMpPayments,
  upsertMpPayment,
  replaceMpPaymentCharges,
} = require("../services/centralVendas/centralVendasMpPaymentsRepository");
const { normalizePayment } = require("../services/centralVendas/centralVendasMpPaymentsService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

function makeDb() {
  const payments = [];
  const charges = [];
  let nextPaymentId = 1;
  let nextChargeId = 1;

  return {
    payments, charges,
    async query(sql, params = []) {
      if (sql.includes("INSERT INTO central_vendas_mp_payments")) {
        const [
          syncRunId, clienteId, clienteContaId, externalAccountId, orderId, orderIdsJson, paymentId,
          status, statusDetail, transactionAmount, transactionAmountRefunded, netReceivedAmount,
          totalPaidAmount, shippingAmount, moneyReleaseDate, moneyReleaseStatus, currencyId,
          dateCreated, dateApproved, dateLastUpdated, refundCount, refundIdsJson,
        ] = params;

        let row = payments.find((r) => r.sync_run_id === syncRunId && r.payment_id === paymentId);
        if (!row) {
          row = { id: nextPaymentId++, sync_run_id: syncRunId, payment_id: paymentId };
          payments.push(row);
        }
        Object.assign(row, {
          cliente_id: clienteId, cliente_conta_id: clienteContaId, external_account_id: externalAccountId,
          order_id: orderId, order_ids_json: JSON.parse(orderIdsJson),
          status, status_detail: statusDetail, transaction_amount: transactionAmount,
          transaction_amount_refunded: transactionAmountRefunded, net_received_amount: netReceivedAmount,
          total_paid_amount: totalPaidAmount, shipping_amount: shippingAmount,
          money_release_date: moneyReleaseDate, money_release_status: moneyReleaseStatus,
          currency_id: currencyId, date_created: dateCreated, date_approved: dateApproved,
          date_last_updated: dateLastUpdated, refund_count: refundCount,
          refund_ids_json: JSON.parse(refundIdsJson),
        });
        return { rows: [{ id: row.id }] };
      }

      if (sql.includes("DELETE FROM central_vendas_mp_payment_charges")) {
        const [mpPaymentRowId] = params;
        for (let i = charges.length - 1; i >= 0; i--) {
          if (charges[i].mp_payment_row_id === mpPaymentRowId) charges.splice(i, 1);
        }
        return { rows: [] };
      }

      if (sql.includes("INSERT INTO central_vendas_mp_payment_charges")) {
        const [
          mpPaymentRowId, syncRunId, paymentId, chargeId, name, type,
          amountOriginal, amountRefunded, accountFrom, accountTo,
          metadataShipmentId, metadataSource, metadataSourceDetail,
          refundChargesJson, updateChargesJson,
        ] = params;
        charges.push({
          id: nextChargeId++, mp_payment_row_id: mpPaymentRowId, sync_run_id: syncRunId, payment_id: paymentId,
          charge_id: chargeId, name, type, amount_original: amountOriginal, amount_refunded: amountRefunded,
          account_from: accountFrom, account_to: accountTo, metadata_shipment_id: metadataShipmentId,
          metadata_source: metadataSource, metadata_source_detail: metadataSourceDetail,
          refund_charges_json: refundChargesJson ? JSON.parse(refundChargesJson) : null,
          update_charges_json: updateChargesJson ? JSON.parse(updateChargesJson) : null,
        });
        return { rows: [] };
      }

      throw new Error(`Fake db: SQL nao mapeado -> ${sql.slice(0, 120)}`);
    },
  };
}

function paymentsLoteFixture({ paymentId = "174959925172", orderId = "O1", collected = true, httpStatus = 200 } = {}) {
  const payment = normalizePayment({
    id: paymentId,
    status: "approved",
    status_detail: "accredited",
    transaction_amount: 34.90,
    transaction_amount_refunded: 0,
    transaction_details: { net_received_amount: 22.41, total_paid_amount: 34.90 },
    money_release_date: "2026-09-18T12:36:32.000-04:00",
    money_release_status: "pending",
    refunds: [],
    charges_details: [
      { amounts: { original: 7.95, refunded: 0 }, metadata: { shipment_id: 47824942815 }, name: "shp_cross_docking", type: "shipping" },
      { amounts: { original: 0.04, refunded: 0 }, accounts: { from: "collector", to: "mp" }, name: "mp_financing_1x_fee", type: "fee" },
      { amounts: { original: 0.96, refunded: 0 }, accounts: { from: "collector", to: "mp" }, name: "mp_processing_fee", type: "fee" },
      { amounts: { original: 3.54, refunded: 0 }, accounts: { from: "collector", to: "ml" }, name: "ml_sale_fee", type: "fee" },
    ],
  });
  const paymentIdToOrderIds = new Map([[paymentId, [orderId]]]);
  const resultsMap = new Map([[paymentId, { collected, payment: collected ? payment : null, httpStatus }]]);
  return { paymentIdsUnique: [paymentId], paymentIdToOrderIds, resultsMap };
}

async function run() {
  // Persiste 1 payment + 4 charges — fixture real do handoff.
  {
    const db = makeDb();
    const lote = paymentsLoteFixture();
    const r = await persistMpPayments({ syncRunId: 1, clienteId: 9, clienteContaId: 5, externalAccountId: "111", paymentsLote: lote }, db);
    eq("persist: 1 payment persistido", r.persistedCount, 1);
    eq("persist: nenhuma falha", r.failedToPersist, []);
    eq("persist: 1 linha em central_vendas_mp_payments", db.payments.length, 1);
    eq("persist: transactionAmount", db.payments[0].transaction_amount, 34.90);
    eq("persist: netReceivedAmount", db.payments[0].net_received_amount, 22.41);
    eq("persist: 4 charges", db.charges.length, 4);
    eq("persist: order_id", db.payments[0].order_id, "O1");
  }

  // 17/18. Idempotência dentro do MESMO sync_run_id — reprocessar nao duplica
  // payment nem charge (UPSERT + replace de charges).
  {
    const db = makeDb();
    const lote = paymentsLoteFixture();
    await persistMpPayments({ syncRunId: 1, clienteId: 9, clienteContaId: 5, externalAccountId: "111", paymentsLote: lote }, db);
    await persistMpPayments({ syncRunId: 1, clienteId: 9, clienteContaId: 5, externalAccountId: "111", paymentsLote: lote }, db);
    eq("17: reprocessar o mesmo run nao duplica payment", db.payments.length, 1);
    eq("18: reprocessar o mesmo run nao duplica charge", db.charges.length, 4);
  }

  // Runs DIFERENTES do MESMO payment_id -> linhas SEPARADAS (auditoria por
  // run — nunca sobrescreve silenciosamente uma observação histórica).
  {
    const db = makeDb();
    const loteRun1 = paymentsLoteFixture();
    await persistMpPayments({ syncRunId: 1, clienteId: 9, clienteContaId: 5, externalAccountId: "111", paymentsLote: loteRun1 }, db);

    const loteRun2 = paymentsLoteFixture();
    // simula money_release_status mudando de pending para released no run 2
    loteRun2.resultsMap.get("174959925172").payment.moneyReleaseStatus = "released";
    await persistMpPayments({ syncRunId: 2, clienteId: 9, clienteContaId: 5, externalAccountId: "111", paymentsLote: loteRun2 }, db);

    eq("auditoria por run: 2 linhas para o mesmo payment_id (run 1 e run 2)", db.payments.length, 2);
    const run1Row = db.payments.find((p) => p.sync_run_id === 1);
    const run2Row = db.payments.find((p) => p.sync_run_id === 2);
    eq("auditoria por run: run 1 preserva o estado observado naquele momento", run1Row.money_release_status, "pending");
    eq("auditoria por run: run 2 tem seu proprio estado, sem sobrescrever o run 1", run2Row.money_release_status, "released");
  }

  // Payment nao coletado (404/erro) nunca vira linha.
  {
    const db = makeDb();
    const lote = paymentsLoteFixture({ collected: false, httpStatus: 404 });
    const r = await persistMpPayments({ syncRunId: 1, clienteId: 9, clienteContaId: 5, externalAccountId: "111", paymentsLote: lote }, db);
    eq("nao coletado: 0 persistido", r.persistedCount, 0);
    eq("nao coletado: nenhuma linha criada", db.payments.length, 0);
  }

  // amounts.original=0 e transaction_amount_refunded=0 preservados como zero
  // real na persistência (nunca viram null).
  {
    const db = makeDb();
    const payment = normalizePayment({
      id: "PZERO", status: "approved", transaction_amount: 10, transaction_amount_refunded: 0,
      charges_details: [{ amounts: { original: 0, refunded: 0 }, name: "zero_fee", type: "fee" }],
    });
    const lote = {
      paymentIdsUnique: ["PZERO"],
      paymentIdToOrderIds: new Map([["PZERO", ["O9"]]]),
      resultsMap: new Map([["PZERO", { collected: true, payment }]]),
    };
    await persistMpPayments({ syncRunId: 1, clienteId: 9, clienteContaId: null, externalAccountId: "111", paymentsLote: lote }, db);
    eq("zero real: transactionAmountRefunded=0 (nao null)", db.payments[0].transaction_amount_refunded, 0);
    eq("zero real: charge amountOriginal=0 (nao null)", db.charges[0].amount_original, 0);
  }

  // Campo ausente persiste NULL, nunca 0.
  {
    const db = makeDb();
    const payment = normalizePayment({ id: "PNULL", status: "approved", transaction_amount: 10 });
    const lote = {
      paymentIdsUnique: ["PNULL"],
      paymentIdToOrderIds: new Map([["PNULL", ["O10"]]]),
      resultsMap: new Map([["PNULL", { collected: true, payment }]]),
    };
    await persistMpPayments({ syncRunId: 1, clienteId: 9, clienteContaId: null, externalAccountId: "111", paymentsLote: lote }, db);
    ok("ausente: netReceivedAmount persiste null", db.payments[0].net_received_amount === null);
    ok("ausente: moneyReleaseStatus persiste null", db.payments[0].money_release_status === null);
  }

  // Nenhum token/Authorization persistido em nenhuma estrutura gravada.
  {
    const db = makeDb();
    const payment = normalizePayment({
      id: "PSEC", status: "approved", transaction_amount: 10,
      charges_details: [{
        amounts: { original: 1, refunded: 0 }, name: "fee", type: "fee",
        refund_charges: [{ amount: 1, access_token: "vazamento-nao-pode-persistir" }],
      }],
    });
    const lote = {
      paymentIdsUnique: ["PSEC"],
      paymentIdToOrderIds: new Map([["PSEC", ["O11"]]]),
      resultsMap: new Map([["PSEC", { collected: true, payment }]]),
    };
    await persistMpPayments({ syncRunId: 1, clienteId: 9, clienteContaId: null, externalAccountId: "111", paymentsLote: lote }, db);
    const dump = JSON.stringify({ payments: db.payments, charges: db.charges });
    ok("seguranca: nenhum access_token persistido", !dump.includes("vazamento-nao-pode-persistir"));
    ok("seguranca: nenhuma string Bearer/Authorization persistida", !/bearer|authorization/i.test(dump));
  }

  // Falha ao persistir UM payment nao derruba os demais.
  {
    const db = makeDb();
    const originalQuery = db.query.bind(db);
    let chamadasInsert = 0;
    db.query = async (sql, params) => {
      if (sql.includes("INSERT INTO central_vendas_mp_payments")) {
        chamadasInsert += 1;
        if (chamadasInsert === 1) throw new Error("falha simulada no primeiro payment");
      }
      return originalQuery(sql, params);
    };

    const paymentOk = normalizePayment({ id: "POK", status: "approved", transaction_amount: 1 });
    const paymentFalha = normalizePayment({ id: "PFALHA", status: "approved", transaction_amount: 1 });
    const lote = {
      paymentIdsUnique: ["PFALHA", "POK"],
      paymentIdToOrderIds: new Map([["PFALHA", ["O1"]], ["POK", ["O2"]]]),
      resultsMap: new Map([
        ["PFALHA", { collected: true, payment: paymentFalha }],
        ["POK", { collected: true, payment: paymentOk }],
      ]),
    };
    const originalError = console.error;
    console.error = () => {};
    const r = await persistMpPayments({ syncRunId: 1, clienteId: 9, clienteContaId: null, externalAccountId: "111", paymentsLote: lote }, db);
    console.error = originalError;

    eq("falha parcial: 1 persistido com sucesso (POK)", r.persistedCount, 1);
    eq("falha parcial: 1 registrado como falho (PFALHA)", r.failedToPersist.length, 1);
    eq("falha parcial: PFALHA nao virou linha", db.payments.find((p) => p.payment_id === "PFALHA"), undefined);
    eq("falha parcial: POK foi persistido mesmo com falha do PFALHA", db.payments.find((p) => p.payment_id === "POK")?.payment_id, "POK");
  }

  console.log(`centralVendasMp1PaymentsRepository.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
