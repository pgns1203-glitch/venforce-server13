#!/usr/bin/env node
// server/scripts/shopeeGrantsSqlCheck.js
// Prova o SQL real de shopee_grants + shopeeGrantService contra PostgreSQL em
// memória (PGlite). Nunca lê DATABASE_URL nem server/.env.
//
//   npm install --no-save @electric-sql/pglite@0.2   (ou NODE_PATH apontando p/ uma instalação)
//   node scripts/shopeeGrantsSqlCheck.js
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

let PGlite;
try {
  ({ PGlite } = require("@electric-sql/pglite"));
} catch {
  console.error("Instale antes (sem salvar no package.json): npm install --no-save @electric-sql/pglite@0.2");
  process.exit(2);
}
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/nunca-usado";
const { salvarGrantLive, statusGrantsLive, validarContaShopee } = require("../services/shopee/shopeeGrantService");
const { decifrar } = require("../services/shopee/shopeeTokenCrypto");

const MIGRATION = fs.readFileSync(path.join(__dirname, "..", "sql", "migrations", "20261029_shopee_grants.sql"), "utf8");
const CHAVE = crypto.randomBytes(32);
const noop = async () => {};

async function rejeita(promise, code, label) {
  try {
    await promise;
  } catch (e) {
    assert.strictEqual(e.code, code, `${label}: esperado ${code}, veio ${e.code} (${e.message})`);
    console.log(`  ✓ ${label}`);
    return;
  }
  assert.fail(`${label}: deveria rejeitar`);
}

(async () => {
  const pg = new PGlite();
  const db = { query: (sql, params) => pg.query(sql, params) };
  const opts = { db, ensureSchema: noop };

  await pg.exec(`
    CREATE TABLE clientes (id SERIAL PRIMARY KEY, nome TEXT, ativo BOOLEAN NOT NULL DEFAULT true);
    CREATE TABLE cliente_contas (
      id SERIAL PRIMARY KEY,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      marketplace TEXT NOT NULL, nome TEXT NOT NULL,
      external_account_id TEXT, ativo BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE UNIQUE INDEX uq_cliente_contas_external_account
      ON cliente_contas (cliente_id, marketplace, external_account_id) WHERE external_account_id IS NOT NULL;
    INSERT INTO clientes (id, nome, ativo) VALUES (1, 'A', true), (2, 'B', true), (3, 'Inativo', false);
    INSERT INTO cliente_contas (id, cliente_id, marketplace, nome, external_account_id, ativo) VALUES
      (10, 1, 'shopee', 'loja-a', NULL, true),
      (20, 2, 'shopee', 'loja-b', NULL, true),
      (11, 1, 'meli', 'ml-a', '123', true),
      (12, 1, 'shopee', 'inativa', NULL, false),
      (13, 3, 'shopee', 'cli-inativo', NULL, true),
      (30, 1, 'shopee', 'preset', '900', true),
      (40, 2, 'shopee', 'falha', NULL, true);
  `);
  await pg.exec(MIGRATION);
  await pg.exec(MIGRATION);
  const fk = await pg.query("SELECT 1 FROM pg_constraint WHERE conname = 'shopee_grants_cliente_conta_fk'");
  assert.strictEqual(fk.rows.length, 1);
  console.log("  ✓ migration aplica 2x (idempotente) e cria a FK guardada");

  const dados = (extra = {}) => ({
    clienteContaId: 10, app: "marketing", shopId: 555, accessToken: "AT-1", refreshToken: "RT-1",
    expireIn: 14400, userId: 42, shopeeRequestId: "rq1", chaveCifra: CHAVE, ...extra,
  });

  // 1. primeira autorização
  const t0 = Date.now();
  const r1 = await salvarGrantLive(dados(), { ...opts, now: () => t0 });
  assert.strictEqual(r1.reautorizacao, false);
  const linha = (await pg.query("SELECT * FROM shopee_grants WHERE id = $1", [r1.grantId])).rows[0];
  assert.strictEqual(String(linha.shop_id), "555");
  assert.strictEqual(linha.ambiente, "live");
  assert.strictEqual(linha.status, "active");
  assert.strictEqual(linha.authorized_by, 42);
  assert.ok(!linha.access_token_enc.includes("AT-1") && !linha.refresh_token_enc.includes("RT-1"), "tokens não ficam em claro");
  assert.strictEqual(decifrar(linha.access_token_enc, { ambiente: "live", app: "marketing", shopId: 555, tipo: "access" }, CHAVE), "AT-1");
  assert.strictEqual(decifrar(linha.refresh_token_enc, { ambiente: "live", app: "marketing", shopId: 555, tipo: "refresh" }, CHAVE), "RT-1");
  assert.strictEqual(new Date(linha.access_token_expires_at).getTime(), t0 + 14400 * 1000);
  const conta10 = (await pg.query("SELECT external_account_id FROM cliente_contas WHERE id = 10")).rows[0];
  assert.strictEqual(conta10.external_account_id, "555");
  console.log("  ✓ persistência: tokens cifrados (decifram com AAD certo), expiração, Conta recebe o shop_id");

  // 2. reautorização da mesma loja na mesma Conta
  const r2 = await salvarGrantLive(dados({ accessToken: "AT-2", refreshToken: "RT-2" }), opts);
  assert.strictEqual(r2.grantId, r1.grantId);
  assert.strictEqual(r2.reautorizacao, true);
  const total = (await pg.query("SELECT count(*)::int AS n FROM shopee_grants")).rows[0].n;
  assert.strictEqual(total, 1);
  const l2 = (await pg.query("SELECT access_token_enc FROM shopee_grants WHERE id = $1", [r1.grantId])).rows[0];
  assert.strictEqual(decifrar(l2.access_token_enc, { ambiente: "live", app: "marketing", shopId: 555, tipo: "access" }, CHAVE), "AT-2");
  console.log("  ✓ reautorização: mesma linha atualizada (sem duplicar)");

  // 3. a mesma loja em outra Conta (outro Cliente)
  await rejeita(salvarGrantLive(dados({ clienteContaId: 20 }), opts), "SHOP_EM_OUTRA_CONTA", "loja já vinculada não vai para outra Conta");
  assert.strictEqual((await pg.query("SELECT external_account_id FROM cliente_contas WHERE id = 20")).rows[0].external_account_id, null);
  // 4. a Conta já vinculada não troca de loja
  await rejeita(salvarGrantLive(dados({ shopId: 556 }), opts), "SHOPEE_ACCOUNT_MISMATCH", "Conta vinculada à loja 555 recusa a loja 556");
  // 5. Conta com external_account_id definido manualmente
  await rejeita(salvarGrantLive(dados({ clienteContaId: 30, shopId: 901 }), opts), "SHOPEE_ACCOUNT_MISMATCH", "external_account_id manual 900 recusa a loja 901");
  const r30 = await salvarGrantLive(dados({ clienteContaId: 30, shopId: 900 }), opts);
  assert.strictEqual(r30.clienteContaId, 30);
  console.log("  ✓ external_account_id manual 900 aceita a loja 900");
  // 6. Conta errada
  await rejeita(salvarGrantLive(dados({ clienteContaId: 11, shopId: 777 }), opts), "MARKETPLACE_INCORRETO", "Conta meli recusada");
  await rejeita(salvarGrantLive(dados({ clienteContaId: 12, shopId: 777 }), opts), "CONTA_INATIVA", "Conta inativa recusada");
  await rejeita(salvarGrantLive(dados({ clienteContaId: 13, shopId: 777 }), opts), "CLIENTE_INATIVO", "Cliente inativo recusado");
  await rejeita(salvarGrantLive(dados({ clienteContaId: 999, shopId: 777 }), opts), "CONTA_NAO_ENCONTRADA", "Conta inexistente recusada");
  await rejeita(salvarGrantLive(dados({ chaveCifra: null, shopId: 777 }), opts), "CHAVE_CIFRA_AUSENTE", "sem chave de cifra não grava");
  await rejeita(validarContaShopee(11, db), "MARKETPLACE_INCORRETO", "validarContaShopee: meli recusada");

  // 7. falha no meio da transação → rollback, nada gravado
  const dbFalho = {
    query: (sql, params) => (/^UPDATE cliente_contas/.test(sql.trim()) ? Promise.reject(Object.assign(new Error("conexão caiu AT-X"), { code: "57P01" })) : pg.query(sql, params)),
  };
  await rejeita(salvarGrantLive(dados({ clienteContaId: 40, shopId: 4040, accessToken: "AT-X" }), { db: dbFalho, ensureSchema: noop }), "GRANT_NAO_PERSISTIDO", "falha no meio → GRANT_NAO_PERSISTIDO");
  assert.strictEqual((await pg.query("SELECT count(*)::int AS n FROM shopee_grants WHERE cliente_conta_id = 40")).rows[0].n, 0, "rollback: nenhuma linha");
  try {
    await salvarGrantLive(dados({ clienteContaId: 40, shopId: 4041, accessToken: "AT-X" }), { db: dbFalho, ensureSchema: noop });
  } catch (e) {
    assert.ok(!String(e.message).includes("AT-X") && !JSON.stringify(e).includes("AT-X"), "erro de banco não carrega token");
  }
  console.log("  ✓ rollback completo e erro sem token");

  // 8. status: só metadados
  const st = await statusGrantsLive({ clienteContaId: 10 }, opts);
  assert.strictEqual(st.length, 1);
  assert.deepStrictEqual(Object.keys(st[0]).sort(), ["accessTokenExpiraEm", "app", "atualizadoEm", "autorizadoEm", "autorizadoPor", "clienteContaId", "grantId", "refreshTokenPresente", "shopId", "status", "tokenPresente"]);
  assert.strictEqual(st[0].tokenPresente, true);
  assert.ok(!JSON.stringify(st).includes("v1."), "nenhum texto cifrado no status");
  assert.strictEqual((await statusGrantsLive({}, opts)).length, 2);
  console.log("  ✓ status: só metadados (sem token nem texto cifrado)");

  // 9. CHECKs e FK
  await rejeita(pg.query("INSERT INTO shopee_grants (cliente_conta_id, ambiente, app, shop_id, access_token_enc, refresh_token_enc, access_token_expires_at) VALUES (20, 'test', 'marketing', 1, 'x', 'y', NOW())"), "23514", "CHECK: ambiente só 'live'");
  await rejeita(pg.query("INSERT INTO shopee_grants (cliente_conta_id, ambiente, app, shop_id, access_token_enc, refresh_token_enc, access_token_expires_at) VALUES (20, 'live', 'marketing', 555, 'x', 'y', NOW())"), "23505", "UNIQUE: loja em duas Contas barrada pelo banco");
  await pg.query("DELETE FROM cliente_contas WHERE id = 30");
  assert.strictEqual((await pg.query("SELECT count(*)::int AS n FROM shopee_grants WHERE cliente_conta_id = 30")).rows[0].n, 0);
  console.log("  ✓ FK: Conta apagada leva o grant (CASCADE)");

  await pg.close();
  console.log("\n✓ shopeeGrantsSqlCheck: SQL real validado");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
