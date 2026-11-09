import { describe, it, expect } from "vitest";
import { aplicarFiltrosLocais, contarFiltrosLocais, lerPercentual, FILTROS_LOCAIS_VAZIOS } from "./filtrosLocais.js";

const cli = (id, resumo, nContas = 1) => ({
  id, resumo,
  contas: Array.from({ length: nContas }, (_, i) => ({ id: id * 10 + i, ativa: true })).concat([{ id: id * 10 + 9, ativa: false }]),
});
const lista = [
  cli(1, { mc: 0.05, tacos: 0.08, ads: 900 }, 3),
  cli(2, { mc: 0.2, tacos: 0.02, ads: 0 }, 1),
  cli(3, null, 5),
];

describe("filtros avançados locais", () => {
  it("vazio não filtra nada e conta zero", () => {
    expect(contarFiltrosLocais(FILTROS_LOCAIS_VAZIOS)).toBe(0);
    expect(aplicarFiltrosLocais(lista, FILTROS_LOCAIS_VAZIOS)).toBe(lista);
  });
  it("lê % em pt-BR", () => {
    expect(lerPercentual("8,5")).toBeCloseTo(0.085);
    expect(lerPercentual("")).toBeNull();
    expect(lerPercentual("abc")).toBeNull();
  });
  it("MC abaixo / TACoS acima só comparam o número do servidor (sem número não passa)", () => {
    expect(aplicarFiltrosLocais(lista, { ...FILTROS_LOCAIS_VAZIOS, mcMax: "8" }).map((c) => c.id)).toEqual([1]);
    expect(aplicarFiltrosLocais(lista, { ...FILTROS_LOCAIS_VAZIOS, tacosMin: "6" }).map((c) => c.id)).toEqual([1]);
  });
  it("Ads com/sem e nº de contas ATIVAS", () => {
    expect(aplicarFiltrosLocais(lista, { ...FILTROS_LOCAIS_VAZIOS, ads: "com" }).map((c) => c.id)).toEqual([1]);
    expect(aplicarFiltrosLocais(lista, { ...FILTROS_LOCAIS_VAZIOS, ads: "sem" }).map((c) => c.id)).toEqual([2, 3]);
    expect(aplicarFiltrosLocais(lista, { ...FILTROS_LOCAIS_VAZIOS, contasMin: "4" }).map((c) => c.id)).toEqual([3]);
    expect(contarFiltrosLocais({ mcMax: "8", tacosMin: "", ads: "com", contasMin: "2" })).toBe(3);
  });
});
