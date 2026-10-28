#!/usr/bin/env node
// server/scripts/sentinel-run-once.js
// Um ciclo do Sentinel para UMA conta, com resumo por estado.
//
//   DATABASE_URL=... node server/scripts/sentinel-run-once.js --conta=<cliente_conta_id> [--since=ISO] [--confirm-host=<host>]
//
// NÃO carrega server/.env: o banco é só o DATABASE_URL do shell. O host é
// impresso antes de qualquer query; fora de localhost, exige --confirm-host
// com o MESMO host (proteção contra rodar em produção por engano).
// --since sobrescreve o checkpoint da conta DENTRO do ciclo (sob o lock, pela conexão
// detentora; ciclo pulado por lock ocupado não grava nada) antes do ciclo (o ciclo ainda relê
// SENTINEL_OVERLAP_MS antes dele). Token ML: noRefresh — expirado ⇒ erro
// SENTINEL_TOKEN_INDISPONIVEL, nunca renova.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function lerArgs(argv) {
  const args = {};
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  }
  return args;
}

async function main() {
  const args = lerArgs(process.argv.slice(2));
  const contaId = Number(args.conta);
  if (!Number.isInteger(contaId)) {
    console.error("uso: node server/scripts/sentinel-run-once.js --conta=<cliente_conta_id> [--since=ISO] [--confirm-host=<host>] [--aplicar-schema]");
    process.exit(2);
  }
  if (args.since && !Number.isFinite(Date.parse(args.since))) {
    console.error(`--since inválido: ${args.since}`);
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL não definido no shell (o .env NÃO é lido por este script).");
    process.exit(2);
  }
  const host = new URL(process.env.DATABASE_URL).hostname;
  console.log(`[sentinel-run-once] banco: host=${host}`);
  if (!LOCAL_HOSTS.has(host) && args["confirm-host"] !== host) {
    console.error(`[sentinel-run-once] host não-local. Para confirmar, repita com --confirm-host=${host}`);
    process.exit(3);
  }

  // Mesmo caminho do worker: pool PRÓPRIO (SENTINEL_DB_POOL_MAX, statement_timeout),
  // ML sempre com noRefresh, lock + checkpoint + exceções idênticos. Só --conta.
  const { criarPoolSentinel } = require("../workers/sentinelWorker");
  const pool = criarPoolSentinel();
  const { ensureSentinelSchema, verificarSentinelSchema } = require("../services/sentinel/sentinelSchema");
  const { executarCiclo } = require("../services/sentinel/sentinelPollingWorker");

  try {
    // Padrão: só VERIFICA o schema (zero DDL). Aplicar a migration é a etapa
    // "migration", com aprovação separada: --aplicar-schema.
    if (args["aplicar-schema"] === true) await ensureSentinelSchema(pool);
    else await verificarSentinelSchema(pool);
    const { pulado, contas } = await executarCiclo({ contaIds: [contaId], db: pool, redefinirCheckpoint: args.since ? new Date(args.since).toISOString() : null });
    if (pulado) {
      console.log("[sentinel-run-once] ciclo pulado: outro ciclo detém o lock.");
      process.exitCode = 4;
      return;
    }
    if (!contas.length) {
      console.log("[sentinel-run-once] ciclo abortado (lock perdido) ou sem conta processada.");
      process.exitCode = 4;
      return;
    }
    const c = contas[0];
    console.log(JSON.stringify({
      conta: c.contaId,
      processados: c.processados,
      quarentena: c.quarentena,
      retentando: c.retentando,
      atrasoSegundos: c.atrasoSegundos,
      atrasoInicialSegundos: c.atrasoInicialSegundos,
      chamadasMl: c.chamadasMl,
      porResultado: c.porResultado,
      porEstado: c.porEstado,
      checkpoint: c.checkpoint,
      erro: c.erro,
    }, null, 2));
    const totais = await pool.query(
      `SELECT estado_margem, COUNT(*)::int AS pedidos
         FROM sentinel_pedidos WHERE cliente_conta_id = $1
        GROUP BY estado_margem ORDER BY estado_margem`,
      [contaId]
    );
    console.log("[sentinel-run-once] sentinel_pedidos da conta por estado:");
    console.table(totais.rows);
    if (c.erro) process.exitCode = 1;
  } catch (err) {
    if (err && err.code === "SENTINEL_SCHEMA_AUSENTE") {
      console.error(`[sentinel-run-once] ${err.message}\n  Aplique as migrations (etapa separada, com aprovação) ou rode com --aplicar-schema.`);
      process.exitCode = 5;
      return;
    }
    throw err;
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`[sentinel-run-once] falhou: ${err.message}`);
  process.exit(1);
});
