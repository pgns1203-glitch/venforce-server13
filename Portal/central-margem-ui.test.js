/*
 * Smoke test de interface em Chrome headless, sem dependências externas.
 * Os dados ficam injetados no cliente do contrato; o modo real da página não
 * conhece fixtures e continua apontando apenas para os endpoints documentados.
 */
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORTAL_DIR = __dirname;

function confidence(level, explanation) {
  return { level, score: null, explanation: explanation || `Confiança ${level}` };
}

function variable(value, sourceLabel, level, options = {}) {
  return {
    value,
    rate: options.rate ?? null,
    format: options.format || "money",
    source: options.source || null,
    sourceLabel,
    confidence: confidence(level || "UNKNOWN"),
    updatedAt: options.updatedAt || null,
    detail: options.detail || null,
    available: value !== null,
    estimated: options.estimated === true,
  };
}

function item(id, status, title, overrides = {}) {
  const price = overrides.price ?? 100;
  const projectedMargin = overrides.projectedMargin === undefined ? 0.2 : overrides.projectedMargin;
  const realizedMargin = overrides.realizedMargin === undefined ? 0.18 : overrides.realizedMargin;
  const level = overrides.level || "HIGH";
  return {
    id,
    itemId: id,
    sku: `SKU-${id}`,
    title,
    image: null,
    permalink: `https://produto.mercadolivre.com.br/${id}`,
    client: { slug: "loja-teste", name: "Loja Teste" },
    marketplace: "meli",
    status,
    confidence: confidence(level, overrides.confidenceExplanation),
    problem: overrides.problem || "Sem exceção adicional",
    targetMargin: overrides.targetMargin ?? 0.15,
    projected: { margin: projectedMargin, profit: projectedMargin === null ? null : price * projectedMargin, estimated: false, note: null },
    realized: { margin: realizedMargin, profit: realizedMargin === null ? null : price * realizedMargin, pending: realizedMargin === null },
    variables: {
      price: variable(price, "API do Mercado Livre", "HIGH", { source: "MELI_API", updatedAt: "2026-08-12T12:00:00Z" }),
      observedPrice: variable(overrides.observedPrice ?? null, "Extensão VenForce", overrides.observedPrice == null ? "UNKNOWN" : "MEDIUM"),
      lastSoldPrice: variable(overrides.lastSoldPrice ?? price, "Pedido do Mercado Livre", level),
      cost: variable(overrides.cost === undefined ? 40 : overrides.cost, "Base VenForce", overrides.cost === null ? "UNKNOWN" : "HIGH", { source: "VENFORCE_BASE" }),
      tax: variable(0.1, "Base VenForce", "HIGH", { format: "percent" }),
      commission: variable(10, "API do Mercado Livre", "HIGH", { rate: 0.1 }),
      freightExpected: variable(5, "API do Mercado Livre", "HIGH"),
      freightActual: variable(overrides.freightActual ?? 6, "Pedido do Mercado Livre", level),
      soldValue: variable(realizedMargin === null ? null : price, "Pedido do Mercado Livre", level),
      netReceipt: variable(overrides.netReceipt ?? null, "Mercado Pago", overrides.netReceipt == null ? "UNKNOWN" : "HIGH"),
      mercadoPago: variable(overrides.netReceipt ?? null, "Mercado Pago", overrides.netReceipt == null ? "UNKNOWN" : "HIGH"),
    },
    divergences: overrides.divergences || [],
    reconciliation: realizedMargin === null ? "Pendente" : level === "LOW" ? "Bloqueada" : "Conciliada",
    latestOrderId: realizedMargin === null ? null : `ORDER-${id}`,
    links: {},
    simulationInputs: { cost: 40, taxRate: 0.1, commissionRate: 0.1, freight: 5, fixedFee: 0, complete: true, source: "Fixture isolada de teste" },
  };
}

const ITEMS = [
  item("MLB-HEALTHY", "HEALTHY", "Produto saudável"),
  item("MLB-LOW", "LOW_MARGIN", "Produto com margem baixa", { projectedMargin: 0.08, realizedMargin: 0.07, problem: "Abaixo da meta" }),
  item("MLB-LOSS", "LOSS", "Produto em prejuízo", { price: 50, projectedMargin: -0.1, realizedMargin: -0.2, problem: "Margem realizada negativa" }),
  item("MLB-UNVALIDATED", "UNVALIDATED", "Produto sem custo", { cost: null, projectedMargin: null, realizedMargin: null, level: "UNKNOWN", problem: "Custo ausente" }),
  item("MLB-SUSPECT", "SUSPECT_DATA", "Produto com dado suspeito", {
    level: "LOW",
    problem: "Fontes de frete divergentes",
    divergences: [{ variable: "Frete", type: "DRIFT", sourceA: "API do Mercado Livre", sourceB: "Pedido do Mercado Livre", valueA: 5, valueB: 12, explanation: "Previsto e realizado diferem.", format: "money" }],
    freightActual: 12,
  }),
  item("MLB-RECON", "RECONCILING", "Produto em conciliação", { realizedMargin: null, level: "MEDIUM", problem: "Mercado Pago pendente" }),
];

const DATA = {
  ok: true,
  sourceMode: "motor",
  sourceLabel: "Motor de Margem",
  partial: true,
  client: { slug: "loja-teste", name: "Loja Teste" },
  marketplace: "meli",
  items: ITEMS,
  pagination: { page: 1, limit: 50, total: ITEMS.length, totalPages: 1 },
  summary: {
    monitored: ITEMS.length,
    counts: { HEALTHY: 1, LOW_MARGIN: 1, LOSS: 1, UNVALIDATED: 1, SUSPECT_DATA: 1, RECONCILING: 1 },
    scope: "dataset",
  },
  lastUpdated: "2026-08-12T12:00:00Z",
  period: { label: "Últimos 30 dias", inicio: "2026-07-14", fim: "2026-08-12" },
  warnings: ["Resposta parcial controlada para teste de interface."],
  gaps: ["AGUARDANDO_MOTOR: Mercado Pago"],
};

function startStaticServer() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = pathname === "/" ? "central-margem.html" : pathname.replace(/^\/+/, "");
    const target = path.resolve(PORTAL_DIR, relative);
    if (!target.startsWith(path.resolve(PORTAL_DIR) + path.sep)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    fs.readFile(target, (error, contents) => {
      if (error) {
        response.writeHead(404).end("not found");
        return;
      }
      const ext = path.extname(target);
      const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
      response.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream", "Cache-Control": "no-store" });
      response.end(contents);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitChrome(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch (_) { /* aguardando */ }
    await sleep(50);
  }
  throw new Error("Chrome DevTools não iniciou.");
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
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
  for (let attempt = 0; attempt < 120; attempt += 1) {
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

async function run() {
  const server = await startStaticServer();
  const serverPort = server.address().port;
  const debugPort = 13000 + Math.floor(Math.random() * 1000);
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=/tmp/vf-central-margem-ui-${process.pid}`,
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

    const injection = `
      localStorage.setItem("vf-token", "ui-test-token");
      localStorage.setItem("vf-user", JSON.stringify({ nome: "Teste UI", role: "admin" }));
      window.__cmFixture = ${JSON.stringify(DATA)};
      window.__cmFail = false;
      window.__cmCalls = [];
      window.__VF_CENTRAL_MARGEM_API_CLIENT__ = {
        getClients: function () {
          return Promise.resolve({ ok: true, clients: [{ id: 1, slug: "loja-teste", name: "Loja Teste", mlConnected: true, totalItems: 6 }] });
        },
        getCentral: function (params) {
          window.__cmCalls.push(params);
          if (window.__cmFail) return Promise.resolve({ ok: false, status: 503, error: "Erro simulado do backend" });
          var data = JSON.parse(JSON.stringify(window.__cmFixture));
          var query = String(params.search || "").toLowerCase();
          if (query) data.items = data.items.filter(function (item) {
            return [item.title, item.itemId, item.sku].join(" ").toLowerCase().indexOf(query) !== -1;
          });
          data.pagination.total = data.items.length;
          data.pagination.totalPages = 1;
          return Promise.resolve(data);
        }
      };
    `;
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: injection });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/central-margem.html?cliente=loja-teste` });
    await waitFor(cdp, "window.VFCentralMargemUi && window.VFCentralMargemUi.getState().data && !window.VFCentralMargemUi.getState().loading", "A Central não carregou");

    await check("carregamento normal e resposta parcial explícita", async () => {
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length"), 6);
      assert.ok((await cdp.evaluate("document.getElementById('cm-page-state').innerText")).includes("Leitura parcial"));
    });

    await check("troca entre as sete visões", async () => {
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#cm-tabs [data-view]').length"), 7);
      await cdp.evaluate("document.querySelector('[data-view=freight]').click()");
      const freightState = await cdp.evaluate("({view:window.VFCentralMargemUi.getState().view,head:document.querySelector('#cm-table-host thead').innerText})");
      assert.strictEqual(freightState.view, "freight");
      assert.ok(freightState.head.toLowerCase().includes("frete previsto"), freightState.head);
      await cdp.evaluate("document.querySelector('[data-view=general]').click()");
    });

    await check("busca por título", async () => {
      await cdp.evaluate(`(function(){var input=document.getElementById('cm-search');input.value='prejuízo';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await waitFor(cdp, "window.VFCentralMargemUi.getState().search === 'prejuízo' && !window.VFCentralMargemUi.getState().loading && document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length === 1", "Busca não filtrou");
      assert.ok((await cdp.evaluate("document.getElementById('cm-table-host').innerText")).includes("Produto em prejuízo"));
      await cdp.evaluate(`(function(){var input=document.getElementById('cm-search');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await waitFor(cdp, "!window.VFCentralMargemUi.getState().loading && document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length === 6", "Busca não foi limpa");
    });

    await check("cards filtram prejuízo e o drawer preserva o contexto ao fechar", async () => {
      await cdp.evaluate("document.querySelector('[data-status-filter=LOSS]').click()");
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length"), 1);
      await cdp.evaluate("document.querySelector('[data-open-item=\"MLB-LOSS\"]').click()");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-drawer').classList.contains('is-open')"), true);
      const drawerText = await cdp.evaluate("document.getElementById('cm-drawer-body').textContent");
      assert.ok(drawerText.toLowerCase().includes("variáveis e fontes"), drawerText);
      assert.strictEqual(await cdp.evaluate("document.querySelector('#cm-simulator-form button[disabled]').textContent"), "Aplicar preço");
      await cdp.evaluate("document.getElementById('cm-drawer-close-footer').click()");
      assert.strictEqual(await cdp.evaluate("window.VFCentralMargemUi.getState().status"), "LOSS");
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length"), 1);
      assert.strictEqual(await cdp.evaluate("document.activeElement.getAttribute('data-open-item')"), "MLB-LOSS");
    });

    await check("simulação calcula sem habilitar escrita de preço", async () => {
      await cdp.evaluate("document.querySelector('[data-open-item=\"MLB-LOSS\"]').click()");
      await cdp.evaluate(`(function(){var input=document.getElementById('cm-simulator-price');input.value='120,00';document.getElementById('cm-simulator-form').requestSubmit();})()`);
      const result = await cdp.evaluate("document.getElementById('cm-simulator-result').textContent");
      assert.ok(result.includes("42,5%"));
      assert.ok(result.includes("51,00"));
      assert.strictEqual(await cdp.evaluate("document.querySelector('#cm-simulator-form button[disabled]').disabled"), true);
      await cdp.evaluate("document.getElementById('cm-drawer-close').click()");
      await cdp.evaluate("document.getElementById('cm-clear-status').click()");
    });

    await check("estados saudável, prejuízo, suspeito, sem custo e realizado pendente ficam representados", async () => {
      const values = await cdp.evaluate("Array.from(document.querySelectorAll('#cm-summary [data-status-filter]')).map(function(x){return [x.getAttribute('data-status-filter'),x.innerText]})");
      const text = JSON.stringify(values);
      assert.ok(text.includes("HEALTHY"));
      assert.ok(text.includes("LOSS"));
      assert.ok(text.includes("SUSPECT_DATA"));
      assert.ok(text.includes("UNVALIDATED"));
      assert.ok(text.includes("RECONCILING"));
      await cdp.evaluate("document.querySelector('[data-view=cost]').click()");
      assert.ok((await cdp.evaluate("document.getElementById('cm-table-host').innerText")).includes("Sem custo"));
      await cdp.evaluate("document.querySelector('[data-view=receipt]').click()");
      assert.ok((await cdp.evaluate("document.getElementById('cm-table-host').innerText")).includes("Pendente"));
    });

    await check("layout não cria rolagem horizontal global em 1440, 1024, 768 e 390 px", async () => {
      for (const width of [1440, 1024, 768, 390]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width <= 600 });
        await sleep(80);
        const metrics = await cdp.evaluate("({viewport:window.innerWidth,scroll:document.documentElement.scrollWidth})");
        assert.ok(metrics.scroll <= metrics.viewport + 1, `${width}px: scroll ${metrics.scroll}, viewport ${metrics.viewport}`);
      }
      await cdp.evaluate("document.querySelector('[data-open-item=\"MLB-HEALTHY\"]').click()");
      const drawer = await cdp.evaluate("(function(){var r=document.getElementById('cm-drawer').getBoundingClientRect();return {width:r.width,viewport:window.innerWidth}})()");
      assert.ok(drawer.width <= drawer.viewport + 1);
      await cdp.evaluate("document.getElementById('cm-drawer-close').click()");
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    });

    await check("erro de backend oferece retry e recupera a leitura", async () => {
      await cdp.evaluate("window.__cmFail=true;document.getElementById('cm-refresh').click()");
      await waitFor(cdp, "window.VFCentralMargemUi.getState().error && document.getElementById('cm-page-state').innerText.indexOf('Erro simulado') !== -1", "Erro não apareceu");
      await cdp.evaluate("window.__cmFail=false;document.getElementById('cm-retry').click()");
      await waitFor(cdp, "window.VFCentralMargemUi.getState().data && !window.VFCentralMargemUi.getState().loading", "Retry não recuperou");
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length"), 6);
    });

    console.log(`# ${checks} smoke tests de UI concluídos`);
  } finally {
    if (cdp) cdp.close();
    chrome.kill("SIGTERM");
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
