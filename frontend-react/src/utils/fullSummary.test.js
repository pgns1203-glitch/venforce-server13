import { describe, it, expect } from "vitest";
import { computeFullSummary, filterInventories } from "./fullSummary.js";

function inv(overrides = {}) {
  return {
    inventoryId: "INV-1",
    references: [{ mlb: "MLB1", sellerSku: "SKU-1", title: "Produto 1" }],
    stock: { available: 10, notAvailable: 0 },
    sales: { total14d: 5 },
    operationalStatus: "SAUDAVEL",
    ...overrides,
  };
}

describe("computeFullSummary", () => {
  it("conta disponibilidade e status operacional corretamente", () => {
    const summary = computeFullSummary([
      inv({ inventoryId: "A", operationalStatus: "RUPTURA", stock: { available: 0, notAvailable: 0 } }),
      inv({ inventoryId: "B", operationalStatus: "SEM_DADO", stock: { available: null, notAvailable: 3 } }),
      inv({ inventoryId: "C", operationalStatus: "EXCESSO" }),
    ]);

    expect(summary.total).toBe(3);
    expect(summary.ruptura).toBe(1);
    expect(summary.semDado).toBe(1);
    expect(summary.excesso).toBe(1);
    expect(summary.disponivel).toBe(1); // so "C" tem estoque disponivel > 0
    expect(summary.indisponivel).toBe(1); // so "B" tem indisponivel > 0
  });

  it("nunca conta estoque ausente (null) como disponivel", () => {
    const summary = computeFullSummary([inv({ stock: { available: null, notAvailable: null } })]);
    expect(summary.disponivel).toBe(0);
    expect(summary.indisponivel).toBe(0);
  });

  it("lista vazia devolve todos os contadores zerados, nunca undefined", () => {
    const summary = computeFullSummary([]);
    expect(summary.total).toBe(0);
    expect(summary.ruptura).toBe(0);
  });
});

describe("filterInventories", () => {
  const lista = [
    inv({ inventoryId: "A", operationalStatus: "RUPTURA", sales: { total14d: 0 }, references: [{ mlb: "MLB-A", sellerSku: "SKU-A", title: "Camiseta azul" }] }),
    inv({ inventoryId: "B", operationalStatus: "SAUDAVEL", sales: { total14d: 8 }, references: [{ mlb: "MLB-B", sellerSku: "SKU-B", title: "Camiseta preta" }] }),
  ];

  it("filtra por status", () => {
    const resultado = filterInventories(lista, { status: "RUPTURA" });
    expect(resultado.map((i) => i.inventoryId)).toEqual(["A"]);
  });

  it("filtra por busca textual (mlb, sku ou titulo)", () => {
    expect(filterInventories(lista, { search: "MLB-B" }).map((i) => i.inventoryId)).toEqual(["B"]);
    expect(filterInventories(lista, { search: "preta" }).map((i) => i.inventoryId)).toEqual(["B"]);
    expect(filterInventories(lista, { search: "SKU-A" }).map((i) => i.inventoryId)).toEqual(["A"]);
  });

  it("filtra somente com demanda (total14d > 0)", () => {
    const resultado = filterInventories(lista, { somenteComDemanda: true });
    expect(resultado.map((i) => i.inventoryId)).toEqual(["B"]);
  });

  it("status invalido/desconhecido e ignorado (nao filtra tudo silenciosamente)", () => {
    const resultado = filterInventories(lista, { status: "NAO_EXISTE" });
    expect(resultado.length).toBe(2);
  });

  it("sem filtros devolve a lista original", () => {
    expect(filterInventories(lista, {}).length).toBe(2);
  });
});
