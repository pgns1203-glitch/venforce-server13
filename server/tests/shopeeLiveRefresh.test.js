// Refresh Shopee LIVE + links em lote + worker. Sem rede e sem banco: gateway,
// serviço de grants e Shopee são falsos. O SQL real (lock, rotação, concorrência,
// 3 grants) é provado em tests/shopeeLiveRefresh.postgres.cjs contra PostgreSQL.
// Chaves e tokens abaixo são FALSOS.
const assert = require("assert");
const crypto = require("crypto");
const express = require("express");
const { readLiveConfig } = require("../services/shopee/shopeeLiveConfig");
const { readTestConfig } = require("../services/shopee/shopeeTestConfig");
const { createStateStore } = require("../services/shopee/shopeeOAuthState");
const { refreshAccessToken, signPublic, ShopeeAuthError, ACCESS_TOKEN_GET_PATH, CODES } = require("../services/shopee/shopeeTestAuth");
const { ShopeeGrantError, ERROS } = require("../services/shopee/shopeeGrantService");
const { createShopeeController } = require("../controllers/shopeeController");
const { createShopeeRefreshWorker, lerConfigWorker } = require("../services/shopee/shopeeRefreshWorker");

const LIVE_KEY = "fake-live-partner-key-refresh-tests-55555";
const CIFRA_HEX = crypto.createHash("sha256").update("cifra-falsa-refresh").digest("hex");
const REFRESH_VELHO = "REFRESH-VELHO-falso-111";
const ACCESS_NOVO = "ACCESS-NOVO-falso-222";
const REFRESH_NOVO = "REFRESH-NOVO-falso-333";
const ENV_LIVE = {
  SHOPEE_LIVE_MARKETING_PARTNER_ID: "2000002",
  SHOPEE_LIVE_MARKETING_PARTNER_KEY: LIVE_KEY,
  SHOPEE_LIVE_REDIRECT_URL: "https://api.example.com/shopee/callback",
  SHOPEE_LIVE_API_ORIGIN: "https://partner.shopeemobile.com",
  SHOPEE_TOKEN_ENCRYPTION_KEY: CIFRA_HEX,
  SHOPEE_LIVE_TRANSPORT: "gateway",
  SHOPEE_GATEWAY_URL: "https://gw.example.com",
  SHOPEE_GATEWAY_SECRET: "segredo-de-gateway-falso-refresh-0123456789abc",
};
const SEGREDOS = [LIVE_KEY, CIFRA_HEX, REFRESH_VELHO, ACCESS_NOVO, REFRESH_NOVO, ENV_LIVE.SHOPEE_GATEWAY_SECRET];
const live = (extra = {}) => readLiveConfig("marketing", { ...ENV_LIVE, ...extra });
function semSegredo(texto, label) {
  for (const s of SEGREDOS) assert.ok(!String(texto).includes(s), `${label}: vazou ${s.slice(0, 10)}…`);
}
const okRefresh = (extra = {}) => ({ status: 200, body: JSON.stringify({ access_token: ACCESS_NOVO, refresh_token: REFRESH_NOVO, expire_in: 14400, request_id: "rq-refresh", error: "", shop_id: 555, ...extra }) });

(async () => {
  // ── access_token/get: só gateway, contrato e segredos ──
  {
    const envelopes = [];
    const gateway = { async forward(env, opts) { envelopes.push({ env, opts }); return okRefresh(); } };
    const fetchOriginal = globalThis.fetch;
    let fetchDireto = 0;
    globalThis.fetch = async () => { fetchDireto += 1; throw new Error("fetch direto proibido"); };
    try {
      const agora = 1_800_000_000_000;
      const r = await refreshAccessToken(live(), { refreshToken: REFRESH_VELHO, shopId: 555 }, { gateway, now: () => agora });
      assert.strictEqual(fetchDireto, 0, "nenhuma chamada LIVE direta");
      assert.strictEqual(envelopes.length, 1);
      const { env } = envelopes[0];
      assert.strictEqual(env.method, "POST");
      assert.strictEqual(env.path, "/api/v2/auth/access_token/get");
      assert.strictEqual(ACCESS_TOKEN_GET_PATH, env.path);
      assert.deepStrictEqual(env.body, { refresh_token: REFRESH_VELHO, partner_id: 2000002, shop_id: 555 });
      const ts = Math.floor(agora / 1000);
      assert.deepStrictEqual(env.query, {
        partner_id: "2000002",
        timestamp: String(ts),
        sign: signPublic({ partnerId: 2000002, partnerKey: LIVE_KEY, path: "/api/v2/auth/access_token/get", timestamp: ts }),
      });
      assert.ok(!JSON.stringify(env).includes(LIVE_KEY), "Partner Key não vai ao gateway (só o sign)");
      assert.strictEqual(r.accessToken, ACCESS_NOVO);
      assert.strictEqual(r.refreshToken, REFRESH_NOVO, "o refresh_token NOVO é devolvido");
      assert.strictEqual(r.expireIn, 14400);
      semSegredo(JSON.stringify(r) + JSON.stringify({ ...r }), "resultado do refresh serializado");
      console.log("  ✓ refresh: POST /api/v2/auth/access_token/get SÓ pelo gateway, assinatura pública, par novo não enumerável");

      // Sem gateway: nada sai (nem direto). TEST/forjada sem gateway: recusado.
      for (const forjada of [
        { ...live(), transport: "direct" },
        { ...readTestConfig("marketing", { SHOPEE_TEST_MARKETING_PARTNER_ID: "1", SHOPEE_TEST_MARKETING_PARTNER_KEY: "k", SHOPEE_TEST_REDIRECT_URL: "https://a.example.com/cb" }), transport: "gateway" },
      ]) {
        Object.defineProperty(forjada, "partnerKey", { value: LIVE_KEY, enumerable: false });
        await assert.rejects(refreshAccessToken(forjada, { refreshToken: REFRESH_VELHO, shopId: 555 }, { gateway }), (e) => e instanceof ShopeeAuthError && e.code === CODES.NAO_CONFIGURADO);
      }
      assert.strictEqual(envelopes.length, 1, "config sem gateway/TEST não chama ninguém");
      assert.strictEqual(fetchDireto, 0);
      console.log("  ✓ refresh: transporte direto ou config TEST → recusado sem chamada nenhuma");

      // Erro da Shopee (4xx via gateway): erro tipado, sem token na mensagem.
      const gwErro = { async forward() { const e = new Error("upstream"); e.upstreamStatus = 403; e.upstreamBody = JSON.stringify({ error: "error_auth", message: `invalid refresh_token ${REFRESH_VELHO}`, request_id: "rq-x" }); throw e; } };
      const err = await refreshAccessToken(live(), { refreshToken: REFRESH_VELHO, shopId: 555 }, { gateway: gwErro }).catch((e) => e);
      assert.ok(err instanceof ShopeeAuthError);
      assert.strictEqual(err.shopeeError, "error_auth");
      assert.strictEqual(err.shopeeRequestId, "rq-x");
      semSegredo(JSON.stringify(err) + err.message + String(err.shopeeMessage), "erro do refresh");
      // Resposta de outra loja: recusada.
      const outra = { async forward() { return okRefresh({ shop_id: 999 }); } };
      await assert.rejects(refreshAccessToken(live(), { refreshToken: REFRESH_VELHO, shopId: 555 }, { gateway: outra }), (e) => e.code === CODES.RESPOSTA_INVALIDA);
      // Resposta sem refresh_token: recusada (nunca grava par incompleto).
      const semRefresh = { async forward() { return okRefresh({ refresh_token: "" }); } };
      await assert.rejects(refreshAccessToken(live(), { refreshToken: REFRESH_VELHO, shopId: 555 }, { gateway: semRefresh }), (e) => e.code === CODES.RESPOSTA_INVALIDA);
      console.log("  ✓ refresh: erro da Shopee tipado e sem token; outra loja / par incompleto recusados");
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }

  // ── controller: refresh manual, links em lote, contas ──
  {
    const logs = [];
    const logger = { log: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) };
    const contas = {
      235: { id: 235, marketplace: "shopee", ativo: true, cliente_ativo: true, external_account_id: null, cliente_nome: "Cliente A", conta_nome: "Loja A" },
      310: { id: 310, marketplace: "shopee", ativo: true, cliente_ativo: true, external_account_id: "8001", cliente_nome: "Cliente B", conta_nome: "Loja B" },
      411: { id: 411, marketplace: "shopee", ativo: true, cliente_ativo: true, external_account_id: null, cliente_nome: "Cliente C", conta_nome: "Loja C" },
      500: { id: 500, marketplace: "meli", ativo: true, cliente_ativo: true, cliente_nome: "Cliente ML" },
      501: { id: 501, marketplace: "tiktok", ativo: true, cliente_ativo: true, cliente_nome: "Cliente TT" },
      502: { id: 502, marketplace: "shopee", ativo: false, cliente_ativo: true, cliente_nome: "Inativa" },
    };
    const salvos = [];
    let modoRefresh = "ok";
    const refreshes = [];
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
      async salvarGrantLive(dados) { salvos.push(dados); return { grantId: salvos.length, clienteContaId: dados.clienteContaId, shopId: dados.shopId, reautorizacao: false }; },
      async statusGrantsLive() { return []; },
      async listarContasShopee() { return [{ clienteContaId: 235, cliente: "Cliente A", conta: "Loja A", podeGerarLink: true, grant: null }]; },
      async refreshGrantLive({ clienteContaId }, { config, refresh }) {
        refreshes.push({ clienteContaId, temChave: Boolean(config.chaveCifra), refreshFn: typeof refresh });
        if (modoRefresh === "shopee") {
          const e = new ShopeeGrantError("REFRESH_FALHOU", ERROS.REFRESH_FALHOU[1], 502);
          e.detalhe = { code: "SHOPEE_UPSTREAM_4XX:error_auth", upstreamStatus: 403, shopeeError: "error_auth", shopeeRequestId: "rq-9", diagnostico: "CODE_RECUSADO" };
          throw e;
        }
        if (modoRefresh === "concorrente") throw new ShopeeGrantError("REFRESH_EM_ANDAMENTO", ERROS.REFRESH_EM_ANDAMENTO[1], 409);
        if (modoRefresh === "sem-grant") throw new ShopeeGrantError("GRANT_NAO_ENCONTRADO", ERROS.GRANT_NAO_ENCONTRADO[1], 404);
        return { grantId: 1, clienteContaId: Number(clienteContaId), shopId: 555, accessTokenExpiresAt: "2026-11-06T16:00:00.000Z", refreshedAt: "2026-11-06T12:00:00.000Z", shopeeRequestId: "rq-ok" };
      },
    };
    const store = createStateStore();
    let envLive = ENV_LIVE;
    const exchange = async () => {
      const r = { shopId: 0, expireIn: 14400, shopeeRequestId: "rq" };
      Object.defineProperty(r, "accessToken", { value: "A", enumerable: false });
      Object.defineProperty(r, "refreshToken", { value: "R", enumerable: false });
      return r;
    };
    const ctrl = createShopeeController({ stateStore: store, readLive: (a) => readLiveConfig(a, envLive), grants, exchange, logger });
    const app = express();
    app.use(express.json());
    app.post("/shopee/live/refresh", (req, res, next) => { req.user = { id: 7 }; next(); }, ctrl.refreshLiveController);
    app.post("/shopee/live/links", (req, res, next) => { req.user = { id: 7 }; next(); }, ctrl.gerarLinksLiveController);
    app.get("/shopee/live/contas", ctrl.contasLiveController);
    app.get("/shopee/callback", ctrl.callbackShopeeController);
    const srv = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const base = `http://127.0.0.1:${srv.address().port}`;
    const post = async (p, body) => { const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
    try {
      // Refresh manual: só metadados.
      const ok = await post("/shopee/live/refresh", { clienteContaId: 235 });
      assert.strictEqual(ok.status, 200);
      assert.deepStrictEqual(Object.keys(ok.json).sort(), ["accessTokenExpiraEm", "clienteContaId", "ok", "refreshedAt", "shopId", "shopeeRequestId"]);
      assert.strictEqual(ok.json.clienteContaId, 235);
      assert.strictEqual(ok.json.shopId, "555");
      assert.strictEqual(refreshes[0].refreshFn, "function");
      semSegredo(JSON.stringify(ok.json), "resposta do refresh manual");
      modoRefresh = "shopee";
      const falha = await post("/shopee/live/refresh", { clienteContaId: 235 });
      assert.strictEqual(falha.status, 502);
      assert.strictEqual(falha.json.code, "REFRESH_FALHOU");
      assert.strictEqual(falha.json.shopeeError, "error_auth");
      assert.match(falha.json.erro, /anteriores foram mantidos/);
      modoRefresh = "concorrente";
      assert.strictEqual((await post("/shopee/live/refresh", { clienteContaId: 235 })).status, 409);
      modoRefresh = "sem-grant";
      assert.strictEqual((await post("/shopee/live/refresh", { clienteContaId: 235 })).status, 404);
      modoRefresh = "ok";
      envLive = { ...ENV_LIVE, SHOPEE_GATEWAY_URL: "" };
      const semGw = await post("/shopee/live/refresh", { clienteContaId: 235 });
      assert.strictEqual(semGw.status, 503, "sem gateway configurado não há refresh");
      assert.ok(semGw.json.faltando.includes("SHOPEE_GATEWAY_URL"));
      envLive = ENV_LIVE;
      console.log("  ✓ POST /live/refresh: só metadados; falha Shopee 502 (tokens mantidos), concorrente 409, sem grant 404, sem gateway 503");

      // Links em lote: state independente por Conta.
      const lote = await post("/shopee/live/links", { clienteContaIds: [235, 310, 411, 500, 501, 502, 999, "abc", 235] });
      assert.strictEqual(lote.status, 200);
      assert.strictEqual(lote.json.ok, false, "há contas recusadas");
      assert.strictEqual(lote.json.validadeMinutos, 10);
      const porId = Object.fromEntries(lote.json.links.map((l) => [String(l.clienteContaId), l]));
      assert.strictEqual(lote.json.links.length, 8, "duplicado (235) gera um link só");
      for (const [id, nome] of [["235", "Cliente A"], ["310", "Cliente B"], ["411", "Cliente C"]]) {
        assert.strictEqual(porId[id].ok, true, id);
        assert.strictEqual(porId[id].cliente, nome);
        assert.ok(porId[id].url.startsWith("https://partner.shopeemobile.com/api/v2/shop/auth_partner?"), "app LIVE atual");
        assert.ok(Date.parse(porId[id].expiraEm) > Date.now());
      }
      assert.strictEqual(porId["310"].lojaJaVinculada, "8001");
      assert.strictEqual(porId["500"].code, "MARKETPLACE_INCORRETO", "Mercado Livre não ganha link");
      assert.strictEqual(porId["501"].code, "MARKETPLACE_INCORRETO", "TikTok não ganha link");
      assert.strictEqual(porId["502"].code, "CONTA_INATIVA");
      assert.strictEqual(porId["999"].code, "CONTA_NAO_ENCONTRADA");
      assert.strictEqual(porId.abc.code, "CONTA_INVALIDA");
      for (const l of lote.json.links.filter((x) => !x.ok)) assert.ok(!l.url, "conta recusada não recebe URL");
      semSegredo(JSON.stringify(lote.json), "lote de links");
      const states = ["235", "310", "411"].map((id) => new URL(new URL(porId[id].url).searchParams.get("redirect")).searchParams.get("state"));
      assert.strictEqual(new Set(states).size, 3, "um state diferente por Conta");
      console.log("  ✓ POST /live/links: 1 link por Conta Shopee ativa (state próprio, 10 min); ML/TikTok/inativa/inexistente sem link");

      // Cada link prende o callback à SUA Conta: o de B vira grant de B, mesmo com
      // clienteContaId forjado na query; e o mesmo link não serve duas vezes.
      const stateB = states[1];
      const cbB = await fetch(`${base}/shopee/callback?state=${stateB}&code=codeB&shop_id=8001&clienteContaId=235`);
      assert.strictEqual(cbB.status, 200);
      assert.strictEqual(salvos.at(-1).clienteContaId, 310, "grant vai para a Conta do state (B), não a da query");
      const replay = await fetch(`${base}/shopee/callback?state=${stateB}&code=codeB2&shop_id=8001`);
      assert.strictEqual(replay.status, 400, "link de uso único");
      const cbA = await fetch(`${base}/shopee/callback?state=${states[0]}&code=codeA&shop_id=7001`);
      assert.strictEqual(cbA.status, 200);
      assert.strictEqual(salvos.at(-1).clienteContaId, 235);
      console.log("  ✓ callback: cada link grava na Conta do próprio state; replay recusado");

      for (const body of [{}, { clienteContaIds: [] }, { clienteContaIds: Array.from({ length: 11 }, (_, i) => i + 1) }, { clienteContaIds: "235" }]) {
        assert.strictEqual((await post("/shopee/live/links", body)).status, 400);
      }
      envLive = { ...ENV_LIVE, SHOPEE_LIVE_MARKETING_PARTNER_KEY: "" };
      assert.strictEqual((await post("/shopee/live/links", { clienteContaIds: [235] })).status, 503);
      envLive = ENV_LIVE;
      const ct = await (await fetch(`${base}/shopee/live/contas`)).json();
      assert.strictEqual(ct.contas[0].clienteContaId, 235);
      semSegredo(logs.join("\n"), "logs do controller");
      console.log("  ✓ /live/links valida o corpo (1–10 ids) e exige LIVE configurado; /live/contas lista; logs sem segredo");
    } finally {
      srv.close();
    }
  }

  // ── worker ──
  {
    assert.strictEqual(lerConfigWorker({}).ligado, false, "desligado por padrão");
    assert.strictEqual(lerConfigWorker({ SHOPEE_LIVE_REFRESH_WORKER_ENABLED: "true" }).ligado, true);
    assert.strictEqual(lerConfigWorker({ SHOPEE_LIVE_REFRESH_INTERVAL_MS: "1000" }).intervaloMs, 60000, "mínimo 1 min (sem loop agressivo)");
    assert.strictEqual(lerConfigWorker({}).intervaloMs, 600000);

    const logs = [];
    const logger = { log: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) };
    const chamadas = [];
    const grants = {
      MARGEM_REFRESH_MS: 30 * 60 * 1000,
      async listarGrantsParaRefresh() {
        return [1, 2, 3, 4].map((n) => ({ grantId: n, clienteContaId: 100 + n, shopId: 9000 + n }));
      },
      async refreshGrantLive({ clienteContaId, seExpiraAntesDe }, { config }) {
        chamadas.push(clienteContaId);
        assert.ok(seExpiraAntesDe instanceof Date, "worker relê a expiração já com o lock");
        assert.strictEqual(config.transport, "gateway");
        if (clienteContaId === 101) throw Object.assign(new ShopeeGrantError("REFRESH_FALHOU", "x", 502), { detalhe: { code: "SHOPEE_UPSTREAM_4XX:error_auth", shopeeRequestId: "rq" } });
        if (clienteContaId === 102) throw new ShopeeGrantError("REFRESH_EM_ANDAMENTO", "x", 409);
        if (clienteContaId === 103) return { pulado: true };
        return { clienteContaId, shopId: 9004, accessTokenExpiresAt: new Date().toISOString() };
      },
    };
    const w = createShopeeRefreshWorker({ env: { ...ENV_LIVE, SHOPEE_LIVE_REFRESH_WORKER_ENABLED: "true" }, grants, logger });
    const [r1, r2] = await Promise.all([w.ciclo(), w.ciclo()]);
    assert.strictEqual(r1, r2, "ciclos concorrentes no processo compartilham a mesma execução");
    assert.deepStrictEqual(chamadas, [101, 102, 103, 104], "falha da loja 101 não impede as demais; um por vez");
    assert.deepStrictEqual(r1, { candidatos: 4, renovados: 1, pulados: 2, falhas: 1 });
    semSegredo(logs.join("\n"), "logs do worker");

    const semConfig = createShopeeRefreshWorker({ env: { SHOPEE_LIVE_REFRESH_WORKER_ENABLED: "true" }, grants: { ...grants, async listarGrantsParaRefresh() { throw new Error("não deveria listar"); } }, logger });
    assert.deepStrictEqual(await semConfig.ciclo(), { candidatos: 0, renovados: 0, pulados: 0, falhas: 0 }, "sem LIVE/gateway configurado o worker não faz nada");
    const desligado = createShopeeRefreshWorker({ env: ENV_LIVE, grants, logger });
    assert.strictEqual(desligado.iniciar(), false, "sem a flag não agenda nada");
    console.log("  ✓ worker: opt-in, mínimo 1 min, um grant por vez, falha isolada, sem LIVE configurado não faz nada");
  }

  console.log("\n✓ shopeeLiveRefresh: todos os testes passaram");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
