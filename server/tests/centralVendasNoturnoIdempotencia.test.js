// server/tests/centralVendasNoturnoIdempotencia.test.js
//
// Manual × cron concorrentes na MESMA conta/período: com o criarSyncRun REAL
// (dedupe + índice único parcial) e o marcarRunRunning REAL (reivindicação
// atômica queued → running), duas chamadas simultâneas nunca produzem duas
// ingestões independentes — o cron reaproveita/observa o run do manual (ou
// vice-versa).
//
// Fake db mínimo em memória: responde só às queries de criarSyncRun
// (clientes, cliente_contas, ml_tokens, vínculos de base, stale, dedupe,
// INSERT com conflito 23505), das transições de estado e de obterSyncRun.
// Cada query cede o event loop (setImmediate) para as corridas acontecerem de
// verdade. NENHUM banco real: DATABASE_URL aponta para porta morta.

process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/teste-sem-banco";

const assert = require("assert");
const runService = require("../services/centralVendas/centralVendasSyncRunService");
const svc = require("../services/centralVendas/centralVendasNoturnoService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

const cliente = { id: 1, nome: "Cliente A", slug: "cliente-a", ativo: true };
const conta = {
  id: 11, cliente_id: 1, marketplace: "meli", nome: "Conta A", slug: "cliente-a-meli",
  external_account_id: "5001", is_primary: true, ativo: true, metadata_json: {},
};
const grant = {
  id: 91, cliente_id: 1, ml_user_id: "5001", cliente_conta_id: 11,
  access_token: "tok-segredo", refresh_token: "ref-segredo",
  expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  token_status: "valid", is_primary: true, refresh_failures: 0, updated_at: new Date().toISOString(),
};

function makeDb() {
  const runs = [];
  let nextId = 1;
  const same = (a, b) => (a ?? null) === (b ?? null);
  const ativo = (p) => runs.find((r) =>
    r.cliente_id === p[0] && same(r.cliente_conta_id, p[1]) && r.marketplace === p[2]
    && r.date_from === p[3] && r.date_to === p[4] && (r.status === "queued" || r.status === "running")) || null;

  return {
    runs,
    publicados: new Set(),
    async query(sql, params = []) {
      await new Promise((resolve) => setImmediate(resolve));
      if (/CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX|ALTER TABLE/.test(sql)) return { rows: [] };
      if (sql.includes("FROM clientes WHERE slug = $1 AND ativo = true")) return { rows: params[0] === cliente.slug ? [cliente] : [] };
      if (sql.includes("FROM clientes WHERE id = $1")) return { rows: params[0] === cliente.id ? [cliente] : [] };
      if (sql.includes("FROM cliente_contas WHERE id = $1")) return { rows: Number(params[0]) === conta.id ? [conta] : [] };
      if (sql.includes("COUNT(*)::int AS total FROM cliente_contas")) return { rows: [{ total: 1 }] };
      if (sql.includes("t.cliente_id = $1 AND t.ml_user_id = $2")) return { rows: [grant] };
      if (sql.includes("FROM base_cliente_vinculos")) return { rows: [] };
      if (sql.includes("SYNC_RUN_STALE_QUEUED") || sql.includes("SYNC_RUN_STALE_RUNNING")) return { rows: [] };
      if (sql.includes("FROM central_vendas_sync_runs") && sql.includes("status IN ('queued','running')") && !sql.includes("JOIN clientes")) {
        const row = ativo(params);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("INSERT INTO central_vendas_sync_runs")) {
        const [clienteId, clienteSlug, clienteContaId, marketplace, ext, grantId, baseId, baseMode, dateFrom, dateTo, requestedBy] = params;
        if (ativo([clienteId, clienteContaId, marketplace, dateFrom, dateTo])) {
          const err = new Error("duplicate key value violates unique constraint \"uq_central_vendas_sync_runs_ativo_v2\"");
          err.code = "23505";
          throw err;
        }
        const row = {
          id: nextId++, cliente_id: clienteId, cliente_slug: clienteSlug, cliente_conta_id: clienteContaId,
          marketplace, external_account_id: ext, grant_id: grantId, base_id: baseId, base_resolution_mode: baseMode,
          date_from: dateFrom, date_to: dateTo, status: "queued", requested_by: requestedBy,
          created_at: new Date().toISOString(), started_at: null, finished_at: null, metadata_json: {},
        };
        runs.push(row);
        return { rows: [row] };
      }
      if (sql.includes("UPDATE central_vendas_sync_runs") && sql.includes("started_at = NOW()")) {
        const row = runs.find((r) => r.id === params[0] && r.status === "queued");
        if (!row) return { rows: [] };
        row.status = "running";
        row.started_at = new Date().toISOString();
        return { rows: [row] };
      }
      if (sql.includes("UPDATE central_vendas_sync_runs") && sql.includes("status = 'completed'")) {
        const row = runs.find((r) => r.id === params[0] && r.status === "running");
        if (!row) return { rows: [] };
        row.status = "completed";
        row.completeness_status = "complete";
        return { rows: [row] };
      }
      if (sql.includes("JOIN clientes c ON c.id = r.cliente_id") && sql.includes("r.id = $1 AND c.slug = $2")) {
        const row = runs.find((r) => r.id === params[0] && params[1] === cliente.slug);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("FROM central_vendas_imports") && sql.includes("sync_run_id = $1")) {
        return { rows: this.publicados.has(params[0]) ? [{ id: 700 + params[0], competencia: "2026-09" }] : [] };
      }
      throw new Error(`SQL inesperado no teste: ${sql.slice(0, 90)}`);
    },
  };
}

// Executor com a MESMA reivindicação atômica de executarSyncRun
// (marcarRunRunning real: UPDATE ... WHERE status='queued'). Conta ingestões:
// é exatamente o que não pode passar de 1 por run.
function makeExecutor(db, { duracaoMs = 20 } = {}) {
  const stats = { ingestoes: 0, porRun: new Map() };
  async function executarSyncRun({ run }) {
    const marcado = await runService.marcarRunRunning(run.id, db);
    if (!marcado) return null;
    stats.ingestoes += 1;
    stats.porRun.set(run.id, (stats.porRun.get(run.id) || 0) + 1);
    await new Promise((resolve) => setTimeout(resolve, duracaoMs));
    await runService.marcarRunCompleted(run.id, { ordersEncontrados: 0 }, db);
    db.publicados.add(run.id);
    return { ok: true };
  }
  return { executarSyncRun, stats };
}

function depsCron(db, executarSyncRun) {
  return {
    db,
    criarSyncRun: runService.criarSyncRun,
    obterSyncRun: runService.obterSyncRun,
    executarSyncRun,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    agora: () => Date.now(),
    observarIntervaloMs: 5,
    observarTimeoutMs: 5000,
    logger: { log() {}, warn() {}, error() {} },
  };
}

const unidade = {
  conta: { clienteId: 1, clienteSlug: "cliente-a", clienteContaId: 11 },
  periodo: { competencia: "2026-09", dateFrom: "2026-09-01", dateTo: "2026-09-23" },
};

// Caminho manual = exatamente o do controller POST /:slug/sincronizar.
async function manual(db, executarSyncRun) {
  const { run, context } = await runService.criarSyncRun({
    clienteSlug: "cliente-a", clienteContaId: 11, marketplace: "meli",
    dateFrom: "2026-09-01", dateTo: "2026-09-23", requestedBy: 7, db,
  });
  const data = await executarSyncRun({ run, context, params: {}, db });
  return { run, data };
}

async function run() {
  // 1. Manual e cron disparados no MESMO instante.
  {
    const db = makeDb();
    const { executarSyncRun, stats } = makeExecutor(db);
    const [m, c] = await Promise.all([
      manual(db, executarSyncRun),
      svc.processarUnidade(unidade, depsCron(db, executarSyncRun)),
    ]);
    eq("corrida: um único run criado", db.runs.length, 1);
    eq("corrida: uma única ingestão", stats.ingestoes, 1);
    eq("corrida: manual e cron no mesmo run", c.runId, m.run.id);
    eq("corrida: run terminou completed", db.runs[0].status, "completed");
    eq("corrida: cron conclui com sucesso (ou observando)", c.status, "sucesso");
    ok("corrida: exatamente um dos dois executou", (m.data !== null) !== (c.executadoPor === "cron"));
  }

  // 2. Manual já rodando (clique às 02:59) → cron reaproveita e OBSERVA.
  {
    const db = makeDb();
    const { executarSyncRun, stats } = makeExecutor(db, { duracaoMs: 60 });
    const manualPromise = manual(db, executarSyncRun);
    await new Promise((resolve) => setTimeout(resolve, 15));
    ok("manual em andamento antes do cron", db.runs[0] && db.runs[0].status === "running");
    const c = await svc.processarUnidade(unidade, depsCron(db, executarSyncRun));
    await manualPromise;
    eq("observa: run reaproveitado", c.reaproveitado, true);
    eq("observa: cron não executou", c.executadoPor, "outro_processo");
    eq("observa: esperou o fim e reporta sucesso", c.status, "sucesso");
    eq("observa: publicado detectado", c.publicado, true);
    eq("observa: uma ingestão", stats.ingestoes, 1);
    eq("observa: um run", db.runs.length, 1);
  }

  // 3. Duas instâncias do cron sobrepostas (ex.: disparo manual do Cron Job
  //    enquanto o agendado roda) → mesmo run, uma ingestão.
  {
    const db = makeDb();
    const { executarSyncRun, stats } = makeExecutor(db);
    const [a, b] = await Promise.all([
      svc.processarUnidade(unidade, depsCron(db, executarSyncRun)),
      svc.processarUnidade(unidade, depsCron(db, executarSyncRun)),
    ]);
    eq("cron×cron: um run", db.runs.length, 1);
    eq("cron×cron: uma ingestão", stats.ingestoes, 1);
    eq("cron×cron: mesmo runId", a.runId, b.runId);
    ok("cron×cron: um executou, o outro reaproveitou", [a.reaproveitado, b.reaproveitado].filter(Boolean).length === 1);
    eq("cron×cron: ambos sucesso", [a.status, b.status], ["sucesso", "sucesso"]);
  }

  // 4. Depois de concluído, uma nova rodada para a mesma tupla cria um run
  //    NOVO (re-sincronizar é legítimo); o anterior continua completed.
  {
    const db = makeDb();
    const { executarSyncRun, stats } = makeExecutor(db, { duracaoMs: 1 });
    const primeiro = await svc.processarUnidade(unidade, depsCron(db, executarSyncRun));
    const segundo = await svc.processarUnidade(unidade, depsCron(db, executarSyncRun));
    ok("sequencial: runs diferentes", primeiro.runId !== segundo.runId);
    eq("sequencial: 2 ingestões, uma por run", [...stats.porRun.values()], [1, 1]);
    eq("sequencial: nenhum run preso em queued/running", db.runs.map((r) => r.status), ["completed", "completed"]);
  }

  console.log(`centralVendasNoturnoIdempotencia.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
