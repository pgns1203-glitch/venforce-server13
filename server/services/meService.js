// server/services/meService.js
// GET /me/context e GET /me/portfolio (VenForce V3 Master Spec §18.2).
//
// "Quais clientes este usuário pode acessar?" hoje só tem resposta real
// para o papel `seller` (filtrado por seller_clientes). Para papéis internos
// (admin/user/membro), Squads/carteiras não têm vínculo persistido no
// schema — resolveEffectivePortfolio (dashboardService.js) já documenta
// isso e devolve TODOS os clientes ativos. Este módulo reaproveita
// exatamente essa função como fonte de autorização: não inventa um
// segundo critério, e não fabrica squadId/responsavelDireto — ambos ficam
// null/false até a fundação de Squads existir. Ver
// Squads_migration/VENFORCE_V3_BACKEND_READINESS.md para o estado completo.

const pool = require("../config/database");
const { resolveEffectivePortfolio } = require("./dashboardService");
const { listarContasDeClientesAtivos } = require("./clienteContas/clienteContaService");
const cliente360Service = require("./cliente360/cliente360Service");

function podeAdministrar(user) {
  return String(user?.role || "").toLowerCase() === "admin";
}

// Status do grant por conta, no vocabulário do V3 (§18.2): conectado |
// sem_grant | atencao. Só faz sentido para marketplaces com OAuth (hoje só
// meli) — Shopee/outros não têm grant, então vem null (nunca "sem_grant"
// fabricado para um marketplace que não usa esse conceito, M7).
function grantStatusDaConta(conta) {
  if (conta.marketplace !== "meli") return null;
  if (!conta.grant) return "sem_grant";
  const status = String(conta.grant.token_status || "valid").toLowerCase();
  if (["error", "invalid", "revoked"].includes(status)) return "atencao";
  if (conta.grant.expires_at && new Date(conta.grant.expires_at).getTime() <= Date.now()) return "atencao";
  return "conectado";
}

// GET /me/context — chamado no boot de TODA página V3. Precisa ser leve:
// nenhuma prontidão, nenhuma lista de contas por cliente, só a contagem
// (contasAtivas), numa única query agregada além da carteira em si.
async function obterContexto(user) {
  const clientesAutorizados = await resolveEffectivePortfolio(pool, user);
  const ids = clientesAutorizados.map((c) => c.id);

  let contasAtivasPorCliente = new Map();
  if (ids.length) {
    const { rows } = await pool.query(
      `SELECT cliente_id, COUNT(*) FILTER (WHERE ativo = true)::int AS contas_ativas
         FROM cliente_contas
        WHERE cliente_id = ANY($1::int[])
        GROUP BY cliente_id`,
      [ids]
    );
    contasAtivasPorCliente = new Map(rows.map((r) => [r.cliente_id, r.contas_ativas]));
  }

  return {
    user: {
      id: user.id,
      nome: user.nome || user.name || null,
      email: user.email || null,
      role: user.role || null,
    },
    // Squads ainda não existem no schema (dashboardService.resolveEffectivePortfolio
    // já documenta a lacuna). Nunca fabricado — fica vazio até existir de verdade.
    squads: [],
    clientes: clientesAutorizados.map((c) => ({
      id: c.id,
      slug: c.slug,
      nome: c.nome,
      squadId: null, // depende de Squads — nunca fabricado
      responsavelDireto: false, // depende de cliente_responsaveis — nunca fabricado
      contasAtivas: contasAtivasPorCliente.get(c.id) || 0,
    })),
    permissoes: {
      podeAdministrar: podeAdministrar(user),
    },
  };
}

// GET /me/portfolio — só a Carteira. Uma requisição: carteira autorizada +
// contas (sem N+1, via listarContasDeClientesAtivos) + readiness já
// calculada em lote por cliente360Service.getClientesOperacional().
async function obterPortfolio(user) {
  const clientesAutorizados = await resolveEffectivePortfolio(pool, user);
  if (!clientesAutorizados.length) return { clientes: [] };
  const ids = clientesAutorizados.map((c) => c.id);

  const [contasTodas, operacional] = await Promise.all([
    listarContasDeClientesAtivos(ids),
    cliente360Service.getClientesOperacional(),
  ]);

  const contasPorCliente = new Map();
  for (const conta of contasTodas) {
    if (!contasPorCliente.has(conta.cliente_id)) contasPorCliente.set(conta.cliente_id, []);
    contasPorCliente.get(conta.cliente_id).push(conta);
  }
  const readinessPorCliente = new Map(operacional.clientes.map((c) => [c.id, c]));

  return {
    clientes: clientesAutorizados.map((c) => {
      const readiness = readinessPorCliente.get(c.id) || null;
      const contas = (contasPorCliente.get(c.id) || []).map((conta) => ({
        id: conta.id,
        marketplace: conta.marketplace,
        nome: conta.nome,
        externalAccountLabel: conta.externalAccountLabel,
        external_account_id: conta.external_account_id,
        ativo: conta.ativo,
        grantStatus: grantStatusDaConta(conta),
        baseVinculada: conta.base ? { id: conta.base.base_id, nome: conta.base.nome } : null,
        // Ainda não existe por conta (só por cliente, via
        // cliente_360_resumos_mensais) — V3 Master Spec §18.1, ajuste 3.
        // null é honesto; nunca copiado do valor por cliente (seria de
        // outra conta na metade dos casos multi-conta).
        ultimaSync: null,
      }));
      return {
        id: c.id,
        slug: c.slug,
        nome: c.nome,
        squadId: null, // Squads não existem — nunca fabricado
        responsavelDireto: false, // cliente_responsaveis não existe — nunca fabricado
        statusOperacional: readiness?.statusOperacional || null,
        // Formato mínimo: só `tipo` é real hoje (readiness.pendencias é
        // array de strings). desde/dias/destino/severidade do exemplo do
        // Master Spec dependem de "fechamento pendente" (Q2, decisão de
        // produto ainda em aberto) — nunca fabricados.
        pendencias: (readiness?.pendencias || []).map((tipo) => ({ tipo })),
        contas,
      };
    }),
  };
}

module.exports = { obterContexto, obterPortfolio, grantStatusDaConta };
