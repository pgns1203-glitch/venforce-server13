// server/config/databaseObservabilidade.js
//
// P0 03/11/2026 — observabilidade LEVE do pool do PostgreSQL. Objetivo: no
// próximo incidente, conseguir afirmar com log se o pool estava saturado
// (total=10 idle=0 waiting=37) ou saudável quando o PostgreSQL caiu, e quanto
// tempo o banco ficou indisponível até voltar a aceitar conexões.
//
// Sem query extra, sem timer agressivo:
//   - mede o tempo de AQUISIÇÃO de toda conexão (pool.query também passa por
//     pool.connect) e loga as lentas (>= PG_POOL_AQUISICAO_LENTA_MS, padrão
//     1000 ms; no máximo 1 linha a cada 10 s);
//   - conta falhas de aquisição (timeout do pool, banco recusando — ex.
//     57P03 "the database system is in recovery mode") e conexões perdidas;
//   - marca o pool como DEGRADADO no 1º erro e loga UMA linha de recuperação
//     na 1ª aquisição bem-sucedida depois disso, com a duração da queda;
//   - a cada PG_POOL_LOG_INTERVALO_MS (padrão 60 s) loga um resumo SÓ se a
//     janela teve algo anormal (espera, lenta, falha, erro); senão, um
//     resumo de rotina a cada 15 min.
// estadoDoPool() devolve o mesmo retrato para /health/db (sem consultar o banco).

const { lerMsPositivo } = require("./databaseConexao");

function codigoOuMensagem(err) {
  if (!err) return "";
  return `${err.code ? `${err.code} ` : ""}${String(err.message || err).slice(0, 160)}`;
}

function instrumentarPool(pool, {
  logger = console,
  nome = "principal",
  lentaMs = lerMsPositivo(process.env.PG_POOL_AQUISICAO_LENTA_MS, 1000),
  intervaloMs = lerMsPositivo(process.env.PG_POOL_LOG_INTERVALO_MS, 60000),
  rotinaMs = 15 * 60 * 1000,
  agora = () => Date.now(),
  iniciarTimer = true,
} = {}) {
  if (pool.__vfInstrumentado) return pool.__vfInstrumentado;

  const total = { aquisicoes: 0, lentas: 0, falhas: 0, conexoesPerdidas: 0, recuperacoes: 0 };
  let janela = novaJanela();
  let ultimoLogLenta = -Infinity;
  let ultimoResumoRotina = agora();
  let degradado = null; // { desde, erros, ultimoErro }
  let ultimaRecuperacao = null;

  function novaJanela() {
    return { aquisicoes: 0, lentas: 0, falhas: 0, conexoesPerdidas: 0, maxMs: 0, somaMs: 0, maxEspera: 0 };
  }

  function contagens() {
    return {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
      max: pool.options?.max ?? null,
    };
  }

  function linhaContagens() {
    const c = contagens();
    return `total=${c.total} idle=${c.idle} waiting=${c.waiting} max=${c.max}`;
  }

  function marcarDegradado(err) {
    if (!degradado) degradado = { desde: agora(), erros: 0, ultimoErro: null };
    degradado.erros += 1;
    degradado.ultimoErro = codigoOuMensagem(err);
  }

  function registrarAquisicao(ms, err, esperaNaEntrada) {
    janela.maxEspera = Math.max(janela.maxEspera, esperaNaEntrada);
    if (err) {
      total.falhas += 1;
      janela.falhas += 1;
      marcarDegradado(err);
      logger.error?.(`[db-pool] falha ao obter conexão após ${ms} ms: ${codigoOuMensagem(err)} | ${linhaContagens()}`);
      return;
    }
    total.aquisicoes += 1;
    janela.aquisicoes += 1;
    janela.somaMs += ms;
    janela.maxMs = Math.max(janela.maxMs, ms);
    if (degradado) {
      const duracao = agora() - degradado.desde;
      total.recuperacoes += 1;
      ultimaRecuperacao = { em: new Date(agora()).toISOString(), indisponivelMs: duracao, erros: degradado.erros };
      logger.log?.(
        `[db-pool] PostgreSQL voltou a atender: 1ª conexão ok ${duracao} ms depois do 1º erro ` +
        `(${degradado.erros} erro(s); último: ${degradado.ultimoErro}) | ${linhaContagens()}`
      );
      degradado = null;
    }
    if (ms >= lentaMs) {
      total.lentas += 1;
      janela.lentas += 1;
      if (agora() - ultimoLogLenta >= 10000) {
        ultimoLogLenta = agora();
        logger.warn?.(`[db-pool] aquisição lenta: ${ms} ms (fila na entrada=${esperaNaEntrada}) | ${linhaContagens()}`);
      }
    }
  }

  const connectOriginal = pool.connect.bind(pool);
  pool.connect = function connectInstrumentado(cb) {
    const t0 = agora();
    const espera = pool.waitingCount;
    if (typeof cb === "function") {
      return connectOriginal((err, client, release) => {
        registrarAquisicao(agora() - t0, err, espera);
        cb(err, client, release);
      });
    }
    return connectOriginal().then(
      (client) => { registrarAquisicao(agora() - t0, null, espera); return client; },
      (err) => { registrarAquisicao(agora() - t0, err, espera); throw err; }
    );
  };

  // Conexão que cai (ociosa ou em uso). O log detalhado já é feito por
  // protegerConexoesDoPool; aqui só conta e marca a degradação.
  pool.on("connect", (client) => {
    client.on("error", (err) => {
      total.conexoesPerdidas += 1;
      janela.conexoesPerdidas += 1;
      marcarDegradado(err);
    });
  });

  function resumo() {
    const j = janela;
    const media = j.aquisicoes ? Math.round(j.somaMs / j.aquisicoes) : 0;
    return `${linhaContagens()} | janela: aquisições=${j.aquisicoes} média=${media}ms máx=${j.maxMs}ms ` +
      `lentas=${j.lentas} falhas=${j.falhas} conexõesPerdidas=${j.conexoesPerdidas} filaMáx=${j.maxEspera}` +
      `${degradado ? ` | DEGRADADO há ${agora() - degradado.desde} ms` : ""}`;
  }

  function tick() {
    const c = contagens();
    const anormal = janela.lentas || janela.falhas || janela.conexoesPerdidas || janela.maxEspera > 0 || c.waiting > 0 || degradado;
    if (anormal) {
      logger.warn?.(`[db-pool] ${resumo()}`);
    } else if (agora() - ultimoResumoRotina >= rotinaMs) {
      logger.log?.(`[db-pool] ${resumo()}`);
      ultimoResumoRotina = agora();
    }
    janela = novaJanela();
  }

  let timer = null;
  if (iniciarTimer) {
    timer = setInterval(tick, intervaloMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  const api = {
    nome,
    tick,
    parar() { if (timer) clearInterval(timer); timer = null; },
    estado() {
      return {
        nome,
        ...contagens(),
        degradado: degradado
          ? { desde: new Date(degradado.desde).toISOString(), erros: degradado.erros, ultimoErro: degradado.ultimoErro }
          : null,
        ultimaRecuperacao,
        totais: { ...total },
      };
    },
  };
  pool.__vfInstrumentado = api;
  return api;
}

function estadoDoPool(pool) {
  return pool?.__vfInstrumentado ? pool.__vfInstrumentado.estado() : null;
}

module.exports = { instrumentarPool, estadoDoPool };
