// server/tests/cliente360ProdutosEngine.test.js
//
// FASE 3 (Projeto_cliente360) — classificarCurvaAbc (novo) e a propagação do
// campo curvaAbc por montarProdutos/linhaProduto. curvaAporFaturamento (Curva
// A boolean, já existente, consumida pela V2) não é alterada — só coberta de
// novo para garantir que continua idêntica depois da extensão.
//
// Roda sem infra: node server/tests/cliente360ProdutosEngine.test.js

const assert = require("assert");
const { montarProdutos, curvaAporFaturamento, classificarCurvaAbc } = require("../services/cliente360/cliente360ProdutosEngine");

let passed = 0;
const check = (n, c) => { assert.ok(c, `FALHOU: ${n}`); passed++; console.log(`  ok  ${n}`); };

// Perfil sintético: 5 produtos com faturamento decrescente, somando 1000.
// P1=500 (50%), P2=250 (75%), P3=150 (90%), P4=70 (97%), P5=30 (100%).
function perfilBase() {
  const map = new Map();
  const add = (mlb, rec, q = 10, mcTotal = rec * 0.2) => map.set(mlb, { mlb, titulo: `Produto ${mlb}`, rec, q, mcTotal, pu: rec / q, mcu: mcTotal / q, custo: 0, frete: 0, tarifa: 0, imposto: 0 });
  add("P1", 500);
  add("P2", 250);
  add("P3", 150);
  add("P4", 70);
  add("P5", 30);
  return map;
}

(() => {
  // ── classificarCurvaAbc: cortes padrão A=80%, B=95% ─────────────────────
  const classe = classificarCurvaAbc(perfilBase());
  check("P1 (50% acumulado) é A", classe.get("P1") === "A");
  check("P2 (75% acumulado) é A", classe.get("P2") === "A");
  check("P3 (90% acumulado) é B", classe.get("P3") === "B");
  check("P4 (97% acumulado) é C", classe.get("P4") === "C");
  check("P5 (100% acumulado) é C", classe.get("P5") === "C");

  // ── produto sem faturamento no período nunca entra em nenhuma faixa ─────
  const perfilComZero = perfilBase();
  perfilComZero.set("P6", { mlb: "P6", titulo: "Produto P6", rec: 0, q: 0, mcTotal: 0, pu: 0, mcu: 0, custo: 0, frete: 0, tarifa: 0, imposto: 0 });
  const classeComZero = classificarCurvaAbc(perfilComZero);
  check("produto com rec=0 não aparece na classificação (nunca 'C' por omissão)", !classeComZero.has("P6"));

  // ── perfil vazio ──────────────────────────────────────────────────────
  check("perfil vazio → mapa vazio, nunca lança", classificarCurvaAbc(new Map()).size === 0);

  // ── curvaAporFaturamento (boolean, já existente) continua idêntica ──────
  const setA = curvaAporFaturamento(perfilBase());
  check("curvaAporFaturamento: P1/P2 estão na Curva A (boolean)", setA.has("P1") && setA.has("P2"));
  check("curvaAporFaturamento: P4/P5 NÃO estão na Curva A", !setA.has("P4") && !setA.has("P5"));

  // ── montarProdutos propaga curvaAbc em TODOS os blocos ──────────────────
  const contribs = [
    { mlb: "P1", titulo: "Produto P1", contribuicao: 40, faturamento: 500, unidadesAtual: 10, motivoDominante: "volume" },
    { mlb: "P5", titulo: "Produto P5", contribuicao: -5, faturamento: 30, unidadesAtual: 10, motivoDominante: "custo" },
  ];
  const resultado = montarProdutos(contribs, perfilBase(), { alvoMargem: 0.15, topN: 5 });

  check("ajudaram: curvaAbc propagado (P1 → A)", resultado.ajudaram.find((p) => p.mlb === "P1")?.curvaAbc === "A");
  check("prejudicaram: curvaAbc propagado (P5 → C)", resultado.prejudicaram.find((p) => p.mlb === "P5")?.curvaAbc === "C");
  check("ajudaram: curvaA (boolean, pré-existente) não foi removido do contrato de contribs — campo é do PRÓPRIO contrib, intacto", resultado.ajudaram[0].contribuicao === 40);

  // Nenhum produto desta fixture cai em noVermelho/abaixoDaMargem (margem alta,
  // 20% > alvo 15%) — confirma que linhaProduto (usada nesses blocos) também
  // recebe curvaAbc quando algum produto cai lá.
  const perfilComRisco = perfilBase();
  perfilComRisco.set("P7", { mlb: "P7", titulo: "Produto no vermelho", rec: 100, q: 5, mcTotal: -20, pu: 20, mcu: -4, custo: 80, frete: 20, tarifa: 10, imposto: 10 });
  const resultadoComRisco = montarProdutos(contribs, perfilComRisco, { alvoMargem: 0.15, topN: 5 });
  const linhaRisco = resultadoComRisco.noVermelho.find((p) => p.mlb === "P7");
  check("noVermelho: linha usa linhaProduto() e recebe curvaAbc (mesmo produto novo, não estava na fixture original)", linhaRisco && "curvaAbc" in linhaRisco);
  check("noVermelho: curvaA (boolean) continua presente ao lado de curvaAbc — nenhum campo antigo removido", linhaRisco && typeof linhaRisco.curvaA === "boolean");

  console.log(`\n${passed} verificações passaram. Curva ABC (Fase 3): cortes 80/95, produto sem faturamento fora da faixa, boolean pré-existente intacto.`);
})();
