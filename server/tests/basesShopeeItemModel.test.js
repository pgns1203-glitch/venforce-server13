// server/tests/basesShopeeItemModel.test.js
//
// FIN-508 — Base de Custos Shopee por Item + Model, sem banco: parser real da
// importação (parsePlanilha de server/index.js), Assistente de Base e o CSV
// que o Assistente do Portal gera para o /importar-base. A persistência em
// Postgres está em scripts/custosShopeeItemModelSqlCheck.js (PGlite).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const XLSX = require("xlsx");
const { carregarParsePlanilha } = require("../scripts/lib/custosPglite");
const { analisarPlanilhaBase } = require("../services/bases/assistenteBaseService");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
// JSON: as linhas do parser nascem no sandbox (vm) e têm outro Array.prototype.
function eq(label, actual, expected) {
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), `${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

function planilha(aoa) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Custos");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
const H = ["ID", "ID Model", "Custo", "Imposto"];
// Estrutura da Base Red Fish real (IDs anônimos): o ID chega como texto ou
// número e o Model como número de 12 dígitos.
const RED_FISH = [
  H,
  ["58200000001", 239400000001, 22.42, 0.11],
  ["58200000001", 239400000002, 22.42, 0.11],
  [58200000001, 239400000003, 22.4199999999999, 0.11],
  ["58200000002", 239400000101, 18, 0.11],
  ["58200000002", 239400000102, 35, 0.11],
  ["58200000003", 239400000201, 9.9, 0.11],
];

async function main() {
  const parsePlanilha = carregarParsePlanilha();

  console.log("\n▸ Importação — parser real (/importar-base)");
  {
    const linhas = parsePlanilha(planilha(RED_FISH), "base.xlsx", "shopee");
    eq("uma linha por variação (Item + Model)", linhas.length, 6);
    eq("Model como texto, sem notação científica", linhas.map((l) => l.id_model).slice(0, 3), ["239400000001", "239400000002", "239400000003"]);
    eq("ID numérico vira o mesmo texto do ID textual", new Set(linhas.slice(0, 3).map((l) => l.produto_id)).size, 1);
    eq("custos próprios por Model", linhas.filter((l) => l.produto_id === "58200000002").map((l) => l.custo_produto), [18, 35]);
    ok("nenhum campo interno vaza para a persistência", linhas.every((l) => !("_linha" in l)));
  }
  {
    const linhas = parsePlanilha(planilha([H, ["5001", "8001", 10, 0.08], ["5001", "8001", 10.004, 0.08]]), "base.xlsx", "shopee");
    eq("mesma variação idêntica (até o centavo) → uma linha", linhas.length, 1);
  }
  {
    let erro = null;
    try { parsePlanilha(planilha([H, ["5001", "8001", 10, 0.08], ["5001", "8001", 10, 0.12]]), "base.xlsx", "shopee"); } catch (e) { erro = e; }
    ok("mesma variação com imposto divergente → 422", erro?.statusCode === 422 && erro.payload?.code === "SHOPEE_VARIACAO_DUPLICADA");
  }
  {
    let erro = null;
    try { parsePlanilha(planilha([["ID", "Custo", "Imposto"], ["5001", 10, 0.08], ["5001", 12, 0.08]]), "base.xlsx", "shopee"); } catch (e) { erro = e; }
    ok("Item sem Model repetido com custos diferentes → 422 (antes: o último vencia em silêncio)",
      erro?.statusCode === 422 && /Item 5001 \(sem Model\)/.test(erro.message));
  }
  {
    const linhas = parsePlanilha(planilha([["ID", "Custo", "Imposto"], ["MLB1", 10, 0.1], ["MLB1", 12, 0.1]]), "base.xlsx", "meli");
    eq("MELI: parser inalterado (repetição segue para o ON CONFLICT histórico)", linhas.length, 2);
  }

  console.log("\n▸ Assistente de Base (POST /bases/assistente/preview)");
  {
    const r = await analisarPlanilhaBase(planilha(RED_FISH), "base.xlsx", { marketplace: "shopee" });
    eq("Models do mesmo Item não são duplicidade", r.resumo.duplicados, 0);
    eq("nem conflito", r.resumo.conflitos, 0);
    eq("todas as variações importáveis", r.dados_importacao.length, 6);
    ok("cada linha leva o seu Model", r.dados_importacao.every((l) => /^2394\d+$/.test(String(l.id_model))));
    // Regressão: com raw:false o Model numérico de 12 dígitos chegava como
    // "2.394E+11" → 239400000000 em TODAS as variações do Item.
    eq("Model exato, sem perder dígitos (célula numérica)", r.dados_importacao.slice(0, 3).map((l) => l.id_model), ["239400000001", "239400000002", "239400000003"]);
    eq("Models distintos = linhas", new Set(r.dados_importacao.map((l) => l.id_model)).size, 6);
  }
  {
    // CSV/texto que já chegou em notação científica: os dígitos não existem
    // mais — a linha não é importada e o assistente avisa como erro.
    const r = await analisarPlanilhaBase(planilha([H, ["5001", "2.39435E+11", 10, 0.08], ["5001", "239435155272", 10, 0.08]]), "base.xlsx", { marketplace: "shopee" });
    eq("linha com Model científico fora da importação", r.dados_importacao.map((l) => l.id_model), ["239435155272"]);
    ok("alerta de erro de notação científica", r.alertas.some((a) => a.tipo === "id_notacao_cientifica" && a.nivel === "erro"));
  }
  {
    const r = await analisarPlanilhaBase(planilha([H, ["5001", "8001", 10, 0.08], ["5001", "8001", 12, 0.08], ["5001", "8002", 12, 0.08]]), "base.xlsx", { marketplace: "shopee" });
    eq("mesma variação repetida = 1 duplicidade", r.resumo.duplicados, 1);
    eq("com custo divergente = 1 conflito", r.resumo.conflitos, 1);
    ok("conflito Shopee é erro (a importação recusa)", r.alertas.some((a) => a.tipo === "conflito_custo" && a.nivel === "erro"));
  }
  {
    const r = await analisarPlanilhaBase(planilha([["ID", "Custo", "Imposto"], ["MLB1", 10, 0.1], ["MLB1", 12, 0.1]]), "base.xlsx", { marketplace: "meli" });
    eq("MELI: ID repetido continua duplicidade + conflito (aviso)", [r.resumo.duplicados, r.resumo.conflitos], [1, 1]);
  }

  console.log("\n▸ Portal — CSV do Assistente → /importar-base");
  {
    const fonte = fs.readFileSync(path.join(__dirname, "..", "..", "Portal", "bases.js"), "utf8");
    const ini = fonte.indexOf("function asstGerarCsv(");
    const fim = fonte.indexOf("async function asstImportarBaseLimpa");
    const sandbox = { module: { exports: {} } };
    vm.createContext(sandbox);
    vm.runInContext(`${fonte.slice(ini, fim)}\nmodule.exports = asstGerarCsv;`, sandbox);
    const asstGerarCsv = sandbox.module.exports;
    const r = await analisarPlanilhaBase(planilha(RED_FISH), "base.xlsx", { marketplace: "shopee" });
    const csv = asstGerarCsv(r.dados_importacao, "shopee");
    ok("CSV Shopee leva a coluna ID Model", csv.startsWith("ID,ID Model,Custo,Imposto\n"));
    const reimportado = parsePlanilha(Buffer.from(csv, "utf8"), "base.csv", "shopee");
    eq("o /importar-base recebe as 6 variações", reimportado.length, 6);
    eq("com os mesmos Models", reimportado.map((l) => l.id_model), r.dados_importacao.map((l) => String(l.id_model)));
    ok("CSV MELI continua ID,Custo,Imposto", asstGerarCsv([{ id: "MLB1", custo: 1, imposto: 0.1 }], "meli").startsWith("ID,Custo,Imposto\n"));
  }

  console.log(`\nbasesShopeeItemModel.test.js: ${checks} verificações OK`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
