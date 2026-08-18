// Prova o scroll generico da Central de Gestao Full: paginacao normal,
// pagina vazia, cursor null, cursor repetido (ciclo), expiracao com
// reinicio unico, teto de paginas/registros e deadline. Nao faz HTTP real —
// `fetchPage` e sempre um mock controlado pelo teste.

const assert = require("assert");
const { runScroll, dedupeByKey } = require("../services/full/fullPagination");

function pageQueue(pages) {
  let index = 0;
  return async () => {
    const page = pages[index];
    index += 1;
    return page;
  };
}

async function run() {
  // Scroll normal ate cursor ausente
  {
    const fetchPage = pageQueue([
      { items: [1, 2], nextCursor: "A" },
      { items: [3, 4], nextCursor: "B" },
      { items: [5], nextCursor: null },
    ]);

    const result = await runScroll({ fetchPage, maxPages: 10, maxRecords: 100 });
    assert.deepStrictEqual(result.items, [1, 2, 3, 4, 5]);
    assert.strictEqual(result.pagesFetched, 3);
    assert.strictEqual(result.stoppedReason, "cursor_absent");
    assert.strictEqual(result.restarted, false);
    console.log("  ✓ scroll normal consome paginas em sequencia ate cursor ausente");
  }

  // Pagina vazia
  {
    const fetchPage = pageQueue([{ items: [], nextCursor: "A" }]);
    const result = await runScroll({ fetchPage, maxPages: 10, maxRecords: 100 });
    assert.deepStrictEqual(result.items, []);
    assert.strictEqual(result.stoppedReason, "empty_page");
    console.log("  ✓ pagina vazia encerra o scroll com empty_page");
  }

  // Cursor null explicito depois de itens (variante de cursor ausente)
  {
    const fetchPage = pageQueue([{ items: [1], nextCursor: null }]);
    const result = await runScroll({ fetchPage, maxPages: 10, maxRecords: 100 });
    assert.deepStrictEqual(result.items, [1]);
    assert.strictEqual(result.stoppedReason, "cursor_absent");
    console.log("  ✓ nextCursor null encerra o scroll com cursor_absent");
  }

  // Cursor repetido: ciclo detectado e abortado
  {
    const fetchPage = pageQueue([
      { items: [1], nextCursor: "A" },
      { items: [2], nextCursor: "A" }, // repete o cursor ja visto
    ]);
    const result = await runScroll({ fetchPage, maxPages: 10, maxRecords: 100 });
    assert.strictEqual(result.stoppedReason, "scroll_cycle_detected");
    assert.strictEqual(result.pagesFetched, 2);
    console.log("  ✓ cursor repetido aborta com scroll_cycle_detected, nunca entra em loop infinito");
  }

  // Expiracao no meio: reinicia uma unica vez e conclui normalmente
  {
    let calls = 0;
    const fetchPage = async (cursor) => {
      calls += 1;
      if (calls === 2) return { expired: true };
      if (cursor === null) return { items: [1], nextCursor: "A" };
      if (cursor === "A") return { items: [2], nextCursor: null };
      throw new Error("chamada inesperada: cursor=" + cursor);
    };

    const result = await runScroll({ fetchPage, maxPages: 10, maxRecords: 100 });
    assert.strictEqual(result.restarted, true);
    assert.strictEqual(result.stoppedReason, "cursor_absent");
    // Sem dedupeKeyFn, o reinicio re-varre do zero e repete o item da 1a pagina
    // (comportamento honesto: cabe a quem chama pedir dedupe quando precisar).
    assert.deepStrictEqual(result.items, [1, 1, 2]);
    console.log("  ✓ scroll expirado no meio reinicia uma unica vez e conclui (re-varredura sem dedupe)");
  }

  // Expiracao repetida: desiste apos o unico restart permitido
  {
    const fetchPage = async () => ({ expired: true });
    const result = await runScroll({ fetchPage, maxPages: 10, maxRecords: 100 });
    assert.strictEqual(result.restarted, true);
    assert.strictEqual(result.stoppedReason, "scroll_expired");
    console.log("  ✓ expiracao apos o restart unico desiste com scroll_expired");
  }

  // Teto de paginas
  {
    const fetchPage = async (cursor) => ({ items: [1], nextCursor: (cursor || 0) + 1 });
    const result = await runScroll({ fetchPage, maxPages: 3, maxRecords: 100 });
    assert.strictEqual(result.pagesFetched, 3);
    assert.strictEqual(result.stoppedReason, "max_pages");
    console.log("  ✓ teto de paginas (maxPages) e respeitado e observavel");
  }

  // Teto de registros
  {
    const fetchPage = pageQueue([
      { items: [1, 2, 3], nextCursor: "A" },
      { items: [4, 5, 6], nextCursor: "B" },
    ]);
    const result = await runScroll({ fetchPage, maxPages: 10, maxRecords: 4 });
    assert.strictEqual(result.items.length, 4);
    assert.strictEqual(result.stoppedReason, "max_records");
    console.log("  ✓ teto de registros (maxRecords) trunca e para, nunca silenciosamente");
  }

  // Deadline
  {
    let time = 0;
    const nowFn = () => time;
    const fetchPage = async (cursor) => {
      time += 1000;
      return { items: [1], nextCursor: (cursor || 0) + 1 };
    };
    const result = await runScroll({ fetchPage, maxPages: 100, maxRecords: 1000, nowFn, deadlineMs: 2500 });
    assert.strictEqual(result.stoppedReason, "deadline_exceeded");
    assert.ok(result.pagesFetched < 100, "deadline deve impedir de chegar ao teto de paginas");
    console.log("  ✓ deadline interrompe o scroll antes do teto de paginas");
  }

  // Dedupe por chave (ex.: operation_id) apos reinicio, sem duplicar registros
  {
    let calls = 0;
    const fetchPage = async (cursor) => {
      calls += 1;
      if (calls === 2) return { expired: true };
      if (cursor === null) return { items: [{ id: "OP1" }, { id: "OP2" }], nextCursor: "A" };
      if (cursor === "A") return { items: [{ id: "OP2" }, { id: "OP3" }], nextCursor: null };
      throw new Error("chamada inesperada");
    };

    const result = await runScroll({
      fetchPage,
      maxPages: 10,
      maxRecords: 100,
      dedupeKeyFn: (op) => op.id,
    });

    const ids = result.items.map((op) => op.id).sort();
    assert.deepStrictEqual(ids, ["OP1", "OP2", "OP3"], "OP2 repetido entre o antes/depois do restart deve aparecer uma unica vez");
    console.log("  ✓ dedupeKeyFn remove duplicatas (ex.: operation_id repetido entre paginas/restart)");
  }

  // Validacao de parametros obrigatorios (runScroll e async: invalido sempre rejeita, nunca lanca sincrono)
  {
    await assert.rejects(() => runScroll({ fetchPage: "nao-e-funcao", maxPages: 1, maxRecords: 1 }), TypeError);
    await assert.rejects(() => runScroll({ fetchPage: async () => ({}), maxPages: 0, maxRecords: 1 }), TypeError);
    await assert.rejects(() => runScroll({ fetchPage: async () => ({}), maxPages: 1, maxRecords: 0 }), TypeError);
    console.log("  ✓ maxPages/maxRecords/fetchPage invalidos sao rejeitados explicitamente");
  }

  // dedupeByKey isolado
  {
    const deduped = dedupeByKey([{ id: "A" }, { id: "B" }, { id: "A" }], (item) => item.id);
    assert.strictEqual(deduped.length, 2);
    console.log("  ✓ dedupeByKey preserva a primeira ocorrencia de cada chave");
  }

  console.log("fullPagination.test.js passed");
}

run();
