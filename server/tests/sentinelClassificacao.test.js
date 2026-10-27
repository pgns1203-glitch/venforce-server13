// Classificação de pedidos do Sentinel (elegibilidade × confiabilidade) e atraso pós-ciclo.
const test = require("node:test");
const assert = require("node:assert/strict");
const { classificarPedido, contaComoVenda } = require("../services/sentinel/sentinelClassificacao");

const base = { estado_margem: "confirmada", margem_valor: -10, pendencias: [], claims_verificado: false };

test("paid confirmada sem claims ⇒ venda, calculado (nunca confirmado)", () => {
  const c = classificarPedido({ ...base, status_ml: "paid" });
  assert.equal(c.elegibilidade, "venda");
  assert.equal(c.confiabilidade, "calculado");
  assert.deepEqual(c.motivosConfiabilidade, ["claims_nao_verificados"]);
});

test("claims verificados ⇒ confirmado", () => {
  assert.equal(classificarPedido({ ...base, status_ml: "paid", claims_verificado: true }).confiabilidade, "confirmado");
});

test("cancelados e não pagos ficam fora de venda", () => {
  for (const [s, motivo] of [["cancelled", "cancelado"], ["invalid", "invalido"], ["pending_cancel", "cancelamento_pendente"],
    ["payment_required", "aguardando_pagamento"], ["payment_in_process", "aguardando_pagamento"], ["confirmed", "aguardando_pagamento"],
    ["partially_paid", "pagamento_parcial"], [null, "status_desconhecido"], ["xpto", "status_desconhecido"]]) {
    const c = classificarPedido({ ...base, status_ml: s });
    assert.equal(c.elegibilidade, "excluido", s);
    assert.equal(c.motivoExclusao, motivo, s);
    assert.equal(contaComoVenda({ ...base, status_ml: s }), false, s);
  }
  assert.equal(contaComoVenda({ ...base, status_ml: "PAID" }), true);
});

test("partially_refunded ⇒ ressalva e pendente", () => {
  const c = classificarPedido({ ...base, status_ml: "partially_refunded" });
  assert.equal(c.elegibilidade, "ressalva");
  assert.equal(c.confiabilidade, "pendente");
  assert.equal(contaComoVenda({ ...base, status_ml: "partially_refunded" }), true);
});

test("estado do cálculo define inconclusivo/pendente", () => {
  for (const e of ["sem_custo", "custo_ambiguo", "erro"]) {
    assert.equal(classificarPedido({ ...base, status_ml: "paid", estado_margem: e, margem_valor: null }).confiabilidade, "inconclusivo", e);
  }
  const p = classificarPedido({ ...base, status_ml: "paid", estado_margem: "provisoria", pendencias: ["sem_frete"] });
  assert.equal(p.confiabilidade, "pendente");
  assert.deepEqual(p.motivosConfiabilidade, ["sem_frete"]);
  assert.equal(classificarPedido({ ...base, status_ml: "paid", margem_valor: null }).confiabilidade, "inconclusivo");
});
