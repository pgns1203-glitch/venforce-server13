// server/tests/authzDiagnostico.test.js
//
// P2.1 — cobertura de carteira do Diagnóstico Inicial. O cliente chega por
// ?clienteId (lista), body.clienteId (criação) ou pelo registro (:id).
// Fixture: user interno 1 acessa o Cliente 10, não o 20. Admin acessa tudo.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");
const controller = require("../controllers/diagnosticoInicialController");

let checks = 0;
function ok(label, cond) { assert.ok(cond, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); }
function fakeRes() {
  return { statusCode: 200, body: null, status(c){this.statusCode=c;return this;}, json(b){this.body=b;return this;} };
}

const DIAGS = {
  1: { id: 1, cliente_id: 10, cliente_slug: "cli-10", marketplace: "meli", status: "rascunho", respostas_json: {} },
  2: { id: 2, cliente_id: 20, cliente_slug: "cli-20", marketplace: "meli", status: "rascunho", respostas_json: {} },
};

function mock(sql, params = []) {
  const q = String(sql).replace(/\s+/g, " ").trim();
  if (/^(CREATE|ALTER|DROP|DO |BEGIN|COMMIT)/i.test(q)) return { rows: [] };
  // authorizationService
  if (q.includes("authz:CAN_ACCESS_ADMIN")) return { rows: [{ "?column?": 1 }] };
  if (q.includes("authz:CAN_ACCESS_INTERNAL")) return { rows: Number(params[1]) === 10 ? [{ "?column?": 1 }] : [] };
  if (q.includes("authz:RESOLVE_CLIENTE_ID")) {
    const id = Number(params[0]);
    return { rows: [10, 20].includes(id) ? [{ id, slug: `cli-${id}`, nome: `Cli ${id}`, ativo: true }] : [] };
  }
  if (q.includes("authz:PORTFOLIO_ADMIN_ALL")) return { rows: [{ id: 10, slug: "cli-10", nome: "Cli 10" }, { id: 20, slug: "cli-20", nome: "Cli 20" }] };
  if (q.includes("authz:PORTFOLIO_INTERNAL_BY_SQUAD")) return { rows: [{ id: 10, slug: "cli-10", nome: "Cli 10" }] };
  // diagnostico repo
  if (q.includes("FROM diagnosticos_iniciais di") && q.includes("WHERE di.id = $1")) {
    return { rows: DIAGS[Number(params[0])] ? [DIAGS[Number(params[0])]] : [] };
  }
  if (q.includes("FROM diagnosticos_iniciais di")) {
    // listagem
    let rows = Object.values(DIAGS);
    if (params.length) rows = rows.filter((d) => d.cliente_id === Number(params[0]));
    return { rows };
  }
  return { rows: [] };
}

async function run() {
  const original = pool.query;
  pool.query = async (sql, params) => mock(sql, params);

  const interno = { id: 1, role: "membro" };
  const admin = { id: 9, role: "admin" };

  // GET /:id — registro de cliente fora da carteira
  {
    const res = fakeRes();
    await controller.obterDiagnostico({ params: { id: "2" }, query: {}, user: interno }, res);
    ok("GET /:id de cliente fora da carteira -> 403", res.statusCode === 403);
    ok("GET /:id fora -> code CLIENTE_FORA_DA_CARTEIRA", res.body && res.body.code === "CLIENTE_FORA_DA_CARTEIRA");
  }
  // GET /:id — registro do cliente da carteira
  {
    const res = fakeRes();
    await controller.obterDiagnostico({ params: { id: "1" }, query: {}, user: interno }, res);
    ok("GET /:id do cliente da carteira -> 200", res.statusCode === 200 && res.body.ok === true);
  }
  // GET /:id — admin acessa qualquer
  {
    const res = fakeRes();
    await controller.obterDiagnostico({ params: { id: "2" }, query: {}, user: admin }, res);
    ok("GET /:id admin -> 200 em qualquer cliente", res.statusCode === 200 && res.body.ok === true);
  }
  // POST / — body.clienteId fora da carteira
  {
    const res = fakeRes();
    await controller.criarDiagnostico({ params: {}, body: { clienteId: 20, marketplace: "meli" }, user: interno }, res);
    ok("POST / com clienteId fora da carteira -> 403", res.statusCode === 403 && res.body.code === "CLIENTE_FORA_DA_CARTEIRA");
  }
  // GET / (lista) sem clienteId -> só diagnósticos do portfolio
  {
    const res = fakeRes();
    await controller.listarDiagnosticos({ params: {}, query: {}, user: interno }, res);
    ok("GET / lista -> só clientes do portfolio", res.body.ok === true && res.body.diagnosticos.every((d) => d.cliente_id === 10));
  }
  // GET / (lista) admin -> todos
  {
    const res = fakeRes();
    await controller.listarDiagnosticos({ params: {}, query: {}, user: admin }, res);
    ok("GET / lista admin -> todos", res.body.diagnosticos.length === 2);
  }
  // GET / com clienteId fora da carteira -> 403
  {
    const res = fakeRes();
    await controller.listarDiagnosticos({ params: {}, query: { clienteId: "20" }, user: interno }, res);
    ok("GET / ?clienteId fora -> 403", res.statusCode === 403 && res.body.code === "CLIENTE_FORA_DA_CARTEIRA");
  }
  // POST /:id/concluir de cliente fora -> 403
  {
    const res = fakeRes();
    await controller.concluirDiagnostico({ params: { id: "2" }, user: interno }, res);
    ok("POST /:id/concluir fora da carteira -> 403", res.statusCode === 403);
  }

  pool.query = original;
  console.log(`\nauthzDiagnostico.test.js: ${checks} verificações passaram.`);
}

run().catch((e) => { console.error(e); process.exitCode = 1; });
