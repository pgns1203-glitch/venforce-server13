// VFField + controles — fiação de acessibilidade e classes, sem asserção de
// estilo computado.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { VFField, VFInput, VFSelect, VFTextarea } from "./index.js";

describe("VFField", () => {
  it("liga o <label> ao controle sem id na mão", () => {
    render(
      <VFField label="Faturamento">
        <VFInput />
      </VFField>,
    );
    expect(screen.getByLabelText("Faturamento")).toHaveClass("vf-input");
  });

  it("dica entra no aria-describedby", () => {
    render(
      <VFField label="FAT" hint="Valor bruto do mês">
        <VFInput />
      </VFField>,
    );
    expect(screen.getByLabelText("FAT")).toHaveAccessibleDescription("Valor bruto do mês");
  });

  it("erro com texto: role=alert, aria-invalid, is-error no campo e no controle, descrição soma dica + erro", () => {
    const { container } = render(
      <VFField label="FAT" hint="Valor bruto" error="Use só números">
        <VFInput />
      </VFField>,
    );
    const input = screen.getByLabelText("FAT");
    expect(screen.getByRole("alert")).toHaveTextContent("Use só números");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveClass("is-error");
    expect(input).toHaveAccessibleDescription("Valor bruto Use só números");
    expect(container.firstChild).toHaveClass("vf-field", "is-error");
  });

  it("error={true} marca inválido sem mensagem", () => {
    render(
      <VFField label="FAT" error>
        <VFInput />
      </VFField>,
    );
    expect(screen.getByLabelText("FAT")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sem erro não renderiza alerta nem aria-invalid", () => {
    render(
      <VFField label="FAT">
        <VFInput />
      </VFField>,
    );
    expect(screen.getByLabelText("FAT")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("required mostra * (oculto do leitor) e marca aria-required", () => {
    render(
      <VFField label="Conta" required>
        <VFInput />
      </VFField>,
    );
    // nome acessível sem o "*": o asterisco é aria-hidden
    const input = screen.getByRole("textbox", { name: "Conta" });
    expect(input).toHaveAttribute("aria-required", "true");
    expect(input).not.toHaveAttribute("required");
  });

  it("success sem erro marca is-success", () => {
    render(
      <VFField label="FAT" success>
        <VFInput />
      </VFField>,
    );
    expect(screen.getByLabelText("FAT")).toHaveClass("is-success");
  });

  it("id explícito do campo vale para label e controle", () => {
    render(
      <VFField label="Obs" id="obs-x">
        <VFTextarea />
      </VFField>,
    );
    expect(screen.getByLabelText("Obs")).toHaveAttribute("id", "obs-x");
  });

  it("prop do controle vence o contexto (aria-invalid explícito)", () => {
    render(
      <VFField label="FAT">
        <VFInput aria-invalid />
      </VFField>,
    );
    expect(screen.getByLabelText("FAT")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("controles", () => {
  it("VFInput sozinho: size, ref, props nativas e digitação", async () => {
    const ref = createRef();
    render(<VFInput ref={ref} size="sm" aria-label="Busca" placeholder="Buscar" />);
    const input = screen.getByRole("textbox", { name: "Busca" });
    expect(input).toHaveClass("vf-input", "vf-input--sm");
    expect(ref.current).toBe(input);
    await userEvent.setup().type(input, "abc");
    expect(input).toHaveValue("abc");
  });

  it("VFSelect com options e placeholder", () => {
    render(
      <VFField label="Conta">
        <VFSelect
          size="lg"
          placeholder="Escolha"
          defaultValue=""
          options={[
            { value: "1", label: "Loja A" },
            { value: "2", label: "Loja B", disabled: true },
          ]}
        />
      </VFField>,
    );
    const select = screen.getByLabelText("Conta");
    expect(select).toHaveClass("vf-select", "vf-select--lg");
    const opcoes = screen.getAllByRole("option");
    expect(opcoes.map((o) => o.textContent)).toEqual(["Escolha", "Loja A", "Loja B"]);
    expect(opcoes[0]).toBeDisabled();
    expect(opcoes[2]).toBeDisabled();
  });

  it("VFSelect aceita children", () => {
    render(
      <VFSelect aria-label="Mês">
        <option value="1">Jan</option>
      </VFSelect>,
    );
    expect(screen.getByRole("combobox", { name: "Mês" })).toHaveTextContent("Jan");
  });

  it("VFTextarea usa .vf-textarea e ignora size", () => {
    render(<VFTextarea aria-label="Obs" size="sm" />);
    const t = screen.getByRole("textbox", { name: "Obs" });
    expect(t).toHaveClass("vf-textarea");
    expect(t).not.toHaveClass("vf-textarea--sm");
  });
});
