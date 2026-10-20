import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProdutosMesa } from "./ProdutosMesa.jsx";
import { normalizarLinhas } from "../../../utils/financeiro/produtos.js";

const linhasMeli = normalizarLinhas([
  { "# de anúncio": "MLB1", "Título do anúncio": "Calça", Unidades: 1, "Venda Total": 100, "Total (BRL)": 80, "Preço de custo": 30, LC: 20, MC: 20, "Cobertura de custo": "com custo" },
  { "# de anúncio": "MLB2", "Título do anúncio": "Blusa", Unidades: 1, "Venda Total": 50, "Total (BRL)": null, "Preço de custo": 10, LC: null, MC: null, "Cobertura de custo": "financeiro pendente" },
  { "# de anúncio": "MLB3", "Título do anúncio": "Saia", Unidades: 1, "Venda Total": 70, "Total (BRL)": 60, "Preço de custo": null, LC: null, MC: null, "Cobertura de custo": "sem custo" },
]);

const linhaDe = (titulo) => screen.getByText(titulo).closest(".vf-fin-mesa-lista__linha");
const linhasVisiveis = (container) => container.querySelectorAll(".vf-fin-mesa-lista__linha");

describe("ProdutosMesa", () => {
  it("linha com custo e financeiro pendente mostra 'Aguardando financeiro' e LC/MC '—' (não R$ 0,00)", () => {
    render(<ProdutosMesa linhas={linhasMeli} />);
    const linha = linhaDe("Blusa");
    expect(within(linha).getByText("Aguardando financeiro")).toBeInTheDocument();
    expect(within(linha).queryByText("Sem custo")).not.toBeInTheDocument();
    expect(within(linha).queryByText("R$ 0,00")).not.toBeInTheDocument();
  });

  it("ordena por receita, da maior para a menor", () => {
    const { container } = render(<ProdutosMesa linhas={linhasMeli} />);
    const titulos = Array.from(linhasVisiveis(container)).map((l) => l.querySelector(".vf-fin-mesa-produto__titulo").textContent);
    expect(titulos).toEqual(["Calça", "Saia", "Blusa"]);
  });

  it("busca fica à esquerda dos filtros por status", () => {
    const { container } = render(<ProdutosMesa linhas={linhasMeli} />);
    const ferramentas = container.querySelector(".vf-fin-mesa-produtos__ferramentas");
    expect(ferramentas.firstElementChild).toHaveAttribute("type", "search");
    expect(ferramentas.lastElementChild).toHaveAttribute("aria-label", "Filtrar produtos");
  });

  it("filtro 'Sem custo' mostra só a linha sem custo; busca por MLB", async () => {
    const usuario = userEvent.setup();
    render(<ProdutosMesa linhas={linhasMeli} />);
    await usuario.click(screen.getByRole("button", { name: /^Sem custo/ }));
    expect(screen.getByText("Saia")).toBeInTheDocument();
    expect(screen.queryByText("Calça")).not.toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: /^Todos/ }));
    await usuario.type(screen.getByRole("searchbox", { name: "Buscar produto" }), "MLB1");
    expect(screen.getByText("Calça")).toBeInTheDocument();
    expect(screen.queryByText("Saia")).not.toBeInTheDocument();
  });

  it("um pedido de fora (aviso de pendências) aplica o recorte 'Sem custo'", () => {
    const { rerender } = render(<ProdutosMesa linhas={linhasMeli} />);
    expect(screen.getByText("Calça")).toBeInTheDocument();
    rerender(<ProdutosMesa linhas={linhasMeli} pedido={{ filtro: "sem_custo", seq: 1 }} />);
    expect(screen.queryByText("Calça")).not.toBeInTheDocument();
    expect(screen.getByText("Saia")).toBeInTheDocument();
  });

  it("clicar na linha expande a composição do produto, com os dados da linha", async () => {
    const usuario = userEvent.setup();
    render(<ProdutosMesa linhas={linhasMeli} />);
    const linha = linhaDe("Calça");
    expect(linha).toHaveAttribute("aria-expanded", "false");
    await usuario.click(linha);
    expect(linha).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Composição do produto")).toBeInTheDocument();
    expect(screen.getByText("Repasse / líquido", { selector: "dt" }).nextSibling).toHaveTextContent("R$ 80,00");
  });

  it("pagina linhas grandes (25 por página) e nunca renderiza todas de uma vez", async () => {
    const usuario = userEvent.setup();
    const muitas = normalizarLinhas(Array.from({ length: 3625 }, (_, i) => ({ "# de anúncio": `MLB${i}`, "Título do anúncio": `P${i}`, "Venda Total": 1, LC: 1, MC: 20, "Cobertura de custo": "com custo" })));
    const { container } = render(<ProdutosMesa linhas={muitas} />);
    expect(screen.getByText("Página 1 de 145")).toBeInTheDocument();
    expect(screen.getByText(/3\.625 de 3\.625 linhas · mostrando 1–25/)).toBeInTheDocument();
    expect(linhasVisiveis(container)).toHaveLength(25);
    await usuario.click(screen.getByRole("button", { name: "Próxima" }));
    expect(screen.getByTitle("P25")).toBeInTheDocument();
    expect(screen.queryByTitle("P24")).not.toBeInTheDocument();
  });

  it("o operador escolhe o tamanho da página e a paginação volta para a primeira", async () => {
    const usuario = userEvent.setup();
    const muitas = normalizarLinhas(Array.from({ length: 120 }, (_, i) => ({ "# de anúncio": `MLB${i}`, "Título do anúncio": `P${i}`, "Venda Total": 1, LC: 1, MC: 20, "Cobertura de custo": "com custo" })));
    const { container } = render(<ProdutosMesa linhas={muitas} />);
    await usuario.click(screen.getByRole("button", { name: "Próxima" }));
    await usuario.selectOptions(screen.getByRole("combobox", { name: "Linhas por página" }), "100");
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
    expect(linhasVisiveis(container)).toHaveLength(100);
  });

  it("MC aparece só como valor, pintada pela faixa (sem barra)", () => {
    const { container } = render(<ProdutosMesa linhas={linhasMeli} />);
    const mc = linhaDe("Calça").querySelector(".vf-fin-mesa-produto__mc");
    expect(mc).toHaveTextContent("20,0%");
    expect(mc).toHaveClass("is-saudavel");
    expect(container.querySelector(".mc__bar, .vf-fin-mesa-produto__barra")).toBeNull();
  });

  it("título longo fica numa linha e o texto inteiro no tooltip", () => {
    const titulo = "Kit ".repeat(80).trim();
    const linhas = normalizarLinhas([{ "# de anúncio": "MLB9", "Título do anúncio": titulo, "Venda Total": 1, LC: 1, MC: 20, "Cobertura de custo": "com custo" }]);
    render(<ProdutosMesa linhas={linhas} />);
    expect(screen.getByTitle(titulo)).toHaveClass("vf-fin-mesa-produto__titulo");
  });

  it("amostra do fechamento salvo diz que não são todas as linhas", () => {
    render(<ProdutosMesa linhas={linhasMeli} amostra />);
    expect(screen.getByText(/Amostra de 3 linhas gravadas no fechamento salvo/)).toBeInTheDocument();
  });
});
