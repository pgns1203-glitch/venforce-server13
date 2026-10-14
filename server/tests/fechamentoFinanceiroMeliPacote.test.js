// server/tests/fechamentoFinanceiroMeliPacote.test.js
//
// PACOTE de diversos produtos no export REAL de vendas do Mercado Livre
// (out/2026). Estrutura reproduzida do arquivo do cliente, com IDs anônimos:
//
//   PAI    Estado "Pacote de N produtos", sem MLB, com receita/tarifas/Total
//   FILHO  × N, cada um com o SEU N.º de venda, MLB, unidades e preço,
//          "Pacote de diversos produtos = Sim" e NENHUM campo financeiro
//
// O financeiro do pacote só existe no pai e é rateado (allocateByRevenue,
// regra existente) entre os filhos. Um filho de pacote não é venda com
// financeiro pendente; uma venda simples nunca é anexada ao pacote anterior.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const XLSX = require("xlsx");
const {
  processMeli,
  parseMeliRows,
  collectMeliAssociations,
} = require("../services/fechamentoFinanceiro/meliFinanceiroService");
const {
  processarFechamentoFinanceiroController,
} = require("../controllers/fechamentosFinanceiroController");
const { round2 } = require("../utils/numberUtils");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// Cabeçalhos exatos do export real (subconjunto que o motor lê).
const H = {
  venda: "N.º de venda",
  data: "Data de venda",
  estado: "Estado",
  pacote: "Pacote de diversos produtos",
  kit: "Pertence a um kit",
  un: "Unidades",
  rec: "Receita por produtos (BRL)",
  tv: "Tarifa de venda e impostos (BRL)",
  te: "Tarifas de envio (BRL)",
  desc: "Descontos e bônus",
  canc: "Cancelamentos e reembolsos (BRL)",
  tot: "Total (BRL)",
  sku: "SKU",
  mlb: "# de anúncio",
  tit: "Título do anúncio",
  pu: "Preço unitário de venda do anúncio (BRL)",
};
const HEADER = Object.values(H);

// parseSpreadsheet(raw:false) entrega texto; célula vazia vira "".
function linha(campos) {
  const row = {};
  for (const [k, header] of Object.entries(H)) {
    row[header] = campos[k] === undefined || campos[k] === null ? "" : String(campos[k]);
  }
  return row;
}
const DATA = "27 de setembro de 2026";
const pai = (venda, n, fin) => linha({ venda, data: DATA, estado: `Pacote de ${n} produtos`, ...fin });
const filho = (venda, mlb, pu, extra = {}) =>
  linha({ venda, data: DATA, estado: "Entregue", pacote: "Sim", kit: "Não", un: 1, mlb, tit: `Produto ${mlb}`, pu, ...extra });
const simples = (venda, mlb, pu, fin, extra = {}) =>
  linha({ venda, data: DATA, estado: "Entregue", pacote: "Não", kit: "Não", un: 1, mlb, tit: `Produto ${mlb}`, pu, rec: pu, ...fin, ...extra });

// Base de custo: custo e imposto por MLB.
const custo = (mlb, c, imp = 10) => ({ "# de anúncio": mlb, "Preço de custo": c, Imposto: imp });

function linhaDe(result, mlb) {
  return result.detailedRows.find((r) => r["# de anúncio"] === mlb);
}
function pendentes(result) {
  return result.detailedRows.filter((r) => r["Cobertura de custo"] === "financeiro pendente");
}
const soma = (rows, campo) => round2(rows.reduce((s, r) => s + Number(r[campo] || 0), 0));

// Pacote de 4 com os valores do exemplo real (N.º de venda e MLB anônimos).
const PACOTE_4 = [
  pai("2000000000000100", 4, { rec: 1172.34, tv: -153.48, te: -103.5, tot: 910.36 }),
  filho("2000000000000101", "MLB100000001", 296.9),
  filho("2000000000000102", "MLB100000002", 196.17),
  filho("2000000000000103", "MLB100000003", 499.9),
  filho("2000000000000104", "MLB100000004", 179.37),
];
const CUSTOS_4 = [
  custo("MLB100000001", 100), custo("MLB100000002", 60), custo("MLB100000003", 180), custo("MLB100000004", 50),
];

// ── Caso 1 — venda simples ────────────────────────────────────────────────
console.log("\n▸ Caso 1 — venda simples");
{
  const rows = [simples("2000000000000001", "MLB200000001", 109.9, { tv: -12.64, te: -17.15, tot: 80.11 })];
  const r = processMeli(rows, [custo("MLB200000001", 40)], 0, 0, 0);
  const l = linhaDe(r, "MLB200000001");
  eq("uma linha de produto", r.detailedRows.length, 1);
  eq("Total da própria linha", l["Total (BRL)"], 80.11);
  eq("com custo, financeiro disponível", l["Cobertura de custo"], "com custo");
  // LC = venda − imposto − (venda − total) − custo = 109,90 − 10,99 − 29,79 − 40
  eq("LC pela fórmula existente", l.LC, 29.12);
}

// ── Caso 2 — pacote com 2 produtos ────────────────────────────────────────
console.log("\n▸ Caso 2 — pacote com 2 produtos");
{
  const rows = [
    pai("2000000000000200", 2, { rec: 629.89, tv: -76.04, te: -54.1, tot: 499.75 }),
    filho("2000000000000201", "MLB300000001", 299.99),
    filho("2000000000000202", "MLB300000002", 329.9),
  ];
  const r = processMeli(rows, [custo("MLB300000001", 100), custo("MLB300000002", 110)], 0, 0, 0);
  eq("2 produtos no fechamento", r.detailedRows.length, 2);
  eq("nenhum produto como financeiro pendente", pendentes(r).length, 0);
  eq("Σ Total dos filhos = Total do pai", soma(r.detailedRows, "Total (BRL)"), 499.75);
  eq("Σ venda dos filhos = receita do pai", soma(r.detailedRows, "Venda Total"), 629.89);
  eq("faturamento sem duplicar", r.summary.grossRevenueTotal, 629.89);
  eq("Total sem duplicar", r.summary.paidRevenueTotal, 499.75);
  eq("1 venda reconhecida (o pacote)", r.parsingDiagnostics.recognizedSalesCount, 1);
}

// ── Caso 3 — pacote com 4 produtos e N.º de venda diferentes ──────────────
console.log("\n▸ Caso 3 — pacote com 4 produtos, cada filho com o seu N.º de venda");
{
  const parsed = parseMeliRows(PACOTE_4);
  const assoc = collectMeliAssociations(parsed);
  eq("um grupo", assoc.groups.length, 1);
  eq("os 4 filhos no grupo do pai", assoc.groups[0].detailIndexes, [1, 2, 3, 4]);
  eq("nenhum filho avulso", assoc.standaloneItems.length, 0);

  const r = processMeli(PACOTE_4, CUSTOS_4, 0, 0, 0);
  eq("4 produtos", r.detailedRows.length, 4);
  eq("nenhum 'financeiro pendente'", pendentes(r).length, 0);
  eq("Σ Total = 910,36", soma(r.detailedRows, "Total (BRL)"), 910.36);
  eq("Σ venda = 1.172,34", soma(r.detailedRows, "Venda Total"), 1172.34);
  eq("receita de cada filho = unidades × preço", linhaDe(r, "MLB100000003")["Venda Total"], 499.9);
  eq("cobertura financeira 100%", r.summary.financialDataCoveragePercent, 100);
  eq("nenhuma venda pendente", r.summary.salesPendingFinancialCount, 0);
  ok("todos com LC calculado", r.detailedRows.every((l) => typeof l.LC === "number"));
  // Ajuste de plataforma do pai: 1172,34 − 153,48 − 103,50 − 910,36 = 5,00
  eq("ajuste de plataforma rateado uma vez", r.summary.platformAdjustmentTotal, 5);
}

// ── Caso 4 — dois pacotes consecutivos ────────────────────────────────────
console.log("\n▸ Caso 4 — dois pacotes consecutivos não se misturam");
{
  const rows = [
    ...PACOTE_4,
    pai("2000000000000300", 2, { rec: 200, tv: -20, te: -10, tot: 170 }),
    filho("2000000000000301", "MLB400000001", 120),
    filho("2000000000000302", "MLB400000002", 80),
  ];
  const assoc = collectMeliAssociations(parseMeliRows(rows));
  eq("dois grupos", assoc.groups.length, 2);
  eq("1º pacote só com os seus 4", assoc.groups[0].detailIndexes, [1, 2, 3, 4]);
  eq("2º pacote só com os seus 2", assoc.groups[1].detailIndexes, [6, 7]);

  const r = processMeli(rows, [...CUSTOS_4, custo("MLB400000001", 30), custo("MLB400000002", 20)], 0, 0, 0);
  eq("Total = 910,36 + 170", r.summary.paidRevenueTotal, 1080.36);
  eq("Total do 2º pacote só nos seus filhos",
    round2(linhaDe(r, "MLB400000001")["Total (BRL)"] + linhaDe(r, "MLB400000002")["Total (BRL)"]), 170);
}

// ── Caso 5 — pacote seguido de venda simples ──────────────────────────────
console.log("\n▸ Caso 5 — venda simples depois do pacote não é anexada");
{
  const rows = [
    ...PACOTE_4,
    // Venda de 1 produto que o ML também marca "Pacote = Sim", mas com o
    // financeiro na própria linha (231 linhas assim no export real).
    simples("2000000000000400", "MLB500000001", 74.9, { tv: -11.7, te: -8.25, tot: 50.95 }, { pacote: "Sim" }),
    simples("2000000000000401", "MLB500000002", 34.9, { tv: -4.01, te: -6.85, tot: 24.04 }),
  ];
  const assoc = collectMeliAssociations(parseMeliRows(rows));
  eq("pacote com os seus 4", assoc.groups[0].detailIndexes, [1, 2, 3, 4]);
  eq("as 2 vendas seguintes ficam avulsas", assoc.standaloneItems.map((s) => s.index), [5, 6]);

  const r = processMeli(rows, [...CUSTOS_4, custo("MLB500000001", 20), custo("MLB500000002", 10)], 0, 0, 0);
  eq("venda simples com o SEU Total", linhaDe(r, "MLB500000001")["Total (BRL)"], 50.95);
  eq("Total = pacote + 2 simples", r.summary.paidRevenueTotal, round2(910.36 + 50.95 + 24.04));
}

// ── Caso 6 — venda simples seguida de pacote ──────────────────────────────
console.log("\n▸ Caso 6 — venda simples antes do pacote");
{
  const rows = [
    simples("2000000000000500", "MLB600000001", 109.9, { tv: -12.64, te: -17.15, tot: 80.11 }),
    ...PACOTE_4,
  ];
  const assoc = collectMeliAssociations(parseMeliRows(rows));
  eq("um grupo, com os 4 filhos", assoc.groups.map((g) => g.detailIndexes), [[2, 3, 4, 5]]);
  eq("só a venda simples é avulsa", assoc.standaloneItems.map((s) => s.index), [0]);
  const r = processMeli(rows, [...CUSTOS_4, custo("MLB600000001", 40)], 0, 0, 0);
  eq("Total = simples + pacote", r.summary.paidRevenueTotal, round2(80.11 + 910.36));
  eq("nenhum pendente", pendentes(r).length, 0);
}

// ── Caso 7 — pacote com um filho sem custo ────────────────────────────────
console.log("\n▸ Caso 7 — filho sem custo: financeiro válido, LC condicionado ao custo");
{
  const r = processMeli(PACOTE_4, CUSTOS_4.filter((c) => c["# de anúncio"] !== "MLB100000002"), 0, 0, 0);
  const semCusto = linhaDe(r, "MLB100000002");
  eq("filho sem custo marcado 'sem custo' (não 'financeiro pendente')", semCusto["Cobertura de custo"], "sem custo");
  ok("filho sem custo recebe a sua parcela do Total", semCusto["Total (BRL)"] > 0);
  eq("LC do filho sem custo é desconhecido", semCusto.LC, null);
  eq("Σ Total continua fechando com o pai", soma(r.detailedRows, "Total (BRL)"), 910.36);
  eq("nenhum pendente", pendentes(r).length, 0);
  eq("3 com LC", r.detailedRows.filter((l) => typeof l.LC === "number").length, 3);
}

// ── Caso 8 — financeiro realmente ausente no pai ──────────────────────────
console.log("\n▸ Caso 8 — pacote sem Total publicado continua 'aguardando financeiro'");
{
  // Pai com receita, mas sem tarifas nem Total (o ML ainda não publicou).
  const rows = [
    pai("2000000000000600", 2, { rec: 200 }),
    filho("2000000000000601", "MLB700000001", 120),
    filho("2000000000000602", "MLB700000002", 80),
  ];
  const r = processMeli(rows, [custo("MLB700000001", 30), custo("MLB700000002", 20)], 0, 0, 0);
  eq("2 produtos, ambos pendentes", pendentes(r).length, 2);
  ok("Total desconhecido continua null (nunca 0)", r.detailedRows.every((l) => l["Total (BRL)"] === null));
  ok("LC desconhecido continua null", r.detailedRows.every((l) => l.LC === null));
  eq("receita preservada", r.summary.grossRevenueTotal, 200);
  eq("receita pendente", r.summary.revenuePendingFinancial, 200);
}
{
  // Venda simples sem Total: pendência legítima não vira "disponível".
  const rows = [simples("2000000000000610", "MLB700000003", 50, {}, { rec: 50 })];
  const r = processMeli(rows, [custo("MLB700000003", 10)], 0, 0, 0);
  eq("venda simples sem Total é pendente", pendentes(r).length, 1);
}

// ── Caso 9 — devolução dentro do pacote (estrutura real) ──────────────────
console.log("\n▸ Caso 9 — devolução de um filho do pacote");
{
  const rows = [
    pai("2000000000000700", 2, { rec: 563.8, tv: -38.04, te: -30.4, canc: -283.1, tot: 212.26 }),
    filho("2000000000000701", "MLB800000001", 283.9, { estado: "Devolução finalizada com reembolso para o comprador" }),
    filho("2000000000000702", "MLB800000002", 279.9),
  ];
  const r = processMeli(rows, [custo("MLB800000001", 90), custo("MLB800000002", 90)], 0, 0, 0);
  eq("filho devolvido sai do LC para a auditoria", r.auditRows.map((a) => a["# de anúncio"]), ["MLB800000001"]);
  eq("filho entregue fica no fechamento", r.detailedRows.map((l) => l["# de anúncio"]), ["MLB800000002"]);
  eq("Σ parcelas (fechamento + auditoria) = Total do pai",
    round2(soma(r.detailedRows, "Total (BRL)") + soma(r.auditRows, "Total rateado (BRL)")), 212.26);
  eq("reembolso contado uma vez (só no pai)", r.summary.refundsTotal, -283.1);
  eq("nenhum pendente", pendentes(r).length, 0);
}

// ── Caso 10 — arredondamento ──────────────────────────────────────────────
console.log("\n▸ Caso 10 — parcelas fecham com o pai até o centavo");
{
  const rows = [
    pai("2000000000000800", 3, { rec: 100, tv: -10.01, te: -7.33, tot: 82.66 }),
    filho("2000000000000801", "MLB900000001", 33.33),
    filho("2000000000000802", "MLB900000002", 33.33),
    filho("2000000000000803", "MLB900000003", 33.34),
  ];
  const r = processMeli(rows, [], 0, 0, 0);
  eq("Σ Total = 82,66", soma(r.detailedRows, "Total (BRL)"), 82.66);
  eq("Σ venda = 100,00", soma(r.detailedRows, "Venda Total"), 100);
  eq("Σ ajuste = 0", soma(r.detailedRows, "Ajuste plataforma (BRL)"), 0);
}

// ── Limites do bloco ──────────────────────────────────────────────────────
console.log("\n▸ Limites — o pai declara N e o bloco termina no N-ésimo filho");
{
  // Um filho órfão (sem pai) logo depois de um pacote completo NÃO é absorvido.
  const rows = [
    pai("2000000000000900", 2, { rec: 200, tv: -20, te: -10, tot: 170 }),
    filho("2000000000000901", "MLB110000001", 120),
    filho("2000000000000902", "MLB110000002", 80),
    filho("2000000000000903", "MLB110000003", 50),
  ];
  const assoc = collectMeliAssociations(parseMeliRows(rows));
  eq("o pacote leva só os 2 que declarou", assoc.groups[0].detailIndexes, [1, 2]);
  const r = processMeli(rows, [], 0, 0, 0);
  eq("o órfão continua sem financeiro (pendente legítimo)", pendentes(r).map((l) => l["# de anúncio"]), ["MLB110000003"]);
  eq("Total do pacote não vaza para o órfão", soma(r.detailedRows.filter((l) => l["Total (BRL)"] !== null), "Total (BRL)"), 170);
}
{
  // Formato antigo/sintético (6bda0151): filho SEM N.º de venda continua no pai.
  const rows = [
    linha({ venda: "10001", data: DATA, estado: "Pago", un: 2, rec: 200, tv: -20, tot: 180 }),
    linha({ mlb: "MLB555", tit: "Produto detalhado", pu: 100 }),
  ];
  const r = processMeli(rows, [custo("MLB555", 40, 0)], 0, 0, 0);
  eq("filho sem N.º de venda herda o pai", r.detailedRows[0]["Total (BRL)"], 180);
}
{
  // Venda com financeiro próprio e outro N.º de venda nunca entra no grupo
  // anterior, mesmo marcada "Pacote = Sim".
  const rows = [
    linha({ venda: "5001", data: DATA, estado: "Pago", rec: 300, tot: 260, tv: -40 }),
    linha({ venda: "5001", data: DATA, estado: "Pago", mlb: "MLB111", un: 1, pu: 200 }),
    linha({ venda: "5002", data: DATA, estado: "Pago", pacote: "Sim", mlb: "MLB333", un: 2, pu: 50, rec: 100, tot: 90, tv: -10 }),
  ];
  const assoc = collectMeliAssociations(parseMeliRows(rows));
  eq("grupo 5001 só com o seu filho", assoc.groups[0].detailIndexes, [1]);
  eq("5002 avulsa", assoc.standaloneItems.map((s) => s.index), [2]);
}

console.log("\n▸ Limites — pacote que não fecha com a linha do pacote avisa");
{
  // Export cortado: o pai declara 3, só 2 produtos vieram antes da próxima venda.
  const rows = [
    pai("2000000000001000", 3, { rec: 300, tv: -30, te: -10, tot: 260 }),
    filho("2000000000001001", "MLB120000001", 100),
    filho("2000000000001002", "MLB120000002", 100),
    simples("2000000000001003", "MLB120000003", 50, { tv: -5, te: -5, tot: 40 }),
  ];
  const r = processMeli(rows, [], 0, 0, 0);
  eq("pacote incompleto listado no diagnóstico", r.parsingDiagnostics.incompletePackSales, ["2000000000001000"]);
  ok("aviso no fechamento", r.summary.executiveNotes.some((n) => /1 pacote\(s\) com produtos que não fecham/.test(n)));
  eq("a venda seguinte não completa o pacote", linhaDe(r, "MLB120000003")["Total (BRL)"], 40);
  eq("o Total do pacote fica nos produtos encontrados", round2(linhaDe(r, "MLB120000001")["Total (BRL)"] + linhaDe(r, "MLB120000002")["Total (BRL)"]), 260);
}
{
  // Σ unidades × preço ≠ receita do pai.
  const rows = [
    pai("2000000000001100", 2, { rec: 250, tv: -25, te: -10, tot: 215 }),
    filho("2000000000001101", "MLB130000001", 100),
    filho("2000000000001102", "MLB130000002", 100),
  ];
  const r = processMeli(rows, [], 0, 0, 0);
  eq("soma que não fecha também avisa", r.parsingDiagnostics.incompletePackSales, ["2000000000001100"]);
}
{
  const r = processMeli(PACOTE_4, CUSTOS_4, 0, 0, 0);
  eq("pacote completo não avisa", r.parsingDiagnostics.incompletePackSales, []);
  eq("1 pacote reconhecido", r.parsingDiagnostics.packGroupsCount, 1);
}

// ── Ponta a ponta pelo controller (mesmo caminho do legado e da V3) ───────
async function pontaAPonta() {
  console.log("\n▸ Controller — XLSX com cabeçalho na linha 6, como o export real");
  const aoa = [["Relatório"], [], [], [], ["Vendas"], HEADER];
  const data = [...PACOTE_4, simples("2000000000000950", "MLB100000009", 50, { tv: -5, te: -5, tot: 40 })];
  for (const row of data) aoa.push(HEADER.map((h) => row[h]));
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Vendas");
  const salesBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const costSheet = XLSX.utils.json_to_sheet([...CUSTOS_4, custo("MLB100000009", 10)]);
  const cwb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(cwb, costSheet, "Custos");
  const costsBuffer = XLSX.write(cwb, { type: "buffer", bookType: "xlsx" });

  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await processarFechamentoFinanceiroController({
    files: { sales: [{ buffer: salesBuffer }], costs: [{ buffer: costsBuffer }] },
    body: { marketplace: "meli", ads: "0", venforce: "0", affiliates: "0" },
  }, res);
  eq("200", res.statusCode, 200);
  eq("5 produtos", res.body.detailedRows.length, 5);
  eq("Total = 910,36 + 40", res.body.summary.paidRevenueTotal, 950.36);
  eq("nenhuma venda pendente", res.body.summary.salesPendingFinancialCount, 0);
  eq("2 vendas reconhecidas (pacote + simples)", res.body.diagnostico.totalVendasReconhecidas, 2);
}

pontaAPonta()
  .then(() => console.log(`\nfechamentoFinanceiroMeliPacote.test.js: ${checks} verificações OK`))
  .catch((e) => { console.error(e); process.exitCode = 1; });
