// server/tests/centralVendasDatasDate.test.js
//
// Incidente 2026-10-02 — 201 falhas do agendador da Central de Vendas:
// "dateFrom e dateTo (YYYY-MM-DD) sao obrigatorios."
//
// Causa: as colunas date_from/date_to de central_vendas_sync_runs são DATE e o
// driver `pg` devolve um objeto Date (meia-noite LOCAL). A recuperação no boot
// (listarPeriodosNoturnosPendentes) fazia String(Date).slice(0, 10) e obtinha
// "Thu Oct 01", que o criarSyncRun recusa. O teste antigo (mock devolvendo
// strings já formatadas) nunca exercitou o tipo real.
//
// Aqui TODA Date vem do parser REAL do pg (pg-types, OID 1082) — nunca de uma
// Date montada à mão — e o checks sensíveis a fuso rodam em subprocessos com
// TZ diferentes (inclusive a leste de UTC, onde toISOString erraria o dia).
// NENHUM banco real: DATABASE_URL aponta para porta morta.

process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/teste-sem-banco";

const assert = require("assert");
const path = require("path");
const { spawnSync } = require("child_process");
const types = require("pg-types");

const runService = require("../services/centralVendas/centralVendasSyncRunService");
const svc = require("../services/centralVendas/centralVendasNoturnoService");

const SO_FUSO = process.argv[2] === "--fuso";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

let checks = 0;
let concluido = false;
process.on("exit", () => {
  if (!concluido) {
    console.error(`centralVendasDatasDate.test.js${SO_FUSO ? ` [TZ=${process.env.TZ}]` : ""}: NÃO concluiu (parou após ${checks} verificações)`);
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

// Exatamente o que o pg entrega para uma coluna DATE.
const dateDoPg = (iso) => types.getTypeParser(1082)(iso);

function linhaDeRun(extra = {}) {
  return {
    id: "7", status: "queued", cliente_id: "1", cliente_slug: "cli", cliente_conta_id: "5", marketplace: "meli",
    external_account_id: "ML5", grant_id: null, base_id: null, base_resolution_mode: null,
    date_from: dateDoPg("2026-10-01"), date_to: dateDoPg("2026-10-31"),
    completeness_status: null, created_at: new Date(), started_at: null, finished_at: null,
    error_code: null, error_message: null, metadata_json: {},
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Parte sensível a fuso: roda no processo atual E em subprocessos com TZ distintos.
// ---------------------------------------------------------------------------
async function checksSensiveisAFuso() {
  // O parser do pg realmente entrega Date (premissa do incidente).
  ok("premissa: o pg entrega Date para DATE", Object.prototype.toString.call(dateDoPg("2026-10-01")) === "[object Date]");
  ok("premissa: String(Date).slice(0,10) NÃO é YYYY-MM-DD (o bug)", !ISO.test(String(dateDoPg("2026-10-01")).slice(0, 10)));

  ok("formatarDiaIso é exportado", typeof runService.formatarDiaIso === "function");
  const f = runService.formatarDiaIso;

  // Date real do pg → dia correto, em qualquer fuso.
  eq("Date 2026-10-01", f(dateDoPg("2026-10-01")), "2026-10-01");
  eq("Date 2026-12-31 (virada de ano)", f(dateDoPg("2026-12-31")), "2026-12-31");
  eq("Date 2026-01-01 (virada de ano)", f(dateDoPg("2026-01-01")), "2026-01-01");
  eq("Date 2026-03-01", f(dateDoPg("2026-03-01")), "2026-03-01");
  eq("Date 2028-02-29 (bissexto)", f(dateDoPg("2028-02-29")), "2028-02-29");

  // Ida e volta para todo dia do período do incidente e para fevereiro bissexto.
  const dias = [];
  for (let d = new Date(Date.UTC(2026, 8, 1)); d <= new Date(Date.UTC(2026, 10, 30)); d = new Date(d.getTime() + 86400000)) {
    dias.push(d.toISOString().slice(0, 10));
  }
  for (const iso of ["2028-02-28", "2028-02-29", "2028-03-01"]) dias.push(iso);
  const errados = dias.filter((iso) => f(dateDoPg(iso)) !== iso);
  eq(`ida e volta Date→dia em ${dias.length} dias`, errados, []);

  // Entradas que já são texto, nulas ou inválidas.
  eq("string YYYY-MM-DD", f("2026-10-01"), "2026-10-01");
  eq("string ISO com hora", f("2026-10-01T03:00:00.000Z"), "2026-10-01");
  eq("null", f(null), null);
  eq("undefined", f(undefined), null);
  eq("string vazia", f(""), null);
  eq("Date inválida nunca vira 'NaN-NaN-NaN'", f(new Date("inválida")), null);
  eq("texto que não é data ('Thu Oct 01')", f("Thu Oct 01"), null);
  eq("número", f(20261001), null);

  // sanitizeRun: dateFrom/dateTo são a fonte de run.dateFrom/dateTo (ex.: endpoint de repasse MP).
  const run = runService.sanitizeRun(linhaDeRun());
  eq("sanitizeRun: dateFrom a partir de Date real", run.dateFrom, "2026-10-01");
  eq("sanitizeRun: dateTo a partir de Date real", run.dateTo, "2026-10-31");
  ok("sanitizeRun: ambos passam no validador YYYY-MM-DD", ISO.test(run.dateFrom) && ISO.test(run.dateTo));
  const runTexto = runService.sanitizeRun(linhaDeRun({ date_from: "2026-09-01", date_to: "2026-09-30" }));
  eq("sanitizeRun: texto continua funcionando", [runTexto.dateFrom, runTexto.dateTo], ["2026-09-01", "2026-09-30"]);
  const runNulo = runService.sanitizeRun(linhaDeRun({ date_from: null, date_to: null }));
  eq("sanitizeRun: datas nulas continuam nulas", [runNulo.dateFrom, runNulo.dateTo], [null, null]);
}

// ---------------------------------------------------------------------------
// listarPeriodosNoturnosPendentes — com Date real E com o formato que o SQL novo devolve.
// ---------------------------------------------------------------------------
const SENTINELA = "PARAMOS_AQUI_APOS_VALIDAR_AS_DATAS";

function dbFalso(linhasPendentes) {
  const consultas = [];
  return {
    consultas,
    async query(sql) {
      consultas.push(sql);
      if (/SELECT DISTINCT/.test(sql) && /central_vendas_sync_runs/.test(sql)) return { rows: linhasPendentes };
      // Qualquer outra query = criarSyncRun passou da validação de datas.
      throw new Error(SENTINELA);
    },
  };
}

const PENDENTES_ESPERADOS = [
  { competencia: "2026-09", dateFrom: "2026-09-01", dateTo: "2026-09-28" },
  { competencia: "2026-09", dateFrom: "2026-09-01", dateTo: "2026-09-30" },
];

async function checksListagemEComposicao() {
  // (a) Linhas com Date REAL do pg (o que o driver devolve quando a coluna sai crua).
  const comDate = [
    { date_from: dateDoPg("2026-09-01"), date_to: dateDoPg("2026-09-28") },
    { date_from: dateDoPg("2026-09-01"), date_to: dateDoPg("2026-09-30") },
  ];
  eq("listar: linhas com Date real → períodos YYYY-MM-DD", await runService.listarPeriodosNoturnosPendentes({ antesDe: new Date().toISOString(), db: dbFalso(comDate) }), PENDENTES_ESPERADOS);

  // (b) Linhas com texto (o que a query nova devolve via TO_CHAR).
  const comTexto = [
    { date_from: "2026-09-01", date_to: "2026-09-28" },
    { date_from: "2026-09-01", date_to: "2026-09-30" },
  ];
  eq("listar: linhas com texto → mesmos períodos", await runService.listarPeriodosNoturnosPendentes({ antesDe: new Date().toISOString(), db: dbFalso(comTexto) }), PENDENTES_ESPERADOS);

  // (c) A query entrega o dia como texto no próprio banco (não depende do fuso do Node).
  const db = dbFalso(comTexto);
  await runService.listarPeriodosNoturnosPendentes({ antesDe: new Date().toISOString(), db });
  const sql = db.consultas[0];
  ok("query usa TO_CHAR(date_from) e TO_CHAR(date_to)", /TO_CHAR\(\s*r\.date_from\s*,\s*'YYYY-MM-DD'\s*\)/i.test(sql) && /TO_CHAR\(\s*r\.date_to\s*,\s*'YYYY-MM-DD'\s*\)/i.test(sql));

  // (d) Composição REAL: recuperarRodadasPendentes → listar REAL → criarSyncRun REAL.
  //     O buraco do teste antigo: aqui nada é mockado entre a leitura do período e a
  //     validação de datas do criarSyncRun. Se as datas forem inválidas, o erro de cada
  //     unidade é o 400 de dateFrom/dateTo; se forem válidas, é a sentinela do banco falso.
  for (const [rotulo, linhas] of [["Date real", comDate], ["texto", comTexto]]) {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      cliente_conta_id: i + 1, cliente_id: i + 1, marketplace: "meli",
      external_account_id: `ML${i + 1}`, conta_ativa: true, conta_nome: `Conta ${i + 1}`,
      cliente_slug: `cliente-${i + 1}`, cliente_nome: `Cliente ${i + 1}`, cliente_ativo: true,
    }));
    const dbRec = dbFalso(linhas);
    const deps = {
      db: dbRec,
      listarPeriodosNoturnosPendentes: runService.listarPeriodosNoturnosPendentes,
      async reconciliarRunsNoturnosInterrompidos() { return []; },
      async listarContas() { return rows; },
      async ensureCentralVendasTables() {},
      criarSyncRun: runService.criarSyncRun,
      async executarSyncRun() { throw new Error("não deveria executar: a criação do run falha antes"); },
      async obterSyncRun() { return null; },
      async sincronizarAdsCliente() { return { atualizado: false }; },
      async reconstruirSnapshotMensal() { return { atualizado: false }; },
      sleep: async () => {},
      agora: () => Date.now(),
      observarIntervaloMs: 1,
      observarTimeoutMs: 5,
      logger: { log() {}, warn() {}, error() {} },
    };
    const rec = await svc.recuperarRodadasPendentes({ env: { SYNC_CENTRAL_CONCURRENCY: "3" }, iniciadoEm: new Date() }, deps);
    eq(`recuperação [${rotulo}]: foi executada`, rec.recuperada, true);
    const unidades = 3 /* contas */ * 2 /* períodos */;
    eq(`recuperação [${rotulo}]: ${unidades} unidades tentadas`, rec.resumo.falhas.length, unidades);
    const mensagens = [...new Set(rec.resumo.falhas.map((x) => x.erro?.message))];
    ok(`recuperação [${rotulo}]: nenhuma unidade falha por dateFrom/dateTo (${JSON.stringify(mensagens)})`,
      rec.resumo.falhas.every((x) => !/dateFrom e dateTo/.test(x.erro?.message || "")));
    ok(`recuperação [${rotulo}]: todas passaram da validação de datas e só pararam na sentinela do banco falso`,
      rec.resumo.falhas.every((x) => (x.erro?.message || "").includes(SENTINELA)));
    ok(`recuperação [${rotulo}]: períodos do resumo são YYYY-MM-DD`, rec.resumo.falhas.every((x) => /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(x.periodo)));
  }
}

// ---------------------------------------------------------------------------
async function main() {
  await checksSensiveisAFuso();
  if (SO_FUSO) {
    concluido = true;
    console.log(`  [TZ=${process.env.TZ}] ${checks} verificacoes OK`);
    return;
  }

  await checksListagemEComposicao();

  // Mesmos checks sensíveis a fuso em subprocessos: UTC (Render), São Paulo, Nova York
  // (horário de verão), Tóquio e Kiritimati (UTC+14: toISOString erraria o dia) e Pago Pago (UTC-11).
  const fusos = ["UTC", "America/Sao_Paulo", "America/New_York", "Asia/Tokyo", "Pacific/Kiritimati", "Pacific/Pago_Pago"];
  for (const tz of fusos) {
    const r = spawnSync(process.execPath, [path.join(__dirname, path.basename(__filename)), "--fuso"], {
      env: { ...process.env, TZ: tz }, encoding: "utf8",
    });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.status !== 0) process.stderr.write(r.stderr || "");
    ok(`checks de data passam com TZ=${tz}`, r.status === 0);
  }

  concluido = true;
  console.log(`centralVendasDatasDate.test.js: ${checks} verificacoes OK`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
