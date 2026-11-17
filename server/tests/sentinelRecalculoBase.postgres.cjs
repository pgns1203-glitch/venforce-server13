// server/tests/sentinelRecalculoBase.postgres.cjs
//
// Recálculo por alteração da base de custos contra um PostgreSQL LOCAL descartável (fora do run-all):
//   SENTINEL_TEST_DATABASE_URL=postgres://vf@127.0.0.1:57652/postgres node tests/sentinelRecalculoBase.postgres.cjs
// Roda o CICLO REAL do worker (executarCiclo → processarConta → avaliarIncidentesConta). ML é fixture; nunca lê server/.env.

const assert = require("assert");
const { Pool, Client } = require("pg");

const baseUrl = process.env.SENTINEL_TEST_DATABASE_URL;
if (!baseUrl) throw new Error("Defina SENTINEL_TEST_DATABASE_URL (PostgreSQL local).");
const parsed = new URL(baseUrl);
console.log(`[sentinel.recalculo.postgres] host=${parsed.hostname} port=${parsed.port}`);
if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) throw new Error("LOCAL_DATABASE_REQUIRED");

const dbName = `vf_sentinel_recalc_${Date.now()}`;
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${dbName}`;
process.env.DATABASE_URL = testUrl.toString();

const { ensureSentinelSchema, ensureSentinelIncidentesSchema } = require("../services/sentinel/sentinelSchema");
const { executarCiclo } = require("../services/sentinel/sentinelPollingWorker");
const { ensureRecalculoSchema, novoEstadoRecalculo } = require("../services/sentinel/sentinelRecalculoBase");
const { reconhecerIncidente, resolverIncidente, resumoMonitoramento, listarIncidentes } = require("../services/sentinel/sentinelIncidentes");

let checks = 0;
function ok(label, cond) { assert.ok(cond, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); }
function eq(label, a, b) { assert.deepStrictEqual(a, b, `FALHOU: ${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); checks += 1; console.log(`  ok  ${label}`); }

// Contas: 10 (base 1, recálculo LIGADO), 20 (base 2, recálculo LIGADO, base NÃO muda no 1º ciclo), 30 (base 3, recálculo DESLIGADO = controle).
// Mesmos produtos em bases DIFERENTES. imposto 13% no início; vira 10% em MLB400/MLB900/MLB650.
const FIXTURE_SQL = `
CREATE TABLE clientes (id integer PRIMARY KEY, nome text, slug text UNIQUE, ativo boolean DEFAULT true);
CREATE TABLE cliente_contas (id integer PRIMARY KEY, cliente_id integer REFERENCES clientes(id), marketplace text,
  nome text, slug text, external_account_id text, is_primary boolean, ativo boolean);
CREATE TABLE custos (id serial PRIMARY KEY, base_id integer NOT NULL, produto_id text NOT NULL,
  custo_produto numeric NOT NULL DEFAULT 0, imposto_percentual numeric NOT NULL DEFAULT 0,
  sku text NOT NULL DEFAULT '', sku_id text NOT NULL DEFAULT '', id_model text, taxa_fixa numeric DEFAULT 0, updated_at timestamptz DEFAULT now());
CREATE TABLE squads (id integer PRIMARY KEY, nome text, ativo boolean DEFAULT true);
CREATE TABLE cliente_squad_history (id serial PRIMARY KEY, cliente_id integer, squad_id integer, fim_em timestamptz);
INSERT INTO squads VALUES (7, 'Squad Azul', true);
INSERT INTO clientes VALUES (1, 'Cliente Teste', 'cliente-teste', true);
INSERT INTO cliente_squad_history (cliente_id, squad_id) VALUES (1, 7);
INSERT INTO cliente_contas VALUES (10, 1, 'meli', 'Conta A', 'conta-a', '5551', true, true), (20, 1, 'meli', 'Conta B', 'conta-b', '5552', false, true), (30, 1, 'meli', 'Conta C', 'conta-c', '5553', false, true);
`;
const PRODUTOS = [["MLB400", 65, 0.13], ["MLB900", 60, 0.13], ["MLB650", 100, 0.13], ["MLB500", 30, 0.10], ["MLB600", 120, 0.13], ["MLB700", 65, 0.13]];

const DIA = 86400000;
const agora = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const SELLER = { 10: "5551", 20: "5552", 30: "5553" };
const BASE = { 10: 1, 20: 2, 30: 3 };
const ID0 = { 10: 1000, 20: 2000, 30: 3000 };

// 5×MLB400 (flipam), 2×MLB900 em PACK (flipam), 1×MLB650 (muda mas continua negativo), 1×MLB500 (não afetado), 1×MLB600 (negativo sempre), 1×MLB700 (incidente será RESOLVIDO pelo humano antes)
function pedidosDaConta(conta) {
  const s = ID0[conta];
  const p = (n, mlb, diasAtras, extra = {}) => ({
    id: s + n, status: "paid", date_created: iso(agora - (diasAtras * DIA) - 3600000), date_last_updated: iso(agora - diasAtras * DIA),
    seller: { id: Number(SELLER[conta]) }, shipping: { id: s + 5000 + n }, order_items: [{ item: { id: mlb, seller_sku: null, variation_id: null }, quantity: 1, unit_price: 100, sale_fee: 14 }], ...extra,
  });
  return [
    p(1, "MLB400", 9), p(2, "MLB400", 8), p(3, "MLB400", 7), p(4, "MLB400", 6), p(5, "MLB400", 5),
    p(8, "MLB900", 6, { pack_id: s + 777, shipping: { id: s + 9100 } }), p(9, "MLB900", 5, { pack_id: s + 777, shipping: { id: s + 9100 } }),
    p(10, "MLB650", 4), p(11, "MLB500", 4), p(12, "MLB600", 3), p(13, "MLB700", 3),
  ];
}

// ML fake: orders/search, orders/{id}, packs/{id}. Conta todas as chamadas por tipo.
function criarMl() {
  const todos = new Map();
  for (const c of [10, 20, 30]) for (const o of pedidosDaConta(c)) todos.set(String(o.id), o);
  const log = [];
  const fn = async (_cli, p, opts = {}) => {
    log.push(p);
    if (p.startsWith("/orders/search")) {
      const qs = new URLSearchParams(p.split("?")[1]);
      const seller = qs.get("seller");
      const from = Date.parse(qs.get("order.date_last_updated.from").replace("-00:00", "Z"));
      const to = Date.parse(qs.get("order.date_last_updated.to").replace("-00:00", "Z"));
      const dentro = [...todos.values()].filter((o) => String(o.seller.id) === seller && Date.parse(o.date_last_updated) >= from && Date.parse(o.date_last_updated) <= to);
      const off = Number(qs.get("offset"));
      return { ok: true, status: 200, data: { paging: { total: dentro.length }, results: dentro.slice(off, off + 50) } };
    }
    if (p.startsWith("/packs/")) {
      const pid = p.split("/")[2];
      const membros = [...todos.values()].filter((o) => String(o.pack_id) === pid && String(o.seller.id) === String(opts.mlUserId));
      return membros.length ? { ok: true, status: 200, data: { shipment: { id: membros[0].shipping.id }, orders: membros.map((o) => ({ id: o.id })) } } : { ok: false, status: 404, data: null };
    }
    if (p.startsWith("/orders/")) {
      const o = todos.get(p.split("/")[2].split("?")[0]);
      return { ok: !!o, status: o ? 200 : 404, data: o || null };
    }
    return { ok: false, status: 404, data: null };
  };
  fn.log = log;
  fn.porId = () => log.filter((p) => /^\/orders\/\d+/.test(p)).length;
  fn.packs = () => log.filter((p) => p.startsWith("/packs/")).length;
  fn.zerar = () => { log.length = 0; };
  return fn;
}

async function main() {
  const admin = new Pool({ connectionString: baseUrl, ssl: false, max: 1 });
  // Conexão ociosa derrubada pelo servidor (ex.: DROP DATABASE ... FORCE no encerramento) emite 'error'; sem listener o Node sai com 1
  // MESMO depois de todas as verificações passarem. Registramos o evento (nunca o engolimos em silêncio).
  const avisos = [];
  admin.on("error", (e) => avisos.push(`admin: ${e.message}`));
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const pool = new Pool({ connectionString: testUrl.toString(), ssl: false, max: 5 });
  pool.on("error", (e) => avisos.push(`pool: ${e.message}`));
  const q = async (sql, p) => (await pool.query(sql, p)).rows;
  const criarClient = () => new Client({ connectionString: testUrl.toString(), ssl: false });
  const ml = criarMl();
  let fretes = 0;
  const buscarFrete = async ({ shipmentId }) => { fretes += 1; const v = Number(shipmentId) >= 10000 ? 30 : 10; /* envios do pack têm id ≥ 10000 */ return { valor: v, custoSeller: v, status: "real", receitaComprador: 0, collected: true }; };
  const resolverConta = (conta) => async () => ({ clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: conta, sellerId: SELLER[conta], baseId: BASE[conta] });
  const cfgBase = { overlapMs: 2 * 3600000, maxTentativas: 3, cicloMaxMs: 120000, maxChamadasPorConta: 500 };
  const ultimoNow = {}; // nowMs do último ciclo de cada conta
  let relogio = agora; // cada ciclo avança 1 min, como na produção (marcador e avaliação do incidente em instantes distintos)
  const estados = { 10: novoEstadoRecalculo(), 20: novoEstadoRecalculo(), 30: novoEstadoRecalculo() };
  const ciclo = (conta, extra = {}) => executarCiclo({
    contaIds: [conta], criarClient, db: pool, nowMs: (ultimoNow[conta] = (relogio += 60000)), resolverConta: resolverConta(conta), mlFetchBase: ml, buscarFrete, config: cfgBase,
    fetchOpts: { config: { windowMaxMs: 30 * DIA } }, recalculoEstado: estados[conta], recalculoConfig: { habilitado: false }, ...extra,
  }).then((r) => r.contas[0]);
  const RC = (extra = {}) => ({ habilitado: true, maxPorCiclo: 50, desde: iso(agora - 12 * DIA), ...extra }); // vigência ANTERIOR às vendas do teste (12 d)
  const cp = async (c) => (await q("SELECT * FROM sentinel_checkpoints WHERE cliente_conta_id=$1", [c]))[0];
  const setCp = (c, ms) => pool.query(`INSERT INTO sentinel_checkpoints (cliente_conta_id, ultimo_date_last_updated) VALUES ($1,$2) ON CONFLICT (cliente_conta_id) DO UPDATE SET ultimo_date_last_updated = EXCLUDED.ultimo_date_last_updated`, [c, iso(ms)]);
  const linha = async (c, n) => (await q("SELECT pedido_id, margem_valor::float AS margem, custo::float AS custo, imposto::float AS imposto, frete::float AS frete, estado_margem, payload_hash, calculado_em, updated_at, ml_date_last_updated, itens->0->>'item_id' AS mlb, to_jsonb(sentinel_pedidos)->'recalculo_base' AS marcador FROM sentinel_pedidos WHERE cliente_conta_id=$1 AND pedido_id=$2", [c, String(ID0[c] + n)]))[0];
  const inc = async (c, mlb) => (await q("SELECT * FROM sentinel_incidentes WHERE cliente_conta_id=$1 AND tipo='margem_negativa' AND chave=$2", [c, mlb]))[0];
  const eventos = async (id, tipo) => (await q("SELECT * FROM sentinel_incidente_eventos WHERE incidente_id=$1 AND ($2::text IS NULL OR evento=$2) ORDER BY id", [id, tipo || null]));
  const tudo = async (c) => q("SELECT pedido_id, payload_hash, calculado_em, updated_at, margem_valor::float AS m FROM sentinel_pedidos WHERE cliente_conta_id=$1 ORDER BY pedido_id", [c]);
  const mudaImposto = (bases, novo) => pool.query("UPDATE custos SET imposto_percentual=$2, updated_at=now() WHERE base_id = ANY($1::int[]) AND produto_id IN ('MLB400','MLB900','MLB650')", [bases, novo]);

  try {
    await pool.query(FIXTURE_SQL);
    for (const b of [1, 2, 3]) for (const [mlb, custo, imp] of PRODUTOS) await pool.query("INSERT INTO custos (base_id, produto_id, custo_produto, imposto_percentual) VALUES ($1,$2,$3,$4)", [b, mlb, custo, imp]);
    await ensureSentinelSchema(pool);
    await ensureSentinelIncidentesSchema(pool);

    console.log("\n▸ 1. ingestão inicial (imposto 13%): linhas e incidentes de margem negativa");
    for (const c of [10, 20, 30]) await setCp(c, agora - 11 * DIA);
    for (const c of [10, 20, 30]) { const r = await ciclo(c); eq(`conta ${c}: ciclo sem erro`, r.erro, null); }
    eq("MLB400 a 13%: margem −2,00 (100−14−10−65−13)", (await linha(10, 1)).margem, -2);
    eq("pack MLB900: frete rateado 15 por pedido, margem −2,00", [(await linha(10, 8)).frete, (await linha(10, 8)).margem], [15, -2]);
    eq("MLB500 (não afetado) +36; MLB600 −57; MLB650 −37", [(await linha(10, 11)).margem, (await linha(10, 12)).margem, (await linha(10, 10)).margem], [36, -57, -37]);
    ok("incidentes de margem abertos e ATIVOS", (await inc(10, "MLB400")).condicao_ativa === true && (await inc(10, "MLB900")).condicao_ativa === true && (await inc(10, "MLB650")).condicao_ativa === true);
    ok("incidente do MLB700 (a ser resolvido) existe", !!(await inc(10, "MLB700")));

    console.log("\n▸ 2. ação humana ANTES da mudança: reconhece MLB400, resolve MLB700");
    const incA = await inc(10, "MLB400"), incR = await inc(10, "MLB700");
    await reconhecerIncidente(pool, incA.id, { ator: "ana", observacao: "vou conferir a base" });
    await resolverIncidente(pool, incR.id, { ator: "ana", motivo: "Dado incorreto / falso positivo" });
    eq("estados humanos gravados", [(await inc(10, "MLB400")).status, (await inc(10, "MLB700")).status], ["reconhecido", "resolvido"]);

    console.log("\n▸ 3. a base muda (13% → 10%) nas contas 10 e 30; conta 20 (base 2) NÃO muda");
    await mudaImposto([1, 3], 0.10);
    const antes10 = await tudo(10);
    const cp10antes = await cp(10);

    console.log("\n▸ 4. migration de recálculo AUSENTE: recálculo suspenso, coleta normal, nada reescrito");
    ml.zerar();
    const sem = await ciclo(10, { recalculoConfig: RC() });
    eq("sem erro e SEM nenhum GET /orders/{id}", [sem.erro, ml.porId()], [null, 0]);
    eq("linhas intactas (continuam defasadas)", (await tudo(10)).map((x) => x.payload_hash), antes10.map((x) => x.payload_hash));
    await ensureRecalculoSchema(pool);
    ok("migration aplicada (coluna recalculo_base)", (await q("SELECT 1 FROM information_schema.columns WHERE table_name='sentinel_pedidos' AND column_name='recalculo_base'")).length === 1);

    console.log("\n▸ 4b. VIGÊNCIA (decisão financeira): a mudança NÃO vale para vendas anteriores a ela");
    const hashesAntes = (await tudo(10)).map((x) => x.payload_hash).join();
    ml.zerar();
    const semVig = await ciclo(10, { recalculoConfig: { habilitado: true, maxPorCiclo: 50 } }); // flag ligada, SEM SENTINEL_RECALC_DESDE
    eq("flag ligada SEM vigência definida: recálculo suspenso (0 GET, linhas intactas, sem erro)", [semVig.erro, ml.porId(), (await tudo(10)).map((x) => x.payload_hash).join() === hashesAntes], [null, 0, true]);
    estados[10] = novoEstadoRecalculo();
    ml.zerar();
    const vigPosterior = await ciclo(10, { recalculoConfig: RC({ desde: iso(agora - 1 * DIA) }) }); // vigência DEPOIS de todas as vendas (caso real da Alianza 1)
    eq("vigência posterior a todas as vendas: 0 GET e NENHUMA linha reescrita (o 13% gravado é o correto)", [vigPosterior.erro, ml.porId(), (await tudo(10)).map((x) => x.payload_hash).join() === hashesAntes], [null, 0, true]);
    eq("e os incidentes dessas vendas seguem ATIVOS (perda real à época)", [(await inc(10, "MLB400")).condicao_ativa, (await inc(10, "MLB900")).condicao_ativa], [true, true]);
    estados[10] = novoEstadoRecalculo();

    console.log("\n▸ 5. recálculo LIGADO, pedidos SEM mudança no ML (ml_date_last_updated igual)");
    ml.zerar();
    const dateAntes = (await linha(10, 1)).ml_date_last_updated.toISOString();
    const r10 = await ciclo(10, { recalculoConfig: RC() });
    eq("ciclo sem erro", r10.erro, null);
    const l1 = await linha(10, 1);
    eq("MLB400 recalculado: imposto 10,00 e margem +1,00", [l1.imposto, l1.margem], [10, 1]);
    eq("ml_date_last_updated NÃO mudou", l1.ml_date_last_updated.toISOString(), dateAntes);
    eq("hash mudou (o cálculo mudou)", l1.payload_hash !== antes10[0].payload_hash, true);
    ok("marcador identifica o recálculo como tal (base atual, não realizado)", l1.marcador && l1.marcador.motivo === "base_de_custos_alterada" && l1.marcador.natureza === "recalculado_com_base_atual" && l1.marcador.antes.imposto === 13 && l1.marcador.antes.margem === -2);
    eq("pack: frete rateado PRESERVADO (15/15) e margem nova +1,00", [(await linha(10, 8)).frete, (await linha(10, 9)).frete, (await linha(10, 8)).margem, (await linha(10, 9)).margem], [15, 15, 1, 1]);
    ok("pack: ambos os pedidos marcados (mesmo o irmão regravado pelo grupo)", (await linha(10, 8)).marcador && (await linha(10, 9)).marcador);
    eq("MLB650 muda mas continua negativo: −34,00", (await linha(10, 10)).margem, -34);
    const nao = await tudo(10);
    for (const n of [11, 12, 13]) {
      const a = antes10.find((x) => x.pedido_id === String(ID0[10] + n)), d = nao.find((x) => x.pedido_id === String(ID0[10] + n));
      eq(`pedido ${n} NÃO afetado: hash, calculado_em e updated_at intactos`, [d.payload_hash, +d.calculado_em, +d.updated_at], [a.payload_hash, +a.calculado_em, +a.updated_at]);
    }
    eq("pedidos não afetados sem marcador", (await linha(10, 11)).marcador, null);
    ok("custo de chamadas: 1 GET por pedido afetado (+ no máx. 1 /packs), frete reaproveitado", ml.porId() >= 8 && ml.porId() <= 10 && ml.packs() <= 1);
    const cp10 = await cp(10);
    ok("checkpoint preservado pela recalculação (avança só como no ciclo normal)", +cp10.ultimo_date_last_updated >= +cp10antes.ultimo_date_last_updated && cp10.ultimo_erro === null);

    console.log("\n▸ 6. incidentes: condição encerrada, histórico e ação humana preservados, sem duplicar");
    const iA = await inc(10, "MLB400"), iP = await inc(10, "MLB900"), iN = await inc(10, "MLB650"), iR = await inc(10, "MLB700");
    eq("MLB400: condição ENCERRADA, status humano mantido (reconhecido) e quem reconheceu", [iA.condicao_ativa, iA.status, iA.reconhecido_por], [false, "reconhecido", "ana"]);
    eq("MLB900 (pack): condição encerrada", iP.condicao_ativa, false);
    const enc = await eventos(iA.id, "condicao_encerrada");
    eq("exatamente UM evento condicao_encerrada, dizendo que foi RECÁLCULO (não 'sem ocorrência')", [enc.length, /recalcul/i.test(enc[0].dados.motivo)], [1, true]);
    eq("evento traz a quantidade de pedidos recalculados", enc[0].dados.recalculoBase.pedidos, 5);
    eq("nenhum evento 'reaberto' e nenhum 'resolvido' automático", (await eventos(iA.id, "reaberto")).length + (await eventos(iA.id, "resolvido")).length, 0);
    eq("MLB650 continua negativo: incidente ATIVO, impacto recalculado 37 → 34, 1 evento 'atualizado' a mais", [iN.condicao_ativa, Number(iN.impacto_valor), (await eventos(iN.id, "atualizado")).length], [true, 34, 1]);
    eq("MLB700 já RESOLVIDO pelo humano: continua resolvido, sem reabrir nem novo evento de encerramento", [iR.status, (await eventos(iR.id, "reaberto")).length, (await eventos(iR.id, "condicao_encerrada")).length], ["resolvido", 0, 0]);
    const resumo = await resumoMonitoramento(pool, { contaIds: [10] });
    eq("resumo soma perda só das condições ATIVAS: MLB650 34 + MLB600 57 = 91", Number(resumo.perdaContribuicaoObservada), 91);
    const lista = await listarIncidentes(pool, { contaIds: [10], limit: 50, offset: 0 });
    const dtoA = lista.itens.find((i) => String(i.id) === String(iA.id));
    eq("API: condicaoAtiva=false e status 'reconhecido' no DTO", [dtoA.condicaoAtiva, dtoA.status], [false, "reconhecido"]);

    console.log("\n▸ 7. idempotência: repetir NÃO reprocessa nem regrava; reimport IDÊNTICO da base também não");
    const depois = await tudo(10);
    ml.zerar();
    const e1 = (await eventos(iA.id)).length;
    await ciclo(10, { recalculoConfig: RC() });
    eq("ciclo repetido: 0 GET /orders/{id}", ml.porId(), 0);
    eq("nenhuma linha regravada", (await tudo(10)).map((x) => [x.payload_hash, +x.updated_at]), depois.map((x) => [x.payload_hash, +x.updated_at]));
    await pool.query("UPDATE custos SET updated_at = now() WHERE base_id = 1"); // reupload da MESMA planilha: updated_at muda, conteúdo não
    ml.zerar();
    await ciclo(10, { recalculoConfig: RC() });
    eq("reimport idêntico (updated_at novo, valores iguais): 0 GET e 0 escritas", [ml.porId(), (await tudo(10)).map((x) => +x.updated_at).join()], [0, depois.map((x) => +x.updated_at).join()]);
    eq("sem eventos duplicados", (await eventos(iA.id)).length, e1);

    console.log("\n▸ 8. isolamento: conta 20 (mesmos produtos, base 2 sem mudança) e controle com recálculo DESLIGADO (conta 30)");
    const antes20 = await tudo(20);
    ml.zerar();
    const r20 = await ciclo(20, { recalculoConfig: RC() });
    eq("conta 20: base inalterada ⇒ 0 GET e linhas intactas (a mudança da base 1 não vaza)", [r20.erro, ml.porId(), (await tudo(20)).map((x) => x.payload_hash).join()], [null, 0, antes20.map((x) => x.payload_hash).join()]);
    ml.zerar();
    const r30 = await ciclo(30); // recálculo desligado
    eq("conta 30 com recálculo DESLIGADO: 0 GET /orders/{id}; continua defasada (−2,00)", [ml.porId(), (await linha(30, 1)).margem], [0, -2]);
    eq("checkpoint de cada conta = fim da janela do PRÓPRIO último ciclo, com recálculo ligado (10) ou desligado (30)", [+(await cp(10)).ultimo_date_last_updated === ultimoNow[10], +(await cp(30)).ultimo_date_last_updated === ultimoNow[30]], [true, true]);

    console.log("\n▸ 9. teto por ciclo + REINÍCIO no meio (estado em memória perdido): retoma sem refazer nem esquecer");
    await mudaImposto([2], 0.10); // agora a conta 20 também tem 8 linhas defasadas (5 + 2 do pack + 1)
    let total = 0; const lotes = [];
    for (let i = 0; i < 6; i += 1) {
      estados[20] = novoEstadoRecalculo(); // cada ciclo = processo reiniciado
      ml.zerar();
      const antesN = (await q("SELECT COUNT(*)::int n FROM sentinel_pedidos WHERE cliente_conta_id=20 AND recalculo_base IS NOT NULL"))[0].n;
      await ciclo(20, { recalculoConfig: RC({ maxPorCiclo: 3 }) });
      const depoisN = (await q("SELECT COUNT(*)::int n FROM sentinel_pedidos WHERE cliente_conta_id=20 AND recalculo_base IS NOT NULL"))[0].n;
      lotes.push(depoisN - antesN); total += depoisN - antesN;
      if (depoisN - antesN === 0) break;
    }
    eq("convergiu: 8 linhas recalculadas no total, nunca mais de 4 por ciclo (teto 3 + irmão de pack)", [total, lotes.every((n) => n <= 4)], [8, true]);
    eq("depois de convergir: 0 GET", (ml.zerar(), await ciclo(20, { recalculoConfig: RC({ maxPorCiclo: 3 }) }), ml.porId()), 0);

    console.log("\n▸ 10. falha de GET e recuperação (conta 30, agora com recálculo LIGADO)");
    estados[30] = novoEstadoRecalculo();
    const idFalha = String(ID0[30] + 3);
    let falhou = false;
    const fetchComFalha = async (ctx, id) => {
      if (String(id) === idFalha && !falhou) { falhou = true; const e = new Error("boom: timeout simulado"); e.code = "ETIMEDOUT"; throw e; }
      const r = await ml("", `/orders/${id}`, { mlUserId: ctx.sellerId });
      return r.data;
    };
    const cp30antes = await cp(30);
    const rf = await ciclo(30, { recalculoConfig: RC(), fetchOrderByIdFn: fetchComFalha });
    const ex = (await q("SELECT status, tentativas FROM sentinel_pedido_excecoes WHERE cliente_conta_id=30 AND pedido_id=$1", [idFalha]))[0];
    eq("a falha vira exceção 'retentando' e NÃO derruba o ciclo nem o checkpoint", [rf.erro, ex && ex.status, +(await cp(30)).ultimo_date_last_updated >= +cp30antes.ultimo_date_last_updated], [null, "retentando", true]);
    eq("os OUTROS pedidos da conta foram recalculados", (await linha(30, 1)).margem, 1);
    eq("o pedido que falhou segue defasado (−2,00)", (await linha(30, 3)).margem, -2);
    await ciclo(30, { recalculoConfig: RC(), fetchOrderByIdFn: fetchComFalha });
    eq("recuperação no ciclo seguinte: recalculado (+1,00) e exceção resolvida", [(await linha(30, 3)).margem, (await q("SELECT status FROM sentinel_pedido_excecoes WHERE cliente_conta_id=30 AND pedido_id=$1", [idFalha]))[0].status], [1, "resolvido"]);

    console.log("\n▸ 11. vigência: SENTINEL_RECALC_DESDE protege pedidos anteriores à data (sem reescrever a história)");
    await pool.query("UPDATE custos SET imposto_percentual = 0.13 WHERE base_id = 1 AND produto_id = 'MLB400'"); // volta a divergir (linhas gravadas a 10%)
    const desde = iso(agora - 7 * DIA + 3600000); // só pedidos com data_pedido >= desde (≈ os de 7 dias atrás em diante)
    ml.zerar();
    estados[10] = novoEstadoRecalculo();
    await ciclo(10, { recalculoConfig: RC({ desde }) });
    const lp = [1, 2, 3, 4, 5];
    const novas = await Promise.all(lp.map((n) => linha(10, n)));
    eq("pedidos de 9 e 8 dias (anteriores à vigência) NÃO foram reescritos: continuam a 10% (+1,00)", novas.slice(0, 2).map((x) => x.margem), [1, 1]);
    eq("pedidos de 6 e 5 dias (dentro da vigência) foram recalculados a 13% (−2,00)", novas.slice(3).map((x) => x.margem), [-2, -2]);

    console.log("\n▸ 12. rollback MANUAL da coluna com o worker no ar: recálculo suspende sem erro e sem GET; migration reaplicada (psql -f, 2×) retoma");
    // conta 10: volta a divergir (base 10% → 13% em MLB400/MLB900/MLB650) e o marcador some do banco no meio da operação
    await pool.query("UPDATE custos SET imposto_percentual = 0.13 WHERE base_id = 1 AND produto_id IN ('MLB400','MLB900','MLB650')");
    await pool.query("ALTER TABLE sentinel_pedidos DROP COLUMN recalculo_base");
    estados[10] = novoEstadoRecalculo();
    ml.zerar();
    const rb = await ciclo(10, { recalculoConfig: RC() });
    eq("ciclo sem erro de coleta e SEM erro na avaliação de incidentes (a transação não é abortada pela coluna ausente)", [rb.erro, rb.incidentesErro === undefined], [null, true]);
    eq("recálculo suspenso (0 GET /orders/{id}) enquanto a coluna não existe", ml.porId(), 0);
    // migration reaplicada como um operador faria (psql -f): o runner versionado pula migration já registrada, então executa-se o .sql
    await pool.query(require("fs").readFileSync(require("path").join(__dirname, "../sql/migrations/20261118_sentinel_recalculo_base.sql"), "utf8"));
    await pool.query(require("fs").readFileSync(require("path").join(__dirname, "../sql/migrations/20261118_sentinel_recalculo_base.sql"), "utf8")); // idempotente: 2× sem erro
    estados[10] = novoEstadoRecalculo();
    ml.zerar();
    const rb2 = await ciclo(10, { recalculoConfig: RC() });
    eq("migration reaplicada: o recálculo retoma sem intervenção (pedidos recalculados de novo)", [rb2.erro, ml.porId() > 0], [null, true]);

    console.log(`\n✓ sentinelRecalculoBase.postgres: ${checks} verificações${avisos.length ? ` (avisos de conexão no encerramento: ${avisos.join(" | ")})` : ""}`);
  } finally {
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
