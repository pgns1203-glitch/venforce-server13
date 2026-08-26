/*
 * Smoke test de interface em Chrome headless para as duas primeiras
 * adoções reais do Shell V3 — F0.6 (ferramentas.html) e F0.7
 * (fechamentos-api.html atrás de `?shell=v3`).
 *
 * Diferença deliberada em relação a Portal/vf-shell-ui.test.js: aqui as
 * páginas são as REAIS do Portal (não um harness sintético), servidas por
 * um servidor estático local. Todo tráfego para o host de produção
 * (`venforce-server.onrender.com` — hardcoded em fechamentos-api.js e
 * usado por padrão por vf-config.js quando a página não declara
 * `<meta name="vf-api-base">`, que nenhuma das duas páginas declara) é
 * interceptado via CDP `Fetch` — nunca chega à rede real:
 *   · `/operacao/cliente-360/clientes` e `/clientes/:slug/contas` (é só
 *     o que vf-context.js chama) respondem com fixtures locais;
 *   · qualquer outra chamada (o que fechamentos-api.js faz por conta
 *     própria, com seu próprio API_BASE hardcoded — fora do escopo desta
 *     unidade, que não toca fechamentos-api.js) falha como se fosse rede
 *     fora do ar. É exatamente o que a tela já precisa tolerar hoje.
 *
 * Padrão de CDP idêntico a Portal/vf-shell-ui.test.js, com o domínio
 * `Fetch` adicionado.
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

function grant(status) {
  return status ? { id: 900, ml_user_id: "1099887766", token_status: status, is_primary: false } : null;
}
function base(id, nome) {
  return { vinculo_id: 500 + id, base_id: id, slug: "base-" + id, nome, resolvido_por: "conta" };
}
const N97 = {
  id: 87, nome: "N97 Comercial", slug: "n97", ativo: true,
  temGrant: true, grantStatus: "conectado", temBase: true, setupScore: 100,
  statusOperacional: "pronto", ultimaSincronizacao: "2026-08-25T14:00:00Z", pendencias: [],
};
const N97_CONTAS = [
  { id: 42, cliente_id: 87, marketplace: "meli", nome: "Mercado Livre 1", slug: "ml-1", external_account_id: "182993004", is_primary: true, ativo: true, grant: grant("valid"), base: base(9, "Custo 2026") },
  { id: 43, cliente_id: 87, marketplace: "meli", nome: "Mercado Livre 2", slug: "ml-2", external_account_id: "204118872", is_primary: false, ativo: true, grant: grant("valid"), base: base(9, "Custo 2026") },
];
const PORTFOLIO = { ok: true, clientes: [N97] };

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    const target = path.resolve(PORTAL_DIR, u.pathname.replace(/^\/+/, ""));
    if (!target.startsWith(path.resolve(PORTAL_DIR) + path.sep)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    fs.readFile(target, (err, contents) => {
      if (err) {
        res.writeHead(404).end("not found");
        return;
      }
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
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return;
    } catch (_) { /* aguardando */ }
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
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      if (message.method && this.onEvent) this.onEvent(message.method, message.params);
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
  for (let i = 0; i < 120; i++) {
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

/* Intercepta qualquer requisição para o host de produção: as duas rotas
   que vf-context.js chama respondem com fixture; todo o resto falha como
   rede fora do ar (é o que fechamentos-api.js, com seu próprio API_BASE,
   já precisa tolerar hoje — fora do escopo desta unidade). */
function wireFetchInterception(cdp) {
  const consoleErrors = [];
  cdp.onEvent = async (method, params) => {
    if (method === "Runtime.consoleAPICalled" && params.type === "error") {
      consoleErrors.push((params.args || []).map((a) => a.value || a.description || "").join(" "));
    }
    if (method !== "Fetch.requestPaused") return;
    const req = params.request;
    const url = req.url;
    if (!url.includes(PROD_HOST)) {
      await cdp.send("Fetch.continueRequest", { requestId: params.requestId });
      return;
    }
    // fetch() cross-origin com header Authorization dispara preflight
    // OPTIONS — precisa responder com os headers de CORS para o navegador
    // liberar a resposta real ao JS da página.
    const corsHeaders = [
      { name: "access-control-allow-origin", value: "*" },
      { name: "access-control-allow-headers", value: "authorization,content-type" },
      { name: "access-control-allow-methods", value: "GET,POST,OPTIONS" },
    ];
    if (req.method === "OPTIONS") {
      await cdp.send("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 204, responseHeaders: corsHeaders });
      return;
    }
    if (url.includes("/operacao/cliente-360/clientes")) {
      const body = Buffer.from(JSON.stringify(PORTFOLIO)).toString("base64");
      await cdp.send("Fetch.fulfillRequest", {
        requestId: params.requestId, responseCode: 200,
        responseHeaders: [...corsHeaders, { name: "content-type", value: "application/json" }], body,
      });
      return;
    }
    const contasMatch = url.match(/\/clientes\/([^/?]+)\/contas/);
    if (contasMatch && decodeURIComponent(contasMatch[1]) === "n97") {
      const body = Buffer.from(JSON.stringify({ ok: true, cliente: { id: 87, nome: "N97 Comercial", slug: "n97", ativo: true }, contas: N97_CONTAS })).toString("base64");
      await cdp.send("Fetch.fulfillRequest", {
        requestId: params.requestId, responseCode: 200,
        responseHeaders: [...corsHeaders, { name: "content-type", value: "application/json" }], body,
      });
      return;
    }
    // qualquer outra chamada ao host de produção: simula rede fora do ar.
    await cdp.send("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" });
  };
  return consoleErrors;
}

async function run() {
  const server = await startStaticServer();
  const serverPort = server.address().port;
  const debugPort = 15000 + Math.floor(Math.random() * 1000);
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=/tmp/vf-shell-adoption-ui-${process.pid}`,
    "about:blank",
  ], { stdio: "ignore" });

  let cdp;
  try {
    await waitChrome(debugPort);
    const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
    const target = await targetResponse.json();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    let consoleErrors = wireFetchInterception(cdp);

    async function seedAndGoto(pathAndQuery) {
      // about:blank primeiro, para poder semear localStorage ANTES do
      // primeiro carregamento real (senão o token não existe a tempo de
      // getToken()/vf-shell.js rodarem).
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/ferramentas.html` });
      await sleep(50);
      await cdp.evaluate(`
        localStorage.setItem("vf-token", "ui-test-token");
        localStorage.setItem("vf-user", JSON.stringify({ id: 12, nome: "Pedro Gomes", role: "user" }));
      `);
      consoleErrors.length = 0;
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/${pathAndQuery}` });
    }

    /* ═══════════════════════ F0.6 — ferramentas.html ═══════════════════ */
    await seedAndGoto("ferramentas.html");
    await waitFor(cdp, "window.VF && window.VF.shell", "vf-shell não montou em ferramentas.html");
    // scope=global sem cliente escolhido (nem na URL, nem na sessão): o
    // estado correto é NO_CLIENT, não READY — a carteira carregou (1
    // cliente na fixture), mas nada foi selecionado. O conteúdo da página
    // global ainda assim precisa renderizar (aplicarGating, §5.4).
    await waitFor(cdp, "window.VF.context.getState() === 'NO_CLIENT'", "contexto não chegou a NO_CLIENT em ferramentas.html");
    await sleep(150);

    await check("F0.6 — layout.js legado NÃO foi carregado", async () => {
      const scripts = await cdp.evaluate("Array.prototype.map.call(document.querySelectorAll('script[src]'), function(s){return s.getAttribute('src');})");
      assert.ok(!scripts.includes("layout.js"), `layout.js não deveria estar presente: ${JSON.stringify(scripts)}`);
      assert.ok(scripts.some((s) => s === "vf-shell.js"), "vf-shell.js deveria estar presente");
    });

    await check("F0.6 — sidebar do Shell V3 mostra 'Ferramentas' como módulo ativo", async () => {
      const item = await cdp.evaluate(`
        (function(){ var a = document.querySelector('.vf-shell__item[data-module=ferramentas]'); return a ? { active: a.classList.contains('is-active'), current: a.getAttribute('aria-current') } : null; })();
      `);
      assert.ok(item, "item 'ferramentas' não encontrado na sidebar");
      assert.strictEqual(item.active, true);
      assert.strictEqual(item.current, "page");
    });

    await check("F0.6 — escopo global nunca bloqueia: conteúdo original da página está visível", async () => {
      assert.strictEqual(await cdp.evaluate("document.getElementById('vf-shell-main').hidden"), false);
      assert.strictEqual(await cdp.evaluate("document.body.classList.contains('vf-shell-blocked')"), false);
      assert.ok((await cdp.evaluate("document.body.innerText")).includes("Central de Ferramentas"), "conteúdo original (H1) sumiu");
    });

    await check("F0.6 — conteúdo original de ferramentas.js intacto: 3 abas, botões de download presentes", async () => {
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('.vf-tools-index .vf-tab').length"), 3);
      assert.ok(await cdp.evaluate("Boolean(document.getElementById('btn-download-extensao'))"));
      assert.ok(await cdp.evaluate("Boolean(document.getElementById('btn-download-midias'))"));
      assert.ok(await cdp.evaluate("Boolean(document.getElementById('btn-add-mlb'))"), "ferramenta OR (ferramenta-or.js) não montou");
    });

    await check("F0.6 — sem erros de console (rede de produção interceptada, sem exceptions JS)", async () => {
      const relevantes = consoleErrors.filter((m) => !/favicon/i.test(m));
      assert.strictEqual(relevantes.length, 0, `erros de console: ${JSON.stringify(relevantes)}`);
    });

    /* ═══════════════ F0.7 — fechamentos-api.html SEM ?shell=v3 ═════════ */
    consoleErrors.length = 0;
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/fechamentos-api.html` });
    await sleep(400);

    await check("F0.7 — sem ?shell=v3: continua carregando layout.js, Shell V3 NÃO monta", async () => {
      const scripts = await cdp.evaluate("Array.prototype.map.call(document.querySelectorAll('script[src]'), function(s){return s.getAttribute('src');})");
      assert.ok(scripts.includes("layout.js"), `layout.js deveria estar presente sem o parâmetro: ${JSON.stringify(scripts)}`);
      assert.ok(!scripts.includes("vf-shell.js"), "vf-shell.js não deveria carregar sem ?shell=v3");
      assert.strictEqual(await cdp.evaluate("Boolean(window.VF && window.VF.shell)"), false, "window.VF.shell não deveria existir");
    });

    /* ═══════════════ F0.7 — fechamentos-api.html COM ?shell=v3 ═════════ */
    consoleErrors.length = 0;
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/fechamentos-api.html?shell=v3` });
    await waitFor(cdp, "window.VF && window.VF.shell", "vf-shell não montou em fechamentos-api.html?shell=v3");
    await sleep(300);

    await check("F0.7 — com ?shell=v3: Shell V3 monta, layout.js NÃO carrega, os dois nunca coexistem", async () => {
      const scripts = await cdp.evaluate("Array.prototype.map.call(document.querySelectorAll('script[src]'), function(s){return s.getAttribute('src');})");
      assert.ok(!scripts.includes("layout.js"), `layout.js não deveria estar presente com ?shell=v3: ${JSON.stringify(scripts)}`);
      assert.ok(scripts.includes("vf-shell.js"), "vf-shell.js deveria estar presente");
      assert.strictEqual(await cdp.evaluate("Boolean(document.querySelector('.vf-sidebar'))"), false, "sidebar legado (.vf-sidebar) não deveria estar no DOM");
      assert.strictEqual(await cdp.evaluate("Boolean(document.querySelector('.vf-shell__sidebar'))"), true, "sidebar do Shell V3 deveria estar no DOM");
    });

    await check("F0.7 — com ?shell=v3: módulo ativo é 'central-vendas', escopo é 'account'", async () => {
      assert.strictEqual(await cdp.evaluate("document.body.dataset.vfScope"), "account");
      assert.strictEqual(await cdp.evaluate("document.body.dataset.vfModule"), "central-vendas");
      const item = await cdp.evaluate(`
        (function(){ var a = document.querySelector('.vf-shell__item[data-module=\\'central-vendas\\']'); return a ? a.classList.contains('is-active') : null; })();
      `);
      assert.strictEqual(item, true);
    });

    console.log(`\n✓ ${checks} verificações de adoção real (F0.6 ferramentas.html + F0.7 fechamentos-api.html)`);
  } finally {
    if (cdp) {
      try { await cdp.send("Fetch.disable"); } catch (_) { /* já pode estar fechado */ }
      cdp.close();
    }
    chrome.kill("SIGTERM");
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
