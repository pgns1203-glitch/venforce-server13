// Recálculo por alteração da base de custos (puro + banco simulado). A detecção é por CONTEÚDO: compara o custo/imposto que a
// linha gravou (itens[]) com o que a base ATUAL resolve. Não usa custos.updated_at: toda edição/reimport grava updated_at
// incondicionalmente (baseCustosService.js:303,322; baseImportService.js:39,52) e DELETE não deixa rastro (meliCustosLoteService.js:117).
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  configRecalculo, recalculoAtivo, planejarRecalculo, divergenciaDeItens, corteRetroativo, assinaturaBase, selecionarDefasadas, deveVarrer,
  novoEstadoRecalculo, ASSINATURA_SQL, SELECIONAR_SQL,
} = require("../services/sentinel/sentinelRecalculoBase");
const { construirIndiceCusto } = require("../services/sentinel/sentinelCusto");

const base = (linhas) => construirIndiceCusto(linhas);
const L = (mlb, custo, imposto, extra = {}) => ({ produto_id: mlb, custo_produto: custo, imposto_percentual: imposto, id_model: "", sku: "", ...extra });
const item = (mlb, o = {}) => ({ item_id: mlb, variation_id: null, sku: null, quantidade: 1, preco: 100, custo_unitario: 65, imposto_percentual: 0.13, estado_custo: "ok", origem_custo: "mlb", ...o });

// ───────────────────────── configuração: desligada por padrão, regra de vigência explícita ─────────────────────────
test("C1 padrão DESLIGADO; janela 30 d; teto 25 pedidos/ciclo; sem data de vigência", () => {
  const c = configRecalculo({});
  assert.deepEqual([c.habilitado, c.janelaDias, c.maxPorCiclo, c.desde], [false, 30, 25, null]);
  assert.equal(recalculoAtivo({}), false);
});

test("C1 só true|1|on|yes ligam; lixo cai no padrão (nunca em valor perigoso)", () => {
  for (const v of ["true", "1", "on", "yes", "TRUE"]) assert.equal(configRecalculo({ SENTINEL_RECALC_BASE_ENABLED: v }).habilitado, true, v);
  for (const v of ["", "0", "false", "talvez", undefined]) assert.equal(configRecalculo({ SENTINEL_RECALC_BASE_ENABLED: v }).habilitado, false, String(v));
  const c = configRecalculo({ SENTINEL_RECALC_JANELA_DIAS: "-3", SENTINEL_RECALC_MAX_POR_CICLO: "abc", SENTINEL_RECALC_DESDE: "ontem" });
  assert.deepEqual([c.janelaDias, c.maxPorCiclo, c.desde], [30, 25, null]);
  assert.equal(configRecalculo({ SENTINEL_RECALC_JANELA_DIAS: "7", SENTINEL_RECALC_MAX_POR_CICLO: "5", SENTINEL_RECALC_DESDE: "2026-11-13T00:00:00Z" }).desde, "2026-11-13T00:00:00.000Z");
});

// ───────────────────────── vigência: retroativo só dentro da janela e a partir de `desde` ─────────────────────────
test("V1 corte retroativo = o mais recente entre (agora − janela) e a data de vigência; sem vigência usa só a janela", () => {
  const agora = Date.parse("2026-11-17T12:00:00Z");
  assert.equal(corteRetroativo({ janelaDias: 30, desde: null }, agora), "2026-10-18T12:00:00.000Z");
  assert.equal(corteRetroativo({ janelaDias: 30, desde: "2026-11-13T00:00:00.000Z" }, agora), "2026-11-13T00:00:00.000Z");
  assert.equal(corteRetroativo({ janelaDias: 30, desde: "2026-01-01T00:00:00.000Z" }, agora), "2026-10-18T12:00:00.000Z");
});

// ───────────────────────── divergência RELEVANTE (conteúdo) ─────────────────────────
test("D1 mesma base ⇒ nenhuma divergência", () => {
  const d = divergenciaDeItens([item("MLB1", { imposto_percentual: 0.1 })], base([L("MLB1", 65, 0.1)]));
  assert.equal(d.divergente, false);
});

test("D1 imposto 13% → 10% ⇒ divergente, com o detalhe do que mudou", () => {
  const d = divergenciaDeItens([item("MLB1")], base([L("MLB1", 65, 0.1)]));
  assert.equal(d.divergente, true);
  assert.deepEqual(d.itens[0], { idx: 0, item_id: "MLB1", campos: ["imposto"], de: { custo: 65, imposto: 0.13, estado: "ok" }, para: { custo: 65, imposto: 0.1, estado: "ok" } });
});

test("D2 custo unitário alterado ⇒ divergente", () => {
  const d = divergenciaDeItens([item("MLB1", { imposto_percentual: 0.1 })], base([L("MLB1", 70, 0.1)]));
  assert.deepEqual(d.itens[0].campos, ["custo"]);
});

test("D3 produto REMOVIDO da base (DELETE não deixa updated_at) ⇒ divergente: ok → sem_custo", () => {
  const d = divergenciaDeItens([item("MLB1", { imposto_percentual: 0.1 })], base([L("MLB9", 1, 0.1)]));
  assert.equal(d.divergente, true);
  assert.deepEqual([d.itens[0].de.estado, d.itens[0].para.estado], ["ok", "sem_custo"]);
});

test("D3 produto que ESTAVA sem custo e ganhou custo ⇒ divergente: sem_custo → ok", () => {
  const gravado = item("MLB1", { custo_unitario: null, imposto_percentual: null, estado_custo: "sem_custo", origem_custo: null });
  const d = divergenciaDeItens([gravado], base([L("MLB1", 65, 0.1)]));
  assert.equal(d.divergente, true);
  assert.deepEqual([d.itens[0].de.estado, d.itens[0].para.estado], ["sem_custo", "ok"]);
});

test("D4 igualdade é NUMÉRICA: '0.10' × 0.1 e 65.00 × 65 não divergem; origem diferente com mesmos valores não é relevante", () => {
  const d = divergenciaDeItens([item("MLB1", { custo_unitario: "65.00", imposto_percentual: "0.10", origem_custo: "sku" })], base([L("MLB1", 65, 0.1)]));
  assert.equal(d.divergente, false);
});

test("D5 pedido com VÁRIOS itens: basta UM divergir; a lista aponta exatamente qual", () => {
  const itens = [item("MLB1", { imposto_percentual: 0.1 }), item("MLB2", { imposto_percentual: 0.13 })];
  const d = divergenciaDeItens(itens, base([L("MLB1", 65, 0.1), L("MLB2", 65, 0.1)]));
  assert.equal(d.divergente, true);
  assert.deepEqual(d.itens.map((x) => x.idx), [1]);
});

test("D6 variação/sku entram na resolução como no cálculo original (mesma chave do custo)", () => {
  const idx = base([L("MLB1", 50, 0.1, { id_model: "111" }), L("MLB1", 60, 0.1, { id_model: "222" })]);
  const g = item("MLB1", { variation_id: 222, custo_unitario: 60, imposto_percentual: 0.1, origem_custo: "variacao" });
  assert.equal(divergenciaDeItens([g], idx).divergente, false);
  assert.equal(divergenciaDeItens([{ ...g, custo_unitario: 50 }], idx).divergente, true);
});

test("D7 entrada inválida (itens ausentes/não-lista) nunca divergente nem lança", () => {
  for (const x of [null, undefined, [], "x", {}]) assert.equal(divergenciaDeItens(x, base([])).divergente, false);
});

// ───────────────────────── assinatura da base (gate barato) ─────────────────────────
test("A1 a assinatura usa SÓ campos que afetam o cálculo e é SELECT puro", () => {
  assert.match(ASSINATURA_SQL.trim(), /^SELECT/i);
  assert.equal(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i.test(ASSINATURA_SQL), false);
  for (const col of ["produto_id", "id_model", "sku", "custo_produto", "imposto_percentual"]) assert.ok(ASSINATURA_SQL.includes(col), col);
  assert.equal(/updated_at/.test(ASSINATURA_SQL), false); // updated_at é tocado sem mudança real
  assert.ok(/sku_id\s*=\s*''/.test(ASSINATURA_SQL)); // mesma projeção do carregarIndiceCusto
});

test("A1 assinaturaBase devolve { n, hash } e exige baseId", async () => {
  const db = { async query(sql, p) { assert.equal(sql, ASSINATURA_SQL); assert.deepEqual(p, [183]); return { rows: [{ n: 735, h: "abc" }] }; } };
  assert.deepEqual(await assinaturaBase(db, 183), { n: 735, hash: "abc" });
  assert.equal(await assinaturaBase(db, null), null);
});

// ───────────────────────── gate de varredura: sem varrer a carteira inteira a cada ciclo ─────────────────────────
test("G1 1º ciclo varre; mesma assinatura sem pendência NÃO varre; assinatura nova varre; pendência força nova varredura", () => {
  const e = novoEstadoRecalculo();
  const s1 = { n: 3, hash: "h1" };
  assert.equal(deveVarrer(e, 7, s1), true); // desconhecido (ex.: depois de reinício)
  e.registrar(7, s1, { pendente: false });
  assert.equal(deveVarrer(e, 7, s1), false);
  assert.equal(deveVarrer(e, 7, { n: 3, hash: "h2" }), true);
  e.registrar(7, { n: 3, hash: "h2" }, { pendente: true }); // sobrou trabalho (teto por ciclo)
  assert.equal(deveVarrer(e, 7, { n: 3, hash: "h2" }), true);
  assert.equal(deveVarrer(e, 8, { n: 3, hash: "h2" }), true); // estado é POR CONTA
  assert.equal(deveVarrer(e, 7, null), false); // sem base não há o que comparar
});

// ───────────────────────── seleção ─────────────────────────
const linhaDb = (id, itens, extra = {}) => ({ pedido_id: String(id), itens, estado_margem: "confirmada", data_pedido: "2026-11-10T10:00:00Z", custo: 65, imposto: 14.35, margem_valor: -1.3, ...extra });
const fakeDb = (rows) => ({ calls: [], async query(sql, p) { this.calls.push({ sql, p }); assert.equal(sql, SELECIONAR_SQL); return { rows }; } });

test("S1 seleciona só as divergentes, até o teto, informa pendência e conta de varridos", async () => {
  const idx = base([L("MLB1", 65, 0.1)]);
  const rows = [1, 2, 3, 4, 5].map((i) => linhaDb(i, [item("MLB1")])).concat([linhaDb(6, [item("MLB1", { imposto_percentual: 0.1 })])]);
  const r = await selecionarDefasadas(fakeDb(rows), 7, idx, { janelaDias: 30, desde: null, maxPorCiclo: 3, varreduraMax: 100 }, Date.parse("2026-11-17T12:00:00Z"));
  assert.deepEqual(r.ids, ["1", "2", "3"]);
  assert.equal(r.varridos, 6);
  assert.equal(r.divergentes, 5);
  assert.equal(r.pendente, true);
  assert.equal(r.defasadas.get("1").de.imposto, 14.35);
});

test("S1 sem divergência ⇒ nada selecionado, sem pendência", async () => {
  const idx = base([L("MLB1", 65, 0.1)]);
  const r = await selecionarDefasadas(fakeDb([linhaDb(1, [item("MLB1", { imposto_percentual: 0.1 })])]), 7, idx, configRecalculo({}), Date.parse("2026-11-17T12:00:00Z"));
  assert.deepEqual([r.ids, r.pendente, r.divergentes], [[], false, 0]);
});

test("S2 a consulta é por CONTA, só estados estáveis e pedidos elegíveis, com corte de vigência (parâmetros, nunca concatenação)", async () => {
  const db = fakeDb([]);
  await selecionarDefasadas(db, 41, base([]), { janelaDias: 30, desde: "2026-11-13T00:00:00.000Z", maxPorCiclo: 5, varreduraMax: 50 }, Date.parse("2026-11-17T12:00:00Z"));
  assert.deepEqual(db.calls[0].p, [41, "2026-11-17T12:00:00.000Z".replace("17T12", "13T00"), 50]);
  assert.match(SELECIONAR_SQL, /cliente_conta_id = \$1/);
  assert.match(SELECIONAR_SQL, /estado_margem IN \('confirmada', 'sem_custo', 'custo_ambiguo'\)/);
  assert.match(SELECIONAR_SQL, /status_ml IN \('paid', 'partially_refunded'\)/);
  assert.equal(/\b(INSERT|UPDATE|DELETE)\b/i.test(SELECIONAR_SQL), false);
});

test("S3 itens corrompidos numa linha não derrubam a seleção das demais", async () => {
  const idx = base([L("MLB1", 65, 0.1)]);
  const rows = [linhaDb(1, "lixo"), linhaDb(2, null), linhaDb(3, [item("MLB1")])];
  const r = await selecionarDefasadas(fakeDb(rows), 7, idx, configRecalculo({}), Date.parse("2026-11-17T12:00:00Z"));
  assert.deepEqual(r.ids, ["3"]);
});

// ───────────────────────── vigência OBRIGATÓRIA: sem data explícita o passado nunca é reescrito ─────────────────────────
// Decisão financeira (17/11/2026): a mudança de imposto da Alianza 1 (13% → 10%) NÃO vale para vendas anteriores à vigência.
test("V2 flag ligada SEM SENTINEL_RECALC_DESDE ⇒ recálculo suspenso: nenhuma consulta, nenhum plano (nunca reescreve o passado por omissão)", async () => {
  const db = { async query() { throw new Error("não deveria consultar o banco sem vigência definida"); } };
  const aviso = console.warn; const avisos = []; console.warn = (m) => avisos.push(m);
  try {
    const plano = await planejarRecalculo({ db, ctx: { clienteContaId: 86, baseId: 183 }, cfg: { ...configRecalculo({ SENTINEL_RECALC_BASE_ENABLED: "true" }) } });
    assert.equal(plano, null);
    assert.ok(avisos.some((m) => /SENTINEL_RECALC_DESDE/.test(m)), "o aviso diz o que falta configurar");
  } finally { console.warn = aviso; }
});

test("V2 com vigência definida o planejamento segue (gate → assinatura); desligado continua sem tocar no banco", async () => {
  const consultas = [];
  const db = { async query(sql) { consultas.push(sql); if (/information_schema/.test(sql)) return { rows: [{ "?column?": 1 }] }; if (sql === ASSINATURA_SQL) return { rows: [{ n: 1, h: "x" }] }; return { rows: [] }; } };
  const cfg = configRecalculo({ SENTINEL_RECALC_BASE_ENABLED: "true", SENTINEL_RECALC_DESDE: "2026-11-13T00:00:00Z" });
  const plano = await planejarRecalculo({ db, ctx: { clienteContaId: 86, baseId: 183 }, cfg, cacheCusto: new Map([[183, base([])]]) });
  assert.ok(plano && plano.ids.length === 0);
  assert.ok(consultas.includes(ASSINATURA_SQL));
  const off = await planejarRecalculo({ db: { async query() { throw new Error("não consulta"); } }, ctx: { clienteContaId: 86, baseId: 183 }, cfg: configRecalculo({}) });
  assert.equal(off, null);
});
