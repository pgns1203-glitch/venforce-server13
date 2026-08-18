// Prova o motor de operacoes Full: normalizacao defensiva, so
// SALE_CONFIRMATION conta como venda, janela de 14 dias dividida em duas
// semanas, dedupe por operation_id e agregacao que nunca transforma uma
// operacao sem delta interpretavel em zero silencioso.

const assert = require("assert");
const {
  normalizeOperation,
  saleUnitsFromOperation,
  dedupeOperationsById,
  buildCompletedDayWindow,
  splitFourteenDayWindow,
  isDateInsideWindow,
  aggregateOperationsByInventory,
} = require("../services/full/fullOperationsEngine");

// [FIX] O payload real de /stock/fulfillment/operations/search usa
// `date_created`, nao `date` (nao existe esse campo na API) -- confirmado
// contra a API ao vivo. Este helper de teste usa `date_created` para
// espelhar o formato real.
function op({ id, type, inventoryId, date, delta }) {
  return { id, type, inventory_id: inventoryId, date_created: date, detail: delta === undefined ? undefined : { available_quantity: delta } };
}

function run() {
  // normalizeOperation: campos minimos presentes
  {
    const normalized = normalizeOperation(op({ id: 1, type: "SALE_CONFIRMATION", inventoryId: "INV-1", date: "2026-08-10T10:00:00Z", delta: -3 }));
    assert.strictEqual(normalized.valid, true);
    assert.strictEqual(normalized.operationId, "1");
    assert.strictEqual(normalized.inventoryId, "INV-1");
    assert.strictEqual(normalized.availableQuantityDelta, -3);
    console.log("  ✓ normalizeOperation le os campos minimos de uma operacao valida");
  }

  // normalizeOperation: entrada invalida nunca quebra, so marca valid=false
  {
    assert.strictEqual(normalizeOperation(null).valid, false);
    assert.strictEqual(normalizeOperation({}).valid, false);
    assert.strictEqual(normalizeOperation({ id: 1, type: "SALE_CONFIRMATION" }).valid, false, "sem inventory_id nao e valido");
    console.log("  ✓ normalizeOperation trata entrada invalida sem lancar excecao");
  }

  // saleUnitsFromOperation: so SALE_CONFIRMATION conta como venda
  {
    const venda = normalizeOperation(op({ id: 1, type: "SALE_CONFIRMATION", inventoryId: "INV-1", date: "2026-08-10", delta: -5 }));
    const cancelamento = normalizeOperation(op({ id: 2, type: "SALE_CANCELATION", inventoryId: "INV-1", date: "2026-08-10", delta: 5 }));

    assert.deepStrictEqual(saleUnitsFromOperation(venda), { applicable: true, units: 5 });
    assert.deepStrictEqual(saleUnitsFromOperation(cancelamento), { applicable: false, units: null });
    console.log("  ✓ so SALE_CONFIRMATION conta como venda; SALE_CANCELATION nunca e somada");
  }

  // saleUnitsFromOperation: SALE_CONFIRMATION sem delta interpretavel nunca vira 0
  {
    const semDelta = normalizeOperation(op({ id: 3, type: "SALE_CONFIRMATION", inventoryId: "INV-1", date: "2026-08-10" }));
    const resultado = saleUnitsFromOperation(semDelta);
    assert.strictEqual(resultado.applicable, true);
    assert.strictEqual(resultado.units, null, "delta ausente nunca pode virar 0 unidades vendidas");
    console.log("  ✓ SALE_CONFIRMATION sem delta interpretavel nunca vira 0 unidades");
  }

  // dedupeOperationsById
  {
    const deduped = dedupeOperationsById([{ id: "OP1" }, { id: "OP2" }, { id: "OP1" }, { id: undefined }]);
    const ids = deduped.filter((o) => o.id).map((o) => o.id);
    assert.deepStrictEqual(ids, ["OP1", "OP2"]);
    assert.strictEqual(deduped.length, 3, "operacao sem id e preservada, nao pode ser deduplicada as cegas");
    console.log("  ✓ dedupeOperationsById remove repeticao por id e preserva operacoes sem id");
  }

  // buildCompletedDayWindow: 14 dias completos terminando antes do dia de corte
  {
    const window = buildCompletedDayWindow({ endExclusiveIso: "2026-08-18", days: 14 });
    assert.strictEqual(window.from, "2026-08-04");
    assert.strictEqual(window.to, "2026-08-17");
    assert.throws(() => buildCompletedDayWindow({ endExclusiveIso: "2026-08-18", days: 0 }), TypeError);
    console.log("  ✓ buildCompletedDayWindow calcula 14 dias completos antes do dia de corte");
  }

  // splitFourteenDayWindow: duas janelas de 7 dias sem sobreposicao nem buraco
  {
    const window = { from: "2026-08-04", to: "2026-08-17" };
    const { previousWeek, currentWeek } = splitFourteenDayWindow(window);
    assert.deepStrictEqual(previousWeek, { from: "2026-08-04", to: "2026-08-10" });
    assert.deepStrictEqual(currentWeek, { from: "2026-08-11", to: "2026-08-17" });
    console.log("  ✓ splitFourteenDayWindow divide em duas semanas contiguas sem sobreposicao");
  }

  // isDateInsideWindow: bordas inclusivas
  {
    const window = { from: "2026-08-04", to: "2026-08-10" };
    assert.strictEqual(isDateInsideWindow("2026-08-04", window), true);
    assert.strictEqual(isDateInsideWindow("2026-08-10", window), true);
    assert.strictEqual(isDateInsideWindow("2026-08-03", window), false);
    assert.strictEqual(isDateInsideWindow("2026-08-11", window), false);
    console.log("  ✓ isDateInsideWindow inclui as duas bordas da janela");
  }

  // aggregateOperationsByInventory: soma por inventario e por semana, ignora cancelamento
  {
    const previousWeek = { from: "2026-08-04", to: "2026-08-10" };
    const currentWeek = { from: "2026-08-11", to: "2026-08-17" };
    const operations = [
      op({ id: 1, type: "SALE_CONFIRMATION", inventoryId: "INV-1", date: "2026-08-05", delta: -2 }),
      op({ id: 2, type: "SALE_CONFIRMATION", inventoryId: "INV-1", date: "2026-08-06", delta: -3 }),
      op({ id: 3, type: "SALE_CONFIRMATION", inventoryId: "INV-1", date: "2026-08-12", delta: -4 }),
      op({ id: 4, type: "SALE_CANCELATION", inventoryId: "INV-1", date: "2026-08-12", delta: 1 }),
      op({ id: 5, type: "SALE_CONFIRMATION", inventoryId: "INV-2", date: "2026-08-05", delta: -1 }),
    ];

    const result = aggregateOperationsByInventory({ operations, previousWeek, currentWeek });
    const inv1 = result.find((r) => r.inventoryId === "INV-1");
    const inv2 = result.find((r) => r.inventoryId === "INV-2");

    assert.strictEqual(inv1.previous7dUnits, 5);
    assert.strictEqual(inv1.previous7dStatus, "ok");
    assert.strictEqual(inv1.current7dUnits, 4, "SALE_CANCELATION nao pode ser somada ou subtraida do total");
    assert.strictEqual(inv2.previous7dUnits, 1);
    assert.strictEqual(inv2.current7dUnits, 0, "sem SALE_CONFIRMATION na semana atual e zero real, nao ausencia");
    console.log("  ✓ aggregateOperationsByInventory soma por inventario/semana e ignora cancelamento");
  }

  // aggregateOperationsByInventory: operacao sem delta degrada a janela, nunca vira soma parcial disfarcada
  {
    const previousWeek = { from: "2026-08-04", to: "2026-08-10" };
    const currentWeek = { from: "2026-08-11", to: "2026-08-17" };
    const operations = [
      op({ id: 1, type: "SALE_CONFIRMATION", inventoryId: "INV-3", date: "2026-08-05", delta: -2 }),
      op({ id: 2, type: "SALE_CONFIRMATION", inventoryId: "INV-3", date: "2026-08-06" }), // sem delta
    ];
    const result = aggregateOperationsByInventory({ operations, previousWeek, currentWeek });
    const inv3 = result.find((r) => r.inventoryId === "INV-3");
    assert.strictEqual(inv3.previous7dStatus, "degraded");
    assert.strictEqual(inv3.previous7dUnits, null, "janela degradada nunca expoe uma soma parcial como se fosse total confiavel");
    console.log("  ✓ operacao SALE_CONFIRMATION sem delta degrada a janela para null, nunca soma parcial");
  }

  // aggregateOperationsByInventory: operacoes invalidas/sem data sao ignoradas sem quebrar
  {
    const previousWeek = { from: "2026-08-04", to: "2026-08-10" };
    const currentWeek = { from: "2026-08-11", to: "2026-08-17" };
    const result = aggregateOperationsByInventory({ operations: [null, {}, { id: 1, type: "SALE_CONFIRMATION" }], previousWeek, currentWeek });
    assert.deepStrictEqual(result, []);
    console.log("  ✓ operacoes invalidas/sem data/sem inventory_id sao ignoradas sem quebrar a agregacao");
  }

  console.log("fullOperationsEngine.test.js passed");
}

run();
