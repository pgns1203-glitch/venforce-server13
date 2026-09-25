// Testes da página do Painel de Contas (redesign administrativo) —
// React Testing Library + Vitest. O hook é mockado: aqui o que se verifica é
// o CONTRATO DE TELA, não a busca de dados.
//
// Travas do redesign cobertas aqui:
//   toolbar no lugar dos campos de formulário · resumo derivado do payload ·
//   cinco estados vazios distintos · menu de colunas com Operação fora do
//   padrão · NENHUM "expandir todos" · densidade compacta declarada.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PainelContasPage from "./PainelContasPage.jsx";

const mocks = vi.hoisted(() => ({ usePainelContas: vi.fn() }));
vi.mock("../hooks/usePainelContas.js", () => ({ usePainelContas: mocks.usePainelContas }));

function cliente(over = {}) {
  return {
    id: 1,
    slug: "acme",
    nome: "Acme Comércio",
    squad: { id: 7, nome: "Squad Alpha", slug: "alpha" },
    ultimoMesDisponivel: "2026-09",
    sincronizadoEm: "2026-09-21T12:00:00.000Z",
    resumo: { fat: 113000, lc: 20400, mc: 0.181, ads: 4100, acos: 0.041, tacos: 0.036, com: null, atv: null, nps: null },
    ...over,
  };
}

function estado(over = {}) {
  return {
    ano: 2026, setAno: vi.fn(),
    squadId: null, setSquadId: vi.fn(),
    busca: "", setBusca: vi.fn(),
    anoPadrao: 2026, temFiltroAtivo: false, limparFiltros: vi.fn(),
    squadsDoUsuario: [{ id: 7, nome: "Squad Alpha" }, { id: 9, nome: "Squad Beta" }],
    clientes: [cliente()],
    carregando: false, atualizando: false, erro: null, recarregar: vi.fn(),
    mesesPorCliente: {}, carregarMeses: vi.fn(),
    semanasPorChave: {}, carregarSemanas: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.usePainelContas.mockReturnValue(estado());
});

describe("cabeçalho administrativo", () => {
  it("anuncia controle da carteira sem despejar detalhe técnico no topo", () => {
    render(<PainelContasPage />);
    expect(screen.getByText("Controle da carteira")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Painel de Contas" })).toBeInTheDocument();
    // O texto sobre snapshot/sincronização saiu do header; continua na tela,
    // mas no rodapé de contexto — perto do dado que ele explica.
    const cabecalho = screen.getByRole("banner");
    expect(within(cabecalho).queryByText(/snapshot/i)).toBeNull();
    expect(screen.getByText(/snapshot mensal já sincronizado/i)).toBeInTheDocument();
  });

  it("declara densidade compacta, reaproveitando o token da Fundação V2", () => {
    const { container } = render(<PainelContasPage />);
    expect(container.querySelector('[data-vf-density="compact"]')).not.toBeNull();
  });

  it("usa o container wide — onze colunas não cabem no padrão de 1200px", () => {
    const { container } = render(<PainelContasPage />);
    expect(container.querySelector(".vf-page-container--wide")).not.toBeNull();
  });
});

describe("barra de controle", () => {
  it("expõe busca, squad e ano como instrumentos, com rótulo acessível", () => {
    render(<PainelContasPage />);
    expect(screen.getByRole("searchbox", { name: /buscar cliente/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /filtrar por squad/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /filtrar por ano/i })).toBeInTheDocument();
  });

  it("esconde o filtro de Squad quando só existe um — controle sem efeito não aparece", () => {
    mocks.usePainelContas.mockReturnValue(estado({ squadsDoUsuario: [{ id: 7, nome: "Squad Alpha" }] }));
    render(<PainelContasPage />);
    expect(screen.queryByRole("combobox", { name: /filtrar por squad/i })).toBeNull();
    expect(screen.getByRole("combobox", { name: /filtrar por ano/i })).toBeInTheDocument();
  });

  it('só oferece "Limpar filtros" quando há filtro aplicado', async () => {
    const limparFiltros = vi.fn();
    render(<PainelContasPage />);
    expect(screen.queryByRole("button", { name: /limpar filtros/i })).toBeNull();

    mocks.usePainelContas.mockReturnValue(estado({ temFiltroAtivo: true, busca: "acme", limparFiltros }));
    render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: /limpar filtros/i }));
    expect(limparFiltros).toHaveBeenCalled();
  });

  it("resume a carteira com contagens derivadas do payload, sem requisição nova", () => {
    mocks.usePainelContas.mockReturnValue(estado({
      clientes: [
        cliente({ id: 1 }),
        cliente({ id: 2, nome: "Bravo", squad: { id: 9, nome: "Squad Beta" } }),
        cliente({ id: 3, nome: "Caverna", resumo: null, ultimoMesDisponivel: null, sincronizadoEm: null }),
      ],
    }));
    render(<PainelContasPage />);
    expect(screen.getByText("3 clientes")).toBeInTheDocument();
    expect(screen.getByText("2 squads")).toBeInTheDocument();
    expect(screen.getByText("2 com dados")).toBeInTheDocument();
    expect(screen.getByText("1 sem sincronização")).toBeInTheDocument();
  });

  it("afirma a atualização em TEXTO, não só em opacidade", () => {
    mocks.usePainelContas.mockReturnValue(estado({ atualizando: true }));
    render(<PainelContasPage />);
    expect(screen.getByText("Atualizando…")).toBeInTheDocument();
    // E os dados anteriores continuam na tela — sem flash de loading (§22).
    expect(screen.getByText("Acme Comércio")).toBeInTheDocument();
  });
});

describe("controle de colunas", () => {
  it("esconde Operação por padrão, mantendo Financeiro e Ads", () => {
    render(<PainelContasPage />);
    expect(screen.getByRole("columnheader", { name: "FAT" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Financeiro" })).toBeInTheDocument();
    // O cabeçalho é lido como a sigla; a definição por extenso vai no botão
    // de ordenação, para quem precisa dela (§12).
    expect(screen.getByRole("button", { name: /Faturamento — venda total do período/ })).toBeInTheDocument();
    expect(screen.queryByText("COM")).toBeNull();
    expect(screen.queryByText("NPS")).toBeNull();
  });

  it("devolve as colunas de Operação — a capacidade não foi removida", async () => {
    render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: /colunas/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /operação/i }));

    expect(screen.getByText("COM")).toBeInTheDocument();
    expect(screen.getByText("ATV")).toBeInTheDocument();
    expect(screen.getByText("NPS")).toBeInTheDocument();
    expect(screen.getByText("sem fonte")).toBeInTheDocument();
  });

  it("impede desligar o último grupo — a tabela nunca fica só de nomes", async () => {
    render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: /colunas/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /^ads/i }));

    const financeiro = screen.getByRole("checkbox", { name: /financeiro/i });
    expect(financeiro).toBeChecked();
    expect(financeiro).toBeDisabled();
  });

  it("guarda a preferência entre sessões, com chave namespaced", async () => {
    const { unmount } = render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: /colunas/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /operação/i }));
    unmount();

    expect(window.localStorage.getItem("vf:painel-contas:grupos-colunas")).toContain("operacao");
    render(<PainelContasPage />);
    expect(screen.getByText("NPS")).toBeInTheDocument();
  });
});

describe("estados vazios distintos (§23)", () => {
  it("distingue busca sem resultado", () => {
    mocks.usePainelContas.mockReturnValue(estado({ clientes: [], busca: "zzz", temFiltroAtivo: true }));
    render(<PainelContasPage />);
    expect(screen.getByText(/nenhum cliente para “zzz”/i)).toBeInTheDocument();
  });

  it("distingue squad filtrado sem cliente, nomeando o squad", () => {
    mocks.usePainelContas.mockReturnValue(estado({ clientes: [], squadId: 9, temFiltroAtivo: true }));
    render(<PainelContasPage />);
    expect(screen.getByText(/nenhum cliente no squad squad beta/i)).toBeInTheDocument();
  });

  it("distingue carteira realmente vazia", () => {
    mocks.usePainelContas.mockReturnValue(estado({ clientes: [] }));
    render(<PainelContasPage />);
    expect(screen.getByText(/sua carteira está vazia/i)).toBeInTheDocument();
  });

  it("distingue ano sem snapshot sem esconder os clientes", () => {
    mocks.usePainelContas.mockReturnValue(estado({
      ano: 2023,
      clientes: [cliente({ resumo: null, ultimoMesDisponivel: null, sincronizadoEm: null })],
    }));
    render(<PainelContasPage />);
    expect(screen.getByText(/nenhum cliente da carteira tem snapshot sincronizado em 2023/i)).toBeInTheDocument();
    expect(screen.getByText("Acme Comércio")).toBeInTheDocument(); // continua listado
  });

  it("distingue cliente sem sincronização na própria linha", () => {
    mocks.usePainelContas.mockReturnValue(estado({
      clientes: [cliente({ resumo: null, ultimoMesDisponivel: null, sincronizadoEm: null })],
    }));
    render(<PainelContasPage />);
    expect(screen.getByText("sem sincronização")).toBeInTheDocument();
  });
});

describe("erro de página inteira", () => {
  it("oferece recarregar sem perder o cabeçalho", async () => {
    const recarregar = vi.fn();
    mocks.usePainelContas.mockReturnValue(estado({ clientes: null, erro: { mensagem: "Falha de rede." }, recarregar }));
    render(<PainelContasPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Falha de rede.");
    await userEvent.click(screen.getByRole("button", { name: /tentar de novo/i }));
    expect(recarregar).toHaveBeenCalled();
  });
});

describe("proteção de performance (§19)", () => {
  it("não existe nenhum controle de expandir todos", () => {
    render(<PainelContasPage />);
    expect(screen.queryByRole("button", { name: /expandir tod/i })).toBeNull();
  });

  it("só oferece recolher quando há algo expandido, e sem disparar busca", async () => {
    const carregarMeses = vi.fn();
    mocks.usePainelContas.mockReturnValue(estado({ carregarMeses }));
    render(<PainelContasPage />);
    expect(screen.queryByRole("button", { name: /recolher tudo/i })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /expandir competências/i }));
    const recolher = screen.getByRole("button", { name: /recolher tudo/i });

    carregarMeses.mockClear();
    await userEvent.click(recolher);
    expect(carregarMeses).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /recolher tudo/i })).toBeNull();
  });
});
