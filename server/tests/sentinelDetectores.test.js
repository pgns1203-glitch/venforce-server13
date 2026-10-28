// Detectores do Sentinel (puros): valor ausente nunca vira zero; sem dupla contagem.
const test = require("node:test");
const assert = require("node:assert/strict");
const { detectarMargemNegativa, detectarCustoPendente, configIncidentes, sanitizarErro, detectarLeituraAtrasada } = require("../services/sentinel/sentinelIncidentes");

const cfg = configIncidentes({});
const p = (id, extra = {}) => ({ pedido_id: id, status_ml: "paid", estado_margem: "confirmada", claims_verificado: false, pendencias: [],
  data_pedido: "2026-10-20T10:00:00Z", faturamento: 100, margem_valor: -10, itens: [{ item_id: "MLB1", preco: 100, quantidade: 1, estado_custo: "ok" }], ...extra });

test("faturamento ausente: margem média null (não 0) e contado à parte", () => {
  const [m] = detectarMargemNegativa([p("1"), p("2", { faturamento: null })], cfg);
  assert.equal(m.impacto_valor, 20);
  assert.equal(m.detalhes.faturamentoObservado, null);
  assert.equal(m.detalhes.margemMediaPct, null);
  assert.equal(m.detalhes.pedidosSemFaturamento, 1);
});

test("faturamento presente: margem média = perda/fat", () => {
  const [m] = detectarMargemNegativa([p("1"), p("2")], cfg);
  assert.deepEqual([m.detalhes.faturamentoObservado, m.detalhes.margemMediaPct], [200, -10]);
});

test("preço ausente no item sem custo: fora da soma e sinalizado", () => {
  const sem = (id, preco) => p(id, { estado_margem: "sem_custo", margem_valor: null, itens: [{ item_id: "MLB9", preco, quantidade: 2, estado_custo: "sem_custo" }] });
  const [c] = detectarCustoPendente([sem("1", 50), sem("2", null)], cfg);
  assert.equal(c.impacto_valor, 100);
  assert.equal(c.detalhes.itensSemPreco, 1);
  assert.match(c.motivo, /1 item\(ns\) sem preço, fora da soma/);
  assert.equal(c.pedidos_afetados, 2);
});

test("pedido multiproduto: 1 incidente, perda contada uma vez; mesmo id repetido não duplica impacto de receita por item", () => {
  const multi = p("7", { margem_valor: -30, itens: [{ item_id: "MLB2", preco: 60, quantidade: 1, estado_custo: "ok" }, { item_id: "MLB3", preco: 40, quantidade: 1, estado_custo: "ok" }] });
  const ms = detectarMargemNegativa([multi], cfg);
  assert.equal(ms.length, 1);
  assert.deepEqual([ms[0].chave, ms[0].impacto_valor], ["MLB2+MLB3", 30]);
});

test("margem nula em pedido 'confirmada' não entra como perda zero", () => {
  assert.equal(detectarMargemNegativa([p("1", { margem_valor: null })], cfg).length, 0);
});

test("erro bruto é redigido antes da API (motivo de leitura inclusive)", () => {
  const bruto = "falhou GET https://api.mercadolibre.com/orders?access_token=APP_USR-1-x Bearer abc";
  const s = sanitizarErro(bruto);
  assert.ok(!/APP_USR|abc|https:/.test(s), s);
  assert.equal(sanitizarErro(null), null);
  const [inc] = detectarLeituraAtrasada({ ultimo_date_last_updated: "2026-10-20T00:00:00Z", ultima_execucao_em: "2026-10-20T11:59:00Z", ultimo_erro: bruto },
    Date.parse("2026-10-20T12:00:00Z"), { ...cfg, leituraLimiteMin: 60 });
  assert.ok(!/APP_USR|https:/.test(inc.motivo + JSON.stringify(inc.detalhes)));
});

test("par chave: valor nunca deixa o valor", () => {
  for (const bruto of ["access_token: ABC", "access_token=ABC", "refresh_token : ABC", "password: ABC", "Authorization: Bearer ABC", "api-key=ABC", "token: ABC"]) {
    const s = sanitizarErro(`falhou ${bruto} fim`);
    assert.ok(!s.includes("ABC"), `${bruto} → ${s}`);
    assert.ok(s.endsWith("fim"), s);
  }
});
