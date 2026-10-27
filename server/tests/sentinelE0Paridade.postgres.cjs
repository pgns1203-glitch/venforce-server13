// server/tests/sentinelE0Paridade.postgres.cjs
//
// Script de paridade da E0 contra um PostgreSQL LOCAL e isolado (fora do run-all).
//
//   SENTINEL_TEST_DATABASE_URL=postgres://vf@127.0.0.1:57651/postgres node tests/sentinelE0Paridade.postgres.cjs
//
// Cria um database descartável, aplica o schema da Central + a migration do
// Sentinel, grava um import fictício e linhas fictícias do Sentinel, roda o
// script de verdade (processo filho, com DATABASE_URL local) e apaga o banco.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { Client } = require("pg");

const baseUrl = process.env.SENTINEL_TEST_DATABASE_URL;
if (!baseUrl) throw new Error("Defina SENTINEL_TEST_DATABASE_URL (PostgreSQL local).");
const parsed = new URL(baseUrl);
if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) throw new Error("LOCAL_DATABASE_REQUIRED");
const dbName = `vf_e0_paridade_test_${Date.now()}`;
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${dbName}`;

async function main() {
  const admin = new Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  const db = new Client({ connectionString: testUrl.toString() });
  try {
    await db.connect();
    await db.query("CREATE TABLE clientes (id SERIAL PRIMARY KEY); CREATE TABLE cliente_contas (id SERIAL PRIMARY KEY); CREATE TABLE bases (id SERIAL PRIMARY KEY); CREATE TABLE ml_tokens (id SERIAL PRIMARY KEY); CREATE TABLE users (id SERIAL PRIMARY KEY);");
    await db.query("INSERT INTO clientes (id) VALUES (1); INSERT INTO cliente_contas (id) VALUES (10);");
    await db.query(fs.readFileSync(path.join(__dirname, "../sql/central_vendas_schema.sql"), "utf8"));
    await db.query(fs.readFileSync(path.join(__dirname, "../sql/migrations/20261023_sentinel_pedidos.sql"), "utf8"));

    const imp = await db.query(
      `INSERT INTO central_vendas_imports (id, cliente_slug, competencia, cliente_conta_id, publication_status, created_at)
       VALUES (900, 'cliente_teste', '2026-09', 10, 'published', '2026-10-07T12:00:00Z') RETURNING id`
    );
    const importId = imp.rows[0].id;
    async function pedidoCentral(pedidoId, { fat, lc, mpct, comissao, frete, custo, imposto, mlb, qtd }) {
      const p = await db.query(
        `INSERT INTO central_vendas_pedidos (import_id, cliente_slug, competencia, pedido_id, status, confianca,
           faturamento, lucro_contribuicao, margem_contribuicao_percentual)
         VALUES ($1,'cliente_teste','2026-09',$2,'pago','confiavel',$3,$4,$5) RETURNING id`,
        [importId, pedidoId, fat, lc, mpct]
      );
      const it = await db.query(
        `INSERT INTO central_vendas_pedido_itens (import_id, pedido_row_id, cliente_slug, competencia, pedido_id, item_id,
           mlb, quantidade, custo_produto, confianca)
         VALUES ($1,$2,'cliente_teste','2026-09',$3,$4,$5,$6,$7,'confiavel') RETURNING id`,
        [importId, p.rows[0].id, pedidoId, `${pedidoId}:${mlb}:0`, mlb, qtd, custo]
      );
      for (const [tipo, valor] of [["tarifa_venda", -comissao], ["frete_seller", -frete], ["custo_produto", -custo], ["imposto_interno", -imposto]]) {
        await db.query(
          `INSERT INTO central_vendas_componentes (import_id, pedido_row_id, item_row_id, cliente_slug, competencia, pedido_id,
             item_id, tipo, valor, fonte, confianca)
           VALUES ($1,$2,$3,'cliente_teste','2026-09',$4,$5,$6,$7,'teste','confiavel')`,
          [importId, p.rows[0].id, it.rows[0].id, pedidoId, `${pedidoId}:${mlb}:0`, tipo, valor]
        );
      }
    }
    await pedidoCentral("P1", { fat: 100, lc: 20, mpct: 20, comissao: 12, frete: 10, custo: 50, imposto: 8, mlb: "MLB1", qtd: 2 });
    await pedidoCentral("P2", { fat: 200, lc: 40, mpct: 20, comissao: 24, frete: 20, custo: 100, imposto: 16, mlb: "MLB2", qtd: 1 });

    async function pedidoSentinel(pedidoId, { atualizado, fat, lc, mpct, comissao, frete, custo, imposto, mlb, qtd, custoUnit }) {
      await db.query(
        `INSERT INTO sentinel_pedidos (cliente_id, cliente_conta_id, pedido_id, competencia, ml_date_last_updated, status_ml,
           itens, faturamento, comissao, frete, custo, imposto, margem_valor, margem_pct, estado_margem)
         VALUES (1, 10, $1, '2026-09', $2, 'paid', $3::jsonb, $4,$5,$6,$7,$8,$9,$10,'confirmada')`,
        [pedidoId, atualizado, JSON.stringify([{ item_id: mlb, quantidade: qtd, custo_unitario: custoUnit }]),
          fat, comissao, frete, custo, imposto, lc, mpct]
      );
    }
    // P1 congelado e idêntico; P2 congelado com 1 centavo de frete diferente; P3 só no Sentinel.
    await pedidoSentinel("P1", { atualizado: "2026-10-01T00:00:00Z", fat: 100, lc: 20, mpct: 20, comissao: 12, frete: 10, custo: 50, imposto: 8, mlb: "MLB1", qtd: 2, custoUnit: 25 });
    await pedidoSentinel("P2", { atualizado: "2026-10-01T00:00:00Z", fat: 200, lc: 39.99, mpct: 20, comissao: 24, frete: 20.01, custo: 100, imposto: 16, mlb: "MLB2", qtd: 1, custoUnit: 100 });
    await pedidoSentinel("P3", { atualizado: "2026-10-20T00:00:00Z", fat: 50, lc: 5, mpct: 10, comissao: 6, frete: 5, custo: 30, imposto: 4, mlb: "MLB3", qtd: 1, custoUnit: 30 });

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "vf-e0-paridade-"));
    const saida = execFileSync(process.execPath, [
      path.join(__dirname, "../scripts/sentinel-e0-paridade.js"), "--conta=10", "--import=900", `--out=${outDir}`,
    ], { env: { ...process.env, DATABASE_URL: testUrl.toString() }, encoding: "utf8" });
    assert.match(saida, /somente leitura/);
    const json = JSON.parse(fs.readFileSync(path.join(outDir, "paridade-conta10-import900.json"), "utf8"));
    const r = json.resumo;
    assert.strictEqual(r.nos_dois, 2);
    assert.strictEqual(r.so_no_sentinel, 1);
    assert.strictEqual(r.so_no_import, 0);
    assert.strictEqual(r.congelados, 2);
    assert.strictEqual(r.congelados_identicos, 1);
    assert.strictEqual(r.divergencias_congelados_por_campo.frete, 1);
    assert.strictEqual(r.divergencias_congelados_por_campo.lc, 1);
    assert.deepStrictEqual(r.agregado_congelados.faturamento, { pedidos: 2, central: 300, sentinel: 300, diferenca: 0 });
    assert.strictEqual(r.itens_com_divergencia, 0, "custo unitário×quantidade bate com o custo total do item");
    console.log("  ok  script de paridade em PG real: identidade, divergência de 1 centavo, agregado e itens");

    const escritas = await db.query("SELECT COUNT(*)::int AS n FROM sentinel_pedidos");
    assert.strictEqual(escritas.rows[0].n, 3, "o script não escreveu nada");
    console.log("  ok  nenhuma escrita feita pelo script");
    fs.rmSync(outDir, { recursive: true, force: true });
  } finally {
    await db.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`).catch(() => {});
    await admin.end().catch(() => {});
  }
  console.log("\n2 verificações passaram (PostgreSQL local).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
