// server/tests/squadsMiddlewareEAuditoria.test.js
//
// - requireClienteNaCarteira: shape da resposta 403/404 (mission §15).
// - squadsMigracaoService.auditoria: relatório de pendências (mission §28).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");

let checks = 0;
function ok(label, cond) { assert.ok(cond, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); }

const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
const migracao = require("../services/squads/squadsMigracaoService");

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

async function run() {
  const originalQuery = pool.query;

  // ── middleware: cliente fora da carteira -> 403 { code } ──
  pool.query = async (sql) => {
    const q = String(sql).replace(/\s+/g, " ");
    if (q.includes("authz:RESOLVE_CLIENTE_SLUG")) return { rows: [{ id: 7, slug: "beta-cli", nome: "Beta Cli", ativo: true }] };
    if (q.includes("authz:CAN_ACCESS_INTERNAL")) return { rows: [] };
    return { rows: [] };
  };
  {
    const mw = requireClienteNaCarteira("cliente");
    const req = { params: { cliente: "beta-cli" }, user: { id: 1, role: "membro" } };
    const res = fakeRes();
    let chamouNext = false;
    await mw(req, res, () => { chamouNext = true; });
    ok("não chama next quando fora da carteira", chamouNext === false);
    ok("responde 403", res.statusCode === 403);
    ok("code = CLIENTE_FORA_DA_CARTEIRA", res.body && res.body.code === "CLIENTE_FORA_DA_CARTEIRA");
    ok("ok:false", res.body.ok === false);
  }

  // ── middleware: cliente inexistente -> 404 ──
  pool.query = async (sql) => {
    const q = String(sql).replace(/\s+/g, " ");
    if (q.includes("authz:RESOLVE_CLIENTE_SLUG")) return { rows: [] };
    return { rows: [] };
  };
  {
    const mw = requireClienteNaCarteira("cliente");
    const req = { params: { cliente: "nao-existe" }, user: { id: 1, role: "membro" } };
    const res = fakeRes();
    await mw(req, res, () => {});
    ok("cliente inexistente -> 404", res.statusCode === 404);
    ok("code = CLIENTE_NAO_ENCONTRADO", res.body.code === "CLIENTE_NAO_ENCONTRADO");
  }

  // ── middleware: autorizado -> next + req.clienteAutorizado ──
  pool.query = async (sql) => {
    const q = String(sql).replace(/\s+/g, " ");
    if (q.includes("authz:RESOLVE_CLIENTE_ID")) return { rows: [{ id: 3, slug: "cli-3", nome: "Cli 3", ativo: true }] };
    if (q.includes("authz:CAN_ACCESS_ADMIN")) return { rows: [{ "?column?": 1 }] };
    return { rows: [] };
  };
  {
    const mw = requireClienteNaCarteira("cliente");
    const req = { params: { cliente: "3" }, user: { id: 1, role: "admin" } };
    const res = fakeRes();
    let chamouNext = false;
    await mw(req, res, () => { chamouNext = true; });
    ok("admin autorizado -> next()", chamouNext === true);
    ok("req.clienteAutorizado preenchido", req.clienteAutorizado && req.clienteAutorizado.id === 3);
  }

  // ── auditoria de migração ──
  pool.query = async (sql, params) => {
    const q = String(sql).replace(/\s+/g, " ");
    if (/^(CREATE|ALTER|DROP|DO |BEGIN|COMMIT)/i.test(q.trim())) return { rows: [] };
    if (q.includes("squads:AUDIT_CLIENTES ")) return { rows: [{ ativos: 10, com_squad: 7, sem_squad: 3 }] };
    if (q.includes("squads:AUDIT_CLIENTES_SEM_SQUAD")) return { rows: [{ id: 8, slug: "x", nome: "X" }, { id: 9, slug: "y", nome: "Y" }, { id: 11, slug: "z", nome: "Z" }] };
    if (q.includes("squads:AUDIT_USUARIOS")) return { rows: [{ internos: 6, com_membership: 4, sem_membership: 2, com_multiplas: 1, sem_principal: 0 }] };
    if (q.includes("squads:AUDIT_PRINCIPAL_DUPLICADO")) return { rows: [] };
    return { rows: [] };
  };
  {
    const r = await migracao.auditoria();
    ok("clientesAtivos.semSquad = 3", r.clientesAtivos.semSquad === 3);
    ok("listaSemSquad com 3 itens", r.clientesAtivos.listaSemSquad.length === 3);
    ok("usuariosInternos.semMembership = 2", r.usuariosInternos.semMembership === 2);
    ok("usuariosInternos.comMultiplasMemberships = 1", r.usuariosInternos.comMultiplasMemberships === 1);
    ok("comPrincipalDuplicado = 0", r.usuariosInternos.comPrincipalDuplicado === 0);
    ok("pronto = false (há pendências)", r.pronto === false);
  }

  pool.query = originalQuery;
  console.log(`\nsquadsMiddlewareEAuditoria.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
