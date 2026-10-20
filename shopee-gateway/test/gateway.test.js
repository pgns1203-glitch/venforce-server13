"use strict";
// Testes do gateway contra servidores HTTP locais. Nenhuma chamada real à
// Shopee nem a serviço de IP: upstream e "ipify" são servidores em 127.0.0.1.
const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const crypto = require("node:crypto");
const { createGateway } = require("../src/server");
const { loadConfig } = require("../src/config");
const { sign, sha256Hex, canonicalString, createNonceCache } = require("../src/auth");
const { buildRequestOptions, lookupIPv4, buildForwardTarget } = require("../src/forwarder");

const SECRET = "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const ALLOWED = "/api/test/allowed";

// ── upstream fake ─────────────────────────────────────────────────────────
let upstreamSeen = [];
let upstreamHandler = (req, res) => res.end("{}");
const upstream = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    upstreamSeen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    upstreamHandler(req, res);
  });
});

let gateway;
let gatewayUrl;
let logs = [];

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function makeConfig(upPort, extra = {}) {
  return loadConfig({
    GATEWAY_SHARED_SECRET: SECRET,
    SHOPEE_API_ORIGIN: `http://127.0.0.1:${upPort}`,
    SHOPEE_ALLOWED_PATHS: `${ALLOWED},/api/test/other`,
    IP_PROBE_URL: `http://127.0.0.1:${upPort}/ip`,
    UPSTREAM_TIMEOUT_MS: "300",
    MAX_BODY_BYTES: "1024",
    MAX_RESPONSE_BYTES: "2048",
    MAX_QUERY_LENGTH: "200",
    ...extra,
  });
}

function signedHeaders({ method, path, body = "", secret = SECRET, ts, nonce }) {
  const timestamp = String(ts ?? Math.floor(Date.now() / 1000));
  const n = nonce ?? crypto.randomBytes(24).toString("base64url");
  return {
    "x-vf-timestamp": timestamp,
    "x-vf-nonce": n,
    "x-vf-signature": sign(secret, { method, path, timestamp, nonce: n, body: Buffer.from(body) }),
  };
}

async function call(path, { method = "POST", body, headers = {}, sign: doSign = true, signOpts = {} } = {}) {
  const raw = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const h = { ...(raw ? { "content-type": "application/json" } : {}), ...headers };
  if (doSign) Object.assign(h, signedHeaders({ method, path, body: raw, ...signOpts }));
  const res = await fetch(gatewayUrl + path, { method, headers: h, body: raw || undefined, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

test.before(async () => {
  const upPort = await listen(upstream);
  gateway = createGateway(makeConfig(upPort), { log: (e) => logs.push(e) });
  gatewayUrl = `http://127.0.0.1:${await listen(gateway)}`;
});
test.after(() => {
  gateway.close();
  upstream.close();
});
test.beforeEach(() => {
  upstreamSeen = [];
  logs = [];
  upstreamHandler = (req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: "upstream" }));
  };
});

function assertNoLeak(text) {
  assert.ok(!text.includes(SECRET), "segredo não pode aparecer");
  assert.ok(!/at .+\.js:\d+/.test(text), "stack trace não pode aparecer");
}

// 1
test("health responde {ok:true} sem auth e sem detalhes", async () => {
  const r = await call("/health", { method: "GET", sign: false });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json, { ok: true });
});

// 2
test("request autenticado corretamente é encaminhado", async () => {
  const r = await call("/forward", { body: { method: "POST", path: ALLOWED, query: { a: "1", n: 2 }, body: { x: 1 } } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.ok, true);
  assert.strictEqual(r.json.upstream.status, 200);
  assert.deepStrictEqual(JSON.parse(r.json.upstream.body), { ok: "upstream" });
  assert.strictEqual(upstreamSeen.length, 1);
  assert.strictEqual(upstreamSeen[0].url, `${ALLOWED}?a=1&n=2`);
  assert.strictEqual(upstreamSeen[0].body, JSON.stringify({ x: 1 }));
});

test("GET encaminhado sem corpo", async () => {
  const r = await call("/forward", { body: { method: "GET", path: ALLOWED } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(upstreamSeen[0].method, "GET");
  assert.strictEqual(upstreamSeen[0].body, "");
});

// 3
test("assinatura ausente → 401 AUTH_MISSING", async () => {
  const r = await call("/forward", { body: { method: "GET", path: ALLOWED }, sign: false });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.json.error.code, "AUTH_MISSING");
  assert.strictEqual(upstreamSeen.length, 0);
});

// 4
test("assinatura inválida → 401 AUTH_INVALID", async () => {
  const wrong = await call("/forward", { body: { method: "GET", path: ALLOWED }, signOpts: { secret: "outro-segredo-qualquer-0123456789abcdef" } });
  assert.strictEqual(wrong.status, 401);
  assert.strictEqual(wrong.json.error.code, "AUTH_INVALID");

  // corpo adulterado depois de assinado
  const raw = JSON.stringify({ method: "GET", path: ALLOWED });
  const h = signedHeaders({ method: "POST", path: "/forward", body: raw });
  const res = await fetch(`${gatewayUrl}/forward`, { method: "POST", headers: h, body: raw.replace(ALLOWED, "/api/test/other") });
  assert.strictEqual(res.status, 401);

  // assinatura de outra rota não vale aqui
  const h2 = signedHeaders({ method: "GET", path: "/probe/ip", body: raw });
  const res2 = await fetch(`${gatewayUrl}/forward`, { method: "POST", headers: h2, body: raw });
  assert.strictEqual(res2.status, 401);

  // formato de assinatura inválido
  const r3 = await call("/forward", { body: { method: "GET", path: ALLOWED }, sign: false, headers: { "x-vf-timestamp": "1", "x-vf-nonce": "abcdefghijklmnop", "x-vf-signature": "zz" } });
  assert.strictEqual(r3.json.error.code, "AUTH_INVALID");
  assert.strictEqual(upstreamSeen.length, 0);
});

// 5
test("timestamp antigo → 401 TIMESTAMP_EXPIRED", async () => {
  const r = await call("/forward", { body: { method: "GET", path: ALLOWED }, signOpts: { ts: Math.floor(Date.now() / 1000) - 120 } });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.json.error.code, "TIMESTAMP_EXPIRED");
});

// 6
test("timestamp futuro fora da tolerância → 401 TIMESTAMP_EXPIRED", async () => {
  const r = await call("/forward", { body: { method: "GET", path: ALLOWED }, signOpts: { ts: Math.floor(Date.now() / 1000) + 120 } });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.json.error.code, "TIMESTAMP_EXPIRED");
});

// 7
test("nonce repetido → 401 NONCE_REPLAY (mesma requisição reenviada)", async () => {
  const raw = JSON.stringify({ method: "GET", path: ALLOWED });
  const h = { "content-type": "application/json", ...signedHeaders({ method: "POST", path: "/forward", body: raw }) };
  const first = await fetch(`${gatewayUrl}/forward`, { method: "POST", headers: h, body: raw });
  assert.strictEqual(first.status, 200);
  const replay = await fetch(`${gatewayUrl}/forward`, { method: "POST", headers: h, body: raw });
  assert.strictEqual(replay.status, 401);
  assert.strictEqual((await replay.json()).error.code, "NONCE_REPLAY");
  assert.strictEqual(upstreamSeen.length, 1);
});

test("nonce cache: TTL expira e cheia falha fechada", () => {
  let t = 0;
  const cache = createNonceCache({ ttlMs: 1000, maxEntries: 2, now: () => t });
  cache.add("a");
  cache.add("b");
  assert.ok(cache.has("a"));
  assert.throws(() => cache.add("c"), (e) => e.code === "NONCE_CACHE_FULL");
  t = 1001;
  assert.ok(!cache.has("a"));
  cache.add("c");
  assert.strictEqual(cache.size, 1);
});

// 8
test("método proibido → 405", async () => {
  for (const method of ["DELETE", "PUT", "PATCH", "TRACE", "CONNECT", "get-ish", 123]) {
    const r = await call("/forward", { body: { method, path: ALLOWED } });
    assert.strictEqual(r.status, 405, String(method));
    assert.strictEqual(r.json.error.code, "METHOD_NOT_ALLOWED");
  }
  const wrongRoute = await call("/forward", { method: "GET", sign: false });
  assert.strictEqual(wrongRoute.status, 405);
  assert.strictEqual(upstreamSeen.length, 0);
});

// 9
test("path fora da allowlist → 403", async () => {
  for (const path of ["/api/test/not-listed", "/api/test/allowed/extra", "/api/test", "/"]) {
    const r = await call("/forward", { body: { method: "GET", path } });
    assert.strictEqual(r.status, 403, path);
    assert.strictEqual(r.json.error.code, "PATH_NOT_ALLOWED");
  }
  assert.strictEqual(upstreamSeen.length, 0);
});

// 10 · 11 · 12
test("URL absoluta, //host, traversal e afins → bloqueados", async () => {
  const ataques = [
    "https://evil.example.com/api/test/allowed",
    "http://127.0.0.1:1/api/test/allowed",
    "//evil.example.com/api/test/allowed",
    "///evil.example.com",
    "/api/test/../test/allowed",
    "/api/test/%2e%2e/allowed",
    "/api/test/allowed/..",
    "/api/test\\allowed",
    "/api/test/allowed?x=1",
    "/api/test/allowed#x",
    "/api/test/allowed/",
    "api/test/allowed",
    "/api/test/allowed@evil.example.com",
    "/api/test/allowed\r\nHost: evil",
    "javascript:alert(1)",
    "",
    null,
    { toString: "x" },
  ];
  for (const path of ataques) {
    const r = await call("/forward", { body: { method: "GET", path } });
    assert.strictEqual(r.status, 403, JSON.stringify(path));
  }
  // o envelope não aceita "url"/"host"/"origin": o upstream vem só da config
  for (const extra of [{ url: "https://evil.example.com" }, { host: "evil.example.com" }, { origin: "https://evil.example.com" }]) {
    const r = await call("/forward", { body: { method: "GET", path: ALLOWED, ...extra } });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.error.code, "INVALID_FORMAT");
  }
  assert.strictEqual(upstreamSeen.length, 0);
});

test("URL composta nunca sai da origem configurada", () => {
  const cfg = makeConfig(9);
  const t = buildForwardTarget({ method: "GET", path: ALLOWED, query: { "a.b": "x y&z=1" } }, cfg);
  const u = new URL(t.url);
  assert.strictEqual(u.origin, "http://127.0.0.1:9");
  assert.strictEqual(u.pathname, ALLOWED);
  assert.strictEqual(u.searchParams.get("a.b"), "x y&z=1");
  assert.strictEqual([...u.searchParams.keys()].length, 1);
});

test("config recusa paths inválidos e origem com path; produção exige https", () => {
  const base = { GATEWAY_SHARED_SECRET: SECRET };
  assert.throws(() => loadConfig({ ...base, SHOPEE_ALLOWED_PATHS: "/ok,/../x" }));
  assert.throws(() => loadConfig({ ...base, SHOPEE_ALLOWED_PATHS: "//evil" }));
  assert.throws(() => loadConfig({ ...base, SHOPEE_API_ORIGIN: "https://x.example.com/api" }));
  assert.throws(() => loadConfig({ ...base, SHOPEE_API_ORIGIN: "https://u:p@x.example.com" }));
  assert.throws(() => loadConfig({ ...base, NODE_ENV: "production", SHOPEE_API_ORIGIN: "http://x.example.com" }));
  assert.throws(() => loadConfig({ GATEWAY_SHARED_SECRET: "Zq9shortvalue" }), (e) => !e.message.includes("Zq9shortvalue"));
  assert.strictEqual(loadConfig({ ...base, NODE_ENV: "production", SHOPEE_API_ORIGIN: "https://x.example.com" }).shopeeOrigin, "https://x.example.com");
  assert.strictEqual(loadConfig(base).host, "127.0.0.1");
});

test("query inválida ou grande → 400 QUERY_INVALID", async () => {
  for (const query of [[1, 2], { "a b": "1" }, { a: { b: 1 } }, { a: ["x"] }, { a: "x".repeat(300) }]) {
    const r = await call("/forward", { body: { method: "GET", path: ALLOWED, query } });
    assert.strictEqual(r.status, 400, JSON.stringify(query).slice(0, 40));
    assert.strictEqual(r.json.error.code, "QUERY_INVALID");
  }
});

test("corpo que não é JSON → 400 INVALID_FORMAT; GET com body → 400", async () => {
  const r = await call("/forward", { body: "nao-e-json" });
  assert.strictEqual(r.json.error.code, "INVALID_FORMAT");
  const r2 = await call("/forward", { body: { method: "GET", path: ALLOWED, body: { x: 1 } } });
  assert.strictEqual(r2.json.error.code, "INVALID_FORMAT");
});

// 13
test("redirect upstream não é seguido", async () => {
  let visited = false;
  upstreamHandler = (req, res) => {
    if (req.url.startsWith("/api/test/other")) visited = true;
    res.writeHead(302, { location: "/api/test/other" });
    res.end();
  };
  const r = await call("/forward", { body: { method: "GET", path: ALLOWED } });
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.json.error.code, "UPSTREAM_REDIRECT");
  assert.strictEqual(upstreamSeen.length, 1);
  assert.ok(!visited);
  assert.ok(!r.text.includes("location") && !r.text.includes("/api/test/other"));
});

// 14
test("timeout gera UPSTREAM_TIMEOUT (504)", async () => {
  upstreamHandler = () => {}; // nunca responde
  const started = Date.now();
  const r = await call("/forward", { body: { method: "GET", path: ALLOWED } });
  assert.strictEqual(r.status, 504);
  assert.strictEqual(r.json.error.code, "UPSTREAM_TIMEOUT");
  assert.ok(Date.now() - started < 3000);
});

test("falha de rede/DNS → UPSTREAM_NETWORK (502)", async () => {
  const dead = http.createServer();
  const port = await listen(dead);
  await new Promise((r) => dead.close(r));
  const gw = createGateway(makeConfig(port), { log: () => {} });
  const url = `http://127.0.0.1:${await listen(gw)}`;
  const raw = JSON.stringify({ method: "GET", path: ALLOWED });
  const res = await fetch(`${url}/forward`, { method: "POST", headers: signedHeaders({ method: "POST", path: "/forward", body: raw }), body: raw });
  gw.close();
  assert.strictEqual(res.status, 502);
  assert.strictEqual((await res.json()).error.code, "UPSTREAM_NETWORK");
});

// 15
test("request body grande → 413 BODY_TOO_LARGE", async () => {
  const big = JSON.stringify({ method: "POST", path: ALLOWED, body: { x: "y".repeat(3000) } });
  const r = await call("/forward", { body: big });
  assert.strictEqual(r.status, 413);
  assert.strictEqual(r.json.error.code, "BODY_TOO_LARGE");
  assert.strictEqual(upstreamSeen.length, 0);
});

// 16
test("resposta upstream excessiva → UPSTREAM_RESPONSE_TOO_LARGE", async () => {
  upstreamHandler = (req, res) => res.end("z".repeat(5000)); // com content-length
  const r = await call("/forward", { body: { method: "GET", path: ALLOWED } });
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.json.error.code, "UPSTREAM_RESPONSE_TOO_LARGE");

  upstreamHandler = (req, res) => {
    res.write("z".repeat(1500)); // chunked, sem content-length
    res.end("z".repeat(1500));
  };
  const r2 = await call("/forward", { body: { method: "GET", path: ALLOWED } });
  assert.strictEqual(r2.json.error.code, "UPSTREAM_RESPONSE_TOO_LARGE");
});

// 17
test("segredo e stack nunca aparecem em respostas de erro nem em logs", async () => {
  upstreamHandler = (req, res) => {
    throw new Error("boom");
  };
  const results = [
    await call("/forward", { body: { method: "GET", path: ALLOWED }, signOpts: { secret: "errado-errado-errado-errado-errado-1" } }),
    await call("/forward", { body: { method: "DELETE", path: ALLOWED } }),
    await call("/forward", { body: { method: "GET", path: "/x/../y" } }),
    await call("/forward", { body: "{" }),
  ];
  for (const r of results) assertNoLeak(r.text);
  const allLogs = JSON.stringify(logs);
  assertNoLeak(allLogs);
  assert.ok(!allLogs.includes("x-vf-signature") && !/"signature"/.test(allLogs));
});

// 18 · 19
test("headers do chamador não vão para o upstream (incl. segredo e assinatura)", async () => {
  const r = await call("/forward", {
    body: { method: "POST", path: ALLOWED, body: { a: 1 } },
    headers: {
      "x-evil": "1",
      "x-forwarded-for": "6.6.6.6",
      "x-forwarded-host": "evil.example.com",
      authorization: `Bearer ${SECRET}`,
      cookie: "s=1",
      "x-request-id": "corr-12345678",
    },
  });
  assert.strictEqual(r.status, 200);
  const seen = upstreamSeen[0].headers;
  for (const h of ["x-evil", "x-forwarded-for", "x-forwarded-host", "authorization", "cookie", "x-vf-timestamp", "x-vf-nonce", "x-vf-signature", "x-request-id"]) {
    assert.strictEqual(seen[h], undefined, h);
  }
  assert.strictEqual(seen.host, upstreamSeen[0].headers.host);
  assert.ok(seen.host.startsWith("127.0.0.1:"), "Host é o da origem configurada");
  assert.ok(!JSON.stringify(upstreamSeen[0]).includes(SECRET));
  assert.deepStrictEqual(Object.keys(seen).sort(), ["accept", "connection", "content-length", "content-type", "host", "user-agent"]);
  assert.strictEqual(r.json.request_id, "corr-12345678");
});

test("envelope não aceita campo headers", async () => {
  const r = await call("/forward", { body: { method: "GET", path: ALLOWED, headers: { host: "evil" } } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(upstreamSeen.length, 0);
});

// 20
test("upstream 4xx → 502 UPSTREAM_4XX com status e corpo da Shopee para o Render", async () => {
  upstreamHandler = (req, res) => {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "error_auth" }));
  };
  const r = await call("/forward", { body: { method: "GET", path: ALLOWED } });
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.json.error.code, "UPSTREAM_4XX");
  assert.strictEqual(r.json.upstream.status, 403);
  assert.deepStrictEqual(JSON.parse(r.json.upstream.body), { error: "error_auth" });
  const log = logs.find((l) => l.route === "/forward");
  assert.strictEqual(log.upstream_status, 403);
  assert.ok(!JSON.stringify(logs).includes("error_auth"), "corpo upstream não entra no log");
});

// 21
test("upstream 5xx → 502 UPSTREAM_5XX", async () => {
  upstreamHandler = (req, res) => {
    res.writeHead(503);
    res.end("indisponivel");
  };
  const r = await call("/forward", { body: { method: "GET", path: ALLOWED } });
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.json.error.code, "UPSTREAM_5XX");
  assert.strictEqual(r.json.upstream.status, 503);
});

test("SHOPEE_API_ORIGIN ausente → 503 CONFIG_MISSING sem chamar nada", async () => {
  const cfg = loadConfig({ GATEWAY_SHARED_SECRET: SECRET, SHOPEE_ALLOWED_PATHS: ALLOWED });
  const gw = createGateway(cfg, { log: () => {} });
  const url = `http://127.0.0.1:${await listen(gw)}`;
  const raw = JSON.stringify({ method: "GET", path: ALLOWED });
  const res = await fetch(`${url}/forward`, { method: "POST", headers: signedHeaders({ method: "POST", path: "/forward", body: raw }), body: raw });
  gw.close();
  assert.strictEqual(res.status, 503);
  assert.strictEqual((await res.json()).error.code, "CONFIG_MISSING");
});

// /probe/ip
test("/probe/ip exige HMAC", async () => {
  const r = await call("/probe/ip", { method: "GET", sign: false });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(upstreamSeen.length, 0);
});

test("/probe/ip devolve o IPv4 observado (texto ou JSON)", async () => {
  upstreamHandler = (req, res) => res.end("203.0.113.7\n");
  let r = await call("/probe/ip", { method: "GET" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.ipv4, "203.0.113.7");
  assert.strictEqual(upstreamSeen[0].url, "/ip");

  upstreamHandler = (req, res) => res.end(JSON.stringify({ ip: "198.51.100.4" }));
  r = await call("/probe/ip", { method: "GET" });
  assert.strictEqual(r.json.ipv4, "198.51.100.4");
});

test("/probe/ip com resposta não-IPv4, erro ou timeout → erro controlado e gateway segue vivo", async () => {
  upstreamHandler = (req, res) => res.end("2001:db8::1");
  let r = await call("/probe/ip", { method: "GET" });
  assert.strictEqual(r.json.error.code, "UPSTREAM_INVALID_RESPONSE");

  upstreamHandler = (req, res) => {
    res.writeHead(500);
    res.end();
  };
  r = await call("/probe/ip", { method: "GET" });
  assert.strictEqual(r.json.error.code, "UPSTREAM_INVALID_RESPONSE");

  upstreamHandler = () => {};
  r = await call("/probe/ip", { method: "GET" });
  assert.strictEqual(r.json.error.code, "UPSTREAM_TIMEOUT");

  const h = await call("/health", { method: "GET", sign: false });
  assert.strictEqual(h.status, 200);
});

// IPv4
test("saída força IPv4: family 4, lookup só A record, sem autoSelectFamily", async () => {
  const opts = buildRequestOptions(new URL("https://example.invalid/x?y=1"), { method: "GET", headers: {}, signal: null });
  assert.strictEqual(opts.family, 4);
  assert.strictEqual(opts.autoSelectFamily, false);
  assert.strictEqual(opts.lookup, lookupIPv4);
  assert.strictEqual(opts.path, "/x?y=1");
  const address = await new Promise((resolve, reject) => lookupIPv4("localhost", {}, (err, addr, family) => (err ? reject(err) : resolve({ addr, family }))));
  assert.strictEqual(address.family, 4);
  assert.ok(/^\d+\.\d+\.\d+\.\d+$/.test(address.addr));
  const all = await new Promise((resolve, reject) => lookupIPv4("localhost", { all: true }, (err, list) => (err ? reject(err) : resolve(list))));
  assert.ok(all.every((a) => a.family === 4));
});

test("rotas desconhecidas → 404 sem logar a URL", async () => {
  const r = await call("/forward/../etc/passwd?token=abc", { method: "GET", sign: false });
  assert.strictEqual(r.status, 404);
  assert.ok(!JSON.stringify(logs).includes("token=abc"));
});

test("canonical string documentada", () => {
  const c = canonicalString({ method: "post", path: "/forward", timestamp: 1700000000, nonce: "n".repeat(16), body: Buffer.from("{}") });
  assert.strictEqual(c, `POST\n/forward\n1700000000\n${"n".repeat(16)}\n${sha256Hex(Buffer.from("{}"))}`);
  assert.strictEqual(sha256Hex(Buffer.alloc(0)), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});
