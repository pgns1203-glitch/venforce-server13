// Prazos da coleta e da gravação da Central de Vendas (incidente P0 2026-10-02).
// Antes, uma chamada ao Mercado Livre/Mercado Pago, uma query da transação de gravação ou uma
// unidade inteira do agendador podiam esperar PARA SEMPRE: 3 unidades presas ocupavam as 3 vagas
// de concorrência da rodada noturna até um restart. Todos os prazos são configuráveis por env e
// valores inválidos (não positivos/não numéricos) caem no padrão — não há como desligá-los por engano.
const { lerMsPositivo } = require("../../config/databaseConexao");

const PADRAO = {
  mlMs: 30 * 1000,           // CENTRAL_VENDAS_ML_TIMEOUT_MS — uma chamada à API do Mercado Livre
  mpMs: 30 * 1000,           // CENTRAL_VENDAS_MP_TIMEOUT_MS — uma chamada à API do Mercado Pago
  dbQueryMs: 60 * 1000,      // CENTRAL_VENDAS_DB_QUERY_TIMEOUT_MS — UMA query da transação de gravação do import
  unidadeMs: 30 * 60 * 1000, // CENTRAL_VENDAS_NOTURNO_UNIDADE_TIMEOUT_MS — executar UMA conta x período
  fechamentoMs: 5 * 60 * 1000, // CENTRAL_VENDAS_NOTURNO_FECHAMENTO_TIMEOUT_MS — Ads / snapshot de um grupo
};

function prazos(env = process.env) {
  return {
    mlMs: lerMsPositivo(env.CENTRAL_VENDAS_ML_TIMEOUT_MS, PADRAO.mlMs),
    mpMs: lerMsPositivo(env.CENTRAL_VENDAS_MP_TIMEOUT_MS, PADRAO.mpMs),
    dbQueryMs: lerMsPositivo(env.CENTRAL_VENDAS_DB_QUERY_TIMEOUT_MS, PADRAO.dbQueryMs),
    unidadeMs: lerMsPositivo(env.CENTRAL_VENDAS_NOTURNO_UNIDADE_TIMEOUT_MS, PADRAO.unidadeMs),
    fechamentoMs: lerMsPositivo(env.CENTRAL_VENDAS_NOTURNO_FECHAMENTO_TIMEOUT_MS, PADRAO.fechamentoMs),
  };
}

// Fábrica testável: devolve uma função com a mesma assinatura da base, que injeta o prazo por padrão
// (o chamador ainda pode passar o próprio timeoutMs).
function comPrazoPadrao(base, chavePrazo, env = process.env) {
  return (clienteId, path, options = {}) => base(clienteId, path, { timeoutMs: prazos(env)[chavePrazo], ...options });
}

module.exports = { prazos, PADRAO, comPrazoPadrao };
