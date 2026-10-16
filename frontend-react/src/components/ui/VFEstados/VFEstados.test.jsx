import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VFEmpty, VFError, VFLoading, VFSkeleton } from "./index.js";

describe("VFEmpty", () => {
  it("título como h3, descrição e entrada animada", () => {
    const { container } = render(<VFEmpty title="Nenhum produto">Ajuste a busca.</VFEmpty>);
    expect(screen.getByRole("heading", { level: 3, name: "Nenhum produto" })).toHaveClass("vf-empty__title");
    expect(screen.getByText("Ajuste a busca.")).toHaveClass("vf-empty__description");
    expect(container.firstChild).toHaveClass("vf-empty", "vf-motion-enter");
    expect(container.firstChild).not.toHaveClass("vf-empty--compact");
  });

  it("compact, titleAs, ícone com tom e ações", () => {
    const { container } = render(
      <VFEmpty compact titleAs="h4" icon="!" iconTone="danger" actions={<a href="/bases.html">Bases</a>} title="X" />,
    );
    expect(container.firstChild).toHaveClass("vf-empty--compact");
    expect(screen.getByRole("heading", { level: 4 })).toBeInTheDocument();
    expect(container.querySelector(".vf-empty__icon")).toHaveClass("is-danger");
    expect(container.querySelector(".vf-empty__actions")).toContainElement(screen.getByRole("link", { name: "Bases" }));
  });
});

describe("VFError", () => {
  it("role=alert com título padrão", () => {
    render(<VFError>Sem resposta da API.</VFError>);
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar");
    expect(screen.getByRole("alert")).toHaveTextContent("Sem resposta da API.");
  });

  it("detalhe técnico separado e botão de tentar de novo", async () => {
    const onRetry = vi.fn();
    render(
      <VFError title="Falhou" detail="ECONNRESET" onRetry={onRetry} retryLabel="Recarregar">
        Explicação.
      </VFError>,
    );
    expect(screen.getByText("ECONNRESET")).toHaveClass("vf-empty__detail");
    await userEvent.setup().click(screen.getByRole("button", { name: "Recarregar" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("sem onRetry nem actions não renderiza área de ações", () => {
    const { container } = render(<VFError title="Sem permissão" />);
    expect(container.querySelector(".vf-empty__actions")).toBeNull();
  });
});

describe("VFLoading", () => {
  it("anuncia o rótulo e esconde o spinner do leitor", () => {
    const { container } = render(<VFLoading label="Carregando fechamento…" size="sm" />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando fechamento…");
    const spinner = container.querySelector(".vf-spinner");
    expect(spinner).toHaveClass("vf-spinner--sm");
    expect(spinner).toHaveAttribute("aria-hidden", "true");
  });

  it("aceita detalhe extra", () => {
    render(
      <VFLoading>
        <span>pode demorar</span>
      </VFLoading>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Carregando…pode demorar");
  });
});

describe("VFSkeleton", () => {
  it("renderiza N blocos decorativos da variante", () => {
    const { container } = render(<VFSkeleton variant="title" count={3} />);
    const blocos = container.querySelectorAll(".vf-skeleton.vf-skeleton--title");
    expect(blocos).toHaveLength(3);
    blocos.forEach((b) => {
      expect(b.tagName).toBe("DIV");
      expect(b).toHaveAttribute("aria-hidden", "true");
    });
  });
});
