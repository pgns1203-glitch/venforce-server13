// server/tests/centralVendasFretePack.test.js
//
// Frete/receita de envio de pedidos que COMPARTILHAM shipment (carrinho/pack):
// o custo do shipment é UM só e é rateado pela receita — Σ exata, nunca N× o valor.
// Sem banco, sem rede.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/x";

const assert = require("assert");
const { ratearEnvioCompartilhado, agruparEnvioCompartilhado, receitaDoPedidoCentavos } = require("../services/centralVendas/centralVendasEnvioCompartilhado");
const { buildMotorFromOrders, buildCostMap } = require("../services/centralVendas/centralVendasSyncService");
const fx = require("./fixtures/centralFretePackFixtures");
const golden = require("./fixtures/centralFretePackGolden.json");

let checks = 0;
function ok(label, cond) { assert.ok(cond, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); }
function eq(label, a, b) { assert.deepStrictEqual(a, b, `FALHOU: ${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); checks += 1; console.log(`  ok  ${label}`); }
const cents = (v) => Math.round(v * 100);
const soma = (mp) => [...mp.values()].reduce((s, v) => s + cents(v), 0);
const P = (...receitas) => receitas.map((r, i) => ({ pedidoId: String(100 + i), receitaCentavos: r }));

console.log("\n▸ função pura ratearEnvioCompartilhado");
eq("1 pedido ⇒ valor CHEIO, sem arredondar", [...ratearEnvioCompartilhado(18.4, P(5000)).values()], [18.4]);
eq("1 pedido: valor com 3 casas passa como veio (idêntico ao comportamento anterior)", [...ratearEnvioCompartilhado(12.345, P(5000)).values()], [12.345]);
for (const [rot, valor, receitas] of [
  ["2 pedidos", 30, [10000, 5000]],
  ["3 pedidos", 30, [10000, 5000, 5000]],
  ["10,00 por 3 receitas iguais (difícil)", 10, [3000, 3000, 3000]],
  ["0,01 por 2 pedidos", 0.01, [5000, 5000]],
  ["receita desproporcional", 17.77, [1, 999999, 12345]],
  ["valor grande", 99999.99, [123456789, 987654321, 5]],
]) {
  const r = ratearEnvioCompartilhado(valor, P(...receitas));
  eq(`${rot}: Σ == custo ao centavo`, soma(r), cents(valor));
}
eq("10,00 / 3 iguais ⇒ 3,33 + 3,33 + 3,34 (resto no último)", [...ratearEnvioCompartilhado(10, P(3000, 3000, 3000)).values()], [3.33, 3.33, 3.34]);
eq("0,01 / 2 ⇒ 0,00 + 0,01", [...ratearEnvioCompartilhado(0.01, P(5000, 5000)).values()], [0, 0.01]);
eq("proporcional à receita (2:1 de 30,00 ⇒ 20,00 + 10,00)", [...ratearEnvioCompartilhado(30, P(20000, 10000)).values()], [20, 10]);
eq("receita total 0 ⇒ igualitário em centavos", [...ratearEnvioCompartilhado(30, P(0, 0, 0)).values()], [10, 10, 10]);
eq("receita 0 e 10,00 por 3 ⇒ Σ exata", soma(ratearEnvioCompartilhado(10, P(0, 0, 0))), 1000);
eq("valor null ⇒ todos null (nunca 0)", [...ratearEnvioCompartilhado(null, P(1, 2, 3)).values()], [null, null, null]);
eq("valor undefined/NaN ⇒ null", [...ratearEnvioCompartilhado(undefined, P(1, 2)).values(), ...ratearEnvioCompartilhado(NaN, P(1, 2)).values()], [null, null, null, null]);
eq("ordem estável por pedido_id (entrada embaralhada ⇒ mesmo resultado)",
  [...ratearEnvioCompartilhado(10, [{ pedidoId: "300", receitaCentavos: 3000 }, { pedidoId: "100", receitaCentavos: 3000 }, { pedidoId: "200", receitaCentavos: 3000 }])],
  [["100", 3.33], ["200", 3.33], ["300", 3.34]]);
eq("receitaDoPedidoCentavos = Σ unit_price×quantity", receitaDoPedidoCentavos(fx.ordersIndependentes()[0]), 28000);
eq("agruparEnvioCompartilhado só devolve shipments com 2+ pedidos", [...agruparEnvioCompartilhado(fx.ordersIndependentes()).keys()], []);

console.log("\n▸ Central: shipment com 1 pedido é IDÊNTICO ao motor de f9c5fea9 (golden)");
const costMap = buildCostMap(fx.costRows);
const motorIndep = buildMotorFromOrders({ orders: fx.ordersIndependentes(), costMap, freteMap: fx.freteIndependentes(), clienteSlug: "cli", competencia: "2026-10" });
eq("pedidos, itens e componentes idênticos ao golden (byte a byte)", JSON.parse(JSON.stringify(motorIndep)), golden);
ok("nenhum campo/obs de envio compartilhado nos pedidos independentes", motorIndep.pedidos.every((p) => p.envioCompartilhadoPor === undefined)
  && motorIndep.componentes.every((c) => !/compartilhado/.test(c.obs || "")));

console.log("\n▸ Central: 2 e 3 pedidos no mesmo shipment");
function motorPack(orders, entry) {
  return buildMotorFromOrders({ orders, costMap, freteMap: new Map([["7001", entry]]), clienteSlug: "cli", competencia: "2026-10" });
}
const somaComp = (motor, tipo) => cents(motor.componentes.filter((c) => c.tipo === tipo && c.valor !== null).reduce((s, c) => s + Math.abs(c.valor), 0) * 1) / 1;
const pack2 = [
  fx.pedido(2001, { shipment: 7001, pack: 8001, itens: [["MLB100", 2, 100, 12.5]] }),   // receita 200
  fx.pedido(2002, { shipment: 7001, pack: 8001, itens: [["MLB200", 1, 100, 10]] }),     // receita 100
];
const m2 = motorPack(pack2, { status: "real", valor: 30, receitaComprador: 10 });
eq("Σ frete_seller dos 2 pedidos == 30,00 (antes somava 60,00)", somaComp(m2, "frete_seller"), 3000);
eq("Σ receita_envio dos 2 pedidos == 10,00 (antes somava 20,00)", somaComp(m2, "receita_envio"), 1000);
eq("frete por pedido proporcional à receita (20,00 / 10,00)", m2.componentes.filter((c) => c.tipo === "frete_seller").map((c) => [c.pedidoId, c.valor]), [["2001", -20], ["2002", -10]]);
ok("obs registra o rateio de pack (frete e receita de envio)", m2.componentes.filter((c) => c.tipo === "frete_seller" || c.tipo === "receita_envio").every((c) => /compartilhado por 2 pedidos, rateado pela receita/.test(c.obs)));
eq("pedido carrega envioCompartilhadoPor", m2.pedidos.map((p) => p.envioCompartilhadoPor), [2, 2]);

const pack3 = [
  fx.pedido(3001, { shipment: 7001, pack: 8002, itens: [["MLB100", 1, 100, 12.5]] }),
  fx.pedido(3002, { shipment: 7001, pack: 8002, itens: [["MLB200", 1, 100, 10]] }),
  fx.pedido(3003, { shipment: 7001, pack: 8002, itens: [["MLB300", 1, 100, 4]] }),
];
const m3 = motorPack(pack3, { status: "real", valor: 10, receitaComprador: 0.01 });
eq("3 pedidos: Σ frete == 10,00 ao centavo", somaComp(m3, "frete_seller"), 1000);
eq("3 pedidos: Σ receita_envio == 0,01 ao centavo", somaComp(m3, "receita_envio"), 1);

console.log("\n▸ Central: dentro do pedido, allocateFrete por unidades continua valendo");
const packMulti = [
  fx.pedido(4001, { shipment: 7001, pack: 8003, itens: [["MLB100", 3, 100, 12.5], ["MLB200", 1, 100, 10]] }), // receita 400
  fx.pedido(4002, { shipment: 7001, pack: 8003, itens: [["MLB300", 4, 50, 4]] }),                               // receita 200
];
const mm = motorPack(packMulti, { status: "real", valor: 30, receitaComprador: null });
const fretes4001 = mm.componentes.filter((c) => c.tipo === "frete_seller" && c.pedidoId === "4001");
eq("pedido 4001 recebe 20,00 do shipment e rateia 3:1 entre os itens (15,00 + 5,00)", fretes4001.map((c) => c.valor), [-15, -5]);
eq("pedido 4002 recebe 10,00", mm.componentes.filter((c) => c.tipo === "frete_seller" && c.pedidoId === "4002").map((c) => c.valor), [-10]);
ok("quantidades e faturamento preservados", mm.pedidos[0].quantidadeItens === 4 && mm.pedidos[0].faturamento === 400 && mm.pedidos[1].faturamento === 200);

console.log("\n▸ Central: frete ausente ⇒ NULL em todos, nunca 0");
for (const entry of [{ status: "ausente", valor: null, receitaComprador: null }, undefined]) {
  const ma = motorPack(pack2, entry);
  ok(`entry ${entry ? "ausente" : "inexistente"}: frete_seller e receita_envio null em todos`, ma.componentes.filter((c) => c.tipo === "frete_seller" || c.tipo === "receita_envio").every((c) => c.valor === null));
  ok("… e a pendência frete_seller_ausente permanece", ma.pedidos.every((p) => p.pendencias.includes("frete_seller_ausente")));
}

console.log("\n▸ Central: pedido cancelado continua no rateio (o envio é do shipment)");
const packCanc = [
  fx.pedido(5001, { shipment: 7001, pack: 8004, itens: [["MLB100", 1, 100, 12.5]] }),
  fx.pedido(5002, { shipment: 7001, pack: 8004, status: "cancelled", itens: [["MLB200", 1, 100, 10]] }),
];
const mc = motorPack(packCanc, { status: "real", valor: 20, receitaComprador: null });
eq("cancelado entra no rateio: 10,00 + 10,00 (Σ == 20,00)", mc.componentes.filter((c) => c.tipo === "frete_seller").map((c) => c.valor), [-10, -10]);

console.log("\n▸ Central: lote por competência — ordersContexto enxerga os irmãos de outro mês");
const irmaoOutroMes = fx.pedido(6002, { shipment: 7001, pack: 8005, dia: 10, itens: [["MLB200", 1, 100, 10]] });
irmaoOutroMes.date_created = "2026-11-01T00:30:00.000-03:00";
const loteOutubro = [fx.pedido(6001, { shipment: 7001, pack: 8005, itens: [["MLB100", 1, 100, 12.5]] })];
const sozinho = buildMotorFromOrders({ orders: loteOutubro, costMap, freteMap: new Map([["7001", { status: "real", valor: 20, receitaComprador: null }]]), clienteSlug: "cli", competencia: "2026-10" });
const comContexto = buildMotorFromOrders({ orders: loteOutubro, ordersContexto: [...loteOutubro, irmaoOutroMes], costMap, freteMap: new Map([["7001", { status: "real", valor: 20, receitaComprador: null }]]), clienteSlug: "cli", competencia: "2026-10" });
eq("sem contexto: lote com 1 pedido = valor cheio (comportamento anterior)", sozinho.componentes.find((c) => c.tipo === "frete_seller").valor, -20);
eq("com contexto (sync passa todos os pedidos do run): recebe a sua parte (10,00)", comContexto.componentes.find((c) => c.tipo === "frete_seller").valor, -10);

console.log(`\n${checks} verificações passaram.`);
