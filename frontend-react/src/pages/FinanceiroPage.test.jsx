// Testes de render do Financeiro V3 — paridade operacional.
//
// A página tem três áreas (Fechamento · Relatórios gerados · Histórico). As
// antigas abas Resultado/Conciliação viraram blocos da aba Fechamento. O
// que se protege aqui:
//   · honestidade M6: item sem valor nunca vira R$ 0,00;
//   · contexto do Shell (cliente/marketplace/conta) só em leitura;
//   · competência por extenso, status DESTA conta e troca com confirmação;
//   · publicar/despublicar só na entrega desta conta, nomeando a competência.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FinanceiroPage from "./FinanceiroPage.jsx";

const mocks = vi.hoisted(() => ({
  useOperacaoAtual: vi.fn(),
  useFinanceiro: vi.fn(),
  useEntregasFechamento: vi.fn(),
  requisitar: vi.fn(),
  setPeriodo: vi.fn(),
}));

vi.mock("../hooks/useVfContext.js", () => ({ useOperacaoAtual: mocks.useOperacaoAtual }));
vi.mock("../hooks/useFinanceiro.js", () => ({ useFinanceiro: mocks.useFinanceiro }));
// A camada operacional é mockada aqui: o comportamento dela — duplo clique,
// contexto obsoleto, GET autoritativo — tem suíte própria em
// hooks/useEntregasFechamento.test.js. Aqui só interessa como a página REAGE.
vi.mock("../hooks/useEntregasFechamento.js", async (original) => ({
  ...(await original()),
  useEntregasFechamento: mocks.useEntregasFechamento,
}));
// GET /base-vinculos (verificação da base no formulário) — sem vínculo.
vi.mock("../services/apiClient.js", async (orig) => ({
  ...(await orig()),
  requisitar: mocks.requisitar,
}));

export function estadoDeEntregas(overrides = {}) {
  return {
    entregas: null, carregando: false, erro: null,
    recarregar: vi.fn(), acaoEmCurso: null, erroDeAcao: null,
    limparErroDeAcao: vi.fn(), publicar: vi.fn(), despublicar: vi.fn(), excluir: vi.fn(),
    ...overrides,
  };
}

function operacaoPronta(overrides = {}) {
  return {
    pronta: true,
    clienteSlug: "n97",
    clienteContaId: 42,
    marketplace: "meli",
    snapshot: {
      state: "READY",
      context: { clienteNome: "Influência Jeans" },
      meta: { nome: "Mercado Livre 1", externalAccountLabel: "2574840252" },
    },
    ...overrides,
  };
}

function envelope(disponivel, dados, motivo = null) {
  return { disponivel, motivo, dados };
}

function dadosBase(overrides = {}) {
  return {
    resultado: envelope(true, {
      composicao: [
        { chave: "faturamento", rotulo: "Faturamento", valor: 100000, disponivel: true },
        { chave: "frete", rotulo: "Frete", valor: null, disponivel: false },
        { chave: "comissao", rotulo: "Comissão", valor: -8000, disponivel: true },
        { chave: "mc", rotulo: "MC Calculada (%)", valor: 20, disponivel: true },
      ],
      status: "publicado",
    }),
    conciliacao: envelope(true, {
      mpReconciliationStatus: "complete",
      summary: { ordersMatchedClean: 40, ordersMatchedWithEvents: 2, ordersTotal: 42, coveragePercent: 100, ordersDivergent: 0, paymentsSettlementPending: 0, totalPaymentNet: 95000 },
    }),
    relatorios: envelope(true, [
      { periodo: "2026-07", status: "publicado", geradoEm: "2026-08-01T10:00:00Z", publicado: true, token: "tok-1", clienteContaId: 42 },
      { periodo: null, status: "rascunho", geradoEm: "2026-08-02T10:00:00Z", publicado: false, token: null, clienteContaId: null },
    ]),
    ...overrides,
  };
}

function mockarHooks({ dados = null, carregando = false, erro = null, operacao = operacaoPronta(), entregas = estadoDeEntregas(), periodo = "2026-08" } = {}) {
  mocks.useOperacaoAtual.mockReturnValue(operacao);
  mocks.useFinanceiro.mockReturnValue({ periodo, setPeriodo: mocks.setPeriodo, dados, carregando, erro, recarregar: vi.fn() });
  mocks.useEntregasFechamento.mockReturnValue(entregas);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requisitar.mockResolvedValue({ ok: true, bases: [] });
});

describe("FinanceiroPage · organização das abas", () => {
  it("três áreas: Fechamento, Relatórios gerados e Histórico — Resultado e Conciliação deixaram de ser abas", () => {
    mockarHooks({ dados: dadosBase() });
    render(<FinanceiroPage />);
    const abas = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(abas).toEqual(["Fechamento", "Relatórios gerados", "Histórico"]);
    expect(screen.getByRole("tab", { name: "Fechamento" })).toHaveAttribute("aria-selected", "true");
  });

  it("a aba Fechamento abre com o formulário de processamento", async () => {
    mockarHooks({ dados: dadosBase() });
    render(<FinanceiroPage />);
    expect(await screen.findByText("Arquivos do fechamento")).toBeInTheDocument();
  });
});

describe("FinanceiroPage · fechamento salvo (antiga aba Resultado)", () => {
  it("item de composição sem valor mostra '—', nunca 'R$ 0,00'; percentual não vira R$", () => {
    mockarHooks({ dados: dadosBase() });
    render(<FinanceiroPage />);
    const linhaFrete = screen.getByText("Frete").closest(".vf-fin-composicao__linha");
    expect(within(linhaFrete).getByText("—")).toBeInTheDocument();
    expect(within(linhaFrete).queryByText("R$ 0,00")).not.toBeInTheDocument();
    expect(screen.getByText("R$ 100.000,00")).toBeInTheDocument();
    const linhaMc = screen.getByText("MC Calculada (%)").closest(".vf-fin-composicao__linha");
    expect(within(linhaMc).getByText("20,0%")).toBeInTheDocument();
  });

  it("sem fechamento salvo: diz para processar acima — não fala de 'linhas de composição'", () => {
    mockarHooks({ dados: dadosBase({ resultado: envelope(false, null, "Nenhum fechamento gerado para este período.") }) });
    render(<FinanceiroPage />);
    expect(screen.getByText(/Processe um fechamento acima para visualizar o resultado/)).toBeInTheDocument();
    expect(screen.queryByText(/não tem linhas de composição/)).not.toBeInTheDocument();
  });

  it("conciliação Mercado Pago aparece DENTRO do fechamento (MELI) e indisponível não derruba o resto", () => {
    mockarHooks({ dados: dadosBase({ conciliacao: envelope(false, null, "Mercado Pago ainda não conectado.") }) });
    render(<FinanceiroPage />);
    expect(screen.getByText("Conciliação Mercado Pago (Central de Vendas)")).toBeInTheDocument();
    expect(screen.getByText("Mercado Pago ainda não conectado.")).toBeInTheDocument();
    expect(screen.getByText("Faturamento")).toBeInTheDocument();
  });

  it("Shopee não mostra o bloco de conciliação Mercado Pago", () => {
    mockarHooks({ dados: dadosBase(), operacao: operacaoPronta({ marketplace: "shopee" }) });
    render(<FinanceiroPage />);
    expect(screen.queryByText("Conciliação Mercado Pago (Central de Vendas)")).not.toBeInTheDocument();
  });

  it("erro geral sem dados: banner de erro e o formulário continua disponível", () => {
    mockarHooks({ erro: { mensagem: "Falha de rede." } });
    render(<FinanceiroPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Falha de rede.");
    expect(screen.getByText("Arquivos do fechamento")).toBeInTheDocument();
  });

  it("contexto ainda não pronto: página não renderiza nada", () => {
    mockarHooks({ operacao: { pronta: false, snapshot: { state: "LOADING" } } });
    const { container } = render(<FinanceiroPage />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("FinanceiroPage · contexto do Shell", () => {
  it("mostra marketplace, conta (com identificador externo) e cliente em leitura — sem seletores próprios", () => {
    mockarHooks({ dados: dadosBase() });
    render(<FinanceiroPage />);
    const ctx = screen.getByTestId("contexto-fechamento");
    expect(ctx).toHaveTextContent("Mercado Livre");
    expect(ctx).toHaveTextContent("Mercado Livre 1 · 2574840252");
    expect(ctx).toHaveTextContent("Influência Jeans");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("o cabeçalho linka pro Financeiro legado com o clienteSlug da operação atual", () => {
    mockarHooks({ dados: dadosBase(), operacao: operacaoPronta({ clienteSlug: "zenite" }) });
    render(<FinanceiroPage />);
    expect(screen.getByRole("link", { name: /Financeiro \(legado\)/ })).toHaveAttribute("href", "financeiro.html?cliente=zenite");
  });
});

describe("FinanceiroPage · competência do fechamento", () => {
  it("competência por extenso e status 'Sem fechamento' quando a conta não tem entrega", () => {
    mockarHooks({ dados: dadosBase(), entregas: estadoDeEntregas({ entregas: [] }) });
    render(<FinanceiroPage />);
    expect(screen.getByTestId("competencia-extenso")).toHaveTextContent("Agosto/2026");
    expect(screen.getByTestId("status-competencia")).toHaveTextContent("Sem fechamento");
  });

  it("status vem da entrega DESTA conta: rascunho e publicado", () => {
    mockarHooks({
      dados: dadosBase(),
      entregas: estadoDeEntregas({ entregas: [{ id: 7, periodo: "2026-08", publicado: false, cliente_conta_id: 42 }] }),
    });
    const { rerender } = render(<FinanceiroPage />);
    expect(screen.getByTestId("status-competencia")).toHaveTextContent("Rascunho salvo");

    mockarHooks({
      dados: dadosBase(),
      entregas: estadoDeEntregas({ entregas: [{ id: 7, periodo: "2026-08", publicado: true, token_publico: "t", cliente_conta_id: 42 }] }),
    });
    rerender(<FinanceiroPage />);
    expect(screen.getByTestId("status-competencia")).toHaveTextContent("Publicado");
  });

  it("entrega legada (sem conta) e de OUTRA conta não viram status desta conta", () => {
    mockarHooks({
      dados: dadosBase(),
      entregas: estadoDeEntregas({
        entregas: [
          { id: 8, periodo: "2026-08", publicado: true, token_publico: "a", cliente_conta_id: null },
          { id: 9, periodo: "2026-08", publicado: true, token_publico: "b", cliente_conta_id: 77 },
        ],
      }),
    });
    render(<FinanceiroPage />);
    expect(screen.getByTestId("status-competencia")).toHaveTextContent("Sem fechamento");
    expect(screen.getByText(/fechamento legado desta competência sem operação registrada/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Despublicar" })).not.toBeInTheDocument();
  });

  it("sem trabalho em andamento, trocar a competência troca direto", async () => {
    const usuario = userEvent.setup();
    mockarHooks({ dados: dadosBase(), entregas: estadoDeEntregas({ entregas: [] }) });
    render(<FinanceiroPage />);
    await usuario.click(screen.getByRole("button", { name: "Ago 2026" }));
    await usuario.click(screen.getByRole("button", { name: "Set" }));
    expect(mocks.setPeriodo).toHaveBeenCalledWith("2026-09");
  });

  it("com arquivo escolhido, trocar a competência pede confirmação nomeando os dois meses", async () => {
    const usuario = userEvent.setup();
    mockarHooks({ dados: dadosBase(), entregas: estadoDeEntregas({ entregas: [] }) });
    render(<FinanceiroPage />);
    await usuario.upload(screen.getByLabelText(/Planilha de vendas/), new File(["a"], "vendas.xlsx"));

    await usuario.click(screen.getByRole("button", { name: "Ago 2026" }));
    await usuario.click(screen.getByRole("button", { name: "Nov" }));
    expect(mocks.setPeriodo).not.toHaveBeenCalled();
    const confirmacao = screen.getByRole("alertdialog", { name: "Confirmar troca de competência" });
    expect(confirmacao).toHaveTextContent("Trocar para Novembro/2026 irá limpar o processamento atual de Agosto/2026");

    await usuario.click(within(confirmacao).getByRole("button", { name: "Manter Agosto/2026" }));
    expect(mocks.setPeriodo).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Ago 2026" }));
    await usuario.click(screen.getByRole("button", { name: "Nov" }));
    await usuario.click(screen.getByRole("button", { name: "Trocar e limpar" }));
    expect(mocks.setPeriodo).toHaveBeenCalledWith("2026-11");
  });
});

describe("FinanceiroPage · publicar/despublicar a entrega desta conta", () => {
  it("rascunho desta conta: Publicar pede confirmação que NOMEIA a competência", async () => {
    const usuario = userEvent.setup();
    const entregas = estadoDeEntregas({ entregas: [{ id: 7, periodo: "2026-08", publicado: false, cliente_conta_id: 42 }] });
    mockarHooks({ dados: dadosBase(), entregas });
    render(<FinanceiroPage />);
    await usuario.click(screen.getByRole("button", { name: "Publicar" }));
    expect(screen.getByText(/Publicar Agosto\/2026\?/)).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Publicar" }));
    expect(entregas.publicar).toHaveBeenCalledWith(7);
  });

  it("Cancelar na confirmação não publica nada", async () => {
    const usuario = userEvent.setup();
    const entregas = estadoDeEntregas({ entregas: [{ id: 7, periodo: "2026-08", publicado: false, cliente_conta_id: 42 }] });
    mockarHooks({ dados: dadosBase(), entregas });
    render(<FinanceiroPage />);
    await usuario.click(screen.getByRole("button", { name: "Publicar" }));
    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(entregas.publicar).not.toHaveBeenCalled();
  });

  it("entrega publicada: Despublicar, Abrir e Copiar link", async () => {
    const usuario = userEvent.setup();
    const entregas = estadoDeEntregas({
      entregas: [{ id: 7, periodo: "2026-08", publicado: true, token_publico: "tok-abc", published_at: "2026-09-01T10:00:00Z", cliente_conta_id: 42 }],
    });
    mockarHooks({ dados: dadosBase(), entregas });
    render(<FinanceiroPage />);
    expect(screen.getByRole("link", { name: "Abrir" })).toHaveAttribute("href", expect.stringContaining("relatorio-publico.html?token=tok-abc"));
    expect(screen.getByRole("button", { name: "Copiar link" })).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Despublicar" }));
    expect(screen.getByText(/Despublicar Agosto\/2026\?/)).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Despublicar" }));
    expect(entregas.despublicar).toHaveBeenCalledWith(7);
  });
});

describe("FinanceiroPage · Relatórios gerados e Histórico", () => {
  it("Relatórios identifica a conta da operação e o legado, linha a linha", async () => {
    const usuario = userEvent.setup();
    mockarHooks({
      dados: dadosBase(),
      operacao: operacaoPronta({ marketplace: "shopee", snapshot: { state: "READY", context: { clienteNome: "Loja" }, meta: { nome: "Shopee 2", externalAccountLabel: "shop-2" } } }),
      entregas: estadoDeEntregas({
        entregas: [
          { id: 11, periodo: "2026-08", cliente_conta_id: 42, publicado: false, modo_calculo: "real_financial", cobertura_custo_percentual: "97.5" },
          { id: 12, periodo: "Julho 2026", cliente_conta_id: null, publicado: false, marketplace_payload: "shopee" },
        ],
      }),
    });
    render(<FinanceiroPage />);
    await usuario.click(screen.getByRole("tab", { name: "Relatórios gerados" }));
    const tabela = screen.getByRole("table");
    expect(within(tabela).getByText("Shopee · Shopee 2 · shop-2")).toBeInTheDocument();
    expect(within(tabela).getByText("Legado · operação não registrada (Shopee)")).toBeInTheDocument();
    expect(within(tabela).getByText("97,5%")).toBeInTheDocument();
  });

  it("trocar de aba e voltar não perde o arquivo escolhido no Fechamento", async () => {
    const usuario = userEvent.setup();
    mockarHooks({ dados: dadosBase(), entregas: estadoDeEntregas({ entregas: [] }) });
    render(<FinanceiroPage />);
    await usuario.upload(screen.getByLabelText(/Planilha de vendas/), new File(["a"], "vendas-agosto.xlsx"));
    await usuario.click(screen.getByRole("tab", { name: "Histórico" }));
    await usuario.click(screen.getByRole("tab", { name: "Fechamento" }));
    expect(screen.getByText("vendas-agosto.xlsx")).toBeInTheDocument();
  });

  it("Histórico: escolher um mês sem trabalho em andamento troca a competência e volta ao Fechamento", async () => {
    const usuario = userEvent.setup();
    mockarHooks({ dados: dadosBase(), entregas: estadoDeEntregas({ entregas: [] }) });
    render(<FinanceiroPage />);
    await usuario.click(screen.getByRole("tab", { name: "Histórico" }));
    await usuario.click(screen.getByRole("button", { name: "Julho/2026" }));
    expect(mocks.setPeriodo).toHaveBeenCalledWith("2026-07");
    expect(screen.getByRole("tab", { name: "Fechamento" })).toHaveAttribute("aria-selected", "true");
  });
});
