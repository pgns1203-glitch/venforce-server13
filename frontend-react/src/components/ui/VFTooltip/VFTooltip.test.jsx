import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VFTooltip } from "./index.js";

describe("VFTooltip", () => {
  it("abre pelo foco do teclado, com a classe da V2, e liga a descrição ao gatilho", async () => {
    const user = userEvent.setup();
    render(
      <VFTooltip content="Custo cobre 80% do faturamento">
        <span tabIndex={0} aria-label="Cobertura parcial">◐</span>
      </VFTooltip>,
    );
    await user.tab();
    const dica = await screen.findByRole("tooltip");
    expect(dica).toHaveTextContent("Custo cobre 80% do faturamento");
    expect(document.querySelector(".vf-tooltip.vf-tooltip--float")).toBeInTheDocument();
    expect(screen.getByLabelText("Cobertura parcial")).toHaveAccessibleDescription("Custo cobre 80% do faturamento");
  });

  it("Escape fecha", async () => {
    const user = userEvent.setup();
    render(
      <VFTooltip content="dica">
        <button type="button">gatilho</button>
      </VFTooltip>,
    );
    await user.tab();
    await screen.findByRole("tooltip");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("sem conteúdo devolve só o filho, sem Radix", () => {
    render(
      <VFTooltip content="">
        <span>só texto</span>
      </VFTooltip>,
    );
    expect(screen.getByText("só texto")).not.toHaveAttribute("data-state");
  });
});
