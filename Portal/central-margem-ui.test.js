/*
 * Smoke test de interface em Chrome headless, sem dependências externas.
 *
 * A fixture é um payload de WORKSPACE (contrato real de
 * `/operacao/central-margem/:slug/workspace`) passado pelo normalizador real
 * (`normalizeWorkspaceResponse`). Assim o teste exercita o contrato de
 * verdade em vez de um objeto escrito à mão que poderia divergir dele em
 * silêncio. A página em produção não conhece fixture nem modo mock.
 *
 * O workspace tem 51 itens carregados: os 6 nomeados de sempre (posições
 * 0–5, sempre visíveis na página visual 1) + 44 itens de preenchimento
 * (posições 6–49, fecham a página visual 1 de 50) + 1 item com divergência
 * de frete na posição 50 (primeiro item da página visual 2) — usado para
 * provar que paginação VISUAL nunca esconde nada de filtro, busca, KPI ou
 * fila de divergências.
 */
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const api = require("./central-margem-api.js");

const PORTAL_DIR = __dirname;

function evidence(source, kind, value, observedAt, note, quality) {
  return { source, kind, value, observedAt: observedAt || null, note: note || null, quality: quality || "MEASURED" };
}

function field(evidences, divergences) {
  const list = evidences.filter((entry) => entry && entry.value !== null && entry.value !== undefined);
  const realized = list.find((entry) => entry.kind === "REALIZED") || null;
  const projected = list.find((entry) => entry.kind === "PROJECTED") || null;
  const selected = realized || projected;
  return {
    present: Boolean(selected),
    selectedValue: selected ? selected.value : null,
    selectedSource: selected ? selected.source : null,
    selectedKind: selected ? selected.kind : null,
    projected,
    realized,
    evidences: list,
    divergences: divergences || [],
    hasConflict: (divergences || []).some((entry) => entry.type === "CONFLICT"),
    hasDrift: (divergences || []).some((entry) => entry.type === "DRIFT"),
  };
}

function motorItem(options) {
  const o = options;
  return {
    identity: { itemId: o.id, sku: `SKU-${o.id}`, titulo: o.title, marketplace: "meli", clienteSlug: "loja-teste" },
    itemId: o.id,
    sku: `SKU-${o.id}`,
    title: o.title,
    image: o.image || null,
    status: o.status,
    confidence: o.confidence || "HIGH",
    problema: o.problem,
    targetMargin: 0.12,
    permalink: `https://produto.mercadolivre.com.br/${o.id}`,
    projected: { margin: o.projectedMargin, profit: o.projectedProfit ?? null, estimated: false, note: null },
    realized: { margin: o.realizedMargin, profit: o.realizedProfit ?? null, pending: o.realizedMargin === null },
    margin: {
      projected: { margin: o.projectedMargin, profit: o.projectedProfit ?? null, computable: o.projectedMargin !== null, strict: true, missing: o.missing || [], assumed: [] },
      realized: { margin: o.realizedMargin, profit: o.realizedProfit ?? null, computable: o.realizedMargin !== null, strict: true, missing: [], assumed: [] },
      target: { marginTarget: 0.12 },
    },
    fields: {
      price: field([
        evidence("MELI_API", "PROJECTED", o.price, "2026-08-12T16:29:31Z", "sale_price (standard)"),
        o.observedPrice === undefined ? null : evidence("EXTENSION_DOM", "PROJECTED", o.observedPrice, "2026-08-12T15:58:12Z", "leitura de DOM"),
        o.soldPrice === undefined ? null : evidence("MELI_ORDER", "REALIZED", o.soldPrice, "2026-08-10T15:42:08Z", "valor unitário do pedido"),
      ].filter(Boolean), o.priceDivergences),
      cost: field([o.cost === null ? null : evidence("VENFORCE_BASE", "PROJECTED", o.cost, null, "custo declarado na Base", "DECLARED")].filter(Boolean)),
      taxRate: field([evidence("VENFORCE_BASE", "PROJECTED", 0.06, null, "imposto declarado na Base", "DECLARED")]),
      fixedFee: field([evidence("VENFORCE_BASE", "PROJECTED", 0, null, "taxa fixa declarada na Base", "DECLARED")]),
      commission: field([
        evidence("MELI_API", "PROJECTED", o.commission, "2026-08-12T16:29:31Z", "listing_prices.sale_fee_amount"),
        o.commissionRealized === undefined ? null : evidence("MELI_ORDER", "REALIZED", o.commissionRealized, "2026-08-10T15:42:08Z", "tarifa do pedido"),
      ].filter(Boolean)),
      commissionRate: field([evidence("MELI_API", "PROJECTED", 0.165, "2026-08-12T16:29:31Z")]),
      freight: field([
        evidence("MELI_API", "PROJECTED", o.freight, "2026-08-12T16:29:31Z", "shipping_options"),
        o.freightRealized === undefined ? null : evidence("MELI_ORDER", "REALIZED", o.freightRealized, "2026-08-10T15:42:08Z", "shipments/:id/costs"),
      ].filter(Boolean), o.freightDivergences),
      netReceipt: field([]),
    },
    quality: {
      confidence: o.confidence || "HIGH",
      reasons: o.reasons || [],
      confidenceByField: {
        price: { level: "HIGH", reasons: [] },
        cost: { level: o.cost === null ? "UNKNOWN" : "HIGH", reasons: [] },
        taxRate: { level: "HIGH", reasons: [] },
        commission: { level: "HIGH", reasons: [] },
        freight: { level: o.freightConfidence || "HIGH", reasons: o.freightReasons || [] },
        netReceipt: { level: "UNKNOWN", reasons: ["Mercado Pago não integrado."] },
      },
      statusReasons: [o.problem],
      hasConflict: Boolean(o.priceDivergences),
      hasDrift: Boolean(o.freightDivergences),
    },
    divergences: [].concat(
      (o.freightDivergences || []).map((entry) => Object.assign({ field: "freight" }, entry)),
      (o.priceDivergences || []).map((entry) => Object.assign({ field: "price" }, entry))
    ),
    sales: { hasOrders: o.soldPrice !== undefined, unidades: 3, pedidos: 2, receita: 980, ultimaVendaEm: "2026-08-10T15:42:08Z" },
    settlement: { available: false, motivo: "MERCADO_PAGO_NAO_INTEGRADO" },
    conciliacao: "Pendente",
  };
}

const NAMED_ITEMS = [
  motorItem({
    id: "MLB-HEALTHY", title: "Cabo USB-C 2 metros", status: "HEALTHY", problem: "Sem exceção operacional.",
    price: 69.9, soldPrice: 69.9, cost: 24, commission: 11.53, commissionRealized: 11.53, freight: 6.25, freightRealized: 6.25,
    projectedMargin: 0.2, projectedProfit: 14, realizedMargin: 0.2, realizedProfit: 14,
    image: "https://http2.mlstatic.com/D_NQ_NP_cabo.jpg",
  }),
  motorItem({
    id: "MLB-LOW", title: "Escova Flex Fitagem", status: "LOW_MARGIN", problem: "Margem abaixo da meta de 12%.",
    price: 47, soldPrice: 47, cost: 20, commission: 7.76, commissionRealized: 7.76, freight: 6.25, freightRealized: 6.25,
    projectedMargin: 0.08, projectedProfit: 3.76, realizedMargin: 0.08, realizedProfit: 3.76,
  }),
  motorItem({
    id: "MLB-LOSS", title: "Kit Ferramentas 129 peças", status: "LOSS", problem: "Preço atual não cobre a estrutura de custos.",
    price: 119.9, soldPrice: 119.9, cost: 83, commission: 19.78, commissionRealized: 20.1, freight: 18.9, freightRealized: 19.6,
    projectedMargin: -0.06, projectedProfit: -8.97, realizedMargin: -0.07, realizedProfit: -9.5,
  }),
  motorItem({
    id: "MLB-UNVALIDATED", title: "Ventilador 40cm Turbo", status: "UNVALIDATED", problem: "Custo não encontrado na Base.",
    price: 149.9, cost: null, commission: 24.73, freight: 21.4,
    projectedMargin: null, realizedMargin: null, missing: ["cost"], confidence: "UNKNOWN",
  }),
  motorItem({
    id: "MLB-SUSPECT", title: "Suporte Articulado Monitor", status: "SUSPECT_DATA", problem: "Frete previsto diverge do realizado.",
    price: 99.9, soldPrice: 99.9, cost: 52, commission: 16.48, commissionRealized: 16.8, freight: 23.4, freightRealized: 18.7,
    projectedMargin: 0.02, projectedProfit: 2.02, realizedMargin: 0.07, realizedProfit: 6.72,
    confidence: "MEDIUM", freightConfidence: "LOW", freightReasons: [{ message: "Frete realizado divergiu do previsto." }],
    freightDivergences: [{
      type: "DRIFT",
      a: { source: "MELI_API", kind: "PROJECTED", value: 23.4, observedAt: "2026-08-12T16:29:31Z" },
      b: { source: "MELI_ORDER", kind: "REALIZED", value: 18.7, observedAt: "2026-08-10T15:42:08Z" },
    }],
  }),
  motorItem({
    id: "MLB-RECON", title: "Secador Profissional 2200W", status: "RECONCILING", problem: "Recebimento ainda em conciliação.",
    price: 189.9, soldPrice: 179.9, cost: 112, commission: 31.33, commissionRealized: 29.7, freight: 25.9, freightRealized: 24.7,
    projectedMargin: 0.05, projectedProfit: 9.28, realizedMargin: null, confidence: "MEDIUM",
  }),
];

function fillerItem(n) {
  return motorItem({
    id: "MLB-FILLER-" + String(n).padStart(3, "0"),
    title: "Produto genérico " + n,
    status: "HEALTHY",
    problem: "Sem exceção operacional.",
    price: 50, soldPrice: 50, cost: 20, commission: 8, commissionRealized: 8, freight: 6, freightRealized: 6,
    projectedMargin: 0.32, projectedProfit: 16, realizedMargin: 0.32, realizedProfit: 16,
  });
}

// 44 itens de preenchimento fecham a página visual 1 em exatamente 50
// (6 nomeados + 44 = 50). O 51º item (abaixo) cai sozinho na página visual 2.
const FILLERS = Array.from({ length: 44 }, (_, i) => fillerItem(i + 1));

const DEEP_ITEM = motorItem({
  id: "MLB-DEEP-DIVERGENCE", title: "Produto Raro Fora Da Primeira Pagina", status: "SUSPECT_DATA",
  problem: "Frete previsto diverge do realizado.",
  price: 80, soldPrice: 80, cost: 40, commission: 12, commissionRealized: 12, freight: 12, freightRealized: 20,
  projectedMargin: 0.35, projectedProfit: 28, realizedMargin: 0.1, realizedProfit: 8,
  confidence: "MEDIUM", freightConfidence: "LOW", freightReasons: [{ message: "Frete realizado divergiu do previsto." }],
  freightDivergences: [{
    type: "DRIFT",
    a: { source: "MELI_API", kind: "PROJECTED", value: 12, observedAt: "2026-08-12T16:29:31Z" },
    b: { source: "MELI_ORDER", kind: "REALIZED", value: 20, observedAt: "2026-08-10T15:42:08Z" },
  }],
});

const ALL_ITEMS = NAMED_ITEMS.concat(FILLERS, [DEEP_ITEM]); // 51 itens

const PAYLOAD = {
  ok: true,
  parcial: false,
  itens: ALL_ITEMS,
  cobertura: { carregados: ALL_ITEMS.length, totalItensMl: ALL_ITEMS.length, parcial: false },
  resumo: { escopo: "workspace", totalItensMl: ALL_ITEMS.length, porStatus: {} },
  periodo: { label: "Últimos 30 dias", inicio: "2026-07-14", fim: "2026-08-12" },
  geradoEm: "2026-08-12T16:29:33Z",
  avisos: ["Resposta parcial controlada para teste de interface."],
};

const DATA = api.normalizeWorkspaceResponse(PAYLOAD, {
  client: { slug: "loja-teste", name: "Loja Teste" },
  marketplace: "meli",
});
DATA.period = { label: "Últimos 30 dias", inicio: "2026-07-14", fim: "2026-08-12" };

// Fixture de cobertura PARCIAL — usada só pelo teste dedicado de banner de
// cobertura parcial (catálogo maior que o teto desta leitura).
const PARTIAL_PAYLOAD = Object.assign({}, PAYLOAD, {
  parcial: true,
  cobertura: { carregados: ALL_ITEMS.length, totalItensMl: 350, parcial: true },
});

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
    this.onEvent = null;
  }

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

    // F2.3 — central-margem.html agora carrega o Shell V3, que resolve
    // Cliente (e tenta resolver Conta, embora esta página seja
    // data-vf-scope="client" e não dependa dela) via
    // GET /operacao/cliente-360/clientes e GET /clientes/:slug/contas —
    // ambos contra o host de produção hardcoded (vf-config.js sem
    // <meta vf-api-base> nesta página). Interceptado via CDP Fetch, nunca
    // toca a rede real. O "motor" da Central de Margem em si continua
    // mockado como antes, via window.__VF_CENTRAL_MARGEM_API_CLIENT__.
    const PROD_HOST = "venforce-server.onrender.com";
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    cdp.onEvent = async (method, params) => {
      if (method !== "Fetch.requestPaused") return;
      const url = params.request.url;
      const respond = async (m, p) => {
        try { await cdp.send(m, p); } catch (err) { if (!/Invalid InterceptionId/.test(err.message || "")) throw err; }
      };
      if (!url.includes(PROD_HOST)) { await respond("Fetch.continueRequest", { requestId: params.requestId }); return; }
      const cors = [
        { name: "access-control-allow-origin", value: "*" },
        { name: "access-control-allow-headers", value: "authorization,content-type" },
        { name: "access-control-allow-methods", value: "GET,POST,OPTIONS" },
      ];
      if (params.request.method === "OPTIONS") { await respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 204, responseHeaders: cors }); return; }
      // C1 — GET /me/context é a primeira chamada do Shell V3 (carteira
      // autoritativa por Squad, server/services/meService.js).
      if (url.includes("/me/context")) {
        const body = Buffer.from(JSON.stringify({
          ok: true,
          user: { id: 12, nome: "Pedro Gomes", email: null, role: "user" },
          squads: [], squadPrincipalId: null,
          clientes: [{ id: 1, slug: "loja-teste", nome: "Loja Teste", squadId: null, responsavelDireto: false, contasAtivas: null }],
          portfolio: { totalClientes: 1 },
          permissoes: { podeAdministrar: false },
        })).toString("base64");
        await respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 200, responseHeaders: [...cors, { name: "content-type", value: "application/json" }], body });
        return;
      }
      if (url.includes("/operacao/cliente-360/clientes")) {
        const body = Buffer.from(JSON.stringify({
          ok: true,
          clientes: [{ id: 1, nome: "Loja Teste", slug: "loja-teste", ativo: true, temGrant: true, grantStatus: "conectado", temBase: true, setupScore: 100, statusOperacional: "pronto", ultimaSincronizacao: null, pendencias: [] }],
        })).toString("base64");
        await respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 200, responseHeaders: [...cors, { name: "content-type", value: "application/json" }], body });
        return;
      }
      const contasMatch = url.match(/\/clientes\/([^/?]+)\/contas/);
      if (contasMatch) {
        const contas = decodeURIComponent(contasMatch[1]) === "loja-teste"
          ? [{ id: 900, cliente_id: 1, marketplace: "meli", nome: "Mercado Livre", slug: "ml", external_account_id: "111222333", externalAccountLabel: "loja-teste-ml", is_primary: true, ativo: true, grant: { id: 1, token_status: "valid" }, base: { vinculo_id: 1, base_id: 1, nome: "Custo Loja Teste" }, ultimaSync: null }]
          : [];
        const body = Buffer.from(JSON.stringify({ ok: true, cliente: { id: 1, nome: "Loja Teste", slug: "loja-teste", ativo: true }, contas })).toString("base64");
        await respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 200, responseHeaders: [...cors, { name: "content-type", value: "application/json" }], body });
        return;
      }
      await respond("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" });
    };

    const injection = `
      localStorage.setItem("vf-token", "ui-test-token");
      localStorage.setItem("vf-user", JSON.stringify({ nome: "Teste UI", role: "admin" }));
      window.__cmFixture = ${JSON.stringify(DATA)};
      window.__cmPartialFixture = ${JSON.stringify(api.normalizeWorkspaceResponse(PARTIAL_PAYLOAD, { client: { slug: "loja-teste", name: "Loja Teste" }, marketplace: "meli" }))};
      window.__cmFail = false;
      window.__cmUsePartial = false;
      window.__cmCalls = [];
      window.__VF_CENTRAL_MARGEM_API_CLIENT__ = {
        getClients: function () {
          return Promise.resolve({ ok: true, clients: [{ id: 1, slug: "loja-teste", name: "Loja Teste", mlConnected: true, totalItems: 51 }] });
        },
        getWorkspace: function (params) {
          window.__cmCalls.push(params);
          if (window.__cmFail) return Promise.resolve({ ok: false, status: 503, error: "Erro simulado do backend" });
          var source = window.__cmUsePartial ? window.__cmPartialFixture : window.__cmFixture;
          return Promise.resolve(JSON.parse(JSON.stringify(source)));
        }
      };
    `;
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: injection });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/central-margem.html?cliente=loja-teste` });
    await waitFor(cdp, "window.VFCentralMargemUi && window.VFCentralMargemUi.getState().data && !window.VFCentralMargemUi.getState().loading", "A Central não carregou");

    const sheetText = () => cdp.evaluate("document.getElementById('cm-table-host').innerText");
    const drawerText = () => cdp.evaluate("document.getElementById('cm-drawer-body').innerText");
    const rowCount = () => cdp.evaluate("document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length");
    const callCount = () => cdp.evaluate("window.__cmCalls.length");

    await check("workspace carrega os 51 itens; página visual 1 mostra 50", async () => {
      assert.strictEqual(await rowCount(), 50);
      assert.ok((await cdp.evaluate("document.getElementById('cm-page-state').innerText")).includes("Leitura parcial"));
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#cm-table-host thead [data-source-select]').length"), 6);
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#cm-table-host thead th').length"), 10, "10 colunas: Produto + 6 variáveis + Margem + Estado + Diagnóstico");
    });

    await check("cobertura aparece no contexto e no contador de resultados", async () => {
      assert.ok((await cdp.evaluate("document.getElementById('cm-context-meta').innerText")).includes("51 de 51 carregados"));
      assert.ok((await cdp.evaluate("document.getElementById('cm-result-count').innerText")).includes("51 resultados de 51 carregados"));
      assert.ok((await cdp.evaluate("document.getElementById('cm-monitored-tag').innerText")).includes("51 de 51 carregados"));
    });

    await check("uma única leitura agregada — nenhuma chamada HTTP por linha", async () => {
      const calls = await callCount();
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB-LOSS\"]').click()");
      await cdp.evaluate("document.querySelector('[data-tab=evidence]').click()");
      await cdp.evaluate("document.querySelector('[data-tab=audit]').click()");
      await cdp.evaluate("document.getElementById('cm-drawer-next').click()");
      assert.strictEqual(await callCount(), calls, "abrir o drawer disparou nova leitura");
      await cdp.evaluate("document.getElementById('cm-drawer-close').click()");
    });

    await check("preset Projetado é o inicial e compõe com fontes previstas", async () => {
      const state = await cdp.evaluate("({preset:window.VFCentralMargemUi.getState().preset,selection:window.VFCentralMargemUi.getState().selection})");
      assert.strictEqual(state.preset, "projected");
      assert.strictEqual(state.selection.price, "MELI_API");
      assert.strictEqual(state.selection.freight, "MELI_API");
      // Suporte Articulado: frete previsto 23,40 é o valor exibido no modo Projetado.
      assert.ok((await sheetText()).includes("23,40"), await sheetText());
    });

    await check("preset Realizado troca as fontes com evidência realizada", async () => {
      await cdp.evaluate("document.querySelector('[data-preset=realized]').click()");
      const state = await cdp.evaluate("window.VFCentralMargemUi.getState().selection");
      assert.strictEqual(state.price, "MELI_ORDER");
      assert.strictEqual(state.freight, "MELI_ORDER");
      // Custo/imposto/taxa fixa são declarados: continuam na Base mesmo no realizado.
      assert.strictEqual(state.cost, "VENFORCE_BASE");
      assert.strictEqual(state.tax, "VENFORCE_BASE");
      assert.ok((await sheetText()).includes("18,70"), "frete realizado não apareceu");
    });

    await check("seletor manual ativa Personalizado e Restaurar volta ao Projetado", async () => {
      await cdp.evaluate(`(function(){var s=document.querySelector('[data-source-select=freight]');s.value='MELI_API';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      assert.strictEqual(await cdp.evaluate("window.VFCentralMargemUi.getState().preset"), "custom");
      assert.strictEqual(await cdp.evaluate("document.querySelector('[data-preset=custom]').classList.contains('is-active')"), true);
      assert.ok(await cdp.evaluate("document.querySelectorAll('#cm-table-host thead .cm-head-select.is-changed').length >= 1"));
      await cdp.evaluate("document.getElementById('cm-restore-sources').click()");
      assert.strictEqual(await cdp.evaluate("window.VFCentralMargemUi.getState().preset"), "projected");
    });

    await check("fonte sem evidência fica Indisponível e custo ausente não vira zero", async () => {
      // O Ventilador não tem custo na Base: a célula de custo e a Margem
      // ficam indisponíveis. Ausente não vira zero — e o zero real da taxa
      // fixa declarada na Base continua sendo exibido como zero.
      const cells = await cdp.evaluate("Array.from(document.querySelector('tr[data-item-id=\"MLB-UNVALIDATED\"]').cells).map(function(c){return c.innerText.trim()})");
      assert.ok(cells[2].startsWith("Indisponível"), `custo deveria estar indisponível: ${cells[2]}`);
      assert.ok(cells[7].startsWith("Indisponível"), `Margem deveria estar indisponível: ${cells[7]}`);
      assert.ok(/^R\$\s0,00/.test(cells[6]), `taxa fixa zero declarada na Base deve continuar zero: ${cells[6]}`);
      const row = cells.join(" | ");
      assert.ok(row.includes("Não validado"), row);
      assert.ok(row.includes("Completar Base"), row);
      // A extensão nunca observou preço: a fonte existe no seletor, o valor não.
      await cdp.evaluate(`(function(){var s=document.querySelector('[data-source-select=price]');s.value='EXTENSION_DOM';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      const text = await sheetText();
      assert.ok(text.includes("Indisponível"), "preço da extensão deveria ficar indisponível");
      await cdp.evaluate("document.getElementById('cm-restore-sources').click()");
    });

    await check("célula indisponível explica fonte esperada, situação e ação", async () => {
      const title = await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB-UNVALIDATED\"] .cm-var-cell .cm-unavailable').getAttribute('title')");
      assert.ok(title.includes("Fonte esperada"), title);
      assert.ok(title.includes("Base VenForce"), title);
      assert.ok(title.includes("Ação: Ver na Base"), title);
      assert.ok(await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB-UNVALIDATED\"] .cm-var-cell .cm-info-mark') !== null"), "marcador ⓘ ausente");
    });

    await check("imagem do produto aparece quando o workspace traz thumbnail, e fallback quando não", async () => {
      const withImage = await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB-HEALTHY\"] .cm-product__thumb img')?.getAttribute('src')");
      assert.strictEqual(withImage, "https://http2.mlstatic.com/D_NQ_NP_cabo.jpg");
      const withoutImage = await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB-LOW\"] .cm-product__thumb')?.classList.contains('cm-product__thumb--empty')");
      assert.strictEqual(withoutImage, true);
    });

    await check("botão Fontes abre o mapa de fontes e a cobertura da leitura", async () => {
      await cdp.evaluate("document.getElementById('cm-open-sources').click()");
      await waitFor(cdp, "document.getElementById('cm-sources-overlay').classList.contains('is-open')", "painel de Fontes não abriu");
      // A visibilidade do overlay depende de uma transição CSS (opacity/visibility);
      // dá tempo do recálculo de estilo terminar antes de ler innerText.
      await sleep(150);
      const body = (await cdp.evaluate("document.getElementById('cm-sources-body').innerText")).toLowerCase();
      assert.ok(body.includes("projetado") && body.includes("realizado"), body);
      assert.ok(body.includes("preço") && body.includes("custo") && body.includes("comissão") && body.includes("frete"), body);
      assert.ok(body.includes("mercado pago") && body.includes("pendente"), body);
      assert.ok(body.includes("extensão") && body.includes("pendente"), body);
      assert.ok(body.includes("51 de 51 carregados"), body);
      assert.ok(await cdp.evaluate("!!document.querySelector('#cm-sources-body a[href=\"bases.html\"]')"), "ação Ver na Base ausente");
      await cdp.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-sources-overlay').classList.contains('is-open')"), false);
    });

    await check("resultado financeiro e integridade são placares separados", async () => {
      // innerText respeita o text-transform da Fundação: compara sem caixa.
      const financial = (await cdp.evaluate("document.getElementById('cm-kpis-financial').innerText")).toLowerCase();
      const integrity = (await cdp.evaluate("document.getElementById('cm-kpis-integrity').innerText")).toLowerCase();
      assert.ok(financial.includes("carregados") && financial.includes("prejuízo"), financial);
      assert.ok(integrity.includes("não validados") && integrity.includes("dados suspeitos") && integrity.includes("em conciliação"), integrity);
      // O item em conciliação tem margem projetada positiva: dado ruim não
      // apaga o resultado financeiro, e vice-versa.
      const recon = await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB-RECON\"]').innerText");
      assert.ok(recon.includes("Em conciliação"), recon);
      assert.ok(recon.includes("Saudável") || recon.includes("Margem baixa"), recon);
    });

    await check("filtro financeiro e filtro de integridade recortam o WORKSPACE inteiro", async () => {
      await cdp.evaluate("document.querySelector('[data-financial-filter=LOSS]').click()");
      assert.strictEqual(await rowCount(), 1);
      assert.ok((await cdp.evaluate("document.getElementById('cm-active-filters').innerText")).includes("Prejuízo"));
      await cdp.evaluate("document.querySelector('[data-financial-filter=LOSS]').click()");
      await cdp.evaluate("document.querySelector('[data-integrity-filter=MISSING]').click()");
      assert.strictEqual(await rowCount(), 1);
      assert.ok((await sheetText()).includes("Ventilador"));
      await cdp.evaluate("document.querySelector('[data-integrity-filter=MISSING]').click()");
      assert.strictEqual(await rowCount(), 50, "de volta à página visual 1 (50 de 51)");
    });

    await check("busca é local e alcança item fora da primeira página visual, sem nova leitura", async () => {
      const calls = await callCount();
      await cdp.evaluate(`(function(){var input=document.getElementById('cm-search');input.value='Fora Da Primeira Pagina';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await waitFor(cdp, "document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length === 1", "Busca não encontrou o item da página visual 2");
      assert.ok((await sheetText()).includes("Produto Raro Fora Da Primeira Pagina"));
      assert.strictEqual(await callCount(), calls, "busca local não pode chamar o backend");
      await cdp.evaluate(`(function(){var input=document.getElementById('cm-search');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await waitFor(cdp, "document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length === 50", "Busca não foi limpa");
    });

    await check("fila de divergências não repete a planilha e abre Evidências na variável certa", async () => {
      const head = (await cdp.evaluate("document.querySelector('#cm-divergences-host thead').innerText")).toLowerCase();
      assert.ok(head.includes("variável") && head.includes("impacto"), head);
      assert.ok(!head.includes("custo") && !head.includes("integridade"), "a fila não deve repetir as colunas da planilha");
      assert.ok((await cdp.evaluate("document.getElementById('cm-divergence-count').innerText")).includes("divergência"));
      await cdp.evaluate("document.querySelector('#cm-divergences-host [data-evidence-item=\"MLB-SUSPECT\"]').click()");
      const state = await cdp.evaluate("({tab:window.VFCentralMargemUi.getState().drawerTab,variable:window.VFCentralMargemUi.getState().evidenceVariable,item:window.VFCentralMargemUi.getState().selectedItemId})");
      assert.deepStrictEqual(state, { tab: "evidence", variable: "freight", item: "MLB-SUSPECT" });
      await sleep(150);
      const body = (await drawerText()).toLowerCase();
      assert.ok(body.includes("evidências de frete"), body);
      assert.ok(body.includes("selecionada"), body);
      assert.ok(body.includes("conflito"), body);
      await cdp.evaluate("document.getElementById('cm-drawer-close').click()");
    });

    await check("divergência fora da página visual aparece na fila, e trocar de página não muda a fila", async () => {
      const divergenceCountBefore = await cdp.evaluate("document.getElementById('cm-divergence-count').innerText");
      // O item com divergência está na página visual 2 (51º), fora da tabela
      // renderizada agora — mas a fila é do workspace inteiro.
      assert.ok(await cdp.evaluate("document.querySelector('#cm-divergences-host [data-evidence-item=\"MLB-DEEP-DIVERGENCE\"]') !== null"), "divergência fora da página 1 não apareceu na fila");
      assert.strictEqual(await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB-DEEP-DIVERGENCE\"]')"), null, "o item não deveria estar na tabela da página visual 1");

      const calls = await callCount();
      await cdp.evaluate("document.getElementById('cm-page-next').click()");
      assert.strictEqual(await rowCount(), 1, "página visual 2 tem só o 51º item");
      assert.ok(await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB-DEEP-DIVERGENCE\"]') !== null"));
      assert.strictEqual(await callCount(), calls, "paginação visual não pode chamar o backend");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-divergence-count').innerText"), divergenceCountBefore, "a fila não pode mudar ao trocar de página visual");
      await cdp.evaluate("document.getElementById('cm-page-prev').click()");
      assert.strictEqual(await rowCount(), 50);
    });

    await check("paginação visual: seletor 50/100/Todos carregados nunca chama a rede", async () => {
      const calls = await callCount();
      await cdp.evaluate(`(function(){var s=document.getElementById('cm-page-size');s.value='100';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      assert.strictEqual(await rowCount(), 51, "100 por página cabe o workspace inteiro (51)");
      await cdp.evaluate(`(function(){var s=document.getElementById('cm-page-size');s.value='all';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      assert.strictEqual(await rowCount(), 51);
      await cdp.evaluate(`(function(){var s=document.getElementById('cm-page-size');s.value='50';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      assert.strictEqual(await rowCount(), 50);
      assert.strictEqual(await callCount(), calls, "trocar o tamanho da página visual não pode chamar o backend");
    });

    await check("drawer tem Resumo, Cenário, Evidências e Auditoria", async () => {
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB-SUSPECT\"]').click()");
      await sleep(150);
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#cm-drawer-tabs [data-tab]').length"), 4);

      // innerText já vem com o text-transform da Fundação aplicado.
      const lower = async () => (await drawerText()).toLowerCase();

      let body = await lower();
      assert.ok(body.includes("leitura do motor"), body);
      assert.ok(body.includes("variáveis que merecem atenção"), body);
      assert.ok(body.includes("gates de segurança"), body);
      assert.ok(body.includes("escrita real indisponível"), body);

      await cdp.evaluate("document.querySelector('[data-tab=scenario]').click()");
      body = await lower();
      assert.ok(body.includes("composição do cenário"), body);
      assert.ok(body.includes("override manual — apenas cenário."), body);
      assert.ok(body.includes("resultado do cenário"), body);

      await cdp.evaluate("document.querySelector('[data-tab=evidence]').click()");
      body = await lower();
      assert.ok(body.includes("observedat"), body);
      assert.ok(body.includes("effectiveat"), body);
      assert.ok(body.includes("não informado"), "effectiveAt inexistente deve aparecer como Não informado");
      // A escolha do Motor (realizado) coexiste com a composição da planilha (projetado).
      assert.ok(body.includes("escolha do motor"), body);

      await cdp.evaluate("document.querySelector('[data-tab=audit]').click()");
      body = await lower();
      assert.ok(body.includes("rastro da leitura disponível nesta resposta"), body);
      assert.ok(body.includes("não um log de eventos gravado"), body);
      assert.ok(body.includes("snapshot persistido") && body.includes("não informado"), body);
      await cdp.evaluate("document.querySelector('[data-tab=summary]').click()");
    });

    await check("cenário recalcula com override local e sinaliza cenário incompleto", async () => {
      await cdp.evaluate("document.querySelector('[data-tab=scenario]').click()");
      await cdp.evaluate(`(function(){var i=document.querySelector('[data-scenario-value=price]');i.value='150';i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      let body = (await drawerText()).toLowerCase();
      assert.ok(body.includes("alterada"), body);
      assert.ok(/r\$\s150,00/.test(body), body);
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-scenario-reset').disabled"), false);

      // Sem custo o cenário não calcula — e não inventa zero.
      await cdp.evaluate(`(function(){var i=document.querySelector('[data-scenario-value=cost]');i.value='';i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      body = (await drawerText()).toLowerCase();
      assert.ok(body.includes("cenário incompleto"), body);
      await cdp.evaluate("document.getElementById('cm-scenario-reset').click()");
      assert.strictEqual(await cdp.evaluate("window.VFCentralMargemUi.getState().scenario.price.manual"), false);
    });

    await check("aplicação real de preço permanece desabilitada", async () => {
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-apply-scenario').disabled"), true);
      const html = await cdp.evaluate("document.documentElement.innerHTML");
      assert.ok(!/method\s*:\s*["'](POST|PUT|PATCH)/i.test(html), "a página não pode conter verbo de escrita");
    });

    await check("Mercado Pago e Extensão continuam explicitamente indisponíveis", async () => {
      const strip = await cdp.evaluate("document.getElementById('cm-source-strip').innerText");
      assert.ok(strip.includes("Mercado Pago") && strip.includes("integração pendente"), strip);
      assert.ok(strip.includes("Extensão") && strip.includes("ingestão pendente"), strip);
      await cdp.evaluate("document.querySelector('[data-tab=summary]').click()");
      const body = (await drawerText()).toLowerCase();
      assert.ok(body.includes("não integrado"), body);
      assert.ok(body.includes("recebimento líquido"), body);
      const disabled = await cdp.evaluate("Array.from(document.querySelectorAll('#cm-drawer-body button[disabled]')).map(function(b){return b.textContent}).join('|')");
      assert.ok(disabled.includes("Mercado Pago"), disabled);
    });

    await check("navegação anterior/próximo, Escape e restauração de foco", async () => {
      await cdp.evaluate("document.getElementById('cm-drawer-close').click()");
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB-LOW\"]').click()");
      assert.strictEqual(await cdp.evaluate("window.VFCentralMargemUi.getState().selectedItemId"), "MLB-LOW");
      await cdp.evaluate("document.getElementById('cm-drawer-next').click()");
      assert.strictEqual(await cdp.evaluate("window.VFCentralMargemUi.getState().selectedItemId"), "MLB-LOSS");
      await cdp.evaluate("document.getElementById('cm-drawer-prev').click()");
      assert.strictEqual(await cdp.evaluate("window.VFCentralMargemUi.getState().selectedItemId"), "MLB-LOW");
      assert.ok((await cdp.evaluate("document.getElementById('cm-drawer-position').innerText")).includes("de 51 produtos"));
      await cdp.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-drawer').classList.contains('is-open')"), false);
      assert.strictEqual(await cdp.evaluate("document.activeElement.getAttribute('data-item-id')"), "MLB-LOW");
    });

    await check("banner de cobertura parcial nunca apresenta amostra como catálogo inteiro", async () => {
      await cdp.evaluate("window.__cmUsePartial=true;document.getElementById('cm-refresh').click()");
      await waitFor(cdp, "!window.VFCentralMargemUi.getState().loading && window.VFCentralMargemUi.getState().data.coverage.partial === true", "Cobertura parcial não carregou");
      assert.ok((await cdp.evaluate("document.getElementById('cm-context-meta').innerText")).includes("51 de 350 carregados"));
      assert.ok((await cdp.evaluate("document.getElementById('cm-page-state').innerText")).includes("cobertura parcial"));
      await cdp.evaluate("window.__cmUsePartial=false;document.getElementById('cm-refresh').click()");
      await waitFor(cdp, "!window.VFCentralMargemUi.getState().loading && window.VFCentralMargemUi.getState().data.coverage.partial === false", "Retorno à cobertura completa falhou");
    });

    await check("layout não cria rolagem horizontal global em 1650, 1440, 1366, 1024, 768 e 390 px", async () => {
      for (const width of [1650, 1440, 1366, 1024, 768, 390]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width <= 600 });
        await sleep(90);
        const metrics = await cdp.evaluate("({viewport:window.innerWidth,scroll:document.documentElement.scrollWidth})");
        assert.ok(metrics.scroll <= metrics.viewport + 1, `${width}px: scroll ${metrics.scroll}, viewport ${metrics.viewport}`);
      }
      // >=1440px a planilha não pode exigir rolagem horizontal própria.
      for (const width of [1650, 1440]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await sleep(90);
        const sheet = await cdp.evaluate("(function(){var el=document.querySelector('.cm-table-wrap');return {scroll:el.scrollWidth,client:el.clientWidth}})()");
        assert.ok(sheet.scroll <= sheet.client + 1, `${width}px: planilha com scroll horizontal (scroll ${sheet.scroll}, client ${sheet.client})`);
      }
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB-HEALTHY\"]').click()");
      const drawer = await cdp.evaluate("(function(){var r=document.getElementById('cm-drawer').getBoundingClientRect();return {width:r.width,viewport:window.innerWidth}})()");
      assert.ok(drawer.width <= drawer.viewport + 1);
      await cdp.evaluate("document.getElementById('cm-drawer-close').click()");
    });

    await check("erro de backend oferece retry e recupera a leitura", async () => {
      await cdp.evaluate("window.__cmFail=true;document.getElementById('cm-refresh').click()");
      await waitFor(cdp, "window.VFCentralMargemUi.getState().error && document.getElementById('cm-page-state').innerText.indexOf('Erro simulado') !== -1", "Erro não apareceu");
      await cdp.evaluate("window.__cmFail=false;document.getElementById('cm-retry').click()");
      await waitFor(cdp, "window.VFCentralMargemUi.getState().data && !window.VFCentralMargemUi.getState().loading", "Retry não recuperou");
      assert.strictEqual(await rowCount(), 50);
    });

    console.log(`# ${checks} smoke tests de UI concluídos`);
  } finally {
    if (cdp) {
      try { await cdp.send("Fetch.disable"); } catch (_) { /* já pode estar fechado */ }
      cdp.close();
    }
    chrome.kill("SIGTERM");
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
