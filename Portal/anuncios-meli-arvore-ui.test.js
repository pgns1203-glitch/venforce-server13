/*
 * Visão agrupada de Anúncios ML — árvore Família -> User Product -> Item MLB.
 *
 * O que só um navegador comprova, e por isso está aqui:
 *
 *   · a aba "Famílias" é o default e NENHUMA família abre sozinha;
 *   · expandir é ação explícita e gasta exatamente UMA requisição;
 *   · colapsar e reabrir a mesma família NÃO gasta requisição nova (cache);
 *   · abrir a família A e a B antes de A responder não deixa a resposta
 *     atrasada de A pintar o painel de B (guarda por family_id);
 *   · trocar de conta invalida o cache — a família do contexto anterior não
 *     pode reaparecer com os dados velhos (guarda de época);
 *   · um user_product com 2 MLBs aparece UMA vez, com os dois anúncios dentro;
 *   · clicar numa linha MLB da árvore abre o MESMO modal do catálogo;
 *   · o badge da aba "Sem agrupamento" vem de ?filtro=sem_agrupamento (a mesma
 *     fonte da lista), nunca de sem_user_product.total — que conta menos;
 *   · os KPIs que escrevem `filtro` ficam desabilitados onde não se aplicam.
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

// Fixture da árvore. FAM-1 tem o caso que motivou a modelagem inteira: um
// user_product com DOIS MLBs (confirmado em produção nos clientes 32 e 35).
const FAMILIAS_CONTA_42 = [
  { family_id: "FAM-1", family_name: "Camiseta Dry Fit Masculina", total_user_products: 2, total_itens: 3,
    user_products: [
      { user_product_id: "MLBU-100", site_id: "MLB", domain_id: "MLB-T_SHIRTS", total_itens: 2 },
      { user_product_id: "MLBU-200", site_id: "MLB", domain_id: "MLB-T_SHIRTS", total_itens: 1 },
    ] },
  { family_id: "FAM-2", family_name: "Caneca Térmica 500ml", total_user_products: 1, total_itens: 1,
    user_products: [{ user_product_id: "MLBU-300", site_id: "MLB", domain_id: "MLB-MUGS", total_itens: 1 }] },
];
const FAMILIAS_CONTA_43 = [
  { family_id: "FAM-1", family_name: "FAMÍLIA DA LOJA B", total_user_products: 1, total_itens: 1,
    user_products: [{ user_product_id: "MLBU-900", site_id: "MLB", domain_id: "MLB-OTHER", total_itens: 1 }] },
];

function item(id, titulo, up, extra) {
  return Object.assign({
    item_id: id, user_product_id: up, family_id: "FAM-1", titulo: titulo,
    status: "active", preco: 89.9, estoque: 12, sku: "SKU-" + id,
    thumbnail: null, permalink: "https://produto.mercadolivre.com.br/" + id,
  }, extra || {});
}

const DETALHE_CONTA_42 = {
  "FAM-1": {
    family_id: "FAM-1", family_name: "Camiseta Dry Fit Masculina",
    user_products: [
      { user_product_id: "MLBU-100", site_id: "MLB", domain_id: "MLB-T_SHIRTS", total_itens: 2,
        itens: [item("MLB-A1", "Camiseta Dry Fit Preta P", "MLBU-100"), item("MLB-A2", "Camiseta Dry Fit Preta M", "MLBU-100")] },
      { user_product_id: "MLBU-200", site_id: "MLB", domain_id: "MLB-T_SHIRTS", total_itens: 1,
        itens: [item("MLB-A3", "Camiseta Dry Fit Azul G", "MLBU-200")] },
    ],
  },
  "FAM-2": {
    family_id: "FAM-2", family_name: "Caneca Térmica 500ml",
    user_products: [
      { user_product_id: "MLBU-300", site_id: "MLB", domain_id: "MLB-MUGS", total_itens: 1,
        itens: [item("MLB-B9", "Caneca Térmica Inox 500ml", "MLBU-300", { family_id: "FAM-2" })] },
    ],
  },
};
const DETALHE_CONTA_43 = {
  "FAM-1": {
    family_id: "FAM-1", family_name: "FAMÍLIA DA LOJA B",
    user_products: [
      { user_product_id: "MLBU-900", site_id: "MLB", domain_id: "MLB-OTHER", total_itens: 1,
        itens: [item("MLB-Z9", "Produto exclusivo da Loja B", "MLBU-900")] },
    ],
  },
};

// ── interruptores do cenário ───────────────────────────────────────────────
let atrasoDetalheFamilia = {};   // family_id -> ms
let totalSemAgrupamento = 7;     // paginacao.total de ?filtro=sem_agrupamento
const pedidos = [];

const SEMENTE = `
  try {
    localStorage.setItem("vf-token", "arvore-token");
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

function contar(padrao, desde) {
  return pedidos.slice(desde).filter((u) => padrao.test(u)).length;
}

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

async function clicar(cdp, seletor, mensagem) {
  const ok = await cdp.evaluate(`(function(){ var e = document.querySelector(${JSON.stringify(seletor)}); if(!e) return false; e.click(); return true; })()`);
  assert.ok(ok, mensagem || `não achei ${seletor} para clicar`);
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
      { name: "access-control-allow-methods", value: "GET,POST,PATCH,OPTIONS" },
    ];
    if (params.request.method === "OPTIONS") { await respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 204, responseHeaders: cors }); return; }
    const corpo = (obj, code) => respond("Fetch.fulfillRequest", {
      requestId: params.requestId, responseCode: code || 200,
      responseHeaders: [...cors, { name: "content-type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(obj)).toString("base64"),
    });

    const caminho = url.replace(`https://${PROD_HOST}`, "");
    pedidos.push(caminho);
    const conta = new URL(url).searchParams.get("clienteContaId") || "42";

    if (url.includes("/me/context")) { await corpo(ME_CONTEXT); return; }
    if (url.includes("/operacao/cliente-360/clientes")) { await corpo({ ok: true, clientes: [N97] }); return; }
    if (/\/clientes\/[^/?]+\/contas/.test(url)) { await corpo({ ok: true, cliente: N97, contas: N97_CONTAS }); return; }

    if (url.includes("/anuncios-meli/clientes")) {
      await corpo({ ok: true, clientes: [{ id: 87, nome: "N97 Comercial", slug: "n97", mlConectado: true, totalAnuncios: 4 }] });
      return;
    }
    if (url.includes("/anuncios-meli/resumo")) {
      await corpo({ ok: true, resumo: { total: 11, ativos: 9, pausados: 2, scoreBaixo: 3, semSku: 1, full: 2, ultimaSync: new Date().toISOString() } });
      return;
    }

    // IMPORTANTE: /familias tem de ser casado ANTES do detalhe genérico
    // /anuncios-meli/:itemId — é o mesmo cuidado de ordem que a rota do
    // Express precisou ter no backend.
    const mDetalheFam = caminho.match(/^\/anuncios-meli\/familias\/([^/?]+)/);
    if (mDetalheFam) {
      const familyId = decodeURIComponent(mDetalheFam[1]);
      const atraso = atrasoDetalheFamilia[familyId];
      if (atraso) await sleep(atraso);
      const fonte = conta === "43" ? DETALHE_CONTA_43 : DETALHE_CONTA_42;
      const familia = fonte[familyId];
      if (!familia) { await corpo({ ok: false, motivo: "Família não encontrada." }, 404); return; }
      await corpo({ ok: true, cliente: { slug: "n97", nome: "N97 Comercial" }, familia });
      return;
    }

    if (caminho.startsWith("/anuncios-meli/familias")) {
      const familias = conta === "43" ? FAMILIAS_CONTA_43 : FAMILIAS_CONTA_42;
      await corpo({
        ok: true, cliente: { slug: "n97", nome: "N97 Comercial" },
        familias,
        sem_user_product: { total: 2 },   // de propósito DIFERENTE do total da aba
        paginacao: { page: 1, limit: 20, totalFamilias: familias.length, totalPaginas: 1 },
      });
      return;
    }

    const mDetalhe = caminho.match(/^\/anuncios-meli\/([^/?]+)(\?|$)/);
    if (mDetalhe && mDetalhe[1] !== "") {
      const itemId = mDetalhe[1];
      await corpo({
        ok: true, cliente: { slug: "n97", nome: "N97 Comercial" },
        anuncio: {
          item_id: itemId, titulo: "Camiseta Dry Fit Preta P", sku: "SKU-" + itemId,
          marca: "DryCo", modelo: "DF1", preco: 89.9, moeda: "BRL", estoque: 12, vendidos: 30,
          status: "active", listing_type_id: "gold_special", category_id: "MLB1055",
          permalink: "https://produto.mercadolivre.com.br/" + itemId, thumbnail: null,
          pictures_count: 2, pictures_json: [], attributes_json: [], is_full: false,
          health: 0.8, score_venforce: 70, revisado: false, cliente_conta_id: Number(conta),
          last_synced_at: new Date().toISOString(), catalog_listing: false, family_name: null,
        },
        descricao: "Descrição de teste.", descricaoEstado: "ok", descricaoErro: null,
        categoriaNome: "Camisetas",
      });
      return;
    }

    if (url.includes("/anuncios-meli")) {
      const filtro = new URL(url).searchParams.get("filtro");
      const total = filtro === "sem_agrupamento" ? totalSemAgrupamento : 11;
      await corpo({
        ok: true,
        anuncios: [{
          item_id: "MLB-SEMUP", titulo: "Anúncio legado sem agrupamento", sku: null,
          preco: 49.9, moeda: "BRL", estoque: 3, vendidos: 1, status: "active",
          permalink: null, thumbnail: null, pictures_count: 1, is_full: false,
          score_venforce: 40, revisado: false,
        }],
        paginacao: { page: 1, limit: 24, total, totalPaginas: 1 },
      });
      return;
    }

    await respond("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" });
  };
  return excecoes;
}

async function run() {
  const server = await startServer();
  const porta = server.address().port;
  const debugPort = 23000 + Math.floor(Math.random() * 900);
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--window-size=1440,900",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/vf-arvore-${process.pid}`, "about:blank",
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
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        window.__erros = [];
        addEventListener("error", function (e) {
          window.__erros.push(String(e.message) + " @ " + e.filename + ":" + e.lineno);
        });
        addEventListener("unhandledrejection", function (e) {
          window.__erros.push("rejeição: " + String((e.reason && e.reason.stack) || e.reason));
        });
      `,
    });

    pedidos.length = 0;
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
    await waitFor(cdp, "document.querySelector('.vf-shell__sidebar')", "Shell V3 não montou");
    await waitFor(cdp, "document.getElementById('vf-shell-main').hidden === false", "gating de conta não liberou a tela");

    /* ── 1 a 3: a aba Famílias é o default e nada abre sozinho ──────────── */

    await check("1 — a aba Famílias é o default e lista as famílias", async () => {
      await waitFor(cdp, "document.querySelector('.am-familia')", "a árvore de famílias não renderizou");
      const estado = await cdp.evaluate(`(function(){
        return {
          familias: document.querySelectorAll('.am-familia').length,
          abaAtiva: document.querySelector('#am-modo .is-active').getAttribute('data-modo'),
          catalogoOculto: document.getElementById('am-catalogo-container').hidden,
          nome: document.querySelector('.am-familia__nome').textContent,
        }; })()`);
      assert.strictEqual(estado.familias, 2);
      assert.strictEqual(estado.abaAtiva, "familias");
      assert.strictEqual(estado.catalogoOculto, true, "o catálogo em lista não pode ficar visível na aba Famílias");
      assert.strictEqual(estado.nome, "Camiseta Dry Fit Masculina");
    });

    await check("2 — nenhuma família abre sozinha", async () => {
      const abertas = await cdp.evaluate("document.querySelectorAll('.am-familia__head[aria-expanded=\"true\"]').length");
      assert.strictEqual(abertas, 0, "alguma família já veio expandida");
      const painelCarregado = await cdp.evaluate("document.querySelectorAll('.am-familia__painel .am-up').length");
      assert.strictEqual(painelCarregado, 0, "houve carga de detalhe sem o usuário pedir");
      assert.strictEqual(contar(/\/familias\/FAM/, 0), 0, "gastou requisição de detalhe sem clique");
    });

    await check("3 — a listagem de famílias não traz MLB nenhum", async () => {
      const mlbs = await cdp.evaluate("document.querySelectorAll('.am-mlb').length");
      assert.strictEqual(mlbs, 0);
    });

    /* ── 4 a 6: expansão explícita, hierarquia e UP com 2 MLBs ──────────── */

    let antesExpandir = pedidos.length;
    await check("4 — expandir a família busca o detalhe e monta os três níveis", async () => {
      await clicar(cdp, '.am-familia[data-familia="FAM-1"] .am-familia__head');
      await waitFor(cdp, "document.querySelector('.am-familia[data-familia=\"FAM-1\"] .am-up')", "o painel da família não carregou");
      const estado = await cdp.evaluate(`(function(){
        var fam = document.querySelector('.am-familia[data-familia="FAM-1"]');
        return {
          expandido: fam.querySelector('.am-familia__head').getAttribute('aria-expanded'),
          painelVisivel: !fam.querySelector('.am-familia__painel').hidden,
          ups: fam.querySelectorAll('.am-up').length,
          mlbs: fam.querySelectorAll('.am-mlb').length,
        }; })()`);
      assert.strictEqual(estado.expandido, "true");
      assert.strictEqual(estado.painelVisivel, true);
      assert.strictEqual(estado.ups, 2, "a família tem 2 user products");
      assert.strictEqual(estado.mlbs, 3, "a família tem 3 anúncios no total");
      assert.strictEqual(contar(/\/familias\/FAM-1/, antesExpandir), 1, "deve gastar exatamente 1 requisição");
    });

    await check("5 — o user product com 2 MLBs aparece UMA vez, com os dois dentro", async () => {
      const up = await cdp.evaluate(`(function(){
        var blocos = Array.from(document.querySelectorAll('.am-familia[data-familia="FAM-1"] .am-up'));
        var alvo = blocos.filter(function(b){ return b.querySelector('.am-up__id').textContent === 'MLBU-100'; });
        return {
          ocorrencias: alvo.length,
          itens: alvo.length ? Array.from(alvo[0].querySelectorAll('.am-mlb')).map(function(r){ return r.getAttribute('data-item'); }) : [],
        }; })()`);
      assert.strictEqual(up.ocorrencias, 1, "o user product foi duplicado na tela");
      assert.deepStrictEqual(up.itens, ["MLB-A1", "MLB-A2"]);
    });

    await check("6 — o user product não é clicável (é só agrupamento visual)", async () => {
      const interativo = await cdp.evaluate(`(function(){
        var head = document.querySelector('.am-up__head');
        return { tag: head.tagName, temRole: head.hasAttribute('role'), temTabindex: head.hasAttribute('tabindex') }; })()`);
      assert.strictEqual(interativo.tag, "DIV");
      assert.strictEqual(interativo.temRole, false);
      assert.strictEqual(interativo.temTabindex, false);
    });

    /* ── 7: cache — colapsar e reabrir não gasta requisição ─────────────── */

    await check("7 — colapsar e reabrir a mesma família NÃO gasta requisição nova", async () => {
      const antes = pedidos.length;
      await clicar(cdp, '.am-familia[data-familia="FAM-1"] .am-familia__head');
      await waitFor(cdp, "document.querySelector('.am-familia[data-familia=\"FAM-1\"] .am-familia__painel').hidden === true", "não colapsou");
      await clicar(cdp, '.am-familia[data-familia="FAM-1"] .am-familia__head');
      await waitFor(cdp, "document.querySelector('.am-familia[data-familia=\"FAM-1\"] .am-familia__painel').hidden === false", "não reabriu");
      const mlbs = await cdp.evaluate("document.querySelectorAll('.am-familia[data-familia=\"FAM-1\"] .am-mlb').length");
      assert.strictEqual(mlbs, 3, "o conteúdo não voltou ao reabrir");
      assert.strictEqual(contar(/\/familias\/FAM-1/, antes), 0, "reabrir gastou requisição — o cache não funcionou");
    });

    /* ── 8: guarda de corrida entre duas famílias ───────────────────────── */

    await check("8 — resposta atrasada da família A não pinta o painel da família B", async () => {
      // Recarregar a página é o jeito honesto de zerar o cache da FAM-1 sem
      // abrir um hook de teste dentro do código de produção.
      atrasoDetalheFamilia = { "FAM-1": 700 };
      pedidos.length = 0;
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
      await waitFor(cdp, "document.querySelector('.am-familia')", "a árvore não voltou depois do reload");

      await clicar(cdp, '.am-familia[data-familia="FAM-1"] .am-familia__head');
      await clicar(cdp, '.am-familia[data-familia="FAM-2"] .am-familia__head');
      await waitFor(cdp, "document.querySelector('.am-familia[data-familia=\"FAM-2\"] .am-up')", "a família B não carregou");

      const b = await cdp.evaluate(`(function(){
        var fam = document.querySelector('.am-familia[data-familia="FAM-2"]');
        return Array.from(fam.querySelectorAll('.am-mlb')).map(function(r){ return r.getAttribute('data-item'); }); })()`);
      assert.deepStrictEqual(b, ["MLB-B9"], "o painel da família B recebeu dados de outra família");

      // Espera a resposta atrasada de A chegar e confirma que ela foi para o
      // painel de A, sem contaminar o de B.
      await waitFor(cdp, "document.querySelector('.am-familia[data-familia=\"FAM-1\"] .am-up')", "a família A não carregou depois do atraso");
      const depois = await cdp.evaluate(`(function(){
        var fam = document.querySelector('.am-familia[data-familia="FAM-2"]');
        return Array.from(fam.querySelectorAll('.am-mlb')).map(function(r){ return r.getAttribute('data-item'); }); })()`);
      assert.deepStrictEqual(depois, ["MLB-B9"], "a resposta atrasada de A sobrescreveu o painel de B");
      atrasoDetalheFamilia = {};
    });

    /* ── 9: troca de conta invalida o cache ────────────────────────────── */

    await check("9 — trocar de conta limpa o cache: a família não volta com dados da conta anterior", async () => {
      await waitFor(cdp, "document.querySelector('.am-familia[data-familia=\"FAM-1\"] .am-up')", "FAM-1 precisa estar carregada antes da troca");
      const antesTroca = await cdp.evaluate(`document.querySelector('.am-familia[data-familia="FAM-1"] .am-up__id').textContent`);
      assert.strictEqual(antesTroca, "MLBU-100");

      await cdp.evaluate("window.VF.context.setConta('43')");
      await waitFor(cdp, `document.querySelector('.am-familia__nome') && document.querySelector('.am-familia__nome').textContent === 'FAMÍLIA DA LOJA B'`,
        "a lista de famílias não trocou junto com a conta");

      const abertas = await cdp.evaluate("document.querySelectorAll('.am-familia__head[aria-expanded=\"true\"]').length");
      assert.strictEqual(abertas, 0, "a família continuou expandida depois da troca de conta");

      const antes = pedidos.length;
      await clicar(cdp, '.am-familia[data-familia="FAM-1"] .am-familia__head');
      await waitFor(cdp, "document.querySelector('.am-familia[data-familia=\"FAM-1\"] .am-up')", "a família da nova conta não carregou");
      const up = await cdp.evaluate(`document.querySelector('.am-familia[data-familia="FAM-1"] .am-up__id').textContent`);
      assert.strictEqual(up, "MLBU-900", "veio o dado cacheado da conta anterior");
      assert.strictEqual(contar(/\/familias\/FAM-1/, antes), 1, "o cache velho impediu a busca na conta nova");
    });

    /* ── 10 a 12: aba Sem agrupamento ───────────────────────────────────── */

    await check("10 — o badge usa ?filtro=sem_agrupamento, não sem_user_product.total", async () => {
      // A fixture devolve sem_user_product.total = 2 e paginacao.total = 7 de
      // propósito: só o número certo passa neste teste.
      await waitFor(cdp, "document.getElementById('am-modo-badge').hidden === false", "o badge não apareceu");
      const texto = await cdp.evaluate("document.getElementById('am-modo-badge').textContent");
      assert.strictEqual(texto, String(totalSemAgrupamento));
      const usouFiltro = pedidos.some((u) => /\/anuncios-meli\?.*filtro=sem_agrupamento.*limit=1/.test(u));
      assert.ok(usouFiltro, "o badge não veio da mesma fonte da lista");
    });

    await check("11 — a aba Sem agrupamento mostra a lista recortada pelo backend", async () => {
      await clicar(cdp, '#am-modo [data-modo="sem_agrupamento"]');
      await waitFor(cdp, "document.querySelector('#am-catalogo-container .am-row')", "a lista sem agrupamento não renderizou");
      const estado = await cdp.evaluate(`(function(){
        return {
          familiasOculto: document.getElementById('am-familias-container').hidden,
          catalogoVisivel: !document.getElementById('am-catalogo-container').hidden,
          abaAtiva: document.querySelector('#am-modo .is-active').getAttribute('data-modo'),
          indicador: document.getElementById('am-filtros-ativos').classList.contains('am-hidden'),
        }; })()`);
      assert.strictEqual(estado.familiasOculto, true);
      assert.strictEqual(estado.catalogoVisivel, true);
      assert.strictEqual(estado.abaAtiva, "sem_agrupamento");
      assert.strictEqual(estado.indicador, true, 'o recorte da aba não pode contar como "filtro ativo"');
      const pedido = pedidos.filter((u) => /^\/anuncios-meli\?/.test(u)).pop();
      assert.ok(/filtro=sem_agrupamento/.test(pedido), `a aba não pediu o recorte certo: ${pedido}`);
    });

    await check("12 — voltar para Famílias e retornar não gasta requisição nova", async () => {
      const antes = pedidos.length;
      await clicar(cdp, '#am-modo [data-modo="familias"]');
      await waitFor(cdp, "document.getElementById('am-familias-container').hidden === false", "não voltou para Famílias");
      await clicar(cdp, '#am-modo [data-modo="sem_agrupamento"]');
      await waitFor(cdp, "document.getElementById('am-catalogo-container').hidden === false", "não voltou para Sem agrupamento");
      assert.strictEqual(contar(/^\/anuncios-meli\?/, antes), 0, "alternar as abas refez requisição");
      assert.strictEqual(contar(/\/anuncios-meli\/familias\?/, antes), 0, "alternar as abas refez a lista de famílias");
    });

    /* ── 13: KPIs desabilitados onde não se aplicam ─────────────────────── */

    await check("13 — os KPIs que escrevem `filtro` ficam desabilitados nas duas abas", async () => {
      const semAgrupamento = await cdp.evaluate(`(function(){
        var m = {};
        document.querySelectorAll('#am-resumo [data-kpi]').forEach(function(b){ m[b.getAttribute('data-kpi')] = b.disabled; });
        return m; })()`);
      ["score_muito_bom", "score_medio", "score_baixo", "mercado_full", "sem_sku"].forEach(function (k) {
        assert.strictEqual(semAgrupamento[k], true, `KPI ${k} deveria estar desabilitado na aba Sem agrupamento`);
      });
      assert.strictEqual(semAgrupamento.ativos, false, "KPI de status deveria continuar disponível");
      assert.strictEqual(semAgrupamento.pausados, false, "KPI de status deveria continuar disponível");

      await clicar(cdp, '#am-modo [data-modo="familias"]');
      await waitFor(cdp, "document.getElementById('am-familias-container').hidden === false", "não voltou para Famílias");
      const familias = await cdp.evaluate(`(function(){
        var m = {};
        document.querySelectorAll('#am-resumo [data-kpi]').forEach(function(b){ m[b.getAttribute('data-kpi')] = b.disabled; });
        return m; })()`);
      assert.strictEqual(familias.ativos, true, "na aba Famílias o endpoint não aceita status — o KPI precisa ficar fora");
      assert.strictEqual(familias.sem_sku, true);
    });

    /* ── 14: a linha MLB abre o modal de sempre ─────────────────────────── */

    await check("14 — clicar numa linha MLB da árvore abre o MESMO modal do catálogo", async () => {
      await clicar(cdp, '.am-familia[data-familia="FAM-1"] .am-familia__head');
      await waitFor(cdp, "document.querySelector('.am-mlb')", "a árvore não trouxe linhas MLB");
      await clicar(cdp, ".am-mlb");
      await waitFor(cdp, "document.querySelector('.am-det-modal')", "o modal não abriu pela linha da árvore");
      await waitFor(cdp, "document.getElementById('am-det-titulo')", "o modal não terminou de carregar");
      const m = await cdp.evaluate(`(function(){
        var e = document.querySelector('.am-det-modal');
        return { role: e.getAttribute('role'), modal: e.getAttribute('aria-modal') }; })()`);
      assert.strictEqual(m.role, "dialog");
      assert.strictEqual(m.modal, "true");
    });

    /* ── 15: nenhum erro de JS na página ───────────────────────────────── */

    await check("15 — nenhum erro de JavaScript durante os fluxos", async () => {
      const jsErros = await cdp.evaluate("window.__erros || []");
      assert.deepStrictEqual(jsErros, [], `erros de JS: ${JSON.stringify(jsErros)}`);
      assert.deepStrictEqual(excecoes, [], `exceções: ${JSON.stringify(excecoes)}`);
    });

    console.log(`\n✓ ${checks} verificações da árvore Família → User Product → Item MLB`);
  } catch (err) {
    try {
      const jsErros = await cdp.evaluate("window.__erros || []");
      if (jsErros && jsErros.length) console.error("erros de JS na página:", JSON.stringify(jsErros, null, 2));
    } catch (_) { /* a sessão pode já ter caído */ }
    throw err;
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
