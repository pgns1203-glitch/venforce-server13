// Drawer de lançamento manual (conta × competência). O servidor é a
// autoridade (validação, precedência do automático, auditoria); aqui se
// protege: escopo explícito, unidades (MC em % → fração), número pt-BR,
// derivação visível, inconsistência bloqueada e erro do servidor exibido.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LancamentoManualDrawer, lerNumeroBR } from "./LancamentoManualDrawer.jsx";

function conta(id, over = {}) {
  return {
    id, rotulo: `Conta ${id}`, ativa: true, podeLancarManual: true,
    fonte: null, resumo: null, manual: null,
    status: { codigo: "sem_integracao", rotulo: "Sem integração", motivo: "Marketplace sem integração automática" },
    ...over,
  };
}

const cliente = {
  id: 3, nome: "Coremix Loja",
  contas: [conta(31), conta(32, { podeLancarManual: false, fonte: { tipo: "api" } })],
};

function abrir(props = {}) {
  const onSalvar = props.onSalvar || vi.fn().mockResolvedValue({ ok: true });
  const onFechar = props.onFechar || vi.fn();
  const onRemover = props.onRemover || vi.fn().mockResolvedValue({ ok: true });
  render(
    <LancamentoManualDrawer
      cliente={props.cliente || cliente}
      contaInicial={props.contaInicial}
      competencia="2026-09"
      onSalvar={onSalvar}
      onRemover={onRemover}
      onFechar={onFechar}
    />
  );
  return { onSalvar, onFechar, onRemover };
}

const campo = (nome) => screen.getByLabelText(nome);

describe("lerNumeroBR", () => {
  it("aceita pt-BR e ponto decimal; vazio é null, lixo é NaN", () => {
    expect(lerNumeroBR("1.234,56")).toBe(1234.56);
    expect(lerNumeroBR("1234.56")).toBe(1234.56);
    expect(lerNumeroBR("0")).toBe(0);
    expect(lerNumeroBR("")).toBeNull();
    expect(Number.isNaN(lerNumeroBR("abc"))).toBe(true);
  });
});

describe("escopo explícito", () => {
  it("mostra cliente, competência e só as contas sem automático", () => {
    abrir();
    expect(screen.getByRole("dialog", { name: /lançar dados manuais/i })).toBeInTheDocument();
    expect(screen.getByText("Coremix Loja")).toBeInTheDocument();
    expect(screen.getByText("Setembro/2026")).toBeInTheDocument();
    const opcoes = Array.from(campo("Conta/operação").options).map((o) => o.textContent);
    expect(opcoes).toEqual(["Conta 31"]);
  });
});

describe("derivação e unidades", () => {
  it("FAT + LC mostra a MC que o servidor vai calcular e envia o que foi digitado", async () => {
    const { onSalvar, onFechar } = abrir();
    await userEvent.type(campo("Faturamento (R$)"), "1.000,00");
    await userEvent.type(campo("Lucro de contribuição (R$)"), "150");
    expect(screen.getByText(/MC calculada: 15,0%/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /salvar lançamento/i }));
    expect(onSalvar).toHaveBeenCalledWith(3, 31, {
      faturamento: 1000, lucroContribuicao: 150, margemContribuicao: null,
      investimentoAds: null, gmvAds: null, observacao: null,
    });
    expect(onFechar).toHaveBeenCalled();
  });

  it("MC é digitada em % e enviada como fração", async () => {
    const { onSalvar } = abrir();
    await userEvent.type(campo("Faturamento (R$)"), "2000");
    await userEvent.type(campo("Margem de contribuição (%)"), "18");
    expect(screen.getByText(/LC calculado: R\$ 360/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /salvar lançamento/i }));
    expect(onSalvar.mock.calls[0][2].margemContribuicao).toBeCloseTo(0.18, 9);
  });

  it("ACOS e TACoS aparecem a partir dos campos de Ads", async () => {
    abrir();
    await userEvent.type(campo("Faturamento (R$)"), "1000");
    await userEvent.type(campo("Investimento Ads (R$)"), "50");
    await userEvent.type(campo("GMV Ads (R$)"), "400");
    expect(screen.getByText(/ACOS 12,5%/)).toBeInTheDocument();
    expect(screen.getByText(/TACoS 5,0%/)).toBeInTheDocument();
  });

  it("FAT, LC e MC inconsistentes bloqueiam o envio", async () => {
    const { onSalvar } = abrir();
    await userEvent.type(campo("Faturamento (R$)"), "1000");
    await userEvent.type(campo("Lucro de contribuição (R$)"), "150");
    await userEvent.type(campo("Margem de contribuição (%)"), "30");
    expect(screen.getByRole("alert")).toHaveTextContent(/não batem/i);
    expect(screen.getByRole("button", { name: /salvar lançamento/i })).toBeDisabled();
    expect(onSalvar).not.toHaveBeenCalled();
  });

  it("sem nenhuma métrica não envia", () => {
    abrir();
    expect(screen.getByRole("button", { name: /salvar lançamento/i })).toBeDisabled();
  });
});

describe("servidor e edição", () => {
  it("mostra o erro do servidor e mantém o drawer aberto", async () => {
    const onSalvar = vi.fn().mockRejectedValue(new Error("Esta conta já tem dado automático publicado nesta competência."));
    const { onFechar } = abrir({ onSalvar });
    await userEvent.type(campo("Faturamento (R$)"), "10");
    await userEvent.click(screen.getByRole("button", { name: /salvar lançamento/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/dado automático publicado/);
    expect(onFechar).not.toHaveBeenCalled();
  });

  it("lançamento existente vem preenchido e pode ser removido em dois passos", async () => {
    const existente = conta(31, {
      fonte: { tipo: "manual", rotulo: "Manual" },
      manual: { valores: { fat: 5000, lc: 750, mc: 0.15, ads: null }, gmvAds: null, observacao: "planilha", atualizadoPor: "Ana" },
    });
    const { onRemover } = abrir({ cliente: { ...cliente, contas: [existente] }, contaInicial: existente });
    expect(campo("Faturamento (R$)")).toHaveValue("5000");
    expect(campo("Margem de contribuição (%)")).toHaveValue("15");
    expect(screen.getByText(/última alteração por Ana/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^remover lançamento$/i }));
    expect(onRemover).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /confirmar remoção/i }));
    expect(onRemover).toHaveBeenCalledWith(3, 31);
  });

  it("Escape fecha", async () => {
    const { onFechar } = abrir();
    await userEvent.keyboard("{Escape}");
    expect(onFechar).toHaveBeenCalled();
  });
});
