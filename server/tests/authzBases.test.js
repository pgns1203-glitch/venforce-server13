// server/tests/authzBases.test.js
//
// P2.1 — cobertura de carteira das Bases de custo.
//   assertBaseNaCarteira: acessa a base quem cobre >=1 cliente vinculado
//   (admin bypass; base órfã liberada às roles internas).
//   baseVinculosController: lista só as linhas da carteira.
//
// Mundo: base 100 -> cliente 10 (na carteira do user 1)
//        base 200 -> cliente 20 (fora)
//        base 300 -> sem vínculo ativo (órfã)

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");

let checks = 0;
function ok(label, cond) { assert.ok(cond, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); }
function fakeRes() {
  return { statusCode: 200, body: null, status(c){this.statusCode=c;return this;}, json(b){this.body=b;return this;} };
}

const VINC = {
  100: [{ cliente_id: 10 }],
  200: [{ cliente_id: 20 }],
  300: [],
};

function mock(sql, params = []) {
  const q = String(sql).replace(/\s+/g, " ").trim();
  if (q.includes("authz:RESOLVE_BASE_ID")) {
    const id = Number(params[0]);
    return { rows: [100, 200, 300].includes(id) ? [{ id, slug: `base-${id}`, nome: `Base ${id}` }] : [] };
  }
  if (q.includes("authz:RESOLVE_BASE_SLUG")) {
    const m = String(params[0]).match(/^base-(\d+)$/);
    return { rows: m ? [{ id: Number(m[1]), slug: params[0], nome: `Base ${m[1]}` }] : [] };
  }
  if (q.includes("authz:BASE_CLIENTES_VINCULADOS")) {
    return { rows: VINC[Number(params[0])] || [] };
  }
  if (q.includes("authz:PORTFOLIO_ADMIN_ALL")) return { rows: [{ id: 10 }, { id: 20 }] };
  if (q.includes("authz:PORTFOLIO_INTERNAL_BY_SQUAD")) return { rows: [{ id: 10 }] };
  if (q.includes("authz:PORTFOLIO_SELLER")) return { rows: [] };
  if (q.includes("FROM bases b") && q.includes("LEFT JOIN base_cliente_vinculos")) {
    return { rows: [
      { id: 100, slug: "base-100", nome: "Base 100", ativo: true, vinculo_id: 1, cliente_id: 10, cliente_slug: "cli-10", cliente_nome: "Cli 10" },
      { id: 200, slug: "base-200", nome: "Base 200", ativo: true, vinculo_id: 2, cliente_id: 20, cliente_slug: "cli-20", cliente_nome: "Cli 20" },
      { id: 300, slug: "base-300", nome: "Base 300", ativo: true, vinculo_id: null, cliente_id: null },
    ] };
  }
  if (q.startsWith("SELECT id, nome, slug FROM clientes WHERE ativo = true") || q.includes("clientes disponiveis") || q.includes("FROM clientes")) {
    return { rows: [{ id: 10, nome: "Cli 10" }, { id: 20, nome: "Cli 20" }] };
  }
  return { rows: [] };
}

async function run() {
  const original = pool.query;
  pool.query = async (sql, params) => mock(sql, params);

  const authz = require("../services/squads/authorizationService");
  const interno = { id: 1, role: "membro" };
  const admin = { id: 9, role: "admin" };

  // assertBaseNaCarteira
  {
    const b = await authz.assertBaseNaCarteira(interno, "100", { bySlug: false });
    ok("base que cobre cliente da carteira -> ok", b.baseId === 100);
  }
  {
    let e = null;
    try { await authz.assertBaseNaCarteira(interno, "200", { bySlug: false }); } catch (err) { e = err; }
    ok("base de cliente fora da carteira -> 403", e && e.statusCode === 403 && e.code === "CLIENTE_FORA_DA_CARTEIRA");
  }
  {
    const b = await authz.assertBaseNaCarteira(interno, "300", { bySlug: false });
    ok("base órfã -> liberada a role interna", b.baseId === 300);
  }
  {
    const b = await authz.assertBaseNaCarteira(admin, "200", { bySlug: false });
    ok("admin -> qualquer base", b.baseId === 200);
  }
  {
    let e = null;
    try { await authz.assertBaseNaCarteira(interno, "999", { bySlug: false }); } catch (err) { e = err; }
    ok("base inexistente -> 404", e && e.statusCode === 404);
  }
  {
    const b = await authz.assertBaseNaCarteira(interno, "base-100", { bySlug: true });
    ok("resolve por slug", b.baseId === 100);
  }

  // baseVinculosController.listar — filtra por carteira
  {
    delete require.cache[require.resolve("../controllers/baseVinculosController")];
    const controller = require("../controllers/baseVinculosController");
    const res = fakeRes();
    await controller.listar({ user: interno }, res);
    const ids = res.body.bases.map((b) => b.id).sort();
    ok("listar (interno) -> base da carteira + órfã, nunca a de fora", JSON.stringify(ids) === JSON.stringify([100, 300]));

    const res2 = fakeRes();
    await controller.listar({ user: admin }, res2);
    ok("listar (admin) -> todas as bases", res2.body.bases.length === 3);
  }

  pool.query = original;
  console.log(`\nauthzBases.test.js: ${checks} verificações passaram.`);
}

run().catch((e) => { console.error(e); process.exitCode = 1; });
