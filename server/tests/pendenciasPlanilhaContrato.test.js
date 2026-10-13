// server/tests/pendenciasPlanilhaContrato.test.js
//
// Contrato entre a PLANILHA DE PENDÊNCIAS do Financeiro V3
// (frontend-react/src/utils/financeiro/pendencias.js → COLUNAS_PLANILHA_PENDENCIAS)
// e o leitor de "Atualizar Base por planilha" (assistenteBaseService).
//
// O operador baixa a planilha, preenche "Novo custo" e a reimporta em Bases de
// Custo. Se o leitor reconhecer a coluna errada, a importação grava custo
// errado SEM aviso — foi exatamente o que aconteceu com o cabeçalho "Produto"
// (casa com o candidato "custo produto" e a coluna do NOME é lida como CUSTO,
// tudo R$ 0). Este teste trava:
//   1. cada coluna é reconhecida pelo papel certo;
//   2. linha com "Novo custo" vazio é ignorada (nada é zerado por omissão);
//   3. ID longo (texto) chega intacto;
//   4. imposto com "%" chega como fração;
//   5. o cabeçalho antigo "Produto" continua PROIBIDO (documenta o porquê).
//
// Sem banco e sem rede.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/x";

const assert = require("assert");
const XLSX = require("xlsx");
const { analisarPlanilhaBase } = require("../services/bases/assistenteBaseService");

let checks = 0;
function ok(label, condition) {
  checks += 1;
  assert.ok(condition, `FALHOU: ${label}`);
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  checks += 1;
  assert.deepStrictEqual(actual, expected, `${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  console.log(`  ok  ${label}`);
}

// Mantido IGUAL a COLUNAS_PLANILHA_PENDENCIAS (frontend). Se mudar lá, mude aqui.
const CABECALHO = ["Nome do produto", "ID", "SKU", "Model ID", "Motivo", "Receita impactada", "Custo atual", "Novo custo", "Imposto (%)"];

function planilha(linhas, cabecalho = CABECALHO) {
  const ws = XLSX.utils.aoa_to_sheet([cabecalho, ...linhas]);
  // forçar TEXTO nas células de ID, como o gerador do portal faz
  linhas.forEach((l, r) => {
    for (const c of [1, 3]) {
      const ref = XLSX.utils.encode_cell({ r: r + 1, c });
      if (ws[ref]) ws[ref].t = "s";
    }
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Pendências de custo");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Campo", "Valor"], ["Cliente", "Z"]]), "Contexto");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

(async () => {
  console.log("▸ MELI");
  const meli = await analisarPlanilhaBase(
    planilha([
      ["Calça", "MLB1234567890", "", "", "Não encontrado na base", 150.5, "", 12.5, "8%"],
      ["Blusa", "MLB2", "", "", "Não encontrado na base", 70, "", "", ""],
    ]),
    "pendencias.xlsx",
    { marketplace: "meli" }
  );
  const cols = meli.colunas || meli.mapeamento || meli.colunas_detectadas;
  eq("ID → coluna ID", cols.id.cabecalho, "ID");
  eq("custo → coluna Novo custo (nunca 'Custo atual' nem o nome do produto)", cols.custo.cabecalho, "Novo custo");
  eq("imposto → coluna Imposto (%)", cols.imposto.cabecalho, "Imposto (%)");
  eq("nome → Nome do produto", cols.produto_nome.cabecalho, "Nome do produto");
  eq("só a linha com Novo custo preenchido é importável", meli.dados_importacao.length, 1);
  eq("ID preservado e custo lido", [meli.dados_importacao[0].id, meli.dados_importacao[0].custo], ["MLB1234567890", 12.5]);
  eq("imposto '8%' vira fração 0,08", meli.dados_importacao[0].imposto, 0.08);
  ok("linha com Novo custo vazio foi ignorada (nada vira R$ 0)", !meli.dados_importacao.some((l) => l.id === "MLB2"));

  console.log("▸ Shopee");
  const shopee = await analisarPlanilhaBase(
    planilha([["Kit", "169417000000123", "S1", "555000000000123", "Custo somente no item pai", 10, "", 9.9, ""]]),
    "pendencias.xlsx",
    { marketplace: "shopee" }
  );
  eq("Shopee: Item ID e Model ID intactos (texto, sem notação científica)", [shopee.dados_importacao[0].id, shopee.dados_importacao[0].id_model], ["169417000000123", "555000000000123"]);
  eq("Shopee: custo lido de Novo custo", shopee.dados_importacao[0].custo, 9.9);

  console.log("▸ Armadilha documentada");
  const armadilha = await analisarPlanilhaBase(
    planilha([["Calça", "MLB1", "", "", "x", 1, "", 12.5, ""]], ["Produto", "ID", "SKU", "Model ID", "Motivo", "Receita impactada", "Custo atual", "Novo custo", "Imposto (%)"]),
    "pendencias.xlsx",
    { marketplace: "meli" }
  );
  const colsArm = armadilha.colunas || armadilha.mapeamento || armadilha.colunas_detectadas;
  ok("com o cabeçalho 'Produto' o leitor confunde nome com custo (por isso é proibido)", colsArm.custo.cabecalho === "Produto");

  console.log(`\n✓ ${checks} verificações do contrato planilha de pendências ↔ Bases de Custo`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
