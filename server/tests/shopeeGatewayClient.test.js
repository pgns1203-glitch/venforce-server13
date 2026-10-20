// Client Render → gateway Shopee (IPv4 fixo). Nenhum request externo real:
// fetch injetado nos testes unitários e, no teste de contrato, o gateway real
// (shopee-gateway/) sobe em 127.0.0.1 com um upstream fake local.
const assert = require("assert");
const crypto = require("crypto");
const http = require("http");
const { readConfig } = require("../services/shopee/shopeeGatewayConfig");
const { createShopeeGatewayClient, signRequest, canonicalString, sha256Hex } = require("../services/shopee/shopeeGatewayClient");
const { ShopeeGatewayError, CODES } = require("../services/shopee/shopeeGatewayError");

const SECRET = "render-gw-secret-0123456789-abcdefghijklmnop";
const cfgOk = readConfig({ SHOPEE_GATEWAY_URL: "https://gw.example.com/", SHOPEE_GATEWAY_SECRET: SECRET, SHOPEE_GATEWAY_TIMEOUT_MS: "200" });

function res(status, body, { json = true } = {}) {
  const text = body === undefined ? "" : json ? JSON.stringify(body) : String(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}
async function rejectsCode(promise, code, label) {
  try {
    await promise;
  } catch (e) {
    assert.ok(e instanceof ShopeeGatewayError, `${label}: deve ser ShopeeGatewayError`);
    assert.strictEqual(e.code, code, `${label}: code`);
    assert.ok(!JSON.stringify(e).includes(SECRET) && !String(e.message).includes(SECRET), `${label}: não vaza segredo`);
    console.log(`  ✓ ${label}`);
    return e;
  }
  assert.fail(`${label}: deveria rejeitar`);
}

(async () => {
  // ── config ──
  assert.strictEqual(readConfig({}).configured, false);
  assert.strictEqual(readConfig({ SHOPEE_GATEWAY_URL: "https://gw.example.com" }).configured, false);
  assert.strictEqual(readConfig({ SHOPEE_GATEWAY_URL: "https://gw.example.com", SHOPEE_GATEWAY_SECRET: "curto" }).configured, false, "segredo < 32 não vale");
  assert.strictEqual(readConfig({ SHOPEE_GATEWAY_URL: "http://gw.local", SHOPEE_GATEWAY_SECRET: SECRET, NODE_ENV: "production" }).configured, false, "produção exige https");
  assert.strictEqual(readConfig({ SHOPEE_GATEWAY_URL: "http://gw.local", SHOPEE_GATEWAY_SECRET: SECRET }).configured, true, "dev aceita http");
  assert.strictEqual(readConfig({ SHOPEE_GATEWAY_URL: "https://u:p@gw.example.com", SHOPEE_GATEWAY_SECRET: SECRET }).configured, false, "sem credencial na URL");
  assert.strictEqual(cfgOk.baseUrl, "https://gw.example.com");
  assert.strictEqual(cfgOk.timeoutMs, 200);
  console.log("  ✓ config: configured só com URL válida + segredo forte; produção exige https");

  // ── canonicalização / SHA256 / HMAC ──
  {
    assert.strictEqual(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert.strictEqual(sha256Hex('{"a":1}'), crypto.createHash("sha256").update('{"a":1}').digest("hex"));
    const c = canonicalString({ method: "post", path: "/forward", timestamp: 1700000000, nonce: "N".repeat(43), body: '{"a":1}' });
    assert.strictEqual(c, `POST\n/forward\n1700000000\n${"N".repeat(43)}\n${sha256Hex('{"a":1}')}`);
    const h = signRequest({ secret: SECRET, method: "POST", path: "/forward", body: '{"a":1}', now: () => 1700000000999, nonce: "N".repeat(43) });
    assert.strictEqual(h["X-VF-Timestamp"], "1700000000", "timestamp em segundos (floor)");
    assert.strictEqual(h["X-VF-Nonce"], "N".repeat(43));
    assert.strictEqual(h["X-VF-Signature"], crypto.createHmac("sha256", SECRET).update(c).digest("hex"));
    assert.ok(/^[0-9a-f]{64}$/.test(h["X-VF-Signature"]));
    console.log("  ✓ canonical string, SHA256 do corpo e HMAC conferem com o contrato");
  }

  // ── nonce ──
  {
    const nonces = new Set();
    for (let i = 0; i < 200; i += 1) {
      const n = signRequest({ secret: SECRET, method: "GET", path: "/probe/ip" })["X-VF-Nonce"];
      assert.ok(/^[A-Za-z0-9_-]{43}$/.test(n), "32 bytes em base64url");
      nonces.add(n);
    }
    assert.strictEqual(nonces.size, 200, "nonce nunca se repete");
    console.log("  ✓ nonce: 32 bytes aleatórios, único por requisição");
  }

  // ── sem config: nenhum fetch ──
  {
    let chamadas = 0;
    const c = createShopeeGatewayClient({ config: readConfig({}), fetchImpl: async () => { chamadas += 1; return res(200, {}); } });
    await rejectsCode(c.probeIp(), CODES.NAO_CONFIGURADO, "sem config: probeIp rejeita");
    await rejectsCode(c.forward({ method: "GET", path: "/x" }), CODES.NAO_CONFIGURADO, "sem config: forward rejeita");
    assert.strictEqual(chamadas, 0);
  }

  // ── request correto ──
  {
    let seen;
    const c = createShopeeGatewayClient({
      config: cfgOk,
      now: () => 1700000000000,
      fetchImpl: async (url, init) => { seen = { url, init }; return res(200, { ok: true, request_id: "x", upstream: { status: 200, content_type: "application/json", body: '{"r":1}' } }); },
    });
    const out = await c.forward({ method: "post", path: "/api/x", query: { a: 1 }, body: { b: 2 } });
    assert.deepStrictEqual({ status: out.status, contentType: out.contentType, body: out.body }, { status: 200, contentType: "application/json", body: '{"r":1}' });
    assert.strictEqual(seen.url, "https://gw.example.com/forward");
    assert.strictEqual(seen.init.method, "POST");
    assert.strictEqual(seen.init.redirect, "error");
    assert.ok(seen.init.signal, "sempre com AbortSignal");
    assert.strictEqual(seen.init.body, JSON.stringify({ method: "POST", path: "/api/x", query: { a: 1 }, body: { b: 2 } }));
    assert.strictEqual(seen.init.headers["Content-Type"], "application/json");
    assert.strictEqual(seen.init.headers["X-VF-Timestamp"], "1700000000");
    const expected = crypto.createHmac("sha256", SECRET)
      .update(canonicalString({ method: "POST", path: "/forward", timestamp: "1700000000", nonce: seen.init.headers["X-VF-Nonce"], body: seen.init.body }))
      .digest("hex");
    assert.strictEqual(seen.init.headers["X-VF-Signature"], expected);
    assert.ok(!JSON.stringify(seen.init.headers).includes(SECRET), "segredo nunca vai em header");
    assert.ok(!seen.url.includes(SECRET), "segredo nunca vai na URL");
    assert.ok(/^[0-9a-f-]{36}$/.test(seen.init.headers["X-Request-Id"]));
    console.log("  ✓ forward: URL do gateway, HMAC sobre o corpo exato, redirect:'error', sem segredo no fio");

    await c.forward({ method: "GET", path: "/api/x", body: { ignorado: true } });
    assert.ok(!seen.init.body.includes("ignorado"), "GET não leva body");
    const probe = createShopeeGatewayClient({ config: cfgOk, fetchImpl: async (url, init) => { seen = { url, init }; return res(200, { ok: true, ipv4: "203.0.113.9" }); } });
    assert.strictEqual((await probe.probeIp()).ipv4, "203.0.113.9");
    assert.strictEqual(seen.url, "https://gw.example.com/probe/ip");
    assert.strictEqual(seen.init.method, "GET");
    assert.strictEqual(seen.init.body, undefined);
    console.log("  ✓ probeIp: GET assinado sem corpo");
  }

  // ── envelope inválido não sai do Render ──
  {
    let chamadas = 0;
    const c = createShopeeGatewayClient({ config: cfgOk, fetchImpl: async () => { chamadas += 1; return res(200, {}); } });
    await rejectsCode(c.forward({ method: "DELETE", path: "/x" }), CODES.ENVELOPE_INVALIDO, "método fora de GET/POST");
    await rejectsCode(c.forward({ method: "GET", path: "https://evil.example.com/x" }), CODES.ENVELOPE_INVALIDO, "URL absoluta");
    await rejectsCode(c.forward({ method: "GET", path: "//evil.example.com" }), CODES.ENVELOPE_INVALIDO, "//host");
    assert.strictEqual(chamadas, 0);
  }

  // ── erro do gateway ──
  {
    const c = createShopeeGatewayClient({ config: cfgOk, fetchImpl: async () => res(401, { ok: false, request_id: "r", error: { code: "AUTH_INVALID", message: "x" } }) });
    const e = await rejectsCode(c.probeIp(), "AUTH_INVALID", "gateway 401 → code do gateway");
    assert.strictEqual(e.status, 401);

    const c2 = createShopeeGatewayClient({
      config: cfgOk,
      fetchImpl: async () => res(502, { ok: false, error: { code: "UPSTREAM_4XX" }, upstream: { status: 403, body: '{"error":"error_auth","access_token":"tok_X"}' } }),
    });
    const e2 = await rejectsCode(c2.forward({ method: "GET", path: "/api/x" }), "UPSTREAM_4XX", "upstream 4xx → UPSTREAM_4XX");
    assert.strictEqual(e2.upstreamStatus, 403);
    assert.strictEqual(JSON.parse(e2.upstreamBody).error, "error_auth", "corpo Shopee disponível para quem trata o erro");
    assert.ok(!JSON.stringify(e2).includes("tok_X"), "corpo Shopee não serializa (não vai para log)");
    assert.ok(!Object.keys(e2).includes("upstreamBody"));

    const c3 = createShopeeGatewayClient({ config: cfgOk, fetchImpl: async () => res(502, "<html>bad gateway</html>", { json: false }) });
    await rejectsCode(c3.probeIp(), CODES.RESPOSTA_INVALIDA, "resposta não JSON (ex.: proxy na frente)");

    const c4 = createShopeeGatewayClient({ config: cfgOk, fetchImpl: async () => res(500, { ok: false, error: { code: "<script>" } }) });
    await rejectsCode(c4.probeIp(), CODES.RESPOSTA_INVALIDA, "code malformado do gateway não é propagado");

    const c5 = createShopeeGatewayClient({ config: cfgOk, fetchImpl: async () => res(301, "") });
    await rejectsCode(c5.probeIp(), CODES.REDIRECT_BLOQUEADO, "3xx sem lançar também é bloqueado");

    const c6 = createShopeeGatewayClient({ config: cfgOk, fetchImpl: async () => { throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") }); } });
    await rejectsCode(c6.probeIp(), CODES.REDIRECT_BLOQUEADO, "redirect:'error' do fetch → REDIRECT_BLOQUEADO");

    const c7 = createShopeeGatewayClient({ config: cfgOk, fetchImpl: async () => { throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") }); } });
    await rejectsCode(c7.probeIp(), CODES.REDE, "falha de rede → ERRO_REDE");

    const c8 = createShopeeGatewayClient({ config: cfgOk, fetchImpl: async () => res(200, { ok: true, ipv4: "2001:db8::1" }) });
    await rejectsCode(c8.probeIp(), CODES.RESPOSTA_INVALIDA, "probeIp exige IPv4");
  }

  // ── timeout ──
  {
    const c = createShopeeGatewayClient({
      config: cfgOk,
      fetchImpl: (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
    });
    const started = Date.now();
    await rejectsCode(c.probeIp(), CODES.TIMEOUT, "timeout → SHOPEE_GATEWAY_TIMEOUT");
    assert.ok(Date.now() - started < 2000);
  }

  // ── contrato real: client do Render ↔ gateway de shopee-gateway/ ──
  {
    const { createGateway } = require("../../shopee-gateway/src/server");
    const { loadConfig } = require("../../shopee-gateway/src/config");
    const seen = [];
    const upstream = http.createServer((req, r) => {
      seen.push({ url: req.url, headers: req.headers });
      if (req.url === "/ip") return r.end("198.51.100.23");
      r.setHeader("content-type", "application/json");
      r.end(JSON.stringify({ response: "ok" }));
    });
    await new Promise((ok) => upstream.listen(0, "127.0.0.1", ok));
    const up = `http://127.0.0.1:${upstream.address().port}`;
    const gw = createGateway(loadConfig({ GATEWAY_SHARED_SECRET: SECRET, SHOPEE_API_ORIGIN: up, SHOPEE_ALLOWED_PATHS: "/api/contrato", IP_PROBE_URL: `${up}/ip` }), { log: () => {} });
    await new Promise((ok) => gw.listen(0, "127.0.0.1", ok));
    const client = createShopeeGatewayClient({ config: readConfig({ SHOPEE_GATEWAY_URL: `http://127.0.0.1:${gw.address().port}`, SHOPEE_GATEWAY_SECRET: SECRET }) });
    try {
      assert.strictEqual((await client.probeIp()).ipv4, "198.51.100.23");
      const out = await client.forward({ method: "POST", path: "/api/contrato", query: { sign: "abc" }, body: { x: 1 } });
      assert.strictEqual(out.status, 200);
      assert.deepStrictEqual(JSON.parse(out.body), { response: "ok" });
      assert.strictEqual(seen[1].url, "/api/contrato?sign=abc");
      assert.strictEqual(seen[1].headers["x-vf-signature"], undefined);
      await rejectsCode(client.forward({ method: "GET", path: "/api/fora" }), "PATH_NOT_ALLOWED", "contrato: allowlist aplicada pelo gateway");
      const wrong = createShopeeGatewayClient({ config: readConfig({ SHOPEE_GATEWAY_URL: `http://127.0.0.1:${gw.address().port}`, SHOPEE_GATEWAY_SECRET: `${SECRET}-outro` }) });
      await rejectsCode(wrong.probeIp(), "AUTH_INVALID", "contrato: segredo diferente → AUTH_INVALID");
      console.log("  ✓ contrato: client do Render autentica no gateway real (probe + forward)");
    } finally {
      gw.close();
      upstream.close();
    }
  }

  console.log("✓ shopeeGatewayClient");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
