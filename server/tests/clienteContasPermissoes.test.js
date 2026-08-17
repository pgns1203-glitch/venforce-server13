// server/tests/clienteContasPermissoes.test.js
//
// Política de permissões da fundação de contas (correção pedida depois da
// Fase 1): roles internas (admin/user/membro) podem ler metadados
// operacionais de cliente_contas/grants; só admin muta e só um endpoint
// dev-admin explícito revela access_token/refresh_token.
//
//  1. membro consegue consultar metadados operacionais;
//  2. membro não consegue consultar credentials;
//  3. membro não consegue realizar mutações admin;
//  4. admin consegue consultar metadados;
//  5. admin consegue explicitamente revelar credentials;
//  6. endpoints genéricos não contêm access_token/refresh_token;
//  7. endpoint admin específico retorna as credentials corretas;
//  8. nenhuma credencial aparece em logs durante os testes.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";
process.env.ML_CLIENT_ID = process.env.ML_CLIENT_ID || "client-test";
process.env.ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET || "secret-test";

const assert = require("assert");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// ── item 8: nenhuma credencial aparece em nenhum console.* durante o teste ──
const SEGREDO_ACCESS = "APP_USR-super-secreto-access-9f1a2b3c";
const SEGREDO_REFRESH = "TG-super-secreto-refresh-7d8e9f0a";
const logsCapturados = [];
const originais = { log: console.log, warn: console.warn, error: console.error, info: console.info };
["log", "warn", "error", "info"].forEach((metodo) => {
  console[metodo] = (...args) => {
    logsCapturados.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    originais[metodo](...args);
  };
});
function restaurarConsole() {
  console.log = originais.log;
  console.warn = originais.warn;
  console.error = originais.error;
  console.info = originais.info;
}

function responseStub() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const pool = require("../config/database");

class MockDb {
  constructor() {
    this.clientes = [{ id: 1, nome: "Loja Eletrônico", slug: "loja-eletronico", ativo: true }];
    this.contas = [
      { id: 10, cliente_id: 1, marketplace: "meli", nome: "Mercado Livre 1", slug: "loja-eletronico-meli-1", external_account_id: "111", is_primary: true, ativo: true, metadata_json: {} },
    ];
    this.grants = [
      {
        id: 501, cliente_id: 1, cliente_conta_id: 10, ml_user_id: "111",
        access_token: SEGREDO_ACCESS, refresh_token: SEGREDO_REFRESH,
        expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000),
        created_at: new Date(), updated_at: new Date(),
        is_primary: true, token_status: "valid", refresh_failures: 0,
        last_refresh_error_at: null, next_refresh_attempt_at: null,
        _has_is_primary: true, _has_refresh_metadata: true,
      },
    ];
  }
  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q.startsWith("SELECT id, nome, slug, ativo FROM clientes WHERE id = $1")) {
      return { rows: this.clientes.filter((c) => c.id === Number(params[0])) };
    }
    if (q.startsWith("SELECT id, nome, slug, ativo FROM clientes WHERE slug = $1")) {
      return { rows: this.clientes.filter((c) => c.slug === params[0]) };
    }
    if (q.includes("FROM cliente_contas cc") && q.includes("LEFT JOIN ml_tokens g")) {
      const filtradas = this.contas.filter((c) => c.cliente_id === Number(params[0]));
      return {
        rows: filtradas.map((c) => {
          const grant = this.grants.find((g) => g.cliente_conta_id === c.id);
          return {
            ...c,
            grant_id: grant?.id ?? null,
            grant_ml_user_id: grant?.ml_user_id ?? null,
            grant_token_status: grant?.token_status ?? null,
            grant_is_primary: grant?.is_primary ?? false,
            vinculo_id: null, vinculo_base_id: null, vinculo_base_slug: null, vinculo_base_nome: null,
          };
        }),
      };
    }
    if (q.startsWith("SELECT * FROM cliente_contas WHERE id = $1")) {
      return { rows: this.contas.filter((c) => c.id === Number(params[0])) };
    }
    if (q.includes("FROM base_cliente_vinculos v") && q.includes("cliente_conta_id = $1")) {
      return { rows: [] };
    }
    if (q.startsWith("SELECT COUNT(*)::int AS total FROM cliente_contas")) {
      return { rows: [{ total: 1 }] };
    }
    if (q.includes("FROM base_cliente_vinculos v") && q.includes("v.cliente_id = $1")) {
      return { rows: [] };
    }
    // mlTokenService.findGrantById
    if (q.includes("FROM ml_tokens t") && q.includes("WHERE t.id = $1")) {
      return { rows: this.grants.filter((g) => g.id === Number(params[0])).map((g) => ({ ...g })) };
    }
    throw new Error(`Query não mapeada no mock: ${q}`);
  }
}

async function run() {
  const originalQuery = pool.query;
  const db = new MockDb();
  pool.query = (sql, params) => db.query(sql, params);

  try {
    delete require.cache[require.resolve("../middlewares/authMiddleware")];
    delete require.cache[require.resolve("../middlewares/accessMiddleware")];
    delete require.cache[require.resolve("../controllers/clienteContasController")];
    delete require.cache[require.resolve("../controllers/mlController")];
    delete require.cache[require.resolve("../services/clienteContas/clienteContaService")];
    delete require.cache[require.resolve("../services/mlTokenService")];

    const { requireAdmin } = require("../middlewares/authMiddleware");
    const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
    const clienteContasController = require("../controllers/clienteContasController");
    const mlController = require("../controllers/mlController");

    // ── 1 & 4: leitura operacional liberada a membro/user/admin ──────────
    for (const role of ["membro", "user", "admin"]) {
      let next = false;
      requireAutomacoesAccess({ user: { role } }, responseStub(), () => { next = true; });
      ok(`${role} passa por requireAutomacoesAccess (leitura operacional liberada)`, next === true);
    }

    // ── 3: membro não consegue mutação admin (requireAdmin bloqueia) ─────
    {
      const res = responseStub();
      let next = false;
      requireAdmin({ user: { role: "membro" } }, res, () => { next = true; });
      ok("membro é bloqueado por requireAdmin (mutações continuam admin-only)", next === false && res.statusCode === 403);
    }
    {
      const res = responseStub();
      let next = false;
      requireAdmin({ user: { role: "admin" } }, res, () => { next = true; });
      ok("admin passa por requireAdmin", next === true);
    }

    // ── 1/4/6: controller de leitura devolve metadados sem tokens ────────
    for (const role of ["membro", "admin"]) {
      const req = { params: { cliente: "loja-eletronico" }, query: {}, user: { role } };
      const res = responseStub();
      await clienteContasController.listar(req, res);
      ok(`${role}: GET /clientes/:cliente/contas responde 200 com metadados`, res.body?.ok === true && Array.isArray(res.body.contas) && res.body.contas.length === 1);
      const conta = res.body.contas[0];
      ok(`${role}: metadados incluem ml_user_id/status/principal/base (operacional)`,
        conta.grant?.ml_user_id === "111" && conta.grant?.token_status === "valid" && conta.is_primary === true && "base" in conta);
      const serializado = JSON.stringify(res.body);
      ok(`${role}: resposta de listagem NÃO contém access_token/refresh_token`, !serializado.includes(SEGREDO_ACCESS) && !serializado.includes(SEGREDO_REFRESH) && !/access_token|refresh_token/.test(serializado));
    }

    // ── 6: /admin/ml-tokens (listagem técnica) também não vaza tokens ────
    {
      const req = {};
      const res = responseStub();
      await mlController.listarMlTokensAdminController(req, res);
      const serializado = JSON.stringify(res.body);
      ok("GET /admin/ml-tokens (listagem) não contém access_token/refresh_token", !serializado.includes(SEGREDO_ACCESS) && !serializado.includes(SEGREDO_REFRESH) && !/"access_token"|"refresh_token"/.test(serializado));
    }

    // ── 5 & 7: endpoint dev-admin explícito revela as credentials certas ──
    {
      const req = { params: { tokenId: "501" } };
      const res = responseStub();
      await mlController.revelarCredenciaisGrantController(req, res);
      ok("GET /admin/ml-tokens/:id/credentials responde 200", res.body?.ok === true);
      ok("credentials endpoint devolve o access_token correto", res.body.access_token === SEGREDO_ACCESS);
      ok("credentials endpoint devolve o refresh_token correto", res.body.refresh_token === SEGREDO_REFRESH);
      ok("credentials endpoint identifica o grant/ml_user_id", res.body.token_id === 501 && res.body.ml_user_id === "111");
    }

    // ── 2: rota de credentials é wireada com requireAdmin (estática) ─────
    const fs = require("fs");
    const path = require("path");
    const mlRoutesSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "mlRoutes.js"), "utf8");
    const offsetCred = mlRoutesSrc.indexOf('"/admin/ml-tokens/:tokenId/credentials"');
    ok("rota de credentials está declarada", offsetCred >= 0);
    const fimCred = mlRoutesSrc.indexOf(");", offsetCred);
    ok("rota de credentials exige requireAdmin (membro não alcança)", mlRoutesSrc.slice(offsetCred, fimCred).includes("requireAdmin"));

    console.log(`\n✓ clienteContasPermissoes: ${checks} verificações`);
  } finally {
    pool.query = originalQuery;
    restaurarConsole();

    // item 8, verificado por último (depois de restaurar o console, com os
    // logs já capturados durante toda a execução acima).
    const vazou = logsCapturados.some((linha) => linha.includes(SEGREDO_ACCESS) || linha.includes(SEGREDO_REFRESH));
    ok(`nenhuma credencial apareceu em logs durante os testes (${logsCapturados.length} linhas inspecionadas)`, !vazou);
  }
}

run().catch((err) => {
  restaurarConsole();
  console.error(err);
  process.exit(1);
});
