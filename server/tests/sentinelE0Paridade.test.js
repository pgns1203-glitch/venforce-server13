// Testes da comparação pura do script de paridade da E0 (sem banco).
const assert = require("assert");
const { compararPedidos } = require("../scripts/sentinel-e0-paridade");

let passou = 0;
function ok(nome, fn) {
  fn();
  passou += 1;
  console.log(`  ok  ${nome}`);
}

const importacao = { id: 900, competencia: "2026-09", created_at: "2026-10-07T12:00:00Z" };

function central(over = {}) {
  return {
    pedido_id: "1", status: "pago", faturamento: "100.00", lucro_contribuicao: "20.00",
    margem_contribuicao_percentual: "20.0000", comissao: "12.00", frete: "10.00", custo: "50.00",
    imposto: "8.00", itens: [{ mlb: "MLB1", quantidade: "1", custo_produto: "-50.00" }], ...over,
  };
}
function sentinel(over = {}) {
  return {
    pedido_id: "1", status_ml: "paid", ml_date_last_updated: "2026-10-01T00:00:00Z",
    faturamento: "100.00", comissao: "12.00", frete: "10.00", custo: "50.00", imposto: "8.00",
    margem_valor: "20.00", margem_pct: "20.00", estado_margem: "confirmada", pendencias: [],
    itens: [{ item_id: "MLB1", quantidade: 1, custo_unitario: 50 }], ...over,
  };
}

ok("pedido idêntico e congelado conta como idêntico", () => {
  const { resumo } = compararPedidos({ importacao, central: [central()], sentinel: [sentinel()] });
  assert.strictEqual(resumo.congelados_identicos, 1);
});

ok("diferença de 1 centavo em congelado é divergência", () => {
  const { resumo, linhas } = compararPedidos({ importacao, central: [central()], sentinel: [sentinel({ frete: "10.01" })] });
  assert.strictEqual(resumo.divergencias_congelados_por_campo.frete, 1);
  assert.strictEqual(resumo.soma_centavos_congelados_por_campo.frete, -1);
  assert.strictEqual(linhas[0].difs.frete.centavos, -1);
});

ok("pedido atualizado depois do import vai para mudou_depois", () => {
  const { resumo } = compararPedidos({
    importacao, central: [central()],
    sentinel: [sentinel({ ml_date_last_updated: "2026-10-20T00:00:00Z", faturamento: "0.00" })],
  });
  assert.strictEqual(resumo.mudou_depois, 1);
  assert.strictEqual(resumo.divergencias_mudou_depois_por_campo.faturamento, 1);
  assert.strictEqual(resumo.divergencias_congelados_por_campo.faturamento, undefined);
});

ok("NULL de um lado é ausente, nunca zero", () => {
  const { resumo, linhas } = compararPedidos({ importacao, central: [central()], sentinel: [sentinel({ imposto: null })] });
  assert.deepStrictEqual(linhas[0].ausentes, ["imposto"]);
  assert.strictEqual(resumo.ausentes_por_campo.imposto, 1);
  assert.strictEqual(resumo.congelados_identicos, 0);
});

ok("pedidos só de um lado são contados", () => {
  const { resumo } = compararPedidos({
    importacao, central: [central({ pedido_id: "A" })], sentinel: [sentinel({ pedido_id: "B" })],
  });
  assert.strictEqual(resumo.so_no_import, 1);
  assert.strictEqual(resumo.so_no_sentinel, 1);
});

ok("custo por MLB divergente aparece nos itens", () => {
  const { linhas } = compararPedidos({
    importacao, central: [central()],
    sentinel: [sentinel({ itens: [{ item_id: "MLB1", quantidade: 1, custo_unitario: 55 }] })],
  });
  assert.deepStrictEqual(linhas[0].itens, [{ mlb: "MLB1", problema: "custo", central: 50, sentinel: 55 }]);
});

ok("agregado dos congelados soma os mesmos pedidos e margem = ΣLC/ΣFAT", () => {
  const { resumo } = compararPedidos({
    importacao,
    central: [central(), central({ pedido_id: "2", faturamento: "300.00", lucro_contribuicao: "30.00" })],
    sentinel: [sentinel(), sentinel({ pedido_id: "2", faturamento: "300.00", margem_valor: "30.00", margem_pct: "10.00" })],
  });
  assert.deepStrictEqual(resumo.agregado_congelados.faturamento, { pedidos: 2, central: 400, sentinel: 400, diferenca: 0 });
  assert.deepStrictEqual(resumo.agregado_congelados.margem_pct, { central: 12.5, sentinel: 12.5 });
});
console.log(`\n${passou} verificações passaram.`);
