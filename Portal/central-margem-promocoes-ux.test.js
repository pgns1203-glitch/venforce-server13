/*
 * Aba Promoções da Central de Margem — experiência do gestor (navegador real).
 *
 * Chrome headless carrega Portal/ de um servidor estático local com o Shell V3
 * (sidebar aberta). A rede de produção é interceptada via CDP e respondida
 * AQUI, em Node, com o núcleo DE VERDADE do servidor:
 *   - cada linha é `montarCandidata` (core.calcularCenario) e a lista é
 *     `rankearOportunidades` (veredito, tipo, busca, ordem e página) — a tela
 *     recebe exatamente o formato que o GET /oportunidades devolve;
 *   - a fonte é `montarFontePromocoes` e o status, o contrato do GET /status;
 *   - a Bancada (POST /api/margem/simular) é calculada pelo mesmo núcleo.
 * Só o Margin Snapshot da aba Precificar é mock em memória (fora do escopo).
 *
 * Cliente: Alianza Jeans, conta 86 ("Alianza Jeans 1", 12 anúncios) e conta
 * 87 ("Alianza Jeans 2", 45 anúncios — 3 páginas). Estados cobertos: lendo,
 * sem leitura, atualizado, antigo, sincronizando (com o Atualizar real),
 * falhou, vendas indisponíveis e dados financeiros incompletos.
 *
 * CM_UX_MODO=antes: só tira as capturas (para comparar com o código anterior,
 * apontando CM_PORTAL_DIR para outra worktree). CM_SHOT_DIR: pasta dos PNGs.
 */
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const PORTAL_DIR = path.resolve(process.env.CM_PORTAL_DIR || __dirname);
const SERVER_DIR = path.join(__dirname, "..", "server");
const SHOT_DIR = process.env.CM_SHOT_DIR || path.join(os.tmpdir(), "central-margem-promocoes-ux");
const MODO_ANTES = process.env.CM_UX_MODO === "antes";

const core = require(path.join(SERVER_DIR, "services", "motorMargem", "core"));
const Opp = require(path.join(SERVER_DIR, "services", "motorMargem", "precificacao", "precificacaoOportunidadesService"));
const { classificarPromocao } = require(path.join(SERVER_DIR, "services", "motorMargem", "precificacao", "promocaoClassificacao"));
const { montarFontePromocoes } = require(path.join(SERVER_DIR, "services", "promoSnapshot", "promoSnapshotFonte"));
const { resolvePromoSnapshotConfig } = require(path.join(SERVER_DIR, "services", "promoSnapshot", "promoSnapshotConfig"));

const AGORA = Date.parse("2026-11-04T13:00:00Z");
const CONFIG = resolvePromoSnapshotConfig({ PROMO_SNAPSHOT_WORKER_ENABLED: "true", PROMO_SNAPSHOT_CONTAS: "86,87" });

// ── Catálogo fake e determinístico ──────────────────────────────────────────
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const MODELOS = ["Calça Jeans Mom", "Calça Jeans Skinny", "Calça Wide Leg", "Bermuda Jeans", "Short Jeans Destroyed", "Jaqueta Jeans Oversized",
  "Saia Jeans Midi", "Macacão Jeans", "Calça Flare Cintura Alta", "Colete Jeans", "Camisa Jeans Manga Longa", "Calça Cargo Jeans"];
const LAVAGENS = ["Clara", "Escura", "Black", "Média", "Off White", "Azul Marinho"];
const CORES = ["#9db4d6", "#3d5a80", "#2b2d42", "#6c8ebf", "#e9e4d8", "#1d3557"];
const PROMOS = [
  { nome: "Black Friday Moda", tipo: "DEAL", fimDias: 26 },
  { nome: "Oferta do Dia", tipo: "DOD", fimDias: 1 },
  { nome: "Campanha Alianza Novembro", tipo: "SELLER_CAMPAIGN", fimDias: 22 },
  { nome: "Desconto co-participado ML", tipo: "SMART", fimDias: 12 },
  { nome: "Liquida Jeans", tipo: "PRICE_DISCOUNT", fimDias: 8 },
];

function thumb(cor) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#f4f5f8"/><path d="M13 6h14l3 28h-7l-3-17-3 17h-7z" fill="${cor}"/></svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

function catalogo(conta, total, seed) {
  const r = rng(seed);
  const itens = [];
  for (let i = 0; i < total; i += 1) {
    const modelo = MODELOS[i % MODELOS.length];
    const lav = LAVAGENS[Math.floor(r() * LAVAGENS.length)];
    const preco = Math.round((79 + r() * 170) * 100) / 100 - 0.1;
    const custo = Math.round(preco * (0.32 + r() * 0.22) * 100) / 100;
    const taxa = r() < 0.5 ? 0.14 : 0.19;
    const frete = preco >= 79 ? Math.round((14 + r() * 12) * 100) / 100 : 0;
    const vendas = r() < 0.18 ? 0 : Math.round(r() * 140);
    const id = (conta === 87 ? "MLB54" : "MLB41") + String(30010000 + i * 7919).slice(0, 8);
    const nPromos = 1 + Math.floor(r() * 3);
    const promos = [];
    for (let k = 0; k < nPromos; k += 1) {
      const p = PROMOS[(i + k * 2) % PROMOS.length];
      const desconto = 0.05 + r() * 0.22;
      const subsidiada = p.tipo === "SMART" || (p.tipo === "DEAL" && r() < 0.6);
      const precoPromo = Math.round(preco * (1 - desconto) * 100) / 100;
      promos.push({
        id: `P-${p.tipo}-${id}-${k}`, nome: p.nome, tipo: p.tipo,
        status: p.tipo === "SMART" && k > 0 ? "started" : "candidate",
        precoPromo, retornoMl: subsidiada ? Math.round(preco * desconto * (0.35 + r() * 0.4) * 100) / 100 : 0,
        fim: new Date(AGORA + p.fimDias * 86400000).toISOString(),
      });
    }
    itens.push({
      id, titulo: `${modelo} ${lav} Alianza ${i % 2 ? "Feminina" : "Masculina"} Tam ${36 + (i % 6) * 2}`,
      imagem: i % 9 === 4 ? null : thumb(CORES[i % CORES.length]),
      preco, custo, aliquota: 0.08, taxa, frete, vendas, promos,
      semComissao: false, herdada: false,
    });
  }
  return itens;
}

const CONTAS = {
  86: { nome: "Alianza Jeans 1", seller: "2190011001", itens: catalogo(86, 12, 86) },
  87: { nome: "Alianza Jeans 2", seller: "2433262404", itens: catalogo(87, 45, 87) },
};
// Dados financeiros incompletos de verdade: sem taxa de comissão no snapshot
// (o núcleo bloqueia, nada é estimado) e uma promoção com a leitura anterior.
CONTAS[87].itens[3].semComissao = true;
CONTAS[87].itens[5].herdada = true;
CONTAS[86].itens[2].semComissao = true;

// Estado de cada conta (o teste muda no meio do roteiro).
const ESTADO = { 86: { modo: "atualizado", vendasIndisponiveis: false }, 87: { modo: "atualizado", vendasIndisponiveis: false } };
const SEGURAR = { opps: false, fila: [] };
const chamadas = { opps: [], status: [], sync: [], simular: [] };

function snapDoItem(it) {
  return {
    titulo: it.titulo, image_url: it.imagem, price: it.preco, cost: it.custo, tax_rate: it.aliquota, fixed_fee: 0,
    commission_rate: it.semComissao ? null : it.taxa, freight: it.frete, margin: null,
    commission: it.semComissao ? null : Math.round(it.preco * it.taxa * 100) / 100, profit: null,
    snap_target_margin: 0.12, anuncio_logistic_type: "fulfillment", list_price: it.preco,
  };
}

function candidatas(conta, viva) {
  const c = CONTAS[conta];
  const vendasPorMlb = new Map(c.itens.map((it) => [it.id, { unidades: it.vendas, receita: it.vendas * it.preco }]));
  const vendasIndisponivel = ESTADO[conta].vendasIndisponiveis;
  const lista = [];
  for (const it of c.itens) {
    for (const pr of it.promos) {
      const classe = classificarPromocao({ tipo: pr.tipo, status: pr.status });
      const promocao = { id: pr.id, chave: pr.id, nome: pr.nome, tipo: pr.tipo, status: pr.status, statusExibicao: null, fim: pr.fim,
        herdada: it.herdada, observadaEm: it.herdada ? new Date(AGORA - 30 * 3600000).toISOString() : null, grupo: classe.grupo, escrita: classe.escrita };
      const args = {
        listaFonte: "promo_snapshot", listaObservadaEm: new Date(AGORA - 40 * 60000).toISOString(), itemId: it.id, promocao,
        precoPromo: pr.precoPromo, retornoMl: pr.retornoMl, snap: snapDoItem(it), precoOriginalPromo: it.preco, titulo: null,
        vendasPorMlb, vendasIndisponivel, rebateAtual: null, rebateIndisponivel: null,
      };
      if (viva && !it.semComissao) {
        const freteNovo = pr.precoPromo < 79 ? 0 : it.frete;
        args.cotacaoReal = {
          comissao: Math.round(pr.precoPromo * it.taxa * 100) / 100, frete: freteNovo, frete_aplicavel: true, limite_excedido: false,
          fonte: { comissao: "ml_listing_prices", frete: "ml_shipping_options_free" }, consultado_em: new Date(AGORA).toISOString(), motivos: {},
        };
      }
      const cand = Opp.montarCandidata(args);
      if (cand) lista.push(cand);
    }
  }
  return lista;
}

function estadoInterno(conta) {
  const m = ESTADO[conta].modo;
  const snapshotAt = new Date(AGORA - (m === "antigo" ? 30 * 3600000 : 40 * 60000)).toISOString();
  const tem = m !== "sem_snapshot" && !(m === "sincronizando" && ESTADO[conta].semSnapshotAntes);
  return {
    hasSnapshot: tem, snapshotAt: tem ? snapshotAt : null, snapshotRunId: tem ? (ESTADO[conta].runSnapshot || 40) : null, partial: false,
    state: m === "sincronizando" ? "syncing" : m === "falhou" ? "failed" : m === "antigo" ? "stale" : tem ? "fresh" : "never_synced",
    snapshotState: m === "antigo" ? "stale" : tem ? "fresh" : "none",
    errorCode: m === "falhou" ? "PROMO_SNAPSHOT_LOTES_FALHANDO" : null,
    processed: ESTADO[conta].processados || 0, total: m === "sincronizando" ? CONTAS[conta].itens.length : null,
    itemsInherited: conta === 87 ? 1 : 0,
  };
}

function syncPublico(conta) {
  const e = estadoInterno(conta);
  const m = ESTADO[conta].modo;
  return {
    state: e.state, hasSnapshot: e.hasSnapshot, snapshotAt: e.snapshotAt, snapshotRunId: e.snapshotRunId, snapshotState: e.snapshotState,
    ageMinutes: e.hasSnapshot ? (m === "antigo" ? 1800 : 40) : null,
    processed: e.processed, total: e.total,
    activeRun: m === "sincronizando" ? { runId: 50, status: "running", itensProcessados: e.processed, itensTotal: e.total, rateLimits: 1, erros: 0, startedAt: new Date(AGORA - 120000).toISOString() } : null,
    autoTrigger: null,
  };
}

function respostaStatus(conta) {
  const m = ESTADO[conta].modo;
  const atualizacao = m === "sincronizando"
    ? { disponivel: false, motivo: "EM_ANDAMENTO", mensagem: "Já existe uma atualização desta conta em andamento." }
    : { disponivel: true, motivo: null, mensagem: null };
  const ultima = m === "falhou"
    ? { runId: 49, status: "failed", promovido: false, erroCodigo: "PROMO_SNAPSHOT_LOTES_FALHANDO", erroMotivo: "o Mercado Livre falhou em vários lotes seguidos", erroMensagem: "3 lotes", rateLimits: 7, finishedAt: new Date(AGORA - 3600000).toISOString() }
    : ESTADO[conta].ultima || null;
  return { ok: true, clienteContaId: conta, contaNome: CONTAS[conta].nome, sellerId: CONTAS[conta].seller,
    worker: { habilitado: true, noPiloto: true, motivo: null, frescorMinutos: 360 }, sync: syncPublico(conta), ultimaTentativa: ultima, atualizacao };
}

function respostaOpps(conta, q) {
  const e = estadoInterno(conta);
  const fontePromocoes = montarFontePromocoes({ estado: e, config: CONFIG, clienteSlug: "alianza", clienteContaId: conta, legado: null });
  const page = Math.max(1, Number(q.get("page")) || 1);
  const limit = Math.min(Math.max(Number(q.get("limit")) || 20, 1), 50);
  if (!e.hasSnapshot) {
    return { ok: true, disponivel: false, motivo: "SEM_SNAPSHOT_PROMOCOES", mensagem: fontePromocoes.rotulo, sync: syncPublico(conta), fontePromocoes, page, limit, total: 0, hasNext: false, oportunidades: [] };
  }
  const viva = q.get("cotacao") === "viva";
  const opts = {
    page, limit, veredito: Opp.parseVeredito(q.get("veredito")), tipo: Opp.parseTipo(q.get("tipo")),
    busca: Opp.parseBusca(q.get("busca")), ordem: Opp.parseOrdem(q.get("ordem")),
  };
  const ranking = Opp.rankearOportunidades(candidatas(conta, false), opts);
  let pagina = ranking.pagina;
  if (viva) {
    const vivas = new Map(candidatas(conta, true).map((c) => [c.itemId + "|" + c.promocao.id, c]));
    pagina = pagina.map((c) => Object.assign({}, vivas.get(c.itemId + "|" + c.promocao.id) || c, { opcoes_total: c.opcoes_total, opcoes: c.opcoes }));
  }
  return {
    ok: true, disponivel: true,
    fonte: { tipo: "promo_snapshot", runId: e.snapshotRunId, geradoEm: e.snapshotAt, parcial: false, itensVarridos: CONTAS[conta].itens.length, itensSemLeitura: 0,
      itensHerdados: e.itemsInherited, frescor: ESTADO[conta].modo === "antigo" ? "antigo" : "ok" },
    sync: syncPublico(conta), fontePromocoes, criterio: "Promoção disponível (que o anúncio ainda não está participando) que baixa o preço, avaliada pelo mesmo cálculo do simulador. Ordem: veredito e, dentro dele, ΔLC × unidades vendidas no período.",
    periodo: { dateFrom: "2026-10-05", dateTo: "2026-11-03", rotulo: "30 dias" },
    ...(ESTADO[conta].vendasIndisponiveis ? { vendas: { realizado: null, realizado_motivo: "CENTRAL_VENDAS_FALHOU", realizado_mensagem: "A leitura de vendas falhou." } } : {}),
    page, limit, total: ranking.total, hasNext: ranking.hasNext,
    filtro: { veredito: opts.veredito === null ? "todos" : opts.veredito, tipo: opts.tipo, busca: opts.busca, ordem: opts.ordem || "impacto" },
    contagem: ranking.contagem, resumo: ranking.resumo, tipos: ranking.tipos, cotacao: { modo: viva ? "viva" : "estimada", consultas: viva ? pagina.length : 0 },
    oportunidades: JSON.parse(JSON.stringify(pagina)),
  };
}

// Bancada (POST /api/margem/simular) do anúncio, calculada pelo núcleo.
function respostaSimular(body) {
  const conta = Number(body.cliente_conta_id);
  const it = CONTAS[conta].itens.find((x) => x.id === body.mlb);
  const meta = { margem_alvo: 0.12, margem_minima: 0 };
  const atual = { preco: it.preco, custo: it.custo, aliquota: it.aliquota, taxa_fixa: 0, comissao: it.semComissao ? null : Math.round(it.preco * it.taxa * 100) / 100, frete: it.frete, rebate: 0 };
  const lido = new Date(AGORA).toISOString();
  const evid = { comissao: { fonte: "ml_listing_prices", consultado_em: lido }, frete: { fonte: "ml_shipping_options_free", consultado_em: lido, aplicavel: true }, preco: { fonte: "promo_snapshot", observado_em: lido } };
  const cenarios = it.promos.map((pr) => {
    const classe = classificarPromocao({ tipo: pr.tipo, status: pr.status });
    const cot = it.semComissao ? { comissao: null, frete: it.frete } : { comissao: Math.round(pr.precoPromo * it.taxa * 100) / 100, frete: pr.precoPromo < 79 ? 0 : it.frete };
    return {
      tipo: "promo", entrada: { tipo: "promo", promotion_id: pr.id },
      promocao: { id: pr.id, chave: pr.id, nome: pr.nome, tipo: pr.tipo, status_exibicao: pr.status === "started" ? "ATIVA" : "ELEGÍVEL", grupo: classe.grupo, inicio: null, fim: pr.fim, preco_final: pr.precoPromo, escrita: classe.escrita },
      ...core.calcularCenario({ atual, cenario: { tipo: "promo", preco: pr.precoPromo, rebate: pr.retornoMl, preco_cheio: it.preco, preco_cheio_fonte: "margin_snapshot" }, cotacao: cot, meta }),
      evidencia: evid,
    };
  });
  const c0 = (body.cenarios || [])[0] || {};
  let lista = cenarios;
  if (c0.tipo === "promo") lista = cenarios.filter((c) => c.promocao.id === c0.promotion_id);
  if (c0.tipo === "preco") {
    lista = [{ tipo: "preco", entrada: c0, ...core.calcularCenario({ atual, cenario: { tipo: "preco", preco: Number(c0.preco) }, cotacao: { comissao: Math.round(Number(c0.preco) * it.taxa * 100) / 100, frete: it.frete }, meta }), evidencia: evid }];
  }
  const e = estadoInterno(conta);
  return {
    ok: true, mlb: it.id, item: { mlb: it.id, ml_promos_url: null },
    atual: { ...core.calcularAtual({ atual }).atual, aliquota: it.aliquota, preco_cheio: it.preco, preco_cheio_fonte: "margin_snapshot", base: { id: 3, nome: "Alianza" }, bloqueios: [], rebate_motivo: null },
    meta, promocoes: { disponivel: true, motivo: null, snapshot_em: e.snapshotAt, parcial: false },
    fontePromocoes: montarFontePromocoes({ estado: e, config: CONFIG, clienteSlug: "alianza", clienteContaId: conta, legado: null }),
    cotacoes: { consultas: lista.length, precos_distintos: lista.length, limite_excedido: 0, maximo_por_requisicao: 40 },
    cenarios: lista,
  };
}

// Margin Snapshot da aba Precificar (fora do escopo): poucas linhas, em memória.
function injecao() {
  const itens = { 86: CONTAS[86].itens.slice(0, 6), 87: CONTAS[87].itens.slice(0, 8) };
  const linhas = {};
  for (const conta of [86, 87]) {
    linhas[conta] = itens[conta].map((it) => {
      const lc = Math.round((it.preco * (1 - it.aliquota - it.taxa) - it.frete - it.custo) * 100) / 100;
      return { id: it.id, titulo: it.titulo, preco: it.preco, imagem: it.imagem, custo: it.custo, taxa: it.taxa, frete: it.frete, lc, margem: Math.round(lc / it.preco * 10000) / 10000 };
    });
  }
  return `
    localStorage.setItem("vf-token", "ui-test-token");
    localStorage.setItem("vf-user", JSON.stringify({ nome: "Gestor Teste", role: "admin" }));
    window.__VF_CENTRAL_MARGEM_PROMO_SYNC_POLL_MS__ = 300;
    (function () {
      var LINHAS = ${JSON.stringify(linhas)};
      function ev(source, value, quality) { return { source: source, kind: "PROJECTED", value: value, quality: quality || "MEASURED", observedAt: "2026-11-04T10:00:00Z", note: null }; }
      function field(e) { return { present: !!e, selectedValue: e ? e.value : null, selectedSource: e ? e.source : null, selectedKind: e ? "PROJECTED" : null, projected: e, realized: null, evidences: e ? [e] : [], divergences: [], hasConflict: false, hasDrift: false }; }
      function raw(l) {
        var status = l.margem < 0 ? "LOSS" : l.margem < 0.12 ? "LOW_MARGIN" : "HEALTHY";
        return { itemId: l.id, title: l.titulo, titulo: l.titulo, image: l.imagem, sku: "AJ-" + l.id.slice(-4), status: status, statusAnuncio: "active", confidence: "HIGH", marketplace: "meli", targetMargin: 0.12,
          fields: { price: field(ev("MELI_API", l.preco)), cost: field(ev("VENFORCE_BASE", l.custo, "DECLARED")), taxRate: field(ev("VENFORCE_BASE", 0.08, "DECLARED")),
            fixedFee: field(ev("VENFORCE_BASE", 0, "DECLARED")), commission: field(ev("MELI_API", Math.round(l.preco * l.taxa * 100) / 100)), commissionRate: field(ev("MELI_API", l.taxa)), freight: field(ev("MELI_API", l.frete)) },
          projected: { margin: l.margem, profit: l.lc, estimated: false } };
      }
      var cache = null;
      function mocks() {
        var A = window.VFCentralMargemApi;
        return {
          getWorkspace: function () { return Promise.resolve({ ok: false, status: 500, error: "workspace ao vivo não é usado" }); },
          getSnapshotResumo: function (p) {
            if (!p.clienteContaId) return Promise.resolve({ ok: false, status: 400, code: "CLIENTE_CONTA_ID_OBRIGATORIO", error: "conta" });
            var l = LINHAS[p.clienteContaId] || [];
            var por = { HEALTHY: 0, LOW_MARGIN: 0, LOSS: 0, UNVALIDATED: 0, SUSPECT_DATA: 0, RECONCILING: 0 };
            l.forEach(function (x) { por[raw(x).status] += 1; });
            return Promise.resolve(A.normalizeSnapshotResumo({ habilitado: true, estado: "ready", acao: null, mensagem: null,
              conta: { id: Number(p.clienteContaId), nome: p.clienteContaId == 87 ? "Alianza Jeans 2" : "Alianza Jeans 1" },
              snapshot: { totalItens: l.length, ultimoCalculoEm: "2026-11-04T10:00:00Z", foraDoCatalogo: 0 },
              kpis: { total: l.length, porStatus: por, porRefreshStatus: { fresh: l.length, stale: 0, failed: 0 }, anuncios: { total: l.length, ativos: l.length, pausados: 0 }, comMargem: l.length },
              refresh: { runAtivo: null, ultimoRun: null } }));
          },
          getSnapshotItens: function (p) {
            var l = LINHAS[p.clienteContaId] || [];
            return Promise.resolve(A.normalizeSnapshotItens({ estado: "ready", paginacao: { page: 1, limit: p.limit || 50, total: l.length, totalPaginas: 1 },
              periodo: { dateFrom: "2026-10-05", dateTo: "2026-11-03" }, ultimoCalculoEm: "2026-11-04T10:00:00Z", itens: l.map(raw), refresh: { runAtivo: null, ultimoRun: null } },
              { client: { slug: p.clientSlug, name: p.clientName }, marketplace: "meli" }));
          },
          getSnapshotRealizado: function () {
            return Promise.resolve(A.normalizeSnapshotRealizado({ ok: true, habilitado: true, realizado: null, realizado_motivo: "CENTRAL_VENDAS_FALHOU", realizado_mensagem: "fora do teste",
              periodo: { dateFrom: "2026-10-05", dateTo: "2026-11-03", modo: "ultimos30", periodo: null, rotulo: "30 dias" }, cobertura: null,
              freshness: { estado: "INDISPONIVEL", sincronizadoAte: null, syncEmAndamento: false, syncAtivo: null }, kpis: null }));
          },
        };
      }
      Object.defineProperty(window, "__VF_CENTRAL_MARGEM_API_CLIENT__", { configurable: true,
        get: function () { if (!cache && window.VFCentralMargemApi) cache = Object.assign({}, window.VFCentralMargemApi.createClient(), mocks()); return cache || undefined; } });
    })();
  `;
}

// ── Infra (mesmo harness dos testes visuais da Central) ─────────────────────
function startStaticServer() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = pathname === "/" ? "central-margem.html" : pathname.replace(/^\/+/, "");
    const target = path.resolve(PORTAL_DIR, relative);
    if (!target.startsWith(PORTAL_DIR + path.sep)) { response.writeHead(403).end("forbidden"); return; }
    fs.readFile(target, (error, contents) => {
      if (error) { response.writeHead(404).end("not found"); return; }
      const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
      response.writeHead(200, { "Content-Type": types[path.extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
      response.end(contents);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitChrome(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return; } catch (_) { /* aguardando */ }
    await sleep(50);
  }
  throw new Error("Chrome DevTools não iniciou.");
}

class Cdp {
  constructor(url) { this.socket = new WebSocket(url); this.nextId = 1; this.pending = new Map(); this.onEvent = null; }
  async open() {
    await new Promise((resolve, reject) => { this.socket.addEventListener("open", resolve, { once: true }); this.socket.addEventListener("error", reject, { once: true }); });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
        return;
      }
      if (message.method && this.onEvent) this.onEvent(message.method, message.params);
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error((result.exceptionDetails.exception && result.exceptionDetails.exception.description) || result.exceptionDetails.text || "Falha na avaliação");
    return result.result.value;
  }
}

async function waitFor(cdp, expression, message, tentativas = 200) {
  for (let attempt = 0; attempt < tentativas; attempt += 1) {
    if (await cdp.evaluate(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(message || `Timeout: ${expression}`);
}

let checks = 0;
async function check(name, fn) {
  if (MODO_ANTES) { try { await fn(); } catch (err) { console.log(`(antes) ${name}: ${String(err.message).split("\n")[0]}`); } return; }
  await fn(); checks += 1; console.log(`ok ${checks} - ${name}`);
}

async function run() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const server = await startStaticServer();
  const debugPort = 17000 + Math.floor(Math.random() * 1000);
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/vf-cm-promos-ux-${process.pid}`, "about:blank",
  ], { stdio: "ignore" });
  let cdp;
  const arquivos = [];
  try {
    await waitChrome(debugPort);
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })).json();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    const PROD_HOST = "venforce-server.onrender.com";
    cdp.onEvent = async (method, params) => {
      if (method !== "Fetch.requestPaused") return;
      const url = params.request.url;
      const respond = async (m, p) => { try { await cdp.send(m, p); } catch (err) { if (!/Invalid InterceptionId/.test(err.message || "")) throw err; } };
      if (!url.includes(PROD_HOST)) { await respond("Fetch.continueRequest", { requestId: params.requestId }); return; }
      const cors = [
        { name: "access-control-allow-origin", value: "*" },
        { name: "access-control-allow-headers", value: "authorization,content-type" },
        { name: "access-control-allow-methods", value: "GET,POST,OPTIONS" },
      ];
      const json = (obj, code = 200) => respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: code,
        responseHeaders: [...cors, { name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(obj)).toString("base64") });
      if (params.request.method === "OPTIONS") { await respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 204, responseHeaders: cors }); return; }
      const u = new URL(url);
      const conta = Number(u.searchParams.get("clienteContaId")) || null;
      try {
        if (u.pathname.includes("/me/context")) {
          await json({ ok: true, user: { id: 12, nome: "Gestor Teste", email: null, role: "user" }, squads: [], squadPrincipalId: null,
            clientes: [{ id: 30, slug: "alianza", nome: "Alianza Jeans", squadId: null, responsavelDireto: false, contasAtivas: null }], portfolio: { totalClientes: 1 }, permissoes: { podeAdministrar: false } });
          return;
        }
        if (u.pathname.includes("/operacao/cliente-360/clientes")) {
          await json({ ok: true, clientes: [{ id: 30, nome: "Alianza Jeans", slug: "alianza", ativo: true, temGrant: true, grantStatus: "conectado", temBase: true, setupScore: 100, statusOperacional: "pronto", ultimaSincronizacao: null, pendencias: [] }] });
          return;
        }
        if (/\/clientes\/[^/?]+\/contas/.test(u.pathname)) {
          await json({ ok: true, cliente: { id: 30, nome: "Alianza Jeans", slug: "alianza", ativo: true }, contas: [86, 87].map((id) => ({
            id, cliente_id: 30, marketplace: "meli", nome: CONTAS[id].nome, slug: "ml-" + id, external_account_id: CONTAS[id].seller, externalAccountLabel: CONTAS[id].nome,
            is_primary: id === 86, ativo: true, grant: { id, token_status: "valid" }, base: { id: 3, nome: "Alianza" } })) });
          return;
        }
        if (u.pathname.endsWith("/promocoes/status")) {
          chamadas.status.push(conta);
          await json(respostaStatus(conta));
          return;
        }
        if (u.pathname.endsWith("/promocoes/sync")) {
          const body = JSON.parse(params.request.postData || "{}");
          const c = Number(body.clienteContaId || body.cliente_conta_id || conta);
          chamadas.sync.push(c);
          ESTADO[c].semSnapshotAntes = ESTADO[c].modo === "sem_snapshot";
          ESTADO[c].modo = "sincronizando";
          ESTADO[c].processados = 0;
          await json({ ok: true, enfileirado: true, reaproveitado: false, runId: 50, clienteContaId: c });
          return;
        }
        if (u.pathname.endsWith("/precificacao/oportunidades")) {
          chamadas.opps.push({ conta, page: Number(u.searchParams.get("page")), limit: Number(u.searchParams.get("limit")), veredito: u.searchParams.get("veredito"),
            tipo: u.searchParams.get("tipo"), busca: u.searchParams.get("busca"), ordem: u.searchParams.get("ordem"), cotacao: u.searchParams.get("cotacao") });
          const resposta = respostaOpps(conta, u.searchParams);
          if (SEGURAR.opps) { SEGURAR.fila.push(() => json(resposta)); return; }
          await json(resposta);
          return;
        }
        if (u.pathname.endsWith("/api/margem/simular")) {
          const body = JSON.parse(params.request.postData || "{}");
          chamadas.simular.push(body);
          await json(respostaSimular(body));
          return;
        }
      } catch (err) {
        await json({ ok: false, error: String(err.message || err) }, err.statusCode || 500);
        return;
      }
      await respond("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" });
    };

    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: injecao() });
    const tamanho = (w, h = 900) => cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await tamanho(1440);
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/central-margem.html?cliente=alianza` });

    const shot = async (name, opts = {}) => {
      await sleep(250);
      const params = { format: "png" };
      if (opts.inteira) {
        const alt = await cdp.evaluate("Math.max(document.documentElement.scrollHeight, 900)");
        const larg = await cdp.evaluate("window.innerWidth");
        params.clip = { x: 0, y: 0, width: larg, height: Math.min(alt, 2600), scale: 1 };
        params.captureBeyondViewport = true;
      }
      const r = await cdp.send("Page.captureScreenshot", params);
      const arquivo = path.join(SHOT_DIR, name + ".png");
      fs.writeFileSync(arquivo, Buffer.from(r.data, "base64"));
      arquivos.push(arquivo);
    };
    const st = (expr) => cdp.evaluate(`(function(){var s=window.VFCentralMargemUi.getState(); return ${expr};})()`);
    const texto = async (sel) => ((await cdp.evaluate(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText||""`)) || "").replace(/ /g, " ");
    // Nada vaza para fora da página nem do card; nenhum texto de célula cortado sem reticências/tooltip.
    const semOverflow = async (rotulo) => {
      const r = JSON.parse(await cdp.evaluate(`JSON.stringify((function () {
        var doc = document.documentElement.scrollWidth <= window.innerWidth + 1;
        var wrap = document.querySelector('.cm-opps-wrap');
        var tabela = wrap ? wrap.scrollWidth <= wrap.clientWidth + 1 : true;
        var cortadas = [];
        document.querySelectorAll('#cm-opps-host tr.cm-promo-row > td').forEach(function (td) {
          td.querySelectorAll('.cm-cel__v, .cm-cel__sub, .cm-promo-acoes, .vf-status').forEach(function (el) {
            var b = el.getBoundingClientRect(); var c = td.getBoundingClientRect();
            if (b.width && (b.right > c.right + 1 || b.left < c.left - 1)) cortadas.push(td.cellIndex + ':' + el.className + ':' + el.textContent.trim().slice(0, 30));
          });
        });
        var bar = document.querySelector('.cm-promos__bar'); var barOk = !bar || bar.scrollWidth <= bar.clientWidth + 1;
        return { doc: doc, tabela: tabela, cortadas: cortadas.slice(0, 5), barOk: barOk };
      })())`));
      assert.ok(r.doc, `${rotulo}: rolagem horizontal na página`);
      assert.ok(r.tabela, `${rotulo}: a tabela rola na horizontal dentro do card`);
      assert.ok(r.barOk, `${rotulo}: barra de filtros transborda`);
      assert.deepStrictEqual(r.cortadas, [], `${rotulo}: elementos cortados`);
    };
    const linhas = () => cdp.evaluate("Array.prototype.map.call(document.querySelectorAll('#cm-opps-host tr.cm-promo-row'), function (tr) { return tr.getAttribute('data-opp'); })");
    const pronto = "document.querySelector('#cm-opps-host tr[data-opp]') && document.getElementById('cm-promos-live').getAttribute('data-cm-live') === 'ok'";
    const selecionarConta = async (id) => {
      await waitFor(cdp, "window.VFCentralMargemUi && window.VF && window.VF.context", "Shell não carregou");
      for (let i = 0; i < 80; i += 1) {
        await cdp.evaluate(`window.VF.context.setConta(${id})`);
        if (await st(`s.contaId === ${id}`)) break;
        await sleep(100);
      }
      assert.strictEqual(await st("s.contaId"), id, "conta selecionada pelo Shell");
    };

    // ── 1. Conta 87, leitura atualizada ──────────────────────────────────
    await selecionarConta(87);
    await waitFor(cdp, "window.VFCentralMargemUi.getState().mode === 'snapshot' && document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length === 8", "Precificar da conta 87 não carregou");
    await shot("00-precificar-1440");

    await check("Abrir Promoções (Shell, sidebar aberta): carregando → lista; barra da conta, recortes com contagem, busca e ordem visíveis", async () => {
      SEGURAR.opps = true;
      await cdp.evaluate("document.querySelector('[data-view=promotions]').click()");
      await waitFor(cdp, "document.querySelector('#cm-opps-host .vf-loading-state, #cm-opps-host [class*=loading]')", "estado de carregamento não apareceu");
      await shot("01-carregando-1440");
      SEGURAR.opps = false;
      while (SEGURAR.fila.length) await SEGURAR.fila.shift()();
      await waitFor(cdp, pronto, "a lista não carregou");
      assert.ok(await cdp.evaluate("document.querySelector('.vf-shell, [data-vf-shell], aside, nav') !== null"), "Shell presente");
      const sync = await texto("#cm-promo-sync");
      assert.ok(/Alianza Jeans 2/.test(sync) && /87/.test(sync), `barra identifica a conta: ${sync}`);
      if (!MODO_ANTES) {
        const seg = await texto("#cm-promo-seg");
        assert.ok(/Oportunidades\s*\d+/.test(seg) && /Vale entrar\s*\d+/.test(seg) && /Bloqueado\s*\d+/.test(seg), `recortes com contagem: ${seg}`);
        assert.strictEqual(await cdp.evaluate("document.getElementById('cm-promo-busca').offsetParent !== null"), true, "busca visível");
        assert.strictEqual(await cdp.evaluate("document.getElementById('cm-promo-ordem').offsetParent !== null"), true, "ordem visível");
        const cab = (await texto(".cm-opps-table > thead")).replace(/\s+/g, " ").toLowerCase();
        for (const c of ["anúncio", "promoção", "preço", "ml banca", "lucro/un", "margem", "veredito"]) assert.ok(cab.includes(c), `coluna ${c}: ${cab}`);
        assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#cm-opps-host tr.cm-promo-row').length"), 20, "página de 20");
        assert.ok(/1–20 de \d+/.test(await texto(".cm-opps-pager")), "paginação do servidor");
        // Central = decisão financeira: o resumo do servidor diz quanto as que valem entrar somam;
        // a execução (Radar / participação em massa) fica em Anúncios ML, só por navegação contextual.
        assert.ok(/^Vale entrar em \d+ anúncios?/.test(await texto("#cm-promo-resumo")), await texto("#cm-promo-resumo"));
        assert.ok(/anuncios-meli\.html\?cliente=alianza&conta=87$/.test(await cdp.evaluate("document.getElementById('cm-promo-executar').href")), "atalho para o Radar da MESMA conta");
      }
      await shot("02-lista-1440");
      await shot("02b-lista-1440-inteira", { inteira: true });
    });

    await check("Densidade: linhas de altura uniforme (≤ 72px) e ~10 anúncios por tela a 1440×900", async () => {
      const alturas = await cdp.evaluate("Array.prototype.map.call(document.querySelectorAll('#cm-opps-host tr.cm-promo-row'), function (tr) { return Math.round(tr.getBoundingClientRect().height); })");
      const max = Math.max(...alturas);
      assert.ok(max <= 72, `linha alta demais: ${max}px (${alturas.join(",")})`);
      assert.ok(max - Math.min(...alturas) <= 6, `alturas desiguais: ${alturas.join(",")}`);
    });

    for (const w of [1366, 1440, 1920]) {
      await check(`${w}px com a sidebar aberta: sem rolagem horizontal, sem elemento cortado`, async () => {
        await tamanho(w);
        await sleep(300);
        assert.ok(await cdp.evaluate("(function(){var a=document.querySelector('aside, .vf-shell__sidebar, [class*=sidebar]'); return !!a && a.getBoundingClientRect().width > 150;})()"), "sidebar aberta");
        await shot(`03-lista-${w}`);
        await semOverflow(`${w}px`);
      });
    }
    await tamanho(1440);

    await check("Busca vai ao servidor (debounce, página 1) e a contagem dos recortes acompanha; limpar volta à lista", async () => {
      chamadas.opps.length = 0;
      await cdp.evaluate("(function(){var i=document.getElementById('cm-promo-busca'); i.focus(); i.value='bermuda'; i.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await waitFor(cdp, "Array.prototype.every.call(document.querySelectorAll('#cm-opps-host tr.cm-promo-row .cm-prod-title'), function (t) { return /bermuda/i.test(t.textContent); }) && document.querySelectorAll('#cm-opps-host tr.cm-promo-row').length > 0 && document.getElementById('cm-promos-live').getAttribute('data-cm-live') === 'ok'", "busca não filtrou");
      assert.ok(chamadas.opps.every((c) => c.busca === "bermuda" && c.page === 1), JSON.stringify(chamadas.opps));
      assert.ok(chamadas.opps.length <= 2, `uma leitura estimada + a cotação ao vivo: ${chamadas.opps.length}`);
      const seg = await texto("#cm-promo-seg");
      const todas = Number((seg.match(/Todas\s*(\d+)/) || [])[1]);
      assert.ok(todas > 0 && todas <= 4, `contagem do recorte da busca: ${seg}`);
      await shot("04-busca");
      await cdp.evaluate("(function(){var i=document.getElementById('cm-promo-busca'); i.value='zzz-nada'; i.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await waitFor(cdp, "document.querySelector('[data-cm-opps=vazio] [data-cm-limpar-busca]')", "vazio da busca sem 'Limpar busca'");
      await shot("05-busca-vazia");
      await cdp.evaluate("document.querySelector('[data-cm-limpar-busca]').click()");
      await waitFor(cdp, `${pronto} && document.querySelectorAll('#cm-opps-host tr.cm-promo-row').length === 20 && document.getElementById('cm-promo-busca').value === ''`, "limpar busca não voltou");
    });

    await check("Recortes por veredito: 'Vale entrar' e 'Bloqueado' filtram no servidor; o bloqueado diz o motivo e não mostra número inventado", async () => {
      await cdp.evaluate("document.querySelector('[data-cm-seg=entrar]').click()");
      await waitFor(cdp, `${pronto} && document.querySelector('[data-cm-seg=entrar]').getAttribute('aria-pressed') === 'true'`, "recorte não aplicou");
      const vereditos = await cdp.evaluate("Array.prototype.map.call(document.querySelectorAll('#cm-opps-host tr.cm-promo-row [data-cm-veredito]'), function (v) { return v.getAttribute('data-cm-veredito'); })");
      assert.ok(vereditos.length && vereditos.every((v) => v === "entrar"), vereditos.join(","));
      await shot("06-vale-entrar");
      await cdp.evaluate("document.querySelector('[data-cm-seg=bloqueado]').click()");
      await waitFor(cdp, `document.querySelector('[data-cm-seg=bloqueado]').getAttribute('aria-pressed') === 'true' && document.querySelector('#cm-opps-host tr.cm-promo-row [data-cm-flag=bloqueado]')`, "bloqueados não apareceram");
      const lin = await texto("#cm-opps-host tr.cm-promo-row");
      assert.ok(/tarifa do Mercado Livre indisponível|comissão atual ausente|faltam dados/.test(lin), `motivo do bloqueio: ${lin}`);
      assert.ok(/indisponível/.test(await texto("#cm-opps-host tr.cm-promo-row [data-cm-lc]")), "lucro indisponível, não zero");
      await semOverflow("bloqueados");
      await shot("07-bloqueado-financeiro-incompleto");
      await cdp.evaluate("document.querySelector('[data-cm-seg=\"\"]').click()");
      await waitFor(cdp, `${pronto} && document.querySelector('[data-cm-seg=\"\"]').getAttribute('aria-pressed') === 'true'`);
    });

    await check("Ordenação: 'Maior subsídio do ML' (select e cabeçalho) reordena no servidor; seta na coluna ativa", async () => {
      await cdp.evaluate("document.querySelector('[data-cm-ordenar=subsidio]').click()");
      await waitFor(cdp, `${pronto} && document.getElementById('cm-promo-ordem').value === 'subsidio'`, "ordem não aplicou");
      assert.strictEqual(chamadas.opps[chamadas.opps.length - 1].ordem, "subsidio");
      const valores = await cdp.evaluate("Array.prototype.map.call(document.querySelectorAll('#cm-opps-host tr.cm-promo-row [data-cm-banca] .cm-cel__v'), function (e) { var t = e.textContent.replace(/[^0-9,-]/g,'').replace(',','.'); return t ? Number(t) : null; })");
      const numeros = valores.filter((v) => v !== null);
      for (let i = 1; i < numeros.length; i += 1) assert.ok(numeros[i - 1] >= numeros[i] - 0.001, `não está em ordem de subsídio: ${valores.join(",")}`);
      assert.strictEqual(await cdp.evaluate("document.querySelector('[data-cm-ordenar=subsidio]').closest('th').getAttribute('aria-sort')"), "descending");
      await shot("08-ordem-subsidio");
      await cdp.evaluate("(function(){var s=document.getElementById('cm-promo-ordem'); s.value=''; s.dispatchEvent(new Event('change',{bubbles:true}));})()");
      await waitFor(cdp, `${pronto} && !document.querySelector('.cm-th-ordem.is-active')`);
    });

    await check("Paginação: 3 páginas da conta 87; Próxima/Anterior pedem a página ao servidor", async () => {
      await cdp.evaluate("document.querySelector('[data-cm-seg=todos]').click()");
      await waitFor(cdp, `${pronto} && document.querySelector('[data-cm-seg=todos]').getAttribute('aria-pressed') === 'true'`);
      const total = await st("s.opps.total");
      assert.ok(total > 40, `todas as promoções da conta: ${total}`);
      await cdp.evaluate("document.querySelector('[data-opps-page=\"2\"]').click()");
      await waitFor(cdp, `${pronto} && /21–40 de/.test(document.querySelector('.cm-opps-pager').textContent)`, "página 2 não veio");
      await cdp.evaluate("document.querySelector('[data-opps-page=\"3\"]').click()");
      await waitFor(cdp, `${pronto} && /41–${total} de/.test(document.querySelector('.cm-opps-pager').textContent)`, "página 3 não veio");
      assert.ok(await cdp.evaluate("document.querySelector('[data-opps-page=\"4\"]').disabled"), "Próxima desabilitada na última");
      await cdp.evaluate("document.querySelector('[data-opps-page=\"2\"]').click()");
      await waitFor(cdp, `${pronto} && /21–40 de/.test(document.querySelector('.cm-opps-pager').textContent)`);
      await shot("09-paginacao");
      await cdp.evaluate("document.querySelector('[data-cm-seg=\"\"]').click()");
      await waitFor(cdp, `${pronto} && /^1–/.test(document.querySelector('.cm-opps-pager').textContent.trim())`);
    });

    await check("Linha aberta: Hoje × Promo, quem banca, frete (saiu da linha), empate e origem — e '+N opções'", async () => {
      await cdp.evaluate("document.querySelector('#cm-opps-host tr.cm-promo-row .cm-c-produto').click()");
      await waitFor(cdp, "document.querySelector('tr.cm-promo-detail:not([hidden]) [data-cm-bancada-cascata]')", "detalhe não abriu");
      await shot("10-linha-aberta");
      const det = (await texto("tr.cm-promo-detail:not([hidden])")).replace(/\s+/g, " ");
      for (const t of ["Hoje", "ML banca", "Você banca", "Frete:", "na promoção", "Lista: Promo Snapshot"]) assert.ok(det.includes(t), `falta ${t}: ${det}`);
      await semOverflow("linha aberta");
      await cdp.evaluate("document.querySelector('#cm-opps-host tr.cm-promo-row .cm-c-produto').click()");
      const comMais = await cdp.evaluate("(function(){var b=document.querySelector('#cm-opps-host [data-promo-more]'); if(!b) return null; b.click(); return b.getAttribute('data-promo-more');})()");
      if (comMais) {
        await waitFor(cdp, `!document.querySelector('tr[data-promo-options="${comMais}"]').hidden`, "+N opções não abriu");
        await shot("11-outras-opcoes");
        await cdp.evaluate(`document.querySelector('[data-promo-more="${comMais}"]').click()`);
      }
    });

    await check("Simular abre a Bancada (drawer) já na promoção da linha, com a conta 87", async () => {
      chamadas.simular.length = 0;
      const id = (await linhas())[0];
      await cdp.evaluate(`document.querySelector('tr[data-opp="${id}"] [data-opp-item]').click()`);
      await waitFor(cdp, "document.querySelector('[data-cm-cenarios]')", "Bancada não carregou");
      assert.ok(chamadas.simular.length >= 1 && chamadas.simular.every((b) => Number(b.cliente_conta_id) === 87 && b.mlb === id), JSON.stringify(chamadas.simular));
      await shot("12-bancada");
      await cdp.evaluate("window.VFCentralMargemUi.closeDrawer()");
    });

    // ── 2. Estados da leitura ────────────────────────────────────────────
    const recarregarAba = async () => {
      await cdp.evaluate("document.querySelector('[data-view=operational]').click()");
      await cdp.evaluate("window.VFCentralMargemUi.getState().opps = null; document.querySelector('[data-view=promotions]').click()");
    };

    await check("Leitura antiga (>24h): barra em atenção, lista continua visível e marcada como antiga", async () => {
      ESTADO[87].modo = "antigo";
      await recarregarAba();
      await waitFor(cdp, `${pronto} && document.getElementById('cm-promo-sync').getAttribute('data-cm-promo-sync') === 'desatualizado'`, "estado antigo não apareceu");
      assert.ok(/antig|desatualiz/i.test(await texto("#cm-promo-sync") + (await texto("#cm-opps-meta"))), "diz que é antiga");
      await shot("13-antiga");
    });

    await check("Falhou: motivo verificável na barra; a última leitura válida segue na tabela", async () => {
      ESTADO[87].modo = "falhou";
      await recarregarAba();
      await waitFor(cdp, `${pronto} && document.getElementById('cm-promo-sync').getAttribute('data-cm-promo-sync') === 'falhou'`, "falha não apareceu");
      assert.ok(/vários lotes/.test(await texto("#cm-promo-sync")));
      await shot("14-falhou");
    });

    await check("Atualizar na própria aba: sincronizando com progresso real → concluído → lista recarregada", async () => {
      ESTADO[87].modo = "atualizado";
      ESTADO[87].ultima = null;
      await recarregarAba();
      await waitFor(cdp, `${pronto} && document.querySelector('[data-cm-promo-sync-acao]') && !document.querySelector('[data-cm-promo-sync-acao]').disabled`, "botão Atualizar indisponível");
      await cdp.evaluate("document.querySelector('[data-cm-promo-sync-acao]').click()");
      await waitFor(cdp, "document.getElementById('cm-promo-sync').getAttribute('data-cm-promo-sync') === 'sincronizando'", "não entrou em sincronizando");
      ESTADO[87].processados = 21;
      await waitFor(cdp, "/21 de 45/.test(document.getElementById('cm-promo-sync').textContent)", "progresso não apareceu");
      assert.ok(await cdp.evaluate("Boolean(document.querySelector('#cm-opps-host tr.cm-promo-row'))"), "a lista anterior continua enquanto sincroniza");
      await shot("15-sincronizando");
      ESTADO[87].modo = "atualizado";
      ESTADO[87].runSnapshot = 50;
      ESTADO[87].ultima = { runId: 50, status: "completed", promovido: true, finishedAt: new Date(AGORA).toISOString() };
      await waitFor(cdp, "document.querySelector('[data-cm-promo-sync-aviso]') && /concluída/.test(document.querySelector('[data-cm-promo-sync-aviso]').textContent)", "conclusão não foi avisada", 300);
      await waitFor(cdp, pronto);
      await shot("16-concluido");
    });

    // ── 3. Conta 86 (Alianza Jeans 1): nada da 87 aparece ────────────────
    await check("Trocar para Alianza Jeans 1 (86) no Shell: só anúncios da 86, filtros zerados; vendas indisponíveis nunca viram 0", async () => {
      ESTADO[86].vendasIndisponiveis = true;
      await selecionarConta(86);
      await waitFor(cdp, `${pronto} && /Alianza Jeans 1/.test(document.getElementById('cm-promo-sync').textContent)`, "a conta 86 não carregou");
      await shot("17-conta86");
      const ids = await linhas();
      assert.ok(ids.length && ids.every((id) => id.startsWith("MLB41")), `só anúncios da 86: ${ids.join(",")}`);
      assert.ok(!/MLB54/.test(await texto("#cm-opps-host")), "nada da 87");
      if (!MODO_ANTES) assert.ok(/conta=86$/.test(await cdp.evaluate("document.getElementById('cm-promo-executar').href")), "o atalho acompanha a conta do Shell");
      assert.ok(/vendas indisp\./.test(await texto("#cm-opps-host")), "vendas indisponíveis ditas");
      assert.ok(!/\b0 un\./.test(await texto("#cm-opps-host")), "nunca '0 un.'");
      await semOverflow("conta 86");
    });

    await check("Conta sem leitura de promoções: mensagem e 'Buscar promoções' na barra, sem tabela vazia confusa", async () => {
      ESTADO[86].modo = "sem_snapshot";
      await recarregarAba();
      await waitFor(cdp, "document.querySelector('[data-cm-opps=indisponivel]') && document.getElementById('cm-promo-sync').getAttribute('data-cm-promo-sync') === 'sem_leitura'", "estado sem leitura não apareceu");
      assert.ok(/Buscar promoções/.test(await texto("#cm-promo-sync")));
      if (!MODO_ANTES) {
        assert.strictEqual(await cdp.evaluate("document.getElementById('cm-promo-seg').hidden && document.querySelector('.cm-promos__bar').hidden"), true, "sem lista: sem recortes/contagens velhas nem filtros que não fazem nada");
        assert.ok(/Peça a leitura na barra acima/.test(await texto("#cm-opps-host")), "o vazio diz o próximo passo");
      }
      await shot("18-sem-leitura");
      ESTADO[86].modo = "atualizado";
    });

    // ── 4. Sem regressão nas outras abas ────────────────────────────────
    await check("Precificar e Diagnóstico continuam iguais (tabela, busca e filtros da planilha voltam)", async () => {
      await cdp.evaluate("document.querySelector('[data-view=operational]').click()");
      await waitFor(cdp, "document.querySelectorAll('#cm-table-host tbody tr[data-item-id]').length === 6 && !document.getElementById('cm-sheet-toolbar').hidden && document.getElementById('cm-promos').hidden", "Precificar não voltou");
      await semOverflow("Precificar");
      await shot("19-precificar-depois");
      await cdp.evaluate("document.querySelector('[data-view=composition]').click()");
      await waitFor(cdp, "document.getElementById('cm-divergences').hidden === false && document.getElementById('cm-promos').hidden", "Diagnóstico não abriu");
      await shot("20-diagnostico-depois");
    });

    if (!MODO_ANTES) console.log(`# ${checks} testes de UX da aba Promoções concluídos`);
    for (const a of arquivos) console.log("  screenshot: " + a);
  } finally {
    try { chrome.kill("SIGTERM"); } catch (_) { /* */ }
    server.close();
  }
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
