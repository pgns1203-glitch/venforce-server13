// server/tests/marginSnapshotRetry.test.js
// Margin Snapshot — política de retry por lote (M3) e listagem do catálogo
// por scan (meliApiEvidenceAdapter.listarIdsCatalogo). Sem rede: o fetch do
// ML é sempre um fake injetado.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const {
  classificarErroDeLote,
  calcularBackoffMs,
  esperar,
  executarComRetry,
  MarginSnapshotStopError,
} = require("../services/motorMargem/marginSnapshotRetry");
const { resolveMarginSnapshotConfig } = require("../services/motorMargem/marginSnapshotConfig");
const meliApi = require("../services/motorMargem/adapters/meliApiEvidenceAdapter");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

function erro(props) {
  return Object.assign(new Error(props.message || "falha"), props);
}

const CONFIG = { ...resolveMarginSnapshotConfig({}), batchMaxAttempts: 4, batchBackoffBaseMs: 1000, batchBackoffMaxMs: 3000, retryAfterMaxMs: 60000 };

// ── Classificação ─────────────────────────────────────────────────────────

cenario("429 com Retry-After é recuperável, conta como rate limit e respeita o tempo pedido", () => {
  const c = classificarErroDeLote(erro({ statusCode: 502, mlStatus: 429, retryAfter: 12 }));
  assert.deepStrictEqual({ retryable: c.retryable, rateLimited: c.rateLimited, retryAfterMs: c.retryAfterMs, status: c.status },
    { retryable: true, rateLimited: true, retryAfterMs: 12000, status: 429 });
});

cenario("mlStatus (status real do ML) tem precedência sobre o statusCode mapeado pelo adapter", () => {
  assert.strictEqual(classificarErroDeLote(erro({ statusCode: 502, mlStatus: 404 })).retryable, false);
  assert.strictEqual(classificarErroDeLote(erro({ statusCode: 502, mlStatus: 503 })).retryable, true);
});

cenario("5xx/408/429 sem Retry-After são recuperáveis; 4xx (auth 422, 400, 404) não", () => {
  for (const s of [500, 502, 503, 408, 429]) assert.strictEqual(classificarErroDeLote(erro({ statusCode: s })).retryable, true, `status ${s}`);
  for (const s of [400, 404, 422]) assert.strictEqual(classificarErroDeLote(erro({ statusCode: s })).retryable, false, `status ${s}`);
});

cenario("erro sem status (rede/timeout) é recuperável — sempre limitado pelo máximo de tentativas", () => {
  assert.strictEqual(classificarErroDeLote(new TypeError("fetch failed")).retryable, true);
});

cenario("backoff exponencial com teto", () => {
  assert.deepStrictEqual([1, 2, 3, 4, 5].map((t) => calcularBackoffMs(t, CONFIG)), [1000, 2000, 3000, 3000, 3000]);
});

// ── executarComRetry ──────────────────────────────────────────────────────

cenario("sucesso após falhas recuperáveis: devolve o valor e quantas tentativas levou", async () => {
  const sleeps = [];
  let n = 0;
  const r = await executarComRetry(async () => {
    n += 1;
    if (n < 3) throw erro({ statusCode: 502 });
    return "ok";
  }, { config: CONFIG, sleep: async (ms) => sleeps.push(ms) });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, "ok");
  assert.strictEqual(r.attempts, 3);
  assert.deepStrictEqual(sleeps, [1000, 2000]);
});

cenario("máximo de tentativas: nunca passa de batchMaxAttempts (sem loop infinito)", async () => {
  let n = 0;
  const sleeps = [];
  const r = await executarComRetry(async () => { n += 1; throw erro({ statusCode: 503 }); },
    { config: CONFIG, sleep: async (ms) => sleeps.push(ms) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "TENTATIVAS_ESGOTADAS");
  assert.strictEqual(n, 4);
  assert.deepStrictEqual(sleeps, [1000, 2000, 3000]);
});

cenario("não recuperável: 1 tentativa só, sem sleep", async () => {
  let n = 0;
  const sleeps = [];
  const r = await executarComRetry(async () => { n += 1; throw erro({ statusCode: 422 }); },
    { config: CONFIG, sleep: async (ms) => sleeps.push(ms) });
  assert.strictEqual(r.motivo, "NAO_RECUPERAVEL");
  assert.strictEqual(n, 1);
  assert.deepStrictEqual(sleeps, []);
});

cenario("Retry-After acima do teto: desiste em vez de dormir além do limite", async () => {
  const sleeps = [];
  const r = await executarComRetry(async () => { throw erro({ mlStatus: 429, retryAfter: 3600 }); },
    { config: CONFIG, sleep: async (ms) => sleeps.push(ms) });
  assert.strictEqual(r.motivo, "RETRY_AFTER_EXCEDE_LIMITE");
  assert.deepStrictEqual(sleeps, []);
});

cenario("abort durante a espera: lança MarginSnapshotStopError (parada cooperativa)", async () => {
  const controller = new AbortController();
  await assert.rejects(
    () => executarComRetry(async () => { throw erro({ statusCode: 502 }); }, {
      config: CONFIG,
      signal: controller.signal,
      sleep: async () => { controller.abort(); },
    }),
    (err) => err instanceof MarginSnapshotStopError
  );
});

cenario("esperar(): timer real curto resolve; abort resolve na hora e limpa o timer", async () => {
  const t0 = Date.now();
  await esperar(20);
  assert.ok(Date.now() - t0 >= 15);

  const controller = new AbortController();
  const t1 = Date.now();
  const p = esperar(60000, controller.signal);
  controller.abort();
  await p;
  assert.ok(Date.now() - t1 < 1000, "abort não espera os 60s");
});

// ── Listagem do catálogo por scan ─────────────────────────────────────────

function fakeFetch(respostasPorStatus) {
  const chamadas = [];
  const fn = async (clienteId, pathQuery, options) => {
    chamadas.push({ clienteId, path: pathQuery, options });
    const status = new URLSearchParams(pathQuery.split("?")[1]).get("status");
    const fila = respostasPorStatus[status];
    const proxima = fila.shift();
    return typeof proxima === "function" ? proxima() : proxima;
  };
  return { fn, chamadas };
}

cenario("listarIdsCatalogo: scan de ativos + pausados via scroll_id, ordem estável e sem repetir id", async () => {
  const { fn, chamadas } = fakeFetch({
    active: [
      { ok: true, status: 200, data: { results: ["MLB1", "MLB2"], scroll_id: "s1" } },
      { ok: true, status: 200, data: { results: ["MLB3"], scroll_id: "s1" } },
      { ok: true, status: 200, data: { results: [], scroll_id: "s1" } },
    ],
    paused: [
      { ok: true, status: 200, data: { results: ["MLB9", "MLB3"], scroll_id: null } },
    ],
  });
  const r = await meliApi.listarIdsCatalogo({ clienteId: 1, mlUserId: "77", maxItens: 100 }, fn);
  assert.deepStrictEqual(r.ids, ["MLB1", "MLB2", "MLB3", "MLB9"]);
  assert.ok(chamadas.every((c) => c.path.startsWith("/users/77/items/search?") && c.path.includes("search_type=scan")));
  assert.ok(chamadas.every((c) => c.options.mlUserId === "77"), "path seller-scoped sempre com mlUserId (conta certa)");
  assert.ok(!chamadas.some((c) => /offset=/.test(c.path)), "scan nunca usa offset (limite de 1000 do ML)");
  assert.ok(chamadas[1].path.includes("scroll_id=s1"));
});

cenario("listarIdsCatalogo: >1000 itens atravessa o limite de offset do ML (scan)", async () => {
  const paginas = [];
  for (let p = 0; p < 13; p += 1) {
    paginas.push({ ok: true, status: 200, data: { results: Array.from({ length: 100 }, (_, i) => `MLB${p * 100 + i}`), scroll_id: "s" } });
  }
  paginas.push({ ok: true, status: 200, data: { results: [], scroll_id: "s" } });
  const { fn } = fakeFetch({ active: paginas, paused: [{ ok: true, status: 200, data: { results: [] } }] });
  const r = await meliApi.listarIdsCatalogo({ clienteId: 1, mlUserId: "77", maxItens: 20000 }, fn);
  assert.strictEqual(r.ids.length, 1300);
});

cenario("listarIdsCatalogo: erro do ML carrega mlStatus e retryAfter (sem dormir nem re-tentar no adapter)", async () => {
  const { fn, chamadas } = fakeFetch({
    active: [{ ok: false, status: 429, retryAfter: 30, data: { message: "too many requests" } }],
    paused: [],
  });
  await assert.rejects(
    () => meliApi.listarIdsCatalogo({ clienteId: 1, mlUserId: "77" }, fn),
    (err) => err.mlStatus === 429 && err.retryAfter === 30 && err.statusCode === 502
  );
  assert.strictEqual(chamadas.length, 1, "o adapter não re-tenta: quem decide é o worker");
});

cenario("listarIdsCatalogo: catálogo acima do teto falha explicitamente (nunca trunca em silêncio)", async () => {
  const { fn } = fakeFetch({
    active: [{ ok: true, status: 200, data: { results: ["A", "B", "C"], scroll_id: "s" } }],
    paused: [],
  });
  await assert.rejects(
    () => meliApi.listarIdsCatalogo({ clienteId: 1, mlUserId: "77", maxItens: 2 }, fn),
    (err) => err.code === "MARGIN_SNAPSHOT_CATALOGO_EXCEDE_TETO"
  );
});

async function main() {
  let falhas = 0;
  for (const caso of casos) {
    try {
      await caso.fn();
      console.log(`  ✓ ${caso.nome}`);
    } catch (err) {
      falhas += 1;
      console.error(`  ✗ ${caso.nome}\n    ${err.stack || err.message}`);
    }
  }
  if (falhas > 0) {
    console.error(`marginSnapshotRetry: ${falhas} de ${casos.length} cenários falharam`);
    process.exitCode = 1;
  } else {
    console.log(`marginSnapshotRetry: ok (${casos.length} cenários)`);
  }
}

main();
