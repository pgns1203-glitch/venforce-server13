// Convergência #3 — o fluxo nativo de GERAR + SALVAR fechamento no V3.
// Cobre o que a missão exige (§13 competência divergente, §15 duplicidade,
// §23 novos testes do Financeiro nativo): validação de arquivos, envio
// multipart com periodo + clienteContaId, competência declarada, e o 409
// ENTREGA_JA_EXISTE virando "substituir" (que preserva o token público).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NovoFechamento } from "./NovoFechamento.jsx";
import { montarPayloadFechamento, parseMoedaBR, cardsDoSummary } from "../../utils/fechamentoPayload.js";
import { FechamentoApiError } from "../../services/financeiroFechamentoApi.js";

const api = vi.hoisted(() => ({ processar: vi.fn(), salvar: vi.fn() }));
vi.mock("../../services/financeiroFechamentoApi.js", async (orig) => ({
  ...(await orig()),
  processarFechamento: api.processar,
  salvarEntregaFechamento: api.salvar,
}));

const SUMMARY = {
  marketplace: "meli",
  grossRevenueTotal: 100000,
  paidRevenueTotal: 92000,
  contributionProfitTotal: 18000,
  averageContributionMargin: 0.2,
  finalResult: 12000,
  tacos: 0.05,
};

function respostaOk(extra = {}) {
  return {
    ok: true,
    summary: SUMMARY,
    competencia: { periodoSolicitado: "2026-08", periodoDetectado: "2026-08", divergente: false },
    detailedRows: [{ id: "MLB1", mc: 0.2 }],
    unmatchedIds: [],
    ...extra,
  };
}

const props = {
  clienteSlug: "n97",
  clienteNome: "N97 Comercial",
  clienteContaId: 42,
  periodo: "2026-08",
  periodoLabel: "Agosto/2026",
  onSalvo: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

async function preencherFormularioMeli(usuario) {
  await usuario.selectOptions(screen.getByLabelText(/Marketplace/), "meli");
  const arquivo = new File(["a"], "vendas.xlsx", { type: "application/vnd.ms-excel" });
  await usuario.upload(screen.getByLabelText(/Planilha de vendas/), arquivo);
}

async function preencherFormularioShopee(usuario) {
  await usuario.selectOptions(screen.getByLabelText(/Marketplace/), "shopee");
  const vendas = new File(["a"], "vendas.xlsx", { type: "application/vnd.ms-excel" });
  await usuario.upload(screen.getByLabelText(/Planilha de vendas/), vendas);
  const custos = new File(["a"], "custos.xlsx", { type: "application/vnd.ms-excel" });
  await usuario.upload(screen.getByLabelText(/Planilha de custos/), custos);
}

describe("fechamentoPayload", () => {
  it("parseMoedaBR entende pt-BR, vazio e número simples", () => {
    expect(parseMoedaBR("3.011,00")).toBe(3011);
    expect(parseMoedaBR("50")).toBe(50);
    expect(parseMoedaBR("")).toBeNull();
    expect(parseMoedaBR(null)).toBeNull();
  });

  it("montarPayloadFechamento congela a identidade do cliente e marca a origem nativa", () => {
    const p = montarPayloadFechamento({
      processamento: respostaOk(),
      clienteSlug: "n97",
      clienteNome: "N97",
      periodo: "2026-08",
      marketplace: "meli",
      ajustes: { ads: "1.000,00" },
    });
    expect(p.tipo).toBe("fechamento_mensal");
    expect(p.cliente.slug).toBe("n97"); // trava validarIdentidadeFechamento
    expect(p.periodo).toBe("2026-08");
    expect(p.summary).toEqual(SUMMARY);
    expect(p.metadados.origem).toBe("financeiro-v3-nativo");
    expect(p.metadados.ads).toBe(1000);
    expect(Array.isArray(p.cards)).toBe(true);
  });

  it("cardsDoSummary nunca inventa R$0 para campo ausente", () => {
    const cards = cardsDoSummary({ grossRevenueTotal: 100000 });
    const semReceita = cards.find((c) => c.titulo === "Receita Líquida");
    expect(semReceita.disponivel).toBe(false);
    expect(semReceita.valor).toBeNull();
  });
});

describe("NovoFechamento · validação e envio", () => {
  it("sem marketplace/arquivo, o botão Processar fica desabilitado", () => {
    render(<NovoFechamento {...props} />);
    expect(screen.getByRole("button", { name: "Processar fechamento" })).toBeDisabled();
  });

  it("Shopee exige planilha de custos; MELI não (usa base vinculada)", async () => {
    const usuario = userEvent.setup();
    render(<NovoFechamento {...props} />);
    await usuario.selectOptions(screen.getByLabelText(/Marketplace/), "shopee");
    const vendas = new File(["a"], "vendas.xlsx");
    await usuario.upload(screen.getByLabelText(/Planilha de vendas/), vendas);
    expect(screen.getByText(/Shopee exige a planilha de custos/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Processar fechamento" })).toBeDisabled();
  });

  it("envia multipart com periodo + clienteContaId e mostra o preview", async () => {
    api.processar.mockResolvedValue(respostaOk());
    const usuario = userEvent.setup();
    render(<NovoFechamento {...props} />);
    await preencherFormularioMeli(usuario);
    await usuario.click(screen.getByRole("button", { name: "Processar fechamento" }));

    await waitFor(() => expect(api.processar).toHaveBeenCalled());
    const form = api.processar.mock.calls[0][0];
    expect(form.get("periodo")).toBe("2026-08");
    expect(form.get("clienteContaId")).toBe("42");
    expect(form.get("marketplace")).toBe("meli");
    expect(await screen.findByText(/Competência confere/)).toBeInTheDocument();
  });
});

describe("NovoFechamento · competência divergente (§13)", () => {
  it("não deixa salvar até o usuário confirmar a divergência explicitamente", async () => {
    api.processar.mockResolvedValue(
      respostaOk({
        competencia: {
          periodoSolicitado: "2026-08",
          periodoDetectado: "2026-07",
          divergente: true,
          motivo: "As datas das vendas caem em julho/2026.",
        },
      })
    );
    const usuario = userEvent.setup();
    render(<NovoFechamento {...props} />);
    await preencherFormularioMeli(usuario);
    await usuario.click(screen.getByRole("button", { name: "Processar fechamento" }));

    expect(await screen.findByText(/não bate com o período em tela/)).toBeInTheDocument();
    const salvar = screen.getByRole("button", { name: "Salvar fechamento" });
    expect(salvar).toBeDisabled();

    await usuario.click(screen.getByRole("checkbox"));
    expect(salvar).toBeEnabled();
  });
});

describe("NovoFechamento · duplicidade 409 (§15)", () => {
  it("409 ENTREGA_JA_EXISTE vira escolha cancelar/substituir; substituir manda substituir:true", async () => {
    api.processar.mockResolvedValue(respostaOk());
    api.salvar
      .mockRejectedValueOnce(
        new FechamentoApiError("Já existe.", { status: 409, codigo: "ENTREGA_JA_EXISTE", entregaId: 77, publicado: true })
      )
      .mockResolvedValueOnce({ id: 77, token_publico: "tok-x", publicado: true });
    const usuario = userEvent.setup();
    render(<NovoFechamento {...props} />);
    await preencherFormularioMeli(usuario);
    await usuario.click(screen.getByRole("button", { name: "Processar fechamento" }));
    await screen.findByText(/Competência confere/);
    await usuario.click(screen.getByRole("button", { name: "Salvar fechamento" }));

    // publicado → aviso mais forte
    expect(await screen.findByText(/já tem um fechamento PUBLICADO/)).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Substituir" }));
    await waitFor(() => expect(api.salvar).toHaveBeenCalledTimes(2));
    expect(api.salvar.mock.calls[1][0].substituir).toBe(true);
    expect(api.salvar.mock.calls[1][0].cliente_conta_id).toBe(42);
    expect(props.onSalvo).toHaveBeenCalled();
  });

  // Convergência #4 §10 — a lógica de 409/substituir mora inteiramente no
  // handler de "Salvar" (montarPayloadFechamento/salvarEntregaFechamento),
  // sem NENHUM `if (marketplace === "meli")`. Isso já era conhecido pelo
  // código, mas nunca tinha uma fixture Shopee provando: fecha a lacuna de
  // evidência apontada no checkpoint da Pessoa 1 (§12) para Salvar/
  // Duplicidade/Substituir.
  it("Shopee: 409 ENTREGA_JA_EXISTE também vira escolha cancelar/substituir", async () => {
    api.processar.mockResolvedValue(respostaOk({ summary: { ...SUMMARY, marketplace: "shopee" } }));
    api.salvar
      .mockRejectedValueOnce(
        new FechamentoApiError("Já existe.", { status: 409, codigo: "ENTREGA_JA_EXISTE", entregaId: 78, publicado: false })
      )
      .mockResolvedValueOnce({ id: 78, token_publico: "tok-shopee", publicado: false });
    const usuario = userEvent.setup();
    render(<NovoFechamento {...props} />);
    await preencherFormularioShopee(usuario);
    await usuario.click(screen.getByRole("button", { name: "Processar fechamento" }));
    await screen.findByText(/Competência confere/);
    await usuario.click(screen.getByRole("button", { name: "Salvar fechamento" }));

    // rascunho (não publicado) → aviso, sem o reforço de "PUBLICADO"
    expect(await screen.findByText(/já (tem|existe) um fechamento/i)).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Substituir" }));
    await waitFor(() => expect(api.salvar).toHaveBeenCalledTimes(2));
    expect(api.salvar.mock.calls[1][0].substituir).toBe(true);
    expect(api.salvar.mock.calls[1][0].cliente_conta_id).toBe(42);
    expect(props.onSalvo).toHaveBeenCalled();
  });
});
