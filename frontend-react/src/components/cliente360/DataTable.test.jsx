// Guarda estrutural do layout da Cliente 360.
//
// O que quebrou antes: cada seção tinha `<table>` próprio, sem largura de coluna
// declarada — a mesma coluna "Produto" ficava num lugar diferente em cada tabela.
// Estes testes travam as decisões que sustentam o alinhamento:
//   - toda tabela é semântica e passa pelo DataTable;
//   - toda coluna declara largura via <colgroup>;
//   - as larguras somam 100% (com table-layout: fixed, é isso que fixa a coluna);
//   - a grade de KPIs tem contagem de colunas explícita, sem card órfão.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import DataTable, { CelulaProduto } from "./DataTable.jsx";
import Cliente360Page from "../../pages/Cliente360Page.jsx";
import { payloadCliente360 } from "../../test/payload.js";

const mocks = vi.hoisted(() => ({
  obterResultado: vi.fn(),
  listarClientes: vi.fn(),
  simular: vi.fn(),
  obterElasticidades: vi.fn(),
  obterPlacar: vi.fn(),
}));

vi.mock("../../services/cliente360Api.js", () => mocks);
vi.mock("../../services/apiClient.js", async () => {
  const real = await vi.importActual("../../services/apiClient.js");
  return { ...real, ehAdmin: () => false, getToken: () => "t", irParaLogin: vi.fn() };
});

const COLUNAS = [
  { key: "nome", header: "Produto", width: "60%", isRowHeader: true, variant: "produto",
    render: (l) => <CelulaProduto titulo={l.nome} mlb={l.mlb} /> },
  { key: "valor", header: "Valor", width: "40%", align: "right", render: (l) => l.valor },
];

describe("DataTable", () => {
  it("renderiza tabela semântica com thead/tbody e cabeçalho de linha", () => {
    render(<DataTable columns={COLUNAS} rows={[{ nome: "A", mlb: "MLB1", valor: "R$ 10,00" }]} getRowKey={(l) => l.mlb} />);

    const tabela = screen.getByRole("table");
    expect(tabela.querySelector("thead")).toBeTruthy();
    expect(tabela.querySelector("tbody")).toBeTruthy();
    expect(within(tabela).getByRole("columnheader", { name: "Produto" })).toBeInTheDocument();
    expect(within(tabela).getByRole("rowheader")).toBeInTheDocument();
  });

  it("declara a largura de cada coluna em <colgroup>", () => {
    render(<DataTable columns={COLUNAS} rows={[]} />);
    const cols = screen.getByRole("table").querySelectorAll("colgroup col");
    expect(cols).toHaveLength(2);
    expect(cols[0].style.width).toBe("60%");
    expect(cols[1].style.width).toBe("40%");
  });

  it("alinha coluna numérica à direita", () => {
    render(<DataTable columns={COLUNAS} rows={[{ nome: "A", mlb: "MLB1", valor: "R$ 10,00" }]} getRowKey={(l) => l.mlb} />);
    expect(screen.getByRole("cell", { name: "R$ 10,00" })).toHaveClass("c360-td--num");
  });

  it("mostra estado vazio ocupando todas as colunas", () => {
    render(<DataTable columns={COLUNAS} rows={[]} emptyLabel="Sem linhas." />);
    const celula = screen.getByRole("cell", { name: "Sem linhas." });
    expect(celula).toHaveAttribute("colspan", "2");
  });

  it("expõe um caption acessível", () => {
    render(<DataTable columns={COLUNAS} rows={[]} caption="Tabela de teste" />);
    expect(screen.getByRole("table", { name: "Tabela de teste" })).toBeInTheDocument();
  });
});

describe("Layout da página", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/cliente-360-react.html?slug=cliente-x&competencia=2026-06&compararCom=2026-05");
    vi.clearAllMocks();
    mocks.listarClientes.mockResolvedValue({ ok: true, clientes: [{ slug: "cliente-x", nome: "Cliente X" }] });
    mocks.obterResultado.mockResolvedValue(payloadCliente360());
    mocks.obterElasticidades.mockResolvedValue({ ok: true, elasticidades: {} });
  });

  afterEach(() => vi.clearAllMocks());

  it("todas as tabelas da página usam a mesma base visual", async () => {
    const { container } = render(<Cliente360Page />);
    await screen.findByText("Fechamento do mês");

    const tabelas = [...container.querySelectorAll("table")];
    expect(tabelas.length).toBeGreaterThan(3);

    for (const tabela of tabelas) {
      // toda tabela nasce do DataTable → sempre dentro do wrapper padrão
      expect(tabela.closest(".c360-tabela")).toBeTruthy();
      // e sempre com as larguras declaradas
      const cols = [...tabela.querySelectorAll("colgroup col")];
      expect(cols.length).toBe(tabela.querySelectorAll("thead th").length);
      expect(cols.every((c) => c.style.width)).toBe(true);
    }
  });

  it("as larguras de coluna somam 100% em cada tabela", async () => {
    const { container } = render(<Cliente360Page />);
    await screen.findByText("Fechamento do mês");

    for (const tabela of container.querySelectorAll("table")) {
      const soma = [...tabela.querySelectorAll("colgroup col")]
        .reduce((total, col) => total + parseFloat(col.style.width), 0);
      expect(Math.round(soma)).toBe(100);
    }
  });

  it("a grade de KPIs não deixa card órfão: 6 derivados + faturamento como base", async () => {
    const { container } = render(<Cliente360Page />);
    await screen.findByText("Fechamento do mês");

    const grade = container.querySelector(".c360-kpis--operacao");
    const cards = [...grade.children];
    expect(cards).toHaveLength(7);

    // Faturamento ocupa a faixa de largura total; os outros 6 formam UMA linha.
    expect(cards[0]).toHaveClass("c360-kpi--base");
    expect(cards.slice(1).every((c) => !c.classList.contains("c360-kpi--base"))).toBe(true);
  });

  it("apenas o Resultado operacional recebe destaque", async () => {
    const { container } = render(<Cliente360Page />);
    await screen.findByText("Fechamento do mês");

    const destaques = container.querySelectorAll(".c360-kpi--destaque");
    expect(destaques).toHaveLength(1);
    expect(destaques[0].textContent).toContain("Resultado operacional");
  });

  it("todas as seções compartilham o mesmo container de régua", async () => {
    const { container } = render(<Cliente360Page />);
    await screen.findByText("Fechamento do mês");

    const secoes = [...container.querySelectorAll("section.vf-section")];
    expect(secoes.length).toBeGreaterThan(5);
    expect(secoes.every((s) => s.classList.contains("c360-secao"))).toBe(true);
    expect(secoes.every((s) => s.closest(".c360"))).toBe(true);
  });
});
