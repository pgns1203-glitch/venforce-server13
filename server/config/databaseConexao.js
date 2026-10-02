// server/config/databaseConexao.js
// Parâmetros de conexão com o PostgreSQL, compartilhados pelo pool
// (config/database.js) e pelas conexões DEDICADAS que vivem fora dele (ex.:
// advisory lock de sessão do "Atualizar dados" do Painel de Contas). Uma
// fonte só, para as duas nunca divergirem (SSL, URL).

function configConexao() {
  return {
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  };
}

// Inteiro positivo em ms; qualquer outra coisa (vazio, 0, negativo, texto)
// cai no padrão — nunca num prazo infinito por engano de configuração.
function lerMsPositivo(valor, padrao) {
  const n = Number.parseInt(valor, 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

module.exports = { configConexao, lerMsPositivo };
