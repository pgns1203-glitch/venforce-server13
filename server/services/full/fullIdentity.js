"use strict";

// Identidade interna da Central de Gestao Full, apenas sobre estruturas JA
// NORMALIZADAS. Nao interpreta payload cru do Mercado Livre (isso pertence
// ao parser de /items de uma fase futura, apos fixtures reais).
//
// Chave fisica canonica: `${clienteContaId}:${inventoryId}`.
// inventory_id e sempre escopado pela conta. MLB, SKU e user_product_id sao
// referencias comerciais, nunca identidade fisica primaria. Nenhum fallback
// automatico usa SKU para juntar inventories, e ambiguidade nunca e
// resolvida silenciosamente.

function isNonEmptyValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Chave fisica canonica de um inventario, sempre escopada pela conta.
 */
function buildCanonicalKey(clienteContaId, inventoryId) {
  if (!isNonEmptyValue(clienteContaId) || !isNonEmptyString(inventoryId)) {
    throw new TypeError("clienteContaId e inventoryId sao obrigatorios para a chave canonica");
  }
  return `${clienteContaId}:${inventoryId}`;
}

/**
 * Valida uma identidade normalizada. Identidade incompleta nunca e
 * adivinhada: retorna valid=false com os motivos.
 */
function validateNormalizedIdentity(identity) {
  const errors = [];

  if (!identity || typeof identity !== "object") {
    return { valid: false, errors: ["identity_missing"] };
  }

  if (!isNonEmptyValue(identity.clienteContaId)) errors.push("clienteContaId_ausente");
  if (!isNonEmptyString(identity.sellerId)) errors.push("sellerId_ausente");
  if (!isNonEmptyString(identity.inventoryId)) errors.push("inventoryId_ausente");

  if (!Array.isArray(identity.references) || identity.references.length === 0) {
    errors.push("references_vazio");
  } else {
    identity.references.forEach((ref, index) => {
      if (!ref || typeof ref !== "object") {
        errors.push(`reference_${index}_invalida`);
        return;
      }
      const hasIdentifier =
        isNonEmptyString(ref.mlb) || isNonEmptyString(ref.userProductId) || isNonEmptyString(ref.sellerSku);
      if (!hasIdentifier) errors.push(`reference_${index}_sem_identificador`);
    });
  }

  return { valid: errors.length === 0, errors };
}

function referenceIdentityTuple(ref) {
  return JSON.stringify({
    mlb: ref.mlb ?? null,
    variationId: ref.variationId ?? null,
  });
}

/**
 * Junta referencias do mesmo inventory sem duplicar por (mlb, variationId).
 * Preserva multiplas referencias comerciais distintas (MLBs/variacoes/UPs).
 */
function mergeReferences(existingReferences, newReferences) {
  const merged = [...existingReferences];
  const seen = new Set(merged.map(referenceIdentityTuple));

  for (const ref of newReferences) {
    const tuple = referenceIdentityTuple(ref);
    if (seen.has(tuple)) continue;
    seen.add(tuple);
    merged.push(ref);
  }

  return merged;
}

/**
 * Deduplica identidades normalizadas por `clienteContaId + inventoryId`.
 * Mesma conta + mesmo inventory funde referencias. Contas diferentes com o
 * mesmo inventoryId NUNCA sao fundidas. Identidades invalidas sao separadas
 * em vez de entrarem silenciosamente no agrupamento.
 */
function dedupeInventories(identities) {
  const groups = new Map();
  const invalid = [];

  for (const identity of identities) {
    const validation = validateNormalizedIdentity(identity);
    if (!validation.valid) {
      invalid.push({ input: identity, errors: validation.errors });
      continue;
    }

    const key = buildCanonicalKey(identity.clienteContaId, identity.inventoryId);
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        key,
        clienteContaId: identity.clienteContaId,
        sellerId: identity.sellerId,
        inventoryId: identity.inventoryId,
        references: [...identity.references],
        identityStatus: "resolved",
        identityWarnings: [],
      });
      continue;
    }

    existing.references = mergeReferences(existing.references, identity.references);

    if (existing.sellerId !== identity.sellerId) {
      existing.identityStatus = "ambiguous";
      if (!existing.identityWarnings.includes("seller_id_conflict")) {
        existing.identityWarnings.push("seller_id_conflict");
      }
    }
  }

  return { inventories: Array.from(groups.values()), invalid };
}

function referenceMatches(ref, { mlb, variationId }) {
  if (!isNonEmptyString(ref.mlb) || ref.mlb !== mlb) return false;
  if (variationId === undefined) return true;
  return (ref.variationId ?? null) === (variationId ?? null);
}

/**
 * Resolve a qual inventory uma referencia comercial pertence, dentro da
 * conta informada. Ordem de join: (mlb, variationId) primeiro; depois mlb
 * sozinho somente se mapear para exatamente um inventory. SKU e
 * user_product_id nunca sao usados como fallback de join. Ambiguidade real
 * nunca e resolvida silenciosamente.
 */
function resolveInventoryForReference({ clienteContaId, mlb, variationId }, inventories) {
  if (!isNonEmptyValue(clienteContaId) || !isNonEmptyString(mlb)) {
    return { status: "unresolved", candidates: [] };
  }

  const scoped = inventories.filter((inv) => inv.clienteContaId === clienteContaId);

  if (variationId !== undefined) {
    const exactMatches = scoped.filter((inv) =>
      inv.references.some((ref) => referenceMatches(ref, { mlb, variationId }))
    );

    if (exactMatches.length === 1) {
      return { status: "resolved", inventoryId: exactMatches[0].inventoryId, matchedBy: "mlb_variation" };
    }
    if (exactMatches.length > 1) {
      return { status: "ambiguous", candidates: exactMatches.map((inv) => inv.inventoryId) };
    }
  }

  const mlbOnlyMatches = scoped.filter((inv) =>
    inv.references.some((ref) => referenceMatches(ref, { mlb }))
  );

  if (mlbOnlyMatches.length === 1) {
    return { status: "resolved", inventoryId: mlbOnlyMatches[0].inventoryId, matchedBy: "mlb_only" };
  }
  if (mlbOnlyMatches.length > 1) {
    return { status: "ambiguous", candidates: mlbOnlyMatches.map((inv) => inv.inventoryId) };
  }

  return { status: "unresolved", candidates: [] };
}

module.exports = {
  buildCanonicalKey,
  validateNormalizedIdentity,
  mergeReferences,
  dedupeInventories,
  resolveInventoryForReference,
};
