// server/tests/syncCentralVendasNoturnoJob.test.js
//
// Processo/CLI dos jobs da Central de Vendas (cron noturno e backfill):
// exit codes, CENTRAL_VENDAS_NOTURNO_ENABLED=false sem abrir banco, erro
// estrutural → exit 1, processo termina sozinho, concorrência via env/CLI,
// nada de Express/index.js, scripts do package.json.
//
// SEGURANÇA — nenhum banco real:
//   - todo processo filho recebe DATABASE_URL explícito para uma porta morta
//     (127.0.0.1:1). dotenv não sobrescreve variável já definida, então nem um
//     server/.env de produção seria usado;
//   - o teste confere na saída que a conexão recusada foi em 127.0.0.1:1.

process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/teste-sem-banco";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const cli = require("../jobs/centralVendasJobCli");

let checks = 0;
// Uma promise pendurada esvazia o event loop e o Node sai com 0 sem terminar
// o teste — aqui isso vira falha.
let concluido = false;
process.on("exit", () => {
  if (!concluido) {
    console.error(`syncCentralVendasNoturnoJob.test.js: NÃO concluiu (parou após ${checks} verificações)`);
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

const SERVER_DIR = path.join(__dirname, "..");
const DEAD_DB = "postgres://nobody@127.0.0.1:1/teste-sem-banco";

// Preload que registra quais módulos o job carregou (pg, express, index.js).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vf-cron-central-"));
const preload = path.join(tmpDir, "preload.js");
fs.writeFileSync(preload, `
const Module = require("module");
const carregados = new Set();
const original = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "pg" || request === "express") carregados.add(request);
  if (/(^|\\/)index(\\.js)?$/.test(request) && parent && /jobs|centralVendas/.test(parent.filename || "")) carregados.add("index.js");
  return original.apply(this, arguments);
};
process.on("exit", () => { process.stdout.write("\\n[preload] carregados=" + JSON.stringify([...carregados].sort()) + "\\n"); });
`);

function rodar(script, args = [], envExtra = {}) {
  const env = { ...process.env, DATABASE_URL: DEAD_DB, ...envExtra };
  delete env.SYNC_CENTRAL_CONCURRENCY;
  delete env.CENTRAL_VENDAS_NOTURNO_ENABLED;
  Object.assign(env, envExtra);
  const inicio = Date.now();
  const r = spawnSync(process.execPath, ["-r", preload, script, ...args], {
    cwd: SERVER_DIR, env, encoding: "utf8", timeout: 30000,
  });
  const saida = `${r.stdout || ""}\n${r.stderr || ""}`;
  const m = saida.match(/\[preload\] carregados=(\[.*\])/);
  return { code: r.status, signal: r.signal, saida, ms: Date.now() - inicio, carregados: m ? JSON.parse(m[1]) : null };
}

const NOTURNO = "jobs/syncCentralVendasNoturno.js";
const BACKFILL = "jobs/backfillCentralVendas.js";

async function run() {
  // =========================================================================
  // 1. Unitário: parseArgs / jobHabilitado / rodarJob
  // =========================================================================
  eq("parseArgs: flags", cli.parseArgs(["--dry-run", "--clientes=a, b,,c", "--data-referencia=2026-09-24", "--meses=3", "--concorrencia=2"]),
    { dryRun: true, clientes: ["a", "b", "c"], dataReferencia: "2026-09-24", meses: "3", concorrencia: "2" });
  eq("parseArgs: vazio", cli.parseArgs([]), { dryRun: false, clientes: null, dataReferencia: null, meses: null, concorrencia: null });
  assert.throws(() => cli.parseArgs(["--desconhecido"]), /Argumento desconhecido/); checks += 1;

  eq("habilitado: ausente → ligado", cli.jobHabilitado({}), true);
  eq("habilitado: 'true' → ligado", cli.jobHabilitado({ CENTRAL_VENDAS_NOTURNO_ENABLED: "true" }), true);
  for (const v of ["false", "FALSE", "0", "off", " false "]) {
    eq(`habilitado: '${v}' → desligado`, cli.jobHabilitado({ CENTRAL_VENDAS_NOTURNO_ENABLED: v }), false);
  }

  {
    let ended = 0;
    const pool = { end: async () => { ended += 1; } };
    const code = await cli.rodarJob({ pool, executar: async () => ({ execucoes: 2, falha: 1 }), exitCodeDoResumo: () => 0, logger: { error() {} } });
    eq("rodarJob: exit code vem do resumo", code, 0);
    eq("rodarJob: pool encerrado no sucesso", ended, 1);
  }
  {
    let ended = 0;
    const erros = [];
    const pool = { end: async () => { ended += 1; } };
    const code = await cli.rodarJob({
      pool,
      executar: async () => { const e = new Error("falhou Bearer APP_USR-123-segredo access_token=abc"); e.code = "X"; throw e; },
      exitCodeDoResumo: () => 0,
      logger: { error: (m) => erros.push(m) },
    });
    eq("rodarJob: erro estrutural → exit 1", code, 1);
    eq("rodarJob: pool encerrado no erro", ended, 1);
    ok("rodarJob: log de erro estrutural sem segredo", erros.length === 1 && !erros[0].includes("APP_USR-123") && !erros[0].includes("abc") && erros[0].includes("erro estrutural"));
  }
  {
    const pool = { end: async () => { throw new Error("pool já fechado"); } };
    const code = await cli.rodarJob({ pool, executar: async () => ({}), exitCodeDoResumo: () => 0, logger: { error() {} } });
    eq("rodarJob: falha ao fechar o pool não muda o exit code", code, 0);
  }

  // =========================================================================
  // 2. Processo: desabilitado encerra SEM abrir banco
  // =========================================================================
  {
    const r = rodar(NOTURNO, [], { CENTRAL_VENDAS_NOTURNO_ENABLED: "false" });
    eq("desligado: exit 0", r.code, 0);
    ok("desligado: log explica", r.saida.includes("[cron-central] desabilitado (CENTRAL_VENDAS_NOTURNO_ENABLED=false)"));
    eq("desligado: nem pg nem express carregados (banco nunca aberto)", r.carregados, []);
    ok("desligado: termina rápido", r.ms < 10000 && r.signal === null);
  }

  // =========================================================================
  // 3. Processo: habilitado, banco inacessível → erro estrutural, exit 1,
  //    termina sozinho, sem Express/index.js
  // =========================================================================
  {
    const r = rodar(NOTURNO, ["--data-referencia=2026-09-24"]);
    eq("sem banco: exit 1", r.code, 1);
    ok("sem banco: tentou a porta morta (nunca outro banco)", r.saida.includes("127.0.0.1:1"));
    ok("sem banco: erro estrutural logado", r.saida.includes("[cron-central] erro estrutural"));
    ok("sem banco: log de início com o período do dia", r.saida.includes("períodos=2026-09-01..2026-09-23") && r.saida.includes("concorrência=3"));
    ok("sem banco: processo terminou sozinho (sem sinal/timeout)", r.signal === null && r.ms < 20000);
    ok("sem banco: carregou pg", r.carregados && r.carregados.includes("pg"));
    ok("sem banco: NÃO carregou express", r.carregados && !r.carregados.includes("express"));
    ok("sem banco: NÃO carregou index.js do servidor", r.carregados && !r.carregados.includes("index.js"));
  }
  {
    const r = rodar(NOTURNO, ["--data-referencia=2026-10-03"], { SYNC_CENTRAL_CONCURRENCY: "4" });
    ok("env: SYNC_CENTRAL_CONCURRENCY=4 respeitada", r.saida.includes("concorrência=4"));
    ok("dias 2–5: dois períodos no log", r.saida.includes("períodos=2026-09-01..2026-09-30,2026-10-01..2026-10-02"));
  }
  {
    const r = rodar(NOTURNO, ["--data-referencia=2027-01-01"], { SYNC_CENTRAL_CONCURRENCY: "99" });
    ok("env: concorrência capada em 10", r.saida.includes("concorrência=10"));
    ok("virada de ano: dezembro completo", r.saida.includes("períodos=2026-12-01..2026-12-31"));
  }

  // =========================================================================
  // 4. Processo: argumentos inválidos → exit 1 sem consultar banco
  // =========================================================================
  for (const [label, args, trecho] of [
    ["argumento desconhecido", ["--foo"], "Argumento desconhecido: --foo"],
    ["data inválida", ["--data-referencia=2026-02-30"], "Data de referencia invalida: 2026-02-30"],
    ["data fora do calendário", ["--data-referencia=2026-13-40"], "Data de referencia invalida: 2026-13-40"],
  ]) {
    const r = rodar(NOTURNO, args);
    eq(`${label}: exit 1`, r.code, 1);
    ok(`${label}: mensagem`, r.saida.includes(trecho));
    ok(`${label}: nenhuma tentativa de conexão`, !r.saida.includes("ECONNREFUSED"));
  }

  // =========================================================================
  // 5. Backfill
  // =========================================================================
  for (const args of [[], ["--meses=0"], ["--meses=13"], ["--meses=abc"]]) {
    const r = rodar(BACKFILL, args);
    eq(`backfill ${args.join(" ") || "(sem --meses)"}: exit 1`, r.code, 1);
    ok(`backfill ${args.join(" ") || "(sem --meses)"}: exige --meses 1..12`, r.saida.includes("--meses e obrigatorio"));
    ok(`backfill ${args.join(" ") || "(sem --meses)"}: sem conexão`, !r.saida.includes("ECONNREFUSED"));
  }
  {
    const r = rodar(BACKFILL, ["--meses=3", "--data-referencia=2026-02-10"]);
    eq("backfill: sem banco → exit 1", r.code, 1);
    ok("backfill: meses completos, do mais antigo ao mais recente",
      r.saida.includes("períodos=2025-11-01..2025-11-30,2025-12-01..2025-12-31,2026-01-01..2026-01-31"));
    ok("backfill: concorrência padrão 1", r.saida.includes("concorrência=1"));
    ok("backfill: origem identificada", r.saida.includes("origem=backfill-central"));
    ok("backfill: porta morta", r.saida.includes("127.0.0.1:1"));
  }
  {
    const r = rodar(BACKFILL, ["--meses=1", "--concorrencia=9", "--data-referencia=2026-02-10"]);
    ok("backfill: --concorrencia capada em 3", r.saida.includes("concorrência=3"));
  }
  {
    // O flag do cron não desliga o backfill manual (é execução explícita).
    const r = rodar(BACKFILL, ["--meses=1", "--data-referencia=2026-02-10"], { CENTRAL_VENDAS_NOTURNO_ENABLED: "false" });
    ok("backfill: não é afetado pelo flag do cron", r.saida.includes("origem=backfill-central"));
  }

  // =========================================================================
  // 6. package.json e isolamento do servidor web
  // =========================================================================
  {
    const pkg = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, "package.json"), "utf8"));
    eq("package: start inalterado", pkg.scripts.start, "node index.js");
    eq("package: script noturno", pkg.scripts["sync:central-vendas:noturno"], "node jobs/syncCentralVendasNoturno.js");
    eq("package: script backfill", pkg.scripts["sync:central-vendas:backfill"], "node jobs/backfillCentralVendas.js");
    for (const arquivo of [NOTURNO, BACKFILL, "jobs/centralVendasJobCli.js"]) {
      const fonte = fs.readFileSync(path.join(SERVER_DIR, arquivo), "utf8").replace(/\/\/.*$/gm, "");
      ok(`${arquivo}: não sobe Express`, !fonte.includes("express") && !fonte.includes("listen("));
      ok(`${arquivo}: não importa o index.js do servidor`, !/require\(["']\.\.\/index/.test(fonte));
    }
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  concluido = true;
  console.log(`syncCentralVendasNoturnoJob.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
