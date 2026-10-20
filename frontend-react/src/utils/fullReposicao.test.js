import { describe, it, expect } from "vitest";
import { quantidadeSugerida, coberturaApos, resumirEnvio, gerarCsvConferencia } from "./fullReposicao.js";

function inv(overrides = {}) {
  return {
    inventoryId: "INV-1",
    references: [{ mlb: "MLB1", sellerSku: "SKU-1", title: "Produto 1", variationId: null }],
    stock: { available: 10, total: 10, status: "ok" },
    sales: { total14d: 14, status: "ok" },
    dailyTurnover: 1,
    operationalStatus: "REPOR",
    unitCost: 12,
    ...overrides,
  };
}

describe("quantidadeSugerida — mesma regra do backend (calculateBaseReplenishment)", () => {
  it("giro × dias − disponível, arredondado para cima, nunca negativo", () => {
    expect(quantidadeSugerida(inv(), 30)).toBe(20);
    expect(quantidadeSugerida(inv({ dailyTurnover: 0.35 }), 30)).toBe(1); // 10,5 − 10
    expect(quantidadeSugerida(inv(), 5)).toBe(0);
  });

  it("sem venda ou sem estoque conhecido → null, nunca 0 inventado", () => {
    expect(quantidadeSugerida(inv({ sales: { status: "unavailable" } }), 30)).toBe(null);
    expect(quantidadeSugerida(inv({ dailyTurnover: null }), 30)).toBe(null);
    expect(quantidadeSugerida(inv({ stock: { available: null, status: "unavailable" } }), 30)).toBe(null);
  });
});

describe("coberturaApos", () => {
  it("(disponível + envio) ÷ giro; sem giro → null", () => {
    expect(coberturaApos(inv(), 20)).toBe(30);
    expect(coberturaApos(inv({ dailyTurnover: 0 }), 20)).toBe(null);
  });
});

describe("resumirEnvio", () => {
  it("soma unidades e custo; sem custo conta à parte; quantidade 0 não entra", () => {
    const r = resumirEnvio([
      { inv: inv(), quantidade: 20 },
      { inv: inv({ inventoryId: "INV-2", unitCost: null, operationalStatus: "RUPTURA" }), quantidade: 5 },
      { inv: inv({ inventoryId: "INV-3" }), quantidade: 0 },
    ]);
    expect(r).toEqual({ produtos: 2, unidades: 25, custo: 240, semCusto: 1, rupturasResolvidas: 1 });
  });

  it("nenhum custo conhecido → custo null", () => {
    expect(resumirEnvio([{ inv: inv({ unitCost: null }), quantidade: 3 }]).custo).toBe(null);
  });
});

describe("gerarCsvConferencia", () => {
  it("BOM + ';' para o Excel pt-BR, só linhas com quantidade, e escapa ';' e aspas", () => {
    const csv = gerarCsvConferencia([
      { inv: inv({ references: [{ mlb: "MLB1", sellerSku: "SKU-1", title: 'Toalha 70x140; "luxo"', variationId: 77 }] }), quantidade: 4 },
      { inv: inv({ inventoryId: "INV-2" }), quantidade: 0 },
    ]);
    expect(csv.startsWith("﻿Produto;MLB;Variação;SKU;Inventory ID;Quantidade;Conferido\r\n")).toBe(true);
    expect(csv).toContain('"Toalha 70x140; ""luxo""";MLB1;77;SKU-1;INV-1;4;');
    expect(csv).not.toContain("INV-2");
  });
});
