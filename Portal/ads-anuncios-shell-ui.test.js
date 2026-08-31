/*
 * F5 — Ads e Anúncios ML migrados para o Shell V3 (data-vf-scope="account").
 *
 * As duas telas tinham seletor próprio de Cliente E de Conta Mercado Livre —
 * e, com eles, a segunda e a terceira cópia da regra de cardinalidade que
 * vive em vf-context.js ("2+ contas ativas → pedir escolha", R8). O que este
 * teste mede é o que só um navegador comprova:
 *
 *   · o `clienteContaId` que sai nas requisições é o do CONTEXTO, e muda
 *     junto com o dropdown de Operação do Shell — ler a loja errada é o modo
 *     de falhar aqui;
 *   · trocar de operação não recarrega a página e não deixa dado da conta
 *     anterior na tela;
 *   · o 409 de conta ambígua volta ao STORE (signalContextError) em vez de
 *     virar um "sem dados" local que o operador não sabe resolver;
 *   · em Ads, a competência é a mesma `?periodo=YYYY-MM` do resto do V3 (o
 *     seletor antigo só montava meses do ano corrente);
 *   · em Anúncios, "Sem conexão ML" deixou de ser o estado padrão de quem
 *     ainda não foi verificado.
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
  { id: 42, cliente_id: 87, marketplace: "meli", nome: "Mercado Livre 1", externalAccountLabel: "n97store", ativo: true, grant: { token_status: "valid" }, base: { base_id: 9, nome: "Custo" } },
  { id: 43, cliente_id: 87, marketplace: "meli", nome: "Mercado Livre 2", externalAccountLabel: "n97outlet", ativo: true, grant: { token_status: "valid" }, base: { base_id: 9, nome: "Custo" } },
];
const ME_CONTEXT = {
  ok: true,
  user: { id: 12, nome: "Pedro Gomes", email: null, role: "user" },
  squads: [], squadPrincipalId: null,
  clientes: [{ id: 87, slug: "n97", nome: "N97 Comercial", squadId: null, responsavelDireto: false, contasAtivas: 2 }],
  portfolio: { totalClientes: 1 },
  permissoes: { podeAdministrar: false },
};

// Shape real de GET /ads/performance: { ok, semDados, performance: {...} }.
// O investimento muda por conta — é assim que o teste vê se a tela trocou
// mesmo de operação, e não só refez a requisição.
function performance(conta) {
  return {
    ok: true, semDados: false,
    performance: {
      mesRef: "2026-07",
      investimentoAds: conta === "43" ? 2000 : 1000,
      gmvAds: conta === "43" ? 40000 : 20000,
      roas: 20, acos: 5, ctr: 1, cpc: 2,
      cliques: 100, impressoes: 1000, vendas: 10,
      totalAnuncios: 5, anuncios: [], campanhas: [],
    },
  };
}

let adsResponde409 = false;
const pedidos = []; // toda URL de API que a página disparou

const SEMENTE = `
  try {
    localStorage.setItem("vf-token", "ads-ui-token");
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

async function esperarPedido(padrao, desde, mensagem) {
  for (let i = 0; i < 200; i++) {
    if (pedidos.slice(desde).some((u) => padrao.test(u))) return pedidos.slice(desde).filter((u) => padrao.test(u));
    await sleep(50);
  }
  throw new Error(mensagem || `Nenhuma requisição casou ${padrao}. Vistas: ${JSON.stringify(pedidos.slice(desde))}`);
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
    const corpo = (obj, code) => respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: code || 200, responseHeaders: [...cors, { name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(obj)).toString("base64") });
    pedidos.push(url.replace(`https://${PROD_HOST}`, ""));

    if (url.includes("/me/context")) { await corpo(ME_CONTEXT); return; }
    if (url.includes("/operacao/cliente-360/clientes")) { await corpo({ ok: true, clientes: [N97] }); return; }
    if (/\/clientes\/[^/?]+\/contas/.test(url)) { await corpo({ ok: true, cliente: N97, contas: N97_CONTAS }); return; }

    if (url.includes("/ads/performance")) {
      if (adsResponde409) { await corpo({ ok: false, code: "MULTIPLE_MARKETPLACE_ACCOUNTS", erro: "Mais de uma conta." }, 409); return; }
      const conta = new URL(url).searchParams.get("clienteContaId") || "";
      await corpo(performance(conta));
      return;
    }
    if (url.includes("/ads/")) { await corpo({ ok: true }); return; }

    if (url.includes("/anuncios-meli/clientes")) {
      await corpo({ ok: true, clientes: [{ id: 87, nome: "N97 Comercial", slug: "n97", mlConectado: true, totalAnuncios: 120 }] });
      return;
    }
    if (url.includes("/anuncios-meli/resumo")) { await corpo({ ok: true, resumo: { total: 120, ultimaSync: "2026-08-20T10:00:00Z" } }); return; }
    if (url.includes("/anuncios-meli")) { await corpo({ ok: true, anuncios: [], total: 0, page: 1, limit: 24, totalPaginas: 1 }); return; }

    await respond("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" });
  };
  return excecoes;
}

async function run() {
  const server = await startServer();
  const porta = server.address().port;
  const debugPort = 21000 + Math.floor(Math.random() * 900);
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/vf-ads-anuncios-${process.pid}`, "about:blank",
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

    /* ═════════════════════════════ ADS ════════════════════════════════ */
    pedidos.length = 0;
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/ads.html?cliente=n97&conta=42&periodo=2026-07` });
    await waitFor(cdp, "document.querySelector('.vf-shell__sidebar')", "Shell V3 não montou em ads.html");
    await waitFor(cdp, "document.getElementById('vf-shell-main').hidden === false", "gating de conta não liberou ads.html");

    await check("F5/ads — os seletores próprios de Cliente e de Conta sumiram", async () => {
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#ads-filtro-cliente, #ads-filtro-conta, #ads-filtro-conta-wrap').length"), 0,
        "ads.html ainda tem seletor próprio de cliente/conta");
      assert.ok(await cdp.evaluate("Boolean(document.getElementById('vf-op-trigger'))"), "o seletor de Operação do Shell deveria estar presente");
    });

    await check("F5/ads — a competência vem de ?periodo=, e o seletor oferece competências reais (não só o ano corrente)", async () => {
      assert.strictEqual(await cdp.evaluate("document.getElementById('ads-filtro-mes').value"), "2026-07");
      const valores = await cdp.evaluate("Array.prototype.map.call(document.querySelectorAll('#ads-filtro-mes option'), function(o){return o.value;}).filter(Boolean)");
      assert.strictEqual(valores.length, 13, `esperado 13 competências, veio ${valores.length}`);
      assert.ok(valores.every((v) => /^\d{4}-\d{2}$/.test(v)), `todas devem ser YYYY-MM: ${JSON.stringify(valores)}`);
      const anos = new Set(valores.map((v) => v.slice(0, 4)));
      assert.ok(anos.size >= 2, `13 competências têm que atravessar mais de um ano: ${JSON.stringify([...anos])}`);
    });

    await check("F5/ads — a requisição sai com o clienteContaId DO CONTEXTO", async () => {
      const chamadas = await esperarPedido(/\/ads\/performance/, 0, "nenhuma chamada a /ads/performance");
      const ultima = chamadas[chamadas.length - 1];
      assert.ok(ultima.includes("clienteSlug=n97"), `sem o cliente do contexto: ${ultima}`);
      assert.ok(ultima.includes("clienteContaId=42"), `sem a conta do contexto: ${ultima}`);
      assert.ok(ultima.includes("mes=2026-07"), `sem a competência da URL: ${ultima}`);
    });

    await check("F5/ads — trocar de Operação no Shell refaz a busca na conta nova, sem recarregar a página", async () => {
      await cdp.evaluate("window.__marca = 1");
      const desde = pedidos.length;
      await cdp.evaluate("window.VF.context.setConta(43)");
      const chamadas = await esperarPedido(/\/ads\/performance.*clienteContaId=43/, desde, "a troca de operação não refez a busca");
      assert.strictEqual(await cdp.evaluate("window.__marca"), 1, "a página recarregou — a troca de operação deveria ser reativa");
      assert.ok(chamadas.length >= 1);
      // E o número em tela é o da conta nova, não o da anterior.
      await waitFor(cdp, "document.getElementById('ads-table-body').innerText.indexOf('2.000') >= 0", "a tabela continuou com o dado da conta anterior");
    });

    await check("F5/ads — 409 de conta ambígua volta ao STORE, não vira 'sem dados' local", async () => {
      adsResponde409 = true;
      await cdp.evaluate("window.VF.context.setConta(42)");
      await waitFor(cdp, "window.VF.context.getState() === 'ACCOUNT_CHOICE_REQUIRED'", "o 409 não virou estado de contexto");
      const estado = await cdp.evaluate("document.querySelector('.vf-shell__state') ? document.querySelector('.vf-shell__state').innerText : ''");
      assert.ok(/Escolha a operação/i.test(estado), `o shell deveria pedir a operação: ${estado}`);
      adsResponde409 = false;
    });

    /* ══════════════════════════ ANÚNCIOS ML ═══════════════════════════ */
    pedidos.length = 0;
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
    await waitFor(cdp, "document.querySelector('.vf-shell__sidebar')", "Shell V3 não montou em anuncios-meli.html");
    await waitFor(cdp, "document.getElementById('vf-shell-main').hidden === false", "gating de conta não liberou anuncios-meli.html");
    await sleep(300);

    await check("F5/anuncios — a VIEW de escolher cliente e o seletor de conta sumiram", async () => {
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#am-view-clientes, #am-busca-cliente, #am-filtro-conta, #am-voltar').length"), 0,
        "anuncios-meli.html ainda tem o próprio seletor de cliente/conta");
      assert.strictEqual(await cdp.evaluate("document.getElementById('am-view-hud').classList.contains('am-hidden')"), false,
        "a HUD deveria estar visível: com contexto resolvido não há nada a escolher aqui");
    });

    await check("F5/anuncios — a HUD é do cliente do contexto e as buscas levam o clienteContaId certo", async () => {
      const hud = await cdp.evaluate("document.getElementById('am-hud-top').innerText");
      assert.ok(/N97 Comercial/.test(hud), `a HUD deveria mostrar o cliente do contexto: ${hud}`);
      assert.ok(/ML conectado/.test(hud), `mlConectado real deveria aparecer: ${hud}`);
      const catalogo = await esperarPedido(/\/anuncios-meli\?/, 0, "nenhuma busca de catálogo");
      assert.ok(catalogo[catalogo.length - 1].includes("clienteContaId=42"), `catálogo sem a conta do contexto: ${catalogo[catalogo.length - 1]}`);
      const resumo = await esperarPedido(/\/anuncios-meli\/resumo/, 0, "nenhuma busca de resumo");
      assert.ok(resumo[resumo.length - 1].includes("clienteContaId=42"), `resumo sem a conta do contexto: ${resumo[resumo.length - 1]}`);
    });

    await check("F5/anuncios — trocar de Operação refaz resumo e catálogo na conta nova", async () => {
      const desde = pedidos.length;
      await cdp.evaluate("window.VF.context.setConta(43)");
      await esperarPedido(/\/anuncios-meli\?.*clienteContaId=43/, desde, "o catálogo não seguiu a troca de operação");
      await esperarPedido(/\/anuncios-meli\/resumo.*clienteContaId=43/, desde, "o resumo não seguiu a troca de operação");
    });

    await check("F5/anuncios — o campo de busca do catálogo tem altura de campo, não uma caixa de 150px", async () => {
      // Achado OLHANDO a tela, não por asserção: `.vf-toolbar__filters
      // .vf-search { flex: 0 0 150px }` foi escrito para o input SOLTO na
      // barra, onde 150px é largura. Envolto num `.vf-field` (coluna), o
      // mesmo flex-basis vira ALTURA — 150×150 com o placeholder cortado.
      // Corrigido com `>` na regra; esta verificação impede a volta.
      const m = await cdp.evaluate(`
        (function(){ var e = document.getElementById('am-busca'); if (!e) return null;
          var r = e.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width) }; })();
      `);
      assert.ok(m, "campo de busca do catálogo não existe");
      assert.ok(m.h < 60, `altura do campo de busca: ${m.h}px — voltou a ser dimensionado como caixa`);
      assert.ok(m.w > 200, `largura do campo de busca: ${m.w}px — espremido a 150px dentro do .vf-field`);
    });

    await check("F5 — nenhuma exceção de JS não tratada em nenhuma das duas telas", async () => {
      const relevantes = excecoes.filter((m) => !/Failed to fetch|NetworkError|ERR_/i.test(m));
      assert.deepStrictEqual(relevantes, [], `exceções: ${JSON.stringify(relevantes)}`);
    });

    console.log(`\n✓ ${checks} verificações de Ads e Anúncios ML migrados (F5)`);
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
