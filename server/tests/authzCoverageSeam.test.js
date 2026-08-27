// server/tests/authzCoverageSeam.test.js
//
// P2.1 — fundação do seam de cobertura de autorização dos módulos legados.
//
// Cobre:
//   - authorizationService.assertClienteContaNaCarteira (conta -> cliente -> canAccessCliente)
//   - carteiraMiddleware.requireClienteNaCarteira aceitando { param | query | body }
//   - carteiraMiddleware.requireClienteContaNaCarteira (id de conta na rota)
//
// Padrão do repo: sem Postgres real; mocka pool.query casando por marcador SQL.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");

let checks = 0;
function ok(label, cond) { assert.ok(cond, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); }

const authz = require("../services/squads/authorizationService");
const {
  requireClienteNaCarteira,
  requireClienteContaNaCarteira,
} = require("../middlewares/carteiraMiddleware");

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

// Mundo de teste:
//   Conta 42 -> Cliente 3 (slug cli-3, ativo)
//   Conta 99 -> Cliente 7 (slug cli-7, ativo)
//   User interno 1 acessa o Cliente 3, NÃO acessa o 7.
function mockMundo(sql, params) {
  const q = String(sql).replace(/\s+/g, " ");
  if (q.includes("authz:RESOLVE_CLIENTE_CONTA")) {
    const id = Number(params[0]);
    if (id === 42) return { rows: [{ conta_id: 42, cliente_id: 3, slug: "cli-3", nome: "Cli 3", ativo: true }] };
    if (id === 99) return { rows: [{ conta_id: 99, cliente_id: 7, slug: "cli-7", nome: "Cli 7", ativo: true }] };
    return { rows: [] };
  }
  if (q.includes("authz:RESOLVE_CLIENTE_SLUG")) {
    const slug = String(params[0]);
    if (slug === "cli-3") return { rows: [{ id: 3, slug: "cli-3", nome: "Cli 3", ativo: true }] };
    if (slug === "cli-7") return { rows: [{ id: 7, slug: "cli-7", nome: "Cli 7", ativo: true }] };
    return { rows: [] };
  }
  if (q.includes("authz:RESOLVE_CLIENTE_ID")) {
    const id = Number(params[0]);
    if (id === 3) return { rows: [{ id: 3, slug: "cli-3", nome: "Cli 3", ativo: true }] };
    if (id === 7) return { rows: [{ id: 7, slug: "cli-7", nome: "Cli 7", ativo: true }] };
    return { rows: [] };
  }
  if (q.includes("authz:CAN_ACCESS_ADMIN")) return { rows: [{ "?column?": 1 }] };
  if (q.includes("authz:CAN_ACCESS_INTERNAL")) {
    const cid = Number(params[1]);
    return { rows: cid === 3 ? [{ "?column?": 1 }] : [] };
  }
  return { rows: [] };
}

async function run() {
  const originalQuery = pool.query;
  pool.query = async (sql, params = []) => mockMundo(sql, params);

  const userAdmin = { id: 9, role: "admin" };
  const userInterno = { id: 1, role: "membro" };

  // ── assertClienteContaNaCarteira ──
  {
    let e = null;
    try { await authz.assertClienteContaNaCarteira(userInterno, 123456); } catch (err) { e = err; }
    ok("conta inexistente -> lança", e !== null);
    ok("conta inexistente -> 404", e && e.statusCode === 404);
    ok("conta inexistente -> CLIENTE_NAO_ENCONTRADO", e && e.code === "CLIENTE_NAO_ENCONTRADO");
  }
  {
    const ctx = await authz.assertClienteContaNaCarteira(userAdmin, 99);
    ok("admin -> retorna contexto da conta", ctx && ctx.clienteId === 7 && ctx.contaId === 99);
  }
  {
    let e = null;
    try { await authz.assertClienteContaNaCarteira(userInterno, 99); } catch (err) { e = err; }
    ok("interno fora da carteira -> 403", e && e.statusCode === 403);
    ok("interno fora da carteira -> CLIENTE_FORA_DA_CARTEIRA", e && e.code === "CLIENTE_FORA_DA_CARTEIRA");
  }
  {
    const ctx = await authz.assertClienteContaNaCarteira(userInterno, 42);
    ok("interno na carteira -> retorna contexto", ctx && ctx.clienteId === 3);
  }

  // ── requireClienteNaCarteira({ query }) ──
  {
    const mw = requireClienteNaCarteira({ query: "clienteSlug" });
    const req = { params: {}, query: { clienteSlug: "cli-7" }, user: userInterno };
    const res = fakeRes();
    let next = false;
    await mw(req, res, () => { next = true; });
    ok("query: fora da carteira -> não chama next", next === false);
    ok("query: fora da carteira -> 403 CLIENTE_FORA_DA_CARTEIRA", res.statusCode === 403 && res.body.code === "CLIENTE_FORA_DA_CARTEIRA");
  }
  {
    const mw = requireClienteNaCarteira({ query: "clienteSlug" });
    const req = { params: {}, query: { clienteSlug: "cli-3" }, user: userInterno };
    const res = fakeRes();
    let next = false;
    await mw(req, res, () => { next = true; });
    ok("query: na carteira -> next + req.clienteAutorizado", next === true && req.clienteAutorizado.id === 3);
  }
  {
    // ref ausente: middleware não inventa 404 — deixa o controller emitir seu 400.
    const mw = requireClienteNaCarteira({ query: "clienteSlug" });
    const req = { params: {}, query: {}, user: userInterno };
    const res = fakeRes();
    let next = false;
    await mw(req, res, () => { next = true; });
    ok("query: ref ausente -> pass-through (next, sem responder)", next === true && res.statusCode === 200);
  }
  {
    const mw = requireClienteNaCarteira({ body: "clienteSlug" });
    const req = { params: {}, query: {}, body: { clienteSlug: "cli-3" }, user: userInterno };
    const res = fakeRes();
    let next = false;
    await mw(req, res, () => { next = true; });
    ok("body: na carteira -> next", next === true && req.clienteAutorizado.id === 3);
  }
  {
    // fallback: aceita query OU body na mesma definição
    const mw = requireClienteNaCarteira({ query: "clienteSlug", body: "clienteSlug" });
    const req = { params: {}, query: {}, body: { clienteSlug: "cli-7" }, user: userInterno };
    const res = fakeRes();
    let next = false;
    await mw(req, res, () => { next = true; });
    ok("query|body fallback: usa body quando query vazio -> 403", next === false && res.statusCode === 403);
  }
  {
    // retrocompat: string = nome de param
    const mw = requireClienteNaCarteira("cliente");
    const req = { params: { cliente: "cli-3" }, query: {}, user: userInterno };
    const res = fakeRes();
    let next = false;
    await mw(req, res, () => { next = true; });
    ok("retrocompat: string continua lendo req.params", next === true && req.clienteAutorizado.id === 3);
  }

  // ── requireClienteContaNaCarteira ──
  {
    const mw = requireClienteContaNaCarteira("id");
    const req = { params: { id: "99" }, user: userInterno };
    const res = fakeRes();
    let next = false;
    await mw(req, res, () => { next = true; });
    ok("conta de cliente fora da carteira -> 403", next === false && res.statusCode === 403 && res.body.code === "CLIENTE_FORA_DA_CARTEIRA");
  }
  {
    const mw = requireClienteContaNaCarteira("id");
    const req = { params: { id: "42" }, user: userInterno };
    const res = fakeRes();
    let next = false;
    await mw(req, res, () => { next = true; });
    ok("conta de cliente na carteira -> next + req.contaAutorizada + req.clienteAutorizado", next === true && req.contaAutorizada.contaId === 42 && req.clienteAutorizado.id === 3);
  }
  {
    const mw = requireClienteContaNaCarteira("clienteContaId");
    const req = { params: { clienteContaId: "777" }, user: userInterno };
    const res = fakeRes();
    await mw(req, res, () => {});
    ok("conta inexistente -> 404 CLIENTE_NAO_ENCONTRADO", res.statusCode === 404 && res.body.code === "CLIENTE_NAO_ENCONTRADO");
  }
  {
    const mw = requireClienteContaNaCarteira("clienteContaId");
    const req = { params: {}, user: userInterno };
    const res = fakeRes();
    let next = false;
    await mw(req, res, () => { next = true; });
    ok("id de conta ausente -> pass-through", next === true && res.statusCode === 200);
  }

  pool.query = originalQuery;
  console.log(`\nauthzCoverageSeam.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
