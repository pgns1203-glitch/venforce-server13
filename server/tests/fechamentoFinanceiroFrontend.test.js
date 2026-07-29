// server/tests/fechamentoFinanceiroFrontend.test.js
// ETAPA 6 — carrega Portal/financeiro.js de verdade num DOM mínimo e verifica
// o que a tela mostra: Resultado Final nunca escondido, "LC Total" nunca
// recebendo o Resultado Final, banner de cobertura parcial e o conjunto
// obrigatório de métricas.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.strictEqual(actual, expected, `${label}: ${actual} !== ${expected}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

/* ── DOM mínimo ─────────────────────────────────────────────────────────── */

const ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function criarElemento(id) {
  const classes = new Set();
  const el = {
    id,
    hidden: false,
    value: "",
    _text: "",
    _html: "",
    children: new Map(),
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      contains: (n) => classes.has(n),
      toString: () => Array.from(classes).join(" "),
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    appendChild() {},
    click() {},
    focus() {},
    closest: () => el,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }),
    querySelectorAll: () => [],
    style: {},
  };

  Object.defineProperty(el, "textContent", {
    get: () => el._text,
    set: (v) => {
      el._text = v == null ? "" : String(v);
      // Comportamento real de textContent → innerHTML (usado por escapeHTML).
      el._html = el._text.replace(/[&<>"]/g, (c) => ESCAPE[c]);
    },
  });
  Object.defineProperty(el, "innerHTML", {
    get: () => el._html,
    set: (v) => {
      el._html = v == null ? "" : String(v);
    },
  });

  // Filho .vf-kpi__value / .vf-kpi__label sob demanda.
  el.querySelector = (selector) => {
    if (!el.children.has(selector)) el.children.set(selector, criarElemento(`${id}${selector}`));
    return el.children.get(selector);
  };
  el.previousElementSibling = null;

  return el;
}

const elementos = new Map();
function byId(id) {
  if (!elementos.has(id)) elementos.set(id, criarElemento(id));
  return elementos.get(id);
}
function kpiValor(id) {
  return byId(id).querySelector(".vf-kpi__value").textContent;
}

globalThis.window = globalThis;
globalThis.initLayout = () => {};
globalThis.fetch = () => Promise.reject(new Error("sem rede no teste"));
globalThis.localStorage = {
  getItem: (k) => (k === "vf-token" ? "token-de-teste" : null),
  setItem() {},
  removeItem() {},
};
globalThis.location = { replace() {}, href: "" };
globalThis.window.location = globalThis.location;
globalThis.URL = { createObjectURL: () => "blob:fake", revokeObjectURL() {} };
globalThis.document = {
  getElementById: byId,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => criarElemento("tmp"),
  addEventListener() {},
  removeEventListener() {},
  body: criarElemento("body"),
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const arquivo = path.join(__dirname, "..", "..", "Portal", "financeiro.js");
vm.runInThisContext(fs.readFileSync(arquivo, "utf8"), { filename: arquivo });

/* ── Fechamento parcial (Shopee, motor real) ────────────────────────────── */

console.log("\n▸ Shopee — fechamento parcial por dados financeiros");
{
  const data = {
    _vf_meta: { marketplace: "shopee", dataGeracao: "2026-07-29T12:00:00.000Z" },
    summary: {
      calculationMode: "real_financial",
      financialConfidence: "parcial",
      grossRevenueTotal: 200,
      paidRevenueTotal: 160,
      revenueWithCost: 100,
      revenueWithoutCost: 100,
      calculatedCoveragePercent: 50,
      contributionProfitTotal: 40,
      averageContributionMargin: 0.4,
      contributionMarginCalculated: 0.4,
      finalResult: 10,
      finalMarginCalculated: 0.1,
      tacos: 0.1,
      tacox: 0.17,
      refundsTotal: 0,
      refundsCount: 0,
    },
    unmatchedIds: ["SKU-SEM-CUSTO"],
    detailedRows: [],
  };

  renderFinResumo(data);
  renderFinResumoExecutivo(data);

  eq("card Receita Bruta Total", kpiValor("fin-bruto"), brl(200));
  eq("card LC Total mostra o LC, não o Resultado Final", kpiValor("fin-lc"), brl(40));
  ok("card LC Total não recebe o Resultado Final", kpiValor("fin-lc") !== brl(10));
  eq("card Resultado Final", kpiValor("fin-resultado"), brl(10));
  eq("Resultado Final não fica escondido na Shopee", byId("fin-resultado").hidden, false);
  eq("card MC Calculada", kpiValor("fin-mc"), pct(0.4));
  eq("card MC Final", kpiValor("fin-mc-final"), pct(0.1));
  eq("card TACoS", kpiValor("fin-tacos"), pct(0.1));
  eq("card TACoX", kpiValor("fin-tacox"), pct(0.17));

  eq("exec: receita com custo", byId("fin-exec-receita-com-custo").textContent, brl(100));
  eq("exec: receita sem custo", byId("fin-exec-receita-sem-custo").textContent, brl(100));
  eq("exec: cobertura da base", byId("fin-exec-cobertura").textContent, pct(0.5));
  eq("exec: LC Total", byId("fin-exec-lc-total").textContent, brl(40));
  eq("exec: Resultado Final", byId("fin-exec-resultado-final").textContent, brl(10));
  eq("exec: MC Final", byId("fin-exec-mc-final").textContent, pct(0.1));
  eq("exec: TACoX", byId("fin-exec-tacox").textContent, pct(0.17));
  ok(
    "exec: status do fechamento identifica motor e confiança",
    byId("fin-exec-status-fechamento").textContent === "Fechamento por dados financeiros · Parcial"
  );

  const banner = byId("fin-cobertura-banner");
  eq("banner de cobertura visível", banner.hidden, false);
  ok(
    "banner traz o texto de fechamento parcial",
    banner.innerHTML.includes("Fechamento parcial: existem vendas sem custo cadastrado.")
  );
  ok(
    "banner explica que o faturamento total está completo",
    banner.innerHTML.includes("O faturamento total está completo")
  );
  ok(
    "banner nomeia o motor financeiro",
    banner.innerHTML.includes("Fechamento por dados financeiros")
  );

  const leitura = byId("fin-leitura");
  ok("leitura cita LC total e Resultado final separados", leitura.innerHTML.includes("LC total"));
  ok("leitura não chama o Resultado Final de LC Total", !leitura.innerHTML.includes("LC Total após"));
}

/* ── Estimativa por performance ─────────────────────────────────────────── */

console.log("\n▸ Shopee — estimativa por performance");
{
  const data = {
    _vf_meta: { marketplace: "shopee" },
    summary: {
      calculationMode: "estimated_performance",
      financialConfidence: "confiavel",
      grossRevenueTotal: 300,
      paidRevenueTotal: 300,
      revenueWithCost: 300,
      revenueWithoutCost: 0,
      calculatedCoveragePercent: 100,
      contributionProfitTotal: 90,
      contributionMarginCalculated: 0.3,
      finalResult: 60,
      finalMarginCalculated: 0.2,
      tacos: 0.1,
      tacox: 0.1,
    },
    unmatchedIds: [],
    detailedRows: [],
  };

  renderFinResumo(data);
  renderFinResumoExecutivo(data);

  const banner = byId("fin-cobertura-banner");
  eq("banner ainda aparece para informar o modo", banner.hidden, false);
  ok(
    "banner marca a estimativa por performance",
    banner.innerHTML.includes("Estimativa por performance")
  );
  ok(
    "cobertura total não dispara aviso de parcial",
    !banner.innerHTML.includes("Fechamento parcial")
  );
  eq("exec: cobertura 100%", byId("fin-exec-cobertura").textContent, pct(1));
  eq("LC Total continua sendo o LC", kpiValor("fin-lc"), brl(90));
  eq("Resultado Final continua visível", kpiValor("fin-resultado"), brl(60));
}

/* ── Payload do relatório do cliente ────────────────────────────────────── */

console.log("\n▸ Payload do relatório para o cliente");
{
  const data = {
    _vf_meta: { marketplace: "shopee", dataGeracao: "2026-07-29T12:00:00.000Z", cliente: {} },
    summary: {
      calculationMode: "real_financial",
      financialConfidence: "parcial",
      grossRevenueTotal: 200,
      paidRevenueTotal: 160,
      revenueWithCost: 100,
      revenueWithoutCost: 100,
      calculatedCoveragePercent: 50,
      contributionProfitTotal: 40,
      averageContributionMargin: 0.4,
      contributionMarginCalculated: 0.4,
      finalResult: 10,
      finalMarginCalculated: 0.1,
      tacos: 0.1,
      tacox: 0.17,
      cancelledCount: 2,
    },
    unmatchedIds: ["SKU-X"],
    detailedRows: [],
    ignoredRevenue: 100,
  };

  const payload = montarPayloadFechamentoCliente(data);
  const titulos = payload.cards.map((card) => card.titulo);

  for (const obrigatorio of [
    "Receita Bruta Total",
    "Receita com custo",
    "Receita sem custo",
    "Cobertura da base",
    "LC Total",
    "MC Calculada",
    "Resultado Final",
    "MC Final",
    "TACoS",
    "TACoX",
  ]) {
    ok(`card obrigatório presente: ${obrigatorio}`, titulos.includes(obrigatorio));
  }

  const cardLc = payload.cards.find((card) => card.titulo === "LC Total");
  const cardResultado = payload.cards.find((card) => card.titulo === "Resultado Final");
  eq("card LC Total carrega o LC", cardLc.raw, 40);
  eq("card Resultado Final carrega o resultado", cardResultado.raw, 10);
  ok("LC Total e Resultado Final são cards distintos", cardLc.raw !== cardResultado.raw);

  ok(
    "resumo executivo avisa do fechamento parcial",
    payload.resumoExecutivo.includes("Fechamento parcial")
  );
  ok(
    "existe seção de fechamento parcial",
    payload.secoes.some((secao) => secao.titulo === "Fechamento parcial")
  );
  eq("severidade em atenção", payload.metadados.severidade, "atencao");
  eq("cobertura no snapshot", payload.snapshot.metricasDerivadas.cobertura, 50);
  eq(
    "confiança no snapshot",
    payload.snapshot.metricasDerivadas.financialConfidence,
    "parcial"
  );
}

/* ── Limpeza de estado ──────────────────────────────────────────────────── */

console.log("\n▸ Limpeza de estado");
{
  limparFinStats();
  limparFinResumoExecutivo();
  limparCoberturaBanner();

  eq("cards zerados", kpiValor("fin-lc"), "—");
  eq("MC Final zerada", kpiValor("fin-mc-final"), "—");
  eq("TACoX zerado", kpiValor("fin-tacox"), "—");
  eq("status do fechamento zerado", byId("fin-exec-status-fechamento").textContent, "—");
  eq("banner escondido", byId("fin-cobertura-banner").hidden, true);
}

console.log(`\n${checks} verificações passaram. Frontend do fechamento OK.`);
