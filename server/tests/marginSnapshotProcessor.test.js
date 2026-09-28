// server/tests/marginSnapshotProcessor.test.js
// Margin Snapshot — M3: processor real testado com deps fake/injetadas.
//
// NENHUMA chamada real ao Mercado Livre ou ao Postgres acontece neste
// arquivo: a listagem do catálogo, prepareWorkspaceContext e enrichBatch são
// substituídos por fakes (ou, no golden test, o Motor REAL roda com adapters
// fake), e a persistência usa o fake db em memória de M1/M2
// (tests/helpers/marginSnapshotFakeDb.js) por baixo do repository REAL.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const C = require("../services/motorMargem/core");
const motorMargem = require("../services/motorMargem/motorMargemService");
const {
  processMarginSnapshotRun,
  MarginSnapshotMarketplaceNaoSuportadoError,
  BATCH_SIZE,
} = require("../services/motorMargem/marginSnapshotProcessor");
const { MarginSnapshotStopError } = require("../services/motorMargem/marginSnapshotRetry");
const { createRateLimiter } = require("../services/motorMargem/marginSnapshotRateLimiter");
const { resolveMarginSnapshotConfig } = require("../services/motorMargem/marginSnapshotConfig");
const snapshotRepository = require("../services/motorMargem/marginSnapshotRepository");
const runRepository = require("../services/motorMargem/marginSnapshotRunRepository");
const { makeMarginSnapshotFakeDb } = require("./helpers/marginSnapshotFakeDb");
const fixture = require("./helpers/motorMargemFixture");

const NOW = new Date("2026-09-25T12:00:00.000Z");

// ── Helpers ──────────────────────────────────────────────────────────────────

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

const SILENCIOSO = { log() {}, warn() {}, error() {} };

// Config de teste: sem pausa entre lotes (a pausa tem teste próprio) e
// backoff determinístico.
function configTeste(overrides = {}) {
  return {
    ...resolveMarginSnapshotConfig({}),
    batchPauseMs: 0,
    batchMaxAttempts: 3,
    batchBackoffBaseMs: 1000,
    batchBackoffMaxMs: 4000,
    retryAfterMaxMs: 60000,
    maxConsecutiveBatchFailures: 3,
    ...overrides,
  };
}

function criarPreparedFake(overrides = {}) {
  return {
    now: NOW,
    cliente: { id: 1, nome: "Cliente Teste", slug: "cliente-teste" },
    base: { id: 900, slug: "base-teste", nome: "Base Teste" },
    mlUserId: 555,
    periodo: { dateFrom: "2026-08-27", dateTo: "2026-09-25" },
    custos: { index: new Map(), total: 0 },
    vendasRaw: { sincronizado: false, pedidos: [], itens: [], componentes: [], imports: [], importSnapshotAt: null },
    porMlb: new Map(),
    reembolsoPorMlb: new Map(),
    naoAtribuido: { reembolso: 0 },
    reembolsos: [],
    fallbackObservedAt: null,
    ...overrides,
  };
}

function fakePrepareWorkspaceContext(prepared, chamadas = []) {
  return async (params, deps) => {
    chamadas.push({ params, deps });
    return prepared;
  };
}

function idsDe(total, prefixo = 1000) {
  return Array.from({ length: total }, (_, i) => `MLB${prefixo + i}`);
}

function fakeListagem(ids, chamadas = []) {
  return async (args) => {
    chamadas.push(args);
    return { ids: ids.slice(), totalAtivos: ids.length, totalPausados: 0 };
  };
}

// enrichBatch fake: recebe `itemIds` (contrato usado pelo worker) e devolve 1
// item REAL do núcleo por id. `falhas` permite injetar erro por chamada.
function fakeEnrichBatch({ gerarItem = (id) => itemComEvidencias({ itemId: id }), chamadas = [], falhar = null } = {}) {
  return async (_prepared, { itemIds, offset, limit }) => {
    chamadas.push({ itemIds, offset, limit });
    if (falhar) {
      const erro = falhar({ itemIds, chamada: chamadas.length });
      if (erro) throw erro;
    }
    return { totalItensMl: itemIds.length, itens: itemIds.map((id) => gerarItem(id)).filter(Boolean) };
  };
}

// Item REAL do núcleo (buildMarginItem/createEvidenceBag). `null` num campo
// omite a evidência (ausente); qualquer outro valor (incluindo 0) registra.
function itemComEvidencias({
  itemId = "MLB1", sku = null, titulo = null,
  cost = 40, taxRate = 0.1, fixedFee = 0,
  price = 100, commission = 12, commissionRate = 0.12, freight = 20,
  now = NOW,
} = {}) {
  const bag = C.createEvidenceBag();
  const comumBase = {
    source: C.SOURCES.VENFORCE_BASE, kind: C.EVIDENCE_KINDS.PROJECTED,
    quality: C.EVIDENCE_QUALITY.DECLARED, observedAt: now,
  };
  if (cost !== null) bag.add(C.FIELDS.COST, { ...comumBase, value: cost });
  if (taxRate !== null) bag.add(C.FIELDS.TAX_RATE, { ...comumBase, value: taxRate });
  if (fixedFee !== null) bag.add(C.FIELDS.FIXED_FEE, { ...comumBase, value: fixedFee });

  const comumMeli = {
    source: C.SOURCES.MELI_API, kind: C.EVIDENCE_KINDS.PROJECTED,
    quality: C.EVIDENCE_QUALITY.MEASURED, observedAt: now,
  };
  if (price !== null) bag.add(C.FIELDS.PRICE, { ...comumMeli, value: price });
  if (commission !== null) bag.add(C.FIELDS.COMMISSION, { ...comumMeli, value: commission });
  if (commissionRate !== null) bag.add(C.FIELDS.COMMISSION_RATE, { ...comumMeli, value: commissionRate });
  if (freight !== null) bag.add(C.FIELDS.FREIGHT, { ...comumMeli, value: freight });

  return C.buildMarginItem({
    identity: { clienteSlug: "cliente-teste", marketplace: "meli", itemId, sku, titulo },
    bag,
    sales: { hasOrders: false },
    settlement: { available: false, motivo: "MERCADO_PAGO_NAO_INTEGRADO" },
    now,
  });
}

// Run REAL no fake db, já em `running` (mesma transição do claim).
async function criarRunRunning(db, overrides = {}) {
  const run = await runRepository.createRun({
    clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: 5, marketplace: "meli",
    reason: "manual_refresh", db,
    ...overrides,
  });
  return runRepository.updateRunStatus({ runId: run.id, status: "running", db });
}

// Deps padrão de um run: fake db real + fakes de Motor/listagem + sleep que
// só registra e avança um relógio fake (nunca espera de verdade). O rate
// limiter do processo é substituído por um limiter com o MESMO relógio.
function depsRun(db, { ids = idsDe(1), prepared = criarPreparedFake(), sleeps = [], config = {}, ...resto } = {}) {
  const cfg = configTeste(config);
  const relogio = { t: 0 };
  const sleep = async (ms) => { sleeps.push(ms); relogio.t += ms; };
  return {
    db,
    logger: SILENCIOSO,
    config: cfg,
    sleep,
    rateLimiter: createRateLimiter({ minIntervalMs: cfg.batchPauseMs, now: () => relogio.t, sleep }),
    prepareWorkspaceContext: fakePrepareWorkspaceContext(prepared),
    listarIdsCatalogo: fakeListagem(ids),
    enrichBatch: fakeEnrichBatch(),
    ...resto,
  };
}

async function snapshot(db, itemId, clienteContaId = 5) {
  return snapshotRepository.getProjectionSnapshot({ clienteContaId, itemId, db });
}

function erroMl({ statusCode = 502, mlStatus = null, retryAfter = null, message = "falha simulada do ML" } = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (mlStatus !== null) err.mlStatus = mlStatus;
  if (retryAfter !== null) err.retryAfter = retryAfter;
  return err;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXTO
// ═══════════════════════════════════════════════════════════════════════════

cenario("1. passa clienteContaId (e clienteSlug) do run ao Motor", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db, { clienteContaId: 42, clienteSlug: "cliente-x" });
  const chamadas = [];
  await processMarginSnapshotRun(run, depsRun(db, {
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake(), chamadas),
  }));

  assert.strictEqual(chamadas.length, 1);
  assert.strictEqual(chamadas[0].params.clienteContaId, 42);
  assert.strictEqual(chamadas[0].params.clienteSlug, "cliente-x");
});

cenario("2. prepareWorkspaceContext é chamado 1x por run, mesmo com vários lotes", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const chamadasContexto = [];
  const chamadasLote = [];
  await processMarginSnapshotRun(run, depsRun(db, {
    ids: idsDe(61),
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake(), chamadasContexto),
    enrichBatch: fakeEnrichBatch({ chamadas: chamadasLote }),
  }));

  assert.strictEqual(chamadasContexto.length, 1, "prepareWorkspaceContext deve ser chamado exatamente 1x por run");
  assert.strictEqual(chamadasLote.length, 4, "61 itens = 4 lotes de até 20");
});

cenario("3. contexto é preparado SEM fonte de vendas — snapshot é projeção pura, mesmo se deps trouxer vendas", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const chamadas = [];
  await processMarginSnapshotRun(run, depsRun(db, {
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake(), chamadas),
    // Um chamador injetando vendas NÃO pode vazar realizado para o snapshot.
    carregarVendas: async () => ({ sincronizado: true, pedidos: [{ id: 1 }], itens: [], componentes: [], imports: [] }),
    agregarPorMlb: () => fixture.vendasPorMlb(),
  }));

  const depsRecebidas = chamadas[0].deps;
  const vendas = await depsRecebidas.carregarVendas();
  assert.strictEqual(vendas.pedidos.length, 0, "fonte de vendas deve chegar vazia ao Motor");
  const agregado = depsRecebidas.agregarPorMlb({});
  assert.strictEqual(agregado.porMlb.size, 0, "agregação por MLB deve chegar vazia ao Motor");
});

// ═══════════════════════════════════════════════════════════════════════════
// LOTES (paginação real do catálogo)
// ═══════════════════════════════════════════════════════════════════════════

async function rodarComNItens(total) {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const chamadasLote = [];
  const resultado = await processMarginSnapshotRun(run, depsRun(db, {
    ids: idsDe(total),
    enrichBatch: fakeEnrichBatch({ chamadas: chamadasLote }),
  }));
  return { db, run, resultado, lotes: chamadasLote };
}

for (const [total, lotesEsperados] of [[1, 1], [BATCH_SIZE, 1], [21, 2], [200, 10], [260, 13]]) {
  cenario(`4. ${total} item(ns) → ${lotesEsperados} lote(s) de enrichBatch`, async () => {
    const { resultado, lotes } = await rodarComNItens(total);
    assert.strictEqual(lotes.length, lotesEsperados);
    assert.strictEqual(resultado.processedItems, total);
    assert.ok(lotes.every((l) => l.itemIds.length <= BATCH_SIZE), "nenhum lote passa do teto do multiget (20)");
  });
}

cenario("5. catálogo > 200 (5.000 itens) é processado inteiro no worker — sem clamp de 200, sem ML real", async () => {
  const { db, resultado, lotes } = await rodarComNItens(5000);
  assert.strictEqual(lotes.length, 250, "5.000 itens em lotes de 20 = 250 lotes");
  assert.strictEqual(resultado.processedItems, 5000);
  assert.strictEqual(resultado.successItems, 5000);
  assert.strictEqual(db.snapshots.length, 5000);
  const vistos = new Set(lotes.flatMap((l) => l.itemIds));
  assert.strictEqual(vistos.size, 5000, "nenhum item repetido nem pulado entre lotes");
});

cenario("6. lotes nunca rodam em paralelo — o próximo só começa quando o anterior terminou", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  let emVoo = 0;
  let pico = 0;
  await processMarginSnapshotRun(run, depsRun(db, {
    ids: idsDe(100),
    enrichBatch: async (_p, { itemIds }) => {
      emVoo += 1;
      pico = Math.max(pico, emVoo);
      await new Promise((r) => setImmediate(r));
      emVoo -= 1;
      return { totalItensMl: itemIds.length, itens: itemIds.map((id) => itemComEvidencias({ itemId: id })) };
    },
  }));
  assert.strictEqual(pico, 1, "no máximo 1 lote em voo por run");
});

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTÊNCIA
// ═══════════════════════════════════════════════════════════════════════════

cenario("7. snapshot projetado é persistido com os campos do núcleo, copiados (nunca recalculados)", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const item = itemComEvidencias({ itemId: "MLB111" });

  await processMarginSnapshotRun(run, depsRun(db, {
    ids: ["MLB111"],
    enrichBatch: fakeEnrichBatch({ gerarItem: () => item }),
  }));

  const linha = await snapshot(db, "MLB111");
  assert.ok(linha, "snapshot deveria ter sido persistido");
  assert.strictEqual(linha.profit, item.margin.projected.profit);
  assert.strictEqual(linha.margin, item.margin.projected.margin);
  assert.strictEqual(linha.marginPercent, item.margin.projected.marginPercent);
  assert.strictEqual(linha.status, item.quality.status);
  assert.strictEqual(linha.confidenceLevel, item.quality.confidence);
  assert.strictEqual(linha.price, 100);
  assert.strictEqual(linha.cost, 40);
  assert.strictEqual(linha.commissionRate, 0.12);
  assert.strictEqual(linha.refreshStatus, "fresh");
  assert.strictEqual(linha.runId, run.id);
  assert.ok(linha.quality.evidencias.price, "evidências projetadas persistidas para a leitura reconstruir o contrato");
  assert.strictEqual(linha.quality.evidencias.price[0].source, "MELI_API");
});

cenario("8. margem REALIZADA nunca é persistida no snapshot projetado", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const bag = C.createEvidenceBag();
  const proj = (source, quality) => ({ source, kind: C.EVIDENCE_KINDS.PROJECTED, quality, observedAt: NOW });
  bag.add(C.FIELDS.COST, { ...proj(C.SOURCES.VENFORCE_BASE, C.EVIDENCE_QUALITY.DECLARED), value: 40 });
  bag.add(C.FIELDS.TAX_RATE, { ...proj(C.SOURCES.VENFORCE_BASE, C.EVIDENCE_QUALITY.DECLARED), value: 0.1 });
  bag.add(C.FIELDS.FIXED_FEE, { ...proj(C.SOURCES.VENFORCE_BASE, C.EVIDENCE_QUALITY.DECLARED), value: 0 });
  bag.add(C.FIELDS.PRICE, { ...proj(C.SOURCES.MELI_API, C.EVIDENCE_QUALITY.MEASURED), value: 100 });
  bag.add(C.FIELDS.COMMISSION, { ...proj(C.SOURCES.MELI_API, C.EVIDENCE_QUALITY.MEASURED), value: 12 });
  bag.add(C.FIELDS.FREIGHT, { ...proj(C.SOURCES.MELI_API, C.EVIDENCE_QUALITY.MEASURED), value: 20 });
  bag.add(C.FIELDS.PRICE, { source: C.SOURCES.MELI_ORDER, kind: C.EVIDENCE_KINDS.REALIZED, quality: C.EVIDENCE_QUALITY.MEASURED, observedAt: NOW, value: 55 });
  bag.add(C.FIELDS.COST, { source: C.SOURCES.VENFORCE_BASE, kind: C.EVIDENCE_KINDS.REALIZED, quality: C.EVIDENCE_QUALITY.DECLARED, observedAt: NOW, value: 30 });
  const item = C.buildMarginItem({
    identity: { clienteSlug: "cliente-teste", marketplace: "meli", itemId: "MLB222" },
    bag,
    sales: { hasOrders: true, unidades: 3, pedidos: 2, receita: 165 },
    settlement: { available: false, motivo: "MERCADO_PAGO_NAO_INTEGRADO" },
    now: NOW,
  });
  assert.ok(item.margin.realized.computable, "pré-condição: o item precisa ter margem realizada calculável");

  await processMarginSnapshotRun(run, depsRun(db, {
    ids: ["MLB222"],
    enrichBatch: fakeEnrichBatch({ gerarItem: () => item }),
  }));

  const linha = await snapshot(db, "MLB222");
  assert.strictEqual(linha.price, 100, "price persistido deve ser o PROJETADO (100), nunca o realizado (55)");
  assert.strictEqual(linha.margin, item.margin.projected.margin);
  assert.notStrictEqual(linha.margin, item.margin.realized.margin);
  const kinds = Object.values(linha.quality.evidencias).flat().map((e) => e.source);
  assert.ok(!kinds.includes("MELI_ORDER"), "nenhuma evidência realizada (pedido) persistida");
});

cenario("9. campo ausente na fonte permanece null; zero real permanece zero", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  await processMarginSnapshotRun(run, depsRun(db, {
    ids: ["MLB333", "MLB444"],
    enrichBatch: fakeEnrichBatch({
      gerarItem: (id) => (id === "MLB333" ? itemComEvidencias({ itemId: id, cost: null }) : itemComEvidencias({ itemId: id, fixedFee: 0 })),
    }),
  }));

  assert.strictEqual((await snapshot(db, "MLB333")).cost, null, "custo ausente persiste como null, nunca 0");
  assert.strictEqual((await snapshot(db, "MLB444")).fixedFee, 0, "taxa fixa 0 real persiste como 0, nunca null");
});

cenario("10. reprocessar o mesmo item é idempotente (UPSERT, nunca duplica linha)", async () => {
  const db = makeMarginSnapshotFakeDb();
  const runA = await criarRunRunning(db);
  await processMarginSnapshotRun(runA, depsRun(db, {
    ids: ["MLB555"],
    enrichBatch: fakeEnrichBatch({ gerarItem: (id) => itemComEvidencias({ itemId: id, price: 100 }) }),
  }));
  await runRepository.updateRunStatus({ runId: runA.id, status: "completed", db });

  const runB = await criarRunRunning(db);
  await processMarginSnapshotRun(runB, depsRun(db, {
    ids: ["MLB555"],
    enrichBatch: fakeEnrichBatch({ gerarItem: (id) => itemComEvidencias({ itemId: id, price: 120 }) }),
  }));

  assert.strictEqual(db.snapshots.length, 1, "continua existindo SÓ 1 linha para o mesmo cliente+conta+marketplace+item");
  const linha = await snapshot(db, "MLB555");
  assert.strictEqual(linha.price, 120, "a linha reflete o run mais recente (UPDATE, não um segundo INSERT)");
  assert.strictEqual(linha.runId, runB.id);
});

cenario("11. isolamento: run da conta 5 nunca escreve nem marca linha da conta 6", async () => {
  const db = makeMarginSnapshotFakeDb();

  const run6 = await criarRunRunning(db, { clienteContaId: 6 });
  await processMarginSnapshotRun(run6, depsRun(db, {
    ids: ["MLB999", "MLB-SO-6"],
    enrichBatch: fakeEnrichBatch({ gerarItem: (id) => itemComEvidencias({ itemId: id, price: 200 }) }),
  }));
  await runRepository.updateRunStatus({ runId: run6.id, status: "completed", db });

  // Conta 5: mesmo MLB999, catálogo SEM "MLB-SO-6" e com um lote que falha.
  const run5 = await criarRunRunning(db, { clienteContaId: 5 });
  await processMarginSnapshotRun(run5, depsRun(db, {
    ids: ["MLB999"],
    enrichBatch: fakeEnrichBatch({ gerarItem: (id) => itemComEvidencias({ itemId: id, price: 100 }) }),
  }));

  assert.strictEqual(db.snapshots.length, 3, "conta 5 e conta 6 têm linhas distintas para o mesmo item_id");
  assert.strictEqual((await snapshot(db, "MLB999", 5)).price, 100);
  const linha6 = await snapshot(db, "MLB999", 6);
  assert.strictEqual(linha6.price, 200, "conta 6 intocada pelo run da conta 5");
  assert.strictEqual(linha6.runId, run6.id);
  const so6 = await snapshot(db, "MLB-SO-6", 6);
  assert.strictEqual(so6.catalogMissingSince, null, "a listagem da conta 5 nunca marca item da conta 6 como fora do catálogo");
  assert.ok(db.snapshots.every((r) => (r.run_id === run5.id ? r.cliente_conta_id === 5 : true)), "run 5 só grava linhas da conta 5");
});

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESSO / HEARTBEAT
// ═══════════════════════════════════════════════════════════════════════════

cenario("12. progresso (processed/success/failed/cursor/total) e heartbeat avançam a cada lote", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const progresso = [];
  await processMarginSnapshotRun(run, depsRun(db, {
    ids: idsDe(45),
    updateRunProgress: async (args) => {
      progresso.push({ processed: args.processedItems, cursor: args.cursorOffset, total: args.totalItems });
      return runRepository.updateRunProgress(args);
    },
  }));

  assert.deepStrictEqual(progresso, [
    { processed: 0, cursor: 0, total: 45 },   // total do catálogo registrado antes do 1º lote
    { processed: 20, cursor: 20, total: 45 },
    { processed: 40, cursor: 40, total: 45 },
    { processed: 45, cursor: 45, total: 45 },
  ]);
  const runFinal = await runRepository.getRunById({ runId: run.id, clienteContaId: 5, db });
  assert.strictEqual(runFinal.processedItems, 45);
  assert.strictEqual(runFinal.successItems, 45);
  assert.strictEqual(runFinal.failedItems, 0);
  assert.strictEqual(runFinal.totalItems, 45);
  assert.ok(runFinal.heartbeatAt, "heartbeat_at renovado pelo mesmo UPDATE de progresso");
  assert.strictEqual(runFinal.metadata.processor.catalogo.total, 45);
});

cenario("13. cursor só avança depois de todos os itens do lote serem persistidos", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const ordem = [];
  await processMarginSnapshotRun(run, depsRun(db, {
    ids: idsDe(3, 4000),
    upsertProjectionSnapshot: async (dados, dbArg) => {
      ordem.push(`upsert:${dados.itemId}`);
      return snapshotRepository.upsertProjectionSnapshot(dados, dbArg);
    },
    updateRunProgress: async (args) => {
      ordem.push(`progresso:cursor=${args.cursorOffset}`);
      return runRepository.updateRunProgress(args);
    },
  }));

  assert.deepStrictEqual(ordem, [
    "progresso:cursor=0",
    "upsert:MLB4000", "upsert:MLB4001", "upsert:MLB4002",
    "progresso:cursor=3",
  ]);
});

cenario("14. pacing: inícios de chamada ao ML espaçados pelo limiter (listagem + 3 lotes = 3 esperas de 250ms)", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const sleeps = [];
  await processMarginSnapshotRun(run, depsRun(db, { ids: idsDe(50), sleeps, config: { batchPauseMs: 250 } }));
  assert.deepStrictEqual(sleeps, [250, 250, 250], "listagem sai na hora; cada lote espera o intervalo mínimo");
});

cenario("14b. 429 com Retry-After penaliza o limiter do PROCESSO: o lote de OUTRA conta espera o mesmo tempo", async () => {
  const db = makeMarginSnapshotFakeDb();
  const relogio = { t: 0 };
  const esperasB = [];
  const limiter = createRateLimiter({ minIntervalMs: 0, now: () => relogio.t, sleep: async (ms) => { relogio.t += ms; } });

  // Run A (conta 5): 1º lote recebe 429 + Retry-After 30s → penaliza o limiter.
  const runA = await criarRunRunning(db, { clienteContaId: 5 });
  let penalizou = 0;
  const limiterEspiao = { ...limiter, penalizar: (ms) => { penalizou = ms; /* congela: B vai consumir */ } };
  await processMarginSnapshotRun(runA, depsRun(db, {
    ids: idsDe(5),
    rateLimiter: limiterEspiao,
    enrichBatch: fakeEnrichBatch({ falhar: ({ chamada }) => (chamada === 1 ? erroMl({ mlStatus: 429, retryAfter: 30 }) : null) }),
  }));
  assert.strictEqual(penalizou, 30000, "o 429 da conta 5 vira cooldown do processo pelo tempo do Retry-After");

  // Run B (conta 6) começa com o limiter do processo penalizado por A.
  limiter.penalizar(penalizou);
  const runB = await criarRunRunning(db, { clienteContaId: 6 });
  await processMarginSnapshotRun(runB, depsRun(db, {
    ids: idsDe(5, 7000),
    rateLimiter: { ...limiter, aguardarVez: async (signal) => { const espera = await limiter.aguardarVez(signal); esperasB.push(espera); return espera; } },
  }));
  assert.strictEqual(esperasB[0], 30000, "a 1ª chamada ao ML da conta 6 espera o cooldown inteiro");
  assert.ok(esperasB.slice(1).every((ms) => ms === 0), "depois do cooldown, segue sem espera extra");
});

// ═══════════════════════════════════════════════════════════════════════════
// RETRY POR LOTE
// ═══════════════════════════════════════════════════════════════════════════

cenario("15. retry recuperável (502) re-tenta o lote com backoff e NÃO duplica snapshot", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const sleeps = [];
  const chamadas = [];
  const resultado = await processMarginSnapshotRun(run, depsRun(db, {
    ids: idsDe(40),
    sleeps,
    enrichBatch: fakeEnrichBatch({
      chamadas,
      // 2ª chamada (1ª tentativa do lote 2) falha; a re-tentativa passa.
      falhar: ({ chamada }) => (chamada === 2 ? erroMl({ statusCode: 502 }) : null),
    }),
  }));

  assert.strictEqual(chamadas.length, 3, "lote 1 (1x) + lote 2 (2x)");
  assert.deepStrictEqual(chamadas[1].itemIds, chamadas[2].itemIds, "a re-tentativa é do MESMO lote");
  assert.deepStrictEqual(sleeps, [1000], "backoff base na 1ª re-tentativa");
  assert.strictEqual(resultado.successItems, 40);
  assert.strictEqual(resultado.failedItems, 0);
  assert.strictEqual(db.snapshots.length, 40, "nenhuma linha duplicada pelo retry");
  const runFinal = await runRepository.getRunById({ runId: run.id, clienteContaId: 5, db });
  assert.strictEqual(runFinal.metadata.processor.retries, 1);
});

cenario("16. 429 com Retry-After: espera exatamente o tempo pedido pelo ML (não o backoff)", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const sleeps = [];
  await processMarginSnapshotRun(run, depsRun(db, {
    ids: idsDe(5),
    sleeps,
    enrichBatch: fakeEnrichBatch({
      falhar: ({ chamada }) => (chamada === 1 ? erroMl({ statusCode: 502, mlStatus: 429, retryAfter: 7 }) : null),
    }),
  }));
  assert.deepStrictEqual(sleeps, [7000]);
  const runFinal = await runRepository.getRunById({ runId: run.id, clienteContaId: 5, db });
  assert.strictEqual(runFinal.metadata.processor.rateLimitedRetries, 1);
});

cenario("17. backoff exponencial com teto: 3 falhas seguidas do mesmo lote → 1000, 2000 (e desiste na 3ª)", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const sleeps = [];
  const resultado = await processMarginSnapshotRun(run, depsRun(db, {
    ids: idsDe(40),
    sleeps,
    enrichBatch: fakeEnrichBatch({
      falhar: ({ itemIds }) => (itemIds[0] === "MLB1000" ? erroMl({ statusCode: 502 }) : null),
    }),
  }));
  assert.deepStrictEqual(sleeps, [1000, 2000], "máx. 3 tentativas: 2 esperas, nunca loop infinito");
  assert.strictEqual(resultado.failedItems, 20);
  assert.strictEqual(resultado.successItems, 20);
});

cenario("18. erro não recuperável (422 = auth/permissão) não é re-tentado", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const sleeps = [];
  const chamadas = [];
  const resultado = await processMarginSnapshotRun(run, depsRun(db, {
    ids: idsDe(40),
    sleeps,
    enrichBatch: fakeEnrichBatch({
      chamadas,
      falhar: ({ itemIds }) => (itemIds[0] === "MLB1000" ? erroMl({ statusCode: 422 }) : null),
    }),
  }));
  assert.strictEqual(chamadas.length, 2, "1 tentativa por lote");
  assert.deepStrictEqual(sleeps, []);
  assert.strictEqual(resultado.failedItems, 20);
});

cenario("19. Retry-After maior que o teto configurado: lote é dado como falho sem segurar o run", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const sleeps = [];
  const resultado = await processMarginSnapshotRun(run, depsRun(db, {
    ids: idsDe(40),
    sleeps,
    config: { retryAfterMaxMs: 5000 },
    enrichBatch: fakeEnrichBatch({
      falhar: ({ itemIds }) => (itemIds[0] === "MLB1000" ? erroMl({ mlStatus: 429, retryAfter: 600 }) : null),
    }),
  }));
  assert.ok(sleeps.every((ms) => ms <= 5000), "nunca dorme 600s dentro do worker");
  assert.strictEqual(resultado.failedItems, 20);
});

// ═══════════════════════════════════════════════════════════════════════════
// FALHA PARCIAL / FALHA FINAL DE LOTE
// ═══════════════════════════════════════════════════════════════════════════

cenario("20. falha FINAL de lote: registrada, snapshots anteriores preservados (failed + erro), itens novos sem linha falsa", async () => {
  const db = makeMarginSnapshotFakeDb();
  // Run A: catálogo com MLB1000..MLB1019 (lote 1) e MLB1020..MLB1029 (lote 2).
  const runA = await criarRunRunning(db);
  await processMarginSnapshotRun(runA, depsRun(db, {
    ids: idsDe(30),
    enrichBatch: fakeEnrichBatch({ gerarItem: (id) => itemComEvidencias({ itemId: id, price: 100 }) }),
  }));
  await runRepository.updateRunStatus({ runId: runA.id, status: "completed", db });

  // Run B: lote 2 falha em todas as tentativas; ele contém 10 itens antigos
  // e 5 itens NOVOS (nunca tiveram snapshot).
  const idsB = [...idsDe(30), ...idsDe(5, 9000)];
  const runB = await criarRunRunning(db);
  const resultado = await processMarginSnapshotRun(runB, depsRun(db, {
    ids: idsB,
    enrichBatch: fakeEnrichBatch({
      gerarItem: (id) => itemComEvidencias({ itemId: id, price: 150 }),
      falhar: ({ itemIds }) => (itemIds.includes("MLB1020") ? erroMl({ statusCode: 502, message: "ML indisponível" }) : null),
    }),
  }));

  assert.strictEqual(resultado.successItems, 20);
  assert.strictEqual(resultado.failedItems, 15, "o lote inteiro (10 antigos + 5 novos) conta como falho");

  const bom = await snapshot(db, "MLB1000");
  assert.strictEqual(bom.price, 150, "lote bom foi atualizado");
  assert.strictEqual(bom.refreshStatus, "fresh");

  const antigo = await snapshot(db, "MLB1025");
  assert.strictEqual(antigo.price, 100, "valor financeiro anterior preservado — nunca zerado");
  assert.strictEqual(antigo.refreshStatus, "failed");
  assert.ok(/ML indisponível/.test(antigo.lastError), "erro auditável na linha");
  assert.strictEqual(antigo.runId, runB.id);

  assert.strictEqual(await snapshot(db, "MLB9000"), null, "item novo que falhou não ganha linha financeira falsa");

  const runFinal = await runRepository.getRunById({ runId: runB.id, clienteContaId: 5, db });
  assert.strictEqual(runFinal.failedItems, 15);
  assert.strictEqual(runFinal.metadata.processor.lotesFalhos, 1);
});

cenario("21. circuit breaker: N lotes seguidos falhando = falha estrutural do run (erro tipado, progresso salvo)", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  await assert.rejects(
    () => processMarginSnapshotRun(run, depsRun(db, {
      ids: idsDe(100),
      config: { maxConsecutiveBatchFailures: 2, batchMaxAttempts: 1 },
      enrichBatch: fakeEnrichBatch({ falhar: ({ itemIds }) => (itemIds[0] !== "MLB1000" ? erroMl() : null) }),
    })),
    (err) => err.code === "MARGIN_SNAPSHOT_LOTES_FALHANDO"
  );
  const runFinal = await runRepository.getRunById({ runId: run.id, clienteContaId: 5, db });
  assert.strictEqual(runFinal.processedItems, 60, "lote 1 ok + 2 lotes falhos registrados antes de interromper");
  assert.strictEqual(runFinal.successItems, 20);
  assert.strictEqual(runFinal.failedItems, 40);
});

cenario("22. nenhum item calculado num catálogo não vazio → erro (run nunca 'completed' fingindo sucesso)", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  await assert.rejects(
    () => processMarginSnapshotRun(run, depsRun(db, {
      ids: idsDe(5),
      config: { batchMaxAttempts: 1 },
      enrichBatch: fakeEnrichBatch({ falhar: () => erroMl() }),
    })),
    (err) => err.code === "MARGIN_SNAPSHOT_NENHUM_ITEM_CALCULADO"
  );
});

cenario("23. falha da LISTAGEM do catálogo: re-tenta e, esgotado, falha o run sem gravar nada", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  let tentativas = 0;
  const chamadasLote = [];
  await assert.rejects(
    () => processMarginSnapshotRun(run, depsRun(db, {
      listarIdsCatalogo: async () => { tentativas += 1; throw erroMl({ statusCode: 502 }); },
      enrichBatch: fakeEnrichBatch({ chamadas: chamadasLote }),
    })),
    /Falha ao listar o catálogo após 3 tentativa/
  );
  assert.strictEqual(tentativas, 3);
  assert.strictEqual(chamadasLote.length, 0);
  assert.strictEqual(db.snapshots.length, 0);
});

cenario("24. item listado mas não retornado pelo detalhe do ML conta como falha e marca a linha antiga", async () => {
  const db = makeMarginSnapshotFakeDb();
  const runA = await criarRunRunning(db);
  await processMarginSnapshotRun(runA, depsRun(db, { ids: ["MLB1", "MLB2"] }));
  await runRepository.updateRunStatus({ runId: runA.id, status: "completed", db });

  const runB = await criarRunRunning(db);
  const resultado = await processMarginSnapshotRun(runB, depsRun(db, {
    ids: ["MLB1", "MLB2"],
    enrichBatch: fakeEnrichBatch({ gerarItem: (id) => (id === "MLB2" ? null : itemComEvidencias({ itemId: id })) }),
  }));
  assert.strictEqual(resultado.successItems, 1);
  assert.strictEqual(resultado.failedItems, 1);
  const linha = await snapshot(db, "MLB2");
  assert.strictEqual(linha.refreshStatus, "failed");
  assert.strictEqual(linha.price, 100, "valores anteriores preservados");
});

cenario("25. falha técnica ao persistir 1 item não apaga o snapshot anterior daquele item", async () => {
  const db = makeMarginSnapshotFakeDb();
  const runA = await criarRunRunning(db);
  await processMarginSnapshotRun(runA, depsRun(db, {
    ids: ["MLB777", "MLB778"],
    enrichBatch: fakeEnrichBatch({ gerarItem: (id) => itemComEvidencias({ itemId: id, price: 100 }) }),
  }));
  await runRepository.updateRunStatus({ runId: runA.id, status: "completed", db });

  const runB = await criarRunRunning(db);
  const resultado = await processMarginSnapshotRun(runB, depsRun(db, {
    ids: ["MLB777", "MLB778"],
    enrichBatch: fakeEnrichBatch({ gerarItem: (id) => itemComEvidencias({ itemId: id, price: 999 }) }),
    upsertProjectionSnapshot: async (dados, dbArg) => {
      if (dados.itemId === "MLB777") throw new Error("falha técnica simulada (ex.: conexão perdida)");
      return snapshotRepository.upsertProjectionSnapshot(dados, dbArg);
    },
  }));

  assert.strictEqual(resultado.failedItems, 1);
  assert.strictEqual(resultado.successItems, 1);
  assert.strictEqual((await snapshot(db, "MLB777")).price, 100, "snapshot anterior sobrevive intocado");
  assert.strictEqual((await snapshot(db, "MLB778")).price, 999);
});

cenario("26. item UNVALIDATED (sem exceção) é persistido normalmente — não é erro técnico", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const resultado = await processMarginSnapshotRun(run, depsRun(db, {
    ids: ["MLB666"],
    enrichBatch: fakeEnrichBatch({ gerarItem: (id) => itemComEvidencias({ itemId: id, cost: null }) }),
  }));
  assert.strictEqual(resultado.successItems, 1);
  assert.strictEqual(resultado.failedItems, 0);
  assert.strictEqual((await snapshot(db, "MLB666")).status, "UNVALIDATED");
});

// ═══════════════════════════════════════════════════════════════════════════
// CATÁLOGO: itens que saíram
// ═══════════════════════════════════════════════════════════════════════════

cenario("27. item que saiu do catálogo é marcado (nunca apagado) e volta ao normal se reaparecer", async () => {
  const db = makeMarginSnapshotFakeDb();
  const runA = await criarRunRunning(db);
  await processMarginSnapshotRun(runA, depsRun(db, { ids: ["MLB-A", "MLB-B"] }));
  await runRepository.updateRunStatus({ runId: runA.id, status: "completed", db });

  const runB = await criarRunRunning(db);
  await processMarginSnapshotRun(runB, depsRun(db, { ids: ["MLB-A"] }));
  await runRepository.updateRunStatus({ runId: runB.id, status: "completed", db });

  const saiu = await snapshot(db, "MLB-B");
  assert.ok(saiu, "linha NÃO é apagada");
  assert.ok(saiu.catalogMissingSince, "marcada como fora do catálogo");
  assert.strictEqual(saiu.refreshStatus, "stale");
  assert.strictEqual(saiu.price, 100, "valores preservados");

  const runC = await criarRunRunning(db);
  await processMarginSnapshotRun(runC, depsRun(db, { ids: ["MLB-A", "MLB-B"] }));
  const voltou = await snapshot(db, "MLB-B");
  assert.strictEqual(voltou.catalogMissingSince, null, "UPSERT limpa a marca quando o item reaparece");
  assert.strictEqual(voltou.refreshStatus, "fresh");
});

cenario("28. catálogo vazio encerra de forma segura (sem loop infinito, sem erro)", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const resultado = await processMarginSnapshotRun(run, depsRun(db, { ids: [] }));
  assert.strictEqual(resultado.processedItems, 0);
  assert.strictEqual(resultado.successItems, 0);
  assert.strictEqual(resultado.failedItems, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// RUN PERDIDO / PARADA
// ═══════════════════════════════════════════════════════════════════════════

cenario("29. run que deixou de estar running (reconciliado) para de escrever imediatamente", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const chamadasLote = [];
  let progresso = 0;
  await assert.rejects(
    () => processMarginSnapshotRun(run, depsRun(db, {
      ids: idsDe(60),
      enrichBatch: fakeEnrichBatch({ chamadas: chamadasLote }),
      updateRunProgress: async (args) => {
        progresso += 1;
        if (progresso === 2) {
          // Outra instância marcou o run como failed por heartbeat antigo.
          const row = db.runs.find((r) => r.id === run.id);
          row.status = "failed";
        }
        return runRepository.updateRunProgress(args);
      },
    })),
    (err) => err.code === "MARGIN_SNAPSHOT_RUN_NAO_ESTA_MAIS_RUNNING"
  );
  assert.strictEqual(chamadasLote.length, 1, "nenhum lote novo depois de perder o run");
});

cenario("30. parada do worker (abort) interrompe entre lotes com erro tipado", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const controller = new AbortController();
  const chamadasLote = [];
  await assert.rejects(
    () => processMarginSnapshotRun(run, depsRun(db, {
      ids: idsDe(60),
      signal: controller.signal,
      enrichBatch: async (_p, { itemIds }) => {
        chamadasLote.push(itemIds);
        controller.abort();
        return { totalItensMl: itemIds.length, itens: itemIds.map((id) => itemComEvidencias({ itemId: id })) };
      },
    })),
    (err) => err instanceof MarginSnapshotStopError && err.code === "MARGIN_SNAPSHOT_WORKER_STOPPED"
  );
  assert.strictEqual(chamadasLote.length, 1);
  assert.strictEqual(db.snapshots.length, 20, "o lote concluído antes da parada fica gravado");
});

// ═══════════════════════════════════════════════════════════════════════════
// GOLDEN: mesmo resultado do Motor existente, sem fórmula paralela
// ═══════════════════════════════════════════════════════════════════════════

async function rodarGolden({ comVendasNoMotorAoVivo }) {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db, { clienteContaId: 5 });
  const motor = fixture.motorDeps({ comVendas: true });

  // Snapshot: Motor REAL (prepareWorkspaceContext + enrichBatch reais) com
  // adapters fake. As deps de vendas do fixture (com pedidos) são
  // sobrescritas pelo processor — é exatamente o que se quer provar.
  await processMarginSnapshotRun(run, {
    ...motor,
    db,
    logger: SILENCIOSO,
    config: configTeste(),
    sleep: async () => {},
    listarIdsCatalogo: async () => ({ ids: Object.keys(fixture.ANUNCIOS), totalAtivos: 3, totalPausados: 0 }),
  });

  // Leitura AO VIVO da tela (obterWorkspace), mesmo Motor, mesmas fontes.
  const aoVivo = await motorMargem.obterWorkspace(
    { clienteSlug: "cliente-teste" },
    fixture.motorDeps({ comVendas: comVendasNoMotorAoVivo })
  );
  return { db, aoVivo };
}

cenario("31. GOLDEN: sem vendas, snapshot == leitura ao vivo do Motor (valores, margem, status, confiança)", async () => {
  const { db, aoVivo } = await rodarGolden({ comVendasNoMotorAoVivo: false });
  assert.strictEqual(aoVivo.itens.length, 3);
  for (const item of aoVivo.itens) {
    const linha = await snapshot(db, item.identity.itemId);
    assert.ok(linha, `snapshot de ${item.identity.itemId} existe`);
    assert.strictEqual(linha.profit, item.margin.projected.profit, `${item.identity.itemId}: lucro`);
    assert.strictEqual(linha.margin, item.margin.projected.margin, `${item.identity.itemId}: margem`);
    assert.strictEqual(linha.marginPercent, item.margin.projected.marginPercent, `${item.identity.itemId}: margem %`);
    assert.strictEqual(linha.status, item.quality.status, `${item.identity.itemId}: status`);
    assert.strictEqual(linha.confidenceLevel, item.quality.confidence, `${item.identity.itemId}: confiança`);
    assert.strictEqual(linha.price, item.fields.price.projected.value);
    assert.strictEqual(linha.cost, item.fields.cost.projected ? item.fields.cost.projected.value : null);
    assert.strictEqual(linha.imageUrl, item.identity.image);
  }
});

cenario("32. GOLDEN: com vendas no período, a margem PROJETADA continua idêntica à do Motor ao vivo", async () => {
  const { db, aoVivo } = await rodarGolden({ comVendasNoMotorAoVivo: true });
  for (const item of aoVivo.itens) {
    const linha = await snapshot(db, item.identity.itemId);
    assert.strictEqual(linha.profit, item.margin.projected.profit, `${item.identity.itemId}: lucro projetado`);
    assert.strictEqual(linha.margin, item.margin.projected.margin, `${item.identity.itemId}: margem projetada`);
  }
  // MLB1 vendeu: ao vivo o status é o da margem EXIBIDA (realizada, RECONCILING);
  // o snapshot guarda o status da PROJETADA — o realizado é combinado na leitura.
  const mlb1 = aoVivo.itens.find((i) => i.identity.itemId === "MLB1");
  assert.strictEqual(mlb1.quality.status, "RECONCILING");
  assert.strictEqual((await snapshot(db, "MLB1")).status, "HEALTHY");
});

// ═══════════════════════════════════════════════════════════════════════════
// VALIDAÇÕES DE ENTRADA
// ═══════════════════════════════════════════════════════════════════════════

cenario("33. erro estrutural de contexto (prepareWorkspaceContext lança) falha o processor inteiro", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const chamadasLote = [];
  await assert.rejects(
    () => processMarginSnapshotRun(run, depsRun(db, {
      prepareWorkspaceContext: async () => { throw new Error("GRANT_ML_NAO_CONECTADO"); },
      enrichBatch: fakeEnrichBatch({ chamadas: chamadasLote }),
    })),
    /GRANT_ML_NAO_CONECTADO/
  );
  assert.strictEqual(chamadasLote.length, 0);
});

cenario("34. marketplace não suportado falha tipada, antes de resolver contexto", async () => {
  let chamadasContexto = 0;
  await assert.rejects(
    () => processMarginSnapshotRun({ id: 1, clienteId: 1, clienteContaId: 5, marketplace: "shopee" }, {
      prepareWorkspaceContext: async () => { chamadasContexto += 1; return criarPreparedFake(); },
    }),
    (err) => err instanceof MarginSnapshotMarketplaceNaoSuportadoError && err.code === "MARGIN_SNAPSHOT_MARKETPLACE_NAO_SUPORTADO"
  );
  assert.strictEqual(chamadasContexto, 0);
});

cenario("35. clienteContaId ausente no run nunca é auto-resolvido — falha explícita", async () => {
  await assert.rejects(() => processMarginSnapshotRun({ id: 1, clienteId: 1, clienteContaId: null, marketplace: "meli" }, {}), /clienteContaId/);
});

// ── Runner ───────────────────────────────────────────────────────────────

async function main() {
  let falhas = 0;
  for (const caso of casos) {
    try {
      await caso.fn();
      console.log(`  ✓ ${caso.nome}`);
    } catch (err) {
      falhas += 1;
      console.error(`  ✗ ${caso.nome}\n    ${err.stack || err.message}`);
    }
  }
  if (falhas > 0) {
    console.error(`marginSnapshotProcessor: ${falhas} de ${casos.length} cenários falharam`);
    process.exitCode = 1;
  } else {
    console.log(`marginSnapshotProcessor: ok (${casos.length} cenários)`);
  }
}

main();
