// server/tests/sentinelV0aUnit.test.js
//
// Sentinel V0-a — partes puras (sem banco, sem rede): flag/allowlist do worker,
// noRefresh em todas as chamadas ao ML, token indisponível sem retry/refresh,
// 429 com Retry-After, hash canônico. O banco real fica em
// tests/sentinel.v0a.postgres.cjs (PG local, fora do run-all).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/x";

const assert = require("assert");
const { iniciar, lerAllowlist, workerHabilitado, executarTick } = require("../workers/sentinelWorker");
const { criarMlFetchSentinel, criarEscopoMl } = require("../services/sentinel/sentinelMlClient");
const { buscarJanela } = require("../services/sentinel/sentinelOrdersFetch");
const { verificarSentinelSchema } = require("../services/sentinel/sentinelSchema");
const { calcularPayloadHash } = require("../services/sentinel/sentinelPedidoService");

let checks = 0;
function ok(label, cond) { assert.ok(cond, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); }
function eq(label, a, b) { assert.deepStrictEqual(a, b, `FALHOU: ${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); checks += 1; console.log(`  ok  ${label}`); }

(async () => {
  console.log("\n▸ 12. nenhum teste toca produção (host)");
  const host = new URL(process.env.DATABASE_URL).hostname;
  ok(`DATABASE_URL aponta para host local (${host})`, ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host));

  console.log("\n▸ 9. flag OFF não inicia (nem pool, nem timer)");
  const logs = [];
  const logger = { log: (m) => logs.push(m), error: () => {} };
  const naoCriar = () => { throw new Error("não deveria criar pool"); };
  for (const env of [{}, { SENTINEL_WORKER_ENABLED: "false", SENTINEL_CONTAS_ALLOWLIST: "41" }, { SENTINEL_WORKER_ENABLED: "" }]) {
    const w = await iniciar({ env, logger, criarPool: naoCriar });
    eq(`env ${JSON.stringify(env)} → não inicia`, [w.iniciado, w.motivo], [false, "flag_off"]);
  }
  const semLista = await iniciar({ env: { SENTINEL_WORKER_ENABLED: "true" }, logger, criarPool: naoCriar });
  eq("flag ON + allowlist vazia → não inicia", [semLista.iniciado, semLista.motivo], [false, "allowlist_vazia"]);
  ok("loga OFF e allowlist vazia", logs.some((m) => /OFF/.test(m)) && logs.some((m) => /allowlist vazia/i.test(m)));
  eq("workerHabilitado só com true|1|on|yes", ["true", "1", "on", "yes", "false", "", "talvez"].map((v) => workerHabilitado({ SENTINEL_WORKER_ENABLED: v })), [true, true, true, true, false, false, false]);
  eq("lerAllowlist ignora lixo e duplicatas", lerAllowlist({ SENTINEL_CONTAS_ALLOWLIST: "41, x, 0, -3, 52, 41" }), [41, 52]);

  console.log("\n▸ 10. conta fora da allowlist não processa");
  let executou = false;
  const dbVazio = { query: async (_sql, params) => { ok("consulta restringe por ANY(allowlist)", Array.isArray(params[0]) && params[0][0] === 41); return { rows: [] }; } };
  const r = await executarTick({ db: dbVazio, allowlist: [41], executar: async () => { executou = true; } });
  eq("nenhuma conta elegível → ciclo não executa", [executou, r.semContas], [false, true]);
  const semAllow = await executarTick({ db: { query: async () => { throw new Error("não deveria consultar"); } }, allowlist: [], executar: async () => { executou = true; } });
  eq("allowlist vazia → nem consulta o banco", [executou, semAllow.semContas], [false, true]);
  let recebido = null;
  await executarTick({ db: { query: async () => ({ rows: [{ id: 41 }] }) }, allowlist: [41, 99], executar: async (a) => { recebido = a.contaIds; } });
  eq("só as contas elegíveis da allowlist vão ao ciclo", recebido, [41]);

  console.log("\n▸ 8. noRefresh em TODAS as chamadas; token expirado sem refresh nem retry");
  const chamadas = [];
  const baseOk = async (c, p, o) => { chamadas.push({ p, o }); return { ok: true, status: 200, data: {} }; };
  const esc = criarEscopoMl();
  const f = criarMlFetchSentinel({ base: baseOk, escopo: esc });
  const ff = criarMlFetchSentinel({ base: baseOk, escopo: esc, modoFrete: true });
  await f(1, "/orders/search?x", { mlUserId: "5" });
  await ff(1, "/shipments/9/costs", { mlUserId: "5" });
  ok("todas as chamadas levam noRefresh:true", chamadas.length === 2 && chamadas.every((c) => c.o.noRefresh === true));
  ok("… e o prazo padrão da Central (timeoutMs)", chamadas.every((c) => Number(c.o.timeoutMs) > 0));
  ok("… e mlUserId da conta preservado", chamadas.every((c) => c.o.mlUserId === "5"));

  for (const [rotulo, base] of [
    ["ML_TOKEN_EXPIRED", async () => { chamadas.push("x"); const e = new Error("expirado"); e.code = "ML_TOKEN_EXPIRED"; throw e; }],
    ["HTTP 401", async () => { chamadas.push("x"); return { ok: false, status: 401, data: null }; }],
  ]) {
    chamadas.length = 0;
    const e = criarEscopoMl();
    const fo = criarMlFetchSentinel({ base, escopo: e });
    let err = null;
    try { await fo(1, "/orders/search", {}); } catch (x) { err = x; }
    eq(`${rotulo} (orders) → SENTINEL_TOKEN_INDISPONIVEL`, err && err.code, "SENTINEL_TOKEN_INDISPONIVEL");
    let err2 = null;
    try { await fo(1, "/orders/search", {}); } catch (x) { err2 = x; }
    eq(`${rotulo}: chamada seguinte nem sai (1 única chamada ao ML, sem retry)`, [chamadas.length, err2 && err2.code, e.tokenIndisponivel], [1, "SENTINEL_TOKEN_INDISPONIVEL", true]);
    chamadas.length = 0;
    const e2 = criarEscopoMl();
    const frete = criarMlFetchSentinel({ base, escopo: e2, modoFrete: true });
    const rf = await frete(1, "/shipments/1/costs", {});
    eq(`${rotulo} (frete) → {ok:false,status:401} não retentável + sinal`, [rf.ok, rf.status, e2.tokenIndisponivel], [false, 401, true]);
  }

  // Orders: 401 vindo de um mlFetch cru também não é retentado.
  let n401 = 0;
  let erro401 = null;
  try {
    await buscarJanela({ clienteId: 1, sellerId: "5" }, 0, 1000, { mlFetchFn: async () => { n401 += 1; return { ok: false, status: 401 }; }, sleepFn: async () => {} });
  } catch (x) { erro401 = x; }
  eq("Orders 401 → SENTINEL_TOKEN_INDISPONIVEL, 1 chamada", [erro401 && erro401.code, n401], ["SENTINEL_TOKEN_INDISPONIVEL", 1]);

  console.log("\n▸ G. orçamento e 429");
  const eo = criarEscopoMl({ maxChamadas: 2 });
  const fb = criarMlFetchSentinel({ base: baseOk, escopo: eo });
  await fb(1, "/a", {}); await fb(1, "/b", {});
  let erroOrc = null;
  try { await fb(1, "/c", {}); } catch (x) { erroOrc = x; }
  eq("3ª chamada acima do orçamento → SENTINEL_ORCAMENTO_CHAMADAS", [erroOrc && erroOrc.code, eo.orcamentoEsgotado], ["SENTINEL_ORCAMENTO_CHAMADAS", true]);
  const efr = criarMlFetchSentinel({ base: baseOk, escopo: eo, modoFrete: true });
  eq("frete acima do orçamento → status 0 (não retentável)", (await efr(1, "/s", {})).status, 0);

  const sono = [];
  let tentativa = 0;
  const j = await buscarJanela({ clienteId: 1, sellerId: "5" }, 0, 1000, {
    mlFetchFn: async () => {
      tentativa += 1;
      if (tentativa === 1) return { ok: false, status: 429, retryAfter: 7, data: null };
      return { ok: true, status: 200, data: { paging: { total: 0 }, results: [] } };
    },
    sleepFn: async (ms) => { sono.push(ms); },
  });
  eq("429 com Retry-After:7 espera 7000ms e retenta", [sono, tentativa, j.complete], [[7000], 2, true]);

  console.log("\n▸ D. hash canônico");
  const base = { faturamento: 200, comissao: 25, frete: 18.4, custo: 100, imposto: 10, margem_valor: 46.6, margem_pct: 23.3, estado_margem: "confirmada", pendencias: [], itens: [{ a: 1, b: 2 }], status_ml: "paid" };
  const h = calcularPayloadHash(base);
  eq("independe da ordem das chaves", calcularPayloadHash({ ...base, itens: [{ b: 2, a: 1 }] }), h);
  ok("muda quando o custo muda", calcularPayloadHash({ ...base, custo: 101 }) !== h);
  ok("muda quando o status_ml muda", calcularPayloadHash({ ...base, status_ml: "cancelled" }) !== h);
  ok("não depende de campos fora do conjunto (ml_date_last_updated)", calcularPayloadHash({ ...base, ml_date_last_updated: "x" }) === h);

  console.log("\n▸ schema: verificação somente leitura (worker não aplica migration)");
  const sqls = [];
  const dbAusente = { end: async () => {}, options: { max: 2 }, query: async (sql) => {
    sqls.push(String(sql));
    if (/unnest/.test(sql)) return { rows: [{ nome: "sentinel_pedidos", existe: true }, { nome: "sentinel_checkpoints", existe: true }, { nome: "sentinel_pedido_excecoes", existe: false }] };
    return { rows: [{ table_name: "sentinel_pedidos", column_name: "id" }, { table_name: "sentinel_checkpoints", column_name: "atraso_segundos" }] };
  } };
  let eSch = null;
  try { await verificarSentinelSchema(dbAusente); } catch (x) { eSch = x; }
  eq("faltando ⇒ SENTINEL_SCHEMA_AUSENTE com a lista", [eSch.code, eSch.faltando], ["SENTINEL_SCHEMA_AUSENTE", ["tabela sentinel_pedido_excecoes", "coluna sentinel_pedidos.payload_hash", "coluna sentinel_checkpoints.atraso_medido_em", "coluna sentinel_checkpoints.ciclos_sem_progresso"]]);
  ok("verificação só emitiu SELECT (0 CREATE/ALTER/INSERT)", sqls.length === 2 && sqls.every((q) => /^\s*SELECT/i.test(q)));
  const sqlsW = [];
  const dbW = { end: async () => {}, options: { max: 2 }, query: async (sql) => { sqlsW.push(String(sql)); return /unnest/.test(sql) ? { rows: [] } : { rows: [] }; } };
  let eW = null;
  try { await iniciar({ env: { SENTINEL_WORKER_ENABLED: "true", SENTINEL_CONTAS_ALLOWLIST: "41" }, logger, criarPool: () => dbW }); } catch (x) { eW = x; }
  eq("worker com schema ausente falha na partida", eW && eW.code, "SENTINEL_SCHEMA_AUSENTE");
  ok("… sem nenhum DDL (0 CREATE/ALTER)", sqlsW.length > 0 && sqlsW.every((q) => !/\b(CREATE|ALTER|DROP)\b/i.test(q)));

  console.log(`\n${checks} verificações passaram.`);
})().catch((err) => { console.error(err); process.exit(1); });
