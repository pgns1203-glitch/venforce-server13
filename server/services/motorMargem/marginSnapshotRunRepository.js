// server/services/motorMargem/marginSnapshotRunRepository.js
// Margin Snapshot — repository de margin_snapshot_runs (M1 da fundação, ver
// docs/AUDITORIA_WORKERS_E_PLANO_MARGIN_SNAPSHOT.md).
//
// M1 foi só persistência/fundação: createRun fazia um INSERT simples; o
// índice único parcial (uq_margin_snapshot_runs_ativo) é quem impede dois
// runs ativos equivalentes, devolvendo erro Postgres 23505 em caso de
// corrida. M2 adiciona aqui SOMENTE claimNextQueuedRun/touchHeartbeat — o
// claim atômico multi-instance (§16/§23 de
// docs/AUDITORIA_WORKERS_E_PLANO_MARGIN_SNAPSHOT.md) e o heartbeat
// explícito. Dedupe/enqueue idempotente vive em
// marginSnapshotRunService.js (M2), não aqui.

const pool = require("../../config/database");

async function ensureTables(db = pool) {
  const repository = require("./marginSnapshotRepository");
  await repository.ensureMarginSnapshotTables(db);
}

// Transições válidas — mesma disciplina de central_vendas_sync_runs: nunca
// terminal -> terminal, nunca pula estado. queued -> running -> (completed |
// failed). PARTIAL/CANCELLED não existem nesta máquina de estados (D5/§9.1
// do plano) — sucesso parcial é sinalizado por failed_items > 0 num run
// completed, não por um status novo.
const TRANSICOES = {
  running: "queued",
  completed: "running",
  failed: "running",
};

function sanitizeRun(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    clienteId: Number(row.cliente_id),
    clienteSlug: row.cliente_slug,
    clienteContaId: Number(row.cliente_conta_id),
    marketplace: row.marketplace,
    baseId: row.base_id != null ? Number(row.base_id) : null,
    reason: row.reason,
    status: row.status,
    totalItems: row.total_items != null ? Number(row.total_items) : null,
    processedItems: Number(row.processed_items),
    successItems: Number(row.success_items),
    failedItems: Number(row.failed_items),
    cursorOffset: Number(row.cursor_offset),
    requestedBy: row.requested_by != null ? Number(row.requested_by) : null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    heartbeatAt: row.heartbeat_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    metadata: row.metadata_json || {},
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Criação
// ---------------------------------------------------------------------------

async function createRun({
  clienteId, clienteSlug, clienteContaId, marketplace = "meli", baseId = null,
  reason, requestedBy = null, db = pool,
}) {
  if (!clienteId) throw new Error("createRun: clienteId é obrigatório.");
  if (!clienteContaId) throw new Error("createRun: clienteContaId é obrigatório (ver decisão em margin_snapshot_schema.sql).");
  if (!reason) throw new Error("createRun: reason é obrigatório.");

  await ensureTables(db);

  const result = await db.query(
    `INSERT INTO margin_snapshot_runs
      (cliente_id, cliente_slug, cliente_conta_id, marketplace, base_id, reason, status, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,'queued',$7)
     RETURNING *`,
    [clienteId, clienteSlug, clienteContaId, marketplace, baseId, reason, requestedBy]
  );
  return sanitizeRun(result.rows[0]);
}

// ---------------------------------------------------------------------------
// Leitura — sempre escopada por conta (nunca vaza run de outra conta do
// mesmo cliente, nem de outro cliente).
// ---------------------------------------------------------------------------

async function getRunById({ runId, clienteContaId, db = pool }) {
  if (!runId) throw new Error("getRunById: runId é obrigatório.");
  if (!clienteContaId) throw new Error("getRunById: clienteContaId é obrigatório (leitura sempre account-scoped).");

  const result = await db.query(
    `SELECT * FROM margin_snapshot_runs WHERE id = $1 AND cliente_conta_id = $2 LIMIT 1`,
    [runId, clienteContaId]
  );
  return result.rows[0] ? sanitizeRun(result.rows[0]) : null;
}

async function findActiveRunForAccount({ clienteId, clienteContaId, marketplace = "meli", db = pool }) {
  if (!clienteId) throw new Error("findActiveRunForAccount: clienteId é obrigatório.");
  if (!clienteContaId) throw new Error("findActiveRunForAccount: clienteContaId é obrigatório.");

  const result = await db.query(
    `SELECT * FROM margin_snapshot_runs
      WHERE cliente_id = $1 AND cliente_conta_id = $2 AND marketplace = $3
        AND status IN ('queued','running')
      ORDER BY id DESC
      LIMIT 1`,
    [clienteId, clienteContaId, marketplace]
  );
  return result.rows[0] ? sanitizeRun(result.rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Transições de estado — guarda estrita (WHERE status = <estado de origem
// esperado>), nunca "status <> X" (mesmo bug já corrigido em
// centralVendasSyncRunService: essa negação deixaria passar failed->
// completed e completed->failed).
// ---------------------------------------------------------------------------

async function updateRunStatus({ runId, status, errorCode = null, errorMessage = null, db = pool }) {
  const fromStatus = TRANSICOES[status];
  if (!fromStatus) {
    throw new Error(`updateRunStatus: transição para status "${status}" não é suportada por esta fundação (M1).`);
  }

  if (status === "running") {
    const result = await db.query(
      `UPDATE margin_snapshot_runs
          SET status = 'running', started_at = NOW(), heartbeat_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'queued'
        RETURNING *`,
      [runId]
    );
    return result.rows[0] ? sanitizeRun(result.rows[0]) : null;
  }

  // completed | failed
  const result = await db.query(
    `UPDATE margin_snapshot_runs
        SET status = $2, finished_at = NOW(), updated_at = NOW(),
            error_code = $3, error_message = $4
      WHERE id = $1 AND status = 'running'
      RETURNING *`,
    [runId, status, errorCode, errorMessage ? String(errorMessage).slice(0, 2000) : null]
  );
  return result.rows[0] ? sanitizeRun(result.rows[0]) : null;
}

// Progresso só faz sentido num run em andamento — guarda WHERE status =
// 'running' evita gravar progresso num run já finalizado ou ainda não
// iniciado. Atualiza heartbeat_at a cada chamada (base para o teto de
// staleness de recovery, que é trabalho de M2 — aqui só a coluna existe).
async function updateRunProgress({
  runId, processedItems, successItems, failedItems, cursorOffset, totalItems = undefined, db = pool,
}) {
  const result = await db.query(
    `UPDATE margin_snapshot_runs
        SET processed_items = $2, success_items = $3, failed_items = $4, cursor_offset = $5,
            total_items = COALESCE($6, total_items),
            heartbeat_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'running'
      RETURNING *`,
    [runId, processedItems, successItems, failedItems, cursorOffset, totalItems ?? null]
  );
  return result.rows[0] ? sanitizeRun(result.rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Claim atômico (M2, §8/§16/§23 do plano) — um worker (nesta instância ou em
// outra) pega o run QUEUED mais antigo sem que outro worker concorrente
// pegue o mesmo. Postgres não permite ORDER BY/LIMIT direto num UPDATE;
// por isso o candidato é escolhido numa subquery com FOR UPDATE SKIP
// LOCKED (trava a linha candidata, pula linhas já travadas por outra
// transação) e o UPDATE externo transiciona queued -> running na mesma
// instrução. Isto é uma única instrução SQL: o lock de linha do Postgres já
// serializa duas chamadas concorrentes na mesma linha — a segunda nunca
// vê o candidato que a primeira já reivindicou (§16: "não é necessário
// nenhum mecanismo novo de lock" além disto).
//
// M3 — `excludeContaIds`: contas que ESTE processo já está processando. O
// índice único já impede 2 runs ativos da mesma conta, mas um run declarado
// stale por heartbeat (M8) pode ter sido substituído enquanto o processo
// original ainda executa; excluir as contas locais garante que um mesmo
// processo nunca rode lotes de uma conta em paralelo. Array vazio = sem
// exclusão (`<> ALL('{}')` é sempre verdadeiro).
async function claimNextQueuedRun({ db = pool, excludeContaIds = [] } = {}) {
  const excluir = (Array.isArray(excludeContaIds) ? excludeContaIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
  const result = await db.query(
    `UPDATE margin_snapshot_runs
        SET status = 'running', started_at = NOW(), heartbeat_at = NOW(), updated_at = NOW()
      WHERE id = (
        SELECT id FROM margin_snapshot_runs
         WHERE status = 'queued'
           AND cliente_conta_id <> ALL($1::bigint[])
         ORDER BY created_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
        AND status = 'queued'
      RETURNING *`,
    [excluir]
  );
  return result.rows[0] ? sanitizeRun(result.rows[0]) : null;
}

// M3 — metadado de observabilidade do run (contadores de retry/429, lotes
// falhos, duração). Merge raso (`||`) só enquanto running. Nunca aceita campo
// sensível (mesma guarda de centralVendasSyncRunService.assertNoSecrets).
const CAMPOS_SENSIVEIS = new Set([
  "access_token", "refresh_token", "api_key", "apikey", "password",
  "authorization", "token", "secret", "client_secret",
]);

function assertNoSecrets(obj, caminho = "metadata_json") {
  if (!obj || typeof obj !== "object") return;
  for (const [key, value] of Object.entries(obj)) {
    if (CAMPOS_SENSIVEIS.has(String(key).toLowerCase())) {
      throw new Error(`Tentativa de persistir campo sensivel "${key}" em ${caminho}.`);
    }
    if (value && typeof value === "object") assertNoSecrets(value, `${caminho}.${key}`);
  }
}

async function mergeRunMetadata({ runId, patch, db = pool }) {
  if (!runId) throw new Error("mergeRunMetadata: runId é obrigatório.");
  assertNoSecrets(patch);
  const result = await db.query(
    `UPDATE margin_snapshot_runs
        SET metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
      WHERE id = $1 AND status = 'running'
      RETURNING *`,
    [runId, JSON.stringify(patch || {})]
  );
  return result.rows[0] ? sanitizeRun(result.rows[0]) : null;
}

// Heartbeat explícito (§17 do plano) — só a coluna/função; recovery
// automático de run abandonado por staleness é M8 (não implementado aqui).
async function touchHeartbeat(runId, db = pool) {
  const result = await db.query(
    `UPDATE margin_snapshot_runs
        SET heartbeat_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'running'
      RETURNING *`,
    [runId]
  );
  return result.rows[0] ? sanitizeRun(result.rows[0]) : null;
}

module.exports = {
  ensureTables,
  createRun,
  getRunById,
  findActiveRunForAccount,
  updateRunStatus,
  updateRunProgress,
  claimNextQueuedRun,
  touchHeartbeat,
  mergeRunMetadata,
  assertNoSecrets,
  sanitizeRun,
  TRANSICOES,
};
