// Testes da página do Painel de Contas operacional — React Testing Library +
// Vitest. O hook é mockado: aqui o que se verifica é o CONTRATO DE TELA.
//
// Travas cobertas: competência explícita no topo e no seletor · filtros de
// status/marketplace/squad/legado · resumo da carteira vindo do servidor ·
// estados vazios distintos · lançamento manual abre no cliente/conta certos ·
// menu de colunas · nenhum "expandir todos" · densidade compacta.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PainelContasPage from "./PainelContasPage.jsx";

const mocks = vi.hoisted(() => ({ usePainelContas: vi.fn() }));
vi.mock("../hooks/usePainelContas.js", () => ({ usePainelContas: mocks.usePainelContas }));

function resumo(over = {}) {
  return { fat: 600, lc: 110, mc: 0.183, ads: 4100, acos: 0.041, tacos: 0.036, com: null, atv: null, nps: null, ...over };
}

function cliente(over = {}) {
  return {
    id: 1, slug: "acme", nome: "Acme Comércio",
    squad: { id: 7, nome: "Squad Alpha", slug: "alpha" }, legado: false,
    competencia: "2026-09",
    escopo: { tipo: "conta", rotulo: "Mercado Livre 1 · ACME", contasOperacionais: 1, contasComDado: 1 },
    status: { codigo: "sincronizado", rotulo: "Sincronizado", motivo: null, precisaAtencao: false },
    fonte: { tipo: "api", rotulo: "API" },
    atualizadoEm: "2026-09-29T06:20:00.000Z", dadosAte: "2026-09-28",
    resumo: resumo(),
    ultimaCompetenciaComDado: "2026-09",
    contas: [{
      id: 11, rotulo: "Mercado Livre 1 · ACME", marketplace: "meli", ativa: true, avisos: [],
      status: { codigo: "sincronizado", rotulo: "Sincronizado" }, fonte: { tipo: "api", rotulo: "API" },
      resumo: resumo({ ads: null, acos: null, tacos: null }), podeLancarManual: false, manual: null,
    }],
    podeLancarManual: false,
    ...over,
  };
}

const semDadosShopee = () => cliente({
  id: 3, nome: "Coremix Loja", resumo: null, fonte: null, atualizadoEm: null, dadosAte: null,
  status: { codigo: "sem_dados", rotulo: "Sem dados", motivo: "Marketplace sem integração automática", precisaAtencao: true },
  contas: [{
    id: 31, rotulo: "Shopee 1 · COREMIX", marketplace: "shopee", ativa: true, avisos: [],
    status: { codigo: "sem_integracao", rotulo: "Sem integração", motivo: "Marketplace sem integração automática" },
    fonte: null, resumo: null, podeLancarManual: true, manual: null,
  }],
  podeLancarManual: true,
});

function estado(over = {}) {
  return {
    competencia: "2026-09", setCompetencia: vi.fn(), competenciaPadrao: "2026-09",
    squadId: null, setSquadId: vi.fn(),
    busca: "", setBusca: vi.fn(),
    status: "todos", setStatus: vi.fn(),
    marketplace: null, setMarketplace: vi.fn(),
    mostrarLegado: false, setMostrarLegado: vi.fn(),
    temFiltroAtivo: false, limparFiltros: vi.fn(),
    clientes: [cliente()],
    resumoCarteira: { operacionais: 67, comDados: 42, semDados: 20, parciais: 5, manuais: 3, automaticos: 39, atencao: 8, legadoOcultos: 26 },
    squadsDisponiveis: [{ id: 7, nome: "Squad Alpha" }, { id: 9, nome: "Squad Beta" }],
    squadsDoUsuario: [],
    marketplacesDisponiveis: [{ codigo: "meli", rotulo: "Mercado Livre" }, { codigo: "shopee", rotulo: "Shopee" }],
    permissoes: { lancarManual: true },
    carregando: false, atualizando: false, erro: null, recarregar: vi.fn(),
    mesesPorCliente: {}, carregarMeses: vi.fn(),
    semanasPorChave: {}, carregarSemanas: vi.fn(),
    salvarManual: vi.fn().mockResolvedValue({ ok: true }), removerManual: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.usePainelContas.mockReturnValue(estado());
});

describe("cabeçalho: a competência está escrita", () => {
  it("diz qual competência a tela representa", () => {
    render(<PainelContasPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Painel de Contas" })).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByText(/Setembro\/2026 · dados operacionais da carteira/)).toBeInTheDocument();
  });

  it("declara densidade compacta e container wide", () => {
    const { container } = render(<PainelContasPage />);
    expect(container.querySelector('[data-vf-density="compact"]')).not.toBeNull();
    expect(container.querySelector(".vf-page-container--wide")).not.toBeNull();
  });
});

describe("barra de filtros", () => {
  it("expõe busca, competência, squad, status, marketplace e legado", () => {
    render(<PainelContasPage />);
    expect(screen.getByRole("searchbox", { name: /buscar cliente/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /competência/i })).toHaveValue("2026-09");
    expect(screen.getByRole("combobox", { name: /filtrar por squad/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /filtrar por status/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /filtrar por marketplace/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /mostrar legado/i })).not.toBeChecked();
  });

  it("competência lista meses por extenso, sem 'ano' solto", () => {
    render(<PainelContasPage />);
    const opcoes = Array.from(screen.getByRole("combobox", { name: /competência/i }).options).map((o) => o.textContent);
    expect(opcoes[0]).toBe("Setembro/2026");
    expect(opcoes[1]).toBe("Agosto/2026");
    expect(opcoes).not.toContain("2026");
  });

  it("trocar filtros chama o hook com o valor técnico", async () => {
    const e = estado();
    mocks.usePainelContas.mockReturnValue(e);
    render(<PainelContasPage />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /competência/i }), "2026-08");
    expect(e.setCompetencia).toHaveBeenCalledWith("2026-08");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /filtrar por status/i }), "sem_dados");
    expect(e.setStatus).toHaveBeenCalledWith("sem_dados");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /filtrar por marketplace/i }), "shopee");
    expect(e.setMarketplace).toHaveBeenCalledWith("shopee");
    await userEvent.click(screen.getByRole("checkbox", { name: /mostrar legado/i }));
    expect(e.setMostrarLegado).toHaveBeenCalledWith(true);
  });

  it("esconde filtros sem efeito (um squad só, um marketplace só)", () => {
    mocks.usePainelContas.mockReturnValue(estado({
      squadsDisponiveis: [{ id: 7, nome: "Squad Alpha" }],
      marketplacesDisponiveis: [{ codigo: "meli", rotulo: "Mercado Livre" }],
    }));
    render(<PainelContasPage />);
    expect(screen.queryByRole("combobox", { name: /filtrar por squad/i })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /filtrar por marketplace/i })).toBeNull();
  });

  it('só oferece "Limpar filtros" quando há filtro aplicado', async () => {
    const limparFiltros = vi.fn();
    const { unmount } = render(<PainelContasPage />);
    expect(screen.queryByRole("button", { name: /limpar filtros/i })).toBeNull();
    unmount();
    mocks.usePainelContas.mockReturnValue(estado({ temFiltroAtivo: true, busca: "acme", limparFiltros }));
    render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: /limpar filtros/i }));
    expect(limparFiltros).toHaveBeenCalled();
  });
});

describe("resumo da carteira (do servidor, na competência)", () => {
  it("mostra operacionais, com dados, sem dados, parciais, manuais e atenção", () => {
    render(<PainelContasPage />);
    const resumoEl = screen.getByTestId("resumo-carteira");
    expect(resumoEl).toHaveTextContent("67 operacionais");
    expect(resumoEl).toHaveTextContent("42 com dados");
    expect(resumoEl).toHaveTextContent("20 sem dados");
    expect(resumoEl).toHaveTextContent("5 parciais");
    expect(resumoEl).toHaveTextContent("3 manuais");
    expect(resumoEl).toHaveTextContent("8 precisam de atenção");
    expect(resumoEl).toHaveTextContent("26 do legado ocultos");
  });

  it("clicar num número do resumo filtra por aquele status", async () => {
    const e = estado();
    mocks.usePainelContas.mockReturnValue(e);
    render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: /8 precisam de atenção/i }));
    expect(e.setStatus).toHaveBeenCalledWith("atencao");
  });

  it("afirma a atualização em TEXTO, não só em opacidade", () => {
    mocks.usePainelContas.mockReturnValue(estado({ atualizando: true }));
    render(<PainelContasPage />);
    expect(screen.getByText("Atualizando…")).toBeInTheDocument();
    expect(screen.getByText("Acme Comércio")).toBeInTheDocument();
  });
});

describe("lançamento manual", () => {
  it("abre o drawer no cliente certo e salva pela ação do hook", async () => {
    const e = estado({ clientes: [cliente(), semDadosShopee()] });
    mocks.usePainelContas.mockReturnValue(e);
    render(<PainelContasPage />);

    await userEvent.click(screen.getByRole("button", { name: /lançar dados — coremix loja/i }));
    const drawer = screen.getByRole("dialog", { name: /lançar dados manuais/i });
    expect(within(drawer).getByText("Coremix Loja")).toBeInTheDocument();
    await userEvent.type(within(drawer).getByLabelText("Faturamento (R$)"), "5000");
    await userEvent.click(within(drawer).getByRole("button", { name: /salvar lançamento/i }));
    expect(e.salvarManual).toHaveBeenCalledWith(3, 31, expect.objectContaining({ faturamento: 5000 }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("controle de colunas", () => {
  it("esconde Operação por padrão, mantendo Financeiro e Ads", () => {
    render(<PainelContasPage />);
    expect(screen.getByRole("columnheader", { name: "FAT" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Financeiro" })).toBeInTheDocument();
    expect(screen.queryByText("NPS")).toBeNull();
  });

  it("devolve as colunas de Operação — a capacidade não foi removida", async () => {
    render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: /colunas/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /operação/i }));
    expect(screen.getByText("NPS")).toBeInTheDocument();
  });

  it("guarda a preferência entre sessões, com chave namespaced", async () => {
    const { unmount } = render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: /colunas/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /operação/i }));
    unmount();
    expect(window.localStorage.getItem("vf:painel-contas:grupos-colunas")).toContain("operacao");
  });
});

describe("estados vazios distintos", () => {
  it("busca sem resultado", () => {
    mocks.usePainelContas.mockReturnValue(estado({ clientes: [], busca: "zzz", temFiltroAtivo: true }));
    render(<PainelContasPage />);
    expect(screen.getByText(/nenhum cliente para “zzz”/i)).toBeInTheDocument();
  });

  it("squad filtrado sem cliente, nomeando o squad", () => {
    mocks.usePainelContas.mockReturnValue(estado({ clientes: [], squadId: 9, temFiltroAtivo: true }));
    render(<PainelContasPage />);
    expect(screen.getByText(/nenhum cliente no squad squad beta/i)).toBeInTheDocument();
  });

  it("status filtrado sem cliente, nomeando status e competência", () => {
    mocks.usePainelContas.mockReturnValue(estado({ clientes: [], status: "parcial", temFiltroAtivo: true }));
    render(<PainelContasPage />);
    expect(screen.getByText(/nenhum cliente parcial em set\/2026/i)).toBeInTheDocument();
  });

  it("carteira realmente vazia", () => {
    mocks.usePainelContas.mockReturnValue(estado({ clientes: [], resumoCarteira: { operacionais: 0, comDados: 0, semDados: 0, parciais: 0, manuais: 0, automaticos: 0, atencao: 0, legadoOcultos: 0 } }));
    render(<PainelContasPage />);
    expect(screen.getByText(/sua carteira está vazia/i)).toBeInTheDocument();
  });

  it("competência sem nenhum dado: avisa sem esconder os clientes e sem mostrar outro mês", () => {
    mocks.usePainelContas.mockReturnValue(estado({ competencia: "2026-10", clientes: [semDadosShopee()] }));
    render(<PainelContasPage />);
    expect(screen.getByText(/nenhum cliente listado tem dados em outubro\/2026/i)).toBeInTheDocument();
    expect(screen.getByText("Coremix Loja")).toBeInTheDocument();
  });
});

describe("erro de página inteira", () => {
  it("oferece recarregar", async () => {
    const recarregar = vi.fn();
    mocks.usePainelContas.mockReturnValue(estado({ clientes: null, erro: { mensagem: "Falha de rede." }, recarregar }));
    render(<PainelContasPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Falha de rede.");
    await userEvent.click(screen.getByRole("button", { name: /tentar de novo/i }));
    expect(recarregar).toHaveBeenCalled();
  });
});

describe("proteção de performance", () => {
  it("não existe nenhum controle de expandir todos", () => {
    render(<PainelContasPage />);
    expect(screen.queryByRole("button", { name: /expandir tod/i })).toBeNull();
  });

  it("só oferece recolher quando há algo expandido, e sem disparar busca", async () => {
    const carregarMeses = vi.fn();
    mocks.usePainelContas.mockReturnValue(estado({ carregarMeses }));
    render(<PainelContasPage />);
    expect(screen.queryByRole("button", { name: /recolher tudo/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /expandir contas/i }));
    await userEvent.click(screen.getByRole("button", { name: /recolher tudo/i }));
    expect(carregarMeses).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /recolher tudo/i })).toBeNull();
  });
});
