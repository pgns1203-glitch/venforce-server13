/* Regressao visual A1-A6. Harness e fixtures copiados da listagem unificada. */
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
const N97_CONTAS = [
  { id: 42, cliente_id: 87, marketplace: "meli", nome: "Loja A", externalAccountLabel: "lojaa", ativo: true, grant: { token_status: "valid" }, base: { base_id: 9, nome: "Custo" } },
  { id: 43, cliente_id: 87, marketplace: "meli", nome: "Loja B", externalAccountLabel: "lojab", ativo: true, grant: { token_status: "valid" }, base: { base_id: 9, nome: "Custo" } },
];
const ME_CONTEXT = {
  ok: true,
  user: { id: 12, nome: "Pedro Gomes", email: null, role: "user" },
  squads: [], squadPrincipalId: null,
  clientes: [{ id: 87, slug: "n97", nome: "N97 Comercial", squadId: null, responsavelDireto: false, contasAtivas: 2 }],
  portfolio: { totalClientes: 1 },
  permissoes: { podeAdministrar: false },
};
const CAPA_FAM1 = "https://http2.mlstatic.com/capa-fam1.jpg";
const IMAGEM_DO_PRIMEIRO_ITEM = "https://http2.mlstatic.com/item-a1.jpg";
const IMAGEM_DO_ITEM_DA_FAM2 = "https://http2.mlstatic.com/item-b9.jpg";
const ESTOQUE_FAM1 = 300;
const LINHAS_CONTA_42 = [
  {
    tipo: "familia", key: "fam:FAM-1", family_id: "FAM-1",
    family_name: "Camiseta Dry Fit Masculina", titulo: "Camiseta Dry Fit Masculina",
    total_user_products: 3, total_itens: 4,
    estoque_total: ESTOQUE_FAM1, vendidos_total: 31,
    preco_min: 89.9, preco_max: 129.9, moeda: "BRL", score_min: 40,
    status_contagem: { ativos: 4, pausados: 0, encerrados: 0 },
    cover: { thumbnail: CAPA_FAM1, user_product_id: "MLBU-200" },
  },
  {
    tipo: "familia", key: "fam:FAM-2", family_id: "FAM-2",
    family_name: "Caneca Térmica 500ml", titulo: "Caneca Térmica 500ml",
    total_user_products: 1, total_itens: 1,
    estoque_total: 12, vendidos_total: 0,
    preco_min: 39.9, preco_max: 39.9, moeda: "BRL", score_min: 80,
    status_contagem: { ativos: 1, pausados: 0, encerrados: 0 },
    cover: { thumbnail: null, user_product_id: "MLBU-300" },
  },
  {
    tipo: "item", key: "item:MLB-SEMUP", item_id: "MLB-SEMUP", family_id: null,
    titulo: "Anúncio legado sem agrupamento", sku: null,
    preco: 49.9, preco_original: 69.9, moeda: "BRL", estoque: 3, vendidos: 1, status: "active",
    permalink: null, thumbnail: null, pictures_count: 1, is_full: false,
    catalog_listing: false, family_name: null, variations_count: 24,
    listing_type_id: "gold_special",
    score_venforce: 40, revisado: false,
    total_itens: 1, total_user_products: 0, estoque_total: 3, vendidos_total: 1,
    cover: { thumbnail: null, user_product_id: null },
    margemProjetadaPercent: 25, margemProjetadaProfit: 12.5, margemProjetadaComputable: true,
    margemProjetadaStatus: "HEALTHY", margemProjetadaCalculadaEm: "2026-09-20T10:00:00Z", margemProjetadaOrigemJob: "manual_cli",
  },
  {
    tipo: "item", key: "item:MLB-SEMVAR", item_id: "MLB-SEMVAR", family_id: null,
    titulo: "Anúncio simples, sem variações no ML", sku: "SKU-SEMVAR",
    preco: 29.9, preco_original: null, moeda: "BRL", estoque: 8, vendidos: 0, status: "active",
    permalink: null, thumbnail: null, pictures_count: 3, is_full: false,
    catalog_listing: false, family_name: null, variations_count: 0,
    score_venforce: 55, revisado: false,
    total_itens: 1, total_user_products: 0, estoque_total: 8, vendidos_total: 0,
    cover: { thumbnail: null, user_product_id: null },
  },
];
function item(id, titulo, up, extra) {
  return Object.assign({
    item_id: id, user_product_id: up, family_id: "FAM-1", titulo: titulo,
    status: "active", preco: 89.9, moeda: "BRL", estoque: 100, vendidos: 5, score_venforce: 62, sku: "SKU-" + id,
    thumbnail: null, permalink: "https://produto.mercadolivre.com.br/" + id,
    listing_type_id: "gold_special",
    pictures_count: 5, is_full: false, revisado: false, catalog_listing: false,
    margemProjetadaPercent: 20, margemProjetadaProfit: 15, margemProjetadaComputable: true,
    margemProjetadaStatus: "HEALTHY", margemProjetadaCalculadaEm: "2026-09-20T10:00:00Z", margemProjetadaOrigemJob: "manual_cli",
  }, extra || {});
}
const NOME_FAM1 = "Camiseta Dry Fit Masculina";
const DETALHE_CONTA_42 = {
  "FAM-1": {
    family_id: "FAM-1", family_name: NOME_FAM1,
    user_products: [
      { user_product_id: "MLBU-100", site_id: "MLB", domain_id: "MLB-T_SHIRTS", total_itens: 2,
        itens: [item("MLB-A1", NOME_FAM1 + " Azul P (12 parcelas)", "MLBU-100",
                  {
                    thumbnail: IMAGEM_DO_PRIMEIRO_ITEM, listing_type_id: "gold_pro",
                    pictures_count: 1, is_full: true, revisado: true, catalog_listing: true,
                    margemProjetadaPercent: -5, margemProjetadaProfit: -10, margemProjetadaStatus: "LOSS",
                  }),
                item("MLB-A2", NOME_FAM1 + " Azul P", "MLBU-100",
                  {
                    listing_type_id: "gold_special",
                    margemProjetadaPercent: null, margemProjetadaProfit: null, margemProjetadaComputable: false,
                    margemProjetadaStatus: "UNVALIDATED", margemProjetadaCalculadaEm: null,
                  })] },
      { user_product_id: "MLBU-200", site_id: "MLB", domain_id: "MLB-T_SHIRTS", total_itens: 1,
        itens: [item("MLB-A3", NOME_FAM1 + " Azul M", "MLBU-200",
          { listing_type_id: "gold_special" })] },
      { user_product_id: "MLBU-300", site_id: "MLB", domain_id: "MLB-T_SHIRTS", total_itens: 1,
        itens: [item("MLB-A4", NOME_FAM1 + " Azul G", "MLBU-300",
          { listing_type_id: "gold_pro" })] },
    ],
  },
  "FAM-2": {
    family_id: "FAM-2", family_name: "Caneca Térmica 500ml",
    user_products: [
      { user_product_id: "MLBU-300C", site_id: "MLB", domain_id: "MLB-MUGS", total_itens: 1,
        itens: [item("MLB-B9", "Caneca Térmica Inox 500ml", "MLBU-300C",
          {
            family_id: "FAM-2", estoque: 12, thumbnail: IMAGEM_DO_ITEM_DA_FAM2,
            margemProjetadaPercent: null, margemProjetadaProfit: null, margemProjetadaComputable: false,
            margemProjetadaStatus: null, margemProjetadaCalculadaEm: null,
          })] },
    ],
  },
};
const METRICAS_FIXTURE = {
  "MLB-SEMUP": { views: 259, vendas: 3, conversao: 1.2 },
  "MLB-A1": { views: null, vendas: 0, conversao: null },
  "MLB-A2": { views: 100, vendas: 0, conversao: 0 },
};
const MARGEM_FIXTURE = {
  "MLB-SEMUP": { origem: "projected", margin: 0.25, marginPercent: 25, status: "HEALTHY", statusLabel: "Saudável", statusReasons: [], precoOriginal: 69.9 },
  "MLB-A1": { origem: "projected", margin: -0.05, marginPercent: -5, status: "LOSS", statusLabel: "Prejuízo", statusReasons: ["Margem negativa (-5.00%)."] },
  "MLB-A2": { origem: "projected", margin: null, marginPercent: null, status: "UNVALIDATED", statusLabel: "Não validado", statusReasons: ["Variáveis obrigatórias ausentes: custo."] },
};

const SEMENTE = `
  try {
    localStorage.setItem("vf-token", "lista-token");
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
  for (let i = 0; i < 200; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return; } catch (_) {  }
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
let failures = 0;
async function check(name, fn) {
  checks += 1;
  try { await fn(); console.log(`ok ${checks} - ${name}`); }
  catch (err) { failures += 1; console.error(`not ok ${checks} - ${name}: ${err.message}`); }
}

// Mesmos contratos e fixtures do teste de listagem; apenas rotas de leitura
// necessarias para montar a lista, os KPIs e a expansao de FAM-1.
function wireInterception(cdp) {
  cdp.onEvent = async (method, params) => {
    if (method !== "Fetch.requestPaused") return;
    const url = params.request.url;
    const requestId = params.requestId;
    if (!url.includes(PROD_HOST)) {
      await cdp.send("Fetch.continueRequest", { requestId }); return;
    }
    const headers = [
      { name: "access-control-allow-origin", value: "*" },
      { name: "access-control-allow-headers", value: "authorization,content-type" },
      { name: "access-control-allow-methods", value: "GET,OPTIONS" },
      { name: "content-type", value: "application/json" },
    ];
    async function respond(obj, code = 200) {
      await cdp.send("Fetch.fulfillRequest", {
        requestId, responseCode: code, responseHeaders: headers,
        body: Buffer.from(JSON.stringify(obj)).toString("base64"),
      });
    }
    if (params.request.method === "OPTIONS") { await respond({}, 204); return; }
    const pathname = new URL(url).pathname;
    if (pathname.includes("/me/context")) return respond(ME_CONTEXT);
    if (pathname.includes("/operacao/cliente-360/clientes")) return respond({ ok: true, clientes: [N97] });
    if (/\/clientes\/[^/?]+\/contas/.test(pathname)) return respond({ ok: true, cliente: N97, contas: N97_CONTAS });
    if (pathname === "/anuncios-meli/clientes") return respond({ ok: true, clientes: [{ id: 87, nome: N97.nome, slug: "n97", mlConectado: true, totalAnuncios: 5 }] });
    if (pathname === "/anuncios-meli/resumo") return respond({ ok: true, resumo: { total: 11, ativos: 9, pausados: 2, scoreBaixo: 3, semSku: 1, full: 2, ultimaSync: new Date().toISOString() } });
    const family = pathname.match(/^\/anuncios-meli\/familias\/([^/]+)/);
    if (family) return respond({ ok: true, cliente: N97, familia: DETALHE_CONTA_42[decodeURIComponent(family[1])] });
    if (pathname === "/anuncios-meli/familias") return respond({ ok: true, cliente: N97, anuncios: LINHAS_CONTA_42, paginacao: { page: 1, limit: 20, total: LINHAS_CONTA_42.length, totalPaginas: 1 } });
    if (pathname === "/anuncios-meli/performance") {
      const qs = new URL(url).searchParams;
      const metricas7d = {}, margem = {};
      (qs.get("itemIds") || "").split(",").filter(Boolean).forEach((id) => {
        if (qs.get("incluirMetricas") !== "0") metricas7d[id] = METRICAS_FIXTURE[id] || { views: 10, vendas: 1, conversao: 10 };
        if (qs.get("incluirMargem") !== "0") margem[id] = MARGEM_FIXTURE[id] || { origem: "projected", margin: 0.2, marginPercent: 20, status: "HEALTHY", statusLabel: "Saud?vel", statusReasons: [] };
      });
      return respond({ ok: true, metricas7d, margem, margemIndisponivel: null, faturamento: null, unidadesVendidas: null, curvaAbc: null, margemPorFamilia: null });
    }
    await cdp.send("Fetch.failRequest", { requestId, errorReason: "ConnectionRefused" });
  };
}

// Medicoes do DOM real: nao altera estilos nem substitui o layout por mocks.
function measure() {
  const card = document.querySelector(".am-listagem");
  const rect = card.getBoundingClientRect();
  const visible = (e) => e.getClientRects().length && e.getBoundingClientRect().height > 0;
  const select = (s) => Array.from(card.querySelectorAll(s)).filter(visible);
  function oneLine(selector, contentHeight = false) {
    const elements = select(selector);
    const bad = elements.filter((e) => {
      const style = getComputedStyle(e);
      const lh = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
      const height = e.getBoundingClientRect().height - (contentHeight
        ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
          + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
        : 0);
      // Caixa de altura fixa (.vf-tag: height 22px, line-height 1) não diz
      // nada sobre quebra: conta as LINHAS do texto pelos retângulos do Range.
      const range = document.createRange();
      range.selectNodeContents(e);
      // Fontes mistas (texto + <span class="vf-mono">) desalinham o topo dos
      // retângulos sem quebrar: só conta linha nova quando o retângulo começa
      // ABAIXO do fundo da linha corrente.
      const rects = Array.from(range.getClientRects())
        .filter((r) => r.width > 0 && r.height > 0)
        .sort((a, b) => a.top - b.top);
      let linhas = rects.length ? 1 : 0;
      let fundo = rects.length ? rects[0].bottom : 0;
      rects.slice(1).forEach((r) => {
        if (r.top >= fundo - 2) { linhas += 1; fundo = r.bottom; } else { fundo = Math.max(fundo, r.bottom); }
      });
      if (contentHeight) return e.getClientRects().length !== 1 || linhas > 1;
      return e.getClientRects().length !== 1 || height > 1.6 * lh;
    }).map((e) => ({ class: e.className, text: e.textContent.trim(), rects: e.getClientRects().length, height: e.getBoundingClientRect().height, lineHeight: getComputedStyle(e).lineHeight }));
    return { count: elements.length, bad };
  }
  const outside = select(".am-row__acao, .am-gauge").filter((e) => {
    const r = e.getBoundingClientRect();
    return r.left < rect.left || r.right > rect.right;
  }).map((e) => ({ class: e.className, right: e.getBoundingClientRect().right, cardRight: rect.right }));
  // O card pode ser o scroller ou conter um wrapper comum ao head e ? expansao.
  const head = card.querySelector(".am-listagem__head");
  const mlb = card.querySelector(".am-mlb");
  const candidates = [card, ...card.querySelectorAll("*")].filter((e) => e.contains(head) && e.contains(mlb));
  const scroller = candidates.find((e) => /^(auto|scroll)$/.test(getComputedStyle(e).overflowX)) || card;
  scroller.scrollLeft = scroller.scrollWidth;
  const lastCells = select(".am-row__acao, .am-gauge");
  const sr = scroller.getBoundingClientRect();
  const unreachable = lastCells.filter((e) => e.getBoundingClientRect().right > sr.right + 1).map((e) => e.className);
  const scroll = { width: scroller.clientWidth, content: scroller.scrollWidth, overflowX: getComputedStyle(scroller).overflowX, left: scroller.scrollLeft, unreachable };
  scroller.scrollLeft = 0;
  const rows = {};
  document.querySelectorAll(".am-resumo .am-kpi").forEach((e) => { rows[e.offsetTop] = (rows[e.offsetTop] || 0) + 1; });
  const grids = select(".am-listagem__head, .am-row--grupo, .am-row[data-item], .am-mlb").map((e) => ({ class: e.className, columns: getComputedStyle(e).gridTemplateColumns }));
  return {
    cardWidth: rect.width, clientWidth: card.clientWidth, scrollWidth: card.scrollWidth, outside, scroll,
    tokens: oneLine(".am-row__ids > *, .am-row__badges .vf-tag, .am-mlb .vf-tag, .am-mlb__cond, .vf-status, .am-margem__valor, .am-metricas7d__linha", true),
    headings: oneLine(".am-listagem__head span"), kpiRows: Object.values(rows), grids,
  };
}

async function run() {
  const server = await startServer();
  const debugPort = 24000 + Math.floor(Math.random() * 900);
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--window-size=1920,900", `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=/tmp/vf-lista-visual-${process.pid}`, "about:blank",
  ], { stdio: "ignore" });
  let cdp;
  try {
    await waitChrome(debugPort);
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })).json();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    wireInterception(cdp);
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SEMENTE });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/anuncios-meli.html?cliente=n97&conta=42` });
    await waitFor(cdp, "document.querySelector('.am-row--grupo[data-familia=\"FAM-1\"]') && document.querySelector('.am-row[data-item]') && document.querySelectorAll('.am-resumo .am-kpi').length === 8", "Lista e oito KPIs nao renderizaram");
    await cdp.evaluate("document.querySelector('.am-row--grupo[data-familia=\"FAM-1\"] .am-row__acao').click()");
    await waitFor(cdp, "document.querySelectorAll('.am-mlb').length === 4 && document.querySelector('.am-mlb .am-margem__valor') && document.querySelector('.am-mlb .am-metricas7d__linha')", "FAM-1 ou performance nao renderizou");
    await cdp.evaluate("document.fonts.ready.then(() => true)");
    for (const width of [1920, 1440, 1366, 1280, 1024]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      const m = await cdp.evaluate("(" + measure.toString() + ")()");
      console.log(`# viewport ${width}px; card ${m.cardWidth}px`);
      await check(`A1 / ${width}px - colunas dentro do card >=1040px`, async () => {
        if (m.cardWidth < 1040) return;
        assert.ok(m.scrollWidth <= m.clientWidth && !m.outside.length, JSON.stringify({ clientWidth: m.clientWidth, scrollWidth: m.scrollWidth, outside: m.outside }));
      });
      await check(`A2 / ${width}px - ultima coluna acessivel abaixo de 1040px`, async () => {
        if (m.cardWidth >= 1040) return;
        assert.ok((m.scroll.content <= m.scroll.width || /^(auto|scroll)$/.test(m.scroll.overflowX)) && !m.scroll.unreachable.length, JSON.stringify(m.scroll));
      });
      await check(`A3 / ${width}px - tokens em uma linha`, async () => {
        assert.ok(m.tokens.count > 0);
        assert.deepStrictEqual(m.tokens.bad, [], JSON.stringify(m.tokens.bad));
      });
      await check(`A4 / ${width}px - cabecalhos em uma linha`, async () => {
        assert.ok(m.headings.count > 0);
        assert.deepStrictEqual(m.headings.bad, [], JSON.stringify(m.headings.bad));
      });
      await check(`A5 / ${width}px - KPIs sem fileira orfa`, async () => {
        assert.strictEqual(m.kpiRows.reduce((a, b) => a + b, 0), 8);
        assert.ok(!m.kpiRows.includes(1), JSON.stringify(m.kpiRows));
      });
      await check(`A6 / ${width}px - mesma grade no head, grupo, item e MLB`, async () => {
        assert.ok(m.grids.length >= 7);
        assert.ok(m.grids.every((g) => g.columns === m.grids[0].columns), JSON.stringify(m.grids));
      });
    }
    console.log(`\n${failures ? "RED" : "GREEN"}: ${checks - failures}/${checks} checks passaram; ${failures} falharam.`);
    if (failures) process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    chrome.kill("SIGTERM");
    server.close();
  }
}
run().catch((err) => { console.error(err); process.exitCode = 1; });
