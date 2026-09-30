process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const { agruparEmSemanas, agruparPedidosEmSemanas } = require("../services/painelContas/painelContasSemanas");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

function pedido(data, faturamento, resultado = null, confianca = "bloqueado", status = "paid") {
  return { data_pedido: data, faturamento, resultado, confianca, status };
}

const coberturaSetembro = { coberturaInicio: "2026-09-01", coberturaFim: "2026-09-30" };

// 1. Uma conta: o FAT mensal é a soma exata dos pedidos semanais.
const umaConta = agruparPedidosEmSemanas("2026-09", [
  pedido("2026-09-01", 100), pedido("2026-09-08", 200), pedido("2026-09-15", 300),
  pedido("2026-09-22", 400), pedido("2026-09-29", 500),
], coberturaSetembro);
ok("uma conta: FAT mensal = soma S1..S5", umaConta.reduce((s, w) => s + w.resumo.fat, 0) === 1500);

// 2. Três contas: cada semana consolidada é a soma das mesmas semanas.
const contas = [1, 2, 3].map((multiplicador) => agruparPedidosEmSemanas("2026-09", [
  pedido("2026-09-01", 10 * multiplicador), pedido("2026-09-08", 20 * multiplicador),
  pedido("2026-09-15", 30 * multiplicador), pedido("2026-09-22", 40 * multiplicador),
  pedido("2026-09-29", 50 * multiplicador),
], coberturaSetembro));
const consolidado = agruparEmSemanas("2026-09", [
  { data: "2026-09-01", vendasBrutas: 60 }, { data: "2026-09-08", vendasBrutas: 120 },
  { data: "2026-09-15", vendasBrutas: 180 }, { data: "2026-09-22", vendasBrutas: 240 },
  { data: "2026-09-29", vendasBrutas: 300 },
]);
ok("três contas: soma por semana = consolidado", consolidado.every((w, i) =>
  contas.reduce((soma, conta) => soma + conta[i].resumo.fat, 0) === w.resumo.fat
));

// 3. Sem import/dado: o caller passa null e nenhuma semana é fabricada.
ok("conta sem dados: nenhuma semana inventada", agruparPedidosEmSemanas("2026-09", null).length === 0);

// 4. Mês parcial no calendário: setembro termina S5 em 30.
ok("mês parcial: S5 termina em 30/09", umaConta[4].de === "2026-09-29" && umaConta[4].ate === "2026-09-30");

// 5. FAT existe sem custo/resultado; LC/MC continuam null.
ok("LC/MC ausentes permanecem null", umaConta.every((w) => w.resumo.lc === null && w.resumo.mc === null));

// LC/MC, quando reais, usam resultado e a base não bloqueada daquele bloco.
const comMargem = agruparPedidosEmSemanas("2026-09", [pedido("2026-09-02", 200, 30, "confiavel")], coberturaSetembro);
ok("LC/MC reais usam os campos oficiais do pedido", comMargem[0].resumo.lc === 30 && comMargem[0].resumo.mc === 0.15);

// 6. Competência exata e regra oficial de exclusão.
const exata = agruparPedidosEmSemanas("2026-09", [
  pedido("2026-08-31", 999), pedido("2026-09-01", 100), pedido("2026-09-02", 777, null, "bloqueado", "cancelled"),
], { ...coberturaSetembro, pedidoValido: (p) => !/cancel/i.test(p.status) });
ok("setembro não inclui agosto nem pedido excluído", exata.reduce((s, w) => s + w.resumo.fat, 0) === 100);

console.log(`\npainelContasSemanasContas.test.js: ${checks} verificações passaram.`);
