// Prova a identidade interna da Central de Gestao Full sobre estruturas JA
// NORMALIZADAS: chave canonica clienteContaId:inventoryId, deduplicacao
// escopada por conta, preservacao de referencias comerciais multiplas e
// rejeicao explicita de ambiguidade (nunca escolha silenciosa).

const assert = require("assert");
const {
  buildCanonicalKey,
  validateNormalizedIdentity,
  mergeReferences,
  dedupeInventories,
  resolveInventoryForReference,
} = require("../services/full/fullIdentity");

function ref({ mlb = null, variationId = null, userProductId = null, sellerSku = null, title = "Produto" }) {
  return { mlb, variationId, userProductId, sellerSku, title };
}

function identity({ clienteContaId, sellerId, inventoryId, references }) {
  return { clienteContaId, sellerId, inventoryId, references };
}

function run() {
  // Chave canonica
  {
    assert.strictEqual(buildCanonicalKey(123, "LCQI05831"), "123:LCQI05831");
    assert.throws(() => buildCanonicalKey(null, "LCQI05831"), TypeError);
    assert.throws(() => buildCanonicalKey(123, ""), TypeError);
    console.log("  ✓ chave canonica clienteContaId:inventoryId");
  }

  // Mesmo inventory + mesma conta -> deduplicar
  {
    const a = identity({
      clienteContaId: 123,
      sellerId: "S1",
      inventoryId: "INV-1",
      references: [ref({ mlb: "MLB1", sellerSku: "SKU-1" })],
    });
    const b = identity({
      clienteContaId: 123,
      sellerId: "S1",
      inventoryId: "INV-1",
      references: [ref({ mlb: "MLB1", sellerSku: "SKU-1" })],
    });

    const { inventories, invalid } = dedupeInventories([a, b]);
    assert.strictEqual(invalid.length, 0);
    assert.strictEqual(inventories.length, 1, "mesmo inventory + mesma conta deve deduplicar");
    assert.strictEqual(inventories[0].identityStatus, "resolved");
    console.log("  ✓ mesmo inventory + mesma conta deduplica");
  }

  // Mesmo inventory + contas diferentes -> NAO deduplicar
  {
    const a = identity({
      clienteContaId: 123,
      sellerId: "S1",
      inventoryId: "INV-1",
      references: [ref({ mlb: "MLB1" })],
    });
    const b = identity({
      clienteContaId: 456,
      sellerId: "S2",
      inventoryId: "INV-1",
      references: [ref({ mlb: "MLB9" })],
    });

    const { inventories } = dedupeInventories([a, b]);
    assert.strictEqual(inventories.length, 2, "contas diferentes com mesmo inventoryId nunca podem ser fundidas");
    const keys = inventories.map((inv) => inv.key).sort();
    assert.deepStrictEqual(keys, ["123:INV-1", "456:INV-1"]);
    console.log("  ✓ mesmo inventory + contas diferentes NAO deduplica");
  }

  // Um inventory com multiplos MLBs -> preservar todas as referencias
  {
    const a = identity({
      clienteContaId: 123,
      sellerId: "S1",
      inventoryId: "INV-1",
      references: [ref({ mlb: "MLB1" })],
    });
    const b = identity({
      clienteContaId: 123,
      sellerId: "S1",
      inventoryId: "INV-1",
      references: [ref({ mlb: "MLB2" })],
    });

    const { inventories } = dedupeInventories([a, b]);
    assert.strictEqual(inventories.length, 1);
    assert.strictEqual(inventories[0].references.length, 2);
    const mlbs = inventories[0].references.map((r) => r.mlb).sort();
    assert.deepStrictEqual(mlbs, ["MLB1", "MLB2"]);
    console.log("  ✓ inventory com multiplos MLBs preserva todas as referencias");
  }

  // MLB igual com inventories diferentes -> preservar inventories separados
  {
    const a = identity({
      clienteContaId: 123,
      sellerId: "S1",
      inventoryId: "INV-1",
      references: [ref({ mlb: "MLB-SAME" })],
    });
    const b = identity({
      clienteContaId: 123,
      sellerId: "S1",
      inventoryId: "INV-2",
      references: [ref({ mlb: "MLB-SAME" })],
    });

    const { inventories } = dedupeInventories([a, b]);
    assert.strictEqual(inventories.length, 2, "MLB repetido em inventories diferentes nao pode juntar os inventories");
    console.log("  ✓ MLB igual com inventories diferentes preserva inventories separados");
  }

  // SKU igual em produtos diferentes -> NAO juntar
  {
    const a = identity({
      clienteContaId: 123,
      sellerId: "S1",
      inventoryId: "INV-1",
      references: [ref({ mlb: "MLB1", sellerSku: "SKU-SAME" })],
    });
    const b = identity({
      clienteContaId: 123,
      sellerId: "S1",
      inventoryId: "INV-2",
      references: [ref({ mlb: "MLB2", sellerSku: "SKU-SAME" })],
    });

    const { inventories } = dedupeInventories([a, b]);
    assert.strictEqual(inventories.length, 2, "SKU nunca e chave de juncao, mesmo repetido");
    console.log("  ✓ SKU igual em produtos diferentes NAO junta inventories");
  }

  // user_product_id igual -> NAO assumir inventory igual
  {
    const a = identity({
      clienteContaId: 123,
      sellerId: "S1",
      inventoryId: "INV-1",
      references: [ref({ mlb: "MLB1", userProductId: "UP-SAME" })],
    });
    const b = identity({
      clienteContaId: 123,
      sellerId: "S1",
      inventoryId: "INV-2",
      references: [ref({ mlb: "MLB2", userProductId: "UP-SAME" })],
    });

    const { inventories } = dedupeInventories([a, b]);
    assert.strictEqual(inventories.length, 2, "user_product_id igual nao substitui inventory_id");
    console.log("  ✓ user_product_id igual NAO assume inventory igual");
  }

  // variation_id diferente -> preservar referencias distintas
  {
    const a = identity({
      clienteContaId: 123,
      sellerId: "S1",
      inventoryId: "INV-1",
      references: [ref({ mlb: "MLB1", variationId: "V1" })],
    });
    const b = identity({
      clienteContaId: 123,
      sellerId: "S1",
      inventoryId: "INV-1",
      references: [ref({ mlb: "MLB1", variationId: "V2" })],
    });

    const merged = mergeReferences(a.references, b.references);
    assert.strictEqual(merged.length, 2, "variacoes diferentes do mesmo MLB devem ser preservadas separadamente");
    const { inventories } = dedupeInventories([a, b]);
    assert.strictEqual(inventories[0].references.length, 2);
    console.log("  ✓ variation_id diferente preserva referencias distintas");
  }

  // Identidade incompleta -> marcar como invalida/nao resolvida
  {
    const incompleta = identity({
      clienteContaId: 123,
      sellerId: "S1",
      inventoryId: "",
      references: [ref({ mlb: "MLB1" })],
    });

    const validation = validateNormalizedIdentity(incompleta);
    assert.strictEqual(validation.valid, false);
    assert.ok(validation.errors.includes("inventoryId_ausente"));

    const semReferencias = identity({ clienteContaId: 123, sellerId: "S1", inventoryId: "INV-1", references: [] });
    assert.strictEqual(validateNormalizedIdentity(semReferencias).valid, false);

    const { inventories, invalid } = dedupeInventories([incompleta]);
    assert.strictEqual(inventories.length, 0);
    assert.strictEqual(invalid.length, 1);
    assert.ok(invalid[0].errors.includes("inventoryId_ausente"));
    console.log("  ✓ identidade incompleta e marcada como invalida, nunca adivinhada");
  }

  // Join ambiguo -> nao escolher silenciosamente
  {
    const a = identity({
      clienteContaId: 123,
      sellerId: "S1",
      inventoryId: "INV-1",
      references: [ref({ mlb: "MLB-DUP", variationId: "V1" })],
    });
    const b = identity({
      clienteContaId: 123,
      sellerId: "S1",
      inventoryId: "INV-2",
      references: [ref({ mlb: "MLB-DUP", variationId: "V1" })],
    });

    const { inventories } = dedupeInventories([a, b]);
    const resolution = resolveInventoryForReference({ clienteContaId: 123, mlb: "MLB-DUP", variationId: "V1" }, inventories);
    assert.strictEqual(resolution.status, "ambiguous");
    assert.deepStrictEqual(resolution.candidates.sort(), ["INV-1", "INV-2"]);
    console.log("  ✓ join ambiguo (mesmo mlb+variationId em dois inventories) nunca escolhe silenciosamente");
  }

  // Join resolvido por (mlb, variationId) e por mlb sozinho quando unico
  {
    const a = identity({
      clienteContaId: 123,
      sellerId: "S1",
      inventoryId: "INV-1",
      references: [ref({ mlb: "MLB-A", variationId: "V1" }), ref({ mlb: "MLB-B" })],
    });
    const { inventories } = dedupeInventories([a]);

    const porVariacao = resolveInventoryForReference({ clienteContaId: 123, mlb: "MLB-A", variationId: "V1" }, inventories);
    assert.strictEqual(porVariacao.status, "resolved");
    assert.strictEqual(porVariacao.inventoryId, "INV-1");
    assert.strictEqual(porVariacao.matchedBy, "mlb_variation");

    const porMlbSozinho = resolveInventoryForReference({ clienteContaId: 123, mlb: "MLB-B" }, inventories);
    assert.strictEqual(porMlbSozinho.status, "resolved");
    assert.strictEqual(porMlbSozinho.matchedBy, "mlb_only");

    const naoEncontrado = resolveInventoryForReference({ clienteContaId: 123, mlb: "MLB-INEXISTENTE" }, inventories);
    assert.strictEqual(naoEncontrado.status, "unresolved");

    console.log("  ✓ join resolve por (mlb, variationId) e por mlb sozinho quando unico; nao encontrado vira unresolved");
  }

  console.log("fullIdentity.test.js passed");
}

run();
