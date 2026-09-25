// Filtros do Painel de Contas na URL: refresh não perde contexto, link
// carrega a mesma investigação, e o que é padrão não suja a URL.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { lerFiltrosDaUrl, escreverFiltrosNaUrl } from "./painelContasUrl.js";

describe("lerFiltrosDaUrl", () => {
  it("lê os três filtros de um link compartilhado", () => {
    expect(lerFiltrosDaUrl("?ano=2024&squadId=3&busca=acme", 2026))
      .toEqual({ ano: 2024, squadId: 3, busca: "acme" });
  });

  it("cai no ano padrão quando não há nada na URL", () => {
    expect(lerFiltrosDaUrl("", 2026)).toEqual({ ano: 2026, squadId: null, busca: "" });
  });

  it("ignora valores inválidos em vez de propagá-los para a requisição", () => {
    expect(lerFiltrosDaUrl("?ano=abacaxi&squadId=xyz", 2026))
      .toEqual({ ano: 2026, squadId: null, busca: "" });
  });

  it("aceita ano fora da janela do seletor — link antigo continua válido", () => {
    expect(lerFiltrosDaUrl("?ano=2019", 2026).ano).toBe(2019);
  });
});

describe("escreverFiltrosNaUrl", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/painel-contas.html");
    vi.spyOn(window.history, "replaceState");
  });

  it("usa replaceState — digitar não pode empilhar histórico por tecla", () => {
    escreverFiltrosNaUrl({ ano: 2026, squadId: null, busca: "ac" }, 2026);
    expect(window.history.replaceState).toHaveBeenCalled();
    expect(window.location.search).toBe("?busca=ac");
  });

  it("não escreve o que é padrão — URL limpa continua limpa", () => {
    escreverFiltrosNaUrl({ ano: 2026, squadId: null, busca: "" }, 2026);
    expect(window.location.search).toBe("");
  });

  it("remove o filtro ao limpar, sem deixar parâmetro órfão", () => {
    escreverFiltrosNaUrl({ ano: 2024, squadId: 3, busca: "acme" }, 2026);
    expect(window.location.search).toContain("squadId=3");

    escreverFiltrosNaUrl({ ano: 2026, squadId: null, busca: "" }, 2026);
    expect(window.location.search).toBe("");
  });

  it("ida e volta preserva a investigação inteira", () => {
    const filtros = { ano: 2025, squadId: 9, busca: "loja x" };
    escreverFiltrosNaUrl(filtros, 2026);
    expect(lerFiltrosDaUrl(window.location.search, 2026)).toEqual(filtros);
  });
});
