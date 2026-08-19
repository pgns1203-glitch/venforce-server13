// server/tests/centralVendasSyncWorkerFailedCompleteness.test.js
//
// Regressão do catch de executarSyncRun (centralVendasSyncWorker.js): ele
// forçava completenessStatus = "failed" sempre que o run técnico falhava,
// ignorando o estado real de central_vendas_sync_sources. Isso quebra a
// invariável documentada em centralVendasSyncRunService — completenessStatus
// é SEMPRE derivado de calcularCompletudeDoRun, nunca escrito por outro
// caminho. Um run técnico failed pode ter completude partial (só uma fonte
// não-estrutural, ex.: claims, falhou) ou até complete (todas as fontes
// fecharam bem e o erro técnico veio de uma etapa posterior, ex.:
// persistência) — só falha estrutural (orders/base) força completude
// failed.
//
// Prova as 3 combinações da spec (unitário no worker, com sincronizarVendasMeli
// injetado — não depende de resolveMarketplaceAccountContext nem do motor
// real; isso já é coberto fim-a-fim por centralVendasM3Completude.test.js).

const assert = require("assert");

const runService = require("../services/centralVendas/centralVendasSyncRunService");
const sourceService = require("../services/centralVendas/centralVendasSyncSourceService");
const worker = require("../services/centralVendas/centralVendasSyncWorker");

let checks = 0;
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

// Fake db mínimo: só central_vendas_sync_runs + central_vendas_sync_sources
// (os testes constroem o run diretamente em db.runs, sem passar por
// criarSyncRun — não precisamos de resolução de conta aqui).
function makeDb() {
  const runs = [];
  const sources = [];
  let nextSourceId = 1;
  const TERMINAL = new Set(["complete", "incomplete", "failed", "not_applicable"]);

  return {
    runs, sources,
    async query(sql, params = []) {
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
      if (sql.includes("INSERT INTO central_vendas_sync_sources")) {
        const [syncRunId, source] = params;
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

let nextRunId = 1;
function novoRun(db) {
  const row = {
    id: nextRunId++, status: "queued", cliente_id: 1, cliente_slug: "loja-da-isa",
    cliente_conta_id: null, marketplace: "meli", external_account_id: null, grant_id: null,
    base_id: null, base_resolution_mode: null, date_from: "2026-08-01", date_to: "2026-08-31",
    requested_by: null, created_at: new Date().toISOString(), started_at: null, finished_at: null,
    error_code: null, error_message: null, metadata_json: {}, completeness_status: null,
    updated_at: new Date().toISOString(),
  };
  db.runs.push(row);
  return runService.sanitizeRun(row);
}

const params = { clienteSlug: "loja-da-isa", dateFrom: "2026-08-01", dateTo: "2026-08-31", marketplace: "meli" };
const context = { conta: null, mlUserId: null, grant: null, base: null };

async function esperaLancar(fn) {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
}

// Roda o cenário e verifica a invariável central: completenessStatus
// persistido no run === calcularCompletudeDoRun(run.id, { runStatus: "failed" }).status
// `montarStub(db)` monta o sincronizarVendasMeli de teste — precisa do `db`
// da própria fake para as chamadas de sourceService (o worker só injeta
// runId/accountContext no sincronizarVendasMeli, não db).
async function rodarCenario(label, { montarStub, statusEsperado, completenessEsperado }) {
  const db = makeDb();
  const r = novoRun(db);
  const sincronizarVendasMeli = montarStub(db);

  const err = await esperaLancar(() =>
    worker.executarSyncRun({ run: r, context, db, sincronizarVendasMeli, params })
  );
  assert.ok(err, `FALHOU: ${label} — executarSyncRun deveria propagar o erro`);
  checks += 1;

  const runFinal = db.runs.find((x) => x.id === r.id);
  eq(`${label}: run.status`, runFinal.status, statusEsperado);
  eq(`${label}: completenessStatus`, runFinal.completeness_status, completenessEsperado);

  const completude = await sourceService.calcularCompletudeDoRun(r.id, { runStatus: "failed", db });
  eq(`${label}: invariavel run.completenessStatus === calcularCompletudeDoRun(...).status`, runFinal.completeness_status, completude.status);
}

async function main() {
  // ── Orders falhou (estrutural) → run.status=failed, completeness=failed ──
  await rodarCenario("orders falhou", {
    statusEsperado: "failed",
    completenessEsperado: "failed",
    montarStub: (db) => async ({ runId }) => {
      await sourceService.iniciarFonte({ runId, source: "orders", db });
      await sourceService.marcarFonteFalha({ runId, source: "orders", errorCode: "ORDERS_HTTP_ERROR", httpStatus: 500, db });
      const err = new Error("orders 500");
      err.code = "ORDERS_HTTP_ERROR";
      throw err;
    },
  });

  // ── Claims falhou (não-estrutural) + erro técnico posterior → status=failed, completeness=partial ──
  await rodarCenario("claims falhou", {
    statusEsperado: "failed",
    completenessEsperado: "partial",
    montarStub: (db) => async ({ runId }) => {
      await sourceService.iniciarFonte({ runId, source: "orders", db });
      await sourceService.marcarFonteCompleta({ runId, source: "orders", expectedCount: 1, receivedCount: 1, db });
      await sourceService.iniciarFonte({ runId, source: "shipments", db });
      await sourceService.marcarFonteCompleta({ runId, source: "shipments", expectedCount: 1, receivedCount: 1, db });
      await sourceService.iniciarFonte({ runId, source: "claims", db });
      await sourceService.marcarFonteFalha({ runId, source: "claims", errorCode: "CLAIMS_HTTP_400", httpStatus: 400, db });
      await sourceService.iniciarFonte({ runId, source: "base", db });
      await sourceService.marcarFonteCompleta({ runId, source: "base", expectedCount: 1, receivedCount: 1, db });
      const err = new Error("erro tecnico depois de claims falhar");
      err.code = "SYNC_EXECUTION_ERROR";
      throw err;
    },
  });

  // ── Todas as fontes completas + erro técnico posterior (ex.: persistência) → status=failed, completeness=complete ──
  await rodarCenario("erro de persistencia apos tudo completo", {
    statusEsperado: "failed",
    completenessEsperado: "complete",
    montarStub: (db) => async ({ runId }) => {
      for (const source of ["orders", "shipments", "claims", "base"]) {
        await sourceService.iniciarFonte({ runId, source, db });
        await sourceService.marcarFonteCompleta({ runId, source, expectedCount: 1, receivedCount: 1, db });
      }
      const err = new Error("falha ao persistir resultado");
      err.code = "PERSIST_ERROR";
      throw err;
    },
  });

  console.log(`centralVendasSyncWorkerFailedCompleteness.test.js: ${checks} verificacoes OK`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
