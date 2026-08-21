// server/tests/centralVendasMp2SettlementCsvParser.test.js
//
// MP2 — parseSettlementCsv (centralVendasMpSettlementCsvParser.js) parseia
// por NOME de coluna (csv-parser, ja em server/package.json — seção 12 do
// spec MP2), nunca por posição fixa. Cabeçalho real validado no handoff
// (seção 19): SOURCE_ID;TRANSACTION_TYPE;TRANSACTION_AMOUNT;FEE_AMOUNT;
// SETTLEMENT_NET_AMOUNT;REAL_AMOUNT;ORDER_ID;SHIPPING_ID;MONEY_RELEASE_DATE

const assert = require("assert");
const { parseSettlementCsv, parseSettlementAmount } = require("../services/centralVendas/centralVendasMpSettlementCsvParser");

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
  // 14 — parser por HEADER, ordem de coluna diferente da "canonica".
  {
    const csvText =
      "ORDER_ID;SOURCE_ID;TRANSACTION_TYPE;TRANSACTION_AMOUNT;FEE_AMOUNT;SETTLEMENT_NET_AMOUNT;REAL_AMOUNT;SHIPPING_ID;MONEY_RELEASE_DATE\n" +
      "2000018051653738;174959925172;SETTLEMENT;34,90;-12,49;22,41;22,41;;2026-09-18T12:36:32.000-04:00\n";
    const { rows, rowsCount } = await parseSettlementCsv(csvText);
    eq("14: 1 linha parseada", rowsCount, 1);
    eq("14: SOURCE_ID lido por nome mesmo com ordem diferente", rows[0].sourceId, "174959925172");
    eq("14: ORDER_ID lido por nome", rows[0].orderId, "2000018051653738");
  }

  // Fixture real completa do handoff (seção 20).
  {
    const csvText =
      "SOURCE_ID;TRANSACTION_TYPE;TRANSACTION_AMOUNT;FEE_AMOUNT;SETTLEMENT_NET_AMOUNT;REAL_AMOUNT;ORDER_ID;SHIPPING_ID;MONEY_RELEASE_DATE\n" +
      "174959925172;SETTLEMENT;34,90;-12,49;22,41;22,41;2000018051653738;;2026-09-18T12:36:32.000-04:00\n";
    const { rows } = await parseSettlementCsv(csvText);
    const r = rows[0];
    eq("fixture: transactionAmount", r.transactionAmount, 34.90);
    eq("fixture: feeAmount", r.feeAmount, -12.49);
    eq("fixture: settlementNetAmount", r.settlementNetAmount, 22.41);
    eq("fixture: realAmount", r.realAmount, 22.41);
    eq("fixture: transactionType", r.transactionType, "SETTLEMENT");
  }

  // 15 — decimal com virgula.
  eq("15: decimal com virgula", parseSettlementAmount("34,90"), 34.90);
  // 16 — decimal com ponto.
  eq("16: decimal com ponto", parseSettlementAmount("34.90"), 34.90);
  // 17 — negativo (com virgula e com ponto).
  eq("17: negativo com virgula", parseSettlementAmount("-12,49"), -12.49);
  eq("17: negativo com ponto", parseSettlementAmount("-12.49"), -12.49);
  // 18 — zero real (nunca vira null).
  ok("18: zero real preservado", parseSettlementAmount("0") === 0);
  ok("18: zero com decimais preservado", parseSettlementAmount("0,00") === 0);
  // 19 — campo vazio = null (nunca 0).
  ok("19: vazio vira null", parseSettlementAmount("") === null);
  ok("19: undefined vira null", parseSettlementAmount(undefined) === null);
  ok("19: null permanece null", parseSettlementAmount(null) === null);

  // 20 — SOURCE_ID preservado como STRING (nao vira Number).
  // 21 — ORDER_ID grande preservado como STRING (nunca perde precisao).
  {
    const csvText =
      "SOURCE_ID;TRANSACTION_TYPE;TRANSACTION_AMOUNT;FEE_AMOUNT;SETTLEMENT_NET_AMOUNT;REAL_AMOUNT;ORDER_ID;SHIPPING_ID;MONEY_RELEASE_DATE\n" +
      "9007199254740993;SETTLEMENT;10,00;0;10,00;10,00;9007199254740995;46381674803;\n";
    const { rows } = await parseSettlementCsv(csvText);
    eq("20: SOURCE_ID como string", rows[0].sourceId, "9007199254740993");
    ok("20: SOURCE_ID nao e number", typeof rows[0].sourceId === "string");
    eq("21: ORDER_ID grande preservado sem perda de precisao", rows[0].orderId, "9007199254740995");
    eq("21: SHIPPING_ID como string", rows[0].shippingId, "46381674803");
  }

  // MONEY_RELEASE_DATE vazio -> null (nao string vazia).
  {
    const csvText =
      "SOURCE_ID;TRANSACTION_TYPE;TRANSACTION_AMOUNT;FEE_AMOUNT;SETTLEMENT_NET_AMOUNT;REAL_AMOUNT;ORDER_ID;SHIPPING_ID;MONEY_RELEASE_DATE\n" +
      "P1;SETTLEMENT;10;0;10;10;O1;;\n";
    const { rows } = await parseSettlementCsv(csvText);
    ok("MONEY_RELEASE_DATE vazio -> null", rows[0].moneyReleaseDate === null);
  }

  // CRLF — csv-parser lida nativamente, so confirmamos que nao quebra aqui.
  {
    const csvText =
      "SOURCE_ID;TRANSACTION_TYPE;TRANSACTION_AMOUNT;FEE_AMOUNT;SETTLEMENT_NET_AMOUNT;REAL_AMOUNT;ORDER_ID;SHIPPING_ID;MONEY_RELEASE_DATE\r\n" +
      "P1;SETTLEMENT;10;0;10;10;O1;;\r\n" +
      "P2;REFUND;-5;0;-5;-5;O1;;\r\n";
    const { rows, rowsCount } = await parseSettlementCsv(csvText);
    eq("CRLF: 2 linhas parseadas", rowsCount, 2);
    eq("CRLF: 2a linha REFUND", rows[1].transactionType, "REFUND");
  }

  console.log(`centralVendasMp2SettlementCsvParser.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
