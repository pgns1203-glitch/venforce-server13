import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { VFTabs } from "./index.js";

const ABAS = [
  { value: null, label: "Consolidado" },
  { value: "MLB", label: "Mercado Livre" },
  { value: "SHOPEE", label: "Shopee" },
];

function Controlado({ inicial = null, onChange = () => {}, tabs = ABAS }) {
  const [v, setV] = useState(inicial);
  return (
    <VFTabs
      tabs={tabs}
      value={v}
      ariaLabel="Seção"
      onValueChange={(novo) => {
        setV(novo);
        onChange(novo);
      }}
    />
  );
}

describe("VFTabs", () => {
  it("tablist nomeada, abas nas classes da V2, ativa com is-active e aria-selected", () => {
    render(<Controlado inicial="MLB" />);
    const lista = screen.getByRole("tablist", { name: "Seção" });
    expect(lista).toHaveClass("vf-tabs", "vf-tabs--indicator");
    const ml = screen.getByRole("tab", { name: "Mercado Livre" });
    expect(ml).toHaveClass("vf-tab", "is-active");
    expect(ml).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Shopee" })).not.toHaveClass("is-active");
  });

  it("clique seleciona e devolve o valor original (inclusive null)", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlado inicial="MLB" onChange={onChange} />);
    await user.click(screen.getByRole("tab", { name: "Consolidado" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("tab", { name: "Consolidado" })).toHaveAttribute("aria-selected", "true");
  });

  it("setas, Home e End movem o foco e selecionam", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlado onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole("tab", { name: "Consolidado" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Mercado Livre" })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith("MLB");
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("SHOPEE");
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("só a aba ativa entra na ordem de Tab", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Controlado inicial="SHOPEE" />
        <button type="button">depois</button>
      </>,
    );
    await user.tab();
    expect(screen.getByRole("tab", { name: "Shopee" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "depois" })).toHaveFocus();
  });

  it("aba desabilitada não é selecionável", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlado onChange={onChange} tabs={[...ABAS, { value: "TIKTOK", label: "TikTok", disabled: true }]} />);
    await user.click(screen.getByRole("tab", { name: "TikTok" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("aria-controls só quando há panelId; traço indicador decorativo", () => {
    render(<VFTabs ariaLabel="X" value="a" onValueChange={() => {}} tabs={[{ value: "a", label: "A", panelId: "painel-a" }, { value: "b", label: "B" }]} />);
    expect(screen.getByRole("tab", { name: "A" })).toHaveAttribute("aria-controls", "painel-a");
    expect(screen.getByRole("tab", { name: "B" })).not.toHaveAttribute("aria-controls");
    expect(document.querySelector(".vf-tabs__indicator")).toHaveAttribute("aria-hidden", "true");
  });
});
