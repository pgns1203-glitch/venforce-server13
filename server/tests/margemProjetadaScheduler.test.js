// server/tests/margemProjetadaScheduler.test.js
//
// Scheduler interno da margem projetada global (margemProjetadaScheduler):
// opt-in, próximo disparo no horário configurável (padrão 05:30)
// America/Sao_Paulo (independente do TZ do processo), boot depois do
// horário → amanhã, nunca roda no boot, duas tentativas não iniciam duas
// rodadas (neste processo e entre instâncias via advisory lock), erro da
// rodada não derruba o processo e reagenda, parar() limpa o timer,
// integração no index.js, e o scheduler NÃO conhece meliSyncService/
// motorMargemService/repository — só chama o orquestrador.
//
// Timers, relógio, pool e rodada são falsos/injetados. NENHUM banco real:
// DATABASE_URL aponta para porta morta antes de qualquer require.

process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/teste-sem-banco";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const sched = require("../services/motorMargem/margemProjetadaScheduler");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

let unhandled = 0;
process.on("unhandledRejection", () => { unhandled += 1; });

// Uma promise pendurada esvazia o event loop e o Node sai com 0 sem terminar
// o teste — aqui isso vira falha.
let concluido = false;
process.on("exit", () => {
  if (!concluido) {
    console.error(`margemProjetadaScheduler.test.js: NÃO concluiu (parou após ${checks} verificações)`);
    process.exitCode = 1;
  }
});

const iso = (ms) => new Date(ms).toISOString();
const T = (s) => Date.parse(s);

function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimeoutFn(fn, ms) {
      const t = { fn, ms, unrefd: false, cleared: false, fired: false, unref() { this.unrefd = true; } };
      timers.push(t);
      return t;
    },
    clearTimeoutFn(t) { t.cleared = true; },
    ativos() { return timers.filter((t) => !t.cleared && !t.fired); },
  };
}

function makeScheduler({ env = { MARGEM_PROJETADA_SCHEDULER_ENABLED: "true" }, agoraInicial, rodada, lock } = {}) {
  let agora = T(agoraInicial || "2026-09-24T07:00:00Z"); // 04:00 em SP
  const timers = fakeTimers();
  const logs = [];
  const chamadas = { rodada: [], lock: 0, liberar: 0 };
  const logger = {
    log: (...a) => logs.push(`LOG ${a.join(" ")}`),
    warn: (...a) => logs.push(`WARN ${a.join(" ")}`),
    error: (...a) => logs.push(`ERROR ${a.join(" ")}`),
  };
  const s = sched.createScheduler({
    env,
    agora: () => agora,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    getPool: () => ({ fake: true }),
    executarRodada: async (opts) => {
      chamadas.rodada.push(opts);
      return rodada ? rodada(opts) : { elegiveis: 2, sucessos: 2, parciais: 0, falhas: 0, ignoradas: 0 };
    },
    adquirirLockGlobal: async (pool, namespace, chave) => {
      chamadas.lock += 1;
      if (lock) return lock(pool, namespace, chave);
      return { adquirido: true, liberar: async () => { chamadas.liberar += 1; } };
    },
    logger,
  });
  return {
    s, timers, logs, chamadas,
    setAgora: (v) => { agora = typeof v === "number" ? v : T(v); },
    getAgora: () => agora,
    // Dispara o timer ativo: relógio vai para o alvo e o callback é aguardado.
    async disparar(atrasoMs = 0) {
      const t = timers.ativos()[0];
      assert.ok(t, "nenhum timer ativo para disparar");
      agora += t.ms + atrasoMs;
      t.fired = true;
      await t.fn();
    },
  };
}

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

async function run() {
  // =========================================================================
  // 1. Configuração (cenários 1-3 e 8 do PASSO 16)
  // =========================================================================
  eq("habilitado: ausente → desligado (opt-in)", sched.habilitado({}), false);
  eq("habilitado: 'true' → ligado", sched.habilitado({ MARGEM_PROJETADA_SCHEDULER_ENABLED: "true" }), true);
  eq("habilitado: ' TRUE ' → ligado", sched.habilitado({ MARGEM_PROJETADA_SCHEDULER_ENABLED: " TRUE " }), true);
  for (const v of ["false", "0", "1", "yes", ""]) {
    eq(`habilitado: '${v}' → desligado`, sched.habilitado({ MARGEM_PROJETADA_SCHEDULER_ENABLED: v }), false);
  }

  {
    const logger = { log() {}, warn() {}, error() {} };
    eq("horário: padrão 05:30", sched.parseHorario({}, logger), { hora: 5, minuto: 30 });
    eq("horário: HOUR/MINUTE customizados", sched.parseHorario({ MARGEM_PROJETADA_SCHEDULER_HOUR: "7", MARGEM_PROJETADA_SCHEDULER_MINUTE: "15" }, logger), { hora: 7, minuto: 15 });
    eq("horário: default diferente da Central de Vendas (03:00)", sched.parseHorario({}, logger).hora !== 3, true);
  }
  {
    const avisos = [];
    const logger = { log() {}, warn: (...a) => avisos.push(a.join(" ")), error() {} };
    eq("horário: HOUR inválida cai no padrão (minuto customizado preservado)", sched.parseHorario({ MARGEM_PROJETADA_SCHEDULER_HOUR: "99", MARGEM_PROJETADA_SCHEDULER_MINUTE: "10" }, logger), { hora: 5, minuto: 10 });
    ok("horário: aviso de HOUR inválida", avisos.some((l) => l.includes("MARGEM_PROJETADA_SCHEDULER_HOUR inválida")));
    eq("horário: MINUTE inválida cai no padrão (hora customizada preservada)", sched.parseHorario({ MARGEM_PROJETADA_SCHEDULER_HOUR: "9", MARGEM_PROJETADA_SCHEDULER_MINUTE: "99" }, logger), { hora: 9, minuto: 30 });
    ok("horário: configuração inválida não lança (segura)", true);
  }

  // =========================================================================
  // 2. Próximo disparo — reaproveita calcularProximoDisparo do precedente
  // =========================================================================
  eq("timezone: America/Sao_Paulo explícito", sched.formatarNoFuso(T("2026-09-24T08:30:00Z")).includes("America/Sao_Paulo"), true);
  eq("próximo: 05:30 SP = 08:30 UTC", iso(sched.calcularProximoDisparo(T("2026-09-24T07:00:00Z"), { hora: 5, minuto: 30 })), "2026-09-24T08:30:00.000Z");

  // =========================================================================
  // 3. Desabilitado (cenário 2)
  // =========================================================================
  for (const env of [{}, { MARGEM_PROJETADA_SCHEDULER_ENABLED: "false" }]) {
    const h = makeScheduler({ env });
    eq(`desabilitado ${JSON.stringify(env)}: iniciar → false`, h.s.iniciar(), false);
    eq(`desabilitado ${JSON.stringify(env)}: nenhum timer`, h.timers.timers.length, 0);
    ok(`desabilitado ${JSON.stringify(env)}: log scheduler_disabled`, h.logs.some((l) => l.includes("scheduler_disabled")));
    eq(`desabilitado ${JSON.stringify(env)}: nenhuma rodada/lock`, [h.chamadas.rodada.length, h.chamadas.lock], [0, 0]);
  }

  // =========================================================================
  // 4. Ligado: agenda, não roda no boot (cenários 3, 4, 6, 7)
  // =========================================================================
  {
    const h = makeScheduler({ agoraInicial: "2026-09-24T07:00:00Z" }); // 04:00 SP
    eq("ligado: iniciar → true", h.s.iniciar(), true);
    ok("ligado: log scheduler_started", h.logs.some((l) => l.includes("scheduler_started")));
    eq("ligado: um timer", h.timers.ativos().length, 1);
    eq("ligado 04:00 SP: dispara em 1h30", h.timers.ativos()[0].ms, 1.5 * 3600 * 1000);
    ok("ligado: timer com unref (não segura o processo)", h.timers.ativos()[0].unrefd);
    ok("ligado: log scheduler_next_run", h.logs.some((l) => l.includes("scheduler_next_run")));
    await flush();
    eq("ligado: NÃO roda imediatamente no boot", [h.chamadas.rodada.length, h.chamadas.lock], [0, 0]);
    eq("ligado: iniciar de novo não cria segundo timer (idempotente)", [h.s.iniciar(), h.timers.ativos().length], [true, 1]);
    eq("estado exposto", h.s.estado(), { iniciado: true, emExecucao: false, proximoEm: T("2026-09-24T08:30:00Z"), temTimer: true });
  }
  {
    const h = makeScheduler({ agoraInicial: "2026-09-24T13:30:00Z" }); // 10:30 SP (deploy de manhã, depois do horário)
    h.s.iniciar();
    eq("boot depois do horário: agenda para amanhã", iso(h.s.estado().proximoEm), "2026-09-25T08:30:00.000Z");
  }
  {
    const h = makeScheduler({ env: { MARGEM_PROJETADA_SCHEDULER_ENABLED: "true", MARGEM_PROJETADA_SCHEDULER_HOUR: "6", MARGEM_PROJETADA_SCHEDULER_MINUTE: "45" } });
    h.s.iniciar();
    eq("horário customizado: 06:45 SP", iso(h.s.estado().proximoEm), "2026-09-24T09:45:00.000Z");
  }

  // =========================================================================
  // 5. Disparo: roda uma vez, libera o lock, reagenda (cenários 11, 14, 16, 18)
  // =========================================================================
  {
    const h = makeScheduler();
    h.s.iniciar();
    await h.disparar();
    eq("disparo: uma rodada", h.chamadas.rodada.length, 1);
    eq("disparo: opções passadas ao orquestrador (carteira completa)", h.chamadas.rodada[0], { clientes: null, plano: false });
    eq("disparo: lock obtido e liberado exatamente 1x", [h.chamadas.lock, h.chamadas.liberar], [1, 1]);
    ok("disparo: logs run_started/run_completed/lock_released", h.logs.some((l) => l.includes("scheduler_run_started")) && h.logs.some((l) => l.includes("scheduler_run_completed")) && h.logs.some((l) => l.includes("scheduler_lock_released")));
    eq("disparo: reagendado (1 timer ativo)", h.timers.ativos().length, 1);
    eq("disparo: próximo = amanhã mesmo horário", iso(h.s.estado().proximoEm), "2026-09-25T08:30:00.000Z");
    await h.disparar();
    eq("disparo: próxima execução continua após sucesso (2ª rodada)", h.chamadas.rodada.length, 2);
  }
  {
    // Timer disparou cedo (relógio ajustado): reagenda sem rodar.
    const h = makeScheduler();
    h.s.iniciar();
    const t = h.timers.ativos()[0];
    h.setAgora(h.getAgora() + t.ms - 60 * 1000);
    t.fired = true;
    await t.fn();
    eq("disparo cedo: não roda", h.chamadas.rodada.length, 0);
    eq("disparo cedo: reagendado para o mesmo alvo", [h.timers.ativos().length, iso(h.s.estado().proximoEm)], [1, "2026-09-24T08:30:00.000Z"]);
  }

  // =========================================================================
  // 6. Lock ocupado → orquestrador NÃO chamado (cenário 12)
  // =========================================================================
  {
    const h = makeScheduler({ lock: () => ({ adquirido: false }) });
    h.s.iniciar();
    await h.disparar();
    eq("lock ocupado: orquestrador não chamado", h.chamadas.rodada.length, 0);
    ok("lock ocupado: log scheduler_lock_not_acquired", h.logs.some((l) => l.includes("scheduler_lock_not_acquired")));
    eq("lock ocupado: reagendado mesmo assim", h.timers.ativos().length, 1);
  }

  // =========================================================================
  // 7. Duas tentativas simultâneas (cenário 9)
  // =========================================================================
  {
    let liberarRodada;
    let n = 0;
    const h = makeScheduler({ rodada: () => (++n === 1 ? new Promise((resolve) => { liberarRodada = () => resolve({}); }) : {}) });
    const primeira = h.s.dispararRodada();
    await flush();
    const segunda = await h.s.dispararRodada();
    eq("mesmo processo: segunda tentativa ignorada", segunda, { executada: false, motivo: "EM_ANDAMENTO_NESTE_PROCESSO" });
    liberarRodada();
    eq("mesmo processo: primeira executou", (await primeira).executada, true);
    eq("mesmo processo: UMA rodada", h.chamadas.rodada.length, 1);
  }

  // =========================================================================
  // 8. Conexão dedicada + unlock/release (cenários 13, 15, 16)
  // =========================================================================
  {
    const seguros = new Map();
    let nextConn = 0;
    const releases = [];
    const queries = [];
    const pool = {
      async connect() {
        const id = ++nextConn;
        return {
          async query(sql, params) {
            queries.push({ sql, params });
            const chave = params.join(":");
            if (sql.includes("pg_try_advisory_lock")) {
              if (seguros.has(chave) && seguros.get(chave) !== id) return { rows: [{ locked: false }] };
              seguros.set(chave, id);
              return { rows: [{ locked: true }] };
            }
            if (sql.includes("pg_advisory_unlock")) {
              if (seguros.get(chave) === id) seguros.delete(chave);
              return { rows: [{ pg_advisory_unlock: true }] };
            }
            throw new Error(`SQL inesperado: ${sql}`);
          },
          release(err) { releases.push({ id, err: err || null }); },
        };
      },
    };
    let rodadas = 0;
    let liberar;
    const bloqueio = new Promise((r) => { liberar = r; });
    const mk = () => sched.createScheduler({
      env: { MARGEM_PROJETADA_SCHEDULER_ENABLED: "true" },
      getPool: () => pool,
      executarRodada: async () => { rodadas += 1; await bloqueio; return {}; },
      logger: { log() {}, warn() {}, error() {} },
    });
    const a = mk();
    const b = mk();
    const pa = a.dispararRodada();
    const pb = b.dispararRodada();
    await flush();
    liberar();
    const [ra, rb] = await Promise.all([pa, pb]);
    eq("conexão dedicada: exatamente uma rodada entre instâncias", rodadas, 1);
    eq("conexão dedicada: uma executou, a outra viu o lock", [ra.executada, rb.executada].sort(), [false, true]);
    eq("conexão dedicada: lock liberado ao fim (unlock em sucesso)", seguros.size, 0);
    eq("conexão dedicada: as duas conexões voltaram ao pool (release sempre ocorre)", releases.length, 2);
    ok("conexão dedicada: usa client.query, nunca pool.query direto", queries.every((q) => typeof q.sql === "string"));
    eq("conexão dedicada: próxima tentativa consegue o lock", (await a.dispararRodada()).executada, true);
    eq("namespace próprio do lock (nenhum dos já existentes)", [sched.LOCK_NAMESPACE, sched.LOCK_CHAVE_RODADA], [1296845930, 1]);
    const usados = [1296845907, 1296845908, 1296845909, 1296845920, 529871001, 529871002];
    ok("namespace novo: não colide com nenhum já usado no repositório", !usados.includes(sched.LOCK_NAMESPACE));
  }
  {
    // Unlock falhou → conexão descartada (release(err)), não devolvida segurando o lock.
    const releases = [];
    const pool = {
      async connect() {
        return {
          async query(sql) {
            if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
            throw new Error("conexão caiu");
          },
          release(err) { releases.push(err || null); },
        };
      },
    };
    const lock = await sched.adquirirLockGlobal(pool, sched.LOCK_NAMESPACE, sched.LOCK_CHAVE_RODADA);
    await lock.liberar();
    ok("unlock falhou: conexão descartada com erro (unlock em erro)", releases.length === 1 && releases[0] instanceof Error);
  }

  // =========================================================================
  // 9. Erros não matam o Web Service e reagendam (cenários 17, 19)
  // =========================================================================
  {
    const h = makeScheduler({
      rodada: async () => {
        const e = new Error("pool esgotado Authorization: Bearer APP_USR-777-segredo refresh_token=TG-xyz password=hunter2");
        e.code = "ECONNRESET";
        throw e;
      },
    });
    h.s.iniciar();
    let lancou = false;
    try { await h.disparar(); } catch (_) { lancou = true; }
    ok("erro na rodada: callback do timer não lança (não derruba Express)", !lancou);
    ok("erro na rodada: log scheduler_run_failed", h.logs.some((l) => l.startsWith("ERROR") && l.includes("scheduler_run_failed")));
    eq("erro na rodada: lock liberado mesmo assim", h.chamadas.liberar, 1);
    ok("erro na rodada: log scheduler_lock_released mesmo com erro", h.logs.some((l) => l.includes("scheduler_lock_released")));
    eq("erro na rodada: próxima rodada agendada", h.timers.ativos().length, 1);
    eq("erro na rodada: não fica preso em execução", h.s.estado().emExecucao, false);
    const texto = h.logs.join("\n");
    ok("erro na rodada: nenhum segredo no log", !texto.includes("APP_USR-777") && !texto.includes("TG-xyz") && !texto.includes("hunter2"));
    await h.disparar();
    eq("erro na rodada: próxima execução continua após erro (2ª rodada)", h.chamadas.rodada.length, 2);
  }
  {
    const h = makeScheduler({ lock: async () => { throw new Error("connect ECONNREFUSED 10.0.0.1:5432"); } });
    h.s.iniciar();
    await h.disparar();
    ok("banco fora no disparo: log de erro do lock", h.logs.some((l) => l.includes("erro ao obter lock da rodada")));
    eq("banco fora no disparo: rodada não executada", h.chamadas.rodada.length, 0);
    eq("banco fora no disparo: reagendado", h.timers.ativos().length, 1);
  }

  // =========================================================================
  // 10. iniciar() idempotente / parar() cancela timer (cenários 9, 10)
  // =========================================================================
  {
    const h = makeScheduler();
    h.s.iniciar();
    h.s.iniciar();
    eq("iniciar() 2x não cria dois timers", h.timers.timers.length, 1);
  }
  {
    const h = makeScheduler();
    h.s.iniciar();
    const t = h.timers.ativos()[0];
    h.s.parar();
    ok("parar: clearTimeout no timer ativo (cancela timer futuro)", t.cleared === true);
    eq("parar: estado", h.s.estado(), { iniciado: false, emExecucao: false, proximoEm: null, temTimer: false });
    await t.fn(); // callback atrasado depois de parar
    eq("parar: callback tardio não roda nem reagenda", [h.chamadas.rodada.length, h.timers.ativos().length], [0, 0]);
    eq("parar: pode reiniciar", [h.s.iniciar(), h.timers.ativos().length], [true, 1]);
  }
  {
    // Parar DURANTE uma rodada: ela termina (não é morta à força), mas não reagenda.
    let liberarRodada;
    const h = makeScheduler({ rodada: () => new Promise((resolve) => { liberarRodada = () => resolve({}); }) });
    h.s.iniciar();
    const disparo = h.disparar();
    await flush();
    h.s.parar();
    liberarRodada();
    await disparo;
    eq("parar durante rodada: rodada termina normalmente, mas não reagenda", h.timers.ativos().length, 0);
  }
  {
    // Instância padrão do módulo: parar() sem iniciar é seguro.
    sched.parar();
    ok("módulo: parar() sem iniciar não lança", true);
  }

  // =========================================================================
  // 11. Scheduler não conhece meliSyncService/motorMargemService/repository
  //     (cenários 20, 21, 22 do PASSO 16)
  // =========================================================================
  {
    const arquivo = fs.readFileSync(path.join(__dirname, "../services/motorMargem/margemProjetadaScheduler.js"), "utf8");
    const linhasRequire = arquivo.split("\n").filter((l) => /require\(/.test(l));
    ok("scheduler: não importa meliSyncService", !linhasRequire.some((l) => l.includes("meliSyncService")));
    ok("scheduler: não importa motorMargemService", !linhasRequire.some((l) => l.includes("motorMargemService")));
    ok("scheduler: não importa nenhum repository/snapshot", !linhasRequire.some((l) => /[Rr]epository/.test(l) || l.includes("margemProjetadaSnapshotRepository")));
    ok("scheduler: só chama margemProjetadaOrquestradorService.executarRodada", arquivo.includes('require("./margemProjetadaOrquestradorService").executarRodada'));
    ok("scheduler: nenhuma concorrência nova (sem Promise.all/worker/child_process)", !arquivo.includes("Promise.all") && !arquivo.includes("worker") && !arquivo.includes("child_process"));
    ok("scheduler: nenhum retry/backoff/sleep introduzido", !/\bretry\b/i.test(arquivo) && !/backoff/i.test(arquivo) && !arquivo.includes("sleep("));
  }

  // =========================================================================
  // 12. Integração no index.js (PASSO 17)
  // =========================================================================
  {
    const index = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
    ok("index: importa o scheduler", index.includes('require("./services/motorMargem/margemProjetadaScheduler")'));
    ok("index: inicia só depois de ensureAnunciosMargemProjetadaSnapshotSchema", /ensureAnunciosMargemProjetadaSnapshotSchema\(\)\.then\(\s*\(\) => margemProjetadaScheduler\.iniciar\(\)/.test(index));
    const encerrar = index.slice(index.indexOf("function encerrarComGraca"), index.indexOf('process.on("SIGTERM"'));
    ok("index: encerrarComGraca para o scheduler", encerrar.includes("margemProjetadaScheduler.parar()"));
    ok("index: boot não chama executarRodada nem processa carteira diretamente", !/margemProjetadaScheduler\.executarRodada/.test(index));
    // Boot com ENABLED=false: iniciar() não agenda nada, então nenhuma
    // chamada a executarRodada/ML/lock é possível nesse caminho.
    const h = makeScheduler({ env: {} });
    eq("boot ENABLED=false: iniciar → false, 0 timers, 0 rodadas, 0 locks", [h.s.iniciar(), h.timers.timers.length, h.chamadas.rodada.length, h.chamadas.lock], [false, 0, 0, 0]);
  }

  eq("nenhuma unhandled rejection", unhandled, 0);
  concluido = true;
  console.log(`margemProjetadaScheduler.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
