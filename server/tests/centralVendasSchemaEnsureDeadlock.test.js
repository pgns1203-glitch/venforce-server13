// server/tests/centralVendasSchemaEnsureDeadlock.test.js
//
// Deadlock 40P01 do sync noturno em massa (ensureCentralVendasTables por conta
// em paralelo × reuso de run). Cobre a metade do repositório:
//   B  single-flight de ensureCentralVendasTables (uma execução real do schema)
//   C  ensure que falha limpa o cache e permite nova tentativa
//   -  advisory lock na MESMA conexão dedicada durante todo o schema
//   G  withTransaction: 40P01/40001 → ROLLBACK → client NOVO → BEGIN → COMMIT
//
// NENHUM banco real: DATABASE_URL aponta para porta morta antes de qualquer
// require e o pool é substituído por um fake que registra cada comando.

process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/teste-sem-banco";

const assert = require("assert");
const retry = require("../services/centralVendas/centralVendasTransientRetry");
const repository = require("../services/centralVendas/centralVendasRepository");
const realPool = require("../config/database");

let checks = 0;
let concluido = false;
process.on("exit", () => {
  if (!concluido) {
    console.error(`centralVendasSchemaEnsureDeadlock.test.js: NÃO concluiu (parou após ${checks} verificações)`);
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
async function rejeita(label, promise, verificador = () => true) {
  let erro = null;
  try { await promise; } catch (err) { erro = err; }
  ok(`${label} (rejeitou)`, erro !== null);
  ok(`${label} (erro esperado)`, verificador(erro));
  return erro;
}

const ehSchema = (sql) => String(sql).includes("CREATE TABLE IF NOT EXISTS central_vendas_imports");
const ehLock = (sql) => String(sql).includes("pg_advisory_xact_lock");

function erroPg(code, message = `pg ${code}`) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Pool fake: cada connect() devolve um client NOVO com id; todo comando fica
// em `eventos` na ordem em que chegou (com o id do client que o executou).
function criarPoolFake({ aoExecutar = null, schemaGate = null } = {}) {
  const eventos = [];
  let proximoId = 0;
  return {
    eventos,
    conexoes: () => proximoId,
    async connect() {
      const id = ++proximoId;
      return {
        id,
        async query(sql, params) {
          const s = String(sql).trim();
          const rotulo = ehSchema(s) ? "SCHEMA" : ehLock(s) ? "LOCK" : s.split(/\s+/)[0].toUpperCase();
          eventos.push({ client: id, cmd: rotulo, params });
          if (rotulo === "SCHEMA" && schemaGate) await schemaGate();
          if (aoExecutar) await aoExecutar({ client: id, cmd: rotulo, sql: s, params });
          return { rows: [{ id: 1 }] };
        },
        release(erro) {
          eventos.push({ client: id, cmd: "RELEASE", destruir: !!erro });
        },
      };
    },
    // Um pool que recebesse .query direto para o schema usaria conexões
    // diferentes para lock e schema — é justamente o que NÃO pode acontecer.
    async query(sql) {
      eventos.push({ client: null, cmd: "POOL_QUERY", sql: String(sql).slice(0, 40) });
      return { rows: [] };
    },
  };
}

const semEspera = { sleep: async () => {}, random: () => 0 };

// withTransaction loga cada retry via console.warn; captura para a saída ficar limpa.
const avisosCapturados = [];
console.warn = (...a) => avisosCapturados.push(a.join(" "));

async function run() {
  // =========================================================================
  // Helper de retry transitório
  // =========================================================================
  ok("isTransientPgError: 40P01", retry.isTransientPgError(erroPg("40P01")));
  ok("isTransientPgError: 40001", retry.isTransientPgError(erroPg("40001")));
  ok("isTransientPgError: 23505 não é", !retry.isTransientPgError(erroPg("23505")));
  ok("isTransientPgError: sem code não é", !retry.isTransientPgError(new Error("ECONNRESET")));
  ok("isTransientPgError: null não é", !retry.isTransientPgError(null));
  eq("MAX_TENTATIVAS = 3", retry.MAX_TENTATIVAS, 3);

  {
    const esperas = [];
    let n = 0;
    const resultado = await retry.comRetryTransitorio(async (tentativa) => {
      n += 1;
      if (tentativa < 3) throw erroPg("40P01");
      return "feito";
    }, { sleep: async (ms) => esperas.push(ms), random: () => 0.5, baseMs: 100 });
    eq("retry: sucesso na 3ª tentativa", resultado, "feito");
    eq("retry: 3 execuções", n, 3);
    eq("retry: backoff cresce com jitter (100*2^(n-1) + 0.5*100)", esperas, [150, 250]);
  }
  {
    let n = 0;
    await rejeita("retry: 3 falhas transitórias propagam o erro", retry.comRetryTransitorio(async () => {
      n += 1;
      throw erroPg("40001");
    }, semEspera), (e) => e.code === "40001");
    eq("retry: nunca passa de 3 tentativas", n, 3);
  }
  {
    let n = 0;
    await rejeita("retry: 23505 não repete", retry.comRetryTransitorio(async () => {
      n += 1;
      throw erroPg("23505");
    }, semEspera), (e) => e.code === "23505");
    eq("retry: erro não transitório = 1 tentativa", n, 1);
  }
  {
    const avisos = [];
    await retry.comRetryTransitorio(async (t) => { if (t < 2) throw erroPg("40P01"); }, {
      ...semEspera,
      onRetry: (info) => avisos.push(`${info.tentativa}/${info.maxTentativas}:${info.err.code}`),
    });
    eq("retry: onRetry recebe a PRÓXIMA tentativa e o code", avisos, ["2/3:40P01"]);
  }

  // =========================================================================
  // B — single-flight: N chamadas simultâneas = 1 execução real do schema
  // =========================================================================
  {
    let liberar;
    const portao = new Promise((resolve) => { liberar = resolve; });
    const pool = criarPoolFake({ schemaGate: () => portao });
    const promessas = [
      repository.ensureCentralVendasTables(pool),
      repository.ensureCentralVendasTables(pool),
      repository.ensureCentralVendasTables(pool),
    ];
    // Deixa as 3 chamadas entrarem antes de liberar o schema.
    await new Promise((resolve) => setImmediate(resolve));
    eq("B: schema em andamento — só 1 conexão aberta", pool.conexoes(), 1);
    liberar();
    await Promise.all(promessas);
    eq("B: schema real executado UMA vez", pool.eventos.filter((e) => e.cmd === "SCHEMA").length, 1);
    eq("B: uma única conexão dedicada", pool.conexoes(), 1);

    await repository.ensureCentralVendasTables(pool);
    eq("B: depois do sucesso, chamadas seguintes não executam o schema", pool.eventos.filter((e) => e.cmd === "SCHEMA").length, 1);
    eq("B: depois do sucesso, nem abrem conexão", pool.conexoes(), 1);
  }

  // =========================================================================
  // Advisory lock: MESMA conexão, BEGIN → lock → schema → COMMIT → release
  // =========================================================================
  {
    const pool = criarPoolFake();
    await repository.ensureCentralVendasTables(pool);
    eq(
      "lock: sequência BEGIN → LOCK → SCHEMA → COMMIT → RELEASE, todos no mesmo client",
      pool.eventos.map((e) => `${e.client}:${e.cmd}`),
      ["1:BEGIN", "1:LOCK", "1:SCHEMA", "1:COMMIT", "1:RELEASE"]
    );
    const lock = pool.eventos.find((e) => e.cmd === "LOCK");
    ok("lock: chave estável e específica do domínio", JSON.stringify(lock.params).includes("venforce:central-vendas:schema"));
    ok("lock: nada foi enviado ao pool fora da conexão dedicada", !pool.eventos.some((e) => e.cmd === "POOL_QUERY"));
  }

  // Erro no schema: ROLLBACK, release e o erro sobe.
  {
    const pool = criarPoolFake({
      aoExecutar: async ({ cmd }) => { if (cmd === "SCHEMA") throw new Error("ddl quebrou"); },
    });
    await rejeita("lock: erro do schema propaga", repository.ensureCentralVendasTables(pool), (e) => /ddl quebrou/.test(e.message));
    eq(
      "lock: erro → ROLLBACK e release (sem COMMIT, sem conexão presa)",
      pool.eventos.map((e) => `${e.client}:${e.cmd}`),
      ["1:BEGIN", "1:LOCK", "1:SCHEMA", "1:ROLLBACK", "1:RELEASE"]
    );
  }

  // ROLLBACK que também falha: a conexão é descartada (release(err)).
  {
    const pool = criarPoolFake({
      aoExecutar: async ({ cmd }) => {
        if (cmd === "SCHEMA") throw new Error("ddl quebrou");
        if (cmd === "ROLLBACK") throw new Error("conexão caiu");
      },
    });
    await rejeita("lock: erro original prevalece sobre falha do ROLLBACK", repository.ensureCentralVendasTables(pool), (e) => /ddl quebrou/.test(e.message));
    ok("lock: conexão quebrada é descartada no release", pool.eventos.some((e) => e.cmd === "RELEASE" && e.destruir === true));
  }

  // =========================================================================
  // C — ensure que falha: cache limpo, próxima chamada tenta de novo
  // =========================================================================
  {
    let falhar = true;
    const pool = criarPoolFake({
      aoExecutar: async ({ cmd }) => { if (cmd === "SCHEMA" && falhar) throw erroPg("57014", "timeout"); },
    });
    const simultaneas = await Promise.allSettled([
      repository.ensureCentralVendasTables(pool),
      repository.ensureCentralVendasTables(pool),
    ]);
    ok("C: quem esperava a mesma promise também recebe a falha", simultaneas.every((r) => r.status === "rejected"));
    eq("C: falha executou o schema uma vez (chamadas simultâneas compartilharam)", pool.eventos.filter((e) => e.cmd === "SCHEMA").length, 1);

    falhar = false;
    await repository.ensureCentralVendasTables(pool);
    eq("C: nova chamada depois da falha tenta o schema de novo", pool.eventos.filter((e) => e.cmd === "SCHEMA").length, 2);
    await repository.ensureCentralVendasTables(pool);
    eq("C: e depois do sucesso volta a ser no-op", pool.eventos.filter((e) => e.cmd === "SCHEMA").length, 2);
  }

  // Queryable sem connect() (fake simples de teste / client emprestado):
  // continua funcionando, executando o schema direto uma única vez.
  {
    const sqls = [];
    const db = { async query(sql) { sqls.push(sql); return { rows: [] }; } };
    await Promise.all([repository.ensureCentralVendasTables(db), repository.ensureCentralVendasTables(db)]);
    await repository.ensureCentralVendasTables(db);
    eq("sem connect(): schema direto no db injetado, uma vez", sqls.filter(ehSchema).length, 1);
  }

  // =========================================================================
  // G — withTransaction com retry: client abortado NUNCA é reutilizado
  // =========================================================================
  {
    let tentativa = 0;
    const pool = criarPoolFake();
    const resultado = await repository.withTransaction(async (db) => {
      tentativa += 1;
      await db.query("INSERT 1");
      if (tentativa === 1) throw erroPg("40P01", "deadlock detected");
      return { importId: 7 };
    }, { retryTransient: true, pool, ...semEspera });
    eq("G: resultado da 2ª tentativa", resultado, { importId: 7 });
    eq(
      "G: BEGIN → erro → ROLLBACK → release → client NOVO → BEGIN → COMMIT → release",
      pool.eventos.map((e) => `${e.client}:${e.cmd}`),
      ["1:BEGIN", "1:INSERT", "1:ROLLBACK", "1:RELEASE", "2:BEGIN", "2:INSERT", "2:COMMIT", "2:RELEASE"]
    );
    ok("G: nada foi executado no client 1 depois do ROLLBACK", pool.eventos.filter((e) => e.client === 1).slice(-2).map((e) => e.cmd).join() === "ROLLBACK,RELEASE");
  }
  {
    const pool = criarPoolFake();
    let n = 0;
    await rejeita("G: 40001 permanente propaga depois de 3 tentativas", repository.withTransaction(async () => {
      n += 1;
      throw erroPg("40001");
    }, { retryTransient: true, pool, ...semEspera }), (e) => e.code === "40001");
    eq("G: máximo de 3 tentativas totais", n, 3);
    eq("G: 3 conexões, cada uma com ROLLBACK e release", pool.eventos.filter((e) => e.cmd === "ROLLBACK").length, 3);
    ok("G: nenhum COMMIT em transação abortada", !pool.eventos.some((e) => e.cmd === "COMMIT"));
  }
  {
    const pool = criarPoolFake();
    let n = 0;
    await rejeita("G: erro não transitório não repete", repository.withTransaction(async () => {
      n += 1;
      throw erroPg("23505");
    }, { retryTransient: true, pool, ...semEspera }), (e) => e.code === "23505");
    eq("G: 23505 = 1 tentativa", n, 1);
  }
  {
    // Sem a opção explícita, withTransaction continua com o comportamento antigo.
    const pool = criarPoolFake();
    let n = 0;
    await rejeita("G: sem retryTransient, 40P01 sobe direto", repository.withTransaction(async () => {
      n += 1;
      throw erroPg("40P01");
    }, { pool }), (e) => e.code === "40P01");
    eq("G: sem opt-in = 1 tentativa", n, 1);
  }

  // A persistência da Central habilita o retry (único caller de withTransaction).
  {
    const original = realPool.connect;
    const eventos = [];
    let n = 0;
    realPool.connect = async () => {
      const id = ++n;
      return {
        async query(sql) {
          const s = String(sql).trim();
          eventos.push(`${id}:${s.split(/\s+/)[0].toUpperCase()}`);
          if (s.startsWith("INSERT INTO central_vendas_imports") && id === 1) throw erroPg("40P01", "deadlock detected");
          return { rows: [{ id: 55 }] };
        },
        release() { eventos.push(`${id}:RELEASE`); },
      };
    };
    try {
      const r = await repository.persistCentralVendasImport({
        cliente: { id: 1, slug: "acme" },
        marketplace: "meli",
        competencia: "2026-09",
        motorPayload: { pedidos: [], itens: [], componentes: [] },
        resumo: {},
        fonte: "api",
      });
      eq("persist: importação criada na 2ª tentativa", r.importacao.id, 55);
      ok("persist: 1º client foi revertido e descartado, 2º concluiu", eventos.includes("1:ROLLBACK") && eventos.includes("2:COMMIT") && !eventos.includes("1:COMMIT"));
    } finally {
      realPool.connect = original;
    }
  }

  ok("withTransaction loga retry só com code (sem SQL/segredo)", avisosCapturados.length > 0 && avisosCapturados.every((l) => /^\[central-vendas\] persistência retry \d\/3 erro=40(P01|001)$/.test(l)));

  concluido = true;
  console.log(`centralVendasSchemaEnsureDeadlock.test.js: ${checks} verificações OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
