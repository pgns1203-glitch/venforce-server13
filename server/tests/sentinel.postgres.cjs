// server/tests/sentinel.postgres.cjs
//
// Sentinel contra um PostgreSQL LOCAL e isolado (fora do run-all).
//
//   SENTINEL_TEST_DATABASE_URL=postgres://vf@127.0.0.1:57651/postgres node tests/sentinel.postgres.cjs
//
// Cria um database descartável vf_sentinel_test_<ts>, roda e apaga. Recusa
// qualquer host que não seja localhost. ML é fixture (mlFetch/frete injetados).

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { Pool, Client } = require("pg");

const baseUrl = process.env.SENTINEL_TEST_DATABASE_URL;
if (!baseUrl) throw new Error("Defina SENTINEL_TEST_DATABASE_URL (PostgreSQL local).");
const parsed = new URL(baseUrl);
console.log(`[sentinel.postgres] host=${parsed.hostname} port=${parsed.port}`);
if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) throw new Error("LOCAL_DATABASE_REQUIRED");

const dbName = `vf_sentinel_test_${Date.now()}`;
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${dbName}`;
// O lock do ciclo abre um Client com configConexao() (DATABASE_URL) — aponta
// para o MESMO banco descartável.
process.env.DATABASE_URL = testUrl.toString();
// PG local sem SSL: o lock do ciclo usa um Client sem ssl (injetado).
const criarClient = () => new Client({ connectionString: testUrl.toString(), ssl: false });

const { ensureSentinelSchema } = require("../services/sentinel/sentinelSchema");
const { executarCiclo, LOCK_KEY } = require("../services/sentinel/sentinelPollingWorker");
const { buildMotorFromOrders, buildCostMap } = require("../services/centralVendas/centralVendasSyncService");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const FIXTURE_SQL = `
CREATE TABLE clientes (id integer PRIMARY KEY, nome text, slug text UNIQUE, ativo boolean DEFAULT true);
CREATE TABLE cliente_contas (id integer PRIMARY KEY, cliente_id integer REFERENCES clientes(id), marketplace text,
  nome text, slug text, external_account_id text, is_primary boolean, ativo boolean);
CREATE TABLE custos (id serial PRIMARY KEY, base_id integer NOT NULL, produto_id text NOT NULL,
  custo_produto numeric NOT NULL DEFAULT 0, imposto_percentual numeric NOT NULL DEFAULT 0,
  sku text NOT NULL DEFAULT '', sku_id text NOT NULL DEFAULT '', id_model text);
INSERT INTO clientes VALUES (1, 'Cliente Teste', 'cliente-teste', true);
INSERT INTO cliente_contas VALUES (10, 1, 'meli', 'Conta A', 'conta-a', '5551', true, true);
INSERT INTO cliente_contas VALUES (20, 1, 'meli', 'Conta B', 'conta-b', '5552', false, true);
INSERT INTO custos (base_id, produto_id, custo_produto, imposto_percentual, id_model) VALUES
  (1, 'MLB400', 50.00, 10, NULL),
  (1, 'MLB500', 10.00, 5, '11'),
  (1, 'MLB500', 20.00, 5, '22');
`;

const H = 3600 * 1000;
const agora = Date.now();
const iso = (ms) => new Date(ms).toISOString();

function pedido(id, mlb, { shipment, updatedMs, criadoMs = agora - H } = {}) {
  return {
    id,
    status: "paid",
    date_created: iso(criadoMs),
    date_last_updated: iso(updatedMs ?? agora - H),
    shipping: { id: shipment, logistic_type: "cross_docking" },
    order_items: [{ item: { id: mlb, title: "P", seller_sku: null, variation_id: null }, quantity: 2, unit_price: 100, sale_fee: 12.5 }],
  };
}

// "Orders API" em memória: filtra por date_last_updated e respeita offset.
function criarMlFetch(pedidos, { porPagina = 50 } = {}) {
  const chamadas = [];
  const fn = async (_clienteId, p) => {
    const qs = new URLSearchParams(p.split("?")[1] || "");
    const from = Date.parse(qs.get("order.date_last_updated.from").replace("-00:00", "Z"));
    const to = Date.parse(qs.get("order.date_last_updated.to").replace("-00:00", "Z"));
    const offset = Number(qs.get("offset"));
    chamadas.push([from, to]);
    const dentro = pedidos.filter((o) => Date.parse(o.date_last_updated) >= from && Date.parse(o.date_last_updated) <= to);
    return { ok: true, status: 200, data: { paging: { total: dentro.length }, results: dentro.slice(offset, offset + Math.min(50, porPagina)) } };
  };
  fn.chamadas = chamadas;
  return fn;
}

function ctxDe(contaId) {
  return async () => ({ clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: contaId, sellerId: contaId === 10 ? "5551" : "5552", baseId: 1 });
}

async function main() {
  const admin = new Pool({ connectionString: baseUrl, ssl: false, max: 1 });
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const pool = new Pool({ connectionString: testUrl.toString(), ssl: false, max: 4 });
  try {
    await pool.query(FIXTURE_SQL);

    console.log("\n▸ Critério 1 — migration 2x");
    await ensureSentinelSchema(pool);
    const outroPool = new Pool({ connectionString: testUrl.toString(), ssl: false, max: 1 });
    await ensureSentinelSchema(outroPool); // outro "db": fura o single-flight, aplica de novo
    await outroPool.end();
    const ddl = fs.readFileSync(path.join(__dirname, "../sql/migrations/20261023_sentinel_pedidos.sql"), "utf8");
    await pool.query(ddl);
    await pool.query(ddl);
    const ddlV0a = fs.readFileSync(path.join(__dirname, "../sql/migrations/20261027_sentinel_v0a.sql"), "utf8");
    await pool.query(ddlV0a);
    await pool.query(ddlV0a);
    const tabelas = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'sentinel_%' ORDER BY 1");
    eq("3 tabelas sentinel_* após aplicações repetidas (runner 2x + SQL puro 2x + V0-a 2x)",
      tabelas.rows.map((r) => r.table_name), ["sentinel_checkpoints", "sentinel_pedido_excecoes", "sentinel_pedidos"]);

    // Frete por shipment (mutável: o frete do 9004 "chega" depois).
    const fretes = new Map([
      ["9001", { valor: 18.4, status: "real", receitaComprador: 0 }],
      ["9002", { valor: 10, status: "real", receitaComprador: 0 }],
      ["9003", { valor: 10, status: "real", receitaComprador: 0 }],
      ["9004", { valor: null, status: "ausente", receitaComprador: null }],
    ]);
    const buscarFrete = async ({ shipmentId }) => fretes.get(String(shipmentId)) || { valor: null, status: "ausente" };

    const P = [
      pedido(4001, "MLB400", { shipment: 9001 }),  // confirmada
      pedido(4002, "MLB999", { shipment: 9002 }),  // sem_custo
      pedido(4003, "MLB500", { shipment: 9003 }),  // custo_ambiguo
      pedido(4004, "MLB400", { shipment: 9004 }),  // provisoria (sem frete)
    ];
    const mlFetchA = criarMlFetch(P);
    const since = iso(agora - 2 * H);
    const depsA = {
      db: pool,
      nowMs: agora,
      resolverConta: ctxDe(10),
      buscarFrete,
      fetchOrderByIdFn: async (_ctx, id) => P.find((o) => String(o.id) === String(id)),
      fetchOpts: { mlFetchFn: mlFetchA },
    };
    await pool.query("INSERT INTO sentinel_checkpoints (cliente_conta_id, ultimo_date_last_updated) VALUES (10, $1)", [since]);

    console.log("\n▸ Ciclo 1 (conta A)");
    const c1 = await executarCiclo({ criarClient, contaIds: [10], ...depsA });
    eq("conta A sem erro", c1.contas[0].erro, null);
    const estados = await pool.query(
      "SELECT pedido_id, estado_margem, margem_valor, faturamento, comissao, frete, custo, imposto, pendencias FROM sentinel_pedidos WHERE cliente_conta_id = 10 ORDER BY pedido_id");
    eq("4 pedidos gravados", estados.rows.length, 4);
    eq("estados", estados.rows.map((r) => [r.pedido_id, r.estado_margem]),
      [["4001", "confirmada"], ["4002", "sem_custo"], ["4003", "custo_ambiguo"], ["4004", "provisoria"]]);

    console.log("\n▸ Critério 3 (fixture) — margem = motor da Central");
    const central = buildMotorFromOrders({
      orders: [P[0]],
      costMap: buildCostMap((await pool.query("SELECT produto_id, custo_produto, imposto_percentual FROM custos WHERE base_id = 1")).rows),
      freteMap: new Map([["9001", fretes.get("9001")]]),
      clienteSlug: "cliente-teste",
      competencia: P[0].date_created.slice(0, 7),
    }).pedidos[0];
    const p1 = estados.rows[0];
    eq("margem_valor do pedido 4001 = lucroContribuicao da Central (diferença R$ 0,00)", Number(p1.margem_valor), central.lucroContribuicao);
    console.log(`      Sentinel ${p1.margem_valor} | Central ${central.lucroContribuicao} | faturamento ${p1.faturamento} comissão ${p1.comissao} frete ${p1.frete} custo ${p1.custo} imposto ${p1.imposto}`);

    console.log("\n▸ Critérios 4 e 5 — sem_custo / custo_ambiguo");
    eq("4002 sem_custo → margem_valor NULL", estados.rows[1].margem_valor, null);
    eq("4003 custo_ambiguo (MLB500 com 2 linhas, item sem variação) → margem_valor NULL", estados.rows[2].margem_valor, null);
    eq("4004 provisoria → pendência sem_frete", estados.rows[3].pendencias, ["sem_frete"]);

    const cp1 = (await pool.query("SELECT * FROM sentinel_checkpoints WHERE cliente_conta_id = 10")).rows[0];
    eq("checkpoint avançou até o fim da última janela (agora)", new Date(cp1.ultimo_date_last_updated).getTime(), agora);

    console.log("\n▸ Provisória não é eterna");
    fretes.set("9004", { valor: 7.5, status: "real", receitaComprador: 0 });
    // Ciclo 2: nada novo na janela (checkpoint = agora); só o reprocessamento
    // das provisórias pode mudar o 4004 — date_last_updated NÃO mudou.
    await executarCiclo({ criarClient, contaIds: [10], ...depsA });
    const p4 = (await pool.query("SELECT estado_margem, frete, pendencias FROM sentinel_pedidos WHERE pedido_id = '4004'")).rows[0];
    eq("frete chegou sem mudar date_last_updated → 4004 vira confirmada", [p4.estado_margem, Number(p4.frete), p4.pendencias], ["confirmada", 7.5, []]);

    console.log("\n▸ Critério 2 (fixture) — rodar de novo não duplica nem toca updated_at");
    const antes = (await pool.query("SELECT pedido_id, updated_at FROM sentinel_pedidos ORDER BY pedido_id")).rows;
    await pool.query("UPDATE sentinel_checkpoints SET ultimo_date_last_updated = $1 WHERE cliente_conta_id = 10", [since]);
    const c3 = await executarCiclo({ criarClient, contaIds: [10], ...depsA });
    const depois = (await pool.query("SELECT pedido_id, updated_at FROM sentinel_pedidos ORDER BY pedido_id")).rows;
    eq("mesma contagem", depois.length, antes.length);
    const dup = await pool.query("SELECT COUNT(*)::int AS n FROM (SELECT cliente_conta_id, pedido_id FROM sentinel_pedidos GROUP BY 1,2 HAVING COUNT(*) > 1) d");
    eq("zero duplicatas", dup.rows[0].n, 0);
    eq("updated_at inalterado em todos os pedidos sem mudança",
      depois.map((r) => r.updated_at.getTime()), antes.map((r) => r.updated_at.getTime()));
    eq("os 4 voltaram como 'pulado' (estado estável + date_last_updated igual)", c3.contas[0].porResultado, { pulado: 4 });

    console.log("\n▸ Truncamento → bissecção (conta B)");
    // 6 pedidos em 6h; a "API" devolve no máximo 2 por página e o teto é 1
    // página → qualquer janela com 3+ pedidos trunca.
    const PB = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5].map((h, i) =>
      pedido(5001 + i, "MLB400", { shipment: 9001, updatedMs: agora - 6 * H + h * H }));
    const mlFetchB = criarMlFetch(PB, { porPagina: 2 });
    const cB = await executarCiclo({
      criarClient, contaIds: [20], db: pool, nowMs: agora, resolverConta: ctxDe(20), buscarFrete,
      fetchOrderByIdFn: async () => { throw new Error("não usado"); },
      fetchOpts: { mlFetchFn: mlFetchB, config: { maxPages: 1, windowMaxMs: 6 * H, windowMinMs: 15 * 60 * 1000 } },
      config: { lookbackHours: 6 },
    });
    const gravadosB = await pool.query("SELECT COUNT(*)::int AS n FROM sentinel_pedidos WHERE cliente_conta_id = 20");
    eq("todos os 6 pedidos gravados", gravadosB.rows[0].n, 6);
    ok("a janela grande truncou e foi dividida", mlFetchB.chamadas.length > 1);
    const cpB = (await pool.query("SELECT * FROM sentinel_checkpoints WHERE cliente_conta_id = 20")).rows[0];
    eq("checkpoint da conta B avançou até agora", new Date(cpB.ultimo_date_last_updated).getTime(), agora);
    eq("sem ultimo_erro", [cB.contas[0].erro, cpB.ultimo_erro], [null, null]);

    console.log("\n▸ Critério 6 — falha na conta");
    const cInv = await executarCiclo({ criarClient, contaIds: [999999], db: pool, nowMs: agora });
    // M05: conta INEXISTENTE não ganha linha de checkpoint (seria órfã sem FK, herdável
    // por uma conta futura com o mesmo id); o erro fica no resumo do ciclo e no log.
    const cpInv = (await pool.query("SELECT * FROM sentinel_checkpoints WHERE cliente_conta_id = 999999")).rows[0];
    eq("conta inexistente → nenhum checkpoint órfão", cpInv, undefined);
    ok("… erro SENTINEL_CONTA_NAO_ENCONTRADA no resumo do ciclo", /SENTINEL_CONTA_NAO_ENCONTRADA/.test(cInv.contas[0].erro));
    ok("o ciclo devolve o erro da conta", /não encontrada/.test(cInv.contas[0].erro));

    const cpAntes = (await pool.query("SELECT ultimo_date_last_updated FROM sentinel_checkpoints WHERE cliente_conta_id = 10")).rows[0];
    await executarCiclo({
      criarClient, contaIds: [10], ...depsA, nowMs: agora + H,
      fetchOpts: { mlFetchFn: async () => ({ ok: false, status: 403, data: null }) },
    });
    const cpDepois = (await pool.query("SELECT * FROM sentinel_checkpoints WHERE cliente_conta_id = 10")).rows[0];
    ok("Orders API 403 → ultimo_erro preenchido", /SENTINEL_ORDERS_HTTP_ERROR/.test(cpDepois.ultimo_erro));
    eq("… e checkpoint igual ao anterior",
      new Date(cpDepois.ultimo_date_last_updated).getTime(), new Date(cpAntes.ultimo_date_last_updated).getTime());

    console.log("\n▸ Advisory lock");
    const segurando = new Client({ connectionString: testUrl.toString(), ssl: false });
    await segurando.connect();
    await segurando.query("SELECT pg_advisory_lock(hashtext($1))", [LOCK_KEY]);
    const cLock = await executarCiclo({ criarClient, contaIds: [10], ...depsA });
    eq("outro ciclo com o lock → este pula", cLock.pulado, true);
    await segurando.end();

    console.log(`\n${checks} verificações passaram (PostgreSQL local ${parsed.hostname}).`);
  } finally {
    await pool.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
    await require("../config/database").end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
