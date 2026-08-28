// server/tests/squadsIsolamento.test.js
//
// Testes de isolamento por Squad (VenForce V3, mission §31-§37, §44).
//
// Sem Postgres real: um modelo em memória (squads, squad_members,
// cliente_squad_history, clientes, seller_clientes) responde às queries
// marcadas /* authz:... */ e /* squads:... */ e às queries do meService.
// A lógica de join é reimplementada no mock a partir dos arrays — se o SQL
// de produção divergir do modelo, o teste continua exercitando o contrato
// do service (resolvePortfolioClientes / canAccessCliente / meService).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";
// P2.2 — isolamento por Squad só vale COM enforcement ativo (o estado OFF é
// coberto por squadsRolloutSafety.test.js).
process.env.SQUADS_ENFORCEMENT = "on";

const assert = require("assert");
const pool = require("../config/database");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// ─────────────────────────── modelo em memória ───────────────────────────

function novoModelo() {
  return {
    clientes: [
      { id: 1, slug: "cliente-a", nome: "Cliente A", ativo: true },
      { id: 2, slug: "cliente-b", nome: "Cliente B", ativo: true },
      { id: 3, slug: "cliente-c", nome: "Cliente C", ativo: true },
      { id: 4, slug: "cliente-s", nome: "Cliente Seller", ativo: true },
      { id: 5, slug: "cliente-gamma", nome: "Cliente Gamma", ativo: true },
    ],
    squads: [
      { id: 10, nome: "Squad Alpha", slug: "alpha", ativo: true },
      { id: 20, nome: "Squad Beta", slug: "beta", ativo: true },
      { id: 30, nome: "Squad Inativo", slug: "inativo", ativo: false },
    ],
    // user_id -> [{squad_id, is_primary, funcao, ativo}]
    members: [
      { squad_id: 10, user_id: 100, is_primary: true, funcao: "membro", ativo: true }, // Alpha
      { squad_id: 20, user_id: 200, is_primary: true, funcao: "coordenador", ativo: true }, // Beta
      // Multi: principal Alpha, adicional Beta
      { squad_id: 10, user_id: 300, is_primary: true, funcao: "membro", ativo: true },
      { squad_id: 20, user_id: 300, is_primary: false, funcao: "membro", ativo: true },
      // user 400: só no Squad Inativo
      { squad_id: 30, user_id: 400, is_primary: true, funcao: "membro", ativo: true },
    ],
    // cliente_squad_history (fim_em null = ativo)
    history: [
      { id: 1, cliente_id: 1, squad_id: 10, fim_em: null }, // A -> Alpha
      { id: 2, cliente_id: 2, squad_id: 10, fim_em: null }, // B -> Alpha
      { id: 3, cliente_id: 3, squad_id: 20, fim_em: null }, // C -> Beta
      { id: 4, cliente_id: 5, squad_id: 30, fim_em: null }, // Gamma -> Squad Inativo
      // cliente-s (4) sem squad — é seller
    ],
    sellerClientes: [
      { user_id: 900, cliente_id: 4, ativo: true },
    ],
    contas: [], // cliente_contas
    responsaveis: [], // cliente_responsaveis
  };
}

function squadAtivoDoCliente(m, clienteId) {
  const h = m.history.find((r) => r.cliente_id === clienteId && r.fim_em === null);
  if (!h) return null;
  const s = m.squads.find((x) => x.id === h.squad_id);
  return { ...h, squad: s };
}

function portfolioInterno(m, userId) {
  const squadsDoUser = m.members
    .filter((mm) => mm.user_id === userId && mm.ativo)
    .map((mm) => mm.squad_id)
    .filter((sid) => (m.squads.find((s) => s.id === sid) || {}).ativo);
  const setSquads = new Set(squadsDoUser);
  return m.clientes
    .filter((c) => c.ativo)
    .filter((c) => {
      const h = m.history.find((r) => r.cliente_id === c.id && r.fim_em === null);
      return h && setSquads.has(h.squad_id);
    })
    .map((c) => ({ id: c.id, slug: c.slug, nome: c.nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

function instalarMock(m) {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;

  async function query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    // DDL / schema no-ops
    if (/^(CREATE|ALTER|DROP|BEGIN|COMMIT|ROLLBACK|DO )/i.test(q) || q.includes("pg_advisory")) {
      return { rows: [] };
    }

    // ── authz ──
    if (q.includes("authz:PORTFOLIO_ADMIN_ALL")) {
      return { rows: m.clientes.filter((c) => c.ativo).map(({ id, slug, nome }) => ({ id, slug, nome })) };
    }
    if (q.includes("authz:PORTFOLIO_SELLER")) {
      const uid = params[0];
      const ids = m.sellerClientes.filter((s) => s.user_id === uid && s.ativo).map((s) => s.cliente_id);
      return { rows: m.clientes.filter((c) => c.ativo && ids.includes(c.id)).map(({ id, slug, nome }) => ({ id, slug, nome })) };
    }
    if (q.includes("authz:PORTFOLIO_INTERNAL_BY_SQUAD")) {
      return { rows: portfolioInterno(m, params[0]) };
    }
    if (q.includes("authz:CAN_ACCESS_ADMIN")) {
      const c = m.clientes.find((x) => x.id === Number(params[0]));
      return { rows: c ? [{ "?column?": 1 }] : [] };
    }
    if (q.includes("authz:CAN_ACCESS_SELLER")) {
      const [uid, cid] = params;
      const hit = m.sellerClientes.some((s) => s.user_id === uid && s.cliente_id === Number(cid) && s.ativo);
      return { rows: hit ? [{ "?column?": 1 }] : [] };
    }
    if (q.includes("authz:CAN_ACCESS_INTERNAL")) {
      const [uid, cid] = params;
      const hit = portfolioInterno(m, uid).some((c) => c.id === Number(cid));
      return { rows: hit ? [{ "?column?": 1 }] : [] };
    }
    if (q.includes("authz:RESOLVE_CLIENTE_ID")) {
      return { rows: m.clientes.filter((c) => c.id === Number(params[0])) };
    }
    if (q.includes("authz:RESOLVE_CLIENTE_SLUG")) {
      return { rows: m.clientes.filter((c) => c.slug === params[0]) };
    }

    // ── squads repo ──
    if (q.includes("squads:MEMBERSHIPS_DO_USUARIO")) {
      const uid = params[0];
      return {
        rows: m.members
          .filter((mm) => mm.user_id === uid && mm.ativo)
          .map((mm) => {
            const s = m.squads.find((x) => x.id === mm.squad_id);
            return {
              id: mm.squad_id, squad_id: mm.squad_id, user_id: uid,
              is_primary: mm.is_primary, funcao: mm.funcao, ativo: mm.ativo,
              squad_nome: s.nome, squad_slug: s.slug, squad_ativo: s.ativo,
            };
          })
          .sort((a, b) => (b.is_primary - a.is_primary) || a.squad_nome.localeCompare(b.squad_nome)),
      };
    }
    if (q.includes("squads:SQUADS_ATIVOS_DE_CLIENTES")) {
      const ids = params[0] || [];
      return {
        rows: ids
          .map((cid) => squadAtivoDoCliente(m, cid))
          .filter(Boolean)
          .map((h) => ({
            cliente_id: h.cliente_id, squad_id: h.squad_id,
            squad_nome: h.squad.nome, squad_slug: h.squad.slug, squad_ativo: h.squad.ativo,
          })),
      };
    }
    if (q.includes("squads:RESPONSAVEIS_DE_CLIENTES")) {
      const ids = params[0] || [];
      const uid = params[1];
      return {
        rows: m.responsaveis
          .filter((r) => r.ativo && ids.includes(r.cliente_id) && (uid == null || r.user_id === uid))
          .map((r) => ({ cliente_id: r.cliente_id, user_id: r.user_id, papel: r.papel })),
      };
    }

    // ── meService: contagem de contas ativas ──
    if (q.startsWith("SELECT cliente_id, COUNT(*) FILTER (WHERE ativo = true)::int AS contas_ativas")) {
      const ids = params[0] || [];
      const map = new Map();
      for (const c of m.contas) {
        if (!ids.includes(c.cliente_id) || c.ativo === false) continue;
        map.set(c.cliente_id, (map.get(c.cliente_id) || 0) + 1);
      }
      return { rows: [...map.entries()].map(([cliente_id, contas_ativas]) => ({ cliente_id, contas_ativas })) };
    }

    // ── clienteContaService.listarContasDeClientesAtivos ──
    if (q.includes("FROM cliente_contas cc") && q.includes("cc.cliente_id = ANY($1::int[])")) {
      const ids = params[0] || [];
      return { rows: m.contas.filter((c) => ids.includes(c.cliente_id) && c.ativo !== false) };
    }

    // ── cliente360Service.getClientesOperacional (schema + readiness) ──
    if (q.startsWith("SELECT id, nome, slug, ativo FROM clientes WHERE ativo = true")) {
      return { rows: m.clientes.filter((c) => c.ativo) };
    }
    if (q.includes("FROM ml_tokens t") && q.includes("DISTINCT ON (t.cliente_id)")) return { rows: [] };
    if (q.includes("FROM base_cliente_vinculos v") && q.includes("DISTINCT v.cliente_id")) return { rows: [] };
    if (q.startsWith("SELECT cliente_id, sincronizado_em FROM cliente_360_resumos_mensais")) return { rows: [] };
    if (q.includes("FROM cliente_contas cc") && q.includes("LATERAL")) return { rows: [] };

    return { rows: [] };
  }

  pool.query = (sql, params) => query(sql, params);
  pool.connect = async () => ({ query: (sql, params) => query(sql, params), release() {} });

  return () => { pool.query = originalQuery; pool.connect = originalConnect; };
}

// ─────────────────────────────── testes ───────────────────────────────

const authz = require("../services/squads/authorizationService");
const meService = require("../services/meService");

const U = {
  alpha: { id: 100, role: "membro", nome: "Alpha" },
  beta: { id: 200, role: "membro", nome: "Beta" },
  multi: { id: 300, role: "membro", nome: "Multi" },
  soInativo: { id: 400, role: "membro", nome: "So Inativo" },
  semSquad: { id: 500, role: "user", nome: "Sem Squad" },
  admin: { id: 1, role: "admin", nome: "Admin" },
  seller: { id: 900, role: "seller", nome: "Seller" },
};

async function run() {
  const m = novoModelo();
  const restaurar = instalarMock(m);
  try {
    // ── §31: matriz de isolamento ──
    ok("Alpha -> Cliente A (id 1): 200", await authz.canAccessCliente(U.alpha, 1) === true);
    ok("Alpha -> Cliente B (id 2): 200", await authz.canAccessCliente(U.alpha, 2) === true);
    ok("Alpha -> Cliente C (id 3): 403", await authz.canAccessCliente(U.alpha, 3) === false);
    ok("Beta -> Cliente C: 200", await authz.canAccessCliente(U.beta, 3) === true);
    ok("Beta -> Cliente A: 403", await authz.canAccessCliente(U.beta, 1) === false);
    ok("Admin -> A/B/C: 200", (await authz.canAccessCliente(U.admin, 1)) && (await authz.canAccessCliente(U.admin, 2)) && (await authz.canAccessCliente(U.admin, 3)));
    ok("Seller -> Cliente S (id 4): 200", await authz.canAccessCliente(U.seller, 4) === true);
    ok("Seller -> Cliente A: 403", await authz.canAccessCliente(U.seller, 1) === false);

    // ── §44: usuário interno FORA do squad ──
    ok("interno sem membership -> canAccess QUALQUER cliente = false", await authz.canAccessCliente(U.semSquad, 1) === false);
    const portSemSquad = await authz.resolvePortfolioClientes(U.semSquad);
    ok("interno sem membership -> portfolio [] (NUNCA todos)", Array.isArray(portSemSquad) && portSemSquad.length === 0);

    // ── §30: squad inativo não dá acesso ──
    ok("membro só de squad INATIVO -> portfolio []", (await authz.resolvePortfolioClientes(U.soInativo)).length === 0);
    ok("membro só de squad INATIVO -> não acessa cliente do squad inativo (id 5)", await authz.canAccessCliente(U.soInativo, 5) === false);
    ok("cliente em squad inativo some da carteira de todos (admin ainda vê)", await authz.canAccessCliente(U.admin, 5) === true);

    // ── §32: multi-squad ──
    const portMulti = await authz.resolvePortfolioClientes(U.multi);
    ok("Multi (Alpha principal + Beta) vê A, B e C", portMulti.map((c) => c.id).sort().join(",") === "1,2,3");
    ok("Multi NÃO vê Gamma (id 5, outro squad)", !portMulti.some((c) => c.id === 5));

    // ── admin / seller portfolio ──
    ok("admin vê todos os 5 clientes ativos", (await authz.resolvePortfolioClientes(U.admin)).length === 5);
    ok("seller vê só o cliente do seller_clientes (1)", (await authz.resolvePortfolioClientes(U.seller)).map((c) => c.id).join(",") === "4");

    // ── assertClienteNaCarteira: erros canônicos ──
    let err1;
    try { await authz.assertClienteNaCarteira(U.alpha, "cliente-c"); } catch (e) { err1 = e; }
    ok("Alpha -> GET cliente-c => 403 CLIENTE_FORA_DA_CARTEIRA", err1 && err1.statusCode === 403 && err1.code === "CLIENTE_FORA_DA_CARTEIRA");
    let err2;
    try { await authz.assertClienteNaCarteira(U.alpha, "nao-existe"); } catch (e) { err2 = e; }
    ok("cliente inexistente => 404 CLIENTE_NAO_ENCONTRADO", err2 && err2.statusCode === 404 && err2.code === "CLIENTE_NAO_ENCONTRADO");
    const cli = await authz.assertClienteNaCarteira(U.alpha, "cliente-a");
    ok("Alpha -> GET cliente-a => resolve o cliente", cli && cli.id === 1);
    ok("assertClienteNaCarteira aceita id numérico", (await authz.assertClienteNaCarteira(U.beta, "3")).id === 3);

    // ── §19/§20: /me/context ──
    const ctxAlpha = await meService.obterContexto(U.alpha);
    ok("/me/context Alpha: 2 clientes (A, B)", ctxAlpha.clientes.length === 2);
    ok("/me/context Alpha: squads reais [Squad Alpha]", ctxAlpha.squads.length === 1 && ctxAlpha.squads[0].slug === "alpha");
    ok("/me/context Alpha: squad principal marcado", ctxAlpha.squads[0].principal === true && ctxAlpha.squadPrincipalId === 10);
    ok("/me/context Alpha: clientes[].squadId real (10)", ctxAlpha.clientes.every((c) => c.squadId === 10));
    ok("/me/context Alpha: portfolio.totalClientes = 2", ctxAlpha.portfolio.totalClientes === 2);

    const ctxSem = await meService.obterContexto(U.semSquad);
    ok("/me/context interno SEM squad: squads [] e clientes [] (200, não 500)", ctxSem.squads.length === 0 && ctxSem.clientes.length === 0);
    ok("/me/context interno SEM squad: totalClientes 0", ctxSem.portfolio.totalClientes === 0);

    const ctxMulti = await meService.obterContexto(U.multi);
    ok("/me/context Multi: 2 squads, principal = Alpha", ctxMulti.squads.length === 2 && ctxMulti.squads.find((s) => s.principal).slug === "alpha");
    ok("/me/context Multi: 3 clientes (principal != limite de acesso)", ctxMulti.clientes.length === 3);

    const ctxAdmin = await meService.obterContexto(U.admin);
    ok("/me/context admin: podeAdministrar true", ctxAdmin.permissoes.podeAdministrar === true);
    ok("/me/context admin: vê os 5 clientes", ctxAdmin.clientes.length === 5);

    // ── §21/§36: /me/portfolio ──
    const portfAlpha = await meService.obterPortfolio(U.alpha);
    ok("/me/portfolio Alpha: só A e B (nunca C nem Gamma)", portfAlpha.clientes.map((c) => c.id).sort().join(",") === "1,2");
    ok("/me/portfolio Alpha: cada cliente traz squad {id,nome,slug}", portfAlpha.clientes.every((c) => c.squad && c.squad.id === 10 && c.squad.slug === "alpha"));
    ok("/me/portfolio Alpha: principalParaUsuario true (Alpha é o principal)", portfAlpha.clientes.every((c) => c.squad.principalParaUsuario === true));
    ok("/me/portfolio Alpha: squads[] do usuário presente (1 -> frontend esconde filtro)", portfAlpha.squads.length === 1);

    const portfMulti = await meService.obterPortfolio(U.multi);
    ok("/me/portfolio Multi: A, B, C", portfMulti.clientes.map((c) => c.id).sort().join(",") === "1,2,3");
    ok("/me/portfolio Multi: C vem com squad Beta e principalParaUsuario false", portfMulti.clientes.find((c) => c.id === 3).squad.slug === "beta" && portfMulti.clientes.find((c) => c.id === 3).squad.principalParaUsuario === false);
    ok("/me/portfolio Multi: squads.length 2 -> frontend agrupa", portfMulti.squads.length === 2);

    const portfSeller = await meService.obterPortfolio(U.seller);
    ok("/me/portfolio seller: só cliente-s", portfSeller.clientes.map((c) => c.id).join(",") === "4");

    const portfSem = await meService.obterPortfolio(U.semSquad);
    ok("/me/portfolio interno sem squad: [] (não exceção)", Array.isArray(portfSem.clientes) && portfSem.clientes.length === 0);

    // ── segurança: sem token em nenhum payload ──
    const dump = JSON.stringify(ctxAlpha) + JSON.stringify(portfAlpha) + JSON.stringify(portfMulti);
    ok("nenhum access_token/refresh_token em /me/context nem /me/portfolio", !/access_token|refresh_token/i.test(dump));

    // ── §34: transferência muda acesso imediatamente (simulando o efeito no modelo) ──
    ok("antes: Alpha acessa B (id 2), Beta não", (await authz.canAccessCliente(U.alpha, 2)) && !(await authz.canAccessCliente(U.beta, 2)));
    // transfere B: Alpha -> Beta
    m.history.find((h) => h.cliente_id === 2 && h.fim_em === null).fim_em = new Date().toISOString();
    m.history.push({ id: 99, cliente_id: 2, squad_id: 20, fim_em: null });
    ok("depois: Alpha recebe 403 para B", await authz.canAccessCliente(U.alpha, 2) === false);
    ok("depois: Beta recebe 200 para B", await authz.canAccessCliente(U.beta, 2) === true);
    ok("depois: /me/portfolio de Alpha não traz mais B (sem cache)", !(await meService.obterPortfolio(U.alpha)).clientes.some((c) => c.id === 2));

    // ── §33: ClienteConta herda o squad do cliente ──
    m.contas.push({ id: 501, cliente_id: 1, marketplace: "meli", nome: "ML1", ativo: true, external_account_id: "1", externalAccountLabel: null, base: null });
    m.contas.push({ id: 502, cliente_id: 1, marketplace: "meli", nome: "ML2", ativo: true, external_account_id: "2", externalAccountLabel: null, base: null });
    m.contas.push({ id: 503, cliente_id: 1, marketplace: "shopee", nome: "Shopee", ativo: true, external_account_id: null, externalAccountLabel: null, base: null });
    const portfComContas = await meService.obterPortfolio(U.alpha);
    const cliA = portfComContas.clientes.find((c) => c.id === 1);
    ok("§33: as 3 contas do Cliente A aparecem para o membro do squad (herança, sem squad_id em cliente_contas)", cliA.contas.length === 3);

    console.log(`\nsquadsIsolamento.test.js: ${checks} verificações passaram.`);
  } finally {
    restaurar();
  }
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
