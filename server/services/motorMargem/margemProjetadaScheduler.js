// server/services/motorMargem/margemProjetadaScheduler.js
// Scheduler INTERNO do Web Service para a margem projetada global —
// alternativa ao Render Cron Job (pago), no MESMO espírito de
// centralVendasNoturnoScheduler.js (reaproveitado aqui, não duplicado, para
// o cálculo de horário/timezone). No horário configurado, chama SOMENTE
// margemProjetadaOrquestradorService.executarRodada — a mesma função que o
// orquestrador manual (server/jobs/margemProjetadaOrquestrador.js) já usa.
// Este arquivo não conhece (nem importa) meliSyncService, motorMargemService,
// nenhum repository ou a fórmula de margem: só decide QUANDO chamar o
// orquestrador, com o mesmo controle de concorrência/lock do precedente.
//
// Horário: MARGEM_PROJETADA_SCHEDULER_HOUR / MARGEM_PROJETADA_SCHEDULER_MINUTE
// (padrão 05:30) no fuso America/Sao_Paulo — explícito, nunca o fuso do
// container. Deliberadamente DIFERENTE do horário da Central de Vendas
// (03:00): folga de ~2h30 para o sync noturno da Central terminar antes de
// qualquer eventual rodada da margem projetada tocar os mesmos dados.
//
// Liga só com MARGEM_PROJETADA_SCHEDULER_ENABLED=true EXPLÍCITO (opt-in) —
// mesma razão do precedente: o scheduler viria com QUALQUER boot do
// servidor, inclusive um boot local apontando para produção.
//
// Não roda no boot: deploy/restart só recalcula o próximo horário.
//
// Proteção de rodada (mesmo padrão do precedente):
//   - neste processo: flag `emExecucao` (dois disparos não se sobrepõem);
//   - entre processos/instâncias: pg_try_advisory_lock de SESSÃO numa conexão
//     dedicada. Namespace PRÓPRIO (ver LOCK_NAMESPACE abaixo) — nunca os já
//     usados por mlTokenService (1296845907/1296845908), clienteContaService
//     (1296845909), centralVendasNoturnoScheduler (1296845920) ou
//     squadService (529871001/529871002).

const {
  calcularProximoDisparo,
  formatarNoFuso,
} = require("../centralVendas/centralVendasNoturnoScheduler");
const { TIMEZONE } = require("../centralVendas/centralVendasNoturnoService");

const HORA_PADRAO = 5;
const MINUTO_PADRAO = 30;
// Namespace novo, auditado antes de escolher (ver cabeçalho acima) — nenhum
// dos já em uso no repositório.
const LOCK_NAMESPACE = 1296845930;
const LOCK_CHAVE_RODADA = 1;
// Timer que dispara antes do alvo (relógio ajustado, clamp do Node) é
// reagendado em vez de rodar cedo demais — mesma tolerância do precedente.
const TOLERANCIA_DISPARO_MS = 1000;

const LOG = "[margem-projetada-scheduler]";

function habilitado(env = process.env) {
  return String(env.MARGEM_PROJETADA_SCHEDULER_ENABLED ?? "").trim().toLowerCase() === "true";
}

// Cada campo (hora/minuto) é validado e cai no próprio default
// independentemente do outro — uma env inválida nunca derruba o boot, só
// avisa e usa o padrão daquele campo.
function parseHorario(env = process.env, logger = console) {
  let hora = HORA_PADRAO;
  const brutoHora = env.MARGEM_PROJETADA_SCHEDULER_HOUR;
  if (brutoHora != null && String(brutoHora).trim() !== "") {
    const n = Number(brutoHora);
    if (Number.isInteger(n) && n >= 0 && n <= 23) hora = n;
    else logger.warn(`${LOG} MARGEM_PROJETADA_SCHEDULER_HOUR inválida (${JSON.stringify(String(brutoHora))}) — usando ${HORA_PADRAO}`);
  }
  let minuto = MINUTO_PADRAO;
  const brutoMinuto = env.MARGEM_PROJETADA_SCHEDULER_MINUTE;
  if (brutoMinuto != null && String(brutoMinuto).trim() !== "") {
    const n = Number(brutoMinuto);
    if (Number.isInteger(n) && n >= 0 && n <= 59) minuto = n;
    else logger.warn(`${LOG} MARGEM_PROJETADA_SCHEDULER_MINUTE inválida (${JSON.stringify(String(brutoMinuto))}) — usando ${MINUTO_PADRAO}`);
  }
  return { hora, minuto };
}

// ---------------------------------------------------------------------------
// Lock global da rodada (advisory lock de sessão) — mesmo padrão do
// precedente, parametrizado (o original é fechado sobre suas próprias
// constantes, então não dá para chamar direto com um namespace diferente).
// ---------------------------------------------------------------------------

async function adquirirLockGlobal(pool, namespace = LOCK_NAMESPACE, chave = LOCK_CHAVE_RODADA) {
  const client = await pool.connect();
  let locked = false;
  try {
    const r = await client.query("SELECT pg_try_advisory_lock($1, $2) AS locked", [namespace, chave]);
    locked = r.rows[0]?.locked === true;
  } catch (err) {
    client.release();
    throw err;
  }
  if (!locked) {
    client.release();
    return { adquirido: false };
  }
  return {
    adquirido: true,
    async liberar() {
      let falhou = null;
      try {
        await client.query("SELECT pg_advisory_unlock($1, $2)", [namespace, chave]);
      } catch (err) {
        falhou = err;
      } finally {
        // Se o unlock falhou, a conexão NÃO volta para o pool (ainda seguraria
        // o lock): release(err) a descarta e o Postgres solta o lock.
        client.release(falhou || undefined);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

function mensagemSegura(err) {
  const { sanitizeErrorMessage } = require("../mlTokenService");
  const code = err?.code ? `${err.code} ` : "";
  return code + sanitizeErrorMessage(String(err?.message || err || "erro desconhecido"))
    .replace(/\b(password|secret|authorization)\b\s*[=:]\s*[^\s,;&]+/gi, "$1=[redacted]");
}

function createScheduler(depsOverride = {}) {
  const deps = {
    env: process.env,
    agora: () => Date.now(),
    setTimeoutFn: (fn, ms) => setTimeout(fn, ms),
    clearTimeoutFn: (t) => clearTimeout(t),
    getPool: () => require("../../config/database"),
    // API REAL do orquestrador — mesma função que a CLI manual usa. Sem
    // filtro (clientes: null) = carteira elegível completa; o próprio
    // service decide, via listarContasElegiveis, quem é elegível.
    executarRodada: (opts) => require("./margemProjetadaOrquestradorService").executarRodada(opts),
    adquirirLockGlobal,
    logger: console,
    timeZone: TIMEZONE,
    lockNamespace: LOCK_NAMESPACE,
    lockChave: LOCK_CHAVE_RODADA,
    ...depsOverride,
  };

  const estado = { iniciado: false, parado: false, timer: null, proximoEm: null, emExecucao: false, horario: null };

  function agendar() {
    if (estado.parado) return;
    const agora = deps.agora();
    const alvo = calcularProximoDisparo(agora, estado.horario, deps.timeZone);
    estado.proximoEm = alvo;
    estado.timer = deps.setTimeoutFn(() => aoDisparar(alvo), Math.max(0, alvo - agora));
    // Nunca segura o processo vivo sozinho (encerramento limpo, testes).
    if (estado.timer && typeof estado.timer.unref === "function") estado.timer.unref();
    deps.logger.log(`${LOG} scheduler_next_run: ${formatarNoFuso(alvo, deps.timeZone)} (${new Date(alvo).toISOString()})`);
  }

  function aoDisparar(alvo) {
    estado.timer = null;
    if (estado.parado) return;
    if (deps.agora() < alvo - TOLERANCIA_DISPARO_MS) {
      agendar();
      return;
    }
    // dispararRodada nunca rejeita; o .then garante o próximo agendamento
    // mesmo depois de erro, e o .catch final impede qualquer unhandled
    // rejection no Web Service.
    return dispararRodada()
      .then(() => agendar())
      .catch((err) => deps.logger.error(`${LOG} erro: ${mensagemSegura(err)}`));
  }

  async function dispararRodada() {
    if (estado.emExecucao) {
      deps.logger.warn(`${LOG} rodada já em andamento neste processo — disparo ignorado`);
      return { executada: false, motivo: "EM_ANDAMENTO_NESTE_PROCESSO" };
    }
    estado.emExecucao = true;
    const inicio = deps.agora();
    try {
      let lock;
      try {
        lock = await deps.adquirirLockGlobal(deps.getPool(), deps.lockNamespace, deps.lockChave);
      } catch (err) {
        deps.logger.error(`${LOG} erro ao obter lock da rodada: ${mensagemSegura(err)}`);
        return { executada: false, motivo: "ERRO_LOCK" };
      }
      if (!lock.adquirido) {
        deps.logger.warn(`${LOG} scheduler_lock_not_acquired — outra instância já está executando a rodada`);
        return { executada: false, motivo: "RODADA_EM_OUTRA_INSTANCIA" };
      }
      try {
        deps.logger.log(`${LOG} scheduler_run_started`);
        const resumo = await deps.executarRodada({ clientes: null, plano: false });
        deps.logger.log(
          `${LOG} scheduler_run_completed: elegíveis=${resumo?.elegiveis ?? "?"} sucessos=${resumo?.sucessos ?? "?"}`
            + ` parciais=${resumo?.parciais ?? "?"} falhas=${resumo?.falhas ?? "?"} ignoradas=${resumo?.ignoradas ?? "?"}`
            + ` duracaoMs=${deps.agora() - inicio}`
        );
        return { executada: true, resumo };
      } catch (err) {
        deps.logger.error(`${LOG} scheduler_run_failed: ${mensagemSegura(err)}`);
        return { executada: false, motivo: "ERRO_RODADA" };
      } finally {
        await lock.liberar().catch(() => {});
        deps.logger.log(`${LOG} scheduler_lock_released`);
      }
    } catch (err) {
      // Rede de segurança: nada daqui pode virar unhandled rejection no Web Service.
      deps.logger.error(`${LOG} erro: ${mensagemSegura(err)}`);
      return { executada: false, motivo: "ERRO" };
    } finally {
      estado.emExecucao = false;
    }
  }

  function iniciar() {
    if (estado.iniciado && !estado.parado) return true;
    if (!habilitado(deps.env)) {
      deps.logger.log(`${LOG} scheduler_disabled (MARGEM_PROJETADA_SCHEDULER_ENABLED != true)`);
      return false;
    }
    estado.horario = parseHorario(deps.env, deps.logger);
    estado.iniciado = true;
    estado.parado = false;
    try {
      deps.logger.log(`${LOG} scheduler_started`);
      agendar();
    } catch (err) {
      estado.iniciado = false;
      deps.logger.error(`${LOG} erro ao agendar: ${mensagemSegura(err)}`);
      return false;
    }
    return true;
  }

  function parar() {
    const tinhaTimer = !!estado.timer;
    estado.parado = true;
    if (estado.timer) deps.clearTimeoutFn(estado.timer);
    estado.timer = null;
    estado.proximoEm = null;
    if (estado.iniciado) deps.logger.log(`${LOG} parado${tinhaTimer ? " (timer limpo)" : ""}`);
    estado.iniciado = false;
  }

  return {
    iniciar,
    parar,
    dispararRodada,
    estado: () => ({
      iniciado: estado.iniciado,
      emExecucao: estado.emExecucao,
      proximoEm: estado.proximoEm,
      temTimer: !!estado.timer,
    }),
  };
}

// Instância do processo (usada pelo index.js).
let padrao = null;
function instancia() {
  if (!padrao) padrao = createScheduler();
  return padrao;
}

module.exports = {
  iniciar: () => instancia().iniciar(),
  parar: () => { if (padrao) padrao.parar(); },
  createScheduler,
  calcularProximoDisparo,
  formatarNoFuso,
  parseHorario,
  habilitado,
  adquirirLockGlobal,
  HORA_PADRAO,
  MINUTO_PADRAO,
  LOCK_NAMESPACE,
  LOCK_CHAVE_RODADA,
};
