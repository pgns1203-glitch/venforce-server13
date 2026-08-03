// Contrato da lista segura de clientes usada pela tela de Fechamento.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const express = require("express");
const fs = require("fs");
const path = require("path");
const pool = require("../config/database");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const routes = require("../routes/fechamentosFinanceiroRoutes");
const service = require("../services/fechamentoFinanceiro/clientesFinanceiroService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.strictEqual(actual, expected, `${label}: ${actual} !== ${expected}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function routeMiddlewareNames(method, routePath) {
  const layer = routes.stack.find(
    (item) => item.route
      && item.route.path === routePath
      && item.route.methods[method]
  );
  assert.ok(layer, `Rota ${method.toUpperCase()} ${routePath} não encontrada`);
  return layer.route.stack.map((item) => item.name);
}

async function main() {
  console.log("\n▸ Clientes do Fechamento — contrato e acesso");

  const names = routeMiddlewareNames("get", "/financeiro/clientes");
  eq("autenticação é o primeiro middleware", names[0], "authMiddleware");
  eq("permissão do módulo é o segundo middleware", names[1], "requireAutomacoesAccess");
  eq("controller roda somente depois das proteções", names[2], "listarClientesFinanceiroController");

  // Prova o caminho público completo usado pelo frontend. Sem token deve ser
  // 401; um 404 aqui indicaria router ausente ou montado no prefixo errado.
  {
    const app = express();
    app.use("/fechamentos", routes);
    const server = await new Promise((resolve) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    try {
      const address = server.address();
      const response = await fetch(
        `http://127.0.0.1:${address.port}/fechamentos/financeiro/clientes`
      );
      eq("rota completa está montada (sem token = 401, nunca 404)", response.status, 401);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  for (const role of ["admin", "user", "membro"]) {
    let nextCalled = false;
    const res = mockRes();
    requireAutomacoesAccess({ user: { role } }, res, () => { nextCalled = true; });
    ok(`role ${role} pode listar clientes`, nextCalled && res.statusCode === 200);
  }

  for (const role of ["seller", "shopee_reviewer", "", undefined]) {
    let nextCalled = false;
    const res = mockRes();
    requireAutomacoesAccess({ user: { role } }, res, () => { nextCalled = true; });
    ok(`role ${String(role)} recebe 403`, !nextCalled && res.statusCode === 403);
  }

  {
    let nextCalled = false;
    const res = mockRes();
    await authMiddleware({ headers: {} }, res, () => { nextCalled = true; });
    ok("requisição sem token recebe 401", !nextCalled && res.statusCode === 401);
  }

  const originalQuery = pool.query;
  let sqlExecutado = "";
  try {
    pool.query = async (sql) => {
      sqlExecutado = String(sql);
      return {
        rows: [{
          id: 7,
          nome: "Cliente Seguro",
          slug: "cliente-seguro",
          ativo: true,
          api_key: "nao-pode-vazar",
          access_token: "nem-este",
          created_at: "2026-08-03",
        }],
      };
    };

    const clientes = await service.listarClientesAtivosFinanceiro();
    assert.deepStrictEqual(clientes, [{
      id: 7,
      nome: "Cliente Seguro",
      slug: "cliente-seguro",
      ativo: true,
    }]);
    checks += 1;
    console.log("  ok  resposta contém exclusivamente id, nome, slug e ativo");
    ok("consulta limita a clientes ativos", /WHERE\s+ativo\s*=\s*true/i.test(sqlExecutado));
    ok("consulta ordena por nome", /ORDER\s+BY\s+nome\s+ASC/i.test(sqlExecutado));
    ok("consulta não seleciona api_key", !/api_key/i.test(sqlExecutado));
    ok("consulta não usa SELECT *", !/SELECT\s+\*/i.test(sqlExecutado));
  } finally {
    pool.query = originalQuery;
  }

  const frontendPath = path.join(__dirname, "..", "..", "Portal", "financeiro.js");
  const frontend = fs.readFileSync(frontendPath, "utf8");
  ok(
    "seletor usa apenas o endpoint específico do Fechamento",
    frontend.includes("`${API_BASE}/fechamentos/financeiro/clientes`")
      && !frontend.includes("`${API_BASE}/clientes`")
  );
  ok(
    "401 no carregamento redireciona ao login",
    /carregarClientesFinanceiro[\s\S]*res\.status === 401[\s\S]*location\.replace\("index\.html"\)/.test(frontend)
  );

  console.log(`\n${checks} verificações passaram. Lista segura do Fechamento OK.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
