import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VFStatus, VFTag, VFBadge } from "./index.js";

describe("VFStatus / VFTag", () => {
  it("VFStatus aplica o tom e repassa props", () => {
    render(
      <VFStatus tone="warning" role="status">
        Base desatualizada
      </VFStatus>,
    );
    expect(screen.getByRole("status")).toHaveClass("vf-status", "is-warning");
  });

  it("VFStatus aceita o tom 'empty' (sem dado) e ignora tom inválido", () => {
    const { rerender } = render(<VFStatus tone="empty">Sem dado</VFStatus>);
    expect(screen.getByText("Sem dado")).toHaveClass("is-empty");
    rerender(<VFStatus tone="neutral">Sem dado</VFStatus>);
    expect(screen.getByText("Sem dado").className).toBe("vf-status");
  });

  it("VFTag aplica o tom, inclusive neutral", () => {
    render(<VFTag tone="neutral">Full</VFTag>);
    expect(screen.getByText("Full")).toHaveClass("vf-tag", "is-neutral");
  });
});

describe("VFBadge", () => {
  it("não pula ao montar", () => {
    render(<VFBadge tone="danger">3</VFBadge>);
    const b = screen.getByText("3");
    expect(b).toHaveClass("vf-badge", "is-danger");
    expect(b).not.toHaveClass("vf-motion-bump");
  });

  it("pula quando o número muda, remontando o elemento", () => {
    const { rerender } = render(<VFBadge>3</VFBadge>);
    const antes = screen.getByText("3");
    rerender(<VFBadge>2</VFBadge>);
    const depois = screen.getByText("2");
    expect(depois).toHaveClass("vf-motion-bump");
    expect(depois).not.toBe(antes);
  });

  it("re-render com o mesmo número não pula de novo", () => {
    const { rerender } = render(<VFBadge>3</VFBadge>);
    rerender(<VFBadge>2</VFBadge>);
    const el = screen.getByText("2");
    rerender(<VFBadge>2</VFBadge>);
    expect(screen.getByText("2")).toBe(el);
  });
});
