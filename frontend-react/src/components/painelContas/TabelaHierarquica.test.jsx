// Testes da tabela hierárquica do Painel de Contas.
//
// O que está sendo protegido aqui é o que a implementação anterior errava ou
// não tinha: hierarquia distinguível por marcação (não só por padding), área
// de clique que não é o chevron, lazy loading de verdade, retry por linha,
// ausência honesta ("—", nunca 0), e — o mais importante — direção de
// variação que NÃO vem do sinal matemático.

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabelaHierarquica, useExpansao, ordenarClientes } from "./TabelaHierarquica.jsx";
import { colunasVisiveis, GRUPOS_PADRAO } from "./colunas.js";
import { useState } from "react";

function resumo(over = {}) {
  return { fat: 113000, lc: 20400, mc: 0.181, ads: 4100, acos: 0.041, tacos: 0.036, com: null, atv: null, nps: null, ...over };
}

function cliente(over = {}) {
  return {
    id: 1, slug: "acme", nome: "Acme Comércio",
    squad: { id: 7, nome: "Squad Alpha", slug: "alpha" },
    ultimoMesDisponivel: "2026-09", sincronizadoEm: "2026-09-21T12:00:00.000Z",
    resumo: resumo(), ...over,
  };
}

// Casca mínima que dá à tabela o estado de expansão real (o mesmo hook que a
// página usa), para os testes exercitarem a interação e não uma simulação.
function Casca({ clientes, mesesPorCliente = {}, semanasPorChave = {}, carregarMeses = vi.fn(), carregarSemanas = vi.fn(), grupos = GRUPOS_PADRAO }) {
  const expansao = useExpansao();
  return (
    <TabelaHierarquica
      clientes={clientes}
      colunas={colunasVisiveis(grupos)}
      grupos={grupos}
      clientesAbertos={expansao.clientesAbertos}
      mesesAbertos={expansao.mesesAbertos}
      alternarCliente={expansao.alternarCliente}
      alternarMes={expansao.alternarMes}
      mesesPorCliente={mesesPorCliente}
      carregarMeses={carregarMeses}
      semanasPorChave={semanasPorChave}
      carregarSemanas={carregarSemanas}
    />
  );
}

describe("hierarquia visual e semântica", () => {
  it("marca os três níveis por classe, não só por recuo", async () => {
    const mesesPorCliente = {
      1: { carregando: false, erro: null, meses: [{ competencia: "2026-09", sincronizadoEm: "2026-09-21T12:00:00Z", resumo: resumo(), variacaoVsMesAnterior: null }] },
    };
    const semanasPorChave = {
      "1:2026-09": { carregando: false, erro: null, semanas: [{ semana: "S1", de: "2026-09-01", ate: "2026-09-07", resumo: resumo({ lc: null, mc: null, ads: null, acos: null, tacos: null }) }] },
    };
    const { container } = render(<Casca clientes={[cliente()]} mesesPorCliente={mesesPorCliente} semanasPorChave={semanasPorChave} />);

    await userEvent.click(screen.getByRole("button", { name: /expandir competências/i }));
    await userEvent.click(screen.getByRole("button", { name: /expandir semanas/i }));

    expect(container.querySelectorAll(".vf-ph-row--cliente")).toHaveLength(1);
    expect(container.querySelectorAll(".vf-ph-row--mes")).toHaveLength(1);
    expect(container.querySelectorAll(".vf-ph-row--semana")).toHaveLength(1);
  });

  it("a linha do cliente é resumo executivo: período e sincronização sem abrir nada", () => {
    render(<Casca clientes={[cliente()]} />);
    expect(screen.getByText("Acme Comércio")).toBeInTheDocument();
    expect(screen.getByText("set/2026")).toBeInTheDocument();
    expect(screen.getByText(/atualizado 21\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByText("Squad Alpha")).toBeInTheDocument();
  });

  it("a semana mostra o intervalo de dias — S1 sozinho não diz nada", async () => {
    const mesesPorCliente = { 1: { meses: [{ competencia: "2026-09", resumo: resumo(), variacaoVsMesAnterior: null }] } };
    const semanasPorChave = {
      "1:2026-09": { semanas: [{ semana: "S3", de: "2026-09-15", ate: "2026-09-21", resumo: resumo() }] },
    };
    render(<Casca clientes={[cliente()]} mesesPorCliente={mesesPorCliente} semanasPorChave={semanasPorChave} />);
    await userEvent.click(screen.getByRole("button", { name: /expandir competências/i }));
    await userEvent.click(screen.getByRole("button", { name: /expandir semanas/i }));

    expect(screen.getByText("S3")).toBeInTheDocument();
    expect(screen.getByText("15–21")).toBeInTheDocument();
  });
});

describe("expansão", () => {
  it("a célula inteira expande — não é preciso mirar o chevron", async () => {
    const carregarMeses = vi.fn();
    render(<Casca clientes={[cliente()]} carregarMeses={carregarMeses} />);
    const botao = screen.getByRole("button", { name: /Cliente Acme Comércio/i });

    expect(botao).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(botao);
    expect(botao).toHaveAttribute("aria-expanded", "true");
  });

  it("é lazy de verdade: nada é buscado antes de abrir", async () => {
    const carregarMeses = vi.fn();
    render(<Casca clientes={[cliente()]} carregarMeses={carregarMeses} />);
    expect(carregarMeses).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /expandir competências/i }));
    expect(carregarMeses).toHaveBeenCalledWith(1);
  });

  it("recolher e reabrir não refaz a chamada — o cache do hook responde", async () => {
    const carregarMeses = vi.fn();
    const mesesPorCliente = { 1: { carregando: false, erro: null, meses: [] } };
    render(<Casca clientes={[cliente()]} mesesPorCliente={mesesPorCliente} carregarMeses={carregarMeses} />);

    const botao = screen.getByRole("button", { name: /Cliente Acme Comércio/i });
    await userEvent.click(botao);
    await userEvent.click(botao);
    await userEvent.click(botao);
    expect(carregarMeses).not.toHaveBeenCalled();
  });

  it("cliente nunca sincronizado não tenta buscar competência nenhuma", async () => {
    const carregarMeses = vi.fn();
    render(<Casca clientes={[cliente({ resumo: null, ultimoMesDisponivel: null, sincronizadoEm: null })]} carregarMeses={carregarMeses} />);
    await userEvent.click(screen.getByRole("button", { name: /expandir competências/i }));

    expect(carregarMeses).not.toHaveBeenCalled();
    expect(screen.getByText(/nunca foi sincronizado/i)).toBeInTheDocument();
  });
});

describe("erro localizado com ação (§20)", () => {
  it("oferece retry nas competências, forçando a recarga", async () => {
    const carregarMeses = vi.fn();
    const mesesPorCliente = { 1: { carregando: false, erro: { mensagem: "Timeout." }, meses: null } };
    render(<Casca clientes={[cliente()]} mesesPorCliente={mesesPorCliente} carregarMeses={carregarMeses} />);

    await userEvent.click(screen.getByRole("button", { name: /expandir competências/i }));
    await userEvent.click(screen.getByRole("button", { name: /tentar novamente/i }));
    expect(carregarMeses).toHaveBeenCalledWith(1, { forcar: true });
  });

  it("oferece retry nas semanas sem contaminar o resto da tabela", async () => {
    const carregarSemanas = vi.fn();
    const mesesPorCliente = { 1: { meses: [{ competencia: "2026-09", resumo: resumo(), variacaoVsMesAnterior: null }] } };
    const semanasPorChave = { "1:2026-09": { carregando: false, erro: { mensagem: "Falhou." }, semanas: null } };
    render(<Casca clientes={[cliente(), cliente({ id: 2, nome: "Bravo Store" })]} mesesPorCliente={mesesPorCliente} semanasPorChave={semanasPorChave} carregarSemanas={carregarSemanas} />);

    await userEvent.click(screen.getByRole("button", { name: /Cliente Acme Comércio/i }));
    await userEvent.click(screen.getByRole("button", { name: /expandir semanas/i }));
    await userEvent.click(screen.getByRole("button", { name: /tentar novamente/i }));

    expect(carregarSemanas).toHaveBeenCalledWith(1, "2026-09", { forcar: true });
    expect(screen.getByText("Bravo Store")).toBeInTheDocument(); // a página inteira segue de pé
  });
});

describe("honestidade do dado", () => {
  it("ausência vira — e nunca zero fabricado", () => {
    render(<Casca clientes={[cliente({ resumo: resumo({ fat: null, mc: null }) })]} />);
    const linha = screen.getByText("Acme Comércio").closest("tr");
    // celulas[0] é a coluna Contexto (Squad); as métricas vêm depois dela,
    // porque a coluna do cliente é um <th scope="row">, não uma célula.
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
    const semFonte = screen.getAllByTitle(/sem fonte de dado auditada/i);
    expect(semFonte.length).toBeGreaterThan(0);
  });
});

// Este bloco é o coração do §16 — e o bug real da implementação anterior, que
// pintava de verde qualquer variação começando com "+".
describe("direção da variação NÃO sai do sinal matemático", () => {
  function comVariacao(variacao) {
    const mesesPorCliente = {
      1: { meses: [{ competencia: "2026-09", resumo: resumo(), variacaoVsMesAnterior: variacao }] },
    };
    return render(<Casca clientes={[cliente()]} mesesPorCliente={mesesPorCliente} />);
  }

  it("FAT subindo é positivo", async () => {
    const { container } = comVariacao({ fat: { abs: 1000, pct: 0.13 } });
    await userEvent.click(screen.getByRole("button", { name: /expandir competências/i }));
    expect(container.querySelector(".vf-ph-delta.is-positivo")).toHaveTextContent("+13,0%");
  });

  it("ACOS subindo é NEGATIVO — investir mais por venda é pior, não melhor", async () => {
    const { container } = comVariacao({ acos: { pp: 2.4 } });
    await userEvent.click(screen.getByRole("button", { name: /expandir competências/i }));
    const delta = container.querySelector(".vf-ph-delta");
    expect(delta).toHaveTextContent("+2,4 p.p.");
    expect(delta).toHaveClass("is-negativo");
  });

  it("TACoS caindo é POSITIVO", async () => {
    const { container } = comVariacao({ tacos: { pp: -1.1 } });
    await userEvent.click(screen.getByRole("button", { name: /expandir competências/i }));
    const delta = container.querySelector(".vf-ph-delta");
    expect(delta).toHaveTextContent("−1,1 p.p.");
    expect(delta).toHaveClass("is-positivo");
  });

  it("Invest. Ads é NEUTRO — gastar mais não é bom nem ruim por si", async () => {
    const { container } = comVariacao({ ads: { abs: 500, pct: 0.14 } });
    await userEvent.click(screen.getByRole("button", { name: /expandir competências/i }));
    const delta = container.querySelector(".vf-ph-delta");
    expect(delta).toHaveTextContent("+14,0%");
    expect(delta).toHaveClass("is-neutro");
  });

  it("a direção também é dita por símbolo, não só por cor", async () => {
    const { container } = comVariacao({ fat: { abs: -1000, pct: -0.13 } });
    await userEvent.click(screen.getByRole("button", { name: /expandir competências/i }));
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
    const desc = ordenarClientes([a, semDado, b], { chave: "fat", ascendente: false });
    const asc = ordenarClientes([a, semDado, b], { chave: "fat", ascendente: true });
    expect(desc[desc.length - 1].nome).toBe("Gama");
    expect(asc[asc.length - 1].nome).toBe("Gama");
  });

  it("cliente sem squad também vai para o fim ao ordenar por Squad", () => {
    const ordenado = ordenarClientes([semDado, a, b], { chave: "squad", ascendente: true });
    expect(ordenado[ordenado.length - 1].nome).toBe("Gama");
  });

  it("o terceiro clique devolve a ordem do servidor", async () => {
    render(<Casca clientes={[a, b]} />);
    const th = screen.getByRole("button", { name: /ordenar clientes por faturamento/i });
    await userEvent.click(th);
    await userEvent.click(th);
    await userEvent.click(th);
    const nomes = screen.getAllByRole("rowheader").map((c) => c.textContent);
    expect(nomes[0]).toContain("Alfa"); // ordem original
  });

  it("meses permanecem cronológicos, fora do alcance da ordenação", async () => {
    const mesesPorCliente = {
      1: { meses: [
        { competencia: "2026-07", resumo: resumo({ fat: 900 }), variacaoVsMesAnterior: null },
        { competencia: "2026-08", resumo: resumo({ fat: 100 }), variacaoVsMesAnterior: null },
      ] },
    };
    const { container } = render(<Casca clientes={[a]} mesesPorCliente={mesesPorCliente} />);
    await userEvent.click(screen.getByRole("button", { name: /expandir competências/i }));
    await userEvent.click(screen.getByRole("button", { name: /ordenar clientes por faturamento/i }));

    const meses = Array.from(container.querySelectorAll(".vf-ph-row--mes th")).map((c) => c.textContent);
    expect(meses[0]).toContain("jul/2026");
    expect(meses[1]).toContain("ago/2026");
  });
});

describe("semântica de tabela e acessibilidade", () => {
  it("cabeçalhos declaram escopo, incluindo o agrupamento de métricas", () => {
    const { container } = render(<Casca clientes={[cliente()]} />);
    expect(container.querySelector('th[scope="colgroup"]')).not.toBeNull();
    expect(container.querySelectorAll('th[scope="col"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('th[scope="row"]').length).toBeGreaterThan(0);
  });

  it("a tabela tem caption descrevendo a hierarquia para leitor de tela", () => {
    const { container } = render(<Casca clientes={[cliente()]} />);
    expect(container.querySelector("caption")).toHaveTextContent(/expande em competências/i);
  });

  it("o rótulo do botão diz o nível e a ação, não só o nome", () => {
    render(<Casca clientes={[cliente()]} />);
    expect(screen.getByRole("button", { name: "Cliente Acme Comércio — expandir competências" })).toBeInTheDocument();
  });

  it("as duas colunas-âncora ficam fixas no scroll horizontal", () => {
    const { container } = render(<Casca clientes={[cliente()]} />);
    const linha = screen.getByText("Acme Comércio").closest("tr");
    expect(linha.querySelectorAll(".vf-table__sticky-cell")).toHaveLength(2);
  });
});
