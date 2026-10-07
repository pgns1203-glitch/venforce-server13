// server/tests/curvaAbcAnual.test.js
// Curva ABC anual: 1 a 12 planilhas (Shopee Performance OU Mercado Livre
// Vendas) consolidadas por ID ANTES de classificar. Buffers XLSX sintéticos
// em memória — sem arquivos reais, sem banco.

const assert = require("assert");
const XLSX = require("xlsx");

const {
  MAX_PLANILHAS_CURVA_ABC,
  validarEntradaCurvaAbc,
} = require("../utils/fechamento/curvaAbcEntrada");
const { processarFechamento, compilarFechamentos } = require("../utils/fechamento/process");
const { compilarFechamentosMeli } = require("../utils/fechamento/meliConversaoService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, label);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function near(label, actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} !== ${expected}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// ── Fixtures ────────────────────────────────────────────────────────────────
function xlsxBuffer(sheetName, aoa) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// Performance Shopee. item = { id, produto, fat, un, variacoes?: [{ id, fat, un }] }
function shopeePerformance(itens) {
  const aoa = [[
    "ID do Item", "Produto", "ID da Variação", "Vendas (Pedido pago) (BRL)",
    "Unidades (Pedido pago)", "Produto Pago", "Impressão do Produto",
    "Cliques Por Produto", "CTR", "Taxa de Conversão de Pedido (Pedido Pago)",
  ]];
  for (const it of itens) {
    aoa.push([it.id, it.produto, "-", it.fat, it.un, it.un, 1000, 100, 10, 5]);
    for (const v of it.variacoes || []) {
      aoa.push([it.id, it.produto, v.id, v.fat, v.un, v.un, 0, 0, 0, 0]);
    }
  }
  return xlsxBuffer("Produtos com Melhor Desempenho", aoa);
}

// Vendas MELI com 5 linhas de preâmbulo (cabeçalho real na linha 6, como o export).
// venda = { n, estado, mlb, titulo, un, preco, receita, total }
function meliVendas(vendas, { sheetName = "Vendas BR" } = {}) {
  const aoa = [
    ["Vendas"], ["Exportado em 01/01/2026"], [""], [""], [""],
    ["N.º de venda", "Estado", "# de anúncio", "Título do anúncio", "Unidades",
      "Preço unitário de venda do anúncio (BRL)", "Receita por produtos (BRL)", "Total (BRL)"],
  ];
  for (const v of vendas) {
    aoa.push([v.n, v.estado || "Pago", v.mlb, v.titulo, v.un, v.preco,
      v.receita ?? v.un * v.preco, v.total ?? v.un * v.preco * 0.7]);
  }
  return xlsxBuffer(sheetName, aoa);
}

const nomes = (n) => Array.from({ length: n }, (_, i) => `mes-${String(i + 1).padStart(2, "0")}.xlsx`);
const linha = (resultado, id) => resultado.curvaAbcCompleta.find((r) => String(r.id) === String(id));

// ── Teste A — Shopee 12 meses ───────────────────────────────────────────────
console.log("\n▸ Teste A — Shopee: mesmo produto em 12 arquivos soma faturamento e unidades");
{
  const buffers = Array.from({ length: 12 }, (_, i) =>
    shopeePerformance([{ id: "123", produto: "Produto 123", fat: 1000 * (i + 1), un: 10 * (i + 1) }])
  );
  const r = compilarFechamentos(buffers, nomes(12));
  ok("sem erro", !r.error);
  eq("1 produto consolidado", r.curvaAbcCompleta.length, 1);
  eq("faturamento anual = soma dos 12", linha(r, "123").faturamento, 1000 * 78);
  eq("unidades anuais = soma dos 12", linha(r, "123").unidades, 10 * 78);
  eq("resumo.faturamentoTotal", r.resumo.faturamentoTotal, 78000);
}

console.log("\n▸ Shopee: regra de variações preservada em cada mês");
{
  const mes = () => shopeePerformance([{
    id: "9", produto: "Com variação", fat: 999, un: 99,
    variacoes: [{ id: "v1", fat: 100, un: 1 }, { id: "v2", fat: 200, un: 2 }],
  }]);
  const r = compilarFechamentos([mes(), mes()], nomes(2));
  eq("usa só as variações (300/mês), não a linha principal", linha(r, "9").faturamento, 600);
  eq("unidades só das variações", linha(r, "9").unidades, 6);
}

// ── Teste B — MELI 12 meses ─────────────────────────────────────────────────
console.log("\n▸ Teste B — MELI: mesmo MLB em 12 arquivos soma faturamento e unidades");
{
  const buffers = Array.from({ length: 12 }, (_, i) =>
    meliVendas([{ n: `${i}1`, mlb: "MLB123", titulo: "Anúncio 123", un: i + 1, preco: 50 }])
  );
  const r = compilarFechamentosMeli(buffers, nomes(12));
  ok("sem erro", !r.error);
  eq("1 anúncio consolidado", r.curvaAbcCompleta.length, 1);
  eq("faturamento = Σ unidades × preço unitário", linha(r, "MLB123").faturamento, 78 * 50);
  eq("unidades anuais", linha(r, "MLB123").unidades, 78);
}

console.log("\n▸ MELI: faturamento é venda bruta (unid × preço), não o líquido recebido");
{
  const b = meliVendas([{ n: "1", mlb: "MLB1", titulo: "A", un: 2, preco: 100, receita: 200, total: 11 }]);
  const r = compilarFechamentosMeli([b], ["a.xlsx"]);
  eq("faturamento 200 (não 11)", linha(r, "MLB1").faturamento, 200);
}

console.log("\n▸ MELI: cancelado/devolvido não entra; não exige planilha de custos");
{
  const b = meliVendas([
    { n: "1", mlb: "MLB1", titulo: "A", un: 1, preco: 100 },
    { n: "2", estado: "Cancelada", mlb: "MLB1", titulo: "A", un: 5, preco: 100 },
    { n: "3", estado: "Devolução concluída", mlb: "MLB1", titulo: "A", un: 7, preco: 100 },
  ]);
  const r = compilarFechamentosMeli([b], ["a.xlsx"]);
  eq("só a venda paga", linha(r, "MLB1").unidades, 1);
  ok("sem campos financeiros no resultado (LC/MC)", !("lc" in linha(r, "MLB1")) && !("mc" in linha(r, "MLB1")));
}

console.log("\n▸ MELI: cabeçalho detectado automaticamente (não fixo na linha 6) e aba qualquer");
{
  const aoa = [
    ["N.º de venda", "Estado", "# de anúncio", "Título do anúncio", "Unidades",
      "Preço unitário de venda do anúncio (BRL)", "Receita por produtos (BRL)", "Total (BRL)"],
    ["1", "Pago", "MLB9", "Z", 3, 10, 30, 20],
  ];
  const r = compilarFechamentosMeli([xlsxBuffer("Planilha1", aoa)], ["a.xlsx"]);
  ok("sem erro", !r.error);
  eq("faturamento 30", linha(r, "MLB9").faturamento, 30);
}

console.log("\n▸ MELI: formato pai/filho (venda principal + linha do anúncio sem unidades)");
{
  const aoa = [
    ["N.º de venda", "Estado", "# de anúncio", "Título do anúncio", "Unidades",
      "Preço unitário de venda do anúncio (BRL)", "Receita por produtos (BRL)", "Total (BRL)"],
    ["100", "Pago", "", "", 4, "", 400, 280],
    ["", "", "MLB5", "Filho", "", 100, "", ""],
  ];
  const r = compilarFechamentosMeli([xlsxBuffer("Vendas BR", aoa)], ["a.xlsx"]);
  ok("sem erro", !r.error);
  eq("unidades herdadas do pai", linha(r, "MLB5").unidades, 4);
  eq("faturamento = unidades × preço do filho", linha(r, "MLB5").faturamento, 400);
}

// ── Teste C — produtos diferentes: ordenação e acumulados ───────────────────
console.log("\n▸ Teste C — consolida ANTES de classificar (não média de curvas mensais)");
{
  // Mês 1: X domina. Mês 2: Y domina. Anual: Y(1000+9000=10000) > X(9000+1000)? iguais → desempate por nome.
  // Para evitar empate: X = 9000+1500 = 10500, Y = 1000+9000 = 10000, Z = 500+500 = 1000.
  const m1 = shopeePerformance([
    { id: "X", produto: "X", fat: 9000, un: 90 }, { id: "Y", produto: "Y", fat: 1000, un: 10 }, { id: "Z", produto: "Z", fat: 500, un: 5 },
  ]);
  const m2 = shopeePerformance([
    { id: "X", produto: "X", fat: 1500, un: 15 }, { id: "Y", produto: "Y", fat: 9000, un: 90 }, { id: "Z", produto: "Z", fat: 500, un: 5 },
  ]);
  const r = compilarFechamentos([m1, m2], ["jan.xlsx", "fev.xlsx"]);
  const ordem = r.curvaAbcCompleta.map((x) => x.id);
  eq("ordenado por faturamento anual desc", ordem, ["X", "Y", "Z"]);
  const total = 10500 + 10000 + 1000;
  near("% X", linha(r, "X").percentualFaturamento, 10500 / total);
  near("acumulado Y", linha(r, "Y").acumuladoFaturamento, 20500 / total);
  near("acumulado Z = 100%", linha(r, "Z").acumuladoFaturamento, 1);
  eq("X é A (até 80%)", linha(r, "X").curvaFat, "A");
  eq("Y é A (cruza 80% mas o anterior era < 80%)", linha(r, "Y").curvaFat, "A");
  eq("Z é C", linha(r, "Z").curvaFat, "C");
  eq("curvaFinal = fat+uni", linha(r, "Z").curvaFinal, linha(r, "Z").curvaFat + linha(r, "Z").curvaUni);
  eq("faturamento do total", r.resumo.faturamentoTotal, total);
}

// ── Teste D — limite 1..12 e marketplace ────────────────────────────────────
console.log("\n▸ Teste D — validação de entrada (limite e marketplace)");
{
  eq("MAX = 12", MAX_PLANILHAS_CURVA_ABC, 12);
  eq("12 permitido", validarEntradaCurvaAbc("shopee", 12), { ok: true, marketplace: "shopee" });
  eq("1 permitido", validarEntradaCurvaAbc("meli", 1), { ok: true, marketplace: "meli" });
  eq("normaliza caixa/espaços", validarEntradaCurvaAbc("  MELI ", 3), { ok: true, marketplace: "meli" });
  const treze = validarEntradaCurvaAbc("shopee", 13);
  ok("13 rejeitado", treze.ok === false);
  eq("mensagem do limite", treze.erro, "Selecione no máximo 12 planilhas.");
  ok("0 rejeitado", validarEntradaCurvaAbc("shopee", 0).ok === false);
  ok("marketplace inválido rejeitado", validarEntradaCurvaAbc("amazon", 2).ok === false);
  ok("marketplace ausente rejeitado", validarEntradaCurvaAbc(undefined, 2).ok === false);
}

// ── Teste E — arquivo inválido derruba a operação inteira ───────────────────
console.log("\n▸ Teste E — arquivo 7/12 inválido: nenhuma curva parcial");
{
  const ruins = {
    shopee: Buffer.from("isto não é um xlsx"),
    shopeeAbaErrada: xlsxBuffer("Outra", [["a"], [1]]),
  };
  const bons = Array.from({ length: 12 }, () => shopeePerformance([{ id: "1", produto: "P", fat: 10, un: 1 }]));
  bons[6] = ruins.shopeeAbaErrada;
  const r = compilarFechamentos(bons, nomes(12));
  ok("erro retornado", !!r.error);
  ok("sem curva parcial", !r.curvaAbcCompleta && !r.resumo);
  ok("informa o arquivo que falhou", r.error.includes("mes-07.xlsx"));

  const bons2 = Array.from({ length: 12 }, () => shopeePerformance([{ id: "1", produto: "P", fat: 10, un: 1 }]));
  bons2[6] = ruins.shopee;
  const r2 = compilarFechamentos(bons2, nomes(12));
  ok("buffer corrompido também falha com nome", !!r2.error && r2.error.includes("mes-07.xlsx") && !r2.curvaAbcCompleta);

  const meliBons = Array.from({ length: 12 }, () => meliVendas([{ n: "1", mlb: "MLB1", titulo: "A", un: 1, preco: 10 }]));
  meliBons[6] = xlsxBuffer("Vendas BR", [["coluna qualquer"], ["x"]]);
  const r3 = compilarFechamentosMeli(meliBons, nomes(12));
  ok("MELI: arquivo 7/12 inválido derruba tudo e cita o nome", !!r3.error && r3.error.includes("mes-07.xlsx") && !r3.curvaAbcCompleta);
}

console.log("\n▸ Validação de tipo: planilha do marketplace errado é rejeitada, não vira zeros");
{
  const meli = meliVendas([{ n: "1", mlb: "MLB1", titulo: "A", un: 1, preco: 10 }]);
  const shopee = shopeePerformance([{ id: "1", produto: "P", fat: 10, un: 1 }]);
  const a = compilarFechamentos([meli], ["vendas-meli.xlsx"]);
  ok("MELI enviado como Shopee → erro com nome", !!a.error && a.error.includes("vendas-meli.xlsx") && !a.curvaAbcCompleta);
  const b = compilarFechamentosMeli([shopee], ["performance.xlsx"]);
  ok("Shopee enviado como MELI → erro com nome", !!b.error && b.error.includes("performance.xlsx") && !b.curvaAbcCompleta);
}

// ── Teste F — regressão: 1 arquivo Shopee igual ao fluxo anterior ───────────
console.log("\n▸ Teste F — regressão: 1 Shopee compilado == processarFechamento");
{
  const b = shopeePerformance([
    { id: "1", produto: "A", fat: 5000, un: 50 },
    { id: "2", produto: "B", fat: 3000, un: 70 },
    { id: "3", produto: "C", fat: 200, un: 3, variacoes: [{ id: "v", fat: 150, un: 2 }] },
  ]);
  const antes = processarFechamento(b);
  const depois = compilarFechamentos([b], ["a.xlsx"]);
  eq("curvaAbcCompleta idêntica", depois.curvaAbcCompleta, antes.curvaAbcCompleta);
  eq("resumo idêntico", depois.resumo, antes.resumo);
  eq("mesmas chaves de contrato", Object.keys(depois).sort(), Object.keys(antes).sort());
}

console.log("\n▸ Compatibilidade: 4 e 12 arquivos MELI/Shopee funcionam");
{
  for (const n of [1, 4, 12]) {
    const s = compilarFechamentos(
      Array.from({ length: n }, () => shopeePerformance([{ id: "1", produto: "P", fat: 10, un: 1 }])), nomes(n));
    const m = compilarFechamentosMeli(
      Array.from({ length: n }, () => meliVendas([{ n: "1", mlb: "MLB1", titulo: "A", un: 1, preco: 10 }])), nomes(n));
    eq(`Shopee ${n}`, linha(s, "1").unidades, n);
    eq(`MELI ${n}`, linha(m, "MLB1").unidades, n);
  }
}

// ── Frontend: contrato estático (sem harness de DOM para esta tela) ─────────
console.log("\n▸ Frontend (Portal/fechamento.js|html) — limite 12 e contrato do request");
{
  const fs = require("fs");
  const path = require("path");
  const js = fs.readFileSync(path.join(__dirname, "../../Portal/fechamento.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../../Portal/fechamento.html"), "utf8");

  ok("MAX_PLANILHAS = 12", /const MAX_PLANILHAS = 12;/.test(js));
  ok("não sobrou limite 20 em arquivos", !/files\.length > 20/.test(js) && !/máximo 20/.test(js));
  const corpoCompilar = js.slice(js.indexOf("async function compilarArquivos"));
  ok("bloqueia >12 antes do fetch (validateInputFiles precede o fetch)",
    corpoCompilar.indexOf("if (!validateInputFiles(input)) return;") >= 0 &&
    corpoCompilar.indexOf("if (!validateInputFiles(input)) return;") < corpoCompilar.indexOf("await fetch("));
  ok("compilar usa API_BASE (sem URL duplicada)", js.includes("`${API_BASE}/fechamentos/compilar`") &&
    !js.includes('"https://venforce-server.onrender.com/fechamentos/compilar"'));
  ok("envia marketplace no FormData", /formData\.append\("marketplace", marketplaceAtivo\)/.test(
    js.slice(js.indexOf("async function compilarArquivos"))));
  ok("input múltiplo aceita .xlsx", /id="fechamento-arquivos"[^>]*multiple[^>]*accept="\.xlsx"/.test(html));
  ok("html anuncia 12, não 20", html.includes("Até 12 arquivos") && !/até 20|Até 20/.test(html));
  ok("seletor de marketplace Shopee/MELI existente", html.includes('data-mp="shopee"') && html.includes('data-mp="meli"'));
}

// ── Rota HTTP: limite aplicado pelo backend (multer real, handler real) ─────
async function testeHttp() {
  const express = require("express");
  const multer = require("multer");
  const {
    criarMiddlewareUploadCurvaAbc,
    criarHandlerCompilarCurvaAbc,
  } = require("../utils/fechamento/curvaAbcEntrada");

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
  const app = express();
  app.post(
    "/fechamentos/compilar",
    criarMiddlewareUploadCurvaAbc(upload, multer.MulterError),
    criarHandlerCompilarCurvaAbc({ gerarExcelBase64: () => null })
  );
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}/fechamentos/compilar`;

  async function post(marketplace, arquivos) {
    const form = new FormData();
    if (marketplace !== undefined) form.append("marketplace", marketplace);
    for (const { buffer, nome } of arquivos) form.append("files", new Blob([buffer]), nome);
    const res = await fetch(url, { method: "POST", body: form });
    return { status: res.status, json: await res.json() };
  }
  const shopeeMes = (i) => ({
    buffer: shopeePerformance([{ id: "123", produto: "P", fat: 100, un: 1 }]),
    nome: `mes-${i + 1}.xlsx`,
  });

  try {
    console.log("\n▸ Rota HTTP — limite 1..12 aplicado no backend");
    const doze = await post("shopee", Array.from({ length: 12 }, (_, i) => shopeeMes(i)));
    eq("12 arquivos → 200", doze.status, 200);
    eq("12 arquivos somam faturamento", doze.json.data.curvaAbcCompleta[0].faturamento, 1200);

    const treze = await post("shopee", Array.from({ length: 13 }, (_, i) => shopeeMes(i)));
    eq("13 arquivos → 400", treze.status, 400);
    eq("13 arquivos: mensagem", treze.json, { ok: false, erro: "Selecione no máximo 12 planilhas." });

    const zero = await post("shopee", []);
    eq("0 arquivos → 400", zero.status, 400);

    const mpRuim = await post("amazon", [shopeeMes(0)]);
    eq("marketplace inválido → 400", mpRuim.status, 400);
    const mpAusente = await post(undefined, [shopeeMes(0)]);
    eq("marketplace ausente → 400", mpAusente.status, 400);

    const arquivos = Array.from({ length: 12 }, (_, i) => shopeeMes(i));
    arquivos[6] = { buffer: xlsxBuffer("Outra", [["a"], [1]]), nome: "março.xlsx" };
    const ruim = await post("shopee", arquivos);
    eq("arquivo inválido → 400", ruim.status, 400);
    ok("cita o arquivo (com acento íntegro)", ruim.json.erro.includes("março.xlsx"));
    ok("sem curva parcial na resposta", !ruim.json.data);

    const meli = await post("meli", [{
      buffer: meliVendas([{ n: "1", mlb: "MLB1", titulo: "A", un: 3, preco: 10 }]),
      nome: "vendas.xlsx",
    }]);
    eq("MELI 1 arquivo → 200", meli.status, 200);
    eq("MELI faturamento", meli.json.data.curvaAbcCompleta[0].faturamento, 30);
  } finally {
    server.close();
  }
}

testeHttp()
  .then(() => console.log(`\n✓ ${checks} verificações da Curva ABC anual passaram`))
  .catch((err) => { console.error(err); process.exit(1); });
