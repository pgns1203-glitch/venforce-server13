// server/services/meService.js
// GET /me/context e GET /me/portfolio (VenForce V3 Master Spec §18.2).
//
// Autoritativos por Squad (V3 S5/S6): a carteira vem de
// authorizationService.resolvePortfolioClientes (admin -> todos; seller ->
// seller_clientes; interno -> clientes dos seus Squads ativos; interno sem
// Squad -> []). squadId/squad e responsavelDireto agora carregam dado REAL
// (cliente_squad_history / cliente_responsaveis) — quando nao ha vinculo,
// vem null/false honesto, nunca fabricado.

const pool = require("../config/database");
const { resolveEffectivePortfolio } = require("./dashboardService");
const { listarContasDeClientesAtivos } = require("./clienteContas/clienteContaService");
const cliente360Service = require("./cliente360/cliente360Service");
const squadsRepo = require("./squads/squadsRepository");

function podeAdministrar(user) {
  return String(user?.role || "").toLowerCase() === "admin";
}

function grantStatusDaConta(conta) {
  if (conta.marketplace !== "meli") return null;
  if (!conta.grant) return "sem_grant";
  const status = String(conta.grant.token_status || "valid").toLowerCase();
  if (["error", "invalid", "revoked"].includes(status)) return "atencao";
  if (conta.grant.expires_at && new Date(conta.grant.expires_at).getTime() <= Date.now()) return "atencao";
  return "conectado";
}

// Memberships ativas do usuario, no shape leve do §19:
// [{ id, nome, slug, principal, funcao, ativo }]. `ativo` = o squad esta ativo
// (um membro de squad inativo aparece aqui mas nao ganha carteira).
async function squadsDoUsuario(userId) {
  await squadsRepo.ensureSquadsTables();
  const rows = await squadsRepo.membershipsDoUsuario(userId);
  return rows.map((m) => ({
    id: m.squad_id,
    nome: m.squad_nome,
    slug: m.squad_slug,
    principal: m.is_primary === true,
    funcao: m.funcao,
    ativo: m.squad_ativo === true,
  }));
}

// GET /me/context — boot de TODA pagina V3. Leve: sem prontidao, sem lista
// de contas por cliente. squads reais + contagem de contas ativas +
// portfolio.totalClientes.
async function obterContexto(user) {
  const [clientesAutorizados, squads] = await Promise.all([
    resolveEffectivePortfolio(pool, user),
    squadsDoUsuario(user.id),
  ]);
  const ids = clientesAutorizados.map((c) => c.id);
  const squadPrincipalId = (squads.find((s) => s.principal) || {}).id || null;

  const [contasAtivasPorCliente, squadAtivoPorCliente, responsaveis] = await Promise.all([
    contarContasAtivas(ids),
    squadsRepo.squadsAtivosDeClientes(ids),
    squadsRepo.responsaveisDeClientes(ids, user.id),
  ]);

  const squadDoCliente = new Map(squadAtivoPorCliente.map((r) => [r.cliente_id, r]));
  const responsavelSet = new Set(responsaveis.map((r) => r.cliente_id));

  return {
    user: {
      id: user.id,
      nome: user.nome || user.name || null,
      email: user.email || null,
      role: user.role || null,
    },
    squads,
    squadPrincipalId,
    clientes: clientesAutorizados.map((c) => {
      const s = squadDoCliente.get(c.id) || null;
      return {
        id: c.id,
        slug: c.slug,
        nome: c.nome,
        squadId: s ? s.squad_id : null,
        responsavelDireto: responsavelSet.has(c.id),
        contasAtivas: contasAtivasPorCliente.get(c.id) || 0,
      };
    }),
    portfolio: { totalClientes: clientesAutorizados.length },
    permissoes: {
      podeAdministrar: podeAdministrar(user),
    },
  };
}

async function contarContasAtivas(ids) {
  if (!ids.length) return new Map();
  const { rows } = await pool.query(
    `SELECT cliente_id, COUNT(*) FILTER (WHERE ativo = true)::int AS contas_ativas
       FROM cliente_contas
      WHERE cliente_id = ANY($1::int[])
      GROUP BY cliente_id`,
    [ids]
  );
  return new Map(rows.map((r) => [r.cliente_id, r.contas_ativas]));
}

// GET /me/portfolio — a Carteira. FONTE AUTORITATIVA: so clientes
// autorizados pelo resolver. Uma requisicao: carteira + contas (sem N+1) +
// readiness em lote + squad por cliente + responsavelDireto.
async function obterPortfolio(user) {
  const [clientesAutorizados, squads] = await Promise.all([
    resolveEffectivePortfolio(pool, user),
    squadsDoUsuario(user.id),
  ]);
  if (!clientesAutorizados.length) return { clientes: [], squads: [] };
  const ids = clientesAutorizados.map((c) => c.id);
  const squadPrincipalId = (squads.find((s) => s.principal) || {}).id || null;

  await squadsRepo.ensureSquadsTables();
  const [contasTodas, operacional, squadAtivoPorCliente, responsaveis] = await Promise.all([
    listarContasDeClientesAtivos(ids),
    cliente360Service.getClientesOperacional({ restringirClienteIds: ids }),
    squadsRepo.squadsAtivosDeClientes(ids),
    squadsRepo.responsaveisDeClientes(ids, user.id),
  ]);

  const contasPorCliente = new Map();
  for (const conta of contasTodas) {
    if (!contasPorCliente.has(conta.cliente_id)) contasPorCliente.set(conta.cliente_id, []);
    contasPorCliente.get(conta.cliente_id).push(conta);
  }
  const readinessPorCliente = new Map(operacional.clientes.map((c) => [c.id, c]));
  const squadDoCliente = new Map(squadAtivoPorCliente.map((r) => [r.cliente_id, r]));
  const responsavelSet = new Set(responsaveis.map((r) => r.cliente_id));
  // Papéis diretos DESTE usuário no cliente (P2.4). `responsaveis` já vem
  // filtrado por user.id. Organização, NÃO acesso — o payload não muda de
  // tamanho de forma relevante (0..3 strings curtas por cliente).
  const papeisDiretosPorCliente = new Map();
  for (const r of responsaveis) {
    if (!papeisDiretosPorCliente.has(r.cliente_id)) papeisDiretosPorCliente.set(r.cliente_id, []);
    papeisDiretosPorCliente.get(r.cliente_id).push(r.papel);
  }

  return {
    // Squads do usuario para a Carteira decidir se mostra filtro/agrupamento
    // (1 squad -> esconde; 2+ -> agrupa). §22.
    squads: squads.map((s) => ({ id: s.id, nome: s.nome, slug: s.slug, principal: s.principal })),
    clientes: clientesAutorizados.map((c) => {
      const readiness = readinessPorCliente.get(c.id) || null;
      const s = squadDoCliente.get(c.id) || null;
      const contas = (contasPorCliente.get(c.id) || []).map((conta) => ({
        id: conta.id,
        marketplace: conta.marketplace,
        nome: conta.nome,
        externalAccountLabel: conta.externalAccountLabel,
        external_account_id: conta.external_account_id,
        ativo: conta.ativo,
        grantStatus: grantStatusDaConta(conta),
        baseVinculada: conta.base ? { id: conta.base.base_id, nome: conta.base.nome } : null,
        ultimaSync: null,
      }));
      return {
        id: c.id,
        slug: c.slug,
        nome: c.nome,
        squadId: s ? s.squad_id : null,
        squad: s
          ? {
              id: s.squad_id,
              nome: s.squad_nome,
              slug: s.squad_slug,
              principalParaUsuario: squadPrincipalId != null && s.squad_id === squadPrincipalId,
            }
          : null,
        responsavelDireto: responsavelSet.has(c.id),
        papeisDiretos: papeisDiretosPorCliente.get(c.id) || [],
        statusOperacional: readiness?.statusOperacional || null,
        pendencias: (readiness?.pendencias || []).map((tipo) => ({ tipo })),
        contas,
      };
    }),
  };
}

module.exports = { obterContexto, obterPortfolio, grantStatusDaConta };
