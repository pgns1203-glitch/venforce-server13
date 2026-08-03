// Lista mínima de clientes usada exclusivamente pelo seletor do Fechamento.
// A consulta e a projeção final não incluem credenciais ou metadados sensíveis.

const pool = require("../../config/database");

async function listarClientesAtivosFinanceiro() {
  const { rows } = await pool.query(`
    SELECT id, nome, slug, ativo
    FROM clientes
    WHERE ativo = true
    ORDER BY nome ASC
  `);

  // Defesa adicional: mesmo que a consulta seja alterada no futuro, o contrato
  // público desta rota continua restrito a estes quatro campos.
  return rows.map((cliente) => ({
    id: cliente.id,
    nome: cliente.nome,
    slug: cliente.slug,
    ativo: cliente.ativo,
  }));
}

module.exports = { listarClientesAtivosFinanceiro };
