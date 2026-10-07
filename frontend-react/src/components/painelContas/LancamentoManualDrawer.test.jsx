// Drawer de lançamento manual (conta × competência). O servidor é a
// autoridade (validação, precedência do automático, auditoria); aqui se
// protege: escopo explícito, unidades (MC em % → fração), número pt-BR,
// derivação visível, inconsistência bloqueada e erro do servidor exibido.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LancamentoManualDrawer, lerNumeroBR, limitesDataReferencia } from "./LancamentoManualDrawer.jsx";

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
      investimentoAds: null, gmvAds: null, dataReferencia: null, observacao: null,
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
      manual: {
        valores: { fat: 5000, lc: 750, mc: 0.15, ads: null }, gmvAds: null, observacao: "planilha",
        atualizadoPor: "Ana", atualizadoEm: "2026-10-01T13:35:00.000Z", dataReferencia: "2026-09-30",
        criadoPor: "Beto", criadoEm: "2026-09-05T12:00:00.000Z", statusRegistro: "vigente",
      },
    });
    const { onRemover } = abrir({ cliente: { ...cliente, contas: [existente] }, contaInicial: existente });
    expect(campo("Faturamento (R$)")).toHaveValue("5000");
    expect(campo("Margem de contribuição (%)")).toHaveValue("15");
    expect(campo("Dados até")).toHaveValue("2026-09-30");
    const registro = screen.getByRole("region", { name: /registro do lançamento/i });
    expect(registro).toHaveTextContent("Conta 31 · Setembro/2026");
    expect(registro).toHaveTextContent("Dados até30/09/2026");
    expect(registro).toHaveTextContent("ResponsávelAna");
    expect(registro).toHaveTextContent("FonteManual");
    expect(registro).toHaveTextContent("StatusVigente");
    expect(registro).toHaveTextContent(/Criado.*por Beto/);

    await userEvent.click(screen.getByRole("button", { name: /^remover lançamento$/i }));
    expect(onRemover).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /confirmar remoção/i }));
    expect(onRemover).toHaveBeenCalledWith(3, 31);
  });

  it("lançamento substituído pelo automático diz que está guardado", () => {
    const guardado = conta(31, {
      fonte: { tipo: "manual", rotulo: "Manual" },
      manual: { valores: { fat: 1 }, statusRegistro: "substituido_por_automatico", atualizadoPor: "Ana" },
    });
    abrir({ cliente: { ...cliente, contas: [guardado] }, contaInicial: guardado });
    expect(screen.getByRole("region", { name: /registro do lançamento/i })).toHaveTextContent(/guardado — o automático é o exibido/i);
  });

  it("Escape fecha", async () => {
    const { onFechar } = abrir();
    await userEvent.keyboard("{Escape}");
    expect(onFechar).toHaveBeenCalled();
  });
});

describe("dados até", () => {
  it("envia a data de referência informada", async () => {
    const { onSalvar } = abrir();
    await userEvent.type(campo("Faturamento (R$)"), "10");
    await userEvent.type(campo("Dados até"), "2026-09-15");
    await userEvent.click(screen.getByRole("button", { name: /salvar lançamento/i }));
    expect(onSalvar.mock.calls[0][2].dataReferencia).toBe("2026-09-15");
  });

  it("data fora da competência bloqueia o envio", async () => {
    const { onSalvar } = abrir();
    await userEvent.type(campo("Faturamento (R$)"), "10");
    await userEvent.type(campo("Dados até"), "2026-08-31");
    expect(screen.getByRole("alert")).toHaveTextContent(/precisa estar em Setembro\/2026/);
    expect(screen.getByRole("button", { name: /salvar lançamento/i })).toBeDisabled();
    expect(onSalvar).not.toHaveBeenCalled();
  });

  it("limites: dentro do mês e nunca depois de hoje", () => {
    expect(limitesDataReferencia("2026-09", "2026-10-01")).toEqual({ min: "2026-09-01", max: "2026-09-30" });
    expect(limitesDataReferencia("2026-10", "2026-10-01")).toEqual({ min: "2026-10-01", max: "2026-10-01" });
    expect(limitesDataReferencia("2026-02", "2026-10-01")).toEqual({ min: "2026-02-01", max: "2026-02-28" });
  });
});

describe("rastreabilidade sob demanda", () => {
  const manual = conta(31, {
    fonte: { tipo: "manual", rotulo: "Manual" },
    manual: { valores: { fat: 5000 }, atualizadoPor: "Ana", statusRegistro: "vigente" },
  });

  it("trilha só é lida ao abrir e mostra ação, autor e valores", async () => {
    const onCarregarHistorico = vi.fn().mockResolvedValue({
      historico: [
        { id: 2, acao: "alterado", em: "2026-10-01T13:35:00.000Z", por: "Ana", valores: { faturamento: 5000, dataReferencia: "2026-09-30" } },
        { id: 1, acao: "criado", em: "2026-09-05T12:00:00.000Z", por: "Beto", valores: { faturamento: 4000 } },
      ],
    });
    render(
      <LancamentoManualDrawer cliente={{ ...cliente, contas: [manual] }} contaInicial={manual} competencia="2026-09"
        onSalvar={vi.fn()} onRemover={vi.fn()} onFechar={vi.fn()} onCarregarHistorico={onCarregarHistorico} />
    );
    expect(onCarregarHistorico).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("Histórico de alterações"));
    expect(onCarregarHistorico).toHaveBeenCalledWith(3, 31, "2026-09");
    const itens = await screen.findAllByRole("listitem");
    expect(itens[0]).toHaveTextContent(/Alterado.*Ana/);
    expect(itens[0]).toHaveTextContent(/FAT R\$\s?5\.000.*dados até 30\/09\/2026/);
    expect(itens[1]).toHaveTextContent(/Criado.*Beto/);
  });

  it("competências lançadas da conta: a atual marcada, as outras abrem a tela naquele mês", async () => {
    const onIrParaCompetencia = vi.fn();
    const onCarregarLancamentos = vi.fn().mockResolvedValue({
      lancamentos: [
        { competencia: "2026-10", valores: { fat: 7000 }, dataReferencia: "2026-10-01" },
        { competencia: "2026-09", valores: { fat: 5000 }, dataReferencia: null },
        { competencia: "2026-08", valores: { fat: 4000 }, dataReferencia: "2026-08-31" },
      ],
    });
    render(
      <LancamentoManualDrawer cliente={{ ...cliente, contas: [manual] }} contaInicial={manual} competencia="2026-09"
        onSalvar={vi.fn()} onRemover={vi.fn()} onFechar={vi.fn()}
        onCarregarLancamentos={onCarregarLancamentos} onIrParaCompetencia={onIrParaCompetencia} />
    );
    const secao = await screen.findByRole("region", { name: /competências lançadas/i });
    expect(onCarregarLancamentos).toHaveBeenCalledWith(3, 31);
    expect(secao).toHaveTextContent("esta tela");
    await userEvent.click(screen.getByRole("button", { name: /abrir agosto\/2026/i }));
    expect(onIrParaCompetencia).toHaveBeenCalledWith(3, 31, "2026-08");
  });
});

describe("modo manual", () => {
  it("conta ML com manual vigente reabre preenchida com o valor gravado e mostra a referência da API", () => {
    const ml = conta(11, {
      rotulo: "Mercado Livre 1 · ACME", fonte: { tipo: "manual", rotulo: "Manual" },
      resumo: { fat: 3000000 },
      referenciaApi: { fat: 2833602, dadosAte: "2026-09-28", rotulo: "API" },
      manual: { valores: { fat: 3000000, lc: 450000, mc: 0.15, ads: null }, gmvAds: null, statusRegistro: "vigente", atualizadoPor: "Ana" },
    });
    render(
      <LancamentoManualDrawer
        cliente={{ id: 1, nome: "AMR", contas: [ml] }} contaInicial={ml} competencia="2026-09"
        onSalvar={vi.fn()} onRemover={vi.fn()} onFechar={vi.fn()} modoManual
      />
    );
    expect(campo("Faturamento (R$)")).toHaveValue("3000000");
    expect(campo("Lucro de contribuição (R$)")).toHaveValue("450000");
    expect(screen.getByTestId("referencia-api")).toHaveTextContent("Referência da API");
    expect(screen.getByText(/prevalece sobre a API/)).toBeInTheDocument();
  });
});
