// server/tests/meServiceContextoPortfolio.test.js
//
// GET /me/context e GET /me/portfolio (VenForce V3 Master Spec §18.2).
//
// Reaproveita resolveEffectivePortfolio (dashboardService.js) como ÚNICA
// fonte de autorização: seller filtra de verdade por seller_clientes;
// papéis internos (admin/user/membro) veem todos os clientes ativos porque
// Squads não existem no schema — este teste prova que o service NUNCA
// fabrica squadId/responsavelDireto para compensar essa lacuna, e nunca
// vaza token em nenhum dos dois contratos.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

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
  constructor({ clientesAtivos = [], sellerClientes = [], contas = [], contasAtivasResumo = null, contasResumoReadiness = [] } = {}) {
    this.clientesAtivos = clientesAtivos;
    this.sellerClientes = sellerClientes;
    this.contas = contas;
    this.contasAtivasResumo = contasAtivasResumo;
    this.contasResumoReadiness = contasResumoReadiness;
    this.queriesExecutadas = [];
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();
    this.queriesExecutadas.push(q);

    if (q.includes("dashboard:AUTHORIZED_SELLER_CLIENTS")) {
      return { rows: this.sellerClientes.filter((c) => true) };
    }
    if (q.includes("dashboard:AUTHORIZED_INTERNAL_CLIENTS")) {
      return { rows: this.clientesAtivos };
    }
    if (q.startsWith("SELECT cliente_id, COUNT(*) FILTER (WHERE ativo = true)::int AS contas_ativas")) {
      const ids = params[0];
      const contagem = new Map();
      for (const c of this.contas) {
        if (!ids.includes(c.cliente_id)) continue;
        if (c.ativo === false) continue;
        contagem.set(c.cliente_id, (contagem.get(c.cliente_id) || 0) + 1);
      }
      return { rows: [...contagem.entries()].map(([cliente_id, contas_ativas]) => ({ cliente_id, contas_ativas })) };
    }
    // listarContasDeClientesAtivos
    if (q.includes("FROM cliente_contas cc") && q.includes("cc.cliente_id = ANY($1::int[])")) {
      const ids = params[0];
      return { rows: this.contas.filter((c) => ids.includes(c.cliente_id) && c.ativo !== false) };
    }
    // cliente360Service.getClientesOperacional() — schema + readiness
    if (q.includes("CREATE TABLE") || q.includes("CREATE INDEX") || q.startsWith("ALTER TABLE")) return { rows: [] };
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

async function run() {
  // 1. Papel interno (membro): vê TODOS os clientes ativos — honesto sobre a
  //    lacuna de Squads, nunca fabrica squadId/responsavelDireto.
  await withMockDb({ clientesAtivos: [clienteA, clienteB], contas: [] }, async () => {
    const ctx = await obterContexto({ id: 10, nome: "Pedro", email: "pedro@venforce.com", role: "membro" });
    ok("membro vê os 2 clientes ativos (sem Squads, é o universo real hoje)", ctx.clientes.length === 2);
    ok("squads sempre vazio — nunca fabricado", Array.isArray(ctx.squads) && ctx.squads.length === 0);
    ok("squadId por cliente é sempre null — nunca fabricado", ctx.clientes.every((c) => c.squadId === null));
    ok("responsavelDireto é sempre false — nunca fabricado", ctx.clientes.every((c) => c.responsavelDireto === false));
    ok("permissoes.podeAdministrar é false para membro", ctx.permissoes.podeAdministrar === false);
  });

  // 2. Admin: podeAdministrar true; mesma carteira universal.
  await withMockDb({ clientesAtivos: [clienteA], contas: [] }, async () => {
    const ctx = await obterContexto({ id: 1, nome: "Admin", email: "admin@venforce.com", role: "admin" });
    ok("admin: podeAdministrar true", ctx.permissoes.podeAdministrar === true);
  });

  // 3. Seller: filtrado de verdade por seller_clientes (autorização real,
  //    diferente do "todos os ativos" dos papéis internos).
  await withMockDb({ clientesAtivos: [clienteA, clienteB], sellerClientes: [clienteA], contas: [] }, async () => {
    const ctx = await obterContexto({ id: 20, nome: "Vendedor", email: "seller@venforce.com", role: "seller" });
    ok("seller vê só o cliente autorizado em seller_clientes (1, não 2)", ctx.clientes.length === 1 && ctx.clientes[0].id === 1);
  });

  // 4. contasAtivas: contagem correta por cliente, sem contar contas inativas.
  await withMockDb(
    {
      clientesAtivos: [clienteA, clienteB],
      contas: [
        { cliente_id: 1, ativo: true }, { cliente_id: 1, ativo: true }, { cliente_id: 1, ativo: false },
        { cliente_id: 2, ativo: true },
      ],
    },
    async () => {
      const ctx = await obterContexto({ id: 10, role: "user" });
      const a = ctx.clientes.find((c) => c.id === 1);
      const b = ctx.clientes.find((c) => c.id === 2);
      ok("cliente A: 2 contas ativas (a inativa não conta)", a.contasAtivas === 2);
      ok("cliente B: 1 conta ativa", b.contasAtivas === 1);
    }
  );

  // 5. Usuário sem clientes autorizados recebe [] — nunca 403 nem exceção.
  await withMockDb({ clientesAtivos: [], sellerClientes: [], contas: [] }, async () => {
    const ctx = await obterContexto({ id: 30, role: "seller" });
    ok("seller sem clientes vinculados recebe clientes: [] (NO_PORTFOLIO, não erro)", Array.isArray(ctx.clientes) && ctx.clientes.length === 0);
    const port = await obterPortfolio({ id: 30, role: "seller" });
    ok("portfolio idem: [] sem exceção", Array.isArray(port.clientes) && port.clientes.length === 0);
  });

  // 6. /me/portfolio: 2 contas do mesmo cliente (ML1 ok, ML2 revogado) —
  //    contas isoladas corretamente, grantStatus por conta.
  await withMockDb(
    {
      clientesAtivos: [clienteA],
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
      const port = await obterPortfolio({ id: 10, role: "user" });
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
      ok("statusOperacional do cliente reflete a cobertura parcial (não 'pronto' com ML2 quebrado)", cli.statusOperacional === "atencao" || cli.statusOperacional === "critico");
    }
  );

  // 7. Segurança: nenhum token aparece em nenhum dos dois contratos.
  await withMockDb(
    {
      clientesAtivos: [clienteA],
      contas: [grantRow({ cliente_id: 1, id: 10, marketplace: "meli", nome: "ML 1", external_account_id: "111", grant_id: 900, grant_ml_user_id: "111", grant_token_status: "valid" })],
    },
    async () => {
      const ctx = await obterContexto({ id: 10, role: "user" });
      const port = await obterPortfolio({ id: 10, role: "user" });
      const dump = JSON.stringify(ctx) + JSON.stringify(port);
      ok("nenhum access_token/refresh_token em /me/context nem /me/portfolio", !/access_token|refresh_token/i.test(dump));
    }
  );

  // 8. N+1: /me/portfolio com 3 clientes autorizados faz um número FIXO de
  //    queries de conta (1, via listarContasDeClientesAtivos), não 1 por cliente.
  await withMockDb(
    {
      clientesAtivos: [clienteA, clienteB, { id: 3, slug: "c3", nome: "Cliente 3", ativo: true }],
      contas: [],
    },
    async (db) => {
      await obterPortfolio({ id: 10, role: "user" });
      const queriesDeConta = db.queriesExecutadas.filter((q) => q.includes("cc.cliente_id = ANY($1::int[])"));
      ok("exatamente 1 query de contas para N clientes (sem N+1)", queriesDeConta.length === 1);
    }
  );

  console.log(`\nmeServiceContextoPortfolio.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
