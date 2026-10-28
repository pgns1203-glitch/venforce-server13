// Exclusão permanente de cliente × tabelas do Sentinel, em PostgreSQL LOCAL descartável:
//   SENTINEL_TEST_DATABASE_URL=postgres://vf@127.0.0.1:57651/postgres node tests/sentinelPurge.postgres.cjs
// Prova: pedidos/incidentes/eventos cascateiam, checkpoints/exceções (sem FK) são
// apagados, e um worker gravando checkpoint em paralelo não deixa linha órfã.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool, Client } = require("pg");

const baseUrl = process.env.SENTINEL_TEST_DATABASE_URL;
if (!baseUrl) throw new Error("Defina SENTINEL_TEST_DATABASE_URL (PostgreSQL local).");
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseUrl).hostname)) throw new Error("LOCAL_DATABASE_REQUIRED");
const dbName = `vf_sentinel_purge_${Date.now()}`;
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${dbName}`;

let checks = 0;
const eq = (label, a, b) => { assert.deepStrictEqual(a, b, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); };

(async () => {
  const admin = new Client({ connectionString: baseUrl, ssl: false });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const pool = new Pool({ connectionString: testUrl.toString(), ssl: false, max: 4 });
  // config/database força SSL: injeta o pool local antes de carregar o serviço.
  const dbPath = require.resolve("../config/database");
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
  const { purgarClientePermanentemente } = require("../services/clientes/clientePurgeService");
  const { registrarExcecao } = require("../services/sentinel/sentinelExcecoes");
  const q = async (sql, p) => (await pool.query(sql, p)).rows;
  const contar = async () => Object.fromEntries(await Promise.all(
    ["sentinel_pedidos", "sentinel_checkpoints", "sentinel_pedido_excecoes", "sentinel_incidentes", "sentinel_incidente_eventos"]
      .map(async (t) => [t, (await q(`SELECT COUNT(*)::int n FROM ${t}`))[0].n])));
  try {
    await pool.query(`
      CREATE TABLE clientes (id integer PRIMARY KEY, nome text, slug text UNIQUE, ativo boolean DEFAULT true);
      CREATE TABLE cliente_contas (id integer PRIMARY KEY, cliente_id integer REFERENCES clientes(id) ON DELETE CASCADE, marketplace text,
        nome text, slug text, external_account_id text, is_primary boolean, ativo boolean);
      INSERT INTO clientes VALUES (1, 'Apagar', 'apagar', true), (2, 'Fica', 'fica', true);
      INSERT INTO cliente_contas VALUES (10, 1, 'meli', 'A', 'a', '1', true, true), (20, 2, 'meli', 'B', 'b', '2', true, true);`);
    for (const f of ["20261023_sentinel_pedidos.sql", "20261027_sentinel_v0a.sql", "20261028_sentinel_incidentes.sql"]) {
      await pool.query(fs.readFileSync(path.resolve(__dirname, "../sql/migrations", f), "utf8"));
    }
    for (const [cli, conta] of [[1, 10], [2, 20]]) {
      await pool.query(`INSERT INTO sentinel_pedidos (cliente_id, cliente_conta_id, pedido_id, competencia, itens, estado_margem, pendencias)
        VALUES ($1, $2, 'P${conta}', '2026-10', '[]', 'confirmada', '[]')`, [cli, conta]);
      await pool.query("INSERT INTO sentinel_checkpoints (cliente_conta_id) VALUES ($1)", [conta]);
      await registrarExcecao(pool, conta, `E${conta}`, "frete");
      const inc = await pool.query(`INSERT INTO sentinel_incidentes (cliente_conta_id, tipo, chave, severidade, confiabilidade, titulo, motivo, proxima_acao, fingerprint)
        VALUES ($1, 'margem_negativa', 'MLB1', 'media', 'calculado', 't', 'm', 'a', 'f') RETURNING id`, [conta]);
      await pool.query("INSERT INTO sentinel_incidente_eventos (incidente_id, evento, ator) VALUES ($1, 'aberto', 'sentinel')", [inc.rows[0].id]);
    }
    eq("antes: 2 de cada", await contar(), { sentinel_pedidos: 2, sentinel_checkpoints: 2, sentinel_pedido_excecoes: 2, sentinel_incidentes: 2, sentinel_incidente_eventos: 2 });

    // Worker grava checkpoint da conta 10 numa transação ABERTA (FOR KEY SHARE na Conta)
    // enquanto o purge começa: o purge espera o lock da Conta e só então limpa.
    await pool.query("DELETE FROM sentinel_checkpoints WHERE cliente_conta_id = 10");
    const worker = new Client({ connectionString: testUrl.toString(), ssl: false });
    await worker.connect();
    await worker.query("BEGIN");
    await worker.query(`INSERT INTO sentinel_checkpoints (cliente_conta_id, ultimo_date_last_updated)
      SELECT cc.id, NOW() FROM cliente_contas cc WHERE cc.id = 10 FOR KEY SHARE`);
    const purge = purgarClientePermanentemente("apagar");
    await new Promise((r) => setTimeout(r, 400));
    await worker.query("COMMIT");
    const r = await purge;
    // E um worker que tente gravar DEPOIS do purge não acha a Conta.
    await worker.query(`INSERT INTO sentinel_checkpoints (cliente_conta_id, ultimo_date_last_updated)
      SELECT cc.id, NOW() FROM cliente_contas cc WHERE cc.id = 10 FOR KEY SHARE ON CONFLICT (cliente_conta_id) DO NOTHING`);
    await registrarExcecao(pool, 10, "E-tarde", "frete");
    await worker.end();
    eq("purge informa checkpoints/exceções apagados", r.apagados.filter((a) => a.tabela.startsWith("sentinel_")).map((a) => a.tabela).sort(), ["sentinel_checkpoints", "sentinel_pedido_excecoes"]);
    eq("depois: só o cliente 2 tem dados Sentinel; nada órfão da conta 10", await contar(),
      { sentinel_pedidos: 1, sentinel_checkpoints: 1, sentinel_pedido_excecoes: 1, sentinel_incidentes: 1, sentinel_incidente_eventos: 1 });
    eq("o que sobrou é da conta 20", (await q("SELECT cliente_conta_id FROM sentinel_checkpoints UNION ALL SELECT cliente_conta_id FROM sentinel_pedido_excecoes")).map((x) => x.cliente_conta_id), [20, 20]);
    console.log(`\n${checks} verificações passaram (purge × Sentinel, PG local).`);
  } finally {
    await pool.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
    await admin.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
