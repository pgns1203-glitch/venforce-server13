/*
 * Smoke test de interface em Chrome headless para a Visão (F3.2) — primeira
 * ilha React sobre o Shell V3. Mesma estratégia de
 * Portal/diagnostico-inicial-shell-ui.test.js: fixtures reais para o Shell
 * (GET /operacao/cliente-360/clientes, GET /clientes/:slug/contas) e um
 * payload REALISTA para GET /operacao/visao/:cliente, moldado exatamente
 * pelo shape real que server/services/visaoService.js compõe (não um mock
 * simplificado) — os 6 blocos, `disponivel`/`escopoConta`/`motivo`/`dados`.
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
const SHOTS_DIR = "/tmp/claude-1000/-home-user-Documentos-venforce-scanner-x1/ee1ec06e-7596-49c3-8e17-52302088a27f/scratchpad";

const N97 = { id: 87, nome: "N97 Comercial", slug: "n97", ativo: true, temGrant: true, grantStatus: "conectado", temBase: true, setupScore: 100, statusOperacional: "pronto", ultimaSincronizacao: null, pendencias: [] };
const PORTFOLIO = { ok: true, clientes: [N97] };
const N97_CONTAS = [
  { id: 42, cliente_id: 87, marketplace: "meli", nome: "Mercado Livre 1", ativo: true, grant: { token_status: "valid" }, base: { base_id: 9 } },
];

// Payload REALISTA — shape confirmado lendo server/services/visaoService.js
// e as funções de origem de cada bloco (não é o shape especulado no
// wireframe do MASTER_SPEC, é o que o backend de verdade devolve hoje).
function payloadFeliz() {
  return {
    ok: true,
    contexto: { clienteId: 87, clienteSlug: "n97", clienteContaId: 42, marketplace: "meli", competencia: "2026-08" },
    saude: {
      disponivel: true, escopoConta: false,
      dados: {
        saude: { status: "atencao", score: 62, label: "Precisa de atenção", motivos: ["3 itens sem custo"] },
        setup: { score: 80, temBase: true, temGrant: true, temDiagnostico: true, temFechamentoMes: false, temAds: true, temFreteHistorico: false },
        sync: { status: "sincronizado", precisaSincronizar: false, ultimaSincronizacao: "2026-08-26T10:00:00Z", motivo: null },
        proximoPasso: { tipo: "fechamento", titulo: "Gerar o fechamento de agosto", descricao: "O período ainda não tem fechamento publicado.", href: "financeiro.html?cliente=n97" },
      },
    },
    resultado: {
      disponivel: true, escopoConta: true,
      dados: {
        faturamento: 412880.5, lucroContribuicao: 96220.3, margemContribuicaoPercentual: 23.3,
        ticket: 128.9, pedidosTotal: 3201, pedidosValidos: 3180, cancelados: 21, problemas: 4,
        confiancaFechamento: "parcial", semCusto: true, semFrete: false,
      },
    },
    margem: {
      disponivel: true, escopoConta: false,
      dados: {
        placar: { margemMediaPercent: 21.4, itensComMargem: 340, itensSemMargem: 12 },
        cobertura: { itensAnalisados: 340, totalItensMl: 352, parcial: true, motivoParcial: "12 itens sem custo cadastrado." },
        excecoes: [{ id: 1 }, { id: 2 }],
      },
    },
    ads: {
      disponivel: true, escopoConta: true,
      dados: { codigo: "OK", investimentoAds: 4520.1, gmvAds: 31200.5, acos: 14.5, roas: 6.9, avisos: [] },
    },
    fechamento: { disponivel: true, escopoConta: false, dados: null },
    atividade: {
      disponivel: true, escopoConta: true,
      dados: [
        { id: 501, status: "completed", dateFrom: "2026-08-01", dateTo: "2026-08-26", completenessStatus: "complete", finishedAt: "2026-08-26T10:05:00Z" },
        { id: 500, status: "failed", dateFrom: "2026-08-01", dateTo: "2026-08-25", completenessStatus: "failed", finishedAt: "2026-08-25T10:05:00Z" },
      ],
    },
  };
}

// Conta Shopee: margem/ads ML-only viram indisponível com motivo (nunca
// tentados) — cenário 2 do visaoServiceComposicao.test.js real, espelhado
// aqui para a Visão em React.
function payloadShopee() {
  const p = payloadFeliz();
  p.contexto.marketplace = "shopee";
  p.margem = { disponivel: false, escopoConta: false, motivo: "Central de Margem está disponível só para operações Mercado Livre." };
  p.ads = { disponivel: false, escopoConta: true, motivo: "Ads está disponível só para operações Mercado Livre." };
  return p;
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

let visaoPayload = payloadFeliz();

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
      { name: "access-control-allow-methods", value: "GET,POST,OPTIONS" },
    ];
    if (req.method === "OPTIONS") { await respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 204, responseHeaders: cors }); return; }
    const json = (obj) => respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 200, responseHeaders: [...cors, { name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(obj)).toString("base64") });

    if (url.includes("/operacao/cliente-360/clientes")) { await json(PORTFOLIO); return; }
    const contasMatch = url.match(/\/clientes\/([^/?]+)\/contas/);
    if (contasMatch) { await json({ ok: true, cliente: { id: 87, nome: "N97 Comercial", slug: "n97", ativo: true }, contas: N97_CONTAS }); return; }
    if (url.includes("/operacao/visao/")) { await json(visaoPayload); return; }

    await respond("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" });
  };
  return consoleErrors;
}

async function run() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const server = await startServer();
  const serverPort = server.address().port;
  const debugPort = 26000 + Math.floor(Math.random() * 1000);
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--window-size=1440,1600",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/vf-visao-shell-ui-${process.pid}`, "about:blank",
  ], { stdio: "ignore" });

  let cdp;
  try {
    await waitChrome(debugPort);
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })).json();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1600, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    const consoleErrors = wireFetchInterception(cdp);

    async function seedAndGoto(qs) {
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/visao.html` });
      await sleep(60);
      await cdp.evaluate(`
        localStorage.setItem("vf-token", "ui-test-token");
        localStorage.setItem("vf-user", JSON.stringify({ id: 12, nome: "Pedro Gomes", role: "admin" }));
        sessionStorage.clear();
      `);
      consoleErrors.length = 0;
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/visao.html${qs ? "?" + qs : ""}` });
      await waitFor(cdp, "window.VF && window.VF.context", "vf-context não montou");
    }

    // ═══ 1. Deep link com conta real, caminho feliz ═══
    visaoPayload = payloadFeliz();
    await seedAndGoto("cliente=n97&conta=42");
    await waitFor(cdp, "window.VF.context.getState() === 'READY'", "n97/42 não chegou a READY");
    await waitFor(cdp, "document.querySelectorAll('.vf-visao-bloco').length === 6", "os 6 blocos da Visão não renderizaram");
    await sleep(200);

    await check("F3.2 — Shell mostra Cliente/Operação corretos", async () => {
      const texto = await cdp.evaluate("document.querySelector('.vf-shell__sidebar').innerText");
      assert.ok(texto.includes("N97 Comercial"), `sidebar deveria mostrar N97 Comercial: ${texto}`);
    });

    await check("F3.2 — 6 blocos renderizam, nenhum mostra 'undefined' ou 'NaN'", async () => {
      const texto = await cdp.evaluate("document.body.innerText");
      assert.ok(!/undefined|NaN/.test(texto), `texto suspeito na página: ${texto.slice(0, 400)}`);
    });

    await check("F3.2 — Resultado do período mostra o faturamento real formatado em R$", async () => {
      const texto = await cdp.evaluate("document.body.innerText");
      assert.ok(/R\$\s*412\.880,50/.test(texto), `faturamento não encontrado formatado: ${texto.slice(0, 800)}`);
    });

    await check("F3.2 — cada bloco tem link de aprofundamento (nenhum bloco sem destino)", async () => {
      const n = await cdp.evaluate("document.querySelectorAll('.vf-visao-bloco a.vf-btn').length");
      // Saúde não tem link fixo (usa o botão do próximo passo, condicional) — as
      // outras 5 sempre têm; aceitar >= 5.
      assert.ok(n >= 5, `esperado >=5 links de aprofundamento, achei ${n}`);
    });

    await check("F3.2 — badge 'cliente inteiro' aparece nos blocos com escopoConta=false (Saúde, Margem, Fechamento)", async () => {
      const n = await cdp.evaluate("Array.prototype.filter.call(document.querySelectorAll('.vf-visao-bloco .vf-tag'), function(t){ return t.textContent.trim() === 'cliente inteiro'; }).length");
      assert.strictEqual(n, 3, `esperado 3 badges 'cliente inteiro' (Saúde/Margem/Fechamento), achei ${n}`);
    });

    const shot1 = path.join(SHOTS_DIR, "visao-feliz-n97.png");
    const png1 = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(shot1, Buffer.from(png1.data, "base64"));
    console.log(`   screenshot: ${shot1}`);

    // ═══ 2. Conta Shopee: Margem/Ads viram indisponível com motivo ═══
    visaoPayload = payloadShopee();
    // `_r` força uma navegação de verdade (URL diferente) mesmo repetindo
    // cliente/conta — vf-context.js ignora qualquer param fora dos aliases
    // conhecidos, não afeta o contexto resolvido.
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/visao.html?cliente=n97&conta=42&_r=2` });
    await waitFor(cdp, "window.VF && window.VF.context && window.VF.context.getState() === 'READY'", "reload não voltou a READY");
    await sleep(300);
    await waitFor(cdp, "document.querySelectorAll('.vf-visao-bloco').length === 6", "os 6 blocos não renderizaram após reload");
    await sleep(200);

    await check("F3.2 — conta Shopee: Margem e Ads mostram motivo de indisponibilidade (ML-only), não erro genérico", async () => {
      const texto = await cdp.evaluate("document.body.innerText");
      assert.ok(texto.includes("Central de Margem está disponível só para operações Mercado Livre."), `motivo de Margem ausente: ${texto.slice(0, 1200)}`);
      assert.ok(texto.includes("Ads está disponível só para operações Mercado Livre."), `motivo de Ads ausente: ${texto.slice(0, 1200)}`);
    });

    const shot2 = path.join(SHOTS_DIR, "visao-shopee-indisponivel.png");
    const png2 = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(shot2, Buffer.from(png2.data, "base64"));
    console.log(`   screenshot: ${shot2}`);

    await check("sem erros de console em nenhum cenário", async () => {
      const relevantes = consoleErrors.filter((m) => !/favicon/i.test(m));
      assert.strictEqual(relevantes.length, 0, `erros de console: ${JSON.stringify(relevantes)}`);
    });

    console.log(`\n✓ ${checks} verificações da Visão (F3.2)`);
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
