// server/services/sentinel/sentinelAcesso.js
// Autorização do Sentinel (V0-b). Tudo no servidor; nada vem do navegador.
//
// Carteira do Sentinel = INTERSEÇÃO de duas fontes existentes (nunca amplia):
//   escopo do Painel de Contas (painelContasAcesso.resolverEscopoPainel) ∩
//   authorizationService.resolvePortfolioClientes.
// O escopo do Painel não depende de SQUADS_ENFORCEMENT (decisão do usuário
// 19/10, precedente do Painel): interno sem Squad/vínculo = VAZIO com o
// enforcement ligado OU desligado. Com enforcement OFF o authorizationService
// dá "todos" ao interno, mas a interseção com o Painel o restringe ao(s) seu(s)
// Squad(s). Admin = todos. Este arquivo só IMPORTA as duas fontes.
//
// Contas ML DESATIVADAS do cliente continuam na carteira para LEITURA e ações humanas
// (reconhecer/resolver), marcadas com ativo:false; o que muda é só o monitoramento.
//
// Filtros de leitura (squad/cliente/conta) são sempre estreitamento.
//
// Papéis: admin e papéis internos. seller e demais papéis não usam o Sentinel.

const pool = require("../../config/database");
const authz = require("../squads/authorizationService");
const { resolverEscopoPainel } = require("../painelContas/painelContasAcesso");

function papelPermitido(user) {
  return authz.ehAdmin(user) || authz.ehInterno(user);
}

const SQL_CONTAS = `/* sentinel:CONTAS_DA_CARTEIRA */
  SELECT cc.id, cc.cliente_id, cc.nome, cc.marketplace, cc.ativo,
         c.slug AS cliente_slug, c.nome AS cliente_nome,
         s.id AS squad_id, s.nome AS squad_nome
    FROM cliente_contas cc
    JOIN clientes c ON c.id = cc.cliente_id
    LEFT JOIN cliente_squad_history csh ON csh.cliente_id = c.id AND csh.fim_em IS NULL
    LEFT JOIN squads s ON s.id = csh.squad_id
   WHERE cc.cliente_id = ANY($1::int[])
     AND cc.marketplace = 'meli'
   ORDER BY c.nome, cc.nome`;

// Contas ML (ativas e desativadas) da carteira do usuário (+ filtros como interseção).
// Retorna { contaIds:number[], contas:[{id,clienteId,clienteSlug,clienteNome,nome,ativo,squad}] }.
async function contasAutorizadas(user, filtros = {}, db = pool) {
  const [global, painel] = await Promise.all([authz.resolvePortfolioClientes(user, db), resolverEscopoPainel(user, db)]);
  const doPainel = new Set(painel.clientes.map((c) => Number(c.id)));
  const clienteIds = global.map((c) => c.id).filter((id) => doPainel.has(Number(id)));
  if (!clienteIds.length) return { contaIds: [], contas: [] };
  const { rows } = await db.query(SQL_CONTAS, [clienteIds]);
  let contas = rows.map((r) => ({
    id: r.id,
    clienteId: r.cliente_id,
    clienteSlug: r.cliente_slug,
    clienteNome: r.cliente_nome,
    nome: r.nome,
    ativo: r.ativo !== false,
    squad: r.squad_id ? { id: r.squad_id, nome: r.squad_nome } : null,
  }));
  if (filtros.squad) contas = contas.filter((c) => c.squad && String(c.squad.id) === String(filtros.squad));
  if (filtros.cliente) {
    const ref = String(filtros.cliente).toLowerCase();
    contas = contas.filter((c) => String(c.clienteId) === ref || c.clienteSlug.toLowerCase() === ref);
  }
  if (filtros.conta) contas = contas.filter((c) => String(c.id) === String(filtros.conta));
  return { contaIds: contas.map((c) => c.id), contas };
}

// Autoriza UMA conta (para rotas por ID de incidente). Mesma regra da lista:
// cliente da conta ∈ carteira. Fora/inexistente → null/false (a rota responde 404 igual
// nos dois casos — não revela existência).
async function contaAutorizadaInfo(user, contaId, db = pool) {
  const id = Number(contaId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const { contas } = await contasAutorizadas(user, { conta: id }, db);
  return contas.find((c) => c.id === id) || null;
}
async function contaAutorizada(user, contaId, db = pool) {
  return !!(await contaAutorizadaInfo(user, contaId, db));
}

module.exports = { papelPermitido, contasAutorizadas, contaAutorizada, contaAutorizadaInfo };
