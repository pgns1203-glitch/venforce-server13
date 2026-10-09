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

// Uma conexão com o PostgreSQL que cai (crash/restart do servidor, rede) faz o
// `pg` emitir 'error' no Client — e 'error' sem listener derruba o PROCESSO
// inteiro (incidente 2026-10-09: o PostgreSQL entrou em recuperação de crash
// durante o sync e o Web Service caiu junto). O pg-pool só escuta 'error'
// enquanto a conexão está OCIOSA; conexão em uso — transação, advisory lock de
// sessão, qualquer `pool.connect()` — fica sem listener nenhum. Aqui: um
// listener permanente em TODA conexão que o pool cria (vale ociosa e em uso) e
// um no próprio pool (que reemite o erro das ociosas). Não engole o erro: ele
// é registrado, a query em voo já foi rejeitada pelo `pg` com o mesmo erro (é
// ela que faz a operação falhar) e a conexão, inutilizável, é descartada pelo
// pool no release.
function protegerConexoesDoPool(pool, { logger = console } = {}) {
  pool.on("connect", (client) => {
    client.on("error", (err) => {
      const code = err?.code ? `${err.code} ` : "";
      logger.error(`[db] conexão com o PostgreSQL perdida: ${code}${err?.message || err} — conexão descartada; a operação que a usava falha e o processo segue`);
    });
  });
  // O erro de uma conexão ociosa chega aqui DEPOIS de já ter sido registrado
  // pelo listener do client acima; este listener existe só para o
  // EventEmitter do pool não relançá-lo como exceção não tratada.
  pool.on("error", () => {});
  return pool;
}

module.exports = { configConexao, lerMsPositivo, protegerConexoesDoPool };
