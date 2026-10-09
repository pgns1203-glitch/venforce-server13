// server/tests/helpers/pgConexaoPerdidaCenario.js
// Roda UM cenário de "conexão com o PostgreSQL caiu" num processo próprio —
// é a única forma honesta de provar que o processo NÃO cai: um 'error' sem
// listener mata o processo inteiro (exit != 0 + "Unhandled 'error' event" no
// stderr), exatamente como no Web Service em 2026-10-09.
//
// Uso: node pgConexaoPerdidaCenario.js <cenario> <protegido|cru>
//   protegido = Pool com protegerConexoesDoPool (o que config/database.js faz)
//   cru       = Pool sem proteção (o estado de produção antes da correção)
// Termina com exit 0 e UMA linha JSON no stdout com o que foi observado.

const { Pool } = require("pg");
const { protegerConexoesDoPool } = require("../../config/databaseConexao");
const { iniciarFakePg } = require("./fakePgServer");

const [, , cenario, modo] = process.argv;
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function capturarLogger() {
  const linhas = [];
  const push = (...args) => linhas.push(args.join(" "));
  return { linhas, logger: { log: push, warn: push, error: push } };
}

function erroDeConexaoMorta() {
  return new Error("Connection terminated unexpectedly");
}

async function main() {
  const fake = await iniciarFakePg();
  const { linhas, logger } = capturarLogger();
  const pool = new Pool({ connectionString: fake.connectionString, ssl: false });
  if (modo === "protegido") protegerConexoesDoPool(pool, { logger });
  const saida = { cenario, modo };

  if (cenario === "transacao") {
    // Gravação do import: transação num client checado do pool, query em voo
    // quando o PostgreSQL derruba a sessão.
    const { withTransaction } = require("../../services/centralVendas/centralVendasRepository");
    try {
      await withTransaction(async (db) => {
        await db.query("INSERT INTO central_vendas_imports DEFAULT VALUES");
        const emVoo = db.query("SELECT pg_sleep(60)");
        setTimeout(() => fake.derrubarTodas(), 30);
        await emVoo;
      }, { pool });
      saida.resultado = "resolveu";
    } catch (err) {
      saida.resultado = "rejeitou";
      saida.erro = err.message;
    }
    await esperar(50);
    saida.poolTotal = pool.totalCount;
  } else if (cenario === "ocioso") {
    await pool.query("SELECT 1");
    saida.ociosasAntes = pool.idleCount;
    fake.derrubarTodas();
    await esperar(100);
    saida.poolTotal = pool.totalCount;
  } else if (cenario === "lock") {
    const { adquirirLockGlobal } = require("../../services/centralVendas/centralVendasNoturnoScheduler");
    const lock = await adquirirLockGlobal(pool, { logger });
    saida.adquirido = lock.adquirido;
    fake.derrubarTodas();
    await esperar(100);
    saida.perdido = lock.perdido();
    await lock.liberar();
    saida.unlockEnviado = fake.queries.some((q) => /pg_advisory_unlock/.test(q));
    await esperar(50);
    saida.poolTotal = pool.totalCount;
  } else if (cenario === "recuperacao") {
    // Recuperação de boot do scheduler com o lock REAL: a conexão cai durante
    // a recuperação (o trabalho em curso falha com erro de conexão). Depois,
    // uma nova tentativa (próximo boot / próximo disparo) obtém o lock de novo.
    const { createScheduler } = require("../../services/centralVendas/centralVendasNoturnoScheduler");
    let tentativa = 0;
    const scheduler = createScheduler({
      env: { CENTRAL_VENDAS_NOTURNO_ENABLED: "true" },
      getPool: () => pool,
      logger,
      setTimeoutFn: (fn, ms) => setTimeout(fn, ms),
      async recuperarRodadasPendentes() {
        tentativa += 1;
        if (tentativa === 1) {
          fake.derrubarTodas();
          await esperar(50);
          throw erroDeConexaoMorta();
        }
        return { recuperada: true, resumo: { total: 1, elegiveis: 1, execucoes: 1, completed: 1, partial: 0, failed: 0, ignorados: 0 } };
      },
    });
    const primeira = await scheduler.recuperarPendencias();
    saida.primeira = primeira;
    saida.emExecucaoDepois = scheduler.estado().emExecucao;
    const segunda = await scheduler.recuperarPendencias();
    saida.segunda = { executada: segunda.executada, recuperacao: segunda.recuperacao };
    saida.locksPedidos = fake.queries.filter((q) => /pg_try_advisory_lock/.test(q)).length;
    await scheduler.parar();
  } else {
    throw new Error(`cenário desconhecido: ${cenario}`);
  }

  saida.logs = linhas;
  await pool.end().catch(() => {});
  await fake.fechar();
  process.stdout.write(`${JSON.stringify(saida)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(3);
});
