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
        margin: it.id === "MLB1003" ? { target: { marginTarget: 0.1, price: 79.9, computable: true } } : undefined,
        sales: { hasOrders: true, unidades: 21, pedidos: 20, receita: 2333, precoMedio: 111.1 },
        settlement: { available: false },
      };
    }

    var PRECO_TABELA = { MLB1001: 110.48, MLB1002: 149.9, MLB1003: 59.9, MLB9999: 99.9 };
    function precoVivo(itemId) { return window.__pc.livePrice[itemId] != null ? window.__pc.livePrice[itemId] : PRECO_TABELA[itemId]; }
    window.__pc = {
      livePrice: {},
      calls: { itens: 0, simular: [], preview: [], apply: [], app: [], hist: [], opps: [] },
      holdBancada: {}, resolveBancada: {},     // bootstrap (todas_promos) por anúncio
      holdSim: false, resolveSim: [],          // preço manual (cenário preco)
      simularFalha: false, alvoModo: "ok",     // ok | sem-preco-viavel
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

    // --- Respostas do /simular (fixtures; nenhuma regra de negócio do front) ---
    function r2(v) { return Math.round(v * 100) / 100; }
    function lin(p, o) {
      o = o || {};
      var imp = r2(p * 0.1), com = r2(p * 0.12), fr = o.frete == null ? 15 : o.frete, reb = o.rebate || 0, custo = 50;
      var lc = r2(p - imp - com - fr - custo + reb);
      return { preco: p, imposto: imp, comissao: com, frete: fr, taxa_fixa: 0, custo: custo, rebate: reb, lc: lc, margem_ratio: Math.round((lc / p) * 10000) / 10000 };
    }
    var LINHA_VAZIA = { preco: null, imposto: null, comissao: null, frete: null, taxa_fixa: null, custo: null, rebate: null, lc: null, margem_ratio: null };
    function evidenciaCot(promo) {
      var e = { comissao: { fonte: "ml_listing_prices", consultado_em: "2026-10-14T15:00:00Z" }, frete: { fonte: "ml_shipping_options_free", consultado_em: "2026-10-14T15:00:00Z" } };
      e.preco = promo ? { fonte: "promo_snapshot", observado_em: "2026-10-14T08:00:00Z" } : { fonte: "informado", consultado_em: null };
      return e;
    }
    function resCenario(tipo, entrada, atual, cen, over) {
      var ok = cen && cen.lc !== null;
      var r = Object.assign({
        tipo: tipo, entrada: entrada, veredito: "entrar", motivo: null, motivos: [],
        flags: { ativa: false, sem_desconto_efetivo: false, mudou_faixa_frete: ok ? cen.frete !== atual.frete : null, rebate_ambiguo: false },
        atual: atual, cenario: cen || LINHA_VAZIA, desconto: null, ml_banca: null, seller_banca: null,
        delta_lc: ok ? r2(cen.lc - atual.lc) : null,
        delta_margem_ratio: ok ? Math.round((cen.margem_ratio - atual.margem_ratio) * 10000) / 10000 : null,
        empate_volume: ok && cen.lc > 0 ? Math.round((atual.lc / cen.lc - 1) * 10000) / 10000 : null,
        meta: { margem_alvo: 0.1, margem_minima: 0 }, evidencia: evidenciaCot(tipo === "promo"),
      }, over || {});
      return r;
    }
    function bloqueadoCen(tipo, entrada, atual, motivo, over) {
      return resCenario(tipo, entrada, atual, null, Object.assign({ veredito: "bloqueado", motivo: motivo, motivos: [motivo], evidencia: null }, over || {}));
    }
    function promoPublica(pr) {
      return { id: pr.id, chave: pr.id + "::" + pr.tipo, tipo: pr.tipo, nome: pr.nome, status: pr.status, status_exibicao: pr.statusExibicao, inicio: pr.inicio, fim: pr.fim, preco_original: pr.precoOriginal, preco_final: pr.precoFinal };
    }
    function cenarioDaPromo(pr, atual) {
      var entrada = { tipo: "promo", promotion_id: pr.id };
      var pub = promoPublica(pr);
      var r;
      if (pr.id === "P-ATIVA") r = bloqueadoCen("promo", entrada, atual, "promocao_ativa", { flags: { ativa: true, sem_desconto_efetivo: false, mudou_faixa_frete: null, rebate_ambiguo: false } });
      else if (pr.id === "P-NAO") r = bloqueadoCen("promo", entrada, atual, "promocao_sem_preco");
      else if (pr.id === "P-DEAL") r = resCenario("promo", entrada, atual, lin(99.9, { rebate: 5.2 }), { veredito: "entrar_se_girar", motivo: "lc_por_unidade_cai", desconto: 10.58, ml_banca: 5.2, seller_banca: 5.38 });
      else if (pr.id === "P-SMART") r = resCenario("promo", entrada, atual, lin(108.9, { rebate: 3 }), { veredito: "entrar", desconto: 1.58, ml_banca: 3, seller_banca: 0 });
      else r = resCenario("promo", entrada, atual, lin(95, { frete: 24.9 }), { veredito: "nao_entrar", motivo: "lc_nao_positivo", desconto: 15.48, ml_banca: 0, seller_banca: 15.48 });
      r.promocao = pub;
      return r;
    }
    function simularResposta(mlb, cenarios) {
      var atualLin = lin(PRECO_TABELA[mlb]);
      var saida = [];
      cenarios.forEach(function (c) {
        if (c.tipo === "todas_promos") promosDe(mlb).forEach(function (pr) { saida.push(cenarioDaPromo(pr, atualLin)); });
        else if (c.tipo === "preco") {
          if (c.preco < 70) saida.push(bloqueadoCen("preco", { tipo: "preco", preco: c.preco }, atualLin, "comissao_indisponivel"));
          else saida.push(resCenario("preco", { tipo: "preco", preco: c.preco }, atualLin, lin(c.preco), { veredito: c.preco >= atualLin.preco ? "entrar" : "entrar_se_girar" }));
        } else if (c.tipo === "preco_alvo") {
          saida.push(window.__pc.alvoModo === "sem-preco-viavel"
            ? { tipo: "preco_alvo", entrada: c, veredito: "bloqueado", motivo: "sem_preco_viavel", preco_alvo: { encontrado: false, preco: null, motivo: "sem_preco_viavel", causa: "meta_inviavel", margem_alvo: 0.1 } }
            : { tipo: "preco_alvo", entrada: c, veredito: "entrar", preco_alvo: { encontrado: true, preco: 81.5, motivo: null, margem_alvo: 0.1, iteracoes: 2 }, evidencia: { preco: { fonte: "busca_preco_alvo" } } });
        }
      });
      return {
        ok: true, mlb: mlb, item: { mlb: mlb },
        atual: Object.assign({ bloqueios: [], rebate_motivo: null }, atualLin),
        meta: { margem_alvo: 0.1, margem_minima: 0 },
        promocoes: cenarios.some(function (c) { return c.tipo === "todas_promos"; }) ? { disponivel: true, motivo: null, snapshot_em: "2026-10-14T08:00:00Z", parcial: false } : null,
        cotacoes: { consultas: 3, precos_distintos: 3, limite_excedido: 0, maximo_por_requisicao: 40 },
        cenarios: saida,
      };
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

      // POST /api/margem/simular: números prontos (o Motor é do servidor); a tela só mostra.
      simular: function (params, signal) {
        var copia = JSON.parse(JSON.stringify(params));
        window.__pc.calls.simular.push(copia);
        var mlb = params.mlb;
        var cen0 = (params.cenarios || [])[0] || {};
        if (window.__pc.simularFalha) return Promise.resolve({ ok: false, status: 502, error: "Mercado Livre fora do ar." });
        var resposta = simularResposta(mlb, params.cenarios || []);
        if (cen0.tipo === "todas_promos" && window.__pc.holdBancada[mlb]) {
          return new Promise(function (resolve) { window.__pc.resolveBancada[mlb] = function () { delete window.__pc.holdBancada[mlb]; resolve(resposta); }; });
        }
        if (cen0.tipo === "preco" && window.__pc.holdSim) {
          return new Promise(function (resolve) {
            // O abort chega tarde (a resposta já estava a caminho): a tela precisa ignorá-la sozinha.
            window.__pc.resolveSim.push(function () { resolve(resposta); });
          });
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
        (window.__pc.calls.oppsParams = window.__pc.calls.oppsParams || []).push({ conta: params.clienteContaId, page: params.page, limit: params.limit, cotacao: params.cotacao, veredito: params.veredito, tipo: params.tipo });
        var viva = params.cotacao === "viva";
        // Resumo para o KPI "Promos com +LC" e os chips da worklist: só os anúncios que valem entrar.
        if (params.veredito === "entrar" && params.limit === 50 && !viva) {
          return Promise.resolve({ ok: true, disponivel: true, page: 1, limit: 50, total: 2, hasNext: false,
            fonte: { tipo: "promo_snapshot", geradoEm: "2026-09-29T08:00:00Z", frescor: "atual" },
            resumo: { entrar: 2, impacto_lc: 123.4, com_historico: 1, sem_historico: 1 }, tipos: [{ tipo: "DEAL", total: 2 }], cotacao: { modo: "estimada" },
            oportunidades: [{ itemId: "MLB1001", titulo: "Produto X", promocao: { id: "P-DEAL", nome: "Oferta MLB1001", tipo: "DEAL", status: "candidate" }, veredito: "entrar", delta_lc: 1.9, flags: {}, estimado: true, atual: {}, cenario: {}, opcoes_total: 1, opcoes: [] }] });
        }
        function opp(itemId, titulo, over) {
          return Object.assign({
            itemId: itemId, titulo: titulo, imagem: null, precoAtual: 149.9, margemAtual: 0.248, margemAtualRebate: null,
            promocao: { id: "P-" + itemId, chave: "P-" + itemId + "::DEAL", nome: "Oferta", tipo: "DEAL", status: "candidate", herdada: false },
            precoPromocao: 129.9, retornoMl: 5.2, margemDepois: 0.197, lucroDepois: 35, unidades: 84, receita: 12000, motivo: "", estimado: !viva,
            veredito: "entrar_se_girar", veredito_motivo: "lc_por_unidade_cai", bloqueios: [], delta_lc: -2.1, empate_volume: 0.018, desconto: 20, ml_banca: 5.2, seller_banca: 14.8,
            flags: { ativa: false, sem_desconto_efetivo: false, mudou_faixa_frete: null, rebate_ambiguo: false, sem_historico: false },
            atual: { preco: 149.9, lc: 37.1, margem_ratio: 0.248, frete: 12 }, cenario: { preco: 129.9, lc: 35, margem_ratio: 0.197, frete: 12 },
            cotacao: { ao_vivo: viva }, opcoes_total: 1, opcoes: [],
          }, over || {});
        }
        // Paginação do SERVIDOR: 45 oportunidades, a página vem pronta.
        if (window.__pc.oppsModo === "paginado") {
          var total = 45;
          var ini = (params.page - 1) * params.limit;
          var itens = [];
          for (var k = ini; k < Math.min(ini + params.limit, total); k += 1) {
            itens.push(opp("MLBP" + (k + 1), "Pag " + (k + 1), { precoAtual: 100, margemAtual: 0.2, promocao: { id: "PP" + k, nome: "Oferta", tipo: "DEAL", herdada: k === 0, observadaEm: "2026-09-29T06:00:00Z" },
              precoPromocao: 90, retornoMl: null, margemDepois: 0.1, unidades: 1, receita: 90 }));
          }
          return Promise.resolve({ ok: true, disponivel: true, fonte: { tipo: "promo_snapshot", geradoEm: "2026-09-29T08:00:00Z", frescor: "atual", parcial: true, itensHerdados: 1 },
            sync: { state: "partial", autoTrigger: "nenhuma" }, criterio: "c.", page: params.page, limit: params.limit, total: total, hasNext: ini + params.limit < total, oportunidades: itens, tipos: [{ tipo: "DEAL", total: 45 }], cotacao: { modo: viva ? "viva" : "estimada" } });
        }
        // Promo Snapshot: primeira leitura em andamento (sem snapshot ainda).
        if (window.__pc.oppsModo === "syncing") {
          return Promise.resolve({ ok: true, disponivel: false, motivo: "SEM_SNAPSHOT_PROMOCOES",
            mensagem: "Primeira leitura das promoções desta conta em andamento (10 de 100 anúncios). A lista aparece sozinha quando terminar.",
            sync: { state: "syncing", processed: 10, total: 100, autoTrigger: "reutilizado" }, oportunidades: [] });
        }
        // Fonte legada (enquanto existir): com a data real do diagnóstico e, sem ela, "data desconhecida".
        if (window.__pc.oppsModo === "legado" || window.__pc.oppsModo === "legado-sem-data") {
          return Promise.resolve({ ok: true, disponivel: true,
            fonte: { tipo: "diagnostico_legado", geradoEm: window.__pc.oppsModo === "legado" ? "2026-09-29T08:00:00Z" : null, frescor: "atual" },
            vendas: { realizado: null, realizado_motivo: "CENTRAL_VENDAS_FALHOU" },
            criterio: "c.", page: 1, limit: 20, total: 1, hasNext: false, tipos: [{ tipo: "DEAL", total: 1 }],
            oportunidades: [opp("MLBL1", "Legado 1", { precoAtual: 100, margemAtual: 0.2, precoPromocao: 90, retornoMl: null, margemDepois: 0.1, unidades: null, receita: null })] });
        }
        // Falha da cotação ao vivo: a estimativa continua na tela.
        if (viva && window.__pc.oppsVivaFalha) return Promise.resolve({ ok: false, status: 502, error: "ML fora" });
        var stale = window.__pc.oppsModo === "stale";
        var lista = [
          opp("MLB1002", "Produto Y", {
            promocao: { id: "P-Y1", chave: "P-Y1::DEAL", nome: "Oferta Y", tipo: "DEAL", status: "candidate" }, opcoes_total: 3,
            flags: { ativa: false, sem_desconto_efetivo: false, mudou_faixa_frete: viva ? true : null, rebate_ambiguo: false, sem_historico: false },
            cenario: { preco: 129.9, lc: 35, margem_ratio: 0.197, frete: viva ? 0 : 12 }, motivo: "retorno ML de R$ 5,20 · 84 un. vendidas no período",
            opcoes: [
              { promocao: { id: "P-Y2", nome: "Oferta Y2", tipo: "SMART", status: "candidate" }, precoPromocao: 135.9, retornoMl: 0, veredito: "nao_entrar", veredito_motivo: "lc_nao_positivo", delta_lc: -9.4, margemDepois: 0.05, lucroDepois: 7, seller_banca: 14, ml_banca: 0, flags: {}, estimado: !viva },
              { promocao: { id: "P-Y3", nome: "Oferta Y3", tipo: "DEAL", status: "pending" }, precoPromocao: 139.9, retornoMl: 0, veredito: "entrar_se_girar", veredito_motivo: "lc_por_unidade_cai", delta_lc: -5, margemDepois: 0.15, lucroDepois: 21, seller_banca: 10, ml_banca: 0, flags: {}, estimado: !viva },
            ] }),
          opp("MLB9999", "Produto fora da página", viva
            ? { veredito: "bloqueado", veredito_motivo: "comissao_indisponivel", bloqueios: ["comissao_indisponivel"], delta_lc: null, empate_volume: null, margemDepois: null, lucroDepois: null,
                cenario: { preco: 89.9, lc: null, margem_ratio: null, frete: null }, flags: { ativa: false, sem_desconto_efetivo: false, mudou_faixa_frete: null, rebate_ambiguo: false, sem_historico: false }, precoAtual: 99.9, precoPromocao: 89.9, retornoMl: null, unidades: 10, receita: 900, motivo: "10 un. vendidas no período" }
            : { precoAtual: 99.9, margemAtual: 0.2, promocao: { id: "P-W", nome: "Oferta W", tipo: "DEAL", status: "candidate" }, precoPromocao: 89.9, retornoMl: null, margemDepois: 0.12, unidades: 10, receita: 900, motivo: "10 un. vendidas no período",
                flags: { ativa: false, sem_desconto_efetivo: false, mudou_faixa_frete: null, rebate_ambiguo: false, sem_historico: false } }),
          opp("MLB7777", "Sem histórico", { unidades: 0, flags: { ativa: false, sem_desconto_efetivo: false, mudou_faixa_frete: null, rebate_ambiguo: false, sem_historico: true } }),
        ];
        // O servidor refaz a ordem da página depois da cotação ao vivo (bloqueado por último).
        if (viva) lista.sort(function (a, b) { return (a.veredito === "bloqueado" ? 1 : 0) - (b.veredito === "bloqueado" ? 1 : 0); });
        if (params.veredito === "bloqueado") lista = lista.filter(function (o) { return o.veredito === "bloqueado"; });
        if (params.tipo) lista = lista.filter(function (o) { return String(o.promocao.tipo).toLowerCase() === String(params.tipo).toLowerCase(); });
        return Promise.resolve({ ok: true, disponivel: true, page: 1, limit: 20, total: lista.length, hasNext: false,
          fonte: { tipo: stale ? "promo_snapshot" : undefined, geradoEm: "2026-09-29T08:00:00Z", frescor: stale ? "atencao" : "atual" },
          sync: stale ? { state: "stale", autoTrigger: "enfileirado" } : undefined,
          criterio: "Promoção disponível avaliada pelo mesmo cálculo do simulador.", tipos: [{ tipo: "DEAL", total: 5 }, { tipo: "SMART", total: 2 }],
          resumo: { entrar: 2, impacto_lc: 123.4, com_historico: 1, sem_historico: 1 },
          cotacao: { modo: viva ? "viva" : "estimada" }, oportunidades: lista });
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
    const typePrice = (v) => cdp.evaluate(`(function(){var i=document.getElementById('cm-new-price');if(!i){document.querySelector('[data-cenario="preco"]').click();i=document.getElementById('cm-new-price');}i.value='${v}';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const resultado = async () => (await cdp.evaluate("document.getElementById('cm-banc-resultado').textContent")).replace(/\u00a0/g, " ");
    const selecionar = (id) => cdp.evaluate(`document.querySelector('[data-cenario="${id}"]').click()`);

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

    await check("topo: 4 KPIs de decisão + realizado da CONTA numa linha; chips de próxima ação; zero chamadas de promoção por linha (sem N+1)", async () => {
      await waitFor(cdp, "window.VFCentralMargemUi.getState().realizado && window.VFCentralMargemUi.getState().promoSummary && window.VFCentralMargemUi.getState().promoSummary.status === 'ok'", "realizado/resumo de promoções não carregaram");
      const top = await cdp.evaluate("document.getElementById('cm-kpis-top').innerText");
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#cm-kpis-top .cm-topk').length"), 4);
      assert.ok(/EM PREJUÍZO\s*1/i.test(top.replace(/\n/g, " ")) || /em prejuízo/i.test(top), top);
      assert.ok(/PROMOS COM \+LC\s*2/i.test(top.replace(/\n/g, " ")), `KPI de promos: ${top}`);
      assert.ok(/impacto R\$\s*123/.test(top) && /1 sem histórico/.test(top), `impacto/sem histórico: ${top}`);
      assert.ok(!top.includes("22,32%"), "o realizado saiu dos KPIs");
      const realizado = await cdp.evaluate("document.getElementById('cm-top-realized').innerText");
      assert.ok(realizado.includes("22,32%") && /R\$\s24\.883/.test(realizado) && /R\$\s5\.452/.test(realizado) && realizado.includes("45"), realizado);
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-top-realized').hasAttribute('data-cm-realized-unavailable')"), false);
      // Próxima ação por linha (uma só): promoção que vale entrar · ok · preço-alvo estimado pelo Motor
      const chips = JSON.parse(await cdp.evaluate("JSON.stringify(Array.prototype.reduce.call(document.querySelectorAll('#cm-table-host tbody tr[data-item-id]'), function (m, tr) { m[tr.getAttribute('data-item-id')] = tr.querySelector('.cm-next-chip').textContent.trim().replace(/\\s+/g, ' '); return m; }, {}))"));
      assert.ok(/^Promo Oferta MLB1001 \+R\$\s1,90$/.test(chips.MLB1001), chips.MLB1001);
      assert.strictEqual(chips.MLB1002, "Ok");
      assert.ok(/^Subir p\/ R\$\s79,90$/.test(chips.MLB1003), chips.MLB1003);
      assert.ok((await cdp.evaluate("document.getElementById('cm-summary-line').innerText")).includes("3 anúncios · 3 ativos · 0 pausados"));
      assert.strictEqual(await calls("simular"), 0, "a tabela nunca simula nem consulta promoções por linha");
      // Filtrar, buscar e trocar de visão também não chamam o ML por linha.
      const itensAntes = await cdp.evaluate("window.__pc.calls.itens");
      await cdp.evaluate("(function(){var s=document.getElementById('cm-financial-filter');s.value='LOSS';s.dispatchEvent(new Event('change'));})()");
      await waitFor(cdp, `window.__pc.calls.itens > ${itensAntes} && !window.VFCentralMargemUi.getState().loading`);
      await cdp.evaluate("(function(){var s=document.getElementById('cm-financial-filter');s.value='';s.dispatchEvent(new Event('change'));})()");
      await waitFor(cdp, "!window.VFCentralMargemUi.getState().loading && document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length === 3");
      await cdp.evaluate("document.querySelector('[data-view=composition]').click(); document.querySelector('[data-view=operational]').click();");
      assert.strictEqual(await calls("simular"), 0, "filtrar/paginar/trocar visão: 0 chamadas ao /simular");
      await shot("10-pricing-page");
    });

    await check("chip de próxima ação: 'Subir p/ R$ X' abre a Bancada com o preço já simulado; 'Promo …' abre a promoção já selecionada; sem botão 'Precificar' por linha", async () => {
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#cm-table-host [data-open-item]').length"), 0);
      // Subir p/ R$ 79,90 (preço-alvo estimado pelo Motor) → preço manual preenchido e simulado pelo backend
      await cdp.evaluate("window.__pc.calls.simular.length = 0");
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB1003\"] .cm-next-chip').click()");
      assert.strictEqual(await st("s.selectedItemId"), "MLB1003");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-new-price').value"), "79,90");
      await waitFor(cdp, "window.__pc.calls.simular.some(function (c) { return c.mlb === 'MLB1003' && c.cenarios[0].tipo === 'preco' && c.cenarios[0].preco === 79.9; })", "o preço sugerido não foi simulado pelo backend");
      // Anúncio abaixo da meta: a Bancada pede também o preço-alvo COTADO (todas_promos + preco_alvo, uma chamada)
      const boot = await cdp.evaluate("window.__pc.calls.simular.filter(function (c) { return c.cenarios.some(function (x) { return x.tipo === 'todas_promos'; }); })");
      assert.strictEqual(boot.length, 1);
      assert.deepStrictEqual(boot[0].cenarios.map((x) => x.tipo), ["todas_promos", "preco_alvo"]);
      assert.strictEqual(boot[0].clienteContaId, 10);
      await waitFor(cdp, "document.querySelector('[data-cm-chip=\"alvo\"]')", "chip do preço-alvo cotado ausente");
      assert.ok(/Subir p\/ R\$\s81,50/.test(await cdp.evaluate("document.querySelector('[data-cm-chip=\"alvo\"]').textContent")), "o chip da Bancada mostra o preço COTADO, não o estimado");
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer()");
      // Promo Oferta MLB1001 +R$ 1,90 → promoção P-DEAL já selecionada ao abrir
      await cdp.evaluate("window.__pc.calls.simular.length = 0");
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB1001\"] .cm-next-chip').click()");
      assert.strictEqual(await st("s.selectedItemId"), "MLB1001");
      await waitFor(cdp, "document.querySelector('[data-cenario=\"P-DEAL\"].is-active') && document.querySelector('[data-cm-promo-info=\"P-DEAL\"]')", "a promoção do chip não foi selecionada");
      assert.strictEqual(await st("s.pendingPromoId"), null);
      assert.deepStrictEqual(await cdp.evaluate("window.__pc.calls.simular.map(function (c) { return c.cenarios.map(function (x) { return x.tipo; }); })"), [["todas_promos"]], "anúncio saudável: sem preço-alvo");
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer()");
      // clicar no chip não abre duas vezes (nem dispara o clique da linha)
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-drawer').classList.contains('is-open')"), false);
    });

    await check("chip 'Promo …' abre a Bancada JÁ na promoção (cenário = promotion_id do chip, coluna Cenário preenchida); o '›' da linha abre em Preço manual; promoção pedida que sumiu AVISA", async () => {
      const chipSel = "tr[data-item-id=\"MLB1001\"] .cm-next-chip";
      // 1) chip → promoção selecionada, Bancada com seletor e cascata (nunca só "Novo preço" + simulação avançada)
      await cdp.evaluate(`document.querySelector('${chipSel}').click()`);
      await waitFor(cdp, "document.querySelector('[data-cenario=\"P-DEAL\"].is-active')", "a promoção do chip não ficou selecionada");
      assert.strictEqual(await cdp.evaluate(`document.querySelector('${chipSel}').getAttribute('data-next-promo')`), "P-DEAL");
      assert.strictEqual(await st("s.bancada.selecionado"), "P-DEAL", "cenário selecionado = promotion_id do chip");
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#cm-banc-cenarios [data-cenario]').length >= 3"), true, "o seletor de cenários aparece");
      assert.strictEqual(await cdp.evaluate("Boolean(document.querySelector('[data-cm-bancada-cascata]'))"), true, "a cascata Atual × Cenário aparece");
      assert.strictEqual(await cdp.evaluate("Boolean(document.getElementById('cm-new-price'))"), false, "com a promoção escolhida não há campo de preço manual");
      const colunaCenario = await cdp.evaluate("document.querySelector('tr[data-cm-linha=\"preco\"] td:nth-child(3)').textContent");
      assert.ok(/99,90/.test(colunaCenario), `a coluna Cenário foi preenchida com o preço da promoção: ${colunaCenario}`);
      assert.strictEqual(await cdp.evaluate("Boolean(document.querySelector('[data-cm-promo-info=\"P-DEAL\"]'))"), true);
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer()");

      // 2) o '›' da linha (sem chip) abre a Bancada em Preço manual
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB1001\"] .cm-go').click()");
      await waitFor(cdp, "document.querySelector('[data-cenario=\"preco\"].is-active') && document.getElementById('cm-new-price')", "a linha não abriu em Preço manual");
      assert.strictEqual(await st("s.bancada.selecionado"), "preco");
      assert.strictEqual(await st("s.pendingPromoId"), null);
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#cm-banc-cenarios [data-cenario]').length >= 3"), true, "o seletor também está lá");
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer()");

      // 3) o chip pode entregar a CHAVE do snapshot em vez do id: ainda seleciona a mesma promoção (id canônico)
      await cdp.evaluate(`var c = document.querySelector('${chipSel}'); c.setAttribute('data-next-promo', 'P-DEAL::DEAL'); c.click();`);
      await waitFor(cdp, "document.querySelector('[data-cenario=\"P-DEAL\"].is-active')", "a chave do snapshot não selecionou a promoção");
      assert.strictEqual(await st("s.bancada.selecionado"), "P-DEAL");
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer()");

      // 4) promoção pedida que não existe mais na leitura: avisa (nunca cai em Preço manual em silêncio)
      await cdp.evaluate(`var c = document.querySelector('${chipSel}'); c.setAttribute('data-next-promo', 'P-SUMIU'); c.click();`);
      await waitFor(cdp, "document.querySelector('[data-cm-bancada=\"promo-nao-encontrada\"]')", "faltou o aviso de promoção ausente");
      assert.strictEqual(await st("s.bancada.selecionado"), "preco");
      assert.strictEqual(await st("s.pendingPromoId"), null);
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer()");
    });

    await check("aba Promoções: fonte bulk da conta, sem ML por linha; estimativa primeiro, depois a página cotada ao vivo", async () => {
      // Ao carregar a Central só roda o RESUMO (KPI + chips): uma leitura estimada dos 50 melhores, nunca a lista paginada.
      const resumoCalls = JSON.parse(await cdp.evaluate("JSON.stringify(window.__pc.calls.oppsParams)"));
      assert.deepStrictEqual(resumoCalls.map((c) => [c.conta, c.page, c.limit, c.veredito, c.cotacao]), [[10, 1, 50, "entrar", "estimada"]], "Precificar só lê o resumo das promoções");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-promos').hidden"), true);
      await cdp.evaluate("document.querySelector('[data-view=promotions]').click()");
      assert.strictEqual(await st("s.view"), "promotions");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-promos').hidden"), false);
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-table-host').hidden"), true, "a tabela de produtos some");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-divergences').hidden"), true);
      await waitFor(cdp, "document.querySelector('#cm-opps-host tr[data-opp]')", "promoções não apareceram");
      // duas leituras da MESMA página: estimada e, em seguida, viva
      await waitFor(cdp, "document.getElementById('cm-promos-live').getAttribute('data-cm-live') === 'ok'", "a cotação ao vivo não terminou");
      const modos = JSON.parse(await cdp.evaluate("JSON.stringify(window.__pc.calls.oppsParams.filter(function (x) { return x.limit === 20; }).map(function (x) { return [x.conta, x.page, x.cotacao]; }))"));
      assert.deepStrictEqual(modos, [[10, 1, "estimada"], [10, 1, "viva"]]);
      const txt = await cdp.evaluate("document.getElementById('cm-opps-host').innerText");
      assert.ok(txt.includes("Produto Y") && txt.includes("Oferta Y"), txt);
      for (const coluna of ["Produto", "Promo", "Preço → promo", "Seller banca / ML banca", "Frete antes → depois", "LC/un antes → depois", "Margem antes → depois", "Veredito"]) {
        assert.ok(txt.toLowerCase().includes(coluna.toLowerCase()), `coluna ${coluna} ausente`);
      }
      assert.ok(!(await cdp.evaluate("Boolean(document.querySelector('#cm-opps-host [data-cm-flag=estimado]'))")), "depois da cotação ao vivo nada é 'estimado'");
      await shot("11-promocoes");
      // Simular abre o drawer (mesmo fora da página) JÁ com a promoção escolhida
      await cdp.evaluate("document.querySelector('tr[data-opp=\"MLB9999\"] [data-opp-item]').click()");
      assert.strictEqual(await st("s.selectedItemId"), "MLB9999");
      assert.strictEqual(await st("s.drawerTab"), "pricing");
      await waitFor(cdp, "window.__pc.calls.simular.some(function (c) { return c.mlb === 'MLB9999'; })", "a Bancada do item de Oportunidades não carregou");
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer()");
    });

    await check("Promoções: colunas, chips de veredito, flags (faixa de frete, sem histórico, bloqueado · motivo) e '+N opções' expansível", async () => {
      const por = await cdp.evaluate("JSON.stringify(Array.prototype.map.call(document.querySelectorAll('#cm-opps-host tr[data-opp]'), function (tr) { return { id: tr.getAttribute('data-opp'), veredito: (tr.querySelector('[data-cm-veredito]') || {}).getAttribute && tr.querySelector('[data-cm-veredito]').getAttribute('data-cm-veredito'), flags: Array.prototype.map.call(tr.querySelectorAll('[data-cm-flag]'), function (f) { return f.getAttribute('data-cm-flag'); }), frete: tr.querySelector('[data-cm-frete]').innerText.replace(/\\s+/g, ' ').trim(), lc: tr.querySelector('[data-cm-lc]').innerText.replace(/\\s+/g, ' ').trim(), banca: tr.querySelector('[data-cm-banca]').innerText.replace(/\\s+/g, ' ').trim() }; }))");
      const linhas = Object.fromEntries(JSON.parse(por).map((l) => [l.id, l]));
      // ordem refeita dentro da página: bloqueado por último
      assert.deepStrictEqual(JSON.parse(por).map((l) => l.id), ["MLB1002", "MLB7777", "MLB9999"]);
      assert.strictEqual(linhas.MLB1002.veredito, "entrar_se_girar");
      assert.ok(linhas.MLB1002.flags.includes("faixa-frete"), "⚠ muda faixa de frete");
      assert.ok(/12,00.*→.*0,00/.test(linhas.MLB1002.frete), linhas.MLB1002.frete);
      assert.ok(linhas.MLB1002.flags.includes("empate"), "precisa vender +X%");
      assert.ok(/37,10.*→.*35,00/.test(linhas.MLB1002.lc) && /Δ/.test(linhas.MLB1002.lc), linhas.MLB1002.lc);
      assert.ok(/14,80.*\/.*5,20/.test(linhas.MLB1002.banca), linhas.MLB1002.banca);
      assert.ok(linhas.MLB7777.flags.includes("sem-historico"));
      assert.strictEqual(linhas.MLB9999.veredito, "bloqueado");
      assert.ok(linhas.MLB9999.flags.includes("bloqueado"));
      assert.ok((await cdp.evaluate("document.querySelector('tr[data-opp=\"MLB9999\"] [data-cm-flag=bloqueado]').textContent")).includes("bloqueado · tarifa do Mercado Livre indisponível"));
      assert.ok(/indisponível/.test(linhas.MLB9999.frete), "frete depois indisponível, sem estimar");
      // +N opções
      assert.strictEqual(await cdp.evaluate("document.querySelector('tr[data-opp=\"MLB1002\"] [data-promo-more]').textContent"), "+2 opções");
      assert.strictEqual(await cdp.evaluate("document.querySelector('tr[data-promo-options=\"MLB1002\"]').hidden"), true);
      await cdp.evaluate("document.querySelector('[data-promo-more=\"MLB1002\"]').click()");
      assert.strictEqual(await cdp.evaluate("document.querySelector('tr[data-promo-options=\"MLB1002\"]').hidden"), false);
      assert.strictEqual(await cdp.evaluate("document.querySelector('[data-promo-more=\"MLB1002\"]').getAttribute('aria-expanded')"), "true");
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('tr[data-promo-options=\"MLB1002\"] tr[data-promo-option]').length"), 2);
      // "Simular" de uma OPÇÃO abre o drawer já com aquela promoção simulada
      await cdp.evaluate("window.__pc.calls.simular.length = 0");
      await cdp.evaluate("document.querySelector('tr[data-promo-option=\"P-Y3\"] [data-opp-item]').click()");
      assert.strictEqual(await st("s.selectedItemId"), "MLB1002");
      assert.strictEqual(await st("s.pendingPromoId"), null, "a promoção escolhida é consumida quando a Bancada do anúncio chega");
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer()");
    });

    await check("Promoções: filtros de veredito e tipo vão ao servidor (página 1), sem recalcular nada na tela", async () => {
      await cdp.evaluate("window.__pc.calls.oppsParams = []");
      await cdp.evaluate("(function(){var s=document.getElementById('cm-promo-veredito');s.value='bloqueado';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
      await waitFor(cdp, "window.__pc.calls.oppsParams.some(function (x) { return x.veredito === 'bloqueado'; }) && document.querySelector('[data-cm-opps=\"vazio\"]')", "filtro não foi ao servidor");
      const chamadas = JSON.parse(await cdp.evaluate("JSON.stringify(window.__pc.calls.oppsParams)"));
      assert.ok(chamadas.every((c) => c.veredito === "bloqueado" && c.page === 1 && c.cotacao === "estimada"), JSON.stringify(chamadas));
      assert.ok((await cdp.evaluate("document.querySelector('[data-cm-opps=\"vazio\"]').textContent")).includes("Nenhuma promoção neste filtro"));
      const tipos = await cdp.evaluate("Array.prototype.map.call(document.querySelectorAll('#cm-promo-tipo option'), function (o) { return o.value; }).join('|')");
      assert.strictEqual(tipos, "|DEAL|SMART", "tipos vêm da resposta do servidor");
      await cdp.evaluate("(function(){var s=document.getElementById('cm-promo-veredito');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}));var t=document.getElementById('cm-promo-tipo');t.value='SMART';t.dispatchEvent(new Event('change',{bubbles:true}));})()");
      await waitFor(cdp, "window.__pc.calls.oppsParams.some(function (x) { return x.tipo === 'SMART'; })", "filtro de tipo não foi ao servidor");
      await cdp.evaluate("(function(){var t=document.getElementById('cm-promo-tipo');t.value='';t.dispatchEvent(new Event('change',{bubbles:true}));})()");
      await waitFor(cdp, "document.querySelectorAll('#cm-opps-host tr[data-opp]').length === 3 && document.getElementById('cm-promos-live').getAttribute('data-cm-live') === 'ok'");
    });

    await check("Promoções: se a cotação ao vivo falhar, a estimativa continua na tela e diz que é estimativa", async () => {
      await cdp.evaluate("window.__pc.oppsVivaFalha = true; document.getElementById('cm-promos').scrollIntoView(); (function(){var s=document.getElementById('cm-promo-veredito');s.value='todos';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
      await waitFor(cdp, "document.getElementById('cm-promos-live').getAttribute('data-cm-live') === 'error'", "falha da cotação ao vivo não foi sinalizada");
      assert.ok((await cdp.evaluate("document.getElementById('cm-promos-live').textContent")).includes("valores estimados"));
      assert.ok(await cdp.evaluate("Boolean(document.querySelector('#cm-opps-host [data-cm-flag=estimado]'))"), "linhas seguem marcadas como estimado");
      assert.ok(/a cotar/.test(await cdp.evaluate("document.querySelector('#cm-opps-host [data-cm-frete]').innerText")), "frete depois: 'a cotar', nunca um número inventado");
      await cdp.evaluate("window.__pc.oppsVivaFalha = false; (function(){var s=document.getElementById('cm-promo-veredito');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
      await waitFor(cdp, "document.getElementById('cm-promos-live').getAttribute('data-cm-live') === 'ok'");
    });

    await check("drawer abre IMEDIATAMENTE em Precificar enquanto a Bancada carrega (um só pedido ao /simular, com a conta)", async () => {
      await cdp.evaluate("document.querySelector('[data-view=operational]').click()");
      await cdp.evaluate("window.__pc.calls.simular.length = 0; window.__pc.holdBancada['MLB1001'] = true");
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB1001\"]').click()");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-drawer').classList.contains('is-open')"), true);
      assert.strictEqual(await st("s.drawerTab"), "pricing");
      await waitFor(cdp, "document.querySelector('[data-cm-bancada=\"loading\"]')", "estado de carregamento da Bancada ausente");
      assert.ok((await cdp.evaluate("document.getElementById('cm-drawer-summary').innerText")).toLowerCase().includes("preço atual"), "resumo fixo disponível sem esperar o ML");
      await cdp.evaluate("window.__pc.resolveBancada['MLB1001']()");
      await waitFor(cdp, "document.querySelector('[data-cm-cenarios]')", "cenários não renderizaram");
      const pedidos = await cdp.evaluate("window.__pc.calls.simular");
      assert.strictEqual(pedidos.length, 1, "um pedido só ao abrir");
      assert.deepStrictEqual(pedidos[0], { clienteContaId: 10, mlb: "MLB1001", cenarios: [{ tipo: "todas_promos" }] });
      assert.strictEqual(await cdp.evaluate("Boolean(document.getElementById('cm-pp-result') || document.querySelector('[data-promo-apply]'))"), false, "o cockpit antigo (cards de promoção, simulação por tipo) saiu do drawer");
    });

    await check("Bancada: Preço manual + uma opção por promoção com chip de veredito; ATIVA/sem preço bloqueadas com o motivo; fonte e hora da cotação", async () => {
      const opcoes = JSON.parse(await cdp.evaluate("JSON.stringify(Array.prototype.map.call(document.querySelectorAll('[data-cenario]'), function (b) { var v = b.querySelector('[data-cm-veredito]'); return [b.getAttribute('data-cenario'), v ? v.getAttribute('data-cm-veredito') : null]; }))"));
      assert.deepStrictEqual(opcoes, [["preco", null], ["P-ATIVA", "bloqueado"], ["P-DEAL", "entrar_se_girar"], ["P-PROG", "nao_entrar"], ["P-SMART", "entrar"], ["P-NAO", "bloqueado"]]);
      assert.strictEqual(await cdp.evaluate("document.querySelector('[data-cenario=\"preco\"]').getAttribute('aria-checked')"), "true");
      // Promoção já ativa: bloqueada pelo núcleo, motivo na tela, botão desabilitado
      await selecionar("P-ATIVA");
      let txt = await resultado();
      assert.ok(txt.includes("bloqueado · promoção já ativa"), txt);
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-bancada-review').disabled"), true);
      assert.ok((await cdp.evaluate("document.getElementById('cm-bancada-review').title")).includes("promoção já ativa"));
      // Sem preço sugerido pelo ML
      await selecionar("P-NAO");
      assert.ok((await resultado()).includes("promoção sem preço sugerido"));
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-bancada-review').disabled"), true);
      // Promoção elegível: Atual × Cenário em cascata, retorno ML, seller × ML banca, ΔLC e quanto precisa vender a mais
      await selecionar("P-DEAL");
      txt = await resultado();
      for (const t of ["Entrar se girar", "LC por unidade cai", "R$ 110,48", "R$ 99,90", "R$ 21,17", "R$ 18,12", "19,16%", "18,14%", "Retorno ML", "R$ 5,20"]) assert.ok(txt.includes(t), `falta ${t}: ${txt}`);
      const linhas = await cdp.evaluate("Array.prototype.map.call(document.querySelectorAll('[data-cm-bancada-cascata] tbody tr'), function (tr) { return tr.getAttribute('data-cm-linha'); }).join(',')");
      assert.strictEqual(linhas, "preco,imposto,comissao,frete,taxa_fixa,custo,rebate,lc,margem", "cascata: preço → −imposto → −comissão → −frete → −taxa → −custo → +retorno = LC → margem");
      assert.ok(/-R\$\s3,05/.test(await cdp.evaluate("document.querySelector('[data-cm-linha=\"lc\"]').textContent").then((t) => t.replace(/\u00a0/g, " "))), "ΔLC/un");
      assert.ok(/Precisa vender\s*\+16,83%/.test((await cdp.evaluate("document.querySelector('[data-cm-empate]').textContent")).replace(/\u00a0/g, " ")), "empate de volume do núcleo");
      const banca = (await cdp.evaluate("document.querySelector('[data-cm-promo-info=\"P-DEAL\"]').textContent")).replace(/\u00a0/g, " ");
      for (const t of ["Oferta MLB1001", "Seller banca", "R$ 5,38", "ML banca", "R$ 5,20"]) assert.ok(banca.includes(t), `falta ${t}: ${banca}`);
      assert.ok(txt.includes("cotação ao vivo do Mercado Livre às") && txt.includes("promoção lida em"), `fonte/hora: ${txt}`);
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-bancada-review').textContent"), "Revisar entrada na promoção");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-bancada-review').disabled"), false);
      assert.strictEqual(await cdp.evaluate("Boolean(document.getElementById('cm-new-price'))"), false, "com uma promoção escolhida não há campo de preço");
      // Muda a faixa de frete: aviso
      await selecionar("P-PROG");
      assert.ok(await cdp.evaluate("Boolean(document.querySelector('[data-cm-flag=\"faixa-frete\"]'))"), "⚠ muda faixa de frete");
      assert.ok((await resultado()).includes("Não entrar"));
      await selecionar("P-SMART");
      assert.ok((await resultado()).includes("Empata o LC total de hoje mesmo vendendo"), "ΔLC > 0: empata vendendo menos");
      await selecionar("P-DEAL");
      await shot("11-drawer-bancada");
      await selecionar("preco");
    });

    await check("preço manual: validação local sem chamada; debounce → 1 cenário `preco` cotado pelo backend", async () => {
      await typePrice("114,999");
      await sleep(80);
      assert.ok((await drawerText()).includes("até duas casas"), "erro local de casas decimais");
      const antes = await calls("simular");
      await sleep(500);
      assert.strictEqual(await calls("simular"), antes, "preço inválido nunca chama o backend");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-bancada-review').disabled"), true, "sem cenário calculado não há revisão");
      await typePrice("114");
      await typePrice("114,9");
      await typePrice("114,90");
      await waitFor(cdp, "document.querySelector('[data-cm-linha=\"lc\"]') && document.getElementById('cm-banc-resultado').textContent.indexOf('114,90') !== -1", "resultado da simulação não apareceu");
      assert.strictEqual(await calls("simular"), antes + 1, "debounce: digitação vira UMA chamada");
      const ultima = await cdp.evaluate("window.__pc.calls.simular[window.__pc.calls.simular.length-1]");
      assert.deepStrictEqual(ultima, { clienteContaId: 10, mlb: "MLB1001", cenarios: [{ tipo: "preco", preco: 114.9 }] });
      const res = await resultado();
      for (const t of ["R$ 110,48", "R$ 114,90", "R$ 21,17", "R$ 24,62", "19,16%", "21,43%", "+R$ 3,45", "+2,27%", "Entrar"]) assert.ok(res.includes(t), `falta ${t}: ${res}`);
      assert.ok(res.includes("Empata o LC total de hoje mesmo vendendo 14,01% a menos"), res);
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-bancada-review').disabled"), false);
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-bancada-review').textContent"), "Revisar novo preço");
      await shot("12-bancada-preco-manual");
    });

    await check("simulação: resposta velha (digitação anterior) nunca sobrescreve a nova", async () => {
      await cdp.evaluate("window.__pc.holdSim = true");
      await typePrice("120,00");
      await waitFor(cdp, "window.__pc.resolveSim.length === 1", "1ª simulação não ficou pendente");
      await typePrice("100,00");
      await waitFor(cdp, "window.__pc.resolveSim.length === 2", "2ª simulação não ficou pendente");
      await cdp.evaluate("window.__pc.resolveSim[1]()");
      await waitFor(cdp, "document.getElementById('cm-banc-resultado').textContent.indexOf('100,00') !== -1", "resultado da 2ª não apareceu");
      await cdp.evaluate("window.__pc.resolveSim[0]()");
      await sleep(150);
      const res = await resultado();
      assert.ok(res.includes("100,00") && !res.includes("120,00"), `resposta velha vazou: ${res}`);
      await cdp.evaluate("window.__pc.holdSim = false; window.__pc.resolveSim = []");
      await typePrice("114,90");
      await waitFor(cdp, "document.getElementById('cm-banc-resultado').textContent.indexOf('114,90') !== -1 && document.getElementById('cm-bancada-review').disabled === false");
    });

    await check("falha do /simular: erro explícito e 'Tentar de novo' na Bancada; falha no preço manual não vira número", async () => {
      await cdp.evaluate("window.__pc.simularFalha = true");
      await typePrice("113,00");
      await waitFor(cdp, "document.querySelector('#cm-banc-resultado .cm-field-error')", "erro do preço manual não apareceu");
      assert.ok((await resultado()).includes("Mercado Livre fora do ar"));
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-bancada-review').disabled"), true);
      await cdp.evaluate("window.__pc.simularFalha = false");
      await typePrice("114,90");
      await waitFor(cdp, "document.getElementById('cm-banc-resultado').textContent.indexOf('24,62') !== -1 && document.getElementById('cm-bancada-review').disabled === false");
    });

    await check("preview da alteração: produto, conta, antes → depois, gates; rollout OFF bloqueia o botão final (zero escrita)", async () => {
      await cdp.evaluate("document.getElementById('cm-bancada-review').click()");
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
      await shot("13-preview-rollout-off");
      await cdp.evaluate("document.getElementById('cm-confirm-cancel').click()");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-confirm-overlay').classList.contains('is-open')"), false);
    });

    await check("cenário bloqueado (cotação indisponível) desabilita revisar; preview bloqueado desabilita a confirmação mesmo com rollout ligado", async () => {
      await cdp.evaluate("window.__pc.escritaHabilitada = true");
      await typePrice("60,00");
      await waitFor(cdp, "document.getElementById('cm-banc-resultado').textContent.indexOf('bloqueado · tarifa do Mercado Livre indisponível') !== -1", "bloqueio da cotação não apareceu na Bancada");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-bancada-review').disabled"), true, "revisar fica bloqueado com cenário bloqueado");
      assert.ok(!(await resultado()).includes("R$ 60,00 "), "nenhum número inventado para o cenário bloqueado");
      assert.strictEqual(await cdp.evaluate("document.querySelector('[data-cm-linha=\"lc\"] td:nth-child(3)').textContent.trim()"), "—");
      await cdp.evaluate("window.__pc.previewBloqueado = true");
      await typePrice("114,90");
      await waitFor(cdp, "document.getElementById('cm-banc-resultado').textContent.indexOf('24,62') !== -1 && document.getElementById('cm-bancada-review').disabled === false");
      await cdp.evaluate("document.getElementById('cm-bancada-review').click()");
      await waitFor(cdp, "document.querySelector('#cm-confirm-body .cm-confirm__table')", "preview bloqueado não abriu");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-confirm-apply').disabled"), true, "o servidor bloqueou: confirmar fica desabilitado");
      await cdp.evaluate("window.__pc.previewBloqueado = false; document.getElementById('cm-confirm-cancel').click()");
    });

    await check("confirmar: duplo clique = 1 escrita com a MESMA chave; sucesso mostra o preço confirmado e acompanha o snapshot", async () => {
      const itensAntes = await cdp.evaluate("window.__pc.calls.itens");
      const bootsAntes = await cdp.evaluate("window.__pc.calls.simular.filter(function (c) { return c.cenarios[0].tipo === 'todas_promos'; }).length");
      await cdp.evaluate("document.getElementById('cm-bancada-review').click()");
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
      // A coluna "Atual" da Bancada é relida em segundo plano (sem trocar a tela por "carregando").
      await waitFor(cdp, `window.__pc.calls.simular.filter(function (c) { return c.cenarios[0].tipo === 'todas_promos'; }).length > ${bootsAntes}`, "a Bancada não foi relida depois do snapshot novo");
    });

    await check("erro de rede no aplicar: 'Tentar de novo' reusa a MESMA chave (sem escrita dupla)", async () => {
      await cdp.evaluate("window.__pc.applyMode = 'network-then-ok'; window.__pc.calls.apply = []");
      await typePrice("115,90");
      await waitFor(cdp, "document.getElementById('cm-banc-resultado').textContent.indexOf('115,90') !== -1 && document.getElementById('cm-bancada-review').disabled === false");
      await cdp.evaluate("document.getElementById('cm-bancada-review').click()");
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
      await waitFor(cdp, `document.getElementById('cm-banc-resultado').textContent.indexOf('${valor}') !== -1 && document.getElementById('cm-bancada-review').disabled === false`, "simulação não habilitou revisar");
      await cdp.evaluate("document.getElementById('cm-bancada-review').click()");
    };
    // Promoção: escolhe o cenário na Bancada e abre a revisão (o botão muda para "Revisar entrada na promoção").
    const abrirRevisaoPromo = (id) => cdp.evaluate(`document.querySelector('[data-cenario="${id}"]').click(); document.getElementById('cm-bancada-review').click();`);

    await check("20. preview A responde DEPOIS do preview B: a resposta de A nunca preenche B (e o pedido de A é abortado)", async () => {
      await cdp.evaluate("window.__pc.holdPreview = true; window.__pc.resolvePreview = []; window.__pc.previewSignals = []");
      await abrirRevisaoPreco("116,90");
      await waitFor(cdp, "window.__pc.resolvePreview.length === 1", "preview A não foi pedido");
      await cdp.evaluate("document.getElementById('cm-confirm-cancel').click()");
      assert.strictEqual(await cdp.evaluate("window.__pc.previewSignals[0] && window.__pc.previewSignals[0].aborted"), true, "fechar aborta o preview em voo");
      await abrirRevisaoPromo("P-DEAL");
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
      await abrirRevisaoPromo("P-DEAL");
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

    await check("promoção: Revisar entrada abre o preview com tipo PROMOTION, desconto total, ML banca e seller banca", async () => {
      await abrirRevisaoPromo("P-DEAL");
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

    await check("troca rápida de item: a Bancada do item anterior que chega tarde nunca aparece no novo", async () => {
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer(); window.__pc.holdBancada['MLB1001'] = true");
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB1001\"]').click()");
      await waitFor(cdp, "typeof window.__pc.resolveBancada['MLB1001'] === 'function'");
      await cdp.evaluate("document.getElementById('cm-drawer-next').click()");
      await waitFor(cdp, "window.VFCentralMargemUi.getState().selectedItemId === 'MLB1002' && document.querySelector('[data-cm-cenarios]')", "item B não carregou a Bancada");
      await cdp.evaluate("window.__pc.resolveBancada['MLB1001']()");
      await sleep(150);
      assert.strictEqual(await st("s.selectedItemId"), "MLB1002");
      const txt = await drawerText();
      assert.ok(txt.includes("Oferta MLB1002") && !txt.includes("Oferta MLB1001"), "promoção do item anterior vazou para o novo");
    });

    await check("preço mudou no ML desde a leitura da tabela: a Bancada parte da leitura da tabela e o PREVIEW mostra o preço vivo (precoVisto da tabela, compare-and-set no servidor)", async () => {
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer(); window.__pc.livePrice['MLB1003'] = 62; window.__pc.calls.preview.length = 0");
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB1003\"]').click()");
      await waitFor(cdp, "document.querySelector('[data-cm-cenarios]')", "Bancada do MLB1003 não carregou");
      await typePrice("75,00");
      await waitFor(cdp, "document.getElementById('cm-banc-resultado').textContent.indexOf('75,00') !== -1 && document.getElementById('cm-bancada-review').disabled === false", "simulação não voltou");
      assert.ok((await cdp.evaluate("document.getElementById('cm-drawer-summary').textContent")).replace(/\u00a0/g, " ").includes("R$ 59,90"), "o resumo mostra a leitura da tabela");
      await cdp.evaluate("document.getElementById('cm-bancada-review').click()");
      await waitFor(cdp, "document.querySelector('#cm-confirm-body .cm-confirm__table')", "preview não abriu");
      const pv = await cdp.evaluate("window.__pc.calls.preview[0]");
      assert.strictEqual(pv.precoVisto, 59.9, "o que a tela mostrava é o precoVisto");
      assert.strictEqual(pv.novoPreco, 75);
      const body = (await cdp.evaluate("document.getElementById('cm-confirm-body').textContent")).replace(/\u00a0/g, " ");
      assert.ok(body.includes("R$ 62,00") && body.includes("R$ 75,00"), `o preview mostra o preço vivo → novo: ${body}`);
      await cdp.evaluate("document.getElementById('cm-confirm-cancel').click(); delete window.__pc.livePrice['MLB1003']");
    });

    await check("preço-alvo sem solução: 'sem preço viável p/ a meta' com o motivo, nunca um preço inventado", async () => {
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer(); window.__pc.alvoModo = 'sem-preco-viavel'");
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB1003\"]').click()");
      await waitFor(cdp, "document.querySelector('[data-cm-chip=\"sem-preco-viavel\"]')", "chip 'sem preço viável' ausente");
      assert.ok((await cdp.evaluate("document.querySelector('[data-cm-chip=\"sem-preco-viavel\"]').title")).includes("a meta não é atingível"));
      assert.strictEqual(await cdp.evaluate("Boolean(document.querySelector('[data-cm-chip=\"alvo\"]'))"), false);
      await cdp.evaluate("window.__pc.alvoModo = 'ok'");
    });

    await check("troca de conta fecha o drawer e descarta a Bancada em voo da conta anterior", async () => {
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer(); window.__pc.holdBancada['MLB1003'] = true");
      await cdp.evaluate("document.querySelector('tr[data-item-id=\"MLB1003\"]').click()");
      await waitFor(cdp, "typeof window.__pc.resolveBancada['MLB1003'] === 'function'");
      await cdp.evaluate("window.VF.context.setConta(11)");
      await waitFor(cdp, "window.VFCentralMargemUi.getState().contaId === 11", "conta 11 não entrou");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-drawer').classList.contains('is-open')"), false);
      await cdp.evaluate("window.__pc.resolveBancada['MLB1003']()");
      await sleep(150);
      assert.strictEqual(await st("s.bancada.data"), null, "resposta da conta anterior não reidrata o estado");
      assert.strictEqual(await cdp.evaluate("document.getElementById('cm-drawer-body').innerHTML"), "");
    });

    await check("oportunidades pelo Promo Snapshot: sincronizando mostra o estado (sem mandar para a tela antiga); stale serve a lista e avisa", async () => {
      await cdp.evaluate("document.querySelector('[data-view=promotions]').click()");
      await cdp.evaluate("window.__pc.oppsModo = 'syncing'; window.VF.context.setConta(10)");
      await waitFor(cdp, "document.querySelector('[data-cm-opps=\"indisponivel\"][data-cm-opps-sync=\"syncing\"]')", "estado de sincronização não apareceu");
      const host = await cdp.evaluate("document.getElementById('cm-promos').innerText");
      assert.ok(host.includes("Primeira leitura das promoções") && host.includes("atualizando (10/100)"), host);
      assert.strictEqual(await cdp.evaluate("Boolean(document.querySelector('#cm-opps-host a[href=\"promocoes-retorno.html\"]'))"), false, "não depende mais da tela Promoções ML");
      assert.ok(await cdp.evaluate("Boolean(window.VFCentralMargemUi.getState().oppsPollTimer)"), "relê a lista enquanto sincroniza");
      await cdp.evaluate("window.__pc.oppsModo = 'stale'; window.VF.context.setConta(11)");
      await waitFor(cdp, "document.querySelector('#cm-opps-host tr[data-opp]')", "lista do snapshot stale não apareceu");
      const meta = await cdp.evaluate("document.getElementById('cm-promos').innerText");
      assert.ok(meta.includes("Promo Snapshot ·") && meta.includes("desatualizado, atualizando"), meta);
    });

    await check("oportunidades pelo diagnóstico legado: badge com a data real; sem data → 'data desconhecida' (nunca '—'); vendas indisponíveis não viram '0 un.'", async () => {
      await cdp.evaluate("window.__pc.oppsModo = 'legado'; window.VF.context.setConta(10)");
      await waitFor(cdp, "document.getElementById('cm-opps-meta').textContent.indexOf('diagnóstico legado') !== -1 && document.querySelector('#cm-opps-host tr[data-opp]')", "lista legada não apareceu");
      const comData = await cdp.evaluate("document.getElementById('cm-opps-meta').textContent");
      assert.ok(comData.includes("diagnóstico legado ·") && /29\/09/.test(comData), comData);
      assert.ok(!comData.includes("data desconhecida"), comData);
      const linha = await cdp.evaluate("document.querySelector('#cm-opps-host tr[data-opp]').textContent");
      assert.ok(!/\b0 un\./.test(linha), `vendas indisponíveis viraram '0 un.': ${linha}`);

      await cdp.evaluate("window.__pc.oppsModo = 'legado-sem-data'; window.VF.context.setConta(11)");
      await waitFor(cdp, "document.getElementById('cm-opps-meta').textContent.indexOf('data desconhecida') !== -1", "badge sem data não mostrou 'data desconhecida'");
      const semData = await cdp.evaluate("document.getElementById('cm-opps-meta').textContent");
      assert.ok(semData.includes("diagnóstico legado · data desconhecida"), semData);
      assert.ok(!/· —/.test(semData), semData);
      await cdp.evaluate("window.__pc.oppsModo = null");
    });

    await check("oportunidades paginadas no SERVIDOR: a Central envia page/limit, mostra total e navega por hasNext; leitura herdada identificada", async () => {
      await cdp.evaluate("window.__pc.calls.oppsParams = []; window.__pc.oppsModo = 'paginado'; window.VF.context.setConta(10)");
      await waitFor(cdp, "document.querySelector('[data-cm-opps-pager=\"1\"]')", "paginador da página 1 não apareceu");
      const p1 = await cdp.evaluate("JSON.stringify(window.__pc.calls.oppsParams[window.__pc.calls.oppsParams.length - 1])");
      assert.deepStrictEqual({ conta: JSON.parse(p1).conta, page: JSON.parse(p1).page, limit: JSON.parse(p1).limit }, { conta: 10, page: 1, limit: 20 }, "pede a página 1 com limit ao servidor");
      const txt1 = await cdp.evaluate("document.getElementById('cm-opps-host').innerText");
      assert.ok(txt1.includes("1–20 de 45"), txt1);
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#cm-opps-host tr[data-opp]').length"), 20);
      assert.ok(await cdp.evaluate("document.querySelector('[data-opps-page=\"0\"]').disabled"), "Anterior desabilitado na página 1");
      assert.ok(txt1.includes("leitura anterior"), "promoção herdada identificada");
      const metaP = await cdp.evaluate("document.getElementById('cm-opps-meta').textContent");
      assert.ok(metaP.includes("parcial") && metaP.includes("1 com leitura anterior"), metaP);
      await cdp.evaluate("document.querySelector('[data-opps-page=\"2\"]').click()");
      await waitFor(cdp, "document.querySelector('[data-cm-opps-pager=\"2\"]')", "página 2 não carregou");
      await cdp.evaluate("document.querySelector('[data-opps-page=\"3\"]').click()");
      await waitFor(cdp, "document.querySelector('[data-cm-opps-pager=\"3\"]')", "página 3 não carregou");
      const txt3 = await cdp.evaluate("document.getElementById('cm-opps-host').innerText");
      assert.ok(txt3.includes("41–45 de 45"), txt3);
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#cm-opps-host tr[data-opp]').length"), 5);
      assert.ok(await cdp.evaluate("document.querySelector('[data-opps-page=\"4\"]').disabled"), "Próxima desabilitada sem hasNext");
      const pedidos = JSON.parse(await cdp.evaluate("JSON.stringify(window.__pc.calls.oppsParams.filter(function (x) { return x.cotacao === 'estimada'; }).map(function (x) { return x.page; }))"));
      assert.deepStrictEqual(pedidos.slice(-3), [1, 2, 3], "cada página é um pedido ao servidor (e depois a mesma página cotada ao vivo)");
      // Trocar de conta volta para a página 1.
      await cdp.evaluate("window.VF.context.setConta(11)");
      await waitFor(cdp, "document.querySelector('[data-cm-opps-pager=\"1\"]') && window.VFCentralMargemUi.getState().contaId === 11", "troca de conta não voltou à página 1");
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
