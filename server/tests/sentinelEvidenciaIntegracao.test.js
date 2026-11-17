// Integração da evidência financeira ao processamento do Sentinel — MODO SOMBRA (banco simulado, sem rede).
//
// Prova, sem PostgreSQL: flag desligada = comportamento byte-idêntico ao anterior; flag ligada sem a migration
// = coleta normal (nada persistido, nada quebra); flag ligada com a migration = só as colunas novas mudam.
// A persistência REAL fica em tests/sentinelEvidencia.postgres.cjs (PG local, fora do run-all).
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calcularPedido, calcularPayloadHash, processarPedido, evidenciaPromoAtiva, UPSERT_SQL, UPSERT_EVIDENCIA_SQL, _linhasDosIrmaos,
} = require("../services/sentinel/sentinelPedidoService");
const { construirIndiceCusto } = require("../services/sentinel/sentinelCusto");
const { evidenciaSchemaPronto, EVIDENCIA_COLUNAS } = require("../services/sentinel/sentinelSchema");
const { classificarPedido } = require("../services/sentinel/sentinelClassificacao");

// Hash/forma de uma linha calculada pelo código ANTERIOR à evidência (capturado no HEAD, antes de qualquer mudança).
const GOLDEN = {
  hash: "13b01e6dfad547f31a43e57f53cc47eb38e0d5d6ea5d0d003a14aab89c4b935d",
  keys: ["claims_verificado", "comissao", "competencia", "custo", "data_pedido", "estado_margem", "faturamento", "frete", "imposto",
    "itens", "margem_pct", "margem_valor", "ml_date_last_updated", "payload_hash", "pedido_id", "pendencias", "status_ml"],
};

const INDICE = construirIndiceCusto([
  { produto_id: "MLB100", custo_produto: 60, imposto_percentual: 6, id_model: "", sku: "A" },
  { produto_id: "MLB200", custo_produto: 20, imposto_percentual: 6, id_model: "", sku: "B" },
]);
const FRETE = { valor: 10, custoSeller: 10, status: "real", receitaComprador: 0, collected: true };
const OBS = "2026-11-17T12:00:00.000Z";

const oi = (o = {}) => ({ item: { id: "MLB100", seller_sku: "A" }, quantity: 1, unit_price: 100, sale_fee: 14, gross_price: 100, discounts: [{ amounts: { full: 0, seller: 0 } }], ...o });
const order = (extra = {}, itens) => ({
  id: 1001, status: "paid", date_created: "2026-11-10T12:00:00.000-03:00", date_last_updated: "2026-11-10T12:05:00.000-03:00",
  shipping: { id: 9001 }, seller: { id: 555 }, order_items: itens || [oi()], ...extra,
});
const conta = (o = {}) => ({ clienteId: 3, clienteContaId: 7, clienteSlug: "x", sellerId: 555, baseId: 1, ...o });

// Banco simulado: responde só ao que o serviço pergunta e MEMORIZA a última gravação (para provar idempotência).
function fakeDb({ row = null, schemaOk = true } = {}) {
  const st = { row, upserts: [], consultasSchema: 0, sqls: [] };
  return {
    st,
    async query(sql, params) {
      st.sqls.push(sql);
      if (/information_schema\.columns/.test(sql)) {
        st.consultasSchema += 1;
        return { rows: schemaOk ? EVIDENCIA_COLUNAS.map((c) => ({ column_name: c })) : [] };
      }
      if (/FROM sentinel_pedidos\s+WHERE cliente_conta_id = \$1 AND pedido_id = \$2/.test(sql)) return { rows: st.row ? [st.row] : [] };
      if (/INSERT INTO sentinel_pedidos/.test(sql) && /ON CONFLICT \(cliente_conta_id, pedido_id\) DO UPDATE/.test(sql)) {
        st.upserts.push({ sql, params });
        const comEv = params.length > 19;
        st.row = {
          ml_date_last_updated: params[5], estado_margem: params[15], frete: params[10], payload_hash: params[18],
          calculo_versao: comEv ? params[19] : (st.row?.calculo_versao ?? null),
          afirmacao_financeira: comEv ? params[20] : (st.row?.afirmacao_financeira ?? null),
          evidencia_financeira: comEv ? JSON.parse(params[21]) : (st.row?.evidencia_financeira ?? null),
        };
        return { rowCount: 1, rows: [{ id: 1 }] };
      }
      throw new Error(`query inesperada: ${sql.slice(0, 90)}`);
    },
  };
}
const depsBase = (db, o = {}) => {
  const chamadas = { frete: 0 };
  return { chamadas, db, cacheCusto: new Map([[1, INDICE]]), buscarFrete: async () => { chamadas.frete += 1; return FRETE; }, observadoEm: OBS, ...o };
};
const semWarn = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };
const NUCLEO = ["faturamento", "comissao", "frete", "custo", "imposto", "margem_valor", "margem_pct", "estado_margem", "pendencias", "itens", "status_ml"];
const nucleoDe = (p) => NUCLEO.map((i) => p[{ faturamento: 8, comissao: 9, frete: 10, custo: 11, imposto: 12, margem_valor: 13, margem_pct: 14, estado_margem: 15, pendencias: 16, itens: 7, status_ml: 6 }[i]]);

// ───────────────────────── 1. flag desligada = comportamento anterior ─────────────────────────
test("I1 sem o argumento de evidência, calcularPedido é byte-idêntico ao código anterior (hash, chaves, margem)", () => {
  const l = calcularPedido({ order: order(), freteEntry: FRETE, indiceCusto: INDICE, clienteSlug: "x" });
  assert.equal(l.payload_hash, GOLDEN.hash);
  assert.deepEqual(Object.keys(l).sort(), GOLDEN.keys);
  assert.equal(l.margem_valor, 10);
  assert.equal(l.estado_margem, "confirmada");
});

test("I1 calcularPayloadHash ignora colunas de evidência quando calculo_versao é nulo (legado)", () => {
  const l = calcularPedido({ order: order(), freteEntry: FRETE, indiceCusto: INDICE, clienteSlug: "x" });
  assert.equal(calcularPayloadHash({ ...l, calculo_versao: null, afirmacao_financeira: "CATEGORICO", evidencia_financeira: { v: 1 } }), GOLDEN.hash);
});

test("I2 processarPedido com a flag desligada: SQL legado, 19 parâmetros, nenhuma consulta extra, sem 'sombra'", async () => {
  const db = fakeDb();
  const r = await processarPedido(conta(), order(), depsBase(db, { evidenciaPromo: false }));
  assert.equal(r.resultado, "gravado");
  assert.equal(db.st.consultasSchema, 0);
  assert.equal(db.st.upserts.length, 1);
  assert.equal(db.st.upserts[0].sql, UPSERT_SQL);
  assert.equal(db.st.upserts[0].params.length, 19);
  assert.equal(db.st.upserts[0].params[18], GOLDEN.hash);
  assert.equal("sombra" in r, false);
  assert.equal(db.st.sqls.some((s) => /calculo_versao|evidencia_financeira/.test(s)), false);
});

test("I2 a flag lê SENTINEL_EVIDENCIA_PROMO_ENABLED: desligada por padrão; só true|1|on|yes ligam", () => {
  assert.equal(evidenciaPromoAtiva({}), false);
  for (const v of ["", "false", "0", "off", "talvez", undefined]) assert.equal(evidenciaPromoAtiva({ SENTINEL_EVIDENCIA_PROMO_ENABLED: v }), false, String(v));
  for (const v of ["true", "1", "on", "yes", "TRUE"]) assert.equal(evidenciaPromoAtiva({ SENTINEL_EVIDENCIA_PROMO_ENABLED: v }), true, v);
});

// ───────────────────────── 2. flag ligada, migration AUSENTE ─────────────────────────
test("I3 flag ligada + migration ausente: coleta normal, SQL legado, hash legado, evidência só em memória (sombra)", async () => {
  const db = fakeDb({ schemaOk: false });
  const r = await processarPedido(conta(), order(), depsBase(db, { evidenciaPromo: true }));
  assert.equal(r.resultado, "gravado");
  assert.equal(db.st.upserts[0].sql, UPSERT_SQL);
  assert.equal(db.st.upserts[0].params.length, 19);
  assert.equal(db.st.upserts[0].params[18], GOLDEN.hash);
  assert.equal(r.sombra.persistido, false);
  assert.equal(r.sombra.afirmacao_se_prejuizo, undefined);
  assert.equal(r.sombra.estado, "SEM_DESCONTO");
  assert.equal(db.st.sqls.some((s) => /evidencia_financeira/.test(s)), false);
});

test("I3 a ausência da migration é consultada UMA vez dentro do TTL (sem consulta por pedido)", async () => {
  const db = fakeDb({ schemaOk: false });
  const d = depsBase(db, { evidenciaPromo: true });
  for (let i = 0; i < 5; i += 1) await processarPedido(conta(), order({ id: 2000 + i }), d);
  assert.equal(db.st.consultasSchema, 1);
});

test("I3 evidenciaSchemaPronto: ausente é reavaliada após o TTL; presente fica em cache", async () => {
  const db = fakeDb({ schemaOk: false });
  assert.equal(await evidenciaSchemaPronto(db, { agora: 1000, ttlMs: 60000 }), false);
  assert.equal(await evidenciaSchemaPronto(db, { agora: 30000, ttlMs: 60000 }), false);
  assert.equal(db.st.consultasSchema, 1);
  assert.equal(await evidenciaSchemaPronto(db, { agora: 70000, ttlMs: 60000 }), false);
  assert.equal(db.st.consultasSchema, 2);
  const ok = fakeDb({ schemaOk: true });
  assert.equal(await evidenciaSchemaPronto(ok, { agora: 1 }), true);
  assert.equal(await evidenciaSchemaPronto(ok, { agora: 9e9 }), true);
  assert.equal(ok.st.consultasSchema, 1);
});

test("I3 falha na consulta do schema NUNCA derruba a coleta (cai no legado)", async () => {
  const db = fakeDb();
  const orig = db.query.bind(db);
  db.query = async (sql, p) => { if (/information_schema/.test(sql)) throw new Error("conexão caiu"); return orig(sql, p); };
  const r = await semWarn(() => processarPedido(conta(), order(), depsBase(db, { evidenciaPromo: true })));
  assert.equal(r.resultado, "gravado");
  assert.equal(db.st.upserts[0].params.length, 19);
});

// ───────────────────────── 3. flag ligada, migration presente ─────────────────────────
test("I4 flag ligada + migration: margem e demais números IDÊNTICOS; só calculo_versao/afirmacao/evidência são novos", async () => {
  const dOff = fakeDb();
  const dOn = fakeDb();
  await processarPedido(conta(), order(), depsBase(dOff, { evidenciaPromo: false }));
  await processarPedido(conta(), order(), depsBase(dOn, { evidenciaPromo: true }));
  const off = dOff.st.upserts[0].params;
  const on = dOn.st.upserts[0].params;
  assert.deepEqual(nucleoDe(on), nucleoDe(off));
  assert.equal(dOn.st.upserts[0].sql, UPSERT_EVIDENCIA_SQL);
  assert.equal(on.length, 22);
  assert.equal(on[19], 1);
  assert.equal(on[20], "SEM_PREJUIZO"); // m = 10 ≥ 0
  const ev = JSON.parse(on[21]);
  assert.equal(ev.v, 1);
  assert.equal(ev.conta.cliente_conta_id, 7);
  assert.equal(ev.pedido.id, "1001");
  assert.equal(ev.observado_em, OBS);
  assert.notEqual(on[18], off[18]); // o hash passa a cobrir a evidência
});

test("I4 a classificação oficial do pedido não muda com a flag ligada (sombra)", () => {
  const sem = calcularPedido({ order: order(), freteEntry: FRETE, indiceCusto: INDICE, clienteSlug: "x" });
  const com = calcularPedido({ order: order(), freteEntry: FRETE, indiceCusto: INDICE, clienteSlug: "x",
    evidencia: { persistir: true, clienteContaId: 7, sellerId: 555, observadoEm: OBS } });
  assert.deepEqual(classificarPedido(com), classificarPedido(sem));
  for (const k of NUCLEO) assert.deepEqual(com[k], sem[k], k);
});

test("I4 prejuízo real: margem negativa fica IGUAL e a afirmação é registrada à parte", async () => {
  const db = fakeDb();
  const pre = order({}, [oi({ unit_price: 70, gross_price: 100, discounts: [{ amounts: { full: 30, seller: 10 } }], sale_fee: 14 })]);
  const r = await processarPedido(conta(), pre, depsBase(db, { evidenciaPromo: true }));
  const p = db.st.upserts[0].params;
  assert.equal(p[13] < 0, true); // margem do motor (sem crédito algum)
  assert.equal(r.resultado, "gravado");
  assert.equal(p[20], "OBSERVACAO"); // 20/un de crédito potencial cobre o prejuízo
  assert.equal(JSON.parse(p[21]).credito_max_pedido, 2000);
  // mesma margem que sem a flag:
  const off = fakeDb();
  await processarPedido(conta(), pre, depsBase(off, { evidenciaPromo: false }));
  assert.equal(off.st.upserts[0].params[13], p[13]);
});

test("I5 idempotência: reprocessar o MESMO pedido (mesmo ml_date) não regrava, mesmo com observado_em diferente", async () => {
  const db = fakeDb();
  await processarPedido(conta(), order(), depsBase(db, { evidenciaPromo: true }));
  for (const obs of ["2026-11-18T00:00:00.000Z", "2026-11-19T00:00:00.000Z"]) {
    const r = await processarPedido(conta(), order(), depsBase(db, { evidenciaPromo: true, observadoEm: obs }));
    assert.equal(r.resultado, "pulado");
  }
  assert.equal(db.st.upserts.length, 1);
});

test("I5 o JSON persistido não cresce com o reprocessamento (mesmo tamanho após regravações forçadas)", async () => {
  const db = fakeDb();
  const d = depsBase(db, { evidenciaPromo: true, forcar: true });
  await processarPedido(conta(), order(), d);
  const t1 = db.st.upserts[0].params[21].length;
  await processarPedido(conta(), order({ date_last_updated: "2026-11-11T00:00:00.000-03:00" }), d);
  await processarPedido(conta(), order({ date_last_updated: "2026-11-12T00:00:00.000-03:00" }), d);
  const tamanhos = db.st.upserts.map((u) => u.params[21].length);
  assert.ok(tamanhos.every((t) => Math.abs(t - t1) < 20), tamanhos.join(","));
});

test("I6 mesma versão do pedido reobservada mais POBRE: evidência rica é preservada, afirmação recomputada, sem regravar", async () => {
  const db = fakeDb();
  const rica = order({}, [oi({ unit_price: 80, gross_price: 100, discounts: [{ amounts: { full: 20, seller: 10 } }] })]);
  await processarPedido(conta(), rica, depsBase(db, { evidenciaPromo: true }));
  const pobre = order({}, [oi({ unit_price: 80, gross_price: undefined, discounts: undefined })]);
  const r = await processarPedido(conta(), pobre, depsBase(db, { evidenciaPromo: true }));
  assert.equal(r.resultado, "pulado");
  assert.equal(db.st.upserts.length, 1);
  assert.equal(db.st.row.evidencia_financeira.completude, 3);
});

test("I6 data NOVA do pedido com evidência mais pobre: a nova vence (o ML é a verdade)", async () => {
  const db = fakeDb();
  const rica = order({}, [oi({ unit_price: 80, gross_price: 100, discounts: [{ amounts: { full: 20, seller: 10 } }] })]);
  await processarPedido(conta(), rica, depsBase(db, { evidenciaPromo: true }));
  const nova = order({ date_last_updated: "2026-11-11T09:00:00.000-03:00" }, [oi({ unit_price: 80, gross_price: undefined, discounts: undefined })]);
  const r = await processarPedido(conta(), nova, depsBase(db, { evidenciaPromo: true }));
  assert.equal(r.resultado, "gravado");
  assert.equal(db.st.row.evidencia_financeira.completude ?? 0, 0);
});

test("I7 linha LEGADA (sem evidência) reobservada: regrava UMA vez com os mesmos números e depois pula", async () => {
  const db = fakeDb({ row: { ml_date_last_updated: "2026-11-10T12:05:00.000-03:00", estado_margem: "confirmada", frete: 10, payload_hash: GOLDEN.hash, calculo_versao: null, evidencia_financeira: null } });
  const legado = nucleoDe(calcularLinhaParams(order()));
  const r1 = await processarPedido(conta(), order(), depsBase(db, { evidenciaPromo: true }));
  assert.equal(r1.resultado, "gravado");
  assert.deepEqual(nucleoDe(db.st.upserts[0].params), legado); // números oficiais idênticos aos que o legado calcularia
  const r2 = await processarPedido(conta(), order(), depsBase(db, { evidenciaPromo: true }));
  assert.equal(r2.resultado, "pulado");
});
function calcularLinhaParams(o) {
  const l = calcularPedido({ order: o, freteEntry: FRETE, indiceCusto: INDICE, clienteSlug: "x" });
  const p = []; p[6] = l.status_ml; p[7] = JSON.stringify(l.itens); p[8] = l.faturamento; p[9] = l.comissao; p[10] = l.frete; p[11] = l.custo;
  p[12] = l.imposto; p[13] = l.margem_valor; p[14] = l.margem_pct; p[15] = l.estado_margem; p[16] = JSON.stringify(l.pendencias); return p;
}

test("I7 o legado puro (flag desligada) continua pulando quando nada mudou", async () => {
  const db = fakeDb({ row: { ml_date_last_updated: "2026-11-10T12:05:00.000-03:00", estado_margem: "confirmada", frete: 10, payload_hash: GOLDEN.hash } });
  const r = await processarPedido(conta(), order(), depsBase(db, { evidenciaPromo: false }));
  assert.equal(r.resultado, "pulado");
  assert.equal(db.st.upserts.length, 0);
});

// ───────────────────────── 4. falhas isoladas, contas, ML ─────────────────────────
test("I8 extrator que lança: coleta segue; grava evidência mínima 'falha_extracao' (sem crédito) e a margem é a mesma", async () => {
  const db = fakeDb();
  const r = await semWarn(() => processarPedido(conta(), order(), depsBase(db, { evidenciaPromo: true, evidenciaExtrator: () => { throw new Error("bug"); } })));
  assert.equal(r.resultado, "gravado");
  const ev = JSON.parse(db.st.upserts[0].params[21]);
  assert.deepEqual(ev.motivos, ["falha_extracao"]);
  assert.equal(ev.credito_max_pedido, undefined);
  assert.equal(db.st.upserts[0].params[13], 10);
});

test("I8 evidência de OUTRA conta/pedido nunca é anexada (guarda final): grava no legado", async () => {
  const db = fakeDb();
  const mistura = (o, ctx) => ({ ...require("../services/sentinel/sentinelEvidenciaFinanceira").extrairEvidencia(o, ctx), conta: { cliente_conta_id: 99, seller_id: "555" } });
  const r = await semWarn(() => processarPedido(conta(), order(), depsBase(db, { evidenciaPromo: true, evidenciaExtrator: mistura })));
  assert.equal(r.resultado, "gravado");
  assert.equal(db.st.upserts[0].sql, UPSERT_SQL);
  assert.equal(db.st.upserts[0].params.length, 19);
});

test("I9 duas contas, mesmo pedido: cada gravação leva só a evidência da PRÓPRIA conta; previa de outra conta é ignorada", async () => {
  const dbA = fakeDb();
  const dbB = fakeDb();
  const rica = order({}, [oi({ unit_price: 80, gross_price: 100, discounts: [{ amounts: { full: 20, seller: 10 } }] })]);
  await processarPedido(conta({ clienteContaId: 7 }), rica, depsBase(dbA, { evidenciaPromo: true }));
  // conta B já tem uma linha com evidência rica de OUTRA conta (corrompida): não pode ser reaproveitada
  dbB.st.row = { ml_date_last_updated: "2026-11-10T12:05:00.000-03:00", estado_margem: "confirmada", frete: 10, payload_hash: "x", calculo_versao: 1, evidencia_financeira: dbA.st.row.evidencia_financeira };
  const pobre = order({}, [oi({ unit_price: 80, gross_price: undefined, discounts: undefined })]);
  await processarPedido(conta({ clienteContaId: 8, sellerId: 555 }), pobre, depsBase(dbB, { evidenciaPromo: true }));
  const evB = JSON.parse(dbB.st.upserts[0].params[21]);
  assert.equal(evB.conta.cliente_conta_id, 8);
  assert.equal(evB.completude ?? 0, 0);
  assert.equal(JSON.parse(dbA.st.upserts[0].params[21]).conta.cliente_conta_id, 7);
});

test("I10 nenhuma chamada nova ao ML: mesmas chamadas de frete com a flag ligada ou desligada; sem fetch de descontos", async () => {
  const chamadas = { off: 0, on: 0 };
  for (let i = 0; i < 3; i += 1) {
    // um banco por pedido: o simulado guarda 1 linha só, o que faria o frete ser reaproveitado entre pedidos
    await processarPedido(conta(), order({ id: 3000 + i }), depsBase(fakeDb(), { evidenciaPromo: false, buscarFrete: async () => { chamadas.off += 1; return FRETE; } }));
    await processarPedido(conta(), order({ id: 3000 + i }), depsBase(fakeDb(), { evidenciaPromo: true, buscarFrete: async () => { chamadas.on += 1; return FRETE; } }));
  }
  assert.equal(chamadas.on, chamadas.off);
  assert.equal(chamadas.on, 3);
  const src = require("fs").readFileSync(require.resolve("../services/sentinel/sentinelEvidenciaFinanceira"), "utf8");
  assert.equal(/mlFetch|fetch\(|https?:\/\/api\.mercadoli/i.test(src.replace(/\/\/.*$/gm, "")), false); // o módulo é puro: sem rede
});

test("I11 falha de escrita no banco segue o protocolo de exceção de sempre (resultado erro) e não corrompe o estado", async () => {
  const db = fakeDb();
  const orig = db.query.bind(db);
  db.query = async (sql, p) => { if (/DO UPDATE/.test(sql)) throw new Error("disco cheio"); return orig(sql, p); };
  const r = await processarPedido(conta(), order(), depsBase(db, { evidenciaPromo: true }));
  assert.equal(r.resultado, "erro");
  assert.match(r.erro, /disco cheio/);
});

test("I12 INSERT do estado erro e SQL legado não tocam as colunas novas; UPSERT de evidência tem a MESMA monotonicidade", () => {
  const where = (sql) => sql.slice(sql.indexOf("WHERE (sentinel_pedidos.ml_date_last_updated IS NULL"), sql.indexOf("RETURNING id")).replace(/\s+/g, " ");
  assert.ok(where(UPSERT_SQL).length > 100);
  assert.equal(where(UPSERT_EVIDENCIA_SQL), where(UPSERT_SQL));
  assert.equal(/calculo_versao|afirmacao_financeira|evidencia_financeira/.test(UPSERT_SQL), false);
  for (const col of ["calculo_versao", "afirmacao_financeira", "evidencia_financeira"]) assert.ok(UPSERT_EVIDENCIA_SQL.includes(`${col} = EXCLUDED.${col}`), col);
  assert.ok(UPSERT_EVIDENCIA_SQL.includes("ON CONFLICT (cliente_conta_id, pedido_id) DO UPDATE"));
});

test("I13 packs: o irmão recalculado com evidência produz o MESMO hash da gravação anterior (sem regravação infinita)", async () => {
  const irmao = order({ id: 1002 });
  const gravado = calcularPedido({ order: irmao, freteEntry: FRETE, indiceCusto: INDICE, clienteSlug: "x", grupoEnvio: [order(), irmao],
    evidencia: { persistir: true, clienteContaId: 7, sellerId: 555, observadoEm: "2026-11-01T00:00:00.000Z" } });
  const db = { async query() { return { rows: [{ pedido_id: "1002", payload_hash: gravado.payload_hash, calculo_versao: 1, evidencia_financeira: JSON.parse(JSON.stringify(gravado.evidencia_financeira)) }] }; } };
  const r = await _linhasDosIrmaos({ db, contaCtx: conta(), order: order(), envio: { pedidos: [order(), irmao] }, freteEntry: FRETE, indiceCusto: INDICE,
    evidencia: { persistir: true, clienteContaId: 7, sellerId: 555, observadoEm: OBS } });
  assert.equal(r.length, 1);
  assert.equal(r[0].linha.payload_hash, r[0].hashGravado);
});

// ───────────────────────── 5. rollback da migration com o worker no ar ─────────────────────────
test("I14 colunas somem DEPOIS do cache 'presente' (rollback manual): cai no SQL legado na hora e reavalia o schema", async () => {
  const db = fakeDb();
  const orig = db.query.bind(db);
  let colunasExistem = true;
  db.query = async (sql, p) => {
    if (/information_schema\.columns/.test(sql)) { db.st.consultasSchema += 1; return { rows: colunasExistem ? EVIDENCIA_COLUNAS.map((c) => ({ column_name: c })) : [] }; }
    if (!colunasExistem && /calculo_versao|evidencia_financeira/.test(sql)) { const e = new Error('column "calculo_versao" does not exist'); e.code = "42703"; throw e; }
    return orig(sql, p);
  };
  const d = depsBase(db, { evidenciaPromo: true });
  const r1 = await processarPedido(conta(), order({ id: 5001 }), d);
  assert.equal(r1.sombra.persistido, true);
  colunasExistem = false; // rollback manual
  const r2 = await semWarn(() => processarPedido(conta(), order({ id: 5002 }), d));
  assert.equal(r2.resultado, "gravado"); // não virou exceção/quarentena
  assert.equal(db.st.upserts.at(-1).params.length, 19);
  assert.equal(db.st.upserts.at(-1).sql, UPSERT_SQL);
  const consultas = db.st.consultasSchema;
  const r3 = await semWarn(() => processarPedido(conta(), order({ id: 5003 }), d));
  assert.equal(r3.sombra.persistido, false); // schema reavaliado: ausente
  assert.ok(db.st.consultasSchema > consultas);
});

test("I14 erro de banco que NÃO é de coluna ausente continua sendo erro (sem mascarar falha real)", async () => {
  const db = fakeDb();
  const orig = db.query.bind(db);
  db.query = async (sql, p) => { if (/DO UPDATE/.test(sql)) { const e = new Error("deadlock"); e.code = "40P01"; throw e; } return orig(sql, p); };
  const r = await processarPedido(conta(), order(), depsBase(db, { evidenciaPromo: true }));
  assert.equal(r.resultado, "erro");
  assert.equal(r.codigo, "40P01");
});
