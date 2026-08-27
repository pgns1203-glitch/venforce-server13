// server/services/squads/squadsRepository.js
// Camada de dados de Squads + autorização por carteira (VenForce V3 Fase S).
// Todo o SQL vive aqui, sempre parametrizado. Cada query carrega um marcador
// /* squads:NOME */ para ser mockável nos testes sem Postgres real (mesmo
// padrão de dashboardService `/* dashboard:... */`).
//
// Modelo (docs/CONTEXTO_COMPLETO_SQUADS §5, mission §3/§4):
//   ROLE            = o que o usuário pode fazer globalmente (users.role)
//   SQUAD           = qual carteira operacional o usuário acessa
//   RESPONSABILIDADE = qual Cliente é diretamente daquele profissional
// Squad NÃO é propagado para tabelas operacionais: deriva-se
//   conta -> cliente -> squad  (dados por conta)
//   cliente -> squad            (dados client-level)

const fs = require("fs");
const path = require("path");
const pool = require("../../config/database");

const migrationPath = path.join(
  __dirname, "..", "..", "sql", "migrations", "20260827_squads_foundation.sql"
);

let _ensured = false;

// Idempotente. O arquivo de migration é a fonte canônica do schema — este
// boot só o reaplica (CREATE TABLE IF NOT EXISTS / índices parciais).
async function ensureSquadsTables(db = pool) {
  if (_ensured && db === pool) return;
  const sql = fs.readFileSync(migrationPath, "utf8");
  await db.query(sql);
  if (db === pool) _ensured = true;
}

/* ─────────────────────────── squads ─────────────────────────── */

async function listarSquads({ apenasAtivos = false, squadIds = null } = {}, db = pool) {
  const filtros = [];
  const params = [];
  if (apenasAtivos) filtros.push("s.ativo = true");
  if (Array.isArray(squadIds)) {
    params.push(squadIds);
    filtros.push(`s.id = ANY($${params.length}::int[])`);
  }
  const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";
  const { rows } = await db.query(
    `/* squads:LIST */
     SELECT s.id, s.nome, s.slug, s.ativo, s.created_at, s.updated_at,
            (SELECT COUNT(*)::int FROM squad_members sm WHERE sm.squad_id = s.id AND sm.ativo = true) AS membros_ativos,
            (SELECT COUNT(*)::int FROM cliente_squad_history csh WHERE csh.squad_id = s.id AND csh.fim_em IS NULL) AS clientes_ativos
       FROM squads s
       ${where}
      ORDER BY s.nome ASC`,
    params
  );
  return rows;
}

async function obterSquadPorId(id, db = pool) {
  const { rows } = await db.query(
    `/* squads:GET */
     SELECT id, nome, slug, ativo, created_at, updated_at FROM squads WHERE id = $1`,
    [Number(id)]
  );
  return rows[0] || null;
}

async function obterSquadPorSlug(slug, db = pool) {
  const { rows } = await db.query(
    `/* squads:GET_BY_SLUG */
     SELECT id, nome, slug, ativo, created_at, updated_at FROM squads WHERE slug = $1`,
    [String(slug)]
  );
  return rows[0] || null;
}

async function criarSquad({ nome, slug }, db = pool) {
  const { rows } = await db.query(
    `/* squads:INSERT */
     INSERT INTO squads (nome, slug) VALUES ($1, $2)
     RETURNING id, nome, slug, ativo, created_at, updated_at`,
    [nome, slug]
  );
  return rows[0];
}

async function atualizarSquad(id, { nome, slug, ativo }, db = pool) {
  const patches = [];
  const params = [];
  if (nome !== undefined) { params.push(nome); patches.push(`nome = $${params.length}`); }
  if (slug !== undefined) { params.push(slug); patches.push(`slug = $${params.length}`); }
  if (ativo !== undefined) { params.push(Boolean(ativo)); patches.push(`ativo = $${params.length}`); }
  if (!patches.length) return obterSquadPorId(id, db);
  patches.push("updated_at = NOW()");
  params.push(Number(id));
  const { rows } = await db.query(
    `/* squads:UPDATE */
     UPDATE squads SET ${patches.join(", ")} WHERE id = $${params.length}
     RETURNING id, nome, slug, ativo, created_at, updated_at`,
    params
  );
  return rows[0] || null;
}

/* ─────────────────────── squad_members ─────────────────────── */

// Memberships ativas do usuário, com dados do squad. Ordena principal
// primeiro. Filtra squad inativo? NÃO — para /me/context queremos mostrar
// a membership mesmo com squad inativo (com flag). A autorização é que
// filtra squad inativo (resolvePortfolio).
async function membershipsDoUsuario(userId, { apenasSquadAtivo = false } = {}, db = pool) {
  const filtroSquad = apenasSquadAtivo ? "AND s.ativo = true" : "";
  const { rows } = await db.query(
    `/* squads:MEMBERSHIPS_DO_USUARIO */
     SELECT sm.id, sm.squad_id, sm.user_id, sm.is_primary, sm.funcao, sm.ativo,
            s.nome AS squad_nome, s.slug AS squad_slug, s.ativo AS squad_ativo
       FROM squad_members sm
       JOIN squads s ON s.id = sm.squad_id
      WHERE sm.user_id = $1 AND sm.ativo = true ${filtroSquad}
      ORDER BY sm.is_primary DESC, s.nome ASC`,
    [Number(userId)]
  );
  return rows;
}

async function membrosDoSquad(squadId, db = pool) {
  const { rows } = await db.query(
    `/* squads:MEMBROS_DO_SQUAD */
     SELECT sm.id, sm.user_id, sm.is_primary, sm.funcao, sm.ativo,
            sm.created_at, sm.updated_at,
            u.nome AS user_nome, u.email AS user_email, u.role AS user_role
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
      WHERE sm.squad_id = $1 AND sm.ativo = true
      ORDER BY sm.is_primary DESC, u.nome ASC`,
    [Number(squadId)]
  );
  return rows;
}

async function obterMembership(squadId, userId, db = pool) {
  const { rows } = await db.query(
    `/* squads:GET_MEMBERSHIP */
     SELECT id, squad_id, user_id, is_primary, funcao, ativo
       FROM squad_members WHERE squad_id = $1 AND user_id = $2`,
    [Number(squadId), Number(userId)]
  );
  return rows[0] || null;
}

// coordenador de um squad específico (para RBAC das APIs admin). Retorna
// true se o usuário tem membership ativa com funcao='coordenador' naquele
// squad (que precisa estar ativo).
async function ehCoordenadorDoSquad(userId, squadId, db = pool) {
  const { rows } = await db.query(
    `/* squads:EH_COORDENADOR */
     SELECT 1
       FROM squad_members sm
       JOIN squads s ON s.id = sm.squad_id AND s.ativo = true
      WHERE sm.user_id = $1 AND sm.squad_id = $2
        AND sm.ativo = true AND sm.funcao = 'coordenador'
      LIMIT 1`,
    [Number(userId), Number(squadId)]
  );
  return rows.length > 0;
}

async function squadsCoordenadosPor(userId, db = pool) {
  const { rows } = await db.query(
    `/* squads:COORDENADOS_POR */
     SELECT sm.squad_id
       FROM squad_members sm
       JOIN squads s ON s.id = sm.squad_id AND s.ativo = true
      WHERE sm.user_id = $1 AND sm.ativo = true AND sm.funcao = 'coordenador'`,
    [Number(userId)]
  );
  return rows.map((r) => r.squad_id);
}

/* ───────────────────── cliente_squad_history ───────────────────── */

async function squadAtivoDoCliente(clienteId, db = pool) {
  const { rows } = await db.query(
    `/* squads:SQUAD_ATIVO_DO_CLIENTE */
     SELECT csh.id, csh.squad_id, csh.inicio_em,
            s.nome AS squad_nome, s.slug AS squad_slug, s.ativo AS squad_ativo
       FROM cliente_squad_history csh
       JOIN squads s ON s.id = csh.squad_id
      WHERE csh.cliente_id = $1 AND csh.fim_em IS NULL`,
    [Number(clienteId)]
  );
  return rows[0] || null;
}

// Squad ativo (id + nome + slug) de vários clientes de uma vez — para
// /me/portfolio e /me/context sem N+1.
async function squadsAtivosDeClientes(clienteIds, db = pool) {
  if (!Array.isArray(clienteIds) || !clienteIds.length) return [];
  const { rows } = await db.query(
    `/* squads:SQUADS_ATIVOS_DE_CLIENTES */
     SELECT csh.cliente_id, csh.squad_id,
            s.nome AS squad_nome, s.slug AS squad_slug, s.ativo AS squad_ativo
       FROM cliente_squad_history csh
       JOIN squads s ON s.id = csh.squad_id
      WHERE csh.fim_em IS NULL AND csh.cliente_id = ANY($1::int[])`,
    [clienteIds]
  );
  return rows;
}

async function clientesDoSquad(squadId, db = pool) {
  const { rows } = await db.query(
    `/* squads:CLIENTES_DO_SQUAD */
     SELECT c.id, c.slug, c.nome, c.ativo,
            csh.inicio_em, csh.alterado_por
       FROM cliente_squad_history csh
       JOIN clientes c ON c.id = csh.cliente_id
      WHERE csh.squad_id = $1 AND csh.fim_em IS NULL
      ORDER BY c.nome ASC`,
    [Number(squadId)]
  );
  return rows;
}

async function historicoDoCliente(clienteId, db = pool) {
  const { rows } = await db.query(
    `/* squads:HISTORICO_DO_CLIENTE */
     SELECT csh.id, csh.squad_id, s.nome AS squad_nome, s.slug AS squad_slug,
            csh.inicio_em, csh.fim_em, csh.alterado_por, csh.motivo,
            u.nome AS alterado_por_nome
       FROM cliente_squad_history csh
       JOIN squads s ON s.id = csh.squad_id
       LEFT JOIN users u ON u.id = csh.alterado_por
      WHERE csh.cliente_id = $1
      ORDER BY csh.inicio_em DESC, csh.id DESC`,
    [Number(clienteId)]
  );
  return rows;
}

/* ─────────────────────── cliente_responsaveis ─────────────────────── */

async function responsaveisDeClientes(clienteIds, userId = null, db = pool) {
  if (!Array.isArray(clienteIds) || !clienteIds.length) return [];
  const params = [clienteIds];
  let filtroUser = "";
  if (userId != null) {
    params.push(Number(userId));
    filtroUser = `AND cr.user_id = $${params.length}`;
  }
  const { rows } = await db.query(
    `/* squads:RESPONSAVEIS_DE_CLIENTES */
     SELECT cr.cliente_id, cr.user_id, cr.papel
       FROM cliente_responsaveis cr
      WHERE cr.ativo = true AND cr.cliente_id = ANY($1::int[]) ${filtroUser}`,
    params
  );
  return rows;
}

module.exports = {
  ensureSquadsTables,
  listarSquads,
  obterSquadPorId,
  obterSquadPorSlug,
  criarSquad,
  atualizarSquad,
  membershipsDoUsuario,
  membrosDoSquad,
  obterMembership,
  ehCoordenadorDoSquad,
  squadsCoordenadosPor,
  squadAtivoDoCliente,
  squadsAtivosDeClientes,
  clientesDoSquad,
  historicoDoCliente,
  responsaveisDeClientes,
  _resetEnsuredParaTeste: () => { _ensured = false; },
};
