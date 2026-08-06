const {
  findRefreshCandidates,
  refreshMlGrant,
  sanitizeErrorMessage,
} = require("../services/mlTokenService");

const INTERVAL_MS = 5 * 60 * 1000;
const REFRESH_WINDOW_S = 10 * 60;

let workerTimer = null;

async function refreshTokenRow(row) {
  try {
    await refreshMlGrant(row.id, { refreshWindowMs: REFRESH_WINDOW_S * 1000 });
  } catch (error) {
    if (error?.code === "ML_REFRESH_IN_PROGRESS" || error?.code === "ML_REFRESH_BACKOFF") return;
    console.warn(JSON.stringify({
      event: "ml_token_worker_refresh_failed",
      grant_id: row.id,
      cliente_id: row.cliente_id,
      ml_user_id: String(row.ml_user_id),
      error: sanitizeErrorMessage(error),
    }));
  }
}

async function runRefreshCycle() {
  try {
    const rows = await findRefreshCandidates(REFRESH_WINDOW_S);
    if (!rows.length) return;
    console.log(JSON.stringify({ event: "ml_token_worker_cycle", grants: rows.length }));
    // Renova sequencialmente para não esgotar o pool PostgreSQL.
	// Cada refresh mantém uma conexão durante o lock e a chamada OAuth.
	for (const row of rows) {
	 await refreshTokenRow(row);
	}
  } catch (error) {
    console.error(JSON.stringify({ event: "ml_token_worker_failed", error: sanitizeErrorMessage(error) }));
  }
}

function startTokenRefreshWorker() {
  if (workerTimer) return;
  console.log(JSON.stringify({
    event: "ml_token_worker_started",
    interval_minutes: INTERVAL_MS / 60000,
    refresh_window_minutes: REFRESH_WINDOW_S / 60,
  }));
  setTimeout(() => {
    runRefreshCycle();
    workerTimer = setInterval(runRefreshCycle, INTERVAL_MS);
  }, 30000);
}

function stopTokenRefreshWorker() {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
}

module.exports = {
  startTokenRefreshWorker,
  stopTokenRefreshWorker,
  runRefreshCycle,
  refreshTokenRow,
};
