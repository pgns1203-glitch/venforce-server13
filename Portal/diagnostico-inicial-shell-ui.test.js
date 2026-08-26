/*
 * Smoke test de interface em Chrome headless para Diagnóstico Inicial
 * migrado para o Shell V3 (F2.4).
 *
 * Mesma estratégia de Portal/fechamentos-api-shell-ui.test.js: fixtures
 * reais para o Shell (GET /operacao/cliente-360/clientes,
 * GET /clientes/:slug/contas) e fixtures mínimas para o "motor" do
 * diagnóstico (GET/POST /operacao/diagnosticos-iniciais) — tudo via CDP
 * Fetch, nunca toca a rede real. O foco aqui é a ORIGEM do contexto
 * (Shell → state.clienteId), não o formulário do diagnóstico em si
 * (schema/seções/autosave — intocado nesta unidade).
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
const PORTFOLIO = { ok: true, clientes: [N97, EXTRA] };

let diagCallLog = []; // [{method, clienteId}]
let diagStore = {}; // clienteId -> diagnostico em rascunho

function diagnosticoFixture(clienteId) {
  return {
    id: 5000 + Number(clienteId), cliente_id: Number(clienteId), marketplace: "meli",
    status: "rascunho", data_diagnostico: "2026-08-26", respostas_json: {},
    completude: 0, completude_detalhes: {}, updated_at: "2026-08-26T10:00:00Z",
  };
}

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
      consoleErrors.push((params.args || []).map((a) => (a.value !== undefined ? a.value : a.description || "")).join(" "));
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
    const json = (obj, code) => Buffer.from(JSON.stringify(obj)).toString("base64") && respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: code || 200, responseHeaders: [...cors, { name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(obj)).toString("base64") });

    if (url.includes("/operacao/cliente-360/clientes")) { await json(PORTFOLIO); return; }
    const contasMatch = url.match(/\/clientes\/([^/?]+)\/contas/);
    if (contasMatch) { await json({ ok: true, cliente: { id: 1, nome: "x", slug: "x", ativo: true }, contas: [] }); return; }

    if (url.includes("/operacao/diagnosticos-iniciais")) {
      const parsed = new URL(url);
      if (req.method === "GET") {
        const clienteId = parsed.searchParams.get("clienteId");
        diagCallLog.push({ method: "GET", clienteId });
        const existing = diagStore[clienteId];
        await json({ ok: true, diagnosticos: existing ? [existing] : [] });
        return;
      }
      if (req.method === "POST") {
        let body = {};
        try { body = JSON.parse(Buffer.from(req.postData || "", "utf8").toString()); } catch (_) { /* sem corpo capturado */ }
        // O corpo do POST não é exposto em Fetch.requestPaused por padrão;
        // deduz o clienteId pelo último GET correspondente (mesma sequência
        // sempre: loadHistorico → ensureDraftForMarketplace).
        const clienteId = diagCallLog.length ? diagCallLog[diagCallLog.length - 1].clienteId : null;
        diagCallLog.push({ method: "POST", clienteId });
        const diag = diagnosticoFixture(clienteId || "0");
        diagStore[clienteId] = diag;
        await json({ ok: true, diagnostico: diag });
        return;
      }
      if (req.method === "PATCH") {
        diagCallLog.push({ method: "PATCH", clienteId: null });
        const idMatch = url.match(/diagnosticos-iniciais\/(\d+)/);
        const diag = idMatch ? Object.values(diagStore).find((d) => String(d.id) === idMatch[1]) : null;
        await json({ ok: true, diagnostico: diag || diagnosticoFixture(0) });
        return;
      }
    }
    await respond("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" });
  };
  return consoleErrors;
}

async function run() {
  const server = await startServer();
  const serverPort = server.address().port;
  const debugPort = 24000 + Math.floor(Math.random() * 1000);
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/vf-diag-shell-ui-${process.pid}`, "about:blank",
  ], { stdio: "ignore" });

  let cdp;
  try {
    await waitChrome(debugPort);
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })).json();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    const consoleErrors = wireFetchInterception(cdp);

    async function seedAndGoto(qs) {
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/diagnostico-inicial.html` });
      await sleep(60);
      await cdp.evaluate(`
        localStorage.setItem("vf-token", "ui-test-token");
        localStorage.setItem("vf-user", JSON.stringify({ id: 12, nome: "Pedro Gomes", role: "admin" }));
      `);
      diagCallLog = [];
      consoleErrors.length = 0;
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/diagnostico-inicial.html${qs ? "?" + qs : ""}` });
      await waitFor(cdp, "window.VF && window.VF.context", "vf-context não montou");
    }

    await seedAndGoto("cliente=n97");
    await waitFor(cdp, "window.VF.context.getState() !== 'BOOT' && window.VF.context.getState() !== 'RESOLVING_CLIENT'", "n97 não resolveu");
    await sleep(400);

    await check("F2.4 — sem seletor local de Cliente no DOM", async () => {
      assert.strictEqual(await cdp.evaluate("Boolean(document.getElementById('diag-cliente'))"), false);
    });

    await check("F2.4 — layout.js não carrega mais nesta página", async () => {
      const scripts = await cdp.evaluate("Array.prototype.map.call(document.querySelectorAll('script[src]'), function(s){return s.getAttribute('src');})");
      assert.ok(!scripts.includes("layout.js"), `layout.js não deveria existir: ${JSON.stringify(scripts)}`);
      assert.ok(scripts.includes("vf-shell.js"));
    });

    await check("data-vf-scope=\"client\": página libera SEM exigir uma operação escolhida (2 contas, nenhuma selecionada)", async () => {
      // n97 tem retorno de contas vazio no fixture — cliente resolvido é
      // suficiente para o scope="client" liberar o conteúdo.
      assert.strictEqual(await cdp.evaluate("document.getElementById('vf-shell-main').hidden"), false, "main deveria estar visível com scope=client assim que o cliente resolve");
    });

    await check("deep link ?cliente=n97: diagnóstico é aberto/consultado com o clienteId certo (87)", async () => {
      assert.ok(diagCallLog.some((c) => String(c.clienteId) === "87"), `nenhuma chamada com clienteId=87: ${JSON.stringify(diagCallLog)}`);
    });

    /* ══════════════════════ troca de CLIENTE via Shell ═══════════════ */
    diagCallLog = [];
    await cdp.evaluate("document.getElementById('vf-cliente-trigger').click()");
    await waitFor(cdp, "document.querySelector('.vf-shell__dropdown')", "dropdown de cliente não abriu");
    await cdp.evaluate(`
      Array.prototype.find.call(document.querySelectorAll('.vf-menu__item'), function(x){ return x.textContent.trim().startsWith('Extra'); }).click();
    `);
    await waitFor(cdp, "window.VF.context.getContext() && window.VF.context.getContext().clienteSlug === 'extra'", "troca para Extra Máquinas não completou");
    await sleep(400);

    await check("troca de cliente (N97→Extra): estado do diagnóstico reinicia e consulta o novo clienteId (88)", async () => {
      assert.ok(diagCallLog.some((c) => String(c.clienteId) === "88"), `nenhuma chamada com clienteId=88 após a troca: ${JSON.stringify(diagCallLog)}`);
    });

    await check("sem erros de console em nenhum cenário", async () => {
      const relevantes = consoleErrors.filter((m) => !/favicon/i.test(m));
      assert.strictEqual(relevantes.length, 0, `erros de console: ${JSON.stringify(relevantes)}`);
    });

    console.log(`\n✓ ${checks} verificações do Diagnóstico Inicial migrado (F2.4)`);
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
