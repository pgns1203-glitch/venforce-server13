// server/tests/authzEntregasCliente.test.js
//
// P2.1 — cobertura de carteira das Entregas de Cliente. Cliente chega por
// body (cliente_id/cliente_slug), query ou pelo registro (:id).
// user interno 1 acessa o Cliente 10, não o 20. Admin acessa tudo.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";
// P2.2 — este teste exercita a autorização por carteira COM enforcement ativo.
process.env.SQUADS_ENFORCEMENT = "on";

const assert = require("assert");
const pool = require("../config/database");
const controller = require("../controllers/entregasClienteController");

let checks = 0;
function ok(label, cond) { assert.ok(cond, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); }
function fakeRes() {
  return { statusCode: 200, body: null, status(c){this.statusCode=c;return this;}, json(b){this.body=b;return this;} };
}

const ENTREGAS = {
  1: { id: 1, cliente_id: 10, cliente_slug: "cli-10", tipo: "fechamento", status: "rascunho" },
  2: { id: 2, cliente_id: 20, cliente_slug: "cli-20", tipo: "fechamento", status: "rascunho" },
};

function mock(sql, params = []) {
  const q = String(sql).replace(/\s+/g, " ").trim();
  if (q.includes("authz:CAN_ACCESS_ADMIN")) return { rows: [{ "?column?": 1 }] };
  if (q.includes("authz:CAN_ACCESS_INTERNAL")) return { rows: Number(params[1]) === 10 ? [{ "?column?": 1 }] : [] };
  if (q.includes("authz:RESOLVE_CLIENTE_ID")) {
    const id = Number(params[0]);
    return { rows: [10, 20].includes(id) ? [{ id, slug: `cli-${id}`, nome: `Cli ${id}`, ativo: true }] : [] };
  }
  if (q.includes("authz:RESOLVE_CLIENTE_SLUG")) {
    const s = String(params[0]);
    const m = s.match(/^cli-(\d+)$/);
    return { rows: m ? [{ id: Number(m[1]), slug: s, nome: s, ativo: true }] : [] };
  }
  if (q.includes("authz:PORTFOLIO_ADMIN_ALL")) return { rows: [{ id: 10 }, { id: 20 }] };
  if (q.includes("authz:PORTFOLIO_INTERNAL_BY_SQUAD")) return { rows: [{ id: 10 }] };
  if (q.startsWith("SELECT id, slug, nome FROM clientes WHERE id = $1")) {
    const id = Number(params[0]); return { rows: [10, 20].includes(id) ? [{ id, slug: `cli-${id}`, nome: `Cli ${id}` }] : [] };
  }
  if (q.startsWith("SELECT id, slug, nome FROM clientes WHERE slug = $1")) {
    const s = String(params[0]); const m = s.match(/^cli-(\d+)$/);
    return { rows: m ? [{ id: Number(m[1]), slug: s, nome: s }] : [] };
  }
  if (q.startsWith("SELECT * FROM entregas_cliente WHERE id = $1")) {
    return { rows: ENTREGAS[Number(params[0])] ? [ENTREGAS[Number(params[0])]] : [] };
  }
  // P2.7 — a carteira passou a entrar NO SQL (`cliente_id = ANY($n::int[])`),
  // antes da paginacao e do COUNT. O mock precisa honrar esse filtro, senao
  // deixa de provar o isolamento (e o `total` volta a ser o global).
  if (q.includes("FROM entregas_cliente")) {
    const idxAny = q.match(/cliente_id = ANY\(\$(\d+)::int\[\]\)/);
    let linhas = Object.values(ENTREGAS);
    if (idxAny) {
      const permitidos = params[Number(idxAny[1]) - 1] || [];
      linhas = linhas.filter((e) => permitidos.includes(e.cliente_id));
    }
    if (q.includes("COUNT(*)::int AS total")) return { rows: [{ total: linhas.length }] };
    return { rows: linhas };
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
    await controller.buscarEntregaPorIdController({ params: { id: "2" }, query: {}, user: interno }, res);
    ok("GET /:id de cliente fora da carteira -> 403", res.statusCode === 403 && res.body.code === "CLIENTE_FORA_DA_CARTEIRA");
  }
  {
    const res = fakeRes();
    await controller.buscarEntregaPorIdController({ params: { id: "1" }, query: {}, user: interno }, res);
    ok("GET /:id do cliente da carteira -> 200", res.statusCode === 200 && res.body.ok === true);
  }
  {
    const res = fakeRes();
    await controller.criarEntregaController({ body: { cliente_slug: "cli-20", tipo: "fechamento" }, user: interno }, res);
    ok("POST / com cliente_slug fora da carteira -> 403", res.statusCode === 403 && res.body.code === "CLIENTE_FORA_DA_CARTEIRA");
  }
  {
    const res = fakeRes();
    await controller.listarEntregasController({ query: {}, user: interno }, res);
    ok("GET / lista -> só entregas do portfolio", res.body.ok === true && res.body.entregas.every((e) => e.cliente_id === 10));
    ok("GET / lista -> total tambem respeita a carteira (era o total global)", res.body.total === 1);
  }
  {
    const res = fakeRes();
    await controller.listarEntregasController({ query: {}, user: admin }, res);
    ok("GET / lista admin -> todas", res.body.entregas.length === 2);
    ok("GET / lista admin -> total global", res.body.total === 2);
  }

  // P2.7 BLOCO L — entrega ORFA (cliente_id NULL) pulava a autorizacao inteira.
  // A FK e ON DELETE SET NULL, entao apagar um cliente PRODUZ orfas.
  {
    ENTREGAS[3] = { id: 3, cliente_id: null, cliente_slug: null, tipo: "fechamento", status: "rascunho" };
    const res = fakeRes();
    await controller.buscarEntregaPorIdController({ params: { id: "3" }, query: {}, user: interno }, res);
    ok("GET /:id de entrega orfa -> 403 para papel interno (era 200)", res.statusCode === 403 && res.body.code === "ENTREGA_SEM_CLIENTE");

    const resDel = fakeRes();
    await controller.publicarEntregaController({ params: { id: "3" }, user: interno }, resDel);
    ok("publicar entrega orfa -> 403 para papel interno", resDel.statusCode === 403);

    const resAdmin = fakeRes();
    await controller.buscarEntregaPorIdController({ params: { id: "3" }, query: {}, user: admin }, resAdmin);
    ok("GET /:id de entrega orfa -> 200 so para admin (bypass canonico)", resAdmin.statusCode === 200 && resAdmin.body.ok === true);
    delete ENTREGAS[3];
  }
  {
    const res = fakeRes();
    await controller.publicarEntregaController({ params: { id: "2" }, user: interno }, res);
    ok("POST /:id/publicar fora da carteira -> 403", res.statusCode === 403);
  }

  pool.query = original;
  console.log(`\nauthzEntregasCliente.test.js: ${checks} verificações passaram.`);
}

run().catch((e) => { console.error(e); process.exitCode = 1; });
