// server/services/centralVendas/centralVendasNoturnoScheduler.js
// Scheduler INTERNO do Web Service para a sincronização noturna da Central de
// Vendas — alternativa ao Render Cron Job (pago). Não é um motor novo: no
// horário, chama centralVendasNoturnoService.executarRodadaNoturna, a MESMA
// função do job CLI (npm run sync:central-vendas:noturno), que continua
// existindo para execução manual ou um futuro Render Cron.
//
// Horário: CENTRAL_VENDAS_NOTURNO_HORA (padrão "03:00") no fuso
// America/Sao_Paulo — explícito, nunca o fuso do container (Render é UTC). O
// próximo disparo é calculado como um INSTANTE absoluto a partir da hora de
// parede no fuso (não um setInterval de 24h, que deriva e ignora mudança de
// offset), e recalculado depois de cada rodada.
//
// Liga só com CENTRAL_VENDAS_NOTURNO_ENABLED=true EXPLÍCITO (opt-in). O job
// CLI trata ausência como ligado porque rodá-lo já é um ato explícito; aqui o
// scheduler viria junto com QUALQUER boot do servidor — inclusive um boot
// local cujo server/.env aponta para o banco de produção.
//
// No boot não cria uma rodada nova, mas retoma períodos que tenham runs
// noturnos queued/running persistidos por um processo anterior.
//
// Proteção de rodada (além do sync_run, que já protege cada conta/período):
//   - neste processo: flag `emExecucao` (dois disparos não se sobrepõem);
//   - entre processos/instâncias: pg_try_advisory_lock de SESSÃO numa conexão
//     dedicada (mesmo padrão de mlTokenService.refreshMlGrant). Se o processo
//     morrer, o Postgres libera o lock junto com a conexão — sem migration,
//     sem tabela de lock, sem lock preso.

const { TIMEZONE } = require("./centralVendasNoturnoService");
const { lerMsPositivo } = require("../../config/databaseConexao");

const HORA_PADRAO = "03:00";
// Namespace próprio (mlTokenService usa 1296845907/1296845908; squadService
// usa 529871001/529871002).
const LOCK_NAMESPACE = 1296845920;
const LOCK_CHAVE_RODADA = 1;
// Timer que dispara antes do alvo (relógio ajustado, clamp do Node) é
// reagendado em vez de rodar cedo demais.
const TOLERANCIA_DISPARO_MS = 1000;
const RECUPERACAO_RETRY_MS = 30000;
// Teto de UMA rodada/recuperação neste processo. Cada unidade já tem prazo
// (centralVendasPrazos), mas uma espera fora delas (preparação, listagem,
// snapshot) deixava `emExecucao` true para sempre: todo disparo seguinte era
// "já em andamento" até um restart. Estourado o teto, o scheduler volta a
// agendar; a rodada antiga continua segurando o advisory lock até terminar,
// então nada roda em paralelo com ela (o próximo disparo vê
// RODADA_EM_OUTRA_INSTANCIA). CENTRAL_VENDAS_NOTURNO_RODADA_TIMEOUT_MS ajusta.
const RODADA_TIMEOUT_PADRAO_MS = 6 * 60 * 60 * 1000;

const LOG = "[sync-scheduler]";

function habilitado(env = process.env) {
  return String(env.CENTRAL_VENDAS_NOTURNO_ENABLED ?? "").trim().toLowerCase() === "true";
}

function parseHora(valor) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(valor ?? "").trim());
  if (!m) return null;
  const hora = Number(m[1]);
  const minuto = Number(m[2]);
  if (hora > 23 || minuto > 59) return null;
  return { hora, minuto };
}

// ---------------------------------------------------------------------------
// Hora de parede no fuso → instante UTC (Intl nativo, sem dependência)
// ---------------------------------------------------------------------------

const formatadores = new Map();
function formatadorDoFuso(timeZone) {
  if (!formatadores.has(timeZone)) {
    formatadores.set(timeZone, new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }));
  }
  return formatadores.get(timeZone);
}

function partesNoFuso(instanteMs, timeZone) {
  const p = {};
  for (const { type, value } of formatadorDoFuso(timeZone).formatToParts(new Date(instanteMs))) {
    if (type !== "literal") p[type] = Number(value);
  }
  return { ano: p.year, mes: p.month, dia: p.day, hora: p.hour, minuto: p.minute, segundo: p.second };
}

// Offset do fuso (ms) naquele instante: parede-no-fuso lida como UTC − instante.
function offsetDoFuso(instanteMs, timeZone) {
  const p = partesNoFuso(instanteMs, timeZone);
  const paredeComoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return paredeComoUtc - Math.floor(instanteMs / 1000) * 1000;
}

// Instante em que o relógio de parede do fuso marca ano-mes-dia hora:minuto.
// Duas passadas: a segunda corrige quando o offset muda entre o palpite e o
// resultado (dia de horário de verão — Brasil não tem desde 2019, mas a conta
// não depende disso).
function instanteDaHoraLocal({ ano, mes, dia, hora, minuto }, timeZone) {
  const palpite = Date.UTC(ano, mes - 1, dia, hora, minuto, 0);
  const primeiro = palpite - offsetDoFuso(palpite, timeZone);
  const segundoOffset = offsetDoFuso(primeiro, timeZone);
  return palpite - segundoOffset;
}

// Próximo instante ESTRITAMENTE posterior a `agoraMs` em que o fuso marca
// hora:minuto. Boot exatamente às 03:00 (ou depois) → amanhã: nunca dispara
// imediatamente.
function calcularProximoDisparo(agoraMs, { hora, minuto }, timeZone = TIMEZONE) {
  const hoje = partesNoFuso(agoraMs, timeZone);
  for (let adiante = 0; adiante <= 2; adiante++) {
    const d = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia + adiante));
    const alvo = instanteDaHoraLocal(
      { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(), hora, minuto },
      timeZone
    );
    if (alvo > agoraMs) return alvo;
  }
  throw new Error("Nao foi possivel calcular o proximo disparo.");
}

function formatarNoFuso(instanteMs, timeZone = TIMEZONE) {
  const p = partesNoFuso(instanteMs, timeZone);
  const pad = (n) => String(n).padStart(2, "0");
  return `${p.ano}-${pad(p.mes)}-${pad(p.dia)} ${pad(p.hora)}:${pad(p.minuto)} ${timeZone}`;
}

// ---------------------------------------------------------------------------
// Lock global da rodada (advisory lock de sessão)
// ---------------------------------------------------------------------------

async function adquirirLockGlobal(pool, { logger = console } = {}) {
  const client = await pool.connect();
  // A conexão do lock fica OCIOSA a rodada inteira (horas). Se ela cair
  // (crash/restart do PostgreSQL, rede), o `pg` emite 'error' neste client —
  // sem listener isso derrubava o processo (incidente 2026-10-09). E o lock
  // de sessão morre junto com a conexão: a partir daí a rodada em curso segue
  // SEM exclusividade entre instâncias. Fica registrado (perdido()) e o
  // release descarta a conexão sem tentar o unlock numa sessão que não existe.
  // O listener entra ANTES da query do lock (cobre a queda durante ela) e sai
  // em todo caminho de release.
  let perdido = null;
  let adquirido = false;
  const aoPerderConexao = (err) => {
    if (perdido) return;
    perdido = err || new Error("conexão do lock encerrada");
    if (!adquirido) return; // a query do lock rejeita com o mesmo erro e quem chamou registra
    logger.error(
      `${LOG} conexão do lock da rodada caiu (${mensagemSegura(perdido)}) — lock global perdido;`
        + " a rodada em curso termina sem exclusividade entre instâncias"
    );
  };
  const escuta = typeof client.on === "function";
  if (escuta) client.on("error", aoPerderConexao);
  const devolver = (err) => {
    if (escuta) client.removeListener("error", aoPerderConexao);
    client.release(err || undefined);
  };
  try {
    const r = await client.query("SELECT pg_try_advisory_lock($1, $2) AS locked", [LOCK_NAMESPACE, LOCK_CHAVE_RODADA]);
    adquirido = r.rows[0]?.locked === true;
  } catch (err) {
    devolver(err);
    throw err;
  }
  if (!adquirido) {
    devolver(perdido);
    return { adquirido: false };
  }
  return {
    adquirido: true,
    perdido: () => perdido !== null,
    async liberar() {
      let falhou = perdido;
      try {
        if (!falhou) await client.query("SELECT pg_advisory_unlock($1, $2)", [LOCK_NAMESPACE, LOCK_CHAVE_RODADA]);
      } catch (err) {
        falhou = err;
      } finally {
        // Conexão perdida ou unlock que falhou: a conexão NÃO volta para o
        // pool (ainda seguraria o lock, ou está morta): release(err) a
        // descarta e o Postgres solta o lock junto com a sessão.
        devolver(falhou);
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
    executarRodadaNoturna: (opts) => require("./centralVendasNoturnoService").executarRodadaNoturna(opts),
    recuperarRodadasPendentes: (opts) => require("./centralVendasNoturnoService").recuperarRodadasPendentes(opts),
    adquirirLockGlobal,
    esperar: (ms) => {
      let timer;
      const promise = new Promise((resolve) => { timer = setTimeout(resolve, ms); });
      if (timer && typeof timer.unref === "function") timer.unref();
      return { promise, cancelar: () => clearTimeout(timer) };
    },
    logger: console,
    timeZone: TIMEZONE,
    ...depsOverride,
  };

  const estado = {
    iniciado: false, parado: false, timer: null, timerRecuperacao: null, proximoEm: null,
    emExecucao: false, horario: null, promessaAtiva: null,
    progresso: null, iniciadoEm: new Date(deps.agora()),
  };

  function agendar() {
    if (estado.parado) return;
    const agora = deps.agora();
    const alvo = calcularProximoDisparo(agora, estado.horario, deps.timeZone);
    estado.proximoEm = alvo;
    estado.timer = deps.setTimeoutFn(() => aoDisparar(alvo), Math.max(0, alvo - agora));
    // Nunca segura o processo vivo sozinho (encerramento limpo, testes).
    if (estado.timer && typeof estado.timer.unref === "function") estado.timer.unref();
    deps.logger.log(`${LOG} próximo sync: ${formatarNoFuso(alvo, deps.timeZone)} (${new Date(alvo).toISOString()})`);
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

  async function executarProtegido(tipo) {
    if (estado.emExecucao) {
      deps.logger.warn(`${LOG} rodada já em andamento neste processo — disparo ignorado`);
      return { executada: false, motivo: "EM_ANDAMENTO_NESTE_PROCESSO" };
    }
    estado.emExecucao = true;
    estado.progresso = null;
    const inicio = deps.agora();
    const execucao = (async () => {
      let lock;
      try {
        lock = await deps.adquirirLockGlobal(deps.getPool(), { logger: deps.logger });
      } catch (err) {
        deps.logger.error(`${LOG} erro ao obter lock da rodada: ${mensagemSegura(err)}`);
        return { executada: false, motivo: "ERRO_LOCK" };
      }
      if (!lock.adquirido) {
        deps.logger.warn(`${LOG} outra instância já está executando a rodada — disparo ignorado`);
        return { executada: false, motivo: "RODADA_EM_OUTRA_INSTANCIA" };
      }
      try {
        const recuperacao = tipo === "recuperacao";
        deps.logger.log(`${LOG} ${recuperacao ? "recuperação" : "rodada"} iniciada`);
        const onProgresso = (p) => { estado.progresso = p; };
        const resultado = recuperacao
          ? await deps.recuperarRodadasPendentes({ env: deps.env, iniciadoEm: estado.iniciadoEm, onProgresso })
          : await deps.executarRodadaNoturna({ env: deps.env, origem: "scheduler-central", onProgresso });
        if (recuperacao && !resultado?.recuperada) {
          deps.logger.log(`${LOG} recuperação concluída: sem pendências`);
          return { executada: true, recuperacao: true, resumo: null };
        }
        const resumo = recuperacao ? resultado?.resumo : resultado;
        deps.logger.log(
          `${LOG} ${recuperacao ? "recuperação" : "rodada"} concluída: avaliadas=${resumo?.total ?? "?"}`
            + ` elegíveis=${resumo?.elegiveis ?? "?"} tentadas=${resumo?.execucoes ?? "?"}`
            + ` completed=${resumo?.completed ?? resumo?.sucesso ?? "?"}`
            + ` partial=${resumo?.partial ?? resumo?.parcial ?? "?"}`
            + ` failed=${resumo?.failed ?? resumo?.falha ?? "?"} ignoradas=${resumo?.ignorados ?? "?"}`
            + ` snapshots=${resumo?.snapshots?.atualizados ?? "?"}`
            + ` duracaoMs=${deps.agora() - inicio}`
        );
        return { executada: true, recuperacao, resumo };
      } catch (err) {
        deps.logger.error(`${LOG} erro na ${tipo === "recuperacao" ? "recuperação" : "rodada"}: ${mensagemSegura(err)}`);
        return { executada: false, motivo: "ERRO_RODADA" };
      } finally {
        if (typeof lock.perdido === "function" && lock.perdido()) {
          deps.logger.warn(`${LOG} ${tipo === "recuperacao" ? "recuperação" : "rodada"} encerrada depois de perder o lock global (conexão caiu)`);
        }
        await lock.liberar().catch(() => {});
      }
    })().catch((err) => {
      // Rede de segurança: nada daqui pode virar unhandled rejection no Web Service.
      deps.logger.error(`${LOG} erro: ${mensagemSegura(err)}`);
      return { executada: false, motivo: "ERRO" };
    });

    const tetoMs = lerMsPositivo(deps.env.CENTRAL_VENDAS_NOTURNO_RODADA_TIMEOUT_MS, RODADA_TIMEOUT_PADRAO_MS);
    let timerTeto = null;
    const teto = new Promise((resolve) => {
      timerTeto = deps.setTimeoutFn(() => {
        const p = estado.progresso || {};
        deps.logger.error(
          `${LOG} ${tipo === "recuperacao" ? "recuperação" : "rodada"} excedeu ${Math.round(tetoMs / 60000)} min`
            + ` (${p.concluidas ?? 0}/${p.total ?? "?"}${p.unidade ? ` últimaUnidade=${p.unidade}` : ""})`
            + " — scheduler liberado; a rodada antiga segue com o lock até terminar"
        );
        resolve({ executada: false, motivo: "RODADA_TIMEOUT" });
      }, tetoMs);
      if (timerTeto && typeof timerTeto.unref === "function") timerTeto.unref();
    });

    // O finally roda UMA vez, quando a corrida termina (rodada ou teto) — a
    // rodada abandonada que termina depois não toca mais o estado.
    const promessa = Promise.race([execucao, teto]).finally(() => {
      if (timerTeto) deps.clearTimeoutFn(timerTeto);
      estado.emExecucao = false;
      estado.promessaAtiva = null;
    });
    estado.promessaAtiva = promessa;
    return promessa;
  }

  function dispararRodada() {
    return executarProtegido("rodada");
  }

  function recuperarPendencias() {
    return executarProtegido("recuperacao").then((resultado) => {
      if (!estado.parado && resultado?.motivo === "RODADA_EM_OUTRA_INSTANCIA" && !estado.timerRecuperacao) {
        deps.logger.log(`${LOG} recuperação aguardará ${RECUPERACAO_RETRY_MS}ms pelo lock da instância anterior`);
        estado.timerRecuperacao = deps.setTimeoutFn(() => {
          estado.timerRecuperacao = null;
          recuperarPendencias().catch((err) => deps.logger.error(`${LOG} erro: ${mensagemSegura(err)}`));
        }, RECUPERACAO_RETRY_MS);
        if (estado.timerRecuperacao && typeof estado.timerRecuperacao.unref === "function") estado.timerRecuperacao.unref();
      }
      return resultado;
    });
  }

  function iniciar() {
    if (estado.iniciado && !estado.parado) return true;
    if (!habilitado(deps.env)) {
      deps.logger.log(`${LOG} desabilitado (CENTRAL_VENDAS_NOTURNO_ENABLED != true)`);
      return false;
    }
    const bruto = deps.env.CENTRAL_VENDAS_NOTURNO_HORA;
    let horario = parseHora(bruto ?? HORA_PADRAO);
    if (!horario) {
      deps.logger.warn(`${LOG} CENTRAL_VENDAS_NOTURNO_HORA inválida (${JSON.stringify(String(bruto))}) — usando ${HORA_PADRAO}`);
      horario = parseHora(HORA_PADRAO);
    }
    estado.horario = horario;
    estado.iniciado = true;
    estado.parado = false;
    try {
      agendar();
    } catch (err) {
      estado.iniciado = false;
      deps.logger.error(`${LOG} erro ao agendar: ${mensagemSegura(err)}`);
      return false;
    }
    return true;
  }

  async function parar({ aguardarMs = 0 } = {}) {
    const tinhaTimer = !!estado.timer;
    estado.parado = true;
    if (estado.timer) deps.clearTimeoutFn(estado.timer);
    if (estado.timerRecuperacao) deps.clearTimeoutFn(estado.timerRecuperacao);
    estado.timer = null;
    estado.timerRecuperacao = null;
    estado.proximoEm = null;
    if (estado.iniciado) deps.logger.log(`${LOG} parado${tinhaTimer ? " (timer limpo)" : ""}`);
    estado.iniciado = false;
    const ativa = estado.promessaAtiva;
    if (!ativa) return { drenada: true, progresso: estado.progresso };
    if (!(aguardarMs > 0)) return { drenada: false, progresso: estado.progresso };
    const espera = deps.esperar(aguardarMs);
    const prazoPromise = espera?.promise || espera;
    const terminou = await Promise.race([
      ativa.then(() => true, () => true),
      Promise.resolve(prazoPromise).then(() => false),
    ]);
    if (terminou && typeof espera?.cancelar === "function") espera.cancelar();
    if (!terminou) {
      const p = estado.progresso || {};
      deps.logger.warn(
        `${LOG} shutdown interrompeu rodada após ${p.concluidas ?? 0}/${p.total ?? "?"}`
          + `${p.unidade ? ` últimaUnidade=${p.unidade}` : ""}; runs queued/running serão recuperados no próximo boot`
      );
    }
    return { drenada: terminou, progresso: estado.progresso };
  }

  return {
    iniciar,
    parar,
    dispararRodada,
    recuperarPendencias,
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
  parar: (opts) => (padrao ? padrao.parar(opts) : Promise.resolve({ drenada: true, progresso: null })),
  recuperarPendencias: () => instancia().recuperarPendencias(),
  createScheduler,
  calcularProximoDisparo,
  instanteDaHoraLocal,
  formatarNoFuso,
  parseHora,
  habilitado,
  adquirirLockGlobal,
  HORA_PADRAO,
  RODADA_TIMEOUT_PADRAO_MS,
  LOCK_NAMESPACE,
  LOCK_CHAVE_RODADA,
};
