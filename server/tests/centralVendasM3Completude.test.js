// server/tests/centralVendasM3Completude.test.js
//
// M3 da fundação V3 da Central de Vendas — Completude por Fonte, fim-a-fim.
// Roda o worker de verdade (executarSyncRun) sobre um sync_run real,
// estubando só o mlFetch (orders/shipments/claims), e prova o cenário final
// obrigatório da spec (seção 68): Orders/Shipments completos, Claims HTTP
// 400 → run técnico completed, completude partial, Returns bloqueado,
// motivo "pós-venda não verificado" propagado até o GET da Central.
//
// Também cobre a rede de segurança (Orders falha depois de Base já ter
// rodado → Base não fica presa em "running") e a honestidade do GET
// (buildPayloadFromRange nunca deixa podeConcluir=true com fonte incompleta).

const assert = require("assert");
const Module = require("module");

const runService = require("../services/centralVendas/centralVendasSyncRunService");
const sourceService = require("../services/centralVendas/centralVendasSyncSourceService");
const worker = require("../services/centralVendas/centralVendasSyncWorker");
const { buildPayloadFromRange } = require("../services/centralVendas/centralVendasService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

const cliente = { id: 1, nome: "Loja da Isa", slug: "loja-da-isa" };

function grantFixture({ id, cliente_id, ml_user_id }) {
  return {
    id, cliente_id, ml_user_id,
    access_token: "tok-super-secreto", refresh_token: "ref-super-secreto",
    expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    token_status: "valid", is_primary: false, refresh_failures: 0, updated_at: new Date().toISOString(),
  };
}

// Fake db: identidade de conta (mesmo contrato de centralVendasSyncRuns.test.js)
// + central_vendas_sync_runs + central_vendas_sync_sources, tudo em memória.
function makeDb({ contas, grants }) {
  const runs = [];
  const sources = [];
  let nextRunId = 1;
  let nextSourceId = 1;

  function acharRunAtivo({ clienteId, clienteContaId, marketplace, dateFrom, dateTo }) {
    return runs.find((r) =>
      r.cliente_id === clienteId && (r.cliente_conta_id ?? null) === (clienteContaId ?? null) &&
      r.marketplace === marketplace && r.date_from === dateFrom && r.date_to === dateTo &&
      (r.status === "queued" || r.status === "running")
    ) || null;
  }

  return {
    runs, sources,
    async query(sql, params = []) {
      if (sql.includes("CREATE TABLE") || sql.includes("ALTER TABLE") || sql.includes("CREATE INDEX") || sql.includes("CREATE UNIQUE INDEX")) {
        return { rows: [] };
      }
      if (sql.includes("FROM clientes WHERE slug = $1 AND ativo = true")) {
        return { rows: params[0] === cliente.slug ? [cliente] : [] };
      }
      if (sql.includes("FROM clientes WHERE id")) {
        return { rows: params[0] === cliente.id ? [cliente] : [] };
      }
      if (sql.includes("cliente_contas WHERE id = $1")) {
        const row = contas.find((c) => c.id === params[0]);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true ORDER BY is_primary")) {
        return { rows: contas.filter((c) => c.cliente_id === params[0] && c.marketplace === params[1] && c.ativo !== false) };
      }
      if (sql.includes("COUNT(*)::int AS total FROM cliente_contas")) {
        const total = contas.filter((c) => c.cliente_id === params[0] && c.marketplace === params[1] && c.ativo !== false).length;
        return { rows: [{ total }] };
      }
      if (sql.includes("t.cliente_id = $1 AND t.ml_user_id = $2")) {
        const row = grants.find((g) => g.cliente_id === params[0] && String(g.ml_user_id) === String(params[1]));
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("FROM ml_tokens t") && sql.includes("WHERE t.cliente_id = $1")) {
        return { rows: grants.filter((g) => g.cliente_id === params[0]) };
      }
      if (sql.includes("v.cliente_conta_id = $1 AND v.ativo = true")) return { rows: [] };
      if (sql.includes("v.cliente_id = $1 AND v.marketplace = $2 AND v.ativo = true")) return { rows: [] };
      if (sql.includes("FROM custos WHERE base_id")) return { rows: [] };

      if (sql.includes("FROM central_vendas_sync_runs") && sql.includes("status IN ('queued','running')") && !sql.includes("JOIN clientes")) {
        const [clienteId, clienteContaId, marketplace, dateFrom, dateTo] = params;
        const row = acharRunAtivo({ clienteId, clienteContaId, marketplace, dateFrom, dateTo });
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("INSERT INTO central_vendas_sync_runs")) {
        const [clienteId, clienteSlug, clienteContaId, marketplace, externalAccountId, grantId, baseId, baseResolutionMode, dateFrom, dateTo, requestedBy] = params;
        const row = {
          id: nextRunId++, cliente_id: clienteId, cliente_slug: clienteSlug, cliente_conta_id: clienteContaId,
          marketplace, external_account_id: externalAccountId, grant_id: grantId, base_id: baseId,
          base_resolution_mode: baseResolutionMode, date_from: dateFrom, date_to: dateTo, status: "queued",
          requested_by: requestedBy, created_at: new Date().toISOString(), started_at: null, finished_at: null,
          error_code: null, error_message: null, metadata_json: {}, completeness_status: null,
          updated_at: new Date().toISOString(),
        };
        runs.push(row);
        return { rows: [row] };
      }
      if (sql.includes("SYNC_RUN_STALE_QUEUED") || sql.includes("SYNC_RUN_STALE_RUNNING")) return { rows: [] };
      if (sql.includes("UPDATE central_vendas_sync_runs") && sql.includes("status = 'running'") && sql.includes("started_at = NOW()")) {
        const row = runs.find((r) => r.id === params[0] && r.status === "queued");
        if (!row) return { rows: [] };
        Object.assign(row, { status: "running", started_at: new Date().toISOString() });
        return { rows: [row] };
      }
      if (sql.includes("UPDATE central_vendas_sync_runs") && sql.includes("status = 'completed'")) {
        const row = runs.find((r) => r.id === params[0] && r.status === "running");
        if (!row) return { rows: [] };
        Object.assign(row, { status: "completed", finished_at: new Date().toISOString(), metadata_json: JSON.parse(params[1]) });
        return { rows: [row] };
      }
      if (sql.includes("UPDATE central_vendas_sync_runs") && sql.includes("status = 'failed'")) {
        const row = runs.find((r) => r.id === params[0] && r.status === "running");
        if (!row) return { rows: [] };
        Object.assign(row, { status: "failed", finished_at: new Date().toISOString(), error_code: params[1], error_message: params[2] });
        return { rows: [row] };
      }
      if (sql.includes("UPDATE central_vendas_sync_runs") && sql.includes("completeness_status = $2")) {
        const row = runs.find((r) => r.id === params[0]);
        if (!row) return { rows: [] };
        row.completeness_status = params[1];
        return { rows: [row] };
      }
      if (sql.includes("JOIN clientes c ON c.id = r.cliente_id") && sql.includes("r.id = $1 AND c.slug = $2")) {
        const row = runs.find((r) => r.id === params[0] && r.cliente_id === cliente.id && params[1] === cliente.slug);
        return { rows: row ? [row] : [] };
      }

      if (sql.includes("INSERT INTO central_vendas_sync_sources")) {
        const [syncRunId, source] = params;
        const TERMINAL = new Set(["complete", "incomplete", "failed", "not_applicable"]);
        let row = sources.find((r) => r.sync_run_id === syncRunId && r.source === source);
        if (!row) {
          row = {
            id: nextSourceId++, sync_run_id: syncRunId, source, status: "running", complete: null,
            expected_count: null, received_count: null, pages_expected: null, pages_received: null,
            attempts: 1, started_at: new Date().toISOString(), finished_at: null,
            error_code: null, http_status: null, error_message: null, metadata_json: {},
          };
          sources.push(row);
          return { rows: [row] };
        }
        if (TERMINAL.has(row.status)) return { rows: [] };
        row.status = "running";
        row.attempts += 1;
        return { rows: [row] };
      }
      if (sql.includes("UPDATE central_vendas_sync_sources") && sql.includes("status = $3")) {
        const [
          syncRunId, source, status, complete, expectedCount, receivedCount,
          pagesExpected, pagesReceived, errorCode, httpStatus, errorMessage, metadataJson,
        ] = params;
        const TERMINAL = new Set(["complete", "incomplete", "failed", "not_applicable"]);
        const row = sources.find((r) => r.sync_run_id === syncRunId && r.source === source && !TERMINAL.has(r.status));
        if (!row) return { rows: [] };
        Object.assign(row, {
          status, complete, expected_count: expectedCount, received_count: receivedCount,
          pages_expected: pagesExpected, pages_received: pagesReceived, error_code: errorCode,
          http_status: httpStatus, error_message: errorMessage, metadata_json: JSON.parse(metadataJson),
        });
        return { rows: [row] };
      }
      if (sql.includes("status = 'failed', complete = false") && sql.includes("IN ('pending', 'running')")) {
        const [syncRunId, errorCode, errorMessage] = params;
        const afetadas = sources.filter((r) => r.sync_run_id === syncRunId && (r.status === "pending" || r.status === "running"));
        for (const row of afetadas) Object.assign(row, { status: "failed", complete: false, error_code: errorCode, error_message: errorMessage });
        return { rows: afetadas.map((r) => ({ source: r.source })) };
      }
      if (sql.includes("SELECT * FROM central_vendas_sync_sources WHERE sync_run_id = $1")) {
        return { rows: sources.filter((r) => r.sync_run_id === params[0]).sort((a, b) => a.id - b.id) };
      }

      throw new Error(`Fake db: SQL nao mapeado -> ${sql.slice(0, 120)}`);
    },
  };
}

// Estuba mlFetch por rota (orders/shipments/claims). `handlers` mapeia
// prefixo de path -> função (path, options) => resposta.
function carregarComHandlers(handlers) {
  const originalLoad = Module._load;
  Module._load = function loadWithStub(request, parent, isMain) {
    if (request === "../../utils/mlClient") {
      return {
        async mlFetch(clienteId, path, options = {}) {
          for (const [prefix, handler] of handlers) {
            if (path.startsWith(prefix)) return handler(path, options);
          }
          return { ok: true, status: 200, data: {} };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    // centralVendasClaimsService e centralVendasFreteService TAMBÉM
    // destruturam mlFetch no topo do módulo — se só o cache de
    // centralVendasSyncService for invalidado, esses dois continuam presos
    // ao stub da PRIMEIRA vez que foram carregados (bug real encontrado
    // rodando os cenários 1 e 2 em sequência: o cenário 2 herdava o
    // mlFetch de claims do cenário 1). Precisa invalidar os três.
    delete require.cache[require.resolve("../services/centralVendas/centralVendasSyncService")];
    delete require.cache[require.resolve("../services/centralVendas/centralVendasClaimsService")];
    delete require.cache[require.resolve("../services/centralVendas/centralVendasFreteService")];
    return require("../services/centralVendas/centralVendasSyncService");
  } finally {
    Module._load = originalLoad;
  }
}

function pedido(id, shipmentId) {
  return {
    id, date_created: "2026-08-10T10:00:00.000-03:00", status: "paid", tags: [], payments: [],
    shipping: { id: shipmentId },
    order_items: [{ item: { id: "MLB1", seller_sku: null, title: "Produto" }, quantity: 1, unit_price: 100, sale_fee: 10 }],
  };
}

async function novoRunFakeRepo() {
  const fakeRepo = {
    persistedCalls: [],
    async ensureCentralVendasTables() {},
    async getClienteBySlug(slug) { return slug === cliente.slug ? cliente : null; },
    async persistCentralVendasImport(args) {
      this.persistedCalls.push(args);
      return {
        importacao: { id: this.persistedCalls.length },
        pedidosPersistidos: args.motorPayload.pedidos.length,
        itensPersistidos: args.motorPayload.itens.length,
        componentesPersistidos: args.motorPayload.componentes.length,
      };
    },
  };
  return fakeRepo;
}

async function capturandoLogs(fn) {
  const original = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = original; }
}

async function run() {
  const contas = [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "loja-isa", external_account_id: "111", is_primary: true, ativo: true }];
  const grants = [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })];

  // ── CENÁRIO 1: tudo completo → completenessStatus=complete ─────────────
  await capturandoLogs(async () => {
    const db = makeDb({ contas, grants });
    const { run: r, context } = await runService.criarSyncRun({
      clienteSlug: cliente.slug, marketplace: "meli", dateFrom: "2026-08-01", dateTo: "2026-08-31", db,
    });
    const fakeRepo = await novoRunFakeRepo();

    const syncService = carregarComHandlers([
      ["/orders/search", () => ({ ok: true, status: 200, data: { results: [pedido("9001", "s1")], paging: { total: 1 } } })],
      ["/shipments/", () => ({ ok: true, status: 200, data: { senders: [{ user_id: "111", cost: 12.5 }], receiver: { cost: 5 } } })],
      ["/post-purchase/v1/claims/search", () => ({ ok: true, status: 200, data: { data: [], paging: { total: 0 } } })],
    ]);

    const sincronizarVendasMeli = syncService.createCentralVendasSyncService(fakeRepo, db).sincronizarVendasMeli;
    await worker.executarSyncRun({
      run: r, context, db, sincronizarVendasMeli,
      params: { clienteSlug: cliente.slug, dateFrom: "2026-08-01", dateTo: "2026-08-31", marketplace: "meli" },
    });

    const runFinal = await runService.obterSyncRun({ runId: r.id, clienteSlug: cliente.slug, db });
    eq("cenario1: run.status", runFinal.status, "completed");
    eq("cenario1: run.completenessStatus", runFinal.completenessStatus, "complete");

    const fontes = await sourceService.listarFontesDoRun(r.id, db);
    const porFonte = Object.fromEntries(fontes.map((f) => [f.source, f]));
    eq("cenario1: orders complete", porFonte.orders.status, "complete");
    eq("cenario1: orders 1/1", [porFonte.orders.receivedCount, porFonte.orders.expectedCount], [1, 1]);
    eq("cenario1: shipments complete", porFonte.shipments.status, "complete");
    eq("cenario1: claims complete", porFonte.claims.status, "complete");
    eq("cenario1: returns complete", porFonte.returns.status, "complete");
    eq("cenario1: base complete", porFonte.base.status, "complete");

    ok("cenario1: resumo carrega completenessStatus", fakeRepo.persistedCalls[0].resumo.completenessStatus === "complete");
    eq("cenario1: resumo syncRunId", fakeRepo.persistedCalls[0].resumo.syncRunId, r.id);
    eq("cenario1: resumo incompleteSources vazio", fakeRepo.persistedCalls[0].resumo.incompleteSources, []);
  });

  // ── CENÁRIO 2 (seção 68 — cenário final obrigatório): Claims HTTP 400 ──
  await capturandoLogs(async () => {
    const db = makeDb({ contas, grants });
    const { run: r, context } = await runService.criarSyncRun({
      clienteSlug: cliente.slug, marketplace: "meli", dateFrom: "2026-08-01", dateTo: "2026-08-31", db,
    });
    const fakeRepo = await novoRunFakeRepo();

    const syncService = carregarComHandlers([
      ["/orders/search", () => ({ ok: true, status: 200, data: { results: [pedido("9010", "s10")], paging: { total: 1 } } })],
      ["/shipments/", () => ({ ok: true, status: 200, data: { senders: [{ user_id: "111", cost: 9.9 }], receiver: { cost: 3 } } })],
      ["/post-purchase/v1/claims/search", () => ({ ok: false, status: 400, data: { error: "bad_request" } })],
    ]);

    const sincronizarVendasMeli = syncService.createCentralVendasSyncService(fakeRepo, db).sincronizarVendasMeli;
    await worker.executarSyncRun({
      run: r, context, db, sincronizarVendasMeli,
      params: { clienteSlug: cliente.slug, dateFrom: "2026-08-01", dateTo: "2026-08-31", marketplace: "meli" },
    });

    const runFinal = await runService.obterSyncRun({ runId: r.id, clienteSlug: cliente.slug, db });
    eq("cenario2: run tecnico completed", runFinal.status, "completed");
    eq("cenario2: completude partial", runFinal.completenessStatus, "partial");

    const fontes = await sourceService.listarFontesDoRun(r.id, db);
    const porFonte = Object.fromEntries(fontes.map((f) => [f.source, f]));
    eq("cenario2: orders complete", porFonte.orders.status, "complete");
    eq("cenario2: shipments complete", porFonte.shipments.status, "complete");
    eq("cenario2: claims failed", porFonte.claims.status, "failed");
    eq("cenario2: claims httpStatus", porFonte.claims.httpStatus, 400);
    eq("cenario2: claims errorCode", porFonte.claims.errorCode, "CLAIMS_HTTP_400");
    eq("cenario2: returns bloqueado (nunca complete)", porFonte.returns.status, "incomplete");
    eq("cenario2: returns errorCode", porFonte.returns.errorCode, "RETURNS_BLOCKED_BY_CLAIMS");

    // GET da Central: honestidade (seção 44/45) — nunca podeConcluir=true
    // nem confianca=confiavel quando claims falhou. Monta o snapshot no
    // mesmo formato que centralVendasRepository.getCentralVendasByRange
    // devolveria (pedidos/itens/componentes em camelCase — buildPedidoContrato
    // aceita as duas convenções via rowValue).
    const call = fakeRepo.persistedCalls[0];
    const snapshot = {
      importacao: { id: 1, resumo_json: call.resumo, fonte: call.fonte, created_at: new Date().toISOString() },
      pedidos: call.motorPayload.pedidos,
      itens: call.motorPayload.itens,
      componentes: call.motorPayload.componentes,
    };
    const payload = buildPayloadFromRange(cliente, { dateFrom: "2026-08-01", dateTo: "2026-08-31" }, snapshot);
    eq("cenario2 GET: confianca parcial", payload.motor.confianca, "parcial");
    eq("cenario2 GET: podeConcluir false", payload.motor.podeConcluir, false);
    ok("cenario2 GET: motivoBloqueio menciona pos-venda", /pos-venda/i.test(payload.motor.motivoBloqueio));
    ok("cenario2 GET: completude exposta", payload.completude && payload.completude.status === "partial");
    ok("cenario2 GET: fontesIncompletas inclui claims", payload.completude.fontesIncompletas.includes("claims"));
  });

  // ── CENÁRIO 3: Orders falha (HTTP 500) → rede de segurança fecha Base ───
  await capturandoLogs(async () => {
    const db = makeDb({ contas, grants });
    const { run: r, context } = await runService.criarSyncRun({
      clienteSlug: cliente.slug, marketplace: "meli", dateFrom: "2026-08-01", dateTo: "2026-08-31", db,
    });
    const fakeRepo = await novoRunFakeRepo();

    const syncService = carregarComHandlers([
      ["/orders/search", () => ({ ok: false, status: 500, data: null })],
    ]);

    const sincronizarVendasMeli = syncService.createCentralVendasSyncService(fakeRepo, db).sincronizarVendasMeli;
    let lancou = false;
    try {
      await worker.executarSyncRun({
        run: r, context, db, sincronizarVendasMeli,
        params: { clienteSlug: cliente.slug, dateFrom: "2026-08-01", dateTo: "2026-08-31", marketplace: "meli" },
      });
    } catch (_) { lancou = true; }
    ok("cenario3: executarSyncRun propaga o erro", lancou);

    const runFinal = await runService.obterSyncRun({ runId: r.id, clienteSlug: cliente.slug, db });
    eq("cenario3: run.status failed", runFinal.status, "failed");
    eq("cenario3: completude failed", runFinal.completenessStatus, "failed");

    const fontes = await sourceService.listarFontesDoRun(r.id, db);
    const porFonte = Object.fromEntries(fontes.map((f) => [f.source, f]));
    // Base começou (consultou custos com sucesso) mas seu marcarFonteCompleta
    // só roda DEPOIS de orders (precisa dos pedidos para a cobertura
    // financeira — seção 33). Como orders falhou antes disso, base ficou
    // presa em "running" — é exatamente o caso que a rede de segurança
    // (seção 54) existe para fechar, nunca deixando "run failed, fontes
    // ainda running".
    eq("cenario3: base fechada pela rede de seguranca", porFonte.base.status, "failed");
    eq("cenario3: orders failed", porFonte.orders.status, "failed");
    eq("cenario3: orders errorCode", porFonte.orders.errorCode, "ORDERS_HTTP_ERROR");
    ok("cenario3: nenhuma fonte presa em running/pending", fontes.every((f) => f.status !== "running" && f.status !== "pending"));
  });

  console.log(`centralVendasM3Completude.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
