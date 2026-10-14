#!/usr/bin/env node
// server/scripts/custosShopeeItemModelSqlCheck.js
//
// FIN-508 — validação do SQL das Bases de Custo Shopee por Item + Model
// contra um Postgres REAL em memória (PGlite): migration (2x, sobre dados
// legados), unicidade nova × MELI × TikTok, importação pelo parser e pelo
// service reais, upsert por variação e a leitura que vai para o fechamento.
//
// SEGURANÇA: nunca lê DATABASE_URL e nunca abre conexão de rede.
//
// Uso (a partir de server/, sem alterar package.json):
//   npm install --no-save @electric-sql/pglite@0.3
//   node scripts/custosShopeeItemModelSqlCheck.js

process.env.DATABASE_URL = "postgres://127.0.0.1:1/custos-shopee-item-model-nunca-conecta";

const assert = require("assert");
const XLSX = require("xlsx");
const { criarBancoCustos, carregarParsePlanilha } = require("./lib/custosPglite");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
async function falha(promessa) {
  try { await promessa; return null; } catch (e) { return e; }
}

function planilha(aoa) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Custos");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function main() {
  // ── 1. Banco como estava em produção ANTES da FIN-508 ───────────────────
  const { pool, fechar } = await criarBancoCustos({ ensure: false });
  await pool.query(`ALTER TABLE custos ADD COLUMN IF NOT EXISTS produto_nome TEXT`);
  await pool.query(`ALTER TABLE custos ADD COLUMN IF NOT EXISTS variacao_nome TEXT`);
  await pool.query(`ALTER TABLE custos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
  await pool.query(`ALTER TABLE custos ADD COLUMN IF NOT EXISTS sku TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE custos ADD COLUMN IF NOT EXISTS sku_id TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE custos DROP CONSTRAINT IF EXISTS custos_base_id_produto_id_key`);
  await pool.query(`CREATE UNIQUE INDEX uq_custos_base_sku_id ON custos (base_id, sku_id) WHERE sku_id <> ''`);
  await pool.query(`CREATE UNIQUE INDEX uq_custos_base_produto_sku_legado ON custos (base_id, produto_id, sku) WHERE sku_id = ''`);
  await pool.query(`INSERT INTO bases (slug, nome, marketplace) VALUES ('legado-meli','legado meli','meli'),('legado-shopee','legado shopee','shopee'),('legado-tiktok','legado tiktok','tiktok')`);
  await pool.query(`INSERT INTO custos (base_id, produto_id, custo_produto, imposto_percentual) VALUES (1,'MLB111',10,0.1),(1,'MLB222',20,0.1)`);
  // Base Shopee achatada: o Item 9001 ficou com UM registro (o último Model importado).
  await pool.query(`INSERT INTO custos (base_id, produto_id, custo_produto, imposto_percentual, id_model) VALUES (2,'9001',30,0.08,'7003'),(2,'9002',15,0.08,NULL)`);
  await pool.query(`INSERT INTO custos (base_id, produto_id, sku_id, custo_produto, imposto_percentual) VALUES (3,'1729','1729000000000000001',5,0.1),(3,'1729','1729000000000000002',6,0.1)`);
  const antes = (await pool.query(`SELECT id, base_id, produto_id, sku_id, custo_produto::text, imposto_percentual::text, id_model FROM custos ORDER BY id`)).rows;

  console.log("\n▸ Migration sobre dados legados");
  const { ensureColunasCustos } = require("../services/bases/baseCustosService");
  await ensureColunasCustos();
  await ensureColunasCustos();
  const indices = (await pool.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'custos'`)).rows;
  const nomes = indices.map((i) => i.indexname);
  ok("índice novo (base, produto_id, sku, COALESCE(id_model,'')) criado", nomes.includes("uq_custos_base_produto_sku_model"));
  ok("índice antigo que achatava as variações removido", !nomes.includes("uq_custos_base_produto_sku_legado"));
  ok("índice TikTok (base, sku_id) intocado", nomes.includes("uq_custos_base_sku_id"));
  ok("aplicada 2x sem erro (idempotente)", true);
  const depois = (await pool.query(`SELECT id, base_id, produto_id, sku_id, custo_produto::text, imposto_percentual::text, id_model FROM custos ORDER BY id`)).rows;
  ok("nenhuma linha legada alterada, apagada ou criada", JSON.stringify(antes) === JSON.stringify(depois));

  console.log("\n▸ Unicidade por canal");
  await pool.query(`INSERT INTO custos (base_id, produto_id, custo_produto, id_model) VALUES (2,'9001',31,'7001'),(2,'9001',32,'7002')`);
  ok("Shopee: mesmo Item com Models diferentes coexiste", (await pool.query(`SELECT COUNT(*)::int n FROM custos WHERE base_id=2 AND produto_id='9001'`)).rows[0].n === 3);
  ok("Shopee: mesma variação (Item + Model) duplicada é recusada",
    !!(await falha(pool.query(`INSERT INTO custos (base_id, produto_id, custo_produto, id_model) VALUES (2,'9001',99,'7001')`))));
  ok("Shopee: segunda linha 'pai' (sem Model) do mesmo Item é recusada",
    !!(await falha(pool.query(`INSERT INTO custos (base_id, produto_id, custo_produto) VALUES (2,'9002',99)`))));
  ok("Shopee: Model NULL e Model '' são a mesma identidade (pai)",
    !!(await falha(pool.query(`INSERT INTO custos (base_id, produto_id, custo_produto, id_model) VALUES (2,'9002',99,'')`))));
  ok("MELI: produto_id repetido continua recusado",
    !!(await falha(pool.query(`INSERT INTO custos (base_id, produto_id, custo_produto) VALUES (1,'MLB111',99)`))));
  ok("TikTok: sku_id repetido continua recusado",
    !!(await falha(pool.query(`INSERT INTO custos (base_id, produto_id, sku_id, custo_produto) VALUES (3,'1729','1729000000000000001',99)`))));

  console.log("\n▸ Importação (parsePlanilha + baseImportService reais)");
  const parsePlanilha = carregarParsePlanilha();
  const baseImportService = require("../services/bases/baseImportService");
  // MELI exige conta + vínculo na criação; o vínculo não é o que se testa aqui.
  require("../services/baseVinculosService").criarVinculoManualTx = async () => ({ vinculo: null });
  let n = 0;
  async function importar(aoa, marketplace = "shopee") {
    const linhas = parsePlanilha(planilha(aoa), "base.xlsx", marketplace);
    n += 1;
    const r = await baseImportService.criarBaseComCustos({
      slug: `imp-${n}`, nomeBase: `imp ${n}`, marketplace, linhasPersistiveis: linhas,
      ...(marketplace === "meli" ? { clienteContaId: 1 } : {}),
    });
    const rows = (await pool.query(`SELECT produto_id, id_model, custo_produto::float AS custo, imposto_percentual::float AS imposto FROM custos WHERE base_id=$1 ORDER BY produto_id, id_model NULLS FIRST`, [r.baseId])).rows;
    return { r, rows, linhas };
  }
  const H = ["ID", "ID Model", "Custo", "Imposto"];
  {
    const { r, rows } = await importar([H, ["5001", "8001", 10, 0.08]]);
    ok("A · 1 Item + 1 Model → 1 linha com o Model", rows.length === 1 && rows[0].id_model === "8001" && r.total === 1);
  }
  {
    const { r, rows } = await importar([H, ["5001", "8001", 10, 0.08], ["5001", "8002", 10, 0.08], ["5001", "8003", 10, 0.08]]);
    ok("B · 1 Item + 3 Models de mesmo custo → 3 linhas", rows.length === 3 && r.total === 3);
  }
  {
    const { rows } = await importar([H, ["5001", "8001", 10, 0.08], ["5001", "8002", 20, 0.08], ["5001", "8003", 35, 0.12]]);
    ok("C · 1 Item + 3 Models de custos diferentes → cada Model com o SEU custo",
      JSON.stringify(rows.map((x) => [x.id_model, x.custo, x.imposto])) === JSON.stringify([["8001", 10, 0.08], ["8002", 20, 0.08], ["8003", 35, 0.12]]));
  }
  {
    const { r, rows } = await importar([H, ["5001", "8001", 10, 0.08], ["5001", "8002", 20, 0.08], ["5002", "8101", 5, 0.08], ["5002", "8102", 6, 0.08], ["5002", "8103", 7, 0.08]]);
    ok("D · 2 Items com vários Models → 5 linhas; contador = banco", rows.length === 5 && r.total === 5);
  }
  {
    const { r, rows } = await importar([H, ["5001", "8001", 10, 0.08], ["5001", "8001", 10, 0.08], ["5001", "8002", 20, 0.08]]);
    ok("E · mesma variação repetida e idêntica → uma linha só", rows.length === 2 && r.total === 2);
  }
  {
    let erro = null;
    try { parsePlanilha(planilha([H, ["5001", "8001", 10, 0.08], ["5001", "8001", 12, 0.08]]), "base.xlsx", "shopee"); } catch (e) { erro = e; }
    ok("F · mesma variação com custo divergente → 422, nada escolhido", erro?.statusCode === 422 && /Item 5001 \/ Model 8001/.test(erro.message) && /linhas 2 e 3/.test(erro.message));
  }
  {
    const { rows } = await importar([["ID", "Custo", "Imposto"], ["5001", 10, 0.08], ["5002", 12, 0.08]]);
    ok("G · Shopee sem coluna de Model → linhas 'pai' (Model NULL), como antes", rows.length === 2 && rows.every((x) => x.id_model === null));
  }
  {
    const { rows } = await importar([H, ["5001", "", 10, 0.08], ["5001", "8001", 12, 0.08]]);
    ok("linha pai e variação do mesmo Item coexistem (legado + Model)", rows.length === 2);
  }
  {
    const { r, rows } = await importar([["ID", "Custo", "Imposto"], ["MLB123", 10, 0.1], ["MLB456", 20, 0.1]], "meli");
    ok("MELI · importação inalterada (sem id_model)", rows.length === 2 && rows.every((x) => x.id_model === null) && r.total === 2);
  }
  {
    // MELI com o mesmo MLB duas vezes: ON CONFLICT como sempre (a última vence);
    // o contador agora diz o que ficou no banco.
    const { r, rows } = await importar([["ID", "Custo", "Imposto"], ["MLB123", 10, 0.1], ["MLB123", 11, 0.1]], "meli");
    ok("MELI · MLB repetido continua uma linha; contador = banco (1, não 2)", rows.length === 1 && r.total === 1 && r.linhasRecebidas === 2);
  }

  console.log(`\ncustosShopeeItemModelSqlCheck: ${checks}/${checks} verificações SQL OK (PGlite)`);
  await fechar();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
