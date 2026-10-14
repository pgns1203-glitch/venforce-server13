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

  console.log("\n▸ Upsert por variação (POST /bases/:slug/custos/upsert)");
  const { upsertCustoBaseController } = require("../controllers/basesController");
  const linhasRf = parsePlanilha(planilha([H, ["7001", "9101", 10, 0.08], ["7001", "9102", 20, 0.08]]), "base.xlsx", "shopee");
  await baseImportService.criarBaseComCustos({ slug: "upsert-shopee", nomeBase: "upsert shopee", marketplace: "shopee", linhasPersistiveis: linhasRf });
  async function upsert(body, slug = "upsert-shopee") {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await upsertCustoBaseController({ params: { baseSlug: slug }, body, user: { id: 1, role: "admin" }, headers: {}, socket: {} }, res);
    return res;
  }
  const variacoes = async (item) => (await pool.query(
    `SELECT id_model, custo_produto::float AS custo, imposto_percentual::float AS imposto FROM custos c JOIN bases b ON b.id = c.base_id
      WHERE b.slug = 'upsert-shopee' AND produto_id = $1 ORDER BY id_model NULLS FIRST`, [item])).rows;
  {
    const r = await upsert({ produto_id: "7001", id_model: "9101", custo_produto: 15 });
    const v = await variacoes("7001");
    ok("atualizar o Model A não altera o Model B", r.statusCode === 200 && r.body.acao === "atualizado" &&
      JSON.stringify(v) === JSON.stringify([{ id_model: "9101", custo: 15, imposto: 0.08 }, { id_model: "9102", custo: 20, imposto: 0.08 }]));
  }
  {
    const r = await upsert({ produto_id: "7001", id_model: "9103", custo_produto: 35, imposto_percentual: 0.12 });
    const v = await variacoes("7001");
    ok("criar o Model C não apaga A/B (custo e imposto próprios)", r.body.acao === "criado" && v.length === 3 &&
      v.find((x) => x.id_model === "9103").custo === 35 && v.find((x) => x.id_model === "9103").imposto === 0.12);
  }
  {
    const r = await upsert({ produto_id: "7001", custo_produto: 99 });
    const v = await variacoes("7001");
    ok("omitir o Model num Item só com variações → 409 SHOPEE_MODEL_OBRIGATORIO, nada muda",
      r.statusCode === 409 && r.body.code === "SHOPEE_MODEL_OBRIGATORIO" && r.body.variacoes.length === 3 && v.every((x) => x.custo !== 99) && v.length === 3);
  }
  {
    const r = await upsert({ produto_id: "7002", custo_produto: 8 });
    const r2 = await upsert({ produto_id: "7002", custo_produto: 9 });
    const v = await variacoes("7002");
    ok("Item novo sem Model → cria a linha pai; o 2º upsert atualiza a mesma", r.body.acao === "criado" && r2.body.acao === "atualizado" && v.length === 1 && v[0].id_model === null && v[0].custo === 9);
  }
  {
    await upsert({ produto_id: "7002", id_model: "9201", custo_produto: 30 });
    const r = await upsert({ produto_id: "7002", custo_produto: 10 });
    const v = await variacoes("7002");
    ok("Item com pai + variação: sem Model atualiza SÓ o pai", r.body.acao === "atualizado" &&
      JSON.stringify(v.map((x) => [x.id_model, x.custo])) === JSON.stringify([[null, 10], ["9201", 30]]));
  }
  {
    const r = await upsert({ produto_id: "7001", id_model: "9102", custo_produto: 21 });
    ok("imposto omitido preserva o imposto da variação", r.body.custo.imposto_percentual === 0.08 && r.body.custo.id_model === "9102");
  }
  {
    const r = await upsert({ produto_id: "7001", id_model: "9102.0", custo_produto: 0 });
    const v = await variacoes("7001");
    ok("id_model normalizado como no importador (\"9102.0\" = 9102); custo 0 explícito é gravado como 0",
      r.body.acao === "atualizado" && v.length === 3 && v.find((x) => x.id_model === "9102").custo === 0);
  }
  {
    const r = await upsert({ produto_id: "7001", id_model: "9101" });
    ok("custo ausente continua 400 (semântica de sempre)", r.statusCode === 400);
  }
  {
    const r = await upsert({ produto_id: "MLB123", custo_produto: 12 }, "imp-9");
    const r2 = await upsert({ produto_id: "MLB999", custo_produto: 7 }, "imp-9");
    ok("MELI: upsert por produto_id inalterado (atualiza / cria)", r.body.acao === "atualizado" && r2.body.acao === "criado" && r.body.custo.id_model === null);
  }

  console.log("\n▸ Leitura da base (GET /bases/:slug → dados)");
  const { chaveDadosCusto } = require("../services/bases/baseCustosService");
  {
    const rows = (await pool.query(`SELECT c.* FROM custos c JOIN bases b ON b.id = c.base_id WHERE b.slug = 'upsert-shopee'`)).rows;
    const chaves = rows.map((r) => chaveDadosCusto(r, "shopee"));
    ok("Shopee: uma chave por variação — nenhuma linha some na serialização", new Set(chaves).size === rows.length);
    ok("variação = Item::model:Model; pai = Item", chaves.includes("7001::model:9101") && chaves.includes("7002"));
    const meli = (await pool.query(`SELECT c.* FROM custos c WHERE base_id = 1`)).rows;
    ok("MELI: chave = MLB, como sempre", meli.every((r) => chaveDadosCusto(r, "meli") === r.produto_id));
    const tiktok = (await pool.query(`SELECT c.* FROM custos c WHERE base_id = 3`)).rows;
    ok("TikTok: chave = sku_id, como sempre", tiktok.every((r) => chaveDadosCusto(r, "tiktok") === r.sku_id));
  }

  console.log(`\ncustosShopeeItemModelSqlCheck: ${checks}/${checks} verificações SQL OK (PGlite)`);
  await fechar();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
