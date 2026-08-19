// server/services/centralVendas/centralVendasSyncRunService.js
// Central de Vendas — Sync Run (M2 da fundação V3).
//
// Uma linha de central_vendas_sync_runs é uma TENTATIVA de sincronizar uma
// conta de marketplace num intervalo. Não é o snapshot nem o fechamento — é
// a execução que produziu ou tentou produzir dados.
//
// A identidade (cliente_conta_id, grant_id, base_id, external_account_id) é
// resolvida UMA ÚNICA VEZ aqui, na criação do run, via
// resolveMarketplaceAccountContext (a mesma porta de entrada do M1 — nunca
// duplicar a lógica de escolha de conta). Ela fica congelada no run: se o
// operador trocar a base oficial do cliente enquanto o run está em
// andamento, o run continua auditável com a base que ele tinha quando foi
// criado, nunca com a nova silenciosamente.
//
// metadata_json NUNCA recebe access_token/refresh_token/Authorization —
// só IDs e contadores (ver marcarRunCompleted).

const pool = require("../../config/database");
const { resolveMarketplaceAccountContext } = require("../clienteContas/clienteContaService");

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

function criarErroHttp(statusCode, mensagem, extra = {}) {
  const err = new Error(mensagem);
  err.statusCode = statusCode;
  if (extra.code) err.code = extra.code;
  if (extra.contas) err.contas = extra.contas;
  return err;
}

function normalizeSlug(slug) {
  return String(slug || "").trim().toLowerCase();
}

function isValidIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function ensureTables(db = pool) {
  const repository = require("./centralVendasRepository");
  await repository.ensureCentralVendasTables(db);
}

// Estados finais nunca voltam para running (ver seção 4 da especificação).
const ESTADOS_FINAIS = new Set(["completed", "failed"]);

function sanitizeRun(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    status: row.status,
    clienteId: row.cliente_id != null ? Number(row.cliente_id) : null,
    clienteSlug: row.cliente_slug,
    clienteContaId: row.cliente_conta_id != null ? Number(row.cliente_conta_id) : null,
    marketplace: row.marketplace,
    externalAccountId: row.external_account_id || null,
    grantId: row.grant_id != null ? Number(row.grant_id) : null,
    baseId: row.base_id != null ? Number(row.base_id) : null,
    baseResolutionMode: row.base_resolution_mode || null,
    dateFrom: row.date_from ? String(row.date_from).slice(0, 10) : null,
    dateTo: row.date_to ? String(row.date_to).slice(0, 10) : null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.status === "failed" ? { code: row.error_code || null, message: row.error_message || null } : null,
    metadata: row.metadata_json || {},
  };
}

// ---------------------------------------------------------------------------
// Criação — resolve identidade, dedupe, INSERT queued.
// ---------------------------------------------------------------------------

async function criarSyncRun({
  clienteSlug, clienteContaId = null, marketplace = "meli", dateFrom, dateTo, requestedBy = null, db = pool,
}) {
  const slug = normalizeSlug(clienteSlug);
  const marketplaceNorm = String(marketplace || "meli").trim().toLowerCase();

  if (!slug) throw criarErroHttp(400, "slug e obrigatorio.");
  if (marketplaceNorm !== "meli") {
    throw criarErroHttp(400, "Marketplace invalido para Central de Vendas nesta fase.");
  }
  if (!isValidIsoDate(dateFrom) || !isValidIsoDate(dateTo)) {
    throw criarErroHttp(400, "dateFrom e dateTo (YYYY-MM-DD) sao obrigatorios.");
  }
  const from = dateFrom <= dateTo ? dateFrom : dateTo;
  const to = dateFrom <= dateTo ? dateTo : dateFrom;

  await ensureTables(db);

  const clienteResult = await db.query(
    "SELECT id, nome, slug FROM clientes WHERE slug = $1 AND ativo = true LIMIT 1",
    [slug]
  );
  const cliente = clienteResult.rows[0];
  if (!cliente) throw criarErroHttp(404, "Cliente nao encontrado.");

  // Porta única de identidade — nunca escolhe sozinha entre 2+ contas ativas
  // (lança 409 MULTIPLE_MARKETPLACE_ACCOUNTS). requireUsableGrant:true falha
  // cedo, ANTES de criar o run, se o grant não for utilizável.
  const context = await resolveMarketplaceAccountContext({
    clienteId: cliente.id,
    marketplace: marketplaceNorm,
    clienteContaId,
    requireUsableGrant: true,
    queryable: db,
  });

  if (marketplaceNorm === "meli" && !context.mlUserId) {
    throw criarErroHttp(422, "Cliente sem Mercado Livre conectado.", { code: "GRANT_UNAVAILABLE" });
  }

  // Fast path: já existe um run queued/running idêntico? Devolve ele em vez
  // de criar outro (seção 21 — dois cliques não geram dois workers).
  const existenteAntes = await buscarRunAtivoEquivalente({
    clienteId: cliente.id,
    clienteContaId: context.conta?.id || null,
    marketplace: marketplaceNorm,
    dateFrom: from,
    dateTo: to,
    db,
  });
  if (existenteAntes) return { run: sanitizeRun(existenteAntes), context, reaproveitado: true };

  let insertResult;
  try {
    insertResult = await db.query(
      `INSERT INTO central_vendas_sync_runs
        (cliente_id, cliente_slug, cliente_conta_id, marketplace, external_account_id, grant_id,
         base_id, base_resolution_mode, date_from, date_to, status, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11)
       RETURNING *`,
      [
        cliente.id,
        cliente.slug,
        context.conta?.id || null,
        marketplaceNorm,
        context.mlUserId || null,
        context.grant?.id || null,
        context.base?.base_id || null,
        context.base?.resolvido_por || null,
        from,
        to,
        requestedBy || null,
      ]
    );
  } catch (err) {
    // Corrida real (dois requests simultâneos passaram pelo SELECT acima ao
    // mesmo tempo): o índice único parcial barrou o segundo INSERT. Em vez de
    // propagar 500, devolve o run que "ganhou" a corrida.
    if (err && err.code === "23505") {
      const existenteDepois = await buscarRunAtivoEquivalente({
        clienteId: cliente.id,
        clienteContaId: context.conta?.id || null,
        marketplace: marketplaceNorm,
        dateFrom: from,
        dateTo: to,
        db,
      });
      if (existenteDepois) return { run: sanitizeRun(existenteDepois), context, reaproveitado: true };
    }
    throw err;
  }

  return { run: sanitizeRun(insertResult.rows[0]), context, reaproveitado: false };
}

async function buscarRunAtivoEquivalente({ clienteId, clienteContaId, marketplace, dateFrom, dateTo, db = pool }) {
  const result = await db.query(
    `SELECT * FROM central_vendas_sync_runs
      WHERE cliente_id = $1
        AND cliente_conta_id IS NOT DISTINCT FROM $2
        AND marketplace = $3
        AND date_from = $4
        AND date_to = $5
        AND status IN ('queued','running')
      ORDER BY id DESC
      LIMIT 1`,
    [clienteId, clienteContaId, marketplace, dateFrom, dateTo]
  );
  return result.rows[0] || null;
}

// ---------------------------------------------------------------------------
// Leitura — sempre escopada por cliente (nunca vaza run de outro cliente).
// ---------------------------------------------------------------------------

async function obterSyncRun({ runId, clienteSlug, db = pool }) {
  const slug = normalizeSlug(clienteSlug);
  const result = await db.query(
    `SELECT r.* FROM central_vendas_sync_runs r
       JOIN clientes c ON c.id = r.cliente_id
      WHERE r.id = $1 AND c.slug = $2
      LIMIT 1`,
    [runId, slug]
  );
  if (!result.rows.length) throw criarErroHttp(404, "Sync run nao encontrado.");
  return sanitizeRun(result.rows[0]);
}

async function listarSyncRuns({ clienteSlug, clienteContaId = null, marketplace = null, status = null, limit = 20, db = pool }) {
  const slug = normalizeSlug(clienteSlug);
  const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const condicoes = ["c.slug = $1"];
  const params = [slug];

  if (clienteContaId != null) {
    params.push(Number(clienteContaId));
    condicoes.push(`r.cliente_conta_id = $${params.length}`);
  }
  if (marketplace) {
    params.push(String(marketplace).trim().toLowerCase());
    condicoes.push(`r.marketplace = $${params.length}`);
  }
  if (status) {
    params.push(String(status).trim().toLowerCase());
    condicoes.push(`r.status = $${params.length}`);
  }

  params.push(limitNum);
  const result = await db.query(
    `SELECT r.* FROM central_vendas_sync_runs r
       JOIN clientes c ON c.id = r.cliente_id
      WHERE ${condicoes.join(" AND ")}
      ORDER BY r.id DESC
      LIMIT $${params.length}`,
    params
  );
  return result.rows.map(sanitizeRun);
}

// ---------------------------------------------------------------------------
// Transições de estado — sempre em transações curtas (sem API externa).
// ---------------------------------------------------------------------------

async function marcarRunRunning(runId, db = pool) {
  const result = await db.query(
    `UPDATE central_vendas_sync_runs
        SET status = 'running', started_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'queued'
      RETURNING *`,
    [runId]
  );
  return result.rows[0] || null;
}

async function marcarRunCompleted(runId, metadata = {}, db = pool) {
  assertNoSecrets(metadata);
  const result = await db.query(
    `UPDATE central_vendas_sync_runs
        SET status = 'completed', finished_at = NOW(), updated_at = NOW(), metadata_json = $2::jsonb
      WHERE id = $1 AND status <> 'completed'
      RETURNING *`,
    [runId, JSON.stringify(metadata || {})]
  );
  return result.rows[0] || null;
}

async function marcarRunFailed(runId, { code = null, message = null } = {}, db = pool) {
  const result = await db.query(
    `UPDATE central_vendas_sync_runs
        SET status = 'failed', finished_at = NOW(), updated_at = NOW(),
            error_code = $2, error_message = $3
      WHERE id = $1 AND status <> 'failed'
      RETURNING *`,
    [runId, code, message ? String(message).slice(0, 2000) : null]
  );
  return result.rows[0] || null;
}

module.exports = {
  criarSyncRun,
  obterSyncRun,
  listarSyncRuns,
  marcarRunRunning,
  marcarRunCompleted,
  marcarRunFailed,
  sanitizeRun,
  ESTADOS_FINAIS,
};
