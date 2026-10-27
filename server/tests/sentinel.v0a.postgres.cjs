// server/tests/sentinel.v0a.postgres.cjs
//
// Sentinel V0-a contra um PostgreSQL LOCAL descartável (fora do run-all):
//   SENTINEL_TEST_DATABASE_URL=postgres://vf@127.0.0.1:57651/postgres node tests/sentinel.v0a.postgres.cjs
// Cria vf_sentinel_v0a_<ts>, roda e apaga. Recusa host que não seja local.
// ML é fixture (mlFetchBase/buscarFrete injetados); nunca lê server/.env.

const assert = require("assert");
const { Pool, Client } = require("pg");

const baseUrl = process.env.SENTINEL_TEST_DATABASE_URL;
if (!baseUrl) throw new Error("Defina SENTINEL_TEST_DATABASE_URL (PostgreSQL local).");
const parsed = new URL(baseUrl);
console.log(`[sentinel.v0a.postgres] host=${parsed.hostname} port=${parsed.port}`);
if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) throw new Error("LOCAL_DATABASE_REQUIRED");

const dbName = `vf_sentinel_v0a_${Date.now()}`;
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${dbName}`;
process.env.DATABASE_URL = testUrl.toString();
const criarClient = () => new Client({ connectionString: testUrl.toString(), ssl: false });

const { ensureSentinelSchema, verificarSentinelSchema } = require("../services/sentinel/sentinelSchema");
const { executarCiclo, processarConta, LOCK_KEY } = require("../services/sentinel/sentinelPollingWorker");
const { processarPedido, gravarLinha, calcularPedido } = require("../services/sentinel/sentinelPedidoService");
const { reabrirExcecao, registrarExcecao } = require("../services/sentinel/sentinelExcecoes");
const { selecionarContas, executarTick } = require("../workers/sentinelWorker");

let checks = 0;
function ok(label, cond) { assert.ok(cond, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); }
function eq(label, a, b) { assert.deepStrictEqual(a, b, `FALHOU: ${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); checks += 1; console.log(`  ok  ${label}`); }

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
INSERT INTO cliente_contas VALUES (30, 1, 'meli', 'Conta C', 'conta-c', '5553', false, true);
INSERT INTO cliente_contas VALUES (41, 1, 'meli', 'Conta Piloto', 'conta-p', '5541', false, true);
INSERT INTO custos (base_id, produto_id, custo_produto, imposto_percentual, id_model) VALUES (1, 'MLB400', 50.00, 10, NULL);
`;

const H = 3600 * 1000;
const agora = Date.now();
const iso = (ms) => new Date(ms).toISOString();

function pedido(id, { mlb = "MLB400", shipment, updatedMs, status = "paid" } = {}) {
  return {
    id, status,
    date_created: iso(agora - 3 * H),
    date_last_updated: iso(updatedMs ?? agora - H),
    shipping: { id: shipment ?? id + 5000, logistic_type: "cross_docking" },
    order_items: [{ item: { id: mlb, title: "P", seller_sku: null, variation_id: null }, quantity: 2, unit_price: 100, sale_fee: 12.5 }],
  };
}

// ML fake no nível do mlFetch (recebe as opções que o Sentinel passa, p/ checar noRefresh).
function criarMlBase(pedidos, { tokenExpiraEm = null, porPagina = 50 } = {}) {
  const log = [];
  const fn = async (_cli, p, opts = {}) => {
    log.push({ p, opts });
    if (tokenExpiraEm && p.startsWith(tokenExpiraEm)) { const e = new Error("expirado"); e.code = "ML_TOKEN_EXPIRED"; throw e; }
    if (p.startsWith("/shipments/")) return { ok: true, status: 200, data: { senders: [{ user_id: opts.mlUserId, cost: 10 }], receiver: { cost: 0 } } };
    if (p.startsWith("/orders/search")) {
      const qs = new URLSearchParams(p.split("?")[1]);
      const from = Date.parse(qs.get("order.date_last_updated.from").replace("-00:00", "Z"));
      const to = Date.parse(qs.get("order.date_last_updated.to").replace("-00:00", "Z"));
      const off = Number(qs.get("offset"));
      const dentro = fn.pedidos.filter((o) => Date.parse(o.date_last_updated) >= from && Date.parse(o.date_last_updated) <= to);
      return { ok: true, status: 200, data: { paging: { total: dentro.length }, results: dentro.slice(off, off + porPagina) } };
    }
    if (p.startsWith("/orders/")) {
      const o = fn.pedidos.find((x) => `/orders/${x.id}` === p);
      return { ok: !!o, status: o ? 200 : 404, data: o || null };
    }
    return { ok: false, status: 404, data: null };
  };
  fn.pedidos = pedidos;
  fn.log = log;
  return fn;
}

const ctxDe = (contaId, sellerId) => async () => ({ clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: contaId, sellerId, baseId: 1 });
const cfgBase = { overlapMs: 2 * H, maxTentativas: 3, cicloMaxMs: 60000, maxChamadasPorConta: 500 };

async function main() {
  const admin = new Pool({ connectionString: baseUrl, ssl: false, max: 1 });
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const pool = new Pool({ connectionString: testUrl.toString(), ssl: false, max: 4 });
  const q = async (sql, p) => (await pool.query(sql, p)).rows;
  const cp = async (id) => (await q("SELECT * FROM sentinel_checkpoints WHERE cliente_conta_id = $1", [id]))[0];
  const ms = (d) => (d ? new Date(d).getTime() : null);
  const setCp = (id, msv) => pool.query(
    `INSERT INTO sentinel_checkpoints (cliente_conta_id, ultimo_date_last_updated) VALUES ($1, $2)
     ON CONFLICT (cliente_conta_id) DO UPDATE SET ultimo_date_last_updated = EXCLUDED.ultimo_date_last_updated`, [id, iso(msv)]);
  try {
    await pool.query(FIXTURE_SQL);
    console.log("\n▸ schema ausente: verificação falha SEM DDL; presente: segue");
    let eAus = null;
    try { await verificarSentinelSchema(pool); } catch (x) { eAus = x; }
    eq("banco sem migrations ⇒ SENTINEL_SCHEMA_AUSENTE (3 tabelas)", [eAus && eAus.code, eAus && eAus.faltando.length], ["SENTINEL_SCHEMA_AUSENTE", 3]);
    eq("verificação não criou nada (0 tabelas sentinel_*)", (await q("SELECT COUNT(*)::int n FROM pg_class WHERE relname LIKE 'sentinel_%'"))[0].n, 0);
    const wAus = await require("../workers/sentinelWorker").iniciar({
      env: { SENTINEL_WORKER_ENABLED: "true", SENTINEL_CONTAS_ALLOWLIST: "41" }, logger: { log() {}, error() {} },
      criarPool: () => new Pool({ connectionString: testUrl.toString(), ssl: false, max: 1 }),
    }).then(() => null, (e) => e);
    eq("worker com schema ausente falha na partida", wAus && wAus.code, "SENTINEL_SCHEMA_AUSENTE");
    eq("… e continua sem nenhuma tabela sentinel_* (0 DDL)", (await q("SELECT COUNT(*)::int n FROM pg_class WHERE relname LIKE 'sentinel_%'"))[0].n, 0);
    const fonteRunOnce = require("fs").readFileSync(require("path").join(__dirname, "../scripts/sentinel-run-once.js"), "utf8");
    ok("run-once: padrão = verificar; ensure só sob --aplicar-schema", /aplicar-schema"\] === true\) await ensureSentinelSchema\(pool\);\s*else await verificarSentinelSchema\(pool\)/.test(fonteRunOnce));
    await ensureSentinelSchema(pool);
    eq("presente ⇒ verificação ok", (await verificarSentinelSchema(pool)).ok, true);
    const wOk = await require("../workers/sentinelWorker").iniciar({
      env: { SENTINEL_WORKER_ENABLED: "true", SENTINEL_CONTAS_ALLOWLIST: "41", SENTINEL_POLL_INTERVAL_MS: "3600000" }, logger: { log() {}, error() {} },
      criarPool: () => new Pool({ connectionString: testUrl.toString(), ssl: false, max: 1 }),
      executar: async () => ({ contas: [] }),
    });
    ok("worker com schema presente inicia", wOk.iniciado === true);
    await wOk.parar("teste");
    const nenhumaViolacao = (await q("SELECT 1 FROM sentinel_pedido_excecoes LIMIT 1")).length === 0;
    ok("schema V0-a aplicado (excecoes, payload_hash, atraso)", nenhumaViolacao
      && (await q("SELECT column_name FROM information_schema.columns WHERE table_name IN ('sentinel_pedidos','sentinel_checkpoints') AND column_name IN ('payload_hash','atraso_segundos','atraso_medido_em')")).length === 3);

    // ── 1 + 2 + 3 ─────────────────────────────────────────────────────────
    console.log("\n▸ 1. mesmo pedido 2x sem duplicar");
    const P1 = [pedido(7001), pedido(7002, { mlb: "MLB400" })];
    const ml = criarMlBase(P1);
    const dep = (extra = {}) => ({ criarClient, db: pool, nowMs: agora, resolverConta: ctxDe(10, "5551"), mlFetchBase: ml, config: cfgBase, ...extra });
    await setCp(10, agora - 4 * H);
    const c1 = await executarCiclo({ contaIds: [10], ...dep() });
    eq("ciclo 1 sem erro", c1.contas[0].erro, null);
    const c2 = await executarCiclo({ contaIds: [10], ...dep() });
    eq("ciclo 2 (mesmos pedidos) sem erro", c2.contas[0].erro, null);
    eq("2 linhas, zero duplicatas", (await q("SELECT COUNT(*)::int n FROM sentinel_pedidos WHERE cliente_conta_id = 10"))[0].n, 2);
    eq("ciclo 2: 100% 'pulado' (date igual + hash igual)", c2.contas[0].porResultado, { pulado: 2 });

    console.log("\n▸ 8 (parte). toda chamada ao ML levou noRefresh:true");
    ok("chamadas registradas (orders + frete)", ml.log.length >= 4 && ml.log.some((c) => c.p.startsWith("/shipments/")));
    ok("100% das chamadas com noRefresh:true", ml.log.every((c) => c.opts.noRefresh === true));
    ok("100% com mlUserId da conta (5551)", ml.log.every((c) => c.opts.mlUserId === "5551"));

    console.log("\n▸ B. checkpoint − overlap, atraso, nunca recua");
    const cpAntes = await cp(10);
    ok("coluna de atraso preenchida", Number(cpAntes.atraso_segundos) >= 0 && cpAntes.atraso_medido_em);
    eq("atraso medido APÓS o ciclo (relógio − checkpoint novo)", Number(cpAntes.atraso_segundos), Math.max(0, Math.round((agora - ms(cpAntes.ultimo_date_last_updated)) / 1000)));
    const idxFrom = (log) => log.filter((c) => c.p.startsWith("/orders/search")).map((c) => Date.parse(new URLSearchParams(c.p.split("?")[1]).get("order.date_last_updated.from").replace("-00:00", "Z")));
    ml.log.length = 0;
    await executarCiclo({ contaIds: [10], ...dep() });
    eq("since do ciclo = checkpoint − 2h (overlap)", Math.min(...idxFrom(ml.log)), ms(cpAntes.ultimo_date_last_updated) - 2 * H);
    ok("checkpoint não recuou apesar da janela de overlap", ms((await cp(10)).ultimo_date_last_updated) >= ms(cpAntes.ultimo_date_last_updated));
    // Regressão E0 (27/10): após --since antigo, o atraso gravado era a idade da janela pedida (~56 dias).
    const cSince = await executarCiclo({ contaIds: [10], ...dep(), redefinirCheckpoint: new Date(agora - 30 * 24 * H).toISOString() });
    ok("--since 30d: atraso inicial = idade da janela (diagnóstico)", cSince.contas[0].atrasoInicialSegundos >= 30 * 24 * 3600);
    ok("--since 30d: atraso gravado pós-ciclo ≈ 0 (checkpoint avançou)", Number((await cp(10)).atraso_segundos) < 3600 && cSince.contas[0].atrasoSegundos < 3600);

    console.log("\n▸ 2. mudança financeira (mesma ml_date_last_updated, custo mudou)");
    const antes = (await q("SELECT custo, margem_valor, payload_hash, updated_at, ml_date_last_updated FROM sentinel_pedidos WHERE pedido_id = '7001'"))[0];
    await pool.query("UPDATE custos SET custo_produto = 60 WHERE produto_id = 'MLB400'");
    const shipAntes = ml.log.filter((c) => c.p.startsWith("/shipments/")).length;
    const c3 = await executarCiclo({ contaIds: [10], ...dep() });
    const shipDepois = ml.log.filter((c) => c.p.startsWith("/shipments/")).length;
    const depois = (await q("SELECT custo, margem_valor, payload_hash, updated_at, ml_date_last_updated FROM sentinel_pedidos WHERE pedido_id = '7001'"))[0];
    ok("custo atualizado sem o ML mexer no pedido", Number(depois.custo) > Number(antes.custo));
    ok("hash mudou, date igual", depois.payload_hash !== antes.payload_hash && ms(depois.ml_date_last_updated) === ms(antes.ml_date_last_updated));
    ok("margem recalculada (menor)", Number(depois.margem_valor) < Number(antes.margem_valor));
    eq("resultado do ciclo: 2 gravados", c3.contas[0].porResultado, { gravado: 2 });
    eq("frete reaproveitado do banco (0 chamadas /shipments no recálculo)", shipDepois - shipAntes, 0);

    console.log("\n▸ 3. observação antiga não regride");
    const velho = pedido(7001, { updatedMs: agora - 5 * H, status: "cancelled" });
    const r = await processarPedido({ clienteId: 1, clienteContaId: 10, clienteSlug: "cliente-teste", sellerId: "5551", baseId: 1 },
      velho, { db: pool, buscarFrete: async () => ({ valor: 1, status: "real" }), cacheCusto: new Map(), forcar: true });
    eq("pré-check: obsoleto → inalterado", [r.resultado, r.obsoleto], ["inalterado", true]);
    const linhaVelha = calcularPedido({ order: velho, freteEntry: { valor: 1, status: "real" }, indiceCusto: await require("../services/sentinel/sentinelCusto").carregarIndiceCusto(1, pool), clienteSlug: "cliente-teste" });
    eq("UPSERT (defesa no SQL): date menor não grava", await gravarLinha(pool, { clienteId: 1, clienteContaId: 10 }, linhaVelha), false);
    const aposVelho = (await q("SELECT status_ml, custo, ml_date_last_updated FROM sentinel_pedidos WHERE pedido_id = '7001'"))[0];
    eq("linha intacta (status paid, custo anterior)", [aposVelho.status_ml, Number(aposVelho.custo), ms(aposVelho.ml_date_last_updated)], ["paid", Number(depois.custo), ms(depois.ml_date_last_updated)]);
    const linhaNova = { ...linhaVelha, ml_date_last_updated: iso(agora), status_ml: "paid" };
    eq("date maior grava", await gravarLinha(pool, { clienteId: 1, clienteContaId: 10 }, linhaNova), true);

    // ── 4 + 5 + 6 ─────────────────────────────────────────────────────────
    console.log("\n▸ 4/5. erro permanente → exceção (retentando ×2, quarentena na 3ª); checkpoint só avança após exceção durável");
    const PE = [pedido(8001, { updatedMs: agora - 2 * H }), pedido(8002, { updatedMs: agora - 2 * H })];
    const mlE = criarMlBase(PE);
    const freteQuebra = async ({ shipmentId }) => {
      if (String(shipmentId) === String(8001 + 5000)) throw new Error("frete explodiu (permanente)");
      return { valor: 10, status: "real", receitaComprador: 0 };
    };
    const depE = (extra = {}) => ({ criarClient, db: pool, nowMs: agora, resolverConta: ctxDe(20, "5552"), mlFetchBase: mlE, buscarFrete: freteQuebra, config: cfgBase, ...extra });
    await setCp(20, agora - 3 * H);
    const cpIni = ms((await cp(20)).ultimo_date_last_updated);
    for (const tentativa of [1, 2]) {
      const c = await executarCiclo({ contaIds: [20], ...depE() });
      const ex = (await q("SELECT * FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 20 AND pedido_id = '8001'"))[0];
      eq(`tentativa ${tentativa}: exceção 'retentando' (${tentativa}/3)`, [ex.status, ex.tentativas], ["retentando", tentativa]);
      eq(`tentativa ${tentativa}: checkpoint NÃO avançou`, ms((await cp(20)).ultimo_date_last_updated), cpIni);
      ok(`tentativa ${tentativa}: ultimo_erro aponta o pedido`, /SENTINEL_PEDIDO_ERRO/.test((await cp(20)).ultimo_erro) && c.contas[0].retentando === 1);
    }
    ok("o outro pedido (8002) foi gravado mesmo com o vizinho falhando", (await q("SELECT 1 FROM sentinel_pedidos WHERE pedido_id = '8002' AND cliente_conta_id = 20")).length === 1);
    const c3E = await executarCiclo({ contaIds: [20], ...depE() });
    const ex3 = (await q("SELECT * FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 20 AND pedido_id = '8001'"))[0];
    eq("3ª tentativa: quarentena (3/3)", [ex3.status, ex3.tentativas], ["quarentena", 3]);
    ok("checkpoint AVANÇOU depois da exceção durável", ms((await cp(20)).ultimo_date_last_updated) > cpIni);
    eq("quarentena não conta como processado (só o 8002)", [c3E.contas[0].quarentena, c3E.contas[0].processados], [1, 1]);
    eq("sem ultimo_erro após quarentena", (await cp(20)).ultimo_erro, null);
    const linha8001 = (await q("SELECT estado_margem FROM sentinel_pedidos WHERE pedido_id = '8001' AND cliente_conta_id = 20"))[0];
    eq("pedido sem cálculo válido anterior fica com a linha 'erro' (visível)", linha8001.estado_margem, "erro");
    const c4E = await executarCiclo({ contaIds: [20], ...depE(), nowMs: agora + H });
    eq("quarentena não é reprocessada (0 tentativas novas)", (await q("SELECT tentativas FROM sentinel_pedido_excecoes WHERE pedido_id = '8001'"))[0].tentativas, 3);
    // Reprocessamento manual futuro: função, sem rota.
    eq("reabrirExcecao → volta a 'retentando'", [await reabrirExcecao(pool, 20, "8001"), (await q("SELECT status, tentativas FROM sentinel_pedido_excecoes WHERE pedido_id = '8001'"))[0]], [true, { status: "retentando", tentativas: 0 }]);

    console.log("\n▸ C. erro NUNCA sobrescreve cálculo válido; sucesso posterior marca 'resolvido'");
    const valido = (await q("SELECT custo, margem_valor, estado_margem FROM sentinel_pedidos WHERE cliente_conta_id = 10 AND pedido_id = '7002'"))[0];
    ok("7002 tem cálculo válido", ["confirmada", "provisoria"].includes(valido.estado_margem) && valido.custo !== null);
    mlE.pedidos.push(pedido(7002, { updatedMs: agora - 30 * 60 * 1000 }));
    await setCp(10, agora - 3 * H);
    await executarCiclo({ contaIds: [10], ...depE({ resolverConta: ctxDe(10, "5551"), buscarFrete: async () => { throw new Error("falha transitória"); } }) });
    const apos = (await q("SELECT custo, margem_valor, estado_margem FROM sentinel_pedidos WHERE cliente_conta_id = 10 AND pedido_id = '7002'"))[0];
    eq("linha válida mantida (nada de erro/NULL)", apos, valido);
    eq("… e a falha ficou só em sentinel_pedido_excecoes", (await q("SELECT status, tentativas FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 10 AND pedido_id = '7002'"))[0], { status: "retentando", tentativas: 1 });
    await executarCiclo({ contaIds: [10], ...depE({ resolverConta: ctxDe(10, "5551"), buscarFrete: async () => ({ valor: 10, status: "real", receitaComprador: 0 }) }) });
    eq("sucesso posterior → 'resolvido'", (await q("SELECT status FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 10 AND pedido_id = '7002'"))[0].status, "resolvido");

    console.log("\n▸ 6. falha ao gravar a exceção ⇒ NÃO avança");
    const PF = [pedido(9001, { updatedMs: agora - 2 * H })];
    const mlF = criarMlBase(PF);
    const dbFalha = { query: (sql, p) => (/INSERT INTO sentinel_pedido_excecoes/.test(sql) ? Promise.reject(new Error("disco cheio (simulado)")) : pool.query(sql, p)) };
    await setCp(30, agora - 3 * H);
    const cpF = ms((await cp(30)).ultimo_date_last_updated);
    // limite 1 ⇒ a primeira falha iria direto para quarentena — mas a escrita falha.
    const cF = await executarCiclo({ contaIds: [30], criarClient, db: pool, dbEscrita: dbFalha, nowMs: agora, resolverConta: ctxDe(30, "5553"), mlFetchBase: mlF, config: { ...cfgBase, maxTentativas: 1 }, buscarFrete: async () => { throw new Error("frete explodiu"); } });
    ok("erro da conta cita SENTINEL_EXCECAO_NAO_GRAVADA", /SENTINEL_EXCECAO_NAO_GRAVADA/.test(cF.contas[0].erro));
    eq("checkpoint NÃO avançou", ms((await cp(30)).ultimo_date_last_updated), cpF);
    eq("nenhuma exceção durável gravada", (await q("SELECT COUNT(*)::int n FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 30"))[0].n, 0);

    // ── 7 + 11 ────────────────────────────────────────────────────────────
    console.log("\n▸ 7. perda de lock interrompe o ciclo sem avançar checkpoint");
    const PL = [pedido(6001, { updatedMs: agora - 2 * H }), pedido(6002, { updatedMs: agora - 90 * 60 * 1000 })];
    const mlL = criarMlBase(PL);
    const mlMata = async (c, p, o) => {
      if (p.startsWith("/shipments/") && mlL.log.filter((c) => c.p.startsWith("/shipments/")).length === 1) {
        // derruba a conexão do lock DEPOIS do 1º pedido gravado (queda no meio do ciclo)
        await pool.query("SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND granted AND pid <> pg_backend_pid()");
      }
      return mlL(c, p, o);
    };
    await setCp(41, agora - 3 * H);
    const cpL = ms((await cp(41)).ultimo_date_last_updated);
    const cL = await executarCiclo({
      contaIds: [41, 30], criarClient, db: pool, nowMs: agora, mlFetchBase: mlMata, config: cfgBase,
      resolverConta: async (id) => ({ clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: id, sellerId: id === 41 ? "5541" : "5553", baseId: 1 }),
    });
    ok("ciclo abortado por lock perdido", !!cL.abortado && /lock/i.test(cL.abortado));
    eq("checkpoint da conta 41 NÃO avançou", ms((await cp(41)).ultimo_date_last_updated), cpL);
    eq("a conta seguinte não foi processada", cL.contas.length, 0);
    eq("FENCING: só o pedido anterior à queda foi gravado; NENHUMA escrita depois (pedido, exceção, checkpoint)",
      [(await q("SELECT COUNT(*)::int n FROM sentinel_pedidos WHERE cliente_conta_id = 41"))[0].n,
       (await q("SELECT COUNT(*)::int n FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 41"))[0].n], [1, 0]);

    console.log("\n▸ 11. restart retoma de forma idempotente");
    const antesRestart = (await q("SELECT pedido_id, updated_at FROM sentinel_pedidos WHERE cliente_conta_id = 41 ORDER BY 1"));
    mlL.log.length = 0;
    const cR = await executarCiclo({
      contaIds: [41], criarClient, db: pool, nowMs: agora, mlFetchBase: mlL, config: cfgBase,
      resolverConta: ctxDe(41, "5541"),
    });
    eq("após restart: sem erro", cR.contas[0].erro, null);
    ok("checkpoint avançou", ms((await cp(41)).ultimo_date_last_updated) > cpL);
    eq("2 linhas, sem duplicar o pedido gravado antes da queda", (await q("SELECT COUNT(*)::int n FROM sentinel_pedidos WHERE cliente_conta_id = 41"))[0].n, 2);
    eq("o pedido anterior à queda manteve updated_at (retomada não o reescreveu)",
      (await q("SELECT pedido_id, updated_at FROM sentinel_pedidos WHERE cliente_conta_id = 41 AND pedido_id = '6001'"))[0].updated_at.getTime(),
      antesRestart[0].updated_at.getTime());
    eq("2º restart: nada muda (tudo 'pulado')", (await executarCiclo({ contaIds: [41], criarClient, db: pool, nowMs: agora, mlFetchBase: mlL, config: cfgBase, resolverConta: ctxDe(41, "5541") })).contas[0].porResultado, { pulado: 2 });

    // ── 8: token ──────────────────────────────────────────────────────────
    console.log("\n▸ 8. token expirado: SENTINEL_TOKEN_INDISPONIVEL, sem refresh, sem retry, sem fallback");
    const PT = [pedido(5001, { updatedMs: agora - 2 * H })];
    const mlT = criarMlBase(PT, { tokenExpiraEm: "/shipments/" });
    await setCp(30, agora - 3 * H);
    const cpT = ms((await cp(30)).ultimo_date_last_updated);
    const cT = await executarCiclo({ contaIds: [30], criarClient, db: pool, nowMs: agora, resolverConta: ctxDe(30, "5553"), mlFetchBase: mlT, config: cfgBase });
    ok("erro rastreável SENTINEL_TOKEN_INDISPONIVEL (frete)", /^SENTINEL_TOKEN_INDISPONIVEL/.test(cT.contas[0].erro) && /^SENTINEL_TOKEN_INDISPONIVEL/.test((await cp(30)).ultimo_erro));
    eq("1 única chamada de frete (sem retry/backoff)", mlT.log.filter((c) => c.p.startsWith("/shipments/")).length, 1);
    ok("noRefresh em todas as chamadas", mlT.log.every((c) => c.opts.noRefresh === true));
    eq("checkpoint não avançou", ms((await cp(30)).ultimo_date_last_updated), cpT);
    const mlT2 = criarMlBase(PT, { tokenExpiraEm: "/orders/search" });
    const cT2 = await executarCiclo({ contaIds: [30], criarClient, db: pool, nowMs: agora, resolverConta: ctxDe(30, "5553"), mlFetchBase: mlT2, config: cfgBase });
    ok("token expirado já na Orders API → SENTINEL_TOKEN_INDISPONIVEL", /^SENTINEL_TOKEN_INDISPONIVEL/.test(cT2.contas[0].erro));
    eq("… 1 chamada, sem retry", mlT2.log.length, 1);

    // ── G: orçamento ──────────────────────────────────────────────────────
    console.log("\n▸ G. orçamento por conta e por ciclo");
    const PG_ = [1, 2, 3, 4].map((i) => pedido(4000 + i, { updatedMs: agora - 2 * H + i * 1000 }));
    const mlG = criarMlBase(PG_);
    await setCp(30, agora - 3 * H);
    const cG = await executarCiclo({ contaIds: [30], criarClient, db: pool, nowMs: agora, resolverConta: ctxDe(30, "5553"), mlFetchBase: mlG, config: { ...cfgBase, maxChamadasPorConta: 3 } });
    ok("SENTINEL_ORCAMENTO_CHAMADAS e no máx. 3 chamadas", /^SENTINEL_ORCAMENTO_CHAMADAS/.test(cG.contas[0].erro) && mlG.log.length <= 3);
    const cG2 = await executarCiclo({ contaIds: [30, 20], criarClient, db: pool, nowMs: agora, resolverConta: ctxDe(30, "5553"), mlFetchBase: mlG, config: { ...cfgBase, cicloMaxMs: 1 }, buscarFrete: async () => { await new Promise((r) => setTimeout(r, 15)); return { valor: 1, status: "real" }; } });
    ok("SENTINEL_CICLO_MAX_MS: ciclo para sem processar todas as contas", cG2.contas.length <= 1);


    // ── Rodada de correção 1 ──────────────────────────────────────────────
    console.log("\n▸ B1. coleta de frete que FALHOU nunca substitui linha válida");
    const ctxA = { clienteId: 1, clienteContaId: 10, clienteSlug: "cliente-teste", sellerId: "5551", baseId: 1 };
    const antesB1 = (await q("SELECT * FROM sentinel_pedidos WHERE cliente_conta_id = 10 AND pedido_id = '7001'"))[0];
    for (const [rot, entry] of [["5xx", { valor: null, status: "ausente", motivo: "http_503", erro: true, collected: false, httpStatus: 503 }],
      ["401", { valor: null, status: "ausente", motivo: "http_401", erro: false, collected: false, httpStatus: 401 }],
      ["timeout/erro_fetch", { valor: null, status: "ausente", motivo: "erro_fetch", erro: true, collected: false, httpStatus: null }]]) {
      const novo = pedido(7001, { updatedMs: agora + 60000, status: "paid" });
      const r = await processarPedido(ctxA, novo, { db: pool, buscarFrete: async () => entry, cacheCusto: new Map() });
      eq(`frete ${rot}: processarPedido devolve erro 'mantida' (SENTINEL_FRETE_COLETA_FALHOU)`, [r.resultado, r.codigo, r.mantida], ["erro", "SENTINEL_FRETE_COLETA_FALHOU", true]);
      const dep_ = (await q("SELECT * FROM sentinel_pedidos WHERE cliente_conta_id = 10 AND pedido_id = '7001'"))[0];
      eq(`frete ${rot}: linha válida INTACTA`, [dep_.estado_margem, dep_.frete, dep_.payload_hash, ms(dep_.ml_date_last_updated), dep_.updated_at.getTime()],
        [antesB1.estado_margem, antesB1.frete, antesB1.payload_hash, ms(antesB1.ml_date_last_updated), antesB1.updated_at.getTime()]);
    }
    // ... e pelo ciclo completo: ML devolve 401 só no frete de um pedido já válido.
    mlE.pedidos.length = 0;
    await pool.query("UPDATE sentinel_pedidos SET ml_date_last_updated = $1 WHERE cliente_conta_id = 10 AND pedido_id = '7001'", [iso(agora - 2 * H)]);
    const antesB1c = (await q("SELECT estado_margem, frete, payload_hash FROM sentinel_pedidos WHERE cliente_conta_id = 10 AND pedido_id = '7001'"))[0];
    const PB1 = [pedido(7001, { updatedMs: agora - 20 * 60 * 1000 })];
    const mlB1 = criarMlBase(PB1);
    const mlB1f = async (c, p, o) => (p.startsWith("/shipments/") ? { ok: false, status: 401, data: null } : mlB1(c, p, o));
    await setCp(10, agora - 3 * H);
    const cB1 = await executarCiclo({ contaIds: [10], criarClient, db: pool, nowMs: agora, resolverConta: ctxDe(10, "5551"), mlFetchBase: mlB1f, config: cfgBase });
    ok("ciclo com frete 401: erro de token rastreável", /^SENTINEL_TOKEN_INDISPONIVEL/.test(cB1.contas[0].erro));
    const dep2 = (await q("SELECT estado_margem, frete, payload_hash FROM sentinel_pedidos WHERE cliente_conta_id = 10 AND pedido_id = '7001'"))[0];
    eq("… e a linha válida continua intacta, com frete real (nada de provisória por cima)", [dep2.estado_margem, dep2.frete !== null, dep2.payload_hash], [antesB1c.estado_margem, true, antesB1c.payload_hash]);
    // sem linha anterior: pode gravar provisória com pendência frete_coleta_falhou
    const rNovo = await processarPedido({ ...ctxA, clienteContaId: 10 }, pedido(7777, { updatedMs: agora }), { db: pool, buscarFrete: async () => ({ valor: null, status: "ausente", motivo: "http_503", erro: true, collected: false, httpStatus: 503 }), cacheCusto: new Map() });
    const l7777 = (await q("SELECT estado_margem, pendencias FROM sentinel_pedidos WHERE pedido_id = '7777'"))[0];
    eq("sem linha anterior: grava provisória c/ pendência frete_coleta_falhou", [rNovo.resultado, l7777.estado_margem, l7777.pendencias], ["gravado", "provisoria", ["frete_coleta_falhou"]]);
    const rAus = await processarPedido({ ...ctxA, clienteContaId: 10 }, pedido(7778, { updatedMs: agora }), { db: pool, buscarFrete: async () => ({ valor: null, status: "ausente", motivo: "sem_custo_seller", erro: false, collected: true, httpStatus: 200 }), cacheCusto: new Map() });
    eq("frete que ainda NÃO existe (collected:true) segue 'sem_frete'", (await q("SELECT pendencias FROM sentinel_pedidos WHERE pedido_id = '7778'"))[0].pendencias, ["sem_frete"]);
    void rAus;

    console.log("\n▸ B3. exceção 'retentando' reaberta é consumida por ID, fora do overlap/checkpoint");
    await pool.query("DELETE FROM sentinel_pedidos WHERE pedido_id IN ('7777', '7778')");
    await pool.query("DELETE FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 10");
    const PB3 = [pedido(7003, { updatedMs: agora - 10 * H })]; // bem fora de checkpoint − overlap
    const mlB3 = criarMlBase(PB3);
    await setCp(10, agora - 1 * H);
    await pool.query("INSERT INTO sentinel_pedido_excecoes (cliente_conta_id, pedido_id, motivo, tentativas, status) VALUES (10, '7003', 'reaberta', 0, 'retentando')");
    const cB3 = await executarCiclo({ contaIds: [10], criarClient, db: pool, nowMs: agora, resolverConta: ctxDe(10, "5551"), mlFetchBase: mlB3, config: cfgBase });
    ok("fetchOrderById(7003) chamado (fora da janela do checkpoint)", mlB3.log.some((c) => c.p === "/orders/7003"));
    ok("… e o pedido foi calculado e gravado", (await q("SELECT 1 FROM sentinel_pedidos WHERE cliente_conta_id = 10 AND pedido_id = '7003'")).length === 1);
    eq("… e a exceção virou 'resolvido'", (await q("SELECT status FROM sentinel_pedido_excecoes WHERE pedido_id = '7003' AND cliente_conta_id = 10"))[0].status, "resolvido");
    ok("checkpoint segue o fluxo normal (avançou)", cB3.contas[0].erro === null && ms((await cp(10)).ultimo_date_last_updated) > agora - 1 * H);
    // limite configurável
    await pool.query("INSERT INTO sentinel_pedido_excecoes (cliente_conta_id, pedido_id, motivo, tentativas, status) VALUES (10, '7004', 'x', 0, 'retentando'), (10, '7005', 'x', 0, 'retentando') ON CONFLICT DO NOTHING");
    mlB3.pedidos.push(pedido(7004, { updatedMs: agora - 10 * H }), pedido(7005, { updatedMs: agora - 10 * H }));
    mlB3.log.length = 0;
    await executarCiclo({ contaIds: [10], criarClient, db: pool, nowMs: agora, resolverConta: ctxDe(10, "5551"), mlFetchBase: mlB3, config: { ...cfgBase, excecoesMax: 1 } });
    eq("SENTINEL_EXCECOES_MAX=1 ⇒ só 1 pedido por ciclo", mlB3.log.filter((c) => /^\/orders\/700[45]$/.test(c.p)).length, 1);

    console.log("\n▸ B7. erro no reprocessamento de provisória segue o protocolo de exceção (sem afetar checkpoint)");
    await pool.query("DELETE FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 10");
    await pool.query("UPDATE sentinel_pedidos SET estado_margem = 'provisoria', pendencias = '[\"sem_frete\"]'::jsonb WHERE cliente_conta_id = 10 AND pedido_id = '7001'");
    const mlB7 = criarMlBase([]); // /orders/7001 → 404 ⇒ fetchOrderById falha
    for (const t of [1, 2, 3]) {
      await setCp(10, agora - 1 * H);
      const c = await executarCiclo({ contaIds: [10], criarClient, db: pool, nowMs: agora, resolverConta: ctxDe(10, "5551"), mlFetchBase: mlB7, config: cfgBase });
      const ex = (await q("SELECT status, tentativas FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 10 AND pedido_id = '7001'"))[0];
      eq(`provisória, falha de fetch #${t}: ${t < 3 ? "retentando" : "quarentena"} (${t}/3)`, [ex.status, ex.tentativas], [t < 3 ? "retentando" : "quarentena", t]);
      ok(`… checkpoint avançou normalmente (#${t})`, c.contas[0].erro === null && ms((await cp(10)).ultimo_date_last_updated) > agora - 1 * H);
    }
    // erro do processarPedido na provisória (frete lança)
    await pool.query("DELETE FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 10");
    await pool.query("UPDATE sentinel_pedidos SET ml_date_last_updated = $1 WHERE cliente_conta_id = 10 AND pedido_id = '7001'", [iso(agora - 8 * H)]);
    const mlB7b = criarMlBase([pedido(7001, { updatedMs: agora - 5 * H })]);
    await setCp(10, agora - 1 * H);
    await executarCiclo({ contaIds: [10], criarClient, db: pool, nowMs: agora, resolverConta: ctxDe(10, "5551"), mlFetchBase: mlB7b, config: cfgBase, buscarFrete: async () => { throw new Error("frete quebrou na provisória"); } });
    eq("provisória: erro de processarPedido ⇒ exceção retentando (1)", (await q("SELECT status, tentativas FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 10 AND pedido_id = '7001'"))[0], { status: "retentando", tentativas: 1 });

    console.log("\n▸ R2. escrita de exceção que falha em QUALQUER caminho ⇒ checkpoint NÃO avança");
    await pool.query("DELETE FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 10");
    await pool.query("UPDATE sentinel_pedidos SET estado_margem = 'provisoria', pendencias = '[\"sem_frete\"]'::jsonb WHERE cliente_conta_id = 10 AND pedido_id = '7001'");
    const dbFalhaEx = { query: (sql, p) => (/INSERT INTO sentinel_pedido_excecoes/.test(sql) ? Promise.reject(new Error("disco cheio (simulado)")) : pool.query(sql, p)) };
    await setCp(10, agora - 1 * H);
    const cpR2 = ms((await cp(10)).ultimo_date_last_updated);
    const cR2 = await executarCiclo({ contaIds: [10], criarClient, db: pool, dbEscrita: dbFalhaEx, nowMs: agora, resolverConta: ctxDe(10, "5551"), mlFetchBase: criarMlBase([]), config: cfgBase });
    ok("provisória com fetch falho + exceção não gravada ⇒ SENTINEL_EXCECAO_NAO_GRAVADA", /SENTINEL_EXCECAO_NAO_GRAVADA/.test(cR2.contas[0].erro));
    eq("… e o checkpoint NÃO avançou (janela já estava completa)", ms((await cp(10)).ultimo_date_last_updated), cpR2);
    eq("… nenhuma exceção durável", (await q("SELECT COUNT(*)::int n FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 10"))[0].n, 0);
    // retentando (reaberta) com a escrita da exceção falhando
    await pool.query("UPDATE sentinel_pedidos SET estado_margem = 'confirmada', pendencias = '[]'::jsonb WHERE cliente_conta_id = 10 AND pedido_id = '7001'");
    await pool.query("INSERT INTO sentinel_pedido_excecoes (cliente_conta_id, pedido_id, motivo, tentativas, status) VALUES (10, '7001', 'x', 0, 'retentando')");
    await setCp(10, agora - 1 * H);
    const cR2b = await executarCiclo({ contaIds: [10], criarClient, db: pool, dbEscrita: dbFalhaEx, nowMs: agora, resolverConta: ctxDe(10, "5551"), mlFetchBase: criarMlBase([]), config: cfgBase });
    ok("retentando com fetch falho + exceção não gravada ⇒ checkpoint intocado", /SENTINEL_EXCECAO_NAO_GRAVADA/.test(cR2b.contas[0].erro) && ms((await cp(10)).ultimo_date_last_updated) === cpR2);
    await pool.query("DELETE FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 10");

    console.log("\n▸ R1. run-once --since: redefinição DENTRO do ciclo, sob o lock, pela conexão detentora");
    const fonteRO = require("fs").readFileSync(require("path").join(__dirname, "../scripts/sentinel-run-once.js"), "utf8");
    ok("run-once não grava mais checkpoint direto (sem INSERT INTO sentinel_checkpoints)", !/INSERT INTO sentinel_checkpoints/.test(fonteRO) && /redefinirCheckpoint/.test(fonteRO));
    await setCp(30, agora - 1 * H);
    const cpR1 = ms((await cp(30)).ultimo_date_last_updated);
    const segura = criarClient();
    await segura.connect();
    await segura.query("SELECT pg_advisory_lock(hashtext($1))", [LOCK_KEY]);
    const cOcup = await executarCiclo({ contaIds: [30], criarClient, db: pool, nowMs: agora, resolverConta: ctxDe(30, "5553"), mlFetchBase: criarMlBase([]), config: cfgBase, redefinirCheckpoint: iso(agora - 9 * H) });
    await segura.end();
    eq("lock ocupado ⇒ ciclo pulado e NADA gravado (checkpoint igual)", [cOcup.pulado, ms((await cp(30)).ultimo_date_last_updated)], [true, cpR1]);
    const mlR1 = criarMlBase([]);
    const cLivre = await executarCiclo({ contaIds: [30], criarClient, db: pool, nowMs: agora, resolverConta: ctxDe(30, "5553"), mlFetchBase: mlR1, config: cfgBase, redefinirCheckpoint: iso(agora - 9 * H) });
    eq("lock livre ⇒ redefine sob o lock e o ciclo parte de (since − overlap)", [cLivre.pulado, Math.min(...idxFrom(mlR1.log))], [false, agora - 9 * H - 2 * H]);
    // a redefinição usa a conexão detentora: se ela cair antes, nada é gravado
    await setCp(30, agora - 1 * H);
    let lk = null;
    const cpAntesKill = ms((await cp(30)).ultimo_date_last_updated);
    const cKill = await executarCiclo({
      contaIds: [30], criarClient: () => (lk = criarClient()), db: pool, nowMs: agora, mlFetchBase: criarMlBase([]), config: cfgBase, redefinirCheckpoint: iso(agora - 9 * H),
      resolverConta: async () => { await pool.query("SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND granted AND pid <> pg_backend_pid()"); return { clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: 30, sellerId: "5553", baseId: 1 }; },
    });
    ok("conexão do lock caiu antes da redefinição ⇒ abortado e checkpoint NÃO foi redefinido", !!cKill.abortado && ms((await cp(30)).ultimo_date_last_updated) === cpAntesKill);
    void lk;

    console.log("\n▸ 7b. FENCING também nas provisórias: lock cai durante o reprocessamento ⇒ nenhuma escrita depois");
    await pool.query("DELETE FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 10");
    await pool.query("UPDATE sentinel_pedidos SET estado_margem = 'provisoria', pendencias = '[\"sem_frete\"]'::jsonb WHERE cliente_conta_id = 10 AND pedido_id = '7001'");
    const antesProv = (await q("SELECT updated_at, estado_margem FROM sentinel_pedidos WHERE cliente_conta_id = 10 AND pedido_id = '7001'"))[0];
    const mlP = criarMlBase([pedido(7001, { updatedMs: agora - 5 * H })]);
    const mlPmata = async (c, p, o) => {
      if (p === "/orders/7001") await pool.query("SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND granted AND pid <> pg_backend_pid()");
      return mlP(c, p, o);
    };
    await setCp(10, agora - 1 * H);
    const cpP = ms((await cp(10)).ultimo_date_last_updated);
    const cP = await executarCiclo({ contaIds: [10], criarClient, db: pool, nowMs: agora, resolverConta: ctxDe(10, "5551"), mlFetchBase: mlPmata, config: cfgBase });
    ok("ciclo abortado", !!cP.abortado);
    const depoisProv = (await q("SELECT updated_at, estado_margem FROM sentinel_pedidos WHERE cliente_conta_id = 10 AND pedido_id = '7001'"))[0];
    eq("provisória NÃO foi reescrita pela instância antiga", [depoisProv.updated_at.getTime(), depoisProv.estado_margem], [antesProv.updated_at.getTime(), "provisoria"]);
    eq("0 exceções e checkpoint intocado", [(await q("SELECT COUNT(*)::int n FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 10"))[0].n, ms((await cp(10)).ultimo_date_last_updated)], [0, cpP]);

    console.log("\n▸ 7c. posse verifica a CHAVE exata (outro advisory do mesmo pid não vale)");
    await pool.query("DELETE FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 41");
    let lockClient = null;
    const mlK = criarMlBase([pedido(2001, { updatedMs: agora - 2 * H })]);
    const mlKtroca = async (c, p, o) => {
      if (p.startsWith("/orders/search")) await lockClient.query("SELECT pg_advisory_unlock(hashtext($1)), pg_advisory_lock(99991)", [LOCK_KEY]);
      return mlK(c, p, o);
    };
    await setCp(41, agora - 3 * H);
    const cpK = ms((await cp(41)).ultimo_date_last_updated);
    const cK = await executarCiclo({ contaIds: [41], criarClient: () => (lockClient = criarClient()), db: pool, nowMs: agora, resolverConta: ctxDe(41, "5541"), mlFetchBase: mlKtroca, config: cfgBase });
    ok("sessão ainda tem OUTRO advisory, mas não a chave do Sentinel ⇒ abortado", !!cK.abortado && /chave do lock/.test(cK.abortado));
    eq("checkpoint intocado", ms((await cp(41)).ultimo_date_last_updated), cpK);

    console.log("\n▸ B4. SENTINEL_SEM_PROGRESSO (orçamento N ciclos seguidos)");
    await pool.query("DELETE FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 41");
    await pool.query("DELETE FROM sentinel_pedidos WHERE cliente_conta_id = 41");
    const PS = [pedido(3001, { updatedMs: agora - 2 * H }), pedido(3002, { updatedMs: agora - 2 * H + 1000 })];
    const mlS = criarMlBase(PS);
    await setCp(41, agora - 3 * H);
    const cfgS = { ...cfgBase, maxChamadasPorConta: 1, alertaSemProgressoCiclos: 2 };
    const alertas = [];
    for (const n of [1, 2, 3]) {
      const c = await executarCiclo({ contaIds: [41], criarClient, db: pool, nowMs: agora, resolverConta: ctxDe(41, "5541"), mlFetchBase: mlS, config: cfgS });
      alertas.push([(await cp(41)).ciclos_sem_progresso, c.contas[0].alerta]);
    }
    eq("contador 1,2,3 e alerta a partir do 2º ciclo", alertas, [[1, null], [2, "SENTINEL_SEM_PROGRESSO"], [3, "SENTINEL_SEM_PROGRESSO"]]);
    await executarCiclo({ contaIds: [41], criarClient, db: pool, nowMs: agora, resolverConta: ctxDe(41, "5541"), mlFetchBase: mlS, config: { ...cfgBase } });
    eq("ciclo com progresso zera o contador", (await cp(41)).ciclos_sem_progresso, 0);

    // ── 10 ────────────────────────────────────────────────────────────────
    console.log("\n▸ 10. allowlist no banco real");
    eq("allowlist [41] → só a 41", await selecionarContas(pool, [41]), [41]);
    eq("allowlist [999] (inexistente) → nada", await selecionarContas(pool, [999]), []);
    eq("allowlist [] → nada (sem consultar)", await selecionarContas(pool, []), []);
    const chamadasTick = [];
    await executarTick({ db: pool, allowlist: [41, 999], executar: async (a) => { chamadasTick.push(a.contaIds); } });
    eq("tick envia só as contas da allowlist que existem", chamadasTick, [[41]]);

    console.log("\n▸ M05 (Codex): dono lido da Conta na escrita; sem órfãos sem FK");
    await pool.query("INSERT INTO clientes VALUES (2, 'Canônico', 'canonico', true) ON CONFLICT DO NOTHING");
    // Unificação EM CURSO (transação aberta) enquanto o ciclo grava: o worker espera
    // (FOR SHARE na Conta) e grava o dono confirmado, não o do snapshot nem o do contexto.
    ml.pedidos.push(pedido(7999, { updatedMs: agora - 30 * 60 * 1000 }));
    await setCp(10, agora - 4 * H);
    const merge = new Client({ connectionString: testUrl.toString(), ssl: false });
    await merge.connect();
    await merge.query("BEGIN");
    await merge.query("UPDATE cliente_contas SET cliente_id = 2 WHERE id = 10");
    const cicloConc = executarCiclo({ contaIds: [10], ...dep() }); // contexto do ciclo ainda diz clienteId 1 (ctxDe)
    await new Promise((r) => setTimeout(r, 500));
    await merge.query("COMMIT");
    await merge.end();
    await cicloConc;
    eq("pedido gravado com o dono confirmado pela unificação concorrente (2)", (await q("SELECT cliente_id FROM sentinel_pedidos WHERE pedido_id = '7999'"))[0].cliente_id, 2);
    await pool.query("UPDATE cliente_contas SET cliente_id = 1 WHERE id = 10");
    const cOrf = await executarCiclo({ contaIds: [999], ...dep({ resolverConta: async () => { const e = new Error("conta não existe"); e.code = "CLIENTE_CONTA_NAO_ENCONTRADA"; throw e; } }) });
    ok("conta inexistente: ciclo registra o erro no resumo", !!cOrf.contas[0].erro);
    eq("… mas não cria checkpoint órfão", (await q("SELECT COUNT(*)::int n FROM sentinel_checkpoints WHERE cliente_conta_id = 999"))[0].n, 0);
    eq("exceção p/ conta inexistente não é gravada", [await registrarExcecao(pool, 999, "X1", "teste"), (await q("SELECT COUNT(*)::int n FROM sentinel_pedido_excecoes WHERE cliente_conta_id = 999"))[0].n], [undefined, 0]);

    console.log(`\n${checks} verificações passaram (PostgreSQL local ${parsed.hostname}).`);
  } finally {
    await pool.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
    await require("../config/database").end().catch(() => {});
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
