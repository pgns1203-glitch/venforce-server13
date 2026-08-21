// server/tests/centralVendasMp3BulkRepository.test.js
//
// MP3 (seção 12/13 do spec MP3) — leitura BULK de Payments/Settlement por um
// array de sync_run_ids (1 query, nunca 1 por run/pedido) e exposição de
// `sync_run_id` em resolveImportsForRange (necessário para o range-aware
// Read API derivar os runs elegíveis sem uma segunda query).

const assert = require("assert");
const repository = require("../services/centralVendas/centralVendasRepository");
const { listMpPaymentsWithChargesTotalByRunIds } = require("../services/centralVendas/centralVendasMpPaymentsRepository");
const { listSettlementMovementsByRunIds, listSettlementReportsByRunIds } = require("../services/centralVendas/centralVendasMpSettlementRepository");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

async function run() {
  // resolveImportsForRange expõe sync_run_id (aditivo) sem quebrar a seleção
  // M4 (published > legacy, cobertura por competência).
  {
    const imports = [
      { id: 1, cliente_slug: "cliente-a", marketplace: "meli", competencia: "2026-08", publication_status: "published",
        coverage_date_from: "2026-08-01", coverage_date_to: "2026-08-31", published_at: "2026-08-05", cliente_conta_id: null, sync_run_id: 501 },
    ];
    const db = {
      async query(sql, params) {
        ok("SELECT inclui sync_run_id", sql.includes("sync_run_id"));
        return { rows: imports };
      },
    };
    const { imports: resolved } = await repository.resolveImportsForRange(
      { clienteSlug: "cliente-a", dateFrom: "2026-08-01", dateTo: "2026-08-31", marketplace: "meli" }, db
    );
    eq("resolveImportsForRange: sync_run_id presente na row resolvida", resolved[0].sync_run_id, 501);
  }

  // Bulk Payments por syncRunIds — 1 query só, escopo exato aos runs pedidos.
  {
    const payments = [
      { id: 1, sync_run_id: 10, cliente_conta_id: 5, order_id: "O1", order_ids_json: ["O1"], payment_id: "P1", status: "approved", status_detail: null, transaction_amount: 100, transaction_amount_refunded: 0, net_received_amount: 90, money_release_date: null, money_release_status: "released", refund_count: 0 },
      { id: 2, sync_run_id: 20, cliente_conta_id: 5, order_id: "O2", order_ids_json: ["O2"], payment_id: "P2", status: "approved", status_detail: null, transaction_amount: 50, transaction_amount_refunded: 0, net_received_amount: 45, money_release_date: null, money_release_status: "pending", refund_count: 0 },
      { id: 3, sync_run_id: 999, cliente_conta_id: 7, order_id: "O9", order_ids_json: ["O9"], payment_id: "P9", status: "approved", status_detail: null, transaction_amount: 1, transaction_amount_refunded: 0, net_received_amount: 1, money_release_date: null, money_release_status: null, refund_count: 0 },
    ];
    let queryCount = 0;
    const db = {
      async query(sql, params) {
        queryCount += 1;
        ok("bulk payments: usa ANY(...)", sql.includes("sync_run_id = ANY("));
        const ids = params[0].map(Number);
        return { rows: payments.filter((p) => ids.includes(p.sync_run_id)).map((p) => ({ ...p, charges_total: 0 })) };
      },
    };
    const rows = await listMpPaymentsWithChargesTotalByRunIds([10, 20], db);
    eq("bulk payments: 1 unica query", queryCount, 1);
    eq("bulk payments: so os 2 runs pedidos, run 999 (outra conta) excluido", rows.map((r) => r.paymentId).sort(), ["P1", "P2"]);
  }

  // Bulk Settlement movements por syncRunIds.
  {
    const movements = [
      { id: 1, settlement_report_id: 1, sync_run_id: 10, cliente_conta_id: 5, row_number: 1, source_id: "P1", order_id: "O1", shipping_id: null, transaction_type: "SETTLEMENT", transaction_amount: 100, fee_amount: -10, settlement_net_amount: 90, real_amount: 90, money_release_date: null, is_released: null },
      { id: 2, settlement_report_id: 2, sync_run_id: 20, cliente_conta_id: 5, row_number: 1, source_id: "P2", order_id: "O2", shipping_id: null, transaction_type: "SETTLEMENT", transaction_amount: 50, fee_amount: -5, settlement_net_amount: 45, real_amount: 45, money_release_date: null, is_released: null },
      { id: 3, settlement_report_id: 3, sync_run_id: 999, cliente_conta_id: 7, row_number: 1, source_id: "P9", order_id: "O9", shipping_id: null, transaction_type: "SETTLEMENT", transaction_amount: 1, fee_amount: 0, settlement_net_amount: 1, real_amount: 1, money_release_date: null, is_released: null },
    ];
    let queryCount = 0;
    const db = {
      async query(sql, params) {
        queryCount += 1;
        ok("bulk movements: usa ANY(...)", sql.includes("sync_run_id = ANY("));
        const ids = params[0].map(Number);
        return { rows: movements.filter((m) => ids.includes(m.sync_run_id)) };
      },
    };
    const rows = await listSettlementMovementsByRunIds([10, 20], db);
    eq("bulk movements: 1 unica query", queryCount, 1);
    eq("bulk movements: so os 2 runs pedidos", rows.map((r) => r.sourceId).sort(), ["P1", "P2"]);
  }

  // Array vazio nunca toca o banco (evita ANY($1) com array vazio/null).
  {
    let queryCount = 0;
    const db = { async query() { queryCount += 1; return { rows: [] }; } };
    eq("payments bulk vazio: []", await listMpPaymentsWithChargesTotalByRunIds([], db), []);
    eq("movements bulk vazio: []", await listSettlementMovementsByRunIds([], db), []);
    eq("reports bulk vazio: []", await listSettlementReportsByRunIds([], db), []);
    eq("nenhuma query disparada", queryCount, 0);
  }

  console.log(`centralVendasMp3BulkRepository.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
