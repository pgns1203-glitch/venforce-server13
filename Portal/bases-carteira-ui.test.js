/* Bases de Custo por cliente (modelo B de Clientes e Contas): lista de
   clientes, um cartão por conta conectada com a base vinculada, cartão
   tracejado para conta sem base, itens da base no próprio painel, busca,
   filtro "Com pendência" e atalho de importação já com cliente e conta.
   Harness copiado da lista de Anúncios ML (Chrome headless + CDP). */
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { URL } = require("url");

const PORTAL_DIR = __dirname;
const PROD_HOST = "venforce-server.onrender.com";

const diasAtras = (n) => new Date(Date.now() - n * 864e5).toISOString();

const PORTFOLIO = {
  ok: true,
  squads: [],
  clientes: [
    { id: 1, slug: "alma", nome: "Alma Cosméticos", squad: { nome: "Squad Fênix" }, contas: [
      { id: 11, marketplace: "meli", nome: "ALMA OFICIAL", external_account_id: "1823349011", ativo: true, baseVinculada: { id: 101 } },
      { id: 12, marketplace: "meli", nome: "ALMA OUTLET", external_account_id: "1904412873", ativo: true, baseVinculada: { id: 102 } },
      { id: 13, marketplace: "shopee", nome: "almacosmeticos", external_account_id: "882301457", ativo: true, baseVinculada: { id: 103 } },
    ] },
    { id: 2, slug: "etx", nome: "ETX Ferramentas", squad: { nome: "Squad Eliza" }, contas: [
      { id: 21, marketplace: "meli", nome: "ETX FERRAMENTAS", external_account_id: "1550982214", ativo: true, baseVinculada: { id: 201 } },
      { id: 22, marketplace: "shopee", nome: "etx.oficial", external_account_id: "730118842", ativo: true, baseVinculada: null },
    ] },
    { id: 3, slug: "meira", nome: "Meira Casa", squad: null, contas: [
      { id: 31, marketplace: "meli", nome: "MEIRA CASA", external_account_id: "1677120345", ativo: true, baseVinculada: { id: 301 } },
      // Sem cliente_conta_id no vínculo: casa pela base que a conta informa.
      { id: 32, marketplace: "meli", nome: "MEIRA DECOR", external_account_id: "1688003219", ativo: true, baseVinculada: { id: 302 } },
      { id: 33, marketplace: "meli", nome: "MEIRA ANTIGA", external_account_id: "1600000000", ativo: false, baseVinculada: null },
    ] },
  ],
};

const base = (id, slug, marketplace, total, com, dias) => ({
  id, slug, nome: slug, marketplace, ativo: true,
  created_at: diasAtras(dias + 30), updated_at: diasAtras(dias),
  total_skus: total, skus_com_custo: com,
});
const BASES = [
  base(101, "alma", "meli", 412, 398, 6),
  base(102, "alma_2", "meli", 96, 61, 41),
  base(103, "alma_shopee", "shopee", 230, 230, 12),
  base(104, "alma_tiktok", "tiktok", 58, 52, 3),
  base(201, "etx", "meli", 1284, 1102, 18),
  base(301, "meira_1", "meli", 318, 318, 9),
  base(302, "meira_2", "meli", 144, 139, 20),
  base(303, "meira_legado", "meli", 40, 40, 10),
  base(901, "teste_import", "shopee", 12, 0, 80),
];
const vinc = (clienteId, nome, slug, marketplace, conta) => ({
  cliente_id: clienteId, cliente_nome: nome, cliente_slug: slug, marketplace,
  cliente_conta_id: conta ? conta.id : null, conta_nome: conta ? conta.nome : null,
  external_account_id: conta ? conta.ext : null,
});
const VINCULOS = {
  101: vinc(1, "Alma Cosméticos", "alma", "meli", { id: 11, nome: "ALMA OFICIAL", ext: "1823349011" }),
  102: vinc(1, "Alma Cosméticos", "alma", "meli", { id: 12, nome: "ALMA OUTLET", ext: "1904412873" }),
  103: vinc(1, "Alma Cosméticos", "alma", "shopee", { id: 13, nome: "almacosmeticos", ext: "882301457" }),
  104: vinc(1, "Alma Cosméticos", "alma", "tiktok", null),
  201: vinc(2, "ETX Ferramentas", "etx", "meli", { id: 21, nome: "ETX FERRAMENTAS", ext: "1550982214" }),
  301: vinc(3, "Meira Casa", "meira", "meli", { id: 31, nome: "MEIRA CASA", ext: "1677120345" }),
  302: vinc(3, "Meira Casa", "meira", "meli", null),
  303: vinc(3, "Meira Casa", "meira", "meli", null),
};

const ME_CONTEXT = {
  ok: true,
  user: { id: 12, nome: "Pedro Gomes", email: null, role: "admin" },
  squads: [], squadPrincipalId: null,
  clientes: PORTFOLIO.clientes.map((c) => ({ id: c.id, slug: c.slug, nome: c.nome, squadId: null, responsavelDireto: false, contasAtivas: c.contas.length })),
  portfolio: { totalClientes: PORTFOLIO.clientes.length },
  permissoes: { podeAdministrar: true },
};

const SEMENTE = `
  try {
    localStorage.setItem("vf-token", "bases-token");
    localStorage.setItem("vf-user", JSON.stringify({ id: 12, nome: "Pedro Gomes", role: "admin" }));
    sessionStorage.removeItem("vf-ctx");
  } catch (e) {}
`;

// Registro do que a tela pediu ao "servidor".
const SERVIDOR = { custosLidos: [] };

function custosDaBase(b) {
  const dados = {};
  for (let i = 0; i < 3; i++) {
    const id = b.marketplace === "meli" ? `MLB${1000 + i}` : String(2000 + i);
    dados[id] = { produto_id: id, custo_produto: i === 2 ? null : 10 + i, imposto_percentual: 0.065, taxa_fixa: 6.25 };
  }
  return { ok: true, baseId: b.slug, nome: b.nome, marketplace: b.marketplace, total: 3, dados };
}

function startServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    const target = path.resolve(PORTAL_DIR, u.pathname.replace(/^\/+/, ""));
    if (!target.startsWith(path.resolve(PORTAL_DIR) + path.sep)) { res.writeHead(403).end("forbidden"); return; }
    fs.readFile(target, (err, contents) => {
      if (err) { res.writeHead(404).end("not found"); return; }
      const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
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

let checks = 0;
let failures = 0;
async function check(name, fn) {
  checks += 1;
  try { await fn(); console.log(`ok ${checks} - ${name}`); }
  catch (err) { failures += 1; console.error(`not ok ${checks} - ${name}: ${err.message}`); }
}

function wireInterception(cdp, excecoes) {
  cdp.onEvent = async (method, params) => {
    if (method === "Runtime.exceptionThrown") {
      excecoes.push(`${params?.exceptionDetails?.text || ""} ${params?.exceptionDetails?.exception?.description || ""}`.trim());
    }
    if (method !== "Fetch.requestPaused") return;
    const url = params.request.url;
    const requestId = params.requestId;
    if (!url.includes(PROD_HOST)) { await cdp.send("Fetch.continueRequest", { requestId }); return; }
    const headers = [
      { name: "access-control-allow-origin", value: "*" },
      { name: "access-control-allow-headers", value: "authorization,content-type" },
      { name: "access-control-allow-methods", value: "GET,POST,PATCH,DELETE,OPTIONS" },
      { name: "content-type", value: "application/json" },
    ];
    async function respond(obj, code = 200) {
      await cdp.send("Fetch.fulfillRequest", {
        requestId, responseCode: code, responseHeaders: headers,
        body: Buffer.from(JSON.stringify(obj)).toString("base64"),
      });
    }
    if (params.request.method === "OPTIONS") { await respond({}, 204); return; }
    const u = new URL(url);
    const p = u.pathname;
    if (p === "/me/context") return respond(ME_CONTEXT);
    if (p === "/me/portfolio") return respond(PORTFOLIO);
    if (p === "/bases") return respond({ ok: true, bases: BASES });
    if (p === "/base-vinculos") return respond({ ok: true, bases: BASES.map((b) => ({ id: b.id, slug: b.slug, vinculo: VINCULOS[b.id] || null, sugestao: null })) });
    if (p === "/base-vinculos/clientes") return respond({ ok: true, clientes: PORTFOLIO.clientes.map((c) => ({ id: c.id, nome: c.nome, slug: c.slug, ativo: true })) });
    if (p === "/cliente-imagens") return respond({ ok: true, imagens: [] });
    const contas = p.match(/^\/clientes\/([^/]+)\/contas$/);
    if (contas) {
      const cli = PORTFOLIO.clientes.find((c) => String(c.id) === contas[1] || c.slug === contas[1]);
      const mp = u.searchParams.get("marketplace");
      return respond({ ok: true, contas: (cli ? cli.contas : []).filter((c) => !mp || c.marketplace === mp) });
    }
    const custos = p.match(/^\/bases\/([^/]+)$/);
    if (custos) {
      const slug = decodeURIComponent(custos[1]);
      SERVIDOR.custosLidos.push(slug);
      const b = BASES.find((x) => x.slug === slug);
      return b ? respond(custosDaBase(b)) : respond({ ok: false, erro: "Base não encontrada" }, 404);
    }
    return respond({ ok: true, clientes: [], contas: [], bases: [], itens: [] });
  };
}

const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const texto = (sel) => `((${q(sel)} || {}).textContent || "").replace(/\\s+/g, " ").trim()`;
const nomesNaLista = `[...document.querySelectorAll(".vf-bases-cli")].map((b) => b.querySelector(".vf-bases-cli__nome").textContent.trim())`;
const clicar = (sel) => `${q(sel)}.click()`;

async function abrir(cdp, porta, query = "") {
  SERVIDOR.custosLidos = [];
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/bases.html${query}` });
  await waitFor(cdp, `document.querySelectorAll(".vf-bases-cli").length > 0 && ${q("#state-sections")}.style.display !== "none"`, "lista de clientes não renderizou");
}

async function digitarBusca(cdp, valor) {
  await cdp.evaluate(`(() => {
    const i = ${q("#bases-busca")};
    i.value = ${JSON.stringify(valor)};
    i.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
}

// VF_SHOTS=<pasta> grava PNGs dos estados principais (conferência visual).
async function foto(cdp, nome) {
  if (!process.env.VF_SHOTS) return;
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(process.env.VF_SHOTS, nome + ".png"), Buffer.from(r.data, "base64"));
}

async function run() {
  const server = await startServer();
  const porta = server.address().port;
  const debugPort = 24000 + Math.floor(Math.random() * 900);
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "vf-bases-carteira-"));
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--window-size=1440,1000", `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${perfil}`, "about:blank",
  ], { stdio: "ignore" });
  let cdp;
  const excecoes = [];
  try {
    await waitChrome(debugPort);
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })).json();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    wireInterception(cdp, excecoes);
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SEMENTE });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

    await abrir(cdp, porta);
    await foto(cdp, "01-inicial");

    await check("L1 — clientes em ordem alfabética, 'Bases sem cliente' por último", async () => {
      assert.deepStrictEqual(await cdp.evaluate(nomesNaLista), ["Alma Cosméticos", "ETX Ferramentas", "Meira Casa", "Bases sem cliente"]);
    });
    await check("L2 — abre no primeiro cliente e já carrega os itens da primeira base", async () => {
      assert.strictEqual(await cdp.evaluate(`${q(".vf-bases-cli[aria-selected='true'] .vf-bases-cli__nome")}.textContent`), "Alma Cosméticos");
      await waitFor(cdp, `${q("#bases-costs-tbody")} && ${q("#bases-costs-tbody")}.children.length === 3`, "itens da base não carregaram");
      assert.strictEqual(await cdp.evaluate(texto("#bases-drawer-title")), "alma");
      assert.strictEqual(await cdp.evaluate(`${q("#bases-drawer")}.hidden`), false);
    });
    await check("L3 — logos oficiais: lista e cartões usam os SVGs de assets/marketplaces", async () => {
      const srcs = await cdp.evaluate(`[...new Set([...document.querySelectorAll(".vf-bases-logo img")].map((i) => i.getAttribute("src")))].sort()`);
      assert.deepStrictEqual(srcs, ["assets/marketplaces/mercado-livre.svg", "assets/marketplaces/shopee.svg", "assets/marketplaces/tiktok-shop.svg"]);
      assert.ok(await cdp.evaluate(`[...document.querySelectorAll(".vf-bases-logo img")].every((i) => i.complete && i.naturalWidth > 0)`), "algum logo não carregou");
    });
    await check("A1 — Alma: um cartão por conta + TikTok (base do cliente, sem conta)", async () => {
      const titulos = await cdp.evaluate(`[...document.querySelectorAll(".vf-bases-conta .vf-bases-conta__abrir")].map((b) => b.textContent.trim())`);
      assert.deepStrictEqual(titulos, ["ALMA OFICIAL", "ALMA OUTLET", "almacosmeticos", "alma_tiktok"]);
      assert.strictEqual(await cdp.evaluate(`document.querySelectorAll(".vf-bases-conta.is-vazia").length`), 0);
    });
    await check("A2 — cobertura somada do cliente: 741 de 796 com custo, 93% (arredonda para baixo)", async () => {
      assert.match(await cdp.evaluate(texto(".vf-bases-painel__cov")), /^93% ?741 de 796 com custo$/);
    });
    await check("A3 — base desatualizada (+30d) aparece como aviso no cartão", async () => {
      const cartao = `[...document.querySelectorAll(".vf-bases-conta")].find((c) => c.textContent.includes("ALMA OUTLET"))`;
      assert.ok(await cdp.evaluate(`!!${cartao}.querySelector(".vf-status.is-warning")`));
      assert.match(await cdp.evaluate(`${cartao}.querySelector(".vf-status").textContent`), /Atualizada há 41 dias/);
    });
    await check("A4 — clicar em outro cartão abre os itens daquela base", async () => {
      await cdp.evaluate(`[...document.querySelectorAll(".vf-bases-conta__abrir")].find((b) => b.textContent.trim() === "ALMA OUTLET").click()`);
      await waitFor(cdp, `${texto("#bases-drawer-title")} === "alma_2" && ${q("#bases-costs-tbody")}.children.length === 3`, "itens de alma_2 não abriram");
      assert.ok(SERVIDOR.custosLidos.includes("alma_2"));
      assert.strictEqual(await cdp.evaluate(`document.querySelectorAll(".vf-bases-conta.is-selected").length`), 1);
      assert.match(await cdp.evaluate(texto(".vf-bases-conta.is-selected")), /ALMA OUTLET/);
    });

    await abrir(cdp, porta, "?cliente=etx");
    await foto(cdp, "02-etx");
    await check("E1 — ?cliente=etx abre direto no cliente", async () => {
      assert.strictEqual(await cdp.evaluate(`${q(".vf-bases-cli[aria-selected='true'] .vf-bases-cli__nome")}.textContent`), "ETX Ferramentas");
      assert.match(await cdp.evaluate(texto(".vf-bases-painel__desc")), /1 conta sem base/);
    });
    await check("E2 — conta conectada sem base vira cartão tracejado com 'Importar planilha'", async () => {
      assert.strictEqual(await cdp.evaluate(`document.querySelectorAll(".vf-bases-conta.is-vazia").length`), 1);
      assert.match(await cdp.evaluate(texto(".vf-bases-conta.is-vazia")), /etx\.oficial.*Shopee · ID 730118842.*sem base de custo/);
    });
    await check("E3 — 'Importar planilha' abre a importação com marketplace, cliente e conta escolhidos", async () => {
      await cdp.evaluate(clicar(".vf-bases-conta.is-vazia [data-import-conta]"));
      await waitFor(cdp, `${q("#bases-import-backdrop")}.classList.contains("is-open") && ${q("#import-conta")}.value === "22"`, "importação não veio preenchida");
      assert.strictEqual(await cdp.evaluate(`${q("#import-marketplace")}.value`), "shopee");
      assert.strictEqual(await cdp.evaluate(`${q("#import-cliente")}.value`), "2");
      await cdp.evaluate(clicar("#bases-import-cancel"));
    });
    await check("E4 — escolher cliente grava ?cliente= na URL", async () => {
      await cdp.evaluate(clicar(".vf-bases-cli[data-cli-key='c:3']"));
      await waitFor(cdp, `new URLSearchParams(location.search).get("cliente") === "meira"`, "URL não acompanhou a escolha");
    });

    await check("M1 — base vinculada só ao cliente casa pela base que a conta informa; a que sobra fica 'conta não definida'", async () => {
      const cartoes = await cdp.evaluate(`[...document.querySelectorAll(".vf-bases-conta")].map((c) => c.textContent.replace(/\\s+/g, " ").trim())`);
      assert.strictEqual(cartoes.length, 3, "conta inativa não deveria virar cartão");
      assert.match(cartoes[1], /MEIRA DECOR.*meira_2/);
      assert.match(cartoes[2], /meira_legado.*conta não definida/);
    });

    await check("B1 — busca acha cliente pelo ID da conta e pelo nome da base", async () => {
      await digitarBusca(cdp, "730118842");
      assert.deepStrictEqual(await cdp.evaluate(nomesNaLista), ["ETX Ferramentas"]);
      await digitarBusca(cdp, "teste_import");
      assert.deepStrictEqual(await cdp.evaluate(nomesNaLista), ["Bases sem cliente"]);
      await digitarBusca(cdp, "");
      assert.strictEqual(await cdp.evaluate(`document.querySelectorAll(".vf-bases-cli").length`), 4);
    });
    await check("B2 — 'Com pendência' esconde quem está em dia (Meira)", async () => {
      assert.strictEqual(await cdp.evaluate(texto("#bases-n-pendencia")), "3");
      await cdp.evaluate(clicar("[data-cli-filtro='pendencia']"));
      assert.deepStrictEqual(await cdp.evaluate(nomesNaLista), ["Alma Cosméticos", "ETX Ferramentas", "Bases sem cliente"]);
      await cdp.evaluate(clicar("[data-cli-filtro='']"));
    });
    await check("S1 — 'Bases sem cliente' lista as órfãs e explica como vincular", async () => {
      await cdp.evaluate(clicar(`.vf-bases-cli[data-cli-key='sem-cliente']`));
      await waitFor(cdp, `${texto("#bases-painel-titulo")} === "Bases sem cliente"`, "painel sem cliente não abriu");
      assert.match(await cdp.evaluate(texto(".vf-bases-painel__desc")), /Definir cliente\/vínculo/);
      assert.match(await cdp.evaluate(texto(".vf-bases-conta")), /teste_import.*0%.*0 de 12 com custo/);
    });
    await foto(cdp, "03-sem-cliente");

    await check("Z — nenhuma exceção de JavaScript durante os fluxos", async () => {
      assert.deepStrictEqual(excecoes, []);
    });

    console.log(`\n${failures ? "RED" : "GREEN"}: ${checks - failures}/${checks} checks passaram; ${failures} falharam.`);
    if (failures) process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    chrome.kill("SIGTERM");
    server.close();
    await sleep(300);
    try { fs.rmSync(perfil, { recursive: true, force: true }); } catch (_) { /* Chrome ainda segurando arquivo */ }
  }
}
run().catch((err) => { console.error(err); process.exitCode = 1; });
