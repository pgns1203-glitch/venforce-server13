/* Sincronização NÃO bloqueante: o andamento fica no card de sincronização
   (etapa 1 = sync, etapa 2 = recálculo da margem), sem modal, com a tela
   utilizável. Harness e fixtures copiados da lista visual. */
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
  window.__VF_AM_MARGEM_POLL_MS__ = 60;
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
const MOCK = { syncPendentes: [], syncResposta: null, refreshPosts: 0, familiasGets: 0, run: null };

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
      { name: "access-control-allow-methods", value: "GET,POST,OPTIONS" },
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
    if (pathname === "/anuncios-meli/resumo") return respond({ ok: true, resumo: { total: 11, ativos: 9, pausados: 2, scoreBaixo: 3, semSku: 1, semCusto: 2, full: 2, ultimaSync: new Date().toISOString() } });
    const family = pathname.match(/^\/anuncios-meli\/familias\/([^/]+)/);
    if (family) return respond({ ok: true, cliente: N97, familia: DETALHE_CONTA_42[decodeURIComponent(family[1])] });
    if (pathname === "/anuncios-meli/familias") { MOCK.familiasGets += 1; } if (pathname === "/anuncios-meli/familias") return respond({ ok: true, cliente: N97, anuncios: LINHAS_CONTA_42, paginacao: { page: 1, limit: 20, total: LINHAS_CONTA_42.length, totalPaginas: 1 } });
    if (pathname === "/anuncios-meli/sync") {
      MOCK.syncPendentes.push(() => respond(MOCK.syncResposta));
      return;
    }
    if (/\/snapshot\/refresh$/.test(pathname)) {
      MOCK.refreshPosts += 1;
      return respond({ ok: true, runId: 77, reaproveitado: true, run: { runId: 77, status: "running", processedItems: 0, totalItems: 175 } }, 202);
    }
    if (/\/snapshot\/refresh\/77$/.test(pathname)) return respond({ ok: true, run: MOCK.run });
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


const SHOT_DIR = process.env.VF_SHOT_DIR || "";
async function shot(cdp, nome) {
  if (!SHOT_DIR) return;
  await sleep(900);
  const r = await cdp.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1440, height: 420, scale: 1 } });
  fs.writeFileSync(path.join(SHOT_DIR, nome + ".png"), Buffer.from(r.data, "base64"));
}

const estado = `(() => {
  const st = document.getElementById("am-sync-status");
  return {
    overlay: !!document.querySelector(".am-sync-overlay, .vf-overlay.is-open"),
    semScroll: document.body.classList.contains("vf-no-scroll"),
    classe: st ? st.className : null,
    titulo: st ? st.querySelector(".am-sync-status__titulo").textContent : null,
    texto: st ? st.textContent : null,
    etapas: st ? Array.from(st.querySelectorAll(".am-sync-etapa")).map((e) => (e.className.match(/is-([a-z]+)/) || [])[1]) : [],
    d1: st ? st.querySelector('[data-etapa="1"] .am-sync-etapa__detalhe').textContent : null,
    d2: st ? st.querySelector('[data-etapa="2"] .am-sync-etapa__detalhe').textContent : null,
    contador: st && st.querySelector(".am-sync-contador") ? st.querySelector(".am-sync-contador").textContent : null,
    resultado: st && st.querySelector(".am-sync-status__resultado") ? st.querySelector(".am-sync-status__resultado").textContent : null,
    acoesVisiveis: !!(document.querySelector(".am-sync-acoes") && !document.querySelector(".am-sync-acoes").hidden),
    dentroDoCard: !!(st && st.closest(".am-sync-area")),
    completoDisabled: document.getElementById("am-sync-completo").disabled,
    novosDisabled: document.getElementById("am-sync-novos").disabled,
  };
})()`;

async function soltarSync(cdp, resposta) {
  MOCK.syncResposta = resposta;
  await waitFor(cdp, "true");
  for (let i = 0; i < 100 && !MOCK.syncPendentes.length; i++) await sleep(30);
  assert.ok(MOCK.syncPendentes.length, "o POST /sync não chegou");
  await MOCK.syncPendentes.shift()();
}

async function run() {
  const server = await startServer();
  const debugPort = 24000 + Math.floor(Math.random() * 900);
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--window-size=1440,900", `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=/tmp/vf-sync-status-${process.pid}`, "about:blank",
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
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/anuncios-meli.html?cliente=n97&conta=42` });
    await waitFor(cdp, "document.getElementById('am-sync-completo') && document.querySelector('.am-row--grupo[data-familia=\"FAM-1\"]')", "HUD/lista não renderizou");
    await shot(cdp, "0-parado");

    await check("S1 - clicar em Sincronização completa não abre modal nem trava a tela", async () => {
      await cdp.evaluate("document.getElementById('am-sync-completo').click()");
      await waitFor(cdp, "document.getElementById('am-sync-status')", "status não apareceu");
      const e = await cdp.evaluate(estado);
      assert.strictEqual(e.overlay, false, "ainda existe overlay");
      assert.strictEqual(e.semScroll, false, "body travado (vf-no-scroll)");
      assert.ok(e.dentroDoCard, "status fora do card de sincronização");
      assert.ok(/is-andamento/.test(e.classe), e.classe);
      assert.strictEqual(e.titulo, "Sincronização completa");
      assert.deepStrictEqual(e.etapas, ["ativo", "pendente"], "etapa 1 ativa, etapa 2 na fila");
      assert.ok(/Consultando o Mercado Livre/.test(e.d1), e.d1);
      assert.ok(/continuar usando a tela/.test(e.texto), e.texto);
      assert.strictEqual(e.acoesVisiveis, false, "a lista de ações deveria dar lugar ao painel");
      assert.ok(e.completoDisabled && e.novosDisabled, "botões deveriam ficar desabilitados");
      await shot(cdp, "1-sincronizando");
    });

    await check("S2 - durante a sincronização a lista continua utilizável (expandir família)", async () => {
      await cdp.evaluate("document.querySelector('.am-row--grupo[data-familia=\"FAM-1\"] .am-row__acao').click()");
      await waitFor(cdp, "document.querySelectorAll('.am-mlb').length > 0", "família não expandiu com o sync em andamento");
      const e = await cdp.evaluate(estado);
      assert.ok(/is-andamento/.test(e.classe), "status sumiu ao mexer na lista");
    });

    await check("S3 - sync gravado: etapa 2 mostra o recálculo da margem com progresso", async () => {
      MOCK.run = { runId: 77, status: "running", processedItems: 40, totalItems: 175 };
      const antes = MOCK.familiasGets;
      await soltarSync(cdp, { ok: true, codigo: "OK", modo: "completo", contaId: 42, totalEncontrados: 175, totalProcessados: 175, totalSalvos: 175, limitado: false });
      await waitFor(cdp, "/40\\s*de 175/.test((document.querySelector('.am-sync-contador')||{}).textContent||'')", "progresso do recálculo não apareceu");
      const e = await cdp.evaluate(estado);
      assert.deepStrictEqual(e.etapas, ["feito", "ativo"], "etapa 1 feita, etapa 2 ativa");
      assert.ok(/175 na conta · 175 gravados/.test(e.d1), e.d1);
      assert.strictEqual(await cdp.evaluate("document.querySelector('[data-sync-fill]').style.width"), "23%", "barra deveria refletir 40/175");
      assert.ok(e.completoDisabled, "botões deveriam seguir desabilitados no recálculo");
      assert.strictEqual(MOCK.refreshPosts, 1, "mesmo POST /snapshot/refresh da Central de Margem");
      assert.ok(MOCK.familiasGets > antes, "lista deveria ser relida após o sync (anúncios novos)");
      await shot(cdp, "2-recalculando");
    });

    await check("S4 - recálculo concluído: status de sucesso, lista relida, botões liberados", async () => {
      const antes = MOCK.familiasGets;
      MOCK.run = { runId: 77, status: "completed", processedItems: 175, totalItems: 175, successItems: 175, failedItems: 0 };
      await waitFor(cdp, "/is-ok/.test((document.getElementById('am-sync-status')||{}).className||'')", "não chegou ao estado concluído");
      const e = await cdp.evaluate(estado);
      assert.deepStrictEqual(e.etapas, ["feito", "feito"]);
      assert.ok(/175 anúncio\(s\) recalculados/.test(e.d2), e.d2);
      assert.ok(/Concluído às \d\d:\d\d · levou \d+:\d\d/.test(e.resultado), e.resultado);
      assert.ok(!e.completoDisabled && !e.novosDisabled, "botões deveriam voltar");
      await waitFor(cdp, "true");
      for (let i = 0; i < 50 && MOCK.familiasGets <= antes; i++) await sleep(30);
      assert.ok(MOCK.familiasGets > antes, "lista não foi relida após o recálculo");
      await shot(cdp, "3-concluido");
    });

    await check("S5 - o aviso de concluído pode ser dispensado", async () => {
      await cdp.evaluate("document.querySelector('[data-sync-fechar]').click()");
      await waitFor(cdp, "!document.getElementById('am-sync-status')", "aviso não foi dispensado");
      assert.strictEqual((await cdp.evaluate(estado)).acoesVisiveis, true, "a lista de ações deveria voltar");
    });

    await check("S6 - falha do sync aparece no card, sem modal, e libera os botões", async () => {
      await cdp.evaluate("document.getElementById('am-sync-novos').click()");
      await waitFor(cdp, "/Atualizar novos/.test((document.querySelector('#am-sync-status .am-sync-status__titulo')||{}).textContent||'')", "status de novos não apareceu");
      await soltarSync(cdp, { ok: false, codigo: "NO_TOKEN", motivo: "Este cliente ainda não tem uma conta do Mercado Livre conectada." });
      await waitFor(cdp, "/is-erro/.test((document.getElementById('am-sync-status')||{}).className||'')", "erro não apareceu");
      const e = await cdp.evaluate(estado);
      assert.strictEqual(e.overlay, false);
      assert.deepStrictEqual(e.etapas, ["erro", "pendente"]);
      assert.ok(/Conecte a conta do Mercado Livre/.test(e.d1), e.d1);
      assert.ok(/Tentar de novo/.test(e.texto), "erro deveria oferecer tentar de novo");
      assert.ok(!e.completoDisabled && !e.novosDisabled);
      await shot(cdp, "4-erro");
    });

    console.log(`\n${failures ? "RED" : "GREEN"}: ${checks - failures}/${checks} checks passaram; ${failures} falharam.`);
    if (failures) process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    chrome.kill("SIGTERM");
    server.close();
  }
}
run().catch((err) => { console.error(err); process.exitCode = 1; });
