// server/tests/aiProvider.test.js
// -----------------------------------------------------------------------------
// F6 — contrato do aiProvider: task → modelo (aiTasks), metadata interna e log
// seguro. Sem rede: `fetch` é simulado; nenhuma chamada real à Anthropic.
// Retry/timeout/temperature do client continuam cobertos em claudeClient.test.js;
// aqui só se prova que a task não muda essa política.
//
// Rodar: node tests/aiProvider.test.js
// -----------------------------------------------------------------------------

const ENVS = ["ANTHROPIC_MODEL", "AI_SEO_TITLE_MODEL", "AI_SEO_DESCRIPTION_MODEL", "AI_PROVIDER"];
for (const k of ENVS) delete process.env[k];
process.env.ANTHROPIC_API_KEY = "sk-teste-secreta";

const assert = require("assert");
const claudeClient = require("../services/ai/claudeClient");
const aiProvider = require("../services/ai/aiProvider");
const { AI_TASKS, ENV_MODELO_POR_TASK, modeloDaTask } = require("../services/ai/aiTasks");

claudeClient._deps.sleep = async () => {};
let relogio = 1000;
aiProvider._deps.agora = () => relogio;
let logs = [];
aiProvider._deps.log = (l) => logs.push(l);

let chamadas = [];
let roteiro = [];
global.fetch = async (url, init) => {
  chamadas.push({ url, body: JSON.parse(init.body), headers: init.headers });
  const passo = roteiro.shift();
  if (!passo) throw new Error("fetch chamado mais vezes que o roteiro previa");
  return passo();
};
const resposta = (data, status = 200) => async () => {
  relogio += 250; // cada ida à API "leva" 250 ms
  return { ok: status < 300, status, headers: { get: () => null }, json: async () => data };
};
const ok = (texto, extra = {}) => resposta({
  content: [{ type: "text", text: texto }], stop_reason: "end_turn",
  usage: { input_tokens: 12, output_tokens: 34 }, ...extra,
});
const timeout = () => async () => { relogio += 45000; const e = new Error("aborted"); e.name = "AbortError"; throw e; };

function reset(passos, env = {}) {
  for (const k of ENVS) delete process.env[k];
  Object.assign(process.env, env);
  chamadas = []; logs = []; roteiro = passos.slice();
}

let falhas = 0;
async function check(nome, fn) {
  try { await fn(); console.log("  ✓ " + nome); }
  catch (e) { falhas++; console.error("  ✗ " + nome + "\n    " + (e.stack || e.message)); }
}

(async () => {
  console.log("aiProvider (F6)");

  await check("tasks centralizadas: seo_title, seo_description, legacy_optimizer (congeladas)", () => {
    assert.deepStrictEqual({ ...AI_TASKS }, { SEO_TITLE: "seo_title", SEO_DESCRIPTION: "seo_description", LEGACY_OPTIMIZER: "legacy_optimizer" });
    assert.ok(Object.isFrozen(AI_TASKS));
    assert.deepStrictEqual({ ...ENV_MODELO_POR_TASK }, { seo_title: "AI_SEO_TITLE_MODEL", seo_description: "AI_SEO_DESCRIPTION_MODEL" });
  });

  // ── Resolução de modelo ─────────────────────────────────────────────────
  await check("1 — sem env nova: toda task usa ANTHROPIC_MODEL", () => {
    reset([], { ANTHROPIC_MODEL: "claude-haiku-4-5" });
    for (const t of Object.values(AI_TASKS)) {
      assert.deepStrictEqual(aiProvider.resolverModelo(t), { provider: "anthropic", model: "claude-haiku-4-5", origem: "ANTHROPIC_MODEL" }, t);
    }
  });

  await check("2 — seo_title com modelo específico usa o específico (e só ele)", () => {
    reset([], { ANTHROPIC_MODEL: "claude-haiku-4-5", AI_SEO_TITLE_MODEL: "claude-sonnet-5-5" });
    assert.deepStrictEqual(aiProvider.resolverModelo(AI_TASKS.SEO_TITLE), { provider: "anthropic", model: "claude-sonnet-5-5", origem: "AI_SEO_TITLE_MODEL" });
    assert.strictEqual(aiProvider.resolverModelo(AI_TASKS.SEO_DESCRIPTION).model, "claude-haiku-4-5");
  });

  await check("3 — seo_description com modelo específico usa o específico (e só ele)", () => {
    reset([], { AI_SEO_DESCRIPTION_MODEL: "claude-opus-5-5" });
    assert.deepStrictEqual(aiProvider.resolverModelo(AI_TASKS.SEO_DESCRIPTION), { provider: "anthropic", model: "claude-opus-5-5", origem: "AI_SEO_DESCRIPTION_MODEL" });
    assert.strictEqual(aiProvider.resolverModelo(AI_TASKS.SEO_TITLE).origem, "DEFAULT_MODEL");
  });

  await check("4 — modelo específico vence ANTHROPIC_MODEL; env vazia/só espaços é ignorada", () => {
    reset([], { ANTHROPIC_MODEL: "claude-haiku-4-5", AI_SEO_TITLE_MODEL: "  claude-sonnet-5-5  " });
    assert.strictEqual(aiProvider.resolverModelo(AI_TASKS.SEO_TITLE).model, "claude-sonnet-5-5");
    reset([], { ANTHROPIC_MODEL: "claude-haiku-4-5", AI_SEO_TITLE_MODEL: "   " });
    assert.deepStrictEqual(aiProvider.resolverModelo(AI_TASKS.SEO_TITLE), { provider: "anthropic", model: "claude-haiku-4-5", origem: "ANTHROPIC_MODEL" });
  });

  await check("5 — não existe AI_DEFAULT_MODEL: o default é ANTHROPIC_MODEL (decisão documentada)", () => {
    reset([], { AI_DEFAULT_MODEL: "claude-opus-5-5" });
    try {
      assert.strictEqual(aiProvider.resolverModelo(AI_TASKS.SEO_TITLE).model, claudeClient.DEFAULT_MODEL);
    } finally { delete process.env.AI_DEFAULT_MODEL; }
  });

  await check("6 — sem nenhuma configuração: Haiku atual do projeto (claude-haiku-4-5-20251001)", () => {
    reset([]);
    assert.strictEqual(claudeClient.DEFAULT_MODEL, "claude-haiku-4-5-20251001");
    for (const t of [...Object.values(AI_TASKS), undefined]) {
      assert.deepStrictEqual(aiProvider.resolverModelo(t), { provider: "anthropic", model: "claude-haiku-4-5-20251001", origem: "DEFAULT_MODEL" });
    }
    assert.strictEqual(aiProvider.modeloAtual(), claudeClient.getModel(), "modeloAtual() sem task = comportamento antigo");
  });

  await check("7 — task desconhecida: padrão do provedor, nunca env derivada do nome", async () => {
    reset([ok('{"a":1}')], { AI_SEO_TITLE_MODEL: "claude-sonnet-5-5", AI_TASK_X_MODEL: "claude-opus-5-5" });
    try {
      assert.strictEqual(modeloDaTask("task_x"), null);
      assert.strictEqual(modeloDaTask("SEO_TITLE"), null, "nome da constante não é task");
      const r = await aiProvider.gerarJSON({ task: "task_x", prompt: "P" });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(chamadas[0].body.model, "claude-haiku-4-5-20251001");
      assert.strictEqual(r.meta.task, null);
    } finally { delete process.env.AI_TASK_X_MODEL; }
  });

  // ── AI_PROVIDER: só ausente/vazio/anthropic; o resto é erro explícito ────
  for (const [rotulo, env] of [["A — ausente", {}], ["B — vazio", { AI_PROVIDER: "" }], ["C — só espaços", { AI_PROVIDER: "   " }], ["D — anthropic", { AI_PROVIDER: "anthropic" }]]) {
    await check(`AI_PROVIDER ${rotulo} → Anthropic, request igual ao de sempre`, async () => {
      reset([ok('{"a":1}')], env);
      assert.strictEqual(aiProvider.provedorAtual(), "anthropic");
      const r = await aiProvider.gerarJSON({ task: AI_TASKS.SEO_TITLE, prompt: "P", temperature: 0.7 });
      assert.deepStrictEqual([r.ok, r.provider, r.model, chamadas.length], [true, "anthropic", "claude-haiku-4-5-20251001", 1]);
      assert.strictEqual(chamadas[0].body.temperature, 0.7);
    });
  }

  for (const [rotulo, valor] of [["E — openai", "openai"], ["F — typo antropic", "antropic"]]) {
    await check(`AI_PROVIDER ${rotulo} → AI_PROVIDER_INVALID, nenhuma chamada sai`, async () => {
      reset([], { AI_PROVIDER: valor });
      const r = await aiProvider.gerarJSON({ task: AI_TASKS.SEO_DESCRIPTION, prompt: "P" });
      assert.deepStrictEqual([r.ok, r.codigo, r.provider, r.model], [false, "AI_PROVIDER_INVALID", null, null]);
      assert.strictEqual(chamadas.length, 0, "nada pode chegar ao claudeClient/fetch");
      assert.deepStrictEqual([r.meta.status, r.meta.codigo, r.meta.latencyMs, r.meta.tentativas], ["erro", "AI_PROVIDER_INVALID", null, 0]);
      const t = await aiProvider.gerarTexto({ task: AI_TASKS.SEO_TITLE, prompt: "P" });
      assert.strictEqual(t.codigo, "AI_PROVIDER_INVALID");
      assert.strictEqual(chamadas.length, 0);
      assert.throws(() => aiProvider.provedorAtual(), (e) => e.codigo === "AI_PROVIDER_INVALID");
      assert.throws(() => aiProvider.resolverModelo(AI_TASKS.SEO_TITLE), (e) => e.codigo === "AI_PROVIDER_INVALID");
    });
  }

  await check("G — erro de provider não carrega chave, prompt, conteúdo nem o valor configurado", async () => {
    reset([], { AI_PROVIDER: "sk-colado-por-engano" });
    const r = await aiProvider.gerarJSON({ task: AI_TASKS.SEO_DESCRIPTION, system: "SYSTEM-SIGILOSO", prompt: "PROMPT-COM-DADOS-DO-ANUNCIO" });
    const tudo = JSON.stringify(r) + " " + logs.join(" ");
    assert.ok(!/sk-teste|sk-colado|SIGILOSO|PROMPT-COM/.test(tudo), tudo);
    assert.ok(!("raw" in r));
    assert.strictEqual(logs.length, 1);
    assert.ok(logs[0].includes("codigo=AI_PROVIDER_INVALID") && logs[0].includes("provider=-"));
  });

  // ── O modelo resolvido chega ao request ────────────────────────────────
  await check("task chega ao request: seo_title → modelo da task; legado → ANTHROPIC_MODEL", async () => {
    reset([ok('{"a":1}'), ok('{"a":1}')], { ANTHROPIC_MODEL: "claude-haiku-4-5", AI_SEO_TITLE_MODEL: "claude-haiku-4-5-20251001" });
    await aiProvider.gerarJSON({ task: AI_TASKS.SEO_TITLE, prompt: "P" });
    await aiProvider.gerarJSON({ task: AI_TASKS.LEGACY_OPTIMIZER, prompt: "P" });
    assert.deepStrictEqual(chamadas.map((c) => c.body.model), ["claude-haiku-4-5-20251001", "claude-haiku-4-5"]);
  });

  await check("temperature segue o modelo EFETIVO da task (geração nova → omitida; Haiku → enviada)", async () => {
    reset([ok('{"a":1}'), ok('{"a":1}')], { AI_SEO_DESCRIPTION_MODEL: "claude-sonnet-5-5" });
    await aiProvider.gerarJSON({ task: AI_TASKS.SEO_DESCRIPTION, prompt: "P", temperature: 0.6 });
    await aiProvider.gerarJSON({ task: AI_TASKS.SEO_TITLE, prompt: "P", temperature: 0.7 });
    assert.ok(!("temperature" in chamadas[0].body), "Sonnet 5.5 não aceita temperature");
    assert.strictEqual(chamadas[1].body.temperature, 0.7);
  });

  await check("request idêntico ao de antes da F6 quando não há env nova", async () => {
    reset([ok('{"a":1}')]);
    await aiProvider.gerarJSON({ task: AI_TASKS.SEO_TITLE, system: "S", prompt: "P", maxTokens: 1200, temperature: 0.7 });
    const esperado = claudeClient.montarCorpo({ model: claudeClient.getModel(), system: "S", prompt: "P", maxTokens: 1200, temperature: 0.7 });
    assert.deepStrictEqual(chamadas[0].body, esperado);
    assert.ok(!("task" in chamadas[0].body), "task é interna, não vai para a Anthropic");
  });

  // ── Metadata ───────────────────────────────────────────────────────────
  await check("meta de sucesso: provider, model, latência medida, usage normalizado, finishReason", async () => {
    reset([ok('{"a":1}')]);
    const r = await aiProvider.gerarJSON({ task: AI_TASKS.SEO_DESCRIPTION, prompt: "P" });
    assert.deepStrictEqual(r.meta, {
      task: "seo_description", provider: "anthropic", model: "claude-haiku-4-5-20251001", latencyMs: 250,
      usage: { inputTokens: 12, outputTokens: 34 }, finishReason: "end_turn", tentativas: 1, status: "ok", codigo: null,
    });
    // campos antigos intactos (o legado persiste usage cru)
    assert.deepStrictEqual([r.provider, r.model, r.usage], ["anthropic", "claude-haiku-4-5-20251001", { input_tokens: 12, output_tokens: 34 }]);
  });

  await check("meta: o que a API não devolveu é null, nunca 0", async () => {
    reset([resposta({ content: [{ type: "text", text: '{"a":1}' }] })]);
    const r = await aiProvider.gerarJSON({ task: AI_TASKS.SEO_TITLE, prompt: "P" });
    assert.deepStrictEqual(r.meta.usage, { inputTokens: null, outputTokens: null });
    assert.strictEqual(r.meta.finishReason, null);
    reset([ok('{"a":1}', { usage: { input_tokens: 5 } })]);
    const r2 = await aiProvider.gerarJSON({ task: AI_TASKS.SEO_TITLE, prompt: "P" });
    assert.deepStrictEqual(r2.meta.usage, { inputTokens: 5, outputTokens: null });
  });

  await check("meta de erro: NO_API_KEY sem chamada → latencyMs null, tentativas 0", async () => {
    const chave = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      reset([]);
      const r = await aiProvider.gerarJSON({ task: AI_TASKS.SEO_TITLE, prompt: "P" });
      assert.strictEqual(r.codigo, "NO_API_KEY");
      assert.strictEqual(chamadas.length, 0);
      assert.deepStrictEqual([r.meta.status, r.meta.codigo, r.meta.latencyMs, r.meta.tentativas], ["erro", "NO_API_KEY", null, 0]);
    } finally { process.env.ANTHROPIC_API_KEY = chave; }
  });

  await check("meta de erro: truncamento e JSON inválido levam o código final da camada", async () => {
    reset([ok('{"a":', { stop_reason: "max_tokens" }), ok("não é json")]);
    const t = await aiProvider.gerarJSON({ task: AI_TASKS.SEO_DESCRIPTION, prompt: "P" });
    const j = await aiProvider.gerarJSON({ task: AI_TASKS.SEO_DESCRIPTION, prompt: "P" });
    assert.deepStrictEqual([t.codigo, t.meta.codigo, t.meta.finishReason], ["AI_RESPONSE_TRUNCATED", "AI_RESPONSE_TRUNCATED", "max_tokens"]);
    assert.deepStrictEqual([j.codigo, j.meta.codigo, j.meta.usage.inputTokens], ["JSON_INVALIDO", "JSON_INVALIDO", 12]);
    assert.strictEqual(chamadas.length, 2, "nenhum dos dois é repetido");
  });

  // ── Retry / timeout inalterados com task ───────────────────────────────
  await check("retry: 529 → 1 nova tentativa (máx. 2); latência cobre as duas", async () => {
    reset([resposta({ error: { message: "Overloaded" } }, 529), ok('{"a":1}')]);
    const r = await aiProvider.gerarJSON({ task: AI_TASKS.SEO_TITLE, prompt: "P" });
    assert.deepStrictEqual([r.ok, chamadas.length, r.meta.tentativas, r.meta.latencyMs], [true, 2, 2, 500]);
  });

  await check("timeout continua sem retry (1 chamada) e vira TIMEOUT", async () => {
    reset([timeout()]);
    const r = await aiProvider.gerarJSON({ task: AI_TASKS.SEO_DESCRIPTION, prompt: "P" });
    assert.deepStrictEqual([r.codigo, chamadas.length, r.meta.tentativas], ["TIMEOUT", 1, 1]);
    assert.strictEqual(claudeClient.TIMEOUT_MS, 45000);
    assert.strictEqual(claudeClient.MAX_TENTATIVAS, 2);
  });

  // ── Log ────────────────────────────────────────────────────────────────
  await check("log: 1 linha por geração, só campos seguros (sem prompt, texto, chave)", async () => {
    reset([ok('{"descricao":"TEXTO-GERADO-SIGILOSO"}')]);
    await aiProvider.gerarJSON({ task: AI_TASKS.SEO_DESCRIPTION, system: "SYSTEM-SIGILOSO", prompt: "PROMPT-COM-DADOS-DO-ANUNCIO" });
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0],
      "[ai] task=seo_description provider=anthropic model=claude-haiku-4-5-20251001 status=ok codigo=- " +
      "latencyMs=250 inputTokens=12 outputTokens=34 finishReason=end_turn tentativas=1");
    assert.ok(!/SIGILOSO|PROMPT|sk-teste/.test(logs[0]));
  });

  await check("log que lança não derruba a geração", async () => {
    reset([ok('{"a":1}')]);
    aiProvider._deps.log = () => { throw new Error("stdout fechado"); };
    try {
      const r = await aiProvider.gerarJSON({ task: AI_TASKS.SEO_TITLE, prompt: "P" });
      assert.strictEqual(r.ok, true);
    } finally { aiProvider._deps.log = (l) => logs.push(l); }
  });

  await check("gerarTexto também resolve pela task e devolve meta", async () => {
    reset([ok("texto livre")], { AI_SEO_TITLE_MODEL: "claude-haiku-4-5" });
    const r = await aiProvider.gerarTexto({ task: AI_TASKS.SEO_TITLE, prompt: "P" });
    assert.deepStrictEqual([r.ok, r.texto, r.model, r.meta.model, r.meta.task], [true, "texto livre", "claude-haiku-4-5", "claude-haiku-4-5", "seo_title"]);
    assert.strictEqual(logs.length, 1);
  });

  for (const k of ENVS) delete process.env[k];
  if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1); }
  console.log("\n✓ aiProvider ok");
})();
