/*
 * F5 — Otimizador de Precificação ML (automacoes.html) migrado para o
 * Shell V3.
 *
 * O lote de Portal/vf-shell-f5-lote-ui.test.js prova a troca de shell. O que
 * SÓ este teste prova é o comportamento que a migração mudou de verdade: o
 * cliente deixou de vir de um <select> próprio e passa a vir do contexto
 * global. Isso cria três situações que não existiam antes e que só um
 * navegador de verdade separa:
 *
 *   1. o cliente do contexto EXISTE na lista de automações → prontidão real;
 *   2. o cliente do contexto NÃO está na lista (sem grant ML, por exemplo) →
 *      precisa dizer isso, e não parecer "ainda carregando" nem afirmar um
 *      diagnóstico que não foi feito;
 *   3. a lista de prontidão FALHOU → "não sei", que é diferente das duas.
 *
 * Mais a troca de cliente pelo dropdown do Shell, sem recarregar a página.
 *
 * Escopo CLIENTE, não conta: nenhuma rota de automacoesRoutes.js aceita
 * conta (o seam é requireClienteNaCarteira sobre `clienteSlug`).
 */
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const PORTAL_DIR = __dirname;
const PROD_HOST = "venforce-server.onrender.com";

const N97 = { id: 87, nome: "N97 Comercial", slug: "n97", ativo: true, temGrant: true, grantStatus: "conectado", temBase: true, setupScore: 100, statusOperacional: "pronto", ultimaSincronizacao: null, pendencias: [] };
const EXTRA = { id: 88, nome: "Extra Máquinas", slug: "extra", ativo: true, temGrant: true, grantStatus: "conectado", temBase: true, setupScore: 100, statusOperacional: "pronto", ultimaSincronizacao: null, pendencias: [] };
const SEM_ML = { id: 89, nome: "Só Shopee", slug: "so-shopee", ativo: true, temGrant: false, grantStatus: "ausente", temBase: true, setupScore: 50, statusOperacional: "atencao", ultimaSincronizacao: null, pendencias: ["sem_grant"] };

const CONTAS = {
  n97: [{ id: 42, cliente_id: 87, marketplace: "meli", nome: "Mercado Livre", ativo: true, grant: { token_status: "valid" }, base: { base_id: 9, nome: "Custo" } }],
  extra: [{ id: 51, cliente_id: 88, marketplace: "meli", nome: "Mercado Livre", ativo: true, grant: { token_status: "valid" }, base: { base_id: 11, nome: "Custo Extra" } }],
  "so-shopee": [{ id: 60, cliente_id: 89, marketplace: "shopee", nome: "Shopee", ativo: true, grant: null, base: { base_id: 14, nome: "Custo Shopee" } }],
};

const ME_CONTEXT = {
  ok: true,
  user: { id: 12, nome: "Pedro Gomes", email: null, role: "user" },
  squads: [], squadPrincipalId: null,
  clientes: [N97, EXTRA, SEM_ML].map((c) => ({ id: c.id, slug: c.slug, nome: c.nome, squadId: null, responsavelDireto: false, contasAtivas: 1 })),
  portfolio: { totalClientes: 3 },
  permissoes: { podeAdministrar: false },
};

/* Shape real de GET /automacoes/clientes (automacoesController.js:127-144).
   `so-shopee` está FORA da lista de propósito: é o cliente do contexto que
   as automações não conhecem. */
const AUTOMACOES_CLIENTES = {
  ok: true,
  clientes: [
    { id: 87, nome: "N97 Comercial", slug: "n97", ativo: true, hasGrantMl: true, mlUserId: "182993004", baseMeli: "custo-2026", baseMeliNome: "Custo 2026", baseMeliUpdatedAt: "2026-08-20T10:00:00Z", baseStatus: "ok", basesMeliCount: 1, prontoParaAnalise: true, prontoParaExportacaoCrua: true },
    { id: 88, nome: "Extra Máquinas", slug: "extra", ativo: true, hasGrantMl: true, mlUserId: "119847221", baseMeli: null, baseMeliNome: null, baseMeliUpdatedAt: null, baseStatus: "ausente", basesMeliCount: 0, prontoParaAnalise: false, prontoParaExportacaoCrua: true },
  ],
};

let automacoesFalham = false;

const SEMENTE = `
  try {
    localStorage.setItem("vf-token", "automacoes-ui-token");
    localStorage.setItem("vf-user", JSON.stringify({ id: 12, nome: "Pedro Gomes", role: "user" }));
    sessionStorage.removeItem("vf-ctx");
  } catch (e) {}
`;

function startServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    const target = path.resolve(PORTAL_DIR, u.pathname.replace(/^\/+/, ""));
    if (!target.startsWith(path.resolve(PORTAL_DIR) + path.sep)) { res.writeHead(403).end("forbidden"); return; }
    fs.readFile(target, (err, contents) => {
      if (err) { res.writeHead(404).end("not found"); return; }
      const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
      res.writeHead(200, { "Content-Type": types[path.extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(contents);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitChrome(port) {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return; } catch (_) { /* aguardando */ }
    await sleep(50);
  }
  throw new Error("Chrome DevTools não iniciou.");
}

class Cdp {
  constructor(url) { this.socket = new WebSocket(url); this.nextId = 1; this.pending = new Map(); this.onEvent = null; }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const m = JSON.parse(event.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
        return;
      }
      if (m.method && this.onEvent) this.onEvent(m.method, m.params);
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Falha na avaliação do navegador");
    return result.result.value;
  }
  close() { this.socket.close(); }
}

async function waitFor(cdp, expression, message) {
  for (let i = 0; i < 200; i++) {
    let ok = false;
    try { ok = await cdp.evaluate(`Boolean(${expression})`); } catch (_) { ok = false; }
    if (ok) return;
    await sleep(50);
  }
  throw new Error(message || `Timeout: ${expression}`);
}

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

function wireInterception(cdp) {
  const excecoes = [];
  const respond = async (m, p) => {
    try { await cdp.send(m, p); } catch (err) { if (!/Invalid InterceptionId/.test(err.message || "")) throw err; }
  };
  cdp.onEvent = async (method, params) => {
    if (method === "Runtime.exceptionThrown") {
      excecoes.push(`${params?.exceptionDetails?.text || ""} ${params?.exceptionDetails?.exception?.description || ""}`.trim());
    }
    if (method !== "Fetch.requestPaused") return;
    const url = params.request.url;
    if (!url.includes(PROD_HOST)) { await respond("Fetch.continueRequest", { requestId: params.requestId }); return; }
    const cors = [
      { name: "access-control-allow-origin", value: "*" },
      { name: "access-control-allow-headers", value: "authorization,content-type" },
      { name: "access-control-allow-methods", value: "GET,POST,OPTIONS" },
    ];
    if (params.request.method === "OPTIONS") { await respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 204, responseHeaders: cors }); return; }
    const json = (obj) => respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 200, responseHeaders: [...cors, { name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(obj)).toString("base64") });

    if (url.includes("/me/context")) { await json(ME_CONTEXT); return; }
    if (url.includes("/operacao/cliente-360/clientes")) { await json({ ok: true, clientes: [N97, EXTRA, SEM_ML] }); return; }
    const contas = url.match(/\/clientes\/([^/?]+)\/contas/);
    if (contas) {
      const slug = decodeURIComponent(contas[1]);
      await json({ ok: true, cliente: { id: 1, nome: slug, slug, ativo: true }, contas: CONTAS[slug] || [] });
      return;
    }
    if (url.includes("/automacoes/clientes")) {
      if (automacoesFalham) { await respond("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" }); return; }
      await json(AUTOMACOES_CLIENTES);
      return;
    }
    await respond("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" });
  };
  return excecoes;
}

async function run() {
  const server = await startServer();
  const porta = server.address().port;
  const debugPort = 20000 + Math.floor(Math.random() * 900);
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/vf-automacoes-ui-${process.pid}`, "about:blank",
  ], { stdio: "ignore" });

  let cdp;
  try {
    await waitChrome(debugPort);
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })).json();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SEMENTE });
    const excecoes = wireInterception(cdp);

    async function abrir(qs) {
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/automacoes.html${qs}` });
      await waitFor(cdp, "document.querySelector('.vf-shell__sidebar')", "Shell V3 não montou");
      await sleep(400); // contexto + GET /automacoes/clientes resolvem
    }

    /* ═══ 1. cliente do contexto, pronto para análise ═══════════════════ */
    await abrir("?cliente=n97");

    await check("F5 — o seletor local de Cliente sumiu: quem escolhe é o Shell", async () => {
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#auto-cliente, #auto-cliente-search').length"), 0,
        "o <select> de cliente da própria tela ainda existe — contexto duplicado");
      assert.ok(await cdp.evaluate("Boolean(document.getElementById('vf-cliente-trigger'))"), "o seletor do Shell deveria estar presente");
    });

    await check("F5 — o cliente exibido é o do contexto, e a prontidão real aparece (grant + base)", async () => {
      assert.strictEqual(await cdp.evaluate("document.getElementById('auto-cliente-nome').textContent.trim()"), "N97 Comercial");
      assert.strictEqual(await cdp.evaluate("document.getElementById('auto-readiness').hidden"), false);
      assert.strictEqual(await cdp.evaluate("document.getElementById('rd-grant').textContent.trim()"), "Conectado");
      assert.strictEqual(await cdp.evaluate("document.getElementById('rd-base').textContent.trim()"), "Custo 2026");
      assert.strictEqual(await cdp.evaluate("document.getElementById('rd-status').textContent.trim()"), "Pronto");
      assert.strictEqual(await cdp.evaluate("document.getElementById('btn-otimizador-analisar').disabled"), false);
    });

    /* ═══ 2. troca de cliente pelo Shell, sem recarregar ════════════════ */
    await check("F5 — trocar de cliente no dropdown do Shell reavalia a prontidão sem recarregar a página", async () => {
      await cdp.evaluate("window.__marca = 1"); // some se a página recarregar
      await cdp.evaluate("window.VF.context.setCliente('extra')");
      await waitFor(cdp, "document.getElementById('auto-cliente-nome').textContent.trim() === 'Extra Máquinas'", "a tela não acompanhou a troca de cliente");
      assert.strictEqual(await cdp.evaluate("window.__marca"), 1, "a página recarregou — a troca de cliente deveria ser reativa");
      // Extra tem grant mas nenhuma base: análise bloqueada, planilha liberada.
      assert.strictEqual(await cdp.evaluate("document.getElementById('rd-base').textContent.trim()"), "Nenhuma vinculada");
      assert.strictEqual(await cdp.evaluate("document.getElementById('btn-otimizador-analisar').disabled"), true);
      assert.strictEqual(await cdp.evaluate("document.getElementById('btn-baixar-planilha-precificacao').disabled"), false);
      const banner = await cdp.evaluate("document.getElementById('auto-state-banner').innerText");
      assert.ok(/sem base MELI vinculada/i.test(banner), `banner esperado sobre base ausente, veio: ${banner}`);
    });

    /* ═══ 3. cliente do contexto que as automações NÃO conhecem ═════════ */
    await check("F5 — cliente fora da lista de automações: diz isso, sem afirmar um diagnóstico que não fez", async () => {
      await cdp.evaluate("window.VF.context.setCliente('so-shopee')");
      await waitFor(cdp, "document.getElementById('auto-cliente-nome').textContent.trim() === 'Só Shopee'", "a tela não acompanhou a troca para o cliente sem automações");
      await sleep(150);
      assert.strictEqual(await cdp.evaluate("document.getElementById('auto-readiness').hidden"), true,
        "não há prontidão para exibir — nenhuma linha pode fingir um valor");
      const banner = await cdp.evaluate("document.getElementById('auto-state-banner').innerText");
      assert.ok(/não aparece na lista de automações/i.test(banner), `esperado o aviso de cliente não habilitado, veio: ${banner}`);
      assert.ok(!/sem grant ML/i.test(banner), `"sem grant ML" é um diagnóstico que esta tela não fez: ${banner}`);
      assert.strictEqual(await cdp.evaluate("document.getElementById('btn-otimizador-analisar').disabled"), true);
    });

    /* ═══ 4. sem cliente no contexto: o Shell bloqueia, a tela não mente ═ */
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/automacoes.html` });
    await waitFor(cdp, "document.querySelector('.vf-shell__sidebar')", "Shell V3 não montou");
    await sleep(300);

    await check("F5 — sem cliente no contexto: escopo client bloqueia o conteúdo e pede o cliente", async () => {
      assert.strictEqual(await cdp.evaluate("document.getElementById('vf-shell-main').hidden"), true);
      assert.strictEqual(await cdp.evaluate("document.body.classList.contains('vf-shell-blocked')"), true);
      const estado = await cdp.evaluate("document.querySelector('.vf-shell__state').innerText");
      assert.ok(/Selecione um cliente/i.test(estado), `estado do shell inesperado: ${estado}`);
    });

    /* ═══ 5. lista de prontidão fora do ar: "não sei" ≠ "não está pronto" ═ */
    automacoesFalham = true;
    await abrir("?cliente=n97");

    await check("F5 — /automacoes/clientes fora do ar: a tela diz que não sabe, em vez de fingir 'não pronto'", async () => {
      const banner = await cdp.evaluate("document.getElementById('auto-state-banner').innerText");
      assert.ok(/Prontidão indisponível/i.test(banner), `esperado o estado de "não sei", veio: ${banner}`);
      assert.strictEqual(await cdp.evaluate("document.getElementById('auto-readiness').hidden"), true);
      assert.strictEqual(await cdp.evaluate("document.getElementById('btn-otimizador-analisar').disabled"), true);
      // O nome do cliente vem do contexto, não da lista que caiu.
      assert.strictEqual(await cdp.evaluate("document.getElementById('auto-cliente-nome').textContent.trim()"), "N97 Comercial");
    });
    automacoesFalham = false;

    await check("F5 — nenhuma exceção de JS não tratada em nenhum cenário", async () => {
      const relevantes = excecoes.filter((m) => !/Failed to fetch|NetworkError|ERR_/i.test(m));
      assert.deepStrictEqual(relevantes, [], `exceções: ${JSON.stringify(relevantes)}`);
    });

    console.log(`\n✓ ${checks} verificações do Otimizador de Precificação ML migrado (F5)`);
  } finally {
    if (cdp) cdp.close();
    chrome.kill("SIGTERM");
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
