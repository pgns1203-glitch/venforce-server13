// server/tests/helpers/mpSettlementFakeDb.js
// Fake db em memória para exercitar centralVendasMpSettlementRepository
// (MP2) real contra um "banco" de casamento de SQL por substring — mesmo
// padrão de server/tests/centralVendasMp1PaymentsRepository.test.js.
//
// Não é executado como teste (run-all.js só roda *.test.js na raiz de
// tests/, não em subpastas).

function makeMpSettlementFakeDb() {
  const reports = [];
  const movements = [];
  let nextReportId = 1;
  let nextMovementId = 1;
  let snapshotMovements = null; // preenchido em BEGIN, usado por ROLLBACK

  async function query(sql, params = []) {
    if (sql === "BEGIN") {
      snapshotMovements = movements.map((m) => ({ ...m }));
      return { rows: [] };
    }
    if (sql === "COMMIT") {
      snapshotMovements = null;
      return { rows: [] };
    }
    if (sql === "ROLLBACK") {
      if (snapshotMovements) {
        movements.length = 0;
        movements.push(...snapshotMovements);
        snapshotMovements = null;
      }
      return { rows: [] };
    }

    if (sql.includes("INSERT INTO central_vendas_mp_settlement_reports")) {
      const [
        syncRunId, clienteId, clienteContaId, externalAccountId,
        reportExternalId, beginDate, endDate, status, reportType, format,
        currencyId, fileName, errorCode, errorMessage, requestedAt,
      ] = params;

      let row = reports.find((r) => r.sync_run_id === syncRunId);
      if (!row) {
        row = { id: nextReportId++, sync_run_id: syncRunId, requested_at: null, rows_count: null, file_sha256: null, processed_at: null, downloaded_at: null, imported_at: null };
        reports.push(row);
      }
      row.cliente_id = clienteId;
      row.cliente_conta_id = clienteContaId;
      row.external_account_id = externalAccountId;
      row.report_external_id = reportExternalId ?? row.report_external_id ?? null;
      row.begin_date = beginDate ?? row.begin_date ?? null;
      row.end_date = endDate ?? row.end_date ?? null;
      row.status = status;
      row.report_type = reportType ?? row.report_type ?? null;
      row.format = format ?? row.format ?? null;
      row.currency_id = currencyId ?? row.currency_id ?? null;
      row.file_name = fileName ?? row.file_name ?? null;
      row.error_code = errorCode ?? null;
      row.error_message = errorMessage ?? null;
      row.requested_at = row.requested_at ?? requestedAt ?? null;
      return { rows: [{ ...row }] };
    }

    if (sql.includes("SELECT * FROM central_vendas_mp_settlement_reports WHERE sync_run_id")) {
      const [syncRunId] = params;
      const row = reports.find((r) => r.sync_run_id === syncRunId);
      return { rows: row ? [{ ...row }] : [] };
    }

    if (sql.includes("UPDATE central_vendas_mp_settlement_reports SET")) {
      const [
        id, status, fileName, fileSha256, rowsCount,
        errorCode, errorMessage, processedAt, downloadedAt, importedAt,
        reportType, format, currencyId,
      ] = params;
      const row = reports.find((r) => r.id === id);
      if (!row) return { rows: [] };
      if (status !== null) row.status = status;
      if (fileName !== null) row.file_name = fileName;
      if (fileSha256 !== null) row.file_sha256 = fileSha256;
      if (rowsCount !== null) row.rows_count = rowsCount;
      row.error_code = errorCode;
      row.error_message = errorMessage;
      if (processedAt !== null) row.processed_at = processedAt;
      if (downloadedAt !== null) row.downloaded_at = downloadedAt;
      if (importedAt !== null) row.imported_at = importedAt;
      if (reportType !== null) row.report_type = reportType;
      if (format !== null) row.format = format;
      if (currencyId !== null) row.currency_id = currencyId;
      return { rows: [{ ...row }] };
    }

    if (sql.includes("DELETE FROM central_vendas_mp_settlement_movements")) {
      const [reportId] = params;
      for (let i = movements.length - 1; i >= 0; i--) {
        if (movements[i].settlement_report_id === reportId) movements.splice(i, 1);
      }
      return { rows: [] };
    }

    if (sql.includes("INSERT INTO central_vendas_mp_settlement_movements")) {
      const [
        reportId, syncRunId, clienteContaId, rowNumber,
        sourceId, orderId, shippingId, transactionType,
        transactionAmount, feeAmount, settlementNetAmount, realAmount,
        moneyReleaseDate, isReleased,
      ] = params;
      movements.push({
        id: nextMovementId++, settlement_report_id: reportId, sync_run_id: syncRunId,
        cliente_conta_id: clienteContaId, row_number: rowNumber,
        source_id: sourceId, order_id: orderId, shipping_id: shippingId,
        transaction_type: transactionType, transaction_amount: transactionAmount,
        fee_amount: feeAmount, settlement_net_amount: settlementNetAmount, real_amount: realAmount,
        money_release_date: moneyReleaseDate, is_released: isReleased,
      });
      return { rows: [] };
    }

    if (sql.includes("SELECT * FROM central_vendas_mp_settlement_movements WHERE sync_run_id")) {
      const [syncRunId] = params;
      return { rows: movements.filter((m) => m.sync_run_id === syncRunId).sort((a, b) => a.row_number - b.row_number).map((m) => ({ ...m })) };
    }

    throw new Error(`mpSettlementFakeDb: SQL nao mapeado -> ${sql.slice(0, 160)}`);
  }

  return { reports, movements, query };
}

module.exports = { makeMpSettlementFakeDb };
