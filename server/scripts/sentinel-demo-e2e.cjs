// E2E do Sentinel contra a DEMO LOCAL (seed + servidor rodando). Uso:
//   node server/scripts/sentinel-demo-seed.js && node server/scripts/sentinel-demo-server.js &
//   PLAYWRIGHT_CORE=/caminho/node_modules/playwright-core CHROME=/usr/bin/google-chrome node server/scripts/sentinel-demo-e2e.cjs
// Os caminhos de screenshot vão para o tmpdir. Requer o seed recém-rodado (assume 4/7 incidentes).
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const out = require("os").tmpdir() + "/";
const U = "http://127.0.0.1:8787/sentinel.html";
let falhas = 0;
const ok = (l, c) => { console.log((c ? "  ok  " : "FALHOU ") + l); if (!c) falhas++; };
// Login REAL do Portal (index.html → /auth/login do servidor de demo) e depois a tela no Shell.
const BASE = "http://127.0.0.1:8787/";
async function login(p, email, { paraSentinel = true } = {}) {
  await p.goto(BASE + "index.html");
  await p.waitForSelector("#login-email");
  await p.fill("#login-email", email); await p.fill("#login-senha", "demo1234");
  await p.click("#btn-login");
  // A demo leva a página padrão pós-login (carteira) ao Sentinel: sem abrir sentinel.html à mão.
  if (paraSentinel) await p.waitForURL(/sentinel\.html/, { timeout: 15000 });
  else await p.waitForTimeout(1500);
}
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome" });
  const errs = [];
  const nova = async (vp) => { const c = await b.newContext({ viewport: vp }); const p = await c.newPage();
    p.on("console", (m) => m.type() === "error" && !/fonts\.g|Transition was skipped|ERR_(NAME|INTERNET)|Failed to load resource.*(40[134])/.test(m.text()) && errs.push(m.text()));
    // "Transition was skipped": @view-transition (vf-tokens-v2.css) interrompida pelos goto() do próprio teste.
    p.on("pageerror", (e) => !/Transition was skipped/.test(e.message) && errs.push("PAGEERR " + e.message)); return p; };

  // 1. Ana (Squad Aurora) com backend real
  let p = await nova({ width: 1400, height: 900 });
  await login(p, "ana@demo.test");
  await p.waitForSelector(".sn-row");
  ok("Shell real montado (sidebar)", (await p.$$(".vf-shell__sidebar")).length === 1);
  ok("menu tem Sentinel ativo", (await p.$$eval('.vf-shell__item[data-module="sentinel"]', (e) => e.length && /sentinel/i.test(e[0].textContent))));
  ok("sem selo de demo com backend", await p.$eval("#sn-demo-seal", (e) => e.hidden));
  ok("sem script de mock com backend", (await p.$$("script[src='sentinel-mock.js']")).length === 0);
  ok("Ana vê só 4 incidentes (carteira Aurora)", (await p.$$(".sn-row")).length === 4);
  const squads = await p.$$eval("#sn-f-squad option", (o) => o.map((x) => x.textContent));
  ok("filtro de squad só tem Aurora", squads.length === 2 && squads[1].includes("Aurora"));
  const txt = await p.textContent("body");
  ok("Gama/Delta (outro Squad) não aparecem", !/Casa Exemplo Gama|Mercado Teste Delta|Epsilon/.test(txt));
  ok("receita sem custo rotulada 'não é prejuízo'", /não é prejuízo/.test(txt));
  ok("nunca 'confirmada' p/ calculado", !/confirmad[ao]/i.test(await p.textContent("#sn-painel")));
  await p.screenshot({ path: out + "int-fila.png" });
  // filtro tipo
  await p.selectOption("#sn-f-tipo", "custo_pendente"); await p.waitForTimeout(500);
  ok("filtro tipo=custo_pendente", (await p.$$(".sn-row")).length === 1);
  await p.click("#sn-clear"); await p.waitForSelector(".sn-row");
  // drawer, reconhecer, resolver
  await p.click(".sn-row >> nth=0"); await p.waitForSelector("#sn-reconhecer");
  ok("drawer mostra pedidos e histórico", (await p.textContent("#sn-drawer-body")).includes("Histórico") && (await p.$$("#sn-drawer-body table tbody tr")).length > 0);
  const hrefs = await p.$$eval("#sn-drawer-foot a", (a) => a.map((x) => x.getAttribute("href")));
  ok("drawer: link da Central leva cliente+conta+mlb; Bases leva cliente", /^central-margem\.html\?cliente=[^&]+&conta=\d+(&mlb=MLB-[A-Z0-9-]+)?$/.test(hrefs[0]) && /^bases\.html\?cliente=[^&]+$/.test(hrefs[1]));
  await p.screenshot({ path: out + "int-drawer.png" });
  await p.click("#sn-reconhecer"); await p.waitForFunction(() => document.querySelector("#sn-drawer-sub").textContent.includes("Reconhecido"));
  ok("reconhecer funciona e aparece no histórico", /reconhecido/.test(await p.textContent(".sn-hist")));
  await p.click("#sn-resolver");
  await p.evaluate(() => { document.querySelector("#sn-motivo").removeAttribute("required"); });
  await p.click("#sn-resolver-form button[type=submit]");
  ok("resolver sem motivo é barrado", /motivo/i.test(await p.textContent("#sn-drawer-body")) && !(await p.textContent("#sn-drawer-sub")).includes("Resolvido"));
  await p.fill("#sn-motivo", "Preço ajustado na demo");
  await p.click("#sn-resolver-form button[type=submit]");
  await p.waitForFunction(() => document.querySelector("#sn-drawer-sub").textContent.includes("Resolvido"));
  ok("resolver com motivo", true);
  await p.keyboard.press("Escape");
  await p.click('[data-tab="contas"]');
  ok("aba contas (2 ativas + 1 desativada)", (await p.$$("#sn-painel tbody tr")).length === 3);
  const links = await p.$$eval("#sn-painel a", (a) => a.slice(0, 2).map((x) => x.getAttribute("href")));
  ok("links contextuais", /central-margem\.html\?cliente=.+&conta=\d+/.test(links[0]) && /bases\.html\?cliente=/.test(links[1]));
  // 403/404 por ID fora da carteira, direto na API com token da Ana
  const tk = await p.evaluate(() => localStorage.getItem("vf-token"));
  const r = await p.evaluate(async (t) => (await fetch("/sentinel/incidentes/1", { headers: { Authorization: "Bearer " + t } })).status, tk);
  const r2 = await p.evaluate(async (t) => { const l = await (await fetch("/sentinel/incidentes?conta=103", { headers: { Authorization: "Bearer " + t } })).json(); return l.total; }, tk);
  ok("conta de outro Squad pedida pela query → 0", r2 === 0);
  console.log("  info incidente #1 por Ana:", r);

  // 2. Caio sem Squad → estado vazio
  p = await nova({ width: 1400, height: 900 });
  await login(p, "caio@demo.test");
  await p.waitForSelector("#sn-painel .vf-empty");
  ok("Caio: sem contas na carteira", /Nenhuma conta monitorável/.test(await p.textContent("#sn-painel")));
  await p.screenshot({ path: out + "int-vazio.png" });

  // 3. seller: o Shell manda p/ a área do seller; e a API nega
  p = await nova({ width: 1400, height: 900 });
  await login(p, "vendedor@demo.test", { paraSentinel: false });
  await p.waitForTimeout(1500);
  const tkS = await p.evaluate(() => localStorage.getItem("vf-token"));
  ok("seller não fica no Sentinel", !/sentinel\.html/.test(p.url()));
  ok("API nega seller (403)", (await p.evaluate(async (t) => (await fetch("/sentinel/resumo", { headers: { Authorization: "Bearer " + t } })).status, tkS)) === 403);

  // 3b. papel não interno (shopee_reviewer) nem vê o item no menu; a API nega (403)
  p = await nova({ width: 1400, height: 900 });
  await login(p, "revisor@demo.test");
  await p.waitForSelector(".vf-shell__sidebar");
  ok("shopee_reviewer: sem 'Sentinel' no menu", (await p.$$('.vf-shell__item[data-module="sentinel"]')).length === 0);
  await p.waitForSelector("#sn-retry");
  ok("shopee_reviewer: API nega o acesso", /não tem acesso/.test(await p.textContent("#sn-painel")));
  p = await nova({ width: 1400, height: 900 });
  await login(p, "ana@demo.test");
  await p.waitForSelector(".sn-row");
  ok("interno vê 'Sentinel' no menu", (await p.$$('.vf-shell__item[data-module="sentinel"]')).length === 1);

  // 4. sem sessão: o Shell leva ao login do Portal
  p = await nova({ width: 1400, height: 900 });
  await p.goto(U); await p.waitForTimeout(1500);
  ok("sem token → login do Portal", /index\.html|\/$/.test(new URL(p.url()).pathname));
  p = await nova({ width: 1400, height: 900 });
  await p.goto(BASE + "index.html"); await p.fill("#login-email", "ana@demo.test"); await p.fill("#login-senha", "errada"); await p.click("#btn-login");
  await p.waitForFunction(() => /inv[aá]lida/i.test(document.body.textContent));
  ok("senha errada mostra erro no login do Portal", true);

  // 4a. Conta desativada: Ana (Squad do cliente) vê o incidente com selo; Bia (outro Squad) não
  p = await nova({ width: 1400, height: 900 });
  await login(p, "ana@demo.test");
  await p.waitForSelector(".sn-row");
  await p.selectOption("#sn-f-periodo", "todos"); await p.waitForTimeout(600);
  ok("Ana vê incidente de conta desativada com selo", /conta desativada — não monitorada/.test(await p.textContent("#sn-painel")));
  await p.click('.sn-row:has(.sn-off)'); await p.waitForSelector("#sn-resolver");
  ok("detalhe da conta desativada: aviso + ações humanas disponíveis", /conta desativada/.test(await p.textContent("#sn-drawer-body")) && (await p.$$("#sn-reconhecer")).length === 1);
  await p.keyboard.press("Escape");
  await p.click('[data-tab="contas"]');
  ok("aba Contas: desativada com selo e fora dos 'atrasada'", /Alfa Antiga/.test(await p.textContent("#sn-painel")) && (await p.$$("#sn-painel .sn-off")).length === 1);
  p = await nova({ width: 1400, height: 900 });
  await login(p, "bia@demo.test");
  await p.waitForSelector(".sn-row");
  await p.selectOption("#sn-f-periodo", "todos"); await p.waitForTimeout(600);
  ok("Bia (outro Squad) não vê a conta desativada", !/Alfa Antiga|conta desativada/.test(await p.textContent("body")));

  // 4b. Saúde do monitoramento (F4) — admin enxerga a conta Gama com erro de token
  p = await nova({ width: 1400, height: 900 });
  await login(p, "admin@demo.test");
  await p.waitForSelector(".sn-row");
  ok("banner crítico interno p/ token indisponível", /token ML indispon/i.test(await p.textContent("#sn-banners")) && (await p.$$("#sn-banners [role=alert]")).length >= 1);
  await p.click('[data-tab="saude"]');
  await p.waitForSelector(".sn-worker");
  const sTxt = await p.textContent("#sn-painel");
  ok("saúde: worker ativo + contas + alertas", /Worker Ativo/.test(sTxt) && /Contas monitoradas/.test(sTxt) && /Erro de token/.test(sTxt) && (await p.$$(".sn-alerta")).length >= 2);
  await p.screenshot({ path: out + "int-saude.png" });
  await p.click('[data-alerta-conta="103"]');
  await p.waitForSelector(".sn-row");
  ok("alerta → 'Ver incidentes' filtra pela conta", (await p.$$(".sn-row")).length === 1 && (await p.$eval("#sn-f-conta", (e) => e.value)) === "103");
  // Ana (Aurora): sem alerta de token — as contas dela estão em dia
  p = await nova({ width: 1400, height: 900 });
  await login(p, "ana@demo.test");
  await p.waitForSelector(".sn-row");
  await p.click('[data-tab="saude"]'); await p.waitForSelector(".sn-worker");
  ok("Ana: saúde só do recorte dela (sem Gama/token)", !/Gama|token ML/.test(await p.textContent("#sn-painel")));

  // 5. admin, mobile
  p = await nova({ width: 390, height: 844 });
  await login(p, "admin@demo.test");
  await p.waitForSelector(".sn-row");
  ok("admin vê 7 incidentes", (await p.$$(".sn-row")).length === 7);
  ok("sem overflow horizontal no celular", !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await p.screenshot({ path: out + "int-mobile.png" });
  await p.click(".sn-row >> nth=0"); await p.waitForSelector("#sn-resolver");
  ok("drawer sem overflow no celular", !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await p.screenshot({ path: out + "int-mobile-drawer.png" });

  // 6. demo=1 (sem backend)
  p = await nova({ width: 1400, height: 900 });
  await p.goto(U + "?demo=1"); await p.waitForSelector(".sn-row");
  ok("demo=1 mostra selo", !(await p.$eval("#sn-demo-seal", (e) => e.hidden)));
  await p.click('[data-tab="saude"]'); await p.waitForSelector(".sn-worker");
  ok("demo=1: aba de saúde com dados de exemplo", /Contas monitoradas/.test(await p.textContent("#sn-painel")));
  ok("demo=1 não chama API", true);

  ok("sem erros de console", errs.length === 0);
  if (errs.length) console.log(errs);
  await b.close();
  console.log(falhas ? falhas + " FALHAS" : "E2E OK");
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
