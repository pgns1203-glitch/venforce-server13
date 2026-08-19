// server/services/bases/baseDependenciesService.js
//
// Preflight de dependências antes do hard delete de uma base (achado P0 da
// auditoria: DELETE /bases/:baseId apagava direto, sem checar nada, e podia
// derrubar em 500 por causa de seller_custos_submissoes — que não declara
// ON DELETE — ou apagar silenciosamente um vínculo ativo por CASCADE).
//
// Esta função é só leitura: nunca decide sozinha por soft delete nem apaga
// nada. Quem chama decide se bloqueia (409) ou segue com o hard delete.

const pool = require("../../config/database");

async function checarDependenciasBase(baseId) {
  const [vinculo, submissoes, custos, relatorios] = await Promise.all([
    pool.query(
      `SELECT v.id, v.cliente_conta_id, c.nome AS cliente_nome
         FROM base_cliente_vinculos v
         LEFT JOIN clientes c ON c.id = v.cliente_id
        WHERE v.base_id = $1 AND v.ativo = true`,
      [baseId]
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM seller_custos_submissoes WHERE base_id = $1`, [baseId]),
    pool.query(`SELECT COUNT(*)::int AS total FROM custos WHERE base_id = $1`, [baseId]),
    pool.query(`SELECT COUNT(*)::int AS total FROM relatorios WHERE base_id = $1`, [baseId]),
  ]);

  const dependencias = [];

  // Bloqueante: nunca deixar o CASCADE apagar um vínculo ativo em silêncio.
  if (vinculo.rows.length) {
    const v = vinculo.rows[0];
    dependencias.push({
      tipo: "vinculo_ativo",
      bloqueia: true,
      mensagem: `Base vinculada${v.cliente_nome ? ` ao cliente "${v.cliente_nome}"` : ""}${v.cliente_conta_id ? ` (conta ${v.cliente_conta_id})` : ""}. Desative o vínculo antes de excluir.`,
    });
  }

  // Bloqueante: sem ON DELETE declarado, o Postgres barra com erro cru (500).
  const totalSubmissoes = submissoes.rows[0]?.total || 0;
  if (totalSubmissoes > 0) {
    dependencias.push({
      tipo: "seller_submissoes",
      bloqueia: true,
      mensagem: `${totalSubmissoes} submissão(ões) de custo do Seller referenciam esta base.`,
    });
  }

  // Informativo: CASCADE apaga custos; útil pro operador ver antes de confirmar.
  const totalCustos = custos.rows[0]?.total || 0;
  if (totalCustos > 0) {
    dependencias.push({
      tipo: "custos",
      bloqueia: false,
      mensagem: `${totalCustos} custo(s) cadastrados serão apagados permanentemente.`,
    });
  }

  // Informativo: relatorios.base_id é SET NULL — não bloqueia, só avisa.
  const totalRelatorios = relatorios.rows[0]?.total || 0;
  if (totalRelatorios > 0) {
    dependencias.push({
      tipo: "relatorios",
      bloqueia: false,
      mensagem: `${totalRelatorios} relatório(s) referenciam esta base (o vínculo por base_id será perdido; o slug textual é preservado).`,
    });
  }

  return {
    bloqueado: dependencias.some((d) => d.bloqueia),
    dependencias,
  };
}

module.exports = { checarDependenciasBase };
