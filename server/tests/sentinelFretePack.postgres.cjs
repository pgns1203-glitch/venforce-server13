// server/tests/sentinelFretePack.postgres.cjs
//
// Sentinel × frete de PACK (shipment compartilhado por 2+ pedidos), contra PostgreSQL LOCAL
// descartável (fora do run-all):
//   SENTINEL_TEST_DATABASE_URL=postgres://vf@127.0.0.1:57651/postgres node tests/sentinelFretePack.postgres.cjs
// ML é fixture no nível do mlFetch (para checar noRefresh e contar chamadas). Nunca lê server/.env.

const assert = require("assert");
const { Pool, Client } = require("pg");

const baseUrl = process.env.SENTINEL_TEST_DATABASE_URL;
if (!baseUrl) throw new Error("Defina SENTINEL_TEST_DATABASE_URL (PostgreSQL local).");
const parsed = new URL(baseUrl);
console.log(`[sentinelFretePack.postgres] host=${parsed.hostname} port=${parsed.port}`);
if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) throw new Error("LOCAL_DATABASE_REQUIRED");

const dbName = `vf_sentinel_fretepack_${Date.now()}`;
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${dbName}`;
process.env.DATABASE_URL = testUrl.toString();
const criarClient = () => new Client({ connectionString: testUrl.toString(), ssl: false });

const { ensureSentinelSchema } = require("../services/sentinel/sentinelSchema");
const { executarCiclo } = require("../services/sentinel/sentinelPollingWorker");
const { processarPedido } = require("../services/sentinel/sentinelPedidoService");
const { detectarMargemNegativa, configIncidentes } = require("../services/sentinel/sentinelIncidentes");
const { classificarPedido } = require("../services/sentinel/sentinelClassificacao");

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
INSERT INTO custos (base_id, produto_id, custo_produto, imposto_percentual) VALUES
  (1, 'MLB100', 20, 10), (1, 'MLB200', 35, 10), (1, 'MLB900', 500, 10);
`;

const H = 3600 * 1000;
const agora = Date.now();
const iso = (ms) => new Date(ms).toISOString();

function pedido(id, { shipment, pack = null, itens, status = "paid", updatedMs = agora - H }) {
  return {
    id, status, pack_id: pack,
    date_created: iso(agora - 3 * H), date_last_updated: iso(updatedMs),
    shipping: { id: shipment, logistic_type: "cross_docking" },
    order_items: itens.map(([mlb, q, preco, taxa]) => ({
      item: { id: mlb, title: "P", seller_sku: null, variation_id: null }, quantity: q, unit_price: preco, sale_fee: taxa,
    })),
  };
}

// ML no nível do mlFetch: /orders/search (janela), /orders/:id, /packs/:id, /shipments/:id/costs.
function criarMl({ pedidos, packs, fretes, indisponiveis = new Set() }) {
  const log = [];
  const fn = async (_c, p, opts = {}) => {
    log.push({ p, opts });
    if (indisponiveis.has(p)) return { ok: false, status: 503, data: null };
    if (p.startsWith("/orders/search")) {
      const qs = new URLSearchParams(p.split("?")[1]);
      const from = Date.parse(qs.get("order.date_last_updated.from").replace("-00:00", "Z"));
      const to = Date.parse(qs.get("order.date_last_updated.to").replace("-00:00", "Z"));
      const dentro = fn.janela.filter((o) => Date.parse(o.date_last_updated) >= from && Date.parse(o.date_last_updated) <= to);
      return { ok: true, status: 200, data: { paging: { total: dentro.length }, results: dentro } };
    }
    const mo = /^\/orders\/(\d+)$/.exec(p);
    if (mo) { const o = pedidos.find((x) => String(x.id) === mo[1]); return { ok: !!o, status: o ? 200 : 404, data: o || null }; }
    const mp = /^\/packs\/(\d+)$/.exec(p);
    if (mp) { const k = packs[mp[1]]; return k ? { ok: true, status: 200, data: { id: Number(mp[1]), shipment: { id: k.shipment }, orders: k.orders.map((id) => ({ id })) } } : { ok: false, status: 404, data: null }; }
    const ms_ = /^\/shipments\/(\d+)\/costs$/.exec(p);
    if (ms_) { const f = fretes[ms_[1]]; return f ? { ok: true, status: 200, data: { senders: [{ user_id: opts.mlUserId, cost: f.cost }], receiver: { cost: f.receita } } } : { ok: false, status: 404, data: null }; }
    return { ok: false, status: 404, data: null };
  };
  fn.janela = pedidos;
  fn.log = log;
  fn.chamou = (re) => log.filter((c) => re.test(c.p)).length;
  return fn;
}

const ctxDe = async () => ({ clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: 10, sellerId: "5551", baseId: 1 });
const cfgBase = { overlapMs: 2 * H, maxTentativas: 3, cicloMaxMs: 60000, maxChamadasPorConta: 500 };

async function main() {
  const admin = new Pool({ connectionString: baseUrl, ssl: false, max: 1 });
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const pool = new Pool({ connectionString: testUrl.toString(), ssl: false, max: 4 });
  const q = async (sql, p) => (await pool.query(sql, p)).rows;
  const linha = async (id) => (await q("SELECT * FROM sentinel_pedidos WHERE cliente_conta_id = 10 AND pedido_id = $1", [String(id)]))[0];
  const limpar = async () => { await pool.query("DELETE FROM sentinel_pedidos; DELETE FROM sentinel_pedido_excecoes; DELETE FROM sentinel_checkpoints;"); };
  const ciclo = (ml, extra = {}) => executarCiclo({ contaIds: [10], criarClient, db: pool, nowMs: agora, resolverConta: ctxDe, mlFetchBase: ml, config: cfgBase, ...extra });
  try {
    await pool.query(FIXTURE_SQL);
    await ensureSentinelSchema(pool);
    const antes = agora - 4 * H;
    const setCp = () => pool.query("INSERT INTO sentinel_checkpoints (cliente_conta_id, ultimo_date_last_updated) VALUES (10, $1) ON CONFLICT (cliente_conta_id) DO UPDATE SET ultimo_date_last_updated = EXCLUDED.ultimo_date_last_updated", [iso(antes)]);

    // A = receita 200, B = receita 100 ⇒ frete 30 → 20 / 10; receita de envio 10 → 6,67 / 3,33
    const A = pedido(1001, { shipment: 7001, pack: 9001, itens: [["MLB100", 2, 100, 12.5]] });
    const B = pedido(1002, { shipment: 7001, pack: 9001, itens: [["MLB200", 1, 100, 10]], updatedMs: agora - 90 * 60 * 1000 });
    const packs = { 9001: { shipment: 7001, orders: [1001, 1002] } };
    const fretes = { 7001: { cost: 30, receita: 10 } };

    console.log("\n▸ 1. pack inteiro na janela ⇒ rateio, Σ == shipment");
    await setCp();
    const ml1 = criarMl({ pedidos: [A, B], packs, fretes });
    ml1.janela = [A, B];
    const c1 = await ciclo(ml1);
    eq("ciclo sem erro", c1.contas[0].erro, null);
    const la = await linha(1001), lb = await linha(1002);
    eq("frete por pedido proporcional à receita (20,00 / 10,00)", [Number(la.frete), Number(lb.frete)], [20, 10]);
    eq("Σ frete dos 2 pedidos == 30,00 (antes: 60,00)", Math.round((Number(la.frete) + Number(lb.frete)) * 100), 3000);
    eq("pedidos confirmados (nenhuma pendência de pack)", [la.estado_margem, lb.estado_margem, la.pendencias, lb.pendencias], ["confirmada", "confirmada", [], []]);
    eq("/packs consultado 1× (cache por pack), 0 /orders extra (irmão já na janela)", [ml1.chamou(/^\/packs\//), ml1.chamou(/^\/orders\/\d+$/)], [1, 0]);
    eq("/shipments/costs 1× (cache por shipment)", ml1.chamou(/^\/shipments\//), 1);
    ok("noRefresh:true em 100% das chamadas (inclusive /packs)", ml1.log.every((c) => c.opts.noRefresh === true));
    const compara = await q("SELECT margem_valor FROM sentinel_pedidos WHERE pedido_id = '1001'");
    ok("margem do pedido usa só a parcela de frete dele", Number(compara[0].margem_valor) === Number(la.margem_valor));

    console.log("\n▸ 5. idempotência (ciclo repetido não duplica nem muda)");
    const hashes = [la.payload_hash, lb.payload_hash];
    const ml1b = criarMl({ pedidos: [A, B], packs, fretes });
    await ciclo(ml1b);
    const la2 = await linha(1001), lb2 = await linha(1002);
    eq("hash e frete estáveis; 2 linhas", [[la2.payload_hash, lb2.payload_hash], Number(la2.frete), (await q("SELECT COUNT(*)::int n FROM sentinel_pedidos"))[0].n], [hashes, 20, 2]);

    console.log("\n▸ 2. pack PARCIALMENTE na janela ⇒ irmão buscado por ID (noRefresh, no orçamento)");
    await limpar(); await setCp();
    const mlP = criarMl({ pedidos: [A, B], packs, fretes });
    mlP.janela = [A]; // só A foi atualizado na janela
    const cP = await ciclo(mlP);
    eq("sem erro", cP.contas[0].erro, null);
    eq("A recebe a sua parcela (20,00), não o frete cheio", Number((await linha(1001)).frete), 20);
    eq("irmão B buscado via /orders/1002 + /packs/9001", [mlP.chamou(/^\/orders\/1002$/), mlP.chamou(/^\/packs\/9001$/)], [1, 1]);
    ok("noRefresh em todas as chamadas novas", mlP.log.every((c) => c.opts.noRefresh === true));
    eq("B não foi gravado por este ciclo (só usado no rateio)", (await q("SELECT COUNT(*)::int n FROM sentinel_pedidos WHERE pedido_id = '1002'"))[0].n, 0);

    console.log("\n▸ 3. irmão indisponível ⇒ frete NULL + frete_pack_incompleto + provisória (nunca o frete cheio)");
    await limpar(); await setCp();
    const mlI = criarMl({ pedidos: [A, B], packs, fretes, indisponiveis: new Set(["/orders/1002"]) });
    mlI.janela = [A];
    await ciclo(mlI);
    const li = await linha(1001);
    eq("frete NULL (não 30, não 0)", li.frete, null);
    eq("provisória com pendência frete_pack_incompleto", [li.estado_margem, li.pendencias.includes("frete_pack_incompleto"), li.pendencias.includes("sem_frete")], ["provisoria", true, false]);
    eq("classificação: inconclusivo", classificarPedido(li).confiabilidade, "inconclusivo");
    ok("irmão tentado com noRefresh", mlI.log.filter((c) => c.p === "/orders/1002").every((c) => c.opts.noRefresh === true));

    console.log("\n▸ 4. detector: pedido com frete_pack_incompleto NÃO gera incidente de margem negativa");
    const caro = pedido(2001, { shipment: 7002, pack: 9002, itens: [["MLB900", 1, 100, 12]] }); // custo 500 ⇒ margem muito negativa
    const mlN = criarMl({ pedidos: [caro], packs: { 9002: { shipment: 7002, orders: [2001, 2002] } }, fretes: { 7002: { cost: 10, receita: 0 } }, indisponiveis: new Set(["/orders/2002"]) });
    mlN.janela = [caro];
    await limpar(); await setCp();
    await ciclo(mlN);
    const ln = (await q("SELECT * FROM sentinel_pedidos WHERE pedido_id = '2001'"))[0];
    ok("margem calculada é negativa (sem frete)", Number(ln.margem_valor) < 0 && ln.pendencias.includes("frete_pack_incompleto"));
    const cfg = configIncidentes({});
    eq("detectarMargemNegativa ⇒ nenhum incidente", detectarMargemNegativa([{ ...ln, data_pedido: ln.data_pedido }], cfg), []);
    const controle = { ...ln, pendencias: ["sem_imposto"], estado_margem: "provisoria" };
    eq("controle: a MESMA linha sem a pendência de pack gera incidente (o filtro é o que a impede)", detectarMargemNegativa([controle], cfg).length, 1);

    console.log("\n▸ 5b. quando o irmão volta, a provisória é reprocessada e vira confirmada (hash muda ⇒ upsert)");
    await limpar(); await setCp();
    const indisp = new Set(["/orders/1002"]);
    const mlR = criarMl({ pedidos: [A, B], packs, fretes, indisponiveis: indisp });
    mlR.janela = [A];
    await ciclo(mlR);
    const hashInc = (await linha(1001)).payload_hash;
    indisp.delete("/orders/1002");
    await ciclo(mlR);
    const lr = await linha(1001);
    eq("A agora com a parcela correta", [Number(lr.frete), lr.estado_margem], [20, "confirmada"]);
    ok("hash mudou (o frete rateado mudou)", lr.payload_hash !== hashInc);

    console.log("\n▸ 6. linha antiga com frete CHEIO (bug) é corrigida quando o pedido é reprocessado");
    await limpar(); await setCp();
    // grava como o Sentinel antigo: sem contexto de envio ⇒ frete cheio (30) no pedido A
    const ctx = await ctxDe();
    await processarPedido(ctx, A, { db: pool, buscarFrete: async () => ({ status: "real", valor: 30, receitaComprador: 10, collected: true }), cacheCusto: new Map() });
    eq("linha legada com 30,00 (bug)", Number((await linha(1001)).frete), 30);
    const mlF = criarMl({ pedidos: [A, B], packs, fretes });
    mlF.janela = [A, B];
    await ciclo(mlF);
    eq("após reprocessar: 20,00 / 10,00 (Σ 30,00)", [Number((await linha(1001)).frete), Number((await linha(1002)).frete)], [20, 10]);

    console.log("\n▸ pack de 1 pedido só (pack lista só ele) ⇒ frete cheio, sem rateio");
    await limpar(); await setCp();
    const solo = pedido(3001, { shipment: 7003, pack: 9003, itens: [["MLB100", 1, 100, 12.5]] });
    const mlS = criarMl({ pedidos: [solo], packs: { 9003: { shipment: 7003, orders: [3001] } }, fretes: { 7003: { cost: 18.4, receita: 0 } } });
    mlS.janela = [solo];
    await ciclo(mlS);
    eq("frete cheio 18,40", Number((await linha(3001)).frete), 18.4);

    console.log("\n▸ sem pack_id mas mesmo shipment na janela ⇒ rateio entre os presentes");
    await limpar(); await setCp();
    const sa = pedido(4001, { shipment: 7004, itens: [["MLB100", 1, 100, 12.5]] });
    const sb = pedido(4002, { shipment: 7004, itens: [["MLB200", 1, 100, 10]] });
    const mlSP = criarMl({ pedidos: [sa, sb], packs: {}, fretes: { 7004: { cost: 10, receita: 0 } } });
    mlSP.janela = [sa, sb];
    await ciclo(mlSP);
    eq("5,00 + 5,00", [Number((await linha(4001)).frete), Number((await linha(4002)).frete)], [5, 5]);
    eq("nenhuma chamada a /packs", mlSP.chamou(/^\/packs\//), 0);

    console.log("\n▸ orçamento de chamadas respeitado no rateio");
    await limpar(); await setCp();
    const mlO = criarMl({ pedidos: [A, B], packs, fretes });
    mlO.janela = [A];
    const cO = await ciclo(mlO, { config: { ...cfgBase, maxChamadasPorConta: 2 } }); // orders/search + /packs; o irmão estoura
    ok("nunca passa de 2 chamadas ao ML", mlO.log.length <= 2);
    eq("sem frete cheio: frete NULL + frete_pack_incompleto", [(await linha(1001)).frete, (await linha(1001)).pendencias.includes("frete_pack_incompleto")], [null, true]);
    ok("conta reporta orçamento esgotado", /SENTINEL_ORCAMENTO_CHAMADAS/.test(cO.contas[0].erro || ""));

    console.log("\n▸ pack cancelado no meio: o cancelado continua no rateio");
    await limpar(); await setCp();
    const ca = pedido(5001, { shipment: 7005, pack: 9005, itens: [["MLB100", 1, 100, 12.5]] });
    const cb = pedido(5002, { shipment: 7005, pack: 9005, status: "cancelled", itens: [["MLB200", 1, 100, 10]] });
    const mlC = criarMl({ pedidos: [ca, cb], packs: { 9005: { shipment: 7005, orders: [5001, 5002] } }, fretes: { 7005: { cost: 20, receita: 0 } } });
    mlC.janela = [ca];
    await ciclo(mlC);
    eq("o pedido pago recebe 10,00 (cancelado entra no rateio)", Number((await linha(5001)).frete), 10);

    console.log(`\n${checks} verificações passaram (PostgreSQL local ${parsed.hostname}).`);
  } finally {
    await pool.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
    await require("../config/database").end().catch(() => {});
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
