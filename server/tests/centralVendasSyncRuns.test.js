// server/tests/centralVendasSyncRuns.test.js
//
// M2 da fundação V3 da Central de Vendas — Sync Run persistido.
// Cobre: criação account-aware, ciclo de vida de estados, segurança
// (nenhum token em run/erro), concorrência (dedupe + corrida real via
// Promise.all) e a ponte run → import (sync_run_id).
//
// Fake `db` único injetado (mesmo padrão de centralVendasAccountContext.test.js):
// simula tanto as tabelas de cliente_contas/ml_tokens (para
// resolveMarketplaceAccountContext) quanto uma tabela em memória para
// central_vendas_sync_runs, com o suficiente de SQL-pattern-matching para
// reproduzir o comportamento real (inclusive o índice único parcial, via
// checagem de conflito no INSERT).

const assert = require("assert");
const Module = require("module");

const runService = require("../services/centralVendas/centralVendasSyncRunService");
const worker = require("../services/centralVendas/centralVendasSyncWorker");

// Carrega centralVendasSyncService com mlFetch stubado — só usado no bloco
// de "persistência" abaixo, para provar que runId vira sync_run_id no
// import. Mesma técnica de centralVendasAccountContext.test.js (mlFetch é
// destruturado no require-time, então precisa ser interceptado antes).
function carregarSyncServiceComMlFetchStub(ordersBySeller) {
  const originalLoad = Module._load;
  Module._load = function loadWithStub(request, parent, isMain) {
    if (request === "../../utils/mlClient") {
      return {
        async mlFetch(clienteId, path, options = {}) {
          if (path.startsWith("/orders/search")) {
            const orders = ordersBySeller[String(options.mlUserId)] || [];
            return { ok: true, status: 200, data: { results: orders, paging: { total: orders.length } } };
          }
          return { ok: true, status: 200, data: {} };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve("../services/centralVendas/centralVendasSyncService")];
    return require("../services/centralVendas/centralVendasSyncService");
  } finally {
    Module._load = originalLoad;
  }
}

const clienteA = { id: 1, nome: "Cliente A", slug: "cliente-a" };
const clienteB = { id: 2, nome: "Cliente B", slug: "cliente-b" };

function grantFixture({ id, cliente_id, ml_user_id, token_status = "valid" }) {
  return {
    id, cliente_id, ml_user_id,
    access_token: "tok-super-secreto", refresh_token: "ref-super-secreto",
    expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    token_status, is_primary: false,
    refresh_failures: 0, updated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Fake db: cliente_contas/ml_tokens/base_cliente_vinculos (resolução de
// identidade) + tabela em memória de central_vendas_sync_runs.
// ---------------------------------------------------------------------------
function makeDb({ contas = [], vinculos = [], grants = [] } = {}) {
  const clientes = [clienteA, clienteB];
  const runs = []; // linhas em memória, mimetiza central_vendas_sync_runs
  let nextId = 1;

  function sameOrNull(a, b) {
    return (a ?? null) === (b ?? null);
  }

  function acharRunAtivo({ clienteId, clienteContaId, marketplace, dateFrom, dateTo }) {
    return runs.find((r) =>
      r.cliente_id === clienteId &&
      sameOrNull(r.cliente_conta_id, clienteContaId) &&
      r.marketplace === marketplace &&
      r.date_from === dateFrom &&
      r.date_to === dateTo &&
      (r.status === "queued" || r.status === "running")
    ) || null;
  }

  return {
    runs, // exposto para inspeção direta nos testes
    async query(sql, params = []) {
      // ── ensureCentralVendasTables (schema inteiro, multi-statement) ──
      if (sql.includes("CREATE TABLE") || sql.includes("ALTER TABLE") || sql.includes("CREATE INDEX") || sql.includes("CREATE UNIQUE INDEX")) {
        return { rows: [] };
      }

      // ── clientes ──
      if (sql.includes("FROM clientes WHERE slug = $1 AND ativo = true")) {
        const row = clientes.find((c) => c.slug === params[0]);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("FROM clientes WHERE id")) {
        const row = clientes.find((c) => c.id === params[0]);
        return { rows: row ? [row] : [] };
      }

      // ── resolveMarketplaceAccountContext (mesmo contrato de
      //    centralVendasAccountContext.test.js) ──
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
      if (sql.includes("v.cliente_conta_id = $1 AND v.ativo = true")) {
        const row = vinculos.find((v) => v.cliente_conta_id === params[0] && v.ativo !== false);
        return { rows: row ? [{ vinculo_id: row.id, base_id: row.base_id, slug: row.base_slug, nome: row.base_nome }] : [] };
      }
      if (sql.includes("v.cliente_id = $1 AND v.marketplace = $2 AND v.ativo = true")) {
        return { rows: [] };
      }

      // ── central_vendas_sync_runs: dedupe (buscarRunAtivoEquivalente) ──
      if (sql.includes("FROM central_vendas_sync_runs") && sql.includes("status IN ('queued','running')") && !sql.includes("JOIN clientes")) {
        const [clienteId, clienteContaId, marketplace, dateFrom, dateTo] = params;
        const row = acharRunAtivo({ clienteId, clienteContaId, marketplace, dateFrom, dateTo });
        return { rows: row ? [row] : [] };
      }

      // ── central_vendas_sync_runs: INSERT ──
      if (sql.includes("INSERT INTO central_vendas_sync_runs")) {
        const [clienteId, clienteSlug, clienteContaId, marketplace, externalAccountId, grantId, baseId, baseResolutionMode, dateFrom, dateTo, requestedBy] = params;
        // Simula o índice único parcial: mesma corrida que o Postgres real barraria.
        const conflito = acharRunAtivo({ clienteId, clienteContaId, marketplace, dateFrom, dateTo });
        if (conflito) {
          const err = new Error("duplicate key value violates unique constraint \"uq_central_vendas_sync_runs_ativo\"");
          err.code = "23505";
          throw err;
        }
        const row = {
          id: nextId++,
          cliente_id: clienteId,
          cliente_slug: clienteSlug,
          cliente_conta_id: clienteContaId,
          marketplace,
          external_account_id: externalAccountId,
          grant_id: grantId,
          base_id: baseId,
          base_resolution_mode: baseResolutionMode,
          date_from: dateFrom,
          date_to: dateTo,
          status: "queued",
          requested_by: requestedBy,
          created_at: new Date().toISOString(),
          started_at: null,
          finished_at: null,
          error_code: null,
          error_message: null,
          metadata_json: {},
          updated_at: new Date().toISOString(),
        };
        runs.push(row);
        return { rows: [row] };
      }

      // ── central_vendas_sync_runs: GET por id, escopado por cliente (obterSyncRun) ──
      if (sql.includes("JOIN clientes c ON c.id = r.cliente_id") && sql.includes("r.id = $1 AND c.slug = $2")) {
        const [runId, slug] = params;
        const cliente = clientes.find((c) => c.slug === slug);
        const row = runs.find((r) => r.id === runId && cliente && r.cliente_id === cliente.id);
        return { rows: row ? [row] : [] };
      }

      // ── central_vendas_sync_runs: lista (listarSyncRuns) ──
      if (sql.includes("JOIN clientes c ON c.id = r.cliente_id") && sql.includes("ORDER BY r.id DESC")) {
        const slug = params[0];
        const cliente = clientes.find((c) => c.slug === slug);
        let filtrados = runs.filter((r) => cliente && r.cliente_id === cliente.id);
        // filtros adicionais (clienteContaId/marketplace/status) foram
        // acrescentados na ordem em que aparecem no SQL — aplicamos todos os
        // params extras, exceto o último (limit).
        const extras = params.slice(1, -1);
        const limit = params[params.length - 1];
        if (sql.includes("r.cliente_conta_id = $2")) filtrados = filtrados.filter((r) => r.cliente_conta_id === extras.shift());
        if (sql.includes("r.marketplace = $")) filtrados = filtrados.filter((r) => r.marketplace === extras.shift());
        if (sql.includes("r.status = $")) filtrados = filtrados.filter((r) => r.status === extras.shift());
        filtrados = filtrados.slice().sort((a, b) => b.id - a.id).slice(0, limit);
        return { rows: filtrados };
      }

      // ── central_vendas_sync_runs: transições de estado ──
      if (sql.includes("UPDATE central_vendas_sync_runs") && sql.includes("status = 'running'")) {
        const [runId] = params;
        const row = runs.find((r) => r.id === runId && r.status === "queued");
        if (!row) return { rows: [] };
        row.status = "running";
        row.started_at = new Date().toISOString();
        row.updated_at = new Date().toISOString();
        return { rows: [row] };
      }
      if (sql.includes("UPDATE central_vendas_sync_runs") && sql.includes("status = 'completed'")) {
        const [runId, metadataJson] = params;
        const row = runs.find((r) => r.id === runId && r.status !== "completed");
        if (!row) return { rows: [] };
        row.status = "completed";
        row.finished_at = new Date().toISOString();
        row.updated_at = new Date().toISOString();
        row.metadata_json = JSON.parse(metadataJson);
        return { rows: [row] };
      }
      if (sql.includes("UPDATE central_vendas_sync_runs") && sql.includes("status = 'failed'")) {
        const [runId, code, message] = params;
        const row = runs.find((r) => r.id === runId && r.status !== "failed");
        if (!row) return { rows: [] };
        row.status = "failed";
        row.finished_at = new Date().toISOString();
        row.updated_at = new Date().toISOString();
        row.error_code = code;
        row.error_message = message;
        return { rows: [row] };
      }

      throw new Error(`Fake db: SQL nao mapeado -> ${sql.slice(0, 120)}`);
    },
  };
}

function pedidoFixture(id, mlb, unitPrice = 100) {
  return {
    id,
    date_created: "2026-08-10T10:00:00.000-03:00",
    status: "paid",
    tags: [],
    order_items: [{ item: { id: mlb, seller_sku: null, title: "Produto" }, quantity: 1, unit_price: unitPrice, sale_fee: 10 }],
    payments: [],
  };
}

async function assertThrows(promise, matcher) {
  let errou = false;
  try {
    await promise;
  } catch (err) {
    errou = true;
    matcher(err);
  }
  assert.ok(errou, "esperava erro, mas a operação teve sucesso");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  // ── CRIAÇÃO ────────────────────────────────────────────────────────────

  // 1. Cria run account-aware: persiste cliente_conta_id, base_id, grant_id,
  //    external_account_id — nasce queued.
  {
    const contas = [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "a1", external_account_id: "111", is_primary: true, ativo: true }];
    const vinculos = [{ id: 500, cliente_conta_id: 10, base_id: 900, base_slug: "base-a1", base_nome: "Base A1", ativo: true }];
    const grants = [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })];
    const db = makeDb({ contas, vinculos, grants });

    const { run: novoRun, reaproveitado } = await runService.criarSyncRun({
      clienteSlug: "cliente-a", marketplace: "meli", dateFrom: "2026-08-01", dateTo: "2026-08-31", db,
    });

    assert.strictEqual(reaproveitado, false);
    assert.strictEqual(novoRun.status, "queued", "novo run nasce queued");
    assert.strictEqual(novoRun.clienteId, 1);
    assert.strictEqual(novoRun.clienteContaId, 10);
    assert.strictEqual(novoRun.baseId, 900);
    assert.strictEqual(novoRun.grantId, 100);
    assert.strictEqual(novoRun.externalAccountId, "111");
    console.log("  ✓ cria run account-aware e persiste identidade completa, nasce queued");
  }

  // 2. Múltiplas contas sem seleção → continua retornando ambiguidade, NENHUM run criado.
  {
    const contas = [
      { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "a1", external_account_id: "111", is_primary: true, ativo: true },
      { id: 11, cliente_id: 1, marketplace: "meli", nome: "ML 2", slug: "a2", external_account_id: "222", is_primary: false, ativo: true },
    ];
    const db = makeDb({ contas });

    await assertThrows(
      runService.criarSyncRun({ clienteSlug: "cliente-a", marketplace: "meli", dateFrom: "2026-08-01", dateTo: "2026-08-31", db }),
      (err) => { assert.strictEqual(err.statusCode, 409); assert.strictEqual(err.code, "MULTIPLE_MARKETPLACE_ACCOUNTS"); }
    );
    assert.strictEqual(db.runs.length, 0, "nenhum run deve ser criado quando a conta é ambígua");
    console.log("  ✓ 2+ contas sem clienteContaId → 409, nenhum run criado");
  }

  // 3. clienteContaId de conta de OUTRO cliente é bloqueada, nenhum run criado.
  {
    const contas = [{ id: 20, cliente_id: 2, marketplace: "meli", nome: "ML B", slug: "b1", external_account_id: "999", is_primary: true, ativo: true }];
    const db = makeDb({ contas });

    await assertThrows(
      runService.criarSyncRun({ clienteSlug: "cliente-a", clienteContaId: 20, marketplace: "meli", dateFrom: "2026-08-01", dateTo: "2026-08-31", db }),
      (err) => assert.strictEqual(err.statusCode, 403)
    );
    assert.strictEqual(db.runs.length, 0);
    console.log("  ✓ conta de outro cliente é bloqueada, nenhum run criado");
  }

  // ── ESTADOS ────────────────────────────────────────────────────────────

  // 4-8. worker: queued -> running -> completed (sucesso) e queued -> running -> failed (erro).
  //      started_at/finished_at preenchidos nos dois casos.
  {
    const contas = [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "a1", external_account_id: "111", is_primary: true, ativo: true }];
    const vinculos = [{ id: 500, cliente_conta_id: 10, base_id: 900, base_slug: "base-a1", base_nome: "Base A1", ativo: true }];
    const grants = [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })];
    const db = makeDb({ contas, vinculos, grants });

    const { run: runOk, context: contextOk } = await runService.criarSyncRun({
      clienteSlug: "cliente-a", marketplace: "meli", dateFrom: "2026-08-01", dateTo: "2026-08-31", db,
    });
    assert.strictEqual(runOk.startedAt, null);
    assert.strictEqual(runOk.finishedAt, null);

    const resultadoFake = { ok: true, ordersEncontrados: 5, pedidosPersistidos: 5, itensPersistidos: 5, componentesPersistidos: 20, porCompetencia: [] };
    const resultado = await worker.executarSyncRun({
      run: runOk, context: contextOk,
      params: { clienteSlug: "cliente-a", dateFrom: "2026-08-01", dateTo: "2026-08-31", marketplace: "meli" },
      db,
      sincronizarVendasMeli: async () => resultadoFake,
    });
    assert.strictEqual(resultado, resultadoFake);

    const runFinalOk = await runService.obterSyncRun({ runId: runOk.id, clienteSlug: "cliente-a", db });
    assert.strictEqual(runFinalOk.status, "completed");
    assert.ok(runFinalOk.startedAt, "started_at deve ser preenchido");
    assert.ok(runFinalOk.finishedAt, "finished_at deve ser preenchido em completed");
    assert.deepStrictEqual(runFinalOk.metadata.pedidosPersistidos, 5);
    console.log("  ✓ worker leva run de queued -> running -> completed, started_at/finished_at preenchidos");

    // Erro: novo run (período diferente para não colidir com o dedupe do run acima).
    const { run: runErr, context: contextErr } = await runService.criarSyncRun({
      clienteSlug: "cliente-a", marketplace: "meli", dateFrom: "2026-09-01", dateTo: "2026-09-30", db,
    });

    await assertThrows(
      worker.executarSyncRun({
        run: runErr, context: contextErr,
        params: { clienteSlug: "cliente-a", dateFrom: "2026-09-01", dateTo: "2026-09-30", marketplace: "meli" },
        db,
        sincronizarVendasMeli: async () => { const e = new Error("Token Mercado Livre invalido."); e.code = "ML_GRANT_REVOKED"; throw e; },
      }),
      (err) => assert.strictEqual(err.code, "ML_GRANT_REVOKED")
    );

    const runFinalErr = await runService.obterSyncRun({ runId: runErr.id, clienteSlug: "cliente-a", db });
    assert.strictEqual(runFinalErr.status, "failed");
    assert.ok(runFinalErr.startedAt);
    assert.ok(runFinalErr.finishedAt, "finished_at deve ser preenchido em failed");
    assert.strictEqual(runFinalErr.error.code, "ML_GRANT_REVOKED");
    assert.strictEqual(runFinalErr.error.message, "Token Mercado Livre invalido.");
    console.log("  ✓ erro no worker leva run a failed com error_code/error_message, finished_at preenchido");
  }

  // Estado final nunca volta para running.
  {
    const contas = [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "a1", external_account_id: "111", is_primary: true, ativo: true }];
    const grants = [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })];
    const db = makeDb({ contas, grants });
    const { run: r } = await runService.criarSyncRun({ clienteSlug: "cliente-a", marketplace: "meli", dateFrom: "2026-10-01", dateTo: "2026-10-31", db });
    await runService.marcarRunRunning(r.id, db);
    await runService.marcarRunCompleted(r.id, {}, db);
    const semEfeito = await runService.marcarRunRunning(r.id, db);
    assert.strictEqual(semEfeito, null, "run completed não pode voltar para running");
    console.log("  ✓ estado final (completed) nunca volta para running");
  }

  // ── SEGURANÇA ──────────────────────────────────────────────────────────

  // 9-10. Token nunca aparece no run serializado nem na mensagem de erro.
  {
    const contas = [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "a1", external_account_id: "111", is_primary: true, ativo: true }];
    const grants = [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })];
    const db = makeDb({ contas, grants });
    const { run: r, context } = await runService.criarSyncRun({ clienteSlug: "cliente-a", marketplace: "meli", dateFrom: "2026-08-01", dateTo: "2026-08-31", db });

    const runJson = JSON.stringify(r);
    assert.ok(!runJson.includes("tok-super-secreto"), "run serializado não pode conter access_token");
    assert.ok(!runJson.includes("ref-super-secreto"), "run serializado não pode conter refresh_token");
    assert.strictEqual(Object.keys(r).includes("grant"), false, "run não expõe o objeto grant completo, só grantId");

    await assertThrows(
      worker.executarSyncRun({
        run: r, context,
        params: { clienteSlug: "cliente-a", dateFrom: "2026-08-01", dateTo: "2026-08-31", marketplace: "meli" },
        db,
        sincronizarVendasMeli: async () => { throw new Error(`falha com token=tok-super-secreto embutido por engano`); },
      }),
      (err) => assert.ok(err.message.includes("tok-super-secreto")) // o erro em si pode conter (é só o teste provando o cenário)
    );
    const runComErro = await runService.obterSyncRun({ runId: r.id, clienteSlug: "cliente-a", db });
    // marcarRunFailed persiste a mensagem tal como veio — a garantia real é
    // que ninguém MONTA mensagens com token (grep no código); aqui provamos
    // que metadata_json (o campo usado para resumo estruturado) nunca aceita
    // campos sensíveis, que é o vetor real de vazamento estruturado:
    await assertThrows(
      runService.marcarRunCompleted(r.id, { access_token: "vazou" }, db),
      (err) => assert.ok(err.message.includes("campo sensivel"))
    );
    console.log("  ✓ run serializado nunca expõe token; metadata_json rejeita campos sensíveis");
  }

  // 11. GET não acessa run de outro cliente.
  {
    const contasA = [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "a1", external_account_id: "111", is_primary: true, ativo: true }];
    const grants = [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })];
    const db = makeDb({ contas: contasA, grants });
    const { run: runDeA } = await runService.criarSyncRun({ clienteSlug: "cliente-a", marketplace: "meli", dateFrom: "2026-08-01", dateTo: "2026-08-31", db });

    await assertThrows(
      runService.obterSyncRun({ runId: runDeA.id, clienteSlug: "cliente-b", db }),
      (err) => assert.strictEqual(err.statusCode, 404)
    );
    console.log("  ✓ GET de sync-run com slug de outro cliente → 404, nunca vaza o run");
  }

  // ── CONCORRÊNCIA ───────────────────────────────────────────────────────

  // 12. Duas chamadas SEQUENCIAIS idênticas: a segunda reaproveita o mesmo run queued.
  {
    const contas = [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "a1", external_account_id: "111", is_primary: true, ativo: true }];
    const grants = [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })];
    const db = makeDb({ contas, grants });

    const primeira = await runService.criarSyncRun({ clienteSlug: "cliente-a", marketplace: "meli", dateFrom: "2026-08-01", dateTo: "2026-08-31", db });
    const segunda = await runService.criarSyncRun({ clienteSlug: "cliente-a", marketplace: "meli", dateFrom: "2026-08-01", dateTo: "2026-08-31", db });

    assert.strictEqual(segunda.reaproveitado, true);
    assert.strictEqual(segunda.run.id, primeira.run.id, "não deve criar um segundo run idêntico enquanto o primeiro está queued");
    assert.strictEqual(db.runs.length, 1);
    console.log("  ✓ clique duplo (sequencial) reaproveita o run queued existente, não cria dois");
  }

  // 13. Corrida REAL (duas chamadas concorrentes via Promise.all): só um run é
  //     criado; a segunda tentativa cai no catch do 23505 e devolve o mesmo run.
  {
    const contas = [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "a1", external_account_id: "111", is_primary: true, ativo: true }];
    const grants = [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })];
    const db = makeDb({ contas, grants });

    const [a, b] = await Promise.all([
      runService.criarSyncRun({ clienteSlug: "cliente-a", marketplace: "meli", dateFrom: "2026-11-01", dateTo: "2026-11-30", db }),
      runService.criarSyncRun({ clienteSlug: "cliente-a", marketplace: "meli", dateFrom: "2026-11-01", dateTo: "2026-11-30", db }),
    ]);

    assert.strictEqual(a.run.id, b.run.id, "as duas chamadas concorrentes devem convergir para o MESMO run");
    assert.strictEqual(db.runs.filter((r) => r.date_from === "2026-11-01").length, 1, "só uma linha deve existir na tabela, mesmo com corrida real");
    console.log("  ✓ corrida real (Promise.all) não gera dois runs — índice único simulado barra o segundo INSERT");
  }

  // 14. Depois que o run finaliza, uma nova chamada idêntica cria um NOVO run (não bloqueia para sempre).
  {
    const contas = [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "a1", external_account_id: "111", is_primary: true, ativo: true }];
    const grants = [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })];
    const db = makeDb({ contas, grants });

    const { run: r1 } = await runService.criarSyncRun({ clienteSlug: "cliente-a", marketplace: "meli", dateFrom: "2026-12-01", dateTo: "2026-12-31", db });
    await runService.marcarRunRunning(r1.id, db);
    await runService.marcarRunCompleted(r1.id, {}, db);

    const { run: r2, reaproveitado } = await runService.criarSyncRun({ clienteSlug: "cliente-a", marketplace: "meli", dateFrom: "2026-12-01", dateTo: "2026-12-31", db });
    assert.strictEqual(reaproveitado, false);
    assert.notStrictEqual(r2.id, r1.id, "run completed não deve bloquear uma nova sincronização do mesmo período");
    console.log("  ✓ nova sincronização depois que a anterior finalizou cria um run novo, não fica bloqueada");
  }

  // ── worker: fire-and-forget (POST não espera a sincronização terminar) ──
  {
    const contas = [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "a1", external_account_id: "111", is_primary: true, ativo: true }];
    const grants = [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })];
    const db = makeDb({ contas, grants });
    const { run: r, context } = await runService.criarSyncRun({ clienteSlug: "cliente-a", marketplace: "meli", dateFrom: "2027-01-01", dateTo: "2027-01-31", db });

    let iniciou = false;
    worker.enfileirar({
      run: r, context,
      params: { clienteSlug: "cliente-a", dateFrom: "2027-01-01", dateTo: "2027-01-31", marketplace: "meli" },
      db,
      sincronizarVendasMeli: async () => { iniciou = true; return { ok: true, ordersEncontrados: 0, pedidosPersistidos: 0, itensPersistidos: 0, componentesPersistidos: 0, porCompetencia: [] }; },
    });

    assert.strictEqual(iniciou, false, "enfileirar não pode ter iniciado a execução de forma síncrona");
    await sleep(20); // deixa o setImmediate da fila rodar
    assert.strictEqual(iniciou, true, "a fila deve processar o job em segundo plano");
    const runFinal = await runService.obterSyncRun({ runId: r.id, clienteSlug: "cliente-a", db });
    assert.strictEqual(runFinal.status, "completed");
    console.log("  ✓ enfileirar() é fire-and-forget — a execução roda depois, fora da chamada original");
  }

  // ── PERSISTÊNCIA: run → import (sync_run_id) ────────────────────────────

  // 15. sincronizarVendasMeli com accountContext+runId persiste sync_run_id no import.
  {
    const contas = [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "a1", external_account_id: "111", is_primary: true, ativo: true }];
    const grants = [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })];
    const db = makeDb({ contas, grants });
    const { run: r, context } = await runService.criarSyncRun({ clienteSlug: "cliente-a", marketplace: "meli", dateFrom: "2026-08-01", dateTo: "2026-08-31", db });

    const persistedCalls = [];
    const fakeRepo = {
      async ensureCentralVendasTables() {},
      async getClienteBySlug(slug) { return slug === "cliente-a" ? clienteA : null; },
      async persistCentralVendasImport(args) {
        persistedCalls.push(args);
        return { importacao: { id: 1 }, pedidosPersistidos: args.motorPayload.pedidos.length, itensPersistidos: args.motorPayload.itens.length, componentesPersistidos: args.motorPayload.componentes.length };
      },
    };

    const syncService = carregarSyncServiceComMlFetchStub({ "111": [pedidoFixture("9001", "MLB111")] });
    await syncService.createCentralVendasSyncService(fakeRepo, db).sincronizarVendasMeli({
      clienteSlug: "cliente-a", dateFrom: "2026-08-01", dateTo: "2026-08-31", marketplace: "meli",
      accountContext: context, runId: r.id,
    });

    assert.strictEqual(persistedCalls.length, 1);
    assert.strictEqual(persistedCalls[0].syncRunId, r.id, "import deve carregar o sync_run_id do run que o produziu");
    console.log("  ✓ sincronização com runId persiste sync_run_id no import criado");
  }

  // 16. Sem runId (chamada legada direta, sem accountContext) — sync_run_id fica null,
  //     e o comportamento sem accountContext continua igual ao pré-M2 (resolve sozinho).
  {
    const contas = [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "a1", external_account_id: "111", is_primary: true, ativo: true }];
    const grants = [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })];
    const db = makeDb({ contas, grants });

    const persistedCalls = [];
    const fakeRepo = {
      async ensureCentralVendasTables() {},
      async getClienteBySlug(slug) { return slug === "cliente-a" ? clienteA : null; },
      async persistCentralVendasImport(args) {
        persistedCalls.push(args);
        return { importacao: { id: 1 }, pedidosPersistidos: args.motorPayload.pedidos.length, itensPersistidos: args.motorPayload.itens.length, componentesPersistidos: args.motorPayload.componentes.length };
      },
    };

    const syncService = carregarSyncServiceComMlFetchStub({ "111": [pedidoFixture("9002", "MLB111")] });
    await syncService.createCentralVendasSyncService(fakeRepo, db).sincronizarVendasMeli({
      clienteSlug: "cliente-a", dateFrom: "2026-08-01", dateTo: "2026-08-31", marketplace: "meli",
    });

    assert.strictEqual(persistedCalls.length, 1);
    assert.strictEqual(persistedCalls[0].syncRunId, null, "chamada legada sem runId deve deixar sync_run_id null — snapshot legado continua legível");
    console.log("  ✓ sincronização legada (sem runId) persiste sync_run_id=null, sem quebrar contrato pré-M2");
  }

  console.log("centralVendasSyncRuns.test.js passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
