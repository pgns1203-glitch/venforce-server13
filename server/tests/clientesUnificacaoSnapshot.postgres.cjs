const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { environment } = require("./helpers/clientesUnificacaoPostgres");
const baseline = require("./helpers/clientesUnificacaoSnapshotBaseline.cjs");
const repo = require("../services/clientesUnificacao/repository");
const {
  buildPlan,
  materialSnapshot,
} = require("../services/clientesUnificacao/planner");
const { manifest } = require("./helpers/clientesUnificacaoFixture");
const { createService } = require("../services/clientesUnificacao/service");
async function main() {
  const env = await environment();
  try {
    await env.seed({ extra: true });
    const m = manifest();
    let oldQueries = 0,
      newQueries = 0;
    const original = await baseline.readSnapshot(
      {
        query: (...args) => {
          oldQueries++;
          return env.pool.query(...args);
        },
      },
      m,
    );
    const events = [];
    const scoped = await repo.readSnapshot(
      {
        query: (...args) => {
          newQueries++;
          return env.pool.query(...args);
        },
      },
      m,
      { onStage: (e) => events.push(e) },
    );
    assert.deepEqual(buildPlan(scoped, m), buildPlan(original, m));
    assert.deepEqual(
      materialSnapshot(scoped, m),
      materialSnapshot(original, m),
    );
    console.log(
      `ok — plano/validator/hash/rollback equivalentes; ${oldQueries} -> ${newQueries} consultas`,
    );
    // Catálogo mantém tabelas desconhecidas, PKs e índices; volume de outras
    // carteiras não deve contaminar snapshot ou esconder conflito relevante.
    for (let n = 0; n < 60; n++)
      await env.pool.query(
        `CREATE TABLE perf_ref_${n}(id integer PRIMARY KEY,cliente_id integer REFERENCES clientes(id))`,
      );
    await env.pool.query(
      "INSERT INTO clientes(id,nome,slug,ativo) SELECT n,'Outra carteira', 'outra-'||n,true FROM generate_series(100,4099)n",
    );
    await env.pool.query(
      "INSERT INTO cliente_contas(id,cliente_id,marketplace,nome,slug,external_account_id,ativo,is_primary) SELECT n,n,'meli','Outra operação','outra-'||n,('9000000'||n),true,false FROM generate_series(100,4099)n",
    );
    const run = async (reader) => {
      let queries = 0;
      const begin = performance.now(),
        stages = [],
        queriesProfile = [];
      const snapshot = await reader.readSnapshot(
        {
          query: async (...a) => {
            queries++;
            const started = performance.now();
            try {
              return await env.pool.query(...a);
            } finally {
              const sql = String(a[0]);
              const stage = sql.includes("information_schema.columns")
                ? "catalog.columns"
                : sql.includes("FROM pg_constraint")
                  ? "catalog.constraints"
                  : sql.includes("FROM pg_index")
                    ? "catalog.indexes"
                    : sql.includes("FROM pg_trigger")
                      ? "catalog.triggers"
                      : sql.match(/FROM "([a-z0-9_]+)"/)?.[1] || "other";
              queriesProfile.push({
                stage,
                durationMs: performance.now() - started,
              });
            }
          },
        },
        m,
        { onStage: (e) => stages.push(e) },
      );
      return {
        snapshot,
        queries,
        elapsedMs: performance.now() - begin,
        stages,
        queriesProfile,
      };
    };
    const full = await run(baseline),
      fast = await run(repo);
    assert.deepEqual(buildPlan(fast.snapshot, m), buildPlan(full.snapshot, m));
    assert.ok(fast.queries < full.queries / 3);
    assert.equal(fast.snapshot.tables.cliente_contas.length, 2);
    assert.ok(fast.snapshot.columns.some((c) => c.table_name === "perf_ref_0"));
    console.log(
      JSON.stringify({
        benchmark: "60 dependent tables + 4000 unrelated clients/accounts",
        old: {
          queries: full.queries,
          elapsedMs: full.elapsedMs,
          stages: full.queriesProfile,
        },
        optimized: { queries: fast.queries, elapsedMs: fast.elapsedMs },
        stages: fast.stages,
      }),
    );
    // Atraso de transporte determinístico (200ms por round-trip) sobre queries
    // PostgreSQL reais. Sem sleeps: reproduz o teto antigo sem testar cronômetro.
    const latencyService = (reader) => {
      let clock = 0;
      return createService({
        pool: {
          connect: async () => {
            const client = await env.pool.connect();
            return {
              query: async (...args) => {
                clock += 200;
                return client.query(...args);
              },
              release: () => client.release(),
            };
          },
        },
        repository: {
          ...repo,
          readSnapshot: reader.readSnapshot,
          audit: async () => {},
        },
        getPreviewTimeoutMs: () => 15000,
        now: () => clock,
      });
    };
    await assert.rejects(
      latencyService(baseline).preview(m, { id: 5, role: "admin" }),
      { code: "MERGE_TRANSACTION_TIMEOUT" },
    );
    assert.equal(
      (await latencyService(repo).preview(m, { id: 5, role: "admin" }))
        .validationReady,
      true,
    );
    console.log(
      "ok — snapshot real excede teto antigo com RTT modelado de 200ms; otimizado passa até com o teto antigo",
    );
    await env.pool.query(
      "INSERT INTO ml_tokens(id,cliente_id,ml_user_id,token_status,is_primary) VALUES(8888,3,'111','revoked',false)",
    );
    const conflict = await run(repo);
    assert.ok(conflict.snapshot.tables.ml_tokens.some((g) => g.id === 8888));
    assert.ok(
      buildPlan(conflict.snapshot, m).validation.blockers.some(
        (b) => b.code === "SELLER_AMBIGUOUS",
      ),
    );
    console.log("ok — Grant histórico de terceiro Cliente continua bloqueando");
    await env.pool.query("INSERT INTO perf_ref_0 VALUES(1,2)");
    const unknown = await run(repo);
    assert.ok(
      buildPlan(unknown.snapshot, m).validation.blockers.some(
        (b) =>
          b.code === "UNKNOWN_CRITICAL_REFERENCE" &&
          b.detail.table === "perf_ref_0",
      ),
    );
    console.log(
      "ok — referência crítica desconhecida descoberta/carregada/bloqueada",
    );
    // Valores não podem passar por JSON numérico e perder precisão.
    await env.pool.query(
      "CREATE DOMAIN perf_momento AS timestamptz; CREATE TABLE relatorios(id bigint PRIMARY KEY,cliente_id integer REFERENCES clientes(id),valor numeric(30,8),datas timestamp[],momento perf_momento); CREATE UNIQUE INDEX perf_type_keys ON relatorios(valor,datas,momento); INSERT INTO relatorios VALUES(9007199254740993,2,123456789012345678.12345678,ARRAY[timestamp '2026-01-01'],'2026-01-01T00:00:00Z')",
    );
    const a = await run(baseline),
      b = await run(repo);
    assert.deepEqual(
      a.snapshot.tables.relatorios,
      b.snapshot.tables.relatorios,
    );
    assert.equal(b.snapshot.tables.relatorios[0].id, "9007199254740993");
    assert.equal(
      b.snapshot.tables.relatorios[0].valor,
      "123456789012345678.12345678",
    );
    assert.ok(b.snapshot.tables.relatorios[0].datas[0] instanceof Date);
    assert.ok(b.snapshot.tables.relatorios[0].momento instanceof Date);
    console.log(
      "ok — bigint de 64 bits, numeric, domains e arrays mantêm parsers nativos",
    );
    await env.pool.query(
      "INSERT INTO clientes(id,nome,slug,ativo) SELECT n,'Fora','fora-'||n,true FROM generate_series(4100,6100)n",
    );
    await env.pool.query(
      "INSERT INTO cliente_contas(id,cliente_id,marketplace,nome,slug,external_account_id,ativo,is_primary) SELECT n,n,'meli','Fora','fora-'||n,('9000000'||n),true,false FROM generate_series(4100,6100)n",
    );
    const isolated = await run(repo);
    assert.equal(isolated.snapshot.tables.cliente_contas.length, 2);
    assert.ok(
      !isolated.snapshot.errors.some(
        (e) => e.table === "clientes" || e.table === "cliente_contas",
      ),
    );
    console.log(
      "ok — mais de 5000 registros de outras carteiras não contaminam o limite do manifesto",
    );
    await env.pool.query(
      "CREATE TABLE meli_anuncios(id integer PRIMARY KEY,cliente_id integer REFERENCES clientes(id)); INSERT INTO meli_anuncios SELECT n,2 FROM generate_series(1,5002)n",
    );
    const volume = await run(repo);
    assert.ok(
      volume.snapshot.errors.some(
        (e) =>
          e.table === "meli_anuncios" && e.code === "BOUNDED_VOLUME_EXCEEDED",
      ),
    );
    console.log(
      "ok — limite de 5000 registros relevantes continua fail-closed",
    );
    console.log(
      "8 cenários PostgreSQL de escopo/equivalência/perfil passaram.",
    );
  } finally {
    await env.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
