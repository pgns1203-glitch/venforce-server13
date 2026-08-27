// server/services/squads/authorizationService.js
// Fonte ÚNICA de autorização por carteira do VenForce V3 (mission §13/§14).
//
//   admin   → todos os clientes ativos (bypass global)
//   seller  → seller_clientes (INALTERADO — Squads não substituem esse vínculo)
//   interno → clientes cujo Squad ativo ∈ Squads ativos do usuário
//   interno SEM membership → carteira VAZIA (pendência de migração) — NUNCA
//             todos os clientes. Sem fallback inseguro.
//
// Não espalhe consulta de Squad em 20 controllers: use `canAccessCliente` /
// `assertClienteNaCarteira` / `resolvePortfolioClientes` daqui.

const pool = require("../../config/database");
const { CODIGOS_CANONICOS } = require("../../utils/erroContextoCanonico");

const ROLES_INTERNAS = new Set(["user", "membro", "interno"]);

function papel(user) {
  return String(user?.role || "").toLowerCase();
}

function ehAdmin(user) {
  return papel(user) === "admin";
}

function ehSeller(user) {
  return papel(user) === "seller";
}

function ehInterno(user) {
  return ROLES_INTERNAS.has(papel(user));
}

function erro(status, code, mensagem) {
  const e = new Error(mensagem);
  e.statusCode = status;
  e.code = code;
  return e;
}

// Resolve `:cliente` (id numérico ou slug) para { id, slug, nome, ativo }.
// Retorna null se não existir.
async function resolverClienteRef(ref, db = pool) {
  const bruto = String(ref ?? "").trim();
  if (!bruto) return null;
  if (/^\d+$/.test(bruto)) {
    const { rows } = await db.query(
      `/* authz:RESOLVE_CLIENTE_ID */ SELECT id, slug, nome, ativo FROM clientes WHERE id = $1`,
      [Number(bruto)]
    );
    return rows[0] || null;
  }
  const slug = bruto.toLowerCase();
  const { rows } = await db.query(
    `/* authz:RESOLVE_CLIENTE_SLUG */ SELECT id, slug, nome, ativo FROM clientes WHERE slug = $1`,
    [slug]
  );
  return rows[0] || null;
}

// Carteira autorizada do usuário: [{ id, slug, nome }].
async function resolvePortfolioClientes(user = {}, db = pool) {
  if (ehAdmin(user)) {
    const { rows } = await db.query(
      `/* authz:PORTFOLIO_ADMIN_ALL */
       SELECT c.id, c.slug, c.nome FROM clientes c
        WHERE c.ativo = true ORDER BY c.nome ASC`
    );
    return rows;
  }

  if (ehSeller(user)) {
    const { rows } = await db.query(
      `/* authz:PORTFOLIO_SELLER */
       SELECT DISTINCT c.id, c.slug, c.nome
         FROM seller_clientes sc
         JOIN clientes c ON c.id = sc.cliente_id
        WHERE sc.user_id = $1 AND sc.ativo = true AND c.ativo = true
        ORDER BY c.nome ASC`,
      [user.id]
    );
    return rows;
  }

  if (ehInterno(user)) {
    // Clientes cujo Squad ativo é um dos Squads ATIVOS do usuário.
    // Squad inativo não dá acesso operacional (mission §30).
    const { rows } = await db.query(
      `/* authz:PORTFOLIO_INTERNAL_BY_SQUAD */
       SELECT DISTINCT c.id, c.slug, c.nome
         FROM cliente_squad_history csh
         JOIN clientes c ON c.id = csh.cliente_id AND c.ativo = true
         JOIN squads s ON s.id = csh.squad_id AND s.ativo = true
         JOIN squad_members sm ON sm.squad_id = s.id
          AND sm.user_id = $1 AND sm.ativo = true
        WHERE csh.fim_em IS NULL
        ORDER BY c.nome ASC`,
      [user.id]
    );
    return rows;
  }

  // Qualquer outro papel (shopee_reviewer, desconhecido): sem carteira
  // operacional. Nunca "todos os clientes".
  return [];
}

// Booleano: o usuário pode acessar este cliente?
async function canAccessCliente(user = {}, clienteId, db = pool) {
  const id = Number(clienteId);
  if (!Number.isInteger(id) || id <= 0) return false;

  if (ehAdmin(user)) {
    // Bypass global: basta o cliente existir (admin acessa inclusive
    // cliente inativo, ex.: administração/migração).
    const { rows } = await db.query(
      `/* authz:CAN_ACCESS_ADMIN */ SELECT 1 FROM clientes WHERE id = $1`,
      [id]
    );
    return rows.length > 0;
  }

  if (ehSeller(user)) {
    const { rows } = await db.query(
      `/* authz:CAN_ACCESS_SELLER */
       SELECT 1 FROM seller_clientes sc
        WHERE sc.user_id = $1 AND sc.cliente_id = $2 AND sc.ativo = true
        LIMIT 1`,
      [user.id, id]
    );
    return rows.length > 0;
  }

  if (ehInterno(user)) {
    const { rows } = await db.query(
      `/* authz:CAN_ACCESS_INTERNAL */
       SELECT 1
         FROM cliente_squad_history csh
         JOIN squads s ON s.id = csh.squad_id AND s.ativo = true
         JOIN squad_members sm ON sm.squad_id = s.id
          AND sm.user_id = $1 AND sm.ativo = true
        WHERE csh.cliente_id = $2 AND csh.fim_em IS NULL
        LIMIT 1`,
      [user.id, id]
    );
    return rows.length > 0;
  }

  return false;
}

// Resolve + autoriza. Lança erro canônico:
//   404 CLIENTE_NAO_ENCONTRADO — id/slug não existe
//   403 CLIENTE_FORA_DA_CARTEIRA — existe mas fora da carteira do usuário
// Retorna { id, slug, nome, ativo } quando autorizado.
async function assertClienteNaCarteira(user, ref, db = pool) {
  const cliente = await resolverClienteRef(ref, db);
  if (!cliente) {
    throw erro(404, CODIGOS_CANONICOS.CLIENTE_NAO_ENCONTRADO, "Cliente não encontrado.");
  }
  const ok = await canAccessCliente(user, cliente.id, db);
  if (!ok) {
    throw erro(403, CODIGOS_CANONICOS.CLIENTE_FORA_DA_CARTEIRA, "Cliente fora da sua carteira.");
  }
  return cliente;
}

// Autoriza por ID de CLIENTE_CONTA. A herança é sempre conta -> cliente ->
// Squad; NUNCA "a conta existe, logo pode acessar" (mission §14, P2.1 §4).
// Lança:
//   404 CLIENTE_NAO_ENCONTRADO — conta não existe
//   403 CLIENTE_FORA_DA_CARTEIRA — a conta existe mas o cliente dela está
//        fora da carteira do usuário
// Retorna { contaId, clienteId, clienteSlug, clienteNome, clienteAtivo }.
async function assertClienteContaNaCarteira(user, clienteContaId, db = pool) {
  const id = Number(clienteContaId);
  if (!Number.isInteger(id) || id <= 0) {
    throw erro(404, CODIGOS_CANONICOS.CLIENTE_NAO_ENCONTRADO, "Conta não encontrada.");
  }
  const { rows } = await db.query(
    `/* authz:RESOLVE_CLIENTE_CONTA */
     SELECT cc.id AS conta_id, cc.cliente_id, c.slug, c.nome, c.ativo
       FROM cliente_contas cc
       JOIN clientes c ON c.id = cc.cliente_id
      WHERE cc.id = $1`,
    [id]
  );
  const conta = rows[0];
  if (!conta) {
    throw erro(404, CODIGOS_CANONICOS.CLIENTE_NAO_ENCONTRADO, "Conta não encontrada.");
  }
  const ok = await canAccessCliente(user, conta.cliente_id, db);
  if (!ok) {
    throw erro(403, CODIGOS_CANONICOS.CLIENTE_FORA_DA_CARTEIRA, "Cliente fora da sua carteira.");
  }
  return {
    contaId: conta.conta_id,
    clienteId: conta.cliente_id,
    clienteSlug: conta.slug,
    clienteNome: conta.nome,
    clienteAtivo: conta.ativo,
  };
}

// Ids de cliente que o usuário acessa, como Set (para interseções em memória).
async function clientesAutorizadosSet(user, db = pool) {
  const lista = await resolvePortfolioClientes(user, db);
  return new Set(lista.map((c) => c.id));
}

// Autoriza por BASE de custos. A base não tem dono direto — ela cobre N
// clientes via base_cliente_vinculos. Regra (decisão P2.1): o usuário acessa
// a base se cobre PELO MENOS UM cliente vinculado. Base órfã (sem vínculo
// ativo) fica acessível às roles internas — não há dado de cliente a vazar.
// admin → sempre. Lança 404 (base não existe) / 403 CLIENTE_FORA_DA_CARTEIRA.
// Retorna { baseId, baseSlug, baseNome }.
async function assertBaseNaCarteira(user, baseRef, { bySlug = false } = {}, db = pool) {
  const bruto = String(baseRef ?? "").trim();
  if (!bruto) {
    throw erro(404, "BASE_NAO_ENCONTRADA", "Base não encontrada.");
  }
  const { rows } = bySlug
    ? await db.query(
        `/* authz:RESOLVE_BASE_SLUG */ SELECT id, slug, nome FROM bases WHERE slug = $1`,
        [bruto.toLowerCase()]
      )
    : await db.query(
        `/* authz:RESOLVE_BASE_ID */ SELECT id, slug, nome FROM bases WHERE id = $1`,
        [/^\d+$/.test(bruto) ? Number(bruto) : -1]
      );
  const base = rows[0];
  if (!base) {
    throw erro(404, "BASE_NAO_ENCONTRADA", "Base não encontrada.");
  }
  if (ehAdmin(user)) {
    return { baseId: base.id, baseSlug: base.slug, baseNome: base.nome };
  }
  const { rows: vinc } = await db.query(
    `/* authz:BASE_CLIENTES_VINCULADOS */
     SELECT DISTINCT cliente_id FROM base_cliente_vinculos
      WHERE base_id = $1 AND ativo = true`,
    [base.id]
  );
  if (vinc.length === 0) {
    // Base órfã: só as roles internas mexem nela.
    if (ehInterno(user) || ehSeller(user)) {
      return { baseId: base.id, baseSlug: base.slug, baseNome: base.nome };
    }
    throw erro(403, CODIGOS_CANONICOS.CLIENTE_FORA_DA_CARTEIRA, "Base fora da sua carteira.");
  }
  const permitidos = await clientesAutorizadosSet(user, db);
  const cobre = vinc.some((v) => permitidos.has(v.cliente_id));
  if (!cobre) {
    throw erro(403, CODIGOS_CANONICOS.CLIENTE_FORA_DA_CARTEIRA, "Base fora da sua carteira.");
  }
  return { baseId: base.id, baseSlug: base.slug, baseNome: base.nome };
}

module.exports = {
  resolverClienteRef,
  resolvePortfolioClientes,
  clientesAutorizadosSet,
  canAccessCliente,
  assertClienteNaCarteira,
  assertClienteContaNaCarteira,
  assertBaseNaCarteira,
  ehAdmin,
  ehSeller,
  ehInterno,
};
