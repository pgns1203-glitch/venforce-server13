// server/tests/promocoesCentralUnificada.postgres.test.js
//
// ACEITE DE PONTA A PONTA — Central de Promoções unificada (Central de Margem
// + Promo Snapshot), sem a tela antiga "Promoções ML".
//
// O que é REAL aqui:
//   - PostgreSQL local (banco criado e apagado pelo teste; host obrigatório
//     localhost);
//   - migration versionada do Promo Snapshot (schemaEnsure / #377);
//   - repositório, run service, worker genérico (claim SKIP LOCKED,
//     heartbeat, fencing), processor, read service, controller HTTP,
//     listarOportunidades (Motor de Margem) e validação de conta + grant
//     (mlTokenService.resolveMlGrant contra ml_tokens);
//   - a Central de Margem (Portal/central-margem*.js) num Chrome headless,
//     com o Shell V3 (vf-shell / vf-context) e o client HTTP real da Central
//     falando com este backend por fetch.
// O que é FALSO:
//   - o Mercado Livre (só GET; caminho, método e seller de cada chamada
//     registrados; latência, 429 e grant revogado por roteiro);
//   - o Margin Snapshot da tabela principal da Central (resumo/itens/
//     realizado) — fora do escopo das promoções; o resto do client é o real;
//   - JWT/carteira (o middleware de autenticação não está montado; a
//     autorização por conta do service — conta do cliente, MELI, ativa,
//     seller — está).
//
// Uso (cluster local, nunca produção):
//   VF_PG_PROMO_TEST_DATABASE_URL=postgres://vf@127.0.0.1:57652/postgres \
//     node tests/promocoesCentralUnificada.postgres.test.js
// Sem a variável o teste é pulado. Sem google-chrome, a parte de interface é
// pulada e o resto roda.

"use strict";

const BASE_URL = process.env.VF_PG_PROMO_TEST_DATABASE_URL;
if (!BASE_URL) {
  console.log("  (pulado) defina VF_PG_PROMO_TEST_DATABASE_URL para rodar contra PostgreSQL local");
  process.exit(0);
}
const HOST = new URL(BASE_URL).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(HOST)) {
  console.error(`LOCAL_DATABASE_REQUIRED (host=${HOST})`);
  process.exit(1);
}
// O pool do app (config/database) nunca é usado: porta morta por segurança.
process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/teste-sem-banco";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");
const { Pool, Client } = require("pg");

const repo = require("../services/promoSnapshot/promoSnapshotRepository");
const service = require("../services/promoSnapshot/promoSnapshotService");
const read = require("../services/promoSnapshot/promoSnapshotReadService");
const runtime = require("../services/promoSnapshot/promoSnapshotRuntime");
const { processPromoSnapshotRun } = require("../services/promoSnapshot/promoSnapshotProcessor");
const { resolvePromoSnapshotConfig } = require("../services/promoSnapshot/promoSnapshotConfig");
const { orquestrarTick } = require("../services/promoSnapshot/promoSnapshotOrchestrator");
const { createRateLimiter } = require("../services/motorMargem/marginSnapshotRateLimiter");
const { listarOportunidades } = require("../services/motorMargem/precificacao/precificacaoOportunidadesService");
const { createPromoSnapshotController } = require("../controllers/promoSnapshotController");
const schemaEnsure = require("../services/schema/schemaEnsure");
const F = require("./helpers/promoSnapshotFakes");

const PORTAL_DIR = path.resolve(__dirname, "..", "..", "Portal");

// ─── Cenário: Alianza Jeans com DUAS contas ML; Loja Única com uma ──────────
const ALIANZA = { id: 50, slug: "alianza-jeans", nome: "Alianza Jeans" };
const UNICA = { id: 60, slug: "loja-unica", nome: "Loja Única" };
const C86 = { id: 86, clienteId: 50, nome: "Alianza Jeans 1", seller: "1587129755" }; // grant PRINCIPAL do cliente
const C87 = { id: 87, clienteId: 50, nome: "Alianza Jeans 2", seller: "2433262404" }; // conta secundária (piloto)
const C90 = { id: 90, clienteId: 60, nome: "Loja Única", seller: "3000000001" };
const N87 = 60;
const N86 = 25;
const N90 = 8;

function ids(prefixo, n) {
  return Array.from({ length: n }, (_, i) => `MLB${prefixo}${String(i + 1).padStart(5, "0")}`);
}
const ITENS = { 87: ids("87", N87), 86: ids("86", N86), 90: ids("90", N90) };

// Promoções por anúncio: candidata abaixo do preço (oportunidade), uma já
// iniciada (fora do ranking) e anúncios sem promoção.
function promocoesDe(itemId, i) {
  if (i % 5 === 4) return [];
  if (i % 5 === 3) return [F.promo({ id: `D-${itemId}`, status: "started", price: 93 })];
  return [F.promo({ id: `C-${itemId}`, type: i % 2 ? "SMART" : "DEAL", status: "candidate", suggested: 90 - (i % 3), meli: 4, seller: 6 })];
}
function vendedor(contaId) {
  const itens = {};
  const saleInfo = {};
  ITENS[contaId].forEach((id, i) => {
    itens[id] = promocoesDe(id, i);
    if (i % 5 === 3) saleInfo[id] = { promotionId: `D-${id}`, amount: 93 };
  });
  return { itens, saleInfo };
}

const BASE_DDL = `
  CREATE TABLE clientes (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, nome TEXT, ativo BOOLEAN NOT NULL DEFAULT true);
  CREATE TABLE cliente_contas (
    id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    marketplace TEXT NOT NULL, nome TEXT NOT NULL, slug TEXT, ativo BOOLEAN NOT NULL DEFAULT true,
    external_account_id TEXT, is_primary BOOLEAN NOT NULL DEFAULT false);
  CREATE TABLE ml_tokens (
    id SERIAL PRIMARY KEY, cliente_id INTEGER NOT NULL, ml_user_id TEXT NOT NULL UNIQUE,
    access_token TEXT NOT NULL, refresh_token TEXT NOT NULL, token_status TEXT, is_primary BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE margin_projection_snapshots (
    id SERIAL PRIMARY KEY, cliente_conta_id INTEGER, marketplace TEXT, item_id TEXT, titulo TEXT, image_url TEXT,
    price NUMERIC, cost NUMERIC, tax_rate NUMERIC, fixed_fee NUMERIC, commission_rate NUMERIC, freight NUMERIC,
    margin NUMERIC, commission NUMERIC, profit NUMERIC, catalog_missing_since TIMESTAMPTZ,
    quality_json JSONB, calculated_at TIMESTAMPTZ, list_price NUMERIC);
  CREATE TABLE meli_anuncios (
    cliente_id INTEGER NOT NULL, item_id TEXT NOT NULL, listing_type_id TEXT, category_id TEXT, logistic_type TEXT,
    UNIQUE (cliente_id, item_id));
`;

async function semear(db) {
  await db.query(`INSERT INTO clientes (id, slug, nome) VALUES ($1,$2,$3), ($4,$5,$6)`,
    [ALIANZA.id, ALIANZA.slug, ALIANZA.nome, UNICA.id, UNICA.slug, UNICA.nome]);
  for (const c of [C86, C87, C90]) {
    await db.query(
      `INSERT INTO cliente_contas (id, cliente_id, marketplace, nome, slug, external_account_id, is_primary) VALUES ($1,$2,'meli',$3,$4,$5,$6)`,
      [c.id, c.clienteId, c.nome, `ml-${c.id}`, c.seller, c.id === 86]
    );
    // Tokens FALSOS (o ML do teste não os lê) — só a forma do grant importa.
    await db.query(
      `INSERT INTO ml_tokens (cliente_id, ml_user_id, access_token, refresh_token, token_status, is_primary, expires_at)
       VALUES ($1,$2,'tok-teste','ref-teste','valid',$3, NOW() + INTERVAL '6 hours')`,
      [c.clienteId, c.seller, c.id === 86 || c.id === 90]
    );
    for (const itemId of ITENS[c.id]) {
      await db.query(
        `INSERT INTO margin_projection_snapshots (cliente_conta_id, marketplace, item_id, titulo, price, cost, tax_rate, fixed_fee,
           commission_rate, commission, freight, margin, profit, quality_json, calculated_at)
         VALUES ($1,'meli',$2,$3,100,40,0.1,0,0.12,12,10,0.28,28,'{"targetMargin":0.1}'::jsonb, NOW())`,
        [c.id, itemId, `Produto ${itemId}`]
      );
      await db.query(
        `INSERT INTO meli_anuncios (cliente_id, item_id, listing_type_id, category_id, logistic_type) VALUES ($1,$2,'gold_special','MLB1234','fulfillment')`,
        [c.clienteId, itemId]
      );
    }
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function aguardar(fn, msg, { tentativas = 400, intervalo = 50 } = {}) {
  for (let i = 0; i < tentativas; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const v = await fn();
    if (v) return v;
    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalo);
  }
  throw new Error(`Timeout: ${msg}`);
}

let checks = 0;
async function check(nome, fn) {
  await fn();
  checks += 1;
  console.log(`  ✓ ${nome}`);
}

// ─── Banco ───────────────────────────────────────────────────────────────────
async function criarBanco() {
  const nome = `vf_promo_e2e_${process.pid}`;
  const admin = new Client({ connectionString: BASE_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${nome}`);
  await admin.query(`CREATE DATABASE ${nome}`);
  await admin.end();
  const u = new URL(BASE_URL);
  u.pathname = `/${nome}`;
  return { nome, url: u.toString() };
}
async function apagarBanco(nome) {
  const admin = new Client({ connectionString: BASE_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`);
  await admin.end();
}

// Pool instrumentado: conta consultas (N+1) e o pico de conexões abertas.
function instrumentar(pool) {
  const m = { consultas: 0, picoConexoes: 0, porTipo: null };
  const tipo = (sql) => {
    if (!m.porTipo) return;
    const t = String(sql).replace(/\s+/g, " ").trim().slice(0, 70);
    m.porTipo.set(t, (m.porTipo.get(t) || 0) + 1);
  };
  const db = {
    query(sql, params) {
      m.consultas += 1;
      tipo(sql);
      m.picoConexoes = Math.max(m.picoConexoes, pool.totalCount);
      return pool.query(sql, params);
    },
    async connect() {
      const c = await pool.connect();
      m.picoConexoes = Math.max(m.picoConexoes, pool.totalCount);
      // Embrulho (nunca alterar o client do pool: ele é reutilizado por
      // pool.query e contaminaria os outros contadores).
      return {
        query: (...a) => { m.consultas += 1; tipo(a[0]); return c.query(...a); },
        release: (...a) => c.release(...a),
      };
    },
  };
  return { db, m };
}

// ─── Backend HTTP mínimo com o controller REAL ───────────────────────────────
function criarBackend({ deps, depsOp, atrasos }) {
  const ctrl = createPromoSnapshotController({
    read: {
      obterStatus: (p) => read.obterStatus(p, deps),
      obterSnapshot: (p) => read.obterSnapshot(p, deps),
      solicitarSync: (p) => read.solicitarSync(p, deps),
    },
    oportunidades: { listarOportunidades: (p) => listarOportunidades(p, depsOp) },
  });
  const log = [];
  const app = express();
  app.use((req, res, next) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization,content-type");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") return res.status(204).end();
    log.push({ method: req.method, path: req.path, query: { ...req.query } });
    req.user = { id: 12 };
    return next();
  });
  app.use(express.json());
  // Falha transitória injetada: as próximas N leituras de status dão 503.
  app.use((req, res, next) => {
    if (/\/promocoes\/status$/.test(req.path) && atrasos.falharStatus > 0) {
      atrasos.falharStatus -= 1;
      return res.status(503).json({ ok: false, erro: "indisponível (teste)" });
    }
    return next();
  });
  // Atraso por conta no status (resposta atrasada da conta anterior).
  app.use((req, res, next) => {
    const conta = String(req.query.clienteContaId || (req.body && req.body.clienteContaId) || "");
    const ms = atrasos[`${req.path}|${conta}`];
    if (ms) return setTimeout(next, ms);
    return next();
  });
  app.get("/operacao/central-margem/:clienteSlug/promocoes/status", ctrl.status);
  app.get("/operacao/central-margem/:clienteSlug/promocoes/snapshot", ctrl.snapshot);
  app.post("/operacao/central-margem/:clienteSlug/promocoes/sync", ctrl.sync);
  app.get("/operacao/central-margem/:clienteSlug/promocoes/oportunidades", ctrl.listarOportunidades);
  // A aba Promoções lê a lista pela rota da precificação (mesmo service).
  app.get("/operacao/central-margem/:clienteSlug/precificacao/oportunidades", ctrl.listarOportunidades);
  app.use((req, res) => res.status(404).json({ ok: false, erro: "rota fora do teste" }));
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, log }));
  });
}

async function api(port, metodo, caminho, corpo) {
  const r = await fetch(`http://127.0.0.1:${port}${caminho}`, {
    method: metodo,
    headers: corpo ? { "content-type": "application/json" } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, body: await r.json() };
}

// ─── Chrome / CDP (mesmo harness dos testes de UI da Central) ────────────────
function startStaticServer(registro) {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    registro.push(pathname);
    const relative = pathname === "/" ? "central-margem.html" : pathname.replace(/^\/+/, "");
    const target = path.resolve(PORTAL_DIR, relative);
    if (!target.startsWith(path.resolve(PORTAL_DIR) + path.sep)) { response.writeHead(403).end("forbidden"); return; }
    fs.readFile(target, (error, contents) => {
      if (error) { response.writeHead(404).end("not found"); return; }
      const ext = path.extname(target);
      const tipos = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
      response.writeHead(200, { "Content-Type": tipos[ext] || "application/octet-stream", "Cache-Control": "no-store" });
      response.end(contents);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

class Cdp {
  constructor(url) { this.socket = new WebSocket(url); this.nextId = 1; this.pending = new Map(); this.onEvent = null; }
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Falha na avaliação do navegador");
    return result.result.value;
  }
  close() { this.socket.close(); }
}

function chromeDisponivel() {
  try { childProcess.execFileSync("google-chrome", ["--version"], { stdio: "ignore" }); return true; } catch (_) { return false; }
}

// Margin Snapshot da tabela principal (fora do escopo): resumo "ready" por
// conta e poucas linhas. As PROMOÇÕES usam o client REAL (getters abaixo).
function injecaoNavegador(backendPort) {
  return `
    localStorage.setItem("vf-token", "ui-test-token");
    localStorage.setItem("vf-user", JSON.stringify({ nome: "Teste UI", role: "admin" }));
    window.VF_API_BASE = "http://127.0.0.1:${backendPort}";
    window.__VF_CENTRAL_MARGEM_PROMO_SYNC_POLL_MS__ = 250;
    (function () {
      var cache = null;
      function mocks() {
        var A = window.VFCentralMargemApi;
        return {
          getWorkspace: function () { return Promise.resolve({ ok: false, status: 500, error: "workspace ao vivo não é usado" }); },
          getSnapshotResumo: function (p) {
            if (!p.clienteContaId) return Promise.resolve({ ok: false, status: 400, code: "CLIENTE_CONTA_ID_OBRIGATORIO", error: "conta" });
            return Promise.resolve(A.normalizeSnapshotResumo({
              habilitado: true, estado: "ready", acao: null, mensagem: null,
              conta: { id: Number(p.clienteContaId), nome: "Conta " + p.clienteContaId },
              snapshot: { totalItens: 1, ultimoCalculoEm: "2026-11-04T10:00:00Z", foraDoCatalogo: 0 },
              kpis: { total: 1, porStatus: { HEALTHY: 1, LOW_MARGIN: 0, LOSS: 0, UNVALIDATED: 0, SUSPECT_DATA: 0, RECONCILING: 0 },
                porRefreshStatus: { fresh: 1, stale: 0, failed: 0 }, anuncios: { total: 1, ativos: 1, pausados: 0 }, comMargem: 1 },
              refresh: { runAtivo: null, ultimoRun: null },
            }));
          },
          getSnapshotItens: function (p) {
            return Promise.resolve(A.normalizeSnapshotItens({
              estado: "ready", paginacao: { page: 1, limit: p.limit || 50, total: 0, totalPaginas: 1 },
              periodo: { dateFrom: "2026-10-05", dateTo: "2026-11-03" }, ultimoCalculoEm: "2026-11-04T10:00:00Z",
              itens: [], refresh: { runAtivo: null, ultimoRun: null },
            }, { client: { slug: p.clientSlug, name: p.clientName }, marketplace: "meli" }));
          },
          getSnapshotRealizado: function () {
            return Promise.resolve(A.normalizeSnapshotRealizado({ ok: true, habilitado: true, realizado: null,
              realizado_motivo: "CENTRAL_VENDAS_FALHOU", realizado_mensagem: "fora do teste",
              periodo: { dateFrom: "2026-10-05", dateTo: "2026-11-03", modo: "ultimos30", periodo: null, rotulo: "30 dias" },
              cobertura: null, freshness: { estado: "INDISPONIVEL", sincronizadoAte: null, syncEmAndamento: false, syncAtivo: null }, kpis: null }));
          },
        };
      }
      Object.defineProperty(window, "__VF_CENTRAL_MARGEM_API_CLIENT__", {
        configurable: true,
        get: function () {
          if (!cache && window.VFCentralMargemApi) cache = Object.assign({}, window.VFCentralMargemApi.createClient(), mocks());
          return cache || undefined;
        },
      });
    })();
  `;
}

// ─── Teste ───────────────────────────────────────────────────────────────────
async function main() {
  const banco = await criarBanco();
  // Pool pequeno de propósito (≈ o que a instância do Render aguenta).
  const pool = new Pool({ connectionString: banco.url, max: 4 });
  // Dois contadores: o worker (polling/heartbeat em background) e o caminho
  // HTTP da Central — o N+1 se mede no segundo.
  const { db, m } = instrumentar(pool);
  const { db: dbHttp, m: mHttp } = instrumentar(pool);
  let worker = null;
  let backend = null;
  let estatico = null;
  let chrome = null;
  let cdp = null;
  const logger = { log() {}, warn() {}, error() {} };
  try {
    await pool.query(BASE_DDL);
    await semear(pool);
    await schemaEnsure.ensurePromoSnapshotSchema(db);

    // ML falso: latência por chamada (para o progresso ser observável), 429 e
    // falha geral por roteiro.
    const roteiro = { latenciaMs: 25, falhar: null };
    const ml = F.criarMlFake({
      sellers: { [C87.seller]: vendedor(87), [C86.seller]: vendedor(86), [C90.seller]: vendedor(90) },
      roteiro: async (caminho, opcoes) => {
        if (roteiro.latenciaMs) await sleep(roteiro.latenciaMs);
        if (roteiro.falhar && roteiro.falhar(caminho, opcoes)) return F.erro429(0);
        return null;
      },
    });

    // Ambiente do piloto: SÓ a conta 87 (PROMO_SNAPSHOT_CONTAS), nenhum
    // cliente inteiro. Objeto mutável: o config é relido a cada chamada.
    const env = {
      PROMO_SNAPSHOT_WORKER_ENABLED: "true",
      PROMO_SNAPSHOT_CLIENTES: "",
      PROMO_SNAPSHOT_CONTAS: "87",
      PROMO_SNAPSHOT_REQUEST_INTERVAL_MS: "0",
      PROMO_SNAPSHOT_BATCH_SIZE: "10",
      PROMO_SNAPSHOT_ITEM_CONCURRENCY: "2",
      PROMO_SNAPSHOT_MAX_ATTEMPTS: "2",
      PROMO_SNAPSHOT_BACKOFF_BASE_MS: "0",
      PROMO_SNAPSHOT_BACKOFF_MAX_MS: "0",
      PROMO_SNAPSHOT_MAX_CONSECUTIVE_BATCH_FAILURES: "2",
      PROMO_SNAPSHOT_WORKER_POLL_MS: "1000",
      PROMO_SAME_CLIENT_COOLDOWN_MINUTES: "15",
      PROMO_SNAPSHOT_RUNS_RETIDOS: "5",
    };

    function iniciarWorker() {
      const config = resolvePromoSnapshotConfig(env);
      const w = runtime.criarWorker({
        db, logger, config,
        runService: service.criarRunService({ db, repo, env, logger }),
        processor: (run, ctx) => processPromoSnapshotRun(run, {
          ...ctx, db, repo, config: resolvePromoSnapshotConfig(env), logger,
          mlFetch: ml.mlFetch, sleep: async () => {}, rateLimiter: createRateLimiter({ minIntervalMs: 0 }),
          // validarConta REAL: conta do cliente, MELI, ativa, seller igual ao
          // do run e grant DESTA conta utilizável (resolveMlGrant em ml_tokens).
        }),
      });
      w.start(config.workerPollMs);
      return w;
    }
    worker = iniciarWorker();
    const kick = () => worker && worker.kick();

    const deps = { db: dbHttp, repo, env, logger, kick };
    const depsOp = {
      ...deps,
      carregarRealizada: async () => ({ porMlb: new Map(), periodo: null }),
      // Cotação "viva" da página no preço promocional (comissão 12% e frete
      // fixo) — o ML real fica fora do teste.
      buscarComissaoEFrete: async ({ precoEfetivo }) => ({ comissaoValor: Math.round(precoEfetivo * 12) / 100, fretePrevisto: 10 }),
      mlFetch: ml.mlFetch,
    };
    const atrasos = {};
    backend = await criarBackend({ deps, depsOp, atrasos });
    const P = backend.port;
    const status = async (conta, slug = ALIANZA.slug) => (await api(P, "GET", `/operacao/central-margem/${slug}/promocoes/status?clienteContaId=${conta}`)).body;
    const sync = async (conta, slug = ALIANZA.slug) => api(P, "POST", `/operacao/central-margem/${slug}/promocoes/sync`, { clienteContaId: conta });
    const lista = async (conta, extra = "", slug = ALIANZA.slug) =>
      (await api(P, "GET", `/operacao/central-margem/${slug}/precificacao/oportunidades?clienteContaId=${conta}&veredito=todos&limit=100${extra}`)).body;
    const q = async (sql, params) => (await pool.query(sql, params)).rows;
    const contaRuns = async (conta) => q(`SELECT id, status, seller_id, error_code, promovido, resumed_from_run_id FROM promo_snapshot_runs WHERE cliente_conta_id = $1 ORDER BY id`, [conta]);
    const esperarRunTerminar = (conta) => aguardar(async () => {
      const s = await status(conta);
      return s.sync && !s.sync.activeRun ? s : null;
    }, `run da conta ${conta} não terminou`);
    // Simula a passagem do tempo para o cooldown (só no banco de teste).
    const passarCooldown = (conta) => pool.query(
      `UPDATE promo_snapshot_contas SET last_attempt_at = NOW() - INTERVAL '2 hours' WHERE cliente_conta_id = $1`, [conta]);

    // ───────────────────────── Parte 1: API + banco ─────────────────────────
    console.log("Parte 1 — API e PostgreSQL");

    await check("1. conta 87 sem snapshot: status sem leitura, Atualizar disponível; abrir a aba NÃO cria run", async () => {
      const s = await status(87);
      assert.strictEqual(s.ok, true);
      assert.strictEqual(s.clienteContaId, 87);
      assert.strictEqual(s.sellerId, C87.seller);
      assert.strictEqual(s.contaNome, "Alianza Jeans 2");
      assert.strictEqual(s.sync.state, "never_synced");
      assert.strictEqual(s.atualizacao.disponivel, true);
      assert.strictEqual(s.worker.noPiloto, true);
      const l = await lista(87);
      assert.strictEqual(l.disponivel, false);
      assert.strictEqual(l.motivo, "SEM_SNAPSHOT_PROMOCOES");
      assert.deepStrictEqual(await contaRuns(87), [], "ler status e lista nunca enfileira varredura");
      assert.strictEqual(ml.chamadas.length, 0);
    });

    await check("2. conta 86 (mesmo cliente) fora do piloto de UMA conta: FORA_DO_PILOTO, POST não enfileira", async () => {
      const s = await status(86);
      assert.strictEqual(s.sellerId, C86.seller);
      assert.strictEqual(s.atualizacao.disponivel, false);
      assert.strictEqual(s.atualizacao.motivo, "FORA_DO_PILOTO");
      const r = await sync(86);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.enfileirado, false);
      assert.strictEqual(r.body.motivo, "FORA_DO_PILOTO");
      assert.deepStrictEqual(await contaRuns(86), []);
    });

    await check("3. conta de OUTRO cliente pelo slug da Alianza → 403 antes de qualquer leitura", async () => {
      const r = await api(P, "GET", `/operacao/central-margem/${ALIANZA.slug}/promocoes/status?clienteContaId=90`);
      assert.strictEqual(r.status, 403);
      const r2 = await api(P, "POST", `/operacao/central-margem/${ALIANZA.slug}/promocoes/sync`, { clienteContaId: 90 });
      assert.strictEqual(r2.status, 403);
      assert.deepStrictEqual(await contaRuns(90), []);
    });

    let primeiroRun = null;
    const consultasPorRequest = {};
    await check("4. POST /sync da 87 enfileira UM run real; 2 POSTs simultâneos não duplicam; o worker processa e promove", async () => {
      const t0 = Date.now();
      const q0 = m.consultas;
      if (process.env.VF_PROMO_E2E_PERFIL === "1") { m.porTipo = new Map(); mHttp.porTipo = new Map(); }
      const [a, b] = await Promise.all([sync(87), sync(87)]);
      assert.strictEqual(a.status, 202);
      assert.strictEqual(b.status, 202);
      assert.strictEqual(a.body.runId, b.body.runId, "o segundo pedido reaproveita o mesmo run");
      assert.strictEqual([a.body.enfileirado, b.body.enfileirado].filter(Boolean).length, 1);
      const ativos = await q(`SELECT count(*)::int AS n FROM promo_snapshot_runs WHERE cliente_conta_id = 87 AND status IN ('queued','running')`);
      assert.strictEqual(ativos[0].n, 1);
      // Progresso REAL durante o run (o que o worker gravou no banco).
      const visto = await aguardar(async () => {
        const s = await status(87);
        const run = s.sync.activeRun;
        return run && run.status === "running" && run.itensTotal === N87 && run.itensProcessados > 0 && run.itensProcessados < N87 ? run : null;
      }, "progresso parcial não apareceu no status", { intervalo: 20 });
      assert.ok(visto.itensProcessados < visto.itensTotal);
      const s = await esperarRunTerminar(87);
      primeiroRun = s.sync.snapshotRunId;
      assert.strictEqual(s.sync.state, "fresh");
      assert.strictEqual(s.ultimaTentativa.status, "completed");
      assert.strictEqual(s.ultimaTentativa.itensTotal, N87);
      assert.strictEqual(s.atualizacao.motivo, "COOLDOWN", "logo depois do run, o Atualizar fica em cooldown");
      const dt = Date.now() - t0;
      // Inclui o polling do worker durante o run (PROMO_SNAPSHOT_WORKER_POLL_MS=1000 no teste).
      console.log(`      run 87: ${N87} anúncios em ${dt} ms (ML falso com ${roteiro.latenciaMs} ms/chamada) · ${m.consultas - q0} consultas do worker no run`);
      if (m.porTipo) {
        for (const [rotulo, mm] of [["worker", m], ["http", mHttp]]) {
          console.log(`        [${rotulo}]\n` + [...mm.porTipo.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => `        ${v}× ${k}`).join("\n"));
          mm.porTipo = null;
        }
      }
      // Ocioso: consultas do worker por segundo sem nada na fila.
      const qi = m.consultas;
      await sleep(3000);
      console.log(`      worker ocioso: ${((m.consultas - qi) / 3).toFixed(1)} consultas/s com polling de 1 s (produção: 15 s)`);
    });

    await check("5. banco: só linhas da conta 87 / seller 2433262404, sem duplicata; chamadas ao ML só GET e com o seller da 87", async () => {
      const linhas = await q(`SELECT cliente_conta_id, seller_id, count(*)::int AS n FROM promo_snapshot_itens GROUP BY 1,2`);
      assert.deepStrictEqual(linhas.map((r) => [Number(r.cliente_conta_id), r.seller_id]), [[87, C87.seller]]);
      const esperadas = ITENS[87].reduce((acc, _, i) => acc + promocoesDe("x", i).length, 0);
      assert.strictEqual(linhas[0].n, esperadas);
      const dup = await q(`SELECT run_id, item_id, promocao_chave, count(*) FROM promo_snapshot_itens GROUP BY 1,2,3 HAVING count(*) > 1`);
      assert.deepStrictEqual(dup, []);
      const conta = await q(`SELECT current_run_id, seller_id, itens_total FROM promo_snapshot_contas WHERE cliente_conta_id = 87`);
      assert.strictEqual(conta.length, 1);
      assert.strictEqual(Number(conta[0].current_run_id), primeiroRun);
      assert.strictEqual(ml.escritas().length, 0, "nenhuma escrita no ML");
      assert.ok(ml.chamadas.every((c) => c.method === "GET"));
      assert.ok(ml.chamadas.every((c) => c.mlUserId === C87.seller), "toda leitura com o token da conta 87 — nunca o grant principal (86)");
      const lotes = await q(`SELECT seq, count(*)::int AS n FROM promo_snapshot_run_lotes WHERE run_id = $1 GROUP BY seq HAVING count(*) > 1`, [primeiroRun]);
      assert.deepStrictEqual(lotes, [], "lote idempotente por (run_id, seq)");
    });

    await check("6. lista da 87 vem do Promo Snapshot (nunca do legado), só MLB87, com a mesma conta; consultas por request constantes", async () => {
      const antes = mHttp.consultas;
      const l = await lista(87);
      const consultasLista = mHttp.consultas - antes;
      assert.strictEqual(l.disponivel, true);
      assert.strictEqual(l.fonte.tipo, "promo_snapshot");
      assert.strictEqual(l.fontePromocoes.origemDados, "promo_snapshot");
      assert.ok(l.oportunidades.length > 0);
      assert.ok(l.oportunidades.every((o) => o.itemId.startsWith("MLB87")));
      // Promoção já iniciada não é oportunidade.
      assert.ok(!l.oportunidades.some((o) => ITENS[87].indexOf(o.itemId) % 5 === 3));
      const antesS = mHttp.consultas;
      await status(87);
      const consultasStatus = mHttp.consultas - antesS;
      consultasPorRequest.status87 = consultasStatus;
      consultasPorRequest.lista87 = consultasLista;
      console.log(`      consultas ao banco: lista=${consultasLista} · status=${consultasStatus} (independem do nº de anúncios)`);
      assert.ok(consultasStatus <= 12, `status fez ${consultasStatus} consultas`);
      assert.ok(consultasLista <= 20, `lista fez ${consultasLista} consultas`);
    });

    await check("7. Atualizar repetido: cooldown recusa sem criar run; depois do cooldown, novo run; nada duplica", async () => {
      const r = await sync(87);
      assert.strictEqual(r.body.enfileirado, false);
      assert.strictEqual(r.body.motivo, "COOLDOWN");
      assert.strictEqual((await contaRuns(87)).length, 1);
      await passarCooldown(87);
      const r2 = await sync(87);
      assert.strictEqual(r2.body.enfileirado, true);
      const s = await esperarRunTerminar(87);
      assert.notStrictEqual(s.sync.snapshotRunId, primeiroRun);
      const porRun = await q(`SELECT run_id, count(*)::int AS n FROM promo_snapshot_itens WHERE cliente_conta_id = 87 GROUP BY 1 ORDER BY 1`);
      // Atual + anterior (para recuperação), cada um com o catálogo inteiro.
      assert.strictEqual(porRun.length, 2);
      assert.strictEqual(porRun[0].n, porRun[1].n);
    });

    await check("8. reiniciar o worker (parada limpa) não perde o último snapshot válido", async () => {
      const antes = await status(87);
      await worker.stop();
      worker = iniciarWorker();
      const depois = await status(87);
      assert.strictEqual(depois.sync.snapshotRunId, antes.sync.snapshotRunId);
      assert.strictEqual(depois.sync.state, "fresh");
      assert.ok((await lista(87)).oportunidades.length > 0);
    });

    await check("9. worker parado NO MEIO do run: snapshot anterior intacto; o próximo run retoma os lotes já lidos", async () => {
      await passarCooldown(87);
      roteiro.latenciaMs = 60;
      const atual = (await status(87)).sync.snapshotRunId;
      const r = await sync(87);
      await aguardar(async () => {
        const s = await status(87);
        return s.sync.activeRun && s.sync.activeRun.itensProcessados >= 20 ? s : null;
      }, "run não avançou", { intervalo: 20 });
      await worker.stop(); // parada cooperativa: run → failed WORKER_STOPPED (retomável)
      const parado = (await contaRuns(87)).find((x) => Number(x.id) === r.body.runId);
      assert.strictEqual(parado.status, "failed");
      assert.strictEqual(parado.error_code, "PROMO_SNAPSHOT_WORKER_STOPPED");
      const s = await status(87);
      assert.strictEqual(s.sync.snapshotRunId, atual, "o snapshot atual continua o último bom");
      assert.strictEqual(s.sync.state, "failed");
      assert.ok(s.ultimaTentativa.erroMotivo);
      roteiro.latenciaMs = 5;
      worker = iniciarWorker();
      const r2 = await sync(87);
      assert.strictEqual(r2.body.enfileirado, true, "falha não tem cooldown: pode tentar de novo na hora");
      const fim = await esperarRunTerminar(87);
      assert.strictEqual(fim.sync.state, "fresh");
      const novo = (await contaRuns(87)).find((x) => Number(x.id) === r2.body.runId);
      assert.strictEqual(Number(novo.resumed_from_run_id), r.body.runId, "retomou do run interrompido");
    });

    await check("10. falha da API (429 em tudo): run falha com motivo verificável; último snapshot preservado e marcado como falha", async () => {
      await passarCooldown(87);
      const atual = (await status(87)).sync.snapshotRunId;
      roteiro.falhar = (caminho) => caminho.startsWith("/seller-promotions/items/");
      const r = await sync(87);
      assert.strictEqual(r.body.enfileirado, true);
      const s = await esperarRunTerminar(87);
      roteiro.falhar = null;
      assert.strictEqual(s.sync.state, "failed");
      assert.strictEqual(s.sync.snapshotRunId, atual);
      assert.strictEqual(s.ultimaTentativa.status, "failed");
      assert.strictEqual(s.ultimaTentativa.erroCodigo, "PROMO_SNAPSHOT_LOTES_FALHANDO");
      assert.ok(s.ultimaTentativa.rateLimits > 0, "os 429 aparecem contados");
      assert.ok(!/tok-teste|ref-teste/.test(JSON.stringify(s)), "nenhum token na resposta");
      const l = await lista(87);
      assert.strictEqual(l.fontePromocoes.estado, "falhou");
      assert.ok(l.oportunidades.length > 0, "a lista continua com a última leitura válida");
      assert.strictEqual(l.fontePromocoes.ultimoBom.runId, atual);
    });

    await check("11. grant revogado da 87: run falha com ML_GRANT_REVOKED (nunca cai no grant principal da 86)", async () => {
      await pool.query(`UPDATE ml_tokens SET token_status = 'revoked' WHERE ml_user_id = $1`, [C87.seller]);
      const chamadasAntes = ml.chamadas.length;
      const r = await sync(87);
      assert.strictEqual(r.body.enfileirado, true);
      const s = await esperarRunTerminar(87);
      assert.strictEqual(s.sync.state, "failed");
      assert.strictEqual(s.ultimaTentativa.erroCodigo, "ML_GRANT_REVOKED");
      assert.strictEqual(s.ultimaTentativa.erroMotivo, "conexão com o Mercado Livre revogada");
      assert.strictEqual(ml.chamadas.length, chamadasAntes, "nenhuma chamada ao ML sem grant da conta");
      await pool.query(`UPDATE ml_tokens SET token_status = 'valid' WHERE ml_user_id = $1`, [C87.seller]);
    });

    await check("12. snapshot desatualizado (fresh_until vencido): status stale + Atualizar disponível; ler não revalida sozinho", async () => {
      // Recupera um snapshot bom antes (o último run falhou).
      const r = await sync(87);
      assert.strictEqual(r.body.enfileirado, true);
      await esperarRunTerminar(87);
      await pool.query(`UPDATE promo_snapshot_contas SET snapshot_at = NOW() - INTERVAL '13 hours', fresh_until = NOW() - INTERVAL '1 hour',
                          last_attempt_at = NOW() - INTERVAL '13 hours' WHERE cliente_conta_id = 87`);
      const runsAntes = (await contaRuns(87)).length;
      const s = await status(87);
      assert.strictEqual(s.sync.state, "stale");
      assert.ok(s.sync.ageMinutes >= 13 * 60);
      assert.strictEqual(s.atualizacao.disponivel, true);
      const l = await lista(87);
      assert.strictEqual(l.fontePromocoes.estado, "desatualizado");
      assert.ok(l.oportunidades.length > 0);
      assert.strictEqual((await contaRuns(87)).length, runsAntes, "abrir a lista desatualizada não dispara run");
    });

    await check("13. orquestrador (atualização automática existente) respeita a allowlist por conta: só enfileira a 87 vencida", async () => {
      const r = await orquestrarTick({ db, repo, env, logger });
      assert.deepStrictEqual(r.enfileirados.map((e) => e.clienteContaId), [87]);
      await esperarRunTerminar(87);
      const r2 = await orquestrarTick({ db, repo, env, logger });
      assert.deepStrictEqual(r2.enfileirados, [], "fresh de novo: nada a fazer");
    });

    await check("14. retenção: runs antigos podados (≤ PROMO_SNAPSHOT_RUNS_RETIDOS + protegidos); atual e anterior intactos; lotes só dos protegidos", async () => {
      // Várias falhas seguidas (sem cooldown em falha) geram histórico.
      roteiro.falhar = (caminho) => caminho.startsWith("/seller-promotions/items/");
      for (let i = 0; i < 6; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await sync(87);
        // eslint-disable-next-line no-await-in-loop
        await esperarRunTerminar(87);
      }
      roteiro.falhar = null;
      const runs = await contaRuns(87);
      const conta = (await q(`SELECT current_run_id, previous_run_id FROM promo_snapshot_contas WHERE cliente_conta_id = 87`))[0];
      const ids87 = runs.map((x) => Number(x.id));
      assert.ok(ids87.includes(Number(conta.current_run_id)), "snapshot atual preservado");
      assert.ok(ids87.includes(Number(conta.previous_run_id)), "snapshot anterior preservado");
      assert.ok(runs.length <= 5 + 2, `runs da conta 87 após a poda: ${runs.length}`);
      const itensRuns = await q(`SELECT DISTINCT run_id FROM promo_snapshot_itens WHERE cliente_conta_id = 87`);
      const permitidos = new Set([Number(conta.current_run_id), Number(conta.previous_run_id)]);
      assert.ok(itensRuns.every((x) => permitidos.has(Number(x.run_id))), "linhas só do atual e do anterior");
      // Lotes: só do atual/anterior e de run interrompido ainda RETOMÁVEL
      // (parada do worker/heartbeat dentro da janela de retomada).
      const lotesRuns = await q(`SELECT DISTINCT l.run_id, r.status, r.error_code FROM promo_snapshot_run_lotes l
                                   JOIN promo_snapshot_runs r ON r.id = l.run_id WHERE r.cliente_conta_id = 87`);
      const fora = lotesRuns.filter((x) => !permitidos.has(Number(x.run_id)) &&
        !(x.status === "failed" && ["PROMO_SNAPSHOT_WORKER_STOPPED", "PROMO_SNAPSHOT_RUN_STALE"].includes(x.error_code)));
      assert.deepStrictEqual(fora, [], "lotes só dos runs protegidos");
      // Falhas não retomáveis (429) já não guardam lotes nem linhas.
      const falhos = runs.filter((x) => x.status === "failed" && x.error_code === "PROMO_SNAPSHOT_LOTES_FALHANDO").map((x) => Number(x.id));
      assert.ok(falhos.length > 0);
      assert.deepStrictEqual((await q(`SELECT count(*)::int AS n FROM promo_snapshot_run_lotes WHERE run_id = ANY($1::bigint[])`, [falhos]))[0].n, 0);
      const tam = await q(`SELECT pg_size_pretty(pg_total_relation_size('promo_snapshot_itens')) AS itens,
                                  pg_size_pretty(pg_total_relation_size('promo_snapshot_runs')) AS runs,
                                  pg_size_pretty(pg_total_relation_size('promo_snapshot_run_lotes')) AS lotes`);
      console.log(`      após ${runs.length} runs retidos: itens=${tam[0].itens} runs=${tam[0].runs} lotes=${tam[0].lotes}`);
    });

    await check("15. índices: as consultas do status e da lista têm índice utilizável (EXPLAIN com seqscan desligado)", async () => {
      const c = await pool.connect();
      try {
        await c.query("SET enable_seqscan = off");
        const usaIndice = (pl) => /Index (Only )?Scan|Bitmap Index Scan/.test(pl) && !/Seq Scan/.test(pl);
        const plano = async (sql, p) => (await c.query(`EXPLAIN ${sql}`, p)).rows.map((r) => r["QUERY PLAN"]).join("\n");
        const p1 = await plano(`SELECT * FROM promo_snapshot_runs WHERE cliente_conta_id = $1 AND marketplace = 'meli' AND tipo = 'PROMO_SNAPSHOT' AND status IN ('queued','running') ORDER BY id DESC LIMIT 1`, [87]);
        assert.ok(usaIndice(p1), p1);
        const p2 = await plano(`SELECT * FROM promo_snapshot_itens WHERE run_id = $1 AND item_id = $2`, [1, "MLB1"]);
        assert.ok(usaIndice(p2), p2);
        const p3 = await plano(`SELECT * FROM promo_snapshot_contas WHERE cliente_conta_id = $1 AND marketplace = 'meli' AND seller_id = $2`, [87, C87.seller]);
        assert.ok(usaIndice(p3), p3);
        const p4 = await plano(`SELECT * FROM promo_snapshot_runs WHERE cliente_conta_id = $1 AND marketplace = 'meli' AND tipo = 'PROMO_SNAPSHOT' AND status IN ('completed','partial','failed') AND seller_id = $2 ORDER BY finished_at DESC NULLS LAST, id DESC LIMIT 1`, [87, C87.seller]);
        assert.ok(usaIndice(p4), p4);
      } finally {
        await c.query("RESET enable_seqscan");
        c.release();
      }
    });

    await check("16. cliente com UMA conta (Loja Única, piloto por cliente): sincroniza e lê só a conta 90", async () => {
      env.PROMO_SNAPSHOT_CLIENTES = UNICA.slug;
      const r = await sync(90, UNICA.slug);
      assert.strictEqual(r.body.enfileirado, true);
      await aguardar(async () => { const s = await status(90, UNICA.slug); return s.sync && !s.sync.activeRun; }, "run 90");
      const l = await lista(90, "", UNICA.slug);
      assert.ok(l.oportunidades.length > 0 && l.oportunidades.every((o) => o.itemId.startsWith("MLB90")));
      assert.ok(ml.chamadas.filter((c) => /MLB90/.test(c.path)).every((c) => c.mlUserId === C90.seller));
      // N+1: conta de 8 anúncios faz o MESMO número de consultas que a de 60.
      let a = mHttp.consultas;
      await status(90, UNICA.slug);
      const status90 = mHttp.consultas - a;
      a = mHttp.consultas;
      await lista(90, "", UNICA.slug);
      const lista90 = mHttp.consultas - a;
      console.log(`      consultas por request: status 87(60 anúncios)=${consultasPorRequest.status87} 90(8)=${status90} · lista 87=${consultasPorRequest.lista87} 90=${lista90}`);
      assert.strictEqual(status90, consultasPorRequest.status87);
      assert.strictEqual(lista90, consultasPorRequest.lista87);
      env.PROMO_SNAPSHOT_CLIENTES = "";
    });

    await check("17. run na fila com o worker DESLIGADO: status e POST dizem WORKER_DESABILITADO (nunca 'reaproveitado'); religado, o run anda", async () => {
      await worker.stop();
      worker = null;
      env.PROMO_SNAPSHOT_WORKER_ENABLED = "false";
      await passarCooldown(87);
      const { run } = await service.enqueuePromoSnapshotRun(
        { clienteId: ALIANZA.id, clienteSlug: ALIANZA.slug, clienteContaId: 87, marketplace: "meli", sellerId: C87.seller },
        { reason: "manual_sync" }, { db, repo, env, logger });
      const s = await status(87);
      assert.strictEqual(s.sync.activeRun.runId, run.id);
      assert.strictEqual(s.atualizacao.motivo, "WORKER_DESABILITADO");
      assert.strictEqual(s.atualizacao.runParado, run.id);
      const r = await sync(87);
      assert.strictEqual(r.body.enfileirado, false);
      assert.notStrictEqual(r.body.reaproveitado, true);
      assert.strictEqual(r.body.motivo, "WORKER_DESABILITADO");
      env.PROMO_SNAPSHOT_WORKER_ENABLED = "true";
      worker = iniciarWorker();
      worker.kick();
      const fim = await esperarRunTerminar(87);
      assert.strictEqual(fim.ultimaTentativa.runId, run.id);
      assert.strictEqual(fim.ultimaTentativa.status, "completed");
    });

    await check("18. poda com teto por DELETE: volume grande sai em várias podas (pendente), nunca toca atual/anterior", async () => {
      const conta = (await q(`SELECT current_run_id FROM promo_snapshot_contas WHERE cliente_conta_id = 87`))[0];
      const atual = Number(conta.current_run_id);
      const linhasAtual = (await q(`SELECT count(*)::int n FROM promo_snapshot_itens WHERE run_id = $1`, [atual]))[0].n;
      // Histórico artificial: 12 runs falhos NÃO retomáveis com 400 linhas e 30 lotes cada.
      const artificiais = [];
      for (let k = 0; k < 12; k += 1) {
        // eslint-disable-next-line no-await-in-loop
        const r = (await q(`INSERT INTO promo_snapshot_runs (cliente_id, cliente_slug, cliente_conta_id, marketplace, seller_id, reason, status, finished_at, error_code)
                             VALUES ($1,$2,87,'meli',$3,'teste','failed', NOW() - INTERVAL '3 hours','PROMO_SNAPSHOT_LOTES_FALHANDO') RETURNING id`,
          [ALIANZA.id, ALIANZA.slug, C87.seller]))[0];
        artificiais.push(Number(r.id));
        // eslint-disable-next-line no-await-in-loop
        await pool.query(`INSERT INTO promo_snapshot_itens (run_id, cliente_id, cliente_conta_id, seller_id, item_id, promocao_chave, observed_at)
                          SELECT $1, $2, 87, $3, 'MLBX' || g, 'k', NOW() FROM generate_series(1, 400) g`, [r.id, ALIANZA.id, C87.seller]);
        // eslint-disable-next-line no-await-in-loop
        await pool.query(`INSERT INTO promo_snapshot_run_lotes (run_id, seq, item_ids) SELECT $1, g, ARRAY['MLBX'||g] FROM generate_series(1, 30) g`, [r.id]);
      }
      const rodadas = [];
      for (let i = 0; i < 30; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const p = await repo.podarHistoricoDaConta({ clienteContaId: 87, manterRuns: 5, resumeMaxMinutes: 60, linhasPorDelete: 500, deletesMax: 4 }, db);
        rodadas.push(p);
        if (!p.pendente) break;
      }
      assert.ok(rodadas.length > 1, "o volume não cabe numa poda só com o teto");
      assert.ok(rodadas.every((p) => p.itens + p.lotes <= 500 * 4), JSON.stringify(rodadas));
      assert.strictEqual(rodadas[rodadas.length - 1].pendente, false);
      assert.strictEqual((await q(`SELECT count(*)::int n FROM promo_snapshot_itens WHERE item_id LIKE 'MLBX%'`))[0].n, 0);
      assert.strictEqual((await q(`SELECT count(*)::int n FROM promo_snapshot_itens WHERE run_id = $1`, [atual]))[0].n, linhasAtual, "snapshot atual intacto");
      // Sobram só: os 5 terminados mais novos + protegidos (atual, anterior,
      // retomáveis dentro da janela). Nenhum dos 12 runs artificiais.
      const restantes = await contaRuns(87);
      const ficaram = restantes.map((x) => Number(x.id)).filter((id) => artificiais.includes(id));
      assert.deepStrictEqual(ficaram, artificiais.slice(-5), "dos 12 runs, ficam só os 5 mais novos (sem linhas)");
      assert.ok(restantes.some((x) => Number(x.id) === atual), "snapshot atual preservado");
      console.log(`      runs restantes da 87: ${restantes.map((x) => x.id + ":" + x.status + (x.error_code ? ":" + x.error_code.replace("PROMO_SNAPSHOT_", "") : "")).join(" ")}`);
      console.log(`      poda em ${rodadas.length} rodadas (teto 4 DELETEs × 500 linhas): ${rodadas.map((p) => p.itens + p.lotes).join(", ")} linhas`);
    });

    console.log(`      pico de conexões do pool do teste: ${Math.max(m.picoConexoes, mHttp.picoConexoes)} (max=4) · consultas: worker=${m.consultas} http=${mHttp.consultas}`);
    assert.ok(Math.max(m.picoConexoes, mHttp.picoConexoes) <= 4);

    // ───────────────────────── Parte 2: interface ─────────────────────────
    if (!chromeDisponivel()) {
      console.log("Parte 2 — interface PULADA (google-chrome indisponível)");
    } else {
      console.log("Parte 2 — interface (Chrome headless + Shell V3 + Central de Margem)");
      // Conta 87 volta a "sem leitura" para o operador começar do zero; a 86
      // continua fora do piloto até ser liberada no meio do teste.
      await pool.query(`DELETE FROM promo_snapshot_runs WHERE cliente_conta_id IN (86, 87)`);
      await pool.query(`DELETE FROM promo_snapshot_contas WHERE cliente_conta_id IN (86, 87)`);
      roteiro.latenciaMs = 40;
      const paginasServidas = [];
      estatico = await startStaticServer(paginasServidas);
      const debugPort = 15000 + Math.floor(Math.random() * 1000);
      chrome = childProcess.spawn("google-chrome", [
        "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
        `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/vf-promo-e2e-${process.pid}`, "about:blank",
      ], { stdio: "ignore" });
      await aguardar(async () => {
        try { return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok; } catch (_) { return false; }
      }, "Chrome DevTools não iniciou");
      const alvo = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })).json();
      cdp = new Cdp(alvo.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");

      const PROD_HOST = "venforce-server.onrender.com";
      await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
      cdp.onEvent = async (method, params) => {
        if (method !== "Fetch.requestPaused") return;
        const url = params.request.url;
        const responder = async (mm, p) => { try { await cdp.send(mm, p); } catch (err) { if (!/Invalid InterceptionId/.test(err.message || "")) throw err; } };
        if (!url.includes(PROD_HOST)) { await responder("Fetch.continueRequest", { requestId: params.requestId }); return; }
        const cors = [
          { name: "access-control-allow-origin", value: "*" },
          { name: "access-control-allow-headers", value: "authorization,content-type" },
          { name: "access-control-allow-methods", value: "GET,POST,OPTIONS" },
        ];
        const json = (obj) => responder("Fetch.fulfillRequest", {
          requestId: params.requestId, responseCode: 200,
          responseHeaders: [...cors, { name: "content-type", value: "application/json" }],
          body: Buffer.from(JSON.stringify(obj)).toString("base64"),
        });
        if (params.request.method === "OPTIONS") { await responder("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 204, responseHeaders: cors }); return; }
        if (url.includes("/me/context")) {
          await json({ ok: true, user: { id: 12, nome: "Operador", email: null, role: "user" }, squads: [], squadPrincipalId: null,
            clientes: [{ id: ALIANZA.id, slug: ALIANZA.slug, nome: ALIANZA.nome, squadId: null, responsavelDireto: false, contasAtivas: null }],
            portfolio: { totalClientes: 1 }, permissoes: { podeAdministrar: false } });
          return;
        }
        if (url.includes("/operacao/cliente-360/clientes")) {
          await json({ ok: true, clientes: [{ id: ALIANZA.id, nome: ALIANZA.nome, slug: ALIANZA.slug, ativo: true, temGrant: true, grantStatus: "conectado", temBase: true, setupScore: 100, statusOperacional: "pronto", ultimaSincronizacao: null, pendencias: [] }] });
          return;
        }
        if (/\/clientes\/[^/?]+\/contas/.test(url)) {
          const conta = (c) => ({ id: c.id, cliente_id: ALIANZA.id, marketplace: "meli", nome: c.nome, slug: `ml-${c.id}`, external_account_id: c.seller,
            externalAccountLabel: c.nome, is_primary: c.id === 86, ativo: true, grant: { id: c.id, token_status: "valid" }, base: { vinculo_id: c.id, base_id: c.id, nome: "Base " + c.id }, ultimaSync: null });
          await json({ ok: true, cliente: { id: ALIANZA.id, nome: ALIANZA.nome, slug: ALIANZA.slug, ativo: true }, contas: [conta(C86), conta(C87)] });
          return;
        }
        await responder("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" });
      };
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: injecaoNavegador(P) });
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${estatico.address().port}/central-margem.html?cliente=${ALIANZA.slug}` });

      const ev = (expr) => cdp.evaluate(expr);
      const esperar = (expr, msg, opts) => aguardar(() => ev(`Boolean(${expr})`), msg, opts);
      const barra = () => ev(`(function(){var h=document.getElementById('cm-promo-sync');return h?{hidden:h.hidden,estado:h.getAttribute('data-cm-promo-sync'),texto:h.innerText,botao:(h.querySelector('[data-cm-promo-sync-acao]')||{}).textContent||null,habilitado:!!(h.querySelector('[data-cm-promo-sync-acao]')&&!h.querySelector('[data-cm-promo-sync-acao]').disabled),titulo:(h.querySelector('[data-cm-promo-sync-acao]')||{}).title||null}:null;})()`);
      const linhasDaLista = () => ev(`Array.from(document.querySelectorAll('#cm-opps-host tr[data-opp]')).map(function(tr){return tr.getAttribute('data-opp');})`);
      const escolherConta = async (id) => {
        for (let i = 0; i < 80; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await ev(`window.VF && window.VF.context && window.VF.context.setConta(${id})`);
          // eslint-disable-next-line no-await-in-loop
          if (await ev(`Boolean(window.VFCentralMargemUi && window.VFCentralMargemUi.getState().contaId === ${id})`)) return;
          // eslint-disable-next-line no-await-in-loop
          await sleep(100);
        }
        throw new Error(`Shell não aplicou a conta ${id}`);
      };

      await check("UI 1. Shell → Alianza Jeans 2 (87) → Central de Margem → aba Promoções: 'sem leitura' com botão Buscar; nenhum run criado", async () => {
        await esperar("window.VFCentralMargemUi", "Central não carregou");
        await escolherConta(87);
        await esperar("window.VFCentralMargemUi.getState().mode === 'snapshot'", "modo persistido não entrou");
        await ev(`document.querySelector('[data-view="promotions"]').click()`);
        await esperar(`document.getElementById('cm-promo-sync') && document.getElementById('cm-promo-sync').getAttribute('data-cm-promo-sync') === 'sem_leitura'`, "barra sem_leitura não apareceu");
        const b = await barra();
        assert.strictEqual(b.hidden, false);
        assert.strictEqual(b.botao, "Buscar promoções");
        assert.strictEqual(b.habilitado, true);
        assert.ok(/Alianza Jeans 2 · conta 87 · seller 2433262404/.test(b.texto), b.texto);
        assert.deepStrictEqual(await contaRuns(87), [], "abrir a aba não dispara varredura");
      });

      await check("UI 2. Atualizar na Central: run real, progresso X de 60 visível, termina e a lista aparece (só MLB87)", async () => {
        await ev(`document.querySelector('[data-cm-promo-sync-acao]').click()`);
        await esperar(`document.getElementById('cm-promo-sync').getAttribute('data-cm-promo-sync') === 'sincronizando'`, "estado sincronizando não apareceu");
        const durante = await aguardar(async () => {
          const b = await barra();
          return b && b.estado === "sincronizando" && /\d+ de 60 anúncios lidos/.test(b.texto) ? b : null;
        }, "progresso 'X de 60' não apareceu", { intervalo: 30 });
        assert.strictEqual(durante.habilitado, false, "botão travado durante o run (sem job duplicado)");
        assert.strictEqual((await q(`SELECT count(*)::int AS n FROM promo_snapshot_runs WHERE cliente_conta_id = 87 AND status IN ('queued','running')`))[0].n, 1);
        await esperar(`document.getElementById('cm-promo-sync').getAttribute('data-cm-promo-sync') === 'atualizado'`, "não chegou a 'atualizado'", { tentativas: 600 });
        await esperar(`document.querySelectorAll('#cm-opps-host tr[data-opp]').length > 0`, "lista não recarregou depois do run");
        const linhas = await linhasDaLista();
        assert.ok(linhas.length > 0 && linhas.every((x) => x.startsWith("MLB87")), JSON.stringify(linhas.slice(0, 5)));
        const b = await barra();
        assert.ok(/Atualização concluída/.test(b.texto), b.texto);
        assert.ok(/60 anúncios lidos/.test(b.texto), b.texto);
        assert.strictEqual(b.habilitado, false, "cooldown logo depois do run");
        assert.ok(/aguarde/i.test(b.titulo || ""), b.titulo);
      });

      await check("UI 3. trocar para a conta 86 no Shell: só dados da 86 (fora do piloto → aviso; nada da 87 na tela)", async () => {
        await escolherConta(86);
        await esperar(`document.getElementById('cm-promo-sync').getAttribute('data-cm-promo-sync') === 'sem_leitura'`, "barra da 86 não apareceu");
        const b = await barra();
        assert.ok(/Alianza Jeans 1 · conta 86/.test(b.texto), b.texto);
        assert.ok(/não está liberada para esta conta/.test(b.texto), b.texto);
        assert.strictEqual(b.habilitado, false);
        assert.deepStrictEqual(await linhasDaLista(), [], "nenhuma linha da 87 na conta 86");
      });

      await check("UI 4. 86 liberada no piloto: Buscar na Central, termina, lista só MLB86; voltar à 87 mostra só MLB87", async () => {
        env.PROMO_SNAPSHOT_CONTAS = "87,86";
        await ev(`document.querySelector('[data-view="operational"]').click()`);
        await ev(`document.querySelector('[data-view="promotions"]').click()`);
        await esperar(`(document.querySelector('[data-cm-promo-sync-acao]')||{}).disabled === false`, "botão da 86 não habilitou");
        await ev(`document.querySelector('[data-cm-promo-sync-acao]').click()`);
        await esperar(`document.getElementById('cm-promo-sync').getAttribute('data-cm-promo-sync') === 'atualizado'`, "86 não terminou", { tentativas: 600 });
        await esperar(`document.querySelectorAll('#cm-opps-host tr[data-opp]').length > 0`, "lista 86 não apareceu");
        const l86 = await linhasDaLista();
        assert.ok(l86.every((x) => x.startsWith("MLB86")), JSON.stringify(l86.slice(0, 5)));
        assert.ok(ml.chamadas.filter((c) => /MLB86/.test(c.path)).every((c) => c.mlUserId === C86.seller));
        await escolherConta(87);
        await esperar(`document.getElementById('cm-promo-sync').getAttribute('data-cm-promo-sync') === 'atualizado'`, "87 não voltou");
        await esperar(`document.querySelectorAll('#cm-opps-host tr[data-opp]').length > 0`, "lista 87 não voltou");
        const l87 = await linhasDaLista();
        assert.ok(l87.every((x) => x.startsWith("MLB87")), JSON.stringify(l87.slice(0, 5)));
      });

      await check("UI 5. resposta ATRASADA da conta anterior não sobrescreve a conta atual", async () => {
        atrasos["/operacao/central-margem/alianza-jeans/promocoes/status|87"] = 1500;
        await escolherConta(86);
        await escolherConta(87);
        await escolherConta(86); // troca enquanto o status da 87 ainda está em voo
        await sleep(2200);
        const b = await barra();
        assert.ok(/conta 86/.test(b.texto), `a barra deveria ser da 86: ${b.texto}`);
        const l = await linhasDaLista();
        assert.ok(l.every((x) => x.startsWith("MLB86")), JSON.stringify(l.slice(0, 5)));
        delete atrasos["/operacao/central-margem/alianza-jeans/promocoes/status|87"];
      });

      await check("UI 6. falha da API na Central: motivo verificável na barra e a lista anterior marcada como antiga", async () => {
        await escolherConta(87);
        await esperar(`document.getElementById('cm-promo-sync').getAttribute('data-cm-promo-sync') === 'atualizado'`, "87 não carregou");
        await passarCooldown(87);
        roteiro.falhar = (caminho) => caminho.startsWith("/seller-promotions/items/");
        await ev(`document.querySelector('[data-view="operational"]').click()`);
        await ev(`document.querySelector('[data-view="promotions"]').click()`);
        await esperar(`(document.querySelector('[data-cm-promo-sync-acao]')||{}).disabled === false`, "Atualizar não habilitou após o cooldown");
        await ev(`document.querySelector('[data-cm-promo-sync-acao]').click()`);
        await esperar(`document.getElementById('cm-promo-sync').getAttribute('data-cm-promo-sync') === 'falhou'`, "falha não apareceu", { tentativas: 600 });
        roteiro.falhar = null;
        const b = await barra();
        assert.ok(/A última atualização falhou: o Mercado Livre falhou em vários lotes seguidos/.test(b.texto), b.texto);
        assert.ok(/429/.test(b.texto), b.texto);
        assert.ok(/dados ANTIGOS/.test(b.texto), b.texto);
        assert.strictEqual(b.botao, "Tentar de novo");
        const l = await linhasDaLista();
        assert.ok(l.length > 0 && l.every((x) => x.startsWith("MLB87")), "a última leitura válida continua visível");
      });

      await check("UI 7. recarregar a página no meio de um run retoma o acompanhamento", async () => {
        roteiro.latenciaMs = 80;
        await sync(87); // falha não tem cooldown
        await cdp.send("Page.reload");
        await esperar("window.VFCentralMargemUi", "Central não recarregou");
        await escolherConta(87);
        await esperar("window.VFCentralMargemUi.getState().mode === 'snapshot'", "modo persistido");
        await ev(`document.querySelector('[data-view="promotions"]').click()`);
        await esperar(`document.getElementById('cm-promo-sync').getAttribute('data-cm-promo-sync') === 'sincronizando'`, "acompanhamento não retomou");
        await esperar(`document.getElementById('cm-promo-sync').getAttribute('data-cm-promo-sync') === 'atualizado'`, "run não terminou", { tentativas: 800 });
        roteiro.latenciaMs = 5;
      });

      await check("UI 9. run RÁPIDO (termina antes do 1º status): a Central recarrega lista e indicadores mesmo assim", async () => {
        await passarCooldown(87);
        roteiro.latenciaMs = 0;
        await ev(`document.querySelector('[data-view="operational"]').click()`);
        await ev(`document.querySelector('[data-view="promotions"]').click()`);
        await esperar(`(document.querySelector('[data-cm-promo-sync-acao]')||{}).disabled === false`, "Atualizar não habilitou", { tentativas: 600 });
        // O status da 87 atrasa: o run termina antes da primeira leitura.
        atrasos["/operacao/central-margem/alianza-jeans/promocoes/status|87"] = 1500;
        const listasAntes = backend.log.filter((r) => /precificacao\/oportunidades$/.test(r.path)).length;
        const runsAntes = (await contaRuns(87)).length;
        await ev(`document.querySelector('[data-cm-promo-sync-acao]').click()`);
        await aguardar(async () => {
          const rr = await contaRuns(87);
          return rr.length > runsAntes && !rr.some((x) => ["queued", "running"].includes(x.status));
        }, "run rápido não terminou");
        await esperar(`/Atualização concluída/.test(document.getElementById('cm-promo-sync').innerText)`, "aviso de conclusão não apareceu", { tentativas: 400 });
        delete atrasos["/operacao/central-margem/alianza-jeans/promocoes/status|87"];
        const listasDepois = backend.log.filter((r) => /precificacao\/oportunidades$/.test(r.path)).length;
        assert.ok(listasDepois > listasAntes, "a lista foi relida depois do run rápido");
        roteiro.latenciaMs = 5;
      });

      await check("UI 10. 503 transitório no status durante o run: a barra mantém a leitura, avisa, retenta e conclui", async () => {
        await passarCooldown(87);
        roteiro.latenciaMs = 60;
        await ev(`document.querySelector('[data-view="operational"]').click()`);
        await ev(`document.querySelector('[data-view="promotions"]').click()`);
        await esperar(`(document.querySelector('[data-cm-promo-sync-acao]')||{}).disabled === false`, "Atualizar não habilitou", { tentativas: 600 });
        await ev(`document.querySelector('[data-cm-promo-sync-acao]').click()`);
        await esperar(`document.getElementById('cm-promo-sync').getAttribute('data-cm-promo-sync') === 'sincronizando'`, "não entrou em sincronizando");
        atrasos.falharStatus = 2;
        await esperar(`/tentando de novo/.test(document.getElementById('cm-promo-sync').innerText)`, "aviso de retentativa não apareceu", { tentativas: 400 });
        await esperar(`document.getElementById('cm-promo-sync').getAttribute('data-cm-promo-sync') === 'atualizado'`, "não concluiu depois do 503", { tentativas: 1200 });
        await esperar(`/Atualização concluída/.test(document.getElementById('cm-promo-sync').innerText)`, "não recarregou depois do 503");
        roteiro.latenciaMs = 5;
      });

      await check("UI 8. a tela antiga nunca foi aberta nem chamada (nenhum promocoes-retorno.* servido; nenhuma rota /automacoes no backend)", async () => {
        assert.ok(!paginasServidas.some((p) => /promocoes-retorno/.test(p)), JSON.stringify(paginasServidas.filter((p) => /promo/.test(p))));
        assert.ok(!backend.log.some((r) => /automacoes|promocoes-retorno/.test(r.path)));
        assert.ok(backend.log.some((r) => r.method === "POST" && /\/promocoes\/sync$/.test(r.path)));
      });
    }

    console.log(`promocoesCentralUnificada.postgres: ${checks} checks ok`);
  } finally {
    try { if (cdp) cdp.close(); } catch (_) { /* */ }
    try { if (chrome) chrome.kill("SIGTERM"); } catch (_) { /* */ }
    try { if (estatico) estatico.close(); } catch (_) { /* */ }
    try {
      if (backend) {
        backend.server.closeAllConnections?.();
        await new Promise((r) => backend.server.close(() => r()));
        await sleep(300); // requests da página que ainda estavam no meio do caminho
      }
    } catch (_) { /* */ }
    try { if (worker) await worker.stop(); } catch (_) { /* */ }
    await pool.end().catch(() => {});
    await apagarBanco(banco.nome).catch((e) => console.error("não apagou o banco de teste:", e.message));
  }
}

main().catch((err) => {
  console.error(`  ✗ ${err && err.stack ? err.stack.split("\n").slice(0, 10).join("\n    ") : err}`);
  process.exit(1);
});
