/*
 * Smoke test de interface do COCKPIT DE PRECIFICAÇÃO da Central de Margem
 * (drawer Precificar/Evidências/Histórico, promoções, preview, gates,
 * rollout, idempotência, pós-escrita e Oportunidades), em Chrome headless.
 *
 * Mesmo harness de central-margem-snapshot-ui.test.js: servidor estático de
 * Portal/ + Shell V3 com a rede de produção interceptada via CDP (nunca toca a
 * rede real). O client da Central é mockado em window.__VF_CENTRAL_MARGEM_API_CLIENT__;
 * os itens passam pelo normalizador REAL (normalizeSnapshotItens). Nenhuma
 * escrita real: `applyPricing` é um mock que só registra a chamada.
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
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

// Mock do client no browser: 3 itens por página, promoções/simulação/preview/
// aplicar controláveis (hold/resolve) para provar corridas e idempotência.
const MOCK_CLIENT = `
  (function () {
    function ev(source, value, quality) {
      return { source: source, kind: "PROJECTED", value: value, quality: quality || "MEASURED", observedAt: "2026-09-29T11:52:00Z", note: null };
    }
    function field(e) {
      return { present: !!e, selectedValue: e ? e.value : null, selectedSource: e ? e.source : null, selectedKind: e ? "PROJECTED" : null,
        projected: e, realized: null, evidences: e ? [e] : [], divergences: [], hasConflict: false, hasDrift: false };
    }
    var ITENS = [
      { id: "MLB1001", titulo: "Produto X", preco: 110.48, margem: 0.1916, status: "HEALTHY" },
      { id: "MLB1002", titulo: "Produto Y", preco: 149.9, margem: 0.248, status: "HEALTHY" },
      { id: "MLB1003", titulo: "Produto Z", preco: 59.9, margem: -0.05, status: "LOSS" },
    ];
    function rawItem(it) {
      return {
        itemId: it.id, title: it.titulo, titulo: it.titulo, sku: "SKU-" + it.id, status: it.status, confidence: "HIGH", marketplace: "meli", targetMargin: 0.1,
        fields: {
          price: field(ev("MELI_API", it.preco)), cost: field(ev("VENFORCE_BASE", 50, "DECLARED")), taxRate: field(ev("VENFORCE_BASE", 0.1, "DECLARED")),
          fixedFee: field(ev("VENFORCE_BASE", 0, "DECLARED")), commission: field(ev("MELI_API", 13.26)), commissionRate: field(ev("MELI_API", 0.12)), freight: field(ev("MELI_API", 20)),
        },
        projected: { margin: it.margem, profit: Math.round(it.margem * it.preco * 100) / 100, estimated: false },
        realized: { margin: 0.2083, profit: 23, pending: false },
        quality: { confidence: "HIGH", confidenceByField: {}, reasons: [], divergences: [], statusReasons: [] },
        diagnostico: { statusAnuncio: "active" },
        snapshot: { refreshStatus: "fresh", calculatedAt: "2026-09-29T11:52:00Z" },
        sales: { hasOrders: true, unidades: 21, pedidos: 20, receita: 2333, precoMedio: 111.1 },
        settlement: { available: false },
      };
    }

    var PRECO_TABELA = { MLB1001: 110.48, MLB1002: 149.9, MLB1003: 59.9, MLB9999: 99.9 };
    function precoVivo(itemId) { return window.__pc.livePrice[itemId] != null ? window.__pc.livePrice[itemId] : PRECO_TABELA[itemId]; }
    window.__pc = {
      livePrice: {},
      calls: { itens: 0, promos: [], sim: [], preview: [], apply: [], app: [], hist: [], opps: [] },
      holdPromos: {}, resolvePromos: {},
      holdSim: false, resolveSim: [],
      previewBloqueado: false, escritaHabilitada: false,
      applyMode: "ok",           // ok | network-then-ok | desatualizado-then-ok | divergente | desconhecido
      holdPreview: false, resolvePreview: [], previewSignals: [],
      appCalls: 0,
    };

    function promosDe(itemId) {
      return [
        { id: "P-ATIVA", tipo: "SELLER_CAMPAIGN", tipoLabel: "Campanha própria", nome: "Campanha Setembro", status: "started", statusExibicao: "ATIVA",
          inicio: "2026-09-01T00:00:00Z", fim: "2026-09-30T00:00:00Z", precoOriginal: 149.9, precoFinal: 139.9, descontoReais: 10, descontoPercentual: 6.67,
          mlBanca: null, sellerBanca: 10, meliPercentage: null, sellerPercentage: 6.67, margem: 0.21, lucro: 29.4, escrita: { suportada: true, acao: "ALTERAR", motivo: null } },
        { id: "P-DEAL", tipo: "DEAL", tipoLabel: "Campanha tradicional", nome: "Oferta " + itemId, status: "candidate", statusExibicao: "ELEGÍVEL",
          inicio: "2026-10-01T00:00:00Z", fim: "2026-10-10T00:00:00Z", precoOriginal: 149.9, precoFinal: 129.9, descontoReais: 20, descontoPercentual: 13.34,
          mlBanca: 5.2, sellerBanca: 14.8, meliPercentage: 3.47, sellerPercentage: 9.87, margem: 0.197, lucro: 25.59, escrita: { suportada: true, acao: "PARTICIPAR", motivo: null } },
        { id: "P-PROG", tipo: "DEAL", tipoLabel: "Campanha tradicional", nome: "Black Friday", status: "pending", statusExibicao: "PROGRAMADA",
          inicio: "2026-11-20T00:00:00Z", fim: "2026-11-30T00:00:00Z", precoOriginal: 149.9, precoFinal: 119.9, descontoReais: 30, descontoPercentual: 20,
          mlBanca: 0, sellerBanca: 30, meliPercentage: 0, sellerPercentage: 20, margem: 0.15, lucro: 18, escrita: { suportada: false, acao: null, motivo: "Promoção programada: só simulação." } },
        { id: "P-SMART", tipo: "SMART", tipoLabel: "Campanha cofinanciada automatizada", nome: "Impulsione suas vendas", status: "candidate", statusExibicao: "ELEGÍVEL",
          inicio: null, fim: null, precoOriginal: 149.9, precoFinal: 146.9, descontoReais: 3, descontoPercentual: 2, mlBanca: 0.75, sellerBanca: 2.25,
          meliPercentage: 0.5, sellerPercentage: 1.5, margem: 0.235, lucro: 34.5, escrita: { suportada: false, acao: null, motivo: "Somente simulação: tipo sem escrita suportada." } },
        { id: "P-NAO", tipo: "SELLER_CAMPAIGN", tipoLabel: "Campanha própria", nome: "Campanha antiga", status: "started", statusExibicao: "NÃO APLICADA",
          inicio: null, fim: null, precoOriginal: 149.9, precoFinal: 144.9, descontoReais: 5, descontoPercentual: 3.34, mlBanca: null, sellerBanca: 5,
          meliPercentage: null, sellerPercentage: 3.34, margem: 0.23, lucro: 33, escrita: { suportada: false, acao: null, motivo: "Não é a promoção aplicada." } },
      ];
    }

    function gatesBase(bloqueado) {
      var g = [
        { id: "conta", grupo: "CONTA", tom: "ok", titulo: "Conta correta", detalhe: "Loja piloto · Mercado Livre 10000" },
        { id: "custo", grupo: "DADOS", tom: "ok", titulo: "Custo da Base encontrado", detalhe: "R$ 50,00" },
        { id: "preco_confirmado", grupo: "PRECO", tom: "ok", titulo: "Preço atual confirmado", detalhe: null },
        { id: "break_even", grupo: "PRECO", tom: bloqueado ? "block" : "ok", titulo: bloqueado ? "Abaixo do break-even" : "Acima do break-even", detalhe: null },
        { id: "meta", grupo: "MARGEM", tom: "warn", titulo: "Margem abaixo da meta", detalhe: "Meta de referência 25,0% — não existe margem mínima oficial; não bloqueia." },
      ];
      return g;
    }

    function avaliacao(params, extra) {
      var novo = params.novoPreco == null ? 129.9 : params.novoPreco;
      var bloqueado = window.__pc.previewBloqueado || novo < 80;
      var promo = params.tipo === "PROMOTION"
        ? { id: params.promotionId, nome: "Oferta MLB1001", tipo: "DEAL", tipoLabel: "Campanha tradicional", statusExibicao: "ELEGÍVEL", precoOriginal: 149.9,
            descontoReais: 20, descontoPercentual: 13.34, mlBanca: 5.2, sellerBanca: 14.8, escrita: { suportada: true, acao: "PARTICIPAR", motivo: null } }
        : null;
      return Object.assign({
        ok: true, tipo: params.tipo,
        item: { itemId: params.itemId, titulo: "Produto X", sku: "SKU-1", statusAnuncio: "active" },
        conta: { id: 10, nome: "Loja piloto", mlUserId: "10000" },
        atual: { preco: precoVivo(params.itemId), margem: 0.1916, lucro: 21.17, precoAlvo: 102.56, breakEven: 89.66, metaMargem: 0.1 },
        proposta: { preco: novo, margem: bloqueado ? -0.04 : 0.2204, lucro: bloqueado ? -3.2 : 25.33, comissao: 13.79, comissaoFonte: "recotada", frete: 20, freteFonte: "recotado",
          rebate: promo ? 5.2 : 0, variacaoPercentual: Math.round((novo / 110.48 - 1) * 10000) / 100 },
        vendas: { unidades: 84, pedidos: 80, receita: 9000 },
        promocao: promo, gates: gatesBase(bloqueado), bloqueado: bloqueado,
        escrita: window.__pc.escritaHabilitada ? { habilitada: true, motivo: null } : { habilitada: false, motivo: "Escrita no Mercado Livre desligada para este cliente (rollout)." },
      }, extra || {});
    }

    window.__VF_CENTRAL_MARGEM_POLL_MS__ = 120;
    window.__VF_CENTRAL_MARGEM_POST_WRITE_POLL_MS__ = 80;
    window.__VF_CENTRAL_MARGEM_API_CLIENT__ = {
      getWorkspace: function () { return Promise.resolve({ ok: false, status: 500, error: "workspace ao vivo NÃO deveria ser chamado" }); },
      getSnapshotResumo: function (params) {
        if (!params.clienteContaId) return Promise.resolve({ ok: false, status: 400, code: "CLIENTE_CONTA_ID_OBRIGATORIO", error: "clienteContaId é obrigatório" });
        return Promise.resolve(window.VFCentralMargemApi.normalizeSnapshotResumo({
          habilitado: true, estado: "ready", conta: { id: Number(params.clienteContaId), nome: "Conta " + params.clienteContaId },
          snapshot: { totalItens: 3, ultimoCalculoEm: "2026-09-29T11:52:00Z", foraDoCatalogo: 0 },
          kpis: { total: 3, porStatus: { HEALTHY: 2, LOW_MARGIN: 0, LOSS: 1, UNVALIDATED: 0, SUSPECT_DATA: 0, RECONCILING: 0 }, porRefreshStatus: { fresh: 3 }, anuncios: { total: 3, ativos: 3, pausados: 0 }, comMargem: 3 },
          refresh: { runAtivo: null, ultimoRun: null },
        }));
      },
      getSnapshotItens: function (params) {
        window.__pc.calls.itens += 1;
        var context = { client: { slug: params.clientSlug, name: params.clientName }, marketplace: "meli" };
        return Promise.resolve(window.VFCentralMargemApi.normalizeSnapshotItens({
          estado: "ready", paginacao: { page: 1, limit: 50, total: 3, totalPaginas: 1 }, periodo: { dateFrom: "2026-08-30", dateTo: "2026-09-28" },
          ultimoCalculoEm: "2026-09-29T11:52:00Z", itens: ITENS.map(rawItem), refresh: { runAtivo: null, ultimoRun: null },
        }, context));
      },
      getSnapshotRealizado: function () {
        return Promise.resolve(window.VFCentralMargemApi.normalizeSnapshotRealizado({
          ok: true, habilitado: true,
          periodo: { dateFrom: "2026-08-30", dateTo: "2026-09-28", modo: "ultimos30", periodo: null, rotulo: "Últimos 30 dias (até 28/09/2026)" },
          cobertura: { estado: "ATUAL", origem: "published", sincronizadoAte: "2026-09-28", meses: 2, mesesComImport: 2, lacunas: [] },
          freshness: { estado: "ATUAL", sincronizadoAte: "2026-09-28", ultimaPublicacaoEm: "2026-09-29T06:00:00Z", syncEmAndamento: false },
          kpis: { receita: 24883, receitaSemMlb: 0, unidades: 210, pedidos: 190, produtosComVenda: 45, lucro: { valor: 5452, produtos: 45 },
            margem: { percent: 22.32, estado: "completa", coberturaReceita: 1, produtosCalculaveis: 45, produtosSemMargem: 0, produtosEstimados: 0 },
            drift: { disponivel: true, pp: -1.2, margemRealizadaMixPercent: 22.32, margemProjetadaMixPercent: 23.52, produtosComparados: 45, limitePp: 2, produtosNegativos: 3, piores: [] } },
        }));
      },
      requestSnapshotRefresh: function () { return Promise.resolve({ ok: true, runId: 1, reused: false, run: { runId: 1, status: "queued" } }); },
      getSnapshotRefreshStatus: function () { return Promise.resolve({ ok: true, run: { runId: 1, status: "completed" } }); },

      getItemPromotions: function (params) {
        window.__pc.calls.promos.push(params.itemId);
        var resposta = { ok: true, itemId: params.itemId, contaCorreta: true, atual: { preco: precoVivo(params.itemId), margem: 0.248, lucro: 37.18 }, promocoes: promosDe(params.itemId), escritaHabilitada: window.__pc.escritaHabilitada };
        if (window.__pc.holdPromos[params.itemId]) {
          return new Promise(function (resolve) { window.__pc.resolvePromos[params.itemId] = function () { delete window.__pc.holdPromos[params.itemId]; resolve(resposta); }; });
        }
        return Promise.resolve(resposta);
      },
      simulatePricing: function (params, signal) {
        window.__pc.calls.sim.push(JSON.parse(JSON.stringify(params)));
        var resposta = avaliacao(params, { simulado: true });
        if (window.__pc.holdSim) {
          return new Promise(function (resolve) { window.__pc.resolveSim.push(function () { resolve(resposta); }); });
        }
        return Promise.resolve(resposta);
      },
      previewPricing: function (params, signal) {
        window.__pc.calls.preview.push(JSON.parse(JSON.stringify(params)));
        window.__pc.previewSignals.push(signal || null);
        var n = window.__pc.calls.preview.length;
        var fp = ("0000000000000000000000000000000000000000000000000000000000000000" + n.toString(16)).slice(-64);
        var resposta = avaliacao(params, { preview: { id: 500 + n, expiraEm: "2026-09-29T12:10:00Z", fingerprint: fp } });
        if (window.__pc.holdPreview) {
          return new Promise(function (resolve) { window.__pc.resolvePreview.push({ id: 500 + n, tipo: params.tipo, go: function () { resolve(resposta); } }); });
        }
        return Promise.resolve(resposta);
      },
      applyPricing: function (params) {
        window.__pc.calls.apply.push(JSON.parse(JSON.stringify(params)));
        if (window.__pc.applyMode === "network-then-ok" && window.__pc.calls.apply.length === 1) {
          return Promise.resolve({ ok: false, status: 0, type: "network", error: "Falha de rede.", data: null });
        }
        if (window.__pc.applyMode === "desatualizado-then-ok" && window.__pc.calls.apply.length === 1) {
          return Promise.resolve({ ok: false, codigo: "PREVIEW_DESATUALIZADO", motivo: "O cenário mudou desde o preview.", novoPreviewNecessario: true,
            diferencas: [{ campo: "frete", antes: "20.00", agora: "24.90" }], aplicacao: { id: 901, status: "recusado" } });
        }
        if (window.__pc.applyMode === "divergente") {
          return Promise.resolve({ ok: true, divergente: true, atencao: "PRECO_CONFIRMADO_ABAIXO_BREAK_EVEN",
            aplicacao: { id: 902, status: "divergente", precoSolicitado: 114.9, precoConfirmado: 79.9, margemDepois: -0.02, lucroDepois: -1.6,
              atencaoCodigo: "PRECO_CONFIRMADO_ABAIXO_BREAK_EVEN", snapshotStatus: "nao_aplicavel", usuario: { nome: "Pedro" } } });
        }
        if (window.__pc.applyMode === "desconhecido") {
          return Promise.resolve({ ok: false, codigo: "ML_TIMEOUT", motivo: "O Mercado Livre não respondeu a tempo.",
            aplicacao: { id: 903, status: "resultado_desconhecido", execucao: "resultado_desconhecido" } });
        }
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve({ ok: true, aplicacao: { id: 900, status: "aplicado", precoSolicitado: 114.9, precoConfirmado: 114.9, snapshotStatus: "pendente", usuario: { nome: "Pedro" } }, divergente: false });
          }, 60);
        });
      },
      getPricingApplication: function (params) {
        window.__pc.calls.app.push(params.id);
        return Promise.resolve({ ok: true, aplicacao: { id: params.id, status: "aplicado", precoConfirmado: 114.9, snapshotStatus: window.__pc.calls.app.length >= 2 ? "atualizado" : "pendente" } });
      },
      getPricingHistory: function (params) {
        window.__pc.calls.hist.push(params.itemId);
        if (params.itemId !== "MLB1001") return Promise.resolve({ ok: true, itemId: params.itemId, historico: [] });
        return Promise.resolve({ ok: true, itemId: params.itemId, historico: [
          { id: 2, status: "aplicado", tipoAcao: "PRICE", precoVisto: 119.9, precoAnterior: 119.9, precoSolicitado: 114.9, precoConfirmado: 114.9, margemAntes: 0.212, margemDepois: 0.189,
            usuario: { nome: "Pedro" }, criadoEm: "2026-09-29T14:32:00Z", aplicadoEm: "2026-09-29T14:32:05Z" },
          { id: 1, status: "recusado", tipoAcao: "PROMOTION", promotionAcao: "PARTICIPAR", promotionNome: "Oferta X", precoVisto: 119.9, precoAnterior: 119.9, precoSolicitado: 109.9, precoConfirmado: null,
            margemAntes: 0.212, margemDepois: 0.15, usuario: { nome: "João" }, criadoEm: "2026-09-28T10:00:00Z", erroCodigo: "PRECO_ALTERADO", erroMensagem: "Preço alterado desde o preview. Atualize e tente novamente." },
        ] });
      },
      getOpportunities: function (params) {
        window.__pc.calls.opps.push(params.clienteContaId);
        // Promo Snapshot: primeira leitura em andamento (sem snapshot ainda).
        if (window.__pc.oppsModo === "syncing") {
          return Promise.resolve({ ok: true, disponivel: false, motivo: "SEM_SNAPSHOT_PROMOCOES",
            mensagem: "Primeira leitura das promoções desta conta em andamento (10 de 100 anúncios). A lista aparece sozinha quando terminar.",
            sync: { state: "syncing", processed: 10, total: 100, autoTrigger: "reutilizado" }, oportunidades: [] });
        }
        var stale = window.__pc.oppsModo === "stale";
        return Promise.resolve({ ok: true, disponivel: true,
          fonte: { tipo: stale ? "promo_snapshot" : undefined, geradoEm: "2026-09-29T08:00:00Z", frescor: stale ? "atencao" : "atual" },
          sync: stale ? { state: "stale", autoTrigger: "enfileirado" } : undefined,
          criterio: "Promoção disponível com margem pós-promoção positiva; ordem: com retorno ML, mais unidades vendidas, maior margem.",
          oportunidades: [
            { itemId: "MLB1002", titulo: "Produto Y", precoAtual: 149.9, margemAtual: 0.248, promocao: { nome: "Oferta Y", tipo: "DEAL" }, precoPromocao: 129.9, retornoMl: 5.2, margemDepois: 0.197, unidades: 84, receita: 12000, motivo: "retorno ML de R$ 5,20 · 84 un. vendidas no período", estimado: true },
            { itemId: "MLB9999", titulo: "Produto fora da página", precoAtual: 99.9, margemAtual: 0.2, promocao: { nome: "Oferta W", tipo: "DEAL" }, precoPromocao: 89.9, retornoMl: null, margemDepois: 0.12, unidades: 10, receita: 900, motivo: "10 un. vendidas no período", estimado: true },
          ] });
      },
    };
  })();
`;

async function run() {
  const server = await startStaticServer();
  const serverPort = server.address().port;
  const debugPort = 15000 + Math.floor(Math.random() * 1000);
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/vf-central-margem-pricing-ui-${process.pid}`, "about:blank",
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

    const PROD_HOST = "venforce-server.onrender.com";
    let contas = "two";
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
        await json({ ok: true, user: { id: 12, nome: "Pedro Gomes", email: null, role: "user" }, squads: [], squadPrincipalId: null,
          clientes: [{ id: 1, slug: "loja-teste", nome: "Loja Teste", squadId: null, responsavelDireto: false, contasAtivas: null }], portfolio: { totalClientes: 1 }, permissoes: { podeAdministrar: false } });
        return;
      }
      if (url.includes("/operacao/cliente-360/clientes")) {
        await json({ ok: true, clientes: [{ id: 1, nome: "Loja Teste", slug: "loja-teste", ativo: true, temGrant: true, grantStatus: "conectado", temBase: true, setupScore: 100, statusOperacional: "pronto", ultimaSincronizacao: null, pendencias: [] }] });
        return;
      }
      if (/\/clientes\/[^/?]+\/contas/.test(url)) {
        const conta = (id, nome) => ({ id, cliente_id: 1, marketplace: "meli", nome, slug: `ml-${id}`, external_account_id: String(id * 1000), externalAccountLabel: nome, is_primary: id === 10, ativo: true, grant: { id, token_status: "valid" }, base: { vinculo_id: id, base_id: id, nome: "Base " + id }, ultimaSync: null });
        await json({ ok: true, cliente: { id: 1, nome: "Loja Teste", slug: "loja-teste", ativo: true }, contas: contas === "two" ? [conta(10, "Loja piloto"), conta(11, "Loja secundária")] : [conta(10, "Loja piloto")] });
        return;
      }
      await respond("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" });
    };

    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem("vf-token", "ui-test-token");
      localStorage.setItem("vf-user", JSON.stringify({ nome: "Teste UI", role: "admin" }));
      ${MOCK_CLIENT}
    ` });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/central-margem.html?cliente=loja-teste` });

    const shot = async (name) => {
      if (!process.env.CM_SHOT_DIR) return;
      await sleep(250);
      const r = await cdp.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(process.env.CM_SHOT_DIR, name + ".png"), Buffer.from(r.data, "base64"));
    };
    const st = (expr) => cdp.evaluate(`(function(){var s=window.VFCentralMargemUi.getState();return ${expr};})()`);
    const drawerText = () => cdp.evaluate("document.getElementById('cm-drawer-body').textContent");
    const calls = (k) => cdp.evaluate(`window.__pc.calls.${k}.length`);
    const typePrice = (v) => cdp.evaluate(`(function(){var i=document.getElementById('cm-new-price');i.value='${v}';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);

    await waitFor(cdp, "window.VFCentralMargemUi && window.VF && window.VF.context && window.VFCentralMargemUi.getState().awaitingAccount", "Shell não pediu a conta");
    // As contas do Shell chegam depois do 1º resumo: repete até a conta entrar.
    for (let i = 0; i < 60; i += 1) {
      await cdp.evaluate("window.VF.context.setConta(10)");
      if (await cdp.evaluate("window.VFCentralMargemUi.getState().contaId === 10")) break;
      await sleep(100);
    }
    try {
      await waitFor(cdp, "window.VFCentralMargemUi.getState().mode === 'snapshot' && window.VFCentralMargemUi.getState().data && !window.VFCentralMargemUi.getState().loading && document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length === 3", "Central persistida não carregou");
    } catch (err) {
      console.error(await cdp.evaluate("JSON.stringify({mode:window.VFCentralMargemUi.getState().mode,conta:window.VFCentralMargemUi.getState().contaId,err:window.VFCentralMargemUi.getState().error,loading:window.VFCentralMargemUi.getState().loading,rows:document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length,ps:document.getElementById('cm-page-state').innerText,host:document.getElementById('cm-table-host').innerText.slice(0,300)})"));
      throw err;
    }

    await check("topo compacto usa o realizado da CONTA; zero chamadas de promoção ao carregar a tabela (sem N+1)", async () => {
      await waitFor(cdp, "window.VFCentralMargemUi.getState().realizado", "realizado não carregou");
      const top = await cdp.evaluate("document.getElementById('cm-kpis-top').innerText");
      assert.ok(top.includes("22,32%"), top);
      assert.ok(/R\$\s24\.883/.test(top) && /R\$\s5\.452/.test(top), top);
      assert.ok(top.includes("45"), top);
      assert.ok((await cdp.evaluate("document.getElementById('cm-summary-line').innerText")).includes("3 anúncios · 3 ativos · 0 pausados"));
      assert.strictEqual(await calls("promos"), 0, "a tabela nunca consulta promoções por linha");
      assert.strictEqual(await calls("sim"), 0);
      // Filtrar, buscar e trocar de visão também não chamam o ML por linha.
      const itensAntes = await cdp.evaluate("window.__pc.calls.itens");
      await cdp.evaluate("(function(){var s=document.getElementById('cm-financial-filter');s.value='LOSS';s.dispatchEvent(new Event('change'));})()");
      await waitFor(cdp, `window.__pc.calls.itens > ${itensAntes} && !window.VFCentralMargemUi.getState().loading`);
      await cdp.evaluate("(function(){var s=document.getElementById('cm-financial-filter');s.value='';s.dispatchEvent(new Event('change'));})()");
      await waitFor(cdp, "!window.VFCentralMargemUi.getState().loading && document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length === 3");
      await cdp.evaluate("document.querySelector('[data-view=composition]').click(); document.querySelector('[data-view=operational]').click();");
      assert.strictEqual(await calls("promos"), 0, "filtrar/paginar/trocar visão: 0 chamadas de promoção");
      assert.strictEqual(await calls("sim"), 0);
      await shot("10-pricing-page");
    });

    await check("oportunidades: fonte bulk da conta, sem ML por linha; Precificar abre o drawer (mesmo fora da página)", async () => {
      await waitFor(cdp, "!document.getElementById('cm-opportunities').hidden && document.querySelector('#cm-opps-host tr[data-opp]')", "oportunidades não apareceram");
      assert.deepStrictEqual(await cdp.evaluate("window.__pc.calls.opps"), [10]);
      const txt = await cdp.evaluate("document.getElementById('cm-opps-host').innerText");
      assert.ok(txt.includes("Produto Y") && txt.includes("retorno ML"), txt);
      await cdp.evaluate("document.querySelector('[data-opp-item=\"MLB9999\"]').click()");
      assert.strictEqual(await st("s.selectedItemId"), "MLB9999");
      assert.strictEqual(await st("s.drawerTab"), "pricing");
      await waitFor(cdp, "window.__pc.calls.promos.indexOf('MLB9999') !== -1", "promoções do item de Oportunidades não carregaram");
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer()");
    });

    await check("drawer abre IMEDIATAMENTE em Precificar enquanto as promoções carregam em paralelo", async () => {
      await cdp.evaluate("window.__pc.holdPromos['MLB1001'] = true");
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB1001\"] [data-open-item]').click()");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-drawer').classList.contains('is-open')"), true);
      assert.strictEqual(await st("s.drawerTab"), "pricing");
      await waitFor(cdp, "document.querySelector('[data-cm-promos=\"loading\"]')", "estado de carregamento das promoções ausente");
      assert.ok((await drawerText()).includes("Ajuste manual"), "ajuste manual disponível sem esperar o ML");
      await cdp.evaluate("window.__pc.resolvePromos['MLB1001']()");
      await waitFor(cdp, "document.querySelector('[data-cm-promos=\"list\"]')", "promoções não renderizaram");
    });

    await check("promoções: ATIVA/ELEGÍVEL/PROGRAMADA/NÃO APLICADA, seller × ML banca, margem/LC; escrita só onde é suportada", async () => {
      const statuses = await cdp.evaluate("Array.from(document.querySelectorAll('[data-promo-status]')).map(function(e){return e.getAttribute('data-promo-status')})");
      for (const s of ["ATIVA", "ELEGÍVEL", "PROGRAMADA", "NÃO APLICADA"]) assert.ok(statuses.includes(s), statuses.join(","));
      const deal = await cdp.evaluate("document.querySelector('[data-promo-id=\"P-DEAL\"]').textContent");
      for (const t of ["Seller banca", "ML banca", "R$ 14,80", "R$ 5,20", "19,7%", "R$ 25,59"]) assert.ok(deal.replace(/ /g, " ").includes(t), `falta ${t}: ${deal}`);
      assert.ok(await cdp.evaluate("Boolean(document.querySelector('[data-promo-apply=\"P-DEAL\"]'))"), "DEAL elegível → Participar");
      assert.strictEqual(await cdp.evaluate("document.querySelector('[data-promo-apply=\"P-DEAL\"]').textContent"), "Participar");
      assert.strictEqual(await cdp.evaluate("document.querySelector('[data-promo-apply=\"P-ATIVA\"]').textContent"), "Alterar");
      for (const id of ["P-PROG", "P-SMART", "P-NAO"]) {
        assert.strictEqual(await cdp.evaluate(`Boolean(document.querySelector('[data-promo-apply="${id}"]'))`), false, `${id} nunca ganha escrita`);
        assert.ok((await cdp.evaluate(`document.querySelector('[data-promo-id="${id}"]').textContent`)).includes("Somente simulação"), id);
      }
      assert.ok((await drawerText()).includes("rollout"), "rollout desligado é explícito");
      await shot("11-drawer-promos");
    });

    await check("preço manual: validação local sem chamada; debounce → 1 simulação no backend com precoVisto", async () => {
      await typePrice("114,999");
      await sleep(80);
      assert.ok((await drawerText()).includes("até duas casas"), "erro local de casas decimais");
      const antes = await calls("sim");
      await sleep(500);
      assert.strictEqual(await calls("sim"), antes, "preço inválido nunca chama o backend");
      await typePrice("114");
      await typePrice("114,9");
      await typePrice("114,90");
      await waitFor(cdp, "document.querySelector('[data-cm-sim=\"PRICE\"]')", "resultado da simulação não apareceu");
      assert.strictEqual(await calls("sim"), antes + 1, "debounce: digitação vira UMA chamada");
      const ultima = await cdp.evaluate("window.__pc.calls.sim[window.__pc.calls.sim.length-1]");
      assert.strictEqual(ultima.novoPreco, 114.9);
      assert.strictEqual(ultima.precoVisto, 110.48);
      assert.strictEqual(ultima.clienteContaId, 10);
      assert.strictEqual(ultima.tipo, "PRICE");
      const res = (await cdp.evaluate("document.getElementById('cm-pp-result').textContent")).replace(/ /g, " ");
      for (const t of ["R$ 110,48", "R$ 114,90", "19,16%", "22,04%", "R$ 21,17", "R$ 25,33", "+4"]) assert.ok(res.includes(t), `falta ${t}: ${res}`);
      assert.ok(res.includes("Margem abaixo da meta"), "gates relevantes aparecem inline");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-pp-review').disabled"), false);
      assert.ok((await cdp.evaluate("document.getElementById('cm-drawer-summary').textContent")).includes("confirmado ao vivo"));
    });

    await check("simulação: resposta velha (digitação anterior) nunca sobrescreve a nova", async () => {
      await cdp.evaluate("window.__pc.holdSim = true");
      await typePrice("120,00");
      await waitFor(cdp, "window.__pc.resolveSim.length === 1", "1ª simulação não ficou pendente");
      await typePrice("100,00");
      await waitFor(cdp, "window.__pc.resolveSim.length === 2", "2ª simulação não ficou pendente");
      await cdp.evaluate("window.__pc.resolveSim[1]()");
      await waitFor(cdp, "document.getElementById('cm-pp-result').textContent.indexOf('100,00') !== -1", "resultado da 2ª não apareceu");
      await cdp.evaluate("window.__pc.resolveSim[0]()");
      await sleep(150);
      const res = await cdp.evaluate("document.getElementById('cm-pp-result').textContent");
      assert.ok(res.includes("100,00") && !res.includes("120,00"), `resposta velha vazou: ${res}`);
      await cdp.evaluate("window.__pc.holdSim = false; window.__pc.resolveSim = []");
      await typePrice("114,90");
      await waitFor(cdp, "document.getElementById('cm-pp-result').textContent.indexOf('114,90') !== -1");
    });

    await check("preview da alteração: produto, conta, antes → depois, gates; rollout OFF bloqueia o botão final (zero escrita)", async () => {
      await cdp.evaluate("document.getElementById('cm-pp-review').click()");
      await waitFor(cdp, "document.getElementById('cm-confirm-overlay').classList.contains('is-open') && document.querySelector('#cm-confirm-body .cm-confirm__table')", "preview não abriu");
      const body = (await cdp.evaluate("document.getElementById('cm-confirm-body').textContent")).replace(/ /g, " ");
      for (const t of ["Produto X", "MLB1001", "Conta Loja piloto", "Mercado Livre 10000", "R$ 110,48", "R$ 114,90", "19,16%", "22,04%", "84 un.", "Conta correta", "Acima do break-even", "Margem abaixo da meta"]) {
        assert.ok(body.includes(t), `falta ${t}: ${body}`);
      }
      assert.ok(await cdp.evaluate("Boolean(document.querySelector('[data-cm-rollout=\"off\"]'))"), "aviso de rollout");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-confirm-apply').disabled"), true);
      await cdp.evaluate("document.getElementById('cm-confirm-apply').click()");
      assert.strictEqual(await calls("apply"), 0, "rollout desligado: nenhuma chamada de aplicar");
      const pv = await cdp.evaluate("window.__pc.calls.preview[0]");
      assert.strictEqual(pv.precoVisto, 110.48);
      assert.strictEqual(pv.novoPreco, 114.9);
      await shot("12-preview-rollout-off");
      await cdp.evaluate("document.getElementById('cm-confirm-cancel').click()");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-confirm-overlay').classList.contains('is-open')"), false);
    });

    await check("gate bloqueante (break-even) desabilita a confirmação mesmo com rollout ligado", async () => {
      await cdp.evaluate("window.__pc.escritaHabilitada = true");
      await typePrice("70,00");
      await waitFor(cdp, "document.getElementById('cm-pp-result').textContent.indexOf('Abaixo do break-even') !== -1", "gate bloqueante não apareceu inline");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-pp-review').disabled"), true, "revisar fica bloqueado com gate vermelho");
      await cdp.evaluate("window.__pc.previewBloqueado = true");
      await typePrice("114,90");
      await waitFor(cdp, "document.querySelector('[data-cm-sim=\"PRICE\"]') && document.getElementById('cm-pp-result').textContent.indexOf('114,90') !== -1");
      await cdp.evaluate("window.__pc.previewBloqueado = false");
      await typePrice("114,90 ");
      await typePrice("114,90");
      await waitFor(cdp, "document.getElementById('cm-pp-review').disabled === false", "revisar voltou a habilitar");
    });

    await check("confirmar: duplo clique = 1 escrita com a MESMA chave; sucesso mostra o preço confirmado e acompanha o snapshot", async () => {
      const itensAntes = await cdp.evaluate("window.__pc.calls.itens");
      await cdp.evaluate("document.getElementById('cm-pp-review').click()");
      await waitFor(cdp, "document.getElementById('cm-confirm-apply').disabled === false", "confirmação não habilitou com rollout ligado");
      await cdp.evaluate("var b=document.getElementById('cm-confirm-apply'); b.click(); b.click(); b.click();");
      await waitFor(cdp, "document.querySelector('[data-cm-apply-result=\"aplicado\"]')", "sucesso não apareceu");
      assert.strictEqual(await calls("apply"), 1, "duplo clique nunca gera 2 escritas");
      const ap = await cdp.evaluate("window.__pc.calls.apply[0]");
      assert.ok(/^cm-/.test(ap.idempotencyKey) && ap.idempotencyKey.length >= 8, ap.idempotencyKey);
      assert.strictEqual(ap.clienteContaId, 10);
      assert.ok(ap.previewId > 500);
      const pvMostrado = await st("s.confirm.preview.preview");
      assert.strictEqual(ap.previewId, pvMostrado.id);
      assert.strictEqual(ap.fingerprint, pvMostrado.fingerprint, "o aplicar devolve o fingerprint do preview EXIBIDO");
      assert.ok((await cdp.evaluate("document.getElementById('cm-confirm-body').textContent")).replace(/ /g, " ").includes("R$ 114,90"));
      await shot("13-aplicado");
      await cdp.evaluate("document.getElementById('cm-confirm-cancel').click()");
      await waitFor(cdp, "document.querySelector('[data-cm-pos-escrita=\"atualizado\"]')", "pós-escrita não chegou a 'margem atualizada'");
      await waitFor(cdp, `window.__pc.calls.itens > ${itensAntes}`, "a página não foi relida depois do snapshot novo");
    });

    await check("erro de rede no aplicar: 'Tentar de novo' reusa a MESMA chave (sem escrita dupla)", async () => {
      await cdp.evaluate("window.__pc.applyMode = 'network-then-ok'; window.__pc.calls.apply = []");
      await typePrice("115,90");
      await waitFor(cdp, "document.getElementById('cm-pp-result').textContent.indexOf('115,90') !== -1 && document.getElementById('cm-pp-review').disabled === false");
      await cdp.evaluate("document.getElementById('cm-pp-review').click()");
      await waitFor(cdp, "document.getElementById('cm-confirm-apply').disabled === false");
      await cdp.evaluate("document.getElementById('cm-confirm-apply').click()");
      await waitFor(cdp, "document.getElementById('cm-confirm-apply').textContent === 'Tentar de novo'", "retry não foi oferecido");
      await cdp.evaluate("document.getElementById('cm-confirm-apply').click()");
      await waitFor(cdp, "document.querySelector('[data-cm-apply-result=\"aplicado\"]')", "retry não concluiu");
      const keys = await cdp.evaluate("window.__pc.calls.apply.map(function(c){return c.idempotencyKey})");
      assert.strictEqual(keys.length, 2);
      assert.strictEqual(keys[0], keys[1], "retry de rede usa a mesma chave de idempotência");
      await cdp.evaluate("window.__pc.applyMode = 'ok'; document.getElementById('cm-confirm-cancel').click()");
    });


    const abrirRevisaoPreco = async (valor) => {
      await typePrice(valor);
      await waitFor(cdp, `document.getElementById('cm-pp-result').textContent.indexOf('${valor}') !== -1 && document.getElementById('cm-pp-review').disabled === false`, "simulação não habilitou revisar");
      await cdp.evaluate("document.getElementById('cm-pp-review').click()");
    };

    await check("20. preview A responde DEPOIS do preview B: a resposta de A nunca preenche B (e o pedido de A é abortado)", async () => {
      await cdp.evaluate("window.__pc.holdPreview = true; window.__pc.resolvePreview = []; window.__pc.previewSignals = []");
      await abrirRevisaoPreco("116,90");
      await waitFor(cdp, "window.__pc.resolvePreview.length === 1", "preview A não foi pedido");
      await cdp.evaluate("document.getElementById('cm-confirm-cancel').click()");
      assert.strictEqual(await cdp.evaluate("window.__pc.previewSignals[0] && window.__pc.previewSignals[0].aborted"), true, "fechar aborta o preview em voo");
      await cdp.evaluate("document.querySelector('[data-promo-apply=\"P-DEAL\"]').click()");
      await waitFor(cdp, "window.__pc.resolvePreview.length === 2", "preview B não foi pedido");
      // B responde primeiro, A por último.
      await cdp.evaluate("window.__pc.resolvePreview[1].go()");
      await waitFor(cdp, "document.querySelector('#cm-confirm-body .cm-confirm__table')", "preview B não renderizou");
      await cdp.evaluate("window.__pc.resolvePreview[0].go()");
      await sleep(150);
      assert.strictEqual(await st("s.confirm.kind"), "PROMOTION");
      assert.strictEqual(await st("s.confirm.preview.preview.id"), await cdp.evaluate("window.__pc.resolvePreview[1].id"));
      assert.ok((await cdp.evaluate("document.getElementById('cm-confirm-body').textContent")).includes("Participar de:"));
      await cdp.evaluate("document.getElementById('cm-confirm-cancel').click()");
      // Variante sem fechar: B substitui A enquanto A ainda carrega.
      await cdp.evaluate("window.__pc.resolvePreview = []; window.__pc.previewSignals = []");
      await abrirRevisaoPreco("117,90");
      await waitFor(cdp, "window.__pc.resolvePreview.length === 1");
      await cdp.evaluate("window.VFCentralMargemUi.getState().confirm.status = 'loading'");
      await cdp.evaluate("document.querySelector('[data-promo-apply=\"P-DEAL\"]').click()");
      await waitFor(cdp, "window.__pc.resolvePreview.length === 2");
      await cdp.evaluate("window.__pc.resolvePreview[0].go()");
      await sleep(150);
      assert.strictEqual(await st("s.confirm.status"), "loading", "A não pode preencher a confirmação B");
      await cdp.evaluate("window.__pc.resolvePreview[1].go()");
      await waitFor(cdp, "window.VFCentralMargemUi.getState().confirm.status === 'ready'");
      assert.strictEqual(await st("s.confirm.kind"), "PROMOTION");
      await cdp.evaluate("window.__pc.holdPreview = false; document.getElementById('cm-confirm-cancel').click()");
    });

    await check("PREVIEW_DESATUALIZADO no aplicar: pede NOVO preview, avisa o que mudou, troca a chave e exige nova confirmação", async () => {
      await cdp.evaluate("window.__pc.applyMode = 'desatualizado-then-ok'; window.__pc.calls.apply = []");
      const previewsAntes = await calls("preview");
      await abrirRevisaoPreco("118,90");
      await waitFor(cdp, "document.getElementById('cm-confirm-apply').disabled === false");
      const chave1 = await st("s.confirm.idempotencyKey");
      await cdp.evaluate("document.getElementById('cm-confirm-apply').click()");
      await waitFor(cdp, "document.querySelector('[data-cm-preview-novo]')", "aviso de novo preview não apareceu");
      await waitFor(cdp, "window.VFCentralMargemUi.getState().confirm.status === 'ready'");
      assert.strictEqual(await calls("preview"), previewsAntes + 2, "um preview NOVO foi pedido automaticamente");
      assert.strictEqual(await calls("apply"), 1, "nada foi reaplicado sem nova confirmação");
      assert.ok((await cdp.evaluate("document.querySelector('[data-cm-preview-novo]').textContent")).includes("frete"));
      const chave2 = await st("s.confirm.idempotencyKey");
      assert.notStrictEqual(chave1, chave2, "preview novo = chave nova");
      await cdp.evaluate("document.getElementById('cm-confirm-apply').click()");
      await waitFor(cdp, "document.querySelector('[data-cm-apply-result=\"aplicado\"]')");
      const aps = await cdp.evaluate("window.__pc.calls.apply");
      assert.strictEqual(aps.length, 2);
      assert.notStrictEqual(aps[0].previewId, aps[1].previewId);
      assert.notStrictEqual(aps[0].fingerprint, aps[1].fingerprint);
      await cdp.evaluate("window.__pc.applyMode = 'ok'; document.getElementById('cm-confirm-cancel').click()");
    });

    await check("preço confirmado divergente: banner de atenção com solicitado × confirmado e margem no confirmado", async () => {
      await cdp.evaluate("window.__pc.applyMode = 'divergente'");
      await abrirRevisaoPreco("119,90");
      await waitFor(cdp, "document.getElementById('cm-confirm-apply').disabled === false");
      await cdp.evaluate("document.getElementById('cm-confirm-apply').click()");
      await waitFor(cdp, "document.querySelector('[data-cm-apply-result=\"divergente\"]')", "banner de divergência ausente");
      const txt = (await cdp.evaluate("document.querySelector('[data-cm-apply-result=\"divergente\"]').textContent")).replace(/\u00a0/g, " ");
      assert.ok(txt.includes("R$ 114,90") && txt.includes("R$ 79,90"), txt);
      assert.ok(/break-even/.test(txt), txt);
      assert.strictEqual(await cdp.evaluate("Boolean(document.querySelector('[data-cm-apply-result=\"aplicado\"]'))"), false, "nunca como sucesso normal");
      await cdp.evaluate("window.__pc.applyMode = 'ok'; document.getElementById('cm-confirm-cancel').click()");
    });

    await check("resultado desconhecido (timeout do ML): alerta para conferir o anúncio e NÃO oferece retry", async () => {
      await cdp.evaluate("window.__pc.applyMode = 'desconhecido'");
      await abrirRevisaoPreco("121,90");
      await waitFor(cdp, "document.getElementById('cm-confirm-apply').disabled === false");
      await cdp.evaluate("document.getElementById('cm-confirm-apply').click()");
      await waitFor(cdp, "document.querySelector('[data-cm-apply-result=\"resultado_desconhecido\"]')", "estado desconhecido não apareceu");
      assert.ok((await cdp.evaluate("document.getElementById('cm-confirm-body').textContent")).includes("Confira o anúncio"));
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-confirm-apply').disabled"), true);
      await cdp.evaluate("window.__pc.applyMode = 'ok'; document.getElementById('cm-confirm-cancel').click()");
    });

    await check("promoção: Participar abre o preview com tipo PROMOTION, desconto total, ML banca e seller banca", async () => {
      await cdp.evaluate("document.querySelector('[data-promo-apply=\"P-DEAL\"]').click()");
      await waitFor(cdp, "document.querySelector('#cm-confirm-body .cm-confirm__table')", "preview da promoção não abriu");
      const pv = await cdp.evaluate("window.__pc.calls.preview[window.__pc.calls.preview.length-1]");
      assert.strictEqual(pv.tipo, "PROMOTION");
      assert.strictEqual(pv.promotionId, "P-DEAL");
      const body = (await cdp.evaluate("document.getElementById('cm-confirm-body').textContent")).replace(/ /g, " ");
      for (const t of ["Participar de:", "Desconto total", "R$ 20,00", "ML banca", "R$ 5,20", "Seller banca", "R$ 14,80"]) assert.ok(body.includes(t), `falta ${t}: ${body}`);
      await shot("14-preview-promo");
      await cdp.evaluate("document.getElementById('cm-confirm-cancel').click()");
    });

    await check("histórico: quem, quando, preço antes → depois, margem e status; outro item mostra estado vazio", async () => {
      await cdp.evaluate("document.querySelector('[data-tab=history]').click()");
      await waitFor(cdp, "document.querySelector('[data-cm-hist=\"aplicado\"]')", "histórico não carregou");
      const txt = (await drawerText()).replace(/ /g, " ");
      for (const t of ["Pedro", "Aplicado no Mercado Livre", "R$ 119,90", "R$ 114,90", "21,2%", "18,9%", "João", "Participou de: Oferta X", "Recusado", "PRECO_ALTERADO"]) {
        assert.ok(txt.includes(t), `falta ${t}: ${txt}`);
      }
      await shot("15-historico");
      await cdp.evaluate("document.getElementById('cm-drawer-next').click()");
      await cdp.evaluate("document.querySelector('[data-tab=history]').click()");
      await waitFor(cdp, "document.querySelector('[data-cm-hist-empty]')", "estado vazio do histórico ausente");
    });

    await check("troca rápida de item: promoções do item anterior que chegam tarde nunca aparecem no novo", async () => {
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer(); window.__pc.holdPromos['MLB1001'] = true");
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB1001\"] [data-open-item]').click()");
      await waitFor(cdp, "typeof window.__pc.resolvePromos['MLB1001'] === 'function'");
      await cdp.evaluate("document.getElementById('cm-drawer-next').click()");
      await waitFor(cdp, "window.VFCentralMargemUi.getState().selectedItemId === 'MLB1002' && document.querySelector('[data-cm-promos=\"list\"]')", "item B não carregou suas promoções");
      await cdp.evaluate("window.__pc.resolvePromos['MLB1001']()");
      await sleep(150);
      assert.strictEqual(await st("s.selectedItemId"), "MLB1002");
      const txt = await drawerText();
      assert.ok(txt.includes("Oferta MLB1002") && !txt.includes("Oferta MLB1001"), "promoção do item anterior vazou para o novo");
    });

    await check("preço mudou no ML desde a leitura da tabela: a tela mostra o vivo, avisa e usa-o como precoVisto", async () => {
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer(); window.__pc.livePrice['MLB1003'] = 62");
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB1003\"] [data-open-item]').click()");
      await waitFor(cdp, "document.querySelector('[data-cm-live-price]')", "aviso de preço vivo diferente ausente");
      const aviso = (await cdp.evaluate("document.querySelector('[data-cm-live-price]').textContent")).replace(/\u00a0/g, " ");
      assert.ok(aviso.includes("R$ 59,90") && aviso.includes("R$ 62,00"), aviso);
      await typePrice("65,00");
      await waitFor(cdp, "document.querySelector('[data-cm-sim=\"PRICE\"]')", "simulação não voltou");
      const ultima = await cdp.evaluate("window.__pc.calls.sim[window.__pc.calls.sim.length-1]");
      assert.strictEqual(ultima.precoVisto, 62, "o preço exibido (vivo) é o precoVisto — nunca o da tabela defasada");
      assert.ok((await cdp.evaluate("document.getElementById('cm-drawer-summary').textContent")).replace(/\u00a0/g, " ").includes("R$ 62,00"));
      await cdp.evaluate("delete window.__pc.livePrice['MLB1003']");
    });

    await check("troca de conta fecha o drawer e descarta promoções em voo da conta anterior", async () => {
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer(); window.__pc.holdPromos['MLB1003'] = true");
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB1003\"] [data-open-item]').click()");
      await waitFor(cdp, "typeof window.__pc.resolvePromos['MLB1003'] === 'function'");
      await cdp.evaluate("window.VF.context.setConta(11)");
      await waitFor(cdp, "window.VFCentralMargemUi.getState().contaId === 11", "conta 11 não entrou");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-drawer').classList.contains('is-open')"), false);
      await cdp.evaluate("window.__pc.resolvePromos['MLB1003']()");
      await sleep(150);
      assert.strictEqual(await st("s.promos"), null, "resposta da conta anterior não reidrata o estado");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-drawer-body').innerHTML"), "");
    });

    await check("oportunidades pelo Promo Snapshot: sincronizando mostra o estado (sem mandar para a tela antiga); stale serve a lista e avisa", async () => {
      await cdp.evaluate("window.__pc.oppsModo = 'syncing'; window.VF.context.setConta(10)");
      await waitFor(cdp, "document.querySelector('[data-cm-opps=\"indisponivel\"][data-cm-opps-sync=\"syncing\"]')", "estado de sincronização não apareceu");
      const host = await cdp.evaluate("document.getElementById('cm-opportunities').innerText");
      assert.ok(host.includes("Primeira leitura das promoções") && host.includes("atualizando (10/100)"), host);
      assert.strictEqual(await cdp.evaluate("Boolean(document.querySelector('#cm-opps-host a[href=\"promocoes-retorno.html\"]'))"), false, "não depende mais da tela Promoções ML");
      assert.ok(await cdp.evaluate("Boolean(window.VFCentralMargemUi.getState().oppsPollTimer)"), "relê a lista enquanto sincroniza");
      await cdp.evaluate("window.__pc.oppsModo = 'stale'; window.VF.context.setConta(11)");
      await waitFor(cdp, "document.querySelector('#cm-opps-host tr[data-opp]')", "lista do snapshot stale não apareceu");
      const meta = await cdp.evaluate("document.getElementById('cm-opportunities').innerText");
      assert.ok(meta.includes("promoções de") && meta.includes("desatualizado, atualizando"), meta);
    });

    console.log(`# ${checks} smoke tests de UI (precificação) concluídos`);
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
