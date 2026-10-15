// Rota GET /integracoes/matriz/status: admin-only, sem segredo, sem ENV ok.
// Também prova que o callback Shopee existente não mudou.
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";
delete process.env.MATRIZ_API_BASE_URL;
delete process.env.MATRIZ_API_TOKEN;

const assert = require("assert");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const routes = require("../routes/integracoesMatrizRoutes");
const { statusMatrizController } = require("../controllers/integracoesMatrizController");
const { callbackShopeeController } = require("../controllers/shopeeController");

function fakeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; } };
}

// rota existe, só GET, authMiddleware → requireAdmin → controller
const layer = routes.stack.find((l) => l.route && l.route.path === "/matriz/status");
assert.ok(layer, "rota /matriz/status existe");
assert.deepStrictEqual(Object.keys(layer.route.methods), ["get"]);
assert.deepStrictEqual(layer.route.stack.map((s) => s.handle), [authMiddleware, requireAdmin, statusMatrizController]);
console.log("  ✓ GET /matriz/status: authMiddleware + requireAdmin + controller");

// não-admin bloqueado
{
  const r = fakeRes(); let next = false;
  requireAdmin({ user: { role: "membro" } }, r, () => { next = true; });
  assert.strictEqual(r.statusCode, 403); assert.strictEqual(next, false);
  console.log("  ✓ não-admin → 403");
}

// sem ENV: configured=false (módulo carregou sem ENV → startup ok)
{
  const r = fakeRes();
  statusMatrizController({}, r);
  assert.strictEqual(r.body.ok, true);
  assert.strictEqual(r.body.configured, false);
  assert.strictEqual(r.body.baseUrlConfigured, false);
  assert.strictEqual(r.body.authenticationConfigured, false);
  assert.deepStrictEqual(r.body.shopee, { externalContract: "pending" });
  console.log("  ✓ sem ENV: configured=false");
}

// com ENV: configured=true e resposta sem segredo
{
  process.env.MATRIZ_API_BASE_URL = "https://matriz.example.com";
  process.env.MATRIZ_API_TOKEN = "tok_SECRETO_XYZ";
  const r = fakeRes();
  statusMatrizController({}, r);
  assert.strictEqual(r.body.configured, true);
  const s = JSON.stringify(r.body);
  assert.ok(!s.includes("tok_SECRETO_XYZ") && !s.includes("matriz.example.com"));
  delete process.env.MATRIZ_API_BASE_URL; delete process.env.MATRIZ_API_TOKEN;
  console.log("  ✓ com ENV: configured=true, sem segredo/URL na resposta");
}

// callback Shopee preservado (casca)
{
  const a = fakeRes(); callbackShopeeController({ query: {} }, a);
  const b = fakeRes(); callbackShopeeController({ query: { code: "abc" } }, b);
  assert.strictEqual(a.statusCode, 200); assert.ok(a.body.includes("Callback Shopee ativo"));
  assert.strictEqual(b.statusCode, 200); assert.ok(b.body.includes("Callback Shopee recebido"));
  assert.ok(!b.body.includes("abc"));
  console.log("  ✓ callback Shopee inalterado");
}
console.log("\n✓ integracoesMatrizRoutes.test.js");
