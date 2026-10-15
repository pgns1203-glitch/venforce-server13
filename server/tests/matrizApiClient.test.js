// Fundação da integração com a API da matriz: client HTTP, config, status e
// service pendente. Nenhum request externo real — fetch é sempre injetado.
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const { readConfig } = require("../services/matrizApi/matrizApiConfig");
const { createMatrizApiClient } = require("../services/matrizApi/matrizApiClient");
const { MatrizApiError, CODES } = require("../services/matrizApi/matrizApiError");
const { getMatrizStatus } = require("../services/matrizApi/matrizStatusService");
const shopeeMatriz = require("../services/matrizApi/shopeeMatrizService");

const TOKEN = "tok_SUPER_SECRETO_123";
const cfgOk = readConfig({ MATRIZ_API_BASE_URL: "https://matriz.example.com/api/", MATRIZ_API_TOKEN: TOKEN });

function res(status, body, { json = true, headers = {} } = {}) {
  const text = body === undefined ? "" : json ? JSON.stringify(body) : String(body);
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { ok: status >= 200 && status < 300, status, text: async () => text, headers: { get: (k) => (h[String(k).toLowerCase()] ?? null) } };
}
function clientWith(fetchImpl, config = cfgOk) {
  return createMatrizApiClient({ config, fetchImpl });
}
async function rejectsCode(promise, code, label) {
  try { await promise; } catch (e) {
    assert.ok(e instanceof MatrizApiError, `${label}: deve ser MatrizApiError`);
    assert.strictEqual(e.code, code, `${label}: code`);
    assert.ok(!String(e.message).includes(TOKEN), `${label}: mensagem não pode vazar token`);
    console.log(`  ✓ ${label}`);
    return e;
  }
  assert.fail(`${label}: deveria rejeitar`);
}

(async () => {
  // ── config ──
  assert.strictEqual(readConfig({}).configured, false);
  assert.strictEqual(readConfig({ MATRIZ_API_BASE_URL: "https://x.com" }).configured, false);
  assert.strictEqual(readConfig({ MATRIZ_API_TOKEN: "t" }).configured, false);
  assert.strictEqual(readConfig({ MATRIZ_API_BASE_URL: "nao-e-url", MATRIZ_API_TOKEN: "t" }).configured, false);
  assert.strictEqual(cfgOk.configured, true);
  assert.strictEqual(cfgOk.baseUrl, "https://matriz.example.com/api");
  console.log("  ✓ config: configured só com base URL válida + token");

  // ── config: https obrigatório em produção; http segue valendo em dev/test ──
  {
    const http = { MATRIZ_API_BASE_URL: "http://matriz.local/api", MATRIZ_API_TOKEN: TOKEN };
    const prod = readConfig({ ...http, NODE_ENV: "production" });
    assert.strictEqual(prod.configured, false, "produção + http → configured=false");
    assert.strictEqual(prod.baseUrlConfigured, false);
    assert.strictEqual(prod.baseUrl, "");
    assert.strictEqual(readConfig({ ...http, NODE_ENV: "Production" }).configured, false, "NODE_ENV case-insensitive");
    assert.strictEqual(readConfig({ ...http, NODE_ENV: "development" }).configured, true, "dev aceita http");
    assert.strictEqual(readConfig({ ...http, NODE_ENV: "test" }).configured, true, "test aceita http");
    assert.strictEqual(readConfig(http).configured, true, "sem NODE_ENV aceita http");
    assert.strictEqual(readConfig({ ...http, MATRIZ_API_BASE_URL: "https://matriz.example.com", NODE_ENV: "production" }).configured, true, "produção + https ok");
    const st = getMatrizStatus({ ...http, NODE_ENV: "production" });
    assert.strictEqual(st.configured, false);
    assert.strictEqual(st.baseUrlConfigured, false);
    console.log("  ✓ config: produção exige https; dev/test aceita http");
  }

  // ── status: sem ENV, com ENV, sem segredo ──
  {
    const vazio = getMatrizStatus({});
    assert.deepStrictEqual(vazio, {
      ok: true, configured: false, baseUrlConfigured: false, authenticationConfigured: false,
      shopee: { externalContract: "pending" },
    });
    const cheio = getMatrizStatus({ MATRIZ_API_BASE_URL: "https://matriz.example.com", MATRIZ_API_TOKEN: TOKEN });
    assert.strictEqual(cheio.configured, true);
    const serializado = JSON.stringify(cheio);
    assert.ok(!serializado.includes(TOKEN) && !serializado.includes("matriz.example.com"), "status não expõe token nem URL");
    console.log("  ✓ status: configured=false sem ENV; nunca expõe segredo/URL");
  }

  // ── sem configuração: nenhum request externo ──
  {
    let chamadas = 0;
    const c = clientWith(async () => { chamadas += 1; return res(200, {}); }, readConfig({}));
    await rejectsCode(c.get("/x"), CODES.NAO_CONFIGURADA, "sem config: GET rejeita");
    await rejectsCode(c.post("/x", {}), CODES.NAO_CONFIGURADA, "sem config: POST rejeita");
    assert.strictEqual(chamadas, 0, "nenhum fetch sem configuração");
    console.log("  ✓ sem config: nenhum request externo");
  }

  // ── GET ──
  {
    let seen;
    const c = clientWith(async (url, init) => { seen = { url, init }; return res(200, { lojas: [1] }); });
    const data = await c.get("/lojas", { query: { page: 2, vazio: "" } });
    assert.deepStrictEqual(data, { lojas: [1] });
    assert.strictEqual(seen.url, "https://matriz.example.com/api/lojas?page=2");
    assert.strictEqual(seen.init.method, "GET");
    assert.strictEqual(seen.init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.strictEqual(seen.init.body, undefined);
    assert.strictEqual(seen.init.redirect, "error", "fetch sempre com redirect:'error'");
    console.log("  ✓ GET: URL base+path+query, Bearer, sem body, redirect:'error'");
  }

  // ── POST ──
  {
    let seen;
    const c = clientWith(async (url, init) => { seen = { url, init }; return res(201, { id: "a" }); });
    const data = await c.post("/grants", { loja: "x" });
    assert.deepStrictEqual(data, { id: "a" });
    assert.strictEqual(seen.init.method, "POST");
    assert.strictEqual(seen.init.headers["Content-Type"], "application/json");
    assert.strictEqual(seen.init.body, JSON.stringify({ loja: "x" }));
    console.log("  ✓ POST: JSON no corpo e Content-Type");
  }

  // ── base URL não vem do chamador ──
  {
    let chamadas = 0;
    const c = clientWith(async () => { chamadas += 1; return res(200, {}); });
    await rejectsCode(c.get("https://evil.example.com/x"), CODES.ERRO_HTTP, "URL absoluta bloqueada");
    await rejectsCode(c.get("//evil.example.com/x"), CODES.ERRO_HTTP, "protocol-relative bloqueada");
    assert.strictEqual(chamadas, 0);
  }

  // ── status HTTP ──
  for (const [status, code] of [[401, CODES.NAO_AUTORIZADO], [403, CODES.PROIBIDO], [404, CODES.NAO_ENCONTRADO], [429, CODES.RATE_LIMIT], [500, CODES.ERRO_SERVIDOR], [503, CODES.ERRO_SERVIDOR], [422, CODES.ERRO_HTTP]]) {
    const c = clientWith(async () => res(status, { erro: "x" }));
    const e = await rejectsCode(c.get("/x"), code, `HTTP ${status} → ${code}`);
    assert.strictEqual(e.status, status);
  }

  // ── erro com corpo não JSON: não vaza o corpo ──
  {
    const c = clientWith(async () => res(502, `<html>${TOKEN}</html>`, { json: false }));
    const e = await rejectsCode(c.get("/x"), CODES.ERRO_SERVIDOR, "5xx com corpo HTML");
    assert.strictEqual(e.details, undefined, "erro não carrega corpo da resposta");
    assert.ok(!JSON.stringify(e).includes(TOKEN) && !String(e.stack).includes(TOKEN));
  }

  // ── erro com corpo JSON: corpo também não sobe (pode ecoar segredo) ──
  {
    const c = clientWith(async () => res(401, { erro: `token ${TOKEN} inválido` }));
    const e = await rejectsCode(c.get("/x"), CODES.NAO_AUTORIZADO, "401 com corpo JSON ecoando token");
    assert.strictEqual(e.details, undefined);
    assert.ok(!JSON.stringify(e).includes(TOKEN), "toJSON não vaza token");
  }

  // ── metadados seguros do erro ──
  {
    const c = clientWith(async () => res(502, { erro: "x" }, { headers: { "X-Request-Id": "req-abc_123" } }));
    const e = await rejectsCode(c.get("/lojas", { query: { segredo: TOKEN, page: 1 } }), CODES.ERRO_SERVIDOR, "metadados: 5xx");
    assert.strictEqual(e.method, "GET");
    assert.strictEqual(e.path, "/lojas", "path sem query");
    assert.strictEqual(e.status, 502);
    assert.strictEqual(e.code, CODES.ERRO_SERVIDOR);
    assert.strictEqual(e.upstreamRequestId, "req-abc_123");
    assert.ok(Number.isFinite(e.durationMs) && e.durationMs >= 0);
    assert.deepStrictEqual(Object.keys(e.toJSON()).sort(), ["code", "durationMs", "message", "method", "name", "path", "status", "upstreamRequestId"]);
    const todo = JSON.stringify(e);
    assert.ok(!todo.includes(TOKEN) && !todo.includes("Bearer") && !todo.includes("segredo"), "metadados sem token/query");

    const sem = await rejectsCode(clientWith(async () => res(500, {})).post("/grants?x=1#f", { a: 1 }), CODES.ERRO_SERVIDOR, "metadados: sem x-request-id");
    assert.strictEqual(sem.method, "POST");
    assert.strictEqual(sem.path, "/grants");
    assert.strictEqual(sem.upstreamRequestId, null);

    const ruim = await rejectsCode(clientWith(async () => res(500, {}, { headers: { "x-request-id": "a b\nc" } })).get("/x"), CODES.ERRO_SERVIDOR, "x-request-id fora do formato é ignorado");
    assert.strictEqual(ruim.upstreamRequestId, null);

    const rede = await rejectsCode(clientWith(async () => { throw new Error(`ECONNREFUSED ${TOKEN}`); }).get("/y?k=v"), CODES.REDE, "metadados: erro de rede");
    assert.strictEqual(rede.path, "/y");
    assert.strictEqual(rede.status, null);
    assert.ok(!JSON.stringify(rede).includes(TOKEN));
  }

  // ── redirect: nunca seguido, vira erro controlado ──
  {
    // fetch injetado que imita o undici com redirect:"error"
    const c = clientWith(async () => { throw Object.assign(new TypeError("fetch failed"), { cause: new Error("unexpected redirect") }); });
    const e = await rejectsCode(c.get("/x?k=v"), CODES.REDIRECT_BLOQUEADO, "redirect (fetch rejeita) → REDIRECT_BLOQUEADO");
    assert.strictEqual(e.path, "/x");

    // fetch que devolve 3xx sem lançar também não é aceito
    const c3 = clientWith(async () => res(302, undefined, { headers: { location: "https://evil.example.com/" } }));
    const e3 = await rejectsCode(c3.get("/x"), CODES.REDIRECT_BLOQUEADO, "3xx devolvido → REDIRECT_BLOQUEADO");
    assert.strictEqual(e3.status, 302);
  }

  // ── redirect com fetch REAL do Node contra servidor local descartável ──
  {
    const http = require("http");
    const visitados = [];
    const srv = http.createServer((req, rs) => {
      visitados.push({ url: req.url, auth: req.headers.authorization || null });
      if (req.url === "/redir") { rs.writeHead(302, { Location: "/destino" }); return rs.end(); }
      rs.writeHead(200, { "Content-Type": "application/json" }); rs.end("{}");
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    try {
      const base = `http://127.0.0.1:${srv.address().port}`;
      const cfgLocal = readConfig({ MATRIZ_API_BASE_URL: base, MATRIZ_API_TOKEN: TOKEN, NODE_ENV: "test" });
      const real = createMatrizApiClient({ config: cfgLocal });
      await rejectsCode(real.get("/redir"), CODES.REDIRECT_BLOQUEADO, "fetch real: 302 não é seguido");
      assert.deepStrictEqual(visitados.map((v) => v.url), ["/redir"], "destino do redirect nunca foi requisitado");
    } finally {
      await new Promise((r) => srv.close(r));
    }
  }

  // ── 200 não JSON ──
  {
    const c = clientWith(async () => res(200, "<html>ok</html>", { json: false }));
    await rejectsCode(c.get("/x"), CODES.RESPOSTA_INVALIDA, "200 não JSON → RESPOSTA_INVALIDA");
  }

  // ── 204 sem corpo ──
  {
    const c = clientWith(async () => res(204, undefined));
    assert.strictEqual(await c.get("/x"), null);
    console.log("  ✓ 204 sem corpo → null");
  }

  // ── rede ──
  {
    const c = clientWith(async () => { throw new Error(`ECONNREFUSED ${TOKEN}`); });
    await rejectsCode(c.get("/x"), CODES.REDE, "erro de rede");
  }

  // ── timeout (AbortController real) ──
  {
    const c = clientWith((url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
    }));
    await rejectsCode(c.get("/lento", { timeoutMs: 30 }), CODES.TIMEOUT, "timeout");
  }

  // ── service Shopee: pendente, sem request ──
  {
    for (const op of ["iniciarAutorizacao", "consultarAutorizacao", "listarLojas", "buscarPedidos", "buscarProdutos"]) {
      await rejectsCode(shopeeMatriz[op](), CODES.ENDPOINT_NAO_CONFIGURADO, `shopeeMatrizService.${op} pendente`);
    }
  }

  console.log("\n✓ matrizApiClient.test.js");
})().catch((e) => { console.error(e); process.exit(1); });
