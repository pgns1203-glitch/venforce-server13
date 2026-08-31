// server/services/squads/squadsMigracaoService.js
// Relatório de auditoria de migração (mission §28). NÃO atribui nada
// automaticamente — só mostra o que precisa de decisão humana.
//
// P2.3: a auditoria agora distingue "Squad inativo" como categoria própria,
// tanto para clientes quanto para usuários internos (o readiness registrou
// essa lacuna). Chaves legadas (semSquad, comSquad, semMembership,
// comMultiplasMemberships, comPrincipalDuplicado, pronto) preservadas.

const pool = require("../../config/database");
const { ensureSquadsTables } = require("./squadsRepository");

// Papéis considerados "internos" para fins de migração de membership.
const ROLES_INTERNAS = ["user", "membro", "interno"];

async function auditoria(db = pool) {
  await ensureSquadsTables(db);

  const [
    clientesAgg,
    clientesSemSquad,
    clientesSquadInativo,
    usuariosAgg,
    principaisDuplicados,
    vinculosDuplicados,
    responsaveisForaDoSquad,
    membrosDeUsuarioInativo,
  ] = await Promise.all([
    db.query(`/* squads:AUDIT_CLIENTES */
      SELECT
        COUNT(*) FILTER (WHERE c.ativo = true)::int AS ativos,
        COUNT(*) FILTER (WHERE c.ativo = true AND s.id IS NOT NULL AND s.ativo = true)::int AS com_squad_ativo,
        COUNT(*) FILTER (WHERE c.ativo = true AND s.id IS NOT NULL AND s.ativo = false)::int AS em_squad_inativo,
        COUNT(*) FILTER (WHERE c.ativo = true AND csh.cliente_id IS NULL)::int AS sem_squad
      FROM clientes c
      LEFT JOIN cliente_squad_history csh
        ON csh.cliente_id = c.id AND csh.fim_em IS NULL
      LEFT JOIN squads s ON s.id = csh.squad_id`),

    db.query(`/* squads:AUDIT_CLIENTES_SEM_SQUAD */
      SELECT c.id, c.slug, c.nome
        FROM clientes c
        LEFT JOIN cliente_squad_history csh
          ON csh.cliente_id = c.id AND csh.fim_em IS NULL
       WHERE c.ativo = true AND csh.cliente_id IS NULL
       ORDER BY c.nome ASC`),

    db.query(`/* squads:AUDIT_CLIENTES_SQUAD_INATIVO */
      SELECT c.id, c.slug, c.nome, s.id AS squad_id, s.slug AS squad_slug, s.nome AS squad_nome
        FROM clientes c
        JOIN cliente_squad_history csh
          ON csh.cliente_id = c.id AND csh.fim_em IS NULL
        JOIN squads s ON s.id = csh.squad_id
       WHERE c.ativo = true AND s.ativo = false
       ORDER BY c.nome ASC`),

    db.query(`/* squads:AUDIT_USUARIOS */
      SELECT
        COUNT(*)::int AS internos,
        COUNT(*) FILTER (WHERE m.total_ativas > 0)::int AS com_membership,
        COUNT(*) FILTER (WHERE COALESCE(m.total_ativas, 0) = 0)::int AS sem_membership,
        COUNT(*) FILTER (WHERE m.total_ativas > 0 AND COALESCE(m.total_squad_ativo, 0) = 0)::int AS apenas_squad_inativo,
        COUNT(*) FILTER (WHERE m.total_ativas > 1)::int AS com_multiplas,
        COUNT(*) FILTER (WHERE m.total_ativas > 1 AND COALESCE(m.total_principais, 0) = 1 AND COALESCE(m.total_squad_ativo, 0) >= 1)::int AS multi_squad_valido,
        COUNT(*) FILTER (WHERE m.total_ativas > 0 AND COALESCE(m.total_principais, 0) = 0)::int AS sem_principal
      FROM users u
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS total_ativas,
               COUNT(*) FILTER (WHERE sm.is_primary)::int AS total_principais,
               COUNT(*) FILTER (WHERE sq.ativo = true)::int AS total_squad_ativo
          FROM squad_members sm
          JOIN squads sq ON sq.id = sm.squad_id
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

    // P2.8 BLOCO Y — MULTIPLOS VINCULOS ATIVOS do mesmo cliente.
    // `cliente_squad_history` modela historico: o vinculo VIGENTE e a linha com
    // fim_em IS NULL, e so pode existir UMA. Duas linhas abertas significam que
    // o mesmo cliente pertence a dois Squads ao mesmo tempo — a carteira fica
    // nao-deterministica e o rollout NAO pode acontecer nesse estado.
    db.query(`/* squads:AUDIT_VINCULOS_DUPLICADOS */
      SELECT csh.cliente_id, c.slug, c.nome, COUNT(*)::int AS vinculos_abertos,
             ARRAY_AGG(csh.squad_id ORDER BY csh.squad_id) AS squad_ids
        FROM cliente_squad_history csh
        JOIN clientes c ON c.id = csh.cliente_id
       WHERE csh.fim_em IS NULL
       GROUP BY csh.cliente_id, c.slug, c.nome
      HAVING COUNT(*) > 1
       ORDER BY c.nome ASC`),

    // P2.8 BLOCO Y — RESPONSAVEL POR CLIENTE FORA DO SEU SQUAD.
    // Isto NAO e falha de autorizacao: responsabilidade nunca concedeu acesso,
    // e continua nao concedendo. E uma inconsistencia ORGANIZACIONAL, e o
    // momento de ve-la e ANTES do rollout: quando o enforcement ligar, essa
    // pessoa deixa de conseguir abrir justamente o cliente pelo qual ela e
    // responsavel. Corrigir e decisao humana (mover o cliente de Squad ou a
    // pessoa para o Squad) — a auditoria so mostra.
    db.query(`/* squads:AUDIT_RESPONSAVEL_FORA_DO_SQUAD */
      SELECT cr.cliente_id, c.slug, c.nome, cr.user_id, cr.papel,
             u.nome AS user_nome, u.email AS user_email
        FROM cliente_responsaveis cr
        JOIN clientes c ON c.id = cr.cliente_id AND c.ativo = true
        JOIN users u ON u.id = cr.user_id AND u.ativo = true
       WHERE cr.ativo = true
         AND LOWER(u.role) = ANY($1::text[])
         AND NOT EXISTS (
           SELECT 1
             FROM cliente_squad_history csh
             JOIN squads s ON s.id = csh.squad_id AND s.ativo = true
             JOIN squad_members sm ON sm.squad_id = s.id
              AND sm.user_id = cr.user_id AND sm.ativo = true
            WHERE csh.cliente_id = cr.cliente_id AND csh.fim_em IS NULL
         )
       ORDER BY c.nome ASC, cr.papel ASC`, [ROLES_INTERNAS]),

    // P2.8 BLOCO Y — membership ATIVA de usuario DESATIVADO. Nao concede
    // acesso (o login ja barra), mas suja a contagem de membros do Squad e
    // esconde que o Squad pode estar sem gente de verdade.
    db.query(`/* squads:AUDIT_MEMBRO_USUARIO_INATIVO */
      SELECT sm.user_id, sm.squad_id, u.nome AS user_nome, s.slug AS squad_slug
        FROM squad_members sm
        JOIN users u ON u.id = sm.user_id
        JOIN squads s ON s.id = sm.squad_id
       WHERE sm.ativo = true AND u.ativo = false
       ORDER BY s.slug ASC`),
  ]);

  const c = clientesAgg.rows[0];
  const u = usuariosAgg.rows[0];
  const principalDuplicado = principaisDuplicados.rows.length;

  // P2.8 BLOCO Y — o que BLOQUEIA o rollout e o que so ATRAPALHA sao coisas
  // diferentes, e misturar as duas esconde o bloqueio.
  //   bloqueante  = a carteira fica errada ou nao-deterministica;
  //   atencao     = inconsistencia real que alguem precisa resolver, mas que
  //                 nao torna a autorizacao incorreta.
  const vinculoDuplicado = vinculosDuplicados.rows.length;

  const pronto =
    c.sem_squad === 0 &&
    c.em_squad_inativo === 0 &&
    u.sem_membership === 0 &&
    u.apenas_squad_inativo === 0 &&
    u.sem_principal === 0 &&
    principalDuplicado === 0 &&
    vinculoDuplicado === 0;

  return {
    geradoEm: new Date().toISOString(),
    clientesAtivos: {
      total: c.ativos,
      // legado: comSquad = qualquer squad ativo aberto (inclui inativo)
      comSquad: c.com_squad_ativo + c.em_squad_inativo,
      comSquadAtivo: c.com_squad_ativo,
      emSquadInativo: c.em_squad_inativo,
      semSquad: c.sem_squad,
      listaSemSquad: clientesSemSquad.rows,
      listaEmSquadInativo: clientesSquadInativo.rows,
    },
    usuariosInternos: {
      total: u.internos,
      comMembership: u.com_membership,
      semMembership: u.sem_membership,
      apenasEmSquadInativo: u.apenas_squad_inativo,
      comMultiplasMemberships: u.com_multiplas,
      multiSquadValido: u.multi_squad_valido,
      semPrincipal: u.sem_principal,
      comPrincipalDuplicado: principalDuplicado,
      principalDuplicadoUserIds: principaisDuplicados.rows.map((r) => r.user_id),
    },
    // Vinculo duplicado e BLOQUEANTE: o mesmo cliente em dois Squads abertos
    // torna a carteira nao-deterministica.
    integridade: {
      clientesComVinculoDuplicado: vinculoDuplicado,
      listaVinculoDuplicado: vinculosDuplicados.rows,
    },
    // Atencao: nao bloqueia o rollout, mas alguem precisa resolver.
    atencao: {
      responsaveisForaDoSquad: responsaveisForaDoSquad.rows.length,
      listaResponsaveisForaDoSquad: responsaveisForaDoSquad.rows,
      membershipsDeUsuarioInativo: membrosDeUsuarioInativo.rows.length,
      listaMembershipsDeUsuarioInativo: membrosDeUsuarioInativo.rows,
    },
    pronto,
  };
}

module.exports = { auditoria };
