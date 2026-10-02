const { Pool } = require('pg');
const { configConexao, lerMsPositivo } = require('./databaseConexao');

// Espera por uma conexão LIVRE do pool tem prazo. Sem ele (padrão do pg =
// infinito), um pool esgotado deixava toda requisição pendurada até o timeout
// do cliente HTTP — incidente de 2026-10-02 (GET /me/context sem resposta).
// Só limita a OBTENÇÃO da conexão: query e transação já em andamento nunca
// são interrompidas por isto (não há statement_timeout global de propósito).
const POOL_CONNECTION_TIMEOUT_PADRAO_MS = 30000;

const pool = new Pool({
  ...configConexao(),
  connectionTimeoutMillis: lerMsPositivo(process.env.PG_POOL_CONNECTION_TIMEOUT_MS, POOL_CONNECTION_TIMEOUT_PADRAO_MS),
});

module.exports = pool;
