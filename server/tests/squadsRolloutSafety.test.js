// server/tests/squadsRolloutSafety.test.js
//
// VenForce V3 — P2.2 (Rollout Safety).
//
// Cobre o interruptor SQUADS_ENFORCEMENT e o efeito dele na fonte única de
// autorização (authorizationService):
//
//   - parsing do flag: ausente / on / true / off / false / inválido
//   - enforcement OFF  → papel interno enxerga TODOS os clientes ativos
//                        (nunca carteira vazia por falta de migração)
//   - enforcement ON   → carteira real por Squad (Alpha não vê Beta;
//                        interno sem membership → []/403)
//   - admin  → bypass idêntico nos dois estados
//   - seller → seller_clientes idêntico nos dois estados (flag não toca)
//   - multi-Squad → união dos Squads ativos (só com ON)
//
// Sem Postgres real: mock de pool.query casando por marcador /* authz:... */.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// ─────────────────────────── modelo em memória ───────────────────────────
// Clientes 1,2 → Squad Alpha (10). Cliente 3 → Squad Beta (20).
// Cliente 4 → sem squad (é do seller). Cliente 5 → Squad Inativo (30).
// User 100 = interno só Alpha. User 300 = interno Alpha+Beta (multi).
// User 400 = interno sem membership. User 900 = seller do cliente 4.
const M = {
  clientes: [
    { id: 1, slug: "cli-a", nome: "Cliente A", ativo: true },
    { id: 2, slug: "cli-b", nome: "Cliente B", ativo: true },
    { id: 3, slug: "cli-c", nome: "Cliente C", ativo: true },
    { id: 4, slug: "cli-s", nome: "Cliente Seller", ativo: true },
    { id: 5, slug: "cli-g", nome: "Cliente Gamma", ativo: true },
    { id: 6, slug: "cli-x", nome: "Cliente Inativo", ativo: false },
  ],
  squads: [
    { id: 10, ativo: true },
    { id: 20, ativo: true },
    { id: 30, ativo: false },
  ],
  members: [
    { squad_id: 10, user_id: 100, ativo: true },
    { squad_id: 10, user_id: 300, ativo: true },
    { squad_id: 20, user_id: 300, ativo: true },
    { squad_id: 30, user_id: 400, ativo: true }, // só squad inativo
  ],
  history: [
    { cliente_id: 1, squad_id: 10, fim_em: null },
    { cliente_id: 2, squad_id: 10, fim_em: null },
    { cliente_id: 3, squad_id: 20, fim_em: null },
    { cliente_id: 5, squad_id: 30, fim_em: null },
  ],
  sellerClientes: [{ user_id: 900, cliente_id: 4, ativo: true }],
};

function mock(sql, params = []) {
  const q = String(sql).replace(/\s+/g, " ");

  if (/^(CREATE|ALTER|DROP|BEGIN|COMMIT|DO )/i.test(q.trim())) return { rows: [] };

  // ── enforcement OFF ──
  if (q.includes("authz:PORTFOLIO_INTERNAL_ENFORCEMENT_OFF") || q.includes("authz:PORTFOLIO_ADMIN_ALL")) {
    return { rows: M.clientes.filter((c) => c.ativo).map(({ id, slug, nome }) => ({ id, slug, nome })) };
  }
  if (q.includes("authz:CAN_ACCESS_ENFORCEMENT_OFF") || q.includes("authz:CAN_ACCESS_ADMIN")) {
    const c = M.clientes.find((x) => x.id === Number(params[0]));
    return { rows: c ? [{ "?column?": 1 }] : [] };
  }

  // ── enforcement ON: interno por squad ──
  if (q.includes("authz:PORTFOLIO_INTERNAL_BY_SQUAD")) {
    const uid = Number(params[0]);
    const squads = M.members
      .filter((m) => m.user_id === uid && m.ativo)
      .map((m) => m.squad_id)
      .filter((sid) => (M.squads.find((s) => s.id === sid) || {}).ativo);
    const set = new Set(squads);
    const rows = M.clientes
      .filter((c) => c.ativo)
      .filter((c) => {
        const h = M.history.find((r) => r.cliente_id === c.id && r.fim_em === null);
        return h && set.has(h.squad_id);
      })
      .map(({ id, slug, nome }) => ({ id, slug, nome }));
    return { rows };
  }
  if (q.includes("authz:CAN_ACCESS_INTERNAL")) {
    const uid = Number(params[0]);
    const cid = Number(params[1]);
    const squads = M.members
      .filter((m) => m.user_id === uid && m.ativo)
      .map((m) => m.squad_id)
      .filter((sid) => (M.squads.find((s) => s.id === sid) || {}).ativo);
    const set = new Set(squads);
    const h = M.history.find((r) => r.cliente_id === cid && r.fim_em === null);
    return { rows: h && set.has(h.squad_id) ? [{ "?column?": 1 }] : [] };
  }

  // ── seller ──
  if (q.includes("authz:PORTFOLIO_SELLER")) {
    const uid = Number(params[0]);
    const ids = M.sellerClientes.filter((s) => s.user_id === uid && s.ativo).map((s) => s.cliente_id);
    return { rows: M.clientes.filter((c) => c.ativo && ids.includes(c.id)).map(({ id, slug, nome }) => ({ id, slug, nome })) };
  }
  if (q.includes("authz:CAN_ACCESS_SELLER")) {
    const [uid, cid] = params;
    const hit = M.sellerClientes.some((s) => s.user_id === Number(uid) && s.cliente_id === Number(cid) && s.ativo);
    return { rows: hit ? [{ "?column?": 1 }] : [] };
  }

  // ── resolverClienteRef ──
  if (q.includes("authz:RESOLVE_CLIENTE_ID")) {
    const c = M.clientes.find((x) => x.id === Number(params[0]));
    return { rows: c ? [c] : [] };
  }
  if (q.includes("authz:RESOLVE_CLIENTE_SLUG")) {
    const c = M.clientes.find((x) => x.slug === String(params[0]));
    return { rows: c ? [c] : [] };
  }

  return { rows: [] };
}

async function comEnforcement(valor, fn) {
  const antes = process.env.SQUADS_ENFORCEMENT;
  if (valor === undefined) delete process.env.SQUADS_ENFORCEMENT;
  else process.env.SQUADS_ENFORCEMENT = valor;
  try {
    return await fn();
  } finally {
    if (antes === undefined) delete process.env.SQUADS_ENFORCEMENT;
    else process.env.SQUADS_ENFORCEMENT = antes;
  }
}

async function run() {
  const originalQuery = pool.query;
  pool.query = async (sql, params) => mock(sql, params);

  const enforcementCfg = require("../config/squadsEnforcement");
  const authz = require("../services/squads/authorizationService");

  const admin = { id: 9, role: "admin" };
  const interno100 = { id: 100, role: "membro" }; // só Alpha
  const interno300 = { id: 300, role: "user" };   // Alpha + Beta
  const interno400 = { id: 400, role: "membro" }; // sem membership válida
  const seller = { id: 900, role: "seller" };

  // ───────────── 1. parsing do flag ─────────────
  await comEnforcement(undefined, () => {
    enforcementCfg._resetParaTeste();
    ok("flag ausente → OFF", enforcementCfg.isEnforcementEnabled() === false);
  });
  await comEnforcement("on", () => ok('flag "on" → ON', enforcementCfg.isEnforcementEnabled() === true));
  await comEnforcement("true", () => ok('flag "true" → ON', enforcementCfg.isEnforcementEnabled() === true));
  await comEnforcement("ON", () => ok('flag "ON" (case) → ON', enforcementCfg.isEnforcementEnabled() === true));
  await comEnforcement("off", () => ok('flag "off" → OFF', enforcementCfg.isEnforcementEnabled() === false));
  await comEnforcement("false", () => ok('flag "false" → OFF', enforcementCfg.isEnforcementEnabled() === false));
  await comEnforcement("", () => ok('flag "" → OFF', enforcementCfg.isEnforcementEnabled() === false));
  await comEnforcement("talvez", () => {
    enforcementCfg._resetParaTeste();
    ok('flag inválida "talvez" → OFF (fail-safe)', enforcementCfg.isEnforcementEnabled() === false);
  });
  await comEnforcement("on", () => {
    const d = enforcementCfg.describeEnforcement();
    ok("describeEnforcement expõe envRaw + enabled", d.envRaw === "on" && d.enabled === true);
  });

  // ───────────── 2. enforcement OFF — interno vê tudo ─────────────
  await comEnforcement("off", async () => {
    const p100 = await authz.resolvePortfolioClientes(interno100);
    ok("OFF: interno (só Alpha) → portfolio = todos os clientes ativos", p100.length === 5);
    const p400 = await authz.resolvePortfolioClientes(interno400);
    ok("OFF: interno SEM membership → portfolio NÃO vazio (5 ativos)", p400.length === 5);
    ok("OFF: interno acessa cliente de outro squad (id 3)", (await authz.canAccessCliente(interno100, 3)) === true);
    ok("OFF: interno acessa cliente sem squad (id 4)", (await authz.canAccessCliente(interno100, 4)) === true);
    ok("OFF: interno NÃO acessa cliente inexistente (id 999)", (await authz.canAccessCliente(interno100, 999)) === false);
    const cli = await authz.assertClienteNaCarteira(interno400, "cli-c");
    ok("OFF: assertClienteNaCarteira não lança 403 (retorna cliente)", cli && cli.id === 3);
  });

  // ───────────── 3. enforcement ON — carteira real ─────────────
  await comEnforcement("on", async () => {
    const p100 = await authz.resolvePortfolioClientes(interno100);
    ok("ON: interno Alpha → só clientes de Alpha (1,2)", p100.length === 2 && p100.every((c) => [1, 2].includes(c.id)));
    const p300 = await authz.resolvePortfolioClientes(interno300);
    ok("ON: interno multi-Squad (Alpha+Beta) → 1,2,3", p300.map((c) => c.id).sort().join(",") === "1,2,3");
    const p400 = await authz.resolvePortfolioClientes(interno400);
    ok("ON: interno sem membership válida → carteira VAZIA", p400.length === 0);
    ok("ON: interno Alpha acessa cliente 1", (await authz.canAccessCliente(interno100, 1)) === true);
    ok("ON: interno Alpha NÃO acessa cliente 3 (Beta)", (await authz.canAccessCliente(interno100, 3)) === false);
    ok("ON: interno em squad inativo NÃO acessa cliente 5", (await authz.canAccessCliente(interno400, 5)) === false);
    let e = null;
    try { await authz.assertClienteNaCarteira(interno100, "cli-c"); } catch (err) { e = err; }
    ok("ON: assertClienteNaCarteira → 403 CLIENTE_FORA_DA_CARTEIRA", e && e.statusCode === 403 && e.code === "CLIENTE_FORA_DA_CARTEIRA");
  });

  // ───────────── 4. admin — idêntico nos dois estados ─────────────
  for (const flag of ["off", "on"]) {
    await comEnforcement(flag, async () => {
      const p = await authz.resolvePortfolioClientes(admin);
      ok(`admin (${flag}) → todos os clientes ativos (5)`, p.length === 5);
      ok(`admin (${flag}) → canAccessCliente qualquer id existente`, (await authz.canAccessCliente(admin, 3)) === true);
    });
  }

  // ───────────── 5. seller — idêntico nos dois estados (flag não toca) ─────────────
  for (const flag of ["off", "on"]) {
    await comEnforcement(flag, async () => {
      const p = await authz.resolvePortfolioClientes(seller);
      ok(`seller (${flag}) → só seller_clientes (cliente 4)`, p.length === 1 && p[0].id === 4);
      ok(`seller (${flag}) → NÃO acessa cliente fora de seller_clientes`, (await authz.canAccessCliente(seller, 1)) === false);
      ok(`seller (${flag}) → acessa cliente 4`, (await authz.canAccessCliente(seller, 4)) === true);
    });
  }

  pool.query = originalQuery;
  console.log(`\nsquadsRolloutSafety.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
