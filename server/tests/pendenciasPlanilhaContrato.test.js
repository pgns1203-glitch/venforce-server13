// server/tests/pendenciasPlanilhaContrato.test.js
//
// CONTRATO entre o Financeiro V3 (correção de custo das pendências) e o
// "Atualizar Base por planilha" / upsert de custos de Bases. Usa as peças REAIS:
//   · o GERADOR de XLSX do frontend (frontend-react/src/utils/financeiro/*);
//   · o PARSER real (assistenteBaseService.analisarPlanilhaBase);
//   · o controller + service REAIS de upsert (basesController/baseCustosService)
//     sobre um banco EM MEMÓRIA (sem rede, sem Postgres).
//
// Round-trip: pendência → XLSX → preencher Novo custo/Imposto → parser real →
// classificação do frontend → upsert real → base atualizada.
//
// Também CARACTERIZA o comportamento do upsert que justifica as proteções da
// tela (Shopee): a identidade de uma linha é o produto_id; gravar outro Model
// no mesmo Item sobrescreve o registro; omitir id_model o zera. Se o backend
// mudar isso, estes testes avisam e a tela pode ser simplificada.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/x";

const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");
const XLSX = require("xlsx");

const pool = require("../config/database");
const { analisarPlanilhaBase } = require("../services/bases/assistenteBaseService");
const { normalizarProdutoIdBase, normalizarProdutoIdShopee } = require("../services/bases/baseCustosService");
const { upsertCustoBaseController } = require("../controllers/basesController");

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

// ── Banco em memória: só o que o upsert de custos toca ──────────────────────
function instalarBancoEmMemoria({ marketplace, custos = [] }) {
  const base = { id: 7, slug: "base-teste", marketplace, ativo: true };
  const rows = custos.map((c) => ({ base_id: 7, sku_id: "", sku: "", taxa_fixa: 0, produto_nome: null, variacao_nome: null, id_model: null, ...c }));
  const original = pool.query;
  pool.query = async (sql, params = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (/^SELECT id, slug, marketplace FROM bases WHERE slug/.test(q)) return { rows: params[0] === base.slug ? [base] : [] };
    if (/^UPDATE bases SET updated_at/.test(q) || /^INSERT INTO activity_logs/.test(q)) return { rows: [] };
    if (/FROM custos WHERE base_id = \$1 AND produto_id = \$2 LIMIT 1/.test(q)) {
      return { rows: rows.filter((r) => r.base_id === params[0] && r.produto_id === params[1]).slice(0, 1) };
    }
    if (/^SELECT imposto_percentual, taxa_fixa, COUNT/.test(q)) {
      const r = rows.find((x) => x.base_id === params[0]);
      return { rows: r ? [{ imposto_percentual: r.imposto_percentual, taxa_fixa: r.taxa_fixa, total: 1 }] : [] };
    }
    if (/^UPDATE custos SET custo_produto = \$3/.test(q)) {
      const r = rows.find((x) => x.base_id === params[0] && x.produto_id === params[1]);
      Object.assign(r, { custo_produto: params[2], imposto_percentual: params[3], taxa_fixa: params[4], id_model: params[5] });
      if (params[6]) r.produto_nome = params[6];
      return { rows: [r] };
    }
    if (/^INSERT INTO custos/.test(q)) {
      const r = { base_id: params[0], produto_id: params[1], sku_id: params[2], custo_produto: params[3], imposto_percentual: params[4], taxa_fixa: params[5], id_model: params[6], produto_nome: params[7], variacao_nome: params[8], sku: params[9] };
      rows.push(r);
      return { rows: [r] };
    }
    throw new Error(`SQL não previsto no banco em memória: ${q.slice(0, 90)}`);
  };
  return { rows, restaurar: () => { pool.query = original; } };
}

// Chama o controller REAL, como o navegador chama POST /bases/:slug/custos/upsert.
async function upsert(body) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await upsertCustoBaseController({ params: { baseSlug: "base-teste" }, body, user: { id: 1 }, headers: {}, ip: "127.0.0.1" }, res);
  return res;
}

function preencher(bytes, preenchimentos) {
  const wb = XLSX.read(Buffer.from(bytes), { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  for (const [celula, valor] of Object.entries(preenchimentos)) ws[celula] = typeof valor === "number" ? { t: "n", v: valor } : { t: "s", v: valor };
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

(async () => {
  const dir = path.resolve(__dirname, "../../frontend-react/src/utils/financeiro");
  const imp = (f) => import(pathToFileURL(path.join(dir, f)).href);
  const { gerarXlsx } = await imp("xlsxMinimo.js");
  const { montarPlanilhaPendencias, agruparPendencias, COLUNAS_PLANILHA_PENDENCIAS } = await imp("pendencias.js");
  const { normalizarLinhas } = await imp("produtos.js");
  const bc = await imp("baseCustos.js");
  ok("o gerador real do frontend carrega no Node", typeof gerarXlsx === "function");

  console.log("▸ Paridade de normalização de ID (frontend × servidor)");
  for (const v of ["123456", "mlb123456", "MLB123456.0", "  'MLB99'  ", "", "SKU-LIVRE"]) {
    eq(`MELI ${JSON.stringify(v)}`, bc.normalizarIdMeli(v), normalizarProdutoIdBase(v));
  }
  for (const v of ["169417000123", "169417000123.0", "'555000000123'", "1.69417E+11"]) {
    // o frontend não "conserta" notação científica (não adivinha dígitos): só compara onde o servidor também é exato
    if (/[eE]/.test(v)) continue;
    eq(`Shopee ${JSON.stringify(v)}`, bc.normalizarIdShopee(v), normalizarProdutoIdShopee(v));
  }

  console.log("▸ Round-trip MELI: gerar → preencher → parser real → classificar → upsert real → base atualizada");
  {
    const pend = agruparPendencias(
      normalizarLinhas([
        { "# de anúncio": "MLB1111", "Título do anúncio": "Calça", "Venda Total": 100, "Preço de custo": null, LC: null, MC: null, "Cobertura de custo": "sem custo" },
        { "# de anúncio": "MLB2222", "Título do anúncio": "Blusa", "Venda Total": 70, "Preço de custo": 0, LC: null, MC: null, "Cobertura de custo": "sem custo" },
        { "# de anúncio": "MLB3333", "Título do anúncio": "Saia", "Venda Total": 40, "Preço de custo": null, LC: null, MC: null, "Cobertura de custo": "sem custo" },
      ])
    );
    const mem = instalarBancoEmMemoria({ marketplace: "meli", custos: [{ produto_id: "MLB2222", custo_produto: 0, imposto_percentual: 0.08 }] });
    try {
      const indice = bc.indexarPorProduto(bc.itensDaBase({ dados: { a: { produto_id: "MLB2222", custo_produto: 0, imposto_percentual: 0.08 } } }));
      const xlsx = montarPlanilhaPendencias(pend, { marketplace: "meli", indice });
      // linhas: 2=Calça(MLB1111) 3=Blusa(MLB2222) 4=Saia(MLB3333). H=Novo custo, I=Imposto (%)
      const preenchida = preencher(xlsx, { H2: 12.5, I2: "10,5%", H3: 7 /* imposto vazio → mantém */ /* Saia: em branco → ignorada */ });
      const previa = await analisarPlanilhaBase(preenchida, "pendencias.xlsx", { marketplace: "meli" });
      const cols = previa.colunas || previa.mapeamento || previa.colunas_detectadas;
      eq("custo lido de 'Novo custo'", cols.custo.cabecalho, "Novo custo");
      eq("imposto lido de 'Imposto (%)'", cols.imposto.cabecalho, "Imposto (%)");
      eq("linha em branco ignorada pelo parser real", previa.dados_importacao.map((l) => l.id), ["MLB1111", "MLB2222"]);

      const { linhas, resumo } = bc.classificarLinhasPlanilha({ marketplace: "meli", dados: previa.dados_importacao, itensBase: bc.itensDaBase({ dados: { a: { produto_id: "MLB2222", custo_produto: 0, imposto_percentual: 0.08 } } }) });
      eq("classificação: 1 atualizar + 1 adicionar", [resumo.atualizar, resumo.adicionar, resumo.ambiguas], [1, 1, 0]);

      for (const l of linhas) {
        const r = await upsert({ produto_id: l.produtoId, custo_produto: l.custo, ...(l.imposto !== null ? { imposto_percentual: l.imposto } : {}), ...(l.idModel ? { id_model: l.idModel } : {}) });
        ok(`upsert ${l.produtoId} ok (${r.body && r.body.acao})`, r.statusCode === 200 && r.body.ok === true);
      }
      const por = Object.fromEntries(mem.rows.map((r) => [r.produto_id, r]));
      eq("Calça criada com custo e imposto da planilha (fração)", [Number(por.MLB1111.custo_produto), Number(por.MLB1111.imposto_percentual)], [12.5, 0.105]);
      eq("Blusa (existente) atualizou o custo e MANTEVE o imposto", [Number(por.MLB2222.custo_produto), Number(por.MLB2222.imposto_percentual)], [7, 0.08]);
      ok("Saia (em branco) NÃO foi criada — nada virou R$ 0", !por.MLB3333);
    } finally {
      mem.restaurar();
    }
  }

  console.log("▸ Round-trip Shopee: Item e Model como texto até o banco");
  {
    const pend = agruparPendencias(normalizarLinhas([{ Produto: "Kit", ID: "169417000000123", "ID Model": "555000000000123", "Vendas (Pedido pago) (BRL)": 10, "Cobertura de custo": "sem custo" }]));
    const mem = instalarBancoEmMemoria({ marketplace: "shopee" });
    try {
      const preenchida = preencher(montarPlanilhaPendencias(pend, { marketplace: "shopee" }), { H2: 9.9 });
      const previa = await analisarPlanilhaBase(preenchida, "pendencias.xlsx", { marketplace: "shopee" });
      eq("Item e Model intactos no parser real", [previa.dados_importacao[0].id, previa.dados_importacao[0].id_model], ["169417000000123", "555000000000123"]);
      const { linhas } = bc.classificarLinhasPlanilha({ marketplace: "shopee", dados: previa.dados_importacao, itensBase: [] });
      const l = linhas[0];
      await upsert({ produto_id: l.produtoId, custo_produto: l.custo, id_model: l.idModel });
      eq("gravado com produto_id e id_model exatos", [mem.rows[0].produto_id, mem.rows[0].id_model, Number(mem.rows[0].custo_produto)], ["169417000000123", "555000000000123", 9.9]);
    } finally {
      mem.restaurar();
    }
  }

  console.log("▸ Caracterização do upsert (por que a tela protege o Shopee)");
  {
    const mem = instalarBancoEmMemoria({ marketplace: "shopee", custos: [{ produto_id: "111", id_model: "A", custo_produto: 20, imposto_percentual: 0.1 }] });
    try {
      await upsert({ produto_id: "111", custo_produto: 5, id_model: "B" });
      eq("outro Model no MESMO Item sobrescreve o registro (a identidade é o produto_id)", [mem.rows.length, mem.rows[0].id_model, Number(mem.rows[0].custo_produto)], [1, "B", 5]);
      await upsert({ produto_id: "111", custo_produto: 6 });
      eq("omitir id_model ZERA o existente (por isso a tela sempre o envia)", mem.rows[0].id_model, null);
    } finally {
      mem.restaurar();
    }
  }

  console.log("▸ Contrato de cabeçalhos");
  eq("colunas da planilha", COLUNAS_PLANILHA_PENDENCIAS, ["Nome do produto", "ID", "SKU", "Model ID", "Motivo", "Receita impactada", "Custo atual", "Novo custo", "Imposto (%)"]);
  {
    const cab = ["Produto", "ID", "SKU", "Model ID", "Motivo", "Receita impactada", "Custo atual", "Novo custo", "Imposto (%)"];
    const ws = XLSX.utils.aoa_to_sheet([cab, ["Calça", "MLB1", "", "", "x", 1, "", 12.5, ""]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "p");
    const arm = await analisarPlanilhaBase(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), "p.xlsx", { marketplace: "meli" });
    const c = arm.colunas || arm.mapeamento || arm.colunas_detectadas;
    ok("com o cabeçalho 'Produto' o leitor confunde nome com custo (por isso é proibido)", c.custo.cabecalho === "Produto");
  }

  console.log(`\n✓ ${checks} verificações do contrato Financeiro V3 ↔ Bases de Custo`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
