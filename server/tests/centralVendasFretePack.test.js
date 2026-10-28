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

console.log("\n▸ B3: pedido fora do resultado tem PESO ZERO; o custo vai inteiro para quem entra no resultado");
const packCanc = [
  fx.pedido(5001, { shipment: 7001, pack: 8004, itens: [["MLB100", 1, 100, 12.5]] }),
  fx.pedido(5002, { shipment: 7001, pack: 8004, status: "cancelled", itens: [["MLB200", 1, 100, 10]] }),
];
const mc = motorPack(packCanc, { status: "real", valor: 20, receitaComprador: 6 });
eq("1 pago + 1 cancelado, shipment 20,00 ⇒ pago 20,00 / cancelado 0,00", mc.componentes.filter((c) => c.tipo === "frete_seller").map((c) => [c.pedidoId, c.valor === 0 ? 0 : c.valor]), [["5001", -20], ["5002", 0]]);
eq("receita_envio idem (6,00 inteira no pago)", mc.componentes.filter((c) => c.tipo === "receita_envio").map((c) => [c.pedidoId, c.valor]), [["5001", 6], ["5002", 0]]);
const packTodosFora = [
  fx.pedido(5101, { shipment: 7001, pack: 8010, status: "cancelled", itens: [["MLB100", 1, 100, 12.5]] }),
  fx.pedido(5102, { shipment: 7001, pack: 8010, status: "cancelled", itens: [["MLB200", 1, 300, 10]] }),
];
const mt = motorPack(packTodosFora, { status: "real", valor: 20, receitaComprador: null });
eq("todos fora do resultado ⇒ rateio pela receita (informativo): 5,00 / 15,00", mt.componentes.filter((c) => c.tipo === "frete_seller").map((c) => c.valor), [-5, -15]);
const packDevolvido = [
  fx.pedido(5201, { shipment: 7001, pack: 8011, itens: [["MLB100", 1, 100, 12.5]] }),
  fx.pedido(5202, { shipment: 7001, pack: 8011, itens: [["MLB200", 1, 100, 10]] }),
];
const claimsMap = new Map([["5202", [{ id: 1, type: "mediations", status: "opened" }]]]);
const mdev = buildMotorFromOrders({ orders: packDevolvido, costMap, freteMap: new Map([["7001", { status: "real", valor: 20, receitaComprador: null }]]), claimsMap, clienteSlug: "cli", competencia: "2026-10" });
ok("status efetivo (pós-venda) também decide o peso: soma continua == 20,00", somaComp(mdev, "frete_seller") === 2000);

console.log("\n▸ B4: allocateFrete em centavos pelo maior resto (sem parcela negativa)");
const quatroItens = [fx.pedido(5301, { shipment: 7099, itens: [["MLB100", 1, 10, 1], ["MLB200", 1, 10, 1], ["MLB300", 1, 10, 1], ["MLB100", 1, 10, 1]] })];
const m4 = buildMotorFromOrders({ orders: quatroItens, costMap, freteMap: new Map([["7099", { status: "real", valor: 0.02, receitaComprador: null }]]), clienteSlug: "cli", competencia: "2026-10" });
const partes = m4.componentes.filter((c) => c.tipo === "frete_seller").map((c) => Math.abs(c.valor));
ok("R$0,02 em 4 itens: nenhuma parcela negativa", m4.componentes.filter((c) => c.tipo === "frete_seller").every((c) => c.valor <= 0));
eq("Σ == 0,02 (antes: 0,01+0,01+0,01−0,01 ⇒ Math.abs somava 0,04)", cents(partes.reduce((s, v) => s + v, 0)), 2);
eq("distribuição pelo maior resto, sobra no último", partes, [0, 0, 0.01, 0.01]);
const { repartirCentavos } = require("../services/centralVendas/centralVendasEnvioCompartilhado");
for (const [total, pesos] of [[10, [1, 1, 1]], [0.01, [1, 1, 1]], [18.4, [2, 1]], [99.99, [3, 7, 11]], [5, [0, 0]], [1.01, [1, 2, 3, 4, 5]]]) {
  const r = repartirCentavos(total, pesos);
  ok(`repartirCentavos(${total}, [${pesos}]) Σ exata e sem negativos`, r.every((v) => v >= 0) && cents(r.reduce((s, v) => s + v, 0)) === cents(total));
}
eq("null ⇒ null", repartirCentavos(null, [1, 2]), [null, null]);

console.log("\n▸ Central: lote por competência — ordersContexto enxerga os irmãos de outro mês");
const irmaoOutroMes = fx.pedido(6002, { shipment: 7001, pack: 8005, dia: 10, itens: [["MLB200", 1, 100, 10]] });
irmaoOutroMes.date_created = "2026-11-01T00:30:00.000-03:00";
const loteOutubro = [fx.pedido(6001, { shipment: 7001, pack: 8005, itens: [["MLB100", 1, 100, 12.5]] })];
const sozinho = buildMotorFromOrders({ orders: loteOutubro, costMap, freteMap: new Map([["7001", { status: "real", valor: 20, receitaComprador: null }]]), clienteSlug: "cli", competencia: "2026-10" });
const comContexto = buildMotorFromOrders({ orders: loteOutubro, ordersContexto: [...loteOutubro, irmaoOutroMes], costMap, freteMap: new Map([["7001", { status: "real", valor: 20, receitaComprador: null }]]), clienteSlug: "cli", competencia: "2026-10" });
eq("sem contexto: lote com 1 pedido = valor cheio (comportamento anterior)", sozinho.componentes.find((c) => c.tipo === "frete_seller").valor, -20);
eq("com contexto (sync passa todos os pedidos do run): recebe a sua parte (10,00)", comContexto.componentes.find((c) => c.tipo === "frete_seller").valor, -10);

(async () => {
console.log("\n▸ B1: resolver de packs da Central (GET /packs por pack_id distinto + irmãos fora do run)");
const { resolverPacksDoRun } = require("../services/centralVendas/centralVendasPackResolver");
function mlPack({ packs, pedidos = [], falhas = {} }) {
  const log = [];
  const fn = async (_c, p, o = {}) => {
    log.push({ p, o });
    if (Array.isArray(falhas[p]) && falhas[p].length) return falhas[p].shift();
    if (falhas[p] && !Array.isArray(falhas[p])) return falhas[p];
    const mp = /^\/packs\/(\d+)$/.exec(p);
    if (mp) { const k = packs[mp[1]]; return k ? { ok: true, status: 200, data: { shipment: { id: k.shipment }, orders: k.orders.map((id) => ({ id })) } } : { ok: false, status: 404 }; }
    const mo = /^\/orders\/(\d+)$/.exec(p);
    if (mo) { const x = pedidos.find((q) => String(q.id) === mo[1]); return x ? { ok: true, status: 200, data: x } : { ok: false, status: 404 }; }
    return { ok: false, status: 404 };
  };
  fn.log = log;
  return fn;
}
const nov = fx.pedido(6102, { shipment: 7001, pack: 8100, itens: [["MLB200", 1, 100, 10]] });
nov.date_created = "2026-11-01T00:10:00.000-03:00";
const out = fx.pedido(6101, { shipment: 7001, pack: 8100, itens: [["MLB100", 1, 100, 12.5]] });
const livre = fx.pedido(6200, { shipment: 7500, itens: [["MLB100", 1, 100, 12.5]] }); // sem pack_id
const mlOk = mlPack({ packs: { 8100: { shipment: 7001, orders: [6101, 6102] } }, pedidos: [nov] });
const r1 = await resolverPacksDoRun({ orders: [out, livre], clienteId: 1, sellerId: "5551", mlFetchFn: mlOk, sleepFn: async () => {} });
eq("irmão de OUTRO mês entra no contexto (A out + B nov)", r1.ordersContexto.map((o) => String(o.id)), ["6101", "6200", "6102"]);
eq("1 GET /packs por pack distinto (sem pack_id não consulta) + 1 irmão buscado", [mlOk.log.filter((c) => c.p.startsWith("/packs/")).length, mlOk.log.filter((c) => /^\/orders\//.test(c.p)).length], [1, 1]);
ok("mlUserId da conta em todas as chamadas", mlOk.log.every((c) => c.o.mlUserId === "5551"));
eq("resumo do run", [r1.resumo.packsConsultados, r1.resumo.packsIncompletos, r1.resumo.irmaosBuscados, r1.resumo.packsComVariosPedidos], [1, 0, 1, 1]);
const mOut = buildMotorFromOrders({ orders: [out], ordersContexto: r1.ordersContexto, packsIncompletos: r1.packsIncompletos, costMap, freteMap: new Map([["7001", { status: "real", valor: 20, receitaComprador: 4 }]]), clienteSlug: "cli", competencia: "2026-10" });
eq("A (out) recebe 10,00, não o valor cheio; receita_envio 2,00", [mOut.componentes.find((c) => c.tipo === "frete_seller").valor, mOut.componentes.find((c) => c.tipo === "receita_envio").valor], [-10, 2]);
// 2 pedidos do mesmo pack no run ⇒ 1 só GET /packs
const mlDois = mlPack({ packs: { 8100: { shipment: 7001, orders: [6101, 6102] } } });
const r2 = await resolverPacksDoRun({ orders: [out, nov], clienteId: 1, sellerId: "5551", mlFetchFn: mlDois, sleepFn: async () => {} });
eq("pack com os 2 pedidos no run: 1 GET /packs, 0 GET /orders", [mlDois.log.length, r2.resumo.irmaosBuscados], [1, 0]);

for (const [rot, falhas] of [
  ["/packs 503 em todas as tentativas", { "/packs/8100": { ok: false, status: 503 } }],
  ["/packs lança (timeout)", { "/packs/8100": { ok: false, status: null } }],
  ["irmão indisponível (404)", { "/orders/6102": { ok: false, status: 404 } }],
]) {
  const mlF = mlPack({ packs: { 8100: { shipment: 7001, orders: [6101, 6102] } }, pedidos: [nov], falhas });
  const rf = await resolverPacksDoRun({ orders: [out], clienteId: 1, sellerId: "5551", mlFetchFn: mlF, sleepFn: async () => {} });
  ok(`${rot} ⇒ pack incompleto`, rf.packsIncompletos.has("8100") && rf.resumo.packsIncompletos === 1);
  const mf = buildMotorFromOrders({ orders: [out], ordersContexto: rf.ordersContexto, packsIncompletos: rf.packsIncompletos, costMap, freteMap: new Map([["7001", { status: "real", valor: 20, receitaComprador: 4 }]]), clienteSlug: "cli", competencia: "2026-10" });
  ok(`${rot}: frete_seller e receita_envio NULL (nunca cheio, nunca 0) + pendência frete_pack_incompleto`,
    mf.componentes.filter((c) => c.tipo === "frete_seller" || c.tipo === "receita_envio").every((c) => c.valor === null) && mf.pedidos[0].pendencias.includes("frete_pack_incompleto"));
}
const esperas = [];
const mlRetry = mlPack({ packs: { 8100: { shipment: 7001, orders: [6101] } }, falhas: { "/packs/8100": [{ ok: false, status: 429, retryAfter: 3 }] } });
const r3 = await resolverPacksDoRun({ orders: [out], clienteId: 1, sellerId: "5551", mlFetchFn: mlRetry, sleepFn: async (ms) => { esperas.push(ms); } });
eq("429 com Retry-After respeitado e retentado; pack de 1 pedido não é incompleto", [esperas, r3.packsIncompletos.size], [[3000], 0]);
const mlDiverge = mlPack({ packs: { 8100: { shipment: 9999, orders: [6101] } } });
eq("shipment do pack ≠ shipment do pedido ⇒ incompleto", (await resolverPacksDoRun({ orders: [out], clienteId: 1, sellerId: "5551", mlFetchFn: mlDiverge, sleepFn: async () => {} })).packsIncompletos.has("8100"), true);
const mlSemPedido = mlPack({ packs: { 8100: { shipment: 7001, orders: [1] } } });
eq("pack que não lista o pedido ⇒ incompleto", (await resolverPacksDoRun({ orders: [out], clienteId: 1, sellerId: "5551", mlFetchFn: mlSemPedido, sleepFn: async () => {} })).packsIncompletos.has("8100"), true);

console.log(`\n${checks} verificações passaram.`);
})().catch((e) => { console.error(e); process.exit(1); });
