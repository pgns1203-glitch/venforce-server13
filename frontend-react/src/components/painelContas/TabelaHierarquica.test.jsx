// Testes da tabela hierárquica do Painel de Contas operacional.
//
// Hierarquia: CLIENTE (consolidado, escopo explícito) → CONTAS/OPERAÇÕES (na
// mesma resposta, sem requisição) → HISTÓRICO MENSAL (lazy) → SEMANAS (lazy).
// Protege também: ausência honesta ("—", nunca 0), motivo de "sem dados",
// fonte/frescor e direção de variação que NÃO vem do sinal matemático.

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabelaHierarquica, useExpansao, ordenarClientes } from "./TabelaHierarquica.jsx";
import { colunasVisiveis, GRUPOS_PADRAO } from "./colunas.js";

function resumo(over = {}) {
  return { fat: 113000, lc: 20400, mc: 0.181, ads: 4100, acos: 0.041, tacos: 0.036, com: null, atv: null, nps: null, ...over };
}

function conta(id, over = {}) {
  return {
    id, rotulo: `Mercado Livre ${id} · LOJA ${id}`, marketplace: "meli", marketplaceRotulo: "Mercado Livre",
    ativa: true, conectada: true, principal: id === 1, avisos: [],
    status: { codigo: "sincronizado", rotulo: "Sincronizado", motivo: null },
    fonte: { tipo: "api", rotulo: "API" },
    resumo: resumo({ fat: id * 100, ads: null, acos: null, tacos: null }),
    atualizadoEm: "2026-09-29T06:10:00.000Z", dadosAte: "2026-09-28",
    manual: null, podeLancarManual: false, ...over,
  };
}

function cliente(over = {}) {
  return {
    id: 1, slug: "acme", nome: "Acme Comércio",
    squad: { id: 7, nome: "Squad Alpha", slug: "alpha" }, legado: false,
    competencia: "2026-09",
    escopo: { tipo: "consolidado", rotulo: "Consolidado · 3 contas", contasOperacionais: 3, contasComDado: 3 },
    status: { codigo: "sincronizado", rotulo: "Sincronizado", motivo: null, precisaAtencao: false },
    fonte: { tipo: "api", rotulo: "API" },
    atualizadoEm: "2026-09-29T06:20:00.000Z", dadosAte: "2026-09-28",
    resumo: resumo({ fat: 600 }),
    ultimaCompetenciaComDado: "2026-09",
    contas: [conta(1), conta(2), conta(3)],
    podeLancarManual: false,
    ...over,
  };
}

function semDados(over = {}) {
  return cliente({
    resumo: null, fonte: null, atualizadoEm: null, dadosAte: null,
    escopo: { tipo: "conta", rotulo: "Shopee 1 · COREMIX", contasOperacionais: 1, contasComDado: 0 },
    status: { codigo: "sem_dados", rotulo: "Sem dados", motivo: "Marketplace sem integração automática", precisaAtencao: true },
    ultimaCompetenciaComDado: "2026-08",
    contas: [conta(1, {
      rotulo: "Shopee 1 · COREMIX", marketplace: "shopee", resumo: null, fonte: null, atualizadoEm: null, dadosAte: null,
      status: { codigo: "sem_integracao", rotulo: "Sem integração", motivo: "Marketplace sem integração automática" },
      podeLancarManual: true,
    })],
    podeLancarManual: true,
    ...over,
  });
}

function Casca({ clientes, mesesPorCliente = {}, semanasPorChave = {}, carregarMeses = vi.fn(), carregarSemanas = vi.fn(), onLancar = vi.fn(), grupos = GRUPOS_PADRAO }) {
  const expansao = useExpansao();
  return (
    <TabelaHierarquica
      clientes={clientes}
      competencia="2026-09"
      colunas={colunasVisiveis(grupos)}
      grupos={grupos}
      expansao={expansao}
      mesesPorCliente={mesesPorCliente}
      carregarMeses={carregarMeses}
      semanasPorChave={semanasPorChave}
      carregarSemanas={carregarSemanas}
      onLancar={onLancar}
    />
  );
}

const abrirCliente = (nome = "Acme Comércio") => userEvent.click(screen.getByRole("button", { name: new RegExp(`Cliente ${nome}`) }));
const abrirHistorico = () => userEvent.click(screen.getByRole("button", { name: /histórico mensal/i }));

describe("linha do cliente: escopo, status, fonte e frescor sem abrir nada", () => {
  it("diz que o número é consolidado e de quantas contas", () => {
    render(<Casca clientes={[cliente()]} />);
    const linha = screen.getByText("Acme Comércio").closest("tr");
    expect(within(linha).getByText("Consolidado · 3 contas")).toBeInTheDocument();
    expect(within(linha).getByText("Sincronizado")).toBeInTheDocument();
    expect(within(linha).getByText(/· API/)).toBeInTheDocument();
    expect(within(linha).getByText(/atualizado 29\/09\/2026/)).toBeInTheDocument();
    expect(within(linha).getByText(/dados até 28\/09\/2026/)).toBeInTheDocument();
    expect(within(linha).getByText("Squad Alpha")).toBeInTheDocument();
  });

  it("estado é compacto (ponto + texto), e o Squad é a única etiqueta da linha", () => {
    const { container } = render(<Casca clientes={[cliente()]} />);
    const linha = container.querySelector(".vf-ph-row--cliente");
    expect(within(linha).getByText("Sincronizado")).toHaveClass("vf-status", "is-success");
    expect(linha.querySelectorAll(".vf-tag")).toHaveLength(1);
  });

  it("sem dado, o frescor continua escrito — ausência vira —, nunca some", () => {
    render(<Casca clientes={[semDados()]} />);
    const linha = screen.getByText("Acme Comércio").closest("tr");
    expect(within(linha).getByText("dados até —")).toBeInTheDocument();
    expect(within(linha).getByText("· sem fonte")).toBeInTheDocument();
    expect(within(linha).getByText("atualizado —")).toBeInTheDocument();
  });

  it("consolidado parcial nunca parece completo", () => {
    render(<Casca clientes={[cliente({
      escopo: { tipo: "consolidado", rotulo: "Consolidado · 2 de 3 contas", contasOperacionais: 3, contasComDado: 2 },
      status: { codigo: "parcial", rotulo: "Parcial", motivo: "2 de 3 contas com dados", precisaAtencao: true },
    })]} />);
    expect(screen.getByText("Consolidado · 2 de 3 contas")).toBeInTheDocument();
    expect(screen.getByText("Parcial")).toBeInTheDocument();
  });

  it("sem dados explica a competência e o motivo — nunca mostra outro mês no lugar", () => {
    render(<Casca clientes={[semDados()]} />);
    const linha = screen.getByText("Acme Comércio").closest("tr");
    expect(within(linha).getByText("Sem dados em set/2026")).toBeInTheDocument();
    expect(within(linha).getByText("Marketplace sem integração automática")).toBeInTheDocument();
    expect(within(linha).getByText(/último dado: ago\/2026/)).toBeInTheDocument();
    expect(within(linha).queryByText(/R\$ 0/)).toBeNull();
  });

  it('o consolidado não repete "Lançar dados" — diz quantas contas precisam de ação', async () => {
    const onLancar = vi.fn();
    const conta1 = conta(1, { status: { codigo: "sem_conexao", rotulo: "Sem conexão", motivo: "Mercado Livre não conectado" }, resumo: null, podeLancarManual: true, precisaAcao: true });
    const conta2 = conta(2, { status: { codigo: "erro_sync", rotulo: "Erro de sync", motivo: "Última sincronização falhou" }, resumo: null, podeLancarManual: true, precisaAcao: true });
    const c = cliente({
      escopo: { tipo: "consolidado", rotulo: "Consolidado · 1 de 3 contas", contasOperacionais: 3, contasComDado: 1, contasPrecisamAcao: 2 },
      status: { codigo: "parcial", rotulo: "Parcial", motivo: "1 de 3 contas com dados", precisaAtencao: true },
      contas: [conta1, conta2, conta(3)],
      podeLancarManual: true,
    });
    const { container } = render(<Casca clientes={[c]} onLancar={onLancar} />);
    const linha = container.querySelector(".vf-ph-row--cliente");
    expect(within(linha).getByText("2 contas precisam de ação")).toBeInTheDocument();
    expect(within(linha).queryByRole("button", { name: /lançar dados/i })).toBeNull();
    // O motivo "1 de 3 contas com dados" não se repete: o escopo já diz.
    expect(within(linha).queryByText("1 de 3 contas com dados")).toBeNull();

    // A frase mora no alvo da âncora: clicar nela abre as contas.
    await userEvent.click(within(linha).getByText("2 contas precisam de ação"));
    const botoes = screen.getAllByRole("button", { name: /lançar dados/i });
    expect(botoes).toHaveLength(2);
    expect(container.querySelectorAll(".vf-ph-row--conta.is-acao")).toHaveLength(2);
    await userEvent.click(botoes[1]);
    expect(onLancar).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 }));
  });

  it("uma conta só: singular", () => {
    render(<Casca clientes={[semDados({ escopo: { tipo: "conta", rotulo: "Shopee 1 · COREMIX", contasOperacionais: 1, contasComDado: 0, contasPrecisamAcao: 1 } })]} />);
    expect(screen.getByText("1 conta precisa de ação")).toBeInTheDocument();
  });
});

describe("expansão: contas primeiro, histórico sob demanda", () => {
  it("abrir o cliente mostra cada conta com o próprio FAT, sem requisição", async () => {
    const carregarMeses = vi.fn();
    const { container } = render(<Casca clientes={[cliente()]} carregarMeses={carregarMeses} />);
    await abrirCliente();

    const linhas = container.querySelectorAll(".vf-ph-row--conta");
    expect(linhas).toHaveLength(3);
    expect(within(linhas[0]).getByText("Mercado Livre 1 · LOJA 1")).toBeInTheDocument();
    expect(within(linhas[1]).getByText("R$ 200")).toBeInTheDocument();
    expect(carregarMeses).not.toHaveBeenCalled();
  });

  it("Ads por conta é — com a explicação (Ads é medido por cliente)", async () => {
    const { container } = render(<Casca clientes={[cliente()]} />);
    await abrirCliente();
    const linha = container.querySelector(".vf-ph-row--conta");
    expect(within(linha).getAllByTitle(/ads é medido por cliente/i).length).toBeGreaterThan(0);
  });

  it("conta sem dado mostra o motivo e oferece lançar naquela conta", async () => {
    const onLancar = vi.fn();
    const { container } = render(<Casca clientes={[semDados()]} onLancar={onLancar} />);
    await abrirCliente();
    const linha = container.querySelector(".vf-ph-row--conta");
    expect(within(linha).getByText("Sem integração")).toBeInTheDocument();
    await userEvent.click(within(linha).getByRole("button", { name: /lançar dados/i }));
    expect(onLancar).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 1 }));
  });

  it("manual substituído pelo automático continua visível", async () => {
    render(<Casca clientes={[cliente({ contas: [conta(1, { manual: { valores: resumo({ fat: 90 }), substituidoPorAutomatico: true, atualizadoPor: "Ana" } })] })]} />);
    await abrirCliente();
    expect(screen.getByText(/manual substituído/i)).toBeInTheDocument();
  });

  it("histórico é lazy: só busca ao abrir a linha de histórico", async () => {
    const carregarMeses = vi.fn();
    render(<Casca clientes={[cliente()]} carregarMeses={carregarMeses} />);
    await abrirCliente();
    expect(carregarMeses).not.toHaveBeenCalled();
    await abrirHistorico();
    expect(carregarMeses).toHaveBeenCalledWith(1);
  });

  it("no histórico, a competência selecionada fica marcada e as semanas abrem", async () => {
    const mesesPorCliente = {
      1: { meses: [
        { competencia: "2026-08", resumo: resumo(), variacaoVsMesAnterior: null },
        { competencia: "2026-09", resumo: resumo(), variacaoVsMesAnterior: null },
      ] },
    };
    const semanasPorChave = { "1:2026-09": { semanas: [{ semana: "S3", de: "2026-09-15", ate: "2026-09-21", resumo: resumo() }] } };
    const { container } = render(<Casca clientes={[cliente()]} mesesPorCliente={mesesPorCliente} semanasPorChave={semanasPorChave} />);
    await abrirCliente();
    await abrirHistorico();

    const selecionada = container.querySelector(".vf-ph-row--mes.is-selecionada");
    expect(selecionada).toHaveTextContent("set/2026");
    await userEvent.click(within(selecionada).getByRole("button", { name: /expandir semanas/i }));
    expect(screen.getByText("S3")).toBeInTheDocument();
    expect(screen.getByText("15–21")).toBeInTheDocument();
  });

  it("oferece retry no histórico, forçando a recarga", async () => {
    const carregarMeses = vi.fn();
    const mesesPorCliente = { 1: { carregando: false, erro: { mensagem: "Timeout." }, meses: null } };
    render(<Casca clientes={[cliente()]} mesesPorCliente={mesesPorCliente} carregarMeses={carregarMeses} />);
    await abrirCliente();
    await abrirHistorico();
    await userEvent.click(screen.getByRole("button", { name: /tentar novamente/i }));
    expect(carregarMeses).toHaveBeenCalledWith(1, { forcar: true });
  });

  it("marca os níveis por classe, não só por recuo", async () => {
    const mesesPorCliente = { 1: { meses: [{ competencia: "2026-09", resumo: resumo(), variacaoVsMesAnterior: null }] } };
    const { container } = render(<Casca clientes={[cliente()]} mesesPorCliente={mesesPorCliente} />);
    await abrirCliente();
    await abrirHistorico();
    expect(container.querySelectorAll(".vf-ph-row--cliente")).toHaveLength(1);
    expect(container.querySelectorAll(".vf-ph-row--conta")).toHaveLength(3);
    expect(container.querySelectorAll(".vf-ph-row--historico")).toHaveLength(1);
    expect(container.querySelectorAll(".vf-ph-row--mes")).toHaveLength(1);
  });
});

describe("honestidade do dado", () => {
  it("ausência vira — e nunca zero fabricado", () => {
    render(<Casca clientes={[cliente({ resumo: resumo({ fat: null, mc: null }) })]} />);
    const linha = screen.getByText("Acme Comércio").closest("tr");
    const celulas = within(linha).getAllByRole("cell");
    expect(celulas[1]).toHaveTextContent("—");
    expect(celulas.some((c) => c.textContent.includes("R$ 0"))).toBe(false);
  });

  it("zero REAL continua sendo zero", () => {
    render(<Casca clientes={[cliente({ resumo: resumo({ ads: 0 }) })]} />);
    expect(screen.getByText("R$ 0")).toBeInTheDocument();
  });

  it("COM/ATV/NPS, quando exibidas, se declaram sem fonte", () => {
    render(<Casca clientes={[cliente()]} grupos={["financeiro", "ads", "operacao"]} />);
    expect(screen.getAllByTitle(/sem fonte de dado auditada/i).length).toBeGreaterThan(0);
  });
});

describe("direção da variação NÃO sai do sinal matemático", () => {
  async function comVariacao(variacao) {
    const mesesPorCliente = { 1: { meses: [{ competencia: "2026-09", resumo: resumo(), variacaoVsMesAnterior: variacao }] } };
    const r = render(<Casca clientes={[cliente()]} mesesPorCliente={mesesPorCliente} />);
    await abrirCliente();
    await abrirHistorico();
    return r;
  }

  it("FAT subindo é positivo", async () => {
    const { container } = await comVariacao({ fat: { abs: 1000, pct: 0.13 } });
    expect(container.querySelector(".vf-ph-delta.is-positivo")).toHaveTextContent("+13,0%");
  });

  it("ACOS subindo é NEGATIVO", async () => {
    const { container } = await comVariacao({ acos: { pp: 2.4 } });
    const delta = container.querySelector(".vf-ph-delta");
    expect(delta).toHaveTextContent("+2,4 p.p.");
    expect(delta).toHaveClass("is-negativo");
  });

  it("TACoS caindo é POSITIVO", async () => {
    const { container } = await comVariacao({ tacos: { pp: -1.1 } });
    const delta = container.querySelector(".vf-ph-delta");
    expect(delta).toHaveTextContent("−1,1 p.p.");
    expect(delta).toHaveClass("is-positivo");
  });

  it("Invest. Ads é NEUTRO", async () => {
    const { container } = await comVariacao({ ads: { abs: 500, pct: 0.14 } });
    expect(container.querySelector(".vf-ph-delta")).toHaveClass("is-neutro");
  });

  it("a direção também é dita por símbolo, não só por cor", async () => {
    const { container } = await comVariacao({ fat: { abs: -1000, pct: -0.13 } });
    expect(container.querySelector(".vf-ph-delta__simbolo")).toHaveTextContent("▼");
  });
});

describe("ordenação client-side, só no nível cliente", () => {
  const a = cliente({ id: 1, nome: "Alfa", resumo: resumo({ fat: 100 }) });
  const b = cliente({ id: 2, nome: "Beta", resumo: resumo({ fat: 300 }) });
  const semDado = cliente({ id: 3, nome: "Gama", resumo: null, squad: null });

  it("ordena por métrica, do maior para o menor no primeiro clique", async () => {
    render(<Casca clientes={[a, b]} />);
    await userEvent.click(screen.getByRole("button", { name: /ordenar clientes por faturamento/i }));
    const nomes = screen.getAllByRole("rowheader").map((c) => c.textContent);
    expect(nomes[0]).toContain("Beta");
  });

  it("cliente sem dado nunca disputa posição — vai para o fim nos dois sentidos", () => {
    expect(ordenarClientes([a, semDado, b], { chave: "fat", ascendente: false }).at(-1).nome).toBe("Gama");
    expect(ordenarClientes([a, semDado, b], { chave: "fat", ascendente: true }).at(-1).nome).toBe("Gama");
  });

  it("cliente sem squad também vai para o fim ao ordenar por Squad", () => {
    expect(ordenarClientes([semDado, a, b], { chave: "squad", ascendente: true }).at(-1).nome).toBe("Gama");
  });

  it("contas continuam coladas ao próprio cliente depois de ordenar", async () => {
    const { container } = render(<Casca clientes={[a, b]} />);
    await abrirCliente("Alfa");
    await userEvent.click(screen.getByRole("button", { name: /ordenar clientes por faturamento/i }));
    const linhas = Array.from(container.querySelectorAll("tbody tr"));
    const idxAlfa = linhas.findIndex((tr) => tr.textContent.includes("Alfa"));
    expect(linhas[idxAlfa + 1]).toHaveClass("vf-ph-row--conta");
  });
});

describe("semântica de tabela e acessibilidade", () => {
  it("cabeçalhos declaram escopo, incluindo o agrupamento de métricas", () => {
    const { container } = render(<Casca clientes={[cliente()]} />);
    expect(container.querySelector('th[scope="colgroup"]')).not.toBeNull();
    expect(container.querySelectorAll('th[scope="row"]').length).toBeGreaterThan(0);
  });

  it("a caption descreve a hierarquia consolidado → contas → histórico", () => {
    const { container } = render(<Casca clientes={[cliente()]} />);
    expect(container.querySelector("caption")).toHaveTextContent(/consolidado.*contas.*histórico/i);
  });

  it("o rótulo do botão diz o nível e a ação", () => {
    render(<Casca clientes={[cliente()]} />);
    expect(screen.getByRole("button", { name: "Cliente Acme Comércio — expandir contas" })).toBeInTheDocument();
  });

  it("as duas colunas-âncora ficam fixas no scroll horizontal", () => {
    render(<Casca clientes={[cliente()]} />);
    const linha = screen.getByText("Acme Comércio").closest("tr");
    expect(linha.querySelectorAll(".vf-table__sticky-cell")).toHaveLength(2);
  });
});

describe("atualizar dados (admin)", () => {
  function Casca2({ clientes, atualizacoes = {}, podeAtualizar = true, onAtualizar = vi.fn(), onDispensar = vi.fn(), competencia = "2026-09" }) {
    const expansao = useExpansao();
    return (
      <TabelaHierarquica
        clientes={clientes}
        competencia={competencia}
        competenciaAtual="2026-09"
        colunas={colunasVisiveis(GRUPOS_PADRAO)}
        grupos={GRUPOS_PADRAO}
        expansao={expansao}
        mesesPorCliente={{}}
        carregarMeses={vi.fn()}
        semanasPorChave={{}}
        carregarSemanas={vi.fn()}
        atualizacoes={atualizacoes}
        podeAtualizar={podeAtualizar}
        onAtualizar={onAtualizar}
        onDispensarAtualizacao={onDispensar}
      />
    );
  }
  const job = (over = {}) => ({
    id: "j1", clienteId: 1, competencia: "2026-09", estado: "executando",
    periodo: { dateFrom: "2026-09-01", dateTo: "2026-09-29", incluiHoje: true, mesCompleto: false },
    progresso: { fase: "contas", concluidas: 0, total: 3 },
    contas: [{ contaId: 1, estado: "pendente" }, { contaId: 2, estado: "ok" }, { contaId: 3, estado: "pendente" }],
    ...over,
  });

  it("sem permissão, nenhum botão", () => {
    render(<Casca2 clientes={[cliente()]} podeAtualizar={false} />);
    expect(screen.queryByRole("button", { name: /atualizar dados/i })).toBeNull();
  });

  it("dispara pelo id do cliente", async () => {
    const onAtualizar = vi.fn();
    render(<Casca2 clientes={[cliente()]} onAtualizar={onAtualizar} />);
    await userEvent.click(screen.getByRole("button", { name: "Atualizar dados de Acme Comércio" }));
    expect(onAtualizar).toHaveBeenCalledWith(1);
  });

  it("mês anterior: o botão explica que reprocessa o mês completo", () => {
    render(<Casca2 clientes={[cliente({ competencia: "2026-08" })]} competencia="2026-08" />);
    expect(screen.getByRole("button", { name: /atualizar dados/i })).toHaveAttribute("title", "Atualizar agora: reprocessa ago/2026 completo (mês encerrado).");
  });

  it("em curso: progresso escrito, contas pendentes marcadas como sincronizando", async () => {
    const { container } = render(<Casca2 clientes={[cliente()]} atualizacoes={{ 1: { competencia: "2026-09", job: job(), iniciando: false } }} />);
    expect(screen.getByText("Atualizando até hoje · 0/3 contas")).toBeInTheDocument();
    expect(screen.getByText("atualizando…")).toBeInTheDocument();
    await abrirCliente();
    const contas = container.querySelectorAll(".vf-ph-row--conta");
    expect(within(contas[0]).getByText("sincronizando…")).toBeInTheDocument();
    expect(within(contas[1]).queryByText("sincronizando…")).toBeNull();
  });

  it("conta com erro antigo sincronizando agora: mostra o agora, não o erro velho", async () => {
    const c = cliente({ contas: [conta(1, { resumo: null, status: { codigo: "erro_sync", rotulo: "Erro de sync", motivo: "Última sincronização falhou" } })] });
    const { container } = render(<Casca2 clientes={[c]} atualizacoes={{ 1: { competencia: "2026-09", job: job({ contas: [{ contaId: 1, estado: "pendente" }] }) } }} />);
    await abrirCliente();
    const linha = container.querySelector(".vf-ph-row--conta");
    expect(within(linha).getByText("sincronizando…")).toBeInTheDocument();
    expect(within(linha).queryByText(/Última sincronização falhou/)).toBeNull();
  });

  it("iniciando (antes da resposta do servidor): já trava o botão", () => {
    render(<Casca2 clientes={[cliente()]} atualizacoes={{ 1: { competencia: "2026-09", job: null, iniciando: true } }} />);
    expect(screen.getByRole("button", { name: /atualizar dados/i })).toBeDisabled();
    expect(screen.getByText("Atualizando até hoje…")).toBeInTheDocument();
  });

  it("concluída sem pendência: nenhuma faixa extra, frescor com ✓", () => {
    const { container } = render(<Casca2 clientes={[cliente()]} atualizacoes={{ 1: { competencia: "2026-09", job: job({ estado: "concluida", contas: [] }) } }} />);
    expect(container.querySelector(".vf-ph-row--atualizacao")).toBeNull();
    expect(container.querySelector(".vf-ph-frescor--ok")).toHaveTextContent("atualizado 29/09/2026");
  });

  it("falha de uma conta: faixa logo abaixo do cliente (mesmo recolhido) nomeando a conta", async () => {
    const onDispensar = vi.fn();
    const { container } = render(<Casca2
      clientes={[cliente()]}
      onDispensar={onDispensar}
      atualizacoes={{ 1: { competencia: "2026-09", job: job({
        estado: "concluida_com_pendencias", mensagem: "2 de 3 contas atualizadas.", concluidaEm: "2026-09-29T15:03:00.000Z",
        contas: [{ contaId: 1, estado: "ok" }, { contaId: 2, estado: "falha", mensagem: "Mercado Livre sem autorização válida — reconecte a conta em Clientes." }, { contaId: 3, estado: "ok" }],
      }) } }}
    />);
    const faixa = container.querySelector(".vf-ph-row--atualizacao");
    expect(faixa).toHaveClass("is-pendencia");
    expect(faixa.previousElementSibling).toHaveClass("vf-ph-row--cliente");
    expect(faixa).toHaveTextContent("2 de 3 contas atualizadas.");
    expect(faixa).toHaveTextContent("Mercado Livre 2 · LOJA 2 — Mercado Livre sem autorização válida");
    expect(faixa).not.toHaveTextContent("LOJA 1");
    await abrirCliente();
    expect(within(container.querySelectorAll(".vf-ph-row--conta")[1]).getByText("· falhou na atualização")).toBeInTheDocument();
    await userEvent.click(within(faixa).getByRole("button", { name: "Dispensar" }));
    expect(onDispensar).toHaveBeenCalledWith(1);
  });

  it("erro ao iniciar (ex.: 422): faixa de falha com a mensagem do servidor", () => {
    const { container } = render(<Casca2 clientes={[cliente()]} atualizacoes={{ 1: { competencia: "2026-09", job: null, erro: { mensagem: "Nenhuma conta Mercado Livre ativa e conectada.", status: 422 } } }} />);
    const faixa = container.querySelector(".vf-ph-row--atualizacao");
    expect(faixa).toHaveClass("is-falha");
    expect(faixa).toHaveTextContent("Não foi possível atualizar: Nenhuma conta Mercado Livre ativa e conectada.");
  });
});
