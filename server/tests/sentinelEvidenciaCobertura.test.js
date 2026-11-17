// Relatório de cobertura da evidência financeira: SOMENTE LEITURA, denominadores explícitos, por conta.
const test = require("node:test");
const assert = require("node:assert/strict");
const { relatorioCobertura, resumirCobertura, COBERTURA_SQL, DISTRIBUICAO_SQL, AVISO_COBERTURA } = require("../services/sentinel/sentinelEvidenciaCobertura");
const { EVIDENCIA_COLUNAS } = require("../services/sentinel/sentinelSchema");

const linhaConta = (o = {}) => ({ cliente_conta_id: 7, considerados: 100, legados: 40, com_evidencia: 60, com_campos_promocionais: 45,
  sem_evidencia_promocional: 15, inconsistentes: 3, potencial_ml: 12, nao_verificados: 20, nao_conciliados: 60,
  prejuizos_com_evidencia: 10, prejuizos_que_virariam_pendentes: 4, ...o });

function fakeDb({ schemaOk = true, conta = [linhaConta()], dist = [{ cliente_conta_id: 7, afirmacao: "CATEGORICO", n: 6 }, { cliente_conta_id: 7, afirmacao: "OBSERVACAO", n: 4 }] } = {}) {
  const sqls = [];
  return { sqls, async query(sql, params) {
    sqls.push({ sql, params });
    if (/information_schema/.test(sql)) return { rows: schemaOk ? EVIDENCIA_COLUNAS.map((c) => ({ column_name: c })) : [] };
    if (sql === COBERTURA_SQL) return { rows: conta };
    if (sql === DISTRIBUICAO_SQL) return { rows: dist };
    throw new Error("query inesperada");
  } };
}

test("CV1 as consultas são SOMENTE LEITURA (só SELECT, nenhuma palavra de escrita)", () => {
  for (const sql of [COBERTURA_SQL, DISTRIBUICAO_SQL]) {
    assert.match(sql.trim(), /^SELECT/i);
    assert.equal(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT)\b/i.test(sql), false);
  }
});

test("CV2 relatório por conta com denominadores explícitos (numerador/denominador, nunca só %)", async () => {
  const r = await relatorioCobertura(fakeDb(), { contaIds: [7] });
  assert.equal(r.disponivel, true);
  const c = r.contas[0];
  assert.equal(c.cliente_conta_id, 7);
  assert.deepEqual(c.pedidos_considerados, { n: 100, denominador: null, descricao: "linhas de sentinel_pedidos da conta na janela" });
  assert.deepEqual(c.legados, { n: 40, denominador: 100, percentual: 40 });
  assert.deepEqual(c.com_evidencia, { n: 60, denominador: 100, percentual: 60 });
  // os demais indicadores têm como denominador os pedidos COM evidência (não os considerados)
  for (const k of ["com_campos_promocionais", "sem_evidencia_promocional", "inconsistentes", "potencial_participacao_ml", "nao_verificados", "nao_conciliados"]) {
    assert.equal(c[k].denominador, 60, k);
  }
  assert.equal(c.potencial_participacao_ml.n, 12);
  assert.equal(c.prejuizos_que_virariam_pendentes.denominador, 10);
  assert.deepEqual(c.distribuicao_afirmacao, { CATEGORICO: 6, OBSERVACAO: 4 });
});

test("CV3 nunca apresenta percentual de 'pedidos corretos' sem conciliação; todos nao_conciliados é dito explicitamente", async () => {
  const r = await relatorioCobertura(fakeDb(), { contaIds: [7] });
  assert.match(r.aviso, /não .*conciliação/i);
  assert.equal(AVISO_COBERTURA, r.aviso);
  assert.equal(JSON.stringify(r).toLowerCase().includes("corretos\""), false);
  assert.equal("pedidos_corretos" in r.contas[0], false);
  assert.equal(r.contas[0].nao_conciliados.n, r.contas[0].com_evidencia.n);
});

test("CV4 sem pedidos com evidência: percentuais null (nunca 0% nem NaN) e sem divisão por zero", () => {
  const r = resumirCobertura({ conta: [linhaConta({ considerados: 5, legados: 5, com_evidencia: 0, com_campos_promocionais: 0, sem_evidencia_promocional: 0,
    inconsistentes: 0, potencial_ml: 0, nao_verificados: 0, nao_conciliados: 0, prejuizos_com_evidencia: 0, prejuizos_que_virariam_pendentes: 0 })], dist: [] });
  const c = r.contas[0];
  assert.equal(c.legados.percentual, 100);
  assert.equal(c.inconsistentes.denominador, 0);
  assert.equal(c.inconsistentes.percentual, null);
  assert.deepEqual(c.distribuicao_afirmacao, {});
});

test("CV5 só as contas pedidas entram (parâmetro), sem mistura: distribuição de outra conta é ignorada", async () => {
  const db = fakeDb({ dist: [{ cliente_conta_id: 7, afirmacao: "CATEGORICO", n: 6 }, { cliente_conta_id: 8, afirmacao: "ROBUSTO", n: 99 }] });
  const r = await relatorioCobertura(db, { contaIds: [7] });
  assert.deepEqual(db.sqls.filter((s) => s.sql === COBERTURA_SQL)[0].params[0], [7]);
  assert.deepEqual(r.contas[0].distribuicao_afirmacao, { CATEGORICO: 6 });
  assert.equal(r.contas.length, 1);
});

test("CV6 migration ausente: informa indisponível e NÃO executa as consultas de cobertura", async () => {
  const db = fakeDb({ schemaOk: false });
  const r = await relatorioCobertura(db, { contaIds: [7] });
  assert.deepEqual([r.disponivel, r.motivo], [false, "schema_evidencia_ausente"]);
  assert.equal(db.sqls.some((s) => s.sql === COBERTURA_SQL), false);
});

test("CV7 entrada inválida: contaIds vazio/ruim ⇒ erro claro (nunca varre todas as contas por omissão)", async () => {
  await assert.rejects(() => relatorioCobertura(fakeDb(), { contaIds: [] }), /contaIds/);
  await assert.rejects(() => relatorioCobertura(fakeDb(), {}), /contaIds/);
  await assert.rejects(() => relatorioCobertura(fakeDb(), { contaIds: ["x", -1] }), /contaIds/);
});
