/* Atividade dos Squads — visão própria de comparação (V2 desta feature).
 *
 * Ajuste de UX sobre a V1: Atividade deixou de ser uma seção dentro do
 * detalhe de um Squad e virou um MODO próprio (Configuração ⇄ Atividade)
 * que compara vários Squads lado a lado, com dedupe de /admin/logs por
 * user_id (uma pessoa em 3 Squads é buscada 1 vez só) e um drawer de
 * detalhe por pessoa. Reaproveita GET /admin/logs (logsController.js) já
 * existente; nenhum endpoint, tabela ou logger novo.
 *
 * Mesma infraestrutura de squads-config-redesign-ui.test.js: reaproveita
 * Cdp/startServer/waitFor/sleep de squads-config-hotfix-ui.test.js via o
 * mesmo truque de Module._compile, e intercepta TODA requisição ao domínio
 * de produção via CDP Fetch — nenhum backend real é tocado.
 *
 * node Portal/squads-config-member-activity-ui.test.js [--screenshots=DIR]
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
function log({ userId, acao, status = "sucesso", createdAt, detalhes = null, ip = "203.0.113.10" }) {
  return { id: nextLogId++, user_id: userId, acao, detalhes, ip, status, created_at: createdAt };
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
      // Pedro também está no Squad Beta — regra de multi-Squad: os MESMOS
      // logs pessoais dele devem reaparecer, sem duplicar o fetch.
      2: [{ user_id: PEDRO.id, user_nome: PEDRO.nome, user_email: PEDRO.email, funcao: "membro", is_primary: false }],
      3: [{ user_id: HELENA.id, user_nome: HELENA.nome, user_email: HELENA.email, funcao: "membro", is_primary: true }],
    },
    squadClientLinks: { 1: [], 2: [], 3: [] },
    allClients: [],
    logs: [
      log({ userId: PEDRO.id, acao: "admin.cliente.criar", createdAt: todayAt(12, 31), detalhes: { cliente: "Cliente Teste" } }),
      log({ userId: PEDRO.id, acao: "base.custo.upsert", createdAt: todayAt(12, 22) }),
      log({ userId: PEDRO.id, acao: "login.falha", status: "falha", createdAt: todayAt(9, 5) }),
      log({ userId: PEDRO.id, acao: "login.sucesso", createdAt: daysAgoAt(3, 9, 0) }),
      log({ userId: PEDRO.id, acao: "login.sucesso", createdAt: daysAgoAt(20, 9, 0) }),
      log({ userId: MICAEL.id, acao: "ads_acompanhamento_salvo", createdAt: todayAt(12, 17) }),
      log({ userId: MICAEL.id, acao: "login.sucesso", createdAt: todayAt(11, 0) }),
      log({ userId: GUSTAVO.id, acao: "automacoes.promocoes.diagnostico.start", createdAt: todayAt(10, 42) }),
      log({ userId: GUSTAVO.id, acao: "base.excluir", status: "falha", createdAt: todayAt(10, 40) }),
      // Fernando: nada hoje, nada em 7 dias, 1 evento dentro de 30 dias.
      log({ userId: FERNANDO.id, acao: "login.sucesso", createdAt: daysAgoAt(10, 9, 0) }),
    ],
  };
}
let S = estadoInicial();
function reset() { S = estadoInicial(); fail = null; }

let fail = null;
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
  const debugPort = 18700 + Math.floor(Math.random() * 500);
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
    const activitySettled = () => waitFor(cdp, "STATE.activityView.status !== 'loading'", "atividade não estabilizou");

    async function gotoAdmin() {
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}/harness-squads.html` });
      await waitFor(cdp, "typeof STATE !== 'undefined' && STATE.squads.length > 0 && !STATE.refreshing", "boot falhou");
    }
    async function switchToNonAdmin() {
      await ev(`localStorage.setItem('vf-user', JSON.stringify({ id: 77, nome: 'Sessão sem admin', role: 'membro' }))`);
      await cdp.send("Page.reload");
      await waitFor(cdp, "typeof STATE !== 'undefined' && !ADMIN && !STATE.refreshing", "boot não-admin falhou");
    }
    const enterActivity = async () => { await click("#sq-mode-activity"); await activitySettled(); };

    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await gotoAdmin();

    await check("1. admin vê Configuração e Atividade; Atividade não é a área default", async () => {
      assert.equal(await ev("$('sq-mode-activity').hidden"), false);
      assert.equal(await ev("$('sq-view-config').hidden"), false);
      assert.equal(await ev("$('sq-view-activity').hidden"), true);
    });

    await check("3. Configuração não chama /admin/logs", async () => {
      assert.equal(logsRequested.length, 0);
    });

    await check("4. entrar em Atividade dispara o carregamento (1 fetch por pessoa única, não por vínculo)", async () => {
      await enterActivity();
      assert.equal(await ev("$('sq-view-activity').hidden"), false);
      assert.equal(await ev("$('sq-view-config').hidden"), true);
      // 5 pessoas únicas (Pedro, Micael, Gustavo, Fernando, Helena) × 2 consultas cada.
      assert.equal(logsRequested.length, 10, `esperava 10 consultas (5 pessoas × 2), veio ${logsRequested.length}`);
    });

    await check("8. multi-Squad não duplica request da mesma pessoa (Pedro está em 2 Squads, só 2 chamadas)", async () => {
      const pedroCalls = logsRequested.filter(qs => new URLSearchParams(qs).get("user_id") === "10");
      assert.equal(pedroCalls.length, 2, `Pedro pertence a 2 Squads mas deveria gerar só 2 chamadas (recentes+falhas), veio ${pedroCalls.length}`);
    });

    await check("5/6. vários Squads aparecem simultaneamente, cada um com seus próprios membros", async () => {
      const cards = await ev("Array.from(document.querySelectorAll('.sq-activity-card')).map(c => c.querySelector('h3').textContent)");
      assert.deepEqual(cards.sort(), ["Squad Alfa", "Squad Beta", "Squad Vazio"]);
      const alfaPeople = await ev(`(function(){
        var card = Array.from(document.querySelectorAll('.sq-activity-card')).find(c => c.querySelector('h3').textContent === 'Squad Alfa');
        return Array.from(card.querySelectorAll('.sq-activity-card-person-name')).map(n => n.textContent);
      })()`);
      assert.deepEqual(alfaPeople.sort(), ["Fernando Lima", "Gustavo Souza", "Micael Almeida", "Pedro Gabriel"]);
      const betaPeople = await ev(`(function(){
        var card = Array.from(document.querySelectorAll('.sq-activity-card')).find(c => c.querySelector('h3').textContent === 'Squad Beta');
        return Array.from(card.querySelectorAll('.sq-activity-card-person-name')).map(n => n.textContent);
      })()`);
      assert.deepEqual(betaPeople, ["Pedro Gabriel"]);
    });

    await check("7. Pedro (multi-Squad) aparece no card do Squad Alfa E no card do Squad Beta", async () => {
      const emAmbos = await ev(`Array.from(document.querySelectorAll('.sq-activity-card')).filter(c => c.textContent.includes('Pedro Gabriel')).length`);
      assert.equal(emAmbos, 2);
    });

    await check("10. resumo do Squad Alfa correto (Hoje)", async () => {
      const texto = await ev(`Array.from(document.querySelectorAll('.sq-activity-card')).find(c => c.querySelector('h3').textContent === 'Squad Alfa').textContent`);
      assert.match(texto, /4 membros/);
      assert.match(texto, /3 com atividade/);
      assert.match(texto, /7 eventos/);
      assert.match(texto, /2 falhas/);
    });

    await check("11. Fernando (sem eventos hoje) aparece como 'Sem atividade no período', não 'Inativo'", async () => {
      const texto = await ev(`Array.from(document.querySelectorAll('.sq-activity-card')).find(c => c.querySelector('h3').textContent === 'Squad Alfa').textContent`);
      assert.match(texto, /Fernando Lima[\s\S]*Sem atividade no período/);
      assert.doesNotMatch(texto, /Inativo/);
    });

    await check("resumo global discreto soma todas as pessoas únicas (não duplica Pedro)", async () => {
      const texto = await ev("$('sq-activity-global-summary').textContent");
      assert.match(texto, /3 Squads/);
      assert.match(texto, /5 pessoas/); // Pedro, Micael, Gustavo, Fernando, Helena — sem duplicar Pedro
    });

    await check("9. período é global — 7 dias recalcula todos os cards juntos", async () => {
      const antes = logsRequested.length;
      await click('[data-action="activity-period"][data-period="7d"]');
      await activitySettled();
      const novas = logsRequested.slice(antes);
      assert.equal(novas.length, 10, "trocar o período deve recarregar as 5 pessoas únicas de novo");
      assert.ok(novas.every(qs => new URLSearchParams(qs).get("de") !== todayStr()), "de deveria refletir 7 dias atrás, não hoje");
      const texto = await ev("$('sq-activity-global-summary').textContent");
      assert.match(texto, /5 pessoas/);
      await click('[data-action="activity-period"][data-period="hoje"]');
      await activitySettled();
    });

    await check("12. busca por pessoa mantém visíveis os Squads onde ela está (Pedro → Alfa e Beta, não Vazio)", async () => {
      await ev(`document.getElementById('sq-activity-search').value='pedro'; document.getElementById('sq-activity-search').dispatchEvent(new Event('input'))`);
      const cards = await ev("Array.from(document.querySelectorAll('.sq-activity-card')).map(c => c.querySelector('h3').textContent)");
      assert.deepEqual(cards.sort(), ["Squad Alfa", "Squad Beta"]);
      const destacado = await ev("Boolean(document.querySelector('.sq-activity-card-person.is-match'))");
      assert.equal(destacado, true, "Pedro deveria estar destacado (is-match) nos cards");
    });

    await check("13. busca por Squad mostra só aquele Squad", async () => {
      await ev(`document.getElementById('sq-activity-search').value='Vazio'; document.getElementById('sq-activity-search').dispatchEvent(new Event('input'))`);
      const cards = await ev("Array.from(document.querySelectorAll('.sq-activity-card')).map(c => c.querySelector('h3').textContent)");
      assert.deepEqual(cards, ["Squad Vazio"]);
      await ev(`document.getElementById('sq-activity-search').value=''; document.getElementById('sq-activity-search').dispatchEvent(new Event('input'))`);
    });

    await check("busca não dispara nova requisição (client-side)", async () => {
      const antes = logsRequested.length;
      await ev(`document.getElementById('sq-activity-search').value='gustavo'; document.getElementById('sq-activity-search').dispatchEvent(new Event('input'))`);
      await sleep(60);
      assert.equal(logsRequested.length, antes);
      await ev(`document.getElementById('sq-activity-search').value=''; document.getElementById('sq-activity-search').dispatchEvent(new Event('input'))`);
    });

    await check("14/15. clique em pessoa abre o drawer com a timeline correta dela", async () => {
      await click('.sq-activity-card-person[data-uid="10"]');
      await waitFor(cdp, "$('sq-person-drawer').classList.contains('is-open')", "drawer não abriu");
      assert.equal(await ev("$('sq-person-drawer-title').textContent"), "Pedro Gabriel");
      const subtitulo = await ev("$('sq-person-drawer-subtitle').textContent");
      assert.match(subtitulo, /Squad Alfa/);
      assert.match(subtitulo, /Squad Beta/);
      const timeline = await ev("$('sq-person-drawer-timeline').textContent");
      assert.match(timeline, /Criou cliente/);
      assert.doesNotMatch(timeline, /Micael|Gustavo|Fernando/, "timeline do drawer deve conter só eventos do Pedro");
    });

    await check("filtro de status do drawer é client-side (sem nova request)", async () => {
      const antes = logsRequested.length;
      await ev(`document.getElementById('sq-person-drawer-status').value='falha'; document.getElementById('sq-person-drawer-status').dispatchEvent(new Event('change'))`);
      const itens = await ev("Array.from(document.querySelectorAll('#sq-person-drawer-timeline .vf-tag')).map(e => e.textContent)");
      assert.ok(itens.length > 0 && itens.every(t => t === "Falha"));
      assert.equal(logsRequested.length, antes);
      await ev(`document.getElementById('sq-person-drawer-status').value='all'; document.getElementById('sq-person-drawer-status').dispatchEvent(new Event('change'))`);
      await click("#sq-person-drawer-close");
      await waitFor(cdp, "!$('sq-person-drawer').classList.contains('is-open')", "drawer não fechou");
    });

    await check("erro no /admin/logs mostra retry; retry recupera", async () => {
      fail = { path: "/admin/logs" };
      await click('[data-action="activity-period"][data-period="30d"]');
      await activitySettled();
      assert.equal(await ev("$('sq-activity-state-error').hidden"), false);
      assert.equal(await ev("$('sq-activity-grid').hidden"), true);
      fail = null;
      await click('[data-action="activity-retry"]');
      await activitySettled();
      assert.equal(await ev("$('sq-activity-state-error').hidden"), true);
      assert.match(await ev("$('sq-activity-global-summary').textContent"), /5 pessoas/);
      await click('[data-action="activity-period"][data-period="hoje"]');
      await activitySettled();
    });

    await check("16. resposta stale não contamina o período atual (troca rápida hoje→7d→30d)", async () => {
      await click('[data-action="activity-period"][data-period="7d"]');
      await sleep(4); // não espera resolver — dispara a próxima troca antes
      await click('[data-action="activity-period"][data-period="30d"]');
      await activitySettled();
      assert.equal(await ev("STATE.activityView.period"), "30d");
      const pessoas = await ev(`Array.from(document.querySelectorAll('.sq-activity-card')).find(c => c.querySelector('h3').textContent === 'Squad Alfa').textContent`);
      assert.match(pessoas, /Fernando Lima[\s\S]*1 evento/, "período final deve ser 30 dias (Fernando tem 1 evento há 10 dias)");
      await click('[data-action="activity-period"][data-period="hoje"]');
      await activitySettled();
    });

    await check("2. voltar para Configuração fecha o drawer se estava aberto e some com a Atividade", async () => {
      await click('.sq-activity-card-person[data-uid="10"]');
      await waitFor(cdp, "$('sq-person-drawer').classList.contains('is-open')", "drawer não abriu de novo");
      await click("#sq-mode-config");
      assert.equal(await ev("$('sq-view-config').hidden"), false);
      assert.equal(await ev("$('sq-view-activity').hidden"), true);
      assert.equal(await ev("$('sq-person-drawer').classList.contains('is-open')"), false);
    });

    await check("18. modo Configuração continua funcionando (seleção de Squad, Pessoas, Clientes)", async () => {
      await click('.sq-row[data-id="1"]'); await settled();
      assert.equal(await ev("$('sq-detail-title').textContent"), "Squad Alfa");
      assert.equal(await ev("document.querySelectorAll('.sq-person').length"), 4);
    });

    await check("nenhum erro JS não tratado durante todo o fluxo", async () => {
      assert.deepEqual(errors, []);
    });

    await check("QA visual: 1920/1440 mostram Squads lado a lado (2+ colunas)", async () => {
      await enterActivity();
      for (const width of [1920, 1440]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
        await sleep(60);
        const colunas = await ev("new Set(Array.from(document.querySelectorAll('.sq-activity-card')).map(c => c.getBoundingClientRect().top)).size");
        assert.ok(colunas <= 2, `esperava os 3 cards distribuídos em no máx. 2 linhas (lado a lado) em ${width}px, vieram ${colunas} linhas`);
        assert.ok(await ev("document.documentElement.scrollWidth <= window.innerWidth"), `overflow horizontal em ${width}px`);
        if (screenshotsDir) { const img = await cdp.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(screenshotsDir, `activity-${width}.png`), Buffer.from(img.data, "base64")); }
      }
    });

    await check("QA visual: 1024px mantém ao menos 2 colunas quando cabe", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false });
      await sleep(60);
      const largura = await ev("document.querySelector('.sq-activity-card').getBoundingClientRect().width");
      const containerWidth = await ev("document.getElementById('sq-activity-grid').getBoundingClientRect().width");
      assert.ok(largura < containerWidth * 0.7, "card não deveria ocupar a largura inteira em 1024px");
      assert.ok(await ev("document.documentElement.scrollWidth <= window.innerWidth"), "overflow horizontal em 1024px");
      if (screenshotsDir) { const img = await cdp.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(screenshotsDir, "activity-1024.png"), Buffer.from(img.data, "base64")); }
    });

    await check("17. mobile (390px) vira uma coluna", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
      await sleep(60);
      const cols = await ev("getComputedStyle(document.getElementById('sq-activity-grid')).gridTemplateColumns.split(' ').length");
      assert.equal(cols, 1);
      assert.ok(await ev("document.documentElement.scrollWidth <= window.innerWidth"), "overflow horizontal em 390px");
      if (screenshotsDir) { const img = await cdp.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(screenshotsDir, "activity-390.png"), Buffer.from(img.data, "base64")); }
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    });

    /* ═════════════════ NÃO-ADMIN ═════════════════ */
    reset();
    const logsAntesDoNaoAdmin = logsRequested.length;
    await switchToNonAdmin();

    await check("2. não-admin não vê o modo Atividade", async () => {
      assert.equal(await ev("$('sq-mode-activity').hidden"), true);
    });

    await check("3. não-admin nunca dispara GET /admin/logs, mesmo tentando via hash", async () => {
      await ev(`location.hash = '#activity'`);
      await cdp.send("Page.reload");
      await waitFor(cdp, "typeof STATE !== 'undefined' && !STATE.refreshing", "reload não-admin com hash falhou");
      assert.equal(await ev("STATE.view"), "config");
      assert.equal(logsRequested.length, logsAntesDoNaoAdmin, "nenhuma nova consulta a /admin/logs deveria ocorrer para não-admin");
    });

    console.log(`\n✓ ${checks} verificações de Atividade dos Squads (comparação)`);
  } finally {
    if (cdp) cdp.close();
    chrome.kill("SIGTERM");
    server.close();
  }
}

run().catch(err => { console.error(err); process.exitCode = 1; });
