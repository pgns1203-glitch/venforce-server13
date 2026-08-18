// Prova o adapter de payload /items -> referencias normalizadas: item
// simples, item multivariacao (inventory_id por variacao), falha parcial
// (uma variacao resolvida e outra nao), SKU ausente/duplicado, e a garantia
// central de que nenhum fallback inventa inventory_id. Os dois ultimos
// blocos integram com fullIdentity.dedupeInventories (PR1) para provar que
// a saida do parser e diretamente consumivel por ela.

const assert = require("assert");
const { parseItem, parseItemsBatch } = require("../services/full/fullItemParser");
const { dedupeInventories } = require("../services/full/fullIdentity");

const CONTA = { clienteContaId: 123, sellerId: "384324657" };

function run() {
  // Item simples, sem variacoes, com inventory_id
  {
    const itemBody = {
      id: "MLB111",
      title: "Produto simples",
      inventory_id: "INV-SIMPLES",
      user_product_id: "MLBU111",
      attributes: [{ id: "SELLER_SKU", value_name: "SKU-111" }],
    };

    const parsed = parseItem(itemBody, CONTA);
    assert.strictEqual(parsed.identities.length, 1);
    assert.strictEqual(parsed.unresolvedReferences.length, 0);

    const identity = parsed.identities[0];
    assert.strictEqual(identity.inventoryId, "INV-SIMPLES");
    assert.strictEqual(identity.clienteContaId, 123);
    assert.strictEqual(identity.sellerId, "384324657");
    assert.strictEqual(identity.references.length, 1);
    assert.strictEqual(identity.references[0].mlb, "MLB111");
    assert.strictEqual(identity.references[0].variationId, null);
    assert.strictEqual(identity.references[0].userProductId, "MLBU111");
    assert.strictEqual(identity.references[0].sellerSku, "SKU-111");
    console.log("  ✓ item simples sem variacao usa inventory_id/user_product_id de topo");
  }

  // Item multivariacao: cada variacao gera sua propria identidade (inventory_id proprio)
  {
    const itemBody = {
      id: "MLB222",
      title: "Produto com variacoes",
      variations: [
        {
          id: 1001,
          inventory_id: "INV-V1",
          user_product_id: "MLBU-V1",
          attribute_combinations: [{ id: "SELLER_SKU", value_name: "SKU-V1" }],
        },
        {
          id: 1002,
          inventory_id: "INV-V2",
          user_product_id: "MLBU-V2",
          attribute_combinations: [{ id: "SELLER_SKU", value_name: "SKU-V2" }],
        },
      ],
    };

    const parsed = parseItem(itemBody, CONTA);
    assert.strictEqual(parsed.identities.length, 2, "cada variacao com inventory_id proprio vira uma identidade");
    assert.strictEqual(parsed.unresolvedReferences.length, 0);

    const inventoryIds = parsed.identities.map((i) => i.inventoryId).sort();
    assert.deepStrictEqual(inventoryIds, ["INV-V1", "INV-V2"]);

    const mlbs = parsed.identities.map((i) => i.references[0].mlb);
    assert.deepStrictEqual(mlbs, ["MLB222", "MLB222"], "o mesmo MLB aparece em mais de um inventory (MLB com mais de um inventario)");

    const variationIds = parsed.identities.map((i) => i.references[0].variationId).sort();
    assert.deepStrictEqual(variationIds, ["1001", "1002"]);
    console.log("  ✓ item multivariacao gera uma identidade por variacao, inventory_id nunca colapsa no MLB de topo");
  }

  // Item sem inventory_id (sem variacao): vai para unresolvedReferences, nunca inventa
  {
    const itemBody = { id: "MLB333", title: "Sem inventory" };
    const parsed = parseItem(itemBody, CONTA);
    assert.strictEqual(parsed.identities.length, 0);
    assert.strictEqual(parsed.unresolvedReferences.length, 1);
    assert.strictEqual(parsed.unresolvedReferences[0].reason, "inventory_id_ausente");
    assert.strictEqual(parsed.unresolvedReferences[0].mlb, "MLB333");
    assert.ok(parsed.warnings.length > 0);
    console.log("  ✓ item sem inventory_id vai para unresolvedReferences, nao inventa (nenhum fallback)");
  }

  // Falha parcial: uma variacao resolvida, outra sem inventory_id
  {
    const itemBody = {
      id: "MLB444",
      variations: [
        { id: 1, inventory_id: "INV-OK" },
        { id: 2 }, // sem inventory_id
      ],
    };
    const parsed = parseItem(itemBody, CONTA);
    assert.strictEqual(parsed.identities.length, 1);
    assert.strictEqual(parsed.identities[0].inventoryId, "INV-OK");
    assert.strictEqual(parsed.unresolvedReferences.length, 1);
    assert.strictEqual(parsed.unresolvedReferences[0].reason, "inventory_id_ausente");
    assert.strictEqual(parsed.unresolvedReferences[0].variationId, "2");
    console.log("  ✓ resposta verbose com falha parcial resolve uma variacao e marca a outra como unresolved");
  }

  // Variacao sem id: nao pode virar identidade nem inventar variationId
  {
    const itemBody = { id: "MLB555", variations: [{ inventory_id: "INV-SEM-VARID" }] };
    const parsed = parseItem(itemBody, CONTA);
    assert.strictEqual(parsed.identities.length, 0);
    assert.strictEqual(parsed.unresolvedReferences.length, 1);
    assert.strictEqual(parsed.unresolvedReferences[0].reason, "variation_id_ausente");
    console.log("  ✓ variacao sem id nunca vira identidade, mesmo tendo inventory_id");
  }

  // SKU ausente (nem atributo, nem seller_custom_field)
  {
    const itemBody = { id: "MLB666", inventory_id: "INV-666" };
    const parsed = parseItem(itemBody, CONTA);
    assert.strictEqual(parsed.identities[0].references[0].sellerSku, null, "SKU ausente nunca pode virar string vazia ou inventada");
    console.log("  ✓ SKU ausente permanece null, nunca inventado");
  }

  // SKU via seller_custom_field (fallback documentado, sem variacao)
  {
    const itemBody = { id: "MLB777", inventory_id: "INV-777", seller_custom_field: "SKU-LEGADO" };
    const parsed = parseItem(itemBody, CONTA);
    assert.strictEqual(parsed.identities[0].references[0].sellerSku, "SKU-LEGADO");
    console.log("  ✓ SKU cai para seller_custom_field quando nao ha atributo SELLER_SKU");
  }

  // SKU duplicado entre variacoes diferentes: cada referencia e preservada, sem juncao por SKU
  {
    const itemBody = {
      id: "MLB888",
      variations: [
        { id: "V1", inventory_id: "INV-888-A", attribute_combinations: [{ id: "SELLER_SKU", value_name: "SKU-REPETIDO" }] },
        { id: "V2", inventory_id: "INV-888-B", attribute_combinations: [{ id: "SELLER_SKU", value_name: "SKU-REPETIDO" }] },
      ],
    };
    const parsed = parseItem(itemBody, CONTA);
    assert.strictEqual(parsed.identities.length, 2);
    const inventoryIds = parsed.identities.map((i) => i.inventoryId).sort();
    assert.deepStrictEqual(inventoryIds, ["INV-888-A", "INV-888-B"], "SKU repetido nao pode juntar inventories diferentes");
    console.log("  ✓ SKU duplicado entre variacoes nao junta inventories (SKU nunca e chave)");
  }

  // item_body invalido dentro do batch nao derruba os demais
  {
    const parsed = parseItemsBatch([null, { id: "MLB999", inventory_id: "INV-999" }], CONTA);
    assert.strictEqual(parsed.identities.length, 1);
    assert.ok(parsed.warnings.includes("item_body_invalido"));
    console.log("  ✓ item_body invalido no lote gera warning e nao derruba os demais itens");
  }

  // Integracao com fullIdentity: multiplas referencias para um mesmo inventario
  // (dois MLBs diferentes cujas variacoes convergem para o mesmo inventory_id)
  {
    const itemA = { id: "MLB-A", variations: [{ id: "VA", inventory_id: "INV-COMPARTILHADO" }] };
    const itemB = { id: "MLB-B", variations: [{ id: "VB", inventory_id: "INV-COMPARTILHADO" }] };

    const parsed = parseItemsBatch([itemA, itemB], CONTA);
    assert.strictEqual(parsed.identities.length, 2, "o parser nao funde no nivel de item; cada variacao e uma identidade propria");

    const { inventories, invalid } = dedupeInventories(parsed.identities);
    assert.strictEqual(invalid.length, 0);
    assert.strictEqual(inventories.length, 1, "fullIdentity.dedupeInventories funde as duas identidades por inventory_id");
    assert.strictEqual(inventories[0].references.length, 2);
    const mlbs = inventories[0].references.map((r) => r.mlb).sort();
    assert.deepStrictEqual(mlbs, ["MLB-A", "MLB-B"]);
    console.log("  ✓ saida do parser + fullIdentity.dedupeInventories preserva multiplas referencias para um inventario");
  }

  // Integracao com fullIdentity: user_product_id igual em MLBs diferentes nao assume mesmo inventory
  {
    const itemA = { id: "MLB-UP-A", inventory_id: "INV-UP-A", user_product_id: "UP-COMPARTILHADO" };
    const itemB = { id: "MLB-UP-B", inventory_id: "INV-UP-B", user_product_id: "UP-COMPARTILHADO" };

    const parsed = parseItemsBatch([itemA, itemB], CONTA);
    const { inventories } = dedupeInventories(parsed.identities);
    assert.strictEqual(inventories.length, 2, "user_product_id repetido nunca substitui inventory_id");
    console.log("  ✓ user_product_id igual em MLBs diferentes NAO assume o mesmo inventory (via fullIdentity)");
  }

  // item sem id de MLB: nunca gera identidade nem referencia inventada
  {
    const parsed = parseItem({ inventory_id: "INV-SEM-MLB" }, CONTA);
    assert.strictEqual(parsed.identities.length, 0);
    assert.strictEqual(parsed.unresolvedReferences.length, 0);
    assert.ok(parsed.warnings.includes("item_sem_id_ml"));
    console.log("  ✓ item sem id de MLB nao gera identidade nem referencia inventada");
  }

  console.log("fullItemParser.test.js passed");
}

run();
