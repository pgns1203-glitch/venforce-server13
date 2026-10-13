// server/tests/financeiroV3ParidadeLegado.test.js
//
// AUDITORIA "V3 × legado mostram resultados diferentes" — a parte que se
// prova em código: dado o MESMO `summary` do motor, as duas telas mostram os
// MESMOS números? Roda o Portal/financeiro.js REAL (finMetricas, num DOM
// mínimo, mesmo idioma de fechamentoFinanceiroFrontend.test.js) contra a
// leitura REAL da V3 (frontend-react/src/utils/financeiro/resumoFechamento.js,
// importada como ESM). Nada é reimplementado aqui.
//
// O que este teste NÃO cobre — e por isso fica registrado no relatório: o
// request. O motor é o mesmo (POST /fechamentos/financeiro), mas o legado e a
// V3 não mandam a mesma ORIGEM DE CUSTOS (Shopee: legado sempre com planilha
// enviada, V3 com a base vinculada; MELI de conta única: legado manda
// costsBaseId = 1º vínculo do cliente, V3 manda clienteContaId e deixa o
// servidor escolher a base da conta). Com entradas diferentes, números
// diferentes são esperados — não é divergência de cálculo nem de tela.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");
const { pathToFileURL } = require("url");

let checks = 0;
function eq(label, actual, expected) {
  assert.strictEqual(actual, expected, `${label}: ${actual} !== ${expected}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

/* ── DOM mínimo para carregar o legado ──────────────────────────────────── */
function criarElemento(id) {
  const el = {
    id, hidden: false, value: "", textContent: "", innerHTML: "", style: {}, dataset: {},
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild() {}, click() {}, focus() {}, closest: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }),
  };
  el.querySelector = () => criarElemento(`${id}-filho`);
  return el;
}
const elementos = new Map();
const byId = (id) => {
  if (!elementos.has(id)) elementos.set(id, criarElemento(id));
  return elementos.get(id);
};
globalThis.window = globalThis;
globalThis.initLayout = () => {};
globalThis.fetch = () => Promise.reject(new Error("sem rede no teste"));
globalThis.localStorage = { getItem: (k) => (k === "vf-token" ? "token-de-teste" : null), setItem() {}, removeItem() {} };
globalThis.location = { replace() {}, href: "" };
globalThis.URL = Object.assign(globalThis.URL || {}, { createObjectURL: () => "blob:fake", revokeObjectURL() {} });
globalThis.document = {
  getElementById: byId, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => criarElemento("tmp"), addEventListener() {}, removeEventListener() {}, body: criarElemento("body"),
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const LEGADO = path.join(__dirname, "..", "..", "Portal", "financeiro.js");
vm.runInThisContext(fs.readFileSync(LEGADO, "utf8"), { filename: LEGADO });
assert.strictEqual(typeof globalThis.finMetricas, "function", "finMetricas do legado não carregou");

/* ── Motor Shopee real (um summary de verdade, não só sintético) ────────── */
const originalLoad = Module._load;
Module._load = function stub(request, parent, isMain) {
  if (request === "xlsx") return { utils: { aoa_to_sheet: () => ({}), json_to_sheet: () => ({}) } };
  return originalLoad.call(this, request, parent, isMain);
};
const { buildShopeeCostMap } = require("../services/fechamentoFinanceiro/shopeePerformanceService");
const { processShopeeFinancialOrders } = require("../services/fechamentoFinanceiro/shopeeOrderAllService");
Module._load = originalLoad;

function linhaShopee(o) {
  return {
    "ID do pedido": "", "Status do pedido": "Concluído", "Status da devolução / reembolso": "", "Nome do produto": "Produto",
    "SKU da variação": "", Quantidade: 1, "Preço acordado": 0, "Subtotal do produto": 0, Repasse: "", "Total global": "",
    "Taxa de transação": "", "Taxa de comissão líquida": "", "Taxa de comissão bruta": "", "Taxa de serviço líquida": "",
    "Taxa de serviço bruta": "", "Valor estimado do frete": "", Imposto: "", CMV: "", ...o,
  };
}

async function main() {
  const V3 = await import(pathToFileURL(path.join(__dirname, "..", "..", "frontend-react", "src", "utils", "financeiro", "resumoFechamento.js")).href);

  // O que a V3 mostra para cada número que o legado mostra (mesma chave do summary).
  function v3(summary) {
    const k = Object.fromEntries(V3.kpisPrincipais(summary).map((i) => [i.chave, i.valor]));
    const cob = V3.coberturas(summary);
    return {
      gross: k.grossRevenueTotal, net: k.paidRevenueTotal, lcTotal: k.contributionProfitTotal, finalResult: k.finalResult,
      mcCalculada: k.mcCalculada ?? null, mcFinal: k.finalMarginCalculated ?? null, tacos: k.tacos ?? null, tacox: k.tacox ?? null,
      comCusto: cob.custo.receitaComCusto, semCusto: cob.custo.receitaSemCusto, cobertura: cob.custo.percentual,
    };
  }
  function comparar(rotulo, summary, campos = ["gross", "net", "lcTotal", "finalResult", "mcCalculada", "mcFinal", "tacos", "tacox", "comCusto", "semCusto", "cobertura"]) {
    const legado = globalThis.finMetricas({ summary });
    const nova = v3(summary);
    for (const c of campos) eq(`${rotulo} · ${c}: legado = V3`, nova[c], legado[c]);
  }

  console.log("\n▸ MELI — summary completo do motor (todas as chaves)");
  const meli = {
    calculationMode: "real_meli_vendas", financialConfidence: "parcial",
    grossRevenueTotal: 412880.5, paidRevenueTotal: 380000.2, revenueWithCost: 390000, revenueWithoutCost: 22880.5,
    calculatedCoveragePercent: 94.46, revenueWithFinancialData: 400000, revenuePendingFinancial: 12880.5, financialDataCoveragePercent: 96.88,
    contributionProfitTotal: 61000.4, averageContributionMargin: 0.15, contributionMarginCalculated: 0.1564, finalResult: 41000.1,
    finalMarginCalculated: 0.1051, tacos: 0.03, tacox: 0.047, adsTotal: 12000, venforceTotal: 5000, affiliatesTotal: 3000.3,
  };
  comparar("MELI", meli);

  console.log("\n▸ Shopee — summary do MOTOR REAL (processShopeeFinancialOrders)");
  const costMap = buildShopeeCostMap([{ sku: "SKU-A", custo: 10, imposto: 0.08 }]);
  const real = processShopeeFinancialOrders({
    salesRowsRaw: [
      linhaShopee({ "ID do pedido": "A", "Nome do produto": "Item A", "SKU da variação": "SKU-A", "Subtotal do produto": 70, "Preço acordado": 70, "Taxa de comissão líquida": -14, "Taxa de transação": -1.4 }),
      linhaShopee({ "ID do pedido": "B", "Nome do produto": "Item B", "SKU da variação": "SKU-B", "Subtotal do produto": 90, "Preço acordado": 90, "Taxa de comissão líquida": -12.6, "Taxa de transação": -1.8 }),
    ],
    costMap, ads: 20, venforce: 5, affiliates: 2,
  }).summary;
  ok("o motor real devolveu receita sem custo (SKU-B sem custo)", Number(real.revenueWithoutCost) > 0);
  comparar("Shopee real", real);

  console.log("\n▸ Reconciliação Shopee — mesmos campos, mesma base de comparação");
  const recon = { grossRevenueTotal: 50000, orderAllTotalCount: 120, orderAllTotalRevenue: 53000, orderAllCompletedCount: 80, orderAllCompletedRevenue: 36000, orderAllUnpaidCount: 5, orderAllUnpaidRevenue: 1500 };
  const r = V3.reconciliacaoShopee(recon);
  eq("Performance (pedidos pagos) = grossRevenueTotal, como no legado", r.performance, 50000);
  eq("Reconciliação (visão completa) = orderAllTotalRevenue", r.reconciliada, 53000);
  eq("sem grossRevenueTotal, cai para paidRevenueTotal (|| do legado)", V3.reconciliacaoShopee({ paidRevenueTotal: 900, orderAllTotalCount: 1 }).performance, 900);
  eq("Não pagos com a cor do legado (warning)", r.estados.find((e) => e.rotulo === "Não pagos").tom, "warning");

  console.log("\n▸ Bordas conhecidas (diferença de APRESENTAÇÃO, não de cálculo)");
  // Sem receita calculável o motor devolve a margem como null (safeRatio). O
  // legado então CALCULA no navegador LC ÷ receita (fallback de payloads
  // antigos); a V3 mostra "—" e não recalcula. Só acontece quando a base de
  // margem é zero — fica registrado para não ser confundido com bug.
  const semBase = { grossRevenueTotal: 1000, revenueWithCost: 0, contributionProfitTotal: 100, contributionMarginCalculated: null, finalResult: 50, finalMarginCalculated: null };
  const legadoSemBase = globalThis.finMetricas({ summary: semBase });
  eq("legado calcula MC no navegador (100 ÷ 1000)", legadoSemBase.mcCalculada, 0.1);
  eq("V3 mostra a ausência do motor (null → —)", v3(semBase).mcCalculada, null);
  comparar("sem base de margem · demais números", semBase, ["gross", "lcTotal", "finalResult", "comCusto"]);

  console.log(`\n${checks} verificações OK`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
