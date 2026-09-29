// server/services/motorMargem/marginSnapshotTriggers.js
// Margin Snapshot — gatilhos automáticos de refresh (M4).
//
// Estes gatilhos SÓ enfileiram: nenhum cálculo de margem acontece aqui nem
// no fluxo que os chama (Central de Vendas, Bases). O run persistido é
// processado depois, em background, pelo Margin Snapshot Worker.
//
// Opt-in explícito, default desligado:
//   - após sync da Central de Vendas → MARGIN_SNAPSHOT_WORKER_ENABLED=true
//   - mudança de Base               → MARGIN_SNAPSHOT_WORKER_ENABLED=true
//                                      E MARGIN_SNAPSHOT_BASE_TRIGGER_ENABLED=true
// Sem worker habilitado não se enfileira nada automaticamente (evita
// acumular runs queued que ninguém processa). O refresh MANUAL (API) não
// depende destas flags.

const pool = require("../../config/database");
const { resolveMarginSnapshotConfig, flagLigada } = require("./marginSnapshotConfig");

const LOG = "[marginSnapshot]";

function defaults(deps = {}) {
  return {
    db: deps.db || pool,
    env: deps.env || process.env,
    logger: deps.logger || console,
    enqueue: deps.enqueue || require("./marginSnapshotRunService").enqueueMarginSnapshotRun,
    kick: deps.kick || require("./marginSnapshotRuntime").kick,
    ultimoCompleto: deps.ultimoCompleto || require("./marginSnapshotRunRepository").findLatestCompletedRunForAccount,
    now: deps.now || (() => new Date()),
  };
}

// ---------------------------------------------------------------------------
// A. Após um sync da Central de Vendas concluído
// ---------------------------------------------------------------------------
//
// Chamado por centralVendasSyncWorker.executarSyncRun DEPOIS de o run estar
// completed e da tentativa de publicação, em try/catch próprio. O snapshot é
// projeção pura (não depende das vendas), então o sync funciona aqui como a
// cadência natural de refresh da conta — nunca como cálculo. O REALIZADO não
// precisa deste gatilho: ele é lido da Central de Vendas na hora da leitura.
//
// Cooldown (syncTriggerCooldownMinutes): um refresh COMPLETADO recente da
// conta dispensa outra varredura do catálogo. Só runs completed contam — um
// run que falhou nunca bloqueia a próxima tentativa.
async function enfileirarAposSyncCentralVendas({ run } = {}, deps = {}) {
  const { db, env, enqueue, kick, ultimoCompleto, now } = defaults(deps);
  const config = resolveMarginSnapshotConfig(env);
  if (!config.workerEnabled) {
    return { enfileirado: false, motivo: "WORKER_DESABILITADO" };
  }
  const marketplace = String(run?.marketplace || "").trim().toLowerCase();
  if (marketplace !== "meli") return { enfileirado: false, motivo: "MARKETPLACE_NAO_SUPORTADO" };

  const clienteContaId = run?.clienteContaId ?? run?.cliente_conta_id ?? null;
  const clienteId = run?.clienteId ?? run?.cliente_id ?? null;
  // Snapshot exige conta explícita (chave canônica). Run legado sem conta
  // (cliente 100% legado) não tem snapshot — não enfileira.
  if (!clienteContaId || !clienteId) return { enfileirado: false, motivo: "SEM_CONTA" };

  if (config.syncTriggerCooldownMinutes > 0) {
    const ultimo = await ultimoCompleto({ clienteId, clienteContaId, marketplace: "meli", db });
    const fim = ultimo && ultimo.finishedAt ? new Date(ultimo.finishedAt).getTime() : NaN;
    const agora = now().getTime();
    if (Number.isFinite(fim) && agora - fim >= 0 && agora - fim < config.syncTriggerCooldownMinutes * 60000) {
      return {
        enfileirado: false,
        motivo: "REFRESH_RECENTE",
        ultimoRunId: ultimo.id,
        ultimoRunConcluidoEm: new Date(fim).toISOString(),
        cooldownMinutos: config.syncTriggerCooldownMinutes,
      };
    }
  }

  const { run: marginRun, reaproveitado } = await enqueue({
    clienteId,
    clienteSlug: run.clienteSlug ?? run.cliente_slug ?? null,
    clienteContaId,
    marketplace: "meli",
    reason: "central_vendas_sync_completed",
    db,
  });
  kick();
  return { enfileirado: true, runId: marginRun.id, reaproveitado };
}

// ---------------------------------------------------------------------------
// D. Mudança de Base (custo/imposto/taxa fixa, vínculo)
// ---------------------------------------------------------------------------
//
// Contas afetadas = as contas cuja resolução de Base NO MOTOR pode cair nesta
// base (contextoPrecificacaoService.resolverContextoPrecificacao): vínculo
// ativo explícito da conta (cliente_conta_id = conta) OU vínculo legado
// client-level (cliente_conta_id NULL), que vale para as contas MELI ativas
// do cliente. Nunca uma conta de outro cliente, nunca conta inativa.
//
// `baseId` aceita id numérico ou slug (mesma resolução id-OU-slug de
// baseVinculosService.resolverBasePorIdOuSlug, usada por DELETE
// /base-vinculos/:baseId).
async function resolverContasAfetadasPorBase({ baseId }, db = pool) {
  const raw = String(baseId ?? "").trim();
  if (!raw) return [];
  const idNum = Number(raw);
  const params = Number.isInteger(idNum) && idNum > 0 ? [idNum, raw.toLowerCase()] : [0, raw.toLowerCase()];
  const result = await db.query(
    `SELECT DISTINCT c.id AS cliente_conta_id, c.cliente_id, cl.slug AS cliente_slug
       FROM base_cliente_vinculos v
       JOIN cliente_contas c
         ON c.cliente_id = v.cliente_id
        AND c.marketplace = 'meli'
        AND c.ativo = true
        AND (v.cliente_conta_id IS NULL OR v.cliente_conta_id = c.id)
       JOIN clientes cl ON cl.id = c.cliente_id
      WHERE v.base_id = (SELECT b.id FROM bases b WHERE b.id = $1 OR LOWER(b.slug) = $2 LIMIT 1)
        AND v.ativo = true
        AND v.marketplace = 'meli'
      ORDER BY c.id`,
    params
  );
  return result.rows.map((row) => ({
    clienteContaId: Number(row.cliente_conta_id),
    clienteId: Number(row.cliente_id),
    clienteSlug: row.cliente_slug,
  }));
}

function baseTriggerHabilitado(env = process.env) {
  return resolveMarginSnapshotConfig(env).workerEnabled && flagLigada(env.MARGIN_SNAPSHOT_BASE_TRIGGER_ENABLED);
}

/**
 * Enfileira refresh para as contas afetadas. `contas` pode vir resolvido
 * pelo chamador (ex.: desvincular — as contas precisam ser lidas ANTES do
 * vínculo ser desativado). Dedupe: 1 run ativo por conta (índice único +
 * enqueue idempotente); mudança durante run em execução vira 1 rerun.
 */
async function enfileirarPorMudancaDeBase({ baseId = null, contas = null, requestedBy = null } = {}, deps = {}) {
  const { db, env, logger, enqueue, kick } = defaults(deps);
  if (!baseTriggerHabilitado(env)) return { enfileirados: [], motivo: "TRIGGER_BASE_DESABILITADO" };

  const alvo = contas || (await resolverContasAfetadasPorBase({ baseId }, db));
  const enfileirados = [];
  for (const conta of alvo) {
    try {
      const { run, reaproveitado } = await enqueue({
        clienteId: conta.clienteId,
        clienteSlug: conta.clienteSlug,
        clienteContaId: conta.clienteContaId,
        marketplace: "meli",
        reason: "base_changed",
        requestedBy,
        db,
      });
      enfileirados.push({ clienteContaId: conta.clienteContaId, runId: run.id, reaproveitado });
    } catch (err) {
      // Uma conta com problema não impede o enqueue das outras.
      logger.error?.(`${LOG} base ${baseId ?? "?"}: falha ao enfileirar conta ${conta.clienteContaId}: ${String(err?.message || err).slice(0, 300)}`);
    }
  }
  if (enfileirados.length) kick();
  return { enfileirados };
}

// Fire-and-forget para controllers: a resposta HTTP da Base nunca espera nem
// falha por causa do enqueue de margem.
function dispararSemBloquear(fn, logger = console) {
  if (!baseTriggerHabilitado()) return;
  Promise.resolve()
    .then(fn)
    .catch((err) => logger.error?.(`${LOG} gatilho de Base falhou (ignorado): ${String(err?.message || err).slice(0, 300)}`));
}

module.exports = {
  enfileirarAposSyncCentralVendas,
  resolverContasAfetadasPorBase,
  enfileirarPorMudancaDeBase,
  baseTriggerHabilitado,
  dispararSemBloquear,
};
