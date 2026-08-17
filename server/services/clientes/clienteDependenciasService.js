// server/services/clientes/clienteDependenciasService.js
//
// A auditoria de clientes/contas encontrou um risco crítico: DELETE
// /clientes/:slug é hard delete e mistura CASCADE destrutivo (grants,
// Cliente 360, Seller, Design, diagnósticos, contas) com tabelas sem FK que
// ficam órfãs (Central de Vendas, Ads, anúncios). Esta função dá uma
// proteção mínima: antes de excluir, verifica se existem dependências
// relevantes e bloqueia com 409 em vez de apagar tudo silenciosamente.
//
// Não implementa soft delete de cliente nem cascades novas — apenas evita
// que o hard delete atual rode sem avisar o que será perdido/orfanado.

const pool = require("../../config/database");

// (label exibido, tabela, coluna de identidade do cliente)
const TABELAS_DEPENDENTES = [
  ["Contas de marketplace", "cliente_contas", "cliente_id"],
  ["Grants Mercado Livre", "ml_tokens", "cliente_id"],
  ["Vínculos de base", "base_cliente_vinculos", "cliente_id"],
  ["Entregas/fechamentos", "entregas_cliente", "cliente_id"],
  ["Imports da Central de Vendas", "central_vendas_imports", "cliente_id"],
  ["Relatórios", "relatorios", "cliente_id"],
  ["Resumos do Cliente 360", "cliente_360_resumos_mensais", "cliente_id"],
  ["Diagnósticos iniciais", "diagnosticos_iniciais", "cliente_id"],
  ["Permissões de seller", "seller_clientes", "cliente_id"],
  ["Perfil do Design Studio", "design_client_profiles", "cliente_id"],
  ["Catálogo de anúncios ML", "meli_anuncios", "cliente_id"],
];

async function tabelaExiste(tabela) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1`,
    [tabela]
  );
  return r.rows.length > 0;
}

async function verificarDependenciasCliente(clienteId) {
  const dependencias = [];
  for (const [label, tabela, coluna] of TABELAS_DEPENDENTES) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await tabelaExiste(tabela))) continue;
    // eslint-disable-next-line no-await-in-loop
    const r = await pool.query(`SELECT COUNT(*)::int AS total FROM ${tabela} WHERE ${coluna} = $1`, [clienteId]);
    const total = r.rows[0]?.total || 0;
    if (total > 0) dependencias.push({ label, tabela, total });
  }
  return dependencias;
}

module.exports = { verificarDependenciasCliente };
