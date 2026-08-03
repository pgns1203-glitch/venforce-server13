// Cobre a liberação do Diagnóstico Inicial para todas as roles internas
// autenticadas (não somente admin), sem abrir mão de autenticação nem do
// isolamento de escopo do seller.
const assert = require("assert");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const diagnosticoRoutes = require("../routes/diagnosticoInicialRoutes");
const cliente360Routes = require("../routes/cliente360Routes");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function middlewareNames(routes, method, path) {
  const layer = routes.stack.find(
    (l) => l.route && l.route.path === path && Object.keys(l.route.methods)[0] === method
  );
  return layer.route.stack.map((s) => s.name);
}

(async () => {
  console.log("\n▸ Diagnóstico Inicial — controle de acesso");

  // 1. Rotas do Diagnóstico Inicial usam authMiddleware + requireAutomacoesAccess
  //    (admin/user/membro), nunca requireAdmin — a tela não é mais admin-only.
  const diagRotas = [
    ["get", "/"], ["get", "/:id"], ["post", "/"],
    ["patch", "/:id"], ["post", "/:id/gerar"], ["post", "/:id/concluir"],
  ];
  for (const [method, path] of diagRotas) {
    const names = middlewareNames(diagnosticoRoutes, method, path);
    ok(`${method.toUpperCase()} ${path} exige authMiddleware`, names[0] === "authMiddleware");
    ok(`${method.toUpperCase()} ${path} usa requireAutomacoesAccess (não requireAdmin)`, names[1] === "requireAutomacoesAccess");
  }

  // 2. A lista de clientes usada pelo seletor da tela (GET /operacao/cliente-360/clientes)
  //    também é admin/user/membro — não o /clientes global (admin-only, expõe api_key).
  const clientesNames = middlewareNames(cliente360Routes, "get", "/clientes");
  ok("GET /operacao/cliente-360/clientes usa requireAutomacoesAccess", clientesNames[1] === "requireAutomacoesAccess");

  // 3. Ações administrativas pesadas do Cliente 360 continuam exigindo admin —
  //    prova de que não abrimos nada além do necessário.
  const syncNames = middlewareNames(cliente360Routes, "post", "/:slug/sincronizar");
  ok("POST /:slug/sincronizar continua com requireAdmin", syncNames[1] === "requireAdmin");

  // 4. requireAutomacoesAccess: admin, user e membro passam.
  for (const role of ["admin", "user", "membro"]) {
    let nextCalled = false;
    const req = { user: { role } };
    const res = mockRes();
    requireAutomacoesAccess(req, res, () => { nextCalled = true; });
    ok(`requireAutomacoesAccess libera role "${role}"`, nextCalled && res.statusCode === 200);
  }

  // 5. requireAutomacoesAccess: seller (área própria) e roles desconhecidas continuam de fora.
  for (const role of ["seller", "shopee_reviewer", "", undefined]) {
    let nextCalled = false;
    const req = { user: { role } };
    const res = mockRes();
    requireAutomacoesAccess(req, res, () => { nextCalled = true; });
    ok(`requireAutomacoesAccess bloqueia role "${role}"`, !nextCalled && res.statusCode === 403);
  }

  // 6. requireAdmin (controle): admin passa, roles internas comuns continuam bloqueadas
  //    — outras telas adminOnly não foram afetadas por esta mudança.
  {
    let nextCalled = false;
    const req = { user: { role: "admin" } };
    const res = mockRes();
    requireAdmin(req, res, () => { nextCalled = true; });
    ok("requireAdmin libera admin", nextCalled);
  }
  for (const role of ["user", "membro", "seller"]) {
    let nextCalled = false;
    const req = { user: { role } };
    const res = mockRes();
    requireAdmin(req, res, () => { nextCalled = true; });
    ok(`requireAdmin continua bloqueando role "${role}"`, !nextCalled && res.statusCode === 403);
  }

  // 7. Sem token: authMiddleware nega antes de qualquer checagem de role (401),
  //    login continua obrigatório.
  {
    let nextCalled = false;
    const req = { headers: {} };
    const res = mockRes();
    await authMiddleware(req, res, () => { nextCalled = true; });
    ok("authMiddleware nega requisição sem Authorization Bearer", !nextCalled && res.statusCode === 401);
  }
  {
    let nextCalled = false;
    const req = { headers: { authorization: "Bearer token-invalido" } };
    const res = mockRes();
    await authMiddleware(req, res, () => { nextCalled = true; });
    ok("authMiddleware nega token inválido/expirado", !nextCalled && res.statusCode === 401);
  }

  console.log(`\n${checks} verificações passaram no controle de acesso do Diagnóstico Inicial.`);
})().catch((error) => { console.error(error); process.exit(1); });
