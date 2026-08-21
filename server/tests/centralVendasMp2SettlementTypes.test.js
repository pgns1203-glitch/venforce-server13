// server/tests/centralVendasMp2SettlementTypes.test.js
//
// MP2 — TRANSACTION_TYPE observados no handoff (seção 22): SETTLEMENT,
// DISPUTE, REFUND, REFUND_SHIPPING, SETTLEMENT_SHIPPING. NUNCA um enum
// fechado — um tipo desconhecido é preservado (parseado E persistido),
// nunca derruba o import (seção 16 do spec MP2).

const assert = require("assert");
const { parseSettlementCsv } = require("../services/centralVendas/centralVendasMpSettlementCsvParser");
const repo = require("../services/centralVendas/centralVendasMpSettlementRepository");
const { makeMpSettlementFakeDb } = require("./helpers/mpSettlementFakeDb");

let checks = 0;
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

const HEADER = "SOURCE_ID;TRANSACTION_TYPE;TRANSACTION_AMOUNT;FEE_AMOUNT;SETTLEMENT_NET_AMOUNT;REAL_AMOUNT;ORDER_ID;SHIPPING_ID;MONEY_RELEASE_DATE\n";

async function run() {
  const linhas = [
    ["P1", "SETTLEMENT", "34,90", "-12,49", "22,41", "22,41"],
    ["P1", "DISPUTE", "-38,70", "0", "-38,70", "-38,70"],
    ["P1", "REFUND", "-286,05", "0", "-286,05", "-286,05"],
    ["P1", "REFUND_SHIPPING", "-90,91", "0", "-90,91", "-90,91"],
    ["P1", "SETTLEMENT_SHIPPING", "90,91", "0", "90,91", "90,91"],
    ["P1", "TIPO_JAMAIS_DOCUMENTADO", "1,00", "0", "1,00", "1,00"],
  ];
  const csvText = HEADER + linhas.map((l) => `${l[0]};${l[1]};${l[2]};${l[3]};${l[4]};${l[5]};O1;;`).join("\n");

  // 24-29 — todos os tipos (conhecidos + desconhecido) sao PARSEADOS sem
  // exceção e sem serem descartados.
  const { rows, rowsCount, typeCounts } = await parseSettlementCsv(csvText);
  eq("parse: 6 linhas, nenhuma descartada", rowsCount, 6);
  eq("25: REFUND preservado", rows.find((r) => r.transactionType === "REFUND") !== undefined, true);
  eq("26: DISPUTE preservado", rows.find((r) => r.transactionType === "DISPUTE") !== undefined, true);
  eq("27: REFUND_SHIPPING preservado", rows.find((r) => r.transactionType === "REFUND_SHIPPING") !== undefined, true);
  eq("28: SETTLEMENT_SHIPPING preservado", rows.find((r) => r.transactionType === "SETTLEMENT_SHIPPING") !== undefined, true);
  eq("29: tipo desconhecido preservado (nao rejeitado)", rows.find((r) => r.transactionType === "TIPO_JAMAIS_DOCUMENTADO") !== undefined, true);
  eq("29: tipo desconhecido conta em typeCounts (observabilidade)", typeCounts.TIPO_JAMAIS_DOCUMENTADO, 1);

  // Persistência: nenhum tipo (conhecido ou não) impede o INSERT — a coluna
  // e TEXT livre, nunca um enum de banco fechado.
  const db = makeMpSettlementFakeDb();
  const report = await repo.upsertSettlementReport({ syncRunId: 1, clienteId: 9, clienteContaId: 5, externalAccountId: "111", reportExternalId: "R1", status: "processed" }, db);
  await repo.replaceSettlementMovements({ reportId: report.id, syncRunId: 1, clienteContaId: 5, movements: rows }, db);
  const persisted = await repo.listSettlementMovementsByRun(1, db);
  eq("persistencia: 6 movimentos persistidos, incluindo o tipo desconhecido", persisted.length, 6);
  eq("persistencia: tipo desconhecido persistido verbatim", persisted.find((m) => m.transactionType === "TIPO_JAMAIS_DOCUMENTADO") !== undefined, true);

  console.log(`centralVendasMp2SettlementTypes.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
