// Testes de render da Cliente 360 V3 — Dossiê Operacional.
//
// O que estes testes protegem NÃO é o desenho: é o conjunto de contratos que
// o redesenho não podia afrouxar e que já valia na versão anterior —
//
//   · a página não tem seletor próprio de cliente/conta (herda do Shell);
//   · o Dossiê lê o MESMO payload do backend (payloadCliente360);
//   · resultado indisponível e competência sem fechamento não derrubam a tela
//     e nunca viram zero;
//   · o Motor de Margem só é consultado depois que alguém pede (lazy);
//   · Ads/Saúde/Histórico só são consultados quando existe Resultado;
//   · trocar de operação/competência não deixa drawer da operação anterior
//     aberto;
//   · o Simulador sempre recebe a conta ativa.
//
// Mudanças de comportamento DESTE redesenho, exercitadas abaixo de propósito:
//   · o Simulador é montado só quando aberto — fechado, ele não busca
//     elasticidade nenhuma (antes buscava em toda carga da página);
//   · "Configurar operação" é um drawer no header, não uma seção do dossiê.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Cliente360V3Page from "./Cliente360V3Page.jsx";
import { payloadCliente360 } from "../test/payload.js";

const mocks = vi.hoisted(() => ({
  useOperacaoAtual: vi.fn(),
  useCliente360V3: vi.fn(),
  useProdutosMargem: vi.fn(),
  useSaudeAdsV3: vi.fn(),
  useHistoricoV3: vi.fn(),
  // Simulador e Placar rodam DE VERDADE aqui (só os hooks V3 são mockados) —
  // mocka-se a API, não o componente, para provar reuso real sem ruído de rede.
  simular: vi.fn(),
  obterElasticidades: vi.fn(),
  obterPlacar: vi.fn(),
}));

vi.mock("../hooks/useVfContext.js", () => ({ useOperacaoAtual: mocks.useOperacaoAtual }));
vi.mock("../hooks/useCliente360V3.js", () => ({ useCliente360V3: mocks.useCliente360V3 }));
vi.mock("../hooks/useProdutosMargem.js", () => ({ useProdutosMargem: mocks.useProdutosMargem }));
vi.mock("../hooks/useSaudeAdsV3.js", () => ({ useSaudeAdsV3: mocks.useSaudeAdsV3 }));
vi.mock("../hooks/useHistoricoV3.js", () => ({ useHistoricoV3: mocks.useHistoricoV3 }));
vi.mock("../services/cliente360Api.js", () => ({
  simular: mocks.simular, obterElasticidades: mocks.obterElasticidades, obterPlacar: mocks.obterPlacar,
}));

function operacaoPronta(overrides = {}) {
  return { pronta: true, clienteId: 1, clienteSlug: "cliente-x", clienteContaId: 10, marketplace: "meli", ...overrides };
}

function bootDisponivel(overridesDados = {}) {
  return {
    contexto: {
      clienteId: 1, clienteSlug: "cliente-x", clienteContaId: 10, marketplace: "meli",
      competencia: "2026-06", compararCom: "2026-05", contextKey: "1:10:2026-06:2026-05",
    },
    capabilities: { disponivel: true, escopo: "account", dados: { marketplace: "meli", isMeli: true } },
    resultado: { disponivel: true, escopo: "account", dados: { ...payloadCliente360(), ...overridesDados } },
  };
}

function mockarHooks({
  boot = null, carregando = false, erro = null, operacao = operacaoPronta(),
  margem = { dados: null, carregando: false, erro: null },
  saudeAds = { ads: null, saude: null, carregando: false, erro: null },
  historico = { dados: null, carregando: false, erro: null },
} = {}) {
  mocks.useOperacaoAtual.mockReturnValue(operacao);
  mocks.useCliente360V3.mockReturnValue({ periodo: "2026-06", setPeriodo: vi.fn(), boot, carregando, erro });
  mocks.useProdutosMargem.mockReturnValue(margem);
  mocks.useSaudeAdsV3.mockReturnValue(saudeAds);
  mocks.useHistoricoV3.mockReturnValue(historico);
}

const secao = (id) => document.querySelector(`#${id}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.obterElasticidades.mockResolvedValue({ ok: true, elasticidades: {} });
  mocks.obterPlacar.mockResolvedValue({ totalRecuperado: 0, aindaNaMesa: 0, acoes: [], legado: [], observacao: "" });
  mocks.useSaudeAdsV3.mockReturnValue({ ads: null, saude: null, carregando: false, erro: null });
  mocks.useHistoricoV3.mockReturnValue({ dados: null, carregando: false, erro: null });
});

describe("Cliente360V3Page · sem seletor próprio (herda o Shell)", () => {
  it("não renderiza nenhum <select> de cliente/conta — só o de período", async () => {
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);

    const selects = await screen.findAllByRole("combobox");
    expect(selects).toHaveLength(1);
    expect(within(selects[0].closest("label")).getByText("Período")).toBeInTheDocument();
  });

  it("contexto ainda não pronto: página não renderiza nada (Shell já cobre o estado)", () => {
    mockarHooks({ operacao: operacaoPronta({ pronta: false }), boot: null });
    const { container } = render(<Cliente360V3Page />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Cliente360V3Page · header contextual", () => {
  it("mostra cliente, marketplace, competência e período comparado", () => {
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);

    const cabecalho = document.querySelector(".c360d-header");
    expect(within(cabecalho).getByText("Cliente X")).toBeInTheDocument();
    expect(within(cabecalho).getByText("Mercado Livre")).toBeInTheDocument();
    const periodo = cabecalho.querySelector(".c360d-header__periodo");
    expect(within(periodo).getByText("Junho/2026")).toBeInTheDocument();
    expect(within(periodo).getByText("vs Maio/2026")).toBeInTheDocument();
  });

  it("mostra a confiança do resultado no header (acompanha a rolagem)", () => {
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);
    expect(document.querySelector(".c360d-header__sinais").textContent).toMatch(/Confiança Confiável/);
  });

  it("identifica a operação mesmo sem resultado — o contexto vem do Shell, não do payload", async () => {
    mockarHooks({
      boot: { ...bootDisponivel(), resultado: { disponivel: false, escopo: "account", motivo: "Motor fora do ar.", dados: null } },
    });
    render(<Cliente360V3Page />);

    const cabecalho = document.querySelector(".c360d-header");
    expect(within(cabecalho).getByText("cliente-x")).toBeInTheDocument();
    expect(within(cabecalho).getByText("Mercado Livre")).toBeInTheDocument();
  });

  it("subnav lista só as seções realmente renderizadas, na ordem do dossiê", async () => {
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);
    const subnav = await screen.findByRole("navigation", { name: "Seções do dossiê" });
    const itens = within(subnav).getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(itens).toEqual([
      "#resultado", "#mudancas", "#confianca", "#produtos", "#oportunidades",
      "#ads", "#margem", "#saude", "#historico", "#acoes",
    ]);
  });
});

describe("Cliente360V3Page · Resultado e Mudanças", () => {
  it("faixa executiva traz os seis indicadores do período com variação", () => {
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);

    const faixa = secao("resultado");
    expect(within(faixa).getByText("R$ 100.000")).toBeInTheDocument();   // faturamento
    expect(within(faixa).getByText("R$ 22.000")).toBeInTheDocument();    // resultado operacional
    expect(within(faixa).getByText("R$ 17.900")).toBeInTheDocument();    // após Ads
    expect(within(faixa).getByText("22,0%")).toBeInTheDocument();        // margem
    expect(within(faixa).getByText("500")).toBeInTheDocument();          // pedidos
    // faturamento e resultado variaram o mesmo percentual no fixture
    expect(within(faixa).getAllByText("+11,1%")).toHaveLength(2);
  });

  it("Ads ausente vira '—' com motivo, nunca zero", () => {
    const dados = payloadCliente360({ ads: null, adsStatus: "sem_dados" });
    mockarHooks({ boot: { ...bootDisponivel(), resultado: { disponivel: true, escopo: "account", dados } } });
    render(<Cliente360V3Page />);

    const faixa = secao("resultado");
    expect(within(faixa).getByText("Sem investimento de Ads nesta competência.")).toBeInTheDocument();
    expect(within(faixa).queryByText("R$ 0")).not.toBeInTheDocument();
  });

  it("ponte vira waterfall: uma coluna por fator mais a variação total", () => {
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);

    const mudancas = secao("mudancas");
    // 4 fatores do fixture + coluna de variação total
    expect(mudancas.querySelectorAll(".c360d-ponte__col")).toHaveLength(5);
    expect(within(mudancas).getByText("Volume")).toBeInTheDocument();
    expect(within(mudancas).getByText("Variação total")).toBeInTheDocument();
    expect(within(mudancas).getByText("R$ 19.800")).toBeInTheDocument();
    expect(within(mudancas).getByText("R$ 22.000")).toBeInTheDocument();
  });

  it("clicar num fator abre o drawer com fórmula e produtos responsáveis", async () => {
    const usuario = userEvent.setup();
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);

    await usuario.click(within(secao("mudancas")).getByRole("button", { name: /Custo do produto/ }));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText(/custo unitário atual − custo unitário anterior/)).toBeInTheDocument();
    expect(within(drawer).getByText("Produto 2")).toBeInTheDocument();
  });

  it("a comparação detalhada é aprofundamento (drawer), não a leitura primária", async () => {
    const usuario = userEvent.setup();
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);

    expect(screen.queryByText("Cancelamentos")).not.toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "tabela completa" }));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Cancelamentos")).toBeInTheDocument();
    expect(within(drawer).getByText("Custo do produto")).toBeInTheDocument();
  });
});

describe("Cliente360V3Page · resiliência", () => {
  it("resultado indisponível mostra o motivo e não derruba a página", async () => {
    mockarHooks({
      boot: { ...bootDisponivel(), resultado: { disponivel: false, escopo: "account", motivo: "Falha ao montar o resultado.", dados: null } },
    });
    render(<Cliente360V3Page />);

    expect(await screen.findByText("Resultado indisponível")).toBeInTheDocument();
    expect(screen.getByText("Falha ao montar o resultado.")).toBeInTheDocument();
    expect(secao("mudancas")).not.toBeInTheDocument();
  });

  it("competência sem fechamento: diz o que falta, esconde a subnav e as seções", async () => {
    mockarHooks({
      boot: bootDisponivel({
        estado: { chave: "sem_fechamento", mensagem: "Não há fechamento sincronizado para esta competência.", bloqueante: true },
      }),
    });
    render(<Cliente360V3Page />);

    expect(await screen.findByText("Competência sem fechamento")).toBeInTheDocument();
    expect(screen.getByText("Nada apurado nesta competência")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Seções do dossiê" })).not.toBeInTheDocument();
    expect(secao("mudancas")).not.toBeInTheDocument();
  });

  it("estado não bloqueante vira faixa de atenção acima dos números", async () => {
    mockarHooks({
      boot: bootDisponivel({
        estado: { chave: "atencao_dados", mensagem: "3 pedidos ainda não sincronizados.", bloqueante: false },
      }),
    });
    render(<Cliente360V3Page />);
    expect(await screen.findByText(/3 pedidos ainda não sincronizados/)).toBeInTheDocument();
    expect(secao("resultado")).toBeInTheDocument();
  });

  it("grant caído sobe para a faixa de bloqueio do topo, com ação — não fica escondido em Saúde", async () => {
    mockarHooks({
      boot: bootDisponivel(),
      saudeAds: {
        ads: null,
        saude: { grantBase: { disponivel: true, escopo: "account", dados: { grantConectado: false, grantStatus: "expired", baseVinculada: true } } },
        carregando: false, erro: null,
      },
    });
    render(<Cliente360V3Page />);

    const faixa = document.querySelector(".c360d-bloqueios");
    expect(within(faixa).getByText("Conexão com o Mercado Livre caiu")).toBeInTheDocument();
    expect(within(faixa).getByRole("link", { name: "Reconectar" })).toHaveAttribute("href", "clientes.html?cliente=cliente-x");
  });

  it("operação saudável não ganha banner verde de 'tudo certo'", () => {
    mockarHooks({
      boot: bootDisponivel(),
      saudeAds: {
        ads: null,
        saude: { grantBase: { disponivel: true, escopo: "account", dados: { grantConectado: true, baseVinculada: true, baseSlug: "b" } } },
        carregando: false, erro: null,
      },
    });
    render(<Cliente360V3Page />);
    expect(document.querySelector(".c360d-bloqueios")).not.toBeInTheDocument();
  });
});

describe("Cliente360V3Page · Central de Produtos", () => {
  it("cada produto é UMA linha, com faturamento, participação, impacto, margem e status", () => {
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);

    const produtos = secao("produtos");
    const linhas = produtos.querySelectorAll("tbody tr");
    expect(linhas).toHaveLength(3); // MLB1, MLB2 e MLB3 do fixture, sem repetição
    const primeira = within(linhas[0]);
    expect(primeira.getByText("Produto 1")).toBeInTheDocument();
    expect(primeira.getByText("R$ 40.000")).toBeInTheDocument();
    expect(primeira.getByText("40,0%")).toBeInTheDocument();
    expect(primeira.getByText("+R$ 1.500")).toBeInTheDocument();
  });

  it("modo Problemas filtra a MESMA tabela (não troca de interface)", async () => {
    const usuario = userEvent.setup();
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);

    await usuario.click(within(secao("produtos")).getByRole("button", { name: /Problemas/ }));

    const linhas = secao("produtos").querySelectorAll("tbody tr");
    expect(linhas).toHaveLength(2); // MLB2 (abaixo do alvo) e MLB3 (no vermelho)
    expect(within(secao("produtos")).queryByText("Produto 1")).not.toBeInTheDocument();
  });

  it("ordenar por uma coluna numérica reordena e anuncia a direção", async () => {
    const usuario = userEvent.setup();
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);

    const cabecalho = within(secao("produtos")).getByRole("button", { name: /Faturamento/ });
    await usuario.click(cabecalho);
    expect(cabecalho.closest("th")).toHaveAttribute("aria-sort", "descending");
    await usuario.click(cabecalho);
    expect(cabecalho.closest("th")).toHaveAttribute("aria-sort", "ascending");
  });

  it("clicar num produto abre o drawer com MLB, e Fechar o remove", async () => {
    const usuario = userEvent.setup();
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);

    await usuario.click(within(secao("produtos")).getByText("Produto 1"));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("MLB1")).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ESC fecha o drawer", async () => {
    const usuario = userEvent.setup();
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);

    await usuario.click(within(secao("produtos")).getByText("Produto 1"));
    await screen.findByRole("dialog");
    await usuario.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("trocar de contexto (contextKey) fecha o drawer — nunca mostra produto da operação anterior", async () => {
    const usuario = userEvent.setup();
    mockarHooks({ boot: bootDisponivel() });
    const { rerender } = render(<Cliente360V3Page />);
    await usuario.click(within(secao("produtos")).getByText("Produto 1"));
    await screen.findByRole("dialog");

    const bootOutraConta = bootDisponivel();
    bootOutraConta.contexto = { ...bootOutraConta.contexto, clienteContaId: 11, contextKey: "OUTRA-CONTA" };
    mockarHooks({ boot: bootOutraConta });
    rerender(<Cliente360V3Page />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Motor de Margem só é consultado depois que o modo Margem é aberto (lazy)", async () => {
    const usuario = userEvent.setup();
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);

    expect(mocks.useProdutosMargem).toHaveBeenLastCalledWith(expect.objectContaining({ habilitado: false }));

    await usuario.click(within(secao("produtos")).getByRole("button", { name: "Margem" }));
    expect(mocks.useProdutosMargem).toHaveBeenLastCalledWith(expect.objectContaining({ habilitado: true }));
  });

  it("modo Margem indisponível (multiconta) mostra o motivo real, não uma tabela vazia", async () => {
    const usuario = userEvent.setup();
    mockarHooks({
      boot: bootDisponivel(),
      margem: { dados: { aplicavel: false, motivo: "Motor de Margem ainda não é multiconta-aware." }, carregando: false, erro: null },
    });
    render(<Cliente360V3Page />);
    await usuario.click(within(secao("produtos")).getByRole("button", { name: "Margem" }));

    // A mesma razão aparece em Produtos (onde o usuário acabou de clicar) e no
    // painel Margem (dono do resumo) — são duas perguntas diferentes feitas em
    // dobras diferentes, não repetição na mesma tela.
    expect(await screen.findAllByText("Motor de Margem ainda não é multiconta-aware.")).toHaveLength(2);
    expect(within(secao("produtos")).getByText(/classificação do fechamento/)).toBeInTheDocument();
  });
});

describe("Cliente360V3Page · Oportunidades e Simulador", () => {
  it("oportunidades abrem pelo total recuperável e detalham por causa", () => {
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);

    const mesa = secao("oportunidades");
    expect(within(mesa).getByText("R$ 2.050")).toBeInTheDocument();
    expect(within(mesa).getByText("1 produto(s) com resultado negativo")).toBeInTheDocument();
  });

  it("clicar numa causa abre o drawer com ação recomendada e destino", async () => {
    const usuario = userEvent.setup();
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);

    await usuario.click(within(secao("oportunidades")).getByText("1 produto(s) com resultado negativo"));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText(/Subir preço ao ponto de equilíbrio/)).toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: "Abrir tela de ação" })).toHaveAttribute("href", "bases.html");
  });

  it("Simulador fechado não busca nada; aberto, recebe a conta ativa", async () => {
    const usuario = userEvent.setup();
    mockarHooks({ boot: bootDisponivel(), operacao: operacaoPronta({ clienteContaId: 42 }) });
    render(<Cliente360V3Page />);

    expect(mocks.obterElasticidades).not.toHaveBeenCalled();

    await usuario.click(screen.getByRole("button", { name: "Abrir simulador" }));

    await waitFor(() => expect(mocks.obterElasticidades).toHaveBeenCalled());
    expect(mocks.obterElasticidades).toHaveBeenCalledWith(
      "cliente-x",
      expect.objectContaining({ clienteContaId: 42 })
    );
  });

  it("sem simulacao no payload, o bloco do Simulador não aparece", async () => {
    const bootSemSimulacao = bootDisponivel();
    delete bootSemSimulacao.resultado.dados.simulacao;
    mockarHooks({ boot: bootSemSimulacao });
    render(<Cliente360V3Page />);
    expect(screen.queryByRole("button", { name: "Abrir simulador" })).not.toBeInTheDocument();
  });
});

describe("Cliente360V3Page · Ads, Margem e Saúde", () => {
  it("Ads separa a fonte da conta (Mercado Ads) da fonte do fechamento (TACoS)", async () => {
    mockarHooks({
      boot: bootDisponivel(),
      saudeAds: {
        ads: { disponivel: true, dados: { investimentoAds: 5000, gmvAds: 20000, roas: 4, acos: 25 } },
        saude: null, carregando: false, erro: null,
      },
    });
    render(<Cliente360V3Page />);

    const ads = secao("ads");
    expect(within(ads).getByText("R$ 5.000")).toBeInTheDocument();
    expect(within(ads).getByText("4,00×")).toBeInTheDocument();
    // TACoS = 5000 / 100000 (faturamento do fechamento do fixture) = 5%.
    expect(within(ads).getByText("5,0%")).toBeInTheDocument();
    expect(within(ads).getByText(/Mercado Ads · conta desta operação/)).toBeInTheDocument();
  });

  it("Ads indisponível para a conta mostra o motivo real, nunca zero inventado", () => {
    mockarHooks({
      boot: bootDisponivel(),
      saudeAds: { ads: { disponivel: false, motivo: "Conta sem grant do Mercado Ads." }, saude: null, carregando: false, erro: null },
    });
    render(<Cliente360V3Page />);
    expect(within(secao("ads")).getByText("Conta sem grant do Mercado Ads.")).toBeInTheDocument();
  });

  it("Margem é resumo e não duplica a análise por item — o detalhe leva para a tabela", () => {
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);
    const margem = secao("margem");
    expect(within(margem).getByText("Margem por item não consultada")).toBeInTheDocument();
    expect(within(margem).getByRole("button", { name: "Consultar margem por item" })).toBeInTheDocument();
  });

  it("Saúde mostra as dimensões independentes e rotula escopo que foge da conta", () => {
    mockarHooks({
      boot: bootDisponivel(),
      saudeAds: {
        ads: null,
        saude: {
          grantBase: { disponivel: true, escopo: "account", dados: { grantConectado: true, baseVinculada: true, baseSlug: "base-x" } },
          sync: { disponivel: true, escopo: "account", dados: { ultimasExecucoes: [] } },
          entrega: { disponivel: false, escopo: "client_legacy", motivo: "Nenhuma entrega registrada." },
        },
        carregando: false, erro: null,
      },
    });
    render(<Cliente360V3Page />);

    const saude = secao("saude");
    expect(within(saude).getByText("Conectada")).toBeInTheDocument();
    expect(within(saude).getByText("base-x")).toBeInTheDocument();
    expect(within(saude).getByText("Nenhuma entrega registrada.")).toBeInTheDocument();
    // escopo "account" é o da tela inteira — não se repete em cada linha
    expect(within(saude).queryByText("account")).not.toBeInTheDocument();
  });

  it("Ads/Saúde/Histórico só são consultados quando existe Resultado", () => {
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);
    expect(mocks.useSaudeAdsV3).toHaveBeenLastCalledWith(expect.objectContaining({ habilitado: true, clienteContaId: 10 }));
  });

  it("competência sem fechamento: Ads/Saúde não são consultados", async () => {
    mockarHooks({
      boot: bootDisponivel({ estado: { chave: "sem_fechamento", mensagem: "Sem fechamento.", bloqueante: true } }),
    });
    render(<Cliente360V3Page />);
    await screen.findByText("Competência sem fechamento");
    expect(mocks.useSaudeAdsV3).toHaveBeenLastCalledWith(expect.objectContaining({ habilitado: false }));
    expect(secao("ads")).not.toBeInTheDocument();
  });
});

describe("Cliente360V3Page · Histórico, Ações e Configuração", () => {
  it("histórico é tabular e compacto, com escopo legado rotulado", () => {
    mockarHooks({
      boot: bootDisponivel(),
      historico: {
        dados: {
          eventos: [
            { tipo: "entrega", escopo: "account", timestamp: "2026-08-05T10:00:00Z", titulo: "Fechamento julho", competencia: "2026-07", ator: "consultor@x.com" },
            { tipo: "acao", escopo: "client_legacy", timestamp: "2026-08-01T10:00:00Z", titulo: "Reprecificação", competencia: "2026-07", ator: null },
          ],
          fontes: { entregas: { disponivel: true }, sincronizacao: { disponivel: true }, acoes: { disponivel: true } },
        },
        carregando: false, erro: null,
      },
    });
    render(<Cliente360V3Page />);

    const historico = secao("historico");
    expect(within(historico).getByText("Fechamento julho")).toBeInTheDocument();
    expect(within(historico).getAllByText(/jul\/2026/)).toHaveLength(2);
    expect(within(historico).getByText("consultor")).toBeInTheDocument();
    // escopo legado fica ao lado de quem fez, não numa coluna própria
    expect(within(historico).getByText(/· cliente/)).toBeInTheDocument();
  });

  it("histórico vazio custa uma linha, não uma dobra", () => {
    mockarHooks({
      boot: bootDisponivel(),
      historico: { dados: { eventos: [], fontes: {} }, carregando: false, erro: null },
    });
    render(<Cliente360V3Page />);
    expect(within(secao("historico")).getByText(/Nenhum evento registrado nesta operação ainda/)).toBeInTheDocument();
    expect(secao("historico").querySelector("table")).toBeNull();
  });

  it("uma fonte do histórico indisponível avisa, mas não esconde as outras", () => {
    mockarHooks({
      boot: bootDisponivel(),
      historico: {
        dados: {
          eventos: [{ tipo: "sincronizacao", escopo: "account", timestamp: "2026-08-05T10:00:00Z", titulo: "Sincronização" }],
          fontes: { entregas: { disponivel: false, motivo: "Falha ao consultar entregas." }, sincronizacao: { disponivel: true }, acoes: { disponivel: true } },
        },
        carregando: false, erro: null,
      },
    });
    render(<Cliente360V3Page />);
    const historico = secao("historico");
    expect(within(historico).getByText(/Falha ao consultar entregas\./)).toBeInTheDocument();
    expect(within(historico).getAllByText("Sincronização").length).toBeGreaterThan(0);
  });

  it("placar continua sob demanda e declara o escopo de cliente inteiro", () => {
    mockarHooks({ boot: bootDisponivel() });
    render(<Cliente360V3Page />);
    const acoes = secao("acoes");
    expect(within(acoes).getByText("Placar não apurado")).toBeInTheDocument();
    expect(within(acoes).getByText(/cliente inteiro, não só esta conta/)).toBeInTheDocument();
    expect(mocks.obterPlacar).not.toHaveBeenCalled();
  });

  it("Configuração não é seção do dossiê: é um drawer do header com os módulos donos", async () => {
    const usuario = userEvent.setup();
    mockarHooks({
      boot: bootDisponivel(),
      saudeAds: {
        ads: null,
        saude: { grantBase: { disponivel: true, dados: { grantConectado: false, grantStatus: "expired", baseVinculada: false } } },
        carregando: false, erro: null,
      },
    });
    render(<Cliente360V3Page />);

    expect(secao("configuracao")).not.toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: /Configurar operação/ }));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Grant: expired")).toBeInTheDocument();
    expect(within(drawer).getAllByRole("link", { name: "Gerenciar" })[0]).toHaveAttribute("href", "clientes.html?cliente=cliente-x");
    expect(within(drawer).getAllByRole("link", { name: "Abrir" }).at(-1)).toHaveAttribute("href", "financeiro.html?cliente=cliente-x");
  });
});

describe("Cliente360V3Page · loading e erro", () => {
  it("sem boot e carregando: esqueleto com a forma do dossiê, não o dossiê", () => {
    mockarHooks({ boot: null, carregando: true });
    render(<Cliente360V3Page />);
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    expect(secao("mudancas")).not.toBeInTheDocument();
  });

  it("erro sem boot: mostra estado de erro, não tela em branco", () => {
    mockarHooks({ boot: null, erro: { codigo: "rede", mensagem: "Não foi possível falar com o servidor." } });
    render(<Cliente360V3Page />);
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível falar com o servidor.");
  });
});
