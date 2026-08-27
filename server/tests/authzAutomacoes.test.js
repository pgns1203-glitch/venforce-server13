// server/tests/authzAutomacoes.test.js
//
// P2.1 — cobertura de carteira dos artefatos salvos de Automações
// (relatório / job de diagnóstico) acessados por id serial. O cliente está
// no registro (cliente_slug), não em clienteSlug de rota.
// user interno 1 acessa cli-10, não cli-20. Admin acessa tudo.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");
const controller = require("../controllers/automacoesController");

let checks = 0;
function ok(label, cond) { assert.ok(cond, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); }
function fakeRes() {
  return { statusCode: 200, body: null, headers: {},
    status(c){this.statusCode=c;return this;}, json(b){this.body=b;return this;},
    setHeader(k,v){this.headers[k]=v;}, send(b){this.body=b;return this;} };
}

const RELATORIOS = { 1: { cliente_slug: "cli-10" }, 2: { cliente_slug: "cli-20" } };
const JOBS = { 5: { cliente_slug: "cli-20" } };

function mock(sql, params = []) {
  const q = String(sql).replace(/\s+/g, " ").trim();
  if (/^(CREATE|ALTER|DROP|DO |BEGIN|COMMIT)/i.test(q)) return { rows: [] };
  if (q.includes("authz:CAN_ACCESS_ADMIN")) return { rows: [{ "?column?": 1 }] };
  if (q.includes("authz:CAN_ACCESS_INTERNAL")) return { rows: Number(params[1]) === 10 ? [{ "?column?": 1 }] : [] };
  if (q.includes("authz:RESOLVE_CLIENTE_SLUG")) {
    const m = String(params[0]).match(/^cli-(\d+)$/);
    return { rows: m ? [{ id: Number(m[1]), slug: params[0], nome: params[0], ativo: true }] : [] };
  }
  if (q.includes("authz:PORTFOLIO_INTERNAL_BY_SQUAD")) return { rows: [{ id: 10, slug: "cli-10", nome: "Cli 10" }] };
  if (q.includes("authz:PORTFOLIO_ADMIN_ALL")) return { rows: [{ id: 10, slug: "cli-10" }, { id: 20, slug: "cli-20" }] };
  if (q.startsWith("SELECT cliente_slug FROM relatorios WHERE id = $1")) {
    return { rows: RELATORIOS[Number(params[0])] ? [RELATORIOS[Number(params[0])]] : [] };
  }
  if (q.startsWith("SELECT cliente_slug FROM promocoes_diagnosticos WHERE id = $1")) {
    return { rows: JOBS[Number(params[0])] ? [JOBS[Number(params[0])]] : [] };
  }
  if (q.includes("FROM relatorios WHERE id = $1")) {
    // buscarDiagnosticoCompletoController full select
    return { rows: [{ id: Number(params[0]), cliente_slug: "cli-20", status: "concluido" }] };
  }
  if (q.includes("listarRelatoriosAutomacoes") || q.includes("FROM relatorios r")) {
    return { rows: [
      { id: 1, cliente_slug: "cli-10" },
      { id: 2, cliente_slug: "cli-20" },
    ] };
  }
  return { rows: [] };
}

async function run() {
  const original = pool.query;
  pool.query = async (sql, params) => mock(sql, params);
  const interno = { id: 1, role: "membro" };
  const admin = { id: 9, role: "admin" };

  {
    const res = fakeRes();
    await controller.buscarDiagnosticoCompletoController({ params: { id: "2" }, user: interno }, res);
    ok("GET diagnostico-completo/:id de cliente fora -> 403", res.statusCode === 403 && res.body.code === "CLIENTE_FORA_DA_CARTEIRA");
  }
  {
    const res = fakeRes();
    await controller.buscarDiagnosticoCompletoController({ params: { id: "1" }, user: interno }, res);
    ok("GET diagnostico-completo/:id do cliente da carteira -> 200", res.statusCode === 200 && res.body.ok === true);
  }
  {
    const res = fakeRes();
    await controller.buscarDiagnosticoCompletoController({ params: { id: "2" }, user: admin }, res);
    ok("GET diagnostico-completo/:id admin -> 200", res.statusCode === 200 && res.body.ok === true);
  }
  {
    const res = fakeRes();
    await controller.exportRelatorioCsvController({ params: { id: "2" }, user: interno }, res);
    ok("GET relatorios/:id/export/csv de cliente fora -> 403", res.statusCode === 403);
  }
  {
    const res = fakeRes();
    await controller.statusDiagnosticoPromocoesController({ params: { id: "5" }, user: interno }, res);
    ok("GET promocoes-retorno/diagnostico/:id de cliente fora -> 403", res.statusCode === 403);
  }
  {
    const res = fakeRes();
    await controller.listarRelatoriosAutomacoesController({ query: {}, user: interno }, res);
    const slugs = (res.body.relatorios || []).map((r) => r.cliente_slug);
    ok("lista de relatórios -> só cli-10 (portfolio)", slugs.length === 1 && slugs[0] === "cli-10");
  }

  pool.query = original;
  console.log(`\nauthzAutomacoes.test.js: ${checks} verificações passaram.`);
}

run().catch((e) => { console.error(e); process.exitCode = 1; });
