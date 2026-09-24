// server/tests/centralVendasOrdersRetry.test.js
//
// Retry/backoff da Orders API em fetchAllOrders (Auditoria Sync Noturno §14):
// 429/5xx/erro de rede transitório → retry limitado com backoff (respeitando
// Retry-After); 401/403/404 e erros de grant (ML_*) → falham na hora, sem
// retry. mlFetch e sleep são injetados pelo 5º argumento de fetchAllOrders —
// nenhum banco, nenhuma rede, nenhuma espera real.

const assert = require("assert");
const svc = require("../services/centralVendas/centralVendasSyncService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

function order(id) {
  return { id, date_created: "2026-09-10T10:00:00.000-03:00", order_items: [] };
}

// `respostas`: fila de respostas por chamada. Cada item é um objeto de
// resposta de mlFetch ({ ok, status, data, retryAfter }) ou { throw: err }.
function stubMlFetch(respostas) {
  const chamadas = [];
  let i = 0;
  async function mlFetchFn(clienteId, path, options) {
    chamadas.push({ clienteId, path, options });
    const r = respostas[Math.min(i, respostas.length - 1)];
    i += 1;
    if (r.throw) throw r.throw;
    return r;
  }
  return { mlFetchFn, chamadas };
}

function sleepSpy() {
  const esperas = [];
  return { sleepFn: async (ms) => { esperas.push(ms); }, esperas };
}

const pagina = (ids, total) => ({ ok: true, status: 200, data: { results: ids.map(order), paging: { total } } });
const http = (status, retryAfter = null) => ({ ok: false, status, data: { error: "x" }, retryAfter });

function erroRede(code) {
  const err = new TypeError("fetch failed");
  err.cause = { code };
  return err;
}

async function capturarWarn(fn) {
  const original = console.warn;
  const linhas = [];
  console.warn = (...args) => { linhas.push(args.join(" ")); };
  try {
    return { resultado: await fn(), linhas };
  } finally {
    console.warn = original;
  }
}

async function run() {
  // 1. 429 com Retry-After → espera exatamente o Retry-After e segue.
  {
    const { mlFetchFn, chamadas } = stubMlFetch([http(429, 3), pagina([1, 2], 2)]);
    const { sleepFn, esperas } = sleepSpy();
    const { data, completeness } = await svc.fetchAllOrders(7, "seller7", "2026-09-01", "2026-09-23", { mlFetchFn, sleepFn });
    eq("1: 2 chamadas", chamadas.length, 2);
    eq("1: Retry-After respeitado (3s)", esperas, [3000]);
    eq("1: pedidos", data.map((o) => o.id), [1, 2]);
    ok("1: completo", completeness.complete === true);
  }

  // 2. 500 e 502 seguidos → backoff exponencial, depois sucesso.
  {
    const { mlFetchFn, chamadas } = stubMlFetch([http(500), http(502), pagina([10], 1)]);
    const { sleepFn, esperas } = sleepSpy();
    const { data } = await svc.fetchAllOrders(7, "seller7", "2026-09-01", "2026-09-23", { mlFetchFn, sleepFn });
    eq("2: 3 chamadas", chamadas.length, 3);
    eq("2: 2 esperas", esperas.length, 2);
    ok("2: 1ª espera ~1s", esperas[0] >= 1000 && esperas[0] < 1250);
    ok("2: 2ª espera ~2s (exponencial)", esperas[1] >= 2000 && esperas[1] < 2250);
    eq("2: pedido", data.length, 1);
  }

  // 3. 503/504 também são transitórios.
  {
    const { mlFetchFn, chamadas } = stubMlFetch([http(503), http(504), pagina([], 0)]);
    const { sleepFn } = sleepSpy();
    const { completeness } = await svc.fetchAllOrders(7, "seller7", "2026-09-01", "2026-09-23", { mlFetchFn, sleepFn });
    eq("3: 3 chamadas", chamadas.length, 3);
    ok("3: 0/0 completo", completeness.complete === true);
  }

  // 4. 429 persistente → esgota as tentativas (limitado) e lança o MESMO erro
  //    de antes (ORDERS_HTTP_ERROR / 502 / mlStatus).
  {
    const { mlFetchFn, chamadas } = stubMlFetch([http(429)]);
    const { sleepFn, esperas } = sleepSpy();
    let erro = null;
    try {
      await svc.fetchAllOrders(7, "seller7", "2026-09-01", "2026-09-23", { mlFetchFn, sleepFn });
    } catch (err) { erro = err; }
    ok("4: lançou", !!erro);
    eq("4: tentativas = ORDERS_MAX_ATTEMPTS", chamadas.length, svc.ORDERS_MAX_ATTEMPTS);
    eq("4: esperas = tentativas - 1", esperas.length, svc.ORDERS_MAX_ATTEMPTS - 1);
    eq("4: code", erro.code, "ORDERS_HTTP_ERROR");
    eq("4: statusCode 502", erro.statusCode, 502);
    eq("4: mlStatus 429", erro.mlStatus, 429);
    eq("4: attempts no erro", erro.attempts, svc.ORDERS_MAX_ATTEMPTS);
  }

  // 5. Erros permanentes (401/403/404/400) → UMA chamada, nenhuma espera.
  for (const status of [401, 403, 404, 400]) {
    const { mlFetchFn, chamadas } = stubMlFetch([http(status), pagina([1], 1)]);
    const { sleepFn, esperas } = sleepSpy();
    let erro = null;
    try {
      await svc.fetchAllOrders(7, "seller7", "2026-09-01", "2026-09-23", { mlFetchFn, sleepFn });
    } catch (err) { erro = err; }
    eq(`5.${status}: 1 chamada`, chamadas.length, 1);
    eq(`5.${status}: sem espera`, esperas.length, 0);
    eq(`5.${status}: code`, erro && erro.code, "ORDERS_HTTP_ERROR");
    eq(`5.${status}: statusCode`, erro.statusCode, status === 401 || status === 403 ? 422 : 502);
  }

  // 6. Erro de grant do mlTokenService (permanente) → propaga sem retry.
  {
    const grantErr = new Error("Grant revogado.");
    grantErr.code = "ML_GRANT_REVOKED";
    grantErr.statusCode = 422;
    const { mlFetchFn, chamadas } = stubMlFetch([{ throw: grantErr }, pagina([1], 1)]);
    const { sleepFn, esperas } = sleepSpy();
    let erro = null;
    try {
      await svc.fetchAllOrders(7, "seller7", "2026-09-01", "2026-09-23", { mlFetchFn, sleepFn });
    } catch (err) { erro = err; }
    ok("6: mesmo erro propagado", erro === grantErr);
    eq("6: 1 chamada", chamadas.length, 1);
    eq("6: sem espera", esperas.length, 0);
  }

  // 7. Erro de rede transitório (fetch failed / ECONNRESET) → retry e sucesso.
  {
    const { mlFetchFn, chamadas } = stubMlFetch([{ throw: erroRede("ECONNRESET") }, pagina([5], 1)]);
    const { sleepFn, esperas } = sleepSpy();
    const { data } = await svc.fetchAllOrders(7, "seller7", "2026-09-01", "2026-09-23", { mlFetchFn, sleepFn });
    eq("7: 2 chamadas", chamadas.length, 2);
    eq("7: 1 espera", esperas.length, 1);
    eq("7: pedido", data.length, 1);
  }

  // 8. Timeout persistente → limitado, propaga o erro original no fim.
  {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    const { mlFetchFn, chamadas } = stubMlFetch([{ throw: timeout }]);
    const { sleepFn } = sleepSpy();
    let erro = null;
    try {
      await svc.fetchAllOrders(7, "seller7", "2026-09-01", "2026-09-23", { mlFetchFn, sleepFn });
    } catch (err) { erro = err; }
    ok("8: erro original", erro === timeout);
    eq("8: limitado a ORDERS_MAX_ATTEMPTS", chamadas.length, svc.ORDERS_MAX_ATTEMPTS);
  }

  // 9. Retry-After absurdo é capado (30s) — nunca trava o cron por minutos.
  {
    eq("9: cap Retry-After", svc.ordersBackoffDelayMs(1, 600), 30000);
    ok("9: sem Retry-After usa exponencial com teto", svc.ordersBackoffDelayMs(10, null) <= 8000);
  }

  // 10. 429 no MEIO da paginação: página 2 falha, retry, e o resultado é o
  //     mesmo de uma paginação sem erro (sem duplicar, sem perder pedido).
  {
    const ids1 = Array.from({ length: 50 }, (_, k) => 100 + k);
    const ids2 = [200, 201, 202];
    const { mlFetchFn, chamadas } = stubMlFetch([pagina(ids1, 53), http(429, 1), pagina(ids2, 53)]);
    const { sleepFn } = sleepSpy();
    const { data, completeness } = await svc.fetchAllOrders(7, "seller7", "2026-09-01", "2026-09-23", { mlFetchFn, sleepFn });
    eq("10: 3 chamadas", chamadas.length, 3);
    ok("10: offset da página repetida é o mesmo", chamadas[1].path === chamadas[2].path && chamadas[1].path.includes("offset=50"));
    eq("10: 53 pedidos", data.length, 53);
    ok("10: completo", completeness.complete === true);
    eq("10: pagesReceived conta só páginas recebidas", completeness.pagesReceived, 2);
  }

  // 11. Classificação de erro transitório.
  {
    const abort = new Error("aborted"); abort.name = "AbortError";
    ok("11: AbortError transitório", svc.isErroTransitorioDeRede(abort));
    ok("11: ETIMEDOUT transitório", svc.isErroTransitorioDeRede(erroRede("ETIMEDOUT")));
    const refresh = new Error("refresh falhou"); refresh.code = "ML_REFRESH_FAILED";
    ok("11: ML_* permanente", !svc.isErroTransitorioDeRede(refresh));
    const http422 = new Error("x"); http422.statusCode = 422;
    ok("11: statusCode permanente", !svc.isErroTransitorioDeRede(http422));
    ok("11: erro genérico permanente", !svc.isErroTransitorioDeRede(new Error("boom")));
  }

  // 12. Identidade congelada preservada no retry e nenhum segredo em log.
  {
    const { mlFetchFn, chamadas } = stubMlFetch([http(429), pagina([1], 1)]);
    const { sleepFn } = sleepSpy();
    const { linhas } = await capturarWarn(() =>
      svc.fetchAllOrders(7, "seller7", "2026-09-01", "2026-09-23", { mlFetchFn, sleepFn })
    );
    ok("12: toda chamada usa mlUserId da conta", chamadas.every((c) => c.options && c.options.mlUserId === "seller7"));
    ok("12: retry logado", linhas.some((l) => l.includes("orders retry")));
    ok("12: log sem segredo", linhas.every((l) => !/bearer|access_token|refresh_token|authorization|secret/i.test(l)));
  }

  console.log(`centralVendasOrdersRetry.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
