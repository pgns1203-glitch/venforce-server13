// Testes da página do Painel de Contas operacional — React Testing Library +
// Vitest. O hook é mockado: aqui o que se verifica é o CONTRATO DE TELA.
//
// Travas cobertas: competência explícita no topo e no seletor · filtros de
// status/marketplace/squad/legado · resumo da carteira vindo do servidor ·
// estados vazios distintos · lançamento manual abre no cliente/conta certos ·
// menu de colunas · nenhum "expandir todos" · densidade compacta ·
// "Atualizar dados" (admin): regra de frescor visível, progresso e falha por
// conta.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PainelContasPage, { descreverAcesso } from "./PainelContasPage.jsx";

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
      id: 11, rotulo: "Mercado Livre 1 · ACME", marketplace: "meli", ativa: true, conectada: true, avisos: [],
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
    secoesMarketplace: [
      { codigo: "meli", rotulo: "Mercado Livre", fonte: "api", descricao: "Dados automáticos da API", clientes: 1 },
      { codigo: "shopee", rotulo: "Shopee", fonte: "manual", descricao: "Lançamentos manuais e histórico", clientes: 1 },
      { codigo: "tiktok", rotulo: "TikTok Shop", fonte: "manual", descricao: "Lançamentos manuais e histórico", clientes: 0 },
    ],
    visao: { codigo: null, rotulo: "Consolidado" },
    permissoes: { lancarManual: true, atualizarDados: false },
    competenciaAtual: "2026-09",
    atualizacoes: {}, atualizarCliente: vi.fn(), dispensarAtualizacao: vi.fn(),
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
  it("expõe busca, competência, squad, filtros rápidos e — em Filtros ▾ — status completo e legado", async () => {
    render(<PainelContasPage />);
    expect(screen.getByRole("searchbox", { name: /buscar cliente/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /competência/i })).toHaveValue("2026-09");
    expect(screen.getByRole("combobox", { name: /filtrar por squad/i })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /filtrar por marketplace/i })).toBeNull();
    const rapidos = screen.getByRole("group", { name: /filtro rápido de status/i });
    expect(within(rapidos).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Todos 67", "Completos 42", "Parciais 5", "Sem dados 20", "Pedem ação 8",
    ]);
    // Status completo (manual/automático) e legado continuam disponíveis.
    await userEvent.click(screen.getByRole("button", { name: /^filtros/i }));
    expect(screen.getByRole("combobox", { name: /filtrar por status/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /mostrar legado/i })).not.toBeChecked();
  });

  it("competência tem passos ‹ › além do select", async () => {
    const e = estado({ competencia: "2026-08" });
    mocks.usePainelContas.mockReturnValue(e);
    render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: "Competência anterior" }));
    expect(e.setCompetencia).toHaveBeenCalledWith("2026-07");
    await userEvent.click(screen.getByRole("button", { name: "Próxima competência" }));
    expect(e.setCompetencia).toHaveBeenCalledWith("2026-09");
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
    await userEvent.click(within(screen.getByRole("group", { name: /filtro rápido/i })).getByRole("button", { name: /^Parciais/ }));
    expect(e.setStatus).toHaveBeenCalledWith("parcial");
    await userEvent.click(screen.getByRole("button", { name: /^filtros/i }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /filtrar por status/i }), "manual");
    expect(e.setStatus).toHaveBeenCalledWith("manual");
    await userEvent.click(screen.getByRole("checkbox", { name: /mostrar legado/i }));
    expect(e.setMostrarLegado).toHaveBeenCalledWith(true);
  });

  it("esconde filtros sem efeito (um squad só)", () => {
    mocks.usePainelContas.mockReturnValue(estado({
      squadsDisponiveis: [{ id: 7, nome: "Squad Alpha" }],
      marketplacesDisponiveis: [{ codigo: "meli", rotulo: "Mercado Livre" }],
    }));
    render(<PainelContasPage />);
    expect(screen.queryByRole("combobox", { name: /filtrar por squad/i })).toBeNull();
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
  it("leitura executiva só com CONTAGENS do servidor: carteira, dados, sem dados, ação e fonte", () => {
    render(<PainelContasPage />);
    const resumoEl = screen.getByTestId("resumo-carteira");
    expect(resumoEl).toHaveTextContent("67 clientes");
    // Com dados = completos + parciais (vocabulário V4).
    expect(resumoEl).toHaveTextContent("47 de 67");
    expect(resumoEl).toHaveTextContent("com dados · 42 completos · 5 parciais");
    expect(resumoEl).toHaveTextContent(/Sem dados\s*20/);
    expect(resumoEl).toHaveTextContent(/Pedem ação\s*8/);
    expect(resumoEl).toHaveTextContent("3 manuais");
    expect(resumoEl).toHaveTextContent("26 do legado ocultos");
    // Nenhum total financeiro da carteira é calculado no front.
    expect(resumoEl).not.toHaveTextContent("R$");
  });

  it("zeros: composição sem segmento vazio e nada pendente", () => {
    mocks.usePainelContas.mockReturnValue(estado({
      resumoCarteira: { operacionais: 10, comDados: 10, semDados: 0, parciais: 0, manuais: 0, automaticos: 10, atencao: 0, legadoOcultos: 0 },
    }));
    render(<PainelContasPage />);
    const resumoEl = screen.getByTestId("resumo-carteira");
    expect(resumoEl).toHaveTextContent("10 de 10");
    expect(within(resumoEl).queryByRole("button", { name: /parciais/i })).toBeNull();
    expect(screen.getByText(/nenhuma regra com clientes neste recorte/i)).toBeInTheDocument();
  });

  it("chips e a composição de Dados filtram pelo mesmo status do servidor", async () => {
    const e = estado();
    mocks.usePainelContas.mockReturnValue(e);
    render(<PainelContasPage />);
    await userEvent.click(within(screen.getByRole("group", { name: /filtro rápido/i })).getByRole("button", { name: /^Pedem ação/ }));
    expect(e.setStatus).toHaveBeenCalledWith("atencao");
    await userEvent.click(within(screen.getByTestId("resumo-carteira")).getByRole("button", { name: /^Parciais/ }));
    expect(e.setStatus).toHaveBeenCalledWith("parcial");
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

    // "Lançar dados" é da CONTA: abre-se o cliente e lança-se na conta certa.
    expect(screen.queryByRole("button", { name: /lançar dados — coremix loja/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Cliente Coremix Loja/ }));
    await userEvent.click(screen.getByRole("button", { name: /lançar dados — shopee 1 · coremix/i }));
    const drawer = screen.getByRole("dialog", { name: /lançar dados.*shopee 1 · coremix/i });
    expect(drawer).toHaveAccessibleDescription(/Coremix Loja/);
    await userEvent.type(within(drawer).getByLabelText("Faturamento (R$)"), "5000");
    await userEvent.click(within(drawer).getByRole("button", { name: /salvar lançamento/i }));
    expect(e.salvarManual).toHaveBeenCalledWith(3, 31, expect.objectContaining({ faturamento: 5000 }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("atualizar dados", () => {
  const job = (over = {}) => ({
    id: "j1", clienteId: 1, competencia: "2026-09", estado: "executando",
    periodo: { competencia: "2026-09", dateFrom: "2026-09-01", dateTo: "2026-09-29", incluiHoje: true, mesCompleto: false },
    progresso: { fase: "contas", concluidas: 1, total: 2 },
    contas: [{ contaId: 11, estado: "ok" }, { contaId: 12, estado: "pendente" }],
    mensagem: null, concluidaEm: null,
    ...over,
  });

  it("a regra de frescor está sempre escrita: automático até ontem", () => {
    render(<PainelContasPage />);
    const regra = screen.getByTestId("regra-atualizacao");
    expect(regra).toHaveTextContent("Atualização automática: até ontem");
    // Sem permissão, nada de "Atualizar agora".
    expect(regra).not.toHaveTextContent("Atualizar agora");
    expect(screen.queryByRole("button", { name: /atualizar dados de/i })).toBeNull();
  });

  it("admin: botão por cliente e a regra diz que 'agora' inclui hoje", async () => {
    const e = estado({ permissoes: { lancarManual: true, atualizarDados: true } });
    mocks.usePainelContas.mockReturnValue(e);
    render(<PainelContasPage />);
    expect(screen.getByTestId("regra-atualizacao")).toHaveTextContent("Atualizar agora: inclui dados parciais de hoje");
    const botao = screen.getByRole("button", { name: "Atualizar dados de Acme Comércio" });
    expect(botao).toHaveAttribute("title", expect.stringMatching(/até hoje, incluindo dados parciais de hoje.*até ontem/));
    await userEvent.click(botao);
    expect(e.atualizarCliente).toHaveBeenCalledWith(1);
  });

  it("admin: cliente sem conta ML conectada tem o botão travado e diz por quê", () => {
    mocks.usePainelContas.mockReturnValue(estado({
      permissoes: { lancarManual: true, atualizarDados: true }, clientes: [semDadosShopee()],
    }));
    render(<PainelContasPage />);
    const botao = screen.getByRole("button", { name: "Atualizar dados de Coremix Loja" });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringMatching(/nenhuma conta mercado livre/i));
  });

  it("mês anterior: 'agora' reprocessa o mês completo", () => {
    mocks.usePainelContas.mockReturnValue(estado({ competencia: "2026-08", permissoes: { lancarManual: true, atualizarDados: true } }));
    render(<PainelContasPage />);
    expect(screen.getByTestId("regra-atualizacao")).toHaveTextContent("Atualização automática: mês encerrado");
    expect(screen.getByTestId("regra-atualizacao")).toHaveTextContent("reprocessa o mês completo");
  });

  it("em curso: progresso na linha, botão travado, dados continuam na tela", () => {
    mocks.usePainelContas.mockReturnValue(estado({
      permissoes: { lancarManual: true, atualizarDados: true },
      atualizacoes: { 1: { competencia: "2026-09", job: job(), erro: null, iniciando: false } },
    }));
    render(<PainelContasPage />);
    const linha = screen.getByText("Acme Comércio").closest("tr");
    expect(within(linha).getByText("Atualizando até hoje")).toBeInTheDocument();
    const botao = within(linha).getByRole("button", { name: /atualizar dados de/i });
    expect(botao).toHaveTextContent("Atualizando 1/2");
    expect(botao).toBeDisabled();
    expect(within(linha).getByText("R$ 600")).toBeInTheDocument();
  });

  it("falha de uma conta: diz qual conta e por quê, com tentar de novo e dispensar", async () => {
    const e = estado({
      permissoes: { lancarManual: true, atualizarDados: true },
      atualizacoes: {
        1: {
          competencia: "2026-09", erro: null, iniciando: false,
          job: job({
            estado: "concluida_com_pendencias", mensagem: "0 de 1 conta atualizada.", concluidaEm: "2026-09-29T15:03:00.000Z",
            contas: [{ contaId: 11, estado: "falha", mensagem: "Mercado Livre sem autorização válida — reconecte a conta em Clientes." }],
          }),
        },
      },
    });
    mocks.usePainelContas.mockReturnValue(e);
    render(<PainelContasPage />);
    const aviso = screen.getByRole("status", { name: "" });
    expect(aviso).toHaveTextContent("Atualização concluída com pendências");
    expect(aviso).toHaveTextContent("Mercado Livre 1 · ACME — Mercado Livre sem autorização válida");
    await userEvent.click(within(aviso).getByRole("button", { name: "Tentar de novo" }));
    expect(e.atualizarCliente).toHaveBeenCalledWith(1);
    await userEvent.click(within(aviso).getByRole("button", { name: "Dispensar" }));
    expect(e.dispensarAtualizacao).toHaveBeenCalledWith(1);
  });

  it("job de outra competência não aparece na tela atual", () => {
    mocks.usePainelContas.mockReturnValue(estado({
      permissoes: { lancarManual: true, atualizarDados: true },
      atualizacoes: { 1: { competencia: "2026-08", job: job(), erro: null, iniciando: false } },
    }));
    render(<PainelContasPage />);
    expect(screen.queryByText(/Atualizando/)).toBeNull();
  });
});

describe("controle de colunas", () => {
  beforeEach(() => { window.localStorage.setItem("vf:painel-contas:vista", "detalhada"); });

  it("vista essencial é o padrão: FAT · Margem · Ads · Dados, sem menu de colunas", () => {
    window.localStorage.clear();
    render(<PainelContasPage />);
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Cliente", "FAT", "Margem", "Ads", "Dados"]);
    expect(screen.queryByRole("button", { name: /colunas/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Essencial" })).toHaveAttribute("aria-pressed", "true");
  });

  it("a vista escolhida fica guardada", async () => {
    window.localStorage.clear();
    render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: "Detalhada" }));
    expect(window.localStorage.getItem("vf:painel-contas:vista")).toBe("detalhada");
    expect(screen.getByRole("columnheader", { name: "Financeiro" })).toBeInTheDocument();
  });

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

  it("'ninguém precisa de ação' é boa notícia e a saída desfaz só o status", async () => {
    const e = estado({ clientes: [], status: "atencao", temFiltroAtivo: true });
    mocks.usePainelContas.mockReturnValue(e);
    render(<PainelContasPage />);
    expect(screen.getByText(/nenhum cliente precisa de ação em set\/2026/i)).toBeInTheDocument();
    expect(screen.getByText(/nada pendente neste recorte/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ver todos os status" }));
    expect(e.setStatus).toHaveBeenCalledWith("todos");
    expect(e.limparFiltros).not.toHaveBeenCalled();
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
    // O cliente continua na tabela (e também é citado em "Merece atenção").
    expect(screen.getByRole("button", { name: /Cliente Coremix Loja/ })).toBeInTheDocument();
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

describe("seções por marketplace", () => {
  it("Consolidado é a aba padrão e ML/Shopee/TikTok aparecem com a contagem", () => {
    render(<PainelContasPage />);
    const abas = screen.getAllByRole("tab");
    // Nome · fonte (API/manual) · contagem.
    expect(abas.map((a) => a.textContent)).toEqual(["Consolidado", "Mercado LivreAPI1", "Shopeemanual1", "TikTok Shopmanual0"]);
    expect(screen.getByRole("tab", { name: /consolidado/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("secao-descricao")).toHaveTextContent(/soma de todas as contas/i);
  });

  it("clicar numa seção pede ao hook aquele marketplace; setas navegam", async () => {
    const e = estado();
    mocks.usePainelContas.mockReturnValue(e);
    render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("tab", { name: /^shopee/i }));
    expect(e.setMarketplace).toHaveBeenCalledWith("shopee");
    screen.getByRole("tab", { name: /consolidado/i }).focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(e.setMarketplace).toHaveBeenLastCalledWith("tiktok");
  });

  it("seção ativa explica a fonte e o rodapé diz que só aquelas contas somam", () => {
    mocks.usePainelContas.mockReturnValue(estado({
      marketplace: "shopee",
      visao: { codigo: "shopee", rotulo: "Shopee", fonte: "manual", descricao: "Lançamentos manuais e histórico" },
      clientes: [semDadosShopee()],
    }));
    render(<PainelContasPage />);
    expect(screen.getByRole("tab", { name: /^shopee/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("secao-descricao")).toHaveTextContent(/lançamentos manuais e histórico/i);
    expect(screen.getByText(/soma só as contas Shopee/i)).toBeInTheDocument();
  });

  it("seção manual sem dados não promete atualização automática", () => {
    mocks.usePainelContas.mockReturnValue(estado({
      marketplace: "tiktok", clientes: [semDadosShopee()],
      visao: { codigo: "tiktok", rotulo: "TikTok Shop", fonte: "manual", descricao: "Lançamentos manuais e histórico" },
    }));
    render(<PainelContasPage />);
    expect(screen.getByText(/TikTok Shop não tem integração automática/i)).toBeInTheDocument();
    expect(screen.queryByText(/roda de madrugada/i)).toBeNull();
  });

  it("seção vazia diz que não há operação daquele marketplace e oferece voltar ao consolidado", async () => {
    const e = estado({
      marketplace: "tiktok", clientes: [],
      visao: { codigo: "tiktok", rotulo: "TikTok Shop", fonte: "manual", descricao: "Lançamentos manuais e histórico" },
    });
    mocks.usePainelContas.mockReturnValue(e);
    render(<PainelContasPage />);
    expect(screen.getByText(/nenhum cliente com operação TikTok Shop/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /ver consolidado/i }));
    expect(e.setMarketplace).toHaveBeenCalledWith(null);
  });
});

describe("acesso por Squad", () => {
  it("papel fora da equipe interna (403) mostra estado de acesso, não erro técnico", () => {
    mocks.usePainelContas.mockReturnValue(estado({
      clientes: null, erro: { codigo: "sem_permissao", status: 403, mensagem: "Você não tem permissão." },
    }));
    render(<PainelContasPage />);
    expect(screen.getByText(/não está liberado para você/i)).toBeInTheDocument();
    expect(screen.getByText(/exclusivo da equipe interna/i)).toBeInTheDocument();
    expect(screen.queryByText(/coordena/i)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /tentar de novo/i })).toBeNull();
  });

  it("interno sem Squad vê estado vazio próprio, sem clientes", () => {
    mocks.usePainelContas.mockReturnValue(estado({
      clientes: [], squadsDisponiveis: [], acesso: { tipo: "nenhum", squads: [], clientesComoGestor: 0 },
      resumoCarteira: { operacionais: 0, comDados: 0, semDados: 0, parciais: 0, manuais: 0, automaticos: 0, atencao: 0, legadoOcultos: 0 },
    }));
    render(<PainelContasPage />);
    expect(screen.getByText("Você ainda não faz parte de um Squad")).toBeInTheDocument();
    expect(screen.queryByText(/não está liberado/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /lançar dados/i })).toBeNull();
  });

  it("membro de vários Squads alterna a carteira pelo filtro de Squad", async () => {
    const e = estado({ acesso: { tipo: "carteira", squads: [{ id: 7, nome: "Squad Alpha" }, { id: 9, nome: "Squad Beta" }], clientesComoGestor: 0 } });
    mocks.usePainelContas.mockReturnValue(e);
    render(<PainelContasPage />);
    const filtro = screen.getByRole("combobox", { name: /filtrar por squad/i });
    await userEvent.selectOptions(filtro, "9");
    expect(e.setSquadId).toHaveBeenCalledWith(9);
    expect(screen.getByTestId("escopo-acesso")).toHaveTextContent("Seus Squads: Squad Alpha, Squad Beta");
  });

  it("membro de um Squad só não vê o filtro de Squad", () => {
    mocks.usePainelContas.mockReturnValue(estado({ squadsDisponiveis: [{ id: 7, nome: "Squad Alpha" }] }));
    render(<PainelContasPage />);
    expect(screen.queryByRole("combobox", { name: /filtrar por squad/i })).toBeNull();
  });

  it("membro comum tem o botão de lançamento quando o servidor libera a conta", async () => {
    mocks.usePainelContas.mockReturnValue(estado({
      clientes: [semDadosShopee()],
      acesso: { tipo: "carteira", squads: [{ id: 7, nome: "Squad Alpha", funcao: "membro" }], clientesComoGestor: 0 },
    }));
    render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: /Cliente Coremix Loja/ }));
    expect(screen.getByRole("button", { name: /lançar dados — shopee 1 · coremix/i })).toBeInTheDocument();
  });

  it("cabeçalho diz de onde vem a carteira", () => {
    mocks.usePainelContas.mockReturnValue(estado({
      acesso: { tipo: "carteira", squads: [{ id: 2, nome: "Squad 2", funcao: "membro" }], clientesComoGestor: 1 },
    }));
    render(<PainelContasPage />);
    expect(screen.getByTestId("escopo-acesso")).toHaveTextContent("Seu Squad: Squad 2 · gestor de 1 cliente");
  });

  it("descreverAcesso cobre admin, membro de Squad(s), gestor e ausência", () => {
    expect(descreverAcesso({ tipo: "admin" })).toBe("todos os Squads");
    expect(descreverAcesso({ tipo: "carteira", squads: [{ nome: "A" }, { nome: "B" }], clientesComoGestor: 0 })).toBe("Seus Squads: A, B");
    expect(descreverAcesso({ tipo: "carteira", squads: [], clientesComoGestor: 3 })).toBe("gestor de 3 clientes");
    expect(descreverAcesso({ tipo: "carteira", squads: [{ nome: "Squad 4", funcao: "gestor" }], clientesComoGestor: 0 })).toBe("Seu Squad: Squad 4");
    expect(descreverAcesso({ tipo: "nenhum", squads: [], clientesComoGestor: 0 })).toBeNull();
    expect(descreverAcesso(null)).toBeNull();
  });
});

describe("modo manual (PAINEL_CONTAS_AUTO_UPDATE_ENABLED desligada)", () => {
  const modoManual = { codigo: "manual", rotulo: "Modo manual", manualPrevalece: true, atualizacaoAutomatica: false };
  // Conta ML COM dado da API: no modo manual a equipe lança por cima.
  const mlComApi = () => cliente({
    contas: [{
      ...cliente().contas[0], podeLancarManual: true,
    }],
    podeLancarManual: true,
  });

  it("diz que o Painel está em modo manual e não promete atualização automática", () => {
    mocks.usePainelContas.mockReturnValue(estado({ modo: modoManual }));
    render(<PainelContasPage />);
    // Selo compacto no cabeçalho (não mais uma faixa da largura da tela): o
    // aviso curto está sempre visível; a explicação completa abre em "Entender".
    const indicador = screen.getByTestId("banner-modo-manual");
    expect(indicador).toHaveTextContent("Modo manual");
    expect(indicador).toHaveTextContent(/prevalecem sobre a API/);
    expect(within(screen.getByRole("banner")).getByTestId("banner-modo-manual")).toBe(indicador);
    // O selo já diz "Modo manual"; a nota ao lado da competência diz o estado
    // do mês e que não há atualização automática — sem prometer "até ontem".
    expect(screen.getByTestId("regra-atualizacao")).toHaveTextContent("Mês em andamento · sem atualização automática");
    expect(screen.getByTestId("regra-atualizacao")).not.toHaveTextContent("até ontem");
    expect(screen.queryByRole("button", { name: /atualizar dados de/i })).toBeNull();
  });

  it("'Entender' abre e fecha a explicação completa do modo manual", async () => {
    mocks.usePainelContas.mockReturnValue(estado({ modo: modoManual }));
    render(<PainelContasPage />);
    const entender = screen.getByRole("button", { name: "Entender" });
    expect(entender).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Painel em modo manual")).toBeNull();
    await userEvent.click(entender);
    expect(entender).toHaveAttribute("aria-expanded", "true");
    const detalhe = screen.getByRole("region", { name: "Sobre o modo manual" });
    expect(detalhe).toHaveTextContent("Painel em modo manual");
    expect(detalhe).toHaveTextContent(/nenhuma rotina automática os substitui/);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Sobre o modo manual" })).toBeNull();
  });

  it("modo automático não mostra a faixa de modo manual", () => {
    mocks.usePainelContas.mockReturnValue(estado({ modo: { codigo: "automatico" } }));
    render(<PainelContasPage />);
    expect(screen.queryByTestId("banner-modo-manual")).toBeNull();
  });

  it("ML com API aceita lançamento, mostra a referência e confirma o que foi salvo", async () => {
    const salvarManual = vi.fn().mockResolvedValue({
      ok: true, competencia: "2026-09",
      conta: { rotulo: "Mercado Livre 1 · ACME", fonte: { tipo: "manual" }, resumo: resumo({ fat: 7000 }) },
    });
    mocks.usePainelContas.mockReturnValue(estado({ modo: modoManual, clientes: [mlComApi()], salvarManual }));
    render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: /Cliente Acme Comércio/ }));
    // Conta com dado da API: corrigir por cima mora no detalhe da conta.
    await userEvent.click(screen.getByRole("button", { name: /conta mercado livre 1 · acme.*expandir/i }));
    await userEvent.click(screen.getByRole("button", { name: "Corrigir com lançamento manual" }));
    const drawer = screen.getByRole("dialog", { name: /corrigir com lançamento manual/i });
    expect(within(drawer).getByTestId("referencia-api")).toHaveTextContent("Referência da API");
    expect(within(drawer).getByText(/prevalece sobre a API/)).toBeInTheDocument();
    await userEvent.type(within(drawer).getByLabelText("Faturamento (R$)"), "7000");
    await userEvent.click(within(drawer).getByRole("button", { name: /salvar lançamento/i }));
    expect(salvarManual).toHaveBeenCalledWith(1, 11, expect.objectContaining({ faturamento: 7000 }));
    const confirmacao = await screen.findByTestId("confirmacao-lancamento");
    expect(confirmacao).toHaveTextContent("Lançamento salvo");
    expect(confirmacao).toHaveTextContent("Mercado Livre 1 · ACME");
    expect(confirmacao).toHaveTextContent("Origem: Manual");
  });

  it("falha ao salvar fica no drawer com a mensagem do servidor, sem confirmação falsa", async () => {
    const salvarManual = vi.fn().mockRejectedValue(new Error("Seu papel não permite lançar dados manuais."));
    mocks.usePainelContas.mockReturnValue(estado({ modo: modoManual, clientes: [mlComApi()], salvarManual }));
    render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: /Cliente Acme Comércio/ }));
    // Conta com dado da API: corrigir por cima mora no detalhe da conta.
    await userEvent.click(screen.getByRole("button", { name: /conta mercado livre 1 · acme.*expandir/i }));
    await userEvent.click(screen.getByRole("button", { name: "Corrigir com lançamento manual" }));
    const drawer = screen.getByRole("dialog", { name: /corrigir com lançamento manual/i });
    await userEvent.type(within(drawer).getByLabelText("Faturamento (R$)"), "7000");
    await userEvent.click(within(drawer).getByRole("button", { name: /salvar lançamento/i }));
    expect(await within(drawer).findByRole("alert")).toHaveTextContent("Seu papel não permite");
    expect(screen.queryByTestId("confirmacao-lancamento")).toBeNull();
  });
});

describe("V4: Merece atenção e fila de lançamento", () => {
  const dois = () => [cliente(), semDadosShopee(), cliente({
    id: 4, nome: "Duplo Shop", status: { codigo: "parcial", rotulo: "Parcial", motivo: "1 de 2 contas com dados", precisaAtencao: true },
    escopo: { tipo: "consolidado", rotulo: "Consolidado · 1 de 2 contas", contasOperacionais: 2, contasComDado: 1 },
    contas: [cliente().contas[0], {
      id: 42, rotulo: "Shopee 1 · DUPLO", marketplace: "shopee", ativa: true, avisos: [],
      status: { codigo: "sem_integracao", rotulo: "Sem integração", motivo: "Marketplace sem integração automática" },
      fonte: null, resumo: null, podeLancarManual: true, manual: null, precisaAcao: true,
    }],
  })];

  it("mostra só regras com fonte real, cada uma com os clientes e a saída", () => {
    mocks.usePainelContas.mockReturnValue(estado({ clientes: dois() }));
    render(<PainelContasPage />);
    const att = screen.getByTestId("merece-atencao");
    expect(within(att).getByText("Sem dados")).toBeInTheDocument();
    expect(within(att).getByText("Aguardam lançamento")).toBeInTheDocument();
    expect(within(att).getByText("Dados parciais")).toBeInTheDocument();
    expect(within(att).queryByText(/margem baixa|tacos elevado/i)).toBeNull();
    expect(within(att).getByRole("button", { name: "Ver todos (3)" })).toBeInTheDocument();
  });

  it("'Lançar pendentes' abre o drawer na 1ª conta pendente, com a posição na fila", async () => {
    mocks.usePainelContas.mockReturnValue(estado({ clientes: dois() }));
    render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: "Lançar pendentes (2)" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByTestId("fila-lancamento")).toHaveTextContent("Fila 1 de 2");
    expect(within(dialogo).getByTestId("fila-lancamento")).toHaveTextContent("0 lançadas");
    expect(dialogo).toHaveAccessibleDescription(/Coremix Loja/);
    expect(within(dialogo).getByRole("button", { name: "Salvar e próxima" })).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Anterior da fila" })).toBeDisabled();
    await userEvent.click(within(dialogo).getByRole("button", { name: "Pular" }));
    expect(await screen.findByRole("dialog", { name: /shopee 1 · duplo/i })).toHaveAccessibleDescription(/Duplo Shop/);
    expect(screen.getByTestId("fila-lancamento")).toHaveTextContent("Fila 2 de 2");
    // A pulada continua navegável para trás.
    expect(screen.getByRole("button", { name: "Anterior da fila" })).toBeEnabled();
    // Pular a última encerra a fila e oferece voltar às puladas.
    await userEvent.click(screen.getByRole("button", { name: "Pular" }));
    const fim = await screen.findByTestId("fila-concluida");
    expect(fim).toHaveTextContent("0 de 2 contas lançadas");
    expect(fim).toHaveTextContent("2 contas puladas continuam pendentes");
    await userEvent.click(screen.getByRole("button", { name: "Voltar às puladas" }));
    expect(await screen.findByTestId("fila-lancamento")).toHaveTextContent("Fila 1 de 2");
  });

  it("'Salvar e próxima' grava, conta como lançada e segue; a última fecha a fila", async () => {
    const e = estado({ clientes: dois() });
    mocks.usePainelContas.mockReturnValue(e);
    render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: "Lançar pendentes (2)" }));
    await userEvent.type(screen.getByLabelText("Faturamento (R$)"), "5000");
    await userEvent.click(screen.getByRole("button", { name: "Salvar e próxima" }));
    expect(e.salvarManual).toHaveBeenCalledWith(3, 31, expect.objectContaining({ faturamento: 5000 }));
    expect(await screen.findByRole("dialog", { name: /shopee 1 · duplo/i })).toBeInTheDocument();
    expect(screen.getByTestId("fila-lancamento")).toHaveTextContent("1 lançada");
    await userEvent.type(screen.getByLabelText("Faturamento (R$)"), "800");
    await userEvent.click(screen.getByRole("button", { name: "Salvar e próxima" }));
    expect(e.salvarManual).toHaveBeenLastCalledWith(4, 42, expect.objectContaining({ faturamento: 800 }));
    expect(await screen.findByTestId("fila-concluida")).toHaveTextContent("2 de 2 contas lançadas");
    expect(screen.queryByRole("button", { name: "Voltar às puladas" })).toBeNull();
  });

  it("fechar o drawer com alterações não salvas pede confirmação", async () => {
    mocks.usePainelContas.mockReturnValue(estado({ clientes: dois() }));
    render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: "Lançar pendentes (2)" }));
    await userEvent.type(screen.getByLabelText("Faturamento (R$)"), "5000");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByText("Descartar o que foi digitado?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Continuar editando" }));
    expect(screen.getByLabelText("Faturamento (R$)")).toHaveValue("5000");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("sem permissão de lançar, não há fila nem botão de lançar pendentes", () => {
    mocks.usePainelContas.mockReturnValue(estado({ clientes: dois(), permissoes: { lancarManual: false, atualizarDados: false } }));
    render(<PainelContasPage />);
    expect(screen.queryByRole("button", { name: /lançar pendentes/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Abrir fila" })).toBeNull();
  });

  it("'Abrir pendentes' abre os clientes que pedem ação sem nova requisição", async () => {
    const e = estado({ clientes: dois() });
    mocks.usePainelContas.mockReturnValue(e);
    render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir pendentes (2)" }));
    expect(screen.getByRole("button", { name: /Cliente Coremix Loja — recolher/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cliente Duplo Shop — recolher/ })).toBeInTheDocument();
    expect(e.carregarMeses).not.toHaveBeenCalled();
  });
});

describe("V4: Filtros avançados e Exibir", () => {
  beforeEach(() => { try { window.localStorage.clear(); } catch { /* jsdom */ } });

  it("MC abaixo de recorta a lista carregada, diz 'N de M' e 'Limpar filtros' zera", async () => {
    mocks.usePainelContas.mockReturnValue(estado({ clientes: [cliente(), semDadosShopee()] }));
    render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
    await userEvent.type(screen.getByLabelText("MC abaixo de (%)"), "50");
    await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(screen.getByRole("button", { name: /^Filtros · 1/ })).toBeInTheDocument();
    expect(screen.getByText(/1 de 2/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cliente Coremix Loja/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(screen.getByRole("button", { name: /Cliente Coremix Loja/ })).toBeInTheDocument();
  });

  it("filtro que esvazia a lista mostra o aviso com a saída", async () => {
    mocks.usePainelContas.mockReturnValue(estado({ clientes: [cliente()] }));
    render(<PainelContasPage />);
    await userEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
    await userEvent.type(screen.getByLabelText("MC abaixo de (%)"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    const aviso = screen.getByTestId("filtros-locais-vazio");
    await userEvent.click(within(aviso).getByRole("button", { name: "Limpar filtros avançados" }));
    expect(screen.queryByTestId("filtros-locais-vazio")).toBeNull();
  });

  it("Exibir: densidade compacta marca a lista; agrupar fica desligado com um squad só", async () => {
    const { container } = render((() => {
      mocks.usePainelContas.mockReturnValue(estado({ clientes: [cliente()] }));
      return <PainelContasPage />;
    })());
    await userEvent.click(screen.getByRole("button", { name: /^Exibir/ }));
    await userEvent.click(screen.getByRole("button", { name: "Compacta" }));
    expect(container.querySelector(".vf-ph-lista")).toHaveClass("is-compacta");
    expect(screen.getByRole("checkbox", { name: "Agrupar por squad" })).toBeDisabled();
    expect(screen.getByText("Sua carteira tem um squad só")).toBeInTheDocument();
  });
});
