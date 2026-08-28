// Testes de render do Financeiro V3 (F4.1, só leitura) — React Testing
// Library + Vitest. Cobrem os contratos de honestidade do Master Spec M6:
// item de composição sem valor nunca vira R$0 · relatório/histórico com
// período inválido mostra "—", não quebra nem mostra a chave crua ·
// estado parcial/indisponível por seção (não a página inteira) · contexto
// Cliente/Conta chega correto nos links para o legado.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FinanceiroPage from "./FinanceiroPage.jsx";
import { AUSENTE } from "../utils/numbers.js";

const mocks = vi.hoisted(() => ({
  useOperacaoAtual: vi.fn(),
  useFinanceiro: vi.fn(),
}));

vi.mock("../hooks/useVfContext.js", () => ({ useOperacaoAtual: mocks.useOperacaoAtual }));
vi.mock("../hooks/useFinanceiro.js", () => ({ useFinanceiro: mocks.useFinanceiro }));

function operacaoPronta(overrides = {}) {
  return { pronta: true, clienteSlug: "n97", clienteContaId: 42, marketplace: "meli", ...overrides };
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
      ],
      status: "publicado",
    }),
    conciliacao: envelope(true, {
      mpReconciliationStatus: "complete",
      summary: { ordersMatchedClean: 40, ordersMatchedWithEvents: 2, ordersTotal: 42, coveragePercent: 100, ordersDivergent: 0, paymentsSettlementPending: 0, totalPaymentNet: 95000 },
    }),
    relatorios: envelope(true, [
      { periodo: "2026-07", status: "publicado", geradoEm: "2026-08-01T10:00:00Z", publicado: true, token: "tok-1" },
      { periodo: null, status: "rascunho", geradoEm: "2026-08-02T10:00:00Z", publicado: false, token: null },
    ]),
    ...overrides,
  };
}

function mockarHooks({ dados = null, carregando = false, erro = null, operacao = operacaoPronta() } = {}) {
  mocks.useOperacaoAtual.mockReturnValue(operacao);
  mocks.useFinanceiro.mockReturnValue({ periodo: "2026-08", setPeriodo: vi.fn(), dados, carregando, erro });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FinanceiroPage · Resultado/composição", () => {
  it("item de composição sem valor mostra '—', nunca 'R$ 0,00'", async () => {
    mockarHooks({ dados: dadosBase() });
    render(<FinanceiroPage />);

    await screen.findByText("Faturamento");
    const linhaFrete = screen.getByText("Frete").closest(".vf-fin-composicao__linha");
    expect(within(linhaFrete).getByText("—")).toBeInTheDocument();
    expect(linhaFrete.textContent).not.toContain("R$ 0,00");

    // itens com valor real continuam formatados normalmente
    expect(screen.getByText("R$ 100.000,00")).toBeInTheDocument();
  });

  it("sem fechamento processado: estado vazio com motivo e link pro legado com o cliente certo", async () => {
    mockarHooks({
      dados: dadosBase({ resultado: envelope(false, null, "Nenhum fechamento publicado para agosto/2026.") }),
    });
    render(<FinanceiroPage />);

    expect(await screen.findByText("Sem fechamento processado")).toBeInTheDocument();
    expect(screen.getByText("Nenhum fechamento publicado para agosto/2026.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Gerar no Financeiro \(legado\)/ });
    expect(link).toHaveAttribute("href", "financeiro.html?cliente=n97");
  });
});

describe("FinanceiroPage · Relatórios e Histórico (período inválido)", () => {
  it("relatório com período ausente mostra '—' na tabela, não a chave crua nem quebra", async () => {
    mockarHooks({ dados: dadosBase() });
    const usuario = userEvent.setup();
    render(<FinanceiroPage />);

    await screen.findByText("Faturamento");
    await usuario.click(screen.getByRole("tab", { name: "Relatórios gerados" }));

    const tabela = screen.getByRole("table");
    const linhas = within(tabela).getAllByRole("row").slice(1); // sem o cabeçalho
    expect(linhas[1]).toHaveTextContent("—"); // segundo relatório, periodo: null
  });

  it("histórico ordena mais recente primeiro e trata período ausente como '—'", async () => {
    mockarHooks({
      dados: dadosBase({
        relatorios: envelope(true, [
          { periodo: "2026-05", status: "publicado" },
          { periodo: "2026-07", status: "rascunho" },
          { periodo: undefined, status: "publicado" },
        ]),
      }),
    });
    const usuario = userEvent.setup();
    render(<FinanceiroPage />);

    await screen.findByText("Faturamento");
    await usuario.click(screen.getByRole("tab", { name: "Histórico" }));

    // ordenação é por localeCompare(String(periodo)) descendente — o
    // período ausente (undefined → "undefined") não quebra a ordenação,
    // só entra no lugar que a colação do locale escolhe, e some no rótulo
    const itens = screen.getAllByRole("listitem");
    const periodos = itens.map((li) => li.querySelector(".vf-fin-historico__periodo").textContent);
    expect(periodos).toEqual(["—", "Julho/2026", "Maio/2026"]);
    expect(periodos).toContain(AUSENTE);
  });
});

describe("FinanceiroPage · estado parcial/indisponível por seção", () => {
  it("conciliação indisponível não impede a aba Resultado de funcionar", async () => {
    mockarHooks({
      dados: dadosBase({ conciliacao: envelope(false, null, "Mercado Pago ainda não conectado.") }),
    });
    const usuario = userEvent.setup();
    render(<FinanceiroPage />);

    await screen.findByText("Faturamento");
    await usuario.click(screen.getByRole("tab", { name: "Conciliação" }));
    expect(screen.getByText("Mercado Pago ainda não conectado.")).toBeInTheDocument();

    await usuario.click(screen.getByRole("tab", { name: "Resultado" }));
    expect(screen.getByText("Faturamento")).toBeInTheDocument();
  });

  it("erro geral sem dados: banner de erro, não tela em branco", () => {
    mockarHooks({ dados: null, erro: { codigo: "rede", mensagem: "Falha ao carregar o Financeiro." } });
    render(<FinanceiroPage />);
    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível carregar o Financeiro");
    expect(alerta).toHaveTextContent("Falha ao carregar o Financeiro.");
  });

  it("contexto ainda não pronto: página não renderiza nada", () => {
    mockarHooks({ operacao: operacaoPronta({ pronta: false }), dados: null });
    const { container } = render(<FinanceiroPage />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("FinanceiroPage · contexto Cliente/Conta", () => {
  it("o cabeçalho linka pro Financeiro legado com o clienteSlug da operação atual, não outro", async () => {
    mockarHooks({ dados: dadosBase(), operacao: operacaoPronta({ clienteSlug: "extra-maquinas", clienteContaId: 51 }) });
    render(<FinanceiroPage />);

    const link = await screen.findByRole("link", { name: /o Financeiro atual/ });
    expect(link).toHaveAttribute("href", "financeiro.html?cliente=extra-maquinas");
  });
});
