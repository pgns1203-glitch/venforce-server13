// server/repositories/observabilityRepository.js
// Camada de dados da observabilidade. Todo o SQL vive aqui e é sempre
// parametrizado — nenhum valor recebido pela API entra em string de query.
// Colunas de ordenação vêm de allowlist fixa, nunca do input.

"use strict";

const fs = require("fs");
const path = require("path");
const pool = require("../config/database");

const schemaPath = path.join(__dirname, "..", "sql", "observability_schema.sql");

const REQUEST_COLUMNS = `
  id, request_id, method, route, path, status_code, duration_ms, source,
  user_id, user_email, user_nome, content_type, response_size, user_agent,
  error_name, error_message, error_stack, metadata, created_at
`;

// Allowlist de ordenação: chave da API → expressão SQL fixa.
const SORT_COLUMNS = {
  created_at: "created_at",
  duration_ms: "duration_ms",
  status_code: "status_code",
  route: "route",
};

const CLIENT_REQUEST_TYPES = ["request", "network-error", "slow-request"];

async function ensureObservabilityTables(db = pool) {
  const sql = fs.readFileSync(schemaPath, "utf8");
  await db.query(sql);
}

function asJson(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

/* ============================================================
 * ESCRITA EM LOTE
 * ============================================================ */

async function insertRequests(rows, db = pool) {
  if (!Array.isArray(rows) || !rows.length) return 0;

  const cols = 18;
  const values = [];
  const placeholders = rows.map((row, index) => {
    const base = index * cols;
    values.push(
      row.requestId,
      row.method,
      row.route,
      row.path,
      row.statusCode,
      row.durationMs,
      row.source || "server",
      row.userId,
      row.userEmail,
      row.userNome,
      row.contentType,
      row.responseSize,
      row.userAgent,
      row.errorName,
      row.errorMessage,
      row.errorStack,
      asJson(row.metadata),
      row.createdAt || new Date().toISOString()
    );
    const p = [];
    for (let i = 1; i <= cols; i += 1) p.push(`$${base + i}`);
    // metadata (17º) precisa de cast explícito; created_at chega como ISO string.
    return `(${p.slice(0, 16).join(",")},${p[16]}::jsonb,${p[17]}::timestamptz)`;
  });

  await db.query(
    `INSERT INTO observability_requests
       (request_id, method, route, path, status_code, duration_ms, source,
        user_id, user_email, user_nome, content_type, response_size, user_agent,
        error_name, error_message, error_stack, metadata, created_at)
     VALUES ${placeholders.join(",")}`,
    values
  );

  return rows.length;
}

async function insertClientEvents(rows, db = pool) {
  if (!Array.isArray(rows) || !rows.length) return 0;

  const cols = 17;
  const values = [];
  const placeholders = rows.map((row, index) => {
    const base = index * cols;
    values.push(
      row.eventId,
      row.requestId,
      row.sessionId,
      row.tabId,
      row.pageLoadId,
      row.page,
      row.eventType,
      row.severity,
      row.message,
      row.stack,
      asJson(row.data),
      row.method,
      row.endpoint,
      row.statusCode,
      row.durationMs,
      row.userId,
      row.userEmail
    );
    const p = [];
    for (let i = 1; i <= cols; i += 1) p.push(`$${base + i}`);
    return `(${p.slice(0, 10).join(",")},${p[10]}::jsonb,${p.slice(11).join(",")})`;
  });

  const result = await db.query(
    `INSERT INTO observability_client_events
       (event_id, request_id, session_id, tab_id, page_load_id, page, event_type,
        severity, message, stack, data, method, endpoint, status_code, duration_ms,
        user_id, user_email)
     VALUES ${placeholders.join(",")}
     ON CONFLICT (event_id) DO NOTHING`,
    values
  );

  return result.rowCount || 0;
}

/* ============================================================
 * LEITURA — LISTA UNIFICADA (servidor + navegador)
 * ============================================================ */

const UNIFIED_CTE = `
  WITH unificado AS (
    SELECT
      'server'::text            AS source,
      r.id                      AS id,
      r.request_id              AS request_id,
      r.method                  AS method,
      COALESCE(r.route, r.path) AS route,
      r.path                    AS path,
      r.status_code             AS status_code,
      r.duration_ms             AS duration_ms,
      r.user_email              AS user_email,
      r.user_nome               AS user_nome,
      NULL::text                AS page,
      NULL::text                AS session_id,
      r.error_message           AS error_message,
      r.error_name              AS error_name,
      r.created_at              AS created_at
    FROM observability_requests r
    UNION ALL
    SELECT
      'browser'::text,
      e.id,
      e.request_id,
      COALESCE(e.method, 'GET'),
      COALESCE(e.endpoint, e.page, '-'),
      COALESCE(e.endpoint, '-'),
      e.status_code,
      e.duration_ms,
      e.user_email,
      NULL::text,
      e.page,
      e.session_id,
      e.message,
      e.event_type,
      e.created_at
    FROM observability_client_events e
    WHERE e.event_type = ANY($1::text[])
  )
`;

function buildRequestFilters(filters, startIndex) {
  const where = [];
  const values = [];
  let i = startIndex;

  if (filters.since) {
    where.push(`created_at >= $${i++}`);
    values.push(filters.since);
  }
  if (filters.until) {
    where.push(`created_at <= $${i++}`);
    values.push(filters.until);
  }
  if (filters.method) {
    where.push(`method = $${i++}`);
    values.push(filters.method);
  }
  if (filters.source) {
    where.push(`source = $${i++}`);
    values.push(filters.source);
  }
  if (filters.route) {
    where.push(`route ILIKE $${i++}`);
    values.push(`%${filters.route}%`);
  }
  if (filters.screen) {
    where.push(`page = $${i++}`);
    values.push(filters.screen);
  }
  if (filters.user) {
    where.push(`user_email ILIKE $${i++}`);
    values.push(`%${filters.user}%`);
  }
  if (filters.requestId) {
    where.push(`request_id = $${i++}`);
    values.push(filters.requestId);
  }
  if (filters.sessionId) {
    where.push(`session_id = $${i++}`);
    values.push(filters.sessionId);
  }
  if (filters.statusExact !== undefined && filters.statusExact !== null) {
    where.push(`status_code = $${i++}`);
    values.push(filters.statusExact);
  }
  if (filters.statusClass === "success") {
    where.push(`status_code BETWEEN 200 AND 399`);
  } else if (filters.statusClass === "4xx") {
    where.push(`status_code BETWEEN 400 AND 499`);
  } else if (filters.statusClass === "5xx") {
    where.push(`status_code >= 500`);
  } else if (filters.statusClass === "network") {
    where.push(`(status_code IS NULL OR status_code = 0)`);
  }
  if (filters.onlyErrors) {
    where.push(`(status_code >= 400 OR status_code IS NULL OR status_code = 0 OR error_message IS NOT NULL)`);
  }
  if (filters.onlySlow) {
    where.push(`duration_ms >= $${i++}`);
    values.push(filters.slowMs);
  }
  if (filters.search) {
    where.push(`(route ILIKE $${i} OR path ILIKE $${i} OR request_id ILIKE $${i}
                 OR COALESCE(error_message,'') ILIKE $${i} OR COALESCE(user_email,'') ILIKE $${i}
                 OR COALESCE(page,'') ILIKE $${i})`);
    values.push(`%${filters.search}%`);
    i += 1;
  }

  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", values, nextIndex: i };
}

async function listRequests(filters, db = pool) {
  const sortColumn = SORT_COLUMNS[filters.sortBy] || SORT_COLUMNS.created_at;
  const sortDir = String(filters.sortDir).toLowerCase() === "asc" ? "ASC" : "DESC";

  const built = buildRequestFilters(filters, 2);
  const limitIndex = built.nextIndex;
  const offsetIndex = built.nextIndex + 1;

  const rows = await db.query(
    `${UNIFIED_CTE}
     SELECT source, id, request_id, method, route, path, status_code, duration_ms,
            user_email, user_nome, page, session_id, error_message, error_name, created_at
       FROM unificado
       ${built.clause}
      ORDER BY ${sortColumn} ${sortDir} NULLS LAST, id DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    [CLIENT_REQUEST_TYPES, ...built.values, filters.limit, filters.offset]
  );

  const total = await db.query(
    `${UNIFIED_CTE} SELECT COUNT(*)::int AS total FROM unificado ${built.clause}`,
    [CLIENT_REQUEST_TYPES, ...built.values]
  );

  return { rows: rows.rows, total: total.rows[0]?.total || 0 };
}

async function getRequestDetail(requestId, db = pool) {
  const server = await db.query(
    `SELECT ${REQUEST_COLUMNS} FROM observability_requests
      WHERE request_id = $1 ORDER BY created_at DESC LIMIT 5`,
    [requestId]
  );

  const client = await db.query(
    `SELECT id, event_id, request_id, session_id, tab_id, page_load_id, page,
            event_type, severity, message, stack, data, method, endpoint,
            status_code, duration_ms, user_email, created_at
       FROM observability_client_events
      WHERE request_id = $1
      ORDER BY created_at ASC
      LIMIT 200`,
    [requestId]
  );

  return { server: server.rows, client: client.rows };
}

/* ============================================================
 * LEITURA — AGREGAÇÕES
 * ============================================================ */

async function getSummary({ since, slowMs }, db = pool) {
  const servidor = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status_code BETWEEN 200 AND 399)::int AS sucesso,
       COUNT(*) FILTER (WHERE status_code BETWEEN 400 AND 499)::int AS erros_4xx,
       COUNT(*) FILTER (WHERE status_code >= 500)::int AS erros_5xx,
       COUNT(*) FILTER (WHERE duration_ms >= $2)::int AS lentas,
       COALESCE(ROUND(AVG(duration_ms)), 0)::int AS duracao_media,
       COALESCE(percentile_disc(0.50) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p50,
       COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p95,
       COALESCE(percentile_disc(0.99) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p99,
       MIN(created_at) AS primeiro,
       MAX(created_at) AS ultimo
     FROM observability_requests
     WHERE created_at >= $1`,
    [since, slowMs]
  );

  const navegador = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE event_type = 'network-error')::int AS falhas_rede,
       COUNT(*) FILTER (WHERE severity = 'error')::int AS erros,
       COUNT(*) FILTER (WHERE event_type = 'js-error')::int AS erros_js,
       COUNT(*) FILTER (WHERE event_type = 'unhandled-rejection')::int AS rejeicoes,
       COUNT(DISTINCT session_id)::int AS sessoes
     FROM observability_client_events
     WHERE created_at >= $1`,
    [since]
  );

  const rotaComMaisErros = await db.query(
    `SELECT COALESCE(route, path) AS rota, COUNT(*)::int AS total
       FROM observability_requests
      WHERE created_at >= $1 AND (status_code >= 400 OR error_name IS NOT NULL)
      GROUP BY 1 ORDER BY total DESC, rota ASC LIMIT 1`,
    [since]
  );

  const rotaMaisLenta = await db.query(
    `SELECT COALESCE(route, path) AS rota,
            COALESCE(ROUND(AVG(duration_ms)), 0)::int AS media,
            COUNT(*)::int AS total
       FROM observability_requests
      WHERE created_at >= $1 AND duration_ms IS NOT NULL
      GROUP BY 1 HAVING COUNT(*) >= 1
      ORDER BY media DESC, rota ASC LIMIT 1`,
    [since]
  );

  const ultimoErro = await db.query(
    `SELECT request_id, method, COALESCE(route, path) AS rota, status_code,
            error_name, error_message, created_at
       FROM observability_requests
      WHERE created_at >= $1 AND (status_code >= 400 OR error_name IS NOT NULL)
      ORDER BY created_at DESC LIMIT 1`,
    [since]
  );

  const porMinuto = await db.query(
    `SELECT date_trunc('minute', created_at) AS minuto,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status_code >= 400)::int AS erros
       FROM observability_requests
      WHERE created_at >= $1
      GROUP BY 1 ORDER BY 1 ASC LIMIT 720`,
    [since]
  );

  const porStatus = await db.query(
    `SELECT COALESCE((status_code / 100) * 100, 0) AS faixa, COUNT(*)::int AS total
       FROM observability_requests
      WHERE created_at >= $1
      GROUP BY 1 ORDER BY 1 ASC`,
    [since]
  );

  return {
    servidor: servidor.rows[0] || {},
    navegador: navegador.rows[0] || {},
    rotaComMaisErros: rotaComMaisErros.rows[0] || null,
    rotaMaisLenta: rotaMaisLenta.rows[0] || null,
    ultimoErro: ultimoErro.rows[0] || null,
    porMinuto: porMinuto.rows,
    porStatus: porStatus.rows,
  };
}

async function getErrorGroups({ since, limit }, db = pool) {
  const servidor = await db.query(
    `SELECT
       COALESCE(error_name, 'HTTP ' || COALESCE(status_code::text, '?')) AS tipo,
       COALESCE(error_message, 'HTTP ' || COALESCE(status_code::text, '?')) AS mensagem,
       COALESCE(route, path) AS rota,
       method,
       MAX(status_code) AS status_code,
       COUNT(*)::int AS total,
       COUNT(DISTINCT user_email)::int AS usuarios,
       MIN(created_at) AS primeira,
       MAX(created_at) AS ultima,
       (ARRAY_AGG(request_id ORDER BY created_at DESC))[1] AS ultimo_request_id,
       (ARRAY_AGG(error_stack ORDER BY created_at DESC))[1] AS stack
     FROM observability_requests
     WHERE created_at >= $1 AND (status_code >= 400 OR error_name IS NOT NULL)
     GROUP BY 1, 2, 3, 4
     ORDER BY total DESC, ultima DESC
     LIMIT $2`,
    [since, limit]
  );

  const navegador = await db.query(
    `SELECT
       event_type AS tipo,
       COALESCE(message, event_type) AS mensagem,
       COALESCE(endpoint, page, '-') AS rota,
       COALESCE(method, '-') AS method,
       MAX(status_code) AS status_code,
       COUNT(*)::int AS total,
       COUNT(DISTINCT session_id)::int AS usuarios,
       MIN(created_at) AS primeira,
       MAX(created_at) AS ultima,
       (ARRAY_AGG(request_id ORDER BY created_at DESC))[1] AS ultimo_request_id,
       (ARRAY_AGG(stack ORDER BY created_at DESC))[1] AS stack
     FROM observability_client_events
     WHERE created_at >= $1 AND severity = 'error'
     GROUP BY 1, 2, 3, 4
     ORDER BY total DESC, ultima DESC
     LIMIT $2`,
    [since, limit]
  );

  return { servidor: servidor.rows, navegador: navegador.rows };
}

async function getRouteStats({ since, slowMs }, db = pool) {
  const result = await db.query(
    `SELECT COALESCE(route, path) AS rota,
            method,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status_code >= 400)::int AS erros,
            COUNT(*) FILTER (WHERE duration_ms >= $2)::int AS lentas,
            COALESCE(ROUND(AVG(duration_ms)), 0)::int AS media,
            COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p95,
            MAX(created_at) AS ultima
       FROM observability_requests
      WHERE created_at >= $1
      GROUP BY 1, 2
      ORDER BY total DESC
      LIMIT 500`,
    [since, slowMs]
  );
  return result.rows;
}

async function getSessions({ since, limit }, db = pool) {
  const result = await db.query(
    `SELECT session_id,
            COUNT(*)::int AS eventos,
            COUNT(DISTINCT tab_id)::int AS abas,
            COUNT(DISTINCT page)::int AS paginas,
            COUNT(*) FILTER (WHERE severity = 'error')::int AS erros,
            MIN(created_at) AS inicio,
            MAX(created_at) AS fim,
            (ARRAY_AGG(user_email ORDER BY created_at DESC))[1] AS user_email,
            (ARRAY_AGG(page ORDER BY created_at DESC))[1] AS ultima_pagina
       FROM observability_client_events
      WHERE created_at >= $1 AND session_id IS NOT NULL
      GROUP BY session_id
      ORDER BY fim DESC
      LIMIT $2`,
    [since, limit]
  );
  return result.rows;
}

/* ============================================================
 * EXPORT
 * ============================================================ */

async function exportRequests(filters, db = pool) {
  const built = buildRequestFilters(filters, 2);
  const result = await db.query(
    `${UNIFIED_CTE}
     SELECT source, request_id, method, route, path, status_code, duration_ms,
            user_email, page, error_message, created_at
       FROM unificado
       ${built.clause}
      ORDER BY created_at DESC
      LIMIT $${built.nextIndex}`,
    [CLIENT_REQUEST_TYPES, ...built.values, filters.limit]
  );
  return result.rows;
}

/* ============================================================
 * RETENÇÃO E LIMPEZA
 * ============================================================ */

async function cleanup({ retentionDays, maxRows }, db = pool) {
  const removed = { requests: 0, clientEvents: 0 };

  const porIdade = await db.query(
    `DELETE FROM observability_requests
      WHERE created_at < NOW() - ($1 || ' days')::interval`,
    [String(retentionDays)]
  );
  removed.requests += porIdade.rowCount || 0;

  const porIdadeEventos = await db.query(
    `DELETE FROM observability_client_events
      WHERE created_at < NOW() - ($1 || ' days')::interval`,
    [String(retentionDays)]
  );
  removed.clientEvents += porIdadeEventos.rowCount || 0;

  const porVolume = await db.query(
    `DELETE FROM observability_requests
      WHERE id < COALESCE(
        (SELECT MIN(id) FROM (SELECT id FROM observability_requests ORDER BY id DESC LIMIT $1) recentes),
        0)`,
    [maxRows]
  );
  removed.requests += porVolume.rowCount || 0;

  const porVolumeEventos = await db.query(
    `DELETE FROM observability_client_events
      WHERE id < COALESCE(
        (SELECT MIN(id) FROM (SELECT id FROM observability_client_events ORDER BY id DESC LIMIT $1) recentes),
        0)`,
    [maxRows]
  );
  removed.clientEvents += porVolumeEventos.rowCount || 0;

  return removed;
}

async function purge({ before }, db = pool) {
  const requests = await db.query(
    `DELETE FROM observability_requests WHERE created_at <= $1`,
    [before]
  );
  const events = await db.query(
    `DELETE FROM observability_client_events WHERE created_at <= $1`,
    [before]
  );
  return { requests: requests.rowCount || 0, clientEvents: events.rowCount || 0 };
}

async function getStorageStats(db = pool) {
  const result = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM observability_requests) AS requests,
       (SELECT COUNT(*)::int FROM observability_client_events) AS client_events,
       (SELECT MIN(created_at) FROM observability_requests) AS request_mais_antiga,
       (SELECT MIN(created_at) FROM observability_client_events) AS evento_mais_antigo`
  );
  return result.rows[0] || { requests: 0, client_events: 0 };
}

async function ping(db = pool) {
  const started = process.hrtime.bigint();
  await db.query("SELECT 1");
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  return Math.round(elapsed * 100) / 100;
}

module.exports = {
  SORT_COLUMNS,
  CLIENT_REQUEST_TYPES,
  ensureObservabilityTables,
  insertRequests,
  insertClientEvents,
  listRequests,
  getRequestDetail,
  getSummary,
  getErrorGroups,
  getRouteStats,
  getSessions,
  exportRequests,
  cleanup,
  purge,
  getStorageStats,
  ping,
  buildRequestFilters,
};
