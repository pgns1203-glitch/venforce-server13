/* Atividade dos membros do Squad — V1.
 *
 * Reaproveita GET /admin/logs (server/controllers/logsController.js) já
 * existente; nenhum endpoint, tabela ou logger novo. Este teste cobre
 * somente o frontend: Portal/squads-config.html/js/css.
 *
 * Mesma infraestrutura de Portal/squads-config-redesign-ui.test.js: reaproveita
 * Cdp/startServer/waitFor/sleep de squads-config-hotfix-ui.test.js via o
 * mesmo truque de Module._compile, e intercepta TODA requisição ao domínio
 * de produção via CDP Fetch — nenhum backend real é tocado.
 *
 * node Portal/squads-config-member-activity-ui.test.js
 */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { spawn } = require("node:child_process");

const existing = path.join(__dirname, "squads-config-hotfix-ui.test.js");
const harness = new Module(existing, module);
harness.filename = existing; harness.paths = module.paths;
const source = fs.readFileSync(existing, "utf8");
const boundary = source.indexOf("async function run() {");
assert.ok(boundary > 0, "Harness existente precisa expor seu setup antes de run().");
harness._compile(source.slice(0, boundary) + `\nmodule.exports = { Cdp, startServer, waitChrome, waitFor, sleep };`, existing);
const { Cdp, startServer, waitChrome, waitFor, sleep } = harness.exports;

/* ── FIXTURES ────────────────────────────────────────────────────────────
 * Horários relativos ao instante em que o teste roda (NOW), para que os
 * presets Hoje/7 dias/30 dias do frontend (que usam a data local do
 * browser) sempre caiam nas janelas certas, não importa quando o teste
 * é executado. */
const NOW = new Date();
function todayAt(h, m) { const d = new Date(NOW); d.setHours(h, m, 0, 0); return d.toISOString(); }
function daysAgoAt(n, h, m) { const d = new Date(NOW); d.setDate(d.getDate() - n); d.setHours(h, m, 0, 0); return d.toISOString(); }
let nextLogId = 1;
function log({ userId, userNome, userEmail, acao, status = "sucesso", createdAt, detalhes = null, ip = "203.0.113.10" }) {
  return { id: nextLogId++, user_id: userId, user_nome: userNome, user_email: userEmail, acao, detalhes, ip, status, created_at: createdAt };
}
const PEDRO = { id: 10, nome: "Pedro Gabriel", email: "pedro@venforce.com" };
const MICAEL = { id: 11, nome: "Micael Almeida", email: "micael@venforce.com" };
const GUSTAVO = { id: 12, nome: "Gustavo Souza", email: "gustavo@venforce.com" };
const FERNANDO = { id: 13, nome: "Fernando Lima", email: "fernando@venforce.com" };
const HELENA = { id: 99, nome: "Helena Vazia", email: "helena@venforce.com" };

function estadoInicial() {
  return {
    squads: [
      { id: 1, nome: "Squad Alfa", slug: "alfa", ativo: true },
      { id: 2, nome: "Squad Beta", slug: "beta", ativo: true },
      { id: 3, nome: "Squad Vazio", slug: "vazio", ativo: true },
    ],
    membros: {
      1: [
        { user_id: PEDRO.id, user_nome: PEDRO.nome, user_email: PEDRO.email, funcao: "coordenador", is_primary: true },
        { user_id: MICAEL.id, user_nome: MICAEL.nome, user_email: MICAEL.email, funcao: "coordenador", is_primary: true },
        { user_id: GUSTAVO.id, user_nome: GUSTAVO.nome, user_email: GUSTAVO.email, funcao: "membro", is_primary: true },
        { user_id: FERNANDO.id, user_nome: FERNANDO.nome, user_email: FERNANDO.email, funcao: "membro", is_primary: true },
      ],
      // Pedro também está no Squad Beta — os MESMOS logs pessoais dele devem
      // reaparecer aqui (regra de multi-Squad da missão, não deduplicar).
      2: [{ user_id: PEDRO.id, user_nome: PEDRO.nome, user_email: PEDRO.email, funcao: "membro", is_primary: false }],
      3: [{ user_id: HELENA.id, user_nome: HELENA.nome, user_email: HELENA.email, funcao: "membro", is_primary: true }],
    },
    squadClientLinks: { 1: [], 2: [], 3: [] },
    allClients: [],
    logs: [
      log({ userId: PEDRO.id, userNome: PEDRO.nome, userEmail: PEDRO.email, acao: "admin.cliente.criar", createdAt: todayAt(12, 31), detalhes: { cliente: "Cliente Teste" } }),
      log({ userId: PEDRO.id, userNome: PEDRO.nome, userEmail: PEDRO.email, acao: "base.custo.upsert", createdAt: todayAt(12, 22) }),
      log({ userId: PEDRO.id, userNome: PEDRO.nome, userEmail: PEDRO.email, acao: "login.falha", status: "falha", createdAt: todayAt(9, 5) }),
      log({ userId: PEDRO.id, userNome: PEDRO.nome, userEmail: PEDRO.email, acao: "login.sucesso", createdAt: daysAgoAt(3, 9, 0) }),
      log({ userId: PEDRO.id, userNome: PEDRO.nome, userEmail: PEDRO.email, acao: "login.sucesso", createdAt: daysAgoAt(20, 9, 0) }),
      log({ userId: MICAEL.id, userNome: MICAEL.nome, userEmail: MICAEL.email, acao: "ads_acompanhamento_salvo", createdAt: todayAt(12, 17) }),
      log({ userId: MICAEL.id, userNome: MICAEL.nome, userEmail: MICAEL.email, acao: "login.sucesso", createdAt: todayAt(11, 0) }),
      log({ userId: GUSTAVO.id, userNome: GUSTAVO.nome, userEmail: GUSTAVO.email, acao: "automacoes.promocoes.diagnostico.start", createdAt: todayAt(10, 42) }),
      log({ userId: GUSTAVO.id, userNome: GUSTAVO.nome, userEmail: GUSTAVO.email, acao: "base.excluir", status: "falha", createdAt: todayAt(10, 40) }),
      // Fernando: nada hoje, nada em 7 dias, 1 evento dentro de 30 dias.
      log({ userId: FERNANDO.id, userNome: FERNANDO.nome, userEmail: FERNANDO.email, acao: "login.sucesso", createdAt: daysAgoAt(10, 9, 0) }),
    ],
  };
}
let S = estadoInicial();
function reset() { S = estadoInicial(); fail = null; }

let fail = null;
const requested = [];
const logsRequested = [];
const errors = [];

function todayStr() { const d = NOW; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

function route(pathname, search, method) {
  if (fail && pathname === fail.path && method === (fail.method || "GET")) return { status: fail.status || 500, body: { ok: false, erro: "Falha controlada no teste" } };
  if (pathname === "/me/context") return { status: 404, body: { ok: false } };
  if (pathname === "/operacao/cliente-360/clientes") return { status: 200, body: { ok: true, clientes: [] } };
  if (pathname === "/squads" && method === "GET") {
    return { status: 200, body: { ok: true, squads: S.squads.map(s => ({ ...s, clientes_ativos: (S.squadClientLinks[s.id] || []).length, membros_ativos: (S.membros[s.id] || []).length })) } };
  }
  let m = pathname.match(/^\/squads\/(\d+)\/membros$/);
  if (m && method === "GET") return { status: 200, body: { ok: true, membros: S.membros[Number(m[1])] || [] } };
  m = pathname.match(/^\/squads\/(\d+)\/clientes$/);
  if (m && method === "GET") return { status: 200, body: { ok: true, clientes: [] } };
  if (pathname === "/clientes" && method === "GET") return { status: 200, body: { ok: true, clientes: S.allClients } };
  if (pathname === "/usuarios" && method === "GET") return { status: 200, body: { ok: true, usuarios: [] } };
  if (pathname === "/admin/logs" && method === "GET") {
    logsRequested.push(search);
    const qs = new URLSearchParams(search);
    const userId = Number(qs.get("user_id"));
    const status = qs.get("status");
    const de = qs.get("de");
    const ate = qs.get("ate");
    const page = Math.max(Number(qs.get("page") || 1), 1);
    const limit = Math.min(Math.max(Number(qs.get("limit") || 50), 1), 200);
    let rows = S.logs.filter(l => l.user_id === userId);
    if (status) rows = rows.filter(l => l.status === status);
    if (de) rows = rows.filter(l => new Date(l.created_at) >= new Date(`${de}T00:00:00`));
    if (ate) rows = rows.filter(l => new Date(l.created_at) <= new Date(`${ate}T23:59:59`));
    rows = rows.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const total = rows.length;
    const paged = rows.slice((page - 1) * limit, (page - 1) * limit + limit);
    return { status: 200, body: { ok: true, logs: paged, total, page, totalPages: Math.max(Math.ceil(total / limit), 1) } };
  }
  return { status: 404, body: { ok: false, erro: `rota fake não implementada: ${method} ${pathname}` } };
}

let checks = 0;
async function check(name, fn) { await fn(); checks += 1; console.log(`ok ${checks} - ${name}`); }
const screenshotsDir = process.argv.find(a => a.startsWith("--screenshots="))?.split("=")[1];
if (screenshotsDir) fs.mkdirSync(screenshotsDir, { recursive: true });

async function run() {
  reset();
  const server = await startServer();
  const port = global.__PORT__;
  const debugPort = 18200 + Math.floor(Math.random() * 500);
  const profile = fs.mkdtempSync("/tmp/vf-sq-activity-");
  const chrome = spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-background-networking",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore" });

  let cdp;
  try {
    await waitChrome(debugPort);
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    cdp = new Cdp(targets.find(t => t.type === "page").webSocketDebuggerUrl);
    await cdp.open();
    cdp.socket.addEventListener("message", e => { const msg = JSON.parse(e.data); if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails); });
    await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
    cdp.onRequestPaused = async ({ requestId, request }) => {
      try {
        const u = new URL(request.url);
        const local = u.origin === `http://127.0.0.1:${port}`;
        if (local) { await cdp.send("Fetch.continueRequest", { requestId }); return; }
        requested.push(request.url);
        let result = { status: 200, body: "" }, type = "text/plain";
        if (u.origin === "https://venforce-server.onrender.com") {
          if (request.method === "OPTIONS") { result = { status: 204, body: "" }; }
          else { result = route(u.pathname, u.search.slice(1), request.method); type = "application/json"; }
        }
        await cdp.send("Fetch.fulfillRequest", {
          requestId, responseCode: result.status,
          responseHeaders: [
            { name: "Content-Type", value: type },
            { name: "Access-Control-Allow-Origin", value: "*" },
            { name: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,DELETE,OPTIONS" },
            { name: "Access-Control-Allow-Headers", value: "Content-Type,Authorization" },
          ],
          body: Buffer.from(typeof result.body === "string" ? result.body : JSON.stringify(result.body)).toString("base64"),
        });
      } catch (e) { errors.push(String(e)); }
    };
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    const ev = expression => cdp.evaluate(expression);
    const click = selector => ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const settled = () => waitFor(cdp, "!STATE.refreshing && !STATE.busy", "estado não estabilizou");
    const activitySettled = () => waitFor(cdp, "STATE.activity.status !== 'loading'", "atividade não estabilizou");

    async function gotoAdmin() {
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}/harness-squads.html` });
      await waitFor(cdp, "typeof STATE !== 'undefined' && STATE.squads.length > 0 && !STATE.refreshing", "boot falhou");
    }
    async function switchToNonAdmin() {
      await ev(`localStorage.setItem('vf-user', JSON.stringify({ id: 77, nome: 'Sessão sem admin', role: 'membro' }))`);
      await cdp.send("Page.reload");
      await waitFor(cdp, "typeof STATE !== 'undefined' && !ADMIN && !STATE.refreshing", "boot não-admin falhou");
    }
    const select = async sid => { await click(`.sq-row[data-id="${sid}"]`); await settled(); await activitySettled(); };

    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await gotoAdmin();
    await select(1);

    await check("1. admin vê a área de Atividade", async () => {
      assert.equal(await ev("$('sq-activity-section').hidden"), false);
    });

    await check("4/5. cada membro do Squad Alfa gerou consulta própria ao abrir (user_id correto, de=hoje)", async () => {
      const ids = new Set(logsRequested.map(qs => new URLSearchParams(qs).get("user_id")));
      assert.deepEqual([...ids].sort(), ["10", "11", "12", "13"]);
      assert.equal(logsRequested.length, 8, "4 membros × 2 consultas (recentes + falhas)");
      assert.ok(logsRequested.every(qs => new URLSearchParams(qs).get("de") === todayStr()));
    });

    await check("6. resumo soma eventos corretamente (Hoje)", async () => {
      const texto = await ev("$('sq-activity-summary').textContent");
      assert.match(texto, /4 membros/);
      assert.match(texto, /3 com atividade/);
      assert.match(texto, /7 eventos/);
      assert.match(texto, /2 falhas/);
    });

    await check("9. falhas são contabilizadas por pessoa", async () => {
      const texto = await ev("$('sq-activity-people').textContent");
      assert.match(texto, /Gustavo Souza[\s\S]*1 falha/);
    });

    await check("7. última atividade correta", async () => {
      const texto = await ev("$('sq-activity-people').textContent");
      const pedroHora = `${String(new Date(todayAt(12, 31)).getHours()).padStart(2, "0")}:31`;
      assert.match(texto, new RegExp(`Pedro Gabriel[\\s\\S]*${pedroHora}`));
    });

    await check("8. pessoa sem evento aparece como 'Sem atividade registrada', não 'Inativo'", async () => {
      const texto = await ev("$('sq-activity-people').textContent");
      assert.match(texto, /Fernando Lima[\s\S]*Sem atividade registrada no período/);
      assert.doesNotMatch(texto, /Inativo/);
    });

    await check("10. timeline global ordenada por created_at DESC + ação amigável mapeada", async () => {
      const primeiro = await ev("document.querySelector('.sq-activity-item').textContent");
      assert.match(primeiro, /Pedro Gabriel/);
      assert.match(primeiro, /Criou cliente/);
    });

    await check("13a. período Hoje: Fernando sem eventos, Gustavo com eventos", async () => {
      const texto = await ev("$('sq-activity-people').textContent");
      assert.match(texto, /Fernando Lima[\s\S]*Sem atividade/);
    });

    await check("13b. troca para 7 dias inclui evento de 3 dias atrás mas mantém Fernando sem atividade", async () => {
      await click('[data-action="activity-period"][data-period="7d"]');
      await activitySettled();
      const texto = await ev("$('sq-activity-summary').textContent");
      assert.match(texto, /8 eventos/); // 7 de hoje + 1 de 3 dias atrás
      const pessoas = await ev("$('sq-activity-people').textContent");
      assert.match(pessoas, /Fernando Lima[\s\S]*Sem atividade/);
    });

    await check("13c. troca para 30 dias inclui o evento de Fernando (10 dias atrás)", async () => {
      await click('[data-action="activity-period"][data-period="30d"]');
      await activitySettled();
      const pessoas = await ev("$('sq-activity-people').textContent");
      assert.match(pessoas, /Fernando Lima[\s\S]*1 evento/);
      await click('[data-action="activity-period"][data-period="hoje"]');
      await activitySettled();
    });

    await check("11. filtro por pessoa não dispara nova requisição", async () => {
      const antes = logsRequested.length;
      await ev(`document.getElementById('sq-activity-filter-person').value='${PEDRO.id}'; document.getElementById('sq-activity-filter-person').dispatchEvent(new Event('change'))`);
      await sleep(60);
      assert.equal(logsRequested.length, antes, "filtro por pessoa não deve chamar /admin/logs de novo");
      const itens = await ev("Array.from(document.querySelectorAll('.sq-activity-item .sq-activity-item-person')).map(e=>e.textContent)");
      assert.ok(itens.length > 0 && itens.every(n => n === "Pedro Gabriel"));
      await ev(`document.getElementById('sq-activity-filter-person').value='all'; document.getElementById('sq-activity-filter-person').dispatchEvent(new Event('change'))`);
    });

    await check("12. filtro por status (falha) não dispara nova requisição", async () => {
      const antes = logsRequested.length;
      await ev(`document.getElementById('sq-activity-filter-status').value='falha'; document.getElementById('sq-activity-filter-status').dispatchEvent(new Event('change'))`);
      await sleep(60);
      assert.equal(logsRequested.length, antes);
      const tags = await ev("Array.from(document.querySelectorAll('.sq-activity-item .vf-tag')).map(e=>e.textContent)");
      assert.ok(tags.length > 0 && tags.every(t => t === "Falha"));
      await ev(`document.getElementById('sq-activity-filter-status').value='all'; document.getElementById('sq-activity-filter-status').dispatchEvent(new Event('change'))`);
    });

    await check("4/16. Squad Beta usa somente Pedro (não busca Micael/Gustavo/Fernando)", async () => {
      const antes = logsRequested.length;
      await select(2);
      const novas = logsRequested.slice(antes);
      const ids = new Set(novas.map(qs => new URLSearchParams(qs).get("user_id")));
      assert.deepEqual([...ids], ["10"]);
    });

    await check("15. multi-Squad: Pedro aparece com os MESMOS logs no Squad Beta", async () => {
      const texto = await ev("$('sq-activity-people').textContent");
      assert.match(texto, /Pedro Gabriel[\s\S]*3 eventos/);
    });

    await check("18. Squad sem nenhuma atividade mostra estado vazio, não erro", async () => {
      await select(3);
      const timeline = await ev("$('sq-activity-timeline').textContent");
      assert.match(timeline, /Nenhuma atividade registrada para os membros deste Squad no período\./);
      assert.equal(await ev("Boolean(document.querySelector('#sq-activity-summary .sq-empty'))"), false);
      const resumo = await ev("$('sq-activity-summary').textContent");
      assert.match(resumo, /0 eventos/);
    });

    await check("17. erro no /admin/logs mostra retry; retry recupera", async () => {
      fail = { path: "/admin/logs" };
      await click('.sq-row[data-id="1"]'); await settled(); await activitySettled();
      assert.ok(await ev("Boolean(document.querySelector('[data-action=\"activity-retry\"]'))"), "botão de retry não apareceu");
      assert.match(await ev("$('sq-activity-summary').textContent"), /Não foi possível carregar a atividade/);
      fail = null;
      await click('[data-action="activity-retry"]');
      await activitySettled();
      assert.match(await ev("$('sq-activity-summary').textContent"), /4 membros/);
    });

    await check("14. troca rápida de Squad não pinta resposta antiga", async () => {
      // Squad Beta tem só Pedro; ao trocar rapidamente para o Vazio, a
      // resposta atrasada de Beta não pode aparecer no Vazio.
      await click('.sq-row[data-id="2"]');
      await sleep(5); // não espera settled — dispara a troca antes da 1ª resolver
      await click('.sq-row[data-id="3"]');
      await settled(); await activitySettled();
      const texto = await ev("$('sq-activity-summary').textContent");
      assert.match(texto, /1 membro/, `esperava resumo do Squad Vazio, veio: ${texto}`);
      assert.doesNotMatch(texto, /Pedro/);
    });

    await check("nenhum erro JS não tratado durante todo o fluxo", async () => {
      assert.deepEqual(errors, []);
    });

    await check("QA visual: 1440/1024/390px sem overflow horizontal com Atividade visível", async () => {
      await select(1);
      for (const width of [1440, 1024, 390]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        if (width === 390) { await click("#sq-detail-close"); await select(1); }
        await ev("document.getElementById('sq-activity-section').scrollIntoView()");
        assert.ok(await ev("document.documentElement.scrollWidth <= window.innerWidth"), `overflow horizontal em ${width}px`);
        if (screenshotsDir) {
          await sleep(120);
          const img = await cdp.send("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(path.join(screenshotsDir, `activity-${width}.png`), Buffer.from(img.data, "base64"));
        }
      }
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    });

    /* ═════════════════ NÃO-ADMIN ═════════════════ */
    reset();
    const logsAntesDoNaoAdmin = logsRequested.length;
    await switchToNonAdmin();
    await ev(`document.querySelector('.sq-row').click()`);
    await settled();

    await check("2. não-admin não vê a área de Atividade", async () => {
      assert.equal(await ev("$('sq-activity-section').hidden"), true);
    });

    await check("3. não-admin nunca dispara GET /admin/logs", async () => {
      assert.equal(logsRequested.length, logsAntesDoNaoAdmin, "nenhuma nova consulta a /admin/logs deveria ocorrer para não-admin");
    });

    console.log(`\n✓ ${checks} verificações de Atividade dos membros do Squad`);
  } finally {
    if (cdp) cdp.close();
    chrome.kill("SIGTERM");
    server.close();
  }
}
function todayAtRef(h, m) { const d = new Date(NOW); d.setHours(h, m, 0, 0); return d.toISOString(); }

run().catch(err => { console.error(err); process.exitCode = 1; });
