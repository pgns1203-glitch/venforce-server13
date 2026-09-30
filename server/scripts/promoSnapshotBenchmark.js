#!/usr/bin/env node
// server/scripts/promoSnapshotBenchmark.js
// Benchmark do Promo Snapshot com Postgres real em memória (PGlite) e ML
// falso instantâneo (só GET): 1 conta, N anúncios (padrão 5.000) com 0–4
// promoções cada. Mede consultas ao banco, chamadas ao ML, memória, tempo de
// persistência e tempo de leitura — e prova que a leitura das Oportunidades
// não cresce com o catálogo (mesmo número de consultas para N/10 e N).
//
// O tempo do ML real NÃO está aqui (o fake responde na hora): o custo real
// da sincronização é dominado pelas chamadas ao ML, espaçadas pelo limiter
// (PROMO_SNAPSHOT_REQUEST_INTERVAL_MS) — ver a estimativa impressa no fim.
//
// SEGURANÇA: nunca lê DATABASE_URL e nunca abre conexão de rede.
// Uso: npm install --no-save @electric-sql/pglite@0.3 && node scripts/promoSnapshotBenchmark.js [N]

process.env.DATABASE_URL = "postgres://127.0.0.1:1/promo-snapshot-benchmark-nunca-conecta";

let PGlite;
try {
  ({ PGlite } = require("@electric-sql/pglite"));
} catch (_) {
  console.error("Instale antes (sem salvar no package.json): npm install --no-save @electric-sql/pglite@0.3");
  process.exit(2);
}

const repo = require("../services/promoSnapshot/promoSnapshotRepository");
const schemaEnsure = require("../services/schema/schemaEnsure");
const service = require("../services/promoSnapshot/promoSnapshotService");
const runtime = require("../services/promoSnapshot/promoSnapshotRuntime");
const { processPromoSnapshotRun } = require("../services/promoSnapshot/promoSnapshotProcessor");
const { resolvePromoSnapshotConfig } = require("../services/promoSnapshot/promoSnapshotConfig");
const { createRateLimiter } = require("../services/motorMargem/marginSnapshotRateLimiter");
const { listarOportunidades } = require("../services/motorMargem/precificacao/precificacaoOportunidadesService");
const F = require("../tests/helpers/promoSnapshotFakes");

const N = Math.max(10, Number(process.argv[2]) || 5000);
const silencioso = { log() {}, warn() {}, error() {} };
const TIPOS = ["DEAL", "MARKETPLACE_CAMPAIGN", "SMART", "PRICE_DISCOUNT"];

function catalogo(n) {
  const itens = {};
  const saleInfo = {};
  for (let i = 1; i <= n; i += 1) {
    const id = `MLB${1000000 + i}`;
    const qtd = i % 5; // 0..4 promoções
    const lista = [];
    for (let k = 0; k < qtd; k += 1) {
      const started = k === 0 && i % 3 === 0;
      lista.push(F.promo({
        id: `P-${TIPOS[k]}-${k}`, type: TIPOS[k], status: started ? "started" : k === 3 ? "pending" : "candidate",
        price: started || k === 3 ? 90 - k : undefined, suggested: started ? undefined : 88 - k,
        meli: k % 2 ? 5 : undefined, seller: 5,
      }));
      if (started) saleInfo[id] = { promotionId: `P-${TIPOS[k]}-${k}`, amount: 90 - k };
    }
    itens[id] = lista;
  }
  return { itens, saleInfo };
}

async function ambiente(n) {
  const pg = new PGlite();
  const contador = { total: 0, porTipo: {} };
  const db = {
    async query(sql, params = []) {
      contador.total += 1;
      const tipo = sql.trim().split(/\s+/)[0].toUpperCase();
      contador.porTipo[tipo] = (contador.porTipo[tipo] || 0) + 1;
      if (!params.length && /;\s*\S/.test(sql)) {
        const r = await pg.exec(sql);
        return { rows: r[r.length - 1]?.rows || [], rowCount: r[r.length - 1]?.affectedRows };
      }
      const r = await pg.query(sql, params);
      // Linhas que a consulta paginada das Oportunidades devolve ao Node.
      if (/WITH promos AS/.test(sql)) contador.linhasOportunidades = r.rows.filter((x) => x.item_id != null).length;
      return { rows: r.rows, rowCount: r.affectedRows };
    },
  };
  await pg.exec(`
    CREATE TABLE clientes (id SERIAL PRIMARY KEY, slug TEXT, nome TEXT, ativo BOOLEAN DEFAULT true);
    CREATE TABLE cliente_contas (id SERIAL PRIMARY KEY, cliente_id INT REFERENCES clientes(id), marketplace TEXT, nome TEXT, ativo BOOLEAN DEFAULT true, external_account_id TEXT);
    CREATE TABLE margin_projection_snapshots (id SERIAL PRIMARY KEY, cliente_conta_id INT, marketplace TEXT, item_id TEXT, titulo TEXT, image_url TEXT,
      price NUMERIC, cost NUMERIC, tax_rate NUMERIC, fixed_fee NUMERIC, commission_rate NUMERIC, freight NUMERIC, margin NUMERIC, catalog_missing_since TIMESTAMPTZ);
    CREATE INDEX ON margin_projection_snapshots (cliente_conta_id, marketplace, item_id);
    INSERT INTO clientes (id, slug, nome) VALUES (3, 'loja-a', 'Loja A');
    INSERT INTO cliente_contas (id, cliente_id, marketplace, nome, external_account_id) VALUES (7, 3, 'meli', 'A', '555');
    INSERT INTO margin_projection_snapshots (cliente_conta_id, marketplace, item_id, titulo, price, cost, tax_rate, fixed_fee, commission_rate, freight, margin)
      SELECT 7, 'meli', 'MLB' || (1000000 + g), 'Produto ' || g, 100, 40, 0.1, 0, 0.12, 10, 0.2 FROM generate_series(1, ${n}) g;
  `);
  await schemaEnsure.ensurePromoSnapshotSchema(db);
  const { itens, saleInfo } = catalogo(n);
  const ml = F.criarMlFake({ sellers: { 555: { itens, saleInfo } } });
  return { pg, db, contador, ml };
}

function mb(bytes) { return (bytes / 1048576).toFixed(1); }

async function sincronizar(amb) {
  const env = { PROMO_SNAPSHOT_WORKER_ENABLED: "true", PROMO_SNAPSHOT_REQUEST_INTERVAL_MS: "0", PROMO_SNAPSHOT_MAX_CATALOG_ITEMS: "200000" };
  const config = resolvePromoSnapshotConfig(env);
  const base = { db: amb.db, repo, env, logger: silencioso, kick() {} };
  let tempoPersistencia = 0;
  let lotes = 0;
  const repoMedido = {
    ...repo,
    async registrarLote(args, db) {
      const t = process.hrtime.bigint();
      try { return await repo.registrarLote(args, db); } finally { tempoPersistencia += Number(process.hrtime.bigint() - t) / 1e6; lotes += 1; }
    },
  };
  let pico = process.memoryUsage().heapUsed;
  const amostra = setInterval(() => { pico = Math.max(pico, process.memoryUsage().heapUsed); }, 20);
  const worker = runtime.criarWorker({
    db: amb.db, logger: silencioso, config, runService: service.criarRunService(base),
    processor: (run, ctx) => processPromoSnapshotRun(run, {
      ...ctx, db: amb.db, repo: repoMedido, config, mlFetch: amb.ml.mlFetch, sleep: async () => {},
      rateLimiter: createRateLimiter({ minIntervalMs: 0 }), validarConta: async () => ({}),
    }),
  });
  if (global.gc) global.gc();
  const heapAntes = process.memoryUsage().heapUsed;
  const q0 = amb.contador.total;
  const t0 = process.hrtime.bigint();
  await service.enqueuePromoSnapshotRun({ clienteId: 3, clienteSlug: "loja-a", clienteContaId: 7, sellerId: "555" }, { reason: "benchmark" }, base);
  const r = await worker.runOnce();
  const total = Number(process.hrtime.bigint() - t0) / 1e6;
  clearInterval(amostra);
  pico = Math.max(pico, process.memoryUsage().heapUsed);
  return { r, total, tempoPersistencia, lotes, queries: amb.contador.total - q0, heapAntes, pico, config };
}

async function lerOportunidades(amb, page = 1) {
  const q0 = amb.contador.total;
  const t0 = process.hrtime.bigint();
  const r = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7, page, limit: 20 }, {
    db: amb.db, repo, env: { PROMO_SNAPSHOT_WORKER_ENABLED: "true" }, logger: silencioso, kick() {},
    resolverContaDoCliente: async () => ({ cliente: { id: 3, slug: "loja-a" }, conta: { id: 7, nome: "A" } }),
    obterConta: async () => ({ id: 7, external_account_id: "555" }),
    carregarRealizada: async () => ({ porMlb: new Map(), periodo: null }),
  });
  return { r, ms: Number(process.hrtime.bigint() - t0) / 1e6, queries: amb.contador.total - q0, linhasDoBanco: amb.contador.linhasOportunidades };
}

async function lerSnapshot(amb, runId) {
  const q0 = amb.contador.total;
  const t0 = process.hrtime.bigint();
  const r = await repo.listarLinhasSnapshot({ clienteContaId: 7, sellerId: "555", runId, page: 10, limit: 100 }, amb.db);
  return { r, ms: Number(process.hrtime.bigint() - t0) / 1e6, queries: amb.contador.total - q0 };
}

async function main() {
  const amb = await ambiente(N);
  const s = await sincronizar(amb);
  const run = s.r.run;
  const linhas = await amb.pg.query(`SELECT COUNT(*)::int n FROM promo_snapshot_itens WHERE run_id = $1`, [run.id]);
  await amb.pg.query("ANALYZE");
  const op1 = await lerOportunidades(amb, 1);
  const op2 = await lerOportunidades(amb, 50);
  const ultimaPag = Math.max(1, Math.ceil(op1.r.total / 20));
  const opU = await lerOportunidades(amb, ultimaPag);
  const sn = await lerSnapshot(amb, run.id);
  // Plano da consulta REAL das Oportunidades (filtro + 1/anúncio + ordem + LIMIT no banco).
  const { sqlOportunidadesPaginadas } = require("../services/motorMargem/precificacao/precificacaoOportunidadesSql");
  const q = sqlOportunidadesPaginadas({
    fonteSql: `SELECT p.item_id, p.promocao_chave AS chave, p.preco_final AS preco_promo, p.subsidio_ml AS retorno FROM promo_snapshot_itens p
                WHERE p.run_id = $1 AND p.cliente_conta_id = $2 AND p.seller_id = $3 AND p.preco_final > 0 AND p.status IN ('candidate','started','active','pending')`,
    paramsFonte: [run.id, 7, "555"], clienteContaId: 7, vendasPorMlb: new Map(), page: 50, limit: 20,
  });
  const plano = await amb.pg.query(`EXPLAIN ANALYZE ${q.sql}`, q.params);

  // Mesma leitura com um catálogo 10x menor: o número de consultas não muda.
  const pequeno = await ambiente(Math.max(10, Math.floor(N / 10)));
  await sincronizar(pequeno);
  await pequeno.pg.query("ANALYZE");
  const opP = await lerOportunidades(pequeno, 1);

  const chamadasMl = amb.ml.chamadas.length;
  const porTipoMl = {
    catalogo: amb.ml.contar(/^\/users\//),
    promocoes_item: amb.ml.contar(/^\/seller-promotions\/items\//),
    sale_price: amb.ml.contar(/\/sale_price\?/),
    vigencia: amb.ml.contar(/^\/seller-promotions\/promotions\//),
  };
  const intervalo = Number(resolvePromoSnapshotConfig({}).requestIntervalMs);

  console.log(`\nPromo Snapshot — benchmark (PGlite + ML falso instantâneo)\n`);
  console.log(`Catálogo: 1 conta, ${N} anúncios, ${run.promocoesEncontradas} promoções gravadas (${linhas.rows[0].n} linhas), ${run.itensComPromocao} anúncios com promoção`);
  console.log(`Run: status=${run.status} promovido=${run.promovido} erros=${run.erros}`);
  console.log(`\nSincronização`);
  console.log(`  tempo total (sem latência do ML) ........ ${s.total.toFixed(0)} ms`);
  console.log(`  tempo de persistência (${s.lotes} lotes) ...... ${s.tempoPersistencia.toFixed(0)} ms (${(s.tempoPersistencia / s.lotes).toFixed(1)} ms/lote)`);
  console.log(`  consultas ao banco ........................ ${s.queries} (${(s.queries / N).toFixed(2)} por anúncio; lote de ${s.config.batchSize})`);
  console.log(`  chamadas ao ML (todas GET) ................ ${chamadasMl} ${JSON.stringify(porTipoMl)}`);
  console.log(`  escritas no ML ............................ ${amb.ml.escritas().length}`);
  console.log(`  heap: antes ${mb(s.heapAntes)} MB · pico ${mb(s.pico)} MB · Δ pico ${mb(s.pico - s.heapAntes)} MB`);
  console.log(`\nLeitura (Central)`);
  console.log(`  Oportunidades página 1 .................... ${op1.ms.toFixed(1)} ms · ${op1.queries} consultas · ${op1.linhasDoBanco} linhas do banco · total=${op1.r.total} hasNext=${op1.r.hasNext}`);
  console.log(`  Oportunidades página 50 ................... ${op2.ms.toFixed(1)} ms · ${op2.queries} consultas · ${op2.linhasDoBanco} linhas do banco`);
  console.log(`  Oportunidades última página (${ultimaPag}) ........ ${opU.ms.toFixed(1)} ms · ${opU.linhasDoBanco} linhas do banco · hasNext=${opU.r.hasNext}`);
  console.log(`  Oportunidades com ${Math.floor(N / 10)} anúncios ........... ${opP.ms.toFixed(1)} ms · ${opP.queries} consultas  ← mesmo nº de consultas (sem N+1)`);
  console.log(`  Snapshot (página 10, 100 linhas) .......... ${sn.ms.toFixed(1)} ms · ${sn.queries} consultas · total=${sn.r.total}`);
  console.log(`\nPlano da consulta das Oportunidades:\n  ${plano.rows.map((x) => x["QUERY PLAN"]).join("\n  ")}`);
  console.log(`\nEstimativa com ML real: ${chamadasMl} GETs espaçados em ≥${intervalo} ms (PROMO_SNAPSHOT_REQUEST_INTERVAL_MS) ≈ ${Math.ceil((chamadasMl * intervalo) / 60000)} min por conta, fora a latência de cada GET com ${resolvePromoSnapshotConfig({}).itemConcurrency} em paralelo.`);

  if (op1.queries !== opP.queries) { console.error("FALHOU: consultas das Oportunidades cresceram com o catálogo"); process.exitCode = 1; }
  if (op1.linhasDoBanco > 20 || op2.linhasDoBanco > 20) { console.error("FALHOU: Oportunidades trouxeram mais que a página do banco"); process.exitCode = 1; }
  if (amb.ml.escritas().length) { console.error("FALHOU: houve escrita no ML"); process.exitCode = 1; }
  await amb.pg.close();
  await pequeno.pg.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
