// VFButton — testes de comportamento (classes/atributos/interação), sem
// asserção de estilo computado: os tokens --vf-* só existem via <link> no
// HTML real.

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { VFButton, useFeedbackOk } from "./index.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("VFButton", () => {
  it("padrão: <button type=button> secundário", () => {
    render(<VFButton>Salvar</VFButton>);
    const btn = screen.getByRole("button", { name: "Salvar" });
    expect(btn).toHaveAttribute("type", "button");
    expect(btn).toHaveClass("vf-btn", "vf-btn--secondary");
  });

  it("traduz variant/size/icon/full/active em modificadores", () => {
    render(
      <VFButton variant="primary" size="lg" icon full active aria-label="Adicionar">
        +
      </VFButton>,
    );
    expect(screen.getByRole("button", { name: /Adicionar/ })).toHaveClass(
      "vf-btn--primary",
      "vf-btn--lg",
      "vf-btn--icon",
      "vf-btn--full",
      "is-active",
    );
  });

  it("variant desconhecida cai em secondary", () => {
    render(<VFButton variant="roxo">X</VFButton>);
    expect(screen.getByRole("button")).toHaveClass("vf-btn--secondary");
  });

  it("loading marca is-loading e aria-busy", () => {
    render(<VFButton loading>Salvar</VFButton>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("is-loading");
    expect(btn).toHaveAttribute("aria-busy", "true");
  });

  it("feedback=ok marca is-done e anuncia o rótulo de conclusão", () => {
    const { rerender } = render(<VFButton>Salvar</VFButton>);
    const regiao = screen.getByRole("button").querySelector("[aria-live]");
    expect(regiao).toHaveTextContent("");
    rerender(<VFButton feedback="ok">Salvar</VFButton>);
    expect(screen.getByRole("button")).toHaveClass("is-done");
    expect(regiao).toHaveTextContent("Concluído");
  });

  it("loading tem prioridade sobre feedback", () => {
    render(
      <VFButton loading feedback="ok">
        Salvar
      </VFButton>,
    );
    expect(screen.getByRole("button")).not.toHaveClass("is-done");
  });

  it("repassa props nativas, className e ref", async () => {
    const onClick = vi.fn();
    const ref = createRef();
    render(
      <VFButton ref={ref} className="extra" data-x="1" onClick={onClick}>
        Ir
      </VFButton>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("vf-btn", "extra");
    expect(btn).toHaveAttribute("data-x", "1");
    expect(ref.current).toBe(btn);
    await userEvent.setup().click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disabled não dispara onClick", async () => {
    const onClick = vi.fn();
    render(
      <VFButton disabled onClick={onClick}>
        Ir
      </VFButton>,
    );
    await userEvent.setup().click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("href vira <a>; desabilitado perde o href e sai da ordem de tab", () => {
    const { rerender } = render(<VFButton href="/bases.html">Bases</VFButton>);
    expect(screen.getByRole("link", { name: "Bases" })).toHaveAttribute("href", "/bases.html");
    rerender(
      <VFButton href="/bases.html" disabled>
        Bases
      </VFButton>,
    );
    const a = screen.getByText("Bases").closest("a");
    expect(a).not.toHaveAttribute("href");
    expect(a).toHaveAttribute("aria-disabled", "true");
    expect(a).toHaveAttribute("tabindex", "-1");
    expect(a).toHaveClass("is-disabled");
  });
});

describe("useFeedbackOk", () => {
  it("confirmar() liga 'ok' e volta a null depois da duração", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFeedbackOk(1000));
    expect(result.current[0]).toBeNull();
    act(() => result.current[1]());
    expect(result.current[0]).toBe("ok");
    act(() => vi.advanceTimersByTime(999));
    expect(result.current[0]).toBe("ok");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current[0]).toBeNull();
  });

  it("confirmar de novo reinicia o prazo", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFeedbackOk(1000));
    act(() => result.current[1]());
    act(() => vi.advanceTimersByTime(800));
    act(() => result.current[1]());
    act(() => vi.advanceTimersByTime(800));
    expect(result.current[0]).toBe("ok");
  });
});
