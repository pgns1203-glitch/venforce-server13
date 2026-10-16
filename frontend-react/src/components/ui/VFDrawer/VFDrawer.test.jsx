// VFDrawer — comportamento (o Radix entrega foco/ESC/clique fora; aqui se
// confere que a ligação com a V2 e o contrato "montar = abrir" funcionam).

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { VFDrawer } from "./index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function movimentoNormal() {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
}

function Abridor({ onClose = () => {}, ...props }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAberto(true)}>
        Abrir detalhe
      </button>
      {aberto && (
        <VFDrawer
          title="Inventário"
          onClose={() => {
            setAberto(false);
            onClose();
          }}
          {...props}
        >
          <button type="button">Ação interna</button>
        </VFDrawer>
      )}
    </>
  );
}

describe("VFDrawer", () => {
  it("é um diálogo modal com o título como nome, nas classes da V2, em <body>", async () => {
    render(<VFDrawer title="Inventário" subtitle="MLB123" onClose={() => {}} size="lg" footer={<span>rodapé</span>} />);
    const dialogo = await screen.findByRole("dialog", { name: "Inventário" });
    expect(dialogo).toHaveClass("vf-drawer", "vf-drawer--lg");
    expect(dialogo).toHaveAccessibleDescription("MLB123");
    expect(dialogo.parentElement).toBe(document.body);
    expect(dialogo.querySelector(".vf-drawer__footer")).toHaveTextContent("rodapé");
    expect(document.querySelector(".vf-drawer-backdrop")).toBeInTheDocument();
  });

  it("entra com is-open (no painel e no fundo)", async () => {
    render(<VFDrawer title="X" onClose={() => {}} />);
    const dialogo = await screen.findByRole("dialog");
    await vi.waitFor(() => expect(dialogo).toHaveClass("is-open"));
    expect(document.querySelector(".vf-drawer-backdrop")).toHaveClass("is-open");
  });

  it("foca o × ao abrir e devolve o foco a quem abriu ao fechar", async () => {
    const user = userEvent.setup();
    render(<Abridor />);
    const abrir = screen.getByRole("button", { name: "Abrir detalhe" });
    await user.click(abrir);
    expect(await screen.findByRole("button", { name: "Fechar" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // o Radix devolve o foco no tick seguinte à desmontagem
    await vi.waitFor(() => expect(abrir).toHaveFocus());
  });

  it("initialFocusRef escolhe onde o foco começa", async () => {
    function ComCampo() {
      const ref = useRef(null);
      return (
        <VFDrawer title="Lançar" onClose={() => {}} initialFocusRef={ref}>
          <input ref={ref} aria-label="FAT" />
        </VFDrawer>
      );
    }
    render(<ComCampo />);
    expect(await screen.findByRole("textbox", { name: "FAT" })).toHaveFocus();
  });

  it("× e clique no fundo fecham", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Abridor onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Abrir detalhe" }));
    await user.click(await screen.findByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Abrir detalhe" }));
    await screen.findByRole("dialog");
    fireEvent.pointerDown(document.querySelector(".vf-drawer-backdrop"));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });

  it("Tab fica preso dentro do painel", async () => {
    const user = userEvent.setup();
    render(<Abridor />);
    await user.click(screen.getByRole("button", { name: "Abrir detalhe" }));
    const fechar = await screen.findByRole("button", { name: "Fechar" });
    await user.tab();
    expect(screen.getByRole("button", { name: "Ação interna" })).toHaveFocus();
    await user.tab();
    expect(fechar).toHaveFocus();
  });

  it("movimento normal: desliza para fora e só então chama onClose (uma vez)", async () => {
    movimentoNormal();
    const onClose = vi.fn();
    render(<VFDrawer title="X" onClose={onClose} />);
    const dialogo = await screen.findByRole("dialog");
    await vi.waitFor(() => expect(dialogo).toHaveClass("is-open"));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(dialogo).not.toHaveClass("is-open");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.transitionEnd(dialogo);
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("movimento normal sem transitionend: prazo de segurança fecha", async () => {
    movimentoNormal();
    const onClose = vi.fn();
    render(<VFDrawer title="X" onClose={onClose} />);
    await screen.findByRole("dialog");
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    act(() => vi.advanceTimersByTime(400));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
