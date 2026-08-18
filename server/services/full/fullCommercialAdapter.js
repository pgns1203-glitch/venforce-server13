"use strict";

// server/services/full/fullCommercialAdapter.js (PR6)
//
// Enriquecimento comercial OPCIONAL e account-aware da Central de Gestao
// Full. Uma unica leitura bulk por conta/periodo — nunca uma chamada por
// inventory_id (secao 9 "Evitar N+1": "Uma agregacao comercial por
// conta/periodo, nunca uma chamada a metricasService por linha").
//
// Secao 6 (divergencia #4) do plano auditado: a Central de Vendas e os
// snapshots da Cliente360 hoje persistem por `cliente_id`, sem
// `cliente_conta_id`. Ou seja, a linhagem de conta ainda NAO esta
// comprovada nessas fontes. Enquanto isso for verdade, este adapter deve
// devolver `commercial.status="unavailable"` para a conta inteira e para
// cada inventory — nunca inventar numero comercial cruzando contas do
// mesmo cliente (risco de producao explicito na secao 23).
//
// `lineageVerifier` e o unico ponto de decisao "essa fonte comercial ja
// prova a conta X?". O padrao devolve sempre false porque nenhuma fonte
// atual do repositorio prova isso; conectar uma fonte real (ex.: Central
// de Vendas apos ganhar `cliente_conta_id`) significa passar um
// `lineageVerifier` e um `fetchAccountCommercial` reais para
// `createFullCommercialAdapter`, nunca mudar o padrao "as cegas".
//
// Contrato de falha: `fetchBulkCommercial` NUNCA rejeita. Qualquer erro de
// `lineageVerifier`/`fetchAccountCommercial` vira `status="unavailable"`
// com motivo sanitizado (secao 22, PR6: "Nao bloquear metricas
// operacionais" — o snapshot operacional nao pode depender deste
// resultado).

const UNVERIFIED_REASON = "account_scope_unverified";

function unavailableResult(reason = UNVERIFIED_REASON) {
  return { status: "unavailable", reason };
}

function toByInventoryMap(raw) {
  if (raw instanceof Map) return raw;
  if (raw && typeof raw === "object") return new Map(Object.entries(raw));
  return new Map();
}

/**
 * `lineageVerifier({ clienteContaId, clienteId, sellerId })` -> Promise<boolean>
 *   Decide se ja existe fonte comercial comprovadamente escopada por conta.
 *   Padrao: sempre `false` (nenhuma fonte atual prova isso — ver cabecalho).
 *
 * `fetchAccountCommercial({ clienteContaId, clienteId, sellerId, period, inventories })`
 *   -> Promise<{ byInventoryId: Map|object }>
 *   So e chamada quando `lineageVerifier` confirmar a linhagem. Ausente por
 *   padrao: sem fonte real conectada, o enriquecimento fica inerte.
 */
function createFullCommercialAdapter({ lineageVerifier = async () => false, fetchAccountCommercial = null } = {}) {
  async function fetchBulkCommercial({ clienteContaId, clienteId, sellerId, period, inventories }) {
    if (!clienteContaId || !clienteId) {
      return { account: unavailableResult(), byInventoryId: new Map() };
    }

    let verified = false;
    try {
      verified = Boolean(await lineageVerifier({ clienteContaId, clienteId, sellerId }));
    } catch {
      verified = false;
    }

    if (!verified || typeof fetchAccountCommercial !== "function") {
      return { account: unavailableResult(), byInventoryId: new Map() };
    }

    try {
      const raw = await fetchAccountCommercial({ clienteContaId, clienteId, sellerId, period, inventories });
      if (!raw || typeof raw !== "object") {
        return { account: unavailableResult("empty_commercial_source"), byInventoryId: new Map() };
      }
      return { account: { status: "ok" }, byInventoryId: toByInventoryMap(raw.byInventoryId) };
    } catch {
      return { account: unavailableResult("commercial_source_failed"), byInventoryId: new Map() };
    }
  }

  return { fetchBulkCommercial };
}

module.exports = { createFullCommercialAdapter, unavailableResult, UNVERIFIED_REASON };
