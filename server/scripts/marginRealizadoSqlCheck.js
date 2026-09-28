#!/usr/bin/env node
// server/scripts/marginRealizadoSqlCheck.js
// Validação do SQL do REALIZADO da Central de Margem contra um Postgres REAL
// em memória (PGlite = Postgres em WASM). Complementa
// marginSnapshotSqlCheck.js; a suíte de testes usa fake db e não prova a
// semântica SQL destas consultas:
//   - resolveImportsForRange + diagnóstico por competência (R-01)
//   - loadRealizadoByImportIds (leitura enxuta: ORDER BY em coluna não
//     selecionada, tipo = ANY(text[])) — e que ela produz o MESMO agregado
//     que a carga completa (loadPedidosByImportIds)
//   - mapProjectionsForItems (item_id = ANY, escopo por conta)
//   - buscarRunAtivoDaConta (make_interval + limites de abandono)
//
// SEGURANÇA: nunca lê DATABASE_URL e nunca abre conexão de rede — o banco é
// criado em memória e descartado no fim.
//
// Uso (a partir de server/, sem alterar package.json):
//   npm install --no-save @electric-sql/pglite@0.3
//   node scripts/marginRealizadoSqlCheck.js

process.env.DATABASE_URL = "postgres://127.0.0.1:1/margin-realizado-sql-check-nunca-conecta";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let PGlite;
try {
  ({ PGlite } = require("@electric-sql/pglite"));
} catch (_) {
  console.error("Instale antes (sem salvar no package.json): npm install --no-save @electric-sql/pglite@0.3");
  process.exit(2);
}

const cvRepo = require("../services/centralVendas/centralVendasRepository");
const syncRuns = require("../services/centralVendas/centralVendasSyncRunService");
const snapshotRepo = require("../services/motorMargem/marginSnapshotRepository");
const cv = require("../services/motorMargem/adapters/centralVendasEvidenceAdapter");
const periodo = require("../services/motorMargem/marginRealizadoPeriodo");

async function criarDb() {
  const pg = new PGlite();
  await pg.exec(`
    CREATE TABLE clientes (id BIGSERIAL PRIMARY KEY, slug TEXT, nome TEXT, ativo BOOLEAN DEFAULT true);
    CREATE TABLE cliente_contas (id BIGSERIAL PRIMARY KEY, cliente_id BIGINT REFERENCES clientes(id), marketplace TEXT, ativo BOOLEAN DEFAULT true);
    CREATE TABLE bases (id BIGSERIAL PRIMARY KEY, slug TEXT, nome TEXT);
    CREATE TABLE users (id BIGSERIAL PRIMARY KEY, nome TEXT);
    CREATE TABLE ml_tokens (id BIGSERIAL PRIMARY KEY);
    INSERT INTO clientes (slug, nome) VALUES ('loja-a','A');
    INSERT INTO cliente_contas (cliente_id, marketplace) VALUES (1,'meli'),(1,'meli');
  `);
  await pg.exec(fs.readFileSync(path.join(__dirname, "..", "sql", "central_vendas_schema.sql"), "utf8"));
  await pg.exec(fs.readFileSync(path.join(__dirname, "..", "sql", "margin_snapshot_schema.sql"), "utf8"));
  const db = {
    async query(sql, params = []) {
      const r = await pg.query(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows };
    },
  };
  return { pg, db };
}

async function inserirImport(db, { conta, competencia, status, de, ate, publicadoEm }) {
  const r = await db.query(
    `INSERT INTO central_vendas_imports (cliente_id, cliente_slug, marketplace, competencia, fonte, cliente_conta_id,
       publication_status, coverage_date_from, coverage_date_to, published_at)
     VALUES (1, 'loja-a', 'meli', $1, 'orders_api', $2, $3, $4, $5, $6) RETURNING id`,
    [competencia, conta, status, de, ate, publicadoEm]
  );
  return Number(r.rows[0].id);
}

async function inserirPedido(db, importId, { pedidoId, data, status, itens, reembolso = null }) {
  const p = await db.query(
    `INSERT INTO central_vendas_pedidos (import_id, cliente_id, cliente_slug, marketplace, competencia, pedido_id, data_pedido, status, confianca, payload_json)
     VALUES ($1, 1, 'loja-a', 'meli', $2, $3, $4, $5, 'confiavel', $6::jsonb) RETURNING id`,
    [importId, data.slice(0, 7), pedidoId, data, status, JSON.stringify({ grande: "x".repeat(2000) })]
  );
  const pedidoRowId = Number(p.rows[0].id);
  let idx = 0;
  for (const it of itens) {
    const itemId = `${pedidoId}:${it.mlb}:${idx++}`;
    const i = await db.query(
      `INSERT INTO central_vendas_pedido_itens (import_id, pedido_row_id, cliente_id, cliente_slug, marketplace, competencia, pedido_id, item_id,
         mlb, sku, titulo, quantidade, valor_unitario, receita_produto, custo_produto, imposto_interno, resultado, confianca)
       VALUES ($1,$2,1,'loja-a','meli',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'confiavel') RETURNING id`,
      [importId, pedidoRowId, data.slice(0, 7), pedidoId, itemId, it.mlb, `SKU-${it.mlb}`, `Produto ${it.mlb}`, it.qtd, it.unit,
        it.unit * it.qtd, it.custo, it.imposto, it.resultado ?? null]
    );
    const itemRowId = Number(i.rows[0].id);
    const comps = [
      ["receita_produto", it.unit * it.qtd], ["tarifa_venda", -it.tarifa], ["custo_produto", it.custo === null ? null : -it.custo],
      ["imposto_interno", it.imposto === null ? null : -it.imposto], ["frete_seller", it.frete === null ? null : -it.frete],
    ];
    for (const [tipo, valor] of comps) {
      await db.query(
        `INSERT INTO central_vendas_componentes (import_id, pedido_row_id, item_row_id, cliente_id, cliente_slug, marketplace, competencia, pedido_id, item_id, tipo, valor, confianca)
         VALUES ($1,$2,$3,1,'loja-a','meli',$4,$5,$6,$7,$8,'real')`,
        [importId, pedidoRowId, itemRowId, data.slice(0, 7), pedidoId, itemId, tipo, valor]
      );
    }
  }
  await db.query(
    `INSERT INTO central_vendas_componentes (import_id, pedido_row_id, item_row_id, cliente_id, cliente_slug, marketplace, competencia, pedido_id, tipo, valor, confianca)
     VALUES ($1,$2,NULL,1,'loja-a','meli',$3,$4,'receita_envio',15,'real')`,
    [importId, pedidoRowId, data.slice(0, 7), pedidoId]
  );
  if (reembolso !== null) {
    await db.query(
      `INSERT INTO central_vendas_componentes (import_id, pedido_row_id, item_row_id, cliente_id, cliente_slug, marketplace, competencia, pedido_id, tipo, valor, confianca)
       VALUES ($1,$2,NULL,1,'loja-a','meli',$3,$4,'cancelamento_reembolso',$5,'real')`,
      [importId, pedidoRowId, data.slice(0, 7), pedidoId, -reembolso]
    );
  }
}

function resumoDoAgregado(agg) {
  const out = {};
  for (const [mlb, a] of agg.porMlb) {
    const bag = require("../services/motorMargem/core").createEvidenceBag();
    out[mlb] = cv.aplicarEvidenciasRealizadas(bag, { agregado: a });
  }
  return { porMlb: out, reembolsos: agg.reembolsos, semMlb: agg.semMlb };
}

async function main() {
  const { db } = await criarDb();

  // Conta 1: agosto publicado inteiro; setembro publicado pelo noturno ATÉ ONTEM.
  const ago = await inserirImport(db, { conta: 1, competencia: "2026-08", status: "published", de: "2026-08-01", ate: "2026-08-31", publicadoEm: "2026-09-05T06:00:00Z" });
  const set = await inserirImport(db, { conta: 1, competencia: "2026-09", status: "published", de: "2026-09-01", ate: "2026-09-27", publicadoEm: "2026-09-28T06:10:00Z" });
  // Candidate e import de OUTRA conta: nunca podem aparecer.
  const cand = await inserirImport(db, { conta: 1, competencia: "2026-09", status: "candidate", de: "2026-09-01", ate: "2026-09-28", publicadoEm: null });
  const outra = await inserirImport(db, { conta: 2, competencia: "2026-09", status: "published", de: "2026-09-01", ate: "2026-09-27", publicadoEm: "2026-09-28T06:00:00Z" });

  const item = (mlb, extra = {}) => ({ mlb, qtd: 1, unit: 100, custo: 40, imposto: 6, tarifa: 14, frete: 20, resultado: 20, ...extra });
  await inserirPedido(db, ago, { pedidoId: "P1", data: "2026-08-30", status: "paid", itens: [item("MLB1", { qtd: 2, unit: 90, custo: 72, imposto: 10.8, tarifa: 25.2 })] });
  await inserirPedido(db, set, { pedidoId: "P2", data: "2026-09-10", status: "paid", itens: [item("MLB1"), item("MLB2", { frete: null })] });
  await inserirPedido(db, set, { pedidoId: "P3", data: "2026-09-12", status: "cancelled", itens: [item("MLB2")], reembolso: 100 });
  await inserirPedido(db, set, { pedidoId: "P4", data: "2026-09-20", status: "paid", itens: [item("MLB3", { custo: null })] });
  await inserirPedido(db, cand, { pedidoId: "PX", data: "2026-09-28", status: "paid", itens: [item("MLB9")] });
  await inserirPedido(db, outra, { pedidoId: "PY", data: "2026-09-15", status: "paid", itens: [item("MLB8")] });

  // 1) Período padrão (até ontem) usa agosto E setembro; até hoje, só agosto + lacuna.
  const padrao = periodo.resolverPeriodoRealizado({ now: new Date("2026-09-28T15:00:00Z") });
  const sel = await cvRepo.resolveImportsForRange({ clienteSlug: "loja-a", dateFrom: padrao.dateFrom, dateTo: padrao.dateTo, clienteContaId: 1, includeLegacy: false }, db);
  assert.deepStrictEqual(sel.importIds.map(Number), [ago, set], "período padrão usa os dois meses publicados");
  assert.strictEqual(periodo.resumirCobertura({ competencias: sel.competencias }).estado, "ATUAL");
  const hoje = await cvRepo.resolveImportsForRange({ clienteSlug: "loja-a", dateFrom: "2026-08-30", dateTo: "2026-09-28", clienteContaId: 1, includeLegacy: false }, db);
  assert.deepStrictEqual(hoje.importIds.map(Number), [ago]);
  const cobHoje = periodo.resumirCobertura({ competencias: hoje.competencias });
  assert.strictEqual(cobHoje.estado, "PARCIAL");
  assert.strictEqual(cobHoje.lacunas[0].publicadoAte, "2026-09-27");
  console.log("  ✓ seleção M4 + diagnóstico por competência (R-01) em Postgres real");

  // 2) Leitura enxuta = mesmo agregado da carga completa, sem payload e sem tipos descartados.
  const completa = await cvRepo.loadPedidosByImportIds({ importIds: sel.importIds, dateFrom: padrao.dateFrom, dateTo: padrao.dateTo }, db);
  const enxuta = await cvRepo.loadRealizadoByImportIds({ importIds: sel.importIds, dateFrom: padrao.dateFrom, dateTo: padrao.dateTo }, db);
  assert.strictEqual(enxuta.pedidos.length, completa.pedidos.length);
  assert.ok(!("payload_json" in enxuta.pedidos[0]), "pedidos sem payload_json");
  assert.ok(enxuta.componentes.every((c) => cvRepo.TIPOS_COMPONENTE_REALIZADO.includes(c.tipo)), "só os tipos do realizado");
  assert.ok(enxuta.componentes.length < completa.componentes.length);
  const agregar = (carga) => {
    const resultado = carga.pedidos.filter((p) => p.status !== "cancelled");
    return cv.agregarPorMlb({ pedidosTodos: carga.pedidos, pedidosResultado: resultado, itens: carga.itens, componentes: carga.componentes });
  };
  assert.deepStrictEqual(resumoDoAgregado(agregar(enxuta)), resumoDoAgregado(agregar(completa)), "agregado idêntico");
  const agg = agregar(enxuta);
  assert.strictEqual(agg.porMlb.get("MLB1").unidades, 3);
  assert.strictEqual(agg.reembolsoPorMlb.get("MLB2").soma, 100, "reembolso do cancelado de item único sobrevive");
  assert.ok(!agg.porMlb.has("MLB9") && !agg.porMlb.has("MLB8"), "candidate e outra conta nunca entram");
  console.log(`  ✓ leitura enxuta produz o mesmo agregado (${enxuta.componentes.length}/${completa.componentes.length} componentes lidos)`);

  // 3) Projeções em lote, escopadas pela conta.
  const upsert = async (conta, itemId, margin) => snapshotRepo.upsertProjectionSnapshot({
    clienteId: 1, clienteContaId: conta, marketplace: "meli", itemId, sku: null, titulo: itemId, baseId: null,
    price: 100, cost: 40, taxRate: 0.06, fixedFee: 0, commission: 14, commissionRate: 0.14, freight: 20,
    profit: margin * 100, margin, marginPercent: margin * 100, status: "HEALTHY", confidenceLevel: "HIGH",
    quality: {}, missing: [], assumed: [], divergences: [], observedAt: new Date(), runId: null, refreshStatus: "fresh",
  }, db);
  await upsert(1, "MLB1", 0.2);
  await upsert(1, "MLB2", 0.15);
  await upsert(2, "MLB1", 0.99);
  const proj = await snapshotRepo.mapProjectionsForItems({ clienteId: 1, clienteContaId: 1, itemIds: ["MLB1", "MLB2", "MLB404"], db });
  assert.deepStrictEqual(Array.from(proj.keys()).sort(), ["MLB1", "MLB2"]);
  assert.strictEqual(proj.get("MLB1").margin, 0.2, "nunca a projeção da conta 2");
  console.log("  ✓ mapProjectionsForItems: 1 query, item_id = ANY, escopo por conta");

  // 4) Sync ativo da conta, ignorando run abandonado.
  // (Índice único: 1 run ativo por tupla conta+período — por isso períodos diferentes.)
  const run = async (status, minutosAtras, de, ate) => db.query(
    `INSERT INTO central_vendas_sync_runs (cliente_id, cliente_slug, cliente_conta_id, marketplace, date_from, date_to, status, created_at, started_at)
     VALUES (1, 'loja-a', 1, 'meli', $3, $4, $1, NOW() - make_interval(mins => $2::int), NOW() - make_interval(mins => $2::int))`,
    [status, minutosAtras, de, ate]
  );
  assert.strictEqual(await syncRuns.buscarRunAtivoDaConta({ clienteId: 1, clienteContaId: 1, db }), null);
  await run("running", 500, "2026-08-01", "2026-08-31"); // abandonado (> RUNNING_STALE_MINUTES)
  assert.strictEqual(await syncRuns.buscarRunAtivoDaConta({ clienteId: 1, clienteContaId: 1, db }), null, "run abandonado não é 'em sincronização'");
  await run("running", 5, "2026-09-01", "2026-09-27");
  const ativo = await syncRuns.buscarRunAtivoDaConta({ clienteId: 1, clienteContaId: 1, db });
  assert.strictEqual(ativo.status, "running");
  assert.strictEqual(ativo.dateTo, "2026-09-27");
  assert.strictEqual(await syncRuns.buscarRunAtivoDaConta({ clienteId: 1, clienteContaId: 2, db }), null, "outra conta");
  console.log("  ✓ buscarRunAtivoDaConta: make_interval + limite de abandono");

  console.log("marginRealizadoSqlCheck: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
