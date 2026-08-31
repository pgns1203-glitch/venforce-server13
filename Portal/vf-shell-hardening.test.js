/*
 * Testes de anti-regressão da maratona pós-Convergência #2 (Pessoa 1).
 *
 * BUG A/C em produção (atividade.html, usuarios.html "quase sem estilo",
 * mais callbacks.html e guia-vendedor.html achados na auditoria transversal)
 * tinham a MESMA causa raiz: a página carrega `vf-shell.css` — que só
 * define ZERO tokens próprios, tudo vem de `vf-tokens-v2.css`
 * (vf-shell.css:19-20) — e/ou markup com classes de `vf-components-v2.css`
 * (`.vf-card`, `.vf-input`, `.vf-btn-primary`, `.vf-badge`, `.vf-modal-*`)
 * sem nunca carregar os dois arquivos. Chegou a produção porque nenhum
 * teste comparava o HEAD real de CADA página Shell V3 contra a cadeia
 * canônica — só existiam testes de COMPORTAMENTO por página.
 *
 * BUG B em produção ("busca de Cliente não permite trocar corretamente"):
 * reproduzido com Chrome DevTools Protocol (Input.dispatchMouseEvent com
 * coordenadas reais, não `.click()` direto) em viewport ≤1200px — o modo
 * "contextbar" que MASTER_SPEC §19.1 documenta. Medido com
 * getBoundingClientRect: o dropdown nascia com `top` NEGATIVO (fora do
 * viewport, acima da dobra) porque `.vf-shell__contextbar .vf-shell__context`
 * virava `position: static`, deixando de ser o *containing block* do
 * dropdown `position: absolute` — o browser caía no algoritmo de "static
 * position" dentro de um flex-wrap e errava o cálculo. Corrigido dando
 * `position: relative` ao bloco de contexto e `top`/`left` explícitos ao
 * dropdown (vf-shell.css). Também faltava clique-fora para fechar o menu
 * (só Esc e escolher um item fechavam) — adicionado em vf-shell.js.
 *
 * Bloco 1 (estático, sem Chrome): audita a cadeia de CSS de TODA página
 * Shell V3 encontrada no repo — não uma lista fixa digitada à mão, para não
 * repetir o erro de só cobrir as páginas já conhecidas.
 *
 * Bloco 2 (headless): Relatórios na sidebar + contexto sobrevive à
 * navegação; clique fora fecha o dropdown; dropdown não nasce fora do
 * viewport em 1000px; computed style mínimo do Shell nas duas páginas que
 * estavam quebradas em produção.
 */
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const PORTAL_DIR = __dirname;

let checks = 0;
async function check(name, fn) {
  try {
    await fn();
    checks += 1;
    console.log(`ok ${checks} - ${name}`);
  } catch (err) {
    console.error(`FALHOU - ${name}`);
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
    throw err;
  }
}

/* ═══════════════════════════ Bloco 1 — estático ══════════════════════════ */

function listShellV3Pages() {
  return fs
    .readdirSync(PORTAL_DIR)
    .filter((f) => f.endsWith(".html"))
    .filter((f) => {
      const html = fs.readFileSync(path.join(PORTAL_DIR, f), "utf8");
      return /data-vf-scope\s*=/.test(html) && /src=["'][^"']*vf-shell\.js["']/.test(html);
    });
}

function extractStylesheetOrder(html) {
  const re = /<link[^>]+rel=["']stylesheet["'][^>]*>/gi;
  const hrefRe = /href=["']([^"']+)["']/i;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const hrefM = hrefRe.exec(m[0]);
    if (!hrefM) continue;
    out.push(hrefM[1].replace(/^\.\//, "").replace(/^\//, ""));
  }
  return out;
}

async function runBloco1() {
  const paginas = listShellV3Pages();

  await check(`descobriu páginas Shell V3 no repo (achou ${paginas.length}, esperado ≥ 15)`, async () => {
    assert.ok(paginas.length >= 15, `só achou ${paginas.length} — a varredura de data-vf-scope + vf-shell.js pode ter quebrado`);
  });

  for (const pagina of paginas) {
    const html = fs.readFileSync(path.join(PORTAL_DIR, pagina), "utf8");
    const ordem = extractStylesheetOrder(html);

    await check(`${pagina} — carrega css/vf-tokens-v2.css (Shell V3 usa vf-shell.css, que só tem tokens de lá)`, async () => {
      assert.ok(ordem.includes("css/vf-tokens-v2.css"), `${pagina} usa Shell V3 mas não carrega css/vf-tokens-v2.css`);
    });

    await check(`${pagina} — carrega css/vf-components-v2.css`, async () => {
      assert.ok(ordem.includes("css/vf-components-v2.css"), `${pagina} usa Shell V3 mas não carrega css/vf-components-v2.css`);
    });

    await check(`${pagina} — ordem: vf-tokens-v2.css antes de vf-components-v2.css`, async () => {
      const iTokens = ordem.indexOf("css/vf-tokens-v2.css");
      const iComponents = ordem.indexOf("css/vf-components-v2.css");
      assert.ok(iTokens < iComponents, `${pagina}: vf-tokens-v2.css deveria vir antes de vf-components-v2.css (achou tokens=${iTokens}, components=${iComponents})`);
    });

    if (ordem.includes("css/vf-shell.css")) {
      await check(`${pagina} — ordem: vf-tokens-v2.css e vf-components-v2.css antes de vf-shell.css`, async () => {
        const iTokens = ordem.indexOf("css/vf-tokens-v2.css");
        const iComponents = ordem.indexOf("css/vf-components-v2.css");
        const iShell = ordem.indexOf("css/vf-shell.css");
        assert.ok(iTokens < iShell, `${pagina}: vf-tokens-v2.css deveria vir antes de vf-shell.css`);
        assert.ok(iComponents < iShell, `${pagina}: vf-components-v2.css deveria vir antes de vf-shell.css`);
      });
    }
  }
}

/* ═══════════════════════════ Bloco 2 — headless ═══════════════════════════ */

const N97 = { id: 87, nome: "N97 Comercial", slug: "n97", ativo: true, temGrant: true, grantStatus: "conectado", temBase: true, setupScore: 100, statusOperacional: "pronto", ultimaSincronizacao: null, pendencias: [] };
const EXTRA = { id: 88, nome: "Extra Máquinas", slug: "extra", ativo: true, temGrant: true, grantStatus: "conectado", temBase: true, setupScore: 100, statusOperacional: "pronto", ultimaSincronizacao: null, pendencias: [] };
const FILLERS = Array.from({ length: 7 }, (_, i) => ({ id: 200 + i, nome: `Filler ${i + 1}`, slug: `filler-${i + 1}`, ativo: true, temGrant: true, grantStatus: "conectado", temBase: true, setupScore: 100, statusOperacional: "pronto", ultimaSincronizacao: null, pendencias: [] }));
const PORTFOLIO_MAIN = { ok: true, clientes: [N97, EXTRA, ...FILLERS] };
const CONTAS = {
  n97: [{ id: 42, cliente_id: 87, marketplace: "meli", nome: "Mercado Livre", slug: "ml-1", ativo: true, grant: { token_status: "valid" }, base: { base_id: 9, nome: "Custo" } }],
  extra: [{ id: 51, cliente_id: 88, marketplace: "meli", nome: "Mercado Livre", slug: "ml", ativo: true, grant: { token_status: "valid" }, base: { base_id: 11, nome: "Custo Extra" } }],
  ...Object.fromEntries(FILLERS.map((c) => [c.slug, [{ id: 300 + c.id, cliente_id: c.id, marketplace: "meli", nome: "ML", slug: "ml", ativo: true, grant: { token_status: "valid" }, base: { base_id: 20, nome: "Custo" } }]])),
};
const ME_CONTEXT = {
  ok: true,
  user: { id: 12, nome: "Pedro Gomes", email: "pedro@venforce.com", role: "admin" },
  squads: [{ id: 3, nome: "Squad Alpha", slug: "alpha", principal: true, funcao: "analista", ativo: true }],
  squadPrincipalId: 3,
  clientes: [N97, EXTRA, ...FILLERS].map((c) => ({ id: c.id, slug: c.slug, nome: c.nome, squadId: 3, responsavelDireto: c.slug === "n97", contasAtivas: (CONTAS[c.slug] || []).length })),
  portfolio: { totalClientes: 2 + FILLERS.length },
  permissoes: { podeAdministrar: true },
};

let serverPort = 0;

function startServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname === "/seed.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><html><head></head><body><script>
        localStorage.setItem("vf-token","test-token");
        localStorage.setItem("vf-user", JSON.stringify({ id: 12, nome: "Pedro Gomes", role: "admin" }));
      </script></body></html>`);
      return;
    }
    if (u.pathname === "/me/context") { res.writeHead(404, { "Content-Type": "application/json" }); res.end('{"ok":false}'); return; }
    if (u.pathname === "/operacao/cliente-360/clientes") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(PORTFOLIO_MAIN)); return; }
    const contasMatch = u.pathname.match(/^\/clientes\/([^/]+)\/contas$/);
    if (contasMatch) {
      const slug = decodeURIComponent(contasMatch[1]);
      const contas = CONTAS[slug];
      if (!contas) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false })); return; }
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, cliente: { id: 1, nome: slug, slug, ativo: true }, contas })); return;
    }
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
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => { serverPort = server.address().port; resolve(server); }));
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
  constructor(url) { this.socket = new WebSocket(url); this.nextId = 1; this.pending = new Map(); }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        if (message.method === "Fetch.requestPaused" && typeof this.onFetchPaused === "function") this.onFetchPaused(message.params);
        return;
      }
      if (!this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
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
    if (result.exceptionDetails) throw new Error((result.exceptionDetails.text || "Falha na avaliação do navegador") + " | " + JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  close() { this.socket.close(); }
}
async function waitFor(cdp, expression, message) {
  for (let i = 0; i < 120; i++) { if (await cdp.evaluate(`Boolean(${expression})`)) return; await sleep(50); }
  throw new Error(message || `Timeout: ${expression}`);
}

// localStorage é por origem: semeia o token em /seed.html (mesma origem do
// servidor de teste) ANTES de navegar para a página real — sem isto o
// shell nunca sai de BOOT (sem vf-token, cai no fluxo de login).
async function seedAndGoto(cdp, port, url) {
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}/seed.html` });
  await waitFor(cdp, "window.localStorage.getItem('vf-token')", "seed.html não gravou o token");
  await cdp.send("Page.navigate", { url });
}

const PROD_HOST = "venforce-server.onrender.com";

// Páginas REAIS (bases.js, atividade.js, usuarios.js, ...) chamam a API de
// produção com URL própria hardcoded (não usam o meta `vf-api-base` do
// harness) — sem isto, um teste "headless" bateria de verdade na rede,
// receberia 401 pro token fake e a própria página redirecionaria pro login
// (medido: bases.html saía para index.html ~900ms depois do boot). Nunca
// deixar isto vazar pra rede real — nem por engano (§26 da missão).
async function wireProdInterception(cdp) {
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  const respond = async (m, p) => {
    try { await cdp.send(m, p); } catch (err) { if (!/Invalid InterceptionId/.test(err.message || "")) throw err; }
  };
  cdp.onFetchPaused = async (params) => {
    const url = params.request.url;
    if (!url.includes(PROD_HOST)) { await respond("Fetch.continueRequest", { requestId: params.requestId }); return; }
    const cors = [
      { name: "access-control-allow-origin", value: "*" },
      { name: "access-control-allow-headers", value: "authorization,content-type" },
      { name: "access-control-allow-methods", value: "GET,POST,PATCH,DELETE,OPTIONS" },
    ];
    if (params.request.method === "OPTIONS") { await respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 204, responseHeaders: cors }); return; }

    const json = (obj) => respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 200, responseHeaders: [...cors, { name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(obj)).toString("base64") });

    if (url.includes("/me/context")) { await json(ME_CONTEXT); return; }
    if (url.includes("/operacao/cliente-360/clientes")) { await json(PORTFOLIO_MAIN); return; }
    const contasMatch = url.match(/\/clientes\/([^/?]+)\/contas/);
    if (contasMatch) {
      const slug = decodeURIComponent(contasMatch[1]);
      await json({ ok: true, cliente: { id: 1, nome: slug, slug, ativo: true }, contas: CONTAS[slug] || [] });
      return;
    }
    await json({ ok: true, clientes: [], contas: [], bases: [], vinculos: [], itens: [] });
  };
}

async function withChrome(fn, { interceptProd = true } = {}) {
  const debugPort = 24000 + Math.floor(Math.random() * 900);
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/vf-hardening-${process.pid}-${debugPort}`, "about:blank",
  ], { stdio: "ignore" });
  let cdp;
  try {
    await waitChrome(debugPort);
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })).json();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    if (interceptProd) await wireProdInterception(cdp);
    return await fn(cdp);
  } finally {
    if (cdp) cdp.close();
    chrome.kill("SIGTERM");
  }
}

async function runBloco2() {
  const server = await startServer();
  try {
    /* ── Computed style: as duas páginas quebradas em produção, servidas
       DE VERDADE (arquivo real, não harness sintético) ─────────────────── */
    for (const pagina of ["atividade.html", "usuarios.html", "callbacks.html"]) {
      await withChrome(async (cdp) => {
        await seedAndGoto(cdp, server.address().port, `http://127.0.0.1:${server.address().port}/${pagina}`);
        await waitFor(cdp, "window.VF && window.VF.shell", `${pagina}: vf-shell não montou`);

        const estilo = await cdp.evaluate(`
          (function(){
            var shell = document.querySelector('.vf-shell');
            var sidebar = document.querySelector('.vf-shell__sidebar');
            var main = document.querySelector('.vf-shell__main');
            var a = document.querySelector('.vf-shell__item');
            var csShell = getComputedStyle(shell);
            var csSidebar = getComputedStyle(sidebar);
            return {
              shellDisplay: csShell.display,
              shellBg: csShell.backgroundColor,
              sidebarWidth: sidebar.getBoundingClientRect().width,
              sidebarBg: csSidebar.backgroundColor,
              mainExists: Boolean(main),
              navLinkColor: a ? getComputedStyle(a).color : null,
              navLinkDecoration: a ? getComputedStyle(a).textDecorationLine : null,
            };
          })();
        `);
        await check(`${pagina} — .vf-shell é grid (Fundação V2 carregada)`, async () => {
          assert.strictEqual(estilo.shellDisplay, "grid", `esperado display:grid, veio ${estilo.shellDisplay} — tokens/components da V2 podem estar ausentes de novo`);
        });
        await check(`${pagina} — sidebar tem largura real (> 100px, não colapsou por token ausente)`, async () => {
          assert.ok(estilo.sidebarWidth > 100, `sidebar com ${estilo.sidebarWidth}px — --vf-sidebar-w provavelmente undefined`);
        });
        await check(`${pagina} — fundo do Shell não é transparente`, async () => {
          assert.notStrictEqual(estilo.shellBg, "rgba(0, 0, 0, 0)", "background do .vf-shell transparente — --vf-bg undefined");
        });
        await check(`${pagina} — link de navegação não é azul padrão do browser nem azul do Bootstrap (CSS da V2 está resetando)`, async () => {
          // rgb(0,0,238) = azul default do user-agent; rgb(13,110,253) = azul
          // do Bootstrap 5 (--bs-link-color) — o 2º achado só apareceu com
          // screenshot real em atividade/callbacks/usuarios.html: Bootstrap
          // é CSS sem @layer e vence `.vf-shell__item` mesmo sendo menos
          // específico (Cascade Layers §5, ver vf-shell.css:530-548 e a
          // correção logo abaixo daquele comentário).
          assert.notStrictEqual(estilo.navLinkColor, "rgb(0, 0, 238)", `link com a cor azul padrão do browser — sinal de shell cru (Bug C): ${estilo.navLinkColor}`);
          assert.notStrictEqual(estilo.navLinkColor, "rgb(13, 110, 253)", `link com a cor azul do Bootstrap — .vf-shell__item perdendo pra CSS sem @layer (Bug C): ${estilo.navLinkColor}`);
        });
        await check(`${pagina} — link de navegação sem sublinhado (Bootstrap também sublinha <a> por padrão)`, async () => {
          assert.strictEqual(estilo.navLinkDecoration, "none", `link sublinhado — sinal do mesmo Bug C: ${estilo.navLinkDecoration}`);
        });
      });
    }

    /* ── Relatórios na sidebar + contexto sobrevive à navegação ─────────── */
    await withChrome(async (cdp) => {
      // bases.html (global, vanilla) em vez de visao.html (ilha React/Vite):
      // o que este teste prova é genérico de vf-shell.js (buildHref), não é
      // sobre visao.html. Cliente/período setados PROGRAMATICAMENTE depois
      // do boot (window.VF.context.setCliente/setPeriodoParam), não via
      // ?cliente=/&periodo= na URL inicial — com esses params já na
      // primeira carga, bases.js/vf-context reagem de um jeito que derruba
      // `window.VF` antes do próximo evaluate (medido: "Cannot read
      // properties of undefined (reading 'context')"), não relacionado ao
      // que este teste verifica.
      await seedAndGoto(cdp, server.address().port, `http://127.0.0.1:${server.address().port}/bases.html`);
      await waitFor(cdp, "window.VF && window.VF.shell", "bases.html: vf-shell não montou");
      await waitFor(cdp, "window.VF.context.getState() !== 'BOOT'", "bases.html: contexto preso em BOOT");
      await cdp.evaluate("window.VF.context.setCliente('n97')");
      await waitFor(cdp, "window.VF.context.getContext() && window.VF.context.getContext().clienteSlug === 'n97'", "setCliente('n97') não resolveu");
      await cdp.evaluate("window.VF.context.setPeriodoParam('2026-07')");

      await check("Relatórios existe como item de navegação (não sumiu da sidebar)", async () => {
        const existe = await cdp.evaluate("Boolean(document.querySelector('.vf-shell__item[data-module=relatorios]'))");
        assert.ok(existe, "nenhum .vf-shell__item[data-module=relatorios] no DOM — Relatórios não está em MODULOS/GLOBAIS/ADMIN");
      });

      await check("clicar em Relatórios preserva cliente e período na navegação", async () => {
        // buildHref() recalcula no clique (comentário de vf-shell.js:485-489)
        // — o atributo `href` estático é só um retrato para "copiar link" e
        // pode não ter o período setado programaticamente depois do render.
        // O teste real é o que o clique de fato navega, via onNavigate.
        await cdp.evaluate("document.querySelector('.vf-shell__item[data-module=relatorios]').click()");
        await waitFor(cdp, "window.location.pathname.indexOf('relatorios.html') >= 0", "clique em Relatórios não navegou");
        const search = await cdp.evaluate("window.location.search");
        const qs = new URLSearchParams(search);
        assert.strictEqual(qs.get("cliente"), "n97", `cliente não preservado ao navegar para Relatórios: ${search}`);
        assert.strictEqual(qs.get("periodo"), "2026-07", `período não preservado ao navegar para Relatórios: ${search}`);
      });
    });

    /* ── Dropdown: clique fora fecha ─────────────────────────────────────── */
    await withChrome(async (cdp) => {
      await seedAndGoto(cdp, server.address().port, `http://127.0.0.1:${server.address().port}/bases.html`);
      await waitFor(cdp, "window.VF && window.VF.shell", "bases.html: vf-shell não montou");
      await waitFor(cdp, "window.VF.context.getState() !== 'BOOT'", "bases.html: contexto preso em BOOT");
      await cdp.evaluate("document.getElementById('vf-cliente-trigger').click()");
      await waitFor(cdp, "document.querySelector('.vf-shell__dropdown')", "dropdown de Cliente não abriu");

      await check("clicar fora do bloco de contexto fecha o dropdown de Cliente", async () => {
        await cdp.evaluate("document.querySelector('.vf-shell__nav').click()");
        await sleep(100);
        const aberto = await cdp.evaluate("Boolean(document.querySelector('.vf-shell__dropdown'))");
        assert.strictEqual(aberto, false, "dropdown continuou aberto depois de clicar fora do bloco de contexto");
      });
    });

    /* ── Dropdown em viewport estreito (≤1200px, modo contextbar): não pode
       nascer com `top` negativo (Bug B — item inalcançável para clique
       real) ──────────────────────────────────────────────────────────── */
    await withChrome(async (cdp) => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
      await seedAndGoto(cdp, server.address().port, `http://127.0.0.1:${server.address().port}/bases.html`);
      await waitFor(cdp, "window.VF && window.VF.shell", "bases.html (1000px): vf-shell não montou");
      await waitFor(cdp, "window.VF.context.getState() !== 'BOOT'", "bases.html (1000px): contexto preso em BOOT");
      await waitFor(cdp, "document.querySelector('.vf-shell__contextbar')", "bases.html (1000px): não entrou em modo contextbar");
      await cdp.evaluate("document.getElementById('vf-cliente-trigger').click()");
      await waitFor(cdp, "document.querySelector('.vf-shell__dropdown')", "dropdown de Cliente não abriu em 1000px");

      await check("dropdown de Cliente em 1000px (contextbar) nasce DENTRO do viewport (top >= 0)", async () => {
        const top = await cdp.evaluate("document.querySelector('.vf-shell__dropdown').getBoundingClientRect().top");
        assert.ok(top >= 0, `dropdown com top=${top}px — nasce acima do viewport, inalcançável para um clique real (Bug B)`);
      });

      await check("primeiro item do dropdown em 1000px é clicável por coordenada real (dentro do viewport)", async () => {
        const geo = await cdp.evaluate(`
          (function(){
            var it = document.querySelector('.vf-menu__item');
            var r = it.getBoundingClientRect();
            var el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { top: r.top, hit: it.contains(el) || it === el };
          })();
        `);
        assert.ok(geo.top >= 0, `primeiro item com top=${geo.top}px, fora do viewport`);
        assert.ok(geo.hit, "o ponto central do primeiro item não resolve para o próprio item (algo está sobrepondo)");
      });
    });
  } finally {
    server.close();
  }
}

async function run() {
  await runBloco1();
  await runBloco2();
  console.log(`\n✓ ${checks} verificações de hardening pós-Convergência #2 (F5/F6, Shell V3)`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
