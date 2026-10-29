// OAuth Shopee de TESTE: config, state de uso único, assinatura, token/get e callback.
// Nenhuma chamada externa: fetch injetado, Shopee falsa em 127.0.0.1 e gateway falso.
// A chave abaixo é FALSA (só para exercitar o HMAC).
const assert = require("assert");
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const { readTestConfig, DEFAULT_ORIGIN } = require("../services/shopee/shopeeTestConfig");
const { createStateStore } = require("../services/shopee/shopeeOAuthState");
const { buildAuthorizationUrl, exchangeCodeForToken, signPublic, ShopeeAuthError, CODES, TOKEN_GET_PATH } = require("../services/shopee/shopeeTestAuth");
const { createShopeeController } = require("../controllers/shopeeController");

const FAKE_KEY = "fake-partner-key-only-for-tests-0123456789";
const CODE = "codeFALSOabc123";
const ACCESS = "ACCESS-TOKEN-FALSO-xyz";
const REFRESH = "REFRESH-TOKEN-FALSO-xyz";
const ENV_OK = {
  SHOPEE_TEST_MARKETING_PARTNER_ID: "1000001",
  SHOPEE_TEST_MARKETING_PARTNER_KEY: FAKE_KEY,
  SHOPEE_TEST_REDIRECT_URL: "https://api.example.com/shopee/callback",
  SHOPEE_TEST_TIMEOUT_MS: "200",
};
const SEGREDOS = [FAKE_KEY, CODE, ACCESS, REFRESH];
const cfg = (extra = {}) => readTestConfig("marketing", { ...ENV_OK, ...extra });

function semSegredo(texto, label) {
  for (const s of SEGREDOS) assert.ok(!String(texto).includes(s), `${label}: vazou ${s.slice(0, 8)}…`);
}
function fakeRes(status, body, { json = true } = {}) {
  const text = json ? JSON.stringify(body) : String(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text };
}
async function rejeita(promise, code, label) {
  try {
    await promise;
  } catch (e) {
    assert.ok(e instanceof ShopeeAuthError, `${label}: tipo`);
    assert.strictEqual(e.code, code, `${label}: code`);
    semSegredo(JSON.stringify(e) + e.message, label);
    console.log(`  ✓ ${label}`);
    return e;
  }
  assert.fail(`${label}: deveria rejeitar`);
}
const tokenOk = () => fakeRes(200, { access_token: ACCESS, refresh_token: REFRESH, expire_in: 14400, request_id: "req1", error: "", message: "" });

(async () => {
  // ── config ──
  {
    const c = cfg();
    assert.strictEqual(c.configured, true);
    assert.strictEqual(c.partnerId, 1000001);
    assert.strictEqual(c.apiOrigin, DEFAULT_ORIGIN);
    assert.strictEqual(c.transport, "direct");
    assert.strictEqual(c.ambiente, "test");
    semSegredo(JSON.stringify(c) + JSON.stringify({ ...c }), "config serializada");
    assert.strictEqual(c.partnerKey, FAKE_KEY, "chave acessível só por leitura direta");
    console.log("  ✓ config TEST válida (chave não enumerável)");

    const vazia = readTestConfig("marketing", {});
    assert.strictEqual(vazia.configured, false);
    assert.deepStrictEqual(vazia.faltando, ["SHOPEE_TEST_MARKETING_PARTNER_ID", "SHOPEE_TEST_MARKETING_PARTNER_KEY", "SHOPEE_TEST_REDIRECT_URL"]);
    console.log("  ✓ config TEST ausente → configured=false + nomes faltando");

    assert.strictEqual(cfg({ SHOPEE_TEST_API_ORIGIN: "https://partner.shopeemobile.com" }).configured, false, "host de PRODUÇÃO recusado");
    assert.strictEqual(cfg({ SHOPEE_TEST_API_ORIGIN: "https://evil.example.com" }).configured, false, "host arbitrário recusado");
    assert.strictEqual(cfg({ SHOPEE_TEST_API_ORIGIN: "https://openplatform.sandbox.test-stable.shopee.sg/" }).configured, true);
    assert.strictEqual(cfg({ SHOPEE_TEST_REDIRECT_URL: "https://api.example.com/shopee/callback?x=1" }).configured, false, "redirect sem query");
    assert.strictEqual(cfg({ SHOPEE_TEST_REDIRECT_URL: "http://api.example.com/cb", NODE_ENV: "production" }).configured, false, "redirect https em produção");
    assert.strictEqual(cfg({ SHOPEE_TEST_MARKETING_PARTNER_ID: "abc" }).configured, false);
    assert.strictEqual(cfg({ SHOPEE_TEST_TRANSPORT: "outro" }).configured, false);
    assert.strictEqual(readTestConfig("produto", ENV_OK).appValido, false, "só marketing habilitado nesta fase");
    assert.strictEqual(cfg({ SHOPEE_MARKETING_PARTNER_KEY: "x", SHOPEE_TEST_MARKETING_PARTNER_KEY: "" }).configured, false, "não lê ENV sem prefixo TEST");
    console.log("  ✓ config: origem só de teste (PROD recusado), redirect sem query, app desconhecido");
  }

  // ── state ──
  {
    let agora = 1_700_000_000_000;
    const store = createStateStore({ ttlMs: 1000, now: () => agora });
    const { state } = store.emitir({ app: "marketing", ambiente: "test", userId: 7 });
    assert.match(state, /^[A-Za-z0-9_-]{43}$/, "32 bytes base64url");
    assert.notStrictEqual(store.emitir({}).state, state, "aleatório");
    console.log("  ✓ geração de state");

    assert.deepStrictEqual(store.consumir(state), { ok: true, intencao: { app: "marketing", ambiente: "test", userId: 7 } });
    console.log("  ✓ state válido");
    assert.deepStrictEqual(store.consumir(state), { ok: false, motivo: "INVALIDO" });
    console.log("  ✓ state reutilizado → INVALIDO");
    assert.deepStrictEqual(store.consumir("x".repeat(43)), { ok: false, motivo: "INVALIDO" });
    assert.deepStrictEqual(store.consumir("curto"), { ok: false, motivo: "INVALIDO" });
    assert.deepStrictEqual(store.consumir(["a", "b"]), { ok: false, motivo: "INVALIDO" });
    assert.deepStrictEqual(store.consumir(undefined), { ok: false, motivo: "AUSENTE" });
    console.log("  ✓ state inválido/ausente");
    const exp = store.emitir({}).state;
    agora += 1001;
    assert.deepStrictEqual(store.consumir(exp), { ok: false, motivo: "EXPIRADO" });
    assert.deepStrictEqual(store.consumir(exp), { ok: false, motivo: "INVALIDO" }, "expirado também não volta");
    console.log("  ✓ state expirado (e não reaproveitável)");

    const pequeno = createStateStore({ maxPendentes: 2 });
    const a = pequeno.emitir({}).state;
    pequeno.emitir({});
    pequeno.emitir({});
    assert.strictEqual(pequeno.tamanho(), 2);
    assert.strictEqual(pequeno.consumir(a).ok, false, "mais antigo descartado no teto");
    console.log("  ✓ teto de states pendentes");
  }

  // ── assinatura / URL ──
  {
    const esperado = crypto.createHmac("sha256", FAKE_KEY).update("1000001/api/v2/shop/auth_partner1700000000").digest("hex");
    assert.strictEqual(signPublic({ partnerId: 1000001, partnerKey: FAKE_KEY, path: "/api/v2/shop/auth_partner", timestamp: 1700000000 }), esperado);
    const u = new URL(buildAuthorizationUrl(cfg(), "S".repeat(43), { now: () => 1700000000999 }));
    assert.strictEqual(u.origin + u.pathname, `${DEFAULT_ORIGIN}/api/v2/shop/auth_partner`);
    assert.strictEqual(u.searchParams.get("partner_id"), "1000001");
    assert.strictEqual(u.searchParams.get("timestamp"), "1700000000", "segundos (floor)");
    assert.strictEqual(u.searchParams.get("sign"), esperado);
    assert.strictEqual(u.searchParams.get("redirect"), `https://api.example.com/shopee/callback?state=${"S".repeat(43)}`);
    semSegredo(u.toString(), "URL de autorização");
    assert.throws(() => buildAuthorizationUrl(readTestConfig("marketing", {}), "S".repeat(43)), (e) => e.code === CODES.NAO_CONFIGURADO);
    console.log("  ✓ assinatura pública + URL auth_partner (sem chave na URL)");
  }

  // ── token/get (direct, fetch injetado) ──
  {
    let chamada;
    const r = await exchangeCodeForToken(cfg(), { code: CODE, shopId: 555 }, {
      now: () => 1700000000000,
      fetchImpl: async (url, opts) => { chamada = { url, opts }; return tokenOk(); },
    });
    const u = new URL(chamada.url);
    assert.strictEqual(u.origin + u.pathname, DEFAULT_ORIGIN + TOKEN_GET_PATH);
    assert.strictEqual(u.searchParams.get("sign"), signPublic({ partnerId: 1000001, partnerKey: FAKE_KEY, path: TOKEN_GET_PATH, timestamp: 1700000000 }));
    assert.strictEqual(chamada.opts.method, "POST");
    assert.strictEqual(chamada.opts.redirect, "error");
    assert.deepStrictEqual(JSON.parse(chamada.opts.body), { code: CODE, shop_id: 555, partner_id: 1000001 });
    semSegredo(chamada.url, "URL do token/get (sem chave)");
    assert.strictEqual(r.accessToken, ACCESS);
    assert.strictEqual(r.refreshToken, REFRESH);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { shopId: 555, expireIn: 14400, shopeeRequestId: "req1" });
    console.log("  ✓ token/get mockado com sucesso (tokens não enumeráveis)");

    const ex = (fetchImpl, c = cfg()) => exchangeCodeForToken(c, { code: CODE, shopId: 555 }, { fetchImpl });
    const e4 = await rejeita(ex(async () => fakeRes(400, { error: "error_auth", message: `code ${CODE} inválido`, request_id: "r4" })), CODES.UPSTREAM_4XX, "erro 4xx upstream");
    assert.strictEqual(e4.shopeeError, "error_auth");
    assert.strictEqual(e4.shopeeRequestId, "r4");
    await rejeita(ex(async () => fakeRes(200, { error: "error_sign", message: "Wrong sign." })), CODES.UPSTREAM_4XX, "erro Shopee com HTTP 200");
    await rejeita(ex(async () => fakeRes(502, "<html>bad gateway</html>", { json: false })), CODES.UPSTREAM_5XX, "erro 5xx upstream");
    await rejeita(ex(async () => fakeRes(200, "não é json", { json: false })), CODES.RESPOSTA_INVALIDA, "resposta inválida (não JSON)");
    await rejeita(ex(async () => fakeRes(200, { access_token: ACCESS, expire_in: 10 })), CODES.RESPOSTA_INVALIDA, "resposta inválida (sem refresh_token)");
    await rejeita(ex(async () => fakeRes(302, "")), CODES.REDIRECT_BLOQUEADO, "redirect não seguido");
    await rejeita(ex(async () => { throw new TypeError("fetch failed"); }), CODES.REDE, "erro de rede");
    await rejeita(ex(async () => tokenOk(), readTestConfig("marketing", {})), CODES.NAO_CONFIGURADO, "token/get sem config");
    await rejeita(exchangeCodeForToken(cfg(), { code: "a b", shopId: 1 }, { fetchImpl: tokenOk }), CODES.PARAMETRO_INVALIDO, "code malformado");
    await rejeita(exchangeCodeForToken(cfg(), { code: CODE, shopId: 0 }, { fetchImpl: tokenOk }), CODES.PARAMETRO_INVALIDO, "shop_id inválido");
  }

  // ── timeout e redirect reais (Shopee falsa local) ──
  {
    const srv = http.createServer((req, res) => {
      if (req.url.startsWith(TOKEN_GET_PATH) && req.headers["x-modo"] === undefined) {
        // nunca responde → timeout
        return;
      }
      res.end();
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const porta = srv.address().port;
    const inicio = Date.now();
    await rejeita(exchangeCodeForToken(cfg(), { code: CODE, shopId: 5 }, {
      fetchImpl: (url, opts) => fetch(url.replace(DEFAULT_ORIGIN, `http://127.0.0.1:${porta}`), opts),
    }), CODES.TIMEOUT, "timeout");
    assert.ok(Date.now() - inicio < 2000, "respeita SHOPEE_TEST_TIMEOUT_MS");
    srv.closeAllConnections();
    srv.close();

    const redir = http.createServer((req, res) => { res.writeHead(302, { Location: "https://evil.example.com/" }); res.end(); });
    await new Promise((r) => redir.listen(0, "127.0.0.1", r));
    const p2 = redir.address().port;
    await rejeita(exchangeCodeForToken(cfg(), { code: CODE, shopId: 5 }, {
      fetchImpl: (url, opts) => fetch(url.replace(DEFAULT_ORIGIN, `http://127.0.0.1:${p2}`), opts),
    }), CODES.REDIRECT_BLOQUEADO, "redirect 302 real não é seguido");
    redir.close();
  }

  // ── token/get via gateway (client falso) ──
  {
    let env;
    const gwOk = { forward: async (e) => { env = e; return { status: 200, body: (await tokenOk().text()) }; } };
    const r = await exchangeCodeForToken(cfg({ SHOPEE_TEST_TRANSPORT: "gateway" }), { code: CODE, shopId: 9 }, { gateway: gwOk });
    assert.strictEqual(env.method, "POST");
    assert.strictEqual(env.path, TOKEN_GET_PATH);
    assert.deepStrictEqual(Object.keys(env.query).sort(), ["partner_id", "sign", "timestamp"]);
    assert.deepStrictEqual(env.body, { code: CODE, shop_id: 9, partner_id: 1000001 });
    assert.strictEqual(r.refreshToken, REFRESH);
    const err4 = Object.assign(new Error("x"), { code: "UPSTREAM_4XX", upstreamStatus: 403 });
    Object.defineProperty(err4, "upstreamBody", { value: JSON.stringify({ error: "error_auth" }) });
    await rejeita(exchangeCodeForToken(cfg({ SHOPEE_TEST_TRANSPORT: "gateway" }), { code: CODE, shopId: 9 }, { gateway: { forward: async () => { throw err4; } } }), CODES.UPSTREAM_4XX, "gateway: 4xx da Shopee");
    await rejeita(exchangeCodeForToken(cfg({ SHOPEE_TEST_TRANSPORT: "gateway" }), { code: CODE, shopId: 9 }, { gateway: { forward: async () => { throw Object.assign(new Error("t"), { code: "SHOPEE_GATEWAY_TIMEOUT" }); } } }), CODES.TIMEOUT, "gateway: timeout");
    await rejeita(exchangeCodeForToken(cfg({ SHOPEE_TEST_TRANSPORT: "gateway" }), { code: CODE, shopId: 9 }, { gateway: { forward: async () => { throw Object.assign(new Error("n"), { code: "SHOPEE_GATEWAY_NAO_CONFIGURADO" }); } } }), CODES.REDE, "gateway: não configurado");
  }

  // ── callback + início (HTTP real via express, sem auth/DB) ──
  {
    const logs = [];
    const logger = { log: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) };
    const store = createStateStore();
    let modo = "ok";
    let chamadasExchange = 0;
    const exchange = async (config, { code, shopId }) => {
      chamadasExchange++;
      assert.strictEqual(config.partnerKey, FAKE_KEY);
      assert.strictEqual(code, CODE);
      if (modo === "erro") throw new ShopeeAuthError(CODES.UPSTREAM_4XX, "recusado", { upstreamStatus: 400, shopeeError: "error_auth", shopeeRequestId: "rq" });
      if (modo === "bug") throw new Error(`boom ${FAKE_KEY}`);
      if (modo === "sign") {
        return exchangeCodeForToken(config, { code, shopId }, { fetchImpl: async () => fakeRes(403, { error: "error_sign", message: `Wrong sign. code=${CODE} ${ACCESS}`, request_id: "rs" }) });
      }
      return exchangeCodeForToken(config, { code, shopId }, { fetchImpl: async () => tokenOk() });
    };
    const ctrl = createShopeeController({ stateStore: store, readConfig: (app) => readTestConfig(app, ENV_OK), exchange, logger });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 42 }; next(); });
    app.get("/shopee/callback", ctrl.callbackShopeeController);
    app.post("/shopee/test/autorizar", ctrl.iniciarAutorizacaoTestController);
    app.get("/shopee/test/status", ctrl.statusTestController);
    const srv = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const base = `http://127.0.0.1:${srv.address().port}`;
    const get = async (qs) => { const r = await fetch(`${base}/shopee/callback${qs}`, { redirect: "manual" }); return { status: r.status, body: await r.text(), headers: r.headers }; };
    const novoState = async () => {
      const r = await fetch(`${base}/shopee/test/autorizar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      assert.strictEqual(r.status, 200);
      semSegredo(JSON.stringify(j), "resposta do autorizar");
      return new URL(new URL(j.url).searchParams.get("redirect")).searchParams.get("state");
    };

    const ativo = await get("");
    assert.strictEqual(ativo.status, 200);
    assert.match(ativo.body, /Callback Shopee ativo/);
    assert.strictEqual(ativo.headers.get("referrer-policy"), "no-referrer");
    console.log("  ✓ callback sem parâmetros mantém a página 'ativo'");

    const s1 = await novoState();
    const ok = await get(`?state=${s1}&code=${CODE}&shop_id=777`);
    assert.strictEqual(ok.status, 200);
    assert.match(ok.body, /Autorização Shopee de teste concluída/);
    assert.match(ok.body, /777/);
    assert.strictEqual(ok.headers.get("referrer-policy"), "no-referrer");
    assert.strictEqual(ok.headers.get("cache-control"), "no-store");
    semSegredo(ok.body, "HTML de sucesso");
    console.log("  ✓ callback válido → sucesso com shop_id, no-referrer, no-store");

    const replay = await get(`?state=${s1}&code=${CODE}&shop_id=777`);
    assert.strictEqual(replay.status, 400);
    assert.match(replay.body, /inválido ou já utilizado/);
    assert.strictEqual(chamadasExchange, 1, "replay não chama a Shopee");
    console.log("  ✓ replay do callback recusado sem nova chamada");

    const semState = await get(`?code=${CODE}&shop_id=777`);
    assert.strictEqual(semState.status, 400);
    semSegredo(semState.body, "HTML sem state");
    console.log("  ✓ callback sem state → 400");
    assert.strictEqual((await get(`?state=${"Z".repeat(43)}&code=${CODE}&shop_id=1`)).status, 400);
    console.log("  ✓ callback com state desconhecido → 400");

    const s2 = await novoState();
    const semCode = await get(`?state=${s2}&shop_id=777`);
    assert.strictEqual(semCode.status, 400);
    assert.match(semCode.body, /não devolveu o código/);
    assert.strictEqual((await get(`?state=${s2}&code=${CODE}&shop_id=777`)).status, 400, "state consumido mesmo na falha");
    console.log("  ✓ callback sem code → 400 e state queimado");

    const s3 = await novoState();
    assert.match((await get(`?state=${s3}&code=${CODE}&main_account_id=9`)).body, /main_account_id/);
    const s4 = await novoState();
    assert.strictEqual((await get(`?state=${s4}&code=${CODE}&shop_id=abc`)).status, 400);
    console.log("  ✓ callback sem shop_id válido → 400");

    modo = "erro";
    const s5 = await novoState();
    const falha = await get(`?state=${s5}&code=${CODE}&shop_id=777`);
    assert.strictEqual(falha.status, 502);
    assert.match(falha.body, /SHOPEE_TEST_UPSTREAM_4XX \(error_auth\)/);
    semSegredo(falha.body, "HTML de erro upstream");
    modo = "bug";
    const s6 = await novoState();
    const bug = await get(`?state=${s6}&code=${CODE}&shop_id=777`);
    assert.strictEqual(bug.status, 502);
    semSegredo(bug.body, "HTML de erro interno");
    console.log("  ✓ falha no token/get → 502 sem detalhe sensível");

    const st = await (await fetch(`${base}/shopee/test/status`)).json();
    assert.strictEqual(st.ultimoGrant.shopId, 777);
    assert.strictEqual(st.ultimoGrant.accessTokenRecebido, true);
    assert.strictEqual(st.ultimoGrant.refreshTokenRecebido, true);
    assert.strictEqual(st.ultimoGrant.iniciadoPor, 42);
    semSegredo(JSON.stringify(st), "status");
    console.log("  ✓ status admin: último grant sem tokens/chave");

    const semCfg = createShopeeController({ stateStore: store, readConfig: (a) => readTestConfig(a, {}), exchange, logger });
    const app2 = express();
    app2.use(express.json());
    app2.post("/a", semCfg.iniciarAutorizacaoTestController);
    const srv2 = await new Promise((r) => { const s = app2.listen(0, "127.0.0.1", () => r(s)); });
    const r503 = await fetch(`http://127.0.0.1:${srv2.address().port}/a`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.strictEqual(r503.status, 503);
    const rApp = await fetch(`http://127.0.0.1:${srv2.address().port}/a`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"app":"erp"}' });
    assert.strictEqual(rApp.status, 400);
    srv2.close();
    console.log("  ✓ autorizar sem config → 503; app desconhecido → 400");

    // ── diagnóstico do 1º grant ──
    const perdido = await get(`?code=${CODE}&shop_id=777`);
    assert.strictEqual(perdido.status, 400);
    assert.match(perdido.body, /state perdido na redirect/);
    assert.ok(logs.some((l) => /state PERDIDO \(code presente e state ausente/.test(l)));
    console.log("  ✓ state perdido na redirect: mensagem e log próprios");

    const s7 = await novoState();
    const concat = await get(`?state=${s7}?code=${CODE}&shop_id=777`);
    assert.strictEqual(concat.status, 400);
    assert.match(concat.body, /state concatenado na redirect/);
    semSegredo(concat.body, "HTML state concatenado");
    assert.ok(logs.some((l) => /state CONCATENADO/.test(l)));
    console.log("  ✓ state concatenado com '?': detectado, sem ecoar o code");

    modo = "sign";
    const s8 = await novoState();
    const sign = await get(`?state=${s8}&code=${CODE}&shop_id=777`);
    assert.strictEqual(sign.status, 502);
    assert.match(sign.body, /\(error_sign\)/);
    assert.match(sign.body, /Assinatura recusada/);
    assert.ok(!/Wrong sign/.test(sign.body), "mensagem crua da Shopee fica fora do HTML");
    semSegredo(sign.body, "HTML error_sign");
    const linhaSign = logs.find((l) => /diagnostico=ASSINATURA_RECUSADA/.test(l));
    assert.ok(linhaSign, "log com diagnóstico");
    assert.match(linhaSign, /host=https:\/\/partner\.test-stable\.shopeemobile\.com transport=direct/);
    assert.match(linhaSign, /shopee_message="Wrong sign\. code\[code\] \[redacted\]"/);
    console.log("  ✓ error_sign: diagnóstico no HTML; mensagem Shopee só no log, sem code/token; host no log");

    semSegredo(logs.join("\n"), "logs");
    assert.ok(logs.some((l) => /grant concluído: app=marketing shop_id=777/.test(l)));
    console.log(`  ✓ nenhum segredo logado (${logs.length} linhas de log conferidas)`);
    srv.close();
  }

  // ── diagnóstico (unidade) ──
  {
    const diag = (body) => exchangeCodeForToken(cfg(), { code: CODE, shopId: 1 }, { fetchImpl: async () => fakeRes(403, body) }).catch((e) => e.diagnostico);
    assert.strictEqual(await diag({ error: "error_sign", message: "Wrong sign." }), "ASSINATURA_RECUSADA");
    assert.strictEqual(await diag({ error: "error_param", message: "Invalid timestamp." }), "TIMESTAMP_RECUSADO");
    assert.strictEqual(await diag({ error: "error_param", message: "Invalid partner_id." }), "PARTNER_OU_HOST");
    assert.strictEqual(await diag({ error: "error_auth", message: "Invalid code." }), "CODE_RECUSADO");
    assert.strictEqual(await diag({ error: "error_server", message: "boom" }), null);
    console.log("  ✓ diagnóstico: sign / timestamp / partner-host / code");
  }

  // ── sanitizador da observabilidade: code embutido em outro parâmetro ──
  {
    const { sanitizeUrl } = require("../utils/observabilitySanitizer");
    const u = sanitizeUrl(`/shopee/callback?state=${"S".repeat(43)}?code=${CODE}&shop_id=7`);
    semSegredo(u, "URL sanitizada (state concatenado)");
    assert.match(u, /shop_id=7/);
    console.log("  ✓ observabilidade não grava code embutido no state");
  }

  // ── worker de refresh ML: opt-out só com "false" ──
  {
    const { workerHabilitado } = require("../utils/tokenRefreshWorker");
    assert.strictEqual(workerHabilitado({}), true, "ausente = ligado (main inalterada)");
    assert.strictEqual(workerHabilitado({ ML_TOKEN_REFRESH_WORKER_ENABLED: "true" }), true);
    assert.strictEqual(workerHabilitado({ ML_TOKEN_REFRESH_WORKER_ENABLED: "FALSE" }), false);
    assert.strictEqual(workerHabilitado({ ML_TOKEN_REFRESH_WORKER_ENABLED: "0" }), true, "só 'false' desliga");
    console.log("  ✓ ML_TOKEN_REFRESH_WORKER_ENABLED: ausente liga, 'false' desliga");
  }

  console.log("\n✓ shopeeTestOAuth: todos os testes passaram");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
