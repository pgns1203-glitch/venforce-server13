// frontend-react/src/components/ErrorBoundary.test.jsx
//
// Regressão da tela branca (§6/§29 da maratona QA): um erro de render não
// pode deixar a ilha React sem nenhum feedback pro usuário.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary.jsx";

function Bomba() {
  throw new Error("falha simulada de render");
}

describe("ErrorBoundary", () => {
  it("renderiza os filhos normalmente quando não há erro", () => {
    render(
      <ErrorBoundary>
        <p>conteúdo normal</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("conteúdo normal")).toBeInTheDocument();
  });

  it("um erro de render mostra estado honesto em vez de deixar a tela em branco", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomba />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Algo deu errado ao carregar esta tela.");
    expect(screen.getByRole("button", { name: "Recarregar" })).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
