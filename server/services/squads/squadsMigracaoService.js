// server/services/squads/squadsMigracaoService.js
// Relatório de auditoria de migração (mission §28). NÃO atribui nada
// automaticamente — só mostra o que precisa de decisão humana.

const pool = require("../../config/database");
const { ensureSquadsTables } = require("./squadsRepository");

// Papéis considerados "internos" para fins de migração de membership.
const ROLES_INTERNAS = ["user", "membro", "interno"];

async function auditoria(db = pool) {
  await ensureSquadsTables(db);

  const [clientesAgg, clientesSemSquad, usuariosAgg, principaisDuplicados] = await Promise.all([
    db.query(`/* squads:AUDIT_CLIENTES */
      SELECT
        COUNT(*) FILTER (WHERE c.ativo = true)::int AS ativos,
        COUNT(*) FILTER (WHERE c.ativo = true AND csh.cliente_id IS NOT NULL)::int AS com_squad,
        COUNT(*) FILTER (WHERE c.ativo = true AND csh.cliente_id IS NULL)::int AS sem_squad
      FROM clientes c
      LEFT JOIN cliente_squad_history csh
        ON csh.cliente_id = c.id AND csh.fim_em IS NULL`),

    db.query(`/* squads:AUDIT_CLIENTES_SEM_SQUAD */
      SELECT c.id, c.slug, c.nome
        FROM clientes c
        LEFT JOIN cliente_squad_history csh
          ON csh.cliente_id = c.id AND csh.fim_em IS NULL
       WHERE c.ativo = true AND csh.cliente_id IS NULL
       ORDER BY c.nome ASC`),

    db.query(`/* squads:AUDIT_USUARIOS */
      SELECT
        COUNT(*)::int AS internos,
        COUNT(*) FILTER (WHERE m.total_ativas > 0)::int AS com_membership,
        COUNT(*) FILTER (WHERE COALESCE(m.total_ativas, 0) = 0)::int AS sem_membership,
        COUNT(*) FILTER (WHERE m.total_ativas > 1)::int AS com_multiplas,
        COUNT(*) FILTER (WHERE m.total_ativas > 0 AND COALESCE(m.total_principais, 0) = 0)::int AS sem_principal
      FROM users u
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS total_ativas,
               COUNT(*) FILTER (WHERE sm.is_primary)::int AS total_principais
          FROM squad_members sm
         WHERE sm.user_id = u.id AND sm.ativo = true
      ) m ON true
      WHERE u.ativo = true AND LOWER(u.role) = ANY($1::text[])`, [ROLES_INTERNAS]),

    // Principal duplicado é bloqueado pelo indice parcial unico, mas
    // checamos por seguranca (dados legados inseridos fora do service).
    db.query(`/* squads:AUDIT_PRINCIPAL_DUPLICADO */
      SELECT sm.user_id, COUNT(*)::int AS principais
        FROM squad_members sm
       WHERE sm.ativo = true AND sm.is_primary = true
       GROUP BY sm.user_id
      HAVING COUNT(*) > 1`),
  ]);

  const c = clientesAgg.rows[0];
  const u = usuariosAgg.rows[0];

  return {
    geradoEm: new Date().toISOString(),
    clientesAtivos: {
      total: c.ativos,
      comSquad: c.com_squad,
      semSquad: c.sem_squad,
      listaSemSquad: clientesSemSquad.rows,
    },
    usuariosInternos: {
      total: u.internos,
      comMembership: u.com_membership,
      semMembership: u.sem_membership,
      comMultiplasMemberships: u.com_multiplas,
      semPrincipal: u.sem_principal,
      comPrincipalDuplicado: principaisDuplicados.rows.length,
      principalDuplicadoUserIds: principaisDuplicados.rows.map((r) => r.user_id),
    },
    pronto: c.sem_squad === 0 && u.sem_membership === 0 && u.sem_principal === 0 && principaisDuplicados.rows.length === 0,
  };
}

module.exports = { auditoria };
