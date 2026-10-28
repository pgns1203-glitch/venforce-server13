// server/tests/sentinelCustoParidade.test.js
//
// Sentinel (Pedidos ao vivo, Fase 1) — testes puros, sem banco e sem rede.
//   1. Paridade da resolução de custo com o FECHAMENTO (processMeli): mesma
//      base, mesmo item → mesmo custo / mesma classificação (model_id, SKU,
//      MLB único, MLB ambíguo, sem custo).
//   2. costMap do Sentinel no formato de buildCostMap e margem igual à do
//      motor da Central para o mesmo pedido.
//   3. Estados do pedido (confirmada / provisoria / sem_custo / custo_ambiguo).
//   4. Janelas com bissecção quando a Orders API trunca.
//   5. Flag OFF: nenhum timer.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/vf-test-dead";

const assert = require("assert");
const { processMeli } = require("../services/fechamentoFinanceiro/meliFinanceiroService");
const { buildMotorFromOrders, buildCostMap, getCost } = require("../services/centralVendas/centralVendasSyncService");
const { construirIndiceCusto, resolverCustoItem, montarCostMap } = require("../services/sentinel/sentinelCusto");
const { calcularPedido } = require("../services/sentinel/sentinelPedidoService");
const { fetchOrdersUpdatedSince } = require("../services/sentinel/sentinelOrdersFetch");
const { iniciar: iniciarWorker } = require("../workers/sentinelWorker");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// Base no formato da tabela `custos` (MELI: sku_id = '').
const BASE = [
  { produto_id: "MLB101", custo_produto: "95.00", imposto_percentual: "6", id_model: "177", sku: "" },
  { produto_id: "MLB101", custo_produto: "42.00", imposto_percentual: "6", id_model: "188", sku: "" },
  { produto_id: "MLB300", custo_produto: "30.00", imposto_percentual: "4", id_model: null, sku: "SKU-A" },
  { produto_id: "MLB300", custo_produto: "31.00", imposto_percentual: "4", id_model: null, sku: "SKU-B" },
  { produto_id: "MLB400", custo_produto: "50.00", imposto_percentual: "10", id_model: null, sku: "" },
  { produto_id: "MLB500", custo_produto: "10.00", imposto_percentual: "5", id_model: "11", sku: "" },
  { produto_id: "MLB500", custo_produto: "20.00", imposto_percentual: "5", id_model: "22", sku: "" },
];

// O que o fechamento recebe da MESMA base (mapeamento de
// baseCustosService.js:870-875, + sku).
const BASE_FECHAMENTO = BASE.map((row) => ({
  "# de anúncio": row.produto_id,
  "preço de custo": row.custo_produto,
  imposto: row.imposto_percentual,
  model_id: row.id_model || "",
  sku: row.sku || "",
}));

function fechamento(mlb, { model = "", sku = "" } = {}) {
  const venda = [{
    "N.º de venda": "V-1",
    "Data da venda": "03/08/2026",
    Estado: "Pago",
    "# de anúncio": mlb,
    model_id: model,
    sku,
    "Título do anúncio": "Produto",
    Unidades: 1,
    "Preço unitário de venda do anúncio (BRL)": 189.9,
    "Receita por produtos (BRL)": 189.9,
    "Total (BRL)": 150,
  }];
  const row = processMeli(venda, BASE_FECHAMENTO, 0, 0, 0).detailedRows[0];
  const cobertura = row["Cobertura de custo"];
  return {
    estado: cobertura === "com custo" ? "ok" : cobertura === "custo ambíguo" ? "custo_ambiguo" : "sem_custo",
    cost: cobertura === "com custo" ? row["Preço de custo"] : null,
  };
}

function orderItem(mlb, { variationId = null, sku = null } = {}) {
  return { item: { id: mlb, variation_id: variationId, seller_sku: sku, title: "Produto" }, quantity: 1, unit_price: 189.9, sale_fee: 20 };
}

const indice = construirIndiceCusto(BASE);

console.log("\n▸ Paridade da resolução de custo com o fechamento");
const CASOS = [
  { nome: "match por model_id", mlb: "MLB101", fe: { model: "188" }, oi: { variationId: 188 }, origem: "model_id", cost: 42 },
  { nome: "match por SKU", mlb: "MLB300", fe: { sku: "SKU-B" }, oi: { sku: "SKU-B" }, origem: "sku", cost: 31 },
  { nome: "MLB único", mlb: "MLB400", fe: {}, oi: {}, origem: "mlb", cost: 50 },
  { nome: "MLB ambíguo (variações sem desempate no item)", mlb: "MLB500", fe: {}, oi: {}, origem: "mlb", cost: null, estado: "custo_ambiguo" },
  { nome: "MLB ambíguo (variação do item não existe na base)", mlb: "MLB500", fe: { model: "33" }, oi: { variationId: 33 }, origem: "mlb", cost: null, estado: "custo_ambiguo" },
  { nome: "MLB fora da base", mlb: "MLB999", fe: {}, oi: {}, origem: null, cost: null, estado: "sem_custo" },
];
for (const caso of CASOS) {
  const f = fechamento(caso.mlb, caso.fe);
  const s = resolverCustoItem(indice, orderItem(caso.mlb, caso.oi));
  const esperado = caso.estado || "ok";
  eq(`${caso.nome}: fechamento → ${esperado}`, f.estado, esperado);
  eq(`${caso.nome}: Sentinel = fechamento (estado)`, s.estado, f.estado);
  eq(`${caso.nome}: Sentinel = fechamento (custo)`, s.cost, f.cost);
  eq(`${caso.nome}: origem do custo`, s.origem, caso.origem);
}

console.log("\n▸ costMap e margem iguais aos da Central");
const r400 = resolverCustoItem(indice, orderItem("MLB400"));
const { costMap } = montarCostMap([r400]);
const centralMap = buildCostMap([BASE[4]]);
eq("entrada do costMap = buildCostMap da Central", getCost(costMap, "MLB400"), getCost(centralMap, "MLB400"));

const ORDER = {
  id: 2000001,
  status: "paid",
  date_created: "2026-10-22T10:00:00.000-03:00",
  date_last_updated: "2026-10-22T11:00:00.000-03:00",
  shipping: { id: 9001, logistic_type: "cross_docking" },
  order_items: [
    { item: { id: "MLB400", title: "P", seller_sku: null, variation_id: null }, quantity: 2, unit_price: 100, sale_fee: 12.5 },
  ],
};
const FRETE_REAL = { valor: 18.4, status: "real", receitaComprador: 0 };
const central = buildMotorFromOrders({
  orders: [ORDER], costMap: centralMap, freteMap: new Map([["9001", FRETE_REAL]]), clienteSlug: "x", competencia: "2026-10",
}).pedidos[0];
const sentinel = calcularPedido({ order: ORDER, freteEntry: FRETE_REAL, indiceCusto: indice, clienteSlug: "x" });
eq("margem_valor = lucroContribuicao da Central (R$ 0,00 de diferença)", sentinel.margem_valor, central.lucroContribuicao);
eq("margem_pct = margemContribuicaoPercentual da Central", sentinel.margem_pct, central.margemContribuicaoPercentual);
eq("componentes: faturamento/comissão/frete/custo/imposto",
  [sentinel.faturamento, sentinel.comissao, sentinel.frete, sentinel.custo, sentinel.imposto], [200, 25, 18.4, 100, 20]);
eq("tudo real → confirmada", sentinel.estado_margem, "confirmada");
eq("competência pelo mês de date_created", sentinel.competencia, "2026-10");

console.log("\n▸ Estados");
const semFrete = calcularPedido({ order: ORDER, freteEntry: { valor: null, status: "ausente" }, indiceCusto: indice, clienteSlug: "x" });
eq("sem frete → provisoria", semFrete.estado_margem, "provisoria");
ok("sem frete → pendência sem_frete", semFrete.pendencias.includes("sem_frete"));
eq("sem frete: margem = a da Central com o mesmo frete ausente", semFrete.margem_valor,
  buildMotorFromOrders({ orders: [ORDER], costMap: centralMap, clienteSlug: "x", competencia: "2026-10" }).pedidos[0].lucroContribuicao);

const semImposto = calcularPedido({
  order: ORDER, freteEntry: FRETE_REAL, clienteSlug: "x",
  indiceCusto: construirIndiceCusto([{ ...BASE[4], imposto_percentual: null }]),
});
eq("imposto ausente → provisoria", semImposto.estado_margem, "provisoria");
ok("imposto ausente → pendência sem_imposto e imposto NULL", semImposto.pendencias.includes("sem_imposto") && semImposto.imposto === null);

const orderSemCusto = { ...ORDER, order_items: [...ORDER.order_items, orderItem("MLB999")] };
const semCusto = calcularPedido({ order: orderSemCusto, freteEntry: FRETE_REAL, indiceCusto: indice, clienteSlug: "x" });
eq("item sem custo → sem_custo", semCusto.estado_margem, "sem_custo");
eq("sem_custo → margem_valor/margem_pct/custo/imposto NULL",
  [semCusto.margem_valor, semCusto.margem_pct, semCusto.custo, semCusto.imposto], [null, null, null, null]);
ok("sem_custo preserva faturamento e frete", semCusto.faturamento > 0 && semCusto.frete === 18.4);

const orderAmbiguo = { ...ORDER, order_items: [orderItem("MLB500")] };
const ambiguo = calcularPedido({ order: orderAmbiguo, freteEntry: FRETE_REAL, indiceCusto: indice, clienteSlug: "x" });
eq("MLB ambíguo → custo_ambiguo", ambiguo.estado_margem, "custo_ambiguo");
eq("custo_ambiguo → margem_valor NULL", ambiguo.margem_valor, null);

const orderDuasVariacoes = { ...ORDER, order_items: [orderItem("MLB101", { variationId: 177 }), orderItem("MLB101", { variationId: 188 })] };
const duas = calcularPedido({ order: orderDuasVariacoes, freteEntry: FRETE_REAL, indiceCusto: indice, clienteSlug: "x" });
eq("mesmo MLB com custos diferentes no pedido → custo_ambiguo (o motor busca por MLB)", duas.estado_margem, "custo_ambiguo");
ok("… com a pendência explicada", duas.pendencias.includes("mlb_repetido_com_custos_diferentes"));

(async () => {
  console.log("\n▸ Janelas com bissecção");
  const H = 3600 * 1000;
  const inicio = Date.parse("2026-10-22T00:00:00.000Z");
  // 6 pedidos espalhados em 6h. A Orders API "trunca" (teto de 1 página de 50
  // simulado com limite 4) qualquer janela com mais de 4 pedidos.
  const pedidos = [0.5, 1, 1.5, 3.5, 4, 5].map((h, i) => ({ id: 100 + i, date_last_updated: new Date(inicio + h * H).toISOString() }));
  const chamadas = [];
  const fakeFetch = async (_c, path) => {
    const qs = new URLSearchParams(path.split("?")[1]);
    const from = Date.parse(qs.get("order.date_last_updated.from").replace("-00:00", "Z"));
    const to = Date.parse(qs.get("order.date_last_updated.to").replace("-00:00", "Z"));
    chamadas.push([from, to]);
    const dentro = pedidos.filter((p) => Date.parse(p.date_last_updated) >= from && Date.parse(p.date_last_updated) <= to);
    // offset sempre 0 com maxPages=1: devolve no máximo 4, total real
    return { ok: true, status: 200, data: { paging: { total: dentro.length }, results: dentro.slice(0, 4) } };
  };
  const PAGINA = 4;
  const fetchComTeto = async (c, path, o) => {
    const r = await fakeFetch(c, path, o);
    r.data.results = r.data.results.slice(0, PAGINA);
    return r;
  };
  // maxPages=1 + PAGE_LIMIT 50 → "bateuTeto" só quando total > recebidos.
  const { janelas } = await fetchOrdersUpdatedSince(
    { clienteId: 1, sellerId: "S" }, new Date(inicio).toISOString(),
    { nowMs: inicio + 6 * H, mlFetchFn: fetchComTeto, config: { maxPages: 1, windowMaxMs: 6 * H, windowMinMs: 15 * 60 * 1000 } }
  );
  ok("a janela de 6h truncou e foi dividida", janelas.length >= 2 && chamadas.length >= 3);
  ok("todas as sub-janelas ficaram completas", janelas.every((j) => j.complete));
  const ids = new Set(janelas.flatMap((j) => j.orders.map((o) => o.id)));
  eq("todos os 6 pedidos foram buscados", [...ids].sort(), pedidos.map((p) => p.id));
  eq("as sub-janelas cobrem o intervalo inteiro, em ordem", [janelas[0].fromMs, janelas[janelas.length - 1].toMs], [inicio, inicio + 6 * H]);

  // Truncamento que não some nem na janela mínima: para ali.
  const sempreTrunca = async () => ({ ok: true, status: 200, data: { paging: { total: 999 }, results: [{ id: 1 }] } });
  const r2 = await fetchOrdersUpdatedSince(
    { clienteId: 1, sellerId: "S" }, new Date(inicio).toISOString(),
    { nowMs: inicio + 12 * H, mlFetchFn: sempreTrunca, config: { maxPages: 1, windowMaxMs: 6 * H, windowMinMs: 15 * 60 * 1000 } }
  );
  const ultima = r2.janelas[r2.janelas.length - 1];
  ok("truncada na janela mínima → última janela incompleta", ultima.complete === false);
  ok("… já na janela mínima (a metade dela teria < 15 min)", (ultima.toMs - ultima.fromMs) / 2 < 15 * 60 * 1000);
  ok("… e nada depois dela foi buscado", ultima.toMs < inicio + 12 * H);

  console.log("\n▸ Flag OFF");
  const logs = [];
  const t = await iniciarWorker({ env: {}, logger: { log: (m) => logs.push(m), error: () => {} }, criarPool: () => { throw new Error("não deveria criar pool"); } });
  eq("sem SENTINEL_WORKER_ENABLED → não inicia", t.iniciado, false);
  ok("… e loga OFF", logs.some((m) => m.includes("OFF")));

  console.log(`\n${checks} verificações passaram. Sentinel: custo/margem/janelas protegidos.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
