#!/usr/bin/env node
// server/scripts/sentinel-carga-local.cjs
//
// Carga e recuperação do Sentinel contra PostgreSQL LOCAL descartável e ML FALSO
// (nenhuma chamada real ao Mercado Livre; recusa host não-local; nunca lê .env):
//   SENTINEL_TEST_DATABASE_URL=postgres://vf@127.0.0.1:57651/postgres \
//     node server/scripts/sentinel-carga-local.cjs [--contas=10] [--pedidos=1000] [--out=arquivo.json]
//
// Mede tempo, memória (RSS/heap, pico), conexões PG (pico) e armazenamento por
// pedido; exercita reinício, perda de conexão, perda do advisory lock, ML
// indisponível/limitado, token expirado, duplicado, mudança financeira,
// cancelamento, reabertura de incidente e isolamento de falha entre contas.
// Objetivo: ESTIMAR capacidade, não afirmar que suporta todas as contas.

const assert = require("assert");
const { Pool, Client } = require("pg");

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const N_CONTAS = Number(args.contas || 10);
const N_PEDIDOS = Number(args.pedidos || 1000);
const baseUrl = process.env.SENTINEL_TEST_DATABASE_URL;
if (!baseUrl) throw new Error("Defina SENTINEL_TEST_DATABASE_URL (PostgreSQL local).");
const parsed = new URL(baseUrl);
if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) throw new Error("LOCAL_DATABASE_REQUIRED");
const dbName = `vf_sentinel_carga_${Date.now()}`;
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${dbName}`;
process.env.DATABASE_URL = testUrl.toString();
process.env.SENTINEL_INCIDENTES_ENABLED = "1";

const { ensureSentinelSchema, ensureSentinelIncidentesSchema } = require("../services/sentinel/sentinelSchema");
const { executarCiclo } = require("../services/sentinel/sentinelPollingWorker");
const S = require("../services/sentinel/sentinelIncidentes");
const poolGlobal = require("../config/database");
poolGlobal.on("error", () => {});

const H = 3600 * 1000;
const agora = Date.now();
const iso = (m) => new Date(m).toISOString();
const resultados = [];
let checks = 0;
const ok = (label, cond, extra = "") => { assert.ok(cond, `FALHOU: ${label} ${extra}`); checks += 1; console.log(`  ok  ${label}${extra ? ` (${extra})` : ""}`); };

function gerarPedidos(contaId, n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const id = contaId * 1_000_000 + i;
    const mlb = `MLB${contaId}${String(i % 40).padStart(3, "0")}`; // 40 produtos por conta
    const t = agora - 3 * 24 * H + Math.floor((i / n) * 3 * 24 * H);
    out.push({
      id, status: "paid", date_created: iso(t), date_last_updated: iso(t + 60000),
      shipping: { id: id + 7, logistic_type: "cross_docking" },
      order_items: [{ item: { id: mlb, title: "P", seller_sku: null, variation_id: null }, quantity: 1 + (i % 3), unit_price: 50 + (i % 7) * 10, sale_fee: 9 }],
    });
  }
  return out;
}

// ML falso por conta: falhas programáveis (429/5xx/token) e gancho por chamada.
function criarMl(porConta) {
  const estado = { chamadas: 0, falha: new Map(), gancho: null };
  const fn = async (_cli, p, opts = {}) => {
    estado.chamadas += 1;
    if (estado.gancho) await estado.gancho(estado.chamadas);
    const conta = Number(String(opts.mlUserId).replace("seller-", ""));
    const f = estado.falha.get(conta);
    if (f === "token") { const e = new Error("token expirado"); e.code = "ML_TOKEN_EXPIRED"; throw e; }
    if (f === "429") return { ok: false, status: 429, data: { message: "too_many_requests" } };
    if (f === "503") return { ok: false, status: 503, data: null };
    if (p.startsWith("/shipments/")) return { ok: true, status: 200, data: { senders: [{ user_id: opts.mlUserId, cost: 12 }], receiver: { cost: 0 } } };
    const pedidos = porConta.get(conta) || [];
    if (p.startsWith("/orders/search")) {
      const qs = new URLSearchParams(p.split("?")[1]);
      const from = Date.parse(qs.get("order.date_last_updated.from").replace("-00:00", "Z"));
      const to = Date.parse(qs.get("order.date_last_updated.to").replace("-00:00", "Z"));
      const off = Number(qs.get("offset"));
      const dentro = pedidos.filter((o) => Date.parse(o.date_last_updated) >= from && Date.parse(o.date_last_updated) <= to);
      return { ok: true, status: 200, data: { paging: { total: dentro.length }, results: dentro.slice(off, off + 50) } };
    }
    if (p.startsWith("/orders/")) {
      const o = pedidos.find((x) => `/orders/${x.id}` === p);
      return { ok: !!o, status: o ? 200 : 404, data: o || null };
    }
    return { ok: false, status: 404, data: null };
  };
  fn.estado = estado;
  return fn;
}

async function main() {
  const admin = new Pool({ connectionString: baseUrl, ssl: false, max: 2 });
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const pool = new Pool({ connectionString: testUrl.toString(), ssl: false, max: 4, application_name: "sentinel-pool" });
  pool.on("error", () => {});
  const q = async (sql, p) => (await pool.query(sql, p)).rows;
  const criarClient = () => new Client({ connectionString: testUrl.toString(), ssl: false, application_name: "sentinel-lock" });

  // Amostragem de memória e conexões durante cada cenário.
  async function medir(nome, fn) {
    const amostras = { rss: 0, heap: 0, conexoes: 0 };
    const timer = setInterval(async () => {
      const m = process.memoryUsage();
      amostras.rss = Math.max(amostras.rss, m.rss);
      amostras.heap = Math.max(amostras.heap, m.heapUsed);
      const r = await admin.query("SELECT COUNT(*)::int n FROM pg_stat_activity WHERE datname = $1", [dbName]).catch(() => null);
      if (r) amostras.conexoes = Math.max(amostras.conexoes, r.rows[0].n);
    }, 100);
    const t0 = Date.now();
    let r;
    try { r = await fn(); } finally { clearInterval(timer); }
    const ms = Date.now() - t0;
    const linha = { cenario: nome, ms, rssPicoMB: Math.round(amostras.rss / 1048576), heapPicoMB: Math.round(amostras.heap / 1048576), conexoesPgPico: amostras.conexoes, ...(r?.medidas || {}) };
    resultados.push(linha);
    console.log(`  ⏱  ${nome}: ${ms} ms · RSS pico ${linha.rssPicoMB} MB · heap ${linha.heapPicoMB} MB · conexões PG pico ${linha.conexoesPgPico}`);
    return r;
  }

  try {
    const contas = Array.from({ length: N_CONTAS }, (_, i) => i + 1);
    await pool.query(`
      CREATE TABLE clientes (id integer PRIMARY KEY, nome text, slug text UNIQUE, ativo boolean DEFAULT true);
      CREATE TABLE cliente_contas (id integer PRIMARY KEY, cliente_id integer REFERENCES clientes(id), marketplace text,
        nome text, slug text, external_account_id text, is_primary boolean, ativo boolean);
      CREATE TABLE custos (id serial PRIMARY KEY, base_id integer NOT NULL, produto_id text NOT NULL,
        custo_produto numeric NOT NULL DEFAULT 0, imposto_percentual numeric NOT NULL DEFAULT 0,
        sku text NOT NULL DEFAULT '', sku_id text NOT NULL DEFAULT '', id_model text);
      CREATE TABLE squads (id integer PRIMARY KEY, nome text, ativo boolean DEFAULT true);
      CREATE TABLE cliente_squad_history (id serial PRIMARY KEY, cliente_id integer, squad_id integer, fim_em timestamptz);
      INSERT INTO clientes VALUES (1, 'Cliente Carga', 'cliente-carga', true);`);
    for (const c of contas) {
      await pool.query("INSERT INTO cliente_contas VALUES ($1, 1, 'meli', $2, $3, $4, false, true)", [c, `Conta ${c}`, `conta-${c}`, `seller-${c}`]);
      // custo p/ 38 dos 40 MLBs (2 ficam sem custo ⇒ incidente custo_pendente); custo alto em 3 ⇒ margem negativa
      for (let k = 0; k < 38; k += 1) {
        await pool.query("INSERT INTO custos (base_id, produto_id, custo_produto, imposto_percentual) VALUES ($1, $2, $3, 8)",
          [c, `MLB${c}${String(k).padStart(3, "0")}`, k < 3 ? 120 : 20]);
      }
    }
    await ensureSentinelSchema(pool);
    await ensureSentinelIncidentesSchema(pool);
    const porConta = new Map(contas.map((c) => [c, gerarPedidos(c, N_PEDIDOS)]));
    const ml = criarMl(porConta);
    const resolverConta = async (id) => ({ clienteId: 1, clienteSlug: "cliente-carga", clienteContaId: id, sellerId: `seller-${id}`, baseId: id });
    const config = { overlapMs: 2 * H, maxTentativas: 3, cicloMaxMs: 30 * 60 * 1000, maxChamadasPorConta: N_PEDIDOS * 3 + 200, lookbackHours: 24 };
    const dep = (extra = {}) => ({ criarClient, db: pool, nowMs: agora, resolverConta, mlFetchBase: ml, config, ...extra });
    const setCp = (id, m) => pool.query(
      `INSERT INTO sentinel_checkpoints (cliente_conta_id, ultimo_date_last_updated) VALUES ($1, $2)
       ON CONFLICT (cliente_conta_id) DO UPDATE SET ultimo_date_last_updated = EXCLUDED.ultimo_date_last_updated`, [id, iso(m)]);
    for (const c of contas) await setCp(c, agora - 4 * 24 * H);
    const tamanho = async () => (await q(`SELECT COALESCE(SUM(pg_total_relation_size(c.oid)),0)::bigint AS b FROM pg_class c
      WHERE c.relkind = 'r' AND c.relname LIKE 'sentinel_%'`))[0].b;

    console.log(`\n▸ C1. 1 conta × ${N_PEDIDOS} pedidos (primeira ingestão)`);
    const c1 = await medir("1 conta, 1ª ingestão", async () => {
      const r = await executarCiclo({ contaIds: [1], ...dep() });
      return { r, medidas: { pedidos: r.contas[0].processados, chamadasMl: r.contas[0].chamadasMl } };
    });
    ok("1 conta: todos os pedidos gravados", (await q("SELECT COUNT(*)::int n FROM sentinel_pedidos WHERE cliente_conta_id=1"))[0].n === N_PEDIDOS);
    ok("incidentes gerados no ciclo", (c1.r.contas[0].incidentes?.abertos || 0) > 0, JSON.stringify(c1.r.contas[0].incidentes));

    console.log(`\n▸ C2. ${N_CONTAS - 1} contas restantes num ciclo (${(N_CONTAS - 1) * N_PEDIDOS} pedidos)`);
    await medir(`${N_CONTAS - 1} contas, 1ª ingestão`, async () => {
      const r = await executarCiclo({ contaIds: contas.slice(1), ...dep() });
      return { medidas: { pedidos: r.contas.reduce((s, c) => s + c.processados, 0) } };
    });
    const total = (await q("SELECT COUNT(*)::int n FROM sentinel_pedidos"))[0].n;
    ok("todas as contas: sem duplicar", total === N_CONTAS * N_PEDIDOS, `${total}`);
    const bytes = Number(await tamanho());
    resultados.push({ cenario: "armazenamento", bytesTabelasSentinel: bytes, bytesPorPedido: Math.round(bytes / total) });
    console.log(`  💾 tabelas sentinel_*: ${(bytes / 1048576).toFixed(1)} MB ≈ ${Math.round(bytes / total)} bytes/pedido (com índices e incidentes)`);

    console.log("\n▸ C3. dois ciclos concorrentes: um pula pelo advisory lock");
    const [a, b] = await Promise.all([executarCiclo({ contaIds: [1], ...dep() }), executarCiclo({ contaIds: [2], ...dep() })]);
    ok("exatamente um ciclo pulado", [a.pulado, b.pulado].filter(Boolean).length === 1);

    console.log("\n▸ C4. reprocessar tudo (idempotência)");
    const evAntes = (await q("SELECT COUNT(*)::int n FROM sentinel_incidente_eventos"))[0].n;
    for (const c of contas) await setCp(c, agora - 4 * 24 * H);
    const c4 = await medir("reprocessamento total", async () => {
      const r = await executarCiclo({ contaIds: contas, ...dep() });
      const por = {};
      for (const c of r.contas) for (const [k, v] of Object.entries(c.porResultado)) por[k] = (por[k] || 0) + v;
      return { r, medidas: { porResultado: por } };
    });
    ok("nada regravado", !c4.r.contas.some((c) => c.porResultado.gravado));
    ok("mesmo total de linhas", (await q("SELECT COUNT(*)::int n FROM sentinel_pedidos"))[0].n === total);
    ok("nenhum evento de incidente novo", (await q("SELECT COUNT(*)::int n FROM sentinel_incidente_eventos"))[0].n === evAntes);

    console.log("\n▸ C5. mudança financeira (custo) + cancelamentos + reabertura");
    const perdaAntes = (await S.resumoMonitoramento(pool, { contaIds: [1], agora })).perdaContribuicaoObservada;
    const inc1 = (await S.listarIncidentes(pool, { contaIds: [1], tipo: "margem_negativa" })).itens[0];
    await S.resolverIncidente(pool, inc1.id, { ator: "carga", motivo: "teste" });
    await pool.query("UPDATE custos SET custo_produto = 200 WHERE base_id = 1 AND produto_id = 'MLB1003'"); // novo produto negativo
    const ped1 = porConta.get(1);
    const t5 = agora + 60000;
    for (let i = 0; i < ped1.length; i += 10) { ped1[i] = { ...ped1[i], status: "cancelled", date_last_updated: iso(t5) }; }
    const novo = gerarPedidos(1, 1)[0];
    porConta.get(1).push({ ...novo, id: 9_999_001, order_items: inc1.chave.split("+").map((mlb) => ({ ...novo.order_items[0], item: { ...novo.order_items[0].item, id: mlb } })), date_created: iso(t5), date_last_updated: iso(t5) });
    await setCp(1, agora - 4 * 24 * H);
    await medir("mudança financeira + 10% cancelados (1 conta)", async () => {
      const r = await executarCiclo({ contaIds: [1], ...dep({ nowMs: t5 + 60000 }) });
      return { medidas: { porResultado: r.contas[0].porResultado } };
    });
    const canc = (await q("SELECT COUNT(*)::int n FROM sentinel_pedidos WHERE cliente_conta_id=1 AND status_ml='cancelled'"))[0].n;
    ok("cancelados gravados como cancelled", canc === Math.ceil(N_PEDIDOS / 10), `${canc}`);
    const res1 = await S.resumoMonitoramento(pool, { contaIds: [1], agora: t5 + 60000 });
    ok("cancelados fora das vendas", res1.cobertura.excluidos.cancelado === canc && res1.cobertura.vendas === res1.cobertura.pedidos - canc);
    ok("MLB1003 com custo novo virou margem negativa", (await S.listarIncidentes(pool, { contaIds: [1], busca: "MLB1003", tipo: "margem_negativa" })).total === 1);
    ok("incidente resolvido reabriu com pedido novo", (await S.obterIncidente(pool, inc1.id)).status === "reaberto");
    resultados.push({ cenario: "perda observada conta 1", antes: perdaAntes, depois: res1.perdaContribuicaoObservada });

    console.log("\n▸ C6. falhas de ML isoladas por conta (token / 429 / 503)");
    for (const c of contas) await setCp(c, agora - 2 * H);
    ml.estado.falha.set(2, "token");
    ml.estado.falha.set(3, "429");
    ml.estado.falha.set(4, "503");
    const c6 = await executarCiclo({ contaIds: contas, ...dep({ nowMs: agora + 2 * H }) });
    const porId = new Map(c6.contas.map((c) => [c.contaId, c]));
    ok("conta 2: erro de token, sem renovar", /TOKEN|token/.test(porId.get(2).erro || ""), porId.get(2).erro);
    ok("contas 3/4: erro de API registrado", !!porId.get(3).erro && !!porId.get(4).erro);
    ok("demais contas processaram normalmente", contas.filter((c) => c > 4).every((c) => !porId.get(c).erro && porId.get(c).checkpoint));
    const op = await S.resumoOperacional(pool, { contaIds: contas, agora: agora + 2 * H + 3 * 3600 * 1000, env: { SENTINEL_LEITURA_LIMITE_MIN: "60" } });
    ok("saúde: alerta TOKEN_INDISPONIVEL p/ conta 2", op.alertas.some((x) => x.codigo === "TOKEN_INDISPONIVEL" && x.contaId === 2));
    ml.estado.falha.clear();

    console.log("\n▸ C7. perda do advisory lock no meio do ciclo");
    for (const c of contas) await setCp(c, agora - 4 * 24 * H);
    const cpAntes = (await q("SELECT cliente_conta_id, ultimo_date_last_updated FROM sentinel_checkpoints ORDER BY 1")).map((r) => String(r.ultimo_date_last_updated));
    ml.estado.chamadas = 0;
    ml.estado.gancho = async (n) => {
      if (n === 30) await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND application_name = 'sentinel-lock'", [dbName]);
    };
    const c7 = await executarCiclo({ contaIds: contas, ...dep() }).catch((e) => ({ erro: e }));
    ml.estado.gancho = null;
    ok("ciclo abortado (lock perdido)", !!(c7.abortado || c7.erro), String(c7.abortado || c7.erro?.message));
    const cpDepois = (await q("SELECT cliente_conta_id, ultimo_date_last_updated FROM sentinel_checkpoints ORDER BY 1")).map((r) => String(r.ultimo_date_last_updated));
    // Contas concluídas ANTES da perda avançam legitimamente; a conta em curso e as seguintes, não.
    const concluidas = new Set((c7.contas || []).filter((c) => !c.erro).map((c) => c.contaId));
    const indevidas = contas.filter((c, i) => !concluidas.has(c) && cpAntes[i] !== cpDepois[i]);
    ok("nenhum checkpoint avançou após a perda do lock", indevidas.length === 0, `concluídas antes: ${[...concluidas].join(",") || "nenhuma"}`);

    console.log("\n▸ C8. perda das conexões do pool no meio do ciclo");
    for (const c of contas.slice(0, 3)) await setCp(c, agora - 4 * 24 * H);
    let derrubou = 0;
    ml.estado.chamadas = 0;
    ml.estado.gancho = async (n) => {
      if (n === 10) derrubou = (await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND application_name = 'sentinel-pool'", [dbName])).rowCount;
    };
    const c8 = await executarCiclo({ contaIds: contas.slice(0, 3), ...dep() }).catch((e) => ({ erro: e }));
    ml.estado.gancho = null;
    ok("conexões do pool foram de fato derrubadas", derrubou > 0, `${derrubou}`);
    ok("ciclo termina sem derrubar o processo", !!c8, String(c8.erro?.message || c8.abortado || (c8.contas || []).map((c) => c.erro || "ok").join(" | ")));

    console.log("\n▸ C9. reinício (parada entre contas) e recuperação");
    let n = 0;
    const c9a = await executarCiclo({ contaIds: contas, ...dep(), deveParar: () => (n += 1) > 2 });
    ok("parada solicitada: processou só parte das contas", c9a.contas.length < contas.length, `${c9a.contas.length}`);
    const c9b = await medir("recuperação após parada/lock/conexão (todas as contas)", async () => {
      const r = await executarCiclo({ contaIds: contas, ...dep() });
      return { r, medidas: { contas: r.contas.length } };
    });
    ok("ciclo seguinte completa todas as contas sem erro", c9b.r.contas.length === contas.length && c9b.r.contas.every((c) => !c.erro));
    ok("sem duplicação após falhas", (await q("SELECT COUNT(*)::int n FROM sentinel_pedidos"))[0].n === total + 1);
    const dupInc = (await q("SELECT COUNT(*)::int n FROM (SELECT cliente_conta_id, tipo, chave FROM sentinel_incidentes GROUP BY 1,2,3 HAVING COUNT(*) > 1) x"))[0].n;
    ok("sem incidente duplicado", dupInc === 0);

    resultados.push({ cenario: "final", pedidos: total + 1, incidentes: (await q("SELECT COUNT(*)::int n FROM sentinel_incidentes"))[0].n,
      eventos: (await q("SELECT COUNT(*)::int n FROM sentinel_incidente_eventos"))[0].n, bytesTabelasSentinel: Number(await tamanho()) });
    console.log(`\n${checks} verificações passaram (carga local: ${N_CONTAS} contas × ${N_PEDIDOS} pedidos).`);
    console.log(JSON.stringify(resultados, null, 1));
    if (args.out) require("fs").writeFileSync(args.out, JSON.stringify({ contas: N_CONTAS, pedidosPorConta: N_PEDIDOS, resultados }, null, 2));
  } finally {
    await pool.end().catch(() => {});
    await poolGlobal.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
    await admin.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
