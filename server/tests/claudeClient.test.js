// server/tests/claudeClient.test.js
//
// Hardening do client Claude (server/services/ai/claudeClient.js) e da
// camada gerarJSON (server/services/ai/aiProvider.js). Sem rede: `fetch`
// global é substituído por um stub.
//
// O que este teste protege:
//
//  1. `temperature` só vai para modelo que aceita — modelos novos devolvem
//     400 quando recebem parâmetros de amostragem. Modelo desconhecido cai
//     no lado seguro (não envia);
//  2. resposta cortada no limite de tokens vira AI_RESPONSE_TRUNCATED, e não
//     o genérico JSON_INVALIDO;
//  3. JSON malformado, HTTP 4xx, 5xx, timeout e rede são distinguíveis;
//  4. retry: no máximo 1, só em 429/5xx/rede. Nunca em 4xx funcional,
//     nunca em timeout, nunca depois de resposta válida da IA.

process.env.ANTHROPIC_API_KEY = "test-key";
delete process.env.ANTHROPIC_MODEL;

const assert = require("assert");
const claudeClient = require("../services/ai/claudeClient");
const aiProvider = require("../services/ai/aiProvider");

// Espera entre tentativas: zero em teste, mas registrada.
const esperas = [];
claudeClient._deps.sleep = async (ms) => { esperas.push(ms); };

const http = require("http");
const fetchNativo = global.fetch;

let chamadas = [];
let roteiro = []; // uma função por chamada esperada

global.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  chamadas.push({ url, body, headers: init.headers, init });
  const passo = roteiro.shift();
  if (!passo) throw new Error("fetch chamado mais vezes que o roteiro previa");
  return passo(init);
};

function respostaOk(data, { status = 200 } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => data,
  });
}
function respostaErro(status, { retryAfter = null, mensagem = "erro" } = {}) {
  return async () => ({
    ok: false,
    status,
    headers: { get: (h) => (h.toLowerCase() === "retry-after" ? retryAfter : null) },
    json: async () => ({ type: "error", error: { type: "x", message: mensagem } }),
  });
}
function textoIa(texto, stop_reason = "end_turn") {
  return respostaOk({
    content: [{ type: "text", text: texto }],
    stop_reason,
    usage: { input_tokens: 10, output_tokens: 20 },
  });
}
function timeout() {
  return async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; };
}
function falhaRede() {
  return async () => { throw new TypeError("fetch failed"); };
}
// F6.2: headers chegam na hora, o body demora `ms`. `respeitaSinal` imita o
// fetch nativo (abortar rejeita o json()); sem ele, o json() ignora o sinal.
function bodyLento(ms, data, { status = 200, respeitaSinal = false } = {}) {
  return async (init) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(data), ms);
      if (respeitaSinal) init.signal.addEventListener("abort", () => {
        clearTimeout(t);
        const e = new Error("This operation was aborted"); e.name = "AbortError"; reject(e);
      }, { once: true });
    }),
  });
}
const DADOS_OK = { content: [{ type: "text", text: '{"a":1}' }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function reset(passos) {
  chamadas = [];
  esperas.length = 0;
  roteiro = passos.slice();
}

let falhas = 0;
async function check(nome, fn) {
  try { await fn(); console.log("  ✓ " + nome); }
  catch (e) { falhas++; console.error("  ✗ " + nome + "\n    " + (e.stack || e.message)); }
}

(async () => {
  console.log("claudeClient / aiProvider.gerarJSON");

  // ── parâmetros por modelo ─────────────────────────────────────────────────
  await check("15a — allowlist de temperature: aceita default e geração ≤ 4.6, omite o resto", () => {
    const aceita = [
      "claude-haiku-4-5-20251001", "claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-6",
      "claude-sonnet-4-5", "claude-opus-4-1-20250805", "claude-sonnet-4-20250514", "claude-opus-4",
      "claude-3-5-sonnet-20241022", "claude-3-haiku-20240307",
    ];
    const omite = [
      "claude-opus-4-7", "claude-opus-4-8", "claude-opus-5", "claude-opus-5-5", "claude-sonnet-5",
      "claude-sonnet-5-5", "claude-fable-5-1", "claude-mythos-5-1", "gpt-4o", "", null, "claude-haiku-5",
    ];
    for (const m of aceita) assert.strictEqual(claudeClient.aceitaTemperature(m), true, "deveria aceitar: " + m);
    for (const m of omite) assert.strictEqual(claudeClient.aceitaTemperature(m), false, "deveria omitir: " + m);
  });

  await check("15b — corpo do modelo default (Haiku 4.5) mantém temperature 0.4 como antes", () => {
    const b = claudeClient.montarCorpo({ model: claudeClient.DEFAULT_MODEL, system: "S", prompt: "P", maxTokens: 1400 });
    assert.deepStrictEqual(b, {
      model: "claude-haiku-4-5-20251001", max_tokens: 1400,
      messages: [{ role: "user", content: "P" }], temperature: 0.4, system: "S",
    });
    const b2 = claudeClient.montarCorpo({ model: claudeClient.DEFAULT_MODEL, prompt: "P", temperature: 0.1 });
    assert.strictEqual(b2.temperature, 0.1);
    assert.strictEqual(b2.max_tokens, 1500);
    assert.ok(!("system" in b2));
  });

  await check("15c — ANTHROPIC_MODEL de geração nova: request sai SEM temperature", async () => {
    process.env.ANTHROPIC_MODEL = "claude-sonnet-5-5";
    try {
      reset([textoIa('{"a":1}')]);
      const r = await aiProvider.gerarJSON({ system: "S", prompt: "P", maxTokens: 100, temperature: 0.4 });
      assert.strictEqual(r.ok, true);
      assert.ok(!("temperature" in chamadas[0].body), "temperature foi enviado para claude-sonnet-5-5");
      assert.strictEqual(chamadas[0].body.model, "claude-sonnet-5-5");
    } finally {
      delete process.env.ANTHROPIC_MODEL;
    }
  });

  // ── respostas ─────────────────────────────────────────────────────────────
  await check("9 — resposta JSON válida (inclusive embrulhada em ```json)", async () => {
    reset([textoIa('```json\n{"titulo_sugerido":"X","n":2}\n```')]);
    const r = await aiProvider.gerarJSON({ prompt: "P" });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.data, { titulo_sugerido: "X", n: 2 });
    assert.strictEqual(r.provider, "anthropic");
    assert.deepStrictEqual(r.usage, { input_tokens: 10, output_tokens: 20 });
    assert.strictEqual(chamadas.length, 1);
    assert.strictEqual(chamadas[0].headers["x-api-key"], "test-key");
  });

  await check("10 — resposta completa mas malformada → JSON_INVALIDO (sem retry)", async () => {
    reset([textoIa('{"titulo_sugerido": "X",, }')]);
    const r = await aiProvider.gerarJSON({ prompt: "P" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, "JSON_INVALIDO");
    assert.strictEqual(chamadas.length, 1, "não pode repetir depois de resposta da IA");
  });

  await check("11 — stop_reason max_tokens → AI_RESPONSE_TRUNCATED (não JSON_INVALIDO)", async () => {
    reset([textoIa('{"descricao_sugerida": "Texto que foi corta', "max_tokens")]);
    const r = await aiProvider.gerarJSON({ prompt: "P" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, "AI_RESPONSE_TRUNCATED");
    assert.ok(/cortada/.test(r.erro));
    assert.strictEqual(chamadas.length, 1, "truncamento não é repetido");
  });

  await check("11b — truncado mesmo que o texto parcial pareça JSON válido", async () => {
    reset([textoIa('{"a":1}', "max_tokens")]);
    const r = await aiProvider.gerarJSON({ prompt: "P" });
    assert.strictEqual(r.codigo, "AI_RESPONSE_TRUNCATED");
  });

  await check("11c — gerarTexto preserva o contrato: texto parcial + stopReason", async () => {
    reset([textoIa("parcial", "max_tokens")]);
    const r = await aiProvider.gerarTexto({ prompt: "P" });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.texto, "parcial");
    assert.strictEqual(r.stopReason, "max_tokens");
  });

  await check("12 — timeout → TIMEOUT, sem retry", async () => {
    reset([timeout()]);
    const r = await aiProvider.gerarJSON({ prompt: "P" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, "TIMEOUT");
    assert.strictEqual(chamadas.length, 1, "timeout não pode ser repetido (dobraria a espera)");
    assert.strictEqual(r.tentativas, 1);
  });

  // ── F6.2: o timeout cobre a leitura do body ───────────────────────────────
  const TETO = 60;
  await check("12b — body lento após headers (json ignora o sinal) → TIMEOUT no teto, sem retry", async () => {
    claudeClient._deps.timeoutMs = TETO;
    try {
      reset([bodyLento(2000, DADOS_OK)]);
      const t0 = Date.now();
      const r = await aiProvider.gerarJSON({ prompt: "P" });
      const dt = Date.now() - t0;
      assert.deepStrictEqual([r.ok, r.codigo, r.tentativas, chamadas.length], [false, "TIMEOUT", 1, 1]);
      assert.ok(dt < 1000, "esperou o body inteiro (" + dt + " ms)");
      assert.ok(chamadas[0].init.signal.aborted, "sinal abortado no teto");
      assert.strictEqual(r.provider, "anthropic");
    } finally { claudeClient._deps.timeoutMs = claudeClient.TIMEOUT_MS; }
  });

  await check("12c — body lento com json que respeita o sinal (fetch nativo) → TIMEOUT", async () => {
    claudeClient._deps.timeoutMs = TETO;
    try {
      reset([bodyLento(2000, DADOS_OK, { respeitaSinal: true })]);
      const r = await claudeClient.gerarTexto({ prompt: "P" });
      assert.deepStrictEqual([r.ok, r.codigo, r.tentativas, r.provider], [false, "TIMEOUT", 1, "anthropic"]);
    } finally { claudeClient._deps.timeoutMs = claudeClient.TIMEOUT_MS; }
  });

  await check("12d — body dentro do prazo → ok, e o timer é desligado depois", async () => {
    claudeClient._deps.timeoutMs = TETO;
    try {
      reset([bodyLento(10, DADOS_OK)]);
      const r = await claudeClient.gerarTexto({ prompt: "P" });
      assert.deepStrictEqual([r.ok, r.tentativas], [true, 1]);
      await esperar(TETO * 2);
      assert.strictEqual(chamadas[0].init.signal.aborted, false, "timer sobrou ligado após o sucesso");
    } finally { claudeClient._deps.timeoutMs = claudeClient.TIMEOUT_MS; }
  });

  await check("12e — body de erro lento (529) → HTTP_529 no teto, retry preservado com teto novo", async () => {
    claudeClient._deps.timeoutMs = TETO;
    try {
      reset([bodyLento(2000, { error: { message: "x" } }, { status: 529 }), bodyLento(10, DADOS_OK)]);
      const t0 = Date.now();
      const r = await claudeClient.gerarTexto({ prompt: "P" });
      assert.deepStrictEqual([r.ok, r.tentativas, chamadas.length, esperas], [true, 2, 2, [1000]]);
      assert.ok(Date.now() - t0 < 1000);
      assert.strictEqual(chamadas[1].init.signal.aborted, false, "2ª tentativa tem timer próprio");
      reset([bodyLento(2000, {}, { status: 400 })]);
      const r2 = await aiProvider.gerarJSON({ prompt: "P" });
      assert.deepStrictEqual([r2.codigo, chamadas.length], ["HTTP_400", 1]);
    } finally { claudeClient._deps.timeoutMs = claudeClient.TIMEOUT_MS; }
  });

  await check("12f — fetch nativo real: servidor manda headers e segura o body → TIMEOUT", async () => {
    const sockets = new Set();
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write('{"content":[');
      res.flushHeaders();
      // o resto do body nunca chega dentro do teto
    });
    srv.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const porta = srv.address().port;
    const fetchStub = global.fetch;
    let headersRecebidos = false;
    global.fetch = async (url, init) => {
      const resp = await fetchNativo("http://127.0.0.1:" + porta + "/", init);
      headersRecebidos = true;
      return resp;
    };
    claudeClient._deps.timeoutMs = 300;
    try {
      const t0 = Date.now();
      const r = await claudeClient.gerarTexto({ prompt: "P" });
      const dt = Date.now() - t0;
      assert.ok(headersRecebidos, "headers deveriam ter chegado antes do teto");
      assert.deepStrictEqual([r.ok, r.codigo, r.tentativas], [false, "TIMEOUT", 1]);
      assert.ok(dt >= 250 && dt < 2000, "tempo fora do teto: " + dt + " ms");
    } finally {
      claudeClient._deps.timeoutMs = claudeClient.TIMEOUT_MS;
      global.fetch = fetchStub;
      for (const s of sockets) s.destroy();
      await new Promise((r) => srv.close(r));
    }
  });

  await check("13 — 4xx funcional (400/401/404) → HTTP_<status>, sem retry", async () => {
    for (const status of [400, 401, 403, 404, 413]) {
      reset([respostaErro(status, { mensagem: "bad" })]);
      const r = await aiProvider.gerarJSON({ prompt: "P" });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.codigo, "HTTP_" + status);
      assert.ok(r.erro.includes(String(status)) && r.erro.includes("bad"));
      assert.strictEqual(chamadas.length, 1, "4xx " + status + " foi repetido");
      assert.ok(!("retryAfterSeg" in r), "campo interno vazou no retorno");
    }
  });

  await check("14 — 5xx seguido de sucesso: 1 retry e devolve a resposta", async () => {
    reset([respostaErro(529), textoIa('{"ok":true}')]);
    const r = await aiProvider.gerarJSON({ prompt: "P" });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.data, { ok: true });
    assert.strictEqual(chamadas.length, 2);
    assert.deepStrictEqual(esperas, [1000]);
  });

  await check("14b — 5xx persistente: para em 2 tentativas e devolve HTTP_5xx", async () => {
    reset([respostaErro(500), respostaErro(503)]);
    const r = await aiProvider.gerarJSON({ prompt: "P" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, "HTTP_503");
    assert.strictEqual(chamadas.length, 2, "mais de 1 retry");
  });

  await check("14c — 429 respeita retry-after (com teto de 5s)", async () => {
    reset([respostaErro(429, { retryAfter: "2" }), textoIa('{"a":1}')]);
    let r = await aiProvider.gerarJSON({ prompt: "P" });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(esperas, [2000]);
    reset([respostaErro(429, { retryAfter: "120" }), respostaErro(429)]);
    r = await aiProvider.gerarJSON({ prompt: "P" });
    assert.strictEqual(r.codigo, "HTTP_429");
    assert.deepStrictEqual(esperas, [5000]);
  });

  await check("14d — falha de rede: 1 retry", async () => {
    reset([falhaRede(), textoIa('{"a":1}')]);
    const r = await aiProvider.gerarJSON({ prompt: "P" });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(chamadas.length, 2);
  });

  await check("14e — o body do retry é o mesmo da 1ª tentativa", async () => {
    reset([respostaErro(502), textoIa('{"a":1}')]);
    await aiProvider.gerarJSON({ system: "S", prompt: "P", maxTokens: 77 });
    assert.deepStrictEqual(chamadas[0].body, chamadas[1].body);
  });

  await check("resposta vazia → EMPTY_RESPONSE, sem retry", async () => {
    reset([respostaOk({ content: [], stop_reason: "end_turn" })]);
    const r = await aiProvider.gerarJSON({ prompt: "P" });
    assert.strictEqual(r.codigo, "EMPTY_RESPONSE");
    assert.strictEqual(chamadas.length, 1);
  });

  await check("sem ANTHROPIC_API_KEY → NO_API_KEY, sem fetch", async () => {
    const chave = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      reset([]);
      const r = await aiProvider.gerarJSON({ prompt: "P" });
      assert.strictEqual(r.codigo, "NO_API_KEY");
      assert.strictEqual(chamadas.length, 0);
    } finally {
      process.env.ANTHROPIC_API_KEY = chave;
    }
  });

  if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1); }
  console.log("\n✓ claudeClient ok");
})();
