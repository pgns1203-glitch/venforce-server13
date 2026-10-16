import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VFKpi } from "./index.js";

describe("VFKpi", () => {
  it("rótulo + valor formatado nas partes da V2", () => {
    const { container } = render(<VFKpi label="Ruptura" value={12} tone="danger" />);
    const kpi = container.firstChild;
    expect(kpi.tagName).toBe("DIV");
    expect(kpi).toHaveClass("vf-kpi", "vf-kpi--danger");
    expect(kpi.querySelector(".vf-kpi__label")).toHaveTextContent("Ruptura");
    expect(kpi.querySelector(".vf-kpi__value")).toHaveTextContent("12");
  });

  it("moeda: valor --currency com o R$ em .vf-kpi__currency", () => {
    const { container } = render(<VFKpi label="Faturamento" value={1500} format="brl" />);
    const valor = container.querySelector(".vf-kpi__value");
    expect(valor).toHaveClass("vf-kpi__value--currency");
    expect(valor.querySelector(".vf-kpi__currency")).toHaveTextContent("R$");
    expect(valor).toHaveTextContent("1.500,00");
  });

  it("tendência e rodapé com tom", () => {
    const { container } = render(
      <VFKpi label="MC" value={0.18} format="pct" trend="+2,1 pp" trendTone="success" foot="vs. mês anterior" footTone="warning" />,
    );
    expect(container.querySelector(".vf-kpi__trend")).toHaveClass("is-success");
    expect(container.querySelector(".vf-kpi__foot")).toHaveClass("is-warning");
  });

  it("onClick vira <button> interativo com aria-pressed", async () => {
    const onClick = vi.fn();
    render(<VFKpi label="Sem custo" value={4} onClick={onClick} active />);
    const btn = screen.getByRole("button", { name: /Sem custo/ });
    expect(btn).toHaveClass("vf-kpi--interactive", "is-active");
    expect(btn).toHaveAttribute("aria-pressed", "true");
    await userEvent.setup().click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("enterIndex entra em sequência (30 ms por posição)", () => {
    const { container } = render(<VFKpi label="X" value={1} enterIndex={3} />);
    const kpi = container.firstChild;
    expect(kpi).toHaveClass("vf-motion-enter");
    expect(kpi.style.getPropertyValue("--vf-motion-delay")).toBe("90ms");
  });

  it("sem enterIndex não anima entrada", () => {
    const { container } = render(<VFKpi label="X" value={1} featured />);
    expect(container.firstChild).toHaveClass("vf-kpi--featured");
    expect(container.firstChild).not.toHaveClass("vf-motion-enter");
  });

  it("valor ausente vira —", () => {
    const { container } = render(<VFKpi label="X" value={null} format="brl" />);
    expect(container.querySelector(".vf-kpi__value").textContent).toBe("—");
  });
});
