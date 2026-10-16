import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VFBanner } from "./index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** matchMedia que diz "movimento normal" (o jsdom não tem matchMedia → reduzido). */
function movimentoNormal() {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
}

describe("VFBanner", () => {
  it("monta título, descrição e ações nas partes da V2", () => {
    render(
      <VFBanner tone="warning" title="Base ausente" actions={<button type="button">Vincular</button>}>
        Sem base de custo, a margem não fecha.
      </VFBanner>,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveClass("vf-banner", "is-warning");
    expect(banner.querySelector(".vf-banner__title")).toHaveTextContent("Base ausente");
    expect(banner.querySelector(".vf-banner__description")).toHaveTextContent("Sem base de custo");
    expect(banner.querySelector(".vf-banner__actions")).toContainElement(screen.getByRole("button", { name: "Vincular" }));
  });

  it("danger vira role=alert; role explícito vence", () => {
    const { rerender } = render(<VFBanner tone="danger" title="Erro" />);
    expect(screen.getByRole("alert")).toHaveClass("is-danger");
    rerender(<VFBanner tone="warning" title="Atenção" role="alert" />);
    expect(screen.getByRole("alert")).toHaveClass("is-warning");
  });

  it("tom desconhecido ou ausente fica neutro", () => {
    render(<VFBanner tone="roxo" title="X" />);
    expect(screen.getByRole("status").className).toBe("vf-banner");
  });

  it("entra com reveal (aberto)", () => {
    const { container } = render(<VFBanner title="X" />);
    expect(container.firstChild).toHaveClass("vf-motion-collapse", "is-open", "vf-motion-reveal");
  });

  it("sem onClose não mostra o ×", () => {
    render(<VFBanner title="X" />);
    expect(screen.queryByRole("button", { name: "Fechar aviso" })).not.toBeInTheDocument();
  });

  it("movimento reduzido: × chama onClose na hora", async () => {
    const onClose = vi.fn();
    render(<VFBanner title="X" onClose={onClose} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Fechar aviso" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("movimento normal: × recolhe e só chama onClose no fim da transição (uma vez)", () => {
    movimentoNormal();
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { container } = render(<VFBanner title="X" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
    const wrapper = container.firstChild;
    expect(wrapper).not.toHaveClass("is-open");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.transitionEnd(wrapper);
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("movimento normal sem transitionend: prazo de segurança chama onClose", () => {
    movimentoNormal();
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<VFBanner title="X" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
    act(() => vi.advanceTimersByTime(400));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("transitionend de um filho não fecha antes da hora", () => {
    movimentoNormal();
    const onClose = vi.fn();
    render(<VFBanner title="X" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
    fireEvent.transitionEnd(screen.getByRole("status"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
