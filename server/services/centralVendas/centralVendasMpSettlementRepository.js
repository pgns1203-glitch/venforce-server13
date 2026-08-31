// server/services/centralVendas/centralVendasMpSettlementRepository.js
// MP2 — Persistência do Settlement Report (lifecycle) e dos movimentos
// (linhas do CSV). Único lugar que grava
// central_vendas_mp_settlement_reports/central_vendas_mp_settlement_movements
// — orquestração/interpretação financeira fica no
// centralVendasMpSettlementReportService/centralVendasMpReconciliationService
// (seção 25 do spec MP2: repository só consulta/persiste).
//
// UNIQUE(sync_run_id) no report ancora ensureSettlementReportForRun: nunca
// gera um segundo report externo para o MESMO run (seção 14). UNIQUE
// (settlement_report_id, row_number) nos movements ancora o replace
// transacional (seção 14/23): reimportar o MESMO report nunca duplica linha,
// e uma falha de parse no meio do caminho faz ROLLBACK — nunca deixa o
// report sem movimentos (seção 13/23 do spec).

const pool = require("../../config/database");

function intOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function sanitizeReportRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    syncRunId: Number(row.sync_run_id),
    clienteId: row.cliente_id != null ? Number(row.cliente_id) : null,
    clienteContaId: row.cliente_conta_id != null ? Number(row.cliente_conta_id) : null,
    externalAccountId: row.external_account_id || null,
    reportExternalId: row.report_external_id || null,
    beginDate: row.begin_date || null,
    endDate: row.end_date || null,
    status: row.status,
    reportType: row.report_type || null,
    format: row.format || null,
    currencyId: row.currency_id || null,
    fileName: row.file_name || null,
    fileSha256: row.file_sha256 || null,
    rowsCount: intOrNull(row.rows_count),
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    requestedAt: row.requested_at || null,
    processedAt: row.processed_at || null,
    downloadedAt: row.downloaded_at || null,
    importedAt: row.imported_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sanitizeMovementRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    settlementReportId: Number(row.settlement_report_id),
    syncRunId: Number(row.sync_run_id),
    clienteContaId: row.cliente_conta_id != null ? Number(row.cliente_conta_id) : null,
    rowNumber: Number(row.row_number),
    sourceId: row.source_id || null,
    orderId: row.order_id || null,
    shippingId: row.shipping_id || null,
    transactionType: row.transaction_type || null,
    transactionAmount: row.transaction_amount === null ? null : Number(row.transaction_amount),
    feeAmount: row.fee_amount === null ? null : Number(row.fee_amount),
    settlementNetAmount: row.settlement_net_amount === null ? null : Number(row.settlement_net_amount),
    realAmount: row.real_amount === null ? null : Number(row.real_amount),
    moneyReleaseDate: row.money_release_date || null,
    isReleased: row.is_released === null || row.is_released === undefined ? null : !!row.is_released,
    createdAt: row.created_at,
  };
}

// INSERT inicial ou UPDATE (upsert por sync_run_id) — cobre tanto "criar
// pela primeira vez" quanto "atualizar estado do MESMO report" (pending ->
// processed, por exemplo), sempre pela mesma linha.
async function upsertSettlementReport({
  syncRunId, clienteId, clienteContaId, externalAccountId,
  reportExternalId = null, beginDate = null, endDate = null,
  status = "requested", reportType = null, format = null, currencyId = null,
  fileName = null, errorCode = null, errorMessage = null, requestedAt = null,
}, db = pool) {
  const result = await db.query(
    `INSERT INTO central_vendas_mp_settlement_reports (
       sync_run_id, cliente_id, cliente_conta_id, external_account_id,
       report_external_id, begin_date, end_date, status, report_type, format,
       currency_id, file_name, error_code, error_message, requested_at, updated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
     ON CONFLICT (sync_run_id) DO UPDATE SET
       report_external_id = COALESCE(EXCLUDED.report_external_id, central_vendas_mp_settlement_reports.report_external_id),
       begin_date = COALESCE(EXCLUDED.begin_date, central_vendas_mp_settlement_reports.begin_date),
       end_date = COALESCE(EXCLUDED.end_date, central_vendas_mp_settlement_reports.end_date),
       status = EXCLUDED.status,
       report_type = COALESCE(EXCLUDED.report_type, central_vendas_mp_settlement_reports.report_type),
       format = COALESCE(EXCLUDED.format, central_vendas_mp_settlement_reports.format),
       currency_id = COALESCE(EXCLUDED.currency_id, central_vendas_mp_settlement_reports.currency_id),
       file_name = COALESCE(EXCLUDED.file_name, central_vendas_mp_settlement_reports.file_name),
       error_code = EXCLUDED.error_code,
       error_message = EXCLUDED.error_message,
       requested_at = COALESCE(central_vendas_mp_settlement_reports.requested_at, EXCLUDED.requested_at),
       updated_at = NOW()
     RETURNING *`,
    [
      syncRunId, clienteId, clienteContaId, externalAccountId,
      reportExternalId, beginDate, endDate, status, reportType, format,
      currencyId, fileName, errorCode, errorMessage, requestedAt,
    ]
  );
  return sanitizeReportRow(result.rows[0]);
}

async function getSettlementReportByRun(syncRunId, db = pool) {
  const result = await db.query(
    `SELECT * FROM central_vendas_mp_settlement_reports WHERE sync_run_id = $1 LIMIT 1`,
    [syncRunId]
  );
  return sanitizeReportRow(result.rows[0] || null);
}

// Atualização de status/metadados do MESMO report (nunca cria linha nova —
// use upsertSettlementReport para a primeira gravação).
async function updateSettlementReportStatus({
  id, status, fileName = undefined, fileSha256 = undefined, rowsCount = undefined,
  errorCode = undefined, errorMessage = undefined,
  processedAt = undefined, downloadedAt = undefined, importedAt = undefined,
  reportType = undefined, format = undefined, currencyId = undefined,
}, db = pool) {
  const result = await db.query(
    `UPDATE central_vendas_mp_settlement_reports SET
       status = COALESCE($2, status),
       file_name = COALESCE($3, file_name),
       file_sha256 = COALESCE($4, file_sha256),
       rows_count = COALESCE($5, rows_count),
       error_code = $6,
       error_message = $7,
       processed_at = COALESCE($8, processed_at),
       downloaded_at = COALESCE($9, downloaded_at),
       imported_at = COALESCE($10, imported_at),
       report_type = COALESCE($11, report_type),
       format = COALESCE($12, format),
       currency_id = COALESCE($13, currency_id),
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id, status ?? null, fileName ?? null, fileSha256 ?? null, intOrNull(rowsCount),
      errorCode === undefined ? null : errorCode, errorMessage === undefined ? null : errorMessage,
      processedAt ?? null, downloadedAt ?? null, importedAt ?? null,
      reportType ?? null, format ?? null, currencyId ?? null,
    ]
  );
  return sanitizeReportRow(result.rows[0] || null);
}

// Transação por report (seção 14/23 do spec): DELETE + INSERT em bloco.
// Falha no meio do parse/insert faz ROLLBACK — nunca deixa o report sem as
// linhas de uma importação anterior válida. `db.connect` só existe no pool
// real; o fake db usado nos testes não tem `.connect`, então cai direto em
// `db.query("BEGIN"/"COMMIT"/"ROLLBACK")` sobre o próprio objeto (suficiente
// para a semântica em memória usada nos testes).
async function replaceSettlementMovements({ reportId, syncRunId, clienteContaId, movements }, db = pool) {
  const usaPoolReal = typeof db.connect === "function";
  const client = usaPoolReal ? await db.connect() : db;
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM central_vendas_mp_settlement_movements WHERE settlement_report_id = $1`,
      [reportId]
    );
    for (const m of movements || []) {
      await client.query(
        `INSERT INTO central_vendas_mp_settlement_movements (
           settlement_report_id, sync_run_id, cliente_conta_id, row_number,
           source_id, order_id, shipping_id, transaction_type,
           transaction_amount, fee_amount, settlement_net_amount, real_amount,
           money_release_date, is_released
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          reportId, syncRunId, clienteContaId, m.rowNumber,
          m.sourceId, m.orderId, m.shippingId, m.transactionType,
          m.transactionAmount, m.feeAmount, m.settlementNetAmount, m.realAmount,
          m.moneyReleaseDate, m.isReleased,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    if (usaPoolReal) client.release();
  }
}

async function listSettlementMovementsByRun(syncRunId, db = pool) {
  const result = await db.query(
    `SELECT * FROM central_vendas_mp_settlement_movements WHERE sync_run_id = $1 ORDER BY row_number ASC`,
    [syncRunId]
  );
  return result.rows.map(sanitizeMovementRow);
}

// V3 P2.7 BLOCO H — cinto de seguranca de CONTA na camada MP.
// Estas tabelas TEM `cliente_conta_id` (e indice dedicado), mas o WHERE
// filtrava so por `sync_run_id`: o isolamento entre contas era 100% transitivo
// pelo array de runs vindo do snapshot. Qualquer erro upstream em
// deriveSyncRunIds virava mistura de contas sem nenhuma deteccao.
// Quando a conta e conhecida, filtramos tambem por ela. Linhas legadas
// (cliente_conta_id NULL) continuam entrando — nao da para atribui-las a uma
// conta e exclui-las derrubaria dado historico; o que passa a ser impossivel e
// entrar linha de OUTRA conta identificada.
function condicaoContaMp(coluna, clienteContaId, params) {
  const id = Number(clienteContaId);
  if (!Number.isInteger(id) || id <= 0) return null;
  params.push(id);
  return `(${coluna} IS NULL OR ${coluna} = $${params.length})`;
}

// MP3 (seção 12/13 do spec MP3) — mesma leitura acima, mas para o conjunto
// de sync_run_ids de um RANGE (M4/M10 pode selecionar mais de 1 import/run
// num período multi-mês). 1 única query, nunca 1 por run.
async function listSettlementMovementsByRunIds(syncRunIds, db = pool, { clienteContaId = null } = {}) {
  const ids = Array.isArray(syncRunIds) ? syncRunIds.filter((id) => Number.isFinite(Number(id))) : [];
  if (!ids.length) return [];
  const params = [ids];
  const conta = condicaoContaMp("cliente_conta_id", clienteContaId, params);
  const result = await db.query(
    `SELECT * FROM central_vendas_mp_settlement_movements WHERE sync_run_id = ANY($1::bigint[])${conta ? ` AND ${conta}` : ""} ORDER BY sync_run_id ASC, row_number ASC`,
    params
  );
  return result.rows.map(sanitizeMovementRow);
}

// MP3 — reports (lifecycle) de vários runs de uma vez, para o frontend
// exibir status do Settlement Report agregado do range (seção 15/16 do
// spec MP3) sem 1 query por run.
async function listSettlementReportsByRunIds(syncRunIds, db = pool, { clienteContaId = null } = {}) {
  const ids = Array.isArray(syncRunIds) ? syncRunIds.filter((id) => Number.isFinite(Number(id))) : [];
  if (!ids.length) return [];
  const params = [ids];
  const conta = condicaoContaMp("cliente_conta_id", clienteContaId, params);
  const result = await db.query(
    `SELECT * FROM central_vendas_mp_settlement_reports WHERE sync_run_id = ANY($1::bigint[])${conta ? ` AND ${conta}` : ""}`,
    params
  );
  return result.rows.map(sanitizeReportRow);
}

module.exports = {
  upsertSettlementReport,
  getSettlementReportByRun,
  updateSettlementReportStatus,
  replaceSettlementMovements,
  listSettlementMovementsByRun,
  listSettlementMovementsByRunIds,
  listSettlementReportsByRunIds,
  sanitizeReportRow,
  sanitizeMovementRow,
};
