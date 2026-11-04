// server/services/promoSnapshot/promoSnapshotReadService.js
// Promo Snapshot — leitura para as telas (Central de Margem e futuros
// consumidores). ZERO chamada ao Mercado Livre: só banco.
//
// Toda operação é account-scoped e validada ANTES de ler:
//   usuário autenticado (rota) → cliente na carteira (rota) → conta do
//   cliente, MELI e ativa (resolverContaDoCliente) → seller da conta.
// Nenhuma resposta mistura contas: toda consulta filtra por cliente_conta_id
// + seller vinculado HOJE à conta e pelo run apontado como snapshot atual
// dessa conta + seller (conta reconectada a outro seller não vê o anterior).
//
// Abrir a tela dispara o auto-trigger (ensureFreshPromoSnapshot), que só
// enfileira e devolve na hora — nunca espera o scan.

const pool = require("../../config/database");
const repoPadrao = require("./promoSnapshotRepository");
const service = require("./promoSnapshotService");
const { resolvePromoSnapshotConfig, avaliarPiloto } = require("./promoSnapshotConfig");
const { motivoDaFalha } = require("./promoSnapshotFonte");
const { criarErroHttp } = require("../motorMargem/marginSnapshotApiService");
const { redigirSegredos } = require("../motorMargem/marginSnapshotSanitize");

const LIMITE_SNAPSHOT_PADRAO = 50;
const LIMITE_SNAPSHOT_MAX = 100;

function defaults(deps = {}) {
  return {
    db: deps.db || pool,
    repo: deps.repo || repoPadrao,
    env: deps.env || process.env,
    now: deps.now || (() => new Date()),
    logger: deps.logger || console,
    resolverContaDoCliente: deps.resolverContaDoCliente || require("../motorMargem/marginSnapshotApiService").resolverContaDoCliente,
    obterConta: deps.obterConta || require("../clienteContas/clienteContaService").obterConta,
  };
}

function paginacao({ page, limit }, { padrao, max }) {
  const p = Math.max(1, Math.trunc(Number(page)) || 1);
  const l = Math.min(Math.max(Math.trunc(Number(limit)) || padrao, 1), max);
  return { page: p, limit: l };
}

/** Cliente + conta validados + seller vinculado (pode ser null: sem grant ML). */
async function resolverContaPromo({ clienteSlug, clienteContaId }, deps = {}) {
  const d = defaults(deps);
  const { cliente, conta } = await d.resolverContaDoCliente({ clienteSlug, clienteContaId }, deps);
  const completa = await d.obterConta(conta.id, d.db);
  const sellerId = completa && completa.external_account_id ? String(completa.external_account_id) : null;
  return {
    cliente,
    conta: { id: conta.id, nome: conta.nome || null },
    identidade: { clienteId: cliente.id, clienteSlug: cliente.slug, clienteContaId: conta.id, marketplace: "meli", sellerId },
  };
}

/**
 * Estado + auto-trigger. Falha no auto-trigger nunca derruba a leitura.
 * `autoTrigger:false` só lê.
 */
async function estadoComAutoTrigger(identidade, { autoTrigger = true } = {}, deps = {}) {
  const d = defaults(deps);
  const estado = await service.estadoSincronizacao(
    { clienteContaId: identidade.clienteContaId, marketplace: "meli", sellerId: identidade.sellerId },
    { ...deps, db: d.db, repo: d.repo }
  );
  let gatilho = { acao: "nenhuma" };
  if (autoTrigger && identidade.sellerId) {
    try {
      gatilho = await service.ensureFreshPromoSnapshot(identidade, { estado }, { ...deps, db: d.db, repo: d.repo });
    } catch (err) {
      gatilho = { acao: "erro", erro: String(err?.code || "AUTO_TRIGGER_FALHOU") };
    }
  }
  return { estado, gatilho };
}

function syncPublico(estado, gatilho) {
  return { ...service.estadoPublico(estado), autoTrigger: gatilho ? gatilho.acao : null };
}

// ─── Atualização manual: UMA regra para o status e para o POST /sync ────────
// O botão Atualizar da Central só renderiza `atualizacao`: nunca decide sozinho
// se pode atualizar. Motivos (quando `disponivel` é false):
//   CONTA_SEM_GRANT_ML   conta sem seller/conexão ML vinculada
//   WORKER_DESABILITADO  PROMO_SNAPSHOT_WORKER_ENABLED != true neste ambiente
//   PILOTO_VAZIO         nenhuma conta/cliente liberado (PROMO_SNAPSHOT_CLIENTES/CONTAS)
//   FORA_DO_PILOTO       esta conta não está na allowlist
//   EM_ANDAMENTO         já existe run desta conta na fila/em execução
//   COOLDOWN             última tentativa (não falha) há menos que o cooldown
// Precedência: grant > worker > allowlist > em andamento > cooldown. Um run
// que já existe NUNCA esconde o worker desligado nem a conta fora do piloto
// (o run fica visível em `sync.activeRun`, mas a tela é avisada do
// impedimento; com o worker desligado ele não progride — `runParado`).
const MENSAGEM_ATUALIZACAO = Object.freeze({
  CONTA_SEM_GRANT_ML: "A conta não tem conexão do Mercado Livre vinculada.",
  WORKER_DESABILITADO: "A atualização de promoções está desligada neste ambiente (PROMO_SNAPSHOT_WORKER_ENABLED).",
  PILOTO_VAZIO: "A atualização de promoções ainda não foi liberada para nenhuma conta (PROMO_SNAPSHOT_CONTAS / PROMO_SNAPSHOT_CLIENTES).",
  FORA_DO_PILOTO: "A atualização de promoções não está liberada para esta conta (fora do piloto: PROMO_SNAPSHOT_CONTAS / PROMO_SNAPSHOT_CLIENTES).",
  EM_ANDAMENTO: "Já existe uma atualização desta conta em andamento.",
  COOLDOWN: "Atualizada há pouco; aguarde para pedir outra leitura.",
});

function avaliarAtualizacaoManual({ config, identidade, estado, agoraMs }) {
  const nao = (motivo, extra = {}) => ({ disponivel: false, motivo, mensagem: MENSAGEM_ATUALIZACAO[motivo], ...extra });
  if (!identidade.sellerId) return nao("CONTA_SEM_GRANT_ML");
  const ativo = estado && estado.activeRun ? estado.activeRun.runId : null;
  if (!config.workerEnabled) return nao("WORKER_DESABILITADO", ativo ? { runParado: ativo } : {});
  const piloto = avaliarPiloto(config, identidade.clienteSlug, identidade.clienteContaId);
  if (!piloto.noPiloto) return nao(piloto.motivo, ativo ? { runId: ativo } : {});
  if (ativo) return nao("EM_ANDAMENTO", { runId: ativo });
  const c = estado && estado._conta;
  const ultima = c && c.lastAttemptAt ? new Date(c.lastAttemptAt).getTime() : NaN;
  const desde = agoraMs - ultima;
  if (config.manualCooldownMinutes > 0 && Number.isFinite(desde) && desde >= 0 && desde < config.manualCooldownMinutes * 60000 &&
      c.lastAttemptStatus && c.lastAttemptStatus !== "failed") {
    const restante = Math.max(1, Math.ceil((config.manualCooldownMinutes * 60000 - desde) / 60000));
    return nao("COOLDOWN", { cooldownRestanteMinutos: restante });
  }
  return { disponivel: true, motivo: null, mensagem: null };
}

/** Último run terminado DESTA conta + seller, no formato da tela (sem segredos). */
function ultimaTentativaPublica(run) {
  if (!run) return null;
  const inicio = run.startedAt ? new Date(run.startedAt).getTime() : NaN;
  const fim = run.finishedAt ? new Date(run.finishedAt).getTime() : NaN;
  return {
    runId: run.id,
    status: run.status,
    reason: run.reason,
    promovido: run.promovido === true,
    iniciadoEm: run.startedAt || null,
    terminadoEm: run.finishedAt || null,
    duracaoSegundos: Number.isFinite(inicio) && Number.isFinite(fim) ? Math.max(0, Math.round((fim - inicio) / 1000)) : null,
    itensTotal: run.itensTotal,
    itensProcessados: run.itensProcessados,
    itensComPromocao: run.itensComPromocao,
    promocoes: run.promocoesEncontradas,
    erros: run.erros,
    rateLimits: run.rateLimits,
    retries: run.retries,
    erroCodigo: run.errorCode || null,
    erroMotivo: run.errorCode ? motivoDaFalha(run.errorCode) : null,
    // error_message já é gravado redigido; redige de novo por defesa.
    erroMensagem: run.errorMessage ? redigirSegredos(run.errorMessage, 300) : null,
  };
}

/**
 * GET .../promocoes/status — estado da conta para a barra de atualização da
 * Central: snapshot atual, run em andamento (progresso real do banco), última
 * tentativa (resultado/motivo verdadeiros) e se o Atualizar está disponível.
 * Só lê: `autoTrigger` precisa ser pedido explicitamente (true).
 */
async function obterStatus(params = {}, deps = {}) {
  const d = defaults(deps);
  const config = resolvePromoSnapshotConfig(d.env);
  const { conta, identidade } = await resolverContaPromo(params, deps);
  const piloto = avaliarPiloto(config, identidade.clienteSlug, identidade.clienteContaId);
  const base = {
    ok: true,
    clienteContaId: conta.id,
    contaNome: conta.nome,
    sellerId: identidade.sellerId,
    worker: { habilitado: config.workerEnabled, noPiloto: piloto.noPiloto, motivo: piloto.motivo, frescorMinutos: config.freshMinutes },
  };
  if (!identidade.sellerId) {
    return {
      ...base, sync: null, motivo: "CONTA_SEM_GRANT_ML", ultimaTentativa: null,
      atualizacao: avaliarAtualizacaoManual({ config, identidade, estado: null, agoraMs: d.now().getTime() }),
    };
  }
  const { estado, gatilho } = await estadoComAutoTrigger(identidade, { autoTrigger: params.autoTrigger === true }, deps);
  const ultimo = await d.repo.findLatestFinishedRun({ clienteContaId: conta.id, marketplace: "meli", sellerId: identidade.sellerId }, d.db);
  return {
    ...base,
    sync: syncPublico(estado, gatilho),
    ultimaTentativa: ultimaTentativaPublica(ultimo),
    atualizacao: avaliarAtualizacaoManual({ config, identidade, estado, agoraMs: d.now().getTime() }),
  };
}

/** GET .../promocoes/snapshot — linhas do snapshot ATUAL, paginadas. */
async function obterSnapshot(params = {}, deps = {}) {
  const d = defaults(deps);
  const { conta, identidade } = await resolverContaPromo(params, deps);
  const { page, limit } = paginacao(params, { padrao: LIMITE_SNAPSHOT_PADRAO, max: LIMITE_SNAPSHOT_MAX });
  if (!identidade.sellerId) {
    return { ok: true, clienteContaId: conta.id, disponivel: false, motivo: "CONTA_SEM_GRANT_ML", page, limit, total: 0, hasNext: false, promocoes: [] };
  }
  const { estado, gatilho } = await estadoComAutoTrigger(identidade, { autoTrigger: params.autoTrigger === true }, deps);
  const base = { ok: true, clienteContaId: conta.id, sellerId: identidade.sellerId, sync: syncPublico(estado, gatilho), page, limit };
  if (!estado.hasSnapshot) return { ...base, disponivel: false, motivo: "SEM_SNAPSHOT_PROMOCOES", total: 0, hasNext: false, promocoes: [] };

  const texto = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());
  const { total, linhas } = await d.repo.listarLinhasSnapshot({
    clienteContaId: conta.id,
    sellerId: identidade.sellerId,
    runId: estado.snapshotRunId,
    page,
    limit,
    itemId: texto(params.itemId),
    status: texto(params.status) ? texto(params.status).toLowerCase() : null,
    tipo: texto(params.tipo) ? texto(params.tipo).toUpperCase() : null,
  }, d.db);
  return {
    ...base,
    disponivel: true,
    snapshot: {
      runId: estado.snapshotRunId, snapshotAt: estado.snapshotAt, freshUntil: estado.freshUntil, partial: estado.partial,
      itensSemLeitura: estado.itemsWithoutRead, itensHerdados: estado.itemsInherited,
    },
    total,
    hasNext: page * limit < total,
    promocoes: linhas,
  };
}

/**
 * POST .../promocoes/sync — SOMENTE enfileira leitura. Respeita cooldown por
 * conta e o dedupe (run ativo é reutilizado). Nunca aplica promoção.
 */
async function solicitarSync(params = {}, deps = {}) {
  const d = defaults(deps);
  const config = resolvePromoSnapshotConfig(d.env);
  const { conta, identidade } = await resolverContaPromo(params, deps);
  if (!identidade.sellerId) {
    throw criarErroHttp(422, "A conta não tem conexão do Mercado Livre vinculada.", "CONTA_SEM_GRANT_ML");
  }
  const estado = await service.estadoSincronizacao(
    { clienteContaId: conta.id, marketplace: "meli", sellerId: identidade.sellerId },
    { ...deps, db: d.db, repo: d.repo }
  );
  const atualizacao = avaliarAtualizacaoManual({ config, identidade, estado, agoraMs: d.now().getTime() });
  if (atualizacao.motivo === "EM_ANDAMENTO") {
    // Dedupe: o run ativo da conta é reaproveitado — nunca um segundo.
    return { ok: true, enfileirado: false, reaproveitado: true, runId: estado.activeRun.runId, clienteContaId: conta.id, sync: syncPublico(estado, { acao: "reutilizado" }), atualizacao };
  }
  if (!atualizacao.disponivel) {
    return {
      ok: true, enfileirado: false, clienteContaId: conta.id, motivo: atualizacao.motivo, mensagem: atualizacao.mensagem,
      ...(atualizacao.cooldownRestanteMinutos ? { cooldownRestanteMinutos: atualizacao.cooldownRestanteMinutos } : {}),
      sync: syncPublico(estado, atualizacao.motivo === "FORA_DO_PILOTO" || atualizacao.motivo === "PILOTO_VAZIO" ? { acao: "fora_do_piloto" } : null),
      atualizacao,
    };
  }
  const { run, reaproveitado } = await service.enqueuePromoSnapshotRun(identidade, {
    reason: "manual_sync", requestedBy: params.requestedBy ?? null,
  }, { ...deps, db: d.db, repo: d.repo });
  if (typeof deps.kick === "function") deps.kick();
  else require("./promoSnapshotRuntime").kick();
  return { ok: true, enfileirado: !reaproveitado, reaproveitado, runId: run.id, clienteContaId: conta.id };
}

module.exports = {
  resolverContaPromo,
  estadoComAutoTrigger,
  syncPublico,
  obterStatus,
  obterSnapshot,
  solicitarSync,
  paginacao,
  avaliarAtualizacaoManual,
  ultimaTentativaPublica,
  MENSAGEM_ATUALIZACAO,
};
