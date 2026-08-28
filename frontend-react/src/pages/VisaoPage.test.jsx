// Testes de render da Visão operacional (F3.2) — React Testing Library + Vitest.
//
// Cobrem exatamente os contratos que já regrediram uma vez (acc3e92):
//   resultado lido de dados.filteredSummary (não de dados direto) ·
//   percentual ausente nunca vira "0,0%" (coerção null/undefined ÷ 100) ·
//   valor ausente nunca vira "R$ 0,00" · escopoConta=false permanece
//   semanticamente explícito (nunca omitido/pausado) · bloco indisponível
//   não derruba os outros 5 blocos da grade.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import VisaoPage from "./VisaoPage.jsx";

const mocks = vi.hoisted(() => ({
  useOperacaoAtual: vi.fn(),
  useVisao: vi.fn(),
}));

vi.mock("../hooks/useVfContext.js", () => ({ useOperacaoAtual: mocks.useOperacaoAtual }));
vi.mock("../hooks/useVisao.js", () => ({ useVisao: mocks.useVisao }));

function operacaoPronta(overrides = {}) {
  return { pronta: true, clienteSlug: "n97", clienteContaId: 42, marketplace: "meli", ...overrides };
}

function envelope(disponivel, dados, escopoConta = true, motivo = null) {
  return { disponivel, escopoConta, motivo, dados };
}

// Shape REALISTA do bootstrap da Central de Vendas: um objeto grande com
// `filteredSummary` aninhado junto de outras chaves (rows/pagination/dias)
// que a Visão não lê — igual ao payload real de getCentralVendasReadBootstrap,
// não um resumo já achatado (é essa diferença que a regressão de acc3e92
// mascarava quando o fixture de teste era flat).
function bootstrapResultado(overridesFilteredSummary = {}) {
  return {
    rows: [{ id: 1 }, { id: 2 }],
    pagination: { page: 1, pageSize: 20, total: 2 },
    dias: [],
    filteredSummary: {
      faturamento: 412880.5,
      lucroContribuicao: 98000,
      margemContribuicaoPercentual: 23.7,
      ticket: 210.5,
      pedidosValidos: 1963,
      pedidosTotal: 2010,
      cancelados: 47,
      ...overridesFilteredSummary,
    },
  };
}

function dadosBase(overrides = {}) {
  return {
    saude: envelope(true, {
      saude: { status: "atencao", score: 62, label: "Precisa de atenção", motivos: [] },
      setup: { temGrant: true, temBase: true },
      sync: { status: "sincronizado", ultimaSincronizacao: "2026-08-26T10:00:00Z" },
      proximoPasso: null,
    }, false),
    resultado: envelope(true, bootstrapResultado(), true),
    margem: envelope(true, { placar: {}, cobertura: {}, excecoes: [] }, false),
    ads: envelope(true, { semDados: true, codigo: "sem_grant", motivo: "Ads não configurado." }, true),
    fechamento: envelope(true, null, false),
    atividade: envelope(true, [], true),
    ...overrides,
  };
}

function mockarHooks({ dados = null, carregando = false, erro = null, operacao = operacaoPronta() } = {}) {
  mocks.useOperacaoAtual.mockReturnValue(operacao);
  mocks.useVisao.mockReturnValue({ periodo: "2026-08", setPeriodo: vi.fn(), dados, carregando, erro });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VisaoPage · Resultado do período (regressão acc3e92)", () => {
  it("lê o faturamento e a margem de dados.filteredSummary, não do bootstrap cru", async () => {
    mockarHooks({ dados: dadosBase() });
    render(<VisaoPage />);

    const bloco = (await screen.findByText("Resultado do período")).closest("section");
    expect(within(bloco).getByText("R$ 412.880,50")).toBeInTheDocument();
    expect(within(bloco).getByText("23,7%")).toBeInTheDocument();
  });

  it("margemContribuicaoPercentual ausente mostra '—', nunca vira '0,0%'", async () => {
    mockarHooks({
      dados: dadosBase({
        resultado: envelope(true, bootstrapResultado({ margemContribuicaoPercentual: null }), true),
      }),
    });
    render(<VisaoPage />);

    const bloco = (await screen.findByText("Resultado do período")).closest("section");
    expect(bloco.textContent).not.toContain("0,0%");
    const rotulo = within(bloco).getByText("Margem de contribuição");
    expect(rotulo.closest(".vf-kpi").querySelector(".vf-kpi__value")).toHaveTextContent("—");
  });

  it("ticket/faturamento ausentes mostram '—', nunca 'R$ 0,00'", async () => {
    mockarHooks({
      dados: dadosBase({
        resultado: envelope(true, bootstrapResultado({ ticket: null, faturamento: undefined }), true),
      }),
    });
    render(<VisaoPage />);

    const bloco = (await screen.findByText("Resultado do período")).closest("section");
    expect(bloco.textContent).not.toContain("R$ 0,00");
    expect(within(bloco).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});

describe("VisaoPage · escopoConta explícito", () => {
  it("escopoConta=false mostra o badge 'cliente inteiro'", async () => {
    mockarHooks({ dados: dadosBase() });
    render(<VisaoPage />);

    const saude = (await screen.findByText("Saúde da operação")).closest("section");
    expect(within(saude).getByText("cliente inteiro")).toBeInTheDocument();
  });

  it("escopoConta=true não mostra o badge (não é omissão silenciosa, é o outro valor explícito)", async () => {
    mockarHooks({ dados: dadosBase() });
    render(<VisaoPage />);

    const resultado = (await screen.findByText("Resultado do período")).closest("section");
    expect(within(resultado).queryByText("cliente inteiro")).not.toBeInTheDocument();
  });
});

describe("VisaoPage · resiliência por bloco", () => {
  it("um bloco indisponível mostra o motivo e não impede os outros 5 blocos de renderizar", async () => {
    mockarHooks({
      dados: dadosBase({
        margem: envelope(false, null, false, "Base de custo ainda não vinculada."),
      }),
    });
    render(<VisaoPage />);

    const margem = (await screen.findByText("Margem")).closest("section");
    expect(within(margem).getByText("Base de custo ainda não vinculada.")).toBeInTheDocument();

    // os outros blocos continuam de pé, com dado real
    expect(screen.getByText("R$ 412.880,50")).toBeInTheDocument();
    expect(screen.getByText("Saúde da operação")).toBeInTheDocument();
    expect(screen.getByText("Ads")).toBeInTheDocument();
    expect(screen.getByText("Fechamento")).toBeInTheDocument();
    expect(screen.getByText("Atividade recente")).toBeInTheDocument();
  });

  it("bloco indisponível sem motivo cai no texto genérico, não fica vazio", async () => {
    mockarHooks({
      dados: dadosBase({ ads: envelope(false, null, true, null) }),
    });
    render(<VisaoPage />);

    const ads = (await screen.findByText("Ads")).closest("section");
    expect(within(ads).getByText("Este bloco não está disponível no momento.")).toBeInTheDocument();
  });
});

describe("VisaoPage · estados de carregamento e erro", () => {
  it("sem dados e carregando: mostra 6 esqueletos, não a grade", () => {
    mockarHooks({ dados: null, carregando: true });
    const { container } = render(<VisaoPage />);
    expect(container.querySelectorAll(".vf-visao-bloco").length).toBe(6);
    expect(screen.queryByText("Resultado do período")).not.toBeInTheDocument();
  });

  it("erro sem dados: banner com mensagem, não tela em branco", () => {
    mockarHooks({ dados: null, erro: { codigo: "rede", mensagem: "Não foi possível falar com o servidor." } });
    render(<VisaoPage />);
    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível carregar a Visão");
    expect(alerta).toHaveTextContent("Não foi possível falar com o servidor.");
  });

  it("contexto ainda não pronto: página não renderiza nada (Shell já cobre o estado)", () => {
    mockarHooks({ operacao: operacaoPronta({ pronta: false }), dados: null });
    const { container } = render(<VisaoPage />);
    expect(container).toBeEmptyDOMElement();
  });
});
