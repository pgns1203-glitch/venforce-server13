// server/tests/centralVendasSyncSourceService.test.js
//
// M3 da fundação V3 da Central de Vendas — Completude por Fonte.
// Cobre: lifecycle da fonte (pending/ausente -> running -> terminal), guarda
// de transição (nunca terminal -> terminal), UNIQUE(sync_run_id, source) via
// UPSERT, rede de segurança (falharFontesEmAndamento) e a agregação de
// completude do run (calcularCompletudeDoRun) — incluindo a distinção entre
// falha estrutural (orders/base -> 'failed') e falha não-fatal (claims ->
// 'partial', nunca 'failed').
//
// Fake db mínimo, só para central_vendas_sync_sources — não precisa simular
// cliente_contas/ml_tokens porque este service não resolve identidade.

const assert = require("assert");
const sourceService = require("../services/centralVendas/centralVendasSyncSourceService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

function makeDb() {
  const rows = [];
  let nextId = 1;

  return {
    rows, // exposto para inspeção direta
    async query(sql, params = []) {
      if (sql.includes("INSERT INTO central_vendas_sync_sources")) {
        const [syncRunId, source] = params;
        let row = rows.find((r) => r.sync_run_id === syncRunId && r.source === source);
        const TERMINAL = new Set(["complete", "incomplete", "failed", "not_applicable"]);
        if (!row) {
          row = {
            id: nextId++, sync_run_id: syncRunId, source, status: "running", complete: null,
            expected_count: null, received_count: null, pages_expected: null, pages_received: null,
            attempts: 1, started_at: new Date().toISOString(), finished_at: null,
            error_code: null, http_status: null, error_message: null, metadata_json: {},
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          };
          rows.push(row);
          return { rows: [row] };
        }
        if (TERMINAL.has(row.status)) return { rows: [] }; // guarda: nunca reabre terminal
        row.status = "running";
        row.attempts += 1;
        row.started_at = row.started_at || new Date().toISOString();
        row.updated_at = new Date().toISOString();
        return { rows: [row] };
      }

      if (sql.includes("UPDATE central_vendas_sync_sources") && sql.includes("status = $3")) {
        const [
          syncRunId, source, status, complete, expectedCount, receivedCount,
          pagesExpected, pagesReceived, errorCode, httpStatus, errorMessage, metadataJson,
        ] = params;
        const TERMINAL = new Set(["complete", "incomplete", "failed", "not_applicable"]);
        const row = rows.find((r) => r.sync_run_id === syncRunId && r.source === source && !TERMINAL.has(r.status));
        if (!row) return { rows: [] };
        Object.assign(row, {
          status, complete, expected_count: expectedCount, received_count: receivedCount,
          pages_expected: pagesExpected, pages_received: pagesReceived, error_code: errorCode,
          http_status: httpStatus, error_message: errorMessage, metadata_json: JSON.parse(metadataJson),
          finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        });
        return { rows: [row] };
      }

      if (sql.includes("status = 'failed', complete = false") && sql.includes("IN ('pending', 'running')")) {
        const [syncRunId, errorCode, errorMessage] = params;
        const afetadas = rows.filter((r) => r.sync_run_id === syncRunId && (r.status === "pending" || r.status === "running"));
        for (const row of afetadas) {
          row.status = "failed";
          row.complete = false;
          row.error_code = errorCode;
          row.error_message = errorMessage;
          row.finished_at = new Date().toISOString();
          row.updated_at = new Date().toISOString();
        }
        return { rows: afetadas.map((r) => ({ source: r.source })) };
      }

      if (sql.includes("SELECT * FROM central_vendas_sync_sources WHERE sync_run_id = $1")) {
        const [syncRunId] = params;
        return { rows: rows.filter((r) => r.sync_run_id === syncRunId).sort((a, b) => a.id - b.id) };
      }

      throw new Error(`Fake db: SQL nao mapeado -> ${sql.slice(0, 120)}`);
    },
  };
}

async function run() {
  // ── LIFECYCLE ────────────────────────────────────────────────────────────

  // 1. iniciarFonte cria pending/ausente -> running.
  {
    const db = makeDb();
    const fonte = await sourceService.iniciarFonte({ runId: 1, source: "orders", db });
    eq("1: status running", fonte.status, "running");
    eq("1: attempts", fonte.attempts, 1);
  }

  // 2. marcarFonteCompleta grava expected/received/metadata.
  {
    const db = makeDb();
    await sourceService.iniciarFonte({ runId: 1, source: "orders", db });
    const fonte = await sourceService.marcarFonteCompleta({
      runId: 1, source: "orders", expectedCount: 587, receivedCount: 587, metadata: { receivedRaw: 587 }, db,
    });
    eq("2: status complete", fonte.status, "complete");
    eq("2: complete true", fonte.complete, true);
    eq("2: expected", fonte.expectedCount, 587);
    eq("2: metadata", fonte.metadata, { receivedRaw: 587 });
  }

  // 3. marcarFonteIncompleta grava errorCode.
  {
    const db = makeDb();
    await sourceService.iniciarFonte({ runId: 1, source: "shipments", db });
    const fonte = await sourceService.marcarFonteIncompleta({
      runId: 1, source: "shipments", expectedCount: 573, receivedCount: 570, errorCode: "SHIPMENTS_PARTIAL", db,
    });
    eq("3: status incomplete", fonte.status, "incomplete");
    eq("3: complete false", fonte.complete, false);
    eq("3: errorCode", fonte.errorCode, "SHIPMENTS_PARTIAL");
  }

  // 4. marcarFonteFalha grava httpStatus + errorCode (caso real: Claims HTTP 400).
  {
    const db = makeDb();
    await sourceService.iniciarFonte({ runId: 1, source: "claims", db });
    const fonte = await sourceService.marcarFonteFalha({
      runId: 1, source: "claims", errorCode: "CLAIMS_HTTP_400", httpStatus: 400, errorMessage: "bad request", db,
    });
    eq("4: status failed", fonte.status, "failed");
    eq("4: httpStatus", fonte.httpStatus, 400);
    eq("4: errorCode", fonte.errorCode, "CLAIMS_HTTP_400");
  }

  // 5. Nenhum campo sensível pode ser persistido em metadata.
  {
    const db = makeDb();
    await sourceService.iniciarFonte({ runId: 1, source: "orders", db });
    let lancou = false;
    try {
      await sourceService.marcarFonteCompleta({
        runId: 1, source: "orders", metadata: { access_token: "vazou" }, db,
      });
    } catch (err) {
      lancou = true;
      ok("5: mensagem menciona o campo sensivel", /access_token/.test(err.message));
    }
    ok("5: lancou", lancou);
  }

  // ── GUARDA DE TRANSIÇÃO E IDEMPOTÊNCIA ──────────────────────────────────

  // 6. UNIQUE(sync_run_id, source): duas chamadas a iniciarFonte para o mesmo
  //    par nunca criam duas linhas.
  {
    const db = makeDb();
    await sourceService.iniciarFonte({ runId: 1, source: "orders", db });
    await sourceService.iniciarFonte({ runId: 1, source: "orders", db });
    const fontes = await sourceService.listarFontesDoRun(1, db);
    eq("6: uma unica linha", fontes.length, 1);
  }

  // 7. Terminal -> terminal nunca sobrescreve silenciosamente (complete
  //    depois failed não aplica; a linha continua complete).
  {
    const db = makeDb();
    await sourceService.iniciarFonte({ runId: 1, source: "orders", db });
    await sourceService.marcarFonteCompleta({ runId: 1, source: "orders", expectedCount: 10, receivedCount: 10, db });
    const semEfeito = await sourceService.marcarFonteFalha({ runId: 1, source: "orders", errorCode: "X", db });
    ok("7: segunda transicao nao aplicou", semEfeito === null);
    const [fonte] = await sourceService.listarFontesDoRun(1, db);
    eq("7: status continua complete", fonte.status, "complete");
  }

  // 8. iniciarFonte nunca reabre uma fonte já terminal no mesmo run.
  {
    const db = makeDb();
    await sourceService.iniciarFonte({ runId: 1, source: "claims", db });
    await sourceService.marcarFonteFalha({ runId: 1, source: "claims", errorCode: "CLAIMS_HTTP_400", db });
    const semEfeito = await sourceService.iniciarFonte({ runId: 1, source: "claims", db });
    ok("8: reabertura bloqueada", semEfeito === null);
    const [fonte] = await sourceService.listarFontesDoRun(1, db);
    eq("8: continua failed", fonte.status, "failed");
  }

  // 9. Duas fontes do MESMO run não colidem entre si.
  {
    const db = makeDb();
    await sourceService.iniciarFonte({ runId: 1, source: "orders", db });
    await sourceService.iniciarFonte({ runId: 1, source: "claims", db });
    const fontes = await sourceService.listarFontesDoRun(1, db);
    eq("9: duas linhas", fontes.length, 2);
  }

  // 10. Fontes de RUNS diferentes nunca vazam entre si.
  {
    const db = makeDb();
    await sourceService.iniciarFonte({ runId: 1, source: "orders", db });
    await sourceService.iniciarFonte({ runId: 2, source: "orders", db });
    const fontesRun1 = await sourceService.listarFontesDoRun(1, db);
    eq("10: run 1 tem 1 fonte", fontesRun1.length, 1);
    eq("10: run 1 e o certo", fontesRun1[0].syncRunId, 1);
  }

  // ── REDE DE SEGURANÇA ────────────────────────────────────────────────────

  // 11. falharFontesEmAndamento fecha só pending/running deste run, nunca
  //     mexe em fontes já terminais nem de outro run.
  {
    const db = makeDb();
    await sourceService.iniciarFonte({ runId: 1, source: "orders", db });
    await sourceService.marcarFonteCompleta({ runId: 1, source: "orders", expectedCount: 1, receivedCount: 1, db });
    await sourceService.iniciarFonte({ runId: 1, source: "shipments", db }); // fica running
    await sourceService.iniciarFonte({ runId: 2, source: "claims", db }); // outro run, fica running

    const fechadas = await sourceService.falharFontesEmAndamento(1, { errorCode: "SYNC_EXECUTION_ERROR" }, db);
    eq("11: fechou so shipments", fechadas, ["shipments"]);

    const fontesRun1 = await sourceService.listarFontesDoRun(1, db);
    const orders = fontesRun1.find((f) => f.source === "orders");
    const shipments = fontesRun1.find((f) => f.source === "shipments");
    eq("11: orders continua complete", orders.status, "complete");
    eq("11: shipments virou failed", shipments.status, "failed");

    const fontesRun2 = await sourceService.listarFontesDoRun(2, db);
    eq("11: run 2 intocado", fontesRun2[0].status, "running");
  }

  // ── AGREGAÇÃO (calcularCompletudeDoRun) ─────────────────────────────────

  // 12. Nenhuma fonte registrada, run AINDA queued/running → 'unknown'
  //     (seção 2 do hardening: ausência pode só significar "ainda não
  //     chegou a vez dela").
  {
    const db = makeDb();
    const completude = await sourceService.calcularCompletudeDoRun(1, { runStatus: "queued", db });
    eq("12: status unknown (run em andamento)", completude.status, "unknown");
  }

  // 12b. Nenhuma fonte registrada, run já terminal (ou runStatus omitido —
  //      comportamento estrito por padrão) → 'partial', TODAS as 4
  //      obrigatórias aparecem em missingSources. Nunca 'complete' por
  //      omissão total de evidência.
  {
    const db = makeDb();
    const completude = await sourceService.calcularCompletudeDoRun(1, { runStatus: "completed", db });
    eq("12b: status partial (run terminal, zero fontes)", completude.status, "partial");
    eq("12b: todas ausentes", completude.missingSources.sort(), ["base", "claims", "orders", "shipments"]);
  }

  // 13. Todas completas (incluindo returns) → 'complete'.
  {
    const db = makeDb();
    for (const source of ["orders", "shipments", "claims", "base", "returns"]) {
      await sourceService.iniciarFonte({ runId: 1, source, db });
      await sourceService.marcarFonteCompleta({ runId: 1, source, expectedCount: 1, receivedCount: 1, db });
    }
    const completude = await sourceService.calcularCompletudeDoRun(1, { db });
    eq("13: status complete", completude.status, "complete");
    eq("13: sem incompletas", completude.incompleteSources, []);
    eq("13: sem falhas", completude.failedSources, []);
    eq("13: sem ausentes", completude.missingSources, []);
    eq("13: requiredSources inclui returns (foi registrada)", completude.requiredSources.sort(), ["base", "claims", "orders", "returns", "shipments"]);
  }

  // 14. Claims failed, restante complete → 'partial' (NUNCA 'failed' — claims
  //     não é estrutural, seção 21/61 teste #30 da spec M3).
  {
    const db = makeDb();
    for (const source of ["orders", "shipments", "base"]) {
      await sourceService.iniciarFonte({ runId: 1, source, db });
      await sourceService.marcarFonteCompleta({ runId: 1, source, expectedCount: 1, receivedCount: 1, db });
    }
    await sourceService.iniciarFonte({ runId: 1, source: "claims", db });
    await sourceService.marcarFonteFalha({ runId: 1, source: "claims", errorCode: "CLAIMS_HTTP_400", httpStatus: 400, db });
    await sourceService.iniciarFonte({ runId: 1, source: "returns", db });
    await sourceService.marcarFonteIncompleta({ runId: 1, source: "returns", errorCode: "RETURNS_BLOCKED_BY_CLAIMS", db });

    const completude = await sourceService.calcularCompletudeDoRun(1, { db });
    eq("14: status partial", completude.status, "partial");
    eq("14: failedSources", completude.failedSources, ["claims"]);
    eq("14: incompleteSources", completude.incompleteSources, ["returns"]);
  }

  // 15. Orders truncado (incomplete, não failed) → 'partial'.
  {
    const db = makeDb();
    await sourceService.iniciarFonte({ runId: 1, source: "orders", db });
    await sourceService.marcarFonteIncompleta({
      runId: 1, source: "orders", expectedCount: 7300, receivedCount: 5000, errorCode: "ORDERS_TRUNCATED_BY_SAFETY_LIMIT", db,
    });
    for (const source of ["shipments", "claims", "base"]) {
      await sourceService.iniciarFonte({ runId: 1, source, db });
      await sourceService.marcarFonteCompleta({ runId: 1, source, expectedCount: 1, receivedCount: 1, db });
    }
    const completude = await sourceService.calcularCompletudeDoRun(1, { db });
    eq("15: status partial", completude.status, "partial");
  }

  // 16. Orders falhou de verdade (fatal) → 'failed' (fonte estrutural).
  {
    const db = makeDb();
    await sourceService.iniciarFonte({ runId: 1, source: "orders", db });
    await sourceService.marcarFonteFalha({ runId: 1, source: "orders", errorCode: "ORDERS_HTTP_ERROR", httpStatus: 500, db });
    const completude = await sourceService.calcularCompletudeDoRun(1, { db });
    eq("16: status failed", completude.status, "failed");
  }

  // 17. Base falhou (BASE_QUERY_ERROR, também estrutural) → 'failed'.
  {
    const db = makeDb();
    await sourceService.iniciarFonte({ runId: 1, source: "base", db });
    await sourceService.marcarFonteFalha({ runId: 1, source: "base", errorCode: "BASE_QUERY_ERROR", db });
    const completude = await sourceService.calcularCompletudeDoRun(1, { db });
    eq("17: status failed", completude.status, "failed");
  }

  // 18. P0 do hardening: orders/claims/base complete, shipments NUNCA
  //     registrada (nenhuma linha) → 'partial', missingSources=['shipments'].
  //     Este é exatamente o cenário que o agregador antigo (baseado só nas
  //     linhas existentes) deixava passar como 'complete' silenciosamente.
  {
    const db = makeDb();
    for (const source of ["orders", "claims", "base"]) {
      await sourceService.iniciarFonte({ runId: 1, source, db });
      await sourceService.marcarFonteCompleta({ runId: 1, source, expectedCount: 1, receivedCount: 1, db });
    }
    const completude = await sourceService.calcularCompletudeDoRun(1, { runStatus: "completed", db });
    eq("18: status partial", completude.status, "partial");
    eq("18: missingSources", completude.missingSources, ["shipments"]);
    eq("18: nunca complete", completude.status !== "complete", true);
  }

  // 19. Simétrico: orders/shipments/base complete, claims nunca registrada.
  {
    const db = makeDb();
    for (const source of ["orders", "shipments", "base"]) {
      await sourceService.iniciarFonte({ runId: 1, source, db });
      await sourceService.marcarFonteCompleta({ runId: 1, source, expectedCount: 1, receivedCount: 1, db });
    }
    const completude = await sourceService.calcularCompletudeDoRun(1, { runStatus: "completed", db });
    eq("19: status partial", completude.status, "partial");
    eq("19: missingSources", completude.missingSources, ["claims"]);
  }

  // 20. Mesmo cenário do 18, mas o run AINDA está running — shipments pode
  //     legitimamente ainda não ter rodado. Vira 'unknown', não 'partial'.
  {
    const db = makeDb();
    for (const source of ["orders", "claims", "base"]) {
      await sourceService.iniciarFonte({ runId: 1, source, db });
      await sourceService.marcarFonteCompleta({ runId: 1, source, expectedCount: 1, receivedCount: 1, db });
    }
    const completude = await sourceService.calcularCompletudeDoRun(1, { runStatus: "running", db });
    eq("20: status unknown (run ainda em andamento)", completude.status, "unknown");
  }

  console.log(`centralVendasSyncSourceService.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
