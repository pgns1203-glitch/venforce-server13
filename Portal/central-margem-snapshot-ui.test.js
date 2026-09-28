/*
 * Smoke test de interface da Central de Margem em MODO LEITURA PERSISTIDA
 * (Margin Snapshot), em Chrome headless, sem dependências externas.
 *
 * Mesmo harness de central-margem-ui.test.js: servidor estático de Portal/ +
 * Shell V3 com a rede de produção interceptada via CDP (nunca toca a rede
 * real). O client da Central é mockado em window.__VF_CENTRAL_MARGEM_API_CLIENT__
 * com os métodos de snapshot servindo 5.000 itens por conta, PAGINADOS no
 * "servidor" e normalizados pelo normalizador REAL
 * (VFCentralMargemApi.normalizeSnapshotItens/normalizeSnapshotResumo).
 *
 * Prova: nenhuma chamada ao workspace ao vivo; paginação/busca/filtro no
 * servidor; nunca mais que 1 página no browser; refresh não congela a tela
 * e mantém a leitura anterior visível; progresso processados/total; polling
 * para no estado terminal; falha não zera dados; troca de conta troca o
 * dataset e mata o polling antigo; estado missing explícito.
 */
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORTAL_DIR = __dirname;

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
  for (let attempt = 0; attempt < 160; attempt += 1) {
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

// Mock do client injetado no browser. Dataset gerado lá (5.000 itens por
// conta) para não serializar megabytes pelo CDP.
const MOCK_CLIENT = `
  (function () {
    var TOTAL = 5000;
    var STATUS = ["HEALTHY", "LOW_MARGIN", "LOSS", "UNVALIDATED", "SUSPECT_DATA"];
    var MARGEM = [0.2, 0.05, -0.1, null, 0.15];
    function ev(source, value, quality) {
      return { source: source, kind: "PROJECTED", value: value, quality: quality || "MEASURED", observedAt: "2026-09-27T10:00:00Z", note: null };
    }
    function field(e) {
      return { present: !!e, selectedValue: e ? e.value : null, selectedSource: e ? e.source : null, selectedKind: e ? "PROJECTED" : null,
        projected: e, realized: null, evidences: e ? [e] : [], divergences: [], hasConflict: false, hasDrift: false };
    }
    function rawItem(conta, i) {
      var status = STATUS[i % 5];
      var margin = MARGEM[i % 5];
      return {
        itemId: "C" + conta + "-MLB" + (100000 + i), title: "Produto " + i + " da conta " + conta, titulo: "Produto " + i + " da conta " + conta,
        sku: "SKU-" + i, status: status, confidence: "HIGH", marketplace: "meli", targetMargin: 0.1,
        fields: {
          price: field(ev("MELI_API", 100)), cost: field(status === "UNVALIDATED" ? null : ev("VENFORCE_BASE", 40, "DECLARED")),
          taxRate: field(ev("VENFORCE_BASE", 0.1, "DECLARED")), fixedFee: field(ev("VENFORCE_BASE", 0, "DECLARED")),
          commission: field(ev("MELI_API", 12)), commissionRate: field(ev("MELI_API", 0.12)), freight: field(ev("MELI_API", 20)),
        },
        projected: { margin: margin, profit: margin === null ? null : margin * 100, estimated: false },
        realized: { margin: null, profit: null, pending: true },
        quality: { confidence: "HIGH", confidenceByField: {}, reasons: [], divergences: [], statusReasons: ["status " + status] },
        snapshot: { refreshStatus: i === 3 ? "failed" : "fresh", lastError: i === 3 ? "ML 503" : null, calculatedAt: "2026-09-27T10:00:00Z" },
        statusBase: "projected",
        sales: { hasOrders: false }, settlement: { available: false },
      };
    }
    function statusDe(i) { return STATUS[i % 5]; }

    window.__cmCalls = { workspace: 0, resumo: [], itens: [], refresh: [], status: [] };
    window.__cmItemsRecebidos = 0;
    window.__cmMissing = { "901": true };
    window.__cmRuns = {};            // conta -> run
    window.__cmOutcome = "completed"; // completed | failed | slow

    function runPublico(run) {
      return run ? { runId: run.runId, status: run.status, totalItems: run.totalItems, processedItems: run.processedItems,
        successItems: run.successItems, failedItems: run.failedItems, errorCode: run.errorCode || null, errorMessage: run.errorMessage || null } : null;
    }
    function ativo(conta) { var r = window.__cmRuns[conta]; return r && r.status !== "completed" && r.status !== "failed" ? r : null; }
    function ultimo(conta) { var r = window.__cmRuns[conta]; return r && (r.status === "completed" || r.status === "failed") ? r : null; }

    window.__VF_CENTRAL_MARGEM_POLL_MS__ = 120;
    window.__VF_CENTRAL_MARGEM_API_CLIENT__ = {
      getWorkspace: function () { window.__cmCalls.workspace += 1; return Promise.resolve({ ok: false, status: 500, error: "workspace ao vivo NÃO deveria ser chamado" }); },
      getSnapshotResumo: function (params) {
        window.__cmCalls.resumo.push(params);
        // Cenário de compatibilidade: backend sem a rota de snapshot.
        if (sessionStorage.getItem("cmResumo404") === "1") {
          return Promise.resolve({ ok: false, status: 404, error: "not found", type: "not-found" });
        }
        if (!params.clienteContaId) {
          return Promise.resolve({ ok: false, status: 400, code: "CLIENTE_CONTA_ID_OBRIGATORIO", error: "clienteContaId é obrigatório" });
        }
        var conta = String(params.clienteContaId);
        var missing = window.__cmMissing[conta] === true;
        var porStatus = { HEALTHY: 0, LOW_MARGIN: 0, LOSS: 0, UNVALIDATED: 0, SUSPECT_DATA: 0, RECONCILING: 0 };
        for (var i = 0; i < TOTAL; i += 1) porStatus[statusDe(i)] += 1;
        var payload = {
          habilitado: true, estado: missing ? "missing" : "ready", acao: missing && !ativo(conta) ? "refresh" : null,
          mensagem: missing ? "Esta conta ainda não tem leitura de margem calculada." : null,
          conta: { id: Number(conta), nome: "Conta " + conta },
          snapshot: { totalItens: missing ? null : TOTAL, ultimoCalculoEm: missing ? null : "2026-09-27T10:00:00Z", foraDoCatalogo: missing ? null : 0 },
          kpis: missing ? null : { total: TOTAL, porStatus: porStatus, porRefreshStatus: { fresh: TOTAL - 1, stale: 0, failed: 1 }, comMargem: TOTAL - porStatus.UNVALIDATED },
          refresh: { runAtivo: runPublico(ativo(conta)), ultimoRun: runPublico(ultimo(conta)) },
        };
        return Promise.resolve(window.VFCentralMargemApi.normalizeSnapshotResumo(payload));
      },
      getSnapshotItens: function (params) {
        window.__cmCalls.itens.push(JSON.parse(JSON.stringify(params)));
        var conta = String(params.clienteContaId);
        var context = { client: { slug: params.clientSlug, name: params.clientName }, marketplace: "meli" };
        if (window.__cmMissing[conta] === true) {
          return Promise.resolve(window.VFCentralMargemApi.normalizeSnapshotItens({ estado: "missing", itens: [], paginacao: { page: 1, limit: params.limit, total: null } }, context));
        }
        var idx = [];
        var termo = (params.search || "").toLowerCase();
        for (var i = 0; i < TOTAL; i += 1) {
          if (params.status && params.status.indexOf(statusDe(i)) === -1) continue;
          if (termo && ("sku-" + i).indexOf(termo) === -1 && ("produto " + i).indexOf(termo) === -1) continue;
          idx.push(i);
        }
        var limit = params.limit || 50;
        var page = params.page || 1;
        var fatia = idx.slice((page - 1) * limit, page * limit);
        window.__cmItemsRecebidos += fatia.length;
        var payload = {
          estado: "ready",
          paginacao: { page: page, limit: limit, total: idx.length, totalPaginas: Math.max(Math.ceil(idx.length / limit), 1) },
          periodo: { dateFrom: "2026-08-29", dateTo: "2026-09-27" },
          ultimoCalculoEm: "2026-09-27T10:00:00Z",
          itens: fatia.map(function (i) { return rawItem(conta, i); }),
          refresh: { runAtivo: runPublico(ativo(conta)), ultimoRun: runPublico(ultimo(conta)) },
        };
        return Promise.resolve(window.VFCentralMargemApi.normalizeSnapshotItens(payload, context));
      },
      requestSnapshotRefresh: function (params) {
        window.__cmCalls.refresh.push(params);
        var conta = String(params.clienteContaId);
        var existente = ativo(conta);
        if (existente) return Promise.resolve({ ok: true, runId: existente.runId, reused: true, run: runPublico(existente) });
        var run = { runId: 700 + window.__cmCalls.refresh.length, conta: conta, status: "queued", totalItems: null, processedItems: 0, successItems: 0, failedItems: 0 };
        window.__cmRuns[conta] = run;
        return Promise.resolve({ ok: true, runId: run.runId, reused: false, run: runPublico(run) });
      },
      getSnapshotRefreshStatus: function (params) {
        window.__cmCalls.status.push(params);
        var run = window.__cmRuns[String(params.clienteContaId)];
        if (!run || run.runId !== params.runId) return Promise.resolve({ ok: false, status: 404, error: "run não encontrado" });
        if (run.status === "queued") { run.status = "running"; run.totalItems = TOTAL; }
        else if (run.status === "running" && window.__cmOutcome !== "slow") {
          run.processedItems = Math.min(TOTAL, run.processedItems + 2500);
          run.successItems = run.processedItems;
          if (run.processedItems >= TOTAL) {
            if (window.__cmOutcome === "failed") { run.status = "failed"; run.errorCode = "MARGIN_SNAPSHOT_LOTES_FALHANDO"; run.errorMessage = "3 lote(s) seguidos falharam; run interrompido."; }
            else { run.status = "completed"; delete window.__cmMissing[run.conta]; }
          }
        }
        return Promise.resolve({ ok: true, run: runPublico(run) });
      },
    };
  })();
`;

async function run() {
  const server = await startStaticServer();
  const serverPort = server.address().port;
  const debugPort = 14000 + Math.floor(Math.random() * 1000);
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=/tmp/vf-central-margem-snapshot-ui-${process.pid}`,
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

    // Shell V3 contra o host de produção hardcoded — interceptado via CDP
    // Fetch, nunca toca a rede real. O cliente tem DUAS contas MELI ativas:
    // o Shell nunca escolhe sozinho (ACCOUNT_CHOICE_REQUIRED).
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
      const json = async (obj) => respond("Fetch.fulfillRequest", {
        requestId: params.requestId, responseCode: 200,
        responseHeaders: [...cors, { name: "content-type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(obj)).toString("base64"),
      });
      if (params.request.method === "OPTIONS") { await respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 204, responseHeaders: cors }); return; }
      if (url.includes("/me/context")) {
        await json({
          ok: true,
          user: { id: 12, nome: "Pedro Gomes", email: null, role: "user" },
          squads: [], squadPrincipalId: null,
          clientes: [{ id: 1, slug: "loja-teste", nome: "Loja Teste", squadId: null, responsavelDireto: false, contasAtivas: null }],
          portfolio: { totalClientes: 1 },
          permissoes: { podeAdministrar: false },
        });
        return;
      }
      if (url.includes("/operacao/cliente-360/clientes")) {
        await json({ ok: true, clientes: [{ id: 1, nome: "Loja Teste", slug: "loja-teste", ativo: true, temGrant: true, grantStatus: "conectado", temBase: true, setupScore: 100, statusOperacional: "pronto", ultimaSincronizacao: null, pendencias: [] }] });
        return;
      }
      if (/\/clientes\/[^/?]+\/contas/.test(url)) {
        const conta = (id, nome) => ({ id, cliente_id: 1, marketplace: "meli", nome, slug: `ml-${id}`, external_account_id: String(id * 1000), externalAccountLabel: nome, is_primary: id === 900, ativo: true, grant: { id, token_status: "valid" }, base: { vinculo_id: id, base_id: id, nome: "Base " + id }, ultimaSync: null });
        await json({ ok: true, cliente: { id: 1, nome: "Loja Teste", slug: "loja-teste", ativo: true }, contas: [conta(900, "Loja principal"), conta(901, "Loja outlet")] });
        return;
      }
      await respond("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" });
    };

    const injection = `
      localStorage.setItem("vf-token", "ui-test-token");
      localStorage.setItem("vf-user", JSON.stringify({ nome: "Teste UI", role: "admin" }));
      ${MOCK_CLIENT}
    `;
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: injection });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/central-margem.html?cliente=loja-teste` });

    const st = (expr) => cdp.evaluate(`(function(){var s=window.VFCentralMargemUi.getState();return ${expr};})()`);
    const rowCount = () => cdp.evaluate("document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length");
    const firstRowId = () => cdp.evaluate("(document.querySelector('#cm-table-host tbody tr[data-item-id]')||{}).getAttribute ? document.querySelector('#cm-table-host tbody tr[data-item-id]').getAttribute('data-item-id') : null");
    const pageState = () => cdp.evaluate("document.getElementById('cm-page-state').innerText");
    const ultimaChamadaItens = () => cdp.evaluate("window.__cmCalls.itens[window.__cmCalls.itens.length-1]");
    const esperarCarregado = (msg) => waitFor(cdp, "window.VFCentralMargemUi && window.VFCentralMargemUi.getState().data && !window.VFCentralMargemUi.getState().loading", msg);

    await check("2+ contas sem escolha: modo persistido pede a operação e nunca escolhe conta sozinho", async () => {
      await waitFor(cdp, "document.querySelector('[data-cm-snapshot-state=\"conta\"]')", "banner de escolha de conta não apareceu");
      assert.strictEqual(await st("s.mode"), "snapshot");
      assert.strictEqual(await st("s.contaId"), null);
      assert.strictEqual(await cdp.evaluate("window.__cmCalls.itens.length"), 0, "nenhuma página lida sem conta");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-refresh').disabled"), true);
    });

    await check("conta escolhida: 1ª página (50) do servidor, KPIs da conta inteira, nenhuma chamada ao workspace ao vivo", async () => {
      await cdp.evaluate("window.VF.context.setConta(900)");
      await esperarCarregado("página 1 não carregou");
      assert.strictEqual(await rowCount(), 50);
      assert.strictEqual(await cdp.evaluate("window.__cmCalls.workspace"), 0, "Motor ao vivo nunca é chamado no modo persistido");
      const chamada = await ultimaChamadaItens();
      assert.strictEqual(chamada.clienteContaId, 900);
      assert.strictEqual(chamada.page, 1);
      assert.strictEqual(chamada.limit, 50);
      assert.ok((await cdp.evaluate("document.getElementById('cm-result-count').innerText")).includes("5000"));
      assert.ok((await cdp.evaluate("document.getElementById('cm-pagination').innerText")).includes("Página 1 de 100"));
      const kpis = await cdp.evaluate("document.getElementById('cm-kpis-financial').innerText");
      assert.ok(kpis.includes("5000") && kpis.includes("1000"), "placar da conta inteira (5.000; 1.000 por status), não da página");
      assert.ok((await pageState()).includes("não puderam ser recalculados"), "aviso de itens com refresh falho");
      assert.ok(await cdp.evaluate("Boolean(document.querySelector('[data-cm-refresh-failed]'))"), "linha marcada com valor anterior");
    });

    await check("5.000 itens navegados sem carregar tudo: próxima página, 200 por página, nunca > 1 página no DOM", async () => {
      const antes = await firstRowId();
      await cdp.evaluate("document.getElementById('cm-page-next').click()");
      await waitFor(cdp, "window.VFCentralMargemUi.getState().serverPage === 2 && !window.VFCentralMargemUi.getState().loading");
      assert.notStrictEqual(await firstRowId(), antes);
      assert.strictEqual((await ultimaChamadaItens()).page, 2);

      await cdp.evaluate("(function(){var s=document.getElementById('cm-page-size');s.value='200';s.dispatchEvent(new Event('change'));})()");
      await waitFor(cdp, "document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length === 200 && !window.VFCentralMargemUi.getState().loading");
      assert.ok((await cdp.evaluate("document.getElementById('cm-pagination').innerText")).includes("Página 1 de 25"));
      for (let i = 0; i < 3; i += 1) {
        await cdp.evaluate("document.getElementById('cm-page-next').click()");
        await waitFor(cdp, `window.VFCentralMargemUi.getState().serverPage === ${i + 2} && !window.VFCentralMargemUi.getState().loading`);
        assert.ok(await rowCount() <= 200);
      }
      const recebidos = await cdp.evaluate("window.__cmItemsRecebidos");
      assert.ok(recebidos < 5000, `browser recebeu só as páginas navegadas (${recebidos} itens), nunca o catálogo inteiro`);
    });

    await check("busca e filtro vão ao servidor (página 1), com o status canônico", async () => {
      await cdp.evaluate("(function(){var i=document.getElementById('cm-search');i.value='SKU-4999';i.dispatchEvent(new Event('input'));})()");
      await waitFor(cdp, "window.__cmCalls.itens[window.__cmCalls.itens.length-1].search === 'SKU-4999' && !window.VFCentralMargemUi.getState().loading", "busca não foi ao servidor");
      assert.strictEqual(await rowCount(), 1);
      assert.strictEqual((await ultimaChamadaItens()).page, 1);

      await cdp.evaluate("(function(){var i=document.getElementById('cm-search');i.value='';i.dispatchEvent(new Event('input'));})()");
      await waitFor(cdp, "!window.__cmCalls.itens[window.__cmCalls.itens.length-1].search && !window.VFCentralMargemUi.getState().loading");
      await cdp.evaluate("(function(){var s=document.getElementById('cm-financial-filter');s.value='LOSS';s.dispatchEvent(new Event('change'));})()");
      await waitFor(cdp, "JSON.stringify(window.__cmCalls.itens[window.__cmCalls.itens.length-1].status) === '[\"LOSS\"]' && !window.VFCentralMargemUi.getState().loading", "filtro não foi ao servidor");
      assert.ok((await cdp.evaluate("document.getElementById('cm-result-count').innerText")).includes("1000"));
      await cdp.evaluate("(function(){var s=document.getElementById('cm-financial-filter');s.value='';s.dispatchEvent(new Event('change'));})()");
      await waitFor(cdp, "!window.__cmCalls.itens[window.__cmCalls.itens.length-1].status && !window.VFCentralMargemUi.getState().loading");
    });

    await check("refresh manual: não congela a tela, mostra progresso, mantém a leitura anterior e para o polling no fim", async () => {
      await cdp.evaluate("document.getElementById('cm-refresh').click()");
      await waitFor(cdp, "window.__cmCalls.refresh.length === 1", "refresh não foi solicitado");
      assert.strictEqual((await cdp.evaluate("window.__cmCalls.refresh[0]")).clienteContaId, 900);
      assert.ok(await rowCount() > 0, "a leitura anterior continua visível durante a atualização");
      await waitFor(cdp, "document.getElementById('cm-page-state').innerText.indexOf('Atualizando leitura') !== -1 || document.getElementById('cm-page-state').innerText.indexOf('Na fila') !== -1", "banner de progresso não apareceu");

      // Tela responde durante o refresh: navegar de página funciona.
      await cdp.evaluate("document.getElementById('cm-page-next').click()");
      await waitFor(cdp, "!window.VFCentralMargemUi.getState().loading && window.VFCentralMargemUi.getState().serverPage >= 2", "navegação travou durante o refresh");

      await waitFor(cdp, "document.getElementById('cm-page-state').innerText.indexOf('2500 / 5000') !== -1 || window.__cmRuns['900'].status === 'completed'", "progresso processados/total não apareceu");
      await waitFor(cdp, "window.__cmRuns['900'].status === 'completed' && !window.VFCentralMargemUi.getState().pollTimer", "polling não terminou");
      await waitFor(cdp, "document.getElementById('cm-page-state').innerText.indexOf('Atualizando') === -1");
      const chamadas = await cdp.evaluate("window.__cmCalls.status.length");
      await sleep(600);
      assert.strictEqual(await cdp.evaluate("window.__cmCalls.status.length"), chamadas, "nenhum polling depois do estado terminal");
    });

    await check("refresh que falha: erro visível e dados anteriores mantidos (nada zerado)", async () => {
      await cdp.evaluate("window.__cmOutcome='failed';document.getElementById('cm-refresh').click()");
      await waitFor(cdp, "document.querySelector('[data-cm-snapshot-state=\"failed\"]')", "falha não apareceu");
      assert.ok((await pageState()).includes("último snapshot válido"));
      assert.ok(await rowCount() > 0);
      assert.ok((await cdp.evaluate("document.getElementById('cm-kpis-financial').innerText")).includes("5000"));
    });

    await check("troca de conta troca o dataset e mata o polling da conta anterior", async () => {
      await cdp.evaluate("window.__cmOutcome='slow';document.getElementById('cm-refresh').click()");
      await waitFor(cdp, "window.VFCentralMargemUi.getState().pollTimer", "polling da conta 900 não começou");
      await cdp.evaluate("window.VF.context.setConta(901)");
      await waitFor(cdp, "window.VFCentralMargemUi.getState().contaId === 901 && !window.VFCentralMargemUi.getState().loading", "troca de conta não recarregou");
      const status900 = await cdp.evaluate("window.__cmCalls.status.filter(function(c){return c.clienteContaId===900;}).length");
      await sleep(600);
      assert.strictEqual(await cdp.evaluate("window.__cmCalls.status.filter(function(c){return c.clienteContaId===900;}).length"), status900, "polling da conta 900 parou");
      assert.strictEqual((await cdp.evaluate("window.__cmCalls.resumo[window.__cmCalls.resumo.length-1]")).clienteContaId, 901);
    });

    await check("conta sem leitura: estado 'missing' explícito (nunca '0 itens'), KPIs '—' e ação de atualizar", async () => {
      await waitFor(cdp, "document.querySelector('[data-cm-snapshot-state=\"missing\"]')", "estado missing não apareceu");
      assert.ok((await cdp.evaluate("document.getElementById('cm-table-host').innerText")).includes("Leitura ainda não calculada"));
      const kpis = await cdp.evaluate("document.getElementById('cm-kpis-financial').innerText");
      assert.ok(kpis.includes("—") && !/\b0\b/.test(kpis), "placar de conta missing nunca vira zeros");
      await cdp.evaluate("window.__cmOutcome='completed';document.getElementById('cm-snapshot-start').click()");
      await waitFor(cdp, "window.__cmCalls.refresh.some(function(c){return c.clienteContaId===901;})", "ação do banner não pediu refresh da conta 901");
      await waitFor(cdp, "window.__cmRuns['901'] && window.__cmRuns['901'].status === 'completed' && document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length > 0", "conta 901 não passou a mostrar a leitura calculada");
      assert.ok((await firstRowId()).startsWith("C901-"), "dataset é o da conta 901");
    });

    await check("backend sem a rota de snapshot (404): a tela cai no workspace legado, sem ficar em erro", async () => {
      await cdp.evaluate("sessionStorage.setItem('cmResumo404','1'); location.reload()");
      await waitFor(cdp, "window.__cmCalls && window.__cmCalls.workspace === 1", "workspace legado não foi chamado após 404 do resumo");
      assert.strictEqual(await st("s.mode"), "legacy");
      await cdp.evaluate("sessionStorage.removeItem('cmResumo404')");
    });

    console.log(`# ${checks} smoke tests de UI (leitura persistida) concluídos`);
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
