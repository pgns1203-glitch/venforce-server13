/*
 * Smoke test de interface em Chrome headless para a integração da Cliente
 * 360 V3 (Projeto_cliente360, Fase 1) ao Shell V3 real (vf-context/vf-shell).
 * Mesma estratégia de Portal/visao-shell-ui.test.js: fixtures reais para o
 * Shell (GET /me/context, GET /clientes/:slug/contas) e um payload REALISTA
 * para GET /operacao/cliente-360-v3/:slug/bootstrap, moldado exatamente pelo
 * envelope que server/services/cliente360/cliente360V3BootstrapService.js
 * compõe (contexto/capabilities/resultado, cada bloco com
 * disponivel/motivo/codigo/escopo/fonte/confianca/dados).
 *
 * O que os testes de unidade (frontend-react/src/pages/Cliente360V3Page.
 * test.jsx, 41 casos) NÃO cobrem: eles mockam useOperacaoAtual() inteiro.
 * Este arquivo prova a integração REAL — vf-context resolvendo carteira,
 * cardinalidade de conta, troca de cliente/conta pela sidebar, corrida de
 * requisições, e os estados de autorização/integração (403, conta inativa)
 * — rodando a página real (Portal/cliente-360-v3.html) e o bundle real
 * (Portal/assets/cliente-360-v3), nunca contra o backend/DB de verdade.
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
const SHOTS_DIR = "/tmp/claude-1000/-home-user-Documentos-venforce-scanner-x1/aeeb225e-8368-439e-8b48-e3f6c30229fa/scratchpad";

/* ── Carteira (GET /me/context) ──────────────────────────────────────────
   4 clientes cobrindo os cenários do checklist de integração:
     · cliente-uma      — 1 conta ativa (auto-seleção, I5)
     · cliente-duas     — 2 contas ativas (ACCOUNT_CHOICE_REQUIRED, I5)
     · cliente-inativa  — 1 conta desativada (ACCOUNT_INACTIVE, I3)
     · cliente-bloqueado— está na carteira (aparece no dropdown), mas
       GET /clientes/:slug/contas devolve CLIENTE_FORA_DA_CARTEIRA — a
       corrida real que existe quando o vínculo de squad é revogado entre o
       boot da carteira e a resolução da conta (§17: FORBIDDEN descarta o
       contexto). */
const CLI_UMA = { id: 101, nome: "Cliente Uma Conta", slug: "cliente-uma", squadId: 5, responsavelDireto: false, contasAtivas: 1 };
const CLI_DUAS = { id: 102, nome: "Cliente Duas Contas", slug: "cliente-duas", squadId: 5, responsavelDireto: false, contasAtivas: 2 };
const CLI_INATIVA = { id: 103, nome: "Cliente Conta Inativa", slug: "cliente-inativa", squadId: 5, responsavelDireto: false, contasAtivas: 0 };
const CLI_BLOQUEADO = { id: 104, nome: "Cliente Bloqueado", slug: "cliente-bloqueado", squadId: 5, responsavelDireto: false, contasAtivas: 1 };
const PORTFOLIO = { ok: true, clientes: [CLI_UMA, CLI_DUAS, CLI_INATIVA, CLI_BLOQUEADO] };

const SQUADS_FIXTURE = [{ id: 5, nome: "Squad Alpha", slug: "alpha", principal: true }];

function meContextDe(portfolio) {
  return {
    ok: true,
    user: { id: 12, nome: "Ana Consultora", email: null, role: "user" },
    squads: SQUADS_FIXTURE,
    squadPrincipalId: 5,
    clientes: portfolio.clientes,
    portfolio: { totalClientes: portfolio.clientes.length },
    permissoes: { podeAdministrar: false },
  };
}

const CONTAS_POR_SLUG = {
  "cliente-uma": [
    { id: 1001, cliente_id: 101, marketplace: "meli", nome: "ML Uma", ativo: true, grant: { token_status: "valid" }, base: { base_id: 1, nome: "Base Uma" } },
  ],
  "cliente-duas": [
    { id: 1002, cliente_id: 102, marketplace: "meli", nome: "ML Duas A", ativo: true, grant: { token_status: "valid" }, base: { base_id: 2, nome: "Base Duas A" } },
    { id: 1003, cliente_id: 102, marketplace: "meli", nome: "ML Duas B", ativo: true, grant: { token_status: "valid" }, base: { base_id: 3, nome: "Base Duas B" } },
  ],
  "cliente-inativa": [
    { id: 1004, cliente_id: 103, marketplace: "meli", nome: "ML Inativa", ativo: false, grant: { token_status: "valid" }, base: { base_id: 4, nome: "Base Inativa" } },
  ],
};

/* ── payload do bootstrap (GET /operacao/cliente-360-v3/:slug/bootstrap) ──
   Envelope real (cliente360V3Envelope.js): disponivel/motivo/codigo/escopo/
   fonte/confianca/dados. `dados` segue o shape de
   frontend-react/src/test/payload.js (payloadCliente360), a fixture já
   auditada contra o backend real — reescrita aqui em CommonJS porque o
   original é ES module de teste do Vitest. */
function dadosResultado({ nomeCliente, slugCliente, faturamento }) {
  const anterior = Math.round(faturamento * 0.9);
  return {
    ok: true,
    cliente: { slug: slugCliente, nome: nomeCliente, id: 1 },
    periodo: { competencia: "2026-06", inicio: "2026-06-01", fim: "2026-06-30", diasNoPeriodo: 30, diasNoMes: 30, parcial: false, label: "junho/2026", marketplace: "meli" },
    comparacao: { competencia: "2026-05", inicio: "2026-05-01", fim: "2026-05-31", diasNoPeriodo: 31, diasNoMes: 31, parcial: false, label: "maio/2026", marketplace: "meli" },
    estado: { chave: "ok", mensagem: null, bloqueante: false },
    thresholds: { margemAlvo: 0.15 },
    confianca: {
      nivel: "confiavel", exibirPonte: true, motivoOcultarPonte: null,
      coberturaResultado: 1, coberturaCusto: 1, coberturaFrete: 1,
      receitaBloqueada: 0, pedidosBloqueados: 0, pedidosParciais: 0,
      reconciliacao: { status: "reconciliado", faturamentoFechamento: faturamento, faturamentoDetalhe: faturamento, ajusteIdentificado: 0, diferenca: 0, origemAjuste: null },
      divergenciaPonte: null, alertas: [], geradoEm: "2026-07-01T00:00:00Z", porPeriodo: { anterior: {}, atual: {} }, pedidosDerrubando: [],
    },
    fechamento: {
      atual: {
        faturamento, pedidos: 500, unidades: 900, ticketMedio: 200, cancelamentos: 12, valorCancelado: 2400, comProblema: 3,
        comissao: 10000, frete: 5000, custo: 60000, imposto: 3000, ajustes: 0,
        resultadoOperacional: 22000, margemOperacional: 0.22, ads: 4100, adsStatus: "carregado",
        tacos: 4100 / faturamento, resultadoAposAds: 22000 - 4100, margemAposAds: (22000 - 4100) / faturamento,
      },
      anterior: {
        faturamento: anterior, pedidos: 460, unidades: 820, ticketMedio: 195, cancelamentos: 10, valorCancelado: 2000, comProblema: 2,
        comissao: 9000, frete: 4500, custo: 54000, imposto: 2700, ajustes: 0,
        resultadoOperacional: 19800, margemOperacional: 0.22, ads: 3200, adsStatus: "carregado",
        tacos: 3200 / anterior, resultadoAposAds: 16600, margemAposAds: 16600 / anterior,
      },
      variacoes: {
        faturamento: { abs: faturamento - anterior, pct: (faturamento - anterior) / anterior },
        resultadoOperacional: { abs: 2200, pct: 0.1111 }, resultadoAposAds: { abs: 1300, pct: 0.0783 },
        margemOperacional: { pp: 0 }, margemAposAds: { pp: 0.45 }, unidades: { abs: 80, pct: 0.0976 },
        pedidos: { abs: 40, pct: 0.087 }, ticketMedio: { abs: 5, pct: 0.0256 }, cancelamentos: { abs: 2, pct: 0.2 },
        ads: { abs: 900, pct: 0.2813 }, tacos: { pp: 0.5 },
      },
      eficiencia: [],
      reconciliacao: {
        atual: { status: "reconciliado", faturamentoFechamento: faturamento, faturamentoDetalhe: faturamento, ajusteIdentificado: 0, diferenca: 0 },
        anterior: { status: "reconciliado", faturamentoFechamento: anterior, faturamentoDetalhe: anterior, ajusteIdentificado: 0, diferenca: 0 },
      },
      origem: { atual: "orders_api", anterior: "orders_api", geradoEm: "2026-07-01T00:00:00Z" },
      fonte: "fechamento_api_central_vendas",
    },
    ads: {
      disponivel: true, natureza: "descritivo",
      leitura: "O investimento em Ads passou de R$ 3.200,00 para R$ 4.100,00.",
      atual: { valor: 4100, status: "carregado", fonte: "mercado_ads", competencia: "2026-06", periodo: null, atualizadoEm: "2026-07-01T12:00:00Z", motivo: null, tacos: 0.041, resultadoAposAds: 17900, margemAposAds: 0.179 },
      anterior: { valor: 3200, status: "carregado", fonte: "resumo_mensal", tacos: 0.0356, resultadoAposAds: 16600, margemAposAds: 0.1844 },
      variacoes: { abs: 900, pct: 0.2813, tacosPp: 0.54, resultadoAposAds: 1300 },
    },
    ponte: {
      base: "resultadoOperacional", inicio: 19800, fim: 22000, delta: 2200, residuo: 0, fecha: true, divergencia: null,
      linhas: [
        { chave: "volume", label: "Volume", impacto: 1800, material: true, descricao: "Unidades mudaram.", formula: "(unidades atuais − anteriores) × margem unitária média anterior", produtos: [{ mlb: "MLB1", titulo: "Produto 1", impacto: 1800, unidadesAnterior: 250, unidadesAtual: 300, unitario: null }] },
        { chave: "preco", label: "Preço médio", impacto: 900, material: true, descricao: "Preço médio mudou.", formula: "Σ unidades atuais × (preço atual − anterior)", produtos: [{ mlb: "MLB1", titulo: "Produto 1", impacto: 900, unidadesAnterior: 250, unidadesAtual: 300, unitario: { anterior: 130, atual: 133 } }] },
        { chave: "custo", label: "Custo do produto", impacto: -613, material: true, descricao: "Custo unitário mudou.", formula: "custo unitário atual − custo unitário anterior", produtos: [{ mlb: "MLB2", titulo: "Produto 2", impacto: -613, unidadesAnterior: 100, unidadesAtual: 100, unitario: { anterior: 150, atual: 156.13 } }] },
        { chave: "outros", label: "Outros", impacto: 113, material: false, descricao: "Fatores imateriais agrupados.", formula: "Comissão + Imposto", composicao: [{ chave: "comissao", label: "Comissão", impacto: 160 }, { chave: "imposto", label: "Imposto", impacto: -47 }], produtos: [] },
      ],
    },
    produtos: {
      ajudaram: [{ mlb: "MLB1", titulo: "Produto 1", contribuicao: 1500, faturamento: 40000, unidadesAtual: 300, motivoDominante: "volume", margem: 0.25, curvaA: true, curvaAbc: "A" }],
      prejudicaram: [{ mlb: "MLB2", titulo: "Produto 2", contribuicao: -500, faturamento: 20000, unidadesAtual: 100, motivoDominante: "custo", margem: 0.05, curvaA: true, curvaAbc: "A" }],
      noVermelho: [{ mlb: "MLB3", titulo: "Produto 3", unidades: 50, faturamento: 5000, resultado: -1550, margemUnitaria: -31, margem: -0.31, precoMedio: 100, curvaA: false, curvaAbc: "C", motivoRisco: "resultado_negativo" }],
      abaixoDaMargem: [{ mlb: "MLB2", titulo: "Produto 2", unidades: 100, faturamento: 20000, margem: 0.05, gapMargemPp: 10, recuperavelAteAlvo: 2000, curvaA: true, curvaAbc: "A", motivoRisco: "margem_abaixo_alvo" }],
      curvaAEmRisco: [], totais: { noVermelho: 1, abaixoDaMargem: 1, analisados: 3 },
    },
    oportunidades: {
      totalRecuperavel: 2050, escopo: "operacional",
      observacao: "Total recuperável considera apenas oportunidades operacionais comprováveis.",
      oportunidades: [
        { tipo: "issue", severidade: "critico", titulo: "1 produto(s) com resultado negativo", fator: "produto", recuperavelEstimado: 1550, contaNoTotal: true, descricao: "Vende abaixo do custo variável.", acaoRecomendada: "Subir preço ou pausar.", destino: "bases.html", produtos: [{ mlb: "MLB3", titulo: "Produto 3", resultado: -1550, faturamento: 5000 }] },
      ],
    },
    narrativa: { titulo: "Resultado subiu.", texto: "Resultado subiu.", escopo: "operacional", drivers: { positivos: [], negativos: [] } },
    simulacao: {
      endpoint: "/operacao/cliente-360/x/resultado/simular", competencia: "2026-06",
      produtos: [{ mlb: "MLB1", titulo: "Produto 1", unidades: 300, precoMedio: 133.33, custoUnitario: 80, freteUnitario: 10, comissaoUnitaria: 13, impostoUnitario: 4, margemUnitaria: 33, receita: 40000, resultado: 10000, margem: 0.25, noVermelho: false }],
      adsMantido: 4100, adsStatus: "carregado", resultadoOperacionalAtual: 22000, resultadoAposAdsAtual: 17900,
      cenariosRapidos: [{ chave: "limpar", label: "Limpar", descricao: "Remove intervenções." }],
    },
    placar: { disponivel: true, endpoint: "/operacao/cliente-360/x/placar", escopo: "operacional" },
  };
}

function bootstrapEnvelope({ clienteId, clienteSlug, clienteContaId, marketplace, nomeCliente, faturamento }) {
  return {
    contexto: { clienteId, clienteSlug, clienteContaId, marketplace, competencia: "2026-06", compararCom: "2026-05", contextKey: `${clienteId}:${clienteContaId}:2026-06:2026-05` },
    capabilities: { disponivel: true, motivo: null, codigo: null, escopo: "account", fonte: { nome: "cliente_conta_service", versao: null, geradoEm: "2026-07-01T00:00:00Z" }, confianca: null, dados: { marketplace, isMeli: marketplace === "meli" } },
    resultado: { disponivel: true, motivo: null, codigo: null, escopo: "account", fonte: { nome: "cliente360_resultado_service", versao: null, geradoEm: "2026-07-01T00:00:00Z" }, confianca: { tipo: "dados", nivel: "confiavel" }, dados: dadosResultado({ nomeCliente, slugCliente: clienteSlug, faturamento }) },
  };
}

// contexto → bootstrap. Chave "slug:contaId".
const BOOTSTRAP_POR_CONTEXTO = {
  "cliente-uma:1001": bootstrapEnvelope({ clienteId: 101, clienteSlug: "cliente-uma", clienteContaId: 1001, marketplace: "meli", nomeCliente: "Cliente Uma Conta", faturamento: 100000 }),
  "cliente-duas:1002": bootstrapEnvelope({ clienteId: 102, clienteSlug: "cliente-duas", clienteContaId: 1002, marketplace: "meli", nomeCliente: "Cliente Duas Contas", faturamento: 200000 }),
  "cliente-duas:1003": bootstrapEnvelope({ clienteId: 102, clienteSlug: "cliente-duas", clienteContaId: 1003, marketplace: "meli", nomeCliente: "Cliente Duas Contas", faturamento: 350000 }),
};

// Atraso artificial de um único request (§I9 — corrida): setado antes de
// disparar a ação, consumido (uso único) no primeiro bootstrap que casar.
let atrasoPendente = null; // { contexto: "slug:contaId", ms: number }

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
    if (result.exceptionDetails) {
      const desc = result.exceptionDetails.exception && (result.exceptionDetails.exception.description || result.exceptionDetails.exception.value);
      throw new Error(desc || result.exceptionDetails.text || "Falha na avaliação do navegador");
    }
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

function clickText(scopeSelector, text) {
  return (cdp) => cdp.evaluate(`
    (function(){
      var scope = document.querySelector(${JSON.stringify(scopeSelector)});
      if (!scope) throw new Error("escopo não encontrado: ${scopeSelector}");
      var all = scope.querySelectorAll('*');
      var target = null;
      for (var i=0;i<all.length;i++){
        var n = all[i];
        if (n.children.length === 0 && n.textContent.trim() === ${JSON.stringify(text)}) { target = n; break; }
      }
      if (!target) throw new Error("texto não encontrado em ${scopeSelector}: ${text}");
      target.click();
      return true;
    })()
  `);
}

// Itens de dropdown do Shell (.vf-menu__item) misturam nome + status/rótulo
// no mesmo botão (vf-shell.js :: dropdownClientes/dropdownOperacoes) — o
// texto pedido nunca é um nó-folha isolado, por isso o casamento é por
// substring no item inteiro, igual a Portal/vf-shell-ui.test.js.
function clickMenuItem(cdp, text) {
  return cdp.evaluate(`
    (function(){
      var itens = document.querySelectorAll('.vf-shell__dropdown .vf-menu__item');
      var alvo = Array.prototype.find.call(itens, function(it){ return it.textContent.indexOf(${JSON.stringify(text)}) >= 0; });
      if (!alvo) throw new Error("item de menu não encontrado: ${text}");
      alvo.click();
      return true;
    })()
  `);
}

let bootstrapCalls = [];

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
    const json = (obj, code) => respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: code || 200, responseHeaders: [...cors, { name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(obj)).toString("base64") });

    if (url.includes("/me/context")) { await json(meContextDe(PORTFOLIO)); return; }

    const contasMatch = url.match(/\/clientes\/([^/?]+)\/contas/);
    if (contasMatch) {
      const slug = decodeURIComponent(contasMatch[1]);
      if (slug === "cliente-bloqueado") {
        await json({ ok: false, code: "CLIENTE_FORA_DA_CARTEIRA", erro: "Este cliente não está na sua carteira." }, 403);
        return;
      }
      const contas = CONTAS_POR_SLUG[slug];
      if (!contas) { await json({ ok: false, code: "CLIENTE_NAO_ENCONTRADO" }, 404); return; }
      const cli = PORTFOLIO.clientes.find((c) => c.slug === slug);
      await json({ ok: true, cliente: { id: cli.id, nome: cli.nome, slug: cli.slug, ativo: true }, contas });
      return;
    }

    const bootMatch = url.match(/\/operacao\/cliente-360-v3\/([^/?]+)\/bootstrap/);
    if (bootMatch) {
      const slug = decodeURIComponent(bootMatch[1]);
      const qs = new URL(url).searchParams;
      const conta = qs.get("conta");
      const chave = `${slug}:${conta}`;
      bootstrapCalls.push(chave);
      const payload = BOOTSTRAP_POR_CONTEXTO[chave];
      if (atrasoPendente && atrasoPendente.contexto === chave) {
        const ms = atrasoPendente.ms;
        atrasoPendente = null; // uso único
        await sleep(ms);
      }
      if (!payload) { await respond("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" }); return; }
      await json(payload);
      return;
    }

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
    "--window-size=1440,1600",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/vf-cliente360v3-shell-ui-${process.pid}`, "about:blank",
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

    async function seed(userOverrides) {
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/cliente-360-v3.html` });
      await sleep(60);
      await cdp.evaluate(`
        localStorage.setItem("vf-token", "ui-test-token");
        localStorage.setItem("vf-user", JSON.stringify(${JSON.stringify({ id: 12, nome: "Ana Consultora", role: "user", ...userOverrides })}));
      `);
    }

    // `periodo` é passageiro de URL da PÁGINA (periodoUrl.js), não do
    // vf-context — sem ele, useCliente360V3 usa competenciaAtual() (o mês
    // real do relógio), que não bate com nenhuma chave do fixture. Fixado
    // aqui em todo goto() para o bootstrap sempre casar com
    // BOOTSTRAP_POR_CONTEXTO (que fala junho/2026).
    async function goto(qs) {
      consoleErrors.length = 0;
      bootstrapCalls = [];
      const query = new URLSearchParams(qs || "");
      if (!query.get("periodo")) query.set("periodo", "2026-06");
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/cliente-360-v3.html?${query.toString()}` });
      await waitFor(cdp, "window.VF && window.VF.context", "vf-context não montou");
    }

    // ═══ 1. Cliente com 1 conta — resolve sozinho (I5), Dossiê renderiza ═══
    await seed();
    await cdp.evaluate(`sessionStorage.clear();`);
    await goto("cliente=cliente-uma");
    await waitFor(cdp, "window.VF.context.getState() === 'READY'", "cliente-uma não chegou a READY");
    await waitFor(cdp, "document.querySelector('.c360d-header')", "header do Dossiê não renderizou");
    await sleep(150);

    await check("cliente com 1 conta ativa: resolve sozinho e renderiza o Dossiê real", async () => {
      const texto = await cdp.evaluate("document.body.innerText");
      assert.ok(texto.includes("R$ 100.000"), `faturamento de cliente-uma não encontrado: ${texto.slice(0, 400)}`);
      assert.deepStrictEqual(bootstrapCalls, ["cliente-uma:1001"], "bootstrap deveria ter sido chamado 1x com a conta 1001");
    });

    await check("Shell (sidebar) mostra Cliente e Operação corretos", async () => {
      const texto = await cdp.evaluate("document.querySelector('.vf-shell__sidebar').innerText");
      assert.ok(texto.includes("Cliente Uma Conta"), `sidebar deveria mostrar Cliente Uma Conta: ${texto}`);
      assert.ok(texto.includes("ML Uma"), `sidebar deveria mostrar a operação ML Uma: ${texto}`);
    });

    const shot1 = path.join(SHOTS_DIR, "c360v3-feliz-uma-conta.png");
    fs.writeFileSync(shot1, Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
    console.log(`   screenshot: ${shot1}`);

    // ═══ 2. Squads do /me/context passam por getSquads() sem seletor próprio ═══
    await check("Squads: getSquads()/getSquadPrincipalId() refletem /me/context; sem seletor de squad inventado no bloco de contexto", async () => {
      const squads = await cdp.evaluate("window.VF.context.getSquads()");
      assert.deepStrictEqual(squads, SQUADS_FIXTURE);
      const principal = await cdp.evaluate("window.VF.context.getSquadPrincipalId()");
      assert.strictEqual(principal, 5);
      const temSeletorDeSquad = await cdp.evaluate(`
        Boolean(document.querySelector('.vf-shell__context [id*="squad" i], .vf-shell__context [class*="squad" i]'))
      `);
      assert.strictEqual(temSeletorDeSquad, false, "não deveria existir seletor de squad dentro do bloco de contexto — activeSquadId não existe, não pode ser inventado aqui");
    });

    // ═══ 3. Cliente com 2+ contas — NUNCA escolhe sozinho (I5) ═══
    await goto("cliente=cliente-duas");
    await waitFor(cdp, "window.VF.context.getState() === 'ACCOUNT_CHOICE_REQUIRED'", "cliente-duas deveria exigir escolha de operação");
    await sleep(150);

    await check("cliente com 2 contas ativas: ACCOUNT_CHOICE_REQUIRED — main escondido, banner correto, nenhum bootstrap disparado", async () => {
      const mainHidden = await cdp.evaluate("document.getElementById('vf-shell-main').hidden");
      assert.strictEqual(mainHidden, true, "main deveria estar escondido sem operação escolhida");
      const titulo = await cdp.evaluate("document.querySelector('.vf-banner__title').textContent");
      assert.strictEqual(titulo, "Escolha a operação");
      assert.deepStrictEqual(bootstrapCalls, [], "bootstrap não pode ser chamado sem conta resolvida");
    });

    // Escolhe a operação A pela sidebar (dropdown real, não atalho de URL).
    await cdp.evaluate("document.getElementById('vf-op-trigger').click()");
    await clickMenuItem(cdp, "ML Duas A");
    await waitFor(cdp, "window.VF.context.getState() === 'READY'", "escolher ML Duas A não levou a READY");
    await waitFor(cdp, "document.body.innerText.includes('R$ 200.000')", "Dossiê da conta 1002 não renderizou");
    await sleep(150);

    await check("escolher a operação pelo dropdown do Shell chama o bootstrap com a conta certa", async () => {
      assert.deepStrictEqual(bootstrapCalls, ["cliente-duas:1002"]);
    });

    // ═══ 4. Drawer aberto + troca de operação: fecha o drawer, nunca mistura conta ═══
    await clickText("#produtos", "Produto 1")(cdp);
    await waitFor(cdp, "document.querySelector('[role=\"dialog\"]')", "drawer de produto não abriu");

    bootstrapCalls = [];
    await cdp.evaluate("document.getElementById('vf-op-trigger').click()");
    await clickMenuItem(cdp, "ML Duas B");
    await waitFor(cdp, "document.body.innerText.includes('R$ 350.000')", "Dossiê da conta 1003 não renderizou");
    await sleep(150);

    await check("trocar de operação com drawer aberto fecha o drawer e troca os dados (nunca mistura conta)", async () => {
      const dialog = await cdp.evaluate("document.querySelector('[role=\"dialog\"]')");
      assert.strictEqual(dialog, null, "drawer da operação anterior deveria ter fechado");
      const texto = await cdp.evaluate("document.body.innerText");
      assert.ok(!texto.includes("R$ 200.000"), "não pode sobrar dado da conta 1002 na tela");
      assert.deepStrictEqual(bootstrapCalls, ["cliente-duas:1003"]);
    });

    // ═══ 5. Requisição atrasada nunca sobrescreve o contexto mais novo (I9) ═══
    atrasoPendente = { contexto: "cliente-duas:1002", ms: 700 };
    bootstrapCalls = [];
    await cdp.evaluate("document.getElementById('vf-op-trigger').click()");
    await clickMenuItem(cdp, "ML Duas A"); // dispara o bootstrap ATRASADO (1002)
    await sleep(120); // a resposta de 1002 ainda não chegou (leva 700ms)
    await cdp.evaluate("document.getElementById('vf-op-trigger').click()");
    await clickMenuItem(cdp, "ML Duas B"); // troca de novo ANTES da resposta atrasada chegar

    await waitFor(cdp, "document.body.innerText.includes('R$ 350.000')", "conta 1003 (mais nova) deveria ter renderizado");
    await sleep(900); // espera a resposta atrasada de 1002 chegar e ser descartada

    await check("resposta atrasada da operação anterior é descartada — o contexto mais novo nunca é sobrescrito", async () => {
      const texto = await cdp.evaluate("document.body.innerText");
      assert.ok(texto.includes("R$ 350.000"), "conta 1003 deveria continuar na tela");
      assert.ok(!texto.includes("R$ 200.000"), "a resposta atrasada da conta 1002 não pode ter sobrescrito a 1003");
      assert.strictEqual(await cdp.evaluate("window.VF.context.getContext().clienteContaId"), 1003);
    });

    // ═══ 6. Trocar de CLIENTE reseta a conta e resolve o novo do zero ═══
    bootstrapCalls = [];
    await cdp.evaluate("document.getElementById('vf-cliente-trigger').click()");
    await clickMenuItem(cdp, "Cliente Uma Conta");
    await waitFor(cdp, "window.VF.context.getState() === 'READY'", "trocar para cliente-uma não voltou a READY");
    await waitFor(cdp, "document.body.innerText.includes('R$ 100.000')", "Dossiê de cliente-uma não renderizou após troca de cliente");
    await sleep(150);

    await check("trocar de cliente reresolve o cliente novo do zero (conta anterior não vaza)", async () => {
      const ctx = await cdp.evaluate("window.VF.context.getContext()");
      assert.strictEqual(ctx.clienteSlug, "cliente-uma");
      assert.strictEqual(ctx.clienteContaId, 1001);
      const texto = await cdp.evaluate("document.body.innerText");
      assert.ok(!texto.includes("Cliente Duas Contas"), "não pode sobrar referência ao cliente anterior");
      assert.deepStrictEqual(bootstrapCalls, ["cliente-uma:1001"]);
    });

    // ═══ 7. URL direta com cliente+conta resolve sem NENHUMA interação ═══
    await goto("cliente=cliente-duas&conta=1003");
    await waitFor(cdp, "window.VF.context.getState() === 'READY'", "deep link cliente+conta não chegou a READY");
    await waitFor(cdp, "document.body.innerText.includes('R$ 350.000')", "deep link não renderizou a conta pedida");
    await check("URL direta com cliente+conta resolve a operação pedida sem interação", async () => {
      assert.deepStrictEqual(bootstrapCalls, ["cliente-duas:1003"]);
    });

    // ═══ 8. Conta inativa pedida explicitamente na URL — NUNCA escolhida (I3) ═══
    await goto("cliente=cliente-inativa&conta=1004");
    await waitFor(cdp, "window.VF.context.getState() === 'ACCOUNT_INACTIVE'", "conta inativa deveria virar ACCOUNT_INACTIVE");
    await sleep(150);
    await check("conta desativada pedida na URL: ACCOUNT_INACTIVE, main escondido, nenhum bootstrap chamado", async () => {
      const mainHidden = await cdp.evaluate("document.getElementById('vf-shell-main').hidden");
      assert.strictEqual(mainHidden, true);
      const titulo = await cdp.evaluate("document.querySelector('.vf-banner__title').textContent");
      assert.strictEqual(titulo, "Operação desativada");
      assert.deepStrictEqual(bootstrapCalls, []);
    });

    // ═══ 9. Cliente fora da carteira (corrida de autorização) — FORBIDDEN ═══
    await goto("cliente=cliente-bloqueado");
    await waitFor(cdp, "window.VF.context.getState() === 'FORBIDDEN'", "cliente-bloqueado deveria virar FORBIDDEN");
    await sleep(150);
    await check("cliente fora da carteira na resolução de contas (403): contexto descartado, sessão limpa", async () => {
      const mainHidden = await cdp.evaluate("document.getElementById('vf-shell-main').hidden");
      assert.strictEqual(mainHidden, true);
      const titulo = await cdp.evaluate("document.querySelector('.vf-banner__title').textContent");
      assert.strictEqual(titulo, "Você não tem acesso a este cliente");
      const sessao = await cdp.evaluate("sessionStorage.getItem('vf-ctx')");
      assert.strictEqual(sessao, null, "sessionStorage deveria ter sido limpo em FORBIDDEN");
      assert.deepStrictEqual(bootstrapCalls, [], "bootstrap não pode ser chamado para um cliente fora da carteira");
    });

    // ═══ 10. Refresh preserva o contexto (sessionStorage por aba) ═══
    await goto("cliente=cliente-uma");
    await waitFor(cdp, "window.VF.context.getState() === 'READY'", "boot inicial antes do refresh não chegou a READY");
    await sleep(150);
    bootstrapCalls = [];
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/cliente-360-v3.html` }); // sem querystring — só a sessão da aba
    await waitFor(cdp, "window.VF && window.VF.context && window.VF.context.getState() === 'READY'", "refresh não restaurou o contexto");
    await sleep(150);
    await check("refresh (F5) sem querystring restaura cliente+conta pela sessão da aba", async () => {
      const ctx = await cdp.evaluate("window.VF.context.getContext()");
      assert.strictEqual(ctx.clienteSlug, "cliente-uma");
      assert.strictEqual(ctx.clienteContaId, 1001);
    });

    // ═══ 11. Logout/login como outro usuário nunca herda a sessão anterior (I8) ═══
    await cdp.evaluate(`localStorage.setItem("vf-user", JSON.stringify({ id: 999, nome: "Outro Consultor", role: "user" }));`);
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/cliente-360-v3.html` });
    await waitFor(cdp, "window.VF && window.VF.context", "vf-context não montou após troca de usuário");
    await waitFor(cdp, "window.VF.context.getState() !== 'BOOT'", "estado não saiu de BOOT após novo login");
    await sleep(150);
    await check("login como outro usuário (userId diferente) descarta a sessão de aba do usuário anterior", async () => {
      const ctx = await cdp.evaluate("window.VF.context.getContext()");
      assert.strictEqual(ctx, null, "o novo usuário não pode herdar cliente-uma da sessão do usuário anterior");
      assert.strictEqual(await cdp.evaluate("window.VF.context.getState()"), "NO_CLIENT");
    });

    await check("sem erros de console em nenhum cenário", async () => {
      const relevantes = consoleErrors.filter((m) => !/favicon/i.test(m));
      assert.strictEqual(relevantes.length, 0, `erros de console: ${JSON.stringify(relevantes)}`);
    });

    console.log(`\n✓ ${checks} verificações da integração Cliente 360 V3 × Shell V3`);
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
