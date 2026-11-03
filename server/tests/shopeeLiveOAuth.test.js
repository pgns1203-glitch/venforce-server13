// OAuth Shopee LIVE: config separada do TEST, cifra dos tokens, link preso à
// Conta, callback LIVE resolvido só pelo state e persistência (serviço falso
// aqui; o SQL real é provado em scripts/shopeeGrantsSqlCheck.js com PGlite).
// Nenhuma chamada externa. Chaves e tokens abaixo são FALSOS.
const assert = require("assert");
const crypto = require("crypto");
const express = require("express");
const { readLiveConfig, readLiveOrigin } = require("../services/shopee/shopeeLiveConfig");
const { readTestConfig } = require("../services/shopee/shopeeTestConfig");
const { lerChave, cifrar, decifrar } = require("../services/shopee/shopeeTokenCrypto");
const { createStateStore } = require("../services/shopee/shopeeOAuthState");
const { exchangeCodeForToken, ShopeeAuthError, CODES } = require("../services/shopee/shopeeTestAuth");
const { ShopeeGrantError, ERROS } = require("../services/shopee/shopeeGrantService");
const { createShopeeController } = require("../controllers/shopeeController");

const LIVE_KEY = "fake-live-partner-key-only-for-tests-987654";
const TEST_KEY = "fake-test-partner-key-only-for-tests-012345";
const CIFRA_HEX = crypto.createHash("sha256").update("chave-de-cifra-falsa-de-teste").digest("hex");
const CODE = "codeLIVEfalso123";
const ACCESS = "ACCESS-LIVE-FALSO-abc";
const REFRESH = "REFRESH-LIVE-FALSO-abc";
const ENV_LIVE = {
  SHOPEE_LIVE_MARKETING_PARTNER_ID: "2000002",
  SHOPEE_LIVE_MARKETING_PARTNER_KEY: LIVE_KEY,
  SHOPEE_LIVE_REDIRECT_URL: "https://api.example.com/shopee/callback",
  SHOPEE_LIVE_API_ORIGIN: "https://partner.shopeemobile.com",
  SHOPEE_TOKEN_ENCRYPTION_KEY: CIFRA_HEX,
  SHOPEE_LIVE_TIMEOUT_MS: "200",
  SHOPEE_LIVE_TRANSPORT: "gateway",
  SHOPEE_GATEWAY_URL: "https://gw.example.com",
  SHOPEE_GATEWAY_SECRET: "segredo-de-gateway-falso-so-para-testes-0123456789",
};
const GW_SECRET_FALSO = ENV_LIVE.SHOPEE_GATEWAY_SECRET;
const ENV_GW = {};
const ENV_TEST = {
  SHOPEE_TEST_MARKETING_PARTNER_ID: "1000001",
  SHOPEE_TEST_MARKETING_PARTNER_KEY: TEST_KEY,
  SHOPEE_TEST_REDIRECT_URL: "https://api.example.com/shopee/callback",
};
const SEGREDOS = [LIVE_KEY, TEST_KEY, CIFRA_HEX, CODE, ACCESS, REFRESH, ENV_LIVE.SHOPEE_GATEWAY_SECRET];
const live = (extra = {}) => readLiveConfig("marketing", { ...ENV_LIVE, ...extra });

function semSegredo(texto, label) {
  for (const s of SEGREDOS) assert.ok(!String(texto).includes(s), `${label}: vazou ${s.slice(0, 8)}…`);
}
const fakeRes = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });
const tokenOk = () => fakeRes(200, { access_token: ACCESS, refresh_token: REFRESH, expire_in: 14400, request_id: "rq-live", error: "" });

(async () => {
  // ── config LIVE ──
  {
    const c = live();
    assert.strictEqual(c.configured, true);
    assert.strictEqual(c.ambiente, "live");
    assert.strictEqual(c.apiOrigin, "https://partner.shopeemobile.com");
    assert.strictEqual(c.partnerKey, LIVE_KEY);
    assert.ok(Buffer.isBuffer(c.chaveCifra) && c.chaveCifra.length === 32);
    semSegredo(JSON.stringify(c) + JSON.stringify({ ...c }), "config LIVE serializada");
    console.log("  ✓ config LIVE válida (Partner Key e chave de cifra não enumeráveis)");

    const vazia = readLiveConfig("marketing", {});
    assert.strictEqual(vazia.configured, false);
    assert.deepStrictEqual(vazia.faltando, [
      "SHOPEE_LIVE_MARKETING_PARTNER_ID", "SHOPEE_LIVE_MARKETING_PARTNER_KEY", "SHOPEE_LIVE_REDIRECT_URL",
      "SHOPEE_LIVE_API_ORIGIN", "SHOPEE_LIVE_TRANSPORT", "SHOPEE_TOKEN_ENCRYPTION_KEY",
    ]);
    assert.strictEqual(live({ SHOPEE_TOKEN_ENCRYPTION_KEY: "" }).configured, false, "sem chave de cifra não persiste → não configurado");
    assert.strictEqual(live({ SHOPEE_TOKEN_ENCRYPTION_KEY: "curta" }).configured, false);
    assert.strictEqual(live({ SHOPEE_LIVE_API_ORIGIN: "" }).configured, false, "host LIVE sem padrão no código");
    console.log("  ✓ LIVE sem config → configured=false + nomes faltando (host LIVE nunca tem padrão)");

    for (const o of ["https://partner.test-stable.shopeemobile.com", "https://openplatform.sandbox.test-stable.shopee.sg",
      "http://partner.shopeemobile.com", "https://evil.example.com", "https://partner.shopeemobile.com/api", "https://u:p@partner.shopeemobile.com"]) {
      assert.strictEqual(readLiveOrigin(o), "", `origem LIVE recusada: ${o}`);
    }
    assert.strictEqual(live({ SHOPEE_LIVE_REDIRECT_URL: "http://api.example.com/shopee/callback" }).configured, false, "LIVE exige https");
    // TEST nunca aceita o host de produção; LIVE nunca aceita host de teste.
    assert.strictEqual(readTestConfig("marketing", { ...ENV_TEST, SHOPEE_TEST_API_ORIGIN: "https://partner.shopeemobile.com" }).configured, false);
    // ENV de um ambiente não configura o outro.
    assert.strictEqual(readLiveConfig("marketing", ENV_TEST).configured, false, "SHOPEE_TEST_* não configura LIVE");
    assert.strictEqual(readTestConfig("marketing", ENV_LIVE).configured, false, "SHOPEE_LIVE_* não configura TEST");
    console.log("  ✓ separação TEST/LIVE: hosts e ENV de um ambiente não servem ao outro");

    // Transporte LIVE: só gateway. Vazio, inválido ou "direct" (mesmo explícito) não configuram.
    for (const t of ["", "  ", "proxy", "direct", "DIRECT", "DIRECT-ish"]) {
      const c = live({ SHOPEE_LIVE_TRANSPORT: t });
      assert.strictEqual(c.configured, false, `transport=${JSON.stringify(t)} não configura`);
      assert.strictEqual(c.transport, "", "sem transporte implícito");
      assert.ok(c.faltando.includes("SHOPEE_LIVE_TRANSPORT"));
    }
    const semTransporte = { ...ENV_LIVE };
    delete semTransporte.SHOPEE_LIVE_TRANSPORT;
    assert.strictEqual(readLiveConfig("marketing", semTransporte).configured, false, "ENV ausente ≠ direct");
    assert.strictEqual(live({ SHOPEE_LIVE_TRANSPORT: " Gateway " }).transport, "gateway", "normaliza caixa/espaço");
    console.log("  ✓ LIVE: só SHOPEE_LIVE_TRANSPORT=gateway configura (vazio/inválido/direct → não configurado)");

    // transport=gateway exige URL + secret do gateway.
    const gw = live(ENV_GW);
    assert.strictEqual(gw.configured, true);
    assert.strictEqual(gw.transport, "gateway");
    semSegredo(JSON.stringify(gw), "config LIVE gateway");
    assert.ok(!JSON.stringify(gw).includes(GW_SECRET_FALSO), "secret do gateway fora da config LIVE");
    const casos = [
      [{ SHOPEE_GATEWAY_URL: "" }, ["SHOPEE_GATEWAY_URL"]],
      [{ SHOPEE_GATEWAY_SECRET: "" }, ["SHOPEE_GATEWAY_SECRET"]],
      [{ SHOPEE_GATEWAY_SECRET: "curto" }, ["SHOPEE_GATEWAY_SECRET"]],
      [{ SHOPEE_GATEWAY_URL: "", SHOPEE_GATEWAY_SECRET: "" }, ["SHOPEE_GATEWAY_URL", "SHOPEE_GATEWAY_SECRET"]],
      [{ SHOPEE_GATEWAY_URL: "http://gw.example.com", NODE_ENV: "production" }, ["SHOPEE_GATEWAY_URL"]],
      [{ SHOPEE_GATEWAY_URL: "não é url" }, ["SHOPEE_GATEWAY_URL"]],
    ];
    for (const [extra, esperado] of casos) {
      const c = live({ ...ENV_GW, ...extra });
      assert.strictEqual(c.configured, false, `gateway incompleto: ${JSON.stringify(Object.keys(extra))}`);
      for (const n of esperado) assert.ok(c.faltando.includes(n), `faltando ${n}`);
    }
    console.log("  ✓ LIVE transport=gateway: sem SHOPEE_GATEWAY_URL/SECRET válidos → não configurado");

    // token/get LIVE com transport=gateway: sai SÓ pelo gateway, nunca por fetch direto.
    const viaGw = [];
    const fakeGateway = { async forward(envelope) { viaGw.push(envelope); return { status: 200, body: JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, expire_in: 14400, request_id: "rq-gw", error: "" }) }; } };
    const tok = await exchangeCodeForToken(gw, { code: CODE, shopId: 777 }, {
      gateway: fakeGateway,
      fetchImpl: async () => { throw new Error("fetch direto não pode ser usado com transport=gateway"); },
    });
    assert.strictEqual(tok.accessToken, ACCESS);
    assert.strictEqual(viaGw.length, 1);
    assert.strictEqual(viaGw[0].method, "POST");
    assert.strictEqual(viaGw[0].path, "/api/v2/auth/token/get");
    assert.strictEqual(viaGw[0].query.partner_id, "2000002");
    assert.ok(!JSON.stringify(viaGw[0]).includes(LIVE_KEY), "Partner Key não vai ao gateway (só o sign)");
    // Config LIVE montada à mão com direct: recusada antes de qualquer rede.
    const forjada = { ...gw, transport: "direct" };
    Object.defineProperty(forjada, "partnerKey", { value: LIVE_KEY, enumerable: false });
    let redeDireta = 0;
    await assert.rejects(
      exchangeCodeForToken(forjada, { code: CODE, shopId: 777 }, { fetchImpl: async () => { redeDireta += 1; return tokenOk(); }, gateway: fakeGateway }),
      (e) => e instanceof ShopeeAuthError && e.code === CODES.NAO_CONFIGURADO,
    );
    assert.strictEqual(redeDireta, 0, "LIVE direct nunca chama a rede");
    assert.strictEqual(viaGw.length, 1, "nem o gateway");
    console.log("  ✓ token/get LIVE com transport=gateway: POST /api/v2/auth/token/get pelo gateway, sem fetch direto");
  }

  // ── cifra ──
  {
    const chave = lerChave({ SHOPEE_TOKEN_ENCRYPTION_KEY: CIFRA_HEX });
    assert.ok(lerChave({ SHOPEE_TOKEN_ENCRYPTION_KEY: chave.toString("base64") }), "aceita base64");
    const ctx = { ambiente: "live", app: "marketing", shopId: 777, tipo: "access" };
    const enc = cifrar(ACCESS, ctx, chave);
    assert.match(enc, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    semSegredo(enc, "texto cifrado");
    assert.notStrictEqual(cifrar(ACCESS, ctx, chave), enc, "IV aleatório");
    assert.strictEqual(decifrar(enc, ctx, chave), ACCESS);
    assert.throws(() => decifrar(enc, { ...ctx, tipo: "refresh" }, chave), "AAD: tipo trocado");
    assert.throws(() => decifrar(enc, { ...ctx, shopId: 778 }, chave), "AAD: outra loja");
    assert.throws(() => decifrar(enc, ctx, crypto.randomBytes(32)), "chave errada");
    assert.throws(() => decifrar(enc.slice(0, -2) + "AA", ctx, chave), "adulterado");
    console.log("  ✓ cifra AES-256-GCM: roundtrip; AAD/chave/adulteração recusam");
  }

  // ── controller: link LIVE + callback ──
  {
    const logs = [];
    const logger = { log: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) };
    const contas = {
      10: { id: 10, marketplace: "shopee", ativo: true, cliente_ativo: true, external_account_id: null },
      11: { id: 11, marketplace: "meli", ativo: true, cliente_ativo: true },
      12: { id: 12, marketplace: "shopee", ativo: false, cliente_ativo: true },
    };
    const salvos = [];
    let modoSalvar = "ok";
    const grants = {
      ShopeeGrantError,
      async validarContaShopee(id) {
        const n = Number(id);
        if (!Number.isSafeInteger(n) || n <= 0) throw new ShopeeGrantError("CONTA_INVALIDA", ERROS.CONTA_INVALIDA[1], 400);
        const c = contas[n];
        if (!c) throw new ShopeeGrantError("CONTA_NAO_ENCONTRADA", ERROS.CONTA_NAO_ENCONTRADA[1], 404);
        if (c.marketplace !== "shopee") throw new ShopeeGrantError("MARKETPLACE_INCORRETO", ERROS.MARKETPLACE_INCORRETO[1], 409);
        if (!c.ativo) throw new ShopeeGrantError("CONTA_INATIVA", ERROS.CONTA_INATIVA[1], 409);
        return c;
      },
      async salvarGrantLive(dados) {
        if (modoSalvar === "conflito") throw new ShopeeGrantError("SHOP_EM_OUTRA_CONTA", ERROS.SHOP_EM_OUTRA_CONTA[1], 409);
        if (modoSalvar === "banco") throw new ShopeeGrantError("GRANT_NAO_PERSISTIDO", "Falha ao persistir o grant Shopee (57P01).", 500);
        if (modoSalvar === "bug") throw new Error(`boom ${dados.accessToken}`);
        salvos.push(dados);
        return { grantId: salvos.length, clienteContaId: dados.clienteContaId, shopId: dados.shopId, reautorizacao: salvos.length > 1 };
      },
      async statusGrantsLive({ clienteContaId }) {
        return salvos.filter((s) => clienteContaId == null || Number(s.clienteContaId) === Number(clienteContaId)).map((s, i) => ({
          grantId: i + 1, clienteContaId: s.clienteContaId, app: s.app, shopId: String(s.shopId), status: "active",
          tokenPresente: true, refreshTokenPresente: true, accessTokenExpiraEm: "2026-10-29T04:00:00.000Z",
        }));
      },
    };
    const chamadasShopee = [];
    // Cada saída registra por onde foi: "gateway" (forward) ou "direct" (fetch).
    const exchange = async (config, args) => {
      const reg = { ambiente: config.ambiente, origin: config.apiOrigin, partnerId: config.partnerId, via: null, path: null };
      chamadasShopee.push(reg);
      return exchangeCodeForToken(config, args, {
        fetchImpl: async () => { reg.via = "direct"; return tokenOk(); },
        gateway: { async forward(env) { reg.via = "gateway"; reg.path = env.path; const r = tokenOk(); return { status: r.status, body: await r.text() }; } },
      });
    };
    const store = createStateStore();
    let envLive = ENV_LIVE;
    const ctrl = createShopeeController({
      stateStore: store,
      readConfig: (a) => readTestConfig(a, ENV_TEST),
      readLive: (a) => readLiveConfig(a, envLive),
      grants,
      exchange,
      logger,
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 42, role: "admin" }; next(); });
    app.get("/shopee/callback", ctrl.callbackShopeeController);
    app.post("/shopee/test/autorizar", ctrl.iniciarAutorizacaoTestController);
    app.post("/shopee/live/autorizar", ctrl.iniciarAutorizacaoLiveController);
    app.get("/shopee/live/status", ctrl.statusLiveController);
    const srv = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const base = `http://127.0.0.1:${srv.address().port}`;
    const post = async (p, body) => { const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
    const cb = async (qs) => { const r = await fetch(`${base}/shopee/callback${qs}`); return { status: r.status, body: await r.text() }; };
    const stateDe = (url) => new URL(new URL(url).searchParams.get("redirect")).searchParams.get("state");

    // validações da Conta antes do link
    assert.strictEqual((await post("/shopee/live/autorizar", {})).status, 400, "sem clienteContaId");
    assert.strictEqual((await post("/shopee/live/autorizar", { clienteContaId: "abc" })).status, 400);
    assert.strictEqual((await post("/shopee/live/autorizar", { clienteContaId: 999 })).json.code, "CONTA_NAO_ENCONTRADA");
    const meli = await post("/shopee/live/autorizar", { clienteContaId: 11 });
    assert.strictEqual(meli.status, 409);
    assert.strictEqual(meli.json.code, "MARKETPLACE_INCORRETO");
    assert.strictEqual((await post("/shopee/live/autorizar", { clienteContaId: 12 })).json.code, "CONTA_INATIVA");
    assert.strictEqual(store.tamanho(), 0, "nenhum state emitido para Conta recusada");
    console.log("  ✓ link LIVE: Conta inválida/inexistente/marketplace errado/inativa → recusa sem emitir state");

    envLive = {};
    const semCfg = await post("/shopee/live/autorizar", { clienteContaId: 10 });
    assert.strictEqual(semCfg.status, 503);
    assert.ok(semCfg.json.faltando.includes("SHOPEE_TOKEN_ENCRYPTION_KEY"));
    envLive = ENV_LIVE;
    console.log("  ✓ link LIVE sem config → 503 com nomes faltando");

    const ok = await post("/shopee/live/autorizar", { clienteContaId: 10 });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.json.ambiente, "live");
    assert.strictEqual(ok.json.clienteContaId, 10);
    const u = new URL(ok.json.url);
    assert.strictEqual(u.origin + u.pathname, "https://partner.shopeemobile.com/api/v2/shop/auth_partner");
    assert.strictEqual(u.searchParams.get("partner_id"), "2000002", "Partner ID LIVE, não o de TEST");
    semSegredo(JSON.stringify(ok.json), "resposta do link LIVE");
    console.log("  ✓ link LIVE: host/partner LIVE, sem segredo na resposta");

    // callback LIVE: Conta vem do state, não da query
    const s1 = stateDe(ok.json.url);
    const fim = await cb(`?state=${s1}&code=${CODE}&shop_id=555&clienteContaId=11&ambiente=test`);
    assert.strictEqual(fim.status, 200);
    assert.match(fim.body, /Autorização Shopee concluída/);
    assert.match(fim.body, /shop_id 555 autorizada e vinculada à Conta #10/);
    semSegredo(fim.body, "HTML sucesso LIVE");
    assert.strictEqual(salvos.length, 1);
    assert.strictEqual(salvos[0].clienteContaId, 10, "Conta do state, ignorando clienteContaId da query");
    assert.strictEqual(salvos[0].shopId, 555);
    assert.strictEqual(salvos[0].accessToken, ACCESS);
    assert.strictEqual(salvos[0].refreshToken, REFRESH);
    assert.strictEqual(salvos[0].userId, 42);
    assert.ok(Buffer.isBuffer(salvos[0].chaveCifra));
    assert.deepStrictEqual(chamadasShopee.at(-1), { ambiente: "live", origin: "https://partner.shopeemobile.com", partnerId: 2000002, via: "gateway", path: "/api/v2/auth/token/get" }, "token/get LIVE no partner LIVE, pelo gateway");
    console.log("  ✓ callback LIVE: token/get LIVE + persistência na Conta do state (query ignorada)");

    const replay = await cb(`?state=${s1}&code=${CODE}&shop_id=555`);
    assert.strictEqual(replay.status, 400);
    assert.strictEqual(salvos.length, 1, "replay não persiste");
    console.log("  ✓ replay LIVE recusado sem nova persistência");

    const s2 = stateDe((await post("/shopee/live/autorizar", { clienteContaId: 10 })).json.url);
    assert.strictEqual((await cb(`?state=${s2}&code=${CODE}&shop_id=555`)).status, 200);
    assert.strictEqual(salvos.length, 2, "reautorização chega ao serviço (upsert lá)");
    console.log("  ✓ reautorização da mesma Conta/loja passa pelo mesmo caminho");

    for (const [modo, status, padrao] of [["conflito", 409, /já está vinculada a outra Conta/], ["banco", 500, /não pôde ser gravada/], ["bug", 500, /não pôde ser gravada/]]) {
      modoSalvar = modo;
      const s = stateDe((await post("/shopee/live/autorizar", { clienteContaId: 10 })).json.url);
      const r = await cb(`?state=${s}&code=${CODE}&shop_id=556`);
      assert.strictEqual(r.status, status, `falha de persistência (${modo}) → ${status}`);
      assert.ok(!/Autorização Shopee concluída|autorizada e vinculada/.test(r.body), `falha (${modo}) nunca mostra sucesso`);
      assert.match(r.body, /Autorização Shopee não concluída/);
      assert.match(r.body, padrao);
      semSegredo(r.body, `HTML falha ${modo}`);
    }
    modoSalvar = "ok";
    console.log("  ✓ falha de persistência (conflito/banco/erro inesperado) nunca retorna sucesso");

    // TEST continua pelo mesmo callback, sem persistir
    const t = await post("/shopee/test/autorizar", {});
    assert.strictEqual(t.status, 200);
    assert.ok(new URL(t.json.url).origin.includes("test-stable"), "link TEST no host de teste");
    const antes = salvos.length;
    const rt = await cb(`?state=${stateDe(t.json.url)}&code=${CODE}&shop_id=777`);
    assert.strictEqual(rt.status, 200);
    assert.match(rt.body, /Autorização Shopee de teste concluída/);
    assert.strictEqual(salvos.length, antes, "TEST não persiste");
    assert.strictEqual(chamadasShopee.at(-1).ambiente, "test");
    assert.strictEqual(chamadasShopee.at(-1).via, "direct", "TEST segue no transporte dele (direct por padrão)");
    assert.ok(chamadasShopee.filter((c) => c.ambiente === "live").every((c) => c.via === "gateway"), "nenhum token/get LIVE direto");
    console.log("  ✓ TEST intacto: mesmo callback, host de teste, sem persistência");

    // erro do token/get LIVE: código sem prefixo TEST
    const ctrlErro = createShopeeController({
      stateStore: store, readLive: (a) => readLiveConfig(a, ENV_LIVE), grants, logger,
      exchange: async () => { throw new ShopeeAuthError(CODES.UPSTREAM_4XX, "x", { upstreamStatus: 403, shopeeError: "error_sign" }); },
    });
    const sErr = store.emitir({ app: "marketing", ambiente: "live", userId: 1, clienteContaId: 10 }).state;
    const resErr = { headers: {}, set() { return this; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } };
    await ctrlErro.callbackShopeeController({ query: { state: sErr, code: CODE, shop_id: "555" } }, resErr);
    assert.strictEqual(resErr.code, 502);
    assert.match(resErr.body, /SHOPEE_UPSTREAM_4XX \(error_sign\)/);
    assert.ok(!/SHOPEE_TEST_/.test(resErr.body));
    console.log("  ✓ erro do token/get LIVE: código sem prefixo TEST e diagnóstico seguro");

    // status LIVE
    const st = await (await fetch(`${base}/shopee/live/status?clienteContaId=10`)).json();
    assert.strictEqual(st.autorizado, true);
    assert.strictEqual(st.grants[0].shopId, "555");
    assert.strictEqual(st.grants[0].tokenPresente, true);
    assert.strictEqual(st.marketing.configured, true);
    semSegredo(JSON.stringify(st), "status LIVE");
    console.log("  ✓ status LIVE: autorizado/shop_id/flags/expiração, sem token nem chave");

    semSegredo(logs.join("\n"), "logs");
    assert.ok(logs.some((l) => /grant LIVE salvo: app=marketing conta=10 shop_id=555/.test(l)));
    console.log(`  ✓ nenhum segredo/token logado (${logs.length} linhas conferidas)`);
    srv.close();
  }

  // ── sondagem LIVE (scripts/shopeeLiveSignProbe.js), sem rede ──
  {
    const probe = require("../scripts/shopeeLiveSignProbe");
    const GLOBAL = "https://partner.shopeemobile.com";
    const envProbe = {
      SHOPEE_LIVE_MARKETING_PARTNER_ID: "2000002", SHOPEE_LIVE_MARKETING_PARTNER_KEY: LIVE_KEY, SHOPEE_LIVE_API_ORIGIN: GLOBAL,
      SHOPEE_LIVE_TRANSPORT: "gateway", SHOPEE_GATEWAY_URL: ENV_LIVE.SHOPEE_GATEWAY_URL, SHOPEE_GATEWAY_SECRET: GW_SECRET_FALSO,
    };
    // Gateway falso com o mesmo contrato do client real: 2xx → {status, body};
    // 4xx/5xx → erro com upstreamStatus/upstreamBody; timeout → código do gateway.
    const rodar = async (resposta, argv = ["node", "probe"], env = envProbe) => {
      const linhas = [];
      const chamadas = [];
      let diretas = 0;
      const gateway = {
        async forward(envelope) {
          chamadas.push({ path: envelope.path, method: envelope.method, partnerId: envelope.query.partner_id, sign: envelope.query.sign, body: envelope.body });
          if (resposta === "timeout") { const e = new Error("t"); e.code = "SHOPEE_GATEWAY_TIMEOUT"; throw e; }
          const [status, body] = resposta;
          if (status >= 200 && status < 300) return { status, body: JSON.stringify(body) };
          const e = new Error("upstream"); e.code = "SHOPEE_GATEWAY_UPSTREAM_4XX"; e.upstreamStatus = status; e.upstreamBody = JSON.stringify(body); throw e;
        },
      };
      const codigo = await probe.main(argv, env, { gateway, fetchImpl: async () => { diretas += 1; throw new Error("rede direta proibida"); }, log: (l) => linhas.push(String(l)) });
      return { codigo, saida: linhas.join("\n"), chamadas, diretas };
    };

    const ok = await rodar([400, { error: "invalid_code", message: "Invalid code." }]);
    assert.strictEqual(ok.codigo, 0);
    assert.strictEqual(ok.diretas, 0, "sondagem LIVE nunca usa rede direta");
    assert.strictEqual(ok.chamadas.length, 1);
    const [ch] = ok.chamadas;
    assert.ok(ch.method === "POST" && ch.path === "/api/v2/auth/token/get" && ch.partnerId === "2000002", "token/get LIVE pelo gateway");
    assert.ok(ch.body.code === "venforceSondagemCodeFalso" && ch.body.shop_id === 1, "code e shop_id falsos");
    assert.match(ch.sign, /^[0-9a-f]{64}$/, "assinatura HMAC-SHA256 hex enviada");
    assert.match(ok.saida, /transport=gateway/);
    assert.match(ok.saida, /→  HOST_ASSINATURA_OK/);
    semSegredo(ok.saida, "saída da sondagem");
    assert.ok(!ok.saida.includes(ch.sign), "assinatura nunca impressa");
    console.log("  ✓ sondagem LIVE: invalid_code pelo gateway → HOST_ASSINATURA_OK, sem rede direta nem segredo na saída");

    const sign = await rodar([403, { error: "error_sign", message: "Wrong sign." }]);
    assert.strictEqual(sign.codigo, 1);
    assert.match(sign.saida, /→  ASSINATURA_RECUSADA/);
    const ip = await rodar([403, { error: "error_ip_not_allowed", message: "IP not in whitelist" }]);
    assert.strictEqual(ip.codigo, 1, "nenhum host aceito → código 1");
    assert.match(ip.saida, /→  IP_ALLOWLIST/);
    assert.match(ip.saida, /Indício de allowlist de IP/);
    assert.match(ip.saida, /Nenhum host aceitou a assinatura/);
    assert.match((await rodar("timeout")).saida, /→  INCONCLUSIVO/);
    assert.match((await rodar([403, { error: "invalid_partner_id", message: "Invalid partner_id, please have a check." }])).saida, /→  PARTNER_OU_HOST/);
    assert.match((await rodar([500, { error: "error_server", message: "x" }])).saida, /→  OUTRO/);
    console.log("  ✓ sondagem: error_sign/IP/timeout/partner/outro classificados; nenhum aceito → exit 1");

    const todos = await rodar([400, { error: "invalid_code" }], ["node", "probe", "--todos-hosts"]);
    assert.strictEqual(todos.codigo, 2, "--todos-hosts desativado no LIVE via gateway");
    assert.strictEqual(todos.chamadas.length, 0);
    const semOrigem = await rodar([400, { error: "invalid_code" }], ["node", "probe"], { ...envProbe, SHOPEE_LIVE_API_ORIGIN: "" });
    assert.strictEqual(semOrigem.codigo, 2);
    assert.match(semOrigem.saida, /SHOPEE_LIVE_API_ORIGIN/);
    for (const [extra, nome] of [
      [{ SHOPEE_LIVE_MARKETING_PARTNER_KEY: "" }, "SHOPEE_LIVE_MARKETING_PARTNER_KEY"],
      [{ SHOPEE_LIVE_TRANSPORT: "" }, "SHOPEE_LIVE_TRANSPORT"],
      [{ SHOPEE_LIVE_TRANSPORT: "direct" }, "SHOPEE_LIVE_TRANSPORT"],
      [{ SHOPEE_GATEWAY_URL: "" }, "SHOPEE_GATEWAY_URL"],
      [{ SHOPEE_GATEWAY_SECRET: "" }, "SHOPEE_GATEWAY_SECRET"],
    ]) {
      const r = await rodar([400, { error: "invalid_code" }], ["node", "probe"], { ...envProbe, ...extra });
      assert.strictEqual(r.codigo, 2, `sem ${nome} não sonda`);
      assert.match(r.saida, new RegExp(nome));
      assert.strictEqual(r.chamadas.length + r.diretas, 0, `sem ${nome}: nenhuma chamada`);
    }
    console.log("  ✓ sondagem: sem credencial/transporte gateway/URL/secret do gateway não chama nada");
  }

  console.log("\n✓ shopeeLiveOAuth: todos os testes passaram");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
