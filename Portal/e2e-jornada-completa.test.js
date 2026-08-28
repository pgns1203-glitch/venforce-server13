/*
 * E2E — jornada completa através de NAVEGAÇÃO REAL (clicar, não deep
 * link) entre as páginas migradas até F3.2:
 *
 *   Carteira → N97 → ML2 → Visão → Central de Vendas → Margem →
 *   Diagnósticos → Carteira (global, contexto preservado) → Extra
 *   Máquinas → Visão (contexto novo)
 *
 * F3.2 muda o destino padrão da Carteira de fechamentos-api.html para
 * visao.html (MASTER_SPEC §11 — Visão é a home operacional agora). A Visão
 * é a primeira ilha React sobre o Shell V3; sua própria chamada de dado
 * (GET /operacao/visao/:cliente) fica FALHADA de propósito aqui, mesmo
 * tratamento dos outros "motores" desta suíte.
 *
 * Cada teste anterior (vf-shell-ui, carteira-ui, fechamentos-api-shell-ui,
 * central-margem-ui, diagnostico-inicial-shell-ui) já prova que CADA
 * página, isoladamente, lê o contexto certo do Shell. O que só um teste
 * cross-page prova é que sessionStorage["vf-ctx"] carrega o contexto
 * corretamente de uma navegação REAL para a próxima — nenhuma delas usa
 * deep link aqui. As páginas de "motor" (Visão/Central de Vendas/Margem/
 * Diagnóstico) têm suas próprias chamadas de dado FALHADAS de propósito:
 * o que este teste mede é a continuidade do CONTEXTO entre navegações,
 * não a renderização de cada tela (já coberta nos testes específicos).
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

function grant(status) { return status ? { id: 900, token_status: status, is_primary: false } : null; }
function base(id, nome) { return { vinculo_id: 500 + id, base_id: id, slug: "base-" + id, nome, resolvido_por: "conta" }; }

const N97 = { id: 87, nome: "N97 Comercial", slug: "n97", ativo: true, temGrant: true, grantStatus: "conectado", temBase: true, setupScore: 100, statusOperacional: "pronto", ultimaSincronizacao: null, pendencias: [] };
const N97_CONTAS = [
  { id: 42, cliente_id: 87, marketplace: "meli", nome: "Mercado Livre 1", slug: "ml-1", external_account_id: "182993004", externalAccountLabel: "n97store", is_primary: true, ativo: true, grant: grant("valid"), base: base(9, "Custo 2026"), ultimaSync: null },
  { id: 43, cliente_id: 87, marketplace: "meli", nome: "Mercado Livre 2", slug: "ml-2", external_account_id: "204118872", externalAccountLabel: "n97outlet", is_primary: false, ativo: true, grant: grant("valid"), base: base(9, "Custo 2026"), ultimaSync: null },
];
const EXTRA = { id: 88, nome: "Extra Máquinas", slug: "extra", ativo: true, temGrant: true, grantStatus: "conectado", temBase: true, setupScore: 100, statusOperacional: "pronto", ultimaSincronizacao: null, pendencias: [] };
const EXTRA_CONTAS = [
  { id: 51, cliente_id: 88, marketplace: "meli", nome: "Mercado Livre", slug: "ml", external_account_id: "119847221", externalAccountLabel: "extramaquinas", is_primary: true, ativo: true, grant: grant("valid"), base: base(11, "Custo Extra"), ultimaSync: null },
];
const PORTFOLIO = { ok: true, clientes: [N97, EXTRA] };
const CONTAS = { n97: N97_CONTAS, extra: EXTRA_CONTAS };

function startServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    const target = path.resolve(PORTAL_DIR, u.pathname.replace(/^\/+/, ""));
    if (!target.startsWith(path.resolve(PORTAL_DIR) + path.sep)) { res.writeHead(403).end("forbidden"); return; }
    fs.readFile(target, (err, contents) => {
      if (err) { res.writeHead(404).end("not found"); return; }
      const ext = path.extname(target);
      const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
      res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "no-store" });
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
  for (let i = 0; i < 160; i++) {
    if (await cdp.evaluate(`Boolean(${expression})`)) return;
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

function wireFetchInterception(cdp) {
  const consoleErrors = [];
  const respond = async (m, p) => {
    try { await cdp.send(m, p); } catch (err) { if (!/Invalid InterceptionId/.test(err.message || "")) throw err; }
  };
  cdp.onEvent = async (method, params) => {
    if (method === "Runtime.consoleAPICalled" && params.type === "error") {
      const text = (params.args || []).map((a) => (a.value !== undefined ? a.value : a.description || "")).join(" ");
      if (!/falha de rede|não foi possível|falha ao carregar/i.test(text)) consoleErrors.push(text);
    }
    if (method !== "Fetch.requestPaused") return;
    const req = params.request;
    const url = req.url;
    if (!url.includes(PROD_HOST)) { await respond("Fetch.continueRequest", { requestId: params.requestId }); return; }
    const cors = [
      { name: "access-control-allow-origin", value: "*" },
      { name: "access-control-allow-headers", value: "authorization,content-type" },
      { name: "access-control-allow-methods", value: "GET,POST,PATCH,OPTIONS" },
    ];
    if (req.method === "OPTIONS") { await respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 204, responseHeaders: cors }); return; }
    const json = (obj) => respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 200, responseHeaders: [...cors, { name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(obj)).toString("base64") });

    if (url.includes("/operacao/cliente-360/clientes")) { await json(PORTFOLIO); return; }
    const contasMatch = url.match(/\/clientes\/([^/?]+)\/contas/);
    if (contasMatch) {
      const slug = decodeURIComponent(contasMatch[1]);
      await json({ ok: true, cliente: { id: 1, nome: slug, slug, ativo: true }, contas: CONTAS[slug] || [] });
      return;
    }
    // Todo o resto (motor de cada tela: central-vendas, margem, diagnósticos)
    // fica fora do ar de propósito — este teste mede continuidade de
    // CONTEXTO entre navegações reais, não a renderização de cada motor
    // (já coberta nos testes específicos de cada página).
    await respond("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" });
  };
  return consoleErrors;
}

async function run() {
  const server = await startServer();
  const serverPort = server.address().port;
  const debugPort = 25000 + Math.floor(Math.random() * 1000);
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/vf-e2e-jornada-${process.pid}`, "about:blank",
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
    const consoleErrors = wireFetchInterception(cdp);

    function ctx() { return cdp.evaluate("window.VF.context.getContext()"); }
    function estado() { return cdp.evaluate("window.VF.context.getState()"); }

    // ═══ 1. Login (simulado: seed direto de vf-token, já coberto em
    //         login-ui.test.js) → Carteira ═══
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/carteira.html` });
    await sleep(60);
    await cdp.evaluate(`
      localStorage.setItem("vf-token", "ui-test-token");
      localStorage.setItem("vf-user", JSON.stringify({ id: 12, nome: "Pedro Gomes", role: "admin" }));
    `);
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/carteira.html` });
    await waitFor(cdp, "window.VF && window.VF.context", "Carteira não montou o Shell");
    await waitFor(cdp, "document.querySelectorAll('.vf-portfolio-row').length === 2", "Carteira não renderizou os 2 clientes");
    await sleep(200);

    await check("1. Carteira: sem contexto ainda (login limpo)", async () => {
      assert.strictEqual(await ctx(), null);
    });

    // ═══ 2. N97 → chip ML2 → Visão (destino padrão da Carteira, F3.3) ═══
    await cdp.evaluate(`
      Array.prototype.find.call(document.querySelectorAll('.vf-portfolio-row[data-slug=n97] [data-conta]'), function(b){ return b.dataset.conta === "43"; }).click()
    `);
    await waitFor(cdp, "window.location.href.indexOf('visao.html') >= 0", "clique no chip ML2 não navegou para a Visão");
    await waitFor(cdp, "window.VF && window.VF.context && window.VF.context.getState() === 'READY'", "Visão não chegou a READY vindo da Carteira");

    await check("2. Visão: chegou com o contexto exato do clique (n97/43)", async () => {
      const c = await ctx();
      assert.strictEqual(c.clienteSlug, "n97");
      assert.strictEqual(c.clienteContaId, 43);
      assert.strictEqual(await cdp.evaluate("document.body.dataset.vfModule"), "visao");
      assert.strictEqual(await cdp.evaluate("document.body.dataset.vfScope"), "account");
    });

    // ═══ 3. Sidebar → Central de Vendas (navegação real, não deep link) ═══
    await cdp.evaluate("document.querySelector('.vf-shell__item[data-module=central-vendas]').click()");
    await waitFor(cdp, "window.location.href.indexOf('fechamentos-api.html') >= 0", "clique em Central de Vendas não navegou");
    await waitFor(cdp, "window.VF && window.VF.context && window.VF.context.getState() === 'READY'", "Central de Vendas não chegou a READY vindo da Visão");
    await sleep(200);

    await check("3. Central de Vendas: contexto sobrevive à navegação real vinda da Visão", async () => {
      const c = await ctx();
      assert.strictEqual(c.clienteSlug, "n97");
      assert.strictEqual(c.clienteContaId, 43);
    });

    // ═══ 4. Sidebar → Margem (navegação real, não deep link) ═══
    await cdp.evaluate("document.querySelector('.vf-shell__item[data-module=margem]').click()");
    await waitFor(cdp, "window.location.href.indexOf('central-margem.html') >= 0", "clique em Margem não navegou");
    await waitFor(cdp, "window.VF && window.VF.context", "Margem não montou o Shell");
    await sleep(300);

    await check("4. Margem: contexto sobrevive à navegação real (sessionStorage), cliente=n97", async () => {
      const c = await ctx();
      assert.ok(c, "contexto não deveria ser null ao chegar em Margem");
      assert.strictEqual(c.clienteSlug, "n97");
      assert.strictEqual(await cdp.evaluate("document.body.dataset.vfScope"), "client");
    });

    // ═══ 5. Sidebar → Diagnósticos ═══
    await cdp.evaluate("document.querySelector('.vf-shell__item[data-module=diagnosticos]').click()");
    await waitFor(cdp, "window.location.href.indexOf('diagnostico-inicial.html') >= 0", "clique em Diagnósticos não navegou");
    await waitFor(cdp, "window.VF && window.VF.context", "Diagnósticos não montou o Shell");
    await sleep(300);

    await check("5. Diagnósticos: contexto continua n97 após três navegações reais em sequência", async () => {
      const c = await ctx();
      assert.strictEqual(c.clienteSlug, "n97");
    });

    // ═══ 6. Sidebar → Carteira (global): contexto PRESERVADO, nunca "pausado" ═══
    await cdp.evaluate("document.querySelector('.vf-shell__item[data-module=carteira]')?.click() || document.querySelector('a[href=\"carteira.html\"]')?.click()");
    await waitFor(cdp, "window.location.href.indexOf('carteira.html') >= 0", "navegação de volta à Carteira não ocorreu");
    await waitFor(cdp, "window.VF && window.VF.context", "Carteira (retorno) não montou o Shell");
    await sleep(300);

    await check("6. De volta à Carteira: contexto de N97 preservado (D15 — nunca 'pausado')", async () => {
      const c = await ctx();
      assert.ok(c, "contexto deveria sobreviver à ida a uma página global");
      assert.strictEqual(c.clienteSlug, "n97");
      assert.ok(!(await cdp.evaluate("document.body.innerText")).toLowerCase().includes("pausado"), "termo 'pausado' proibido (D15)");
    });

    // ═══ 7. Trocar de cliente: Extra Máquinas (1 conta, entra em 1 clique) → Visão ═══
    await cdp.evaluate(`
      document.querySelector('.vf-portfolio-row[data-slug=extra] [data-entrar]').click();
    `);
    await waitFor(cdp, "window.location.href.indexOf('visao.html') >= 0", "clique em Extra Máquinas não navegou para a Visão");
    await waitFor(cdp, "window.VF && window.VF.context && window.VF.context.getState() === 'READY'", "Extra Máquinas não chegou a READY");

    await check("7. Troca de cliente pela Carteira: contexto novo é Extra/51, não mistura com N97", async () => {
      const c = await ctx();
      assert.strictEqual(c.clienteSlug, "extra");
      assert.strictEqual(c.clienteContaId, 51);
      assert.strictEqual(await cdp.evaluate("document.body.dataset.vfModule"), "visao");
    });

    await check("sem erros de console inesperados em toda a jornada", async () => {
      assert.strictEqual(consoleErrors.length, 0, `erros: ${JSON.stringify(consoleErrors)}`);
    });

    console.log(`\n✓ ${checks} verificações da jornada completa (Login→Carteira→N97→ML2→Visão→CentralDeVendas→Margem→Diagnóstico→Carteira→Extra→Visão)`);
  } finally {
    if (cdp) { try { await cdp.send("Fetch.disable"); } catch (_) { /* já pode estar fechado */ } cdp.close(); }
    chrome.kill("SIGTERM");
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
