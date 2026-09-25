const assert = require("assert");
const {
  extrairSellerSku,
  rotuloVariation,
  expandirItemEmReferencias,
  consolidarReferenciasEmLinha,
  nomeVariacaoUserProduct,
} = require("../services/meli/meliItemIdentityService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

function sellerSku(value) {
  return { id: "SELLER_SKU", name: "SKU", value_name: value };
}

function run() {
  const simples = expandirItemEmReferencias({
    id: "MLB100",
    attributes: [
      { id: "SKU_COMPATIVEL", value_name: "NAO-USAR" },
      sellerSku("SKU-SIMPLES"),
    ],
    seller_custom_field: "FALLBACK-NAO-USAR",
    variations: [],
  });
  ok("A — item simples gera uma referência", simples.length === 1);
  ok("A — SELLER_SKU exato tem prioridade", simples[0].sku === "SKU-SIMPLES");
  ok("A — origem canônica é identificável", simples[0].sku_origem === "seller_sku");
  ok("A — atributo que apenas contém sku não é aceito", extrairSellerSku([{ id: "MY_SKU", value_name: "X" }]) === null);

  const fallback = expandirItemEmReferencias({
    id: "MLB101",
    seller_custom_field: "LEGACY-SIMPLES",
    variations: [],
  });
  ok("B — seller_custom_field é fallback", fallback[0].sku === "LEGACY-SIMPLES");
  ok("B — origem do fallback é identificável", fallback[0].sku_origem === "seller_custom_field_fallback");

  const legado = expandirItemEmReferencias({
    id: "MLB200",
    variations: [
      {
        id: 9001,
        attributes: [sellerSku("SKU-36")],
        attribute_combinations: [
          { id: "COLOR", value_name: "Bege" },
          { id: "SIZE", value_name: "36" },
        ],
      },
      { id: 9002, attributes: [sellerSku("SKU-38")], attribute_combinations: [] },
      { id: 9003, attributes: [sellerSku("SKU-40")], attribute_combinations: [] },
    ],
  });
  ok("C — legado com 3 variations gera 3 referências", legado.length === 3);
  ok("C — o mesmo MLB é preservado nas 3 referências", legado.every((ref) => ref.item_id === "MLB200"));
  ok("C — variation.id é preservado como string", JSON.stringify(legado.map((ref) => ref.variation_id)) === JSON.stringify(["9001", "9002", "9003"]));
  ok("C — três SKUs diferentes são preservados", new Set(legado.map((ref) => ref.sku)).size === 3);

  const semSku = expandirItemEmReferencias({
    id: "MLB201",
    variations: [{ id: 1, attributes: [], available_quantity: 0 }],
  });
  ok("D — variation sem SKU e com estoque zero continua existindo", semSku.length === 1 && semSku[0].sku === null);
  ok("D — SKU ausente não é inventado com MLB/variation.id", semSku[0].sku_origem === "ausente");

  const duplicado = expandirItemEmReferencias({
    id: "MLB202",
    variations: [
      { id: 1, attributes: [sellerSku("SKU-REPETIDO")] },
      { id: 2, attributes: [sellerSku("SKU-REPETIDO")] },
    ],
  });
  ok("E — SKU duplicado não colapsa variations", duplicado.length === 2);
  ok("E — identidade continua MLB + variation.id", duplicado[0].variation_id !== duplicado[1].variation_id);

  ok("F — rótulo usa attribute_combinations em ordem", rotuloVariation([
    { value_name: "Bege" },
    { value_name: "36" },
  ]) === "Bege | 36");

  const familyId = "18446744073709551615";
  const userProduct = expandirItemEmReferencias({
    id: "MLB300",
    user_product_id: "MLBU999",
    family_id: familyId,
    family_name: "Tênis Corrida",
    title: "Tênis Corrida - Bege 36",
    attributes: [sellerSku("SKU-UP")],
    variations: [],
  });
  ok("G — User Product gera uma referência por MLB", userProduct.length === 1);
  ok("G — MLBU é enriquecimento e MLB não é substituído", userProduct[0].item_id === "MLB300" && userProduct[0].user_product_id === "MLBU999");
  ok("G — nome amigável de UP usa sufixo seguro", userProduct[0].variacao_label === "Bege 36" && nomeVariacaoUserProduct({ title: "Produto" }) === "Produto");
  ok("H — family_id grande permanece string íntegra", userProduct[0].family_id === familyId && typeof userProduct[0].family_id === "string");

  const consolidadoLegado = consolidarReferenciasEmLinha(legado);
  ok("I — consolidar 3 referências vira 1 linha", consolidadoLegado.variacoes === 3);
  ok("I — SKU(s) concatena os 3 SKUs distintos", consolidadoLegado.skus === "SKU-36; SKU-38; SKU-40");
  ok("I — MLB da linha consolidada é o do item", consolidadoLegado.item_id === "MLB200");

  const consolidadoDuplicado = consolidarReferenciasEmLinha(duplicado);
  ok("J — SKU duplicado aparece uma vez na célula", consolidadoDuplicado.skus === "SKU-REPETIDO");
  ok("J — Variações continua contando as 2 variations reais", consolidadoDuplicado.variacoes === 2);

  const consolidadoSemSku = consolidarReferenciasEmLinha(semSku);
  ok("K — variation sem SKU continua gerando linha consolidada", consolidadoSemSku.variacoes === 1);
  ok("K — SKU ausente não é inventado na consolidação", consolidadoSemSku.skus === "");

  const consolidadoSimples = consolidarReferenciasEmLinha(simples);
  ok("L — item simples consolida para 1 linha com 1 variação", consolidadoSimples.variacoes === 1 && consolidadoSimples.skus === "SKU-SIMPLES");

  const consolidadoUserProduct = consolidarReferenciasEmLinha(userProduct);
  ok("M — User Product consolida para 1 linha por MLB", consolidadoUserProduct.item_id === "MLB300" && consolidadoUserProduct.user_product_id === "MLBU999");
  ok("N — consolidarReferenciasEmLinha de lista vazia retorna null", consolidarReferenciasEmLinha([]) === null);

  console.log(`\n✓ meliItemIdentityService: ${checks} verificações`);
}

run();
