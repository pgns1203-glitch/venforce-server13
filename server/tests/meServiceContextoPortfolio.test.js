// server/tests/meServiceContextoPortfolio.test.js
//
// GET /me/context e GET /me/portfolio (VenForce V3 Master Spec §18.2).
//
// Pós V3 S5/S6: a carteira é autoritativa por Squad. Este teste cobre a
// MECÂNICA do meService (contagem de contas, ausência de N+1, sem token,
// grantStatus por conta, isolamento entre contas do mesmo cliente). O
// isolamento por Squad em si (matriz Alpha/Beta/Admin/Seller, multi-squad,
// transferência) está em squadsIsolamento.test.js.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";
// P2.2 — portfolio autoritativo por Squad pressupõe enforcement ativo.
process.env.SQUADS_ENFORCEMENT = "on";

const assert = require("assert");
const pool = require("../config/database");
const { obterContexto, obterPortfolio } = require("../services/meService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const clienteA = { id: 1, slug: "n97", nome: "N97 Comercial", ativo: true };
const clienteB = { id: 2, slug: "extra", nome: "Extra Máquinas", ativo: true };

class MockDb {
  constructor({
    clientesAtivos = [],
    sellerClientes = [],
    contas = [],
    contasResumoReadiness = [],
    // squad model
    membershipsPorUser = {},          // { userId: [{squad_id,nome,slug,is_primary,funcao,ativo}] }
    squadAtivoPorCliente = {},        // { clienteId: {squad_id, squad_nome, squad_slug, squad_ativo} }
    responsaveis = [],                // [{cliente_id, user_id, papel}]
  } = {}) {
    this.clientesAtivos = clientesAtivos;
    this.sellerClientes = sellerClientes;
    this.contas = contas;
    this.contasResumoReadiness = contasResumoReadiness;
    this.membershipsPorUser = membershipsPorUser;
    this.squadAtivoPorCliente = squadAtivoPorCliente;
    this.responsaveis = responsaveis;
    this.queriesExecutadas = [];
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();
    this.queriesExecutadas.push(q);

    if (/^(CREATE|ALTER|DROP|DO |BEGIN|COMMIT|ROLLBACK)/i.test(q) || q.includes("pg_advisory")) return { rows: [] };

    // ── autorização ──
    if (q.includes("authz:PORTFOLIO_SELLER")) {
      return { rows: this.sellerClientes };
    }
    if (q.includes("authz:PORTFOLIO_ADMIN_ALL")) {
      return { rows: this.clientesAtivos };
    }
    if (q.includes("authz:PORTFOLIO_INTERNAL_BY_SQUAD")) {
      // usuário interno vê os clientes que têm squad ativo cujo id ∈ squads do user
      const uid = params[0];
      const squadIds = new Set((this.membershipsPorUser[uid] || []).filter((s) => s.ativo).map((s) => s.squad_id));
      return {
        rows: this.clientesAtivos.filter((c) => {
          const s = this.squadAtivoPorCliente[c.id];
          return s && squadIds.has(s.squad_id);
        }),
      };
    }

    // ── squads repo ──
    if (q.includes("squads:MEMBERSHIPS_DO_USUARIO")) {
      const uid = params[0];
      return {
        rows: (this.membershipsPorUser[uid] || []).map((s) => ({
          id: s.squad_id, squad_id: s.squad_id, user_id: uid,
          is_primary: s.is_primary, funcao: s.funcao || "membro", ativo: s.ativo,
          squad_nome: s.nome, squad_slug: s.slug, squad_ativo: s.ativo,
        })),
      };
    }
    if (q.includes("squads:SQUADS_ATIVOS_DE_CLIENTES")) {
      const ids = params[0] || [];
      return {
        rows: ids
          .filter((id) => this.squadAtivoPorCliente[id])
          .map((id) => ({ cliente_id: id, ...this.squadAtivoPorCliente[id] })),
      };
    }
    if (q.includes("squads:RESPONSAVEIS_DE_CLIENTES")) {
      const ids = params[0] || [];
      const uid = params[1];
      return { rows: this.responsaveis.filter((r) => ids.includes(r.cliente_id) && (uid == null || r.user_id === uid)) };
    }

    // ── meService: contagem de contas ──
    if (q.startsWith("SELECT cliente_id, COUNT(*) FILTER (WHERE ativo = true)::int AS contas_ativas")) {
      const ids = params[0];
      const contagem = new Map();
      for (const c of this.contas) {
        if (!ids.includes(c.cliente_id) || c.ativo === false) continue;
        contagem.set(c.cliente_id, (contagem.get(c.cliente_id) || 0) + 1);
      }
      return { rows: [...contagem.entries()].map(([cliente_id, contas_ativas]) => ({ cliente_id, contas_ativas })) };
    }
    // listarContasDeClientesAtivos
    if (q.includes("FROM cliente_contas cc") && q.includes("cc.cliente_id = ANY($1::int[])")) {
      const ids = params[0];
      return { rows: this.contas.filter((c) => ids.includes(c.cliente_id) && c.ativo !== false) };
    }
    // cliente360Service.getClientesOperacional
    if (q.startsWith("SELECT id, nome, slug, ativo FROM clientes WHERE ativo = true")) return { rows: this.clientesAtivos };
    if (q.includes("FROM ml_tokens t") && q.includes("DISTINCT ON (t.cliente_id)")) return { rows: [] };
    if (q.includes("FROM base_cliente_vinculos v") && q.includes("DISTINCT v.cliente_id")) return { rows: [] };
    if (q.startsWith("SELECT cliente_id, sincronizado_em FROM cliente_360_resumos_mensais")) return { rows: [] };
    if (q.includes("FROM cliente_contas cc") && q.includes("LATERAL") && !q.includes("cc.cliente_id = ANY")) {
      return { rows: this.contasResumoReadiness };
    }

    return { rows: [] };
  }
}

function withMockDb(dbOpts, fn) {
  const original = pool.query;
  const db = new MockDb(dbOpts);
  pool.query = (sql, params) => db.query(sql, params);
  return Promise.resolve().then(() => fn(db)).finally(() => { pool.query = original; });
}

function grantRow({ cliente_id, id, marketplace, nome, external_account_id, ativo = true, metadata_json = {}, grant_id = null, grant_ml_user_id = null, grant_token_status = null, grant_expires_at = null, vinculo_id = null, vinculo_base_id = null, vinculo_base_slug = null, vinculo_base_nome = null }) {
  return {
    id, cliente_id, marketplace, nome, slug: `${cliente_id}-${marketplace}`,
    external_account_id, is_primary: true, ativo, metadata_json,
    created_at: "2026-01-01", updated_at: "2026-01-01",
    grant_id, grant_ml_user_id, grant_token_status, grant_expires_at,
    vinculo_id, vinculo_base_id, vinculo_base_slug, vinculo_base_nome,
  };
}

// membro do Squad Alpha (id 10), com A e B atribuídos a Alpha.
const alphaMemberships = { 10: [{ squad_id: 10, nome: "Squad Alpha", slug: "alpha", is_primary: true, funcao: "membro", ativo: true }] };
const abEmAlpha = {
  1: { squad_id: 10, squad_nome: "Squad Alpha", squad_slug: "alpha", squad_ativo: true },
  2: { squad_id: 10, squad_nome: "Squad Alpha", squad_slug: "alpha", squad_ativo: true },
};

async function run() {
  // 1. Interno com Squad: vê os clientes do seu Squad, com squadId real.
  await withMockDb(
    { clientesAtivos: [clienteA, clienteB], contas: [], membershipsPorUser: { 10: alphaMemberships[10] }, squadAtivoPorCliente: abEmAlpha },
    async () => {
      const ctx = await obterContexto({ id: 10, nome: "Pedro", email: "pedro@venforce.com", role: "membro" });
      ok("membro do Squad Alpha vê os 2 clientes atribuídos", ctx.clientes.length === 2);
      ok("squads reais (não fabricado)", ctx.squads.length === 1 && ctx.squads[0].slug === "alpha");
      ok("squadId por cliente é o squad ativo real", ctx.clientes.every((c) => c.squadId === 10));
      ok("responsavelDireto false quando não há cliente_responsaveis", ctx.clientes.every((c) => c.responsavelDireto === false));
      ok("permissoes.podeAdministrar false para membro", ctx.permissoes.podeAdministrar === false);
      ok("portfolio.totalClientes = 2", ctx.portfolio.totalClientes === 2);
    }
  );

  // 2. Admin: podeAdministrar true; carteira = todos os ativos.
  await withMockDb({ clientesAtivos: [clienteA, clienteB], contas: [] }, async () => {
    const ctx = await obterContexto({ id: 1, nome: "Admin", email: "admin@venforce.com", role: "admin" });
    ok("admin: podeAdministrar true", ctx.permissoes.podeAdministrar === true);
    ok("admin: vê todos os clientes ativos", ctx.clientes.length === 2);
  });

  // 3. Seller: filtrado por seller_clientes.
  await withMockDb({ clientesAtivos: [clienteA, clienteB], sellerClientes: [clienteA], contas: [] }, async () => {
    const ctx = await obterContexto({ id: 20, nome: "Vendedor", email: "seller@venforce.com", role: "seller" });
    ok("seller vê só o cliente autorizado em seller_clientes (1, não 2)", ctx.clientes.length === 1 && ctx.clientes[0].id === 1);
  });

  // 4. contasAtivas: contagem por cliente, sem contar inativas.
  await withMockDb(
    {
      clientesAtivos: [clienteA, clienteB],
      membershipsPorUser: { 10: alphaMemberships[10] },
      squadAtivoPorCliente: abEmAlpha,
      contas: [
        { cliente_id: 1, ativo: true }, { cliente_id: 1, ativo: true }, { cliente_id: 1, ativo: false },
        { cliente_id: 2, ativo: true },
      ],
    },
    async () => {
      const ctx = await obterContexto({ id: 10, role: "membro" });
      const a = ctx.clientes.find((c) => c.id === 1);
      const b = ctx.clientes.find((c) => c.id === 2);
      ok("cliente A: 2 contas ativas (a inativa não conta)", a.contasAtivas === 2);
      ok("cliente B: 1 conta ativa", b.contasAtivas === 1);
    }
  );

  // 5. Usuário interno sem Squad: [] — nunca 403, nunca exceção, nunca todos.
  await withMockDb({ clientesAtivos: [clienteA, clienteB], contas: [] }, async () => {
    const ctx = await obterContexto({ id: 30, role: "membro" });
    ok("interno sem membership: clientes [] (NO_PORTFOLIO, não erro)", Array.isArray(ctx.clientes) && ctx.clientes.length === 0);
    ok("interno sem membership: squads []", ctx.squads.length === 0);
    const port = await obterPortfolio({ id: 30, role: "membro" });
    ok("portfolio idem: [] sem exceção", Array.isArray(port.clientes) && port.clientes.length === 0);
  });

  // 6. /me/portfolio: 2 contas do mesmo cliente (ML1 ok, ML2 revogado).
  await withMockDb(
    {
      clientesAtivos: [clienteA],
      membershipsPorUser: { 10: alphaMemberships[10] },
      squadAtivoPorCliente: { 1: abEmAlpha[1] },
      contas: [
        grantRow({ cliente_id: 1, id: 10, marketplace: "meli", nome: "Mercado Livre 1", external_account_id: "111", metadata_json: { nickname: "n97store" }, grant_id: 900, grant_ml_user_id: "111", grant_token_status: "valid", vinculo_id: 800, vinculo_base_id: 700, vinculo_base_slug: "base-a", vinculo_base_nome: "Base A" }),
        grantRow({ cliente_id: 1, id: 11, marketplace: "meli", nome: "Mercado Livre 2", external_account_id: "222", grant_id: 901, grant_ml_user_id: "222", grant_token_status: "revoked" }),
      ],
      contasResumoReadiness: [
        { cliente_id: 1, marketplace: "meli", ativo: true, tem_grant: true, grant_token_status: "valid", grant_expires_at: null, tem_base: true },
        { cliente_id: 1, marketplace: "meli", ativo: true, tem_grant: true, grant_token_status: "revoked", grant_expires_at: null, tem_base: false },
      ],
    },
    async () => {
      const port = await obterPortfolio({ id: 10, role: "membro" });
      const cli = port.clientes.find((c) => c.id === 1);
      ok("cliente aparece com 2 contas, nenhuma duplicada", cli.contas.length === 2);
      const ml1 = cli.contas.find((c) => c.id === 10);
      const ml2 = cli.contas.find((c) => c.id === 11);
      ok("ML1: grantStatus conectado", ml1.grantStatus === "conectado");
      ok("ML1: externalAccountLabel do nickname capturado no OAuth", ml1.externalAccountLabel === "n97store");
      ok("ML1: baseVinculada presente", ml1.baseVinculada && ml1.baseVinculada.nome === "Base A");
      ok("ML2: grantStatus atencao (grant revogado)", ml2.grantStatus === "atencao");
      ok("ML2: sem externalAccountLabel (nunca inventado)", ml2.externalAccountLabel === null);
      ok("ML2 nunca herda a base de ML1", ml2.baseVinculada === null);
      ok("cliente traz squad {id,slug,principalParaUsuario}", cli.squad && cli.squad.slug === "alpha" && cli.squad.principalParaUsuario === true);
      ok("statusOperacional reflete a cobertura parcial", cli.statusOperacional === "atencao" || cli.statusOperacional === "critico");
    }
  );

  // 7. Segurança: nenhum token em nenhum dos dois contratos.
  await withMockDb(
    {
      clientesAtivos: [clienteA],
      membershipsPorUser: { 10: alphaMemberships[10] },
      squadAtivoPorCliente: { 1: abEmAlpha[1] },
      contas: [grantRow({ cliente_id: 1, id: 10, marketplace: "meli", nome: "ML 1", external_account_id: "111", grant_id: 900, grant_ml_user_id: "111", grant_token_status: "valid" })],
    },
    async () => {
      const ctx = await obterContexto({ id: 10, role: "membro" });
      const port = await obterPortfolio({ id: 10, role: "membro" });
      const dump = JSON.stringify(ctx) + JSON.stringify(port);
      ok("nenhum access_token/refresh_token em /me/context nem /me/portfolio", !/access_token|refresh_token/i.test(dump));
    }
  );

  // 8. N+1: /me/portfolio com 3 clientes faz UM número fixo de queries de conta.
  await withMockDb(
    {
      clientesAtivos: [clienteA, clienteB, { id: 3, slug: "c3", nome: "Cliente 3", ativo: true }],
      membershipsPorUser: { 10: alphaMemberships[10] },
      squadAtivoPorCliente: {
        1: abEmAlpha[1], 2: abEmAlpha[2],
        3: { squad_id: 10, squad_nome: "Squad Alpha", squad_slug: "alpha", squad_ativo: true },
      },
      contas: [],
    },
    async (db) => {
      await obterPortfolio({ id: 10, role: "membro" });
      const queriesDeConta = db.queriesExecutadas.filter((q) => q.includes("cc.cliente_id = ANY($1::int[])"));
      ok("exatamente 1 query de contas para N clientes (sem N+1)", queriesDeConta.length === 1);
      const queriesDeSquad = db.queriesExecutadas.filter((q) => q.includes("squads:SQUADS_ATIVOS_DE_CLIENTES"));
      ok("exatamente 1 query de squad para N clientes (sem N+1)", queriesDeSquad.length === 1);
    }
  );

  console.log(`\nmeServiceContextoPortfolio.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
