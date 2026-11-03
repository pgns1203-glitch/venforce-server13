// server/services/boot/bootSequencial.js
//
// P0 03/11/2026 — o callback do app.listen disparava ~15 inicializações de
// banco AO MESMO TEMPO (ensure* de schema, auditoria de Squads, cleanups,
// workers): até 15 conexões simultâneas e vários DDL disputando locks
// justamente no instante do deploy, quando a instância antiga ainda está
// drenando. Aqui elas passam a rodar UMA POR VEZ, na ordem dada:
//
//   - cada etapa é independente: erro numa não impede as seguintes (o Portal
//     nunca cai por uma inicialização não crítica — mesmo contrato dos
//     `.catch` de antes);
//   - erro TRANSITÓRIO (banco reiniciando / em recovery, conexão perdida,
//     timeout de aquisição, lock_timeout do DDL) repete a MESMA etapa com
//     backoff antes de seguir — o boot que pega o PostgreSQL voltando de um
//     crash não desiste das schemas em 1 tentativa (antes: o scheduler da
//     Central ficava desligado até o próximo deploy);
//   - `aoConcluir` só roda depois de `executar` dar certo (dependência:
//     scheduler/worker só depois do seu schema) e `aoFalhar` recebe o erro
//     final;
//   - cada etapa loga duração + estado do pool.

const ESPERAS_PADRAO_MS = [1000, 3000, 10000, 30000, 60000, 120000];

// Códigos/mensagens que significam "o banco (ou a conexão) não estava
// disponível agora" — vale tentar de novo depois.
const CODIGOS_TRANSITORIOS = new Set([
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now ("the database system is in recovery mode" / starting up)
  "53300", // too_many_connections
  "55P03", // lock_not_available (lock_timeout do DDL)
  "40P01", // deadlock_detected
  "08000", "08001", "08003", "08004", "08006", // connection_exception
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN",
]);

function ehErroTransitorioDeBanco(err) {
  if (!err) return false;
  if (CODIGOS_TRANSITORIOS.has(err.code)) return true;
  const msg = String(err.message || "");
  return /Connection terminated|timeout exceeded when trying to connect|in recovery mode|the database system is (starting up|shutting down)|Client has encountered a connection error|Connection terminated due to connection timeout/i.test(msg);
}

const dormir = (ms) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  if (typeof t.unref === "function") t.unref();
});

function linhaPool(pool) {
  if (!pool) return "";
  return ` | pool total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`;
}

/**
 * etapas: [{ nome, executar: async () => any, aoConcluir?: (r) => any, aoFalhar?: (err) => any }]
 * Resolve SEMPRE (nunca rejeita) com [{ nome, ok, tentativas, ms, erro? }].
 */
async function executarEtapasDeBoot(etapas, {
  logger = console,
  pool = null,
  esperasMs = ESPERAS_PADRAO_MS,
  sleep = dormir,
  ehTransitorio = ehErroTransitorioDeBanco,
  deveParar = () => false,
} = {}) {
  const resultados = [];
  const inicioBoot = Date.now();
  logger.log?.(`[boot] ${etapas.length} etapas de inicialização em sequência${linhaPool(pool)}`);
  for (const etapa of etapas) {
    if (deveParar()) {
      logger.log?.(`[boot] encerrando: etapas restantes não iniciadas (a partir de ${etapa.nome})`);
      break;
    }
    const t0 = Date.now();
    let tentativas = 0;
    let erroFinal = null;
    let resultado;
    for (;;) {
      tentativas += 1;
      try {
        resultado = await etapa.executar();
        erroFinal = null;
        break;
      } catch (err) {
        erroFinal = err;
        const espera = esperasMs[tentativas - 1];
        if (!ehTransitorio(err) || espera === undefined || deveParar()) break;
        logger.warn?.(
          `[boot] ${etapa.nome}: erro transitório (${err.code || ""} ${String(err.message || err).slice(0, 160)}) — ` +
          `tentativa ${tentativas + 1} em ${espera} ms${linhaPool(pool)}`
        );
        await sleep(espera);
      }
    }
    const ms = Date.now() - t0;
    if (!erroFinal) {
      logger.log?.(`[boot] ${etapa.nome}: ok em ${ms} ms${tentativas > 1 ? ` (${tentativas} tentativas)` : ""}${linhaPool(pool)}`);
      resultados.push({ nome: etapa.nome, ok: true, tentativas, ms });
      if (etapa.aoConcluir) {
        try {
          await etapa.aoConcluir(resultado);
        } catch (err) {
          logger.error?.(`[boot] ${etapa.nome}: erro depois do schema pronto: ${err.message}`);
        }
      }
    } else {
      resultados.push({ nome: etapa.nome, ok: false, tentativas, ms, erro: erroFinal });
      try {
        if (etapa.aoFalhar) await etapa.aoFalhar(erroFinal);
        else logger.error?.(`[boot] ${etapa.nome}: falhou: ${erroFinal.message}`);
      } catch (err) {
        logger.error?.(`[boot] ${etapa.nome}: erro ao reportar falha: ${err.message}`);
      }
    }
  }
  const falhas = resultados.filter((r) => !r.ok).map((r) => r.nome);
  logger.log?.(
    `[boot] inicialização concluída em ${Date.now() - inicioBoot} ms` +
    `${falhas.length ? ` — ${falhas.length} etapa(s) com falha: ${falhas.join(", ")}` : " — todas ok"}${linhaPool(pool)}`
  );
  return resultados;
}

module.exports = { executarEtapasDeBoot, ehErroTransitorioDeBanco, ESPERAS_PADRAO_MS };
