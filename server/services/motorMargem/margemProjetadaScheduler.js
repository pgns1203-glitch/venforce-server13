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
// ENABLED=true sozinho NÃO autoriza processar nenhuma conta — só diz "o
// scheduler pode funcionar". Escopo é um opt-in SEPARADO e OBRIGATÓRIO:
//   - MARGEM_PROJETADA_SCHEDULER_CLIENTES=slug1,slug2  → só esses clientes;
//   - MARGEM_PROJETADA_SCHEDULER_ALL=true              → carteira elegível
//     inteira (mesmo "--all" da CLI manual, nunca implícito).
// Os dois juntos são configuração AMBÍGUA (nenhum é escolhido em silêncio);
// nenhum dos dois é configuração AUSENTE — em ambos os casos o scheduler não
// agenda execução operacional (ver resolverEscopoScheduler).
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
// Escopo: quais contas o scheduler pode processar quando disparar
// ---------------------------------------------------------------------------
//
// MARGEM_PROJETADA_SCHEDULER_CLIENTES: mesmo formato de --clientes na CLI
// manual (comma-separated slugs), mas com parsing mais estrito aqui —
// trim + remove vazios + DEDUPLICA (a CLI não deduplica; não precisa, o
// orquestrador não se importa com duplicata na lista de filtro, mas a
// dedup deixa o log/relatório do scheduler mais legível). NÃO faz
// lowercase: quem compara case-insensitive é
// margemProjetadaOrquestradorService.classificarContas, não o chamador —
// não duplicamos essa regra aqui.
function parseClientesEnv(bruto) {
  if (bruto == null) return null; // env ausente — distinto de "presente e vazio"
  const lista = String(bruto).split(",").map((s) => s.trim()).filter(Boolean);
  return [...new Set(lista)];
}

// Mesma semântica de `habilitado`: só "true" (trim + case-insensitive)
// autoriza. "1"/"yes"/"on" NÃO contam — precisa ser o valor exato usado no
// resto do repositório para opt-in booleano.
function todaCarteiraAtivada(env = process.env) {
  return String(env.MARGEM_PROJETADA_SCHEDULER_ALL ?? "").trim().toLowerCase() === "true";
}

// Única fonte de verdade sobre QUAIS contas o scheduler pode tocar. Nunca
// escolhe um lado em silêncio: ausência de escopo e ambiguidade de escopo
// são os DOIS jeitos de "não processar nada", com motivo distinto para log.
// Mesmos códigos de motivo da barreira da CLI manual
// (margemProjetadaOrquestrador.js:validarEscopo) — convergência de
// vocabulário, não coincidência.
function resolverEscopoScheduler(env = process.env) {
  const clientes = parseClientesEnv(env.MARGEM_PROJETADA_SCHEDULER_CLIENTES);
  const temClientes = Array.isArray(clientes) && clientes.length > 0;
  const all = todaCarteiraAtivada(env);

  if (temClientes && all) {
    return { valido: false, motivo: "ESCOPO_AMBIGUO" };
  }
  if (temClientes) {
    return { valido: true, tipo: "clientes", clientes };
  }
  if (all) {
    return { valido: true, tipo: "all", clientes: null };
  }
  return { valido: false, motivo: "ESCOPO_OBRIGATORIO" };
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
    // API REAL do orquestrador — mesma função que a CLI manual usa. O opts
    // passado em cada disparo vem de resolverEscopoScheduler (clientes: [...]
    // para subset, clientes: null só quando ALL=true foi ligado explicitamente).
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
    // Resolvido de novo aqui (não só em iniciar()) para o disparo continuar
    // seguro mesmo chamado direto (testes de concorrência) e como defesa
    // extra caso o processo tivesse, por algum motivo, um escopo desatualizado
    // guardado. Escopo inválido é tratado IGUAL a emExecucao: recusa ANTES de
    // tocar lock/pool/orquestrador.
    const escopo = resolverEscopoScheduler(deps.env);
    if (!escopo.valido) {
      if (escopo.motivo === "ESCOPO_AMBIGUO") {
        deps.logger.error(`${LOG} scheduler_scope_ambiguous — disparo ignorado`);
      } else {
        deps.logger.warn(`${LOG} scheduler_scope_missing — disparo ignorado`);
      }
      return { executada: false, motivo: escopo.motivo };
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
        // Shape IDÊNTICO ao que a CLI manual já valida e usa — nenhuma
        // segunda representação de filtro é inventada aqui.
        const resumo = await deps.executarRodada({ clientes: escopo.clientes, plano: false });
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
    // ENABLED=true sozinho não basta: sem escopo válido, o scheduler fica
    // inerte — nenhum timer operacional, nenhum lock, nenhuma chamada ao
    // orquestrador. Resolvido aqui (não a cada disparo) pelo mesmo motivo do
    // horário: reinício de processo é o único jeito de mudar a configuração.
    const escopo = resolverEscopoScheduler(deps.env);
    if (!escopo.valido) {
      if (escopo.motivo === "ESCOPO_AMBIGUO") {
        deps.logger.error(`${LOG} scheduler_scope_ambiguous — MARGEM_PROJETADA_SCHEDULER_CLIENTES e MARGEM_PROJETADA_SCHEDULER_ALL=true não podem estar definidos ao mesmo tempo`);
      } else {
        deps.logger.warn(`${LOG} scheduler_scope_missing — defina MARGEM_PROJETADA_SCHEDULER_CLIENTES=slug1,slug2 ou MARGEM_PROJETADA_SCHEDULER_ALL=true`);
      }
      return false;
    }
    estado.horario = parseHorario(deps.env, deps.logger);
    estado.iniciado = true;
    estado.parado = false;
    try {
      deps.logger.log(`${LOG} scheduler_started`);
      if (escopo.tipo === "clientes") {
        deps.logger.log(`${LOG} scheduler_scope_clients: ${escopo.clientes.length} cliente(s) — ${escopo.clientes.join(",")}`);
      } else {
        deps.logger.log(`${LOG} scheduler_scope_all`);
      }
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
  parseClientesEnv,
  todaCarteiraAtivada,
  resolverEscopoScheduler,
  adquirirLockGlobal,
  HORA_PADRAO,
  MINUTO_PADRAO,
  LOCK_NAMESPACE,
  LOCK_CHAVE_RODADA,
};
