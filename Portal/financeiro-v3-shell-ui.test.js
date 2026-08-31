/*
 * Smoke test de interface em Chrome headless para o Financeiro V3 (F4.1) —
 * segunda ilha React sobre o Shell V3. Mesma estratégia de
 * Portal/visao-shell-ui.test.js: fixtures reais para o Shell e um payload
 * REALISTA para GET /financeiro/:cliente, moldado pelo shape real que
 * server/services/financeiroVisaoService.js compõe.
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

// Payload REALISTA — shape confirmado lendo server/services/
// financeiroVisaoService.js e centralVendasMp3ReadService.js.
function payloadFeliz() {
  return {
    ok: true,
    contexto: { clienteId: 87, clienteSlug: "n97", clienteContaId: 42, marketplace: "meli", periodo: "2026-08" },
    resultado: {
      disponivel: true, escopoConta: false,
      dados: {
        status: "publicado", geradoEm: "2026-08-26T10:00:00Z", publicadoEm: "2026-08-26T12:00:00Z",
        cards: [],
        composicao: [
          { chave: "faturamento_bruto", rotulo: "Faturamento bruto", valor: 412880.5, disponivel: true },
          { chave: "comissao", rotulo: "Comissão", valor: -41288.05, disponivel: true },
          { chave: "frete", rotulo: "Frete", valor: -12500, disponivel: true },
          { chave: "custo_produto", rotulo: "Custo de produto", valor: null, disponivel: false },
          { chave: "resultado", rotulo: "Resultado", valor: 96220.3, disponivel: true },
        ],
      },
    },
    conciliacao: {
      disponivel: true, escopoConta: true,
      dados: {
        mpReconciliationStatus: "partial",
        summary: {
          ordersTotal: 3201, ordersMatchedClean: 2900, ordersMatchedWithEvents: 100, ordersDivergent: 3,
          ordersSettlementPending: 50, coveragePercent: 93.8, paymentsUnique: 3100, paymentsSettlementPending: 50,
          totalPaymentNet: 380000.2,
        },
      },
    },
    relatorios: {
      disponivel: true, escopoConta: false,
      dados: [
        { periodo: "2026-08", status: "publicado", geradoEm: "2026-08-26T10:00:00Z", publicado: true, token: "tok-agosto" },
        { periodo: "2026-07", status: "publicado", geradoEm: "2026-07-28T10:00:00Z", publicado: true, token: "tok-julho" },
        { periodo: "2026-06", status: "rascunho", geradoEm: "2026-06-29T10:00:00Z", publicado: false, token: null },
      ],
    },
  };
}

// Sem fechamento gerado no período — shape real confirmado lendo
// financeiroVisaoService.js: `resultado.disponivel` é FALSE quando não há
// entrega para o período (não é `true` com `dados:null` — `dados` continua
// preenchido, no shape "nao_gerado", mas o envelope inteiro é indisponível
// com motivo; M6, "não é erro" mas também não é um bloco "disponível vazio").
function payloadSemFechamento() {
  return {
    ok: true,
    contexto: { clienteId: 87, clienteSlug: "n97", clienteContaId: 42, marketplace: "meli", periodo: "2026-09" },
    resultado: {
      disponivel: false, escopoConta: false,
      dados: { status: "nao_gerado", geradoEm: null, publicadoEm: null, cards: [], composicao: [] },
      motivo: "Nenhum fechamento gerado para este período.",
    },
    conciliacao: { disponivel: true, escopoConta: true, dados: { mpReconciliationStatus: "not_available", summary: { ordersTotal: 0 } } },
    relatorios: { disponivel: true, escopoConta: false, dados: [] },
  };
}

/* C1 — o Shell V3 pede GET /me/context antes de qualquer coisa (a carteira
   autoritativa por Squad, server/services/meService.js). Este backend falso
   passa a respondê-lo derivando do MESMO fixture de carteira já usado aqui:
   sem isto o harness simularia um servidor sem /me, que não é o servidor
   real que a página vai encontrar. */
function meContextDe(portfolio) {
  const clientes = (portfolio.clientes || []).map((c) => ({
    id: c.id, slug: c.slug, nome: c.nome, squadId: null, responsavelDireto: false, contasAtivas: null,
  }));
  return {
    ok: true,
    user: { id: 12, nome: "Pedro Gomes", email: null, role: "user" },
    squads: [], squadPrincipalId: null,
    clientes,
    portfolio: { totalClientes: clientes.length },
    permissoes: { podeAdministrar: false },
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

let financeiroPayload = payloadFeliz();

/* ── F4.2 — GET/POST /entregas-cliente, no shape real de
   server/services/entregasClienteService.js (o SELECT de `listarEntregas`
   e o RETURNING de `publicarEntrega`). Este fake é COM ESTADO de propósito:
   publicar/despublicar mudam o array, e é isso que permite ao teste provar
   que a tela relê do servidor em vez de remendar o estado local. ───────── */
let entregasFake = [];
let entregasFalham = false; // cenário do modo degradado
let entregasRequestCount = 0;

function resetEntregas() {
  entregasFalham = false;
  entregasRequestCount = 0;
  entregasFake = [
    { id: 801, tipo: "fechamento_mensal", cliente_id: 87, cliente_slug: "n97", titulo: "Fechamento Agosto", periodo: "2026-08", status: "publicado", publicado: true, token_publico: "tok-agosto", created_at: "2026-08-26T10:00:00Z", published_at: "2026-08-26T12:00:00Z" },
    { id: 802, tipo: "fechamento_mensal", cliente_id: 87, cliente_slug: "n97", titulo: "Fechamento Julho", periodo: "2026-07", status: "publicado", publicado: true, token_publico: "tok-julho", created_at: "2026-07-28T10:00:00Z", published_at: "2026-07-28T11:00:00Z" },
    { id: 803, tipo: "fechamento_mensal", cliente_id: 87, cliente_slug: "n97", titulo: "Fechamento Junho", periodo: "2026-06", status: "rascunho", publicado: false, token_publico: null, created_at: "2026-06-29T10:00:00Z", published_at: null },
  ];
}
resetEntregas();

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

    if (url.includes("/me/context")) { await json(meContextDe(PORTFOLIO)); return; }
    if (url.includes("/operacao/cliente-360/clientes")) { await json(PORTFOLIO); return; }
    const contasMatch = url.match(/\/clientes\/([^/?]+)\/contas/);
    if (contasMatch) { await json({ ok: true, cliente: { id: 87, nome: "N97 Comercial", slug: "n97", ativo: true }, contas: N97_CONTAS }); return; }
    // F4.2 — escrita ANTES da leitura: /entregas-cliente/:id/publicar tem
    // o mesmo prefixo da listagem.
    const acaoMatch = url.match(/\/entregas-cliente\/(\d+)\/(publicar|despublicar)/);
    if (acaoMatch) {
      const alvo = entregasFake.find((e) => e.id === Number(acaoMatch[1]));
      if (!alvo) { await respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 404, responseHeaders: [...cors, { name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify({ ok: false, erro: "Entrega não encontrada." })).toString("base64") }); return; }
      if (acaoMatch[2] === "publicar") {
        alvo.publicado = true;
        alvo.status = "publicado";
        alvo.token_publico = alvo.token_publico || `tok-${alvo.id}`;
        alvo.published_at = "2026-09-05T09:00:00Z";
      } else {
        alvo.publicado = false;
        alvo.status = "rascunho";
        alvo.token_publico = null;
        alvo.published_at = null;
      }
      await json({ ok: true, entrega: alvo });
      return;
    }
    if (url.includes("/entregas-cliente")) {
      entregasRequestCount += 1;
      if (entregasFalham) { await respond("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" }); return; }
      await json({ ok: true, total: entregasFake.length, entregas: entregasFake });
      return;
    }
    if (url.includes("/financeiro/")) { await json(financeiroPayload); return; }

    await respond("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" });
  };
  return consoleErrors;
}

async function run() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const server = await startServer();
  const serverPort = server.address().port;
  const debugPort = 27000 + Math.floor(Math.random() * 1000);
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--window-size=1440,1200",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/vf-fin-v3-shell-ui-${process.pid}`, "about:blank",
  ], { stdio: "ignore" });

  let cdp;
  try {
    await waitChrome(debugPort);
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })).json();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    const consoleErrors = wireFetchInterception(cdp);

    async function seedAndGoto(qs) {
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/financeiro-v3.html` });
      await sleep(60);
      await cdp.evaluate(`
        localStorage.setItem("vf-token", "ui-test-token");
        localStorage.setItem("vf-user", JSON.stringify({ id: 12, nome: "Pedro Gomes", role: "admin" }));
        sessionStorage.clear();
      `);
      consoleErrors.length = 0;
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/financeiro-v3.html${qs ? "?" + qs : ""}` });
      await waitFor(cdp, "window.VF && window.VF.context", "vf-context não montou");
    }

    // ═══ 1. Deep link com conta real, caminho feliz ═══
    financeiroPayload = payloadFeliz();
    await seedAndGoto("cliente=n97&conta=42");
    await waitFor(cdp, "window.VF.context.getState() === 'READY'", "n97/42 não chegou a READY");
    await waitFor(cdp, "document.querySelector('.vf-tabs')", "abas do Financeiro não renderizaram");
    await sleep(200);

    await check("F4.1 — Shell mostra Cliente/Operação corretos, item Financeiro ativo na sidebar", async () => {
      const texto = await cdp.evaluate("document.querySelector('.vf-shell__sidebar').innerText");
      assert.ok(texto.includes("N97 Comercial"), `sidebar deveria mostrar N97 Comercial: ${texto}`);
    });

    await check("F4.1 — link cruzado para o Financeiro legado presente no cabeçalho", async () => {
      const href = await cdp.evaluate(`(function(){ var a = document.querySelector('.vf-page-header__description a'); return a ? a.getAttribute('href') : null; })()`);
      assert.ok(href && href.includes("financeiro.html"), `link para o legado ausente/incorreto: ${href}`);
    });

    await check("F4.1 — aba Resultado (padrão): composição renderiza, item sem custo mostra '—', nunca R$0", async () => {
      const texto = await cdp.evaluate("document.querySelector('.vf-fin-painel').innerText");
      assert.ok(texto.includes("Faturamento bruto"), `composição ausente: ${texto}`);
      assert.ok(/Custo de produto[\s\S]*—/.test(texto), `custo ausente deveria mostrar '—', não R$0: ${texto}`);
      assert.ok(!texto.includes("R$ 0,00"), `nenhum valor ausente pode virar R$ 0,00: ${texto}`);
    });

    await check("F4.1 — aba Conciliação: status e cobertura corretos", async () => {
      await cdp.evaluate("Array.prototype.find.call(document.querySelectorAll('.vf-tab'), b => b.textContent.trim() === 'Conciliação').click()");
      await sleep(150);
      const texto = await cdp.evaluate("document.querySelector('.vf-fin-painel').innerText");
      assert.ok(texto.includes("parcial") || texto.includes("Parcial"), `status de conciliação ausente: ${texto}`);
      assert.ok(/93,8%|93.8%/.test(texto), `cobertura não encontrada: ${texto}`);
    });

    await check("F4.2 — aba Relatórios gerados: 3 entregas, link público só quando publicado, rascunho oferece Publicar", async () => {
      await cdp.evaluate("Array.prototype.find.call(document.querySelectorAll('.vf-tab'), b => b.textContent.trim() === 'Relatórios gerados').click()");
      await sleep(200);
      const linhas = await cdp.evaluate("document.querySelectorAll('.vf-fin-painel tbody tr').length");
      assert.strictEqual(linhas, 3, `esperado 3 entregas, achei ${linhas}`);
      const rascunho = await cdp.evaluate("document.querySelector('.vf-fin-painel tbody tr:last-child').innerText");
      assert.ok(!/Abrir/.test(rascunho), `rascunho não pode oferecer link público: ${rascunho}`);
      assert.ok(/Publicar/.test(rascunho), `rascunho deveria oferecer Publicar: ${rascunho}`);
      // Publicado nunca finge data de publicação; rascunho mostra ausência.
      assert.ok(/—/.test(rascunho), `rascunho deveria mostrar '—' em "Publicado em": ${rascunho}`);
    });

    await check("F4.2 — a linha da competência em tela é marcada (a lista é do cliente inteiro, não do período)", async () => {
      const marcadas = await cdp.evaluate("document.querySelectorAll('.vf-fin-painel tbody tr.is-destacada').length");
      assert.strictEqual(marcadas, 1, `esperado exatamente 1 linha marcada como período em tela, achei ${marcadas}`);
      const texto = await cdp.evaluate("document.querySelector('.vf-fin-painel tbody tr.is-destacada').innerText");
      assert.ok(/Agosto\/2026/.test(texto), `a linha marcada deveria ser a de Agosto/2026: ${texto}`);
      const aviso = await cdp.evaluate("document.querySelector('.vf-fin-painel').innerText");
      assert.ok(/não é\s*\n?\s*filtrada por conta|não\s+é\s+filtrada por conta/.test(aviso.replace(/\s+/g, " ")), `o escopo de cliente deveria estar dito na tela: ${aviso.slice(0, 200)}`);
    });

    await check("F4.2 — um clique não publica: a confirmação aparece e NOMEIA a competência", async () => {
      const antes = entregasRequestCount;
      await cdp.evaluate(`
        (function(){ var tr = document.querySelector('.vf-fin-painel tbody tr:last-child');
          Array.prototype.find.call(tr.querySelectorAll('button'), function(b){ return b.textContent.trim() === 'Publicar'; }).click(); })();
      `);
      await sleep(120);
      const texto = await cdp.evaluate("document.querySelector('.vf-fin-confirm').innerText");
      assert.ok(/Publicar Junho\/2026\?/.test(texto), `a confirmação deveria nomear a competência: ${texto}`);
      assert.strictEqual(entregasRequestCount, antes, "um clique só não pode ter disparado nenhuma requisição");
      assert.strictEqual(entregasFake.find((e) => e.id === 803).publicado, false, "nada podia ter sido publicado ainda");
    });

    await check("F4.2 — confirmar publica de verdade e a tela relê do servidor (estado autoritativo, não remendo local)", async () => {
      const antes = entregasRequestCount;
      await cdp.evaluate(`
        (function(){ var box = document.querySelector('.vf-fin-confirm');
          Array.prototype.find.call(box.querySelectorAll('button'), function(b){ return b.textContent.trim() === 'Publicar'; }).click(); })();
      `);
      await waitFor(cdp, "document.querySelectorAll('.vf-fin-painel tbody tr')[2].innerText.indexOf('Despublicar') >= 0", "a linha não passou a publicada");
      assert.strictEqual(entregasFake.find((e) => e.id === 803).publicado, true, "o servidor deveria ter registrado a publicação");
      assert.ok(entregasRequestCount > antes, "a tela deveria ter relido a lista depois da escrita");
      const linha = await cdp.evaluate("document.querySelectorAll('.vf-fin-painel tbody tr')[2].innerText");
      assert.ok(/Abrir/.test(linha), `entrega publicada deveria oferecer o link público: ${linha}`);
      assert.ok(!/—/.test(linha.split("\t").slice(3, 4).join("")), `"Publicado em" não pode continuar vazio: ${linha}`);
    });

    await check("F4.2 — despublicar revoga o link (a válvula que o Financeiro legado nunca ligou)", async () => {
      await cdp.evaluate(`
        (function(){ var tr = document.querySelectorAll('.vf-fin-painel tbody tr')[2];
          Array.prototype.find.call(tr.querySelectorAll('button'), function(b){ return b.textContent.trim() === 'Despublicar'; }).click(); })();
      `);
      await sleep(120);
      const confirm = await cdp.evaluate("document.querySelector('.vf-fin-confirm').innerText");
      assert.ok(/Despublicar Junho\/2026\?/.test(confirm), `confirmação de despublicar deveria nomear a competência: ${confirm}`);
      await cdp.evaluate(`
        (function(){ var box = document.querySelector('.vf-fin-confirm');
          Array.prototype.find.call(box.querySelectorAll('button'), function(b){ return b.textContent.trim() === 'Despublicar'; }).click(); })();
      `);
      await waitFor(cdp, "document.querySelectorAll('.vf-fin-painel tbody tr')[2].innerText.indexOf('Publicar') >= 0", "a linha não voltou a rascunho");
      const alvo = entregasFake.find((e) => e.id === 803);
      assert.strictEqual(alvo.publicado, false);
      assert.strictEqual(alvo.token_publico, null, "o token público precisa ser revogado");
    });

    await check("F4.2 — aba Fechamento publica o período EM TELA, com a competência nomeada", async () => {
      await cdp.evaluate("Array.prototype.find.call(document.querySelectorAll('.vf-tab'), b => b.textContent.trim() === 'Fechamento').click()");
      await sleep(200);
      const texto = await cdp.evaluate("document.querySelector('.vf-fin-painel').innerText");
      assert.ok(/Despublicar/.test(texto), `Agosto está publicado: a aba deveria oferecer Despublicar: ${texto}`);
      await cdp.evaluate(`
        (function(){ var p = document.querySelector('.vf-fin-painel');
          Array.prototype.find.call(p.querySelectorAll('button'), function(b){ return b.textContent.trim() === 'Despublicar'; }).click(); })();
      `);
      await sleep(120);
      const confirm = await cdp.evaluate("document.querySelector('.vf-fin-confirm').innerText");
      assert.ok(/Agosto\/2026/.test(confirm), `a aba Fechamento tem que agir sobre o período em tela (Agosto/2026): ${confirm}`);
      await cdp.evaluate(`
        (function(){ var box = document.querySelector('.vf-fin-confirm');
          Array.prototype.find.call(box.querySelectorAll('button'), function(b){ return b.textContent.trim() === 'Cancelar'; }).click(); })();
      `);
      await sleep(80);
      assert.strictEqual(entregasFake.find((e) => e.id === 801).publicado, true, "Cancelar não pode ter despublicado nada");
    });

    await check("F4.1 — aba Histórico: 3 períodos, mais recente primeiro", async () => {
      await cdp.evaluate("Array.prototype.find.call(document.querySelectorAll('.vf-tab'), b => b.textContent.trim() === 'Histórico').click()");
      await sleep(200);
      const primeiro = await cdp.evaluate("document.querySelector('.vf-fin-historico__item .vf-fin-historico__periodo').textContent");
      assert.ok(/Agosto/i.test(primeiro), `histórico deveria começar por Agosto/2026 (mais recente): ${primeiro}`);
    });

    /* ── F4.2 — modo degradado: a lista operacional cai, a leitura fica ── */
    entregasFalham = true;
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/financeiro-v3.html?cliente=n97&conta=42&_r=deg` });
    await waitFor(cdp, "window.VF && window.VF.context && window.VF.context.getState() === 'READY'", "reload não voltou a READY");
    await waitFor(cdp, "document.querySelector('.vf-tabs')", "abas não renderizaram");
    await sleep(200);

    await check("F4.2 — /entregas-cliente fora do ar: a tabela continua em LEITURA, com motivo e retry, sem botão inerte", async () => {
      await cdp.evaluate("Array.prototype.find.call(document.querySelectorAll('.vf-tab'), b => b.textContent.trim() === 'Relatórios gerados').click()");
      await sleep(250);
      const texto = await cdp.evaluate("document.querySelector('.vf-fin-painel').innerText");
      assert.ok(/Ações indisponíveis no momento/.test(texto), `deveria explicar por que as ações sumiram: ${texto}`);
      assert.ok(/Tentar novamente/.test(texto), "o modo degradado precisa oferecer retry");
      assert.ok(!/Publicar/.test(texto), `sem id não existe ação — nenhum botão Publicar podia aparecer: ${texto}`);
      const linhas = await cdp.evaluate("document.querySelectorAll('.vf-fin-painel tbody tr').length");
      assert.strictEqual(linhas, 3, `a leitura do payload do Financeiro deveria sobreviver, achei ${linhas} linhas`);
    });

    entregasFalham = false;
    resetEntregas();
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/financeiro-v3.html?cliente=n97&conta=42&_r=1b` });
    await waitFor(cdp, "window.VF && window.VF.context && window.VF.context.getState() === 'READY'", "reload não voltou a READY");
    await waitFor(cdp, "document.querySelector('.vf-tabs')", "abas não renderizaram");
    await sleep(200);

    const shot1 = path.join(SHOTS_DIR, "financeiro-v3-feliz.png");
    const png1 = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(shot1, Buffer.from(png1.data, "base64"));
    console.log(`   screenshot: ${shot1}`);

    // ═══ 2. Sem fechamento no período — estado vazio honesto, não erro ═══
    financeiroPayload = payloadSemFechamento();
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/financeiro-v3.html?cliente=n97&conta=42&_r=2` });
    await waitFor(cdp, "window.VF && window.VF.context && window.VF.context.getState() === 'READY'", "reload não voltou a READY");
    await waitFor(cdp, "document.querySelector('.vf-tabs')", "abas não renderizaram após reload");
    await sleep(200);

    await check("F4.1 — sem fechamento no período: estado vazio honesto na aba Resultado, link pro legado pra gerar", async () => {
      const texto = await cdp.evaluate("document.querySelector('.vf-fin-painel').innerText");
      assert.ok(/Sem fechamento processado|Nenhum fechamento/.test(texto), `estado vazio ausente: ${texto}`);
      const href = await cdp.evaluate(`(function(){ var a = document.querySelector('.vf-fin-painel a[href*="financeiro.html"]'); return a ? a.getAttribute('href') : null; })()`);
      assert.ok(href, "link para gerar no legado ausente no estado vazio");
    });

    const shot2 = path.join(SHOTS_DIR, "financeiro-v3-sem-fechamento.png");
    const png2 = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(shot2, Buffer.from(png2.data, "base64"));
    console.log(`   screenshot: ${shot2}`);

    // ═══ 3. REGRESSÃO P0 — sem vf-token: nunca pode ficar em branco pra
    // sempre. bootProduction() (vf-shell.js) só chama vfContext.init() se
    // hasToken() for true; sem isso nenhuma chamada de API acontece, então
    // o redirect-por-401 do vf-api nunca é acionado — a página HTML real
    // (não um harness com token pré-semeado) precisa mandar pro login
    // sozinha nesse caso. ═══
    await cdp.evaluate(`localStorage.removeItem("vf-token"); localStorage.removeItem("vf-user"); sessionStorage.clear();`);
    consoleErrors.length = 0;
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/financeiro-v3.html?cliente=n97&conta=42&_r=3` });
    await waitFor(cdp, "document.body.innerText.includes('E-mail')", "sem vf-token deveria redirecionar para o login (index.html) em vez de ficar em branco pra sempre");

    await check("F4.1 — sem vf-token: redireciona para o login em vez de ficar em branco pra sempre (regressão da tela branca)", async () => {
      const pathname = await cdp.evaluate("window.location.pathname");
      assert.ok(/index\.html$/.test(pathname), `esperava redirect para index.html, url atual: ${pathname}`);
      const temRootDoFinanceiro = await cdp.evaluate("document.getElementById('root') !== null");
      assert.strictEqual(temRootDoFinanceiro, false, "página de login não deveria ter o #root do Financeiro V3 sobrando no DOM");
    });

    await check("sem erros de console em nenhum cenário", async () => {
      const relevantes = consoleErrors.filter((m) => !/favicon/i.test(m));
      assert.strictEqual(relevantes.length, 0, `erros de console: ${JSON.stringify(relevantes)}`);
    });

    console.log(`\n✓ ${checks} verificações do Financeiro V3 (F4.1)`);
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
