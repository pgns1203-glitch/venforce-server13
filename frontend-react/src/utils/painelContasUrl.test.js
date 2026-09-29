// Filtros do Painel de Contas na URL: refresh não perde contexto, link
// carrega a mesma investigação, e o que é padrão não suja a URL.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { lerFiltrosDaUrl, escreverFiltrosNaUrl, FILTROS_PADRAO } from "./painelContasUrl.js";

const SET = "2026-09";

describe("lerFiltrosDaUrl", () => {
  it("lê todos os filtros de um link compartilhado", () => {
    expect(lerFiltrosDaUrl("?competencia=2026-06&squadId=3&busca=acme&status=sem_dados&marketplace=shopee&legado=1", SET))
      .toEqual({ competencia: "2026-06", squadId: 3, busca: "acme", status: "sem_dados", marketplace: "shopee", mostrarLegado: true });
  });

  it("sem nada na URL: competência corrente, status todos, legado oculto", () => {
    expect(lerFiltrosDaUrl("", SET)).toEqual({ ...FILTROS_PADRAO, competencia: SET });
    expect(FILTROS_PADRAO.mostrarLegado).toBe(false);
  });

  it("ignora valores inválidos em vez de propagá-los para a requisição", () => {
    expect(lerFiltrosDaUrl("?competencia=2026-13&squadId=xyz&status=qualquer&marketplace=a%20b", SET))
      .toEqual({ ...FILTROS_PADRAO, competencia: SET });
  });

  it("link antigo com ?ano= não vira competência inventada", () => {
    expect(lerFiltrosDaUrl("?ano=2024", SET).competencia).toBe(SET);
  });
});

describe("escreverFiltrosNaUrl", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/painel-contas.html");
    vi.spyOn(window.history, "replaceState");
  });

  it("usa replaceState — digitar não pode empilhar histórico por tecla", () => {
    escreverFiltrosNaUrl({ ...FILTROS_PADRAO, competencia: SET, busca: "ac" }, SET);
    expect(window.history.replaceState).toHaveBeenCalled();
    expect(window.location.search).toBe("?busca=ac");
  });

  it("não escreve o que é padrão — URL limpa continua limpa", () => {
    escreverFiltrosNaUrl({ ...FILTROS_PADRAO, competencia: SET }, SET);
    expect(window.location.search).toBe("");
  });

  it("remove o filtro ao limpar, sem deixar parâmetro órfão", () => {
    escreverFiltrosNaUrl({ competencia: "2026-06", squadId: 3, busca: "acme", status: "parcial", marketplace: "meli", mostrarLegado: true }, SET);
    expect(window.location.search).toContain("competencia=2026-06");
    expect(window.location.search).toContain("legado=1");

    escreverFiltrosNaUrl({ ...FILTROS_PADRAO, competencia: SET }, SET);
    expect(window.location.search).toBe("");
  });

  it("ida e volta preserva a investigação inteira", () => {
    const filtros = { competencia: "2025-12", squadId: 9, busca: "loja x", status: "atencao", marketplace: "meli", mostrarLegado: true };
    escreverFiltrosNaUrl(filtros, SET);
    expect(lerFiltrosDaUrl(window.location.search, SET)).toEqual(filtros);
  });
});
