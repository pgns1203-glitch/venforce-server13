// Lista mínima de clientes usada exclusivamente pelo seletor do Fechamento.
// A consulta e a projeção final não incluem credenciais ou metadados sensíveis.
//
// V3 P2.7 BLOCO L — esta rota rodava `SELECT ... FROM clientes WHERE ativo = true`
// sem NENHUM filtro de carteira, e o controller nem passava `req.user`. Qualquer
// papel de automações (`membro` inclusive) enxergava todos os clientes ativos da
// base, de todos os Squads e de todos os sellers.
//
// Agora delega para o authorizationService — a MESMA fonte única de carteira do
// resto do V3 (admin bypass, seller por vínculo, interno por Squad). Com
// SQUADS_ENFORCEMENT=OFF o resultado para papel interno é idêntico ao de antes,
// então não há quebra de comportamento hoje: o que muda é que a rota passa a
// respeitar a carteira sozinha quando o enforcement for ligado, e já hoje isola
// `seller` e papéis sem carteira operacional.

const { resolvePortfolioClientes } = require("../squads/authorizationService");

async function listarClientesAtivosFinanceiro(user) {
  const rows = await resolvePortfolioClientes(user || {});

  // Defesa adicional: mesmo que a fonte mude no futuro, o contrato público
  // desta rota continua restrito a estes quatro campos. `ativo` é sempre true
  // porque toda consulta de carteira já filtra cliente ativo.
  return rows.map((cliente) => ({
    id: cliente.id,
    nome: cliente.nome,
    slug: cliente.slug,
    ativo: true,
  }));
}

module.exports = { listarClientesAtivosFinanceiro };
