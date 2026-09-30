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
const { resolvePromoSnapshotConfig } = require("./promoSnapshotConfig");
const { criarErroHttp } = require("../motorMargem/marginSnapshotApiService");

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

/** GET .../promocoes/status */
async function obterStatus(params = {}, deps = {}) {
  const { conta, identidade } = await resolverContaPromo(params, deps);
  if (!identidade.sellerId) {
    return { ok: true, clienteContaId: conta.id, sellerId: null, sync: null, motivo: "CONTA_SEM_GRANT_ML" };
  }
  const { estado, gatilho } = await estadoComAutoTrigger(identidade, { autoTrigger: params.autoTrigger !== false }, deps);
  return { ok: true, clienteContaId: conta.id, sellerId: identidade.sellerId, sync: syncPublico(estado, gatilho) };
}

/** GET .../promocoes/snapshot — linhas do snapshot ATUAL, paginadas. */
async function obterSnapshot(params = {}, deps = {}) {
  const d = defaults(deps);
  const { conta, identidade } = await resolverContaPromo(params, deps);
  const { page, limit } = paginacao(params, { padrao: LIMITE_SNAPSHOT_PADRAO, max: LIMITE_SNAPSHOT_MAX });
  if (!identidade.sellerId) {
    return { ok: true, clienteContaId: conta.id, disponivel: false, motivo: "CONTA_SEM_GRANT_ML", page, limit, total: 0, hasNext: false, promocoes: [] };
  }
  const { estado, gatilho } = await estadoComAutoTrigger(identidade, {}, deps);
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
  if (estado.activeRun) {
    return { ok: true, enfileirado: false, reaproveitado: true, runId: estado.activeRun.runId, sync: syncPublico(estado, { acao: "reutilizado" }) };
  }
  if (!config.workerEnabled) {
    return { ok: true, enfileirado: false, motivo: "WORKER_DESABILITADO", mensagem: "A sincronização de promoções não está ligada neste ambiente (PROMO_SNAPSHOT_WORKER_ENABLED).", sync: syncPublico(estado, null) };
  }
  const c = estado._conta;
  const ultima = c && c.lastAttemptAt ? new Date(c.lastAttemptAt).getTime() : NaN;
  const desde = d.now().getTime() - ultima;
  if (config.manualCooldownMinutes > 0 && Number.isFinite(desde) && desde >= 0 && desde < config.manualCooldownMinutes * 60000 &&
      c.lastAttemptStatus && c.lastAttemptStatus !== "failed") {
    const restante = Math.max(1, Math.ceil((config.manualCooldownMinutes * 60000 - desde) / 60000));
    return { ok: true, enfileirado: false, motivo: "COOLDOWN", cooldownRestanteMinutos: restante, sync: syncPublico(estado, null) };
  }
  const { run, reaproveitado } = await service.enqueuePromoSnapshotRun(identidade, {
    reason: "manual_sync", requestedBy: params.requestedBy ?? null,
  }, { ...deps, db: d.db, repo: d.repo });
  if (typeof deps.kick === "function") deps.kick();
  else require("./promoSnapshotRuntime").kick();
  return { ok: true, enfileirado: !reaproveitado, reaproveitado, runId: run.id };
}

module.exports = {
  resolverContaPromo,
  estadoComAutoTrigger,
  syncPublico,
  obterStatus,
  obterSnapshot,
  solicitarSync,
  paginacao,
};
