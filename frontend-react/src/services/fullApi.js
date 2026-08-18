// frontend-react/src/services/fullApi.js
// Cliente HTTP da Central de Gestão Full. Reaproveita `requisitar`
// (JWT, 401/403, AbortSignal, erro consistente) — SEM retry no browser: o
// backend já aplica retry/backoff/circuit breaker (fullRetry) e devolve
// `retryAt`/`cache.stale` quando esgotado ou servindo dado desatualizado.

import { requisitar } from "./apiClient.js";

export function obterSnapshotFull(clienteContaId, { windowDays = 14, signal } = {}) {
  return requisitar(`/operacao/full/contas/${encodeURIComponent(clienteContaId)}/snapshot`, {
    params: { windowDays },
    signal,
  });
}

export function obterInventoryDetail(clienteContaId, inventoryId, { signal } = {}) {
  return requisitar(
    `/operacao/full/contas/${encodeURIComponent(clienteContaId)}/inventories/${encodeURIComponent(inventoryId)}`,
    { signal }
  );
}

export function obterInventoryMovements(clienteContaId, inventoryId, { cursor, limit = 100, signal } = {}) {
  return requisitar(
    `/operacao/full/contas/${encodeURIComponent(clienteContaId)}/inventories/${encodeURIComponent(inventoryId)}/movements`,
    { params: { cursor, limit }, signal }
  );
}
