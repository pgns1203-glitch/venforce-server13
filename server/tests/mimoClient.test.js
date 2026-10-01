// server/tests/mimoClient.test.js
// -----------------------------------------------------------------------------
// F6.1 — client da Xiaomi MiMo (server/services/ai/mimoClient.js), direto e
// através do aiProvider. Sem rede: `fetch` é simulado; nenhuma chamada real.
//
// Rodar: node tests/mimoClient.test.js
// -----------------------------------------------------------------------------

const ENVS = [
  "AI_PROVIDER", "AI_SEO_TITLE_PROVIDER", "AI_SEO_DESCRIPTION_PROVIDER",
  "AI_SEO_TITLE_MODEL", "AI_SEO_DESCRIPTION_MODEL", "MIMO_MODEL", "ANTHROPIC_MODEL",
];
for (const k of ENVS) delete process.env[k];
const CHAVE = "mimo-chave-secreta-de-teste";
process.env.MIMO_API_KEY = CHAVE;
delete process.env.ANTHROPIC_API_KEY;

const assert = require("assert");
const mimoClient = require("../services/ai/mimoClient");
const aiProvider = require("../services/ai/aiProvider");
const { AI_TASKS } = require("../services/ai/aiTasks");

const esperas = [];
mimoClient._deps.sleep = async (ms) => { esperas.push(ms); };
let logs = [];
aiProvider._deps.log = (l) => logs.push(l);

let chamadas = [];
let roteiro = [];
global.fetch = async (url, init) => {
  chamadas.push({ url, init, body: JSON.parse(init.body), headers: init.headers });
  const passo = roteiro.shift();
  if (!passo) throw new Error("fetch chamado mais vezes que o roteiro previa");
  return passo(init);
};
const respostaOk = (data) => async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => data });
const respostaErro = (status, { retryAfter = null, mensagem = "erro" } = {}) => async () => ({
  ok: false, status,
  headers: { get: (h) => (h.toLowerCase() === "retry-after" ? retryAfter : null) },
  json: async () => ({ type: "error", error: { type: "x", message: mensagem } }),
});
const textoIa = (texto, stop_reason = "end_turn", extra = {}) => respostaOk({
  id: "msg_1", type: "message", role: "assistant", model: "mimo-v2.6-pro",
  content: [{ type: "text", text: texto }], stop_reason,
  usage: { input_tokens: 101, output_tokens: 57, cache_read_input_tokens: null }, ...extra,
});
const timeout = () => async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; };
const falhaRede = () => async () => { throw new TypeError("fetch failed"); };

function reset(passos, env = {}) {
  for (const k of ENVS) delete process.env[k];
  Object.assign(process.env, env);
  chamadas = []; logs = []; esperas.length = 0; roteiro = passos.slice();
}
const MIMO = { AI_SEO_TITLE_PROVIDER: "mimo", AI_SEO_DESCRIPTION_PROVIDER: "mimo" };
const json = (opts = {}) => aiProvider.gerarJSON({ task: AI_TASKS.SEO_TITLE, system: "S", prompt: "P", maxTokens: 1200, temperature: 0.7, ...opts });

let falhas = 0;
async function check(nome, fn) {
  try { await fn(); console.log("  ✓ " + nome); }
  catch (e) { falhas++; console.error("  ✗ " + nome + "\n    " + (e.stack || e.message)); }
}

(async () => {
  console.log("mimoClient (F6.1)");

  await check("sem MIMO_API_KEY → NO_API_KEY, nenhum fetch, provider mimo", async () => {
    delete process.env.MIMO_API_KEY;
    try {
      reset([], MIMO);
      const r = await json();
      assert.deepStrictEqual([r.ok, r.codigo, r.provider, r.model, chamadas.length], [false, "NO_API_KEY", "mimo", "mimo-v2.6-pro", 0]);
      assert.ok(/MIMO_API_KEY/.test(r.erro));
      assert.deepStrictEqual([r.meta.latencyMs, r.meta.tentativas], [null, 0]);
    } finally { process.env.MIMO_API_KEY = CHAVE; }
  });

  await check("ANTHROPIC_API_KEY não serve de chave para a MiMo (e vice-versa)", async () => {
    delete process.env.MIMO_API_KEY;
    process.env.ANTHROPIC_API_KEY = "chave-da-anthropic";
    try {
      reset([], MIMO);
      const r = await json();
      assert.strictEqual(r.codigo, "NO_API_KEY");
      assert.strictEqual(chamadas.length, 0);
    } finally { process.env.MIMO_API_KEY = CHAVE; delete process.env.ANTHROPIC_API_KEY; }
  });

  await check("request: URL oficial pay-as-you-go, header api-key, sem x-api-key/anthropic-version", async () => {
    reset([textoIa('{"titulos":[]}')], MIMO);
    await json();
    const c = chamadas[0];
    assert.strictEqual(c.url, "https://api.xiaomimimo.com/anthropic/v1/messages");
    assert.strictEqual(c.init.method, "POST");
    assert.deepStrictEqual(c.headers, { "Content-Type": "application/json", "api-key": CHAVE });
  });

  await check("corpo: model, max_tokens, system, messages e thinking DESLIGADO", async () => {
    reset([textoIa('{"titulos":[]}')], MIMO);
    await json();
    assert.deepStrictEqual(chamadas[0].body, {
      model: "mimo-v2.6-pro", max_tokens: 1200,
      messages: [{ role: "user", content: "P" }],
      thinking: { type: "disabled" }, temperature: 0.7, system: "S",
    });
  });

  await check("temperature: enviada (thinking off), limitada a [0, 1.5]; sem número = default da MiMo", () => {
    const b = (t) => mimoClient.montarCorpo({ model: "mimo-v2.6-pro", prompt: "P", temperature: t });
    assert.strictEqual(b(0.6).temperature, 0.6);
    assert.strictEqual(b(0).temperature, 0);
    assert.strictEqual(b(2).temperature, 1.5);
    assert.strictEqual(b(-1).temperature, 0);
    assert.ok(!("temperature" in b(undefined)));
    assert.ok(!("temperature" in b(NaN)));
    assert.deepStrictEqual(b(0.6).thinking, { type: "disabled" });
    assert.ok(!("top_p" in b(0.6)));
  });

  await check("modelo: MIMO_MODEL → mimo-v2.6-pro; modelo da task vence MIMO_MODEL", async () => {
    reset([textoIa("{}"), textoIa("{}"), textoIa("{}")], { ...MIMO, MIMO_MODEL: "mimo-v2.6-flash" });
    await json();
    process.env.AI_SEO_TITLE_MODEL = "mimo-v2.6-pro-ultraspeed";
    await json();
    delete process.env.MIMO_MODEL; delete process.env.AI_SEO_TITLE_MODEL;
    await json();
    assert.deepStrictEqual(chamadas.map((c) => c.body.model), ["mimo-v2.6-flash", "mimo-v2.6-pro-ultraspeed", "mimo-v2.6-pro"]);
  });

  await check("ANTHROPIC_MODEL não vaza para a MiMo", async () => {
    reset([textoIa("{}")], { ...MIMO, ANTHROPIC_MODEL: "claude-haiku-4-5" });
    await json();
    assert.strictEqual(chamadas[0].body.model, "mimo-v2.6-pro");
  });

  await check("sucesso: JSON parseado, provider mimo, usage cru + meta normalizada", async () => {
    reset([textoIa('```json\n{"titulos":["A","B"]}\n```')], MIMO);
    const r = await json();
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.data, { titulos: ["A", "B"] });
    assert.deepStrictEqual([r.provider, r.model], ["mimo", "mimo-v2.6-pro"]);
    assert.deepStrictEqual(r.usage, { input_tokens: 101, output_tokens: 57, cache_read_input_tokens: null });
    assert.deepStrictEqual(
      { ...r.meta, latencyMs: typeof r.meta.latencyMs },
      { task: "seo_title", provider: "mimo", model: "mimo-v2.6-pro", latencyMs: "number",
        usage: { inputTokens: 101, outputTokens: 57 }, finishReason: "end_turn", tentativas: 1, status: "ok", codigo: null });
  });

  await check("bloco thinking na resposta é ignorado; só texto vira saída", async () => {
    reset([respostaOk({ content: [{ type: "thinking", thinking: "raciocínio" }, { type: "text", text: '{"a":1}' }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 2 } })], MIMO);
    const r = await json();
    assert.deepStrictEqual(r.data, { a: 1 });
  });

  await check("stop_reason max_tokens → AI_RESPONSE_TRUNCATED, sem retry", async () => {
    reset([textoIa('{"titulos":["A"', "max_tokens")], MIMO);
    const r = await json();
    assert.deepStrictEqual([r.codigo, r.meta.finishReason, chamadas.length], ["AI_RESPONSE_TRUNCATED", "max_tokens", 1]);
  });

  await check("stop_reason repetition_truncation (MiMo) → AI_RESPONSE_TRUNCATED, sem retry", async () => {
    reset([textoIa('{"titulos":["A","A","A"', "repetition_truncation")], MIMO);
    const r = await json();
    assert.deepStrictEqual([r.codigo, r.meta.finishReason, chamadas.length], ["AI_RESPONSE_TRUNCATED", "repetition_truncation", 1]);
  });

  await check("stop_reason content_filter → CONTENT_FILTER, sem retry", async () => {
    reset([textoIa("", "content_filter")], MIMO);
    const r = await json();
    assert.deepStrictEqual([r.ok, r.codigo, r.provider, chamadas.length], [false, "CONTENT_FILTER", "mimo", 1]);
  });

  await check("JSON inválido → JSON_INVALIDO, sem retry", async () => {
    reset([textoIa("isto não é json")], MIMO);
    const r = await json();
    assert.deepStrictEqual([r.codigo, chamadas.length, r.meta.codigo], ["JSON_INVALIDO", 1, "JSON_INVALIDO"]);
  });

  await check("resposta vazia → EMPTY_RESPONSE, sem retry", async () => {
    reset([respostaOk({ content: [], stop_reason: "end_turn" })], MIMO);
    const r = await json();
    assert.deepStrictEqual([r.codigo, chamadas.length], ["EMPTY_RESPONSE", 1]);
  });

  await check("429 → 1 retry (respeita Retry-After com teto de 5 s) e recupera", async () => {
    reset([respostaErro(429, { retryAfter: "30" }), textoIa('{"a":1}')], MIMO);
    const r = await json();
    assert.deepStrictEqual([r.ok, chamadas.length, r.meta.tentativas, esperas], [true, 2, 2, [5000]]);
    assert.deepStrictEqual(chamadas[0].body, chamadas[1].body, "retry reenvia o mesmo corpo");
  });

  await check("500 e 503 → 1 retry; persistindo, para em 2 tentativas", async () => {
    reset([respostaErro(500), textoIa('{"a":1}')], MIMO);
    const ok = await json();
    assert.deepStrictEqual([ok.ok, chamadas.length, esperas], [true, 2, [1000]]);
    reset([respostaErro(503), respostaErro(503)], MIMO);
    const r = await json();
    assert.deepStrictEqual([r.codigo, chamadas.length, r.meta.tentativas], ["HTTP_503", 2, 2]);
  });

  await check("4xx funcional (400, 401, 402, 403, 404, 421) → sem retry", async () => {
    for (const st of [400, 401, 402, 403, 404, 421]) {
      reset([respostaErro(st)], MIMO);
      const r = await json();
      assert.deepStrictEqual([r.codigo, chamadas.length], ["HTTP_" + st, 1], String(st));
    }
  });

  await check("falha de rede → 1 retry", async () => {
    reset([falhaRede(), textoIa('{"a":1}')], MIMO);
    const r = await json();
    assert.deepStrictEqual([r.ok, chamadas.length], [true, 2]);
    reset([falhaRede(), falhaRede()], MIMO);
    const r2 = await json();
    assert.deepStrictEqual([r2.codigo, chamadas.length], ["NETWORK", 2]);
  });

  await check("timeout → TIMEOUT, sem retry; mesmo teto do claudeClient (45 s × 2)", async () => {
    reset([timeout()], MIMO);
    const r = await json();
    assert.deepStrictEqual([r.codigo, chamadas.length], ["TIMEOUT", 1]);
    assert.ok(chamadas[0].init.signal, "fetch recebe AbortSignal");
    assert.deepStrictEqual([mimoClient.TIMEOUT_MS, mimoClient.MAX_TENTATIVAS], [45000, 2]);
  });

  await check("segredo nunca aparece em erro, retorno nem log", async () => {
    const passos = [respostaErro(401, { mensagem: "Invalid API Key" }), textoIa("x"), timeout(), textoIa('{"a":1}')];
    reset(passos, MIMO);
    const rs = [];
    for (let i = 0; i < passos.length; i++) rs.push(await json({ prompt: "PROMPT-COM-DADOS-DO-ANUNCIO" }));
    delete process.env.MIMO_API_KEY;
    rs.push(await json());
    process.env.MIMO_API_KEY = CHAVE;
    const tudo = JSON.stringify(rs) + " " + logs.join(" ");
    assert.ok(!tudo.includes(CHAVE), "chave vazou");
    assert.ok(!logs.join(" ").includes("PROMPT-COM"), "prompt foi para o log");
    assert.ok(logs.every((l) => l.includes("provider=mimo")));
  });

  await check("legacy_optimizer continua no Anthropic mesmo com AI_PROVIDER=mimo", async () => {
    reset([], { AI_PROVIDER: "mimo" });
    const r = await aiProvider.gerarJSON({ task: AI_TASKS.LEGACY_OPTIMIZER, prompt: "P" });
    assert.deepStrictEqual([r.provider, r.codigo, chamadas.length], ["anthropic", "NO_API_KEY", 0], "foi para o claudeClient (sem chave Anthropic)");
  });

  for (const k of ENVS) delete process.env[k];
  if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1); }
  console.log("\n✓ mimoClient ok");
})();
