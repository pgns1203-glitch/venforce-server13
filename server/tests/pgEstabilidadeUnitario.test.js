// server/tests/pgEstabilidadeUnitario.test.js
//
// P0 03/11/2026 — estabilidade do PostgreSQL no boot, SEM banco:
//   A  executor de etapas de boot (sequência, retry só para erro transitório,
//      dependentes só depois do schema, nunca rejeita)
//   B  instrumentação do pool (aquisição lenta, falha, conexão perdida,
//      degradação → recuperação, resumo só quando anormal)
//   C  guardas estáticas: o schema da Central não tem mais backfill; o boot
//      do index.js não dispara ensure* fora da sequência; o marcador de
//      versão está ligado nos ensures de tabela de negócio.
// A parte com PostgreSQL real está em pgEstabilidadeBoot.postgres.test.js.

process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/teste-sem-banco";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { executarEtapasDeBoot, ehErroTransitorioDeBanco } = require("../services/boot/bootSequencial");
const { instrumentarPool, estadoDoPool } = require("../config/databaseObservabilidade");

let checks = 0;
function ok(label, cond = true) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
const erroPg = (code, message = `pg ${code}`) => Object.assign(new Error(message), { code });
const silencioso = { log: () => {}, warn: () => {}, error: () => {} };

async function testeA() {
  // A1 — sequência estrita: a etapa N+1 só começa depois que a N terminou.
  {
    const eventos = [];
    let emCurso = 0;
    let maxSimultaneas = 0;
    const etapa = (nome) => ({
      nome,
      executar: async () => {
        emCurso += 1;
        maxSimultaneas = Math.max(maxSimultaneas, emCurso);
        eventos.push(`ini:${nome}`);
        await new Promise((r) => setTimeout(r, 5));
        eventos.push(`fim:${nome}`);
        emCurso -= 1;
      },
    });
    const res = await executarEtapasDeBoot(["a", "b", "c"].map(etapa), { logger: silencioso });
    ok("A1: etapas rodam uma por vez, na ordem", maxSimultaneas === 1
      && eventos.join() === "ini:a,fim:a,ini:b,fim:b,ini:c,fim:c" && res.every((r) => r.ok));
  }
  // A2 — transitório repete com as esperas dadas; aoConcluir só depois do sucesso.
  {
    const esperas = [];
    let n = 0;
    const ordem = [];
    const res = await executarEtapasDeBoot([{
      nome: "schema",
      executar: async () => { n += 1; ordem.push(`tentativa${n}`); if (n < 3) throw erroPg(n === 1 ? "57P03" : "55P03"); return "pronto"; },
      aoConcluir: (r) => ordem.push(`worker:${r}`),
      aoFalhar: () => ordem.push("falhou"),
    }], { logger: silencioso, esperasMs: [11, 22, 33], sleep: async (ms) => esperas.push(ms) });
    ok("A2: 57P03 (recovery) e 55P03 (lock_timeout) repetem com backoff; worker só depois do schema",
      n === 3 && esperas.join() === "11,22" && ordem.join() === "tentativa1,tentativa2,tentativa3,worker:pronto" && res[0].tentativas === 3);
  }
  // A3 — transitório que nunca passa: esgota as esperas e chama aoFalhar uma vez.
  {
    let n = 0;
    const falhas = [];
    const res = await executarEtapasDeBoot([{
      nome: "schema",
      executar: async () => { n += 1; throw new Error("Connection terminated unexpectedly"); },
      aoConcluir: () => falhas.push("NAO-DEVIA"),
      aoFalhar: (err) => falhas.push(err.message),
    }], { logger: silencioso, esperasMs: [1, 1], sleep: async () => {} });
    ok("A3: transitório persistente → 1 + N tentativas, aoFalhar uma vez, worker NÃO inicia",
      n === 3 && falhas.length === 1 && /terminated/.test(falhas[0]) && res[0].ok === false);
  }
  // A4 — erro não transitório: 1 tentativa, e as etapas seguintes rodam.
  {
    let n = 0;
    const res = await executarEtapasDeBoot([
      { nome: "quebrada", executar: async () => { n += 1; throw erroPg("42P01"); } },
      { nome: "seguinte", executar: async () => "ok" },
    ], { logger: silencioso, esperasMs: [1, 1], sleep: async () => {} });
    ok("A4: erro não transitório não repete e não impede a etapa seguinte", n === 1 && res[1].ok === true);
  }
  // A5 — erro DENTRO de aoConcluir / aoFalhar não derruba a sequência e ela nunca rejeita.
  {
    const res = await executarEtapasDeBoot([
      { nome: "a", executar: async () => 1, aoConcluir: () => { throw new Error("log quebrou"); } },
      { nome: "b", executar: async () => { throw erroPg("42601"); }, aoFalhar: () => { throw new Error("log quebrou 2"); } },
      { nome: "c", executar: async () => 3 },
    ], { logger: silencioso });
    ok("A5: exceção em aoConcluir/aoFalhar é contida; sequência segue e resolve", res.map((r) => r.ok).join() === "true,false,true");
  }
  // A6 — encerrando (SIGTERM): etapas restantes não começam e a espera de retry também para.
  {
    let parar = false;
    const rodou = [];
    const res = await executarEtapasDeBoot([
      { nome: "a", executar: async () => { rodou.push("a"); parar = true; } },
      { nome: "b", executar: async () => { rodou.push("b"); } },
    ], { logger: silencioso, deveParar: () => parar });
    ok("A6: com deveParar() verdadeiro, nenhuma etapa nova começa", rodou.join() === "a" && res.length === 1);
  }
  // A6b — SIGTERM DURANTE o backoff (achado da revisão do Codex): não há nova
  // tentativa nem aoConcluir (worker não inicia depois do shutdown).
  {
    let parar = false;
    let execucoes = 0;
    const eventos = [];
    const res = await executarEtapasDeBoot([
      { nome: "schema", executar: async () => { execucoes += 1; if (execucoes === 1) throw erroPg("57P03"); return "ok"; },
        aoConcluir: () => eventos.push("worker-iniciado"), aoFalhar: () => eventos.push("aoFalhar") },
      { nome: "seguinte", executar: async () => eventos.push("seguinte") },
    ], { logger: silencioso, esperasMs: [5, 5], sleep: async () => { parar = true; }, deveParar: () => parar });
    ok("A6b: SIGTERM no backoff → sem nova tentativa, sem worker, sem etapas seguintes",
      execucoes === 1 && eventos.length === 0 && res.length === 1 && res[0].interrompida === true);
  }
  // A6c — SIGTERM depois do executar ok e antes do aoConcluir: worker não inicia.
  {
    let parar = false;
    const eventos = [];
    await executarEtapasDeBoot([
      { nome: "schema", executar: async () => { parar = true; return 1; }, aoConcluir: () => eventos.push("worker-iniciado") },
    ], { logger: silencioso, deveParar: () => parar });
    ok("A6c: encerramento entre o schema e o worker → worker não inicia", eventos.length === 0);
  }
  // A7 — classificação de erros.
  ok("A7: transitórios reconhecidos", [
    erroPg("57P03"), erroPg("57P01"), erroPg("55P03"), erroPg("VF_SCHEMA_LOCK_OCUPADO"), erroPg("53300"), erroPg("08006"), erroPg("ECONNREFUSED"),
    new Error("Connection terminated unexpectedly"), new Error("timeout exceeded when trying to connect"),
    new Error("the database system is in recovery mode"),
  ].every(ehErroTransitorioDeBanco));
  ok("A7: não transitórios recusados", ![
    erroPg("42P01"), erroPg("23505"), erroPg("42601"), new Error("qualquer"), null,
  ].some(ehErroTransitorioDeBanco));
}

// Pool fake com a mesma superfície usada pela instrumentação (pg-pool).
function poolFake() {
  const p = new EventEmitter();
  p.totalCount = 0; p.idleCount = 0; p.waitingCount = 0; p.options = { max: 10 };
  p.proximo = { ms: 0, erro: null };
  p.agora = 1000;
  p.connect = function connect(cb) {
    const { ms, erro } = p.proximo;
    const exec = () => {
      p.agora += ms;
      if (erro) return Promise.reject(erro);
      const client = new EventEmitter();
      p.emit("connect", client);
      p.ultimoClient = client;
      return Promise.resolve(client);
    };
    if (typeof cb === "function") { exec().then((c) => cb(null, c, () => {}), (e) => cb(e)); return undefined; }
    return exec();
  };
  return p;
}

async function testeB() {
  const logs = [];
  const logger = { log: (m) => logs.push(["log", m]), warn: (m) => logs.push(["warn", m]), error: (m) => logs.push(["error", m]) };
  const pool = poolFake();
  const obs = instrumentarPool(pool, { logger, lentaMs: 1000, iniciarTimer: false, agora: () => pool.agora, rotinaMs: 60000 });
  ok("B0: instrumentar duas vezes devolve a mesma instância", instrumentarPool(pool) === obs);

  pool.proximo = { ms: 5, erro: null };
  await pool.connect();
  await new Promise((r) => pool.connect((err) => r(err))); // forma callback (a que pool.query usa)
  ok("B1: aquisições rápidas (promise e callback) contadas sem log", obs.estado().totais.aquisicoes === 2 && logs.length === 0);

  pool.proximo = { ms: 2500, erro: null };
  pool.totalCount = 10; pool.idleCount = 0; pool.waitingCount = 7;
  await pool.connect();
  ok("B2: aquisição lenta loga ms e total/idle/waiting", logs.some(([n, m]) => n === "warn" && /aquisição lenta: 2500 ms/.test(m) && /total=10 idle=0 waiting=7 max=10/.test(m)));

  logs.length = 0;
  pool.proximo = { ms: 30000, erro: new Error("timeout exceeded when trying to connect") };
  await pool.connect().catch(() => {});
  pool.proximo = { ms: 3, erro: erroPg("57P03", "the database system is in recovery mode") };
  await pool.connect().catch(() => {});
  ultimoClientErro(pool);
  const est = obs.estado();
  ok("B3: falhas de aquisição e conexão perdida contadas; pool DEGRADADO",
    est.totais.falhas === 2 && est.totais.conexoesPerdidas === 1 && est.degradado && est.degradado.erros === 3
    && logs.filter(([n]) => n === "error").length === 2);
  ok("B3: /health/db reflete a degradação (estadoDoPool)", estadoDoPool(pool).degradado.ultimoErro.includes("Connection terminated"));

  pool.agora += 4000;
  pool.proximo = { ms: 2, erro: null };
  pool.waitingCount = 0;
  await pool.connect();
  const rec = logs.find(([, m]) => /voltou a atender/.test(m));
  ok("B4: 1ª aquisição ok depois da queda loga a recuperação com a duração", rec && /\d+ ms depois do 1º erro \(3 erro\(s\)/.test(rec[1])
    && obs.estado().degradado === null && obs.estado().totais.recuperacoes === 1 && obs.estado().ultimaRecuperacao.indisponivelMs > 0);

  logs.length = 0;
  obs.tick(); // janela com falhas/lenta → resumo como warn
  ok("B5: resumo periódico sai quando a janela teve algo anormal", logs.length === 1 && logs[0][0] === "warn" && /janela: aquisições=\d+/.test(logs[0][1]));
  logs.length = 0;
  obs.tick(); // janela limpa, antes do intervalo de rotina → silêncio
  ok("B5: janela normal não loga (sem ruído)", logs.length === 0);
  pool.agora += 60001;
  obs.tick();
  ok("B5: resumo de rotina depois do intervalo", logs.length === 1 && logs[0][0] === "log");
}

function ultimoClientErro(pool) {
  pool.ultimoClient.emit("error", new Error("Connection terminated unexpectedly"));
}

function testeE() {
  // Revisão do Codex: os ALTER de custos (ACCESS EXCLUSIVE) não podem dividir a
  // transação com a construção de índice.
  const src = fs.readFileSync(path.join(__dirname, "..", "services", "bases", "baseCustosService.js"), "utf8");
  const colunas = src.slice(src.indexOf("const CUSTOS_COLUNAS_DDL"), src.indexOf("const CUSTOS_INDICES_DDL"));
  const indices = src.slice(src.indexOf("const CUSTOS_INDICES_DDL"), src.indexOf("async function ensureColunasCustos"));
  ok("E1: custos — ALTERs sem nenhum índice na mesma transação", /ALTER TABLE custos ADD COLUMN/.test(colunas) && !/INDEX/i.test(colunas.replace(/--.*$/gm, "")));
  ok("E1: custos — índices em transação separada, sem ALTER ADD COLUMN", /CREATE UNIQUE INDEX IF NOT EXISTS uq_custos_base_sku_id/.test(indices) && !/ADD COLUMN/.test(indices));
}

function testeD() {
  const { semTransacaoPropria } = require("../services/schema/schemaVersionado");
  const sql = "BEGIN;\nSELECT 1;\nDO $$\nBEGIN\n  PERFORM 1;\nEND\n$$;\n  COMMIT;\nbegin ;\n";
  const out = semTransacaoPropria(sql);
  ok("D1: BEGIN;/COMMIT; de nível superior neutralizados; BEGIN de bloco DO intacto",
    !/^\s*(BEGIN|COMMIT)\s*;\s*$/im.test(out) && /DO \$\$\nBEGIN\n  PERFORM 1;/.test(out) && /SELECT 1;/.test(out));
  for (const arq of ["20260827_squads_foundation.sql", "20260828_cliente_responsaveis_p24.sql", "20261015_squad_members_funcao_gestor.sql", "20261014_custos_shopee_item_model.sql"]) {
    const conteudo = semTransacaoPropria(fs.readFileSync(path.join(__dirname, "..", "sql", "migrations", arq), "utf8"));
    ok(`D2: ${arq} sem BEGIN;/COMMIT; de nível superior depois do filtro`, !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;\s*$/im.test(conteudo));
  }
}

function testeC() {
  const raiz = path.join(__dirname, "..");
  const schema = fs.readFileSync(path.join(raiz, "sql", "central_vendas_schema.sql"), "utf8");
  const semComentarios = schema.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  ok("C1: central_vendas_schema.sql não tem UPDATE em central_vendas_componentes (backfill saiu do boot)",
    !/UPDATE\s+central_vendas_componentes/i.test(semComentarios));
  ok("C1: o procedimento de backfill existe como script", fs.existsSync(path.join(raiz, "scripts", "central-vendas-backfill-escopo-componentes.js")));

  const index = fs.readFileSync(path.join(raiz, "index.js"), "utf8");
  const listen = index.slice(index.indexOf("const server = app.listen("), index.indexOf("// Encerramento:"));
  ok("C2: o callback do app.listen não chama ensure* diretamente (só a sequência)",
    !/ensure[A-Z]\w*\(/.test(listen) && /executarEtapasDeBoot\(etapasDeBoot\(\)/.test(listen));
  const etapas = index.slice(index.indexOf("function etapasDeBoot()"), index.indexOf("const server = app.listen("));
  for (const nome of ["ensureCentralVendasTables", "ensureEntregasClienteSchema", "ensureColunasCustos", "ensureMargemPrecificacaoSchema",
    "ensurePromoSnapshotSchema", "ensureObservabilityTables", "ensureFechamentoIncidenteTables", "armarRolloutGate",
    "marginSnapshotRuntime.iniciarSeHabilitado", "observabilityService.runCleanup"]) {
    ok(`C3: ${nome} continua no boot (dentro das etapas)`, etapas.includes(nome));
  }
  ok("C3: cleanup da observabilidade é a ÚLTIMA etapa", etapas.lastIndexOf("nome: \"observability-cleanup\"") > etapas.lastIndexOf("nome: \""+"margin-snapshot-worker\""));

  const usos = [
    ["services/centralVendas/centralVendasRepository.js", /aplicarSchemaVersionado\(/],
    ["services/schema/schemaEnsure.js", /aplicarSchemaVersionado\(\{ db, chave: lockKey/],
    ["services/schema/schemaEnsure.js", /chave: "entregas_cliente"/],
    ["services/bases/baseCustosService.js", /chave: "custos_colunas", sql: CUSTOS_COLUNAS_DDL/],
    ["services/bases/baseCustosService.js", /chave: "custos_indices", sql: sqlIndices[^}]*removerTransacaoPropria: true/],
    ["services/squads/squadsRepository.js", /aplicarSchemaVersionado\(\{ db, chave: nome, sql, lockKey: `vf:schema:\$\{nome\}`, removerTransacaoPropria: true \}\)/],
    ["services/motorMargem/marginSnapshotRepository.js", /aplicarSchemaVersionado\(/],
  ];
  for (const [arq, re] of usos) ok(`C4: ${arq} usa o marcador de versão`, re.test(fs.readFileSync(path.join(raiz, arq), "utf8")));
}

(async () => {
  await testeA();
  await testeB();
  testeC();
  testeD();
  testeE();
  console.log(`\n✓ pgEstabilidadeUnitario: ${checks} checks`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
