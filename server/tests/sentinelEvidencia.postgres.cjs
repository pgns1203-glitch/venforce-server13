// server/tests/sentinelEvidencia.postgres.cjs
//
// Persistência REAL da evidência financeira (modo sombra) contra um PostgreSQL LOCAL descartável (fora do run-all):
//   SENTINEL_TEST_DATABASE_URL=postgres://vf@127.0.0.1:57651/postgres node tests/sentinelEvidencia.postgres.cjs
// Cria vf_sentinel_evid_<ts>, roda e apaga. Recusa host que não seja local. Nunca lê server/.env; ML é fixture.

const assert = require("assert");
const { Pool, Client } = require("pg");

const baseUrl = process.env.SENTINEL_TEST_DATABASE_URL;
if (!baseUrl) throw new Error("Defina SENTINEL_TEST_DATABASE_URL (PostgreSQL local).");
const parsed = new URL(baseUrl);
console.log(`[sentinel.evidencia.postgres] host=${parsed.hostname} port=${parsed.port}`);
if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) throw new Error("LOCAL_DATABASE_REQUIRED");

const dbName = `vf_sentinel_evid_${Date.now()}`;
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${dbName}`;
process.env.DATABASE_URL = testUrl.toString();

const { ensureSentinelSchema, ensureSentinelEvidenciaSchema, evidenciaSchemaPronto } = require("../services/sentinel/sentinelSchema");
const { processarPedido, MARCAR_PACK_INCOMPLETO_EVIDENCIA_SQL } = require("../services/sentinel/sentinelPedidoService");
const { executarCiclo } = require("../services/sentinel/sentinelPollingWorker");
const { relatorioCobertura } = require("../services/sentinel/sentinelEvidenciaCobertura");

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
INSERT INTO custos (base_id, produto_id, custo_produto, imposto_percentual, id_model) VALUES (1, 'MLB400', 50.00, 10, NULL);
`;
const FRETE = { valor: 10, custoSeller: 10, status: "real", receitaComprador: 0, collected: true };
const buscarFrete = async () => FRETE;
const ctx = (contaId, sellerId) => ({ clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: contaId, sellerId, baseId: 1 });
const ped = (id, o = {}, item = {}) => ({
  id, status: "paid", date_created: "2026-11-10T12:00:00.000-03:00", date_last_updated: o.upd || "2026-11-10T12:05:00.000-03:00",
  shipping: { id: id + 5000 }, seller: { id: o.seller || 5551 },
  order_items: [{ item: { id: "MLB400", seller_sku: null, variation_id: null }, quantity: 2, unit_price: 100, sale_fee: 12.5,
    gross_price: 200, discounts: [{ amounts: { full: 0, seller: 0 } }], ...item }],
});
const deps = (pool, o = {}) => ({ db: pool, buscarFrete, cacheCusto: new Map(), observadoEm: "2026-11-17T12:00:00.000Z", ...o });

async function main() {
  const admin = new Pool({ connectionString: baseUrl, ssl: false, max: 1 });
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const pool = new Pool({ connectionString: testUrl.toString(), ssl: false, max: 4 });
  const q = async (sql, p) => (await pool.query(sql, p)).rows;
  try {
    await pool.query(FIXTURE_SQL);
    await ensureSentinelSchema(pool);

    console.log("\n▸ 1. ANTES da migration de evidência: flag ligada não quebra nada e não cria colunas");
    ok("schema de evidência ausente", (await evidenciaSchemaPronto(pool)) === false);
    const r0 = await processarPedido(ctx(10, 5551), ped(1), deps(pool, { evidenciaPromo: true }));
    eq("pedido gravado normalmente (SQL legado)", r0.resultado, "gravado");
    eq("sombra só em memória", [r0.sombra.persistido, r0.sombra.estado], [false, "SEM_DESCONTO"]);
    eq("nenhuma coluna de evidência criada", (await q("SELECT COUNT(*)::int n FROM information_schema.columns WHERE table_name='sentinel_pedidos' AND column_name='calculo_versao'"))[0].n, 0);
    // linhas LEGADAS para provar preservação depois
    await processarPedido(ctx(10, 5551), ped(2), deps(pool, { evidenciaPromo: false }));
    await processarPedido(ctx(10, 5551), ped(3), deps(pool, { evidenciaPromo: false }));
    const antes = await q("SELECT pedido_id, margem_valor, faturamento, payload_hash, calculado_em, updated_at FROM sentinel_pedidos ORDER BY pedido_id");

    console.log("\n▸ 2. migration aditiva e idempotente (aplicada 2×)");
    await ensureSentinelEvidenciaSchema(pool);
    await ensureSentinelEvidenciaSchema(pool);
    ok("colunas presentes", (await evidenciaSchemaPronto(pool, { agora: Date.now() + 1e7 })) === true);
    eq("constraint criada UMA vez", (await q("SELECT COUNT(*)::int n FROM pg_constraint WHERE conname='chk_sentinel_pedidos_evidencia'"))[0].n, 1);
    eq("chave única por conta+pedido preservada", (await q("SELECT COUNT(*)::int n FROM pg_constraint WHERE conname='uq_sentinel_pedidos_conta_pedido'"))[0].n, 1);
    const depois = await q("SELECT pedido_id, margem_valor, faturamento, payload_hash, calculado_em, updated_at FROM sentinel_pedidos ORDER BY pedido_id");
    eq("TODAS as linhas antigas intactas (valores, hash e timestamps)", depois, antes);
    eq("linhas antigas ficam LEGADAS (3 colunas NULL)", (await q("SELECT COUNT(*)::int n FROM sentinel_pedidos WHERE calculo_versao IS NULL AND afirmacao_financeira IS NULL AND evidencia_financeira IS NULL"))[0].n, 3);
    eq("nenhum índice novo", (await q("SELECT COUNT(*)::int n FROM pg_indexes WHERE tablename='sentinel_pedidos'"))[0].n, 3);

    console.log("\n▸ 3. flag ligada + migration: só as colunas novas mudam; margem idêntica à do legado");
    const margemLegado = (await q("SELECT margem_valor, faturamento, comissao, frete, custo, imposto, estado_margem FROM sentinel_pedidos WHERE pedido_id='2'"))[0];
    await processarPedido(ctx(10, 5551), ped(4), deps(pool, { evidenciaPromo: false }));
    const legado4 = (await q("SELECT margem_valor, faturamento, comissao, frete, custo, imposto, estado_margem FROM sentinel_pedidos WHERE pedido_id='4'"))[0];
    eq("(controle) pedido 2 e 4 têm o mesmo cálculo legado", legado4, margemLegado);
    const r5 = await processarPedido(ctx(10, 5551), ped(5), deps(pool, { evidenciaPromo: true }));
    eq("gravado com evidência", [r5.resultado, r5.sombra.persistido], ["gravado", true]);
    const l5 = (await q("SELECT margem_valor, faturamento, comissao, frete, custo, imposto, estado_margem, calculo_versao, afirmacao_financeira, evidencia_financeira FROM sentinel_pedidos WHERE pedido_id='5'"))[0];
    const { calculo_versao, afirmacao_financeira, evidencia_financeira, ...numeros } = l5;
    eq("números oficiais IDÊNTICOS ao do legado", numeros, margemLegado);
    eq("versão/afirmação", [calculo_versao, afirmacao_financeira], [1, "SEM_PREJUIZO"]);
    eq("evidência da conta/pedido corretos", [evidencia_financeira.conta.cliente_conta_id, evidencia_financeira.pedido.id, evidencia_financeira.estado], [10, "5", "SEM_DESCONTO"]);
    ok("JSON compacto (< 1 KB) e sem cópia do pedido do ML", JSON.stringify(evidencia_financeira).length < 1024 && !JSON.stringify(evidencia_financeira).includes("title"));

    console.log("\n▸ 4. idempotência: reprocessar não regrava (nem muda calculado_em), mesmo com observado_em novo");
    const t0 = (await q("SELECT calculado_em, updated_at FROM sentinel_pedidos WHERE pedido_id='5'"))[0];
    const r5b = await processarPedido(ctx(10, 5551), ped(5), deps(pool, { evidenciaPromo: true, observadoEm: "2026-12-01T00:00:00.000Z" }));
    eq("resultado pulado", r5b.resultado, "pulado");
    eq("timestamps intactos", (await q("SELECT calculado_em, updated_at FROM sentinel_pedidos WHERE pedido_id='5'"))[0], t0);

    console.log("\n▸ 5. linha LEGADA reobservada: regrava uma vez, mesmos números, depois pula");
    const m3 = (await q("SELECT margem_valor, faturamento, custo, frete FROM sentinel_pedidos WHERE pedido_id='3'"))[0];
    const r3 = await processarPedido(ctx(10, 5551), ped(3), deps(pool, { evidenciaPromo: true }));
    eq("regravada com evidência", r3.resultado, "gravado");
    eq("números oficiais mantidos", (await q("SELECT margem_valor, faturamento, custo, frete FROM sentinel_pedidos WHERE pedido_id='3'"))[0], m3);
    eq("agora pula", (await processarPedido(ctx(10, 5551), ped(3), deps(pool, { evidenciaPromo: true }))).resultado, "pulado");
    eq("a outra linha legada (pedido 2) continua LEGADA", (await q("SELECT calculo_versao FROM sentinel_pedidos WHERE pedido_id='2'"))[0].calculo_versao, null);

    console.log("\n▸ 6. evidência rica não é trocada por reobservação mais pobre (mesma versão do pedido)");
    const rica = ped(6, {}, { unit_price: 80, gross_price: 200 - 40, discounts: [{ amounts: { full: 20, seller: 10 } }] });
    await processarPedido(ctx(10, 5551), rica, deps(pool, { evidenciaPromo: true }));
    const pobre = ped(6, {}, { unit_price: 80, gross_price: undefined, discounts: undefined });
    const rp = await processarPedido(ctx(10, 5551), pobre, deps(pool, { evidenciaPromo: true }));
    eq("pobre mesma data ⇒ pulado", rp.resultado, "pulado");
    eq("evidência rica mantida (completude 3)", (await q("SELECT evidencia_financeira->>'completude' c FROM sentinel_pedidos WHERE pedido_id='6'"))[0].c, "3");
    const nova = ped(6, { upd: "2026-11-11T09:00:00.000-03:00" }, { unit_price: 80, gross_price: undefined, discounts: undefined });
    eq("data NOVA ⇒ a nova vence (o ML é a verdade)", (await processarPedido(ctx(10, 5551), nova, deps(pool, { evidenciaPromo: true }))).resultado, "gravado");
    eq("… e a evidência agora é a pobre", (await q("SELECT evidencia_financeira->>'completude' c FROM sentinel_pedidos WHERE pedido_id='6'"))[0].c, "0");
    const obsoleta = await processarPedido(ctx(10, 5551), ped(6, { upd: "2026-11-10T00:00:00.000-03:00" }), deps(pool, { evidenciaPromo: true }));
    eq("observação MAIS ANTIGA nunca regride", [obsoleta.resultado, obsoleta.obsoleto], ["inalterado", true]);

    console.log("\n▸ 7. isolamento por conta: mesmo pedido em duas contas, evidências separadas");
    await processarPedido(ctx(20, 5552), ped(7, { seller: 5552 }), deps(pool, { evidenciaPromo: true }));
    await processarPedido(ctx(10, 5551), ped(7), deps(pool, { evidenciaPromo: true }));
    const duas = await q("SELECT cliente_conta_id, evidencia_financeira->'conta'->>'cliente_conta_id' c FROM sentinel_pedidos WHERE pedido_id='7' ORDER BY 1");
    eq("cada linha com a evidência da própria conta", duas.map((x) => [x.cliente_conta_id, x.c]), [[10, "10"], [20, "20"]]);
    const outroSeller = await processarPedido(ctx(10, 5551), ped(8, { seller: 9999 }), deps(pool, { evidenciaPromo: true }));
    eq("pedido de OUTRO seller: gravado como sempre, evidência INCONSISTENTE (sem crédito)", [outroSeller.resultado, outroSeller.sombra.estado], ["gravado", "INCONSISTENTE"]);

    console.log("\n▸ 8. CHECK do banco barra evidência de outra conta/pedido, parcial ou fora do enum");
    const tenta = async (set) => { try { await pool.query(`UPDATE sentinel_pedidos SET ${set} WHERE cliente_conta_id=10 AND pedido_id='5'`); return "aceito"; } catch (e) { return e.code; } };
    eq("evidência de outra conta ⇒ 23514", await tenta(`evidencia_financeira = jsonb_set(evidencia_financeira, '{conta,cliente_conta_id}', '20'::jsonb)`), "23514");
    eq("evidência de outro pedido ⇒ 23514", await tenta(`evidencia_financeira = jsonb_set(evidencia_financeira, '{pedido,id}', '"999"'::jsonb)`), "23514");
    eq("só afirmação sem evidência ⇒ 23514", await tenta(`calculo_versao = NULL`), "23514");
    eq("afirmação fora do enum ⇒ 23514", await tenta(`afirmacao_financeira = 'TALVEZ'`), "23514");
    eq("versão divergente do JSON ⇒ 23514", await tenta(`calculo_versao = 2`), "23514");
    eq("chave de conta ausente no JSON ⇒ 23514 (não passa em silêncio)", await tenta(`evidencia_financeira = evidencia_financeira #- '{conta,cliente_conta_id}'`), "23514");

    console.log("\n▸ 9. pack incompleto: a afirmação das linhas com evidência vira INDETERMINADO; legadas não ganham evidência");
    await pool.query(MARCAR_PACK_INCOMPLETO_EVIDENCIA_SQL, [10, ["5", "2"]]);
    const mk = await q("SELECT pedido_id, afirmacao_financeira, calculo_versao, margem_valor FROM sentinel_pedidos WHERE cliente_conta_id=10 AND pedido_id IN ('5','2') ORDER BY 1");
    eq("pedido 2 (legado) segue sem afirmação; pedido 5 INDETERMINADO; margens NULL", mk.map((x) => [x.pedido_id, x.afirmacao_financeira, x.calculo_versao, x.margem_valor]), [["2", null, null, null], ["5", "INDETERMINADO", 1, null]]);

    console.log("\n▸ 10. relatório de cobertura (SELECT) roda no PG real e respeita os denominadores");
    const rel = await relatorioCobertura(pool, { contaIds: [10] });
    ok("disponível", rel.disponivel === true && rel.contas.length === 1);
    const c = rel.contas[0];
    const totais = (await q("SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE calculo_versao IS NULL)::int l FROM sentinel_pedidos WHERE cliente_conta_id=10"))[0];
    eq("considerados e legados batem com a tabela", [c.pedidos_considerados.n, c.legados.n], [totais.n, totais.l]);
    eq("com_evidencia = considerados − legados", c.com_evidencia.n, totais.n - totais.l);
    eq("todos os com evidência estão NAO_CONCILIADOS", c.nao_conciliados.n, c.com_evidencia.n);
    eq("conta 20 não aparece", rel.contas.some((x) => x.cliente_conta_id === 20), false);
    const rel20 = await relatorioCobertura(pool, { contaIds: [20] });
    eq("conta 20 isolada: 1 pedido, 1 com evidência", [rel20.contas[0].pedidos_considerados.n, rel20.contas[0].com_evidencia.n], [1, 1]);

    console.log("\n▸ 10b. pack (envio compartilhado) com evidência: atômico, irmão legado atualizado, sem regravação infinita");
    const pk = (id, o = {}) => ({ ...ped(id), shipping: { id: 9100 }, ...o });
    const freteShip = async () => ({ valor: 30, custoSeller: 30, status: "real", receitaComprador: 0, collected: true });
    const envioDe = (...pedidos) => ({ conhecidos: new Map(pedidos.map((p) => [String(p.id), p])), cachePack: new Map(), cachePedidos: new Map(), cacheFrete: new Map(), fetchPack: async () => null, fetchOrder: async () => null });
    const A = pk(41); const B = pk(42);
    // B entra ANTES da flag (legado); depois A com a flag: o irmão B deve ser regravado COM evidência, no mesmo grupo
    await processarPedido(ctx(10, 5551), B, deps(pool, { evidenciaPromo: false, buscarFrete: freteShip, envio: envioDe(B) }));
    eq("B nasceu legado", (await q("SELECT calculo_versao FROM sentinel_pedidos WHERE pedido_id='42'"))[0].calculo_versao, null);
    const rA = await processarPedido(ctx(10, 5551), A, deps(pool, { evidenciaPromo: true, buscarFrete: freteShip, envio: envioDe(A, B) }));
    eq("A gravado", rA.resultado, "gravado");
    const par = await q("SELECT pedido_id, calculo_versao, frete, margem_valor FROM sentinel_pedidos WHERE pedido_id IN ('41','42') ORDER BY 1");
    eq("A e B com evidência (v1) e frete rateado (15+15)", par.map((x) => [x.pedido_id, x.calculo_versao, Number(x.frete)]), [["41", 1, 15], ["42", 1, 15]]);
    const tsPar = await q("SELECT pedido_id, calculado_em, updated_at FROM sentinel_pedidos WHERE pedido_id IN ('41','42') ORDER BY 1");
    const rA2 = await processarPedido(ctx(10, 5551), A, deps(pool, { evidenciaPromo: true, buscarFrete: freteShip, envio: envioDe(A, B) }));
    const rB2 = await processarPedido(ctx(10, 5551), B, deps(pool, { evidenciaPromo: true, buscarFrete: freteShip, envio: envioDe(A, B) }));
    eq("reprocessar o grupo: ambos pulados (hash do irmão bate)", [rA2.resultado, rB2.resultado, rA2.irmaosCorrigidos || false], ["pulado", "pulado", false]);
    eq("nenhuma regravação (timestamps intactos)", await q("SELECT pedido_id, calculado_em, updated_at FROM sentinel_pedidos WHERE pedido_id IN ('41','42') ORDER BY 1"), tsPar);
    // B cancela: A passa a levar o shipment inteiro e é regravado junto, ainda com evidência íntegra
    const Bc = pk(42, { status: "cancelled", date_last_updated: "2026-11-12T10:00:00.000-03:00" });
    await processarPedido(ctx(10, 5551), Bc, deps(pool, { evidenciaPromo: true, buscarFrete: freteShip, envio: envioDe(A, Bc) }));
    const apos = await q("SELECT pedido_id, status_ml, calculo_versao, afirmacao_financeira, frete FROM sentinel_pedidos WHERE pedido_id IN ('41','42') ORDER BY 1");
    eq("A leva o frete cheio (30), B cancelado NAO_APLICAVEL; ambos com evidência", apos.map((x) => [x.pedido_id, x.status_ml, x.calculo_versao, x.afirmacao_financeira, Number(x.frete)]),
      [["41", "paid", 1, "SEM_PREJUIZO", 30], ["42", "cancelled", 1, "NAO_APLICAVEL", 0]]);

    console.log("\n▸ 10c. ciclo REAL do worker: flag ligada + migration ≡ flag desligada (checkpoint, resultados e chamadas ao ML)");
    const H = 3600 * 1000;
    const agora = Date.now();
    const iso = (m) => new Date(m).toISOString();
    const criarClient = () => new Client({ connectionString: testUrl.toString(), ssl: false });
    const cfgBase = { overlapMs: 2 * H, maxTentativas: 3, cicloMaxMs: 60000, maxChamadasPorConta: 500 };
    const fx = (seller, base) => [
      { ...ped(base + 1, { seller }), date_last_updated: iso(agora - H), date_created: iso(agora - 3 * H) },
      { ...ped(base + 2, { seller }, { gross_price: undefined, discounts: undefined }), date_last_updated: iso(agora - 2 * H), date_created: iso(agora - 3 * H) },
      { ...ped(base + 3, { seller }, { gross_price: 999 }), date_last_updated: iso(agora - 90 * 60 * 1000), date_created: iso(agora - 3 * H) },
    ];
    const mlBase = (pedidos) => {
      const log = [];
      const fn = async (_c, p, o = {}) => {
        log.push(p);
        if (p.startsWith("/shipments/")) return { ok: true, status: 200, data: { senders: [{ user_id: o.mlUserId, cost: 10 }], receiver: { cost: 0 } } };
        if (p.startsWith("/orders/search")) {
          const qs = new URLSearchParams(p.split("?")[1]);
          const from = Date.parse(qs.get("order.date_last_updated.from").replace("-00:00", "Z"));
          const to = Date.parse(qs.get("order.date_last_updated.to").replace("-00:00", "Z"));
          const dentro = pedidos.filter((x) => Date.parse(x.date_last_updated) >= from && Date.parse(x.date_last_updated) <= to);
          return { ok: true, status: 200, data: { paging: { total: dentro.length }, results: dentro.slice(Number(qs.get("offset")), Number(qs.get("offset")) + 50) } };
        }
        return { ok: false, status: 404, data: null };
      };
      fn.log = log;
      return fn;
    };
    const ctxFn = (c, sl) => async () => ({ clienteId: 1, clienteSlug: "cliente-teste", clienteContaId: c, sellerId: sl, baseId: 1 });
    const setCp = (id, m) => pool.query("INSERT INTO sentinel_checkpoints (cliente_conta_id, ultimo_date_last_updated) VALUES ($1,$2) ON CONFLICT (cliente_conta_id) DO UPDATE SET ultimo_date_last_updated = EXCLUDED.ultimo_date_last_updated", [id, iso(m)]);
    await ensureSentinelEvidenciaSchema(pool); // o passo 10 anterior não derrubou: o rollback só vem no 11
    const run = async (conta, sellerNum, base, flag) => {
      const ml = mlBase(fx(sellerNum, base));
      await setCp(conta, agora - 4 * H);
      process.env.SENTINEL_EVIDENCIA_PROMO_ENABLED = flag ? "1" : "0";
      try {
        const c = await executarCiclo({ contaIds: [conta], criarClient, db: pool, nowMs: agora, resolverConta: ctxFn(conta, String(sellerNum)), mlFetchBase: ml, config: cfgBase });
        const cpv = (await q("SELECT ultimo_date_last_updated, ultimo_erro, pedidos_processados_ultima FROM sentinel_checkpoints WHERE cliente_conta_id=$1", [conta]))[0];
        return { c: c.contas[0], cp: cpv, chamadas: ml.log.length };
      } finally { delete process.env.SENTINEL_EVIDENCIA_PROMO_ENABLED; }
    };
    // contas LIMPAS (o passo 9 deixou pedidos provisórios na conta 10, que o worker reprocessaria por GET /orders/:id)
    await pool.query("INSERT INTO cliente_contas VALUES (30, 1, 'meli', 'Conta C', 'conta-c', '5553', false, true), (40, 1, 'meli', 'Conta D', 'conta-d', '5554', false, true)");
    const off = await run(30, 5553, 7100, false);
    const on = await run(40, 5554, 7200, true);
    eq("ciclo sem erro nas duas", [off.c.erro, on.c.erro], [null, null]);
    eq("mesmos resultados por pedido", on.c.porResultado, off.c.porResultado);
    eq("checkpoint avançou IGUAL (mesma data, mesmo nº processado)", [new Date(on.cp.ultimo_date_last_updated).getTime(), on.cp.pedidos_processados_ultima, on.cp.ultimo_erro],
      [new Date(off.cp.ultimo_date_last_updated).getTime(), off.cp.pedidos_processados_ultima, off.cp.ultimo_erro]);
    eq("MESMO número de chamadas ao ML (nenhuma nova)", on.chamadas, off.chamadas);
    const numerosCiclo = (conta, base) => q(`SELECT (pedido_id::bigint - ${base})::int AS k, faturamento, comissao, frete, custo, imposto, margem_valor, estado_margem FROM sentinel_pedidos WHERE cliente_conta_id=$1 AND pedido_id::bigint BETWEEN ${base} AND ${base + 9} ORDER BY 1`, [conta]);
    eq("números oficiais dos 3 pedidos idênticos entre as contas", await numerosCiclo(40, 7200), await numerosCiclo(30, 7100));
    const ev = await q("SELECT pedido_id::bigint - 7200 AS k, evidencia_financeira->>'estado' e, afirmacao_financeira a FROM sentinel_pedidos WHERE cliente_conta_id=40 AND pedido_id::bigint BETWEEN 7200 AND 7209 ORDER BY 1");
    eq("evidência: completo/ausente/inconsistente — todos coletados", ev.map((x) => [Number(x.k), x.e]), [[1, "SEM_DESCONTO"], [2, "NAO_DETERMINADO"], [3, "INCONSISTENTE"]]);
    eq("conta sem flag: nenhuma evidência", (await q("SELECT COUNT(*)::int n FROM sentinel_pedidos WHERE cliente_conta_id=30 AND pedido_id::bigint BETWEEN 7100 AND 7109 AND calculo_versao IS NOT NULL"))[0].n, 0);
    eq("nenhuma exceção/quarentena criada", (await q("SELECT COUNT(*)::int n FROM sentinel_pedido_excecoes WHERE cliente_conta_id IN (30,40)"))[0].n, 0);

    console.log("\n▸ 11. rollback manual documentado funciona e as linhas seguem legíveis");
    await pool.query("ALTER TABLE sentinel_pedidos DROP CONSTRAINT IF EXISTS chk_sentinel_pedidos_evidencia");
    await pool.query("ALTER TABLE sentinel_pedidos DROP COLUMN IF EXISTS evidencia_financeira, DROP COLUMN IF EXISTS afirmacao_financeira, DROP COLUMN IF EXISTS calculo_versao");
    // O cache de schema ainda diz "presente": o 1º pedido bate em 42703, reavalia e refaz no SQL legado (sem exceção/quarentena).
    const rRb = await processarPedido(ctx(10, 5551), ped(9), deps(pool, { evidenciaPromo: true }));
    eq("rollback com o worker no ar: pedido gravado no legado (não virou erro)", [rRb.resultado, (await q("SELECT COUNT(*)::int n FROM sentinel_pedido_excecoes"))[0].n], ["gravado", 0]);
    ok("schema reavaliado: ausente", (await evidenciaSchemaPronto(pool)) === false);
    eq("linhas seguem legíveis", (await q("SELECT COUNT(*)::int n FROM sentinel_pedidos WHERE cliente_conta_id=10 AND margem_valor IS NOT NULL"))[0].n >= 4, true);

    console.log(`\n✓ sentinelEvidencia.postgres: ${checks} verificações`);
  } finally {
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
