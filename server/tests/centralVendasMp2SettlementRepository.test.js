// server/tests/centralVendasMp2SettlementRepository.test.js
//
// MP2 — centralVendasMpSettlementRepository: idempotência do import (replace
// transacional por report), preservação de movimentos sem Payment
// correspondente (Settlement é fonte DA CONTA — seção 15 do spec), e
// isolamento entre sync_run_id (nunca cruza dado de contas diferentes —
// seção 30/42).

const assert = require("assert");
const repo = require("../services/centralVendas/centralVendasMpSettlementRepository");
const { makeMpSettlementFakeDb } = require("./helpers/mpSettlementFakeDb");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

function movRow(rowNumber, sourceId, extra = {}) {
  return {
    rowNumber, sourceId, orderId: extra.orderId ?? null, shippingId: extra.shippingId ?? null,
    transactionType: extra.transactionType ?? "SETTLEMENT",
    transactionAmount: extra.transactionAmount ?? 10, feeAmount: extra.feeAmount ?? -1,
    settlementNetAmount: extra.settlementNetAmount ?? 9, realAmount: extra.realAmount ?? 9,
    moneyReleaseDate: null, isReleased: null,
  };
}

async function run() {
  // 22 — reimportar o MESMO report NUNCA duplica movimento (replace
  // transacional: delete + insert em bloco).
  {
    const db = makeMpSettlementFakeDb();
    const report = await repo.upsertSettlementReport({ syncRunId: 1, clienteId: 9, clienteContaId: 5, externalAccountId: "111", reportExternalId: "R1", status: "processed" }, db);
    const movimentos = [movRow(1, "P1"), movRow(2, "P2")];
    await repo.replaceSettlementMovements({ reportId: report.id, syncRunId: 1, clienteContaId: 5, movements: movimentos }, db);
    await repo.replaceSettlementMovements({ reportId: report.id, syncRunId: 1, clienteContaId: 5, movements: movimentos }, db);
    eq("22: reimportar o mesmo report nao duplica (2 linhas, nao 4)", db.movements.length, 2);
  }

  // 23 — falha no meio da importação NUNCA destrói um import anterior
  // válido (ROLLBACK preserva o estado anterior).
  {
    const db = makeMpSettlementFakeDb();
    const report = await repo.upsertSettlementReport({ syncRunId: 1, clienteId: 9, clienteContaId: 5, externalAccountId: "111", reportExternalId: "R1", status: "processed" }, db);
    await repo.replaceSettlementMovements({ reportId: report.id, syncRunId: 1, clienteContaId: 5, movements: [movRow(1, "P1")] }, db);
    eq("estado anterior: 1 movimento", db.movements.length, 1);

    let chamadasInsert = 0;
    const originalQuery = db.query.bind(db);
    db.query = async (sql, params) => {
      if (sql.includes("INSERT INTO central_vendas_mp_settlement_movements")) {
        chamadasInsert += 1;
        if (chamadasInsert === 2) throw new Error("falha simulada no meio do import");
      }
      return originalQuery(sql, params);
    };

    let lancou = false;
    try {
      await repo.replaceSettlementMovements({
        reportId: report.id, syncRunId: 1, clienteContaId: 5,
        movements: [movRow(1, "NOVO1"), movRow(2, "NOVO2")],
      }, db);
    } catch (_) { lancou = true; }

    ok("23: erro propagado", lancou);
    eq("23: ROLLBACK preserva o movimento da importacao anterior valida (nunca fica sem linhas)", db.movements.length, 1);
    eq("23: o movimento preservado e o da importacao anterior (P1), nao um dos novos", db.movements[0].source_id, "P1");
  }

  // Movement sem Payment correspondente no run continua persistido (nunca
  // descartado nem tratado como erro) — Settlement e fonte DA CONTA.
  {
    const db = makeMpSettlementFakeDb();
    const report = await repo.upsertSettlementReport({ syncRunId: 1, clienteId: 9, clienteContaId: 5, externalAccountId: "111", reportExternalId: "R1", status: "processed" }, db);
    await repo.replaceSettlementMovements({
      reportId: report.id, syncRunId: 1, clienteContaId: 5,
      movements: [movRow(1, "SEM_PAYMENT_NO_RUN")],
    }, db);
    const persisted = await repo.listSettlementMovementsByRun(1, db);
    eq("movement sem payment continua persistido", persisted.length, 1);
    eq("movement sem payment preserva sourceId", persisted[0].sourceId, "SEM_PAYMENT_NO_RUN");
  }

  // 42 — duas contas (dois sync runs) nunca cruzam report/movimento.
  {
    const db = makeMpSettlementFakeDb();
    const reportContaA = await repo.upsertSettlementReport({ syncRunId: 10, clienteId: 9, clienteContaId: 100, externalAccountId: "AAA", reportExternalId: "RA", status: "processed" }, db);
    const reportContaB = await repo.upsertSettlementReport({ syncRunId: 20, clienteId: 9, clienteContaId: 200, externalAccountId: "BBB", reportExternalId: "RB", status: "processed" }, db);
    await repo.replaceSettlementMovements({ reportId: reportContaA.id, syncRunId: 10, clienteContaId: 100, movements: [movRow(1, "PAY_A")] }, db);
    await repo.replaceSettlementMovements({ reportId: reportContaB.id, syncRunId: 20, clienteContaId: 200, movements: [movRow(1, "PAY_B")] }, db);

    const movimentosA = await repo.listSettlementMovementsByRun(10, db);
    const movimentosB = await repo.listSettlementMovementsByRun(20, db);
    eq("42: run da conta A so ve seu proprio movimento", movimentosA.map((m) => m.sourceId), ["PAY_A"]);
    eq("42: run da conta B so ve seu proprio movimento", movimentosB.map((m) => m.sourceId), ["PAY_B"]);

    const runA = await repo.getSettlementReportByRun(10, db);
    const runB = await repo.getSettlementReportByRun(20, db);
    eq("42: report da conta A tem seu proprio reportExternalId", runA.reportExternalId, "RA");
    eq("42: report da conta B tem seu proprio reportExternalId", runB.reportExternalId, "RB");
    ok("42: cliente_conta_id nunca cruza entre os dois reports", runA.clienteContaId !== runB.clienteContaId);
  }

  console.log(`centralVendasMp2SettlementRepository.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
