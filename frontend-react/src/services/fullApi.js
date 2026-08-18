// frontend-react/src/services/fullApi.js
// Cliente HTTP da Central de Gestão Full. Reaproveita `requisitar`
// (JWT, 401/403, AbortSignal, erro consistente) — SEM retry no browser: o
// backend já aplica retry/backoff/circuit breaker (fullRetry) e devolve
// `retryAt`/`cache.stale` quando esgotado ou servindo dado desatualizado.

import { requisitar } from "./apiClient.js";

// Fundação de Clientes/Contas — mesmos endpoints já usados pelo resto do
// Portal (Portal/bases.js, Portal/cliente-operacao.js e o picker de contas
// do cliente), reaproveitados aqui para o seletor Cliente → Conta Mercado
// Livre da Central Full. Nenhuma modelagem nova de conta.
export function obterClientesDisponiveis({ signal } = {}) {
  return requisitar(`/base-vinculos/clientes`, { signal });
}

export function obterContasMeliDoCliente(clienteId, { signal } = {}) {
  return requisitar(`/clientes/${encodeURIComponent(clienteId)}/contas`, {
    params: { marketplace: "meli" },
    signal,
  });
}

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
