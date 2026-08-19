// server/services/centralVendas/centralVendasSyncSourceService.js
// Central de Vendas — Completude por Fonte (M3 da fundação V3).
//
// Uma linha de central_vendas_sync_sources é o resultado da coleta de UMA
// fonte (orders/shipments/claims/returns/base) dentro de UM sync_run. Isto é
// um eixo SEPARADO do status técnico do run (M2, central_vendas_sync_runs):
// um run pode terminar `completed` e ainda assim ter uma fonte
// `incomplete`/`failed` — ver docs/CENTRAL_VENDAS_V3_ARQUITETURA.md.
//
// `complete` NÃO é sinônimo de "dado financeiro presente". Shipments pode
// estar `complete=true` (todos os endpoints responderam) mesmo com alguns
// fretes ausentes — isso vira `missingFreightCount` em metadata, nunca
// truncamento de coleta.
//
// Collectors (centralVendasSyncService/Frete/Claims) fornecem evidências;
// este service é o ÚNICO lugar que persiste o estado da fonte — não
// espalhar SQL de status de fonte pelos collectors.
//
// metadata_json NUNCA recebe access_token/refresh_token/Authorization — só
// contadores e códigos (mesma guarda de centralVendasSyncRunService).

const pool = require("../../config/database");

const SOURCES = ["orders", "shipments", "claims", "returns", "base"];
const STATUSES = ["pending", "running", "complete", "incomplete", "failed", "not_applicable"];
const TERMINAL_STATUSES = new Set(["complete", "incomplete", "failed", "not_applicable"]);

// Fontes que entram na agregação de completude do run nesta fase. `returns`
// só participa quando uma linha dela foi de fato registrada no run (nem todo
// run tem devolução a resolver) — ver calcularCompletudeDoRun.
const REQUIRED_SOURCES_BASE = new Set(["orders", "shipments", "claims", "base"]);

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

function normalizeSource(source) {
  const value = String(source || "").trim().toLowerCase();
  if (!SOURCES.includes(value)) throw new Error(`Fonte de sync invalida: "${source}".`);
  return value;
}

function intOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function sanitizeSourceRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    syncRunId: Number(row.sync_run_id),
    source: row.source,
    status: row.status,
    complete: row.complete === null || row.complete === undefined ? null : !!row.complete,
    expectedCount: intOrNull(row.expected_count),
    receivedCount: intOrNull(row.received_count),
    pagesExpected: intOrNull(row.pages_expected),
    pagesReceived: intOrNull(row.pages_received),
    attempts: intOrNull(row.attempts) || 0,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code || null,
    httpStatus: intOrNull(row.http_status),
    errorMessage: row.error_message || null,
    metadata: row.metadata_json || {},
  };
}

// pending/ausente -> running. Idempotente: nunca reabre uma fonte que já
// chegou a um estado terminal neste run (guarda simétrica ao M2).
async function iniciarFonte({ runId, source, db = pool }) {
  const src = normalizeSource(source);
  const result = await db.query(
    `INSERT INTO central_vendas_sync_sources (sync_run_id, source, status, attempts, started_at, updated_at)
     VALUES ($1, $2, 'running', 1, NOW(), NOW())
     ON CONFLICT (sync_run_id, source) DO UPDATE
        SET status = 'running',
            attempts = central_vendas_sync_sources.attempts + 1,
            started_at = COALESCE(central_vendas_sync_sources.started_at, NOW()),
            updated_at = NOW()
      WHERE central_vendas_sync_sources.status NOT IN ('complete','incomplete','failed','not_applicable')
     RETURNING *`,
    [runId, src]
  );
  return sanitizeSourceRow(result.rows[0] || null);
}

async function marcarFonteTerminal({
  runId, source, status, complete,
  expectedCount = null, receivedCount = null, pagesExpected = null, pagesReceived = null,
  errorCode = null, httpStatus = null, errorMessage = null, metadata = {}, db = pool,
}) {
  assertNoSecrets(metadata);
  const src = normalizeSource(source);
  const result = await db.query(
    `UPDATE central_vendas_sync_sources
        SET status = $3, complete = $4, expected_count = $5, received_count = $6,
            pages_expected = $7, pages_received = $8, error_code = $9, http_status = $10,
            error_message = $11, metadata_json = $12::jsonb, finished_at = NOW(), updated_at = NOW()
      WHERE sync_run_id = $1 AND source = $2
        AND status NOT IN ('complete','incomplete','failed','not_applicable')
      RETURNING *`,
    [
      runId, src, status, complete,
      intOrNull(expectedCount), intOrNull(receivedCount), intOrNull(pagesExpected), intOrNull(pagesReceived),
      errorCode || null, intOrNull(httpStatus), errorMessage ? String(errorMessage).slice(0, 2000) : null,
      JSON.stringify(metadata || {}),
    ]
  );
  return sanitizeSourceRow(result.rows[0] || null);
}

async function marcarFonteCompleta({ runId, source, expectedCount, receivedCount, pagesExpected, pagesReceived, metadata, db = pool }) {
  return marcarFonteTerminal({
    runId, source, status: "complete", complete: true,
    expectedCount, receivedCount, pagesExpected, pagesReceived, metadata, db,
  });
}

async function marcarFonteIncompleta({
  runId, source, expectedCount, receivedCount, pagesExpected, pagesReceived,
  errorCode, httpStatus, errorMessage, metadata, db = pool,
}) {
  return marcarFonteTerminal({
    runId, source, status: "incomplete", complete: false,
    expectedCount, receivedCount, pagesExpected, pagesReceived, errorCode, httpStatus, errorMessage, metadata, db,
  });
}

async function marcarFonteFalha({ runId, source, errorCode, httpStatus, errorMessage, metadata, db = pool }) {
  return marcarFonteTerminal({
    runId, source, status: "failed", complete: false,
    errorCode, httpStatus, errorMessage, metadata, db,
  });
}

// Reservado para fontes que realmente não se aplicam ao run (ex.: futuras
// ads/full_costs quando ainda não integradas). Não usar para esconder falha.
async function marcarFonteNaoAplicavel({ runId, source, metadata, db = pool }) {
  return marcarFonteTerminal({ runId, source, status: "not_applicable", complete: null, metadata, db });
}

// Rede de segurança (seção 54 da spec M3): fecha qualquer fonte ainda
// pending/running deste run como failed, quando o worker aborta por um erro
// que a orquestração normal não previu. Nunca deixa uma fonte presa em
// "running" para sempre.
async function falharFontesEmAndamento(runId, { errorCode = "SYNC_EXECUTION_ERROR", errorMessage = null } = {}, db = pool) {
  const result = await db.query(
    `UPDATE central_vendas_sync_sources
        SET status = 'failed', complete = false, error_code = $2,
            error_message = $3, finished_at = NOW(), updated_at = NOW()
      WHERE sync_run_id = $1 AND status IN ('pending', 'running')
      RETURNING source`,
    [runId, errorCode, errorMessage ? String(errorMessage).slice(0, 2000) : null]
  );
  return result.rows.map((row) => row.source);
}

async function listarFontesDoRun(runId, db = pool) {
  const result = await db.query(
    `SELECT * FROM central_vendas_sync_sources WHERE sync_run_id = $1 ORDER BY id ASC`,
    [runId]
  );
  return result.rows.map(sanitizeSourceRow);
}

// Fontes cuja falha é ESTRUTURAL (seção 20/32): quando orders ou base falham,
// centralVendasSyncService.sincronizarVendasMeli relança o erro e o worker
// nunca chega a marcar o run como completed — o run técnico vira failed, e
// completude segue o mesmo veredito. Claims/shipments/returns NUNCA lançam
// (buscarFretesEmLote/buscarClaimsPorPeriodo sempre resolvem) — por isso a
// falha deles é sempre 'partial', nunca 'failed' (seção 21, teste #30).
const STRUCTURAL_SOURCES = new Set(["orders", "base"]);

// Hardening M3, P0 seção 1: a agregação ANTIGA partia só das linhas que
// EXISTEM em central_vendas_sync_sources — uma fonte obrigatória que nunca
// chegou a ser registrada (ex.: o worker morreu antes de sequer chamar
// iniciarFonte("shipments")) ficava invisível para o agregador, e
// orders/claims/base completos sozinhos podiam virar `complete` sem
// qualquer evidência de Shipments. `requiredSources` agora é FIXO
// (independente de quais linhas existem) e `missingSources` é calculado
// explicitamente por diferença de conjunto — fonte obrigatória ausente
// NUNCA pode resultar em `complete`.
async function calcularCompletudeDoRun(runId, { runStatus = null, db = pool } = {}) {
  const fontes = await listarFontesDoRun(runId, db);
  const observadas = new Set(fontes.map((f) => f.source));

  // `returns` é condicional (seção 3 do hardening): só entra na
  // obrigatoriedade quando o run de fato precisou avaliar devolução (uma
  // linha foi registrada). Nunca aparece em `missingSources` — sua
  // ausência não é uma lacuna, é "não se aplicou a este run".
  const requiredSet = new Set(REQUIRED_SOURCES_BASE);
  if (observadas.has("returns")) requiredSet.add("returns");
  const requiredSources = [...requiredSet];
  const missingSources = requiredSources.filter((source) => !observadas.has(source));

  const relevantes = fontes.filter((f) => requiredSet.has(f.source));
  const failedSources = relevantes.filter((f) => f.status === "failed").map((f) => f.source);
  const incompleteSources = relevantes.filter((f) => f.status === "incomplete").map((f) => f.source);
  const pendentes = relevantes.some((f) => f.status === "pending" || f.status === "running");
  const falhaEstrutural = failedSources.some((source) => STRUCTURAL_SOURCES.has(source));

  // Run técnico ainda não terminou (seção 2): fonte ausente/pendente pode
  // legitimamente significar "ainda não chegou a vez dela", não uma lacuna
  // — por isso o veredito fica `unknown`, nunca `partial`, enquanto
  // queued/running. Depois de completed/failed (ou quando o chamador não
  // informa o status — mantém o comportamento estrito por padrão), fonte
  // obrigatória ausente/incompleta/falha NUNCA vira `complete`.
  const aindaEmAndamento = runStatus === "queued" || runStatus === "running";

  let status;
  if (falhaEstrutural) {
    status = "failed";
  } else if (missingSources.length || failedSources.length || incompleteSources.length) {
    status = aindaEmAndamento ? "unknown" : "partial";
  } else if (pendentes) {
    status = "unknown";
  } else {
    status = "complete";
  }

  return {
    status,
    requiredSources,
    observedSources: [...observadas],
    missingSources,
    incompleteSources,
    failedSources,
  };
}

module.exports = {
  iniciarFonte,
  marcarFonteCompleta,
  marcarFonteIncompleta,
  marcarFonteFalha,
  marcarFonteNaoAplicavel,
  falharFontesEmAndamento,
  listarFontesDoRun,
  calcularCompletudeDoRun,
  sanitizeSourceRow,
  SOURCES,
  STATUSES,
  TERMINAL_STATUSES,
};
