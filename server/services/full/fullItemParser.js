"use strict";

// Adapter de payload `/items` (ML) para referencias normalizadas, no
// formato que `fullIdentity.js` (PR1) ja sabe consumir. Recebe o BODY do
// item (ja desembrulhado do envelope de multiget `{code, body}` por
// fullMlGateway), nunca a resposta HTTP crua.
//
// Regras de resolucao (secao 8 do plano auditado):
//   1. Item sem variacoes: usa os campos de topo inventory_id/user_product_id.
//   2. Item com variacoes: cada variation.id vira uma referencia propria,
//      com o inventory_id/user_product_id/SKU daquela variacao.
//   3. Sem inventory_id, a referencia vai para unresolvedReferences — nunca
//      inventa por MLB, SKU ou user_product_id.
//
// SALE_CONFIRMATION, uplift, score e qualquer leitura de operacoes NAO
// pertencem a este arquivo.

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeId(value) {
  if (value === null || value === undefined) return null;
  const asString = String(value).trim();
  return asString.length > 0 ? asString : null;
}

function attributeValue(attribute) {
  if (!attribute) return null;
  if (isNonEmptyString(attribute.value_name)) return attribute.value_name;
  if (Array.isArray(attribute.values) && attribute.values[0] && isNonEmptyString(attribute.values[0].name)) {
    return attribute.values[0].name;
  }
  return null;
}

function findAttributeValue(attributes, attributeId) {
  const list = Array.isArray(attributes) ? attributes : [];
  const found = list.find((attr) => attr && attr.id === attributeId);
  return found ? attributeValue(found) : null;
}

function extractSellerSku(itemLevelAttributes, itemLevelSellerCustomField, variationLevelAttributes) {
  const variationSku = findAttributeValue(variationLevelAttributes, "SELLER_SKU");
  if (variationSku) return variationSku;
  if (variationLevelAttributes !== undefined) {
    // Variacao existe mas nao tem SELLER_SKU proprio: nao herda do item.
    return null;
  }
  const itemSku = findAttributeValue(itemLevelAttributes, "SELLER_SKU");
  if (itemSku) return itemSku;
  return normalizeId(itemLevelSellerCustomField);
}

function buildReference({ mlb, variationId, userProductId, sellerSku, title }) {
  return { mlb, variationId, userProductId, sellerSku, title: isNonEmptyString(title) ? title : null };
}

/**
 * Analisa um unico item body. Retorna:
 *   identities: [{ clienteContaId, sellerId, inventoryId, references:[ref] }]
 *   unresolvedReferences: [{ ...reference, reason }]
 *   warnings: string[]
 */
function parseItem(itemBody, { clienteContaId, sellerId }) {
  const identities = [];
  const unresolvedReferences = [];
  const warnings = [];

  const mlb = normalizeId(itemBody && itemBody.id);
  if (!mlb) {
    warnings.push("item_sem_id_ml");
    return { identities, unresolvedReferences, warnings };
  }

  const itemAttributes = Array.isArray(itemBody.attributes) ? itemBody.attributes : [];
  const variations = Array.isArray(itemBody.variations) ? itemBody.variations : [];

  if (variations.length === 0) {
    const inventoryId = normalizeId(itemBody.inventory_id);
    const userProductId = normalizeId(itemBody.user_product_id);
    const sellerSku = extractSellerSku(itemAttributes, itemBody.seller_custom_field, undefined);
    const reference = buildReference({ mlb, variationId: null, userProductId, sellerSku, title: itemBody.title });

    if (inventoryId) {
      identities.push({ clienteContaId, sellerId, inventoryId, references: [reference] });
    } else {
      unresolvedReferences.push({ ...reference, reason: "inventory_id_ausente" });
      warnings.push(`item ${mlb} sem inventory_id`);
    }
    return { identities, unresolvedReferences, warnings };
  }

  for (const variation of variations) {
    if (!variation || typeof variation !== "object") {
      warnings.push(`item ${mlb} com variacao invalida`);
      continue;
    }

    const variationId = normalizeId(variation.id);
    const inventoryId = normalizeId(variation.inventory_id);
    const userProductId = normalizeId(variation.user_product_id);
    const variationAttributes = Array.isArray(variation.attribute_combinations)
      ? variation.attribute_combinations
      : [];
    const sellerSku = extractSellerSku(itemAttributes, itemBody.seller_custom_field, variationAttributes);
    const reference = buildReference({ mlb, variationId, userProductId, sellerSku, title: itemBody.title });

    if (!variationId) {
      unresolvedReferences.push({ ...reference, reason: "variation_id_ausente" });
      warnings.push(`item ${mlb} com variacao sem id`);
      continue;
    }

    if (inventoryId) {
      identities.push({ clienteContaId, sellerId, inventoryId, references: [reference] });
    } else {
      unresolvedReferences.push({ ...reference, reason: "inventory_id_ausente" });
      warnings.push(`item ${mlb} variacao ${variationId} sem inventory_id`);
    }
  }

  return { identities, unresolvedReferences, warnings };
}

/**
 * Analisa varios item bodies (ja resolvidos de um multiget). Agrega os
 * contratos de `parseItem`. Nao deduplica por inventory_id — isso e
 * responsabilidade de `fullIdentity.dedupeInventories` (PR1) sobre a lista
 * de `identities` resultante.
 */
function parseItemsBatch(itemBodies, { clienteContaId, sellerId }) {
  const identities = [];
  const unresolvedReferences = [];
  const warnings = [];

  const list = Array.isArray(itemBodies) ? itemBodies : [];
  for (const itemBody of list) {
    if (!itemBody || typeof itemBody !== "object") {
      warnings.push("item_body_invalido");
      continue;
    }
    const parsed = parseItem(itemBody, { clienteContaId, sellerId });
    identities.push(...parsed.identities);
    unresolvedReferences.push(...parsed.unresolvedReferences);
    warnings.push(...parsed.warnings);
  }

  return { identities, unresolvedReferences, warnings };
}

module.exports = {
  parseItem,
  parseItemsBatch,
};
