/*
 * Teste VISUAL da Central de Margem (layout da Fase 3) com dados FAKE da
 * "Red Fish": 8 anúncios (2 em prejuízo, 2 abaixo da meta, 4 saudáveis), as
 * promoções do Promo Snapshot e a Bancada do drawer (Atual × Cenário).
 *
 * Não toca a rede real: o Chrome headless carrega Portal/ de um servidor
 * estático local e a rede de produção é interceptada via CDP. O client da
 * Central é o mock de central-margem-pricing-ui.test.js (extraído do próprio
 * arquivo e ajustado abaixo — se aquele mock mudar e algum ajuste não casar, o
 * teste falha dizendo qual).
 *
 * Gera PNGs em CM_SHOT_DIR (padrão: <tmp>/central-margem-visual) e imprime os
 * caminhos. Além das capturas confere o essencial do layout (4 KPIs, aviso
 * único do realizado, ordem da worklist, cascata da Bancada, sem rolagem
 * horizontal).
 */
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const PORTAL_DIR = __dirname;
const SHOT_DIR = process.env.CM_SHOT_DIR || path.join(os.tmpdir(), "central-margem-visual");

function startStaticServer() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = pathname === "/" ? "central-margem.html" : pathname.replace(/^\/+/, "");
    const target = path.resolve(PORTAL_DIR, relative);
    if (!target.startsWith(path.resolve(PORTAL_DIR) + path.sep)) { response.writeHead(403).end("forbidden"); return; }
    fs.readFile(target, (error, contents) => {
      if (error) { response.writeHead(404).end("not found"); return; }
      const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
      response.writeHead(200, { "Content-Type": types[path.extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
      response.end(contents);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitChrome(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return; } catch (_) { /* aguardando */ }
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
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
        return;
      }
      if (message.method && this.onEvent) this.onEvent(message.method, message.params);
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error((result.exceptionDetails.exception && result.exceptionDetails.exception.description) || result.exceptionDetails.text || "Falha na avaliação do navegador");
    return result.result.value;
  }
  close() { this.socket.close(); }
}

async function waitFor(cdp, expression, message) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (await cdp.evaluate(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(message || `Timeout: ${expression}`);
}

let checks = 0;
async function check(name, fn) { await fn(); checks += 1; console.log(`ok ${checks} - ${name}`); }

// ── Dados fake da Red Fish ─────────────────────────────────────────────────
// Margem = (0,78·P − 65)/P: é a conta do mock da Bancada (imposto 10%, comissão
// 12%, frete R$ 15, custo R$ 50), então a tabela e a Bancada contam a mesma história.
const REDFISH_ITENS = `[
      { id: "MLB1003", titulo: "Carretilha Marine Sports Sparta 7000", preco: 59.9, status: "LOSS", alvo: 95.6 },
      { id: "MLB1004", titulo: "Vara Telescópica Pro 3,60m Carbono", preco: 71.9, status: "LOSS", alvo: 95.6 },
      { id: "MLB1005", titulo: "Linha Multifilamento 0,30mm 300m", preco: 87, status: "LOW_MARGIN", alvo: 95.6 },
      { id: "MLB1006", titulo: "Anzol Circle 4/0 Caixa c/ 50", preco: 91, status: "LOW_MARGIN", alvo: 95.6 },
      { id: "MLB1001", titulo: "Isca Artificial Camarão Neon 9cm", preco: 110.48, status: "HEALTHY" },
      { id: "MLB1002", titulo: "Molinete Atlantic Pro 3000 5 Rolamentos", preco: 149.9, status: "HEALTHY" },
      { id: "MLB1007", titulo: "Bolsa Térmica de Pesca 25L", preco: 189.9, status: "HEALTHY" },
      { id: "MLB1008", titulo: "Caixa Organizadora 3 Gavetas", preco: 229.9, status: "HEALTHY" },
    ].map(function (i) { i.margem = Math.round(((0.78 * i.preco - 65) / i.preco) * 10000) / 10000; return i; })`;

function mockDaRedFish() {
  const origem = fs.readFileSync(path.join(PORTAL_DIR, "central-margem-pricing-ui.test.js"), "utf8");
  const achado = origem.match(/const MOCK_CLIENT = `([\s\S]*?)\n`;/);
  assert.ok(achado, "mock de central-margem-pricing-ui.test.js não encontrado");
  let mock = achado[1];
  const trocar = (de, para, rotulo) => {
    const antes = mock;
    mock = typeof de === "string" ? mock.split(de).join(para) : mock.replace(de, para);
    assert.notStrictEqual(mock, antes, `ajuste do mock não casou: ${rotulo}`);
  };
  trocar(/var ITENS = \[[\s\S]*?\n    \];/, `var ITENS = ${REDFISH_ITENS};`, "ITENS");
  trocar('margin: it.id === "MLB1003" ? { target: { marginTarget: 0.1, price: 79.9, computable: true } } : undefined,', "margin: it.alvo ? { target: { marginTarget: 0.1, price: it.alvo, computable: true } } : undefined,", "preço-alvo estimado");
  trocar(/var PRECO_TABELA = \{[^}]*\};/, "var PRECO_TABELA = { MLB9999: 99.9 }; ITENS.forEach(function (i) { PRECO_TABELA[i.id] = i.preco; });", "PRECO_TABELA");
  trocar("totalItens: 3", "totalItens: 8", "totalItens");
  trocar("kpis: { total: 3, porStatus: { HEALTHY: 2, LOW_MARGIN: 0, LOSS: 1,", "kpis: { lcPrejuizo: -27.2, total: 8, porStatus: { HEALTHY: 4, LOW_MARGIN: 2, LOSS: 2,", "KPIs do resumo");
  trocar("anuncios: { total: 3, ativos: 3, pausados: 0 }, comMargem: 3", "anuncios: { total: 8, ativos: 8, pausados: 0 }, comMargem: 8", "anúncios");
  trocar("paginacao: { page: 1, limit: 50, total: 3, totalPaginas: 1 }", "paginacao: { page: 1, limit: 50, total: 8, totalPaginas: 1 }", "paginação");
  trocar("preco: 81.5,", "preco: 95.59,", "preço-alvo cotado");
  trocar("Loja piloto", "Red Fish · ML Principal", "nome da conta");
  trocar("Produto X", "Isca Artificial Camarão Neon 9cm", "título MLB1001");
  trocar("Produto Y", "Molinete Atlantic Pro 3000 5 Rolamentos", "título MLB1002");
  trocar("Produto fora da página", "Chumbada Oliva 40g (fora da página)", "título MLB9999");
  trocar("Sem histórico", "Rede de Arremesso 2,5m (sem histórico)", "título MLB7777");
  return mock;
}

async function run() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const mock = mockDaRedFish();
  const server = await startStaticServer();
  const serverPort = server.address().port;
  const debugPort = 16000 + Math.floor(Math.random() * 1000);
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/vf-central-margem-visual-${process.pid}`, "about:blank",
  ], { stdio: "ignore" });

  let cdp;
  try {
    await waitChrome(debugPort);
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })).json();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    const PROD_HOST = "venforce-server.onrender.com";
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    cdp.onEvent = async (method, params) => {
      if (method !== "Fetch.requestPaused") return;
      const url = params.request.url;
      const respond = async (m, p) => { try { await cdp.send(m, p); } catch (err) { if (!/Invalid InterceptionId/.test(err.message || "")) throw err; } };
      if (!url.includes(PROD_HOST)) { await respond("Fetch.continueRequest", { requestId: params.requestId }); return; }
      const cors = [
        { name: "access-control-allow-origin", value: "*" },
        { name: "access-control-allow-headers", value: "authorization,content-type" },
        { name: "access-control-allow-methods", value: "GET,POST,OPTIONS" },
      ];
      const json = (obj) => respond("Fetch.fulfillRequest", {
        requestId: params.requestId, responseCode: 200,
        responseHeaders: [...cors, { name: "content-type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(obj)).toString("base64"),
      });
      if (params.request.method === "OPTIONS") { await respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 204, responseHeaders: cors }); return; }
      if (url.includes("/me/context")) {
        await json({ ok: true, user: { id: 12, nome: "Pedro Gomes", email: null, role: "user" }, squads: [], squadPrincipalId: null,
          clientes: [{ id: 90, slug: "red_fish", nome: "Red Fish", squadId: null, responsavelDireto: false, contasAtivas: null }], portfolio: { totalClientes: 1 }, permissoes: { podeAdministrar: false } });
        return;
      }
      if (url.includes("/operacao/cliente-360/clientes")) {
        await json({ ok: true, clientes: [{ id: 90, nome: "Red Fish", slug: "red_fish", ativo: true, temGrant: true, grantStatus: "conectado", temBase: true, setupScore: 100, statusOperacional: "pronto", ultimaSincronizacao: null, pendencias: [] }] });
        return;
      }
      if (/\/clientes\/[^/?]+\/contas/.test(url)) {
        await json({ ok: true, cliente: { id: 90, nome: "Red Fish", slug: "red_fish", ativo: true }, contas: [
          { id: 10, cliente_id: 90, marketplace: "meli", nome: "Red Fish · ML Principal", slug: "ml-10", external_account_id: "10000", externalAccountLabel: "Red Fish · ML Principal", is_primary: true, ativo: true, grant: { id: 10, token_status: "valid" }, base: null },
        ] });
        return;
      }
      await respond("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" });
    };

    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem("vf-token", "ui-test-token");
      localStorage.setItem("vf-user", JSON.stringify({ nome: "Teste UI", role: "admin" }));
      ${mock}
    ` });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/central-margem.html?cliente=red_fish` });

    const arquivos = [];
    const shot = async (name) => {
      await sleep(300);
      const r = await cdp.send("Page.captureScreenshot", { format: "png" });
      const arquivo = path.join(SHOT_DIR, name + ".png");
      fs.writeFileSync(arquivo, Buffer.from(r.data, "base64"));
      arquivos.push(arquivo);
    };
    const texto = async (seletor) => (await cdp.evaluate(`document.querySelector(${JSON.stringify(seletor)}).innerText`)).replace(/ /g, " ");
    const semRolagemHorizontal = () => cdp.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1");

    // Com uma Conta única, o Shell pode concluir a resolução antes deste poll.
    // Aceitar esse estado estável evita depender da duração do estado transitório;
    // as asserções seguintes continuam exigindo Conta #10 e os oito anúncios.
    await waitFor(cdp, "window.VFCentralMargemUi && window.VF && window.VF.context && (window.VFCentralMargemUi.getState().awaitingAccount || (window.VF.context.getState() === 'READY' && window.VFCentralMargemUi.getState().contaId === 10))", "Shell não resolveu a conta nem pediu seleção");
    for (let i = 0; i < 60; i += 1) {
      await cdp.evaluate("window.VF.context.setConta(10)");
      if (await cdp.evaluate("window.VFCentralMargemUi.getState().contaId === 10")) break;
      await sleep(100);
    }
    await waitFor(cdp, "window.VFCentralMargemUi.getState().mode === 'snapshot' && window.VFCentralMargemUi.getState().data && !window.VFCentralMargemUi.getState().loading && document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length === 8", "a worklist da Red Fish não carregou");
    await waitFor(cdp, "window.VFCentralMargemUi.getState().realizado && window.VFCentralMargemUi.getState().promoSummary && window.VFCentralMargemUi.getState().promoSummary.status === 'ok'", "realizado/resumo de promoções não carregaram");

    await check("Precificar: 4 KPIs de decisão, realizado numa linha só e worklist ordenada (prejuízo → abaixo da meta → saudáveis)", async () => {
      assert.ok((await cdp.evaluate("document.body.innerText")).includes("Red Fish"), "o cliente da tela é a Red Fish");
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#cm-kpis-top .cm-topk').length"), 4);
      const kpis = (await texto("#cm-kpis-top")).replace(/\n/g, " ");
      assert.ok(/EM PREJUÍZO\s*2/i.test(kpis), kpis);
      assert.ok(/PROMOS COM \+LC\s*2/i.test(kpis), kpis);
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-top-realized').hasAttribute('data-cm-realized-unavailable')"), false);
      const ordem = await cdp.evaluate("Array.prototype.map.call(document.querySelectorAll('#cm-table-host tbody tr[data-item-id]'), function (tr) { return tr.getAttribute('data-item-id'); }).join(',')");
      assert.strictEqual(ordem, "MLB1003,MLB1004,MLB1005,MLB1006,MLB1001,MLB1002,MLB1007,MLB1008");
      const cabecalho = (await texto("#cm-table-host thead")).replace(/\s+/g, " ").toLowerCase();
      for (const coluna of ["produto", "preço", "lc/un", "margem", "próxima ação"]) assert.ok(cabecalho.includes(coluna), `coluna ${coluna}: ${cabecalho}`);
      assert.ok(await semRolagemHorizontal(), "sem rolagem horizontal");
      await shot("01-precificar");
    });

    await check("Promoções: uma linha por anúncio com a melhor promoção, veredito e flags", async () => {
      await cdp.evaluate("document.querySelector('[data-view=promotions]').click()");
      await waitFor(cdp, "document.querySelector('#cm-opps-host tr[data-opp]') && document.getElementById('cm-promos-live').getAttribute('data-cm-live') === 'ok'", "promoções não apareceram");
      assert.ok(await semRolagemHorizontal(), "sem rolagem horizontal");
      const badge = (await texto("#cm-opps-meta")) + " | " + (await texto("#cm-promos-live"));
      assert.ok(/^Lista: Promo Snapshot · /.test(badge) && /Números: cotação ao vivo/.test(badge), badge);
      await shot("02-promocoes");
    });

    await check("Promoções: linha expandida mostra a cascata Hoje × Promo, quem banca e a origem dos números", async () => {
      await cdp.evaluate("document.querySelector('tr.cm-promo-row .cm-c-produto').click()");
      await waitFor(cdp, "document.querySelector('tr.cm-promo-detail:not([hidden]) [data-cm-bancada-cascata]')", "o detalhe da linha não abriu");
      const detalhe = (await texto("tr.cm-promo-detail:not([hidden])")).replace(/\s+/g, " ");
      for (const t of ["Desconto total", "ML banca", "Você banca", "Lista: Promo Snapshot", "Números: cotação ao vivo"]) assert.ok(detalhe.includes(t), `falta ${t}: ${detalhe}`);
      assert.ok(await semRolagemHorizontal(), "sem rolagem horizontal");
      await shot("03-promocoes-expandida");
      await cdp.evaluate("document.querySelector('tr.cm-promo-row .cm-c-produto').click()");
    });

    await check("Diagnóstico: divergências e a tabela Composição atual", async () => {
      await cdp.evaluate("document.querySelector('[data-view=composition]').click()");
      await waitFor(cdp, "document.getElementById('cm-divergences').hidden === false", "o Diagnóstico não abriu");
      await shot("07-diagnostico");
      await cdp.evaluate("document.querySelector('[data-view=operational]').click()");
    });

    await check("Bancada (promoção): Atual × Cenário em cascata, seller × ML banca, ΔLC, empate de volume e botão único", async () => {
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB1001\"]').click()");
      await waitFor(cdp, "document.querySelector('[data-cm-cenarios]')", "a Bancada não carregou");
      await cdp.evaluate("document.querySelector('[data-cenario=\"P-DEAL\"]').click()");
      const resultado = await texto("#cm-banc-resultado");
      for (const t of ["Entrar se girar", "Retorno ML", "LC/un", "Margem", "Precisa vender"]) assert.ok(resultado.includes(t), `falta ${t}: ${resultado}`);
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-bancada-review').textContent"), "Participar desta promoção");
      assert.ok(await semRolagemHorizontal(), "sem rolagem horizontal");
      await shot("04-bancada-promocao");
    });

    await check("Bancada (preço manual): o cenário digitado é cotado pelo backend e comparado com o atual", async () => {
      await cdp.evaluate("document.querySelector('[data-cenario=\"preco\"]').click()");
      await cdp.evaluate("(function(){var i=document.getElementById('cm-new-price');i.value='114,90';i.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await waitFor(cdp, "document.getElementById('cm-banc-resultado').textContent.indexOf('114,90') !== -1 && document.getElementById('cm-bancada-review').disabled === false", "o cenário de preço não apareceu");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-bancada-review').textContent"), "Revisar novo preço");
      await shot("05-bancada-preco-manual");
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer()");
    });

    await check("Bancada (bloqueado): promoção já ativa — o motivo na tela, sem botão de escrita e com o link do Mercado Livre", async () => {
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB1001\"]').click()");
      await waitFor(cdp, "document.querySelector('[data-cm-cenarios]')", "a Bancada não carregou");
      await cdp.evaluate("document.querySelector('[data-cenario=\"P-ATIVA\"]').click()");
      const resultado = await texto("#cm-banc-resultado");
      assert.ok(resultado.includes("bloqueado · promoção já ativa"), resultado);
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-bancada-review')"), null, "sem botão de escrita");
      assert.ok((await texto("#cm-bancada-ml")).includes("Abrir no Mercado Livre"));
      assert.ok(await semRolagemHorizontal(), "sem rolagem horizontal");
      await shot("06-bancada-bloqueado");
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer()");
    });

    await check("Bancada de anúncio em prejuízo: chip 'Subir p/ R$ X' com o preço-alvo cotado", async () => {
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB1003\"]').click()");
      await waitFor(cdp, "document.querySelector('[data-cm-chip=\"alvo\"]')", "o preço-alvo cotado não apareceu");
      assert.ok(/Subir p\/ R\$\s95,59/.test(await texto("[data-cm-chip=\"alvo\"]")));
      await shot("08-bancada-prejuizo");
    });

    console.log(`# ${checks} testes visuais concluídos`);
    for (const arquivo of arquivos) console.log(`  screenshot: ${arquivo}`);
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
