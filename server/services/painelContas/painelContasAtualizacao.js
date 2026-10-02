// server/services/painelContas/painelContasAtualizacao.js
// "Atualizar dados" do Painel de Contas — atualização SOB DEMANDA de UM
// cliente numa competência. NÃO é um motor novo nem outra regra de cálculo:
// chama `centralVendasNoturnoService.executarRodada`, o MESMO orquestrador da
// rodada noturna, com o escopo de um cliente só —
//   criarSyncRun → executarSyncRun (por conta ML elegível)
//   → sincronizarAdsCliente → reconstruirSnapshotMensal (por cliente).
//
// ── O que muda em relação ao noturno (e só isto) ───────────────────────────
// Período:  competência corrente → dia 1 até HOJE (America/Sao_Paulo), ou seja
//           inclui o dia parcial; competência anterior → o mês COMPLETO, nunca
//           "até hoje". O noturno continua "até ontem" e não é tocado.
// Run:      requested_by = quem clicou e reutilizarCompletedPublicado = false
//           (o mesmo contrato do botão manual da Central): um clique pede dado
//           novo, não o run publicado de mais cedo. requested_by preenchido
//           também mantém estes runs FORA da recuperação de restart da rodada
//           noturna (que só olha requested_by IS NULL).
//
// ── Concorrência ───────────────────────────────────────────────────────────
// Escopo = cliente × competência. Duas atualizações simultâneas do mesmo
// escopo são recusadas (409) em dois níveis:
//   - no processo: registro em memória (também é de onde sai o progresso);
//   - entre instâncias: pg_try_advisory_lock de SESSÃO numa conexão DEDICADA,
//     aberta FORA do pool compartilhado.
// Por baixo ainda vale o dedupe do próprio sync_run (índice único de runs
// ativos por conta × período).
//
// Por que fora do pool (incidente 2026-10-02): com o lock numa conexão DO
// pool, cada atualização reservava 1 das 10 conexões até terminar — e a
// sincronização grava pelo mesmo pool. Dez cliques reservaram as dez; nenhuma
// sincronização conseguia gravar para terminar e soltar a sua, e o resto da
// API (GET /me/context) esperava conexão para sempre.
//
// Atualizações simultâneas também têm teto (429), em dois níveis:
//   - no processo: contador síncrono, checado ANTES de abrir conexão;
//   - entre instâncias: N vagas = N advisory locks; cada atualização segura
//     uma vaga na mesma sessão dedicada do lock de escopo.
// Encerrar a sessão dedicada solta escopo + vaga no Postgres de uma vez — no
// fim do job, em qualquer erro e quando a conexão cai.
//
// ── Estado ─────────────────────────────────────────────────────────────────
// O job vive em memória (o worker da Central também é in-process). Um restart
// perde o progresso, não o dado: o que já foi publicado continua publicado, e
// runs presos são reconciliados pelo criarSyncRun do próximo clique.

const crypto = require("crypto");
const pool = require("../../config/database");
const { configConexao } = require("../../config/databaseConexao");
const { assertClienteNaCarteira } = require("../squads/authorizationService");
const noturno = require("../centralVendas/centralVendasNoturnoService");
const { competenciaValida } = require("./painelContasManual");

const TIMEZONE = "America/Sao_Paulo";
const ORIGEM = "painel-sob-demanda";
const LOG = "[painel-atualizar]";
// Job terminado continua consultável por um tempo: a tela que recarregou
// (ou outra pessoa olhando o mesmo cliente) ainda vê o desfecho e as falhas.
const RETENCAO_CONCLUIDO_MS = 30 * 60 * 1000;

// Teto de atualizações simultâneas (por processo e entre instâncias).
// PAINEL_ATUALIZAR_MAX_SIMULTANEAS ajusta; inválido → padrão.
const LIMITE_SIMULTANEAS_PADRAO = 2;
const LIMITE_SIMULTANEAS_MAXIMO = 10;

// Conexão dedicada do lock: só faz try_lock (não bloqueante), então prazos
// curtos. Falhar aqui recusa o clique; nunca trava a API.
const LOCK_CONNECT_TIMEOUT_MS = 10000;
const LOCK_QUERY_TIMEOUT_MS = 10000;

const PREFIXO_LOCK_ESCOPO = "venforce:painel-contas:atualizar:";
const PREFIXO_LOCK_VAGA = "venforce:painel-contas:atualizar:vaga:";

function erro(statusCode, code, mensagem, extra = {}) {
  const e = new Error(mensagem);
  e.statusCode = statusCode;
  e.code = code;
  Object.assign(e, extra);
  return e;
}

function ehAdmin(user) {
  return String(user?.role || "").toLowerCase() === "admin";
}

function resolverLimiteSimultaneas(valor) {
  const n = Number.parseInt(valor, 10);
  if (!Number.isFinite(n) || n < 1) return LIMITE_SIMULTANEAS_PADRAO;
  return Math.min(n, LIMITE_SIMULTANEAS_MAXIMO);
}

function erroLimite(limite) {
  return erro(
    429,
    "LIMITE_ATUALIZACOES_SIMULTANEAS",
    `Já há ${limite} ${limite === 1 ? "atualização" : "atualizações"} em andamento. Aguarde uma terminar e tente de novo.`
  );
}

// ---------------------------------------------------------------------------
// Período
// ---------------------------------------------------------------------------

function ultimoDia(competencia) {
  const [ano, mes] = competencia.split("-").map(Number);
  return `${competencia}-${String(new Date(Date.UTC(ano, mes, 0)).getUTCDate()).padStart(2, "0")}`;
}

/**
 * Janela da atualização sob demanda.
 * @param {string} competencia YYYY-MM
 * @param {string} hoje        YYYY-MM-DD no fuso de negócio
 */
function periodoSobDemanda(competencia, hoje) {
  const atual = String(hoje).slice(0, 7);
  if (competencia > atual) throw erro(400, "COMPETENCIA_FUTURA", "Não é possível atualizar uma competência futura.");
  const dateFrom = `${competencia}-01`;
  if (competencia === atual) {
    return { competencia, dateFrom, dateTo: hoje, incluiHoje: true, mesCompleto: false };
  }
  return { competencia, dateFrom, dateTo: ultimoDia(competencia), incluiHoje: false, mesCompleto: true };
}

// ---------------------------------------------------------------------------
// Mensagens por conta — só afirma o que o código/resultado diz.
// ---------------------------------------------------------------------------

const MENSAGEM_POR_CODIGO = {
  GRANT_UNAVAILABLE: "Mercado Livre sem autorização válida — reconecte a conta em Clientes.",
  ML_ACCOUNT_MISMATCH: "A autorização do Mercado Livre pertence a outra conta — reconecte em Clientes.",
  MULTIPLE_MARKETPLACE_ACCOUNTS: "Cliente com mais de uma conta ativa sem conta indicada.",
  NAO_PUBLICADO_ORDERS_INCOMPLETO: "Sincronizou, mas os pedidos vieram incompletos — nada foi publicado.",
  RUN_EM_ANDAMENTO_EM_OUTRO_PROCESSO: "Outra sincronização desta conta ainda está rodando.",
  conta_sem_mercado_livre_conectado: "Mercado Livre não conectado.",
  marketplace_nao_suportado: "Marketplace sem sincronização automática.",
  conta_inativa: "Conta inativa.",
};

function mensagemDaConta(resultado) {
  if (resultado.status === "sucesso") return null;
  if (resultado.status === "parcial") {
    if (resultado.motivo && MENSAGEM_POR_CODIGO[resultado.motivo]) return MENSAGEM_POR_CODIGO[resultado.motivo];
    return "Publicado com cobertura parcial das fontes.";
  }
  if (resultado.status === "ignorado") {
    return MENSAGEM_POR_CODIGO[resultado.motivo] || "Conta ignorada nesta atualização.";
  }
  const codigo = resultado.erro?.code || null;
  return (codigo && MENSAGEM_POR_CODIGO[codigo]) || resultado.erro?.message || "Falha ao sincronizar a conta.";
}

const ESTADO_CONTA = { sucesso: "ok", parcial: "parcial", falha: "falha", ignorado: "ignorada" };

// ---------------------------------------------------------------------------
// Registro em memória
// ---------------------------------------------------------------------------

const jobs = new Map(); // chave cliente|competência → job
let emAndamento = 0; // vagas locais ocupadas (do lock adquirido até o fim do job)

function chave(clienteId, competencia) {
  return `${Number(clienteId)}|${competencia}`;
}

function vigente(job, agoraMs) {
  if (!job) return null;
  if (job.estado === "executando") return job;
  return agoraMs - new Date(job.concluidaEm).getTime() <= RETENCAO_CONCLUIDO_MS ? job : null;
}

// Cópia pública: o job interno carrega referências (lock) que não vão para a
// resposta HTTP.
function publico(job) {
  if (!job) return null;
  return {
    id: job.id,
    clienteId: job.clienteId,
    competencia: job.competencia,
    estado: job.estado,
    periodo: { ...job.periodo },
    iniciadaEm: job.iniciadaEm,
    iniciadaPor: job.iniciadaPor,
    concluidaEm: job.concluidaEm,
    progresso: { ...job.progresso },
    contas: job.contas.map((c) => ({ ...c })),
    ads: job.ads ? { ...job.ads } : null,
    snapshot: job.snapshot ? { ...job.snapshot } : null,
    mensagem: job.mensagem,
  };
}

function atualizacaoDoCliente(clienteId, competencia, { agoraMs = Date.now() } = {}) {
  return publico(vigente(jobs.get(chave(clienteId, competencia)), agoraMs));
}

// ---------------------------------------------------------------------------
// Lock entre instâncias
// ---------------------------------------------------------------------------

// Conexão própria, FORA do pool compartilhado (ver "Por que fora do pool").
function criarConexaoDedicada() {
  const { Client } = require("pg");
  return new Client({
    ...configConexao(),
    application_name: "venforce-painel-atualizar-lock",
    connectionTimeoutMillis: LOCK_CONNECT_TIMEOUT_MS,
    query_timeout: LOCK_QUERY_TIMEOUT_MS,
    keepAlive: true,
  });
}

/**
 * Lock do escopo cliente × competência + uma das `vagas` globais, ambos de
 * SESSÃO numa conexão dedicada. Retorna { adquirido: true, liberar } ou
 * { adquirido: false, motivo: "ESCOPO_OCUPADO" | "LIMITE_GLOBAL" }.
 * A conexão é encerrada em todo desfecho que não devolve o lock.
 */
async function adquirirLockEscopo({ clienteId, competencia, vagas, criarConexao = criarConexaoDedicada, logger = console }) {
  const nome = `${PREFIXO_LOCK_ESCOPO}${Number(clienteId)}:${competencia}`;
  const client = criarConexao();
  let encerramento = null;
  // Encerrar a sessão solta TODOS os advisory locks dela no Postgres (escopo
  // e vaga), mesmo que nenhum unlock explícito chegue a rodar. Idempotente.
  const encerrar = () => {
    if (!encerramento) encerramento = Promise.resolve().then(() => client.end()).catch(() => {});
    return encerramento;
  };
  // Sem listener, um 'error' da conexão (rede caiu) derrubaria o processo. O
  // Postgres já soltou os locks da sessão; o job segue até o fim.
  client.on("error", (err) => {
    logger.warn(`${LOG} conexão do lock caiu (${nome}): ${err?.message}`);
    encerrar();
  });
  const tentar = async (chave) => {
    const r = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [chave]);
    return r.rows[0]?.locked === true;
  };

  try {
    await client.connect();
    if (!(await tentar(nome))) {
      await encerrar();
      return { adquirido: false, motivo: "ESCOPO_OCUPADO" };
    }
    let vaga = null;
    for (let i = 0; i < vagas && vaga === null; i += 1) {
      if (await tentar(`${PREFIXO_LOCK_VAGA}${i}`)) vaga = i;
    }
    if (vaga === null) {
      await encerrar();
      return { adquirido: false, motivo: "LIMITE_GLOBAL" };
    }
    return { adquirido: true, vaga, liberar: encerrar };
  } catch (err) {
    await encerrar();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

function defaultDeps() {
  const runService = require("../centralVendas/centralVendasSyncRunService");
  return {
    db: pool,
    assertClienteNaCarteira,
    listarContas: noturno.listarContas,
    executarRodada: noturno.executarRodada,
    criarSyncRun: runService.criarSyncRun,
    adquirirLock: adquirirLockEscopo,
    criarConexaoLock: criarConexaoDedicada,
    hoje: () => noturno.hojeNoFuso(new Date(), TIMEZONE),
    agora: () => new Date(),
    env: process.env,
    logger: console,
  };
}

// Mesmos logs do orquestrador, com prefixo próprio: um grep por
// [cron-central] continua mostrando só a rodada automática.
function loggerComPrefixo(logger) {
  const trocar = (m) => (typeof m === "string" ? m.replace("[cron-central]", LOG) : m);
  return {
    log: (m, ...r) => logger.log(trocar(m), ...r),
    warn: (m, ...r) => logger.warn(trocar(m), ...r),
    error: (m, ...r) => logger.error(trocar(m), ...r),
  };
}

function concluir(job, resumo, agora) {
  const contas = job.contas;
  const falhas = contas.filter((c) => c.estado === "falha").length;
  const parciais = contas.filter((c) => c.estado === "parcial" || c.estado === "ignorada").length;
  const ok = contas.filter((c) => c.estado === "ok").length;
  const sincronizaveis = contas.filter((c) => c.elegivel).length;

  job.snapshot = resumo
    ? { atualizado: resumo.snapshots.atualizados > 0, motivo: Object.keys(resumo.snapshots.porMotivo)[0] || null }
    : null;
  job.ads = resumo
    ? { atualizado: resumo.ads.atualizados > 0, motivo: Object.keys(resumo.ads.porMotivo)[0] || null }
    : null;

  if (ok === 0 && falhas > 0 && falhas === sincronizaveis) {
    job.estado = "falhou";
    job.mensagem = sincronizaveis === 1 ? "A conta não foi atualizada." : `Nenhuma das ${sincronizaveis} contas foi atualizada.`;
  } else if (falhas > 0 || parciais > 0) {
    job.estado = "concluida_com_pendencias";
    job.mensagem = `${ok} de ${contas.length} ${contas.length === 1 ? "conta atualizada" : "contas atualizadas"}.`;
  } else {
    job.estado = "concluida";
    job.mensagem = ok === 1 ? "Conta atualizada." : `${ok} contas atualizadas.`;
  }
  // O evento da última conta só chega depois de Ads + snapshot do cliente
  // (o orquestrador fecha o grupo antes de reportar), então "concluída" aqui
  // já inclui a reconstrução do número consolidado.
  job.progresso = { ...job.progresso, fase: "concluida" };
  job.concluidaEm = agora.toISOString();
}

async function executarJob(job, contexto, deps) {
  const { cliente, rows, lock } = contexto;
  const porConta = new Map(job.contas.map((c) => [c.contaId, c]));
  let resumo = null;
  try {
    resumo = await deps.executarRodada(
      {
        periodos: [{ competencia: job.periodo.competencia, dateFrom: job.periodo.dateFrom, dateTo: job.periodo.dateTo }],
        concorrencia: noturno.resolverConcorrencia(deps.env.SYNC_CENTRAL_CONCURRENCY),
        clientes: [cliente.slug],
        origem: ORIGEM,
        onProgresso: (p) => {
          job.progresso = {
            fase: p.fase === "execucao" ? "contas" : "preparacao",
            concluidas: p.concluidas ?? 0,
            total: p.total ?? job.progresso.total,
          };
          const r = p.resultado;
          const conta = r ? porConta.get(Number(r.clienteContaId)) : null;
          if (conta) {
            conta.estado = ESTADO_CONTA[r.status] || "falha";
            conta.mensagem = mensagemDaConta(r);
            conta.erroCodigo = r.erro?.code || (r.status !== "sucesso" ? r.motivo || null : null);
            conta.runId = r.runId ?? null;
          }
        },
      },
      {
        db: deps.db,
        // Contas já lidas na validação — mesma linha, sem 2ª consulta.
        listarContas: async () => rows,
        criarSyncRun: (args) => deps.criarSyncRun({
          ...args,
          requestedBy: job.iniciadaPorId,
          reutilizarCompletedPublicado: false,
        }),
        logger: loggerComPrefixo(deps.logger),
      }
    );
  } catch (err) {
    // Erro estrutural (ex.: schema da Central indisponível): nenhuma conta
    // rodou. Contas ainda pendentes viram falha com a causa.
    const { code, message } = err || {};
    for (const c of job.contas) {
      if (c.estado === "pendente") {
        c.estado = "falha";
        c.erroCodigo = code || null;
        c.mensagem = String(message || "Falha ao iniciar a atualização.").slice(0, 300);
      }
    }
    deps.logger.error(`${LOG} ${cliente.slug} ${job.competencia} erro estrutural: ${code ? `${code} ` : ""}${message}`);
  } finally {
    concluir(job, resumo, deps.agora());
    await Promise.resolve(lock?.liberar?.()).catch((err) => {
      deps.logger.warn(`${LOG} falha ao liberar lock ${cliente.slug} ${job.competencia}: ${err?.message}`);
    });
  }
  return job;
}

/**
 * POST /painel-contas/:clienteId/atualizar/:competencia
 * Valida, registra o job e dispara a execução em segundo plano. Responde com
 * o job em "executando" — o progresso é lido por obterAtualizacao.
 */
async function iniciarAtualizacao(user, clienteRef, competencia, depsOverride = {}) {
  const deps = { ...defaultDeps(), ...depsOverride };
  if (!ehAdmin(user)) throw erro(403, "SEM_PERMISSAO", "Atualizar dados sob demanda é restrito a administradores.");
  if (!competenciaValida(competencia)) throw erro(400, "COMPETENCIA_INVALIDA", "competencia inválida (esperado YYYY-MM).");
  const periodo = periodoSobDemanda(competencia, deps.hoje());
  const cliente = await deps.assertClienteNaCarteira(user, clienteRef, deps.db);

  const k = chave(cliente.id, competencia);
  const agora = deps.agora();
  const existente = vigente(jobs.get(k), agora.getTime());
  if (existente?.estado === "executando") {
    throw erro(409, "ATUALIZACAO_EM_ANDAMENTO", "Já existe uma atualização deste cliente nesta competência em andamento.", {
      atualizacao: publico(existente),
    });
  }

  // Mesma classificação da rodada noturna (§9): só contas ML ativas e
  // conectadas sincronizam; as demais entram no job como "ignorada" com o
  // motivo, para a tela não sugerir que foram tentadas.
  const todas = await deps.listarContas(deps.db);
  const rows = todas.filter((r) => Number(r.cliente_id) === Number(cliente.id));
  const { elegiveis, ignoradas } = noturno.classificarContas(rows);
  if (elegiveis.length === 0) {
    throw erro(422, "SEM_CONTA_ELEGIVEL", "Nenhuma conta Mercado Livre ativa e conectada para atualizar neste cliente.");
  }

  // Teto por processo ANTES de abrir conexão. Checar e reservar no mesmo
  // trecho síncrono: cliques simultâneos não passam juntos pela checagem.
  const limite = deps.limiteSimultaneas ?? resolverLimiteSimultaneas(deps.env?.PAINEL_ATUALIZAR_MAX_SIMULTANEAS);
  if (emAndamento >= limite) throw erroLimite(limite);
  emAndamento += 1;
  let vagaDevolvida = false;
  const devolverVaga = () => {
    if (vagaDevolvida) return;
    vagaDevolvida = true;
    emAndamento -= 1;
  };

  let lockEscopo;
  try {
    lockEscopo = await deps.adquirirLock({
      clienteId: cliente.id, competencia, vagas: limite, criarConexao: deps.criarConexaoLock, logger: deps.logger,
    });
  } catch (err) {
    devolverVaga();
    throw err;
  }
  if (!lockEscopo.adquirido) {
    devolverVaga();
    if (lockEscopo.motivo === "LIMITE_GLOBAL") throw erroLimite(limite);
    throw erro(409, "ATUALIZACAO_EM_ANDAMENTO", "Já existe uma atualização deste cliente nesta competência em andamento.");
  }
  // Fim do job (ou falha antes dele): devolve a vaga local primeiro — ela não
  // pode depender de a conexão dedicada encerrar a tempo — e solta o lock.
  const lock = {
    liberar: async () => {
      devolverVaga();
      await lockEscopo.liberar?.();
    },
  };

  let job;
  try {
    job = {
      id: crypto.randomUUID(),
      clienteId: Number(cliente.id),
      competencia,
      estado: "executando",
      periodo,
      iniciadaEm: agora.toISOString(),
      iniciadaPor: user.nome || null,
      iniciadaPorId: user.id ?? null,
      concluidaEm: null,
      progresso: { fase: "preparacao", concluidas: 0, total: elegiveis.length },
      contas: [
        ...elegiveis.map((c) => ({
          contaId: c.clienteContaId, elegivel: true, estado: "pendente", mensagem: null, erroCodigo: null, runId: null,
        })),
        ...ignoradas
          // Conta inativa não faz parte do consolidado: não é pendência.
          .filter((c) => c.motivo !== "conta_inativa" && c.motivo !== "cliente_inativo")
          .map((c) => ({
            contaId: c.clienteContaId, elegivel: false, estado: "ignorada",
            mensagem: MENSAGEM_POR_CODIGO[c.motivo] || null, erroCodigo: c.motivo, runId: null,
          })),
      ],
      ads: null,
      snapshot: null,
      mensagem: null,
    };
    jobs.set(k, job);
    deps.logger.log(
      `${LOG} início cliente=${cliente.slug} competência=${competencia} período=${periodo.dateFrom}..${periodo.dateTo}`
        + ` contas=${elegiveis.length} por=${job.iniciadaPorId ?? "?"}`
    );
  } catch (err) {
    if (job && jobs.get(k) === job) jobs.delete(k);
    await Promise.resolve(lock.liberar()).catch(() => {});
    throw err;
  }

  const execucao = executarJob(job, { cliente, rows, lock }, deps);
  // Segundo plano de propósito: a resposta não espera a API do Mercado Livre.
  execucao.catch(() => {});
  return { atualizacao: publico(job), execucao };
}

// GET /painel-contas/:clienteId/atualizar/:competencia
async function obterAtualizacao(user, clienteRef, competencia, depsOverride = {}) {
  const deps = { ...defaultDeps(), ...depsOverride };
  if (!competenciaValida(competencia)) throw erro(400, "COMPETENCIA_INVALIDA", "competencia inválida (esperado YYYY-MM).");
  const cliente = await deps.assertClienteNaCarteira(user, clienteRef, deps.db);
  return atualizacaoDoCliente(cliente.id, competencia, { agoraMs: deps.agora().getTime() });
}

function _limparParaTestes() {
  jobs.clear();
  emAndamento = 0;
}

module.exports = {
  iniciarAtualizacao,
  obterAtualizacao,
  atualizacaoDoCliente,
  periodoSobDemanda,
  mensagemDaConta,
  ehAdmin,
  RETENCAO_CONCLUIDO_MS,
  adquirirLockEscopo,
  resolverLimiteSimultaneas,
  LIMITE_SIMULTANEAS_PADRAO,
  _limparParaTestes,
};
