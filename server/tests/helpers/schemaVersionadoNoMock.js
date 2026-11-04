// server/tests/helpers/schemaVersionadoNoMock.js
//
// Desde 03/11/2026 (P0 estabilidade do PostgreSQL) os ensure* do pool passam
// por services/schema/schemaVersionado.js: SELECT do marcador no pool e, se
// preciso, conexão dedicada com BEGIN / SET LOCAL / advisory lock / DDL /
// INSERT do marcador / COMMIT. Testes que mockam `pool.query` só para as
// consultas de negócio usam isto para aceitar esse diálogo como no-op.

function ehDialogoDeSchema(sql) {
  const q = String(sql).trim();
  return /schema:VERSAO/.test(q)
    || /^(BEGIN|COMMIT|ROLLBACK)$/i.test(q)
    || /^SET LOCAL (statement_timeout|lock_timeout)/i.test(q)
    || /pg_advisory_xact_lock/.test(q)
    || /venforce_schema_versoes/.test(q);
}

// connect() fake que devolve um "client" delegando ao pool.query ATUAL (o mock).
function connectDelegandoAoQuery(pool) {
  return async () => ({ query: (sql, params) => pool.query(sql, params), release() {} });
}

module.exports = { ehDialogoDeSchema, connectDelegandoAoQuery };
