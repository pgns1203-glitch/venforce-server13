const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireAdmin } = require("../middlewares/authMiddleware");

const ROOT = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

function responseStub() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function assertOperationalRole(role) {
  let nextCalled = false;
  requireAutomacoesAccess({ user: { role } }, responseStub(), () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true, `${role} deve manter acesso operacional`);
}

assertOperationalRole("admin");
assertOperationalRole("membro");

{
  const res = responseStub();
  let nextCalled = false;
  requireAdmin({ user: { role: "membro" } }, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 403);
}

const operationalRoutes = [
  ["routes/metricasRoutes.js", "requireAutomacoesAccess"],
  ["routes/adsRoutes.js", "requireAutomacoesAccess"],
  ["routes/centralVendasRoutes.js", 'router.get("/:slug", authMiddleware, requireAutomacoesAccess'],
  ["routes/automacoesRoutes.js", "requireAutomacoesAccess"],
  ["routes/cliente360Routes.js", 'router.get("/:slug", authMiddleware, requireAutomacoesAccess'],
  ["routes/cliente360ResultadoRoutes.js", "requireAutomacoesAccess"],
  ["routes/fechamentosFinanceiroRoutes.js", "requireAutomacoesAccess"],
  ["routes/diagnosticoInicialRoutes.js", "requireAutomacoesAccess"],
  ["routes/meliAnunciosRoutes.js", "router.use(authMiddleware, requireAutomacoesAccess)"],
];

for (const [file, expected] of operationalRoutes) {
  assert.ok(read(file).includes(expected), `${file} deve preservar o acesso operacional de membro`);
}

const mlRoutes = read("routes/mlRoutes.js");
for (const route of [
  '"/admin/ml-tokens"',
  '"/admin/ml-tokens/:tokenId/principal"',
  '"/admin/ml-tokens/:tokenId/testar"',
  '"/clientes/:slug/ml-status"',
]) {
  const offset = mlRoutes.indexOf(route);
  assert.ok(offset >= 0, `rota administrativa ausente: ${route}`);
  assert.ok(mlRoutes.slice(offset, offset + 180).includes("requireAdmin"), `${route} deve exigir admin`);
}

const migration = read("sql/migrations/20260806_ml_tokens_primary_refresh_safety.sql");
assert.ok(!/\b(?:DELETE|TRUNCATE|DROP\s+TABLE|CREATE\s+TABLE)\b/i.test(migration));
assert.ok(!/access_token|refresh_token|ml_user_id\s*=|cliente_id\s*=/i.test(migration));

const boot = read("index.js");
assert.ok(!boot.includes("ensureMlTokenSchema"));
assert.ok(!boot.includes("20260806_ml_tokens_primary_refresh_safety"));

const tests = fs.readdirSync(__dirname).filter((name) => name.endsWith(".test.js"));
for (const file of tests) {
  assert.ok(!/DELETE\s+FROM\s+ml_tokens/i.test(fs.readFileSync(path.join(__dirname, file), "utf8")), `${file} não pode apagar grants`);
}

console.log("ok — escopo e permissões operacionais dos grants ML preservados");
