// server/tests/pgConexaoPerdidaNaoDerrubaProcesso.test.js
//
// Incidente 2026-10-09: o PostgreSQL de produção entrou em recuperação de
// crash durante a recuperação de boot do sync noturno (run da conta grande) e
// derrubou TODAS as sessões. O `pg` emite 'error' no Client quando o socket
// fecha sem client.end() ("Connection terminated unexpectedly"); o pg-pool só
// escuta 'error' em conexão OCIOSA — conexão checada (transação, advisory
// lock de sessão) ficava sem listener, e EventEmitter sem listener de 'error'
// lança: o processo Node inteiro caiu.
//
// Parte 1 — `pg` e `pg-pool` REAIS contra um servidor PostgreSQL falso (TCP,
// protocolo mínimo) que derruba os sockets. Cada cenário roda num processo
// filho: o critério "o processo não cai" é o exit code dele.
//   A/B  transação com query em voo + "Connection terminated unexpectedly"
//   C    erro com o advisory lock da rodada ativo
//   D    erro durante a recuperação de boot (scheduler real, lock real)
//   E    limpeza: conexão descartada do pool, lock sem unlock em sessão morta
//   F    nenhum 'error' não tratado (processo vivo, exit 0)
// Parte 2 — worker (executarSyncRun) com banco falso:
//   G    run termina failed com código explícito SYNC_DB_CONNECTION_LOST,
//        mesmo com o banco ainda em recuperação nas primeiras tentativas
//   H    banco fora por mais tempo: erro ORIGINAL sobe, run fica running e o
//        próximo boot o reconcilia (SYNC_RUN_PROCESS_RESTART)
// (I — sem dois runs ativos da mesma conta/período depois da falha: cenário 6
//  de centralVendasNoturnoIdempotencia.test.js, com criarSyncRun real.)

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://nobody@127.0.0.1:1/teste-sem-banco";

const assert = require("assert");
const path = require("path");
const { spawnSync } = require("child_process");

let checks = 0;
let concluido = false;
process.on("exit", () => {
  if (!concluido) {
    console.error(`pgConexaoPerdidaNaoDerrubaProcesso.test.js: NÃO concluiu (parou após ${checks} verificações)`);
    process.exitCode = 1;
  }
});
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

const CENARIO = path.join(__dirname, "helpers", "pgConexaoPerdidaCenario.js");
function rodarCenario(cenario, modo) {
  const r = spawnSync(process.execPath, [CENARIO, cenario, modo], { encoding: "utf8", timeout: 30000 });
  const linha = String(r.stdout || "").trim().split("\n").filter(Boolean).pop();
  let saida = null;
  try { saida = linha ? JSON.parse(linha) : null; } catch { saida = null; }
  return { status: r.status, stderr: String(r.stderr || ""), saida };
}

function parte1() {
  // Reprodução do crash (Pool como estava em produção, sem proteção).
  {
    const r = rodarCenario("transacao", "cru");
    ok("REPRO transação sem proteção: processo cai", r.status !== 0);
    ok("REPRO: mesma mensagem da Render", r.stderr.includes("Error: Connection terminated unexpectedly"));
    ok("REPRO: emitido no Client (conexão checada do pool)", r.stderr.includes("Emitted 'error' event on Client instance"));
  }
  {
    const r = rodarCenario("ocioso", "cru");
    ok("REPRO conexão ociosa sem listener no pool: processo cai", r.status !== 0);
    ok("REPRO ocioso: emitido no Pool", r.stderr.includes("Emitted 'error' event on BoundPool instance"));
  }

  // A/B/E/F — transação com query em voo.
  {
    const r = rodarCenario("transacao", "protegido");
    eq("A/F transação: processo vivo (exit 0)", r.status, 0);
    eq("B transação: a operação falha com o erro da conexão", [r.saida?.resultado, r.saida?.erro], ["rejeitou", "Connection terminated unexpectedly"]);
    eq("E transação: conexão morta descartada do pool", r.saida?.poolTotal, 0);
    ok("A transação: perda registrada no log (não engolida)", (r.saida?.logs || []).some((l) => l.startsWith("[db] conexão com o PostgreSQL perdida")));
  }

  // Conexão ociosa no pool.
  {
    const r = rodarCenario("ocioso", "protegido");
    eq("F ocioso: processo vivo", r.status, 0);
    eq("E ocioso: conexão removida do pool", r.saida?.poolTotal, 0);
  }

  // C/E — advisory lock da rodada (o lock tem listener próprio: protegido
  // mesmo num pool sem a proteção global).
  for (const modo of ["cru", "protegido"]) {
    const r = rodarCenario("lock", modo);
    eq(`C lock (${modo}): processo vivo`, r.status, 0);
    eq(`C lock (${modo}): adquirido e depois perdido`, [r.saida?.adquirido, r.saida?.perdido], [true, true]);
    eq(`E lock (${modo}): sem unlock numa sessão morta`, r.saida?.unlockEnviado, false);
    eq(`E lock (${modo}): conexão do lock descartada`, r.saida?.poolTotal, 0);
    ok(`C lock (${modo}): perda do lock registrada`, (r.saida?.logs || []).some((l) => l.includes("lock global perdido")));
  }

  // D/H — recuperação de boot com o lock real.
  {
    const r = rodarCenario("recuperacao", "protegido");
    eq("D recuperação: processo vivo", r.status, 0);
    eq("D recuperação: falha controlada", r.saida?.primeira, { executada: false, motivo: "ERRO_RODADA" });
    eq("D recuperação: scheduler liberado (sem 'em andamento' preso)", r.saida?.emExecucaoDepois, false);
    eq("H nova tentativa obtém o lock de novo e recupera", r.saida?.segunda, { executada: true, recuperacao: true });
    eq("H dois pedidos de lock (um por tentativa)", r.saida?.locksPedidos, 2);
  }

  // O pool de produção nasce protegido.
  {
    const pool = require("../config/database");
    ok("config/database.js: listener em toda conexão nova", pool.listenerCount("connect") >= 1);
    ok("config/database.js: listener de 'error' no pool", pool.listenerCount("error") >= 1);
  }
}

// ---------------------------------------------------------------------------
// Parte 2 — worker
// ---------------------------------------------------------------------------

const runService = require("../services/centralVendas/centralVendasSyncRunService");
const sourceService = require("../services/centralVendas/centralVendasSyncSourceService");
const worker = require("../services/centralVendas/centralVendasSyncWorker");
const { isPgConnectionError } = require("../services/centralVendas/centralVendasTransientRetry");

function erroConexao() {
  return new Error("Connection terminated unexpectedly");
}
function erroEmRecuperacao() {
  const err = new Error("the database system is in recovery mode");
  err.code = "57P03";
  return err;
}

// Banco falso: runs + sources. `indisponivel(n)` faz as próximas n queries
// falharem como "banco em recuperação" (o PostgreSQL voltando do crash).
function makeDb() {
  const runs = [];
  const sources = [];
  let falhasPendentes = 0;
  return {
    runs,
    sources,
    indisponivel(n) { falhasPendentes = n; },
    async query(sql, params = []) {
      if (falhasPendentes > 0) {
        falhasPendentes -= 1;
        throw erroEmRecuperacao();
      }
      if (sql.includes("UPDATE central_vendas_sync_runs") && sql.includes("started_at = NOW()")) {
        const row = runs.find((r) => r.id === params[0] && r.status === "queued");
        if (!row) return { rows: [] };
        Object.assign(row, { status: "running", started_at: new Date(Date.now() - 60000).toISOString() });
        return { rows: [row] };
      }
      if (sql.includes("SYNC_RUN_PROCESS_RESTART")) {
        const antes = new Date(params[0]).getTime();
        const afetados = runs.filter((r) => r.requested_by == null && r.status === "running" && new Date(r.started_at).getTime() < antes);
        for (const r of afetados) Object.assign(r, { status: "failed", error_code: "SYNC_RUN_PROCESS_RESTART" });
        return { rows: afetados.map((r) => ({ id: r.id, date_from: r.date_from, date_to: r.date_to })) };
      }
      if (sql.includes("UPDATE central_vendas_sync_runs") && sql.includes("status = 'failed'")) {
        const row = runs.find((r) => r.id === params[0] && r.status === "running");
        if (!row) return { rows: [] };
        Object.assign(row, { status: "failed", error_code: params[1], error_message: params[2] });
        return { rows: [row] };
      }
      if (sql.includes("UPDATE central_vendas_sync_runs") && sql.includes("completeness_status = $2")) {
        const row = runs.find((r) => r.id === params[0]);
        if (row) row.completeness_status = params[1];
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("status = 'failed', complete = false") && sql.includes("IN ('pending', 'running')")) {
        const afetadas = sources.filter((r) => r.sync_run_id === params[0] && (r.status === "pending" || r.status === "running"));
        for (const row of afetadas) Object.assign(row, { status: "failed", complete: false, error_code: params[1] });
        return { rows: afetadas.map((r) => ({ source: r.source })) };
      }
      if (sql.includes("SELECT * FROM central_vendas_sync_sources WHERE sync_run_id = $1")) {
        return { rows: sources.filter((r) => r.sync_run_id === params[0]) };
      }
      throw new Error(`Fake db: SQL não mapeado -> ${sql.slice(0, 120)}`);
    },
  };
}

let proximoRunId = 776;
function novoRun(db) {
  const row = {
    id: proximoRunId++, status: "queued", cliente_id: 1, cliente_slug: "cliente-grande", cliente_conta_id: 66,
    marketplace: "meli", date_from: "2026-10-01", date_to: "2026-10-07", requested_by: null,
    created_at: new Date().toISOString(), started_at: null, metadata_json: {}, completeness_status: null,
  };
  db.runs.push(row);
  // Coleta já em andamento quando a conexão cai (shipments ainda running).
  db.sources.push(
    { id: 1, sync_run_id: row.id, source: "orders", status: "complete", complete: true },
    { id: 2, sync_run_id: row.id, source: "shipments", status: "running", complete: null },
  );
  return runService.sanitizeRun(row);
}

const params = { clienteSlug: "cliente-grande", dateFrom: "2026-10-01", dateTo: "2026-10-07", marketplace: "meli" };

async function parte2() {
  // Classificação: só sinais do pg/PostgreSQL contam como conexão perdida.
  ok("classifica 'Connection terminated unexpectedly'", isPgConnectionError(erroConexao()));
  ok("classifica 57P02 crash_shutdown", isPgConnectionError(Object.assign(new Error("x"), { code: "57P02" })));
  ok("classifica 57P03 em recuperação", isPgConnectionError(erroEmRecuperacao()));
  ok("classifica 08006 connection_failure", isPgConnectionError(Object.assign(new Error("x"), { code: "08006" })));
  ok("classifica client não consultável", isPgConnectionError(new Error("Client has encountered a connection error and is not queryable")));
  ok("NÃO classifica ECONNRESET de HTTP", !isPgConnectionError(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })));
  ok("NÃO classifica deadlock", !isPgConnectionError(Object.assign(new Error("deadlock"), { code: "40P01" })));
  ok("NÃO classifica erro comum", !isPgConnectionError(new Error("orders 500")));

  // G — conexão cai na gravação; o banco ainda recusa as 2 primeiras queries
  // do fechamento (recuperação de crash) e volta.
  {
    const db = makeDb();
    const run = novoRun(db);
    const esperas = [];
    let erro = null;
    try {
      await worker.executarSyncRun({
        run, context: {}, params, db,
        sleep: async (ms) => { esperas.push(ms); },
        sincronizarVendasMeli: async () => {
          db.indisponivel(2);
          throw erroConexao();
        },
      });
    } catch (err) {
      erro = err;
    }
    eq("G: o erro original sobe", erro?.message, "Connection terminated unexpectedly");
    const final = db.runs.find((r) => r.id === run.id);
    eq("G: run termina failed", final.status, "failed");
    eq("G: código explícito", final.error_code, "SYNC_DB_CONNECTION_LOST");
    eq("G: fonte em andamento fechada como failed", db.sources.find((s) => s.source === "shipments").status, "failed");
    eq("G: esperou o banco voltar (2 tentativas com backoff)", esperas, [500, 1000]);
  }

  // Erro que NÃO é de conexão mantém o código de sempre (sem espera).
  {
    const db = makeDb();
    const run = novoRun(db);
    const esperas = [];
    await worker.executarSyncRun({
      run, context: {}, params, db,
      sleep: async (ms) => { esperas.push(ms); },
      sincronizarVendasMeli: async () => { throw Object.assign(new Error("orders 500"), { code: "ORDERS_HTTP_ERROR" }); },
    }).catch(() => {});
    const final = db.runs.find((r) => r.id === run.id);
    eq("regressão: erro comum mantém err.code", [final.status, final.error_code], ["failed", "ORDERS_HTTP_ERROR"]);
    eq("regressão: erro comum sem retry de fechamento", esperas, []);
  }

  // H — banco fora durante TODAS as tentativas de fechamento: o erro original
  // sobe (não o da limpeza), o run fica running e o próximo boot o reconcilia.
  {
    const db = makeDb();
    const run = novoRun(db);
    const esperas = [];
    let erro = null;
    const errosOriginais = console.error;
    const logs = [];
    console.error = (...a) => logs.push(a.join(" "));
    try {
      await worker.executarSyncRun({
        run, context: {}, params, db,
        sleep: async (ms) => { esperas.push(ms); },
        sincronizarVendasMeli: async () => {
          db.indisponivel(1000);
          throw erroConexao();
        },
      });
    } catch (err) {
      erro = err;
    } finally {
      console.error = errosOriginais;
    }
    db.indisponivel(0);
    eq("H: erro ORIGINAL sobe (não o da limpeza)", erro?.message, "Connection terminated unexpectedly");
    eq("H: tentativas de fechamento limitadas", esperas, [500, 1000, 2000, 4000]);
    ok("H: falha ao fechar registrada", logs.some((l) => l.includes(`sync-run #${run.id} não foi possível marcar como failed (SYNC_DB_CONNECTION_LOST)`)));
    eq("H: run ficou running (sem processo)", db.runs.find((r) => r.id === run.id).status, "running");
    const fechados = await runService.reconciliarRunsNoturnosInterrompidos({ antesDe: new Date().toISOString(), db });
    eq("H: próximo boot reconcilia o órfão", fechados.map((r) => r.id), [run.id]);
    eq("H: código do boot", db.runs.find((r) => r.id === run.id).error_code, "SYNC_RUN_PROCESS_RESTART");
  }
}

async function main() {
  parte1();
  await parte2();
  concluido = true;
  console.log(`pgConexaoPerdidaNaoDerrubaProcesso.test.js: ${checks} verificações OK`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
