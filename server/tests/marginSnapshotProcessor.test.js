// server/tests/marginSnapshotProcessor.test.js
// Margin Snapshot — M3: processor real testado com deps fake/injetadas.
//
// NENHUMA chamada real ao Mercado Livre ou ao Postgres acontece neste
// arquivo: prepareWorkspaceContext/enrichBatch são sempre substituídos por
// fakes, e os testes de persistência usam o mesmo fake db em memória de
// M1/M2 (tests/helpers/marginSnapshotFakeDb.js) por baixo do repository
// REAL — nunca `pool` de verdade.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const C = require("../services/motorMargem/core");
const {
  processMarginSnapshotRun,
  MarginSnapshotMarketplaceNaoSuportadoError,
  BATCH_SIZE,
} = require("../services/motorMargem/marginSnapshotProcessor");
const snapshotRepository = require("../services/motorMargem/marginSnapshotRepository");
const runRepository = require("../services/motorMargem/marginSnapshotRunRepository");
const { makeMarginSnapshotFakeDb } = require("./helpers/marginSnapshotFakeDb");

const NOW = new Date("2026-09-25T12:00:00.000Z");

// ── Helpers ──────────────────────────────────────────────────────────────────

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

let nextRunId = 1;
function criarRunFake(overrides = {}) {
  return {
    id: nextRunId++,
    clienteId: 1,
    clienteSlug: "cliente-teste",
    clienteContaId: 5,
    marketplace: "meli",
    baseId: null,
    reason: "manual_refresh",
    status: "running",
    totalItems: null,
    processedItems: 0,
    successItems: 0,
    failedItems: 0,
    cursorOffset: 0,
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
  return async (params) => {
    chamadas.push(params);
    return prepared;
  };
}

function fakeEnrichBatch({ total, gerarItem, chamadas = [] }) {
  return async (_prepared, { offset, limit }) => {
    chamadas.push({ offset, limit });
    const fim = Math.min(offset + limit, total);
    const itens = [];
    for (let i = offset; i < fim; i++) itens.push(gerarItem(i));
    return { totalItensMl: total, itens };
  };
}

// Item REAL do núcleo (buildMarginItem/createEvidenceBag) — nunca um objeto
// à mão que possa divergir do contrato real do Motor. `null` num campo omite
// a evidência (ausente, inclusive p/ testar null vs zero); qualquer outro
// valor (incluindo 0) registra a evidência real. Não usar `undefined` para
// "omitir": um parâmetro com valor default resolveria `undefined` para o
// default ANTES desta função ver o valor.
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

// Cria um run REAL (não fake) no fake db de M1/M2, já em `running` — mesma
// transição que o worker faz via claim. Necessário para os testes que
// verificam persistência/progresso/heartbeat de verdade.
async function criarRunRunning(db, overrides = {}) {
  const run = await runRepository.createRun({
    clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: 5, marketplace: "meli",
    reason: "manual_refresh", db,
    ...overrides,
  });
  return runRepository.updateRunStatus({ runId: run.id, status: "running", db });
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXTO
// ═══════════════════════════════════════════════════════════════════════════

cenario("1. passa clienteContaId (e clienteSlug) do run ao Motor", async () => {
  const chamadas = [];
  const run = criarRunFake({ clienteContaId: 42, clienteSlug: "cliente-x" });
  const deps = {
    db: {},
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake(), chamadas),
    enrichBatch: fakeEnrichBatch({ total: 0, gerarItem: () => null }),
    updateRunProgress: async () => {},
  };

  await processMarginSnapshotRun(run, deps);

  assert.strictEqual(chamadas.length, 1);
  assert.strictEqual(chamadas[0].clienteContaId, 42);
  assert.strictEqual(chamadas[0].clienteSlug, "cliente-x");
});

cenario("2. resolve contexto uma vez por run, mesmo com vários lotes", async () => {
  const chamadasContexto = [];
  const run = criarRunFake();
  const deps = {
    db: {},
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake(), chamadasContexto),
    enrichBatch: fakeEnrichBatch({
      total: 21,
      gerarItem: (i) => itemComEvidencias({ itemId: `MLB${1000 + i}` }),
    }),
    upsertProjectionSnapshot: async () => {},
    updateRunProgress: async () => {},
  };

  await processMarginSnapshotRun(run, deps);

  assert.strictEqual(chamadasContexto.length, 1, "prepareWorkspaceContext deve ser chamado exatamente 1x por run");
});

// ═══════════════════════════════════════════════════════════════════════════
// LOTES
// ═══════════════════════════════════════════════════════════════════════════

async function rodarComNItens(total) {
  const chamadasLote = [];
  const run = criarRunFake();
  const deps = {
    db: {},
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake()),
    enrichBatch: fakeEnrichBatch({
      total,
      gerarItem: (i) => itemComEvidencias({ itemId: `MLB${1000 + i}` }),
      chamadas: chamadasLote,
    }),
    upsertProjectionSnapshot: async () => {},
    updateRunProgress: async () => {},
  };

  const resultado = await processMarginSnapshotRun(run, deps);
  return { resultado, lotes: chamadasLote.length };
}

cenario("3. 1 item → 1 lote", async () => {
  const { resultado, lotes } = await rodarComNItens(1);
  assert.strictEqual(lotes, 1);
  assert.strictEqual(resultado.processedItems, 1);
});

cenario("4. 20 itens (exatamente 1 lote) → 1 lote", async () => {
  const { resultado, lotes } = await rodarComNItens(BATCH_SIZE);
  assert.strictEqual(lotes, 1);
  assert.strictEqual(resultado.processedItems, BATCH_SIZE);
});

cenario("5. 21 itens → 2 lotes", async () => {
  const { resultado, lotes } = await rodarComNItens(21);
  assert.strictEqual(lotes, 2);
  assert.strictEqual(resultado.processedItems, 21);
});

cenario("6. 200 itens → 10 lotes", async () => {
  const { resultado, lotes } = await rodarComNItens(200);
  assert.strictEqual(lotes, 10);
  assert.strictEqual(resultado.processedItems, 200);
});

cenario("7. 260 itens → 13 lotes", async () => {
  const { resultado, lotes } = await rodarComNItens(260);
  assert.strictEqual(lotes, 13);
  assert.strictEqual(resultado.processedItems, 260);
});

cenario("8. não existe clamp de 200 no processor — 300 itens processa tudo", async () => {
  const { resultado, lotes } = await rodarComNItens(300);
  assert.strictEqual(lotes, 15, "300 itens em lotes de 20 são 15 lotes, sem nenhum teto de 200");
  assert.strictEqual(resultado.processedItems, 300);
  assert.strictEqual(resultado.successItems, 300);
});

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTÊNCIA
// ═══════════════════════════════════════════════════════════════════════════

cenario("9. snapshot projetado é persistido com os campos do núcleo, copiados (nunca recalculados)", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const item = itemComEvidencias({ itemId: "MLB111" });

  await processMarginSnapshotRun(run, {
    db,
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake()),
    enrichBatch: fakeEnrichBatch({ total: 1, gerarItem: () => item }),
  });

  const linha = await snapshotRepository.getProjectionSnapshot({ clienteContaId: 5, itemId: "MLB111", db });
  assert.ok(linha, "snapshot deveria ter sido persistido");
  assert.strictEqual(linha.profit, item.margin.projected.profit);
  assert.strictEqual(linha.margin, item.margin.projected.margin);
  assert.strictEqual(linha.marginPercent, item.margin.projected.marginPercent);
  assert.strictEqual(linha.status, item.quality.status);
  assert.strictEqual(linha.confidenceLevel, item.quality.confidence);
  assert.strictEqual(linha.price, 100);
  assert.strictEqual(linha.cost, 40);
  assert.strictEqual(linha.commissionRate, 0.12);
});

cenario("10. margem REALIZADA nunca é persistida no snapshot projetado", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  // Item com pedido/realizado presente — mesmo assim, só o projetado pode
  // ir para o snapshot.
  const bag = C.createEvidenceBag();
  bag.add(C.FIELDS.COST, { source: C.SOURCES.VENFORCE_BASE, kind: C.EVIDENCE_KINDS.PROJECTED, quality: C.EVIDENCE_QUALITY.DECLARED, observedAt: NOW, value: 40 });
  bag.add(C.FIELDS.TAX_RATE, { source: C.SOURCES.VENFORCE_BASE, kind: C.EVIDENCE_KINDS.PROJECTED, quality: C.EVIDENCE_QUALITY.DECLARED, observedAt: NOW, value: 0.1 });
  bag.add(C.FIELDS.FIXED_FEE, { source: C.SOURCES.VENFORCE_BASE, kind: C.EVIDENCE_KINDS.PROJECTED, quality: C.EVIDENCE_QUALITY.DECLARED, observedAt: NOW, value: 0 });
  bag.add(C.FIELDS.PRICE, { source: C.SOURCES.MELI_API, kind: C.EVIDENCE_KINDS.PROJECTED, quality: C.EVIDENCE_QUALITY.MEASURED, observedAt: NOW, value: 100 });
  bag.add(C.FIELDS.COMMISSION, { source: C.SOURCES.MELI_API, kind: C.EVIDENCE_KINDS.PROJECTED, quality: C.EVIDENCE_QUALITY.MEASURED, observedAt: NOW, value: 12 });
  bag.add(C.FIELDS.FREIGHT, { source: C.SOURCES.MELI_API, kind: C.EVIDENCE_KINDS.PROJECTED, quality: C.EVIDENCE_QUALITY.MEASURED, observedAt: NOW, value: 20 });
  // Evidência REALIZADA (pedido) — bem diferente da projetada, para provar
  // que não vaza para o snapshot se aparecer no valor persistido. PRICE e
  // COST são os únicos campos obrigatórios para `computable` (marginEngine.
  // REQUIRED_FIELDS) — sem um COST realizado a margem realizada nem seria
  // calculável, o que invalidaria a pré-condição deste teste.
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
  assert.notStrictEqual(item.margin.realized.margin, item.margin.projected.margin, "pré-condição: projetada e realizada devem diferir neste teste");

  await processMarginSnapshotRun(run, {
    db,
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake()),
    enrichBatch: fakeEnrichBatch({ total: 1, gerarItem: () => item }),
  });

  const linha = await snapshotRepository.getProjectionSnapshot({ clienteContaId: 5, itemId: "MLB222", db });
  assert.strictEqual(linha.price, 100, "price persistido deve ser o PROJETADO (100), nunca o realizado (55)");
  assert.strictEqual(linha.margin, item.margin.projected.margin);
  assert.notStrictEqual(linha.margin, item.margin.realized.margin);
});

cenario("11. campo ausente na fonte permanece null no snapshot", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const item = itemComEvidencias({ itemId: "MLB333", cost: null }); // sem evidência de custo

  await processMarginSnapshotRun(run, {
    db,
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake()),
    enrichBatch: fakeEnrichBatch({ total: 1, gerarItem: () => item }),
  });

  const linha = await snapshotRepository.getProjectionSnapshot({ clienteContaId: 5, itemId: "MLB333", db });
  assert.strictEqual(linha.cost, null, "custo ausente na fonte deve persistir como null, nunca 0");
});

cenario("12. zero real permanece zero no snapshot (nunca vira null)", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const item = itemComEvidencias({ itemId: "MLB444", fixedFee: 0 }); // taxa fixa 0 é um valor real

  await processMarginSnapshotRun(run, {
    db,
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake()),
    enrichBatch: fakeEnrichBatch({ total: 1, gerarItem: () => item }),
  });

  const linha = await snapshotRepository.getProjectionSnapshot({ clienteContaId: 5, itemId: "MLB444", db });
  assert.strictEqual(linha.fixedFee, 0, "taxa fixa 0 real deve persistir como 0, nunca null");
});

cenario("13. mesma conta+item processado 2x faz UPSERT (nunca duplica linha)", async () => {
  const db = makeMarginSnapshotFakeDb();
  const runA = await criarRunRunning(db);

  await processMarginSnapshotRun(runA, {
    db,
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake()),
    enrichBatch: fakeEnrichBatch({ total: 1, gerarItem: () => itemComEvidencias({ itemId: "MLB555", price: 100 }) }),
  });
  await runRepository.updateRunStatus({ runId: runA.id, status: "completed", db });

  const runB = await criarRunRunning(db);
  await processMarginSnapshotRun(runB, {
    db,
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake()),
    enrichBatch: fakeEnrichBatch({ total: 1, gerarItem: () => itemComEvidencias({ itemId: "MLB555", price: 120 }) }),
  });

  assert.strictEqual(db.snapshots.length, 1, "deve continuar existindo SÓ 1 linha para o mesmo cliente+conta+marketplace+item");
  const linha = await snapshotRepository.getProjectionSnapshot({ clienteContaId: 5, itemId: "MLB555", db });
  assert.strictEqual(linha.price, 120, "a linha deve refletir o run mais recente (UPDATE, não um segundo INSERT)");
  assert.strictEqual(linha.runId, runB.id);
});

cenario("14. conta 5 e conta 6 permanecem independentes para o mesmo item", async () => {
  const db = makeMarginSnapshotFakeDb();

  const run5 = await criarRunRunning(db, { clienteContaId: 5 });
  await processMarginSnapshotRun(run5, {
    db,
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake()),
    enrichBatch: fakeEnrichBatch({ total: 1, gerarItem: () => itemComEvidencias({ itemId: "MLB999", price: 100 }) }),
  });

  const run6 = await criarRunRunning(db, { clienteContaId: 6 });
  await processMarginSnapshotRun(run6, {
    db,
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake()),
    enrichBatch: fakeEnrichBatch({ total: 1, gerarItem: () => itemComEvidencias({ itemId: "MLB999", price: 200 }) }),
  });

  assert.strictEqual(db.snapshots.length, 2, "conta 5 e conta 6 devem gerar 2 linhas distintas para o mesmo item_id");
  const linha5 = await snapshotRepository.getProjectionSnapshot({ clienteContaId: 5, itemId: "MLB999", db });
  const linha6 = await snapshotRepository.getProjectionSnapshot({ clienteContaId: 6, itemId: "MLB999", db });
  assert.strictEqual(linha5.price, 100);
  assert.strictEqual(linha6.price, 200);
});

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESSO
// ═══════════════════════════════════════════════════════════════════════════

cenario("15. progresso (processed/success/failed/cursor/total) atualiza por lote", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);

  await processMarginSnapshotRun(run, {
    db,
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake()),
    enrichBatch: fakeEnrichBatch({
      total: 21,
      gerarItem: (i) => itemComEvidencias({ itemId: `MLB${2000 + i}` }),
    }),
  });

  const runFinal = await runRepository.getRunById({ runId: run.id, clienteContaId: 5, db });
  assert.strictEqual(runFinal.processedItems, 21);
  assert.strictEqual(runFinal.successItems, 21);
  assert.strictEqual(runFinal.failedItems, 0);
  assert.strictEqual(runFinal.totalItems, 21);
  assert.strictEqual(runFinal.cursorOffset, 40, "cursor final = offset do 2º lote (20) + BATCH_SIZE (20)");
});

cenario("16. heartbeat ocorre — heartbeat_at é atualizado a cada lote (via updateRunProgress)", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const heartbeatAposClaim = run.heartbeatAt;
  assert.ok(heartbeatAposClaim, "pré-condição: claim/running já deve ter setado heartbeat_at");

  let chamadasProgresso = 0;
  const updateRunProgressReal = runRepository.updateRunProgress;
  await processMarginSnapshotRun(run, {
    db,
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake()),
    enrichBatch: fakeEnrichBatch({
      total: 21,
      gerarItem: (i) => itemComEvidencias({ itemId: `MLB${3000 + i}` }),
    }),
    updateRunProgress: async (args) => {
      chamadasProgresso += 1;
      return updateRunProgressReal(args);
    },
  });

  assert.strictEqual(chamadasProgresso, 2, "1 atualização de progresso (com heartbeat) por lote — 21 itens = 2 lotes");
  const runFinal = await runRepository.getRunById({ runId: run.id, clienteContaId: 5, db });
  assert.ok(runFinal.heartbeatAt, "heartbeat_at deve continuar preenchido após o processamento");
});

cenario("17. cursor só avança depois de todos os itens do lote serem persistidos", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const ordem = [];

  const upsertReal = snapshotRepository.upsertProjectionSnapshot;
  const updateRunProgressReal = runRepository.updateRunProgress;

  await processMarginSnapshotRun(run, {
    db,
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake()),
    enrichBatch: fakeEnrichBatch({
      total: 3,
      gerarItem: (i) => itemComEvidencias({ itemId: `MLB${4000 + i}` }),
    }),
    upsertProjectionSnapshot: async (dados, dbArg) => {
      ordem.push(`upsert:${dados.itemId}`);
      return upsertReal(dados, dbArg);
    },
    updateRunProgress: async (args) => {
      ordem.push(`progresso:cursor=${args.cursorOffset}`);
      return updateRunProgressReal(args);
    },
  });

  assert.deepStrictEqual(ordem, [
    "upsert:MLB4000", "upsert:MLB4001", "upsert:MLB4002",
    "progresso:cursor=20",
  ], "os 3 upserts do único lote devem acontecer ANTES da atualização de progresso/cursor");
});

// ═══════════════════════════════════════════════════════════════════════════
// FALHAS
// ═══════════════════════════════════════════════════════════════════════════

cenario("18. erro estrutural de contexto (prepareWorkspaceContext lança) falha o processor inteiro", async () => {
  const run = criarRunFake();
  let chamadasEnrich = 0;
  const deps = {
    db: {},
    prepareWorkspaceContext: async () => {
      throw new Error("GRANT_ML_NAO_CONECTADO");
    },
    enrichBatch: async () => { chamadasEnrich += 1; return { totalItensMl: 0, itens: [] }; },
  };

  await assert.rejects(() => processMarginSnapshotRun(run, deps), /GRANT_ML_NAO_CONECTADO/);
  assert.strictEqual(chamadasEnrich, 0, "sem contexto resolvido, enrichBatch nunca deve ser chamado");
});

cenario("19. item UNVALIDATED (sem exceção) é persistido normalmente — não é tratado como erro técnico", async () => {
  const db = makeMarginSnapshotFakeDb();
  const run = await criarRunRunning(db);
  const item = itemComEvidencias({ itemId: "MLB666", cost: null }); // sem custo → não computável
  assert.strictEqual(item.quality.status, "UNVALIDATED", "pré-condição do teste");

  const resultado = await processMarginSnapshotRun(run, {
    db,
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake()),
    enrichBatch: fakeEnrichBatch({ total: 1, gerarItem: () => item }),
  });

  assert.strictEqual(resultado.successItems, 1);
  assert.strictEqual(resultado.failedItems, 0);
  const linha = await snapshotRepository.getProjectionSnapshot({ clienteContaId: 5, itemId: "MLB666", db });
  assert.strictEqual(linha.status, "UNVALIDATED");
});

cenario("20. falha técnica ao persistir 1 item não apaga o snapshot anterior daquele item", async () => {
  const db = makeMarginSnapshotFakeDb();
  const runA = await criarRunRunning(db);

  await processMarginSnapshotRun(runA, {
    db,
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake()),
    enrichBatch: fakeEnrichBatch({ total: 1, gerarItem: () => itemComEvidencias({ itemId: "MLB777", price: 100 }) }),
  });
  await runRepository.updateRunStatus({ runId: runA.id, status: "completed", db });

  const linhaAntes = await snapshotRepository.getProjectionSnapshot({ clienteContaId: 5, itemId: "MLB777", db });
  assert.strictEqual(linhaAntes.price, 100);

  const runB = await criarRunRunning(db);
  const upsertReal = snapshotRepository.upsertProjectionSnapshot;
  const resultado = await processMarginSnapshotRun(runB, {
    db,
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake()),
    enrichBatch: fakeEnrichBatch({ total: 1, gerarItem: () => itemComEvidencias({ itemId: "MLB777", price: 999 }) }),
    upsertProjectionSnapshot: async (dados, dbArg) => {
      if (dados.itemId === "MLB777") throw new Error("falha técnica simulada (ex.: conexão perdida)");
      return upsertReal(dados, dbArg);
    },
  });

  assert.strictEqual(resultado.failedItems, 1);
  assert.strictEqual(resultado.successItems, 0);
  const linhaDepois = await snapshotRepository.getProjectionSnapshot({ clienteContaId: 5, itemId: "MLB777", db });
  assert.strictEqual(linhaDepois.price, 100, "snapshot anterior deve sobreviver intocado — nunca apagado/zerado por falha técnica");
});

cenario("21. lote vazio encerra de forma segura (sem loop infinito, sem erro)", async () => {
  const run = criarRunFake();
  const deps = {
    db: {},
    prepareWorkspaceContext: fakePrepareWorkspaceContext(criarPreparedFake()),
    enrichBatch: async () => ({ totalItensMl: 0, itens: [] }),
    updateRunProgress: async () => {},
  };

  const resultado = await processMarginSnapshotRun(run, deps);

  assert.strictEqual(resultado.processedItems, 0);
  assert.strictEqual(resultado.successItems, 0);
  assert.strictEqual(resultado.failedItems, 0);
});

cenario("marketplace não suportado falha tipada, nunca tenta rodar adapter errado", async () => {
  const run = criarRunFake({ marketplace: "shopee" });
  let chamadasContexto = 0;
  const deps = {
    db: {},
    prepareWorkspaceContext: async () => { chamadasContexto += 1; return criarPreparedFake(); },
    enrichBatch: async () => ({ totalItensMl: 0, itens: [] }),
  };

  await assert.rejects(
    () => processMarginSnapshotRun(run, deps),
    (err) => err instanceof MarginSnapshotMarketplaceNaoSuportadoError && err.code === "MARGIN_SNAPSHOT_MARKETPLACE_NAO_SUPORTADO"
  );
  assert.strictEqual(chamadasContexto, 0, "marketplace inválido deve falhar ANTES de resolver contexto/chamar o Motor");
});

cenario("clienteContaId ausente no run nunca é auto-resolvido — falha explícita", async () => {
  const run = criarRunFake({ clienteContaId: null });
  await assert.rejects(() => processMarginSnapshotRun(run, { db: {} }), /clienteContaId/);
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
