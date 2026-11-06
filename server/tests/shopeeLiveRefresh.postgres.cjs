// Refresh Shopee LIVE contra PostgreSQL REAL (lock, transação, rotação do
// refresh_token, concorrência, 3 grants). Fora do `npm test`: precisa de um
// PostgreSQL local descartável.
//
//   SHOPEE_REFRESH_TEST_DATABASE_URL=postgres://vf@127.0.0.1:57651/vf_shopee_refresh_test_1 \
//   DATABASE_URL=postgres://127.0.0.1:1/nunca node tests/shopeeLiveRefresh.postgres.cjs
//
// Cria e apaga o próprio database. Só aceita host local e nome vf_shopee_refresh_test_*.
// A Shopee é FALSA: guarda o refresh_token válido de cada loja e invalida o
// anterior a cada uso (rotação), como a real.
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const url = process.env.SHOPEE_REFRESH_TEST_DATABASE_URL;
if (!url) {
  console.error("Defina SHOPEE_REFRESH_TEST_DATABASE_URL (PostgreSQL local descartável).");
  process.exit(2);
}
const parsed = new URL(url);
if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || !/^\/vf_shopee_refresh_test_[a-z0-9_]+$/.test(parsed.pathname)) {
  console.error("LOCAL_ISOLATED_DATABASE_REQUIRED");
  process.exit(2);
}
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/nunca";

const { salvarGrantLive, refreshGrantLive, statusGrantsLive, listarGrantsParaRefresh, listarContasShopee } = require("../services/shopee/shopeeGrantService");
const { decifrar } = require("../services/shopee/shopeeTokenCrypto");
const { refreshAccessToken, ShopeeAuthError, CODES } = require("../services/shopee/shopeeTestAuth");
const { readLiveConfig } = require("../services/shopee/shopeeLiveConfig");
const { createShopeeRefreshWorker } = require("../services/shopee/shopeeRefreshWorker");

const MIGS = ["20261029_shopee_grants.sql", "20261106_shopee_grants_refresh.sql"]
  .map((f) => fs.readFileSync(path.join(__dirname, "..", "sql", "migrations", f), "utf8"));
const LIVE_KEY = "fake-live-partner-key-pg-refresh-777";
const CIFRA_HEX = crypto.randomBytes(32).toString("hex");
const ENV_LIVE = {
  SHOPEE_LIVE_MARKETING_PARTNER_ID: "2000002",
  SHOPEE_LIVE_MARKETING_PARTNER_KEY: LIVE_KEY,
  SHOPEE_LIVE_REDIRECT_URL: "https://api.example.com/shopee/callback",
  SHOPEE_LIVE_API_ORIGIN: "https://partner.shopeemobile.com",
  SHOPEE_TOKEN_ENCRYPTION_KEY: CIFRA_HEX,
  SHOPEE_LIVE_TRANSPORT: "gateway",
  SHOPEE_GATEWAY_URL: "https://gw.example.com",
  SHOPEE_GATEWAY_SECRET: "segredo-de-gateway-falso-pg-0123456789abcdef",
};
const config = readLiveConfig("marketing", ENV_LIVE);
assert.strictEqual(config.configured, true);
const ctx = (shopId, tipo) => ({ ambiente: "live", app: "marketing", shopId, tipo });
const noop = async () => {};

// Shopee falsa atrás do gateway falso: rotação real (o refresh usado morre).
function criarShopeeFalsa({ atrasoMs = 0 } = {}) {
  const validos = new Map(); // shopId → refresh_token válido
  const usos = []; // {shopId, refreshToken, aceito}
  let seq = 0;
  let falharProxima = null;
  const gateway = {
    async forward(env) {
      assert.strictEqual(env.path, "/api/v2/auth/access_token/get", "só o path de refresh");
      if (atrasoMs) await new Promise((r) => setTimeout(r, atrasoMs));
      const { refresh_token: rt, shop_id: shopId } = env.body;
      if (falharProxima) {
        const tipo = falharProxima;
        falharProxima = null;
        usos.push({ shopId, refreshToken: rt, aceito: false });
        if (tipo === "timeout") throw Object.assign(new Error("t"), { code: "GATEWAY_TIMEOUT" });
        throw Object.assign(new Error("4xx"), { upstreamStatus: 403, upstreamBody: JSON.stringify({ error: "error_auth", message: "invalid refresh token", request_id: `rq-err-${shopId}` }) });
      }
      const aceito = validos.get(shopId) === rt;
      usos.push({ shopId, refreshToken: rt, aceito });
      if (!aceito) {
        throw Object.assign(new Error("4xx"), { upstreamStatus: 403, upstreamBody: JSON.stringify({ error: "error_auth", message: "refresh token already used", request_id: `rq-reuse-${shopId}` }) });
      }
      seq += 1;
      const novoRefresh = `RT-${shopId}-v${seq}-${crypto.randomBytes(6).toString("hex")}`;
      const novoAccess = `AT-${shopId}-v${seq}-${crypto.randomBytes(6).toString("hex")}`;
      validos.set(shopId, novoRefresh);
      return { status: 200, body: JSON.stringify({ access_token: novoAccess, refresh_token: novoRefresh, expire_in: 14400, request_id: `rq-${shopId}-${seq}`, error: "", shop_id: shopId }) };
    },
  };
  return {
    gateway,
    usos,
    validos,
    falhar(tipo) { falharProxima = tipo; },
    refresh: (cfg, args) => refreshAccessToken(cfg, args, { gateway }),
  };
}

async function lerGrant(pool, contaId) {
  return (await pool.query("SELECT * FROM shopee_grants WHERE cliente_conta_id = $1", [contaId])).rows[0];
}
const tokensDe = (g) => ({
  access: decifrar(g.access_token_enc, ctx(Number(g.shop_id), "access"), config.chaveCifra),
  refresh: decifrar(g.refresh_token_enc, ctx(Number(g.shop_id), "refresh"), config.chaveCifra),
});

(async () => {
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  const dbName = parsed.pathname.slice(1);
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const pool = new Pool({ connectionString: url, max: 8 });
  const opts = { db: pool, ensureSchema: noop };
  try {
    await pool.query(`
      CREATE TABLE clientes (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, ativo BOOLEAN NOT NULL DEFAULT true);
      CREATE TABLE cliente_contas (
        id SERIAL PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        marketplace TEXT NOT NULL, nome TEXT NOT NULL, external_account_id TEXT,
        ativo BOOLEAN NOT NULL DEFAULT true, updated_at TIMESTAMP DEFAULT NOW());
      INSERT INTO clientes (id, nome) VALUES (1, 'Cliente A'), (2, 'Cliente B'), (3, 'Cliente C'), (4, 'Cliente ML');
      INSERT INTO cliente_contas (id, cliente_id, marketplace, nome) VALUES
        (235, 1, 'shopee', 'Loja A'), (310, 2, 'shopee', 'Loja B'), (411, 3, 'shopee', 'Loja C'), (500, 4, 'meli', 'ML');
    `);
    // Base já em produção: só a 1ª migration; depois a nova (aditiva) duas vezes.
    await pool.query(MIGS[0]);
    await pool.query(`INSERT INTO shopee_grants (cliente_conta_id, ambiente, app, shop_id, access_token_enc, refresh_token_enc, access_token_expires_at)
                      VALUES (235, 'live', 'marketing', 7001, 'x', 'y', NOW())`);
    await pool.query(MIGS[1]);
    await pool.query(MIGS[1]);
    const legado = (await pool.query("SELECT last_refresh_at, last_refresh_error FROM shopee_grants WHERE cliente_conta_id = 235")).rows[0];
    assert.deepStrictEqual(legado, { last_refresh_at: null, last_refresh_error: null }, "linha existente preservada, colunas novas NULL");
    await pool.query("DELETE FROM shopee_grants");
    console.log("  ✓ migration aditiva: aplica sobre a tabela existente, 2x (idempotente), linhas preservadas");

    // 3 Contas de 3 Clientes autorizam 3 lojas (fluxo do callback).
    const shopee = criarShopeeFalsa();
    const lojas = { 235: 7001, 310: 8001, 411: 9001 };
    for (const [conta, shop] of Object.entries(lojas)) {
      const rt = `RT-${shop}-inicial`;
      shopee.validos.set(shop, rt);
      await salvarGrantLive({ clienteContaId: Number(conta), app: "marketing", shopId: shop, accessToken: `AT-${shop}-inicial`, refreshToken: rt, expireIn: 600, userId: 1, chaveCifra: config.chaveCifra }, opts);
    }
    const st0 = await statusGrantsLive({}, opts);
    assert.strictEqual(st0.length, 3, "3 grants coexistem");
    assert.deepStrictEqual(st0.map((g) => g.cliente).sort(), ["Cliente A", "Cliente B", "Cliente C"]);
    assert.ok(st0.every((g) => g.pertoDeExpirar && !g.expirado && g.ultimoRefreshEm === null));
    console.log("  ✓ 3 Clientes, 3 Contas, 3 lojas: grants independentes (status mostra cliente, perto de expirar)");

    // 1. refresh normal (Cliente A).
    const antesB = await lerGrant(pool, 310);
    const antesC = await lerGrant(pool, 411);
    const t0 = Date.now();
    const r1 = await refreshGrantLive({ clienteContaId: 235 }, { ...opts, config, refresh: shopee.refresh, now: () => t0 });
    assert.strictEqual(r1.shopId, 7001);
    assert.ok(r1.refreshedAt);
    const gA = await lerGrant(pool, 235);
    const tA = tokensDe(gA);
    assert.strictEqual(tA.refresh, shopee.validos.get(7001), "NOVO refresh_token persistido");
    assert.match(tA.access, /^AT-7001-v1-/, "NOVO access_token persistido");
    assert.ok(!gA.access_token_enc.includes("AT-7001") && !gA.refresh_token_enc.includes("RT-7001"), "tokens continuam cifrados");
    assert.match(gA.refresh_token_enc, /^v1\./);
    assert.strictEqual(new Date(gA.access_token_expires_at).getTime(), t0 + 14400 * 1000);
    assert.ok(gA.last_refresh_at && gA.last_refresh_request_id === "rq-7001-1" && gA.last_refresh_error === null);
    assert.ok(new Date(gA.updated_at).getTime() >= new Date(gA.authorized_at).getTime());
    assert.deepStrictEqual(await lerGrant(pool, 310), antesB, "grant do Cliente B intocado");
    assert.deepStrictEqual(await lerGrant(pool, 411), antesC, "grant do Cliente C intocado");
    console.log("  ✓ refresh normal: par novo cifrado, expiração/last_refresh_* gravados; B e C intocados");

    // 2. segundo refresh usa o refresh_token NOVO (rotação persistida).
    await refreshGrantLive({ clienteContaId: 235 }, { ...opts, config, refresh: shopee.refresh });
    const usosA = shopee.usos.filter((u) => u.shopId === 7001);
    assert.deepStrictEqual(usosA.map((u) => u.aceito), [true, true], "sempre o refresh_token mais novo");
    assert.strictEqual(usosA[1].refreshToken, tA.refresh);
    console.log("  ✓ rotação: o 2º refresh usa o refresh_token devolvido pelo 1º");

    // 3. erro da Shopee preserva os tokens anteriores.
    const antesErro = await lerGrant(pool, 235);
    shopee.falhar("4xx");
    const e1 = await refreshGrantLive({ clienteContaId: 235 }, { ...opts, config, refresh: shopee.refresh }).catch((e) => e);
    assert.strictEqual(e1.code, "REFRESH_FALHOU");
    assert.strictEqual(e1.detalhe.shopeeError, "error_auth");
    const depoisErro = await lerGrant(pool, 235);
    assert.strictEqual(depoisErro.access_token_enc, antesErro.access_token_enc, "access_token anterior mantido");
    assert.strictEqual(depoisErro.refresh_token_enc, antesErro.refresh_token_enc, "refresh_token anterior mantido");
    assert.strictEqual(String(depoisErro.access_token_expires_at), String(antesErro.access_token_expires_at));
    assert.strictEqual(String(depoisErro.last_refresh_at), String(antesErro.last_refresh_at), "last_refresh_at não muda na falha");
    assert.strictEqual(depoisErro.status, "active", "grant não é apagado nem desativado");
    assert.strictEqual(depoisErro.last_refresh_error, "SHOPEE_UPSTREAM_4XX:error_auth");
    shopee.falhar("timeout");
    const e2 = await refreshGrantLive({ clienteContaId: 235 }, { ...opts, config, refresh: shopee.refresh }).catch((e) => e);
    assert.strictEqual(e2.code, "REFRESH_FALHOU");
    assert.strictEqual((await lerGrant(pool, 235)).refresh_token_enc, antesErro.refresh_token_enc);
    assert.ok(!JSON.stringify(e1).includes("RT-") && !e1.message.includes("RT-"), "erro sem token");
    // Depois da falha, um refresh bom limpa o erro.
    await refreshGrantLive({ clienteContaId: 235 }, { ...opts, config, refresh: shopee.refresh });
    assert.strictEqual((await lerGrant(pool, 235)).last_refresh_error, null);
    console.log("  ✓ erro da Shopee (4xx/timeout): tokens, expiração e last_refresh_at preservados; só o erro é registrado");

    // 4. concorrência: 5 refreshes simultâneos do MESMO grant (pool de 8 conexões).
    const lenta = criarShopeeFalsa({ atrasoMs: 300 });
    const gB = tokensDe(await lerGrant(pool, 310));
    lenta.validos.set(8001, gB.refresh);
    const resultados = await Promise.allSettled(Array.from({ length: 5 }, () =>
      refreshGrantLive({ clienteContaId: 310 }, { ...opts, config, refresh: lenta.refresh })));
    const ok = resultados.filter((r) => r.status === "fulfilled");
    const recusados = resultados.filter((r) => r.status === "rejected");
    assert.strictEqual(ok.length, 1, "só um refresh do grant B passa");
    assert.ok(recusados.every((r) => r.reason.code === "REFRESH_EM_ANDAMENTO"), JSON.stringify(recusados.map((r) => r.reason.code)));
    assert.strictEqual(lenta.usos.length, 1, "o refresh_token foi enviado à Shopee UMA vez");
    assert.ok(lenta.usos.every((u) => u.aceito), "nenhum refresh_token consumido duas vezes");
    assert.strictEqual(tokensDe(await lerGrant(pool, 310)).refresh, lenta.validos.get(8001));
    console.log("  ✓ concorrência: 5 refreshes simultâneos → 1 chamada à Shopee, 4 REFRESH_EM_ANDAMENTO, par novo gravado");

    // 5. duas "instâncias" do worker ao mesmo tempo: nenhuma consome o mesmo token.
    await pool.query("UPDATE shopee_grants SET access_token_expires_at = NOW() + INTERVAL '5 minutes'");
    const lenta2 = criarShopeeFalsa({ atrasoMs: 200 });
    for (const [conta, shop] of Object.entries(lojas)) lenta2.validos.set(shop, tokensDe(await lerGrant(pool, Number(conta))).refresh);
    const grantsPg = {
      MARGEM_REFRESH_MS: 30 * 60 * 1000,
      listarGrantsParaRefresh: (a) => listarGrantsParaRefresh(a, opts),
      refreshGrantLive: (a, o) => refreshGrantLive(a, { ...o, ...opts }),
    };
    const quieto = { log() {}, warn() {}, error() {} };
    const w1 = createShopeeRefreshWorker({ env: { ...ENV_LIVE, SHOPEE_LIVE_REFRESH_WORKER_ENABLED: "true" }, grants: grantsPg, refresh: lenta2.refresh, logger: quieto });
    const w2 = createShopeeRefreshWorker({ env: { ...ENV_LIVE, SHOPEE_LIVE_REFRESH_WORKER_ENABLED: "true" }, grants: grantsPg, refresh: lenta2.refresh, logger: quieto });
    const [c1, c2] = await Promise.all([w1.ciclo(), w2.ciclo()]);
    assert.strictEqual(c1.renovados + c2.renovados, 3, `cada loja renovada uma vez: ${JSON.stringify([c1, c2])}`);
    assert.strictEqual(c1.falhas + c2.falhas, 0);
    assert.strictEqual(lenta2.usos.length, 3, "3 chamadas à Shopee, uma por loja");
    assert.ok(lenta2.usos.every((u) => u.aceito), "nenhum refresh_token reutilizado entre instâncias");
    const depoisWorker = await statusGrantsLive({}, opts);
    assert.ok(depoisWorker.every((g) => !g.pertoDeExpirar && g.ultimoRefreshEm), "todas renovadas, longe de expirar");
    assert.deepStrictEqual(await listarGrantsParaRefresh({}, opts), [], "nada mais a renovar");
    console.log("  ✓ 2 workers simultâneos (deploy): 3 lojas renovadas uma vez cada, nenhum token reutilizado");

    // 6. falha de uma loja não bloqueia as outras e espera 15 min para tentar de novo.
    await pool.query("UPDATE shopee_grants SET access_token_expires_at = NOW() - INTERVAL '1 minute'");
    const s3 = criarShopeeFalsa();
    for (const [conta, shop] of Object.entries(lojas)) s3.validos.set(shop, tokensDe(await lerGrant(pool, Number(conta))).refresh);
    s3.validos.set(7001, "outro-token-que-ninguem-tem");
    const w3 = createShopeeRefreshWorker({ env: { ...ENV_LIVE, SHOPEE_LIVE_REFRESH_WORKER_ENABLED: "true" }, grants: { ...grantsPg, refreshGrantLive: (a, o) => refreshGrantLive(a, { ...o, ...opts }) }, refresh: s3.refresh, logger: quieto });
    const c3 = await w3.ciclo();
    assert.deepStrictEqual(c3, { candidatos: 3, renovados: 2, pulados: 0, falhas: 1 }, "token expirado ainda renova; A falha, B e C seguem");
    assert.deepStrictEqual((await listarGrantsParaRefresh({}, opts)).map((g) => g.clienteContaId), [], "A só volta depois da espera de 15 min");
    assert.deepStrictEqual((await listarGrantsParaRefresh({ esperaAposFalhaMs: 0 }, opts)).map((g) => g.clienteContaId), [235]);
    console.log("  ✓ worker: loja A falha, B e C renovam; A só é tentada de novo após a espera");

    // 7. lock compartilhado com o callback: reautorização espera o refresh em curso.
    const s4 = criarShopeeFalsa({ atrasoMs: 300 });
    s4.validos.set(9001, tokensDe(await lerGrant(pool, 411)).refresh);
    const ordem = [];
    const pRefresh = refreshGrantLive({ clienteContaId: 411 }, { ...opts, config, refresh: s4.refresh }).then(() => ordem.push("refresh"));
    await new Promise((r) => setTimeout(r, 80));
    const pReauth = salvarGrantLive({ clienteContaId: 411, app: "marketing", shopId: 9001, accessToken: "AT-9001-reauth", refreshToken: "RT-9001-reauth", expireIn: 14400, chaveCifra: config.chaveCifra }, opts).then(() => ordem.push("reauth"));
    await Promise.all([pRefresh, pReauth]);
    assert.deepStrictEqual(ordem, ["refresh", "reauth"], "callback espera o refresh da mesma loja");
    assert.strictEqual(tokensDe(await lerGrant(pool, 411)).refresh, "RT-9001-reauth", "reautorização (mais nova) prevalece");
    assert.strictEqual((await lerGrant(pool, 411)).last_refresh_error, null);
    console.log("  ✓ refresh × reautorização da mesma loja serializados pelo mesmo lock");

    // 8. grants inexistentes/inativos e chave errada: nada é alterado.
    assert.strictEqual((await refreshGrantLive({ clienteContaId: 500 }, { ...opts, config, refresh: s4.refresh }).catch((e) => e)).code, "GRANT_NAO_ENCONTRADO");
    await pool.query("UPDATE shopee_grants SET status = 'revoked' WHERE cliente_conta_id = 310");
    assert.strictEqual((await refreshGrantLive({ clienteContaId: 310 }, { ...opts, config, refresh: s4.refresh }).catch((e) => e)).code, "GRANT_INATIVO");
    await pool.query("UPDATE shopee_grants SET status = 'active' WHERE cliente_conta_id = 310");
    const antesChave = await lerGrant(pool, 310);
    const outraChave = Object.assign({}, config);
    Object.defineProperty(outraChave, "chaveCifra", { value: crypto.randomBytes(32), enumerable: false });
    Object.defineProperty(outraChave, "partnerKey", { value: LIVE_KEY, enumerable: false });
    const eChave = await refreshGrantLive({ clienteContaId: 310 }, { ...opts, config: outraChave, refresh: s4.refresh }).catch((e) => e);
    assert.strictEqual(eChave.code, "TOKEN_ILEGIVEL");
    assert.strictEqual((await lerGrant(pool, 310)).refresh_token_enc, antesChave.refresh_token_enc);
    console.log("  ✓ sem grant 404, grant revogado recusado, chave de cifra trocada → TOKEN_ILEGIVEL sem chamar a Shopee");

    // 9. status e lista de contas: só metadados.
    const stFinal = JSON.stringify(await statusGrantsLive({}, opts)) + JSON.stringify(await listarContasShopee({}, opts));
    assert.ok(!/AT-|RT-|v1\./.test(stFinal), "status/contas sem token nem texto cifrado");
    assert.ok(!stFinal.includes(LIVE_KEY));
    const contas = await listarContasShopee({}, opts);
    assert.deepStrictEqual(contas.map((c) => c.clienteContaId), [235, 310, 411], "só Contas Shopee (ML fora)");
    assert.deepStrictEqual((await listarContasShopee({ busca: "cliente b" }, opts)).map((c) => c.clienteContaId), [310]);
    console.log("  ✓ status e /live/contas: só metadados, só Contas Shopee, busca por nome");

    console.log("\n✓ shopeeLiveRefresh.postgres: SQL real validado");
  } finally {
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
