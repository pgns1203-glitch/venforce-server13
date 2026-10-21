// server/tests/fechamentoFinanceiroMeliCustosPlural.test.js
// FIN-709: a planilha de custos do MELI com cabeçalho "CUSTOS" (plural)
// precisa ser lida como coluna de custo. Antes só "custo" era reconhecido,
// então os MLBs eram encontrados mas ficavam sem custo.

const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function loadWithXlsxStub(request, parent, isMain) {
  if (request === "xlsx") {
    return { utils: { aoa_to_sheet: () => ({}) } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  parseMeliCostRows,
  buildMeliCostMap,
} = require("../services/fechamentoFinanceiro/meliFinanceiroService");

Module._load = originalLoad;

// Cabeçalho exato da planilha "custos Doce Lar.xlsx": ID | CUSTOS | IMPOSTO.
const costRows = [
  { ID: 4286760379, CUSTOS: 90, IMPOSTO: 0.09 },
  { ID: 5893645412, CUSTOS: 122, IMPOSTO: 0.09 },
  { ID: 5893658464, CUSTOS: 180, IMPOSTO: 0.09 },
  { ID: 5295056266, CUSTOS: 68, IMPOSTO: 0.09 },
  { ID: 2098064505, CUSTOS: 45, IMPOSTO: 0.09 },
  // Custo realmente vazio: continua sem custo.
  { ID: 1413777370, CUSTOS: "", IMPOSTO: 0.09 },
];

{
  const parsed = parseMeliCostRows(costRows);
  const byId = Object.fromEntries(parsed.map((row) => [row.id, row]));

  assert.strictEqual(byId["4286760379"].cost, 90, "CUSTOS deve ser lido como custo");
  assert.strictEqual(byId["5893645412"].cost, 122);
  assert.strictEqual(byId["5893658464"].cost, 180);
  assert.strictEqual(byId["5295056266"].cost, 68);
  assert.strictEqual(byId["2098064505"].cost, 45);
  assert.strictEqual(byId["4286760379"].taxPercent, 9, "imposto 0,09 vira 9%");

  assert.strictEqual(byId["1413777370"].cost, 0, "custo vazio segue como 0");
}

{
  // Cabeçalho singular continua funcionando (sem regressão).
  const parsed = parseMeliCostRows([{ "# de anúncio": "MLB1111111111", Custo: 33, Imposto: 0.1 }]);
  assert.strictEqual(parsed[0].cost, 33);
  assert.strictEqual(parsed[0].id, "MLB1111111111");
}

{
  // O mapa usado pelo fechamento também encontra os MLBs com custo.
  const map = buildMeliCostMap(costRows);
  assert.strictEqual(map.get("MLB5893658464").cost, 180);
  assert.strictEqual(map.get("5893658464").cost, 180, "chave sem prefixo MLB também resolve");
}

console.log("fechamentoFinanceiroMeliCustosPlural: ok");
