// Teste de fumaça do preview visual (?preview=1). NÃO é cobertura de contrato
// (isso vive em Cliente360V3Page.test.jsx): prova que os cinco estados da
// fixture renderizam a árvore REAL do Dossiê sem quebrar e sem nenhuma chamada
// de rede — `fetch` é mockado para rejeitar, então qualquer requisição
// derrubaria o teste.
//
// Desde o redesenho, o preview monta o MESMO `DossieCorpo` da página real. Este
// arquivo também é, na prática, a prova de que os dois não divergiram.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import Cliente360V3PreviewPage from "./Cliente360V3PreviewPage.jsx";
import { ESTADOS_PREVIEW, lerEstado } from "./cliente360V3PreviewFixtures.js";

function abrir(query) {
  window.history.replaceState(null, "", `/cliente-360-v3.html?preview=1&${query}`);
  return render(<Cliente360V3PreviewPage />);
}

describe("Cliente360V3PreviewPage · fumaça", () => {
  let fetchOriginal;

  beforeEach(() => {
    fetchOriginal = global.fetch;
    global.fetch = vi.fn(() => Promise.reject(new Error("preview não deveria chamar fetch")));
  });

  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  it.each(ESTADOS_PREVIEW.map((e) => e.chave))("estado '%s' renderiza sem chamar fetch", async (chave) => {
    abrir(`state=${chave}`);

    if (chave === "indisponivel") {
      expect(await screen.findByText("Resultado indisponível")).toBeInTheDocument();
    } else if (chave === "carregando") {
      expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    } else {
      expect(await screen.findByText("Casa Viva Utilidades")).toBeInTheDocument();
      expect(document.querySelector("#produtos")).toBeInTheDocument();
    }

    // O contexto da operação vem do Shell, não do payload: ele existe em TODOS
    // os estados, inclusive indisponível e carregando.
    expect(document.querySelector(".c360d-header")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("aceita tanto `state=partial` (oficial) quanto `estado=confianca_parcial` (legado)", () => {
    expect(lerEstado("?state=partial")).toBe("confianca_parcial");
    expect(lerEstado("?estado=confianca_parcial")).toBe("confianca_parcial");
    expect(lerEstado("?state=loading")).toBe("carregando");
    expect(lerEstado("?state=chute")).toBe("normal");
    expect(lerEstado("")).toBe("normal");
  });

  it("estado 'attention' mostra o bloqueio no topo, acima dos números", async () => {
    abrir("state=attention");
    await screen.findByText("Casa Viva Utilidades");

    const faixa = document.querySelector(".c360d-bloqueios");
    expect(within(faixa).getByText("Conexão com o Mercado Livre caiu")).toBeInTheDocument();
    expect(within(faixa).getByText("Números podem mudar")).toBeInTheDocument();
  });

  it("estado 'partial' declara o resíduo da ponte em vez de forçar o fechamento", async () => {
    abrir("state=partial");
    await screen.findByText("Casa Viva Utilidades");

    const mudancas = document.querySelector("#mudancas");
    expect(within(mudancas).getByText("Não explicado")).toBeInTheDocument();
    expect(within(mudancas).getByText("Não fecha")).toBeInTheDocument();
    expect(document.querySelector(".c360d-header__sinais").textContent).toMatch(/Confiança Parcial/);
  });

  it("o preview desenha o trilho da sidebar para o Dossiê ser julgado na largura real", () => {
    abrir("state=normal");
    expect(document.querySelector(".c360d-preview__rail")).toBeInTheDocument();
  });

  it("trocar o estado pela barra de preview atualiza o conteúdo", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    abrir("state=normal");
    await screen.findByText("Casa Viva Utilidades");

    await userEvent.selectOptions(screen.getByLabelText("Estado"), "indisponivel");

    expect(await screen.findByText("Resultado indisponível")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
