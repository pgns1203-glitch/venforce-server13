// Prova a politica de retry/backoff/deadline/concorrencia da Central de
// Gestao Full: Retry-After em segundos e HTTP-date, sequencia 429->503->200
// com sleep injetado, ausencia de retry em 400/403/404, deadline cortando
// antes do teto de tentativas e um limite de concorrencia real.

const assert = require("assert");
const {
  isRetryableStatus,
  parseRetryAfterMs,
  computeBackoffDelayMs,
  executeWithRetry,
  createConcurrencyLimiter,
} = require("../services/full/fullRetry");

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function run() {
  // isRetryableStatus
  {
    assert.strictEqual(isRetryableStatus(429), true);
    assert.strictEqual(isRetryableStatus(500), true);
    assert.strictEqual(isRetryableStatus(502), true);
    assert.strictEqual(isRetryableStatus(503), true);
    assert.strictEqual(isRetryableStatus(504), true);
    assert.strictEqual(isRetryableStatus(400), false);
    assert.strictEqual(isRetryableStatus(401), false);
    assert.strictEqual(isRetryableStatus(403), false);
    assert.strictEqual(isRetryableStatus(404), false);
    console.log("  ✓ isRetryableStatus classifica 429/5xx como retryavel e 400/401/403/404 como definitivo");
  }

  // parseRetryAfterMs: segundos (string e numero), ausencia e invalido
  {
    assert.strictEqual(parseRetryAfterMs("30"), 30000);
    assert.strictEqual(parseRetryAfterMs(30), 30000, "mlFetch hoje devolve retryAfter numerico em segundos");
    assert.strictEqual(parseRetryAfterMs(null), null);
    assert.strictEqual(parseRetryAfterMs(undefined), null);
    assert.strictEqual(parseRetryAfterMs(""), null);
    assert.strictEqual(parseRetryAfterMs("nao-e-uma-data"), null);
    console.log("  ✓ parseRetryAfterMs interpreta segundos e trata ausencia/invalido como null");
  }

  // parseRetryAfterMs: HTTP-date (futuro e passado)
  {
    const nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const futureHeader = new Date(nowMs + 5000).toUTCString();
    const futureMs = parseRetryAfterMs(futureHeader, { nowMs });
    assert.ok(futureMs >= 4000 && futureMs <= 5000, `esperado ~5000ms, recebido ${futureMs}`);

    const pastHeader = new Date(nowMs - 5000).toUTCString();
    assert.strictEqual(parseRetryAfterMs(pastHeader, { nowMs }), 0, "data no passado nao pode virar delay negativo");
    console.log("  ✓ parseRetryAfterMs interpreta HTTP-date (futuro vira delay positivo, passado vira 0)");
  }

  // computeBackoffDelayMs: full jitter com cap
  {
    assert.strictEqual(computeBackoffDelayMs({ attempt: 0, baseMs: 100, capMs: 1000, randomFn: () => 0 }), 0);
    assert.strictEqual(computeBackoffDelayMs({ attempt: 0, baseMs: 100, capMs: 1000, randomFn: () => 1 }), 100);
    assert.strictEqual(computeBackoffDelayMs({ attempt: 3, baseMs: 100, capMs: 1000, randomFn: () => 1 }), 800);
    assert.strictEqual(
      computeBackoffDelayMs({ attempt: 10, baseMs: 100, capMs: 1000, randomFn: () => 1 }),
      1000,
      "exponencial muito grande deve ser limitado pelo cap"
    );
    assert.throws(() => computeBackoffDelayMs({ attempt: -1, baseMs: 100, capMs: 1000 }), TypeError);
    console.log("  ✓ computeBackoffDelayMs aplica full jitter e respeita o cap");
  }

  // executeWithRetry: 429 -> 503 -> 200, com sleep injetado (sem espera real)
  {
    let calls = 0;
    const sleeps = [];
    const sleepFn = async (ms) => sleeps.push(ms);

    const result = await executeWithRetry({
      attempt: async () => {
        calls += 1;
        if (calls === 1) return { ok: false, status: 429, data: null, retryAfterHeader: null };
        if (calls === 2) return { ok: false, status: 503, data: null, retryAfterHeader: null };
        return { ok: true, status: 200, data: { foo: 1 }, retryAfterHeader: null };
      },
      maxAttempts: 5,
      baseMs: 100,
      capMs: 1000,
      retryAfterCapMs: 5000,
      sleepFn,
      randomFn: () => 0.5,
    });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.data, { foo: 1 });
    assert.strictEqual(result.attempts, 3);
    assert.strictEqual(calls, 3);
    assert.strictEqual(sleeps.length, 2, "deve dormir entre a 1a->2a e a 2a->3a tentativa, nunca depois do sucesso");
    console.log("  ✓ 429 -> 503 -> 200 se recupera com sleep injetado, 3 tentativas");
  }

  // executeWithRetry: sem retry em 400/403/404, mesmo com orcamento sobrando
  {
    for (const status of [400, 403, 404]) {
      let calls = 0;
      const sleepFn = async () => { throw new Error("nao deveria dormir para " + status); };
      const result = await executeWithRetry({
        attempt: async () => {
          calls += 1;
          return { ok: false, status, data: null, retryAfterHeader: null };
        },
        maxAttempts: 5,
        baseMs: 100,
        capMs: 1000,
        retryAfterCapMs: 5000,
        sleepFn,
      });
      assert.strictEqual(calls, 1, `status ${status} nao pode ser retentado`);
      assert.strictEqual(result.attempts, 1);
      assert.strictEqual(result.exhausted, true);
    }
    console.log("  ✓ 400/403/404 nunca sao retentados, mesmo com maxAttempts>1");
  }

  // executeWithRetry: Retry-After em segundos e respeitado (limitado pelo cap)
  {
    const sleeps = [];
    let calls = 0;
    const result = await executeWithRetry({
      attempt: async () => {
        calls += 1;
        if (calls < 3) return { ok: false, status: 429, data: null, retryAfterHeader: "1" };
        return { ok: true, status: 200, data: null, retryAfterHeader: null };
      },
      maxAttempts: 5,
      baseMs: 100,
      capMs: 1000,
      retryAfterCapMs: 500,
      sleepFn: async (ms) => sleeps.push(ms),
    });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(sleeps, [500, 500], "1000ms de Retry-After deve ser limitado pelo retryAfterCapMs=500");
    console.log("  ✓ Retry-After em segundos e respeitado e limitado pelo teto configurado");
  }

  // executeWithRetry: deadline corta antes de esgotar maxAttempts
  {
    let time = 0;
    const nowFn = () => time;
    const sleeps = [];
    const sleepFn = async (ms) => { sleeps.push(ms); time += ms; };

    const result = await executeWithRetry({
      attempt: async () => ({ ok: false, status: 429, data: null, retryAfterHeader: "1" }),
      maxAttempts: 10,
      baseMs: 100,
      capMs: 1000,
      retryAfterCapMs: 100000,
      sleepFn,
      nowFn,
      deadlineMs: 2500,
    });

    assert.strictEqual(result.timedOut, true);
    assert.strictEqual(result.exhausted, true);
    assert.ok(result.attempts < 10, "deadline deve impedir de chegar ao teto de tentativas");
    assert.strictEqual(sleeps.length, 3, "3 tentativas de 1000ms cada devem esgotar o deadline de 2500ms");
    console.log("  ✓ deadline interrompe o retry antes de esgotar maxAttempts");
  }

  // createConcurrencyLimiter: nunca excede o limite configurado
  {
    const limiter = createConcurrencyLimiter(2);
    let active = 0;
    let maxActive = 0;
    const releasers = [];

    function makeTask(id) {
      return limiter(
        () =>
          new Promise((resolve) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            releasers.push(() => {
              active -= 1;
              resolve(id);
            });
          })
      );
    }

    const promise = Promise.all([1, 2, 3, 4, 5].map(makeTask));

    await flushMicrotasks();
    assert.strictEqual(active, 2, "so 2 tarefas devem estar ativas com concurrency=2");

    while (releasers.length > 0) {
      releasers.shift()();
      await flushMicrotasks();
    }

    const results = await promise;
    assert.deepStrictEqual(results, [1, 2, 3, 4, 5]);
    assert.strictEqual(maxActive, 2, "nunca deve exceder o limite de concorrencia configurado");
    console.log("  ✓ createConcurrencyLimiter nunca excede o limite configurado (limite de concorrencia real)");
  }

  console.log("fullRetry.test.js passed");
}

run();
