const { performance } = require("node:perf_hooks");

// Apenas nomes de etapas/tabelas, contagens, tempos e códigos. Nunca SQL,
// parâmetros, resultados, manifesto ou mensagens de erro do PostgreSQL.
function diagnostics({
  onStage,
  logger = console,
  now = () => performance.now(),
} = {}) {
  const started = now();
  let lastStage = "start",
    queries = 0;
  const send = (event) => {
    try {
      if (onStage) onStage(event);
      else if (
        event.status === "error" ||
        event.durationMs >= 250 ||
        event.stage === "total"
      )
        (event.status === "error" ? logger.warn : logger.info)?.call(
          logger,
          JSON.stringify(event),
        );
    } catch (_) {
      /* Observabilidade não pode alterar o plano/transação. */
    }
  };
  async function measure(stage, fn, details = {}) {
    lastStage = stage;
    const begin = now();
    try {
      const result = await fn();
      send({
        event: "client_unification_snapshot",
        stage,
        ...details,
        status: "ok",
        durationMs: Math.round((now() - begin) * 10) / 10,
        ...(Array.isArray(result?.rows) ? { rows: result.rows.length } : {}),
      });
      return result;
    } catch (error) {
      send({
        event: "client_unification_snapshot",
        stage,
        ...details,
        status: "error",
        durationMs: Math.round((now() - begin) * 10) / 10,
        code: /^[A-Z0-9_]{2,80}$/.test(error?.code || "")
          ? error.code
          : "SNAPSHOT_QUERY_FAILED",
      });
      throw error;
    }
  }
  return {
    measure,
    span(stage) {
      const start = now();
      return (details = {}) => {
        lastStage = stage;
        send({
          event: "client_unification_snapshot",
          stage,
          ...details,
          status: "ok",
          durationMs: Math.round((now() - start) * 10) / 10,
        });
      };
    },
    table(table, phase, rows, serverMs) {
      send({
        event: "client_unification_snapshot",
        stage: "table.loaded",
        table,
        phase,
        rows,
        status: "ok",
        durationMs: Number(serverMs),
      });
    },
    query(db, stage, sql, params, details) {
      queries++;
      return measure(stage, () => db.query(sql, params), details);
    },
    finish(status) {
      send({
        event: "client_unification_snapshot",
        stage: "total",
        lastStage,
        status,
        queries,
        durationMs: Math.round((now() - started) * 10) / 10,
      });
    },
  };
}
module.exports = { diagnostics };
