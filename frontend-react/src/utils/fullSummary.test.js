import { describe, it, expect } from "vitest";
import { computeFullSummary, diasInteiros, filterInventories, ordenarPorUrgencia } from "./fullSummary.js";

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

describe("computeFullSummary · valores da Central do Full (modelo C)", () => {
  it("soma só valores conhecidos; nenhum conhecido fica null, nunca R$ 0", () => {
    const vazio = computeFullSummary([inv({ stockCost: null, forecast30dRevenue: null })]);
    expect(vazio.custoEstoque).toBe(null);
    expect(vazio.previsao30d).toBe(null);

    const s = computeFullSummary([
      inv({ inventoryId: "A", stockCost: 100, forecast30dRevenue: 300 }),
      inv({ inventoryId: "B", stockCost: null, forecast30dRevenue: 50 }),
      inv({ inventoryId: "C", operationalStatus: "EXCESSO", stockCost: 40 }),
      inv({ inventoryId: "D", operationalStatus: "SEM_GIRO", stockCost: null }),
    ]);
    expect(s.custoEstoque).toBe(140);
    expect(s.previsao30d).toBe(350);
    expect(s.parado).toBe(2);
    expect(s.custoParado).toBe(40);
  });

  it("sem custo = tem unidades no Full e custo null (undefined não conta)", () => {
    const s = computeFullSummary([
      inv({ inventoryId: "A", stock: { available: 2, total: 3 }, unitCost: null }),
      inv({ inventoryId: "B", stock: { available: 0, total: 0 }, unitCost: null }),
      inv({ inventoryId: "C", stock: { available: 2, total: 3 } }),
    ]);
    expect(s.semCusto).toBe(1);
  });

  it("cobertura média = disponível ÷ giro só dos itens que giram; giro perdido soma as rupturas", () => {
    const s = computeFullSummary([
      inv({ inventoryId: "A", stock: { available: 20 }, dailyTurnover: 1 }),
      inv({ inventoryId: "B", stock: { available: 10 }, dailyTurnover: 1 }),
      inv({ inventoryId: "C", stock: { available: 500 }, dailyTurnover: 0, operationalStatus: "SEM_GIRO" }),
      inv({ inventoryId: "D", stock: { available: 0 }, dailyTurnover: 3, operationalStatus: "RUPTURA" }),
    ]);
    expect(s.coberturaMedia).toBe(6); // 30 un ÷ 5/dia
    expect(s.giroRuptura).toBe(3);
    expect(computeFullSummary([inv({ dailyTurnover: null })]).coberturaMedia).toBe(null);
  });
});

describe("filterInventories · recortes dos KPIs", () => {
  const lista = [
    inv({ inventoryId: "A", operationalStatus: "RUPTURA", stock: { available: 0, total: 0 } }),
    inv({ inventoryId: "B", operationalStatus: "CRITICO" }),
    inv({ inventoryId: "C", operationalStatus: "EXCESSO", stock: { available: 9, total: 9 }, unitCost: null }),
  ];

  it("vários KPIs ativos somam (OU)", () => {
    expect(filterInventories(lista, { kpis: ["ruptura", "critico"] }).map((i) => i.inventoryId)).toEqual(["A", "B"]);
    expect(filterInventories(lista, { kpis: ["parado"] }).map((i) => i.inventoryId)).toEqual(["C"]);
    expect(filterInventories(lista, { kpis: ["semCusto"] }).map((i) => i.inventoryId)).toEqual(["C"]);
  });

  it("chave desconhecida é ignorada (não esvazia a lista)", () => {
    expect(filterInventories(lista, { kpis: ["nao-existe"] }).length).toBe(3);
  });
});

describe("ordenarPorUrgencia", () => {
  it("status primeiro, depois menor cobertura, depois maior giro; sem dado por último", () => {
    const ordem = ordenarPorUrgencia([
      inv({ inventoryId: "saudavel", operationalStatus: "SAUDAVEL", coverageDays: 30 }),
      inv({ inventoryId: "sem-dado", operationalStatus: "SEM_DADO", coverageDays: null }),
      inv({ inventoryId: "repor-12", operationalStatus: "REPOR", coverageDays: 12 }),
      inv({ inventoryId: "repor-8", operationalStatus: "REPOR", coverageDays: 8 }),
      inv({ inventoryId: "ruptura-lenta", operationalStatus: "RUPTURA", coverageDays: 0, dailyTurnover: 1 }),
      inv({ inventoryId: "ruptura-rapida", operationalStatus: "RUPTURA", coverageDays: 0, dailyTurnover: 5 }),
    ]).map((i) => i.inventoryId);
    expect(ordem).toEqual(["ruptura-rapida", "ruptura-lenta", "repor-8", "repor-12", "saudavel", "sem-dado"]);
  });
});

describe("diasInteiros", () => {
  it("arredonda a cobertura para baixo (bate com o status) e mantém ausência", () => {
    expect(diasInteiros(6.9)).toBe(6);
    expect(diasInteiros(19.5)).toBe(19);
    expect(diasInteiros(0)).toBe(0);
    expect(diasInteiros(null)).toBe(null);
  });
});
