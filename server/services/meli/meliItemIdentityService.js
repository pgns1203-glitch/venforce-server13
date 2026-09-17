// Identidade de itens Mercado Livre para consumidores que precisam distinguir
// MLB, variação legada e User Product. Helper puro: sem banco e sem HTTP.

function textoOuNulo(valor) {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  return texto || null;
}

function valorAtributo(attribute) {
  if (!attribute) return null;
  const direto = textoOuNulo(attribute.value_name) || textoOuNulo(attribute.value_id);
  if (direto) return direto;

  const primeiroValor = Array.isArray(attribute.values) ? attribute.values[0] : null;
  return textoOuNulo(primeiroValor?.name) || textoOuNulo(primeiroValor?.id);
}

function extrairSellerSku(attributes) {
  const attrs = Array.isArray(attributes) ? attributes : [];
  const attribute = attrs.find((item) => item && item.id === "SELLER_SKU");
  return valorAtributo(attribute);
}

function resolverSku(attributes, sellerCustomField) {
  const sellerSku = extrairSellerSku(attributes);
  if (sellerSku) {
    return { sku: sellerSku, sku_origem: "seller_sku" };
  }

  const fallback = textoOuNulo(sellerCustomField);
  if (fallback) {
    return { sku: fallback, sku_origem: "seller_custom_field_fallback" };
  }

  return { sku: null, sku_origem: "ausente" };
}

function rotuloVariation(attributeCombinations) {
  return (Array.isArray(attributeCombinations) ? attributeCombinations : [])
    .map((attribute) => valorAtributo(attribute))
    .filter(Boolean)
    .join(" | ");
}

function nomeVariacaoUserProduct(body) {
  const titulo = textoOuNulo(body?.title);
  const familia = textoOuNulo(body?.family_name);

  if (titulo && familia && titulo.toLocaleLowerCase().startsWith(familia.toLocaleLowerCase())) {
    const sufixo = titulo.slice(familia.length).replace(/^\s*[-–—|:]\s*/, "").trim();
    if (sufixo) return sufixo;
  }

  if (titulo) return titulo;
  return extrairSellerSku(body?.attributes) || textoOuNulo(body?.seller_custom_field) || "";
}

function expandirItemEmReferencias(body) {
  const itemId = textoOuNulo(body?.id);
  if (!itemId) return [];

  const userProductId = textoOuNulo(body?.user_product_id);
  // String() é apenas defesa de tipo. A preservação antes do JSON.parse deve
  // ser feita pelo mlClient com bigIntFields: ["family_id"].
  const familyId = textoOuNulo(body?.family_id);
  const variations = Array.isArray(body?.variations) ? body.variations : [];

  if (variations.length > 0) {
    return variations.map((variation) => {
      const identidadeSku = resolverSku(variation?.attributes, variation?.seller_custom_field);
      return {
        item_id: itemId,
        user_product_id: userProductId,
        family_id: familyId,
        variation_id: textoOuNulo(variation?.id),
        sku: identidadeSku.sku,
        sku_origem: identidadeSku.sku_origem,
        variacao_label: rotuloVariation(variation?.attribute_combinations),
      };
    });
  }

  const identidadeSku = resolverSku(body?.attributes, body?.seller_custom_field);
  return [{
    item_id: itemId,
    user_product_id: userProductId,
    family_id: familyId,
    variation_id: null,
    sku: identidadeSku.sku,
    sku_origem: identidadeSku.sku_origem,
    variacao_label: userProductId ? nomeVariacaoUserProduct(body) : "",
  }];
}

// Consolida as referências (uma por variation, ou uma só para item sem
// variations/User Product) de volta em UMA linha por MLB: SKUs distintos
// concatenados para exibição, e Variações sempre com a contagem real de
// referências — mesmo quando o SKU se repete entre elas.
function consolidarReferenciasEmLinha(referencias) {
  const refs = Array.isArray(referencias) ? referencias : [];
  if (!refs.length) return null;

  const skusVistos = new Set();
  const skusUnicos = [];
  refs.forEach((ref) => {
    const sku = textoOuNulo(ref?.sku);
    if (sku && !skusVistos.has(sku)) {
      skusVistos.add(sku);
      skusUnicos.push(sku);
    }
  });

  const primeira = refs[0];
  return {
    item_id: primeira.item_id,
    user_product_id: primeira.user_product_id,
    family_id: primeira.family_id,
    skus: skusUnicos.join("; "),
    variacoes: refs.length,
  };
}

module.exports = {
  extrairSellerSku,
  rotuloVariation,
  expandirItemEmReferencias,
  consolidarReferenciasEmLinha,
  nomeVariacaoUserProduct,
};
